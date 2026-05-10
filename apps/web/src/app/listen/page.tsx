'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ListenLandingPage() {
  const router = useRouter();
  const [code, setCode] = useState('');

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <p className="text-xs uppercase tracking-[0.2em] text-ink-400 mb-3">Listener</p>
      <h1 className="text-3xl font-semibold tracking-tight">Join a service</h1>
      <p className="mt-2 text-sm text-ink-400">
        Scan the QR code your usher gave you, or enter the service code below.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = code.trim();
          if (trimmed) router.push(`/listen/${encodeURIComponent(trimmed)}`);
        }}
        className="mt-8 grid gap-3"
      >
        <label className="field-label">Service code</label>
        <input
          className="field-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="svc_xxxxxxxx"
          autoFocus
        />
        <button type="submit" className="btn btn-primary">Continue →</button>
      </form>
    </main>
  );
}
