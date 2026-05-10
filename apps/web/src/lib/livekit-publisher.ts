'use client';

import { Room, LocalAudioTrack, Track, type RoomOptions } from 'livekit-client';
import type { LanguageCode } from '@rtv/shared';

/**
 * Wraps a LiveKit Room as the operator-publisher participant. Each target
 * language gets its own published audio track named e.g. "translation-es",
 * which listener clients use to pick which language they hear.
 */
export class LivekitPublisher {
  private room: Room | null = null;
  private published = new Map<LanguageCode, LocalAudioTrack>();

  async connect(url: string, token: string): Promise<void> {
    const opts: RoomOptions = {
      adaptiveStream: false,
      dynacast: false,
      publishDefaults: {
        audioPreset: { maxBitrate: 32000 },
        dtx: false,
        red: true,
        forceStereo: false,
        stopMicTrackOnMute: false,
      },
    };
    const room = new Room(opts);
    await room.connect(url, token);
    this.room = room;
  }

  async publishLanguage(lang: LanguageCode, stream: MediaStream): Promise<void> {
    if (!this.room) throw new Error('not connected to LiveKit');
    if (this.published.has(lang)) return;

    const [mediaTrack] = stream.getAudioTracks();
    if (!mediaTrack) throw new Error('stream has no audio track');

    const localTrack = new LocalAudioTrack(mediaTrack, undefined, false);
    const publication = await this.room.localParticipant.publishTrack(localTrack, {
      name: `translation-${lang}`,
      source: Track.Source.Unknown,
      stream: 'translations',
    });

    // Tag publication with language so listeners can find it by metadata.
    void publication;
    this.published.set(lang, localTrack);
  }

  async disconnect(): Promise<void> {
    if (!this.room) return;
    for (const track of this.published.values()) {
      try { track.stop(); } catch {/* noop */}
    }
    this.published.clear();
    await this.room.disconnect();
    this.room = null;
  }
}
