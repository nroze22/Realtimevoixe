'use client';

import {
  ConnectionQuality,
  Room,
  RoomEvent,
  Track,
  type RemoteAudioTrack,
  type RemoteParticipant,
} from 'livekit-client';
import type { LanguageCode } from '@rtv/shared';

export interface ListenerCaption {
  kind: 'source' | 'target';
  lang: LanguageCode;
  text: string;
  tMs: number;
}

export interface ListenerCallbacks {
  onConnected: (availableLanguages: LanguageCode[]) => void;
  onLanguagesChanged: (availableLanguages: LanguageCode[]) => void;
  onAudioTrack: (lang: LanguageCode, track: RemoteAudioTrack) => void;
  onCaption: (caption: ListenerCaption) => void;
  onConnectionQuality: (q: 'excellent' | 'good' | 'poor' | 'lost' | 'unknown') => void;
  onError: (msg: string) => void;
  onDisconnected: () => void;
}

/**
 * Subscribes to the LiveKit room and discovers per-language audio tracks
 * (named "translation-<lang>"). The caller picks one to attach to its
 * <audio> element.
 */
export class ListenerSession {
  private room: Room | null = null;
  private trackByLang = new Map<LanguageCode, RemoteAudioTrack>();

  constructor(private readonly cb: ListenerCallbacks) {}

  async connect(url: string, token: string): Promise<void> {
    const room = new Room({
      adaptiveStream: true,
    });
    this.room = room;

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      this.handleTrack(track, publication.trackName ?? '', participant);
    });

    room.on(RoomEvent.TrackUnsubscribed, (_track, publication) => {
      const lang = parseLangFromName(publication.trackName ?? '');
      if (lang && this.trackByLang.has(lang)) {
        this.trackByLang.delete(lang);
        this.cb.onLanguagesChanged([...this.trackByLang.keys()]);
      }
    });

    room.on(RoomEvent.Disconnected, () => this.cb.onDisconnected());
    room.on(RoomEvent.ConnectionQualityChanged, (quality) => {
      this.cb.onConnectionQuality(translateQuality(quality));
    });

    room.on(RoomEvent.DataReceived, (payload) => {
      try {
        const text = new TextDecoder().decode(payload);
        const msg = JSON.parse(text);
        if (msg?.t === 'caption' && typeof msg.text === 'string') {
          this.cb.onCaption({
            kind: msg.kind === 'source' ? 'source' : 'target',
            lang: msg.lang as LanguageCode,
            text: msg.text,
            tMs: typeof msg.tMs === 'number' ? msg.tMs : 0,
          });
        }
      } catch {/* noop */}
    });

    await room.connect(url, token);

    // Walk existing publications.
    room.remoteParticipants.forEach((p) => {
      p.audioTrackPublications.forEach((pub) => {
        if (pub.track) this.handleTrack(pub.track, pub.trackName ?? '', p);
      });
    });

    this.cb.onConnected([...this.trackByLang.keys()]);
  }

  private handleTrack(track: Track, name: string, _participant: RemoteParticipant) {
    if (track.kind !== Track.Kind.Audio) return;
    const lang = parseLangFromName(name);
    if (!lang) return;
    const audioTrack = track as RemoteAudioTrack;
    this.trackByLang.set(lang, audioTrack);
    this.cb.onAudioTrack(lang, audioTrack);
    this.cb.onLanguagesChanged([...this.trackByLang.keys()]);
  }

  attachTo(lang: LanguageCode, element: HTMLMediaElement): void {
    const t = this.trackByLang.get(lang);
    if (!t) return;
    t.attach(element);
  }

  detachAll(element: HTMLMediaElement): void {
    for (const t of this.trackByLang.values()) {
      try { t.detach(element); } catch {/* noop */}
    }
  }

  async disconnect(): Promise<void> {
    if (!this.room) return;
    await this.room.disconnect();
    this.room = null;
    this.trackByLang.clear();
  }
}

function parseLangFromName(name: string): LanguageCode | null {
  if (!name.startsWith('translation-')) return null;
  return name.slice('translation-'.length) as LanguageCode;
}

function translateQuality(q: ConnectionQuality): 'excellent' | 'good' | 'poor' | 'lost' | 'unknown' {
  switch (q) {
    case ConnectionQuality.Excellent: return 'excellent';
    case ConnectionQuality.Good:      return 'good';
    case ConnectionQuality.Poor:      return 'poor';
    case ConnectionQuality.Lost:      return 'lost';
    default:                          return 'unknown';
  }
}
