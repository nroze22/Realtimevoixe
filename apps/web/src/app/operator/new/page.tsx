'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, BookText, Bookmark, Plus, Search, Sparkles, Users, X } from 'lucide-react';
import {
  LANGUAGES,
  REALTIME_TARGET_LANGUAGES,
  type LanguageCode,
  type ServiceConfig,
} from '@rtv/shared';
import { createService } from '@/lib/orchestrator';
import { cn } from '@/lib/cn';
import {
  getTemplate,
  markTemplateUsed,
  saveTemplate,
  type Template,
} from '@/lib/templates';
import { useToast } from '@/components/toast';

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
  { id: 'sunday-en-es',    name: 'Sunday · English → Spanish',           description: 'Most common in US churches',         source: 'en', targets: ['es'], cap: 30 },
  { id: 'sunday-en-multi', name: 'Sunday · English → ES + PT',            description: 'Multi-language congregations',        source: 'en', targets: ['es', 'pt'], cap: 60 },
  { id: 'special-en-3',    name: 'Conference · English → 3 languages',    description: 'For events with international guests', source: 'en', targets: ['es', 'pt', 'ko'], cap: 90 },
];

interface Speaker { id: string; name: string; role?: string }

export default function NewServicePage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl px-5 py-10 text-ink-500">Loading…</main>}>
      <NewServiceForm />
    </Suspense>
  );
}

