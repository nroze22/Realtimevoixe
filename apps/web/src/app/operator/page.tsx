'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bookmark,
  Calendar,
  Clock,
  History,
  Mic2,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { LANGUAGES_BY_CODE, type LanguageCode } from '@rtv/shared';
import { Logo } from '@/components/logo';
import { Eyebrow } from '@/components/ui';
import {
  deleteTemplate,
  listRecents,
  listTemplates,
  type RecentService,
  type Template,
} from '@/lib/templates';

export default function OperatorHomePage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [recents, setRecents] = useState<RecentService[]>([]);

  useEffect(() => {
    setTemplates(listTemplates());
    setRecents(listRecents(6));
  }, []);

  const lastTemplate = templates[0];

  function onDeleteTemplate(id: string) {
    deleteTemplate(id);
    setTemplates(listTemplates());
  }

  return (
    <main className="relative min-h-dvh">
      <div className="pointer-events-none absolute inset-x-0 -top-24 h-[40vh] bg-gradient-to-b from-accent-900/10 to-transparent" aria-hidden />

      <header className="relative z-10 mx-auto max-w-5xl px-5 pt-6 flex items-center justify-between">
        <Link href="/" aria-label="Home"><Logo withWordmark /></Link>
        <Link href="/operator/new" className="btn btn-primary h-9 px-3 text-xs">
          <Plus className="h-3.5 w-3.5" /> New service
        </Link>
      </header>

      <div className="relative z-10 mx-auto max-w-5xl px-5 pt-10 md:pt-14 pb-24 animate-fade-in">
        <div className="flex items-end justify-between gap-4 mb-7">
          <div>
            <Eyebrow className="mb-2 flex items-center gap-1.5">
              <Calendar className="h-3 w-3" /> {weekday()}
            </Eyebrow>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tightish text-balance">
              Today&apos;s service
            </h1>
            <p className="mt-2 text-ink-400 text-pretty">
              Pick up where you left off, or start fresh.
            </p>
          </div>
        </div>

        {lastTemplate ? (
          <ResumeCard template={lastTemplate} />
        ) : (
          <StarterCard />
        )}

        <section className="mt-12">
          <div className="flex items-center justify-between mb-3">
            <Eyebrow className="flex items-center gap-1.5">
              <Bookmark className="h-3 w-3" /> Saved templates
            </Eyebrow>
            <Link href="/operator/new" className="text-xs text-accent-300 hover:underline">
              Create new →
            </Link>
          </div>
          {templates.length === 0 ? (
            <div className="card text-center py-8 text-sm text-ink-500">
              You haven&apos;t saved any templates yet. Save the next service from the
              setup screen.
            </div>
          ) : (
            <ul className="grid gap-2.5 md:grid-cols-2">
              {templates.map((t) => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  onDelete={() => onDeleteTemplate(t.id)}
                />
              ))}
            </ul>
          )}
        </section>

        {recents.length > 0 && (
          <section className="mt-12">
            <div className="flex items-center justify-between mb-3">
              <Eyebrow className="flex items-center gap-1.5">
                <History className="h-3 w-3" /> Recent services
              </Eyebrow>
              <Link href="/operator/history" className="text-xs text-accent-300 hover:underline">
                View all →
              </Link>
            </div>
            <div className="card-flush overflow-hidden">
              <ul>
                {recents.map((r, i) => (
                  <li
                    key={r.serviceId}
                    className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-white/[0.04]' : ''}`}
                  >
                    <span className="h-8 w-8 rounded-lg bg-white/[0.04] ring-1 ring-white/[0.06] grid place-items-center text-ink-300">
                      <Mic2 className="h-3.5 w-3.5" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-medium text-ink-100">{r.title}</div>
                      <div className="truncate text-[11px] text-ink-500 mt-0.5">
                        {formatShortDate(r.startedAt)} ·{' '}
                        {fmtElapsed(r.durationSec)} ·{' '}
                        {r.targetLanguages.map((c) => LANGUAGES_BY_CODE[c as LanguageCode]?.englishName ?? c).join(', ')}
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-3 text-[11px] text-ink-400">
                      <span className="readout">{r.peakListeners}</span>
                      <span>listeners</span>
                      <span className="text-ink-700">·</span>
                      <span className="readout">${r.costUSD.toFixed(2)}</span>
                    </div>
                    <span className="font-mono text-[11px] text-ink-500 ml-2">{r.joinCode}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function ResumeCard({ template }: { template: Template }) {
  const langs = template.config.targetLanguages
    .map((c) => LANGUAGES_BY_CODE[c as LanguageCode]?.englishName ?? c)
    .join(', ');
  return (
    <Link
      href={`/operator/new?template=${template.id}`}
      className="card-elev block hover:bg-ink-900/70 transition-colors group relative overflow-hidden"
    >
      <div className="absolute -top-20 -right-20 h-56 w-56 rounded-full bg-accent-700/20 blur-3xl pointer-events-none" aria-hidden />
      <div className="relative grid gap-6 md:grid-cols-[1fr_auto] items-center">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-3.5 w-3.5 text-accent-300" />
            <Eyebrow>Pick up where you left off</Eyebrow>
          </div>
          <div className="text-2xl md:text-3xl font-semibold tracking-tightish">
            {template.config.title}
          </div>
          <div className="mt-1.5 text-sm text-ink-400">
            {LANGUAGES_BY_CODE[template.config.sourceLanguage as LanguageCode]?.englishName ?? template.config.sourceLanguage}
            <span className="mx-2 text-ink-700">→</span>
            {langs}
          </div>
          {template.lastUsedAt && (
            <div className="mt-2 text-[11px] text-ink-500 inline-flex items-center gap-1.5">
              <Clock className="h-3 w-3" /> last used {timeAgo(template.lastUsedAt)}
            </div>
          )}
        </div>
        <div className="btn btn-primary btn-lg">
          Start setup <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}

function StarterCard() {
  return (
    <Link
      href="/operator/new"
      className="card-elev block hover:bg-ink-900/70 transition-colors group relative overflow-hidden"
    >
      <div className="absolute -top-20 -right-20 h-56 w-56 rounded-full bg-accent-700/15 blur-3xl pointer-events-none" aria-hidden />
      <div className="relative flex items-center gap-6">
        <div className="h-12 w-12 rounded-2xl bg-accent-900/40 ring-1 ring-accent-700/40 grid place-items-center">
          <Plus className="h-5 w-5 text-accent-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xl md:text-2xl font-semibold tracking-tightish">
            Start your first service
          </div>
          <div className="text-sm text-ink-400 mt-1 text-pretty">
            Pick an audio source, choose target languages, and you&apos;re live in about a minute.
          </div>
        </div>
        <ArrowRight className="h-4 w-4 text-ink-400 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function TemplateRow({ template, onDelete }: { template: Template; onDelete: () => void }) {
  const langs = template.config.targetLanguages
    .map((c) => LANGUAGES_BY_CODE[c as LanguageCode]?.englishName ?? c)
    .join(', ');
  return (
    <li className="card flex items-center gap-3 group hover:border-white/[0.10] hover:bg-ink-900/70 transition">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{template.name}</div>
        <div className="mt-0.5 text-[11px] text-ink-500 truncate">
          {LANGUAGES_BY_CODE[template.config.sourceLanguage as LanguageCode]?.englishName ?? template.config.sourceLanguage} → {langs}
        </div>
      </div>
      <Link
        href={`/operator/new?template=${template.id}`}
        className="text-xs text-accent-300 hover:underline px-2 py-1"
      >
        Use
      </Link>
      <button
        onClick={(e) => { e.preventDefault(); onDelete(); }}
        className="opacity-0 group-hover:opacity-100 transition text-ink-500 hover:text-red-300 p-1.5 rounded-md hover:bg-white/[0.04]"
        aria-label="Delete template"
        title="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function weekday(): string {
  const d = new Date();
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatShortDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
