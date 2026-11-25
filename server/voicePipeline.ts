import {
  Content,
  FunctionDeclaration,
  GoogleGenAI,
  Part,
  ThinkingLevel,
  Type,
} from '@google/genai';
import crypto from 'crypto';
import WebSocket from 'ws';
import type {
  Appointment,
  CallLog,
  PipelineCapabilities,
  ToolEvent,
  TranscriptEntry,
} from '../src/types/clinic.js';
import {
  bookAppointment,
  cancelAppointment,
  checkDoctorAvailability,
  findAppointmentsByPhone,
  getDoctors,
  getOffsetIsoDate,
  normalizePhone,
  saveCallLog,
} from './db.js';

function createGeminiClient(apiVersion?: string): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function getPipelineCapabilities(): PipelineCapabilities {
  return {
    gemini: Boolean(process.env.GEMINI_API_KEY),
    deepgram: Boolean(process.env.DEEPGRAM_API_KEY),
    sarvam: Boolean(process.env.SARVAM_API_KEY),
  };
}

const modelCooldownUntil = new Map<string, number>();

function isModelCoolingDown(model: string): boolean {
  const until = modelCooldownUntil.get(model);
  if (!until) return false;
  if (Date.now() >= until) {
    modelCooldownUntil.delete(model);
    return false;
  }
  return true;
}

function cleanSpokenText(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pcm16ToWavBuffer(pcm: Buffer, sampleRate = 16000, channels = 1): Buffer {
  const byteRate = sampleRate * channels * 2;
  const blockAlign = channels * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34); // Bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'check_doctor_availability',
    description:
      'Returns available appointment slots for doctors at Tara, optionally filtered by doctor name, medical specialty, or date.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        doctor_name: {
          type: Type.STRING,
          description: 'Doctor name or surname, e.g. "Dr. Ananya Rao" or "Ananya".',
        },
        specialty: {
          type: Type.STRING,
          description:
            'Medical specialty, e.g. "Cardiology", "Dermatology", "Pediatrics", "Orthopedics", "General Medicine", or "General Therapist".',
        },
        date: {
          type: Type.STRING,
          description: 'Optional date in YYYY-MM-DD format, or "today" / "tomorrow".',
        },
      },
    },
  },
  {
    name: 'book_appointment',
    description:
      'Books an available doctor appointment slot for the caller using the phone number they spoke out loud and confirmed.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        phone_number: {
          type: Type.STRING,
          description: 'The caller phone number spoken and confirmed by the caller.',
        },
        doctor_name: {
          type: Type.STRING,
          description: 'Full or partial doctor name, e.g. "Dr. Ananya Rao".',
        },
        date: {
          type: Type.STRING,
          description: 'Appointment date in YYYY-MM-DD format.',
        },
        time: {
          type: Type.STRING,
          description: 'Slot time, e.g. "10:00 AM" or "02:30 PM".',
        },
        patient_name: {
          type: Type.STRING,
          description: 'Optional patient name if provided by the caller.',
        },
        reason: {
          type: Type.STRING,
          description: 'Brief reason for visit if mentioned by the caller.',
        },
      },
      required: ['phone_number', 'doctor_name', 'date', 'time'],
    },
  },
  {
    name: 'cancel_appointment',
    description:
      'Cancels an existing confirmed appointment for the caller using the phone number they spoke out loud and confirmed.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        phone_number: {
          type: Type.STRING,
          description: 'The caller phone number spoken and confirmed by the caller.',
        },
        appointment_id: {
          type: Type.STRING,
          description: 'Optional specific appointment ID if multiple exist.',
        },
      },
      required: ['phone_number'],
    },
  },
  {
    name: 'lookup_caller_appointments',
    description:
      'Looks up existing confirmed appointments associated with a spoken phone number before confirming cancellation.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        phone_number: {
          type: Type.STRING,
          description: 'The phone number spoken by the caller.',
        },
      },
      required: ['phone_number'],
    },
  },
];

