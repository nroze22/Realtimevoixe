'use client';

import { useEffect, useRef } from 'react';
import { Clock, X } from 'lucide-react';
import type { ListenerCaption } from '@/lib/listener';
import { annotateScripture } from '@/lib/bible';
import { cn } from '@/lib/cn';

interface MissedDrawerProps {
  open: boolean;
  onClose: () => void;
  captions: ListenerCaption[];
  /** Service start time (ms) for relative timestamps. */
  startMs: number;
}

/**
 * Bottom sheet drawer for late arrivals. Shows the last N caption lines in
 * scrollable form with relative timestamps and tappable scripture refs.
 */
export function MissedDrawer({ open, onClose, captions, startMs }: MissedDrawerProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div
      className={cn(
        'fixed inset-0 z-[120] transition-opacity',
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
      aria-hidden={!open}
    >
      <div
        className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={ref}
        className={cn(
          'absolute inset-x-0 bottom-0 max-h-[80vh] rounded-t-3xl border-t border-x border-white/[0.08]',
          'bg-ink-900/95 backdrop-blur-md shadow-[0_-30px_60px_-20px_rgba(0,0,0,0.6)]',
          'transition-transform duration-300 ease-snap',
          open ? 'translate-y-0' : 'translate-y-full',
        )}
        role="dialog"
        aria-modal="true"
        aria-label="What you missed"
      >
        <div className="flex items-center justify-center pt-2.5 pb-1">
          <span className="h-1 w-10 rounded-full bg-white/[0.10]" />
        </div>
        <header className="px-5 py-3 flex items-center justify-between">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-accent-300" />
            What you missed
          </h2>
          <button
            onClick={onClose}
            className="text-ink-500 hover:text-ink-100 p-1.5 rounded-md hover:bg-white/[0.05]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] max-h-[60vh] overflow-y-auto scroll-soft">
          {captions.length === 0 ? (
            <p className="text-sm text-ink-500 py-8 text-center">
              Nothing yet — captions will appear as the speaker begins.
            </p>
          ) : (
            <ul className="space-y-3 pb-4">
              {captions.map((c, i) => {
                const parts = annotateScripture(c.text);
                const tSec = Math.max(0, Math.floor((c.tMs ?? 0) / 1000));
                const mm = Math.floor(tSec / 60);
                const ss = tSec % 60;
                return (
                  <li
                    key={`${c.tMs}-${i}`}
                    className="grid grid-cols-[auto_1fr] gap-3 text-pretty"
                  >
                    <span className="text-[10px] tabular-nums text-ink-500 font-mono pt-1">
                      {mm}:{String(ss).padStart(2, '0')}
                    </span>
                    <span className="text-[15px] text-ink-100 leading-snug">
                      {parts.map((p, j) =>
                        p.type === 'text' ? (
                          <span key={j}>{p.text}</span>
                        ) : (
                          <a
                            key={j}
                            href={p.href}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent-300 underline-offset-2 hover:underline font-medium"
                          >
                            {p.text}
                          </a>
                        ),
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
