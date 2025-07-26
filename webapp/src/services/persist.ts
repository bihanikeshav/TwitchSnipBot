/**
 * Per-channel session persistence via IndexedDB. Survives page reloads,
 * unlike React state which lives only in memory.
 *
 * IndexedDB stores Blobs natively — no base64, no copying — so a session's
 * MP4 clips round-trip with zero overhead. We strip the runtime-only
 * `clipTs` (raw HLS slice) since we always have the remuxed MP4, and we
 * normalize transient remuxState back to 'ready' since anything stored on
 * disk by definition finished its remux pipeline.
 */
import { set, get, del, keys } from 'idb-keyval';
import type { Moment } from '../App';

const PREFIX = 'snip:moments:';

interface StoredMoment {
  id: string;
  highlight: Moment['highlight'];
  clipMp4: Blob;
  startTs: number;
  endTs: number;
  durationSec: number;
}

function toStored(m: Moment): StoredMoment | null {
  if (!m.clipMp4) return null;
  return {
    id: m.id,
    highlight: m.highlight,
    clipMp4: m.clipMp4,
    startTs: m.startTs,
    endTs: m.endTs,
    durationSec: m.durationSec,
  };
}

function fromStored(s: StoredMoment): Moment {
  return {
    id: s.id,
    highlight: s.highlight,
    clipTs: null,
    clipMp4: s.clipMp4,
    startTs: s.startTs,
    endTs: s.endTs,
    durationSec: s.durationSec,
    state: 'ready',
    remuxState: 'ready',
  };
}

export async function saveMoments(channel: string, moments: Moment[]): Promise<void> {
  const stored = moments.map(toStored).filter((m): m is StoredMoment => m !== null);
  if (stored.length === 0) {
    await del(PREFIX + channel);
    return;
  }
  await set(PREFIX + channel, stored);
}

export async function loadMoments(channel: string): Promise<Moment[] | null> {
  const stored = (await get(PREFIX + channel)) as StoredMoment[] | undefined;
  if (!stored || stored.length === 0) return null;
  return stored.map(fromStored);
}

export async function clearChannel(channel: string): Promise<void> {
  await del(PREFIX + channel);
}

export interface StoredChannel {
  channel: string;
  count: number;
  bytes: number;
}

export async function listStoredChannels(): Promise<StoredChannel[]> {
  const allKeys = await keys();
  const result: StoredChannel[] = [];
  for (const k of allKeys) {
    if (typeof k !== 'string' || !k.startsWith(PREFIX)) continue;
    const channel = k.slice(PREFIX.length);
    const stored = (await get(k)) as StoredMoment[] | undefined;
    if (!stored) continue;
    const bytes = stored.reduce((s, m) => s + (m.clipMp4?.size || 0), 0);
    result.push({ channel, count: stored.length, bytes });
  }
  return result.sort((a, b) => a.channel.localeCompare(b.channel));
}

export async function clearAll(): Promise<void> {
  const allKeys = await keys();
  await Promise.all(
    allKeys
      .filter((k) => typeof k === 'string' && k.startsWith(PREFIX))
      .map((k) => del(k)),
  );
}

// ── CS mode (/cs): clips + auto-reconnect session ──
//
// CS clips are simpler than moments (just a tagged MP4 blob), and the live
// scoreboard/feed rebuilds itself from the scorebot on reconnect — so all we
// persist is the tagged clip blobs (IndexedDB) and the connection inputs
// (localStorage) so a refresh restores the session.

const CS_PREFIX = 'snip:cs-clips:';
const CS_SESSION_KEY = 'snip:cs-session';

export interface StoredCsClip {
  id: string;
  label: string;
  color: string;
  type: 'chat' | 'game' | 'manual';
  round: number | null;
  ts: number;
  mp4: Blob;
}

export async function saveCsClips(channel: string, clips: StoredCsClip[]): Promise<void> {
  if (clips.length === 0) { await del(CS_PREFIX + channel); return; }
  await set(CS_PREFIX + channel, clips);
}

export async function loadCsClips(channel: string): Promise<StoredCsClip[] | null> {
  const stored = (await get(CS_PREFIX + channel)) as StoredCsClip[] | undefined;
  return stored && stored.length ? stored : null;
}

export interface CsSession { hltvUrl: string; channel: string; }

export function saveCsSession(s: CsSession): void {
  try { localStorage.setItem(CS_SESSION_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export function loadCsSession(): CsSession | null {
  try {
    const v = localStorage.getItem(CS_SESSION_KEY);
    if (!v) return null;
    const s = JSON.parse(v) as CsSession;
    return s.hltvUrl && s.channel ? s : null;
  } catch { return null; }
}

export function clearCsSession(): void {
  try { localStorage.removeItem(CS_SESSION_KEY); } catch { /* ignore */ }
}

// ── Main app (/): channel for shareable URL + refresh auto-reconnect ──
const SESSION_KEY = 'snip:session';

export function saveSession(channel: string): void {
  try { localStorage.setItem(SESSION_KEY, channel); } catch { /* private mode */ }
}

export function loadSession(): string | null {
  try { return localStorage.getItem(SESSION_KEY) || null; } catch { return null; }
}

export function clearSession(): void {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}
