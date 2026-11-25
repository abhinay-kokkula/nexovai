import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Phone } from 'lucide-react';
import type { CallLog } from '../types/clinic';

interface CallLogsViewProps {
  callLogs: CallLog[];
  onStartCall: () => void;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export const CallLogsView: React.FC<CallLogsViewProps> = ({
  callLogs,
  onStartCall,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(
    callLogs[0]?.id || null
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            Recent Voice Calls
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Completed calls with full transcripts and executed scheduling actions.
          </p>
        </div>

        <button
          type="button"
          onClick={onStartCall}
          className="whitespace-nowrap shrink-0 flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-teal-800"
        >
          <Phone className="h-3.5 w-3.5" />
          New Call
        </button>
      </div>

      {callLogs.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="text-sm font-medium text-slate-700">
            No voice calls recorded yet
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Click Try Call to start a conversation and inspect its transcript here.
          </p>
          <button
            type="button"
            onClick={onStartCall}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800"
          >
            <Phone className="h-3.5 w-3.5" />
            Try Call
          </button>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {callLogs.map((log) => {
            const expanded = expandedId === log.id;
            return (
              <div key={log.id} className="px-5 py-3.5">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : log.id)}
                  className="flex w-full items-center justify-between gap-4 text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {expanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">
                        {log.outcome}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500 font-mono tabular-nums">
                        {log.id}
                        <span className="mx-1.5 text-slate-300">·</span>
                        {log.callerPhone ? `Phone ${log.callerPhone}` : 'No phone spoken'}
                        <span className="mx-1.5 text-slate-300">·</span>
                        {log.sttProvider} / {log.ttsProvider}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0 text-right font-mono text-xs text-slate-500 tabular-nums">
                    <div>{formatDuration(log.durationSeconds)}</div>
                    <div className="text-[11px] text-slate-400">
                      {new Date(log.startedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                </button>

                {expanded && (
                  <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 pl-7">
                    {log.transcript.map((item) => (
                      <div key={item.id} className="text-xs">
                        <span className="font-medium text-slate-700">
                          {item.speaker === 'caller'
                            ? 'Caller'
                            : item.speaker === 'agent'
                            ? 'Tara'
                            : item.toolEvent?.name || 'Tool'}
                          :{' '}
                        </span>
                        <span className="text-slate-600">{item.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
