'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Headphones } from 'lucide-react';
import { normalizeJoinCode } from '@rtv/shared';

export default function ListenLandingPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = code.trim();
    if (!trimmed) return;
    const normalized = normalizeJoinCode(trimmed);
    const target = normalized ?? trimmed;
    router.push(`/listen/${encodeURIComponent(target)}`);
  }

  return (
    <main className="mx-auto max-w-md px-5 pt-10 pb-12 animate-fade-in">
      <a href="/" className="inline-flex items-center gap-1.5 text-xs text-ink-400 hover:text-ink-200 mb-6 transition">
        <ArrowLeft className="h-3.5 w-3.5" /> Home
      </a>

      <span className="chip mb-4">
        <Headphones className="h-3 w-3 text-accent-300" /> Listener
      </span>
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tightish">Join a service</h1>
      <p className="mt-2 text-sm text-ink-400 text-pretty">
        Scan the QR your usher gave you, or enter the service code below. Then
        pick your language and plug in your earbuds.
      </p>

      <form onSubmit={onSubmit} className="mt-8 grid gap-3">
        <label className="field-label" htmlFor="code">Service code</label>
        <input
          id="code"
          className="field-input font-mono uppercase tracking-[0.18em] text-lg text-center"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="SVC-XXXX"
          autoFocus
          autoCapitalize="characters"
          inputMode="text"
        />
        {error && <p className="text-xs text-red-300">{error}</p>}
        <button type="submit" className="btn btn-primary btn-lg">
          Continue <ArrowRight className="h-4 w-4" />
        </button>
      </form>

      <p className="mt-10 text-[11px] text-ink-500 text-center">
        Tip: add this page to your home screen for faster access next week.
      </p>
    </main>
  );
}