function NewServiceForm() {
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();

  const [title, setTitle] = useState('Sunday Worship Service');
  const [pastorName, setPastorName] = useState('');
  const [sourceLanguage, setSourceLanguage] = useState<LanguageCode>('en');
  const [targets, setTargets] = useState<Set<LanguageCode>>(new Set(['es']));
  const [costCap, setCostCap] = useState(30);
  const [enableCaptions, setEnableCaptions] = useState(true);
  const [pronunciationGuide, setPronunciationGuide] = useState('');
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [loadedTemplate, setLoadedTemplate] = useState<Template | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Load template via ?template=<id> if present
  useEffect(() => {
    const id = search.get('template');
    if (!id) return;
    const tpl = getTemplate(id);
    if (!tpl) return;
    setLoadedTemplate(tpl);
    setTitle(tpl.config.title);
    setPastorName(tpl.config.pastorName ?? '');
    setSourceLanguage(tpl.config.sourceLanguage as LanguageCode);
    setTargets(new Set(tpl.config.targetLanguages as LanguageCode[]));
    setCostCap(tpl.config.costCapUSD);
    setEnableCaptions(tpl.config.enableCaptions);
    setPronunciationGuide(tpl.config.pronunciationGuide ?? '');
    setSpeakers(tpl.config.speakers ?? []);
    setTemplateName(tpl.name);
    setShowAdvanced(
      !!(tpl.config.pronunciationGuide || (tpl.config.speakers && tpl.config.speakers.length > 0)),
    );
  }, [search]);

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
    setLoadedTemplate(null);
  }

  function addSpeaker() {
    setSpeakers((prev) => [
      ...prev,
      { id: `spk_${Math.random().toString(36).slice(2, 7)}`, name: '', role: '' },
    ]);
  }
  function updateSpeaker(id: string, patch: Partial<Speaker>) {
    setSpeakers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function removeSpeaker(id: string) {
    setSpeakers((prev) => prev.filter((s) => s.id !== id));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (targets.size === 0) throw new Error('Pick at least one target language.');
      if (targets.size > 6) throw new Error('Limit of 6 simultaneous languages while we keep costs sane.');
      const serviceId = `svc_${Math.random().toString(36).slice(2, 10)}`;
      const cleanSpeakers = speakers.filter((s) => s.name.trim());
      const config: ServiceConfig = {
        serviceId,
        orgId: 'demo-org',
        title,
        pastorName: pastorName || undefined,
        sourceLanguage,
        targetLanguages: Array.from(targets),
        costCapUSD: costCap,
        enableCaptions,
        pronunciationGuide: pronunciationGuide.trim() || undefined,
        speakers: cleanSpeakers.length > 0 ? cleanSpeakers : undefined,
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

      // Save / refresh template if requested
      if (saveAsTemplate || loadedTemplate) {
        const tplName = (saveAsTemplate ? templateName : loadedTemplate?.name) || title;
        const { serviceId: _sid, orgId: _oid, ...rest } = config;
        const tpl = saveTemplate({
          id: loadedTemplate?.id,
          name: tplName,
          config: rest,
        });
        markTemplateUsed(tpl.id);
        toast.success('Template saved', tpl.name);
      }

      router.push(`/operator/${serviceId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const estPerMin = 0.30 * targets.size;
  const estPerHour = estPerMin * 60;

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 md:py-14 animate-fade-in">
      <a href="/operator" className="inline-flex items-center gap-1.5 text-xs text-ink-400 hover:text-ink-200 mb-6 transition">
        <ArrowLeft className="h-3.5 w-3.5" /> Operator home
      </a>

      <h1 className="text-3xl md:text-4xl font-semibold tracking-tightish">
        Set up a service
      </h1>
      <p className="mt-2 text-ink-400 text-pretty">
        This creates a session, mints a join code, and prepares the LiveKit room.
        You&apos;ll capture audio on the next screen.
      </p>

      {loadedTemplate && (
        <div className="mt-4 inline-flex items-center gap-2 chip">
          <Bookmark className="h-3 w-3 text-accent-300" /> Loaded from <span className="text-ink-100">{loadedTemplate.name}</span>
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-8 grid gap-7">
        {/* Presets */}
        {!loadedTemplate && (
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
                  className="card text-left hover:border-white/[0.12] hover:bg-ink-900/70 transition-all"
                >
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="mt-1 text-[11px] text-ink-500">{p.description}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.targets.map((c) => <span key={c} className="text-xs">{FLAG[c]}</span>)}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Basics */}
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
              <label className="field-label" htmlFor="pastor">Default speaker name</label>
              <input
                id="pastor"
                className="field-input"
                value={pastorName}
                onChange={(e) => setPastorName(e.target.value)}
                placeholder="Pastor John"
              />
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
                              : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.06]'
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
              Estimated burn:{' '}
              <span className="text-ink-300 tabular-nums">${estPerMin.toFixed(2)}/min</span>{' '}
              · <span className="text-ink-300 tabular-nums">${estPerHour.toFixed(0)}/hour</span>
            </p>
          </div>

          <div className="flex items-end">
            <label className="inline-flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enableCaptions}
                onChange={(e) => setEnableCaptions(e.target.checked)}
                className="h-4 w-4 rounded border-white/[0.10] bg-ink-900 accent-accent-500"
              />
              <span className="text-sm">
                Show live captions (source &amp; targets)
                <span className="block text-[11px] text-ink-500 leading-snug">
                  Listeners on phones see them too.
                </span>
              </span>
            </label>
          </div>
        </section>

        {/* Advanced */}
        <section>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-sm text-ink-300 hover:text-ink-100 inline-flex items-center gap-2 mb-3"
          >
            <span className={cn('transition-transform', showAdvanced && 'rotate-90')}>›</span>
            Advanced · pronunciation, speakers
          </button>
          {showAdvanced && (
            <div className="grid gap-5 animate-fade-in">
              <div>
                <label className="field-label flex items-center gap-1.5" htmlFor="pronunciation">
                  <BookText className="h-3 w-3 text-ink-500" /> Pronunciation &amp; terminology guide
                </label>
                <textarea
                  id="pronunciation"
                  rows={4}
                  className="field-input resize-y"
                  value={pronunciationGuide}
                  onChange={(e) => setPronunciationGuide(e.target.value)}
                  placeholder={`E.g.\n"Hillsong Church" — preserve verbatim\nLogos → Logos (do not translate to 'word')\nPastor John Tigh → /tahy/`}
                />
                <p className="mt-1.5 text-[11px] text-ink-500 leading-relaxed">
                  Names, scripture refs, theological terms, or program names that should be
                  preserved or transliterated specifically. Used as session guidance when the
                  realtime model supports it.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="field-label flex items-center gap-1.5 !mb-0">
                    <Users className="h-3 w-3 text-ink-500" /> Speakers
                  </label>
                  <button
                    type="button"
                    onClick={addSpeaker}
                    className="text-xs text-accent-300 hover:underline inline-flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" /> Add speaker
                  </button>
                </div>
                {speakers.length === 0 ? (
                  <p className="text-[11px] text-ink-500">
                    Add additional speakers (worship leader, guest, etc.) to switch between them
                    during the service.
                  </p>
                ) : (
                  <ul className="grid gap-2">
                    {speakers.map((s) => (
                      <li key={s.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-center">
                        <input
                          className="field-input"
                          value={s.name}
                          onChange={(e) => updateSpeaker(s.id, { name: e.target.value })}
                          placeholder="Name"
                        />
                        <input
                          className="field-input"
                          value={s.role ?? ''}
                          onChange={(e) => updateSpeaker(s.id, { role: e.target.value })}
                          placeholder="Role (optional)"
                        />
                        <button
                          type="button"
                          onClick={() => removeSpeaker(s.id)}
                          className="text-ink-500 hover:text-red-300 p-2 rounded-md hover:bg-white/[0.04]"
                          aria-label="Remove speaker"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 grid gap-2">
                <label className="inline-flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={saveAsTemplate}
                    onChange={(e) => setSaveAsTemplate(e.target.checked)}
                    className="h-4 w-4 rounded border-white/[0.10] bg-ink-900 accent-accent-500"
                  />
                  <span className="text-sm flex items-center gap-1.5">
                    <Bookmark className="h-3 w-3 text-accent-300" />
                    {loadedTemplate ? 'Update template' : 'Save as a template'}
                  </span>
                </label>
                {saveAsTemplate && (
                  <input
                    className="field-input"
                    placeholder="Template name (e.g., Sunday Worship)"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                  />
                )}
              </div>
            </div>
          )}
        </section>

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm text-red-200 animate-fade-in">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-white/[0.06]">
          <a href="/operator" className="btn btn-ghost">Cancel</a>
          <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>
            {submitting ? 'Creating…' : 'Continue'}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </form>
    </main>
  );
}
