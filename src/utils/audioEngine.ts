// Client-side Web Audio API engine for continuous 16kHz PCM streaming, RMS VAD, ring/hangup tones, and agent playback

export interface AudioEngineCallbacks {
  onAudioLevel: (level: number, source: 'mic' | 'agent' | 'idle') => void;
  onPcmChunk: (pcm16: ArrayBuffer) => void;
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  onAgentPlaybackEnd: () => void;
  onMicError: (message: string) => void;
}

export class VoiceAudioEngine {
  private ctx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private silentGain: GainNode | null = null;

  private activePlaybackSource: AudioBufferSourceNode | null = null;
  private agentAnalyser: AnalyserNode | null = null;
  private agentAnimFrame: number | null = null;

  private ringInterval: number | null = null;
  private thinkingInterval: number | null = null;
  private muted = false;
  private destroyed = false;

  // Sensitive client-side RMS VAD state (for Finalize & fallback utterance capture)
  private speaking = false;
  private silenceStartMs = 0;
  private speechStartThreshold = 0.0055;
  private bargeInThreshold = 0.032;
  private bargeInFrames = 0;
  private silenceDurationMs = 750;

  private callbacks: AudioEngineCallbacks;

  constructor(callbacks: AudioEngineCallbacks) {
    this.callbacks = callbacks;
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  public startRingback(): void {
    this.stopRingback();
    void this.ensureContext().then((ctx) => {
      if (this.destroyed) return;
      const playBurst = () => {
        if (this.destroyed) return;
        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc1.type = 'sine';
        osc2.type = 'sine';
        osc1.frequency.value = 440;
        osc2.frequency.value = 480;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.045, now + 0.05);
        gain.gain.setValueAtTime(0.045, now + 0.9);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.05);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.06);
        osc2.stop(now + 1.06);
      };
      playBurst();
      this.ringInterval = window.setInterval(playBurst, 2100);
    }).catch(() => {
      // Ignore autoplay blocks
    });
  }

  public stopRingback(): void {
    if (this.ringInterval !== null) {
      window.clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
  }

  public startThinkingTone(): void {
    if (this.thinkingInterval !== null || this.destroyed) return;
    void this.ensureContext().then((ctx) => {
      if (this.destroyed) return;
      const playSoftPulse = () => {
        if (this.destroyed) return;
        const now = ctx.currentTime;
        // Soft two-note ascending marimba-like waiting chime
        const notes = [
          { freq: 587.33, offset: 0 },
          { freq: 783.99, offset: 0.11 },
        ];
        for (const n of notes) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(n.freq, now + n.offset);
          gain.gain.setValueAtTime(0.0001, now + n.offset);
          gain.gain.exponentialRampToValueAtTime(0.022, now + n.offset + 0.025);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + n.offset + 0.24);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + n.offset);
          osc.stop(now + n.offset + 0.25);
        }
      };
      playSoftPulse();
      this.thinkingInterval = window.setInterval(playSoftPulse, 1700);
    }).catch(() => {
      // Ignore
    });
  }

  public stopThinkingTone(): void {
    if (this.thinkingInterval !== null) {
      window.clearInterval(this.thinkingInterval);
      this.thinkingInterval = null;
    }
  }

  public playHangupTone(): void {
    void this.ensureContext().then((ctx) => {
      if (this.destroyed) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(340, now + 0.18);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.24);
    }).catch(() => {
      // Ignore
    });
  }

  public async startMicrophone(): Promise<boolean> {
    try {
      const ctx = await this.ensureContext();
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });

      this.micSource = ctx.createMediaStreamSource(this.micStream);
      this.processor = ctx.createScriptProcessor(2048, 1, 1);
      this.silentGain = ctx.createGain();
      this.silentGain.gain.value = 0;

      const inputSampleRate = ctx.sampleRate;
      const targetSampleRate = 16000;

      this.processor.onaudioprocess = (event) => {
        if (this.destroyed || this.muted) {
          if (!this.activePlaybackSource) {
            this.callbacks.onAudioLevel(0, 'idle');
          }
          return;
        }

        const inputData = event.inputBuffer.getChannelData(0);

        // Compute RMS amplitude [0..1]
        let sumSq = 0;
        for (let i = 0; i < inputData.length; i++) {
          sumSq += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sumSq / inputData.length);
        const normalizedLevel = Math.min(1, rms * 9);

        // Barge-in detection only on sustained direct speech when agent is speaking
        if (this.activePlaybackSource) {
          if (rms > this.bargeInThreshold) {
            this.bargeInFrames += 1;
            if (this.bargeInFrames >= 3) {
              this.bargeInFrames = 0;
              this.speaking = true;
              this.silenceStartMs = 0;
              this.callbacks.onSpeechStart();
            }
          } else {
            this.bargeInFrames = 0;
          }
          return;
        }

        // Stream continuous 16kHz PCM frames while listening so server STT/endpointing stays responsive without speaker echo
        const downsampled = this.downsampleToInt16(
          inputData,
          inputSampleRate,
          targetSampleRate
        );
        this.callbacks.onPcmChunk(downsampled.buffer as ArrayBuffer);

        this.callbacks.onAudioLevel(
          normalizedLevel,
          rms > this.speechStartThreshold ? 'mic' : 'idle'
        );

        const now = performance.now();
        if (rms > this.speechStartThreshold) {
          this.silenceStartMs = 0;
          if (!this.speaking) {
            this.speaking = true;
            this.callbacks.onSpeechStart();
          }
        } else if (this.speaking) {
          if (this.silenceStartMs === 0) {
            this.silenceStartMs = now;
          } else if (now - this.silenceStartMs >= this.silenceDurationMs) {
            this.speaking = false;
            this.silenceStartMs = 0;
            this.callbacks.onSpeechEnd();
          }
        }
      };

      this.micSource.connect(this.processor);
      this.processor.connect(this.silentGain);
      this.silentGain.connect(ctx.destination);
      return true;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Microphone access was denied or unavailable.';
      this.callbacks.onMicError(msg);
      return false;
    }
  }

  private downsampleToInt16(
    float32Array: Float32Array,
    inputRate: number,
    outputRate: number
  ): Int16Array {
    if (inputRate === outputRate) {
      const out = new Int16Array(float32Array.length);
      for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return out;
    }

    const ratio = inputRate / outputRate;
    const newLength = Math.round(float32Array.length / ratio);
    const result = new Int16Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < float32Array.length; i++) {
        accum += float32Array[i];
        count++;
      }
      const sample = count > 0 ? accum / count : 0;
      const clamped = Math.max(-1, Math.min(1, sample));
      result[offsetResult] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted && this.speaking) {
      this.speaking = false;
      this.callbacks.onSpeechEnd();
    }
  }

  public async playBase64Audio(base64: string): Promise<void> {
    this.stopThinkingTone();
    this.stopAgentPlayback(false);
    this.speaking = false;
    this.silenceStartMs = 0;
    this.bargeInFrames = 0;
    try {
      const ctx = await this.ensureContext();
      const binaryStr = atob(base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
      if (this.destroyed) return;

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(ctx.destination);

      this.activePlaybackSource = source;
      this.agentAnalyser = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!this.activePlaybackSource || !this.agentAnalyser || this.destroyed) {
          return;
        }
        this.agentAnalyser.getByteTimeDomainData(dataArray);
        let sumSq = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / dataArray.length);
        this.callbacks.onAudioLevel(Math.min(1, rms * 4.5), 'agent');
        this.agentAnimFrame = requestAnimationFrame(tick);
      };
      this.agentAnimFrame = requestAnimationFrame(tick);

      source.onended = () => {
        if (this.activePlaybackSource === source) {
          this.stopAgentPlayback(true);
        }
      };
      source.start(0);
    } catch (err) {
      console.error('Audio playback failed:', err);
      this.callbacks.onAgentPlaybackEnd();
    }
  }

  public stopAgentPlayback(notifyEnd = true): void {
    if (this.agentAnimFrame !== null) {
      cancelAnimationFrame(this.agentAnimFrame);
      this.agentAnimFrame = null;
    }
    if (this.activePlaybackSource) {
      try {
        this.activePlaybackSource.onended = null;
        this.activePlaybackSource.stop();
        this.activePlaybackSource.disconnect();
      } catch {
        // Ignore already stopped
      }
      this.activePlaybackSource = null;
    }
    this.agentAnalyser = null;
    this.callbacks.onAudioLevel(0, 'idle');
    if (notifyEnd) {
      this.callbacks.onAgentPlaybackEnd();
    }
  }

  public destroy(): void {
    this.destroyed = true;
    this.stopRingback();
    this.stopThinkingTone();
    this.stopAgentPlayback(false);

    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }
    if (this.silentGain) {
      this.silentGain.disconnect();
      this.silentGain = null;
    }
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) {
        track.stop();
      }
      this.micStream = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
