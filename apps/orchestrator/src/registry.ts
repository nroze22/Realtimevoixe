import type { ServiceConfig, LanguageCode } from '@rtv/shared';
import { ServiceSession } from './service-session.js';

class Registry {
  private services = new Map<string, ServiceSession>();

  get(serviceId: string): ServiceSession | undefined {
    return this.services.get(serviceId);
  }

  create(config: ServiceConfig): ServiceSession {
    const existing = this.services.get(config.serviceId);
    if (existing) return existing;
    const roomName = `svc-${config.serviceId}`;
    const session = new ServiceSession(config, roomName);
    session.on('ended', () => {
      // Keep around briefly so the UI can still query final state.
      setTimeout(() => this.services.delete(config.serviceId), 60_000);
    });
    this.services.set(config.serviceId, session);
    return session;
  }

  list(): ServiceSession[] {
    return Array.from(this.services.values());
  }
}

export const registry = new Registry();
