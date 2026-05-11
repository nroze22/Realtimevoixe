'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  LANGUAGES_BY_CODE,
  REALTIME_TARGET_LANGUAGES,
  type LanguageCode,
} from '@rtv/shared';
import { fetchListenerToken } from '@/lib/orchestrator';
import { ListenerSession, type ListenerCaption } from '@/lib/listener';

type Phase = 'choose-language' | 'connecting' | 'listening' | 'error' | 'ended';

const FLAG_BY_CODE: Record<string, string> = {
  en: '🇺🇸', es: '🇪🇸', pt: '🇧🇷', fr: '🇫🇷', de: '🇩🇪', it: '🇮🇹', nl: '🇳🇱', pl: '🇵🇱',
  ru: '🇷🇺', uk: '🇺🇦', tr: '🇹🇷', ar: '🇸🇦', zh: '🇨🇳', ja: '🇯🇵', ko: '🇰🇷',
};

export default function ListenerPage() {
  const params = useParams<{ serviceId: string }>();
  const serviceId = params.serviceId;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<ListenerSession | null>(null);
  const lastCaptionsRef = useRef<ListenerCaption[]>([]);

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

  const browserLang = useMemo<LanguageCode | null>(() => {
    if (typeof navigator === 'undefined') return null;
    const code = (navigator.language || '').slice(0, 2) as LanguageCode;
    return LANGUAGES_BY_CODE[code]?.code ?? null;
  }, []);

  // PWA install prompt
  useEffect(() => {
    function onPrompt(e: any) {
      e.preventDefault();
      setInstallEvent(e);
      setShowInstall(true);
    }
    window.addEventListener('beforeinstallprompt', onPrompt as EventListener);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt as EventListener);
  }, []);

  // Persist last-used language
  useEffect(() => {
    const saved = localStorage.getItem(`rtv:lang:${serviceId}`);
    if (saved && REALTIME_TARGET_LANGUAGES.some((l) => l.code === saved)) {
      setLanguage(saved as LanguageCode);
    }
  }, [serviceId]);

  const join = useCallback(async (lang: LanguageCode) => {
    setLanguage(lang);
    setPhase('connecting');
    setError(null);
    setCaptions([]);
    lastCaptionsRef.current = [];
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
        onAudioTrack: (l) => {
          if (l === lang && audioRef.current) {
            session.attachTo(l, audioRef.current);
            tryPlay();
          }
        },
        onCaption: (c) => {
          // Only show captions for the language we're listening to.
          if (c.lang !== lang) return;
          lastCaptionsRef.current = [...lastCaptionsRef.current.slice(-30), c];
          setCaptions(lastCaptionsRef.current);
        },
        onConnectionQuality: setQuality,
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
      .then(() => setNeedsUnmute(false))
      .catch(() => setNeedsUnmute(true));
  }

  useEffect(() => () => {
    void sessionRef.current?.disconnect();
  }, []);

  // ---------- Choose language screen ----------
  if (phase === 'choose-language') {
    return (
      <main className="min-h-dvh bg-gradient-to-b from-ink-950 via-ink-950 to-ink-900 px-5 pt-10 pb-12 mx-auto max-w-md">
        <header className="mb-7">
          <p className="text-[11px] uppercase tracking-[0.22em] text-ink-500 mb-2">Service</p>
          <h1 className="text-3xl font-semibold tracking-tight">Pick your language</h1>
          <p className="mt-2 text-sm text-ink-400">
            Plug in your earbuds and choose how you&apos;d like to hear the message.
          </p>
        </header>

        <div className="grid gap-2.5">
          {REALTIME_TARGET_LANGUAGES.map((l) => {
            const isLast = language === l.code;
            const isBrowser = browserLang === l.code;
            return (
              <button
                key={l.code}
                onClick={() => join(l.code)}
                className={`relative rounded-2xl border bg-ink-900/70 hover:bg-ink-900 active:scale-[0.99]
                            border-ink-800 hover:border-accent/60 transition px-4 py-4 text-left
                            ${isLast || isBrowser ? 'border-accent/70 bg-ink-900' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl leading-none">{FLAG_BY_CODE[l.code] ?? '🗣'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-lg font-medium truncate">{l.nativeName}</div>
                    <div className="text-xs text-ink-500">{l.englishName}</div>
                  </div>
                  {(isLast || isBrowser) && (
                    <span className="text-[10px] uppercase tracking-wider text-accent font-medium">
                      {isLast ? 'last used' : 'suggested'}
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
            className="btn btn-ghost mt-8 w-full"
          >
            Add Realtime Voice to your home screen
          </button>
        )}

        <p className="mt-8 text-center text-[11px] text-ink-600">
          Service code: <span className="font-mono text-ink-400">{serviceId}</span>
        </p>
      </main>
    );
  }

  const lang = language!;
  const langMeta = LANGUAGES_BY_CODE[lang];

  // ---------- Listening / connecting / error / ended ----------
  return (
    <main
      dir={langMeta.rtl ? 'rtl' : 'ltr'}
      className="min-h-dvh flex flex-col bg-gradient-to-b from-ink-950 via-ink-950 to-ink-900"
    >
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      {/* Top status bar */}
      <header className="flex items-center justify-between px-5 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <PhaseDot phase={phase} />
          <span className="text-xs uppercase tracking-wider text-ink-400">
            {phase === 'listening' && (needsUnmute ? 'paused' : 'live')}
            {phase === 'connecting' && 'connecting'}
            {phase === 'ended' && 'service ended'}
            {phase === 'error' && 'error'}
          </span>
        </div>
        <ConnectionBars quality={quality} />
      </header>

      {/* Hero */}
      <section className="px-5 mt-2">
        <p className="text-[11px] uppercase tracking-[0.2em] text-ink-500 mb-1">listening in</p>
        <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
          <span>{FLAG_BY_CODE[lang] ?? '🗣'}</span>
          <span>{langMeta.nativeName}</span>
        </h1>
        <p className="text-sm text-ink-400">{langMeta.englishName}</p>
      </section>

      {/* Caption canvas */}
      <section
        className="flex-1 mt-6 px-5 overflow-hidden"
        aria-live="polite"
        aria-label="Live translation captions"
      >
        <CaptionStack captions={captions} />
      </section>

      {/* Bottom control deck */}
      <footer className="px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 border-t border-ink-800/60 bg-ink-950/70 backdrop-blur">
        {needsUnmute && phase === 'listening' && (
          <button
            onClick={tryPlay}
            className="btn btn-primary w-full h-14 text-base mb-3 shadow-lg shadow-accent/20"
          >
            Tap to start listening
          </button>
        )}

        {!needsUnmute && phase === 'listening' && (
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={() => {
                if (!audioRef.current) return;
                if (audioRef.current.paused) audioRef.current.play().catch(() => {/* noop */});
                else audioRef.current.pause();
              }}
              className="h-12 w-12 rounded-full bg-accent text-accent-fg flex items-center justify-center shadow-lg shadow-accent/30"
              aria-label="Toggle play"
            >
              <PauseGlyph />
            </button>
            <div className="flex-1">
              <label className="text-[10px] uppercase tracking-wider text-ink-500">volume</label>
              <input
                type="range"
                min={0} max={1} step={0.01}
                value={volume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolume(v);
                  if (audioRef.current) audioRef.current.volume = v;
                }}
                className="w-full accent-accent"
              />
            </div>
          </div>
        )}

        {phase === 'error' && (
          <p className="text-sm text-red-300 mb-3">{error}</p>
        )}

        {phase === 'ended' && (
          <p className="text-sm text-ink-300 mb-3 text-center">
            The service has ended. Thanks for joining.
          </p>
        )}

        <button
          onClick={() => {
            void sessionRef.current?.disconnect();
            setPhase('choose-language');
            setCaptions([]);
            lastCaptionsRef.current = [];
          }}
          className="btn btn-ghost w-full"
        >
          Change language
        </button>

        <p className="mt-3 text-center text-[10px] text-ink-600">
          Lock your phone — translation keeps playing in your earbuds.
        </p>
      </footer>
    </main>
  );
}

// ============================================================================

function CaptionStack({ captions }: { captions: ListenerCaption[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [captions.length]);

  if (captions.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-center px-4">
        <p className="text-ink-600 text-sm max-w-xs">
          Captions will appear here a moment after the speaker begins.
        </p>
      </div>
    );
  }

  // Show most recent line large, prior context smaller and faded.
  const last = captions[captions.length - 1]!;
  const recent = captions.slice(0, -1).slice(-6);

  return (
    <div ref={ref} className="h-full overflow-y-auto scroll-smooth pr-1">
      <ul className="space-y-3 pb-4">
        {recent.map((c, i) => (
          <li key={`${c.tMs}-${i}`} className="text-base text-ink-400 leading-snug">
            {c.text}
          </li>
        ))}
        <li className="text-2xl font-medium text-ink-50 leading-snug">{last.text}</li>
      </ul>
    </div>
  );
}

function PhaseDot({ phase }: { phase: Phase }) {
  const cls =
    phase === 'listening' ? 'bg-emerald-400'
      : phase === 'connecting' ? 'bg-sky-400 animate-pulse'
      : phase === 'ended' ? 'bg-ink-500'
      : phase === 'error' ? 'bg-red-400'
      : 'bg-ink-600';
  return <span className={`h-2.5 w-2.5 rounded-full ${cls}`} />;
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
          className={`block w-1 rounded-sm ${i <= filled ? color : 'bg-ink-700'}`}
          style={{ height: `${4 + i * 3}px` }}
        />
      ))}
    </div>
  );
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
