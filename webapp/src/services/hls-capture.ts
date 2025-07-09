/**
 * Background HLS capture for a live Twitch channel.
 *
 * Fetches Twitch's HLS playlist directly, polls for new .ts segments, and
 * keeps a rolling buffer of the last N seconds in memory. No screen share,
 * no user prompt, no tab visibility requirement, no re-encoding —
 * the clip output is source-quality MPEG-TS straight from Twitch's CDN.
 */

const TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const PLAYBACK_QUERY_HASH = '0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712';

// Twitch's GQL + usher endpoints don't allow CORS from non-twitch origins.
// Routed through same-origin proxies (Vite middleware in dev, Pages Functions
// in prod). Media playlists + segments live on rotating *.ttvnw.net hosts that
// 403 a non-twitch Origin, so those go through the generic /tw-media proxy.
const GQL_URL = '/tw-gql/gql';
function proxyUsher(url: string): string {
  return url.replace(/^https:\/\/usher\.ttvnw\.net/, '/tw-usher');
}
function proxyMedia(absoluteUrl: string): string {
  return `/tw-media?u=${encodeURIComponent(absoluteUrl)}`;
}

interface AccessToken {
  value: string;
  signature: string;
}

interface Segment {
  url: string;
  data: ArrayBuffer;
  duration: number;
}

