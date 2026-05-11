import { cn } from '@/lib/cn';

interface LogoProps {
  className?: string;
  size?: number;
  withWordmark?: boolean;
  animated?: boolean;
}

export function Logo({ className, size = 22, withWordmark = false, animated }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2 select-none', className)}>
      <svg
        viewBox="0 0 32 32"
        width={size}
        height={size}
        fill="none"
        className={cn(animated && 'group')}
        aria-hidden
      >
        <defs>
          <linearGradient id="rtv-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0%"  stopColor="#aa8aff" />
            <stop offset="100%" stopColor="#7c5cff" />
          </linearGradient>
        </defs>
        <g stroke="url(#rtv-grad)" strokeLinecap="round" strokeWidth="2.5">
          <line x1="4"  y1="14" x2="4"  y2="18" className={animated ? 'animate-[bar1_1.6s_ease-in-out_infinite]' : ''} />
          <line x1="10" y1="10" x2="10" y2="22" className={animated ? 'animate-[bar2_1.6s_ease-in-out_infinite]' : ''} />
          <line x1="16" y1="6"  x2="16" y2="26" className={animated ? 'animate-[bar3_1.6s_ease-in-out_infinite]' : ''} />
          <line x1="22" y1="10" x2="22" y2="22" className={animated ? 'animate-[bar4_1.6s_ease-in-out_infinite]' : ''} />
          <line x1="28" y1="14" x2="28" y2="18" opacity="0.6" />
        </g>
      </svg>
      {withWordmark && (
        <span className="font-semibold tracking-tightish text-ink-50">
          Realtime <span className="text-ink-400">Voice</span>
        </span>
      )}
    </span>
  );
}
