'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, History, Mic2, Users } from 'lucide-react';
import { LANGUAGES_BY_CODE, type LanguageCode } from '@rtv/shared';
import { Logo } from '@/components/logo';
import { Eyebrow } from '@/components/ui';
import { listRecents, type RecentService } from '@/lib/templates';
import { recordingHref } from '@/lib/orchestrator';

export default function HistoryPage() {
  const [recents, setRecents] = useState<RecentService[]>([]);

  useEffect(() => {
    setRecents(listRecents(50));
  }, []);

  return (
    <main className="relative min-h-dvh">
      <div className="pointer-events-none absolute inset-x-0 -top-24 h-[30vh] bg-gradient-to-b from-accent-900/8 to-transparent" aria-hidden />

      <header className="relative z-10 mx-auto max-w-4xl px-5 pt-6 flex items-center justify-between">
        <Link href="/operator" className="inline-flex items-center gap-1.5 text-xs text-ink-400 hover:text-ink-200 transition">
          <ArrowLeft className="h-3.5 w-3.5" /> Operator home
        </Link>
        <Logo />
      </header>

      <div className="relative z-10 mx-auto max-w-4xl px-5 pt-10 md:pt-14 pb-20 animate-fade-in">
        <Eyebrow className="mb-2 flex items-center gap-1.5">
          <History className="h-3 w-3" /> Service history
        </Eyebrow>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tightish text-balance">
          Past services
        </h1>
        <p className="mt-2 text-ink-400 text-pretty">
          Locally stored on this device. Recording links remain valid for a few minutes after a service ends.
        </p>

        {recents.length === 0 ? (
          <div className="card mt-10 text-center py-10">
            <p className="text-sm text-ink-500">
              You haven&apos;t run a service from this browser yet.
            </p>
            <Link href="/operator/new" className="btn btn-primary mt-5">
              <Mic2 className="h-4 w-4" /> Start a service
            </Link>
          </div>
        ) : (
          <ul className="mt-8 grid gap-3">
            {recents.map((r) => (
              <li key={r.serviceId} className="card-flush p-0">
                <details className="group">
                  <summary className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-white/[0.02] transition select-none">
                    <span className="h-9 w-9 rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06] grid place-items-center text-ink-300">
                      <Mic2 className="h-4 w-4" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{r.title}</div>
                      <div className="text-[11px] text-ink-500 mt-0.5 truncate">
                        {formatLong(r.startedAt)} · {fmtElapsed(r.durationSec)}
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-4 text-[11px] text-ink-400">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        <span className="readout">{r.peakListeners}</span>
                      </span>
                      <span className="readout">${r.costUSD.toFixed(2)}</span>
                    </div>
                    <span className="font-mono text-[11px] text-ink-500 ml-2">{r.joinCode}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-ink-500 ml-1 transition-transform group-open:rotate-90" />
                  </summary>
                  <div className="px-5 pb-5 border-t border-white/[0.04] pt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-ink-500 mb-2">Languages</div>
                      <div className="text-sm text-ink-300">
                        <strong className="text-ink-100">
                          {LANGUAGES_BY_CODE[r.sourceLanguage as LanguageCode]?.englishName ?? r.sourceLanguage}
                        </strong>
                        <span className="mx-2 text-ink-700">→</span>
                        {r.targetLanguages
                          .map((c) => LANGUAGES_BY_CODE[c as LanguageCode]?.englishName ?? c)
                          .join(', ')}
                      </div>
                      {r.pastorName && (
                        <div className="mt-3">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-ink-500 mb-1">Speaker</div>
                          <div className="text-sm text-ink-300">{r.pastorName}</div>
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-ink-500 mb-2">Downloads</div>
                      <div className="grid gap-1 text-xs">
                        <DownloadRow
                          label={`Source · ${LANGUAGES_BY_CODE[r.sourceLanguage as LanguageCode]?.englishName ?? r.sourceLanguage}`}
                          srtHref={recordingHref(r.serviceId, r.sourceLanguage, 'srt')}
                          vttHref={recordingHref(r.serviceId, r.sourceLanguage, 'vtt')}
                        />
                        {r.targetLanguages.map((l) => (
                          <DownloadRow
                            key={l}
                            label={LANGUAGES_BY_CODE[l as LanguageCode]?.englishName ?? l}
                            wavHref={recordingHref(r.serviceId, l, 'wav')}
                            srtHref={recordingHref(r.serviceId, l, 'srt')}
                            vttHref={recordingHref(r.serviceId, l, 'vtt')}
                          />
                        ))}
                      </div>
                      <p className="mt-2 text-[10px] text-ink-500">
                        Links expire ~5 min after the service ends.
                      </p>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function DownloadRow({
  label, wavHref, srtHref, vttHref,
}: { label: string; wavHref?: string; srtHref?: string; vttHref?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-white/[0.04] last:border-0 py-1.5">
      <span className="text-ink-300 truncate">{label}</span>
      <div className="flex items-center gap-2">
        {wavHref && <a className="text-accent-300 hover:underline" href={wavHref} target="_blank" rel="noreferrer">wav</a>}
        {srtHref && <a className="text-ink-300 hover:text-ink-100 hover:underline" href={srtHref} target="_blank" rel="noreferrer">srt</a>}
        {vttHref && <a className="text-ink-300 hover:text-ink-100 hover:underline" href={vttHref} target="_blank" rel="noreferrer">vtt</a>}
      </div>
    </div>
  );
}

function formatLong(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function fmtElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