async function fetchAccessToken(channel: string): Promise<AccessToken> {
  const body = {
    operationName: 'PlaybackAccessToken',
    extensions: { persistedQuery: { version: 1, sha256Hash: PLAYBACK_QUERY_HASH } },
    variables: {
      isLive: true,
      login: channel,
      isVod: false,
      vodID: '',
      // 'embed' often yields a playlist with fewer (or no) mid-roll ads —
      // the same trick the in-app TwitchPlayer iframe uses. 'site' is the
      // regular logged-in-on-twitch.tv context which gets full ads.
      playerType: 'embed',
    },
  };
  const res = await fetch(GQL_URL, {
    method: 'POST',
    headers: {
      'Client-ID': TWITCH_CLIENT_ID,
      'Content-Type': 'text/plain;charset=UTF-8',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`gql access token failed (${res.status})`);
  const json = await res.json();
  const token = json?.data?.streamPlaybackAccessToken;
  if (!token?.value || !token?.signature) {
    throw new Error('no access token in gql response (is the channel live?)');
  }
  return { value: token.value, signature: token.signature };
}

async function fetchMasterPlaylist(channel: string, token: AccessToken): Promise<string> {
  const params = new URLSearchParams({
    allow_source: 'true',
    allow_audio_only: 'true',
    fast_bread: 'true',
    p: String(Math.floor(Math.random() * 1_000_000)),
    player_backend: 'mediaplayer',
    playlist_include_framerate: 'true',
    reassignments_supported: 'true',
    sig: token.signature,
    token: token.value,
  });
  const url = proxyUsher(`https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8?${params.toString()}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`usher playlist failed (${res.status})`);
  return res.text();
}

function parseMasterPlaylist(m3u8: string): { variants: Array<{ url: string; quality: string }> } {
  const lines = m3u8.split('\n');
  const variants: Array<{ url: string; quality: string }> = [];
  let lastVideo = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXT-X-MEDIA:') && line.includes('TYPE=VIDEO')) {
      const m = /NAME="([^"]+)"/.exec(line);
      lastVideo = m ? m[1] : '';
    } else if (line.startsWith('http')) {
      variants.push({ url: line, quality: lastVideo || `variant-${variants.length}` });
    }
  }
  if (variants.length === 0) throw new Error('no media playlists found in master');
  return { variants };
}

function pickVariant(variants: Array<{ url: string; quality: string }>): { url: string; quality: string } {
  const source = variants.find((v) => /chunked|source|1080/i.test(v.quality));
  return source || variants[0];
}

function parseMediaPlaylist(text: string, playlistUrl: string): {
  segments: Array<{ url: string; duration: number }>;
  targetDuration: number;
  initUrl: string | null;
} {
  const lines = text.split('\n');
  const segments: Array<{ url: string; duration: number }> = [];
  let targetDuration = 2;
  let nextDuration = 2;
  let initUrl: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = parseFloat(line.split(':')[1]) || 2;
    } else if (line.startsWith('#EXT-X-MAP:')) {
      // Modern Twitch HLS serves fragmented MP4 (CMAF). Media segments are
      // unparseable without their init segment — extract it here.
      const m = /URI="([^"]+)"/.exec(line);
      if (m) initUrl = resolveUrl(m[1], playlistUrl);
    } else if (line.startsWith('#EXTINF:')) {
      nextDuration = parseFloat(line.split(':')[1].split(',')[0]) || targetDuration;
    } else if (line && !line.startsWith('#')) {
      segments.push({ url: resolveUrl(line, playlistUrl), duration: nextDuration });
      nextDuration = targetDuration;
    }
  }
  return { segments, targetDuration, initUrl };
}

function resolveUrl(target: string, base: string): string {
  try {
    return new URL(target, base).toString();
  } catch {
    return target;
  }
}

export interface HlsCaptureOptions {
  onError?: (err: Error) => void;
  onSegment?: (count: number, durationSec: number) => void;
}

export class HlsCapture {
  private channel: string;
  private bufferSeconds: number;
  private buffer: Segment[] = [];
  private seen = new Set<string>();
  private mediaPlaylistUrl: string | null = null;
  private targetDuration = 2;
  private pollTimer: number | null = null;
  private active = false;
  private opts: HlsCaptureOptions;
  /** Init segment bytes from #EXT-X-MAP, prepended to every clip blob. */
  private initSegment: Uint8Array | null = null;
  private initSegmentUrl: string | null = null;
  /** True if the source is fragmented MP4 (CMAF). False = MPEG-TS. */
  private isFragmentedMp4 = false;

  constructor(channel: string, bufferSeconds = 30, opts: HlsCaptureOptions = {}) {
    this.channel = channel.toLowerCase().replace(/^#/, '');
    this.bufferSeconds = bufferSeconds;
    this.opts = opts;
  }

  async start(): Promise<void> {
    const token = await fetchAccessToken(this.channel);
    const master = await fetchMasterPlaylist(this.channel, token);
    const { variants } = parseMasterPlaylist(master);
    this.mediaPlaylistUrl = pickVariant(variants).url;
    this.active = true;
    this.poll();
  }

  private async poll(): Promise<void> {
    if (!this.active || !this.mediaPlaylistUrl) return;
    try {
      // mediaPlaylistUrl is the REAL twitch url (kept real so relative segment
      // paths resolve correctly); we fetch it through the same-origin proxy.
      const res = await fetch(proxyMedia(this.mediaPlaylistUrl));
      if (!res.ok) throw new Error(`media playlist failed (${res.status})`);
      const { segments, targetDuration, initUrl } = parseMediaPlaylist(
        await res.text(),
        this.mediaPlaylistUrl,
      );
      this.targetDuration = targetDuration;

      // Fetch the init segment once (or re-fetch if Twitch rotates it).
      // Twitch inserts a new init segment after ad → content transitions,
      // and the old media segments are incompatible with the new init's
      // track headers. We drop the buffer when this happens so every slice
      // is guaranteed to be a coherent (init, …media…) sequence.
      if (initUrl && initUrl !== this.initSegmentUrl) {
        try {
          const initRes = await fetch(proxyMedia(initUrl));
          if (initRes.ok) {
            this.initSegment = new Uint8Array(await initRes.arrayBuffer());
            this.initSegmentUrl = initUrl;
            this.isFragmentedMp4 = true;
            if (this.buffer.length > 0) {
              console.log('[hls] init segment changed, flushing', this.buffer.length, 'old segments');
              this.buffer = [];
            }
          }
        } catch (err) {
          console.warn('[hls] init segment fetch failed', err);
        }
      }

      const fresh = segments.filter((s) => !this.seen.has(s.url));
      for (const seg of fresh) {
        this.seen.add(seg.url);
        try {
          const segRes = await fetch(proxyMedia(seg.url));
          if (!segRes.ok) continue;
          const data = await segRes.arrayBuffer();
          this.buffer.push({ url: seg.url, data, duration: seg.duration });
          this.trimBuffer();
          this.opts.onSegment?.(this.buffer.length, this.getBufferDuration());
        } catch {
          /* per-segment errors are normal during rotation; skip */
        }
      }
      if (this.seen.size > 500) {
        const arr = Array.from(this.seen).slice(-300);
        this.seen = new Set(arr);
      }
    } catch (err) {
      this.opts.onError?.(err as Error);
    } finally {
      if (this.active) {
        this.pollTimer = window.setTimeout(
          () => this.poll(),
          Math.max(1000, this.targetDuration * 500),
        );
      }
    }
  }

  private trimBuffer(): void {
    let total = 0;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      total += this.buffer[i].duration;
      if (total > this.bufferSeconds) {
        this.buffer = this.buffer.slice(i + 1);
        return;
      }
    }
  }

  /** Concatenates the init segment (if any) with the given segment data. */
  private packBlob(segs: Segment[]): Blob {
    const parts: BlobPart[] = [];
    if (this.initSegment) parts.push(new Uint8Array(this.initSegment));
    for (const s of segs) parts.push(s.data);
    const type = this.isFragmentedMp4 ? 'video/mp4' : 'video/MP2T';
    return new Blob(parts, { type });
  }

  getBuffer(): Blob | null {
    if (this.buffer.length === 0) return null;
    return this.packBlob(this.buffer);
  }

  /** True when the stream is fragmented MP4 (so clips end in .mp4 not .ts). */
  isFmp4(): boolean {
    return this.isFragmentedMp4;
  }

  /** How many seconds of media we currently have buffered. */
  getBufferedSec(): number {
    return this.buffer.reduce((s, seg) => s + seg.duration, 0);
  }

  /**
   * Return the last `seconds` of buffered video as a single TS blob.
   * Walks from the newest segment backwards until accumulated duration
   * meets the request, so clip length matches what was asked for.
   */
  getBufferSlice(seconds: number): { blob: Blob; durationSec: number } | null {
    if (this.buffer.length === 0) return null;
    const taken: Segment[] = [];
    let total = 0;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      taken.unshift(this.buffer[i]);
      total += this.buffer[i].duration;
      if (total >= seconds) break;
    }
    return { blob: this.packBlob(taken), durationSec: total };
  }

  getBufferDuration(): number {
    return this.buffer.reduce((sum, s) => sum + s.duration, 0);
  }

  getBufferSegmentCount(): number {
    return this.buffer.length;
  }

  isActive(): boolean {
    return this.active;
  }

  stop(): void {
    this.active = false;
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.buffer = [];
    this.seen.clear();
    this.initSegment = null;
    this.initSegmentUrl = null;
    this.isFragmentedMp4 = false;
  }

  setBufferLength(seconds: number): void {
    this.bufferSeconds = seconds;
    // If the buffer is now over budget, drop the oldest segments immediately
    // so the change is visible right away rather than only after rotation.
    this.trimBuffer();
  }

  /** Last segment-arrival timestamps so we can resolve absolute time ranges. */
  getSegmentWallClock(): { startMs: number; endMs: number } | null {
    if (this.buffer.length === 0) return null;
    const totalDur = this.buffer.reduce((s, seg) => s + seg.duration, 0) * 1000;
    const endMs = Date.now();
    return { startMs: endMs - totalDur, endMs };
  }

  /**
   * Return a slice covering the wall-clock range [startMs, endMs].
   * Walks segments oldest-to-newest, approximating each segment's time span
   * as duration relative to "now".
   */
  getBufferRange(startMs: number, endMs: number): { blob: Blob; durationSec: number } | null {
    if (this.buffer.length === 0) return null;
    const totalDur = this.buffer.reduce((s, seg) => s + seg.duration, 0);
    const bufferEndMs = Date.now();
    const bufferStartMs = bufferEndMs - totalDur * 1000;
    if (endMs < bufferStartMs || startMs > bufferEndMs) return null;
    const wantStart = Math.max(startMs, bufferStartMs);
    const wantEnd = Math.min(endMs, bufferEndMs);

    let cursorMs = bufferStartMs;
    const taken: Segment[] = [];
    for (const seg of this.buffer) {
      const segEndMs = cursorMs + seg.duration * 1000;
      // include the segment if it overlaps the requested range
      if (segEndMs > wantStart && cursorMs < wantEnd) taken.push(seg);
      cursorMs = segEndMs;
    }
    if (taken.length === 0) return null;
    const dur = taken.reduce((s, seg) => s + seg.duration, 0);
    return { blob: this.packBlob(taken), durationSec: dur };
  }
}
