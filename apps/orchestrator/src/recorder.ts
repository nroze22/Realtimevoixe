import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { LanguageCode } from '@rtv/shared';
import { log } from './log.js';

const SAMPLE_RATE = 24_000; // gpt-realtime / gpt-realtime-translate output rate
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
/** Hard cap per language to keep disk bounded. ~90 min @ 24kHz mono PCM16. */
const MAX_BYTES_PER_LANG = SAMPLE_RATE * 2 * 90 * 60;

interface Caption {
  tMs: number;
  text: string;
}

interface LangRecording {
  pcmBytes: number;
  pcmStream: fs.WriteStream;
  pcmPath: string;
  captions: Caption[];
  /** Last byte offset we hinted fdatasync at — used for periodic flushes. */
  lastFsyncBytes: number;
}

/**
 * Streams translated PCM16 audio to a tmp file (raw PCM) and accumulates
 * caption events in memory. We rewrite a WAV header at finalize time.
 */
export class ServiceRecorder {
  private langs = new Map<LanguageCode, LangRecording>();
  private dir: string;
  /** Source-language captions (one stream, regardless of N targets). */
  private sourceCaptions: Caption[] = [];
  /** Hard-capped to avoid bloating memory; > this gets dropped. */
  private static MAX_CAPTIONS_PER_LANG = 5000;

  constructor(public readonly serviceId: string) {
    this.dir = path.join(os.tmpdir(), 'rtv-recordings', serviceId);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  appendAudio(lang: LanguageCode, pcm16: Buffer): void {
    let rec = this.langs.get(lang);
    if (!rec) {
      const pcmPath = path.join(this.dir, `${lang}.pcm`);
      rec = {
        pcmBytes: 0,
        pcmStream: fs.createWriteStream(pcmPath, { flags: 'w' }),
        pcmPath,
        captions: [],
        lastFsyncBytes: 0,
      };
      this.langs.set(lang, rec);
    }
    if (rec.pcmBytes >= MAX_BYTES_PER_LANG) return;
    const remaining = MAX_BYTES_PER_LANG - rec.pcmBytes;
    const chunk = pcm16.byteLength > remaining ? pcm16.subarray(0, remaining) : pcm16;
    rec.pcmStream.write(chunk);
    rec.pcmBytes += chunk.byteLength;

    // Periodic fsync hint — every ~5s of 24kHz mono PCM16 (~240KB) we flush
    // the OS buffer so a crash loses ≤5s of audio, not the whole service.
    if (rec.pcmBytes - rec.lastFsyncBytes >= 240_000) {
      rec.lastFsyncBytes = rec.pcmBytes;
      const fd = (rec.pcmStream as any).fd as number | undefined;
      if (typeof fd === 'number') {
        fs.fdatasync(fd, () => {/* best-effort */});
      }
    }
  }

  /** Mark a discontinuity in the audio + captions (e.g., translate-session restart). */
  markGap(lang: LanguageCode, tMs: number, reason: string): void {
    this.appendCaption('target', lang, tMs, `[${reason}]`);
  }

  appendCaption(kind: 'source' | 'target', lang: LanguageCode, tMs: number, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (kind === 'source') {
      if (this.sourceCaptions.length >= ServiceRecorder.MAX_CAPTIONS_PER_LANG) return;
      this.sourceCaptions.push({ tMs, text: trimmed });
      return;
    }
    let rec = this.langs.get(lang);
    if (!rec) {
      // Captions can arrive before audio; bootstrap the rec lazily.
      const pcmPath = path.join(this.dir, `${lang}.pcm`);
      rec = {
        pcmBytes: 0,
        pcmStream: fs.createWriteStream(pcmPath, { flags: 'w' }),
        pcmPath,
        captions: [],
        lastFsyncBytes: 0,
      };
      this.langs.set(lang, rec);
    }
    if (rec.captions.length >= ServiceRecorder.MAX_CAPTIONS_PER_LANG) return;
    rec.captions.push({ tMs, text: trimmed });
  }

  listLanguages(): LanguageCode[] {
    return Array.from(this.langs.keys());
  }

  /** Returns a WAV-formatted buffer for the given target language (or null). */
  async wavFor(lang: LanguageCode): Promise<Buffer | null> {
    const rec = this.langs.get(lang);
    if (!rec) return null;
    await new Promise<void>((resolve) => rec.pcmStream.end(resolve));
    let pcm: Buffer;
    try { pcm = await fs.promises.readFile(rec.pcmPath); }
    catch (err) { log.warn({ err }, 'failed to read pcm'); return null; }
    return wrapWav(pcm);
  }

  srtFor(lang: LanguageCode | 'source'): string {
    const caps = lang === 'source' ? this.sourceCaptions : (this.langs.get(lang)?.captions ?? []);
    return toSrt(caps);
  }

  vttFor(lang: LanguageCode | 'source'): string {
    const caps = lang === 'source' ? this.sourceCaptions : (this.langs.get(lang)?.captions ?? []);
    return toVtt(caps);
  }

  async finalize(): Promise<void> {
    for (const rec of this.langs.values()) {
      try { await new Promise<void>((resolve) => rec.pcmStream.end(resolve)); } catch {/* noop */}
    }
  }

  async destroy(): Promise<void> {
    await this.finalize();
    try { await fs.promises.rm(this.dir, { recursive: true, force: true }); } catch {/* noop */}
  }
}

// ---------- WAV header + caption formatting ----------

function wrapWav(pcm: Buffer): Buffer {
  const dataLen = pcm.byteLength;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);              // fmt chunk size
  header.writeUInt16LE(1, 20);               // PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE / 8, 28); // byte rate
  header.writeUInt16LE(CHANNELS * BITS_PER_SAMPLE / 8, 32);               // block align
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcm]);
}

function pad(n: number, w = 2): string { return String(n).padStart(w, '0'); }
function fmtSrtTs(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const t = Math.max(0, ms);
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const mss = t % 1000;
  return `${sign}${pad(h)}:${pad(m)}:${pad(s)},${pad(mss, 3)}`;
}
function fmtVttTs(ms: number): string {
  return fmtSrtTs(ms).replace(',', '.');
}

function toSrt(caps: Caption[]): string {
  if (caps.length === 0) return '';
  const lines: string[] = [];
  for (let i = 0; i < caps.length; i++) {
    const cur = caps[i]!;
    const next = caps[i + 1];
    const end = next ? next.tMs : cur.tMs + Math.max(2000, cur.text.length * 60);
    lines.push(String(i + 1));
    lines.push(`${fmtSrtTs(cur.tMs)} --> ${fmtSrtTs(end)}`);
    lines.push(cur.text);
    lines.push('');
  }
  return lines.join('\n');
}

function toVtt(caps: Caption[]): string {
  if (caps.length === 0) return 'WEBVTT\n';
  const lines: string[] = ['WEBVTT', ''];
  for (let i = 0; i < caps.length; i++) {
    const cur = caps[i]!;
    const next = caps[i + 1];
    const end = next ? next.tMs : cur.tMs + Math.max(2000, cur.text.length * 60);
    lines.push(`${fmtVttTs(cur.tMs)} --> ${fmtVttTs(end)}`);
    lines.push(cur.text);
    lines.push('');
  }
  return lines.join('\n');
}
