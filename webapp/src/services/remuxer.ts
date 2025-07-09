/**
 * ffmpeg.wasm wrapper for browser-side video operations.
 *
 * - tsToMp4: remux MPEG-TS to fragmented MP4 with no re-encoding so
 *   <video> tags can play it and seeking works.
 * - trim: cut a clip to [start, end] seconds (re-encodes only when the cut
 *   doesn't fall on a keyframe).
 * - concat: stitch multiple MP4 clips into one MP4 file using the demuxer
 *   concat protocol, again without re-encoding when possible.
 *
 * The ffmpeg instance is lazily loaded on first use (the WASM core is ~30 MB
 * and is fetched from a CDN, then cached as a Blob URL).
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// IMPORTANT: we must serve the ESM core (dist/esm), not UMD. Vite bundles
// @ffmpeg/ffmpeg's worker as a *module* worker, which loads the core via
// `(await import(coreURL)).default`. Only the ESM build has that default
// export; the UMD build doesn't, so it fails with "failed to import
// ffmpeg-core.js" / "Cannot find module 'blob:...'". This matches the
// official @ffmpeg/ffmpeg usage example.

// The ffmpeg core (~32 MB wasm) is served SAME-ORIGIN from `/ffmpeg/*`,
// which both dev and prod proxy to jsDelivr:
//   - dev:  Vite proxy (see vite.config.ts)
//   - prod: Cloudflare Pages Function (functions/ffmpeg/[[path]].ts)
// Same-origin loading dodges adblockers (which block direct unpkg/jsdelivr
// fetches) AND keeps the 32 MB wasm out of the Pages build, which has a
// 25 MiB per-file limit. Direct CDNs remain as a last-ditch fallback.
const CORE_VERSION = '0.12.10';
const CORE_BASES = [
  '/ffmpeg',
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`,
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`,
];

export type FFmpegStage = 'idle' | 'loading' | 'ready' | 'failed';

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
let stage: FFmpegStage = 'idle';
let stageError: string | null = null;

const progressListeners = new Set<(p: number) => void>();
const logListeners = new Set<(msg: string) => void>();
const stageListeners = new Set<(s: FFmpegStage, err: string | null) => void>();

function setStage(next: FFmpegStage, err: string | null = null) {
  stage = next;
  stageError = err;
  for (const cb of stageListeners) cb(next, err);
}

export function getFFmpegStage(): { stage: FFmpegStage; error: string | null } {
  return { stage, error: stageError };
}

export function onFFmpegProgress(cb: (p: number) => void): () => void {
  progressListeners.add(cb);
  return () => { progressListeners.delete(cb); };
}
export function onFFmpegLog(cb: (msg: string) => void): () => void {
  logListeners.add(cb);
  return () => { logListeners.delete(cb); };
}
export function onFFmpegStage(cb: (s: FFmpegStage, err: string | null) => void): () => void {
  stageListeners.add(cb);
  cb(stage, stageError);
  return () => { stageListeners.delete(cb); };
}

async function loadFromBase(ff: FFmpeg, base: string): Promise<void> {
  // toBlobURL fetches the core + wasm and wraps them as blob: URLs so the
  // worker ffmpeg-core spawns can reference them regardless of origin.
  // Version query busts browser/edge HTTP caches when the core build changes
  // (these responses are served immutable + 1yr). The proxy drops the query
  // before hitting the upstream CDN, and the CDNs ignore unknown params, so
  // it only affects the cache key — exactly what we want. Bump CORE_VERSION
  // or the `-esm` tag to force a refetch.
  const v = `?b=${CORE_VERSION}-esm`;
  const coreURL = await toBlobURL(`${base}/ffmpeg-core.js${v}`, 'text/javascript');
  const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm${v}`, 'application/wasm');
  await ff.load({ coreURL, wasmURL });
}

async function getFFmpeg(): Promise<FFmpeg> {
  if (instance) return instance;
  if (loading) return loading;

  setStage('loading');
  loading = (async () => {
    const ff = new FFmpeg();
    ff.on('progress', ({ progress }) => {
      for (const cb of progressListeners) cb(Math.max(0, Math.min(1, progress)));
    });
    ff.on('log', ({ message }) => {
      // eslint-disable-next-line no-console
      console.log('[ffmpeg]', message);
      for (const cb of logListeners) cb(message);
    });

    const LOAD_TIMEOUT_MS = 60_000;
    let lastErr: unknown = null;

    // CORE_BASES[0] is same-origin '/ffmpeg' (proxied to jsDelivr by Vite in
    // dev and a Pages Function in prod). The remaining entries are direct
    // CDN fallbacks if the proxy is somehow unavailable.
    for (const base of CORE_BASES) {
      try {
        await withTimeout(loadFromBase(ff, base), LOAD_TIMEOUT_MS, `load from ${base}`);
        instance = ff;
        setStage('ready');
        // eslint-disable-next-line no-console
        console.log('[ffmpeg] loaded from', base);
        return ff;
      } catch (err) {
        lastErr = err;
        // eslint-disable-next-line no-console
        console.warn('[ffmpeg] failed to load from', base, err);
      }
    }

    loading = null;
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    setStage('failed', msg);
    throw new Error(`ffmpeg load failed: ${msg}`);
  })();
  return loading;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export async function preloadFFmpeg(): Promise<void> {
  await getFFmpeg();
}

let opCounter = 0;
function nextId(): string {
  opCounter += 1;
  return `${Date.now()}_${opCounter}`;
}

export async function tsToMp4(tsBlob: Blob): Promise<Blob> {
  const ff = await getFFmpeg();
  const id = nextId();
  const inName = `in_${id}.ts`;
  const outName = `out_${id}.mp4`;
  await ff.writeFile(inName, await fetchFile(tsBlob));
  // -fflags +genpts rebuilds timestamps lost in mid-stream TS concat.
  // -movflags +faststart puts the moov atom at the front for browser playback.
  let code = -1;
  try {
    code = await ff.exec([
      '-fflags', '+genpts+igndts',
      '-i', inName,
      '-c', 'copy',
      '-bsf:a', 'aac_adtstoasc',
      '-movflags', '+faststart',
      outName,
    ]);
  } catch (e) {
    console.warn('[tsToMp4] copy-codec failed, falling back to re-encode', e);
  }

  // Fallback: re-encode if stream copy fails (often happens when the slice
  // doesn't start on a keyframe).
  if (code !== 0) {
    try { await ff.deleteFile(outName); } catch {}
    code = await ff.exec([
      '-fflags', '+genpts+igndts',
      '-i', inName,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      outName,
    ]);
    if (code !== 0) {
      await safeDelete(ff, [inName, outName]);
      throw new Error(`ffmpeg exit ${code}`);
    }
  }

  const data = await ff.readFile(outName);
  await safeDelete(ff, [inName, outName]);
  return new Blob([new Uint8Array(data as Uint8Array)], { type: 'video/mp4' });
}

async function safeDelete(ff: FFmpeg, names: string[]): Promise<void> {
  for (const n of names) { try { await ff.deleteFile(n); } catch {} }
}

export interface TrimOptions {
  fadeInSec?: number;
  fadeOutSec?: number;
}

export async function trimMp4(
  mp4Blob: Blob,
  startSec: number,
  endSec: number,
  opts: TrimOptions = {},
): Promise<Blob> {
  const fIn = Math.max(0, opts.fadeInSec ?? 0);
  const fOut = Math.max(0, opts.fadeOutSec ?? 0);
  const needsReencode = fIn > 0.01 || fOut > 0.01;

  // Fast path: stream-copy trim. No re-encode, runs in well under a second
  // even on long clips. Cuts snap to the nearest keyframe at-or-before the
  // requested start (Twitch HLS keyframes are ~2 s apart), so a request to
  // trim at 2.7 s may actually start at 2.0 s. Skip this path when fades
  // are requested — fade filters require the decoded frames.
  if (!needsReencode) {
    try {
      return await copyTrim(mp4Blob, startSec, endSec);
    } catch (err) {
      console.warn('[trim] copy path failed, re-encoding:', err);
    }
  }
  return reencodeTrim(mp4Blob, startSec, endSec, fIn, fOut);
}

async function copyTrim(mp4Blob: Blob, startSec: number, endSec: number): Promise<Blob> {
  const ff = await getFFmpeg();
  const id = nextId();
  const inName = `in_${id}.mp4`;
  const outName = `out_${id}.mp4`;
  await ff.writeFile(inName, await fetchFile(mp4Blob));
  const dur = Math.max(0.1, endSec - startSec);
  try {
    const code = await ff.exec([
      '-ss', String(startSec),     // -ss BEFORE -i = fast keyframe seek
      '-i', inName,
      '-t', String(dur),
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      '-movflags', '+faststart',
      outName,
    ]);
    if (code !== 0) throw new Error(`copy-trim exit ${code}`);
    const data = await ff.readFile(outName);
    return new Blob([new Uint8Array(data as Uint8Array)], { type: 'video/mp4' });
  } finally {
    await safeDelete(ff, [inName, outName]);
  }
}

async function reencodeTrim(
  mp4Blob: Blob,
  startSec: number,
  endSec: number,
  fIn: number,
  fOut: number,
): Promise<Blob> {
  const ff = await getFFmpeg();
  const id = nextId();
  const inName = `in_${id}.mp4`;
  const outName = `out_${id}.mp4`;
  await ff.writeFile(inName, await fetchFile(mp4Blob));
  const dur = Math.max(0.1, endSec - startSec);
  const fadeIn = Math.min(fIn, dur / 2);
  const fadeOut = Math.min(fOut, dur / 2);
  const fadeOutStart = Math.max(0, dur - fadeOut);

  const vf: string[] = [];
  const af: string[] = [];
  if (fadeIn > 0) {
    vf.push(`fade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
    af.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
  }
  if (fadeOut > 0) {
    vf.push(`fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOut.toFixed(3)}`);
    af.push(`afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOut.toFixed(3)}`);
  }

  const args = ['-ss', String(startSec), '-i', inName, '-t', String(dur)];
  if (vf.length) args.push('-vf', vf.join(','));
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22');
  if (af.length) args.push('-af', af.join(','));
  args.push('-c:a', 'aac', '-movflags', '+faststart', outName);

  try {
    const code = await ff.exec(args);
    if (code !== 0) throw new Error(`reencode-trim exit ${code}`);
    const data = await ff.readFile(outName);
    return new Blob([new Uint8Array(data as Uint8Array)], { type: 'video/mp4' });
  } finally {
    await safeDelete(ff, [inName, outName]);
  }
}

export async function concatMp4(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 0) throw new Error('no clips to concat');
  if (blobs.length === 1) return blobs[0];

  // Fast path: stream-copy concat. Works when every input shares codec /
  // profile / pixel format / sample rate — true by construction when all
  // clips were captured from the same Twitch HLS variant in one session.
  try {
    return await copyConcat(blobs);
  } catch (err) {
    console.warn('[concat] copy path failed, re-encoding:', err);
  }
  return reencodeConcat(blobs);
}

async function copyConcat(blobs: Blob[]): Promise<Blob> {
  const ff = await getFFmpeg();
  const id = nextId();
  const names: string[] = [];
  for (let i = 0; i < blobs.length; i++) {
    const n = `seg_${id}_${i}.mp4`;
    await ff.writeFile(n, await fetchFile(blobs[i]));
    names.push(n);
  }
  const listName = `list_${id}.txt`;
  await ff.writeFile(listName, new TextEncoder().encode(names.map((n) => `file '${n}'`).join('\n')));
  const outName = `out_${id}.mp4`;
  try {
    const code = await ff.exec([
      '-f', 'concat',
      '-safe', '0',
      '-i', listName,
      '-c', 'copy',
      '-movflags', '+faststart',
      outName,
    ]);
    if (code !== 0) throw new Error(`copy-concat exit ${code}`);
    const data = await ff.readFile(outName);
    return new Blob([new Uint8Array(data as Uint8Array)], { type: 'video/mp4' });
  } finally {
    for (const n of names) { try { await ff.deleteFile(n); } catch {} }
    try { await ff.deleteFile(listName); } catch {}
    try { await ff.deleteFile(outName); } catch {}
  }
}

async function reencodeConcat(blobs: Blob[]): Promise<Blob> {
  const ff = await getFFmpeg();
  const id = nextId();
  const names: string[] = [];
  for (let i = 0; i < blobs.length; i++) {
    const n = `seg_${id}_${i}.mp4`;
    await ff.writeFile(n, await fetchFile(blobs[i]));
    names.push(n);
  }
  const listName = `list_${id}.txt`;
  await ff.writeFile(listName, new TextEncoder().encode(names.map((n) => `file '${n}'`).join('\n')));
  const outName = `out_${id}.mp4`;
  try {
    const code = await ff.exec([
      '-f', 'concat',
      '-safe', '0',
      '-i', listName,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '22',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      outName,
    ]);
    if (code !== 0) throw new Error(`reencode-concat exit ${code}`);
    const data = await ff.readFile(outName);
    return new Blob([new Uint8Array(data as Uint8Array)], { type: 'video/mp4' });
  } finally {
    for (const n of names) { try { await ff.deleteFile(n); } catch {} }
    try { await ff.deleteFile(listName); } catch {}
    try { await ff.deleteFile(outName); } catch {}
  }
}

export function isFFmpegReady(): boolean {
  return instance !== null;
}
