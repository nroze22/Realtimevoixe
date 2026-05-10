import type { ServiceConfig } from '@rtv/shared';
import { generateJoinCode } from '@rtv/shared';
import { ServiceSession } from './service-session.js';

class Registry {
  private services = new Map<string, ServiceSession>();
  private byJoinCode = new Map<string, string>();

  get(serviceId: string): ServiceSession | undefined {
    return this.services.get(serviceId);
  }

  /** Resolve by service id or short join code. */
  resolve(idOrCode: string): ServiceSession | undefined {
    const direct = this.services.get(idOrCode);
    if (direct) return direct;
    const code = idOrCode.toUpperCase();
    const resolvedId = this.byJoinCode.get(code);
    if (resolvedId) return this.services.get(resolvedId);
    return undefined;
  }

  create(config: ServiceConfig): ServiceSession {
    const existing = this.services.get(config.serviceId);
    if (existing) return existing;
    const roomName = `svc-${config.serviceId}`;
    const joinCode = this.mintUniqueCode();
    const session = new ServiceSession(config, roomName, joinCode);
    session.on('ended', () => {
      // Keep around briefly so the UI can still pull final state and
      // download recordings.
      setTimeout(() => {
        this.services.delete(config.serviceId);
        this.byJoinCode.delete(joinCode);
        void session.recorder.destroy();
      }, 5 * 60_000);
    });
    this.services.set(config.serviceId, session);
    this.byJoinCode.set(joinCode, config.serviceId);
    return session;
  }

  list(): ServiceSession[] {
    return Array.from(this.services.values());
  }

  private mintUniqueCode(): string {
    for (let i = 0; i < 16; i++) {
      const code = generateJoinCode();
      if (!this.byJoinCode.has(code)) return code;
    }
    throw new Error('failed to mint unique join code');
  }
}

export const registry = new Registry();
