import type { LanguageCode } from './languages.js';
import type { ServiceState } from './service.js';

/**
 * Wire format for the WebSocket protocol between the operator's browser and
 * the orchestrator. Audio chunks travel as binary frames; everything else is
 * a JSON text frame matching one of the discriminated unions below.
 */

// ---- Operator -> Orchestrator (text frames) ----

export type OperatorMessage =
  | { type: 'hello'; serviceId: string; role: 'operator' }
  | { type: 'start'; }
  | { type: 'pause'; }
  | { type: 'resume'; }
  | { type: 'stop'; }
  | { type: 'cap.raise'; addUSD: number }
  | { type: 'audio.meta'; sampleRate: number; channels: 1 | 2; codec: 'pcm16' | 'opus' };

// ---- Orchestrator -> Operator (text frames) ----

export interface CaptionFrame {
  /** 'source' = original spoken language, 'target' = translated language. */
  kind: 'source' | 'target';
  language: LanguageCode;
  text: string;
  /** Whether this is a final committed caption. Otherwise it's a partial. */
  isFinal: boolean;
  /** Monotonic timestamp ms since orchestrator session start. */
  tMs: number;
}

export interface CostUpdate {
  costUSD: number;
  capUSD: number;
  /** 0..1 fraction toward cap. */
  capFraction: number;
  burnPerMinuteUSD: number;
  costByLanguage: Record<string, number>;
}

export type OrchestratorMessage =
  | { type: 'state'; state: ServiceState }
  | { type: 'caption'; frame: CaptionFrame }
  | { type: 'cost'; usage: CostUpdate }
  | { type: 'listener.count'; byLanguage: Record<string, number>; total: number }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; tMs: number }
  | { type: 'cap.warning'; capFraction: number }
  | { type: 'cap.reached'; }
  | { type: 'error'; message: string };
