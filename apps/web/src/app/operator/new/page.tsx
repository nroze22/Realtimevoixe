'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LANGUAGES,
  REALTIME_TARGET_LANGUAGES,
  type LanguageCode,
  type ServiceConfig,
} from '@rtv/shared';
import { createService } from '@/lib/orchestrator';

export default function NewServicePage() {
  const router = useRouter();
  const [title, setTitle] = useState('Sunday Worship Service');
  const [pastorName, setPastorName] = useState('');
  const [sourceLanguage, setSourceLanguage] = useState<LanguageCode>('en');
  const [targets, setTargets] = useState<Set<LanguageCode>>(new Set<LanguageCode>(['es']));
  const [costCap, setCostCap] = useState(30);
  const [enableCaptions, setEnableCaptions] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceOptions = LANGUAGES;
  const targetOptions = useMemo(() => REALTIME_TARGET_LANGUAGES, []);

  function toggleTarget(code: LanguageCode) {
    setTargets((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (targets.size === 0) throw new Error('Pick at least one target language.');
      if (targets.size > 6)
        throw new Error('Limit of 6 simultaneous target languages while we keep costs reasonable.');

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

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Start a service</h1>
      <p className="mt-2 text-sm text-ink-400">
        This creates a live session and a LiveKit room. You&apos;ll capture audio in the next step.
      </p>

      <form onSubmit={onSubmit} className="mt-8 grid gap-6">
        <div>
          <label className="field-label">Service title</label>
          <input
            className="field-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={120}
          />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <label className="field-label">Pastor name (optional)</label>
            <input
              className="field-input"
              value={pastorName}
              onChange={(e) => setPastorName(e.target.value)}
              placeholder="Pastor John"
            />
          </div>
          <div>
            <label className="field-label">Source language (spoken at the pulpit)</label>
            <select
              className="field-input"
              value={sourceLanguage}
              onChange={(e) => setSourceLanguage(e.target.value as LanguageCode)}
            >
              {sourceOptions.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.englishName} ({l.nativeName})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="field-label !mb-0">Target languages</label>
            <span className="text-xs text-ink-500">{targets.size} selected · max 6</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {targetOptions.map((l) => {
              const on = targets.has(l.code);
              return (
                <button
                  type="button"
                  key={l.code}
                  className={`chip ${on ? 'chip-on' : ''}`}
                  onClick={() => toggleTarget(l.code)}
                >
                  {l.englishName} <span className="text-ink-400">· {l.nativeName}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-ink-500">
            Each language adds an independent OpenAI Realtime session. Cost scales linearly.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <label className="field-label">Hard cost cap (USD)</label>
            <input
              type="number"
              min={1}
              max={500}
              step={1}
              className="field-input"
              value={costCap}
              onChange={(e) => setCostCap(Number(e.target.value))}
            />
            <p className="mt-1 text-xs text-ink-500">
              Service auto-stops at this cap. Default $30 covers ~1 service × 3 languages.
            </p>
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enableCaptions}
                onChange={(e) => setEnableCaptions(e.target.checked)}
              />
              Show live captions (source &amp; targets)
            </label>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-ink-800">
          <a href="/" className="btn btn-ghost">Back</a>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create service →'}
          </button>
        </div>
      </form>
    </main>
  );
}
