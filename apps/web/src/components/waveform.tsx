'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';

interface WaveformProps {
  stream: MediaStream | null;
  /** Optional fallback for "live but no stream wired up yet". */
  active?: boolean;
  className?: string;
  bars?: number;
  /** Tailwind class for bar color. */
  color?: string;
}

/**
 * Compact animated waveform driven by an AnalyserNode on the given MediaStream.
 * If no stream is provided but `active` is true, draws a calm idle pulse so the
 * UI never goes static during connecting / silent moments.
 */
export function Waveform({ stream, active, className, bars = 32, color = 'bg-accent-500' }: WaveformProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    if (!stream) return;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.75;
    src.connect(analyser);
    ctxRef.current = ctx;
    analyserRef.current = analyser;
    return () => {
      try { src.disconnect(); } catch {/* noop */}
      try { void ctx.close(); } catch {/* noop */}
      ctxRef.current = null;
      analyserRef.current = null;
    };
  }, [stream]);

  useEffect(() => {
    const buf = new Uint8Array(64);
    let t = 0;
    function tick() {
      const el = containerRef.current;
      if (!el) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const children = el.children;
      const analyser = analyserRef.current;
      if (analyser) {
        analyser.getByteFrequencyData(buf);
        for (let i = 0; i < children.length; i++) {
          const idx = Math.floor((i / children.length) * buf.length);
          const v = (buf[idx] ?? 0) / 255;
          const h = 6 + v * 32; // 6px..38px
          (children[i] as HTMLDivElement).style.height = `${h}px`;
        }
      } else if (active) {
        // Calm idle wave.
        t += 0.06;
        for (let i = 0; i < children.length; i++) {
          const v = (Math.sin(t + i * 0.45) + 1) / 2; // 0..1
          const h = 4 + v * 8;
          (children[i] as HTMLDivElement).style.height = `${h}px`;
        }
      } else {
        for (let i = 0; i < children.length; i++) {
          (children[i] as HTMLDivElement).style.height = `4px`;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active]);

  return (
    <div
      ref={containerRef}
      className={cn('flex items-center gap-[3px] h-10', className)}
      aria-hidden
    >
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className={cn('w-[3px] rounded-full transition-[height] duration-75', color)}
          style={{ height: '4px' }}
        />
      ))}
    </div>
  );
}
