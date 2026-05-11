'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, Check, Info, X } from 'lucide-react';
import { cn } from '@/lib/cn';

type Tone = 'success' | 'info' | 'warn' | 'error';

interface Toast {
  id: number;
  tone: Tone;
  title: string;
  body?: string;
  durationMs?: number;
  exiting?: boolean;
}

interface ToastContextValue {
  show: (t: Omit<Toast, 'id'>) => number;
  dismiss: (id: number) => void;
  success: (title: string, body?: string) => number;
  info: (title: string, body?: string) => number;
  warn: (title: string, body?: string) => number;
  error: (title: string, body?: string) => number;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 200);
  }, []);

  const show = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev.slice(-4), { ...t, id }]);
      const ms = t.durationMs ?? 3600;
      setTimeout(() => dismiss(id), ms);
      return id;
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      dismiss,
      success: (title, body) => show({ tone: 'success', title, body }),
      info:    (title, body) => show({ tone: 'info',    title, body }),
      warn:    (title, body) => show({ tone: 'warn',    title, body, durationMs: 5000 }),
      error:   (title, body) => show({ tone: 'error',   title, body, durationMs: 6000 }),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div
      className="pointer-events-none fixed z-[200] top-3 right-3 left-3 sm:left-auto sm:w-[360px] flex flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} t={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ t, onDismiss }: { t: Toast; onDismiss: () => void }) {
  const [enter, setEnter] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEnter(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const Icon = t.tone === 'success' ? Check
    : t.tone === 'warn' ? AlertTriangle
    : t.tone === 'error' ? AlertTriangle
    : Info;

  const tint =
    t.tone === 'success' ? 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/30'
    : t.tone === 'warn'  ? 'text-amber-200 bg-amber-500/10 ring-amber-500/30'
    : t.tone === 'error' ? 'text-red-200  bg-red-500/10  ring-red-500/30'
    : 'text-sky-200 bg-sky-500/10 ring-sky-500/30';

  return (
    <div
      className={cn(
        'pointer-events-auto rounded-xl border border-white/[0.08] bg-ink-900/80 backdrop-blur-md p-3 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.7)]',
        'flex items-start gap-3 text-sm',
        enter && !t.exiting && 'animate-[toast-in_280ms_var(--ease-snap)_both]',
        t.exiting && 'animate-[toast-out_180ms_ease-out_forwards]',
      )}
      role="status"
    >
      <div className={cn('h-7 w-7 flex-shrink-0 rounded-full ring-1 grid place-items-center', tint)}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-ink-50 leading-tight">{t.title}</div>
        {t.body && <div className="text-[12px] text-ink-400 mt-0.5 leading-snug">{t.body}</div>}
      </div>
      <button
        onClick={onDismiss}
        className="rounded-md p-1 text-ink-500 hover:text-ink-100 hover:bg-white/[0.05] transition"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
