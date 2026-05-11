'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface CommandItem {
  id: string;
  title: string;
  hint?: string;
  shortcut?: string[];
  icon?: LucideIcon;
  action: () => void;
  /** Optional grouping label. */
  group?: string;
}

interface CommandPaletteProps {
  items: CommandItem[];
  /**
   * If you want to control open externally pass `open` + `setOpen`. Otherwise
   * the palette toggles on Cmd/Ctrl-K and Esc on its own.
   */
  open?: boolean;
  setOpen?: (v: boolean) => void;
}

export function CommandPalette({ items, open: extOpen, setOpen: extSetOpen }: CommandPaletteProps) {
  const [internal, setInternal] = useState(false);
  const open = extOpen ?? internal;
  const setOpen = extSetOpen ?? setInternal;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Global hotkey ⌘K / Ctrl-K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      it.title.toLowerCase().includes(q) ||
      it.hint?.toLowerCase().includes(q) ||
      it.group?.toLowerCase().includes(q),
    );
  }, [items, query]);

  const grouped = useMemo(() => {
    const out: Record<string, CommandItem[]> = {};
    for (const it of filtered) {
      const g = it.group ?? 'Actions';
      (out[g] ||= []).push(it);
    }
    return out;
  }, [filtered]);

  function runAt(idx: number) {
    const item = filtered[idx];
    if (!item) return;
    setOpen(false);
    setTimeout(() => item.action(), 0);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(active);
    }
  }

  if (!open) return null;

  let runningIdx = -1;

  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center p-4 pt-[18vh] animate-[caption-in_220ms_var(--ease-snap)_both]">
      <div
        className="absolute inset-0 bg-ink-950/60 backdrop-blur-[6px]"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div className="relative w-full max-w-xl rounded-2xl border border-white/[0.08] bg-ink-900/90 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.8)] overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
          <Search className="h-4 w-4 text-ink-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-600"
          />
          <span className="kbd">esc</span>
        </div>

        <div className="max-h-[55vh] overflow-y-auto scroll-soft py-1">
          {Object.entries(grouped).map(([g, list]) => (
            <div key={g} className="py-1">
              <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-[0.18em] text-ink-500">
                {g}
              </div>
              {list.map((it) => {
                runningIdx += 1;
                const isActive = runningIdx === active;
                const Icon = it.icon;
                const idx = runningIdx;
                return (
                  <button
                    key={it.id}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => runAt(idx)}
                    className={cn(
                      'w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                      isActive ? 'bg-white/[0.06] text-ink-50' : 'text-ink-200 hover:bg-white/[0.03]',
                    )}
                  >
                    {Icon && (
                      <span className={cn(
                        'h-6 w-6 rounded-md grid place-items-center',
                        isActive ? 'bg-accent-900/40 text-accent-200' : 'bg-white/[0.04] text-ink-400',
                      )}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <span className="flex-1 min-w-0 truncate">{it.title}</span>
                    {it.hint && (
                      <span className="text-[11px] text-ink-500 truncate max-w-[40%]">{it.hint}</span>
                    )}
                    {it.shortcut && (
                      <span className="flex gap-1 ml-auto">
                        {it.shortcut.map((s) => (
                          <span key={s} className="kbd">{s}</span>
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-ink-500">
              No matches for &ldquo;{query}&rdquo;.
            </div>
          )}
        </div>

        <div className="border-t border-white/[0.06] px-4 py-2 text-[11px] text-ink-500 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="kbd">↑</span><span className="kbd">↓</span> navigate
            <span className="ml-3 kbd">↵</span> select
          </span>
          <span className="font-mono opacity-70">Realtime Voice</span>
        </div>
      </div>
    </div>
  );
}
