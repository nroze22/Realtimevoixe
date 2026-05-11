import type { ServiceConfig, ServiceState } from '@rtv/shared';

const HTTP =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_HTTP_URL ?? 'http://localhost:8787';
const WS =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_WS_URL ?? 'ws://localhost:8787';

export interface CreateServiceResult {
  service: ServiceState;
  livekit: { url: string; roomName: string; operatorToken: string };
}

export async function createService(config: ServiceConfig): Promise<CreateServiceResult> {
  const res = await fetch(`${HTTP}/services`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    throw new Error(`Failed to create service (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export interface ListenerToken {
  url: string;
  roomName: string;
  token: string;
  identity: string;
  preferredLanguage: string;
}

export async function fetchListenerToken(
  serviceId: string,
  language: string,
  listenerId?: string,
): Promise<ListenerToken> {
  const res = await fetch(`${HTTP}/listener-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceId, language, listenerId }),
  });
  if (!res.ok) {
    throw new Error(`Failed to mint listener token (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export interface DeepHealth {
  ok: boolean;
  openai: { ok: boolean; latencyMs: number; error?: string };
  livekit: { ok: boolean; latencyMs: number; error?: string };
}

export async function fetchDeepHealth(): Promise<DeepHealth> {
  const res = await fetch(`${HTTP}/health/deep`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`health check failed (${res.status})`);
  return res.json();
}

export function operatorWsUrl(serviceId: string): string {
  return `${WS}/ws/operator/${encodeURIComponent(serviceId)}`;
}

export function recordingHref(
  serviceId: string,
  lang: string,
  ext: 'wav' | 'srt' | 'vtt',
): string {
  return `${HTTP}/services/${encodeURIComponent(serviceId)}/recordings/${encodeURIComponent(lang)}.${ext}`;
}