function buildSystemInstruction(): string {
  const doctors = getDoctors();
  const docSummary = doctors
    .map((d) => `- ${d.name} (${d.specialty}, ${d.room})`)
    .join('\n');

  return `You are Tara, the front-desk voice appointment assistant at Tara.
Today's date is ${getOffsetIsoDate(0)}, tomorrow is ${getOffsetIsoDate(1)}, and the day after is ${getOffsetIsoDate(2)}.

Clinic Doctors:
${docSummary}

Strict Conversation & Safety Rules:
1. Speak naturally, warmly, and concisely in plain spoken sentences (1 to 3 short sentences per turn). Never use markdown, bullet points, asterisks, emojis, or code formatting because your output is read aloud via text-to-speech.
2. Identify callers ONLY by the phone number they speak out loud during the call. Never mention login, OTP, or caller-ID.
3. ALWAYS read the phone number back clearly to the caller to confirm you heard every digit right BEFORE calling book_appointment or cancel_appointment. Only call book_appointment or cancel_appointment after the caller confirms the phone number and appointment details.
4. When checking availability, call check_doctor_availability and offer 2 to 3 concrete open time slots clearly.
5. If the requested doctor, specialty, or time slot is unavailable or not found, clearly explain that and proactively suggest the nearest available alternatives from the tool response (such as our General Therapist Dr. Kabir Malhotra, General Medicine Dr. Priya Nair, or the doctor's nearest open slots) and offer to book one.
6. When cancelling, if the caller gives a phone number, you may call lookup_caller_appointments first, read back the phone number and the matching appointment details, ask them to confirm, and then call cancel_appointment once confirmed.
7. Format spoken times naturally (for example, "10:00 AM today" or "2:30 PM tomorrow"). Keep numbers clear for speech synthesis.`;
}

async function synthesizeWithSarvam(
  text: string,
  speaker = 'ritu'
): Promise<{ audioBase64: string; mimeType: string; provider: string } | null> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) return null;

  const hasDevanagari = /[\u0900-\u097F]/.test(text);
  const languageCode = hasDevanagari ? 'hi-IN' : 'en-IN';
  const trimmed = text.trim().slice(0, 2400);
  if (!trimmed) return null;

  const response = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: trimmed,
      language_code: languageCode,
      model: 'bulbul:v3',
      speaker,
      pace: 1.04,
      speech_sample_rate: 16000,
      output_audio_codec: 'wav',
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Sarvam TTS error (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as { audios?: string[] };
  const audioBase64 = data.audios?.[0];
  if (!audioBase64) return null;
  return {
    audioBase64,
    mimeType: 'audio/wav',
    provider: 'Sarvam Bulbul v3',
  };
}

async function synthesizeWithGemini(
  _ai: GoogleGenAI,
  text: string
): Promise<{ audioBase64: string; mimeType: string; provider: string } | null> {
  const ttsClient = createGeminiClient('v1beta');
  if (!ttsClient) return null;

  const runRequest = async (model: string, includeMetadata: boolean) => {
    const part: Part = includeMetadata
      ? {
          text,
          speechMetadata: {
            style: 'Warm, calm, articulate medical clinic receptionist on a phone call',
          },
        }
      : { text };

    return ttsClient.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [part] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });
  };

  let lastError: unknown;
  for (const model of ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts']) {
    let response;
    try {
      try {
        response = await runRequest(model, true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('speechMetadata')) throw err;
        response = await runRequest(model, false);
      }
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const canTryNextModel =
        msg.includes('429') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('404') ||
        msg.includes('NOT_FOUND');
      if (!canTryNextModel) throw err;
      continue;
    }

    const audioBase64 =
      response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioBase64) continue;

    return {
      audioBase64,
      mimeType: 'audio/wav',
      provider: model === 'gemini-3.8-flash-tts'
        ? 'Gemini 3.8 Flash TTS'
        : 'Gemini 3.8 Flash-Lite TTS',
    };
  }

  if (lastError) throw lastError;
  throw new Error('Gemini TTS models returned no audio.');
}

