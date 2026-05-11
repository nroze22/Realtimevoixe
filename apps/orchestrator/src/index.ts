import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import {
  ServiceConfigSchema,
  type OperatorMessage,
  type LanguageCode,
} from '@rtv/shared';
import { env } from './env.js';
import { log } from './log.js';
import { registry } from './registry.js';
import { ensureRoom, mintToken } from './livekit.js';
import { z } from 'zod';

async function main() {
  const e = env();
  const fastify = Fastify({ logger: false });

  await fastify.register(cors, { origin: true });
  await fastify.register(websocket, {
    options: { maxPayload: 8 * 1024 * 1024 },
  });

  fastify.get('/health', async () => ({ ok: true, service: 'orchestrator' }));

  /**
   * Create a service session and return its LiveKit room name + operator token.
   * The operator browser uses this token to publish per-language audio tracks
   * back into the room. Listeners use /listener-token to subscribe.
   */
  fastify.post('/services', async (req, reply) => {
    const parsed = ServiceConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_config', issues: parsed.error.issues });
    }
    const session = registry.create(parsed.data);
    await ensureRoom(session.state.livekitRoomName);
    const operatorToken = await mintToken({
      identity: `operator-${parsed.data.serviceId}`,
      roomName: session.state.livekitRoomName,
      canPublish: true,
      canSubscribe: false,
      name: parsed.data.title,
      metadata: { role: 'operator' },
    });
    return {
      service: session.state,
      livekit: {
        url: e.LIVEKIT_URL,
        roomName: session.state.livekitRoomName,
        operatorToken,
      },
    };
  });

  /**
   * Mint a subscribe-only token for a listener PWA.
   */
  const ListenerTokenSchema = z.object({
    serviceId: z.string().min(1),
    language: z.string().min(2).max(8),
    listenerId: z.string().optional(),
  });
  fastify.post('/listener-token', async (req, reply) => {
    const parsed = ListenerTokenSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid' });
    const session = registry.resolve(parsed.data.serviceId);
    if (!session) return reply.code(404).send({ error: 'service_not_found' });

    const identity = parsed.data.listenerId ?? `listener-${crypto.randomUUID()}`;
    const token = await mintToken({
      identity,
      roomName: session.state.livekitRoomName,
      canPublish: false,
      canSubscribe: true,
      name: `Listener (${parsed.data.language})`,
      metadata: { role: 'listener', language: parsed.data.language },
    });
    return {
      url: e.LIVEKIT_URL,
      roomName: session.state.livekitRoomName,
      token,
      identity,
      preferredLanguage: parsed.data.language,
    };
  });

  fastify.get('/services/:serviceId', async (req, reply) => {
    const { serviceId } = req.params as { serviceId: string };
    const session = registry.resolve(serviceId);
    if (!session) return reply.code(404).send({ error: 'not_found' });
    return { service: session.state };
  });

  /** List downloadable recording assets for a service. */
  fastify.get('/services/:serviceId/recordings', async (req, reply) => {
    const { serviceId } = req.params as { serviceId: string };
    const session = registry.resolve(serviceId);
    if (!session) return reply.code(404).send({ error: 'not_found' });
    const langs = session.recorder.listLanguages();
    return {
      sourceLanguage: session.state.config.sourceLanguage,
      targetLanguages: langs,
      // Public download URLs are exposed below.
    };
  });

  fastify.get('/services/:serviceId/recordings/:lang.wav', async (req, reply) => {
    const { serviceId, lang } = req.params as { serviceId: string; lang: string };
    const session = registry.resolve(serviceId);
    if (!session) return reply.code(404).send({ error: 'not_found' });
    const wav = await session.recorder.wavFor(lang as any);
    if (!wav) return reply.code(404).send({ error: 'no_audio' });
    reply
      .header('Content-Type', 'audio/wav')
      .header('Content-Disposition', `attachment; filename="${serviceId}-${lang}.wav"`);
    return reply.send(wav);
  });

  fastify.get('/services/:serviceId/recordings/:lang.srt', async (req, reply) => {
    const { serviceId, lang } = req.params as { serviceId: string; lang: string };
    const session = registry.resolve(serviceId);
    if (!session) return reply.code(404).send({ error: 'not_found' });
    const srt = session.recorder.srtFor(lang === session.state.config.sourceLanguage ? 'source' : (lang as any));
    reply
      .header('Content-Type', 'application/x-subrip; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${serviceId}-${lang}.srt"`);
    return reply.send(srt);
  });

  fastify.get('/services/:serviceId/recordings/:lang.vtt', async (req, reply) => {
    const { serviceId, lang } = req.params as { serviceId: string; lang: string };
    const session = registry.resolve(serviceId);
    if (!session) return reply.code(404).send({ error: 'not_found' });
    const vtt = session.recorder.vttFor(lang === session.state.config.sourceLanguage ? 'source' : (lang as any));
    reply
      .header('Content-Type', 'text/vtt; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${serviceId}-${lang}.vtt"`);
    return reply.send(vtt);
  });

  /**
   * Operator WebSocket. Wire protocol:
   *
   *   Text frame in : JSON OperatorMessage (see @rtv/shared/messages)
   *   Binary in     : PCM16 LE 16kHz mono audio frames (raw, no header)
   *   Text frame out: JSON OrchestratorMessage
   *   Binary out    : per-language PCM16 audio (see service-session.ts header)
   */
  fastify.get('/ws/operator/:serviceId', { websocket: true }, (socket, req) => {
    const { serviceId } = req.params as { serviceId: string };
    const session = registry.get(serviceId);
    if (!session) {
      socket.send(JSON.stringify({ type: 'error', message: 'service_not_found' }));
      socket.close(4404, 'service not found');
      return;
    }
    log.info({ serviceId }, 'operator socket connected');
    session.attachOperator(socket);

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = data as Buffer;
        session.appendInputAudio(buf);
        return;
      }
      let msg: OperatorMessage;
      try {
        msg = JSON.parse(data.toString()) as OperatorMessage;
      } catch {
        return;
      }
      handleOperatorMessage(serviceId, msg).catch((err) => log.error({ err }, 'op msg failed'));
    });

    socket.on('close', () => {
      log.info({ serviceId }, 'operator socket closed');
      session.detachOperator(socket);
    });

    socket.on('error', (err) => log.error({ err }, 'operator ws error'));
  });

  async function handleOperatorMessage(serviceId: string, msg: OperatorMessage) {
    const session = registry.get(serviceId);
    if (!session) return;
    switch (msg.type) {
      case 'hello':
        break;
      case 'start':
        await session.start();
        break;
      case 'pause':
        session.pause();
        break;
      case 'resume':
        session.resume();
        break;
      case 'stop':
        await session.stop();
        break;
      case 'cap.raise':
        session.raiseCap(msg.addUSD);
        break;
      case 'audio.meta':
        // Track expected sample rate, currently informational.
        log.debug({ serviceId, meta: msg }, 'audio meta');
        break;
    }
  }

  fastify.listen({ port: e.ORCHESTRATOR_PORT, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      log.error({ err }, 'failed to start orchestrator');
      process.exit(1);
    }
    log.info({ address }, 'orchestrator listening');
  });
}

main().catch((err) => {
  log.error({ err }, 'fatal');
  process.exit(1);
});
