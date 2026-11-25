import React, { useEffect, useRef } from 'react';
import { Phone } from 'lucide-react';
import type { CallState, PipelineCapabilities, TranscriptEntry } from '../types/clinic';

interface LiveTranscriptPanelProps {
  callState: CallState;
  transcript: TranscriptEntry[];
  interimTranscript: string;
  capabilities: PipelineCapabilities | null;
  onStartCall: () => void;
}

export const LiveTranscriptPanel: React.FC<LiveTranscriptPanelProps> = ({
  callState,
  transcript,
  interimTranscript,
  capabilities,
  onStartCall,
}) => {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, interimTranscript]);

  const activeStt = capabilities?.deepgram
    ? 'Deepgram Nova-3'
    : capabilities?.sarvam
    ? 'Sarvam Saaras v4'
    : 'Gemini Transcribe';
  const activeTts = capabilities?.sarvam ? 'Sarvam Bulbul v3' : 'Gemini TTS';

  return (
    <aside className="flex h-full flex-col rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            Live Transcript
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {activeStt} · Gemini 4 Hydrogen / 3.5 Flash-Lite · {activeTts}
          </p>
        </div>

        {callState === 'idle' || callState === 'ended' ? (
          <button
            type="button"
            onClick={onStartCall}
            className="whitespace-nowrap shrink-0 flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-teal-800"
          >
            <Phone className="h-3.5 w-3.5" />
            Talk to Tara
          </button>
        ) : (
          <span className="whitespace-nowrap shrink-0 text-xs font-medium text-teal-700">
            {callState === 'ringing' ? 'Connecting' : 'Call in progress'}
          </span>
        )}
      </div>

      {/* Transcript Stream */}
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4 min-h-[340px] max-h-[540px]">
        {transcript.length === 0 && !interimTranscript ? (
          <div className="space-y-4 py-4">
            <p className="text-xs leading-relaxed text-slate-600">
              Start a call to speak naturally with Tara. Identify yourself by speaking any phone number aloud—no login or OTP required.
            </p>
            <div className="space-y-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
              <p className="font-medium text-slate-700">Sample flows to try</p>
              <p>
                <span className="font-medium text-slate-700">Check & book:</span>{' '}
                &ldquo;Do you have any Cardiology slots today? My number is 98112 34567.&rdquo;
              </p>
              <p>
                <span className="font-medium text-slate-700">Alternative option:</span>{' '}
                &ldquo;Is Dr. Sharma available today, or do you have a General Therapist?&rdquo;
              </p>
              <p>
                <span className="font-medium text-slate-700">Cancel existing:</span>{' '}
                &ldquo;I need to cancel my appointment. My phone number is 98765 43210.&rdquo;
              </p>
            </div>
          </div>
        ) : (
          <>
            {transcript.map((entry) => {
              if (entry.speaker === 'tool') {
                return (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-600"
                  >
                    <span className="font-semibold text-slate-800">
                      {entry.toolEvent?.name}
                    </span>
                    <span className="mx-1.5 text-slate-300">·</span>
                    <span>{entry.text}</span>
                  </div>
                );
              }

              const isCaller = entry.speaker === 'caller';
              return (
                <div key={entry.id} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="font-medium text-slate-700">
                      {isCaller ? 'Caller' : 'Tara (Front Desk)'}
                    </span>
                    <span className="font-mono tabular-nums">
                      {new Date(entry.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                  <p
                    className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                      isCaller
                        ? 'bg-teal-50/70 text-slate-900'
                        : 'bg-slate-50 text-slate-800'
                    }`}
                  >
                    {entry.text}
                  </p>
                </div>
              );
            })}

            {interimTranscript && (
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-teal-700">
                  Caller (speaking...)
                </div>
                <p className="rounded-lg border border-teal-200 bg-teal-50/40 px-3 py-2 text-xs text-slate-700">
                  {interimTranscript}
                </p>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>
    </aside>
  );
};
