import React, { useEffect, useRef, useState } from 'react';
import {
  CalendarCheck2,
  CalendarX2,
  Download,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Phone,
  PhoneOff,
  Send,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { Appointment, CallState, TranscriptEntry } from '../types/clinic';
import { VoiceWaveform } from './VoiceWaveform';

interface PhoneCallOverlayProps {
  open: boolean;
  minimized: boolean;
  callState: CallState;
  agentStatus: 'listening' | 'transcribing' | 'thinking' | 'speaking';
  elapsedSeconds: number;
  muted: boolean;
  speakerMuted: boolean;
  audioLevel: number;
  audioSource: 'mic' | 'agent' | 'idle';
  transcript: TranscriptEntry[];
  interimTranscript: string;
  bookingCard: { action: 'booked' | 'cancelled'; appointment: Appointment } | null;
  providers: { stt: string; tts: string; llm: string } | null;
  errorMessage: string | null;
  selectedVoice: 'ritu' | 'shubh';
  onVoiceChange: (voice: 'ritu' | 'shubh') => void;
  onToggleMinimize: () => void;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onEndCall: () => void;
  onStartNewCall: () => void;
  onCloseOverlay: () => void;
  onSendTextUtterance: (text: string) => void;
  onDownloadToken: (appointment: Appointment) => void;
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const PhoneCallOverlay: React.FC<PhoneCallOverlayProps> = ({
  open,
  minimized,
  callState,
  agentStatus,
  elapsedSeconds,
  muted,
  speakerMuted,
  audioLevel,
  audioSource,
  transcript,
  interimTranscript,
  bookingCard,
  providers,
  errorMessage,
  selectedVoice,
  onVoiceChange,
  onToggleMinimize,
  onToggleMute,
  onToggleSpeaker,
  onEndCall,
  onStartNewCall,
  onCloseOverlay,
  onSendTextUtterance,
  onDownloadToken,
}) => {
  const [textInput, setTextInput] = useState('');
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, interimTranscript, bookingCard]);

  if (!open) return null;

  const handleSubmitText = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = textInput.trim();
    if (!trimmed || callState !== 'connected') return;
    onSendTextUtterance(trimmed);
    setTextInput('');
  };

  if (minimized) {
    return (
      <div className="fixed right-5 bottom-5 z-50 flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white shadow-2xl">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-600/20 text-teal-300">
          <Phone className="h-4 w-4" />
        </div>
        <div className="min-w-[140px]">
          <p className="font-display text-sm font-semibold text-white">
            Tara Care Desk
          </p>
          <p className="font-mono text-xs text-slate-400 tabular-nums">
            {callState === 'ringing'
              ? 'Ringing...'
              : callState === 'connected'
              ? `Connected · ${formatTimer(elapsedSeconds)}`
              : 'Call ended'}
          </p>
        </div>
        {callState === 'connected' && (
          <button
            type="button"
            onClick={onToggleMute}
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
              muted
                ? 'bg-amber-500/20 text-amber-300'
                : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
            aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
        )}
        <button
          type="button"
          onClick={onToggleMinimize}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-slate-200 hover:bg-slate-700"
          aria-label="Expand phone screen"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
        {callState !== 'ended' ? (
          <button
            type="button"
            onClick={onEndCall}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700"
            aria-label="End call"
          >
            <PhoneOff className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onCloseOverlay}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white"
          >
            Dismiss
          </button>
        )}
      </div>
    );
  }

  const statusText =
    callState === 'ringing'
      ? 'Connecting...'
      : callState === 'ended'
      ? `Call ended · ${formatTimer(elapsedSeconds)}`
      : agentStatus === 'speaking'
      ? 'Tara speaking'
      : agentStatus === 'thinking'
      ? 'Checking clinic schedule'
      : agentStatus === 'transcribing'
      ? 'Processing speech'
      : muted
      ? 'Microphone muted'
      : 'Listening';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-3 backdrop-blur-[2px] sm:items-center sm:justify-end sm:p-6"
      role="dialog"
      aria-label="Voice Call Handset"
    >
      <div className="flex h-[min(680px,92vh)] w-full max-w-[390px] flex-col overflow-hidden rounded-[28px] border border-slate-800 bg-[#0B1220] text-slate-100 shadow-2xl">
        {/* Handset Top Bar */}
        <div className="flex items-center justify-between border-b border-slate-800/80 px-5 pt-4 pb-3">
          <div>
            <p className="font-display text-base font-semibold tracking-tight text-white">
              Tara Care Desk
            </p>
            <p className="font-mono text-xs text-slate-400 tabular-nums">
              {callState === 'connected'
                ? formatTimer(elapsedSeconds)
                : callState === 'ringing'
                ? 'Ringing'
                : 'Ended'}
              {providers ? ` · ${providers.tts}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <select
              value={selectedVoice}
              onChange={(e) => onVoiceChange(e.target.value as 'ritu' | 'shubh')}
              aria-label="Voice persona"
              className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="ritu">Ritu (Female)</option>
              <option value="shubh">Shubh (Male)</option>
            </select>
            <button
              type="button"
              onClick={onToggleMinimize}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
              aria-label="Minimize phone screen"
              title="Minimize to corner"
            >
              <Minimize2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Waveform + Call State Banner */}
        <div className="border-b border-slate-800/80 bg-slate-900/50 px-5 py-3">
          <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
            <span>{statusText}</span>
            {providers && (
              <span className="font-mono text-[11px] text-slate-500">
                {providers.stt}
              </span>
            )}
          </div>
          <VoiceWaveform
            level={audioLevel}
            source={audioSource}
            callState={callState}
          />
        </div>

        {/* Error notice if mic blocked or API key missing */}
        {errorMessage && (
          <div className="border-b border-red-900/60 bg-red-950/60 px-4 py-2 text-xs text-red-200">
            {errorMessage}
          </div>
        )}

        {/* Booking / Cancellation Confirmation Card inside Phone */}
        {bookingCard && (
          <div className="mx-4 mt-3 rounded-xl border border-slate-700 bg-slate-900 p-3.5">
            <div className="flex items-start gap-2.5">
              <div
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                  bookingCard.action === 'booked'
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-red-500/15 text-red-400'
                }`}
              >
                {bookingCard.action === 'booked' ? (
                  <CalendarCheck2 className="h-4 w-4" />
                ) : (
                  <CalendarX2 className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white">
                  {bookingCard.action === 'booked'
                    ? 'Appointment Confirmed'
                    : 'Appointment Cancelled'}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-300">
                  {bookingCard.appointment.doctorName} ·{' '}
                  {bookingCard.appointment.specialty}
                </p>
                <p className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums">
                  {bookingCard.appointment.date} · {bookingCard.appointment.time}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-teal-300 tabular-nums">
                  {bookingCard.appointment.phoneNumber} · {bookingCard.appointment.id}
                </p>
                {bookingCard.action === 'booked' && (
                  <button
                    type="button"
                    onClick={() => onDownloadToken(bookingCard.appointment)}
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-teal-500"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download Token ({bookingCard.appointment.id})
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Live Transcript inside the Phone */}
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {transcript.length === 0 && !interimTranscript && (
            <div className="py-8 text-center text-xs text-slate-500">
              {callState === 'ringing'
                ? 'Dialing Tara care desk...'
                : 'Speak clearly into your microphone to begin.'}
            </div>
          )}

          {transcript.map((item) => {
            if (item.speaker === 'tool') {
              return (
                <div
                  key={item.id}
                  className="mx-auto max-w-[92%] rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-center font-mono text-[11px] text-slate-400"
                >
                  {item.text}
                </div>
              );
            }

            const isCaller = item.speaker === 'caller';
            return (
              <div
                key={item.id}
                className={`flex flex-col ${
                  isCaller ? 'items-end' : 'items-start'
                }`}
              >
                <span className="mb-1 text-[11px] text-slate-500">
                  {isCaller ? 'You' : 'Tara'}
                </span>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${
                    isCaller
                      ? 'rounded-br-sm bg-teal-600 text-white'
                      : 'rounded-bl-sm border border-slate-800 bg-slate-900 text-slate-100'
                  }`}
                >
                  {item.text}
                </div>
              </div>
            );
          })}

          {interimTranscript && (
            <div className="flex flex-col items-end">
              <span className="mb-1 text-[11px] text-slate-500">You (speaking)</span>
              <div className="max-w-[85%] rounded-2xl rounded-br-sm border border-teal-500/40 bg-teal-950/60 px-3.5 py-2 text-[13px] text-teal-100">
                {interimTranscript}
              </div>
            </div>
          )}
          <div ref={transcriptEndRef} />
        </div>

        {/* Optional Type-to-Speak Fallback Bar (keeps voice primary, helps in silent demos) */}
        {callState === 'connected' && (
          <form
            onSubmit={handleSubmitText}
            className="flex items-center gap-2 border-t border-slate-800/80 bg-slate-900/40 px-4 py-2.5"
          >
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Or type a message to Tara..."
              className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-teal-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!textInput.trim()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-teal-600 text-white transition-colors hover:bg-teal-500 disabled:opacity-40"
              aria-label="Send message"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        )}

        {/* Phone Controls */}
        <div className="flex items-center justify-around border-t border-slate-800 bg-slate-950 px-6 py-4">
          {callState === 'ended' ? (
            <>
              <button
                type="button"
                onClick={onStartNewCall}
                className="flex items-center gap-2 rounded-full bg-teal-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500"
              >
                <Phone className="h-4 w-4" />
                Call Again
              </button>
              <button
                type="button"
                onClick={onCloseOverlay}
                className="rounded-full border border-slate-700 px-5 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
              >
                Close
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onToggleMute}
                disabled={callState !== 'connected'}
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
                  muted
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                }`}
                aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
                title={muted ? 'Unmute' : 'Mute'}
              >
                {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>

              <button
                type="button"
                onClick={onEndCall}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition-transform hover:scale-105 hover:bg-red-500 active:scale-95"
                aria-label="End call"
                title="End Call"
              >
                <PhoneOff className="h-6 w-6" />
              </button>

              <button
                type="button"
                onClick={onToggleSpeaker}
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${
                  speakerMuted
                    ? 'bg-slate-700 text-slate-400'
                    : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                }`}
                aria-label={speakerMuted ? 'Unmute speaker' : 'Mute speaker'}
                title={speakerMuted ? 'Speaker muted' : 'Speaker active'}
              >
                {speakerMuted ? (
                  <VolumeX className="h-5 w-5" />
                ) : (
                  <Volume2 className="h-5 w-5" />
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
