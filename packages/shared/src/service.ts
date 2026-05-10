import { z } from 'zod';
import { LANGUAGES } from './languages.js';

const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as [string, ...string[]];

export const ServiceConfigSchema = z.object({
  serviceId: z.string().min(1),
  orgId: z.string().min(1),
  title: z.string().min(1).max(120),
  pastorName: z.string().max(120).optional(),
  /** Spoken source language at the pulpit. */
  sourceLanguage: z.enum(LANGUAGE_CODES),
  /** Languages to translate into. At least one. */
  targetLanguages: z.array(z.enum(LANGUAGE_CODES)).min(1).max(8),
  /** Pastor profile (for future Custom Voice ID lookup). */
  pastorId: z.string().optional(),
  /** Hard cost cap in USD for this service. Sessions terminate when reached. */
  costCapUSD: z.number().positive().default(30),
  /** Whether to enable the Whisper source-captions sidecar. */
  enableCaptions: z.boolean().default(true),
});

export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;

export type ServiceStatus = 'idle' | 'starting' | 'live' | 'paused' | 'stopping' | 'stopped' | 'error';

export interface ServiceState {
  config: ServiceConfig;
  status: ServiceStatus;
  startedAt: number | null;
  endedAt: number | null;
  livekitRoomName: string;
  /** Short usher-friendly code, e.g. "SVC-7K2L". */
  joinCode: string;
  costUSD: number;
  capReached: boolean;
  listenersByLanguage: Record<string, number>;
  totalListeners: number;
  errorMessage: string | null;
}
