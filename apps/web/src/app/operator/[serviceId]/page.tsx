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
type Phase = 'setup' | 'live' | 'paused' | 'stopped';

/** Pre-flight wizard steps. */
type Step = 'device' | 'level' | 'share' | 'launch';

export default function OperatorConsole() {
  const params = useParams<{ serviceId: string }>();
  const serviceId = params.serviceId;

  // ---------- State ----------
  const [stored, setStored] = useState<StoredService | null>(null);
  const [conn, setConn] = useState<Conn>('closed');
  const [phase, setPhase] = useState<Phase>('setup');
  const [step, setStep] = useState<Step>('device');
  const [stepOk, setStepOk] = useState<Record<Step, boolean>>({
    device: false, level: false, share: false, launch: false,
  });
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
    byLanguage: {}, total: 0,
  });
  const [testing, setTesting] = useState(false);
  const [inputLevel, setInputLevel] = useState({ rms: 0, peak: 0 });
  const [hasSpokenAbove, setHasSpokenAbove] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  const engineRef = useRef<AudioEngine | null>(null);
  const publisherRef = useRef<LivekitPublisher | null>(null);
  const levelTesterRef = useRef<LevelTester | null>(null);

  const listenerUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const code = stored?.joinCode ?? serviceId;
    return `${window.location.origin}/listen/${code}`;
  }, [serviceId, stored?.joinCode]);

  // ---------- Boot: load service from sessionStorage ----------
  useEffect(() => {
    const raw = sessionStorage.getItem(`service:${serviceId}`);
    if (!raw) {
      setError('Service config not found in this browser session. Create it from /operator/new.');
      return;
    }
    setStored(JSON.parse(raw) as StoredService);
  }, [serviceId]);

  // ---------- Enumerate audio inputs ----------
  useEffect(() => {
    async function enumerate() {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach((t) => t.stop());
        const list = (await navigator.mediaDevices.enumerateDevices()).filter(
          (d) => d.kind === 'audioinput',
        );
        setDevices(list);
        const saved = localStorage.getItem('rtv:operator:device');
        if (saved && list.some((d) => d.deviceId === saved)) {
          setSelectedDevice(saved);
        } else if (list[0]) {
          setSelectedDevice(list[0].deviceId);
        }
      } catch {
        setError('Microphone permission denied. Allow access to choose an audio source.');
      }
    }
    void enumerate();
  }, []);

  // Mark device step OK once a device is selected.
  useEffect(() => {
    if (selectedDevice) {
      setStepOk((s) => ({ ...s, device: true }));
      localStorage.setItem('rtv:operator:device', selectedDevice);
    }
  }, [selectedDevice]);

  // ---------- Elapsed timer while live ----------
  useEffect(() => {
    if (phase !== 'live') return;
    const t = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

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

  // ---------- Connect to orchestrator + LiveKit ----------
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
      onInputLevel: (rms) =>
        setInputLevel((prev) => ({ rms, peak: Math.max(prev.peak * 0.97, rms) })),
    });
    engineRef.current = engine;

    const publisher = new LivekitPublisher();
    publisherRef.current = publisher;
    await publisher.connect(stored.livekit.url, stored.livekit.operatorToken);

    await engine.connect(operatorWsUrl(serviceId));
    engine.send({ type: 'hello', serviceId, role: 'operator' });

    for (const lang of stored.config.targetLanguages as LanguageCode[]) {
      await engine.ensureSink(lang);
    }
  }, [serviceId, stored, handleMessage]);

  // ---------- Controls ----------
  async function onGoLive() {
    setError(null);
    try {
      if (!engineRef.current) await connect();
      await engineRef.current!.startCapture(selectedDevice || null);
      engineRef.current!.send({ type: 'start' });
      setElapsedSec(0);
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
    publisherRef.current = null;
    engineRef.current = null;
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
      await tester.start(selectedDevice || null, (rms, peak) => {
        setInputLevel((prev) => ({ rms, peak: Math.max(prev.peak * 0.96, peak) }));
        if (rms > 0.02) setHasSpokenAbove(true); // ~-34dBFS
      });
      levelTesterRef.current = tester;
      setTesting(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Once test has heard real audio, level step is OK.
  useEffect(() => {
    if (hasSpokenAbove) setStepOk((s) => ({ ...s, level: true }));
  }, [hasSpokenAbove]);

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

  // ---------------------------- ON-AIR MODE ----------------------------
  if (phase === 'live' || phase === 'paused') {
    return (
      <OnAir
        cfg={cfg}
        joinCode={stored.joinCode}
        listenerUrl={listenerUrl}
        targetLangs={targetLangs}
        phase={phase}
        conn={conn}
        elapsedSec={elapsedSec}
        cost={cost}
        capReached={capReached}
        capWarning={capWarning}
        listeners={listeners}
        captionsByLang={captionsByLang}
        historyByLang={historyByLang}
        inputLevel={inputLevel}
        serviceId={serviceId}
        onPause={onPause}
        onResume={onResume}
        onStop={onStop}
      />
    );
  }

  // ---------------------------- SETUP WIZARD ----------------------------
  const allReady = stepOk.device && stepOk.level && stepOk.share;

  return (
    <main className="mx-auto max-w-3xl px-5 py-8 md:py-12">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.2em] text-ink-500">Pre-flight</p>
          <ConnBadge conn={conn} phase={phase} />
        </div>
        <h1 className="mt-2 text-2xl md:text-3xl font-semibold tracking-tight">{cfg.title}</h1>
        <p className="text-sm text-ink-400">
          {LANGUAGES_BY_CODE[cfg.sourceLanguage as LanguageCode].englishName}
          <span className="mx-2 text-ink-700">→</span>
          {targetLangs.map((c) => LANGUAGES_BY_CODE[c].englishName).join(', ')}
        </p>
      </header>

      <ol className="grid gap-3">
        <WizardStep
          n={1}
          title="Plug in your audio source"
          done={stepOk.device}
          open={step === 'device'}
          onOpen={() => setStep('device')}
          onContinue={() => setStep('level')}
          continueLabel="Next: test the signal"
        >
          <p className="text-sm text-ink-400 mb-3">
            Connect a cable from a clean mono aux send on your mixer
            (X32/M32/Yamaha/A&amp;H/StudioLive) into a USB audio interface plugged
            into this laptop. Then pick that interface here.
          </p>
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
          <ul className="mt-3 text-xs text-ink-500 list-disc pl-4 space-y-1">
            <li>Use a <strong className="text-ink-200">post-EQ aux send</strong>, not the main mix.</li>
            <li>Set the channel to mono if your console allows it.</li>
            <li>Echo cancellation / noise suppression are disabled here — your console&apos;s gates and EQ are the source of truth.</li>
          </ul>
        </WizardStep>

        <WizardStep
          n={2}
          title="Test the signal"
          done={stepOk.level}
          open={step === 'level'}
          onOpen={() => setStep('level')}
          disabled={!stepOk.device}
          onContinue={() => setStep('share')}
          continueLabel="Next: share with congregation"
        >
          <p className="text-sm text-ink-400 mb-3">
            Have someone speak into the pulpit mic. You want the green bar to
            sit around the middle when they speak normally, with peaks (the
            amber line) below the top.
          </p>
          <div className="flex items-center gap-3">
            <button onClick={toggleTest} className="btn btn-primary">
              {testing ? 'Stop test' : 'Start test'}
            </button>
            {hasSpokenAbove && (
              <span className="chip chip-on">Signal detected ✓</span>
            )}
          </div>
          <div className="mt-4">
            <LevelMeter rms={inputLevel.rms} peak={inputLevel.peak} active={testing} />
          </div>
        </WizardStep>

        <WizardStep
          n={3}
          title="Share with your congregation"
          done={stepOk.share}
          open={step === 'share'}
          onOpen={() => setStep('share')}
          disabled={!stepOk.level}
          onContinue={() => { setStepOk((s) => ({ ...s, share: true })); setStep('launch'); }}
          continueLabel="I'm ready to go live"
        >
          <div className="grid gap-4 md:grid-cols-[auto_1fr] items-start">
            <div className="rounded-lg bg-white p-3 inline-block">
              <QRCodeSVG value={listenerUrl} size={156} />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-500">Join code</div>
              <div className="font-mono text-2xl tracking-widest text-ink-50">
                {stored.joinCode}
              </div>
              <a
                href={listenerUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-xs text-accent break-all hover:underline"
              >
                {listenerUrl}
              </a>
              <p className="mt-3 text-xs text-ink-500">
                Print the QR + code, project it on a screen for ~30 seconds before service,
                or hand it to ushers. The code stays valid until you stop the service.
              </p>
            </div>
          </div>
          <details className="mt-5 text-xs">
            <summary className="cursor-pointer text-ink-300">
              Using existing FM/IR headsets?
            </summary>
            <div className="mt-2 text-ink-400 space-y-1.5 leading-relaxed">
              <p>
                Open a per-language broadcast page on a laptop near your transmitter and
                wire its line-out into the transmitter input:
              </p>
              <ul className="space-y-1 font-mono text-[11px]">
                {targetLangs.map((l) => (
                  <li key={l}>
                    <span className="text-ink-500">{LANGUAGES_BY_CODE[l].englishName}:</span>{' '}
                    <a
                      className="text-accent break-all"
                      target="_blank"
                      rel="noreferrer"
                      href={`/broadcast/${stored.joinCode}/${l}`}
                    >
                      {typeof window !== 'undefined' ? window.location.origin : ''}/broadcast/{stored.joinCode}/{l}
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                See the README for cabling diagrams (Williams AV, Listen Tech, Sennheiser
                MobileConnect).
              </p>
            </div>
          </details>
        </WizardStep>

        <WizardStep
          n={4}
          title="Go live"
          done={false}
          open={step === 'launch'}
          onOpen={() => setStep('launch')}
          disabled={!allReady}
        >
          <p className="text-sm text-ink-400 mb-3">
            Translation will start immediately. The first $30 of usage is your
            hard cap — we&apos;ll stop automatically if reached.
          </p>
          {error && (
            <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}
          <button
            onClick={onGoLive}
            disabled={!allReady}
            className="btn btn-primary w-full h-12 text-base"
          >
            Go live now
          </button>
          <p className="mt-2 text-[10px] text-ink-600 text-center">
            You can pause or stop at any time.
          </p>
        </WizardStep>
      </ol>
    </main>
  );
}

// ============================================================================
// ON-AIR component
// ============================================================================

function OnAir(props: {
  cfg: ServiceConfig;
  joinCode: string;
  listenerUrl: string;
  targetLangs: LanguageCode[];
  phase: Phase;
  conn: Conn;
  elapsedSec: number;
  cost: CostUpdate | null;
  capReached: boolean;
  capWarning: number | null;
  listeners: { byLanguage: Record<string, number>; total: number };
  captionsByLang: Record<string, string>;
  historyByLang: Record<string, string[]>;
  inputLevel: { rms: number; peak: number };
  serviceId: string;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  const {
    cfg, joinCode, listenerUrl, targetLangs, phase, conn, elapsedSec, cost,
    capReached, capWarning, listeners, captionsByLang, historyByLang, inputLevel,
    serviceId, onPause, onResume, onStop,
  } = props;

  const ring = phase === 'live'
    ? 'shadow-[0_0_0_2px_rgba(16,185,129,0.5)]'
    : phase === 'paused'
      ? 'shadow-[0_0_0_2px_rgba(245,158,11,0.5)]'
      : '';

  return (
    <main className={`min-h-dvh ${ring}`}>
      {/* Top bar */}
      <div className="sticky top-0 z-20 bg-ink-950/90 backdrop-blur border-b border-ink-800">
        <div className="mx-auto max-w-7xl px-5 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span
              className={`h-3 w-3 rounded-full ${
                phase === 'live' ? 'bg-emerald-400 animate-pulse'
                  : phase === 'paused' ? 'bg-amber-400'
                  : 'bg-ink-500'
              }`}
            />
            <span className="font-semibold tracking-wider text-sm">
              {phase === 'live' ? 'ON AIR' : phase === 'paused' ? 'PAUSED' : '—'}
            </span>
          </div>
          <span className="text-xs text-ink-500 tabular-nums">{fmtElapsed(elapsedSec)}</span>
          <div className="flex-1 truncate text-sm text-ink-300">{cfg.title}</div>
          <ConnBadge conn={conn} phase={phase} compact />
          <div className="flex gap-2">
            {phase === 'live' ? (
              <button onClick={onPause} className="btn btn-warn">Pause</button>
            ) : (
              <button onClick={onResume} className="btn btn-primary">Resume</button>
            )}
            <button onClick={onStop} className="btn btn-danger">Stop</button>
          </div>
        </div>
        {capReached && (
          <div className="bg-red-500/15 border-t border-red-500/30 text-red-200 text-xs px-5 py-1.5 text-center">
            Cost cap reached — service stopped to protect your bill.
          </div>
        )}
        {capWarning !== null && !capReached && capWarning >= 0.5 && (
          <div className="bg-amber-500/15 border-t border-amber-500/30 text-amber-100 text-xs px-5 py-1.5 text-center">
            {Math.round(capWarning * 100)}% of cost cap used.
          </div>
        )}
      </div>

      <div className="mx-auto max-w-7xl px-5 py-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Captions canvas */}
        <section className="grid gap-5">
          <CaptionPanelLg
            label={`Source · ${LANGUAGES_BY_CODE[cfg.sourceLanguage as LanguageCode].englishName}`}
            current={captionsByLang[cfg.sourceLanguage] ?? ''}
            history={historyByLang[cfg.sourceLanguage] ?? []}
            highlight
          />
          {targetLangs.map((lang) => (
            <CaptionPanelLg
              key={lang}
              label={`${LANGUAGES_BY_CODE[lang].englishName} · ${LANGUAGES_BY_CODE[lang].nativeName}`}
              listeners={listeners.byLanguage[lang] ?? 0}
              current={captionsByLang[lang] ?? ''}
              history={historyByLang[lang] ?? []}
              rtl={LANGUAGES_BY_CODE[lang].rtl}
            />
          ))}
        </section>

        {/* Right sidebar */}
        <aside className="grid gap-5 content-start">
          <MetricCard
            label="Cost"
            value={cost ? `$${cost.costUSD.toFixed(2)}` : '$0.00'}
            sub={cost ? `cap $${cfg.costCapUSD.toFixed(0)} · burn $${cost.burnPerMinuteUSD.toFixed(2)}/min` : '—'}
            barPct={cost ? Math.round(cost.capFraction * 100) : 0}
          />
          <MetricCard
            label="Listeners"
            value={String(listeners.total)}
            sub="connected on phones"
          />
          <MetricCard
            label="Input level"
            valueComponent={<LevelMeter rms={inputLevel.rms} peak={inputLevel.peak} active={phase === 'live'} compact />}
          />

          <div className="card">
            <h2 className="text-sm font-medium uppercase tracking-wider text-ink-400 mb-2">
              Share
            </h2>
            <div className="font-mono text-xl tracking-widest text-ink-50">{joinCode}</div>
            <div className="rounded-md bg-white p-2 inline-block mt-3">
              <QRCodeSVG value={listenerUrl} size={140} />
            </div>
            <a href={listenerUrl} target="_blank" rel="noreferrer" className="btn btn-ghost mt-3 w-full text-xs">
              Open listener page
            </a>
          </div>

          <div className="card">
            <h2 className="text-sm font-medium uppercase tracking-wider text-ink-400 mb-2">
              Headset broadcast outputs
            </h2>
            <ul className="text-xs space-y-1">
              {targetLangs.map((l) => (
                <li key={l} className="flex items-center justify-between gap-2">
                  <span className="truncate text-ink-300">{LANGUAGES_BY_CODE[l].englishName}</span>
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href={`/broadcast/${joinCode}/${l}`}
                    className="text-accent hover:underline"
                  >
                    open
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-ink-500">
              Pin one of these on a laptop wired into your FM/IR transmitter.
            </p>
          </div>

          <div className="card">
            <h2 className="text-sm font-medium uppercase tracking-wider text-ink-400 mb-2">
              Recordings
            </h2>
            <div className="grid gap-1 text-[11px]">
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
            <p className="mt-2 text-[10px] text-ink-500">
              Available during and ~5 min after the service.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}

// ============================================================================
// Subcomponents
// ============================================================================

function WizardStep({
  n, title, done, open, disabled, onOpen, onContinue, continueLabel, children,
}: {
  n: number;
  title: string;
  done: boolean;
  open: boolean;
  disabled?: boolean;
  onOpen?: () => void;
  onContinue?: () => void;
  continueLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <li
      className={`rounded-2xl border transition overflow-hidden
        ${open ? 'border-accent/50 bg-ink-900/70' : 'border-ink-800 bg-ink-900/40'}
        ${disabled ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        onClick={() => !disabled && onOpen?.()}
        disabled={disabled}
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
      >
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold
            ${done ? 'bg-emerald-500/20 text-emerald-300'
              : open ? 'bg-accent text-accent-fg'
              : 'bg-ink-800 text-ink-300'}`}
        >
          {done ? '✓' : n}
        </span>
        <span className="font-medium">{title}</span>
        {disabled && <span className="ml-auto text-xs text-ink-500">complete previous step</span>}
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1">
          {children}
          {onContinue && (
            <div className="mt-5 flex justify-end">
              <button onClick={onContinue} className="btn btn-primary">{continueLabel ?? 'Continue'} →</button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function MetricCard({
  label, value, sub, barPct, valueComponent,
}: {
  label: string;
  value?: string;
  sub?: string;
  barPct?: number;
  valueComponent?: React.ReactNode;
}) {
  return (
    <div className="card">
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-ink-500 mb-1">{label}</h2>
      {valueComponent ?? <div className="text-3xl font-semibold tabular-nums">{value}</div>}
      {sub && <div className="mt-1 text-[11px] text-ink-500">{sub}</div>}
      {typeof barPct === 'number' && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-800">
          <div
            className={`h-full transition-all ${
              barPct > 90 ? 'bg-red-500' : barPct > 60 ? 'bg-amber-400' : 'bg-emerald-500'
            }`}
            style={{ width: `${Math.min(100, barPct)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function CaptionPanelLg({
  label, current, history, highlight, listeners, rtl,
}: {
  label: string;
  current: string;
  history: string[];
  highlight?: boolean;
  listeners?: number;
  rtl?: boolean;
}) {
  return (
    <div
      dir={rtl ? 'rtl' : 'ltr'}
      className={`card ${highlight ? 'border-accent/40 bg-accent/5' : ''}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wider text-ink-400">{label}</span>
        {typeof listeners === 'number' && (
          <span className="text-[11px] text-ink-500">{listeners} listening</span>
        )}
      </div>
      <div className="text-lg md:text-xl leading-snug min-h-[2.5rem]">
        {current || <span className="text-ink-700">…</span>}
      </div>
      {history.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-ink-400 max-h-32 overflow-auto pr-1">
          {history.slice().reverse().map((h, i) => (
            <li key={i} className="border-l-2 border-ink-800 pl-2">{h}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DownloadRow({
  label, wavHref, srtHref, vttHref,
}: {
  label: string; wavHref?: string; srtHref?: string; vttHref?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-ink-800/70 last:border-0 py-1.5">
      <span className="text-ink-300 truncate">{label}</span>
      <div className="flex items-center gap-2">
        {wavHref && <a className="text-accent hover:underline" href={wavHref} target="_blank" rel="noreferrer">wav</a>}
        {srtHref && <a className="text-ink-300 hover:text-ink-100 hover:underline" href={srtHref} target="_blank" rel="noreferrer">srt</a>}
        {vttHref && <a className="text-ink-300 hover:text-ink-100 hover:underline" href={vttHref} target="_blank" rel="noreferrer">vtt</a>}
      </div>
    </div>
  );
}

function LevelMeter({
  rms, peak, active, compact,
}: { rms: number; peak: number; active: boolean; compact?: boolean }) {
  const dbfs = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  const pct = !active ? 0 : Math.max(0, Math.min(100, ((dbfs + 60) / 60) * 100));
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  const peakPct = !active ? 0 : Math.max(0, Math.min(100, ((peakDb + 60) / 60) * 100));
  return (
    <div>
      {!compact && (
        <div className="flex items-center justify-between mb-1 text-[10px] uppercase tracking-wider text-ink-500">
          <span>Input level</span>
          <span className="tabular-nums">
            {active
              ? `${dbfs === -Infinity ? '−∞' : dbfs.toFixed(0)} dBFS · peak ${peakDb === -Infinity ? '−∞' : peakDb.toFixed(0)} dB`
              : 'idle'}
          </span>
        </div>
      )}
      <div className={`relative overflow-hidden rounded-full bg-ink-800 ${compact ? 'h-3' : 'h-2'}`}>
        <div
          className={`absolute inset-y-0 left-0 transition-[width] duration-75 ${
            pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-emerald-500' : pct > 30 ? 'bg-emerald-500/80' : 'bg-emerald-600/50'
          }`}
          style={{ width: `${pct}%` }}
        />
        <div className="absolute inset-y-0 w-[2px] bg-amber-300/80" style={{ left: `${peakPct}%` }} />
      </div>
      {!compact && active && dbfs < -45 && (
        <p className="mt-1 text-[10px] text-amber-300">Signal looks quiet — check the aux send gain.</p>
      )}
      {!compact && active && peakDb > -3 && (
        <p className="mt-1 text-[10px] text-red-300">Peaks near clipping — pull the aux send down a few dB.</p>
      )}
    </div>
  );
}

function ConnBadge({
  conn, phase, compact,
}: { conn: Conn; phase: Phase; compact?: boolean }) {
  const dot =
    phase === 'live' ? 'bg-emerald-400 animate-pulse'
      : phase === 'paused' ? 'bg-amber-400'
      : conn === 'open' ? 'bg-sky-400'
      : conn === 'connecting' ? 'bg-sky-400 animate-pulse'
      : 'bg-ink-600';
  const text =
    phase === 'live' ? 'LIVE'
      : phase === 'paused' ? 'PAUSED'
      : conn === 'open' ? 'READY'
      : conn === 'connecting' ? 'CONNECTING'
      : 'OFFLINE';
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border border-ink-800 bg-ink-900 ${compact ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-xs'} font-medium tracking-wide`}>
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {text}
    </span>
  );
}

function fmtElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
