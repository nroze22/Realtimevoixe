'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  AlertTriangle, ArrowLeft, Clock, Headphones, Pause as PauseIcon, Play, RefreshCw,
  Type, Volume2,
} from 'lucide-react';
import {
  LANGUAGES_BY_CODE,
  REALTIME_TARGET_LANGUAGES,
  type LanguageCode,
} from '@rtv/shared';
import { fetchListenerToken } from '@/lib/orchestrator';
import { ListenerSession, type ListenerCaption } from '@/lib/listener';
import { Waveform } from '@/components/waveform';
import { MissedDrawer } from '@/components/missed-drawer';
import { annotateScripture } from '@/lib/bible';
import { cn } from '@/lib/cn';

type Phase = 'choose-language' | 'connecting' | 'listening' | 'error' | 'ended';

const FLAG: Record<string, string> = {
  en: '🇺🇸', es: '🇪🇸', pt: '🇧🇷', fr: '🇫🇷', de: '🇩🇪', it: '🇮🇹', nl: '🇳🇱', pl: '🇵🇱',
  ru: '🇷🇺', uk: '🇺🇦', tr: '🇹🇷', ar: '🇸🇦', zh: '🇨🇳', ja: '🇯🇵', ko: '🇰🇷',
};

export default function ListenerPage() {
  const params = useParams<{ serviceId: string }>();
  const serviceId = params.serviceId;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<ListenerSession | null>(null);
  const lastCaptionsRef = useRef<ListenerCaption[]>([]);
  const trackStreamRef = useRef<MediaStream | null>(null);

  const [phase, setPhase] = useState<Phase>('choose-language');
  const [language, setLanguage] = useState<LanguageCode | null>(null);
  const [available, setAvailable] = useState<LanguageCode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [needsUnmute, setNeedsUnmute] = useState(true);
  const [quality, setQuality] = useState<'excellent' | 'good' | 'poor' | 'lost' | 'unknown'>('unknown');
  const [captions, setCaptions] = useState<ListenerCaption[]>([]);
  const [showInstall, setShowInstall] = useState(false);
  const [installEvent, setInstallEvent] = useState<any>(null);
  const [volume, setVolume] = useState(1);
  const [bigText, setBigText] = useState(false);
  const [captionStream, setCaptionStream] = useState<MediaStream | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [missedOpen, setMissedOpen] = useState(false);
  const [headphonesOk, setHeadphonesOk] = useState<boolean | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const startMsRef = useRef<number>(0);

  const browserLang = useMemo<LanguageCode | null>(() => {
    if (typeof navigator === 'undefined') return null;
    const code = (navigator.language || '').slice(0, 2) as LanguageCode;
    return LANGUAGES_BY_CODE[code]?.code ?? null;
  }, []);

  useEffect(() => {
    function onPrompt(e: any) {
      e.preventDefault();
      setInstallEvent(e);
      setShowInstall(true);
    }
    window.addEventListener('beforeinstallprompt', onPrompt as EventListener);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt as EventListener);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(`rtv:lang:${serviceId}`);
    if (saved && REALTIME_TARGET_LANGUAGES.some((l) => l.code === saved)) {
      setLanguage(saved as LanguageCode);
    }
    const bt = localStorage.getItem('rtv:bigtext') === '1';
    setBigText(bt);
  }, [serviceId]);

  const join = useCallback(async (lang: LanguageCode) => {
    setLanguage(lang);
    setPhase('connecting');
    setError(null);
    setCaptions([]);
    lastCaptionsRef.current = [];
    setCaptionStream(null);
    setReconnecting(false);
    startMsRef.current = Date.now();
    localStorage.setItem(`rtv:lang:${serviceId}`, lang);

    try {
      const tok = await fetchListenerToken(serviceId, lang);
      const session = new ListenerSession({
        onConnected: (langs) => {
          setAvailable(langs);
          setPhase('listening');
          if (audioRef.current && langs.includes(lang)) {
            session.attachTo(lang, audioRef.current);
            tryPlay();
          }
        },
        onLanguagesChanged: setAvailable,
        onAudioTrack: (l, track) => {
          if (l === lang && audioRef.current) {
            session.attachTo(l, audioRef.current);
            tryPlay();
            try {
              const ms = new MediaStream([track.mediaStreamTrack]);
              trackStreamRef.current = ms;
              setCaptionStream(ms);
            } catch {/* noop */}
          }
        },
        onCaption: (c) => {
          if (c.lang !== lang) return;
          lastCaptionsRef.current = [...lastCaptionsRef.current.slice(-30), c];
          setCaptions(lastCaptionsRef.current);
        },
        onConnectionQuality: (q) => {
          setQuality(q);
          setReconnecting(q === 'lost');
        },
        onDisconnected: () => setPhase('ended'),
        onError: (m) => { setError(m); setPhase('error'); },
      });
      sessionRef.current = session;
      await session.connect(tok.url, tok.token);

      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: `Live translation · ${LANGUAGES_BY_CODE[lang].englishName}`,
          artist: 'Realtime Voice',
        });
        navigator.mediaSession.setActionHandler('play', () => audioRef.current?.play());
        navigator.mediaSession.setActionHandler('pause', () => audioRef.current?.pause());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [serviceId]);

  function tryPlay() {
    if (!audioRef.current) return;
    audioRef.current.muted = false;
    audioRef.current
      .play()
      .then(() => { setNeedsUnmute(false); setIsPlaying(true); })
      .catch(() => setNeedsUnmute(true));
  }

  // Track playing state for UI
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay  = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
    };
  });

  // Heuristic headphone-output detection. The Audio Output Devices API isn't
  // available on iOS Safari, so we fall back to a best-effort check: if we
  // can enumerate any output device whose label hints at "headphones",
  // "airpods", or "earbuds", assume they're plugged in. Otherwise show a
  // friendly nudge.
  useEffect(() => {
    if (phase !== 'listening' || needsUnmute) return;
    let cancelled = false;
    async function probe() {
      try {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
          setHeadphonesOk(null);
          return;
        }
        const devs = await navigator.mediaDevices.enumerateDevices();
        const outputs = devs.filter((d) => d.kind === 'audiooutput');
        const headphoneLike = outputs.some((d) => {
          const l = (d.label || '').toLowerCase();
          return /headphone|earbud|airpod|earphone|bluetooth|usb audio|line|external/.test(l);
        });
        if (!cancelled) setHeadphonesOk(headphoneLike || outputs.length > 1);
      } catch {
        if (!cancelled) setHeadphonesOk(null);
      }
    }
    void probe();
    return () => { cancelled = true; };
  }, [phase, needsUnmute]);

  useEffect(() => () => {
    void sessionRef.current?.disconnect();
  }, []);

  function toggleBigText() {
    setBigText((v) => {
      const next = !v;
      localStorage.setItem('rtv:bigtext', next ? '1' : '0');
      return next;
    });
  }

  // -------- Choose language --------
  if (phase === 'choose-language') {
    return (
      <main className="min-h-dvh px-5 pt-10 pb-12 mx-auto max-w-md animate-fade-in">
        <header className="mb-7">
          <span className="chip mb-4">
            <Headphones className="h-3 w-3 text-accent-300" /> Listener
          </span>
          <h1 className="text-3xl md:text-[2rem] font-semibold tracking-tightish leading-tight">
            Pick your language
          </h1>
          <p className="mt-2 text-sm text-ink-400 text-pretty">
            Plug in your earbuds and choose how you&apos;d like to hear the message.
          </p>
        </header>

        <div className="grid gap-2.5">
          {REALTIME_TARGET_LANGUAGES.map((l) => {
            const isLast = language === l.code;
            const isBrowser = browserLang === l.code;
            const highlight = isLast || isBrowser;
            return (
              <button
                key={l.code}
                onClick={() => join(l.code)}
                className={cn(
                  'group relative w-full text-left rounded-2xl border bg-ink-900/55 backdrop-blur-sm',
                  'px-4 py-4 transition-all duration-150 ease-snap',
                  'hover:bg-ink-900 hover:border-accent-700/60 active:scale-[0.99]',
                  highlight ? 'border-accent-700/60' : 'border-ink-800',
                )}
              >
                <div className="flex items-center gap-3.5">
                  <span className="text-2xl leading-none">{FLAG[l.code] ?? '🗣'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-lg font-medium tracking-tightish truncate">{l.nativeName}</div>
                    <div className="text-xs text-ink-500">{l.englishName}</div>
                  </div>
                  {highlight && (
                    <span className="text-[10px] uppercase tracking-[0.16em] text-accent-300 font-medium">
                      {isLast ? 'last' : 'suggested'}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {showInstall && (
          <button
            onClick={async () => {
              if (!installEvent) return;
              installEvent.prompt();
              const choice = await installEvent.userChoice;
              if (choice.outcome === 'accepted') setShowInstall(false);
            }}
            className="btn btn-ghost mt-7 w-full"
          >
            Add to home screen
          </button>
        )}

        <p className="mt-8 text-center text-[11px] text-ink-600">
          Service code <span className="font-mono text-ink-400">{serviceId}</span>
        </p>
      </main>
    );
  }

  const lang = language!;
  const langMeta = LANGUAGES_BY_CODE[lang];

  // -------- Listening / connecting / error / ended --------
  return (
    <main
      dir={langMeta.rtl ? 'rtl' : 'ltr'}
      className="min-h-dvh flex flex-col"
    >
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      {/* Top bar */}
      <header className="px-5 pt-5 pb-3 flex items-center justify-between gap-3">
        <button
          onClick={() => {
            void sessionRef.current?.disconnect();
            setPhase('choose-language');
            setCaptions([]);
            lastCaptionsRef.current = [];
          }}
          className="inline-flex items-center gap-1.5 text-xs text-ink-400 hover:text-ink-200 transition"
          aria-label="Change language"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Change language
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMissedOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 text-[11px] text-ink-300 hover:bg-white/[0.06] hover:border-white/[0.12] transition"
            disabled={captions.length === 0}
            aria-label="What I missed"
          >
            <Clock className="h-3 w-3" /> Recap
          </button>
          <ConnectionBars quality={quality} />
        </div>
      </header>

      {/* Headphone hint banner */}
      {headphonesOk === false && phase === 'listening' && !needsUnmute && (
        <div className="mx-5 mt-1 mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 flex items-center gap-2 text-[12px] text-amber-100 animate-fade-in">
          <Headphones className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="flex-1 leading-snug">Plug in earbuds so you don&apos;t interrupt the service around you.</span>
          <button
            onClick={() => setHeadphonesOk(true)}
            className="text-amber-200/80 hover:text-amber-100 text-[11px] px-1.5 py-0.5"
            aria-label="Dismiss"
          >
            Got it
          </button>
        </div>
      )}

      {/* Hero */}
      <section className="px-5 mt-1">
        <div className="flex items-center gap-3">
          <span className="text-3xl leading-none" aria-hidden>{FLAG[lang] ?? '🗣'}</span>
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl font-semibold tracking-tightish truncate">{langMeta.nativeName}</h1>
            <p className="text-xs text-ink-500">{langMeta.englishName}</p>
          </div>
          <button
            onClick={toggleBigText}
            className={cn(
              'h-9 w-9 rounded-full border border-ink-800 flex items-center justify-center transition',
              bigText ? 'bg-accent text-accent-fg border-accent-500' : 'bg-ink-900/60 text-ink-300 hover:bg-ink-800',
            )}
            aria-label="Toggle big text"
            aria-pressed={bigText}
          >
            <Type className="h-4 w-4" />
          </button>
        </div>

        {/* Speaker activity */}
        <div className="mt-4 flex items-center gap-3">
          <span className={cn(
            'h-2 w-2 rounded-full',
            phase === 'listening' && isPlaying ? 'bg-emerald-400 animate-pulse' :
            phase === 'connecting' ? 'bg-sky-400 animate-pulse' :
            phase === 'ended' ? 'bg-ink-500' :
            'bg-ink-600'
          )} />
          <div className="text-[11px] uppercase tracking-[0.16em] text-ink-400">
            {phase === 'listening' && (isPlaying ? 'live' : (needsUnmute ? 'tap to start' : 'paused'))}
            {phase === 'connecting' && 'connecting'}
            {phase === 'ended' && 'service ended'}
            {phase === 'error' && 'error'}
          </div>
          <div className="flex-1">
            <Waveform
              stream={captionStream}
              active={phase === 'listening' && !needsUnmute}
              bars={28}
              color="bg-accent-400"
              className="h-6"
            />
          </div>
        </div>
      </section>

      {/* Captions canvas */}
      <section
        className="flex-1 mt-7 px-5 overflow-hidden"
        aria-live="polite"
        aria-label="Live translation captions"
      >
        <CaptionStack captions={captions} big={bigText} phase={phase} />
      </section>

      {/* Bottom control deck */}
      <footer className="px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 border-t border-ink-800/60 bg-ink-950/80 backdrop-blur">
        {needsUnmute && phase === 'listening' && (
          <button
            onClick={tryPlay}
            className="btn btn-primary btn-lg w-full mb-3"
          >
            <Play className="h-5 w-5" /> Tap to start listening
          </button>
        )}

        {!needsUnmute && phase === 'listening' && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (!audioRef.current) return;
                if (audioRef.current.paused) audioRef.current.play().catch(() => {/* noop */});
                else audioRef.current.pause();
              }}
              className={cn(
                'h-12 w-12 rounded-full bg-accent text-accent-fg flex items-center justify-center shadow-glow',
                'transition-transform active:scale-95',
              )}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <PauseIcon className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-0.5" />}
            </button>
            <div className="flex-1">
              <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-ink-500 mb-1">
                <Volume2 className="h-3 w-3" /> Volume
              </label>
              <input
                type="range"
                min={0} max={1} step={0.01}
                value={volume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolume(v);
                  if (audioRef.current) audioRef.current.volume = v;
                }}
                className="w-full accent-accent-500"
                aria-label="Volume"
              />
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200 mt-3">
            {error}
          </div>
        )}

        {phase === 'ended' && (
          <p className="text-sm text-ink-300 text-center mt-3">
            The service has ended. Thanks for joining.
          </p>
        )}

        <p className="mt-3 text-center text-[10px] text-ink-600">
          Lock your phone — translation keeps playing in your earbuds.
        </p>
      </footer>

      <MissedDrawer
        open={missedOpen}
        onClose={() => setMissedOpen(false)}
        captions={captions}
        startMs={startMsRef.current}
      />

      {reconnecting && (
        <div className="absolute inset-x-0 top-0 z-50 m-3 rounded-xl border border-white/[0.08] bg-ink-900/90 backdrop-blur-md px-4 py-3 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.7)] flex items-center gap-3 animate-fade-in">
          <RefreshCw className="h-4 w-4 text-amber-300 animate-spin" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-ink-50">Reconnecting…</div>
            <div className="text-[11px] text-ink-400 leading-snug">
              Network dropped briefly. We&apos;ll catch you up.
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ============================================================================

function CaptionStack({
  captions, big, phase,
}: {
  captions: ListenerCaption[];
  big: boolean;
  phase: Phase;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [captions.length]);

  if (captions.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-3 animate-fade-in">
        <div className="relative h-14 w-14">
          <div className="absolute inset-0 rounded-full bg-accent-900/30 animate-pulse-ring" />
          <div className="absolute inset-1 rounded-full bg-ink-900/80 ring-1 ring-white/[0.06] flex items-center justify-center">
            <Headphones className="h-5 w-5 text-accent-300" />
          </div>
        </div>
        <p className="text-ink-400 text-sm max-w-xs text-pretty mt-2">
          {phase === 'connecting'
            ? 'Connecting to the service…'
            : 'Captions will appear here moments after the speaker begins.'}
        </p>
        <p className="text-[11px] text-ink-600 max-w-xs">
          Plug in your earbuds for the best experience.
        </p>
      </div>
    );
  }

  const last = captions[captions.length - 1]!;
  const recent = captions.slice(0, -1).slice(-6);

  return (
    <div ref={ref} className="h-full overflow-y-auto scroll-smooth scroll-soft pr-1">
      <ul className="space-y-3 pb-6">
        {recent.map((c, i) => (
          <li key={`${c.tMs}-${i}`} className={cn(
            'text-ink-400 leading-snug text-pretty transition-opacity duration-300',
            big ? 'text-lg' : 'text-base',
          )}>
            <ScriptureText text={c.text} />
          </li>
        ))}
        <li
          key={`${last.tMs}-last`}
          className={cn(
            'font-medium text-ink-50 leading-snug text-balance caption-in',
            big ? 'text-3xl' : 'text-2xl',
          )}
        >
          <ScriptureText text={last.text} />
        </li>
      </ul>
    </div>
  );
}

function ScriptureText({ text }: { text: string }) {
  const parts = annotateScripture(text);
  return (
    <>
      {parts.map((p, i) =>
        p.type === 'text' ? (
          <span key={i}>{p.text}</span>
        ) : (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noreferrer"
            className="text-accent-300 underline decoration-accent-700/60 underline-offset-2 hover:decoration-accent-400 transition-colors"
          >
            {p.text}
          </a>
        ),
      )}
    </>
  );
}

function ConnectionBars({ quality }: { quality: 'excellent' | 'good' | 'poor' | 'lost' | 'unknown' }) {
  const filled =
    quality === 'excellent' ? 3
    : quality === 'good' ? 2
    : quality === 'poor' ? 1
    : 0;
  const color =
    quality === 'lost' ? 'bg-red-500'
    : quality === 'poor' ? 'bg-amber-400'
    : 'bg-emerald-400';
  return (
    <div className="flex items-end gap-0.5" aria-label={`Connection ${quality}`}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn('block w-1 rounded-sm', i <= filled ? color : 'bg-ink-700')}
          style={{ height: `${4 + i * 3}px` }}
        />
      ))}
    </div>
  );
}
