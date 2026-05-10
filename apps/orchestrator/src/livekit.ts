import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { env } from './env.js';

let _roomService: RoomServiceClient | null = null;
function roomService(): RoomServiceClient {
  if (_roomService) return _roomService;
  const e = env();
  // RoomServiceClient wants the HTTP URL, derived from the wss URL.
  const httpUrl = e.LIVEKIT_URL.replace(/^wss?:/i, (m) =>
    m.toLowerCase() === 'wss:' ? 'https:' : 'http:',
  );
  _roomService = new RoomServiceClient(httpUrl, e.LIVEKIT_API_KEY, e.LIVEKIT_API_SECRET);
  return _roomService;
}

export interface TokenOptions {
  identity: string;
  roomName: string;
  canPublish: boolean;
  canSubscribe: boolean;
  /** TTL in seconds. */
  ttlSeconds?: number;
  /** Optional display name. */
  name?: string;
  /** Optional metadata (e.g. {"role":"operator","language":"es"}). */
  metadata?: Record<string, unknown>;
}

export async function mintToken(opts: TokenOptions): Promise<string> {
  const e = env();
  const at = new AccessToken(e.LIVEKIT_API_KEY, e.LIVEKIT_API_SECRET, {
    identity: opts.identity,
    ttl: opts.ttlSeconds ?? 60 * 60 * 4,
    name: opts.name,
    metadata: opts.metadata ? JSON.stringify(opts.metadata) : undefined,
  });
  at.addGrant({
    room: opts.roomName,
    roomJoin: true,
    canPublish: opts.canPublish,
    canSubscribe: opts.canSubscribe,
    canPublishData: true,
  });
  return at.toJwt();
}

export async function ensureRoom(roomName: string): Promise<void> {
  const svc = roomService();
  try {
    await svc.createRoom({
      name: roomName,
      emptyTimeout: 10 * 60,
      maxParticipants: 600,
    });
  } catch (err) {
    // Room may already exist; LiveKit returns 409. Ignore.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/already exists|409/i.test(msg)) throw err;
  }
}

export async function deleteRoom(roomName: string): Promise<void> {
  try {
    await roomService().deleteRoom(roomName);
  } catch {
    // ignore
  }
}

/**
 * Returns listener counts per language, derived from each participant's
 * metadata ({"role":"listener","language":"es"}). Operators are excluded.
 */
export async function listenerCounts(
  roomName: string,
): Promise<{ byLanguage: Record<string, number>; total: number }> {
  const byLanguage: Record<string, number> = {};
  let total = 0;
  try {
    const participants = await roomService().listParticipants(roomName);
    for (const p of participants) {
      if (!p.metadata) continue;
      let meta: { role?: string; language?: string } = {};
      try { meta = JSON.parse(p.metadata); } catch {/* noop */}
      if (meta.role !== 'listener' || !meta.language) continue;
      byLanguage[meta.language] = (byLanguage[meta.language] ?? 0) + 1;
      total += 1;
    }
  } catch {
    // ignore — room may not exist yet.
  }
  return { byLanguage, total };
}
