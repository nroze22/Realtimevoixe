import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_REALTIME_MODEL: z.string().default('gpt-realtime-translate'),
  OPENAI_TRANSCRIBE_MODEL: z.string().default('gpt-4o-mini-transcribe'),
  OPENAI_CUSTOM_VOICE_IDS: z.string().optional(),

  LIVEKIT_URL: z.string().url('LIVEKIT_URL must be a valid wss URL'),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),

  ORCHESTRATOR_PORT: z.coerce.number().int().positive().default(8787),
  ORCHESTRATOR_PUBLIC_URL: z.string().default('http://localhost:8787'),

  COST_CAP_PER_SERVICE_USD: z.coerce.number().positive().default(30),
  COST_CAP_PER_ORG_MONTHLY_USD: z.coerce.number().positive().default(300),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;
export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment configuration:');
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}

export function parseCustomVoiceMap(): Map<string, string> {
  const raw = env().OPENAI_CUSTOM_VOICE_IDS;
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const pair of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [pastorId, voiceId] = pair.split(':').map((s) => s.trim());
    if (pastorId && voiceId) map.set(pastorId, voiceId);
  }
  return map;
}
