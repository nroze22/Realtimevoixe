'use client';

import { useCallback, useState, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { Check, Copy, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

// ============================================================================
// Button
// ============================================================================

type Variant = 'primary' | 'ghost' | 'danger' | 'warn';
type Size = 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
}

export function Button({
  variant = 'ghost',
  size = 'md',
  icon: Icon,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={cn(
        'btn',
        size === 'lg' && 'btn-lg',
        variant === 'primary' && 'btn-primary',
        variant === 'ghost' && 'btn-ghost',
        variant === 'danger' && 'btn-danger',
        variant === 'warn' && 'btn-warn',
        className,
      )}
    >
      {Icon && <Icon className={size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden />}
      {children}
    </button>
  );
}

// ============================================================================
// Section header
// ============================================================================

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('eyebrow', className)}>{children}</p>;
}

// ============================================================================
// Stat card
// ============================================================================

interface StatProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** Progress percent 0..100. Renders a thin bar. */
  progress?: number;
  progressTone?: 'good' | 'warn' | 'danger' | 'accent';
  icon?: LucideIcon;
}

export function Stat({ label, value, sub, progress, progressTone = 'accent', icon: Icon }: StatProps) {
  const toneClass =
    progressTone === 'good'   ? 'bg-emerald-500'
    : progressTone === 'warn' ? 'bg-amber-400'
    : progressTone === 'danger' ? 'bg-red-500'
    : 'bg-accent-500';
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 text-ink-500" aria-hidden />}
        <Eyebrow>{label}</Eyebrow>
      </div>
      <div className="readout text-3xl">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-ink-500">{sub}</div>}
      {typeof progress === 'number' && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-800">
          <div
            className={cn('h-full transition-[width] duration-300 ease-snap', toneClass)}
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Copy button
// ============================================================================

export function CopyButton({
  value, label, className, compact,
}: { value: string; label?: string; className?: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {/* noop */}
  }, [value]);
  return (
    <button
      onClick={onCopy}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-ink-800 bg-ink-900/60 text-ink-300',
        'hover:text-ink-100 hover:border-ink-700 transition-colors',
        compact ? 'px-1.5 py-1 text-[10px]' : 'px-2.5 py-1 text-xs',
        className,
      )}
      aria-label={label ? `Copy ${label}` : 'Copy'}
      type="button"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      <span>{copied ? 'Copied' : label ?? 'Copy'}</span>
    </button>
  );
}

// ============================================================================
// Phase pill — used in headers
// ============================================================================

export function PhasePill({
  tone, label, pulse,
}: {
  tone: 'live' | 'paused' | 'ready' | 'connecting' | 'offline' | 'ended';
  label: string;
  pulse?: boolean;
}) {
  const dot =
    tone === 'live' ? 'bg-emerald-400'
    : tone === 'paused' ? 'bg-amber-400'
    : tone === 'ready' ? 'bg-sky-400'
    : tone === 'connecting' ? 'bg-sky-400'
    : tone === 'ended' ? 'bg-ink-500'
    : 'bg-ink-600';
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-ink-800 bg-ink-900/70 backdrop-blur px-3 py-1.5 text-xs font-medium tracking-wide">
      <span className={cn('relative flex h-2 w-2 rounded-full', dot)}>
        {pulse && <span className={cn('absolute inset-0 rounded-full animate-pulse-ring', dot)} />}
      </span>
      {label}
    </span>
  );
}

// ============================================================================
// Cluster: simple flex row for buttons/chips
// ============================================================================

export function Cluster({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>;
}
