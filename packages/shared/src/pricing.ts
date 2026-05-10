/**
 * OpenAI Realtime pricing as of May 2026. Update when OpenAI changes rates.
 * Source: https://openai.com/api/pricing (verify before relying on for billing).
 *
 * Tokens are *audio tokens*. Empirically ~50 audio input tokens/sec and
 * ~85 audio output tokens/sec during continuous speech (varies by content).
 */
export const PRICING = {
  realtime: {
    'gpt-realtime': {
      inputPerMillionTokens: 32,
      cachedInputPerMillionTokens: 0.4,
      outputPerMillionTokens: 64,
    },
    'gpt-realtime-mini': {
      inputPerMillionTokens: 10,
      cachedInputPerMillionTokens: 0.3,
      outputPerMillionTokens: 20,
    },
    'gpt-realtime-translate': {
      inputPerMillionTokens: 32,
      cachedInputPerMillionTokens: 0.4,
      outputPerMillionTokens: 64,
    },
  },
  transcribe: {
    'whisper-1': { perMinute: 0.006 },
    'gpt-4o-transcribe': { perMinute: 0.006 },
    'gpt-4o-mini-transcribe': { perMinute: 0.003 },
  },
  livekit: {
    /** Approximate LiveKit Cloud egress per participant-minute, Build tier. */
    perParticipantMinute: 0.0005,
  },
} as const;

export type RealtimeModelName = keyof typeof PRICING.realtime;
export type TranscribeModelName = keyof typeof PRICING.transcribe;

export interface UsageSnapshot {
  audioInputTokens: number;
  audioOutputTokens: number;
  cachedAudioInputTokens: number;
  transcribeSeconds: number;
  livekitParticipantSeconds: number;
}

export function emptyUsage(): UsageSnapshot {
  return {
    audioInputTokens: 0,
    audioOutputTokens: 0,
    cachedAudioInputTokens: 0,
    transcribeSeconds: 0,
    livekitParticipantSeconds: 0,
  };
}

export function addUsage(a: UsageSnapshot, b: Partial<UsageSnapshot>): UsageSnapshot {
  return {
    audioInputTokens: a.audioInputTokens + (b.audioInputTokens ?? 0),
    audioOutputTokens: a.audioOutputTokens + (b.audioOutputTokens ?? 0),
    cachedAudioInputTokens: a.cachedAudioInputTokens + (b.cachedAudioInputTokens ?? 0),
    transcribeSeconds: a.transcribeSeconds + (b.transcribeSeconds ?? 0),
    livekitParticipantSeconds: a.livekitParticipantSeconds + (b.livekitParticipantSeconds ?? 0),
  };
}

export function estimateCostUSD(
  usage: UsageSnapshot,
  realtimeModel: RealtimeModelName,
  transcribeModel: TranscribeModelName,
): number {
  const rt = PRICING.realtime[realtimeModel];
  const tr = PRICING.transcribe[transcribeModel];
  const lk = PRICING.livekit;

  const inputCost = (usage.audioInputTokens / 1_000_000) * rt.inputPerMillionTokens;
  const cachedCost = (usage.cachedAudioInputTokens / 1_000_000) * rt.cachedInputPerMillionTokens;
  const outputCost = (usage.audioOutputTokens / 1_000_000) * rt.outputPerMillionTokens;
  const transcribeCost = (usage.transcribeSeconds / 60) * tr.perMinute;
  const livekitCost = (usage.livekitParticipantSeconds / 60) * lk.perParticipantMinute;

  return inputCost + cachedCost + outputCost + transcribeCost + livekitCost;
}

/**
 * Rough per-minute cost when running N concurrent translate sessions on the
 * same input audio. Used for quick "burn rate" estimates in the operator UI.
 *
 * Assumes ~50 input audio tok/sec and ~85 output audio tok/sec sustained.
 */
export function estimatedBurnPerMinuteUSD(
  realtimeModel: RealtimeModelName,
  numTargetLanguages: number,
  transcribeModel: TranscribeModelName,
): number {
  const rt = PRICING.realtime[realtimeModel];
  const inputTokPerMin = 50 * 60;
  const outputTokPerMin = 85 * 60;
  const perLang =
    (inputTokPerMin / 1_000_000) * rt.inputPerMillionTokens +
    (outputTokPerMin / 1_000_000) * rt.outputPerMillionTokens;
  const transcribe = PRICING.transcribe[transcribeModel].perMinute;
  return perLang * numTargetLanguages + transcribe;
}
