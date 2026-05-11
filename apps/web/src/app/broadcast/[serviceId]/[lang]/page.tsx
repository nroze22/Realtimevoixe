'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Cable, Radio, RefreshCw, Speaker } from 'lucide-react';
import { LANGUAGES_BY_CODE, type LanguageCode } from '@rtv/shared';
import { fetchListenerToken } from '@/lib/orchestrator';
import { ListenerSession } from '@/lib/listener';
import { Waveform } from '@/components/waveform';
import { Eyebrow, PhasePill } from '@/components/ui';
import { cn } from '@/lib/cn';

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
  const [secondsPlayed, setSecondsPlayed] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const langMeta = LANGUAGES_BY_CODE[lang];

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
        if (saved && list.some((d) => d.deviceId === saved)) setSelectedOutput(saved);
        else if (list[0]) setSelectedOutput(list[0].deviceId);
      } catch {/* noop */}
    }
    void enumerate();
  }, [serviceId, lang]);

  useEffect(() => {
    if (!supportsSink || !audioRef.current || !selectedOutput) return;
    try {
      (audioRef.current as any).setSinkId?.(selectedOutput);
      localStorage.setItem(`rtv:bcast-sink:${serviceId}:${lang}`, selectedOutput);
    } catch {/* noop */}
  }, [supportsSink, selectedOutput, serviceId, lang]);

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
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
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
        onLanguagesChanged: (langs) => setState(langs.includes(lang) ? 'live' : 'silent'),
        onAudioTrack: (l, track) => {
          if (l !== lang || !audioRef.current) return;
          session.attachTo(l, audioRef.current);
          audioRef.current.play().catch(() => {/* noop */});
          try { setStream(new MediaStream([track.mediaStreamTrack])); } catch {/* noop */}
        },
        onCaption: () => {/* not needed */},
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

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const t = setInterval(() => { if (!el.paused) setSecondsPlayed((b) => b + 1); }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    void connect();
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      void sessionRef.current?.disconnect();
    };
  }, [connect]);

  const tone =
    state === 'live'       ? 'live'
    : state === 'silent'   ? 'paused'
    : state === 'connecting' ? 'connecting'
    : 'offline';

  return (
    <main className="min-h-dvh px-6 md:px-10 py-12 mx-auto max-w-3xl animate-fade-in">
      <header className="mb-8">
        <span className="chip mb-4">
          <Radio className="h-3 w-3 text-accent-300" /> Broadcast output
        </span>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tightish leading-tight">
          {langMeta?.englishName ?? lang}
          <span className="block text-ink-400 text-2xl mt-1 font-normal">
            {langMeta?.nativeName ?? ''}
          </span>
        </h1>
        <p className="mt-3 text-sm text-ink-500">
          Service <span className="font-mono text-ink-300">{serviceId}</span>
        </p>
      </header>

      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      <div className="card">
        <div className="flex items-center justify-between">
          <PhasePill
            tone={tone}
            label={
              state === 'live'       ? 'ON AIR'
              : state === 'silent'   ? 'AWAITING UPSTREAM'
              : state === 'connecting' ? 'CONNECTING'
              : 'OFFLINE'
            }
            pulse={state === 'live' || state === 'connecting'}
          />
          <div className="text-xs text-ink-500 tabular-nums">
            {secondsPlayed > 0 ? `playing · ${fmtElapsed(secondsPlayed)}` : 'idle'}
          </div>
        </div>

        <div className="mt-6">
          <Waveform
            stream={stream}
            active={state === 'live'}
            color={state === 'live' ? 'bg-emerald-400' : 'bg-ink-700'}
            bars={48}
            className="h-12"
          />
        </div>

        <div className="mt-8">
          <Eyebrow className="mb-2 flex items-center gap-1.5">
            <Speaker className="h-3 w-3 text-ink-500" /> Audio output device
          </Eyebrow>
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
            <p className="text-xs text-ink-500">
              Your browser doesn&apos;t support output selection. Pick the right
              output in your OS sound settings.
            </p>
          )}
          <p className="mt-2 text-[11px] text-ink-500 leading-relaxed">
            Wire this device&apos;s line-out into the input on your assistive-listening
            transmitter (Williams AV, Listen Tech, Sennheiser MobileConnect ConnectStation,
            etc.) or your mixer&apos;s aux return.
          </p>
        </div>

        {error && (
          <div className="mt-5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200 flex items-center gap-2">
            <RefreshCw className="h-3 w-3 animate-spin" />
            {error} · reconnecting…
          </div>
        )}

        <div className="mt-6 text-[11px] text-ink-500 flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className={cn(
              'h-1.5 w-1.5 rounded-full',
              quality === 'excellent' ? 'bg-emerald-400' :
              quality === 'good' ? 'bg-emerald-400' :
              quality === 'poor' ? 'bg-amber-400' :
              quality === 'lost' ? 'bg-red-400' : 'bg-ink-600'
            )} />
            conn: {quality}
          </span>
        </div>
      </div>

      <ul className="mt-7 text-[11px] text-ink-500 space-y-1.5 leading-relaxed">
        <li className="flex items-start gap-2">
          <Cable className="h-3 w-3 mt-0.5 text-ink-600 flex-shrink-0" />
          Keep this tab open and visible for the duration of the service.
        </li>
        <li>• Wake-lock keeps the OS from throttling background tabs.</li>
        <li>• Auto-reconnects every 2s if the network drops.</li>
        <li>• Use the operator console&apos;s join code to start / stop upstream.</li>
      </ul>
    </main>
  );
}

function fmtElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
