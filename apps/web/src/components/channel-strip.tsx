'use client';

import { Headphones, Pin, Users } from 'lucide-react';
import { LANGUAGES_BY_CODE, type LanguageCode } from '@rtv/shared';
import { Waveform } from '@/components/waveform';
import { cn } from '@/lib/cn';

interface ChannelStripProps {
  lang: LanguageCode;
  /** Live current caption (target). */
  current: string;
  /** Finalized recent caption history (most recent at the end). */
  history: string[];
  listeners: number;
  /** Output audio MediaStream for the live waveform. */
  stream: MediaStream | null;
  active: boolean;
  /** Pin the latest finalized line for the post-service report. */
  onPin?: (text: string) => void;
  pinnedCount?: number;
}

/**
 * Mixer-style channel strip for one translated language. Renders the
 * language label, a current/last caption focal area, recent context fading
 * upward, listener count pill, and a live waveform driven by that
 * language's actual translated audio stream.
 */
export function ChannelStrip({
  lang, current, history, listeners, stream, active, onPin, pinnedCount,
}: ChannelStripProps) {
  const meta = LANGUAGES_BY_CODE[lang];
  const hasActivity = !!current || history.length > 0;
  const pinnable = current || history.at(-1) || '';

  return (
    <div className={cn(
      'group relative card-flush p-0 transition-colors duration-200',
      'hover:border-white/[0.10]',
    )}>
      {/* Left side accent stripe */}
      <div
        className={cn(
          'absolute inset-y-3 left-0 w-[3px] rounded-r-full transition-all duration-300',
          hasActivity ? 'bg-accent-500' : 'bg-white/[0.06]',
        )}
        aria-hidden
      />

      <div className="p-5 pl-6 grid gap-3" dir={meta.rtl ? 'rtl' : 'ltr'}>
        {/* Header row */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono uppercase text-[10px] tracking-[0.18em] text-ink-500">
              {lang}
            </span>
            <span className="text-sm font-medium text-ink-100">{meta.englishName}</span>
            <span className="text-xs text-ink-500">· {meta.nativeName}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 text-[11px] text-ink-300">
              <Users className="h-3 w-3" />
              <span className="readout">{listeners}</span>
            </span>
            {onPin && (
              <button
                type="button"
                onClick={() => pinnable && onPin(pinnable)}
                disabled={!pinnable}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition',
                  pinnedCount && pinnedCount > 0
                    ? 'border-accent-500 bg-accent-900/30 text-accent-200'
                    : 'border-white/[0.06] bg-white/[0.02] text-ink-400 hover:border-white/[0.12] hover:text-ink-100',
                  !pinnable && 'opacity-40 cursor-not-allowed',
                )}
                title="Star this line for the post-service report"
                aria-label="Pin moment"
              >
                <Pin className="h-3 w-3" />
                {pinnedCount ?? 0}
              </button>
            )}
          </div>
        </div>

        {/* Recent context */}
        {history.length > 1 && (
          <ul className="space-y-1.5 max-h-20 overflow-hidden mask-fade-top text-sm text-ink-500 leading-snug">
            {history.slice(-4, -1).map((h, i, arr) => (
              <li
                key={`${i}-${h.slice(0, 8)}`}
                style={{ opacity: 0.35 + (i / arr.length) * 0.4 }}
                className="text-pretty"
              >
                {h}
              </li>
            ))}
          </ul>
        )}

        {/* Current line */}
        <div
          key={current || '__empty__'}
          className={cn(
            'min-h-[2.6rem] text-pretty',
            current
              ? 'text-xl md:text-2xl text-ink-50 font-medium leading-snug caption-in'
              : 'text-base text-ink-700 italic',
          )}
        >
          {current || (history.at(-1) ?? 'Listening…')}
        </div>

        {/* Foot: live waveform */}
        <div className="flex items-center gap-3 pt-1">
          <Headphones className="h-3 w-3 text-ink-600 flex-shrink-0" />
          <Waveform
            stream={stream}
            active={active}
            color={hasActivity ? 'bg-accent-400' : 'bg-ink-700'}
            bars={40}
            className="h-5 flex-1"
          />
        </div>
      </div>
    </div>
  );
}
