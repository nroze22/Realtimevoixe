'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { LANGUAGES_BY_CODE, type LanguageCode } from '@rtv/shared';
import { fetchListenerToken } from '@/lib/orchestrator';
import { ListenerSession } from '@/lib/listener';

/**
 * Broadcast output mode. Pin a laptop/Pi to this URL with its line-out wired
 * to the FM/IR/Wi-Fi transmitter input that already feeds the church's
 * existing receiver headsets. This page is designed to run unattended for
 * hours: it keeps the screen awake, picks a specific audio output sink, and
 * auto-reconnects forever.
 */
export default function BroadcastPage() {
  const params = useParams<{ serviceId: string; lang: string }>();
  const serviceId = params.serviceId;
  const lang = params.lang as LanguageCode;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<ListenerSession | null>(null);
  const wakeLockRef = useRef<any>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [state, setState] = useState<'connecting' | 'live' | 'silent' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedOutput, setSelectedOutput] = useState<string>('');
  const [supportsSink, setSupportsSink] = useState(false);
  const [quality, setQuality] = useState<string>('unknown');
  const [bytesPlayed, setBytesPlayed] = useState(0);

  const langMeta = LANGUAGES_BY_CODE[lang];

  // Enumerate output devices (needs prior permission for labels).
  useEffect(() => {
    setSupportsSink(typeof HTMLAudioElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype);
    async function enumerate() {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach((t) => t.stop());
        const list = (await navigator.mediaDevices.enumerateDevices()).filter(
          (d) => d.kind === 'audiooutput',
        );
        setOutputs(list);
        const saved = localStorage.getItem(`rtv:bcast-sink:${serviceId}:${lang}`);
        if (saved && list.some((d) => d.deviceId === saved)) {
          setSelectedOutput(saved);
        } else if (list[0]) {
          setSelectedOutput(list[0].deviceId);
        }
      } catch {
        // Permission denied. Default audio output still works for line-out.
      }
    }
    void enumerate();
  }, [serviceId, lang]);

  useEffect(() => {
    if (!supportsSink || !audioRef.current || !selectedOutput) return;
    try {
      (audioRef.current as any).setSinkId?.(selectedOutput);
      localStorage.setItem(`rtv:bcast-sink:${serviceId}:${lang}`, selectedOutput);
    } catch (err) {
      console.warn('setSinkId failed', err);
    }
  }, [supportsSink, selectedOutput, serviceId, lang]);

  // Wake lock keeps the screen on so the page is never throttled by the OS.
  useEffect(() => {
    async function acquire() {
      try {
        const lock = await (navigator as any).wakeLock?.request?.('screen');
        wakeLockRef.current = lock ?? null;
      } catch {/* noop */}
    }
    void acquire();
    function onVisible() {
      if (document.visibilityState === 'visible') void acquire();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      try { wakeLockRef.current?.release?.(); } catch {/* noop */}
    };
  }, []);

  const connect = useCallback(async () => {
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
    setState('connecting');
    setError(null);
    try {
      const tok = await fetchListenerToken(serviceId, lang, `broadcast-${lang}`);
      const session = new ListenerSession({
        onConnected: (langs) => {
          if (langs.includes(lang) && audioRef.current) {
            session.attachTo(lang, audioRef.current);
            audioRef.current.muted = false;
            audioRef.current.volume = 1;
            audioRef.current.play().catch(() => {/* noop */});
          }
          setState(langs.includes(lang) ? 'live' : 'silent');
        },
        onLanguagesChanged: (langs) => {
          if (langs.includes(lang) && audioRef.current) {
            session.attachTo(lang, audioRef.current);
            audioRef.current.play().catch(() => {/* noop */});
          }
          setState(langs.includes(lang) ? 'live' : 'silent');
        },
        onAudioTrack: (l) => {
          if (l !== lang || !audioRef.current) return;
          session.attachTo(l, audioRef.current);
          audioRef.current.play().catch(() => {/* noop */});
        },
        onCaption: () => {/* captions not needed for headset broadcast */},
        onConnectionQuality: (q) => setQuality(q),
        onDisconnected: () => scheduleReconnect(),
        onError: (m) => { setError(m); scheduleReconnect(); },
      });
      sessionRef.current = session;
      await session.connect(tok.url, tok.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
      scheduleReconnect();
    }
  }, [serviceId, lang]);

  function scheduleReconnect() {
    if (retryRef.current) return;
    retryRef.current = setTimeout(() => {
      retryRef.current = null;
      void connect();
    }, 2000);
  }

  // Track how much audio actually played so the operator can see it isn't dead.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const t = setInterval(() => {
      if (!el.paused) setBytesPlayed((b) => b + 1);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-connect on mount.
  useEffect(() => {
    void connect();
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      void sessionRef.current?.disconnect();
    };
  }, [connect]);

  return (
    <main className="min-h-dvh px-8 py-12 mx-auto max-w-3xl">
      <header className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.2em] text-ink-500 mb-2">
          Broadcast output
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">
          {langMeta?.englishName ?? lang}
          <span className="text-ink-500"> · </span>
          <span className="text-ink-300">{langMeta?.nativeName ?? ''}</span>
        </h1>
        <p className="mt-2 text-sm text-ink-400">
          Service <span className="font-mono text-ink-200">{serviceId}</span>
        </p>
      </header>

      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      <div className="card">
        <div className="flex items-center justify-between">
          <StateBadge state={state} quality={quality} />
          <div className="text-xs text-ink-500 tabular-nums">
            {bytesPlayed > 0 ? `playing · ${bytesPlayed}s` : 'idle'}
          </div>
        </div>

        <div className="mt-6">
          <label className="field-label">Audio output device</label>
          {supportsSink ? (
            <select
              className="field-input"
              value={selectedOutput}
              onChange={(e) => setSelectedOutput(e.target.value)}
            >
              {outputs.length === 0 && <option value="">Default</option>}
              {outputs.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Output ${i + 1}`}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-ink-400">
              Your browser doesn&apos;t support audio output selection. Audio will play through
              the system default device — pick the right output in your OS sound settings.
            </p>
          )}
          <p className="mt-2 text-xs text-ink-500">
            Wire this device&apos;s line-out into the input on your assistive-listening
            transmitter (Williams AV, Listen Tech, Sennheiser MobileConnect ConnectStation,
            etc.) or your mixer&apos;s aux return.
          </p>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error} · reconnecting…
          </div>
        )}
      </div>

      <ul className="mt-6 text-xs text-ink-500 space-y-1">
        <li>• Keep this tab open and visible for the duration of the service.</li>
        <li>• The screen wake-lock keeps the OS from throttling background tabs.</li>
        <li>• Auto-reconnects every 2s if the network drops.</li>
        <li>• Use the operator console&apos;s join code to start / stop the upstream service.</li>
      </ul>
    </main>
  );
}

function StateBadge({ state, quality }: { state: string; quality: string }) {
  const color =
    state === 'live' ? 'bg-emerald-400 animate-pulse'
      : state === 'silent' ? 'bg-amber-400'
      : state === 'connecting' ? 'bg-sky-400 animate-pulse'
      : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <span className={`h-3 w-3 rounded-full ${color}`} />
      <span className="text-sm uppercase tracking-wider">
        {state === 'live' ? 'On Air' : state === 'silent' ? 'Awaiting upstream' : state}
      </span>
      <span className="text-xs text-ink-500 ml-2">conn: {quality}</span>
    </div>
  );
}
