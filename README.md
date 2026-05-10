# Realtime Voice — Live Church Translation

Live AI translation of worship services, built on **OpenAI Realtime
(`gpt-realtime-translate`)** and **LiveKit Cloud**. Congregants listen on
their own phones + earbuds — no rented headsets, no human interpreters.

## What's in the box

```
.
├── apps/
│   ├── orchestrator/   Node + Fastify service. Owns OpenAI Realtime sessions,
│   │                   LiveKit token minting, and cost guardrails.
│   └── web/            Next.js 15 app. Two surfaces in one codebase:
│                          • /operator/*  → AV booth dashboard
│                          • /listen/*    → listener PWA
└── packages/
    └── shared/         TypeScript types, language list, pricing math,
                        and the WS wire protocol shared by web + orchestrator.
```

## Architecture at a glance

```
 Mixer aux out ──USB──▶ Operator browser ─PCM16 WS──▶ Orchestrator
                              │                         │
                              │                         ├─▶ OpenAI Realtime (es)
                              │                         ├─▶ OpenAI Realtime (pt)
                              │                         └─▶ OpenAI Realtime (ko)
                              │                              │
                              │◀──── translated PCM ─────────┘
                              │
                              ▼
                       LiveKit Cloud (room: svc-XXXX)
                              │
                       publishes 1 audio track per language
                              │
                              ▼
                       Listener PWA on phones
```

Why this shape:

- **Browser publishes to LiveKit**, not the orchestrator. Keeps the orchestrator
  pure Node (no native bindings, no GPUs, no media stack) and lets us reuse the
  battle-tested LiveKit JS SDK.
- **One OpenAI Realtime session per target language.** OpenAI's
  `gpt-realtime-translate` model is one-source-one-target by design. The
  orchestrator multiplexes the upstream audio into N parallel sessions.
- **`gpt-realtime-translate` auto-adapts to the speaker's tone**, so the
  translated voice already sounds *speaker-like* with zero setup. When OpenAI
  Custom Voices access is granted, drop the approved voice ID into
  `OPENAI_CUSTOM_VOICE_IDS` and the orchestrator passes it through.
- **Source-language captions come from the Realtime session's built-in
  `input_audio_transcription` (Whisper)** — no separate transcription pipeline
  needed.
- **Hard cost cap per service** — sessions auto-terminate when reached. Default
  $30/service, configurable per service.

## Prerequisites

- Node 20+ and pnpm 10+
- An OpenAI API key on a plan with Realtime access
- A LiveKit Cloud project (the free Build tier covers development)

## Setup

```bash
cp .env.example .env
# fill in OPENAI_API_KEY, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET

pnpm install
```

Set the same env vars in both apps via the root `.env` (both apps load it).

## Run dev

```bash
pnpm dev
# orchestrator on http://localhost:8787
# web on        http://localhost:3000
```

Open <http://localhost:3000>, click **Start a service**, configure target
languages, and on the next screen pick your audio input and click **Go live**.

Open the QR / listener link on a second device or browser tab to hear it.

## Audio plumbing in production

Easiest path for an AV team:

1. Run a balanced cable from any mono **aux send** on the mixer (X32 / M32 /
   Yamaha QL / Allen & Heath SQ / StudioLive) into a USB audio adapter on the
   booth laptop. The X32/M32/StudioLive line of consoles can also expose a USB
   multichannel device directly — pick the channel mapped to your translation
   aux.
2. In Chrome, allow microphone access and pick that device in the operator
   console.
3. Wire your venue Wi-Fi so listener phones have line-of-sight to an AP on the
   5 GHz band — LiveKit unicast is efficient but Wi-Fi airtime is the
   bottleneck above ~100 simultaneous listeners.

A Raspberry Pi appliance image that does the same job headlessly is on the
phase-4 roadmap.

## Cost model

Realtime audio (`gpt-realtime` / `gpt-realtime-translate`) is roughly:

| Item                          | Cost            |
| ----------------------------- | --------------- |
| Audio in                      | $32 / 1M tokens |
| Audio in (cached)             | $0.40 / 1M      |
| Audio out                     | $64 / 1M tokens |
| `gpt-4o-mini-transcribe`      | $0.003 / min    |
| LiveKit Build tier (egress)   | $0.0005 / participant-min |

Approximate burn rate during continuous speech:

- **1 target language** ≈ $0.30 / minute
- **3 target languages** ≈ $0.90 / minute

A 60-minute service into Spanish is therefore ~$18, into 3 languages ~$54. Hard
cap defaults to **$30 / service**. The orchestrator streams the live cost back
to the operator UI every second and auto-stops at 100%.

## Voice cloning roadmap

OpenAI's Custom Voices API exists but access is sales-gated. Until your org is
approved:

- The operator UI shows "Adaptive voice — sounds like the speaker" because
  `gpt-realtime-translate` auto-mimics the speaker's tone/pitch/pacing.
- The `pastorId` field is collected on service creation and stored. When OpenAI
  grants Custom Voices access, set `OPENAI_CUSTOM_VOICE_IDS` in `.env`:
  `OPENAI_CUSTOM_VOICE_IDS=pastor-john:voice_abc123,pastor-jane:voice_def456`
  and the orchestrator will pass the matching voice ID into the Realtime
  session.

Always get a written, dated consent before enrolling any voice — even with
permission, scope it to "church services for org X" and document a deletion
process. The Tennessee ELVIS Act and similar state laws make this material.

## Roadmap

- [ ] Persistence layer (Supabase) for services, organizations, billing events
- [ ] Stripe subscriptions + usage metering
- [ ] Pi 4 ingest appliance image (USB audio → WS upstream, zero-config QR pair)
- [ ] Recording + transcript export
- [ ] Native iOS/Android wrappers if app-store presence is needed
- [ ] LL-HLS edge for venues with >100 simultaneous listeners
