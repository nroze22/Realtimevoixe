'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import {
  type CaptionFrame,
  type CostUpdate,
  type LanguageCode,
  type OrchestratorMessage,
  type ServiceConfig,
  LANGUAGES_BY_CODE,
} from '@rtv/shared';
import { AudioEngine } from '@/lib/audio-engine';
import { LevelTester } from '@/lib/level-tester';
import { LivekitPublisher } from '@/lib/livekit-publisher';
import { operatorWsUrl, recordingHref } from '@/lib/orchestrator';

interface StoredService {
  config: ServiceConfig;
  joinCode: string;
  livekit: { url: string; roomName: string; operatorToken: string };
}

type Conn = 'connecting' | 'open' | 'closed' | 'error';

export default function OperatorConsole() {
  const params = useParams<{ serviceId: string }>();
  const serviceId = params.serviceId;

  const [stored, setStored] = useState<StoredService | null>(null);
  const [conn, setConn] = useState<Conn>('closed');
  const [phase, setPhase] = useState<'setup' | 'live' | 'paused' | 'stopped'>('setup');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [captionsByLang, setCaptionsByLang] = useState<Record<string, string>>({});
  const [historyByLang, setHistoryByLang] = useState<Record<string, string[]>>({});
  const [cost, setCost] = useState<CostUpdate | null>(null);
  const [logs, setLogs] = useState<{ level: string; message: string; t: number }[]>([]);
  const [capWarning, setCapWarning] = useState<number | null>(null);
  const [capReached, setCapReached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listeners, setListeners] = useState<{ byLanguage: Record<string, number>; total: number }>({
    byLanguage: {},
    total: 0,
  });

  const engineRef = useRef<AudioEngine | null>(null);
  const publisherRef = useRef<LivekitPublisher | null>(null);
  const levelTesterRef = useRef<LevelTester | null>(null);
  const [inputLevel, setInputLevel] = useState({ rms: 0, peak: 0 });
  const [testing, setTesting] = useState(false);

  const listenerUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const code = stored?.joinCode ?? serviceId;
    return `${window.location.origin}/listen/${code}`;
  }, [serviceId, stored?.joinCode]);

  // ---------- Load service config from session ----------
  useEffect(() => {
    const raw = sessionStorage.getItem(`service:${serviceId}`);
    if (!raw) {
      setError('Service config not found in this browser session. Create it from /operator/new.');
      return;
    }
    setStored(JSON.parse(raw) as StoredService);
  }, [serviceId]);

  // ---------- Enumerate audio devices ----------
  useEffect(() => {
    async function enumerate() {
      try {
        // Trigger a permissions prompt so labels are populated.
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach((t) => t.stop());
        const list = (await navigator.mediaDevices.enumerateDevices()).filter(
          (d) => d.kind === 'audioinput',
        );
        setDevices(list);
        if (!selectedDevice && list[0]) setSelectedDevice(list[0].deviceId);
      } catch (err) {
        setError('Microphone permission denied. Allow access to pick an audio source.');
      }
    }
    void enumerate();
  }, [selectedDevice]);

  // ---------- Connect to orchestrator ----------
  const connect = useCallback(async () => {
    if (!stored) return;
    const engine = new AudioEngine({
      onConnectionChange: setConn,
      onLanguageStream: async (lang, stream) => {
        const pub = publisherRef.current;
        if (pub) {
          try { await pub.publishLanguage(lang, stream); }
          catch (err) { console.error('publish failed', err); }
        }
      },
      onMessage: handleMessage,
      onInputLevel: (rms) => setInputLevel((prev) => ({ rms, peak: Math.max(prev.peak * 0.97, rms) })),
    });
    engineRef.current = engine;

    const publisher = new LivekitPublisher();
    publisherRef.current = publisher;
    await publisher.connect(stored.livekit.url, stored.livekit.operatorToken);

    await engine.connect(operatorWsUrl(serviceId));
    engine.send({ type: 'hello', serviceId, role: 'operator' });

    // Pre-create sinks so binary frames have a destination right away.
    for (const lang of stored.config.targetLanguages as LanguageCode[]) {
      await engine.ensureSink(lang);
    }
  }, [serviceId, stored]);

  // ---------- WS message router ----------
  const handleMessage = useCallback((msg: OrchestratorMessage) => {
    switch (msg.type) {
      case 'state':
        if (msg.state.status === 'live') setPhase('live');
        else if (msg.state.status === 'paused') setPhase('paused');
        else if (msg.state.status === 'stopped') setPhase('stopped');
        break;
      case 'caption':
        applyCaption(msg.frame);
        break;
      case 'cost':
        setCost(msg.usage);
        break;
      case 'cap.warning':
        setCapWarning(msg.capFraction);
        break;
      case 'cap.reached':
        setCapReached(true);
        break;
      case 'listener.count':
        setListeners({ byLanguage: msg.byLanguage, total: msg.total });
        break;
      case 'log':
        setLogs((prev) => [
          ...prev.slice(-50),
          { level: msg.level, message: msg.message, t: msg.tMs },
        ]);
        break;
      case 'error':
        setError(msg.message);
        break;
      default:
        break;
    }
  }, []);

  function applyCaption(frame: CaptionFrame) {
    setCaptionsByLang((prev) => ({ ...prev, [frame.language]: frame.text }));
    if (frame.isFinal && frame.text.trim()) {
      setHistoryByLang((prev) => {
        const arr = prev[frame.language] ?? [];
        return { ...prev, [frame.language]: [...arr.slice(-20), frame.text] };
      });
    }
  }

  // ---------- Controls ----------
  async function onGoLive() {
    if (!engineRef.current) {
      try { await connect(); } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    try {
      await engineRef.current!.startCapture(selectedDevice || null);
      engineRef.current!.send({ type: 'start' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function onPause() { engineRef.current?.send({ type: 'pause' }); }
  function onResume() { engineRef.current?.send({ type: 'resume' }); }
  async function onStop() {
    engineRef.current?.send({ type: 'stop' });
    await publisherRef.current?.disconnect();
    await engineRef.current?.close();
  }

  async function toggleTest() {
    if (testing) {
      await levelTesterRef.current?.stop();
      levelTesterRef.current = null;
      setTesting(false);
      setInputLevel({ rms: 0, peak: 0 });
      return;
    }
    try {
      const tester = new LevelTester();
      await tester.start(selectedDevice || null, (rms, peak) =>
        setInputLevel((prev) => ({ rms, peak: Math.max(prev.peak * 0.96, peak) })),
      );
      levelTesterRef.current = tester;
      setTesting(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => () => {
    void publisherRef.current?.disconnect();
    void engineRef.current?.close();
    void levelTesterRef.current?.stop();
  }, []);

  // ---------- Render ----------
  if (error && !stored) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
        <a href="/operator/new" className="btn btn-primary mt-6">Create a service</a>
      </main>
    );
  }
  if (!stored) {
    return <main className="mx-auto max-w-2xl px-6 py-12 text-ink-400">Loading…</main>;
  }

  const cfg = stored.config;
  const targetLangs = cfg.targetLanguages as LanguageCode[];

  return (
    <main className="mx-auto max-w-6xl px-6 py-8 grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className="grid gap-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-ink-500">Operator console</p>
            <h1 className="text-2xl font-semibold">{cfg.title}</h1>
            <p className="text-sm text-ink-400">
              Source <span className="text-ink-200">{LANGUAGES_BY_CODE[cfg.sourceLanguage as LanguageCode].englishName}</span>
              <span className="mx-2 text-ink-700">→</span>
              {targetLangs.map((c) => LANGUAGES_BY_CODE[c].englishName).join(', ')}
            </p>
          </div>
          <PhaseBadge phase={phase} conn={conn} />
        </header>

        <div className="card">
          <div className="grid gap-4 md:grid-cols-[1fr_auto] items-end">
            <div>
              <label className="field-label">Audio input device</label>
              <select
                className="field-input"
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
              >
                {devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Audio input ${i + 1}`}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-ink-500">
                Connect a USB cable from the X32 / M32 / StudioLive USB output, or pick the system
                input wired to your aux send.
              </p>
            </div>
            <div className="flex gap-2">
              {phase === 'setup' || phase === 'stopped' ? (
                <>
                  <button onClick={toggleTest} className="btn btn-ghost">
                    {testing ? 'Stop test' : 'Test mic'}
                  </button>
                  <button onClick={onGoLive} className="btn btn-primary">Go live</button>
                </>
              ) : phase === 'live' ? (
                <>
                  <button onClick={onPause} className="btn btn-warn">Pause</button>
                  <button onClick={onStop} className="btn btn-danger">Stop</button>
                </>
              ) : phase === 'paused' ? (
                <>
                  <button onClick={onResume} className="btn btn-primary">Resume</button>
                  <button onClick={onStop} className="btn btn-danger">Stop</button>
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-4">
            <LevelMeter rms={inputLevel.rms} peak={inputLevel.peak} active={testing || phase === 'live'} />
          </div>

          {capReached && (
            <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              Cost cap reached — service stopped to protect your bill. Raise the cap and start a new
              service to continue.
            </div>
          )}
          {capWarning !== null && !capReached && (
            <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              {Math.round(capWarning * 100)}% of cost cap used.
            </div>
          )}
          {error && (
            <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}
        </div>

        <div className="grid gap-4">
          <h2 className="text-sm font-medium uppercase tracking-wider text-ink-400">Live captions</h2>
          <CaptionPanel
            label={`Source · ${LANGUAGES_BY_CODE[cfg.sourceLanguage as LanguageCode].englishName}`}
            current={captionsByLang[cfg.sourceLanguage] ?? ''}
            history={historyByLang[cfg.sourceLanguage] ?? []}
            highlight
          />
          {targetLangs.map((lang) => (
            <CaptionPanel
              key={lang}
              label={`${LANGUAGES_BY_CODE[lang].englishName} · ${LANGUAGES_BY_CODE[lang].nativeName}`}
              current={captionsByLang[lang] ?? ''}
              history={historyByLang[lang] ?? []}
            />
          ))}
        </div>
      </section>

      <aside className="grid gap-6 content-start">
        <div className="card">
          <h2 className="text-sm font-medium uppercase tracking-wider text-ink-400 mb-3">Cost</h2>
          <CostPanel cost={cost} cap={cfg.costCapUSD} />
        </div>

        <div className="card">
          <h2 className="text-sm font-medium uppercase tracking-wider text-ink-400 mb-2">
            Listeners
          </h2>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums">{listeners.total}</span>
            <span className="text-xs text-ink-500">connected</span>
          </div>
          {Object.keys(listeners.byLanguage).length > 0 ? (
            <ul className="mt-3 space-y-1 text-xs text-ink-300">
              {targetLangs.map((l) => (
                <li key={l} className="flex justify-between">
                  <span>{LANGUAGES_BY_CODE[l].englishName}</span>
                  <span className="tabular-nums text-ink-200">
                    {listeners.byLanguage[l] ?? 0}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-ink-600">No listeners yet.</p>
          )}
        </div>

        <div className="card">
          <h2 className="text-sm font-medium uppercase tracking-wider text-ink-400 mb-2">
            Join code
          </h2>
          <div className="font-mono text-2xl tracking-widest text-ink-50">
            {stored.joinCode}
          </div>
          <p className="mt-1 text-xs text-ink-500">
            Read it from the platform; ushers can enter it on the listener page.
          </p>
          <div className="rounded-md bg-white p-3 inline-block mt-4">
            <QRCodeSVG value={listenerUrl} size={180} />
          </div>
          <p className="mt-3 text-xs text-ink-400 break-all">{listenerUrl}</p>
          <a href={listenerUrl} target="_blank" rel="noreferrer" className="btn btn-ghost mt-3 w-full">
            Open listener page
          </a>
        </div>

        <div className="card">
          <h2 className="text-sm font-medium uppercase tracking-wider text-ink-400 mb-3">
            Recordings
          </h2>
          <p className="text-xs text-ink-500 mb-3">
            Available while the service is live and for ~1 minute after stop.
          </p>
          <div className="grid gap-2 text-xs">
            <DownloadRow
              label={`Source · ${LANGUAGES_BY_CODE[cfg.sourceLanguage as LanguageCode].englishName}`}
              srtHref={recordingHref(serviceId, cfg.sourceLanguage, 'srt')}
              vttHref={recordingHref(serviceId, cfg.sourceLanguage, 'vtt')}
            />
            {targetLangs.map((l) => (
              <DownloadRow
                key={l}
                label={LANGUAGES_BY_CODE[l].englishName}
                wavHref={recordingHref(serviceId, l, 'wav')}
                srtHref={recordingHref(serviceId, l, 'srt')}
                vttHref={recordingHref(serviceId, l, 'vtt')}
              />
            ))}
          </div>
        </div>

        <div className="card">
          <h2 className="text-sm font-medium uppercase tracking-wider text-ink-400 mb-3">Activity</h2>
          <ul className="text-xs text-ink-300 space-y-1 max-h-64 overflow-auto">
            {logs.length === 0 && <li className="text-ink-600">No events yet.</li>}
            {logs.map((l, i) => (
              <li key={i} className={l.level === 'error' ? 'text-red-300' : ''}>
                {l.message}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </main>
  );
}

// ---------- Subcomponents ----------

function DownloadRow({
  label, wavHref, srtHref, vttHref,
}: {
  label: string; wavHref?: string; srtHref?: string; vttHref?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-ink-800 last:border-0 py-1.5">
      <span className="text-ink-300 truncate">{label}</span>
      <div className="flex items-center gap-2">
        {wavHref && (
          <a className="text-accent hover:underline" href={wavHref} target="_blank" rel="noreferrer">
            wav
          </a>
        )}
        {srtHref && (
          <a className="text-ink-300 hover:text-ink-100 hover:underline" href={srtHref} target="_blank" rel="noreferrer">
            srt
          </a>
        )}
        {vttHref && (
          <a className="text-ink-300 hover:text-ink-100 hover:underline" href={vttHref} target="_blank" rel="noreferrer">
            vtt
          </a>
        )}
      </div>
    </div>
  );
}

function LevelMeter({ rms, peak, active }: { rms: number; peak: number; active: boolean }) {
  const dbfs = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  const pct = !active ? 0 : Math.max(0, Math.min(100, ((dbfs + 60) / 60) * 100));
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  const peakPct = !active ? 0 : Math.max(0, Math.min(100, ((peakDb + 60) / 60) * 100));
  return (
    <div>
      <div className="flex items-center justify-between mb-1 text-[10px] uppercase tracking-wider text-ink-500">
        <span>Input level</span>
        <span className="tabular-nums">
          {active
            ? `${dbfs === -Infinity ? '−∞' : dbfs.toFixed(0)} dBFS · peak ${peakDb === -Infinity ? '−∞' : peakDb.toFixed(0)} dB`
            : 'idle'}
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-ink-800">
        <div
          className={`absolute inset-y-0 left-0 transition-[width] duration-75 ${
            pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-emerald-500' : pct > 30 ? 'bg-emerald-500/80' : 'bg-emerald-600/50'
          }`}
          style={{ width: `${pct}%` }}
        />
        <div className="absolute inset-y-0 w-[2px] bg-amber-300/80" style={{ left: `${peakPct}%` }} />
      </div>
      {active && dbfs < -45 && (
        <p className="mt-1 text-[10px] text-amber-300">Signal looks quiet — check console aux send gain.</p>
      )}
      {active && peakDb > -3 && (
        <p className="mt-1 text-[10px] text-red-300">Peaks near clipping — pull the aux send down a few dB.</p>
      )}
    </div>
  );
}

function PhaseBadge({ phase, conn }: { phase: string; conn: Conn }) {
  const dot =
    phase === 'live' ? 'bg-emerald-400 animate-pulse'
      : phase === 'paused' ? 'bg-amber-400'
      : phase === 'stopped' ? 'bg-ink-500'
      : conn === 'open' ? 'bg-sky-400'
      : conn === 'connecting' ? 'bg-sky-400 animate-pulse'
      : 'bg-ink-600';
  const text =
    phase === 'live' ? 'LIVE'
      : phase === 'paused' ? 'PAUSED'
      : phase === 'stopped' ? 'STOPPED'
      : conn === 'open' ? 'READY'
      : conn === 'connecting' ? 'CONNECTING'
      : 'NOT CONNECTED';
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-ink-800 bg-ink-900 px-3 py-1.5 text-xs font-medium tracking-wide">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {text}
    </span>
  );
}

function CaptionPanel({
  label, current, history, highlight,
}: {
  label: string; current: string; history: string[]; highlight?: boolean;
}) {
  return (
    <div className={`card ${highlight ? 'border-accent/40' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wider text-ink-400">{label}</span>
      </div>
      <div className="text-base leading-snug min-h-[2.5rem]">
        {current || <span className="text-ink-700">…</span>}
      </div>
      {history.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-ink-400 max-h-40 overflow-auto pr-1">
          {history.slice().reverse().map((h, i) => (
            <li key={i} className="border-l-2 border-ink-800 pl-2">{h}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CostPanel({ cost, cap }: { cost: CostUpdate | null; cap: number }) {
  const pct = cost ? Math.min(100, Math.round(cost.capFraction * 100)) : 0;
  return (
    <>
      <div className="flex items-baseline justify-between">
        <span className="text-3xl font-semibold tabular-nums">
          ${cost ? cost.costUSD.toFixed(3) : '0.000'}
        </span>
        <span className="text-xs text-ink-500">cap ${cap.toFixed(0)}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-800">
        <div
          className={`h-full transition-all ${pct > 90 ? 'bg-red-500' : pct > 60 ? 'bg-amber-400' : 'bg-emerald-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-3 text-xs text-ink-500">
        Burn rate: <span className="text-ink-300 tabular-nums">
          ${cost ? cost.burnPerMinuteUSD.toFixed(3) : '—'}/min
        </span>
      </div>
      {cost && Object.keys(cost.costByLanguage).length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-ink-400">
          {Object.entries(cost.costByLanguage).map(([lang, c]) => (
            <li key={lang} className="flex justify-between">
              <span>{lang}</span>
              <span className="tabular-nums">${c.toFixed(3)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
