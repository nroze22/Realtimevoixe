'use client';

import type { ServiceConfig } from '@rtv/shared';

/**
 * Client-side persistence for service templates and recent service summaries.
 *
 * Templates are user-saved service configs ("Sunday Worship", "Special Event")
 * that can be loaded into the new-service form. Recent services are a rolling
 * history of services this operator has launched from this browser, used to
 * show a familiar starting point on the operator home page.
 */

const TEMPLATES_KEY = 'rtv:templates';
const RECENTS_KEY = 'rtv:recents';
const NOTES_PREFIX = 'rtv:notes:';

export interface Template {
  id: string;
  name: string;
  /** Subset of ServiceConfig — we drop serviceId/orgId since they're per-launch. */
  config: Omit<ServiceConfig, 'serviceId' | 'orgId'>;
  /** Unix millis. */
  createdAt: number;
  /** Unix millis of last successful launch from this template. */
  lastUsedAt?: number;
}

export interface RecentService {
  serviceId: string;
  joinCode: string;
  title: string;
  pastorName?: string;
  sourceLanguage: string;
  targetLanguages: string[];
  startedAt: number;
  endedAt: number;
  durationSec: number;
  costUSD: number;
  peakListeners: number;
}

function safeRead<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {/* noop */}
}

// ============================================================================
// Templates
// ============================================================================

export function listTemplates(): Template[] {
  return safeRead<Template[]>(TEMPLATES_KEY, []).sort(
    (a, b) => (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt),
  );
}

export function getTemplate(id: string): Template | undefined {
  return listTemplates().find((t) => t.id === id);
}

export function saveTemplate(input: { name: string; config: Template['config']; id?: string }): Template {
  const all = listTemplates();
  const id = input.id ?? `tpl_${Math.random().toString(36).slice(2, 9)}`;
  const existing = all.find((t) => t.id === id);
  const next: Template = existing
    ? { ...existing, name: input.name, config: input.config }
    : { id, name: input.name, config: input.config, createdAt: Date.now() };
  const merged = [next, ...all.filter((t) => t.id !== id)];
  safeWrite(TEMPLATES_KEY, merged);
  return next;
}

export function deleteTemplate(id: string): void {
  const all = listTemplates();
  safeWrite(TEMPLATES_KEY, all.filter((t) => t.id !== id));
}

export function markTemplateUsed(id: string): void {
  const all = listTemplates();
  const next = all.map((t) => (t.id === id ? { ...t, lastUsedAt: Date.now() } : t));
  safeWrite(TEMPLATES_KEY, next);
}

// ============================================================================
// Recent services
// ============================================================================

export function listRecents(limit = 8): RecentService[] {
  return safeRead<RecentService[]>(RECENTS_KEY, [])
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit);
}

export function recordRecent(svc: RecentService): void {
  const all = safeRead<RecentService[]>(RECENTS_KEY, []);
  const merged = [svc, ...all.filter((r) => r.serviceId !== svc.serviceId)].slice(0, 20);
  safeWrite(RECENTS_KEY, merged);
}

// ============================================================================
// Per-service notes (operator's running order, jots during service)
// ============================================================================

export function getNotes(serviceId: string): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(`${NOTES_PREFIX}${serviceId}`) ?? '';
}

export function setNotes(serviceId: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (!value) window.localStorage.removeItem(`${NOTES_PREFIX}${serviceId}`);
    else window.localStorage.setItem(`${NOTES_PREFIX}${serviceId}`, value);
  } catch {/* noop */}
}
