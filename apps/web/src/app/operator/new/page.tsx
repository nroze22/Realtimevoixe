'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Search, Sparkles } from 'lucide-react';
import {
  LANGUAGES,
  REALTIME_TARGET_LANGUAGES,
  type LanguageCode,
  type ServiceConfig,
} from '@rtv/shared';
import { createService } from '@/lib/orchestrator';
import { cn } from '@/lib/cn';

// Light groupings for the language grid — visual scanning only.
const LANG_GROUP: Record<string, string> = {
  es: 'Americas', en: 'Americas', pt: 'Americas',
  fr: 'Europe', de: 'Europe', it: 'Europe', nl: 'Europe', pl: 'Europe', tr: 'Europe',
  ru: 'Europe', uk: 'Europe', ar: 'Middle East',
  zh: 'Asia', ja: 'Asia', ko: 'Asia',
};
const GROUP_ORDER = ['Americas', 'Europe', 'Middle East', 'Asia'] as const;

const FLAG: Record<string, string> = {
  en: '🇺🇸', es: '🇪🇸', pt: '🇧🇷', fr: '🇫🇷', de: '🇩🇪', it: '🇮🇹', nl: '🇳🇱', pl: '🇵🇱',
  ru: '🇷🇺', uk: '🇺🇦', tr: '🇹🇷', ar: '🇸🇦', zh: '🇨🇳', ja: '🇯🇵', ko: '🇰🇷',
};

interface Preset {
  id: string;
  name: string;
  description: string;
  source: LanguageCode;
  targets: LanguageCode[];
  cap: number;
}

const PRESETS: Preset[] = [
  { id: 'sunday-en-es',    name: 'Sunday — English → Spanish',           description: 'Most common in US churches', source: 'en', targets: ['es'], cap: 30 },
  { id: 'sunday-en-multi', name: 'Sunday — English → Spanish + Portuguese', description: 'Multi-language congregations', source: 'en', targets: ['es', 'pt'], cap: 60 },
  { id: 'special-en-3',    name: 'Conference — English → 3 languages',  description: 'For events with international guests', source: 'en', targets: ['es', 'pt', 'ko'], cap: 90 },
];

