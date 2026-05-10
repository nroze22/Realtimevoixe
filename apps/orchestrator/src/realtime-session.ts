import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { LanguageCode } from '@rtv/shared';
import { LANGUAGES_BY_CODE } from '@rtv/shared';
import { env, parseCustomVoiceMap } from './env.js';
import { log } from './log.js';

/**
 * One TranslateSession opens a WebSocket session to OpenAI's Realtime API,
 * configured to translate spoken audio from `sourceLanguage` into
 * `targetLanguage` and emit audio + text deltas back to us.
 *
 * Wire protocol reference: https://developers.openai.com/api/docs/guides/realtime
 *
 * We use the WebSocket transport (server-to-server). The client browser
 * streams PCM16 to the orchestrator via its own WebSocket; the orchestrator
 * forwards those audio chunks into this session via `appendAudio()`.
 */

const OPENAI_REALTIME_WS = 'wss://api.openai.com/v1/realtime';

export interface TranslateSessionOptions {
  serviceId: string;
  pastorId?: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
}

export interface TranslateSessionEvents {
  audio: (pcm16: Buffer) => void;
  /** Streamed translated text (target language). */
  text: (delta: string, isFinal: boolean) => void;
  /**
   * Streamed source-language transcript from the built-in
   * `input_audio_transcription` model. Useful for captions.
   */
  sourceText: (delta: string, isFinal: boolean) => void;
  usage: (u: { inputTokens: number; outputTokens: number; cachedInputTokens: number }) => void;
  error: (err: Error) => void;
  closed: () => void;
  open: () => void;
}

export declare interface TranslateSession {
  on<E extends keyof TranslateSessionEvents>(event: E, listener: TranslateSessionEvents[E]): this;
  emit<E extends keyof TranslateSessionEvents>(
    event: E,
    ...args: Parameters<TranslateSessionEvents[E]>
  ): boolean;
}

export class TranslateSession extends EventEmitter {
  private ws: WebSocket | null = null;
  private closed = false;
  private currentTextBuffer = '';

  constructor(public readonly options: TranslateSessionOptions) {
    super();
  }

  async start(): Promise<void> {
    const model = env().OPENAI_REALTIME_MODEL;
    const url = `${OPENAI_REALTIME_WS}?model=${encodeURIComponent(model)}`;
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${env().OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });
    this.ws = ws;

    ws.on('open', () => {
      log.info(
        { serviceId: this.options.serviceId, target: this.options.targetLanguage },
        'realtime session opened',
      );
      this.sendSessionUpdate();
      this.emit('open');
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      let evt: any;
      try {
        evt = JSON.parse(raw.toString());
      } catch (err) {
        log.warn({ err }, 'failed to parse realtime event');
        return;
      }
      this.handleEvent(evt);
    });

    ws.on('error', (err) => {
      log.error({ err, target: this.options.targetLanguage }, 'realtime ws error');
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    });

    ws.on('close', (code, reason) => {
      this.closed = true;
      log.info(
        { code, reason: reason.toString(), target: this.options.targetLanguage },
        'realtime ws closed',
      );
      this.emit('closed');
    });
  }

  /** Send a raw session.update describing translation behaviour. */
  private sendSessionUpdate() {
    const { sourceLanguage, targetLanguage, pastorId } = this.options;
    const srcName = LANGUAGES_BY_CODE[sourceLanguage].englishName;
    const tgtName = LANGUAGES_BY_CODE[targetLanguage].englishName;

    const customVoice = pastorId ? parseCustomVoiceMap().get(pastorId) : undefined;

    /**
     * gpt-realtime-translate ignores `voice` and `instructions` in favour of
     * its built-in dynamic voice adaptation. When the org has Custom Voices
     * provisioned, switch to gpt-realtime with explicit voice + instructions.
     */
    const useTranslateModel = env().OPENAI_REALTIME_MODEL.includes('translate');
    const instructions = useTranslateModel
      ? undefined
      : [
          `You are a simultaneous interpreter for a church service.`,
          `The speaker is talking in ${srcName}. Translate everything they say into ${tgtName}.`,
          `Preserve reverent tone, scripture references, and proper names exactly.`,
          `Do not add commentary. Do not address the speaker. Speak only the translation.`,
        ].join(' ');

    const sessionPayload: Record<string, unknown> = {
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      input_audio_transcription: { model: 'gpt-4o-mini-transcribe', language: sourceLanguage },
      turn_detection: { type: 'server_vad', threshold: 0.5, silence_duration_ms: 350 },
      modalities: ['audio', 'text'],
    };

    if (!useTranslateModel) {
      sessionPayload.instructions = instructions;
      sessionPayload.voice = customVoice ?? 'verse';
    } else if (customVoice) {
      // If a Custom Voice has been provisioned, prefer it even on the translate model.
      sessionPayload.voice = customVoice;
    }

    this.send({ type: 'session.update', session: sessionPayload });
  }

  /** Append a raw PCM16 (16kHz mono LE) chunk to the input audio buffer. */
  appendAudio(pcm16: Buffer): void {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const b64 = pcm16.toString('base64');
    this.send({ type: 'input_audio_buffer.append', audio: b64 });
  }

  /** Force a commit + response generation (e.g. on pause). */
  flush(): void {
    if (this.closed) return;
    this.send({ type: 'input_audio_buffer.commit' });
    this.send({ type: 'response.create' });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws?.close(1000, 'session ended');
    } catch {
      // ignore
    }
  }

  private send(payload: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  private handleEvent(evt: { type: string; [k: string]: any }): void {
    switch (evt.type) {
      case 'response.audio.delta':
      case 'response.output_audio.delta': {
        const b64 = (evt.delta ?? evt.audio) as string | undefined;
        if (b64) this.emit('audio', Buffer.from(b64, 'base64'));
        break;
      }

      case 'response.audio_transcript.delta':
      case 'response.output_text.delta':
      case 'response.text.delta': {
        const delta = (evt.delta ?? '') as string;
        this.currentTextBuffer += delta;
        if (delta) this.emit('text', delta, false);
        break;
      }

      case 'conversation.item.input_audio_transcription.delta': {
        const delta = (evt.delta ?? '') as string;
        if (delta) this.emit('sourceText', delta, false);
        break;
      }

      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = (evt.transcript ?? '') as string;
        if (transcript) this.emit('sourceText', transcript, true);
        break;
      }

      case 'response.audio_transcript.done':
      case 'response.output_text.done':
      case 'response.text.done':
      case 'response.done': {
        const finalText = (evt.transcript ?? evt.text ?? this.currentTextBuffer ?? '') as string;
        if (finalText) this.emit('text', '', true);
        this.currentTextBuffer = '';

        const usage = evt.response?.usage ?? evt.usage;
        if (usage) {
          const audioIn =
            usage.input_token_details?.audio_tokens ??
            usage.input_audio_tokens ??
            0;
          const audioOut =
            usage.output_token_details?.audio_tokens ??
            usage.output_audio_tokens ??
            0;
          const cached =
            usage.input_token_details?.cached_tokens ?? usage.cached_input_tokens ?? 0;
          this.emit('usage', {
            inputTokens: audioIn,
            outputTokens: audioOut,
            cachedInputTokens: cached,
          });
        }
        break;
      }

      case 'error': {
        log.error({ err: evt.error, target: this.options.targetLanguage }, 'realtime error event');
        this.emit('error', new Error(evt.error?.message ?? 'unknown realtime error'));
        break;
      }

      default:
        // Many other event types exist; we only care about the audio/text/usage path.
        break;
    }
  }
}
