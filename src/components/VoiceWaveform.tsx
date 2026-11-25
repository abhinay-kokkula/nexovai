import React, { useMemo } from 'react';

interface VoiceWaveformProps {
  level: number; // 0..1
  source: 'mic' | 'agent' | 'idle';
  callState: 'idle' | 'ringing' | 'connected' | 'ended';
}

const BAR_COUNT = 27;

export const VoiceWaveform: React.FC<VoiceWaveformProps> = ({
  level,
  source,
  callState,
}) => {
  const weights = useMemo(() => {
    const mid = (BAR_COUNT - 1) / 2;
    return Array.from({ length: BAR_COUNT }, (_, idx) => {
      const dist = Math.abs(idx - mid) / mid;
      const bell = Math.cos((dist * Math.PI) / 2);
      const harmonic = 0.72 + 0.28 * Math.sin(idx * 1.45);
      return Math.max(0.18, bell * harmonic);
    });
  }, []);

  const barColor =
    callState === 'ringing'
      ? 'bg-teal-400/70'
      : source === 'agent'
      ? 'bg-teal-400'
      : source === 'mic'
      ? 'bg-sky-400'
      : 'bg-slate-600';

  return (
    <div
      className="flex h-12 items-center justify-center gap-1 px-4"
      aria-hidden="true"
    >
      {weights.map((weight, idx) => {
        const baseHeight = callState === 'ringing' ? 0.25 : 0.14;
        const activeBoost =
          callState === 'connected' ? level * weight * 0.95 : 0;
        const scaleY = Math.min(1, baseHeight + activeBoost);
        return (
          <span
            key={idx}
            className={`w-1 rounded-full transition-transform duration-100 ${barColor}`}
            style={{
              height: '44px',
              transform: `scaleY(${scaleY.toFixed(3)})`,
            }}
          />
        );
      })}
    </div>
  );
};
