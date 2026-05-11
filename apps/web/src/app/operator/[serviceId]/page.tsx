'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowRight,
  Cable,
  Check,
  Circle,
  Command,
  DollarSign,
  Download,
  ExternalLink,
  FileText,
  Headphones,
  Keyboard,
  Mic,
  Pause as PauseIcon,
  Play,
  Radio,
  Share2,
  Square,
  Users,
  Volume2,
  Music,
} from 'lucide-react';
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
import { cn } from '@/lib/cn';
import { Button, CopyButton, Eyebrow, PhasePill, Stat } from '@/components/ui';
import { Waveform } from '@/components/waveform';
import { AnimatedNumber } from '@/components/animated-number';
import { ChannelStrip } from '@/components/channel-strip';
import { CommandPalette, type CommandItem } from '@/components/command-palette';
import { Logo } from '@/components/logo';
import { useToast } from '@/components/toast';

interface StoredService {
  config: ServiceConfig;
  joinCode: string;
  livekit: { url: string; roomName: string; operatorToken: string };
}

type Conn = 'connecting' | 'open' | 'closed' | 'error';
type Phase = 'setup' | 'live' | 'paused' | 'stopped';
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
  const [inputStream, setInputStream] = useState<MediaStream | null>(null);
  const [outputStreams, setOutputStreams] = useState<Record<string, MediaStream>>({});
  const [cmdOpen, setCmdOpen] = useState(false);
  const [endedSummary, setEndedSummary] = useState<null | {
    durationSec: number; costUSD: number; peakListeners: number;
  }>(null);

  const toast = useToast();

  const engineRef = useRef<AudioEngine | null>(null);
  const publisherRef = useRef<LivekitPublisher | null>(null);
  const levelTesterRef = useRef<LevelTester | null>(null);
  const peakListenersRef = useRef(0);

  const listenerUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const code = stored?.joinCode ?? serviceId;
    return `${window.location.origin}/listen/${code}`;
  }, [serviceId, stored?.joinCode]);

  // ---------- Boot ----------
  useEffect(() => {
    const raw = sessionStorage.getItem(`service:${serviceId}`);
    if (!raw) {
      setError('Service config not found in this browser session. Create it from /operator/new.');
      return;
    }
    setStored(JSON.parse(raw) as StoredService);
  }, [serviceId]);

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
        if (saved && list.some((d) => d.deviceId === saved)) setSelectedDevice(saved);
        else if (list[0]) setSelectedDevice(list[0].deviceId);
      } catch {
        setError('Microphone permission denied. Allow access to choose an audio source.');
      }
    }
    void enumerate();
  }, []);

  useEffect(() => {
    if (selectedDevice) {
      setStepOk((s) => ({ ...s, device: true }));
      localStorage.setItem('rtv:operator:device', selectedDevice);
    }
  }, [selectedDevice]);

  useEffect(() => {
    if (phase !== 'live') return;
    const t = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    peakListenersRef.current = Math.max(peakListenersRef.current, listeners.total);
  }, [listeners.total]);

  // ---------- WS message router ----------
  const handleMessage = useCallback((msg: OrchestratorMessage) => {
    switch (msg.type) {
      case 'state':
        if (msg.state.status === 'live') setPhase('live');
        else if (msg.state.status === 'paused') setPhase('paused');
        else if (msg.state.status === 'stopped') {
          setPhase('stopped');
          setEndedSummary({
            durationSec: elapsedSec,
            costUSD: cost?.costUSD ?? 0,
            peakListeners: peakListenersRef.current,
          });
        }
        break;
      case 'caption':
        applyCaption(msg.frame);
        break;
      case 'cost':
        setCost(msg.usage);
        break;
      case 'cap.warning':
        setCapWarning(msg.capFraction);
        toast.warn(
          `${Math.round(msg.capFraction * 100)}% of cost cap`,
          'Consider stopping or raising the cap before the service ends.',
        );
        break;
      case 'cap.reached':
        setCapReached(true);
        toast.error('Cost cap reached', 'Service stopped automatically to protect your bill.');
        break;
      case 'listener.count':
        setListeners({ byLanguage: msg.byLanguage, total: msg.total });
        break;
      case 'error':
        setError(msg.message);
        toast.error('Error', msg.message);
        break;
    }
  }, [elapsedSec, cost]);

  function applyCaption(frame: CaptionFrame) {
    setCaptionsByLang((prev) => ({ ...prev, [frame.language]: frame.text }));
    if (frame.isFinal && frame.text.trim()) {
      setHistoryByLang((prev) => {
        const arr = prev[frame.language] ?? [];
        return { ...prev, [frame.language]: [...arr.slice(-20), frame.text] };
      });
    }
  }

  // ---------- Connect ----------
  const connect = useCallback(async () => {
    if (!stored) return;
    const engine = new AudioEngine({
      onConnectionChange: setConn,
      onLanguageStream: async (lang, stream) => {
        setOutputStreams((prev) => ({ ...prev, [lang]: stream }));
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
      setInputStream(engineRef.current!.getInputStream());
      engineRef.current!.send({ type: 'start' });
      setElapsedSec(0);
      setEndedSummary(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  function onPause()  { engineRef.current?.send({ type: 'pause' }); }
  function onResume() { engineRef.current?.send({ type: 'resume' }); }
  async function onStop() {
    setEndedSummary({
      durationSec: elapsedSec,
      costUSD: cost?.costUSD ?? 0,
      peakListeners: peakListenersRef.current,
    });
    engineRef.current?.send({ type: 'stop' });
    await publisherRef.current?.disconnect();
    await engineRef.current?.close();
    publisherRef.current = null;
    engineRef.current = null;
    setInputStream(null);
    setPhase('stopped');
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
        if (rms > 0.02) setHasSpokenAbove(true);
      });
      levelTesterRef.current = tester;
      setTesting(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

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
        <div className="card border-red-500/40 bg-red-500/10 text-red-200 text-sm">{error}</div>
        <a href="/operator/new" className="btn btn-primary mt-6">Create a service</a>
      </main>
    );
  }
  if (!stored) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <div className="card animate-pulse text-ink-500">Loading service…</div>
      </main>
    );
  }

  const cfg = stored.config;
  const targetLangs = cfg.targetLanguages as LanguageCode[];

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
        inputStream={inputStream}
        outputStreams={outputStreams}
        serviceId={serviceId}
        cmdOpen={cmdOpen}
        setCmdOpen={setCmdOpen}
        onPause={onPause}
        onResume={onResume}
        onStop={onStop}
        toastSuccess={(t, b) => toast.success(t, b)}
      />
    );
  }

  if (phase === 'stopped' && endedSummary) {
    return (
      <EndedSummary
        cfg={cfg}
        joinCode={stored.joinCode}
        serviceId={serviceId}
        targetLangs={targetLangs}
        durationSec={endedSummary.durationSec}
        costUSD={endedSummary.costUSD}
        peakListeners={endedSummary.peakListeners}
      />
    );
  }

  const allReady = stepOk.device && stepOk.level && stepOk.share;

  return (
    <main className="mx-auto max-w-3xl px-5 py-8 md:py-14 animate-fade-in">
      <header className="mb-7">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>Pre-flight</Eyebrow>
          <PhasePill
            tone={
              conn === 'open' ? 'ready'
              : conn === 'connecting' ? 'connecting'
              : 'offline'
            }
            label={
              conn === 'open' ? 'READY'
              : conn === 'connecting' ? 'CONNECTING'
              : 'OFFLINE'
            }
            pulse={conn === 'connecting'}
          />
        </div>
        <h1 className="mt-2 text-3xl md:text-4xl font-semibold tracking-tightish">{cfg.title}</h1>
        <p className="text-sm text-ink-400 mt-1">
          {LANGUAGES_BY_CODE[cfg.sourceLanguage as LanguageCode].englishName}
          <span className="mx-2 text-ink-700">→</span>
          {targetLangs.map((c) => LANGUAGES_BY_CODE[c].englishName).join(', ')}
        </p>
      </header>

      {/* Progress rail */}
      <ProgressRail
        steps={[
          { key: 'device', label: 'Audio',     done: stepOk.device },
          { key: 'level',  label: 'Signal',    done: stepOk.level },
          { key: 'share',  label: 'Share',     done: stepOk.share },
          { key: 'launch', label: 'Go live',   done: false },
        ]}
        active={step}
      />

      <ol className="mt-7 grid gap-3">
        <WizardStep
          n={1}
          icon={Cable}
          title="Plug in your audio source"
          tagline="Pick the device that's carrying the pulpit mic."
          done={stepOk.device}
          open={step === 'device'}
          onOpen={() => setStep('device')}
          onContinue={() => setStep('level')}
        >
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
          <Hint className="mt-3">
            Take a balanced cable from any <strong className="text-ink-200">post-EQ mono aux send</strong> on your mixer
            (X32/M32/Yamaha/A&amp;H/StudioLive) into a USB audio interface, then pick that
            interface above.
          </Hint>
        </WizardStep>

        <WizardStep
          n={2}
          icon={Mic}
          title="Test the signal"
          tagline="Make sure we're actually hearing the mic."
          done={stepOk.level}
          open={step === 'level'}
          onOpen={() => setStep('level')}
          disabled={!stepOk.device}
          onContinue={() => setStep('share')}
        >
          <p className="text-sm text-ink-400 mb-3 text-pretty">
            Have someone speak normally into the pulpit mic. You want the green
            bar around the middle, with peaks (amber line) below the top.
          </p>
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={toggleTest} icon={testing ? Square : Play}>
              {testing ? 'Stop test' : 'Start test'}
            </Button>
            {hasSpokenAbove && (
              <span className="chip chip-on">
                <Check className="h-3 w-3" /> Signal detected
              </span>
            )}
          </div>
          <div className="mt-4">
            <LevelMeter rms={inputLevel.rms} peak={inputLevel.peak} active={testing} />
          </div>
        </WizardStep>

        <WizardStep
          n={3}
          icon={Share2}
          title="Share with your congregation"
          tagline="Print the QR, project the code, or hand it to ushers."
          done={stepOk.share}
          open={step === 'share'}
          onOpen={() => setStep('share')}
          disabled={!stepOk.level}
          onContinue={() => { setStepOk((s) => ({ ...s, share: true })); setStep('launch'); }}
        >
          <div className="grid gap-5 md:grid-cols-[auto_1fr] items-start">
            <div className="rounded-xl bg-white p-3 inline-block">
              <QRCodeSVG value={listenerUrl} size={172} />
            </div>
            <div>
              <Eyebrow>Join code</Eyebrow>
              <div className="mt-1 flex items-center gap-2">
                <div className="font-mono text-3xl tracking-[0.18em] text-ink-50">{stored.joinCode}</div>
                <CopyButton value={stored.joinCode} label="code" />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <a href={listenerUrl} target="_blank" rel="noreferrer"
                   className="text-xs text-accent-300 break-all hover:underline">{listenerUrl}</a>
                <CopyButton value={listenerUrl} label="link" compact />
              </div>
              <Hint className="mt-4">
                The code stays valid until you stop the service. Project it on a
                screen for ~30 seconds before service starts.
              </Hint>
            </div>
          </div>

          <details className="mt-5 rounded-lg border border-ink-800 bg-ink-900/40 px-4 py-3">
            <summary className="cursor-pointer text-sm text-ink-200 flex items-center gap-2">
              <Headphones className="h-4 w-4 text-ink-400" />
              Using existing FM/IR headsets?
            </summary>
            <div className="mt-3 text-xs text-ink-400 space-y-2">
              <p>
                Open one of these broadcast pages on a laptop near your transmitter and
                wire its line-out into the transmitter input. The page keeps the screen
                awake and auto-reconnects.
              </p>
              <ul className="space-y-1">
                {targetLangs.map((l) => {
                  const href = `/broadcast/${stored.joinCode}/${l}`;
                  return (
                    <li key={l} className="flex items-center gap-2">
                      <span className="text-ink-300 w-32 truncate">{LANGUAGES_BY_CODE[l].englishName}</span>
                      <a className="text-accent-300 hover:underline inline-flex items-center gap-1 break-all" target="_blank" rel="noreferrer" href={href}>
                        {href} <ExternalLink className="h-3 w-3" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          </details>
        </WizardStep>

        <WizardStep
          n={4}
          icon={Radio}
          title="Go live"
          tagline="Translation starts immediately. You can pause or stop anytime."
          done={false}
          open={step === 'launch'}
          onOpen={() => setStep('launch')}
          disabled={!allReady}
        >
          <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-4 grid gap-3">
            <Row label="Source" value={LANGUAGES_BY_CODE[cfg.sourceLanguage as LanguageCode].englishName} />
            <Row label="Targets" value={targetLangs.map((c) => LANGUAGES_BY_CODE[c].englishName).join(', ')} />
            <Row label="Cost cap" value={`$${cfg.costCapUSD.toFixed(0)}`} />
            <Row label="Join code" value={stored.joinCode} mono />
          </div>
          {error && (
            <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200 animate-fade-in">
              {error}
            </div>
          )}
          <Button variant="primary" size="lg" onClick={onGoLive} disabled={!allReady} className="w-full mt-5" icon={Radio}>
            Go live now
          </Button>
        </WizardStep>
      </ol>
    </main>
  );
}

// ============================================================================
// ON-AIR
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
  inputStream: MediaStream | null;
  outputStreams: Record<string, MediaStream>;
  serviceId: string;
  cmdOpen: boolean;
  setCmdOpen: (v: boolean) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  toastSuccess: (title: string, body?: string) => void;
}) {
  const {
    cfg, joinCode, listenerUrl, targetLangs, phase, conn, elapsedSec, cost,
    capReached, capWarning, listeners, captionsByLang, historyByLang,
    inputLevel, inputStream, outputStreams, serviceId, cmdOpen, setCmdOpen,
    onPause, onResume, onStop, toastSuccess,
  } = props;

  // ---------- Command palette items ----------
  const cmdItems: CommandItem[] = [
    {
      id: 'pause-resume', group: 'Service',
      title: phase === 'live' ? 'Pause translation' : 'Resume translation',
      hint: phase === 'live' ? 'Mic continues capturing' : 'Pick up where you left off',
      icon: phase === 'live' ? PauseIcon : Play,
      shortcut: ['space'],
      action: () => (phase === 'live' ? onPause() : onResume()),
    },
    {
      id: 'stop', group: 'Service',
      title: 'Stop the service',
      hint: 'Ends translation and saves recordings',
      icon: Square,
      shortcut: ['shift', '.'],
      action: onStop,
    },
    {
      id: 'copy-code', group: 'Share',
      title: 'Copy join code',
      hint: joinCode,
      icon: Share2,
      action: async () => {
        try { await navigator.clipboard.writeText(joinCode); toastSuccess('Copied join code', joinCode); } catch {/* noop */}
      },
    },
    {
      id: 'copy-link', group: 'Share',
      title: 'Copy listener link',
      hint: listenerUrl,
      icon: ExternalLink,
      action: async () => {
        try { await navigator.clipboard.writeText(listenerUrl); toastSuccess('Copied listener link'); } catch {/* noop */}
      },
    },
    {
      id: 'open-listener', group: 'Share',
      title: 'Open listener page',
      icon: Headphones,
      action: () => window.open(listenerUrl, '_blank', 'noreferrer'),
    },
    ...targetLangs.map((l) => ({
      id: `bcast-${l}`,
      group: 'Headset broadcast',
      title: `Open broadcast · ${LANGUAGES_BY_CODE[l].englishName}`,
      hint: `For wiring into FM/IR/transmitter`,
      icon: Radio,
      action: () => window.open(`/broadcast/${joinCode}/${l}`, '_blank', 'noreferrer'),
    })),
  ];

  // Spacebar pause/resume
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (phase === 'live') onPause();
        else if (phase === 'paused') onResume();
      } else if (e.shiftKey && e.key === '>') {
        e.preventDefault();
        onStop();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onPause, onResume, onStop]);

  return (
    <main className="min-h-dvh">
      {/* Sticky control bar */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-950/85 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-5 py-3 flex items-center gap-4">
          <Logo size={18} />
          <PhasePill
            tone={phase === 'live' ? 'live' : 'paused'}
            label={phase === 'live' ? 'ON AIR' : 'PAUSED'}
            pulse={phase === 'live'}
          />
          <span className="readout text-sm text-ink-300">{fmtElapsed(elapsedSec)}</span>
          <div className="flex-1 min-w-0 truncate text-sm text-ink-300">
            {cfg.title}
          </div>
          <div className="hidden md:block w-40">
            <Waveform stream={inputStream} active color="bg-emerald-400" bars={28} className="h-7" />
          </div>
          <button
            onClick={() => setCmdOpen(true)}
            className="hidden md:inline-flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-ink-300 hover:bg-white/[0.06] hover:border-white/[0.12] transition"
            aria-label="Open command palette"
          >
            <Command className="h-3 w-3" /> <span className="kbd">⌘K</span>
          </button>
          {phase === 'live' ? (
            <Button variant="warn" onClick={onPause} icon={PauseIcon}>Pause</Button>
          ) : (
            <Button variant="primary" onClick={onResume} icon={Play}>Resume</Button>
          )}
          <Button variant="danger" onClick={onStop} icon={Square}>Stop</Button>
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
      </header>

      <div className="mx-auto max-w-7xl px-5 py-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Captions canvas — source first then mixer-style channel strips */}
        <section className="grid gap-4">
          <SourceCaption
            cfg={cfg}
            current={captionsByLang[cfg.sourceLanguage] ?? ''}
            history={historyByLang[cfg.sourceLanguage] ?? []}
          />
          <div className="grid gap-3">
            {targetLangs.map((lang) => (
              <ChannelStrip
                key={lang}
                lang={lang}
                current={captionsByLang[lang] ?? ''}
                history={historyByLang[lang] ?? []}
                listeners={listeners.byLanguage[lang] ?? 0}
                stream={outputStreams[lang] ?? null}
                active={phase === 'live'}
              />
            ))}
          </div>
        </section>

        {/* Sidebar */}
        <aside className="grid gap-5 content-start">
          <Stat
            label="Cost"
            icon={DollarSign}
            value={<AnimatedNumber value={cost?.costUSD ?? 0} prefix="$" decimals={2} />}
            sub={cost ? `cap $${cfg.costCapUSD.toFixed(0)} · ${cost.burnPerMinuteUSD.toFixed(2)}/min burn` : 'estimating…'}
            progress={cost ? Math.round(cost.capFraction * 100) : 0}
            progressTone={
              cost && cost.capFraction > 0.9 ? 'danger'
              : cost && cost.capFraction > 0.6 ? 'warn'
              : 'good'
            }
          />
          <Stat
            label="Listeners"
            icon={Users}
            value={String(listeners.total)}
            sub="connected on phones"
          />
          <div className="card">
            <div className="flex items-center gap-2 mb-1.5">
              <Volume2 className="h-3.5 w-3.5 text-ink-500" />
              <Eyebrow>Input level</Eyebrow>
            </div>
            <LevelMeter rms={inputLevel.rms} peak={inputLevel.peak} active={phase === 'live'} compact />
            <div className="mt-3">
              <Waveform stream={inputStream} active={phase === 'live'} color="bg-accent-400" bars={48} className="h-9" />
            </div>
          </div>

          <div className="card relative overflow-hidden">
            <div className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-accent-700/15 blur-2xl pointer-events-none" aria-hidden />
            <Eyebrow className="mb-2 flex items-center gap-1.5 relative">
              <Share2 className="h-3 w-3 text-ink-500" /> Share
            </Eyebrow>
            <div className="flex items-center gap-2 relative">
              <div className="font-mono text-2xl tracking-[0.22em] text-ink-50">{joinCode}</div>
              <CopyButton value={joinCode} label="" compact />
            </div>
            <div className="rounded-lg bg-white p-2 inline-block mt-3 relative">
              <QRCodeSVG value={listenerUrl} size={148} />
            </div>
            <a href={listenerUrl} target="_blank" rel="noreferrer"
               className="btn btn-ghost mt-3 w-full text-xs relative">
              <ExternalLink className="h-3 w-3" /> Open listener page
            </a>
          </div>

          <div className="card">
            <Eyebrow className="mb-2 flex items-center gap-1.5">
              <Headphones className="h-3 w-3 text-ink-500" /> Headset broadcast
            </Eyebrow>
            <ul className="grid gap-1">
              {targetLangs.map((l) => (
                <li key={l} className="flex items-center justify-between gap-2 py-1 border-b border-ink-800/60 last:border-0">
                  <span className="text-xs text-ink-300 truncate">{LANGUAGES_BY_CODE[l].englishName}</span>
                  <a target="_blank" rel="noreferrer" href={`/broadcast/${joinCode}/${l}`}
                     className="text-[11px] text-accent-300 hover:underline inline-flex items-center gap-1">
                    open <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              ))}
            </ul>
            <Hint className="mt-2 !text-[10px]">
              Pin a page on a laptop wired into your FM/IR transmitter.
            </Hint>
          </div>

          <div className="card">
            <Eyebrow className="mb-2 flex items-center gap-1.5">
              <Download className="h-3 w-3 text-ink-500" /> Recordings
            </Eyebrow>
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
          </div>

          <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-3 text-[11px] text-ink-500 leading-relaxed">
            <div className="flex items-center gap-1.5 mb-1.5 text-ink-400">
              <Keyboard className="h-3 w-3" /> Shortcuts
            </div>
            <ul className="grid gap-1.5">
              <li className="flex justify-between"><span>Command palette</span><span className="kbd">⌘K</span></li>
              <li className="flex justify-between"><span>Pause / resume</span><span className="kbd">space</span></li>
              <li className="flex justify-between"><span>Stop</span><span className="flex gap-1"><span className="kbd">shift</span><span className="kbd">.</span></span></li>
            </ul>
          </div>
        </aside>
      </div>

      <CommandPalette items={cmdItems} open={cmdOpen} setOpen={setCmdOpen} />
    </main>
  );
}