async function transcribeWithSarvam(wavBuffer: Buffer): Promise<string | null> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) return null;

  const form = new FormData();
  const blob = new Blob([new Uint8Array(wavBuffer)], { type: 'audio/wav' });
  form.append('file', blob, 'utterance.wav');
  form.append('model', 'saaras:v4');
  form.append('mode', 'transcribe');

  const response = await fetch('https://api.sarvam.ai/speech-to-text', {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey,
    },
    body: form,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Sarvam STT error (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as { transcript?: string };
  return data.transcript?.trim() || '';
}

async function transcribeWithGemini(
  _ai: GoogleGenAI,
  wavBuffer: Buffer
): Promise<string> {
  const sttClient = createGeminiClient('v1beta');
  if (!sttClient) return '';

  const contents = {
    parts: [
      {
        inlineData: {
          mimeType: 'audio/wav',
          data: wavBuffer.toString('base64'),
        },
      },
      {
        text: 'Transcribe the spoken audio accurately, preserving spoken phone digits clearly. Return only the transcription text without extra commentary. If there is no intelligible speech, return an empty string.',
      },
    ],
  };

  const models = [
    'gemini-3.5-transcribe',
    'gemini-3.5-flash-lite',
    'gemini-4-hydrogen',
  ];
  for (const [index, model] of models.entries()) {
    try {
      const response = await sttClient.models.generateContent({
        model,
        contents,
      });
      return (response.text ?? '').trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable =
        msg.includes('404') ||
        msg.includes('NOT_FOUND') ||
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('429');
      if (!isRetryable || index === models.length - 1) {
        throw err;
      }
    }
  }

  return '';
}

export interface DashboardBroadcastEvent {
  type: 'appointments:changed' | 'transcript:update' | 'call:state' | 'call_logs:updated';
  payload: unknown;
}

export class VoiceCallSession {
  private ws: WebSocket;
  private broadcastDashboard: (evt: DashboardBroadcastEvent) => void;
  private ai: GoogleGenAI | null;
  private callId: string;
  private startedAt: string;
  private transcript: TranscriptEntry[] = [];
  private callerPhone: string | null = null;
  private outcome = 'Consultation inquiry';
  private turnId = 0;
  private activeTurnProcessing = false;
  private speaker = 'ritu';
  private sttProvider = 'Gemini 3.5 Transcribe';
  private ttsProvider = 'Gemini 3.8 TTS';

  // Deepgram live socket state
  private deepgramWs: WebSocket | null = null;
  private deepgramFinalBuffer: string[] = [];
  private pendingDeepgramChunks: Buffer[] = [];
  private utteranceFlushTimer: NodeJS.Timeout | null = null;
  private deepgramKeepAliveTimer: NodeJS.Timeout | null = null;

  // Fallback PCM buffer when Deepgram key is absent
  private pcmChunks: Buffer[] = [];

  // Gemini chat instance
  private chat: ReturnType<GoogleGenAI['chats']['create']> | null = null;
  private currentModel = 'gemini-4-hydrogen';
  private started = false;
  private closed = false;

  constructor(
    ws: WebSocket,
    broadcastDashboard: (evt: DashboardBroadcastEvent) => void
  ) {
    this.ws = ws;
    this.broadcastDashboard = broadcastDashboard;
    this.ai = createGeminiClient();
    this.callId = `CALL-${crypto.randomInt(10000, 99999)}`;
    this.startedAt = new Date().toISOString();
  }

  private createChatForModel(model: string, history?: Content[]) {
    return this.ai!.chats.create({
      model,
      history,
      config: {
        systemInstruction: buildSystemInstruction(),
        tools: [{ functionDeclarations: toolDeclarations }],
        ...(model === 'gemini-4-hydrogen'
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : {}),
      },
    });
  }

  private sendClient(data: Record<string, unknown>): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private pushTranscript(entry: TranscriptEntry): void {
    this.transcript.push(entry);
    this.sendClient({ type: 'transcript_entry', entry });
    this.broadcastDashboard({
      type: 'transcript:update',
      payload: { callId: this.callId, entry },
    });
  }

  public setSpeaker(speaker: string): void {
    if (speaker === 'ritu' || speaker === 'shubh') {
      this.speaker = speaker;
    }
  }

  public async start(options?: { speaker?: string }): Promise<void> {
    if (options?.speaker) {
      this.setSpeaker(options.speaker);
    }
    this.started = true;

    const caps = getPipelineCapabilities();
    if (!this.ai) {
      this.sendClient({
        type: 'error',
        message:
          'GEMINI_API_KEY is not configured. Please add it in Settings > Secrets.',
      });
      return;
    }

    this.sttProvider = caps.deepgram
      ? 'Deepgram Nova-3'
      : caps.sarvam
      ? 'Sarvam Saaras v4'
      : 'Gemini 3.5 Transcribe';

    this.ttsProvider = caps.sarvam ? 'Sarvam Bulbul v3' : 'Gemini 3.8 TTS';

    this.currentModel = 'gemini-4-hydrogen';
    this.chat = this.createChatForModel(this.currentModel);

    if (caps.deepgram) {
      this.connectDeepgramLive();
    }

    this.sendClient({
      type: 'call_ready',
      callId: this.callId,
      providers: {
        stt: this.sttProvider,
        tts: this.ttsProvider,
        llm: 'Gemini 4 Hydrogen',
      },
    });

    this.broadcastDashboard({
      type: 'call:state',
      payload: { state: 'connected', callId: this.callId, startedAt: this.startedAt },
    });

    const greeting =
      'Hello, thank you for calling Tara. This is Tara. How can I help you with an appointment today?';
    await this.emitAgentSpeech(greeting, ++this.turnId);
  }

  private handleDeepgramFailure(reason: string): void {
    console.warn('Deepgram live STT unavailable, switching fallback:', reason);
    if (this.deepgramKeepAliveTimer) {
      clearInterval(this.deepgramKeepAliveTimer);
      this.deepgramKeepAliveTimer = null;
    }
    this.deepgramWs = null;
    if (this.pendingDeepgramChunks.length > 0) {
      this.pcmChunks.push(...this.pendingDeepgramChunks);
      this.pendingDeepgramChunks = [];
    }
    this.sttProvider = process.env.SARVAM_API_KEY
      ? 'Sarvam Saaras v4'
      : 'Gemini 3.5 Transcribe';
    this.sendClient({
      type: 'provider_notice',
      stt: this.sttProvider,
      message: reason,
    });
  }

  private connectDeepgramLive(): void {
    const dgKey = process.env.DEEPGRAM_API_KEY;
    if (!dgKey) return;

    const dgUrl =
      'wss://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true&interim_results=true&endpointing=350&utterance_end_ms=1000&encoding=linear16&sample_rate=16000';

    const dgSocket = new WebSocket(dgUrl, {
      headers: {
        Authorization: `Token ${dgKey}`,
      },
    });
    this.deepgramWs = dgSocket;

    dgSocket.on('open', () => {
      if (this.closed || this.deepgramWs !== dgSocket) return;
      if (this.pendingDeepgramChunks.length > 0) {
        for (const chunk of this.pendingDeepgramChunks) {
          dgSocket.send(chunk);
        }
        this.pendingDeepgramChunks = [];
      }
      if (this.deepgramKeepAliveTimer) {
        clearInterval(this.deepgramKeepAliveTimer);
      }
      this.deepgramKeepAliveTimer = setInterval(() => {
        if (this.deepgramWs && this.deepgramWs.readyState === WebSocket.OPEN) {
          this.deepgramWs.send(JSON.stringify({ type: 'KeepAlive' }));
        }
      }, 5000);
    });

    dgSocket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          is_final?: boolean;
          speech_final?: boolean;
          from_finalize?: boolean;
          channel?: { alternatives?: Array<{ transcript?: string }> };
        };

        if (msg.type === 'UtteranceEnd') {
          this.flushDeepgramBuffer();
          return;
        }

        const alt = msg.channel?.alternatives?.[0]?.transcript?.trim() || '';
        if (!alt) {
          if (msg.from_finalize) {
            this.flushDeepgramBuffer();
          }
          return;
        }

        if (!msg.is_final) {
          this.sendClient({ type: 'interim_transcript', text: alt });
        } else {
          this.deepgramFinalBuffer.push(alt);
          this.sendClient({
            type: 'interim_transcript',
            text: this.deepgramFinalBuffer.join(' '),
          });
          if (msg.speech_final || msg.from_finalize) {
            this.flushDeepgramBuffer();
          } else {
            if (this.utteranceFlushTimer) clearTimeout(this.utteranceFlushTimer);
            this.utteranceFlushTimer = setTimeout(() => {
              this.flushDeepgramBuffer();
            }, 650);
          }
        }
      } catch (err) {
        console.error('Deepgram parse error:', err);
      }
    });

    dgSocket.on('unexpected-response', (_req, res) => {
      this.handleDeepgramFailure(`Deepgram rejected handshake (${res.statusCode}).`);
    });

    dgSocket.on('error', (err) => {
      this.handleDeepgramFailure(err.message || 'Deepgram socket error');
    });

    dgSocket.on('close', () => {
      if (this.deepgramKeepAliveTimer) {
        clearInterval(this.deepgramKeepAliveTimer);
        this.deepgramKeepAliveTimer = null;
      }
      if (this.deepgramWs === dgSocket) {
        this.deepgramWs = null;
      }
    });
  }

  private flushDeepgramBuffer(): void {
    if (this.utteranceFlushTimer) {
      clearTimeout(this.utteranceFlushTimer);
      this.utteranceFlushTimer = null;
    }
    const text = this.deepgramFinalBuffer.join(' ').trim();
    this.deepgramFinalBuffer = [];
    if (text) {
      this.sendClient({ type: 'interim_transcript', text: '' });
      void this.handleCallerUtterance(text);
    }
  }

  public handleSpeechStart(): void {
    if (this.closed || !this.started) return;
    // In fallback mode without live Deepgram, keep only a short ~0.4s pre-roll before speech onset
    if (!this.deepgramWs || this.deepgramWs.readyState !== WebSocket.OPEN) {
      const combined = Buffer.concat(this.pcmChunks);
      const maxPreRollBytes = 12800; // 0.4s at 16kHz 16-bit mono
      this.pcmChunks =
        combined.length > maxPreRollBytes
          ? [combined.subarray(combined.length - maxPreRollBytes)]
          : combined.length > 0
          ? [combined]
          : [];
    }
  }

  public handleAudioChunk(chunk: Buffer): void {
    if (this.closed || !this.started) return;
    if (this.deepgramWs) {
      if (this.deepgramWs.readyState === WebSocket.OPEN) {
        this.deepgramWs.send(chunk);
        return;
      }
      if (this.deepgramWs.readyState === WebSocket.CONNECTING) {
        this.pendingDeepgramChunks.push(chunk);
        return;
      }
    }

    this.pcmChunks.push(chunk);
    // Cap rolling fallback buffer to ~15 seconds (480,000 bytes)
    let totalBytes = 0;
    for (const b of this.pcmChunks) totalBytes += b.length;
    while (totalBytes > 480000 && this.pcmChunks.length > 1) {
      const removed = this.pcmChunks.shift()!;
      totalBytes -= removed.length;
    }
  }

  public async handleSpeechEnd(): Promise<void> {
    if (this.closed || !this.started) return;
    // When Deepgram live streaming is active, force an immediate flush via Finalize
    if (this.deepgramWs && this.deepgramWs.readyState === WebSocket.OPEN) {
      this.deepgramWs.send(JSON.stringify({ type: 'Finalize' }));
      return;
    }

    if (this.pcmChunks.length === 0) return;
    const combinedPcm = Buffer.concat(this.pcmChunks);
    this.pcmChunks = [];

    // Ignore tiny clicks < 0.25s at 16kHz 16-bit mono (8000 bytes)
    if (combinedPcm.length < 8000) return;

    const wavBuffer = pcm16ToWavBuffer(combinedPcm, 16000, 1);

    try {
      this.sendClient({ type: 'agent_state', state: 'transcribing' });
      let text: string | null = null;

      if (process.env.SARVAM_API_KEY) {
        try {
          text = await transcribeWithSarvam(wavBuffer);
        } catch (sarvamErr) {
          console.warn('Sarvam STT failed, falling back to Gemini STT:', sarvamErr);
        }
      }

      if (text === null && this.ai) {
        text = await transcribeWithGemini(this.ai, wavBuffer);
      }

      if (text && text.trim()) {
        await this.handleCallerUtterance(text.trim());
      } else {
        this.sendClient({ type: 'agent_state', state: 'listening' });
      }
    } catch (err) {
      console.error('Speech transcription failed:', err);
      const errorText = err instanceof Error ? err.message : String(err);
      const isRateLimited =
        errorText.includes('429') || errorText.includes('RESOURCE_EXHAUSTED');
      const isTemporarilyUnavailable =
        errorText.includes('503') || errorText.includes('UNAVAILABLE');
      this.sendClient({
        type: 'error',
        message: isRateLimited
          ? 'Tara has reached Gemini’s speech-recognition request limit. You can type your message or try again later.'
          : isTemporarilyUnavailable
          ? 'Gemini speech recognition is temporarily busy. Please try again in a few seconds or type your message.'
          : 'Tara could not transcribe that audio. Please try again or type your message.',
      });
      this.sendClient({ type: 'agent_state', state: 'listening' });
    }
  }

  public handleBargeIn(): void {
    this.turnId += 1;
    this.sendClient({ type: 'stop_audio' });
  }

  private executeClinicTool(
    toolName: string,
    args: Record<string, unknown>
  ): Record<string, unknown> {
    let toolResult: Record<string, unknown> = {};

    if (toolName === 'check_doctor_availability') {
      toolResult = checkDoctorAvailability({
        doctor_name: args.doctor_name as string | undefined,
        specialty: args.specialty as string | undefined,
        date: args.date as string | undefined,
      });
    } else if (toolName === 'book_appointment') {
      const booked = bookAppointment({
        phone_number: String(args.phone_number || ''),
        doctor_name: String(args.doctor_name || ''),
        date: String(args.date || ''),
        time: String(args.time || ''),
        patient_name: args.patient_name as string | undefined,
        reason: args.reason as string | undefined,
      });
      toolResult = booked as unknown as Record<string, unknown>;
      if (booked.success && booked.appointment) {
        this.callerPhone = booked.appointment.phoneNormalized;
        this.outcome = `Booked ${booked.appointment.doctorName} (${booked.appointment.time})`;
        this.sendClient({
          type: 'booking_card',
          action: 'booked',
          appointment: booked.appointment,
        });
        this.broadcastDashboard({
          type: 'appointments:changed',
          payload: {
            action: 'booked',
            appointment: booked.appointment,
          },
        });
      }
    } else if (toolName === 'cancel_appointment') {
      const cancelled = cancelAppointment({
        phone_number: String(args.phone_number || ''),
        appointment_id: args.appointment_id as string | undefined,
      });
      toolResult = cancelled as unknown as Record<string, unknown>;
      if (cancelled.success && cancelled.cancelledAppointment) {
        const apt = cancelled.cancelledAppointment as Appointment;
        this.callerPhone = apt.phoneNormalized;
        this.outcome = `Cancelled ${apt.id} (${apt.doctorName})`;
        this.sendClient({
          type: 'booking_card',
          action: 'cancelled',
          appointment: apt,
        });
        this.broadcastDashboard({
          type: 'appointments:changed',
          payload: {
            action: 'cancelled',
            appointment: apt,
          },
        });
      }
    } else if (toolName === 'lookup_caller_appointments') {
      const phoneStr = String(args.phone_number || '');
      const matches = findAppointmentsByPhone(phoneStr);
      if (normalizePhone(phoneStr).length >= 7) {
        this.callerPhone = normalizePhone(phoneStr);
      }
      toolResult = {
        found: matches.length > 0,
        appointments: matches,
      };
    }

    if (
      toolName === 'check_doctor_availability' ||
      toolName === 'book_appointment' ||
      toolName === 'cancel_appointment'
    ) {
      const toolEvent: ToolEvent = {
        id: `tool-${Date.now()}-${crypto.randomInt(100, 999)}`,
        name: toolName as ToolEvent['name'],
        args,
        result: toolResult,
        timestamp: new Date().toISOString(),
      };
      this.pushTranscript({
        id: toolEvent.id,
        speaker: 'tool',
        text:
          toolName === 'check_doctor_availability'
            ? 'Checked doctor availability'
            : toolName === 'book_appointment'
            ? 'Executed appointment booking'
            : 'Executed appointment cancellation',
        timestamp: toolEvent.timestamp,
        toolEvent,
      });
    }

    return toolResult;
  }

  private async runSarvamLlmTurn(): Promise<string> {
    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) {
      throw new Error('SARVAM_API_KEY not configured for LLM fallback.');
    }

    const openAiTools = [
      {
        type: 'function',
        function: {
          name: 'check_doctor_availability',
          description:
            'Returns available appointment slots for doctors at Tara, optionally filtered by doctor name, medical specialty, or date.',
          parameters: {
            type: 'object',
            properties: {
              doctor_name: { type: 'string' },
              specialty: { type: 'string' },
              date: { type: 'string', description: 'YYYY-MM-DD, today, or tomorrow' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'book_appointment',
          description:
            'Books an available doctor appointment slot using the phone number spoken and confirmed by the caller.',
          parameters: {
            type: 'object',
            properties: {
              phone_number: { type: 'string' },
              doctor_name: { type: 'string' },
              date: { type: 'string' },
              time: { type: 'string' },
              patient_name: { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['phone_number', 'doctor_name', 'date', 'time'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cancel_appointment',
          description:
            'Cancels an existing confirmed appointment using the phone number spoken and confirmed by the caller.',
          parameters: {
            type: 'object',
            properties: {
              phone_number: { type: 'string' },
              appointment_id: { type: 'string' },
            },
            required: ['phone_number'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'lookup_caller_appointments',
          description:
            'Looks up existing confirmed appointments associated with a spoken phone number.',
          parameters: {
            type: 'object',
            properties: {
              phone_number: { type: 'string' },
            },
            required: ['phone_number'],
          },
        },
      },
    ];

    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: buildSystemInstruction() },
    ];
    for (const entry of this.transcript) {
      if (entry.speaker === 'caller') {
        messages.push({ role: 'user', content: entry.text });
      } else if (entry.speaker === 'agent') {
        messages.push({ role: 'assistant', content: entry.text });
      } else if (entry.speaker === 'tool' && entry.toolEvent) {
        messages.push({
          role: 'system',
          content: `Tool ${entry.toolEvent.name} was already executed with args ${JSON.stringify(entry.toolEvent.args)} and returned: ${JSON.stringify(entry.toolEvent.result)}. Use this result directly to answer the caller.`,
        });
      }
    }

    const errors: string[] = [];
    for (const sarvamModel of ['sarvam-105b-conversations', 'sarvam-105b']) {
      try {
        const convo = [...messages];
        for (let loop = 0; loop < 5; loop++) {
          const resp = await fetch('https://api.sarvam.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'api-subscription-key': apiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: sarvamModel,
              messages: convo,
              tools: openAiTools,
              tool_choice: 'auto',
              temperature: 0.2,
              max_tokens: 2048,
            }),
          });

          if (!resp.ok) {
            const errTxt = await resp.text().catch(() => '');
            throw new Error(`Sarvam ${sarvamModel} (${resp.status}): ${errTxt.slice(0, 180)}`);
          }

          const data = (await resp.json()) as {
            choices?: Array<{
              finish_reason?: string;
              message?: {
                content?: string | null;
                reasoning_content?: string | null;
                tool_calls?: Array<{
                  id: string;
                  function: { name: string; arguments: string };
                }>;
              };
            }>;
          };

          const choice = data.choices?.[0];
          const msg = choice?.message;
          if (!msg) throw new Error(`Empty ${sarvamModel} response`);

          if (msg.tool_calls && msg.tool_calls.length > 0) {
            convo.push({
              role: 'assistant',
              content: msg.content || '',
              tool_calls: msg.tool_calls,
            });

            for (const tc of msg.tool_calls) {
              let parsedArgs: Record<string, unknown> = {};
              try {
                parsedArgs = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
              } catch {
                parsedArgs = {};
              }
              const toolResult = this.executeClinicTool(tc.function.name, parsedArgs);
              convo.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify(toolResult),
              });
            }
            continue;
          }

          const cleaned = cleanSpokenText(msg.content || '');
          if (cleaned) return cleaned;
          throw new Error(
            `Empty ${sarvamModel} response text (finish=${choice?.finish_reason || 'unknown'}, hasReasoning=${Boolean(msg.reasoning_content)})`
          );
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push(errMsg);
        console.warn(`Sarvam LLM ${sarvamModel} failed:`, errMsg);
      }
    }

    throw new Error(`LLM failover unavailable: ${errors.join(' | ')}`);
  }

  public async handleCallerUtterance(text: string): Promise<void> {
    if (this.closed || !this.chat || !this.ai) return;
    const cleanText = text.trim();
    if (!cleanText) return;

    const myTurn = ++this.turnId;
    this.pushTranscript({
      id: `tr-${Date.now()}-${crypto.randomInt(100, 999)}`,
      speaker: 'caller',
      text: cleanText,
      timestamp: new Date().toISOString(),
    });

    // Capture spoken phone digits if clearly present
    const digitMatches = cleanText.replace(/[\s-]/g, '').match(/\d{10}/);
    if (digitMatches?.[0]) {
      this.callerPhone = digitMatches[0];
    }

    this.sendClient({ type: 'agent_state', state: 'thinking' });

    try {
      this.activeTurnProcessing = true;
      const sendWithFailover = async (message: string | Part[]) => {
        const candidateModels = ['gemini-4-hydrogen', 'gemini-3.5-flash-lite'].filter(
          (m) => !isModelCoolingDown(m)
        );
        const modelsToTry = candidateModels.includes(this.currentModel)
          ? [this.currentModel, ...candidateModels.filter((m) => m !== this.currentModel)]
          : candidateModels;

        if (modelsToTry.length === 0) {
          throw new Error('Gemini models in cooldown');
        }

        let lastErr: unknown;
        for (const modelName of modelsToTry) {
          if (modelName !== this.currentModel) {
            const priorHistory = this.chat?.getHistory() || [];
            this.currentModel = modelName;
            this.chat = this.createChatForModel(modelName, priorHistory);
          }

          try {
            return await this.chat!.sendMessage({ message });
          } catch (err) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`Gemini ${modelName} failed:`, msg.slice(0, 140));
            if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
              // Avoid hammering quota-exhausted model on subsequent turns
              modelCooldownUntil.set(modelName, Date.now() + 10 * 60 * 1000);
            } else if (msg.includes('503') || msg.includes('UNAVAILABLE')) {
              modelCooldownUntil.set(modelName, Date.now() + 30 * 1000);
            }
            const isTransient =
              msg.includes('503') ||
              msg.includes('UNAVAILABLE') ||
              msg.includes('429') ||
              msg.includes('RESOURCE_EXHAUSTED') ||
              msg.includes('404') ||
              msg.includes('NOT_FOUND');
            if (!isTransient) throw err;
          }
        }
        throw lastErr;
      };

      let replyText = '';
      try {
        let response = await sendWithFailover(cleanText);
        let safetyLoop = 0;
        while (response.functionCalls && response.functionCalls.length > 0 && safetyLoop < 5) {
          safetyLoop += 1;
          const functionResponseParts: Part[] = [];
          for (const call of response.functionCalls) {
            const toolName = call.name || '';
            const args = (call.args || {}) as Record<string, unknown>;
            const toolResult = this.executeClinicTool(toolName, args);
            functionResponseParts.push({
              functionResponse: {
                id: call.id,
                name: toolName,
                response: toolResult,
              },
            });
          }
          response = await sendWithFailover(functionResponseParts);
        }
        replyText = cleanSpokenText(response.text ?? '');
      } catch (geminiErr) {
        if (process.env.SARVAM_API_KEY) {
          console.warn(
            'Gemini unavailable, switching to Sarvam LLM fallback:',
            geminiErr instanceof Error ? geminiErr.message.slice(0, 120) : geminiErr
          );
          replyText = await this.runSarvamLlmTurn();
        } else {
          throw geminiErr;
        }
      }

      if (replyText && myTurn === this.turnId && !this.closed) {
        await this.emitAgentSpeech(replyText, myTurn);
      } else {
        this.sendClient({ type: 'agent_state', state: 'listening' });
      }
    } catch (err) {
      console.error('LLM turn error:', err);
      const errorText = err instanceof Error ? err.message : String(err);
      const isRateLimited =
        errorText.includes('429') || errorText.includes('RESOURCE_EXHAUSTED');
      const isTemporarilyUnavailable =
        errorText.includes('503') ||
        errorText.includes('UNAVAILABLE') ||
        errorText.includes('Gemini models in cooldown');
      this.sendClient({
        type: 'error',
        message: isRateLimited
          ? 'Tara has reached Gemini’s request limit. Please wait a moment before trying again.'
          : isTemporarilyUnavailable
          ? 'Gemini is temporarily busy. Please wait about 30 seconds, then try speaking again.'
          : errorText,
      });
      this.sendClient({ type: 'agent_state', state: 'listening' });
    } finally {
      this.activeTurnProcessing = false;
    }
  }

  private async emitAgentSpeech(text: string, myTurn: number): Promise<void> {
    if (this.closed || myTurn !== this.turnId) return;

    this.pushTranscript({
      id: `tr-${Date.now()}-${crypto.randomInt(100, 999)}`,
      speaker: 'agent',
      text,
      timestamp: new Date().toISOString(),
    });

    this.sendClient({ type: 'agent_state', state: 'speaking' });

    try {
      let synthesized: {
        audioBase64: string;
        mimeType: string;
        provider: string;
      } | null = null;

      if (process.env.SARVAM_API_KEY) {
        try {
          synthesized = await synthesizeWithSarvam(text, this.speaker);
        } catch (sarvamErr) {
          console.warn('Sarvam TTS failed, falling back to Gemini TTS:', sarvamErr);
        }
      }

      if (!synthesized && this.ai) {
        synthesized = await synthesizeWithGemini(this.ai, text);
      }

      if (myTurn !== this.turnId || this.closed) return;

      if (synthesized) {
        this.ttsProvider = synthesized.provider;
        this.sendClient({
          type: 'agent_audio',
          audioBase64: synthesized.audioBase64,
          mimeType: synthesized.mimeType,
          provider: synthesized.provider,
          turnId: myTurn,
        });
      } else {
        this.sendClient({ type: 'agent_state', state: 'listening' });
      }
    } catch (err) {
      console.error('TTS error:', err);
      const errorText = err instanceof Error ? err.message : String(err);
      const isQuotaExceeded =
        errorText.includes('429') || errorText.includes('RESOURCE_EXHAUSTED');
      const isTemporarilyUnavailable =
        errorText.includes('503') || errorText.includes('UNAVAILABLE');
      this.sendClient({
        type: 'error',
        message: isQuotaExceeded
          ? 'Tara’s voice playback quota is temporarily unavailable. You can continue by typing messages; add SARVAM_API_KEY for an alternate voice service.'
          : isTemporarilyUnavailable
          ? 'Tara’s voice service is temporarily busy. You can continue by typing messages.'
          : 'Tara could not generate voice audio. You can continue by typing messages.',
      });
      this.sendClient({ type: 'agent_state', state: 'listening' });
    }
  }

  public end(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.deepgramKeepAliveTimer) {
      clearInterval(this.deepgramKeepAliveTimer);
      this.deepgramKeepAliveTimer = null;
    }
    if (this.utteranceFlushTimer) {
      clearTimeout(this.utteranceFlushTimer);
      this.utteranceFlushTimer = null;
    }
    if (this.deepgramWs) {
      try {
        if (this.deepgramWs.readyState === WebSocket.OPEN) {
          this.deepgramWs.send(JSON.stringify({ type: 'CloseStream' }));
        }
        this.deepgramWs.close();
      } catch {
        // Ignore close errors
      }
      this.deepgramWs = null;
    }

    const endedAt = new Date().toISOString();
    const durationSeconds = Math.max(
      1,
      Math.round((new Date(endedAt).getTime() - new Date(this.startedAt).getTime()) / 1000)
    );

    if (this.transcript.length > 0) {
      const log: CallLog = {
        id: this.callId,
        startedAt: this.startedAt,
        endedAt,
        durationSeconds,
        callerPhone: this.callerPhone,
        sttProvider: this.sttProvider,
        ttsProvider: this.ttsProvider,
        outcome: this.outcome,
        transcript: this.transcript,
      };
      saveCallLog(log);
      this.broadcastDashboard({
        type: 'call_logs:updated',
        payload: log,
      });
    }

    this.broadcastDashboard({
      type: 'call:state',
      payload: { state: 'ended', callId: this.callId },
    });
  }
}
