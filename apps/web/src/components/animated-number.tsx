'use client';

import { useEffect, useRef, useState } from 'react';

interface AnimatedNumberProps {
  value: number;
  /** decimal places */
  decimals?: number;
  /** ms to tween */
  duration?: number;
  /** prefix string, e.g. "$" */
  prefix?: string;
  /** suffix string, e.g. "%" */
  suffix?: string;
  className?: string;
}

/**
 * Smoothly tweens a numeric value to its new target using a cubic-out ease.
 * Avoids the jumpy feel of raw .toFixed() updates.
 */
export function AnimatedNumber({
  value, decimals = 2, duration = 600, prefix = '', suffix = '', className,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const toRef = useRef(value);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    fromRef.current = display;
    toRef.current = value;
    startRef.current = null;

    function tick(now: number) {
      if (startRef.current == null) startRef.current = now;
      const elapsed = now - startRef.current;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = fromRef.current + (toRef.current - fromRef.current) * eased;
      setDisplay(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return (
    <span className={className}>
      {prefix}
      {display.toFixed(decimals)}
      {suffix}
    </span>
  );
}
