'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { LANGUAGES_BY_CODE, LANGUAGES, type LanguageCode } from '@rtv/shared';
import { fetchListenerToken } from '@/lib/orchestrator';
import { ListenerSession } from '@/lib/listener';

type Phase = 'choose-language' | 'connecting' | 'listening' | 'error' | 'ended';

export default function ListenerPage() {
  const params = useParams<{ serviceId: string }>();
  const serviceId = params.serviceId;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<ListenerSession | null>(null);

  const [phase, setPhase] = useState<Phase>('choose-language');
  const [language, setLanguage] = useState<LanguageCode | null>(null);
  const [available, setAvailable] = useState<LanguageCode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);

  const browserLang = useMemo<LanguageCode | null>(() => {
    if (typeof navigator === 'undefined') return null;
    const code = (navigator.language || '').slice(0, 2) as LanguageCode;
    return LANGUAGES_BY_CODE[code]?.code ?? null;
  }, []);

  const join = useCallback(async (lang: LanguageCode) => {
    setLanguage(lang);
    setPhase('connecting');
    setError(null);

    try {
      const tok = await fetchListenerToken(serviceId, lang);
      const session = new ListenerSession({
        onConnected: (langs) => {
          setAvailable(langs);
          setPhase('listening');
          // Try to attach right away if our language is already published.
          if (audioRef.current && langs.includes(lang)) {
            session.attachTo(lang, audioRef.current);
            audioRef.current.muted = false;
            audioRef.current.play().catch(() => setMuted(true));
            setMuted(false);
          }
        },
        onLanguagesChanged: (langs) => {
          setAvailable(langs);
          if (audioRef.current && langs.includes(lang)) {
            session.attachTo(lang, audioRef.current);
            audioRef.current.play().catch(() => setMuted(true));
          }
        },
        onAudioTrack: (l, _track) => {
          if (l === lang && audioRef.current) {
            session.attachTo(l, audioRef.current);
            audioRef.current.play().catch(() => setMuted(true));
          }
        },
        onDisconnected: () => setPhase('ended'),
        onError: (m) => { setError(m); setPhase('error'); },
      });
      sessionRef.current = session;
      await session.connect(tok.url, tok.token);

      // Media Session API: lock-screen controls for iOS/Android.
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

  useEffect(() => () => {
    void sessionRef.current?.disconnect();
  }, []);

  if (phase === 'choose-language') {
    return (
      <main className="mx-auto max-w-md px-6 py-12">
        <p className="text-xs uppercase tracking-[0.2em] text-ink-500 mb-2">Service</p>
        <h1 className="text-2xl font-semibold mb-1">{serviceId}</h1>
        <p className="text-sm text-ink-400 mb-8">
          Pick the language you&apos;d like to listen in. Your phone will play the translated audio
          through your earbuds.
        </p>

        <div className="grid gap-2">
          {LANGUAGES.filter((l) => l.realtimeTarget).map((l) => (
            <button
              key={l.code}
              onClick={() => join(l.code)}
              className={`card text-left hover:border-accent transition flex items-baseline justify-between ${
                browserLang === l.code ? 'border-accent/50' : ''
              }`}
            >
              <div>
                <div className="text-base font-medium">{l.nativeName}</div>
                <div className="text-xs text-ink-500">{l.englishName}</div>
              </div>
              {browserLang === l.code && <span className="text-xs text-accent">your language</span>}
            </button>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.2em] text-ink-500 mb-1">
          Listening · {language && LANGUAGES_BY_CODE[language].englishName}
        </p>
        <h1 className="text-2xl font-semibold">{serviceId}</h1>
      </header>

      <div className="card">
        <audio ref={audioRef} autoPlay playsInline className="hidden" />
        <div className="flex items-center gap-3">
          <PhaseDot phase={phase} />
          <div className="text-sm">
            {phase === 'connecting' && 'Connecting…'}
            {phase === 'listening' && (muted ? 'Tap unmute to start' : 'Live')}
            {phase === 'ended' && 'The service has ended.'}
            {phase === 'error' && (error ?? 'Error')}
          </div>
        </div>

        {muted && phase === 'listening' && (
          <button
            className="btn btn-primary mt-4 w-full"
            onClick={() => {
              if (!audioRef.current) return;
              audioRef.current.muted = false;
              audioRef.current.play().then(() => setMuted(false)).catch(() => {/* noop */});
            }}
          >
            Tap to unmute
          </button>
        )}

        {(
          <button
            className="btn btn-ghost mt-4 w-full"
            onClick={() => {
              void sessionRef.current?.disconnect();
              setPhase('choose-language');
              setLanguage(null);
              setAvailable([]);
              setError(null);
            }}
          >
            Change language
          </button>
        )}

        {available.length > 0 && (
          <div className="mt-6 text-xs text-ink-500">
            Available languages: {available.map((c) => LANGUAGES_BY_CODE[c]?.nativeName ?? c).join(' · ')}
          </div>
        )}
      </div>

      <p className="mt-6 text-xs text-ink-500">
        Tip: lock your phone — translation keeps playing in your earbuds.
      </p>
    </main>
  );
}

function PhaseDot({ phase }: { phase: Phase }) {
  const cls =
    phase === 'listening' ? 'bg-emerald-400 animate-pulse'
      : phase === 'connecting' ? 'bg-sky-400 animate-pulse'
      : phase === 'ended' ? 'bg-ink-500'
      : phase === 'error' ? 'bg-red-400'
      : 'bg-ink-600';
  return <span className={`h-2.5 w-2.5 rounded-full ${cls}`} />;
}