function SourceCaption({
  cfg, current, history,
}: {
  cfg: ServiceConfig;
  current: string;
  history: string[];
}) {
  return (
    <div className="card-elev relative overflow-hidden">
      <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-accent-700/10 blur-3xl pointer-events-none" aria-hidden />
      <div className="flex items-center gap-2 relative">
        <span className="inline-flex items-center gap-1.5 chip">
          <Mic className="h-3 w-3 text-accent-300" />
          Source · {LANGUAGES_BY_CODE[cfg.sourceLanguage as LanguageCode].englishName}
        </span>
        {cfg.pastorName && <span className="text-xs text-ink-500">· {cfg.pastorName}</span>}
      </div>
      <div
        key={current || '__empty__'}
        className={cn(
          'mt-3 text-pretty leading-snug',
          current
            ? 'text-2xl md:text-3xl font-medium text-ink-50 caption-in'
            : 'text-base text-ink-700 italic',
        )}
      >
        {current || 'Waiting for the speaker…'}
      </div>
      {history.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-ink-500 max-h-24 overflow-hidden">
          {history.slice(-3, -1).map((h, i) => (
            <li key={i} className="leading-snug opacity-70">{h}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================================================================
// ENDED SUMMARY
// ============================================================================

function EndedSummary({
  cfg, joinCode, serviceId, targetLangs, durationSec, costUSD, peakListeners,
}: {
  cfg: ServiceConfig;
  joinCode: string;
  serviceId: string;
  targetLangs: LanguageCode[];
  durationSec: number;
  costUSD: number;
  peakListeners: number;
}) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10 md:py-14 animate-fade-in">
      <span className="chip mb-5">
        <Check className="h-3 w-3 text-emerald-400" /> Service ended
      </span>
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tightish">
        Nicely done.
      </h1>
      <p className="mt-2 text-ink-400">
        Here&apos;s a quick recap. Recording downloads stay live for the next
        five minutes.
      </p>

      <div className="mt-7 grid gap-3 sm:grid-cols-3">
        <Stat label="Duration" value={fmtElapsed(durationSec)} />
        <Stat label="Cost" value={`$${costUSD.toFixed(2)}`} sub={`cap $${cfg.costCapUSD}`} />
        <Stat label="Peak listeners" value={String(peakListeners)} />
      </div>

      <div className="card mt-5">
        <Eyebrow className="mb-3 flex items-center gap-1.5">
          <FileText className="h-3 w-3" /> Downloads
        </Eyebrow>
        <div className="grid gap-1 text-sm">
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

      <div className="mt-7 flex flex-wrap gap-3">
        <a href="/operator/new" className="btn btn-primary">
          <Radio className="h-4 w-4" /> Start another service
        </a>
        <a href="/" className="btn btn-ghost">Back to home</a>
      </div>

      <p className="mt-8 text-[11px] text-ink-500">
        Service code <span className="font-mono text-ink-300">{joinCode}</span>{' '}
        is retired once downloads expire.
      </p>
    </main>
  );
}

// ============================================================================
// Reusable bits
// ============================================================================

function ProgressRail({
  steps, active,
}: {
  steps: { key: Step; label: string; done: boolean }[];
  active: Step;
}) {
  const idxActive = steps.findIndex((s) => s.key === active);
  return (
    <ol className="flex items-center gap-2">
      {steps.map((s, i) => {
        const isActive = i === idxActive;
        return (
          <li key={s.key} className="flex items-center gap-2 flex-1 last:flex-none">
            <div className={cn(
              'flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] transition-colors',
              isActive ? 'bg-accent text-accent-fg' :
              s.done   ? 'bg-emerald-500/15 text-emerald-300' :
                         'bg-ink-900 text-ink-500',
            )}>
              {s.done ? <Check className="h-3 w-3" /> : <Circle className={cn('h-2 w-2', isActive ? 'fill-current' : '')} />}
              {s.label}
            </div>
            {i < steps.length - 1 && (
              <span className={cn(
                'h-px flex-1',
                steps[i + 1]?.done || i < idxActive ? 'bg-accent-700' : 'bg-ink-800',
              )} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function WizardStep({
  n, icon: Icon, title, tagline, done, open, disabled, onOpen, onContinue, children,
}: {
  n: number;
  icon: typeof Mic;
  title: string;
  tagline?: string;
  done: boolean;
  open: boolean;
  disabled?: boolean;
  onOpen?: () => void;
  onContinue?: () => void;
  children: React.ReactNode;
}) {
  return (
    <li
      className={cn(
        'card-flush transition-all duration-200 ease-snap',
        open ? 'border-accent-700/60 bg-ink-900/70' : 'hover:border-ink-700/80',
        disabled && 'opacity-60',
      )}
    >
      <button
        type="button"
        onClick={() => !disabled && onOpen?.()}
        disabled={disabled}
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
      >
        <span className={cn(
          'flex h-9 w-9 items-center justify-center rounded-xl ring-1 transition-colors',
          done   ? 'bg-emerald-500/15 ring-emerald-500/40 text-emerald-300' :
          open   ? 'bg-accent-900/40 ring-accent-700/60 text-accent-200' :
                   'bg-ink-800 ring-ink-700/50 text-ink-400',
        )}>
          {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">Step {n} · {title}</div>
          {tagline && <div className="text-[11px] text-ink-500 mt-0.5">{tagline}</div>}
        </div>
        {disabled && (
          <span className="text-[10px] text-ink-500">complete previous step</span>
        )}
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 animate-fade-in">
          {children}
          {onContinue && (
            <div className="mt-5 flex justify-end">
              <Button variant="primary" onClick={onContinue} icon={ArrowRight}>
                Continue
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function CaptionPanel({
  label, current, history, isSource, listeners, rtl,
}: {
  label: string;
  current: string;
  history: string[];
  isSource?: boolean;
  listeners?: number;
  rtl?: boolean;
}) {
  return (
    <div
      dir={rtl ? 'rtl' : 'ltr'}
      className={cn('card', isSource && 'border-accent-700/40 bg-accent-900/10')}
    >
      <div className="flex items-center justify-between mb-2">
        <Eyebrow>{label}</Eyebrow>
        {typeof listeners === 'number' && (
          <span className="text-[11px] text-ink-500 inline-flex items-center gap-1">
            <Users className="h-3 w-3" /> {listeners}
          </span>
        )}
      </div>
      <div className="text-lg md:text-xl leading-snug min-h-[2.6rem] text-pretty">
        {current ? (
          <span className="animate-fade-in">{current}</span>
        ) : (
          <span className="text-ink-700">
            <Music className="inline-block h-4 w-4 mr-1 align-[-2px]" />
            Listening…
          </span>
        )}
      </div>
      {history.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-ink-400 max-h-32 overflow-auto pr-1 scroll-soft">
          {history.slice().reverse().map((h, i) => (
            <li key={i} className="border-l-2 border-ink-800 pl-2 leading-snug">{h}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DownloadRow({
  label, wavHref, srtHref, vttHref,
}: { label: string; wavHref?: string; srtHref?: string; vttHref?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-ink-800/60 last:border-0 py-1.5">
      <span className="text-ink-300 truncate">{label}</span>
      <div className="flex items-center gap-2">
        {wavHref && <a className="text-accent-300 hover:underline" href={wavHref} target="_blank" rel="noreferrer">wav</a>}
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
      <div className={cn('relative overflow-hidden rounded-full bg-ink-800', compact ? 'h-3' : 'h-2')}>
        <div
          className={cn(
            'absolute inset-y-0 left-0 transition-[width] duration-75',
            pct > 90 ? 'bg-red-500' :
            pct > 70 ? 'bg-emerald-500' :
            pct > 30 ? 'bg-emerald-500/80' : 'bg-emerald-600/50',
          )}
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

function Hint({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('text-[11px] text-ink-500 leading-relaxed text-pretty', className)}>
      {children}
    </p>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] uppercase tracking-wider text-ink-500">{label}</span>
      <span className={cn('text-sm', mono && 'font-mono tracking-widest')}>{value}</span>
    </div>
  );
}

function fmtElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