export default function NewServicePage() {
  const router = useRouter();
  const [title, setTitle] = useState('Sunday Worship Service');
  const [pastorName, setPastorName] = useState('');
  const [sourceLanguage, setSourceLanguage] = useState<LanguageCode>('en');
  const [targets, setTargets] = useState<Set<LanguageCode>>(new Set(['es']));
  const [costCap, setCostCap] = useState(30);
  const [enableCaptions, setEnableCaptions] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const filteredTargets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return REALTIME_TARGET_LANGUAGES.filter((l) => {
      if (l.code === sourceLanguage) return false;
      if (!q) return true;
      return l.englishName.toLowerCase().includes(q) || l.nativeName.toLowerCase().includes(q);
    });
  }, [query, sourceLanguage]);

  const grouped = useMemo(() => {
    const map: Record<string, typeof filteredTargets> = {};
    for (const l of filteredTargets) {
      const g = LANG_GROUP[l.code] ?? 'Other';
      (map[g] ||= []).push(l);
    }
    return map;
  }, [filteredTargets]);

  function toggleTarget(code: LanguageCode) {
    setTargets((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function applyPreset(p: Preset) {
    setSourceLanguage(p.source);
    setTargets(new Set(p.targets));
    setCostCap(p.cap);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (targets.size === 0) throw new Error('Pick at least one target language.');
      if (targets.size > 6) throw new Error('Limit of 6 simultaneous languages while we keep costs sane.');
      const serviceId = `svc_${Math.random().toString(36).slice(2, 10)}`;
      const config: ServiceConfig = {
        serviceId,
        orgId: 'demo-org',
        title,
        pastorName: pastorName || undefined,
        sourceLanguage,
        targetLanguages: Array.from(targets),
        costCapUSD: costCap,
        enableCaptions,
      };
      const created = await createService(config);
      sessionStorage.setItem(
        `service:${serviceId}`,
        JSON.stringify({
          config: created.service.config,
          joinCode: created.service.joinCode,
          livekit: created.livekit,
        }),
      );
      router.push(`/operator/${serviceId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const estPerMin = 0.30 * targets.size; // crude
  const estPerHour = estPerMin * 60;

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 md:py-14 animate-fade-in">
      <a href="/" className="inline-flex items-center gap-1.5 text-xs text-ink-400 hover:text-ink-200 mb-6 transition">
        <ArrowLeft className="h-3.5 w-3.5" /> Home
      </a>

      <h1 className="text-3xl md:text-4xl font-semibold tracking-tightish">
        Set up a service
      </h1>
      <p className="mt-2 text-ink-400 text-pretty">
        This creates a session, mints a join code, and prepares the LiveKit room.
        You&apos;ll capture audio on the next screen.
      </p>

      <form onSubmit={onSubmit} className="mt-9 grid gap-7">
        {/* Presets */}
        <section>
          <h2 className="eyebrow mb-3 flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-accent-300" /> Quick start
          </h2>
          <div className="grid gap-2.5 md:grid-cols-3">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className="card text-left hover:border-accent-700 hover:bg-ink-900/75 transition-all"
              >
                <div className="text-sm font-medium">{p.name}</div>
                <div className="mt-1 text-[11px] text-ink-500">{p.description}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.targets.map((c) => (
                    <span key={c} className="text-xs">{FLAG[c]}</span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Title / Pastor / Source */}
        <section className="grid gap-5">
          <div>
            <label className="field-label" htmlFor="title">Service title</label>
            <input
              id="title"
              className="field-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required maxLength={120}
            />
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="pastor">Pastor name (optional)</label>
              <input
                id="pastor"
                className="field-input"
                value={pastorName}
                onChange={(e) => setPastorName(e.target.value)}
                placeholder="Pastor John"
              />
              <p className="mt-1.5 text-[11px] text-ink-500">
                Used for the future Custom Voice mapping (dormant until approved).
              </p>
            </div>

            <div>
              <label className="field-label" htmlFor="source">Spoken language</label>
              <select
                id="source"
                className="field-input"
                value={sourceLanguage}
                onChange={(e) => setSourceLanguage(e.target.value as LanguageCode)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.englishName} · {l.nativeName}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Targets */}
        <section>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="eyebrow">Target languages</h2>
            <div className="flex items-center gap-2 text-[11px] text-ink-500">
              <span>{targets.size} selected</span>
              <span className="text-ink-700">·</span>
              <span>max 6</span>
            </div>
          </div>
          <div className="relative mb-3">
            <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
            <input
              className="field-input pl-8"
              placeholder="Search languages…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="grid gap-5">
            {GROUP_ORDER.map((g) => {
              const list = grouped[g] ?? [];
              if (list.length === 0) return null;
              return (
                <div key={g}>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-ink-500 mb-2">{g}</div>
                  <div className="flex flex-wrap gap-2">
                    {list.map((l) => {
                      const on = targets.has(l.code);
                      return (
                        <button
                          type="button"
                          key={l.code}
                          onClick={() => toggleTarget(l.code)}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-all',
                            on
                              ? 'border-accent-500 bg-accent text-accent-fg shadow-glow'
                              : 'border-ink-800 bg-ink-900/60 hover:border-ink-700 hover:bg-ink-900'
                          )}
                        >
                          <span aria-hidden>{FLAG[l.code] ?? '🗣'}</span>
                          <span>{l.englishName}</span>
                          <span className={cn('text-[10px]', on ? 'text-accent-fg/70' : 'text-ink-500')}>
                            {l.nativeName}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {Object.keys(grouped).length === 0 && (
              <p className="text-sm text-ink-500">No languages match &ldquo;{query}&rdquo;.</p>
            )}
          </div>
        </section>

        {/* Cost cap + captions */}
        <section className="grid gap-5 md:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="cap">Hard cost cap</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">$</span>
              <input
                id="cap"
                type="number"
                min={1} max={500} step={1}
                className="field-input pl-7"
                value={costCap}
                onChange={(e) => setCostCap(Number(e.target.value))}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-ink-500 leading-relaxed">
              Service auto-stops at this total. Estimated burn at current settings:{' '}
              <span className="text-ink-300 tabular-nums">${estPerMin.toFixed(2)}/min</span>{' '}
              · <span className="text-ink-300 tabular-nums">${estPerHour.toFixed(0)}/hour</span>.
            </p>
          </div>

          <div className="flex items-end">
            <label className="inline-flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enableCaptions}
                onChange={(e) => setEnableCaptions(e.target.checked)}
                className="h-4 w-4 rounded border-ink-700 bg-ink-900 accent-accent-500"
              />
              <span className="text-sm">
                Show live captions (source &amp; targets)
                <span className="block text-[11px] text-ink-500 leading-snug">
                  Listeners on phones will see them too.
                </span>
              </span>
            </label>
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm text-red-200 animate-fade-in">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-ink-800/70">
          <a href="/" className="btn btn-ghost">Cancel</a>
          <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>
            {submitting ? 'Creating…' : 'Continue'}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </form>
    </main>
  );
}
