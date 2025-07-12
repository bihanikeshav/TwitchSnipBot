/**
 * Moments archive export / import.
 *
 * Bundles a session's ready moments into a single .tsbz file (just a zip).
 * Contains a manifest.json + one mp4 file per moment. Round-trips cleanly:
 * exporting from session A and importing into session B reconstructs the
 * Moment objects with playable Blob refs.
 */
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { Moment } from '../App';
import type { DetectedHighlight } from './highlight-detector';

const ARCHIVE_VERSION = 1;
const MANIFEST_NAME = 'manifest.json';

interface ManifestMoment {
  id: string;
  highlight: DetectedHighlight;
  startTs: number;
  endTs: number;
  durationSec: number;
  clipFile: string;
}

interface Manifest {
  version: number;
  exportedAt: number;
  channel: string;
  moments: ManifestMoment[];
}

export async function exportArchive(moments: Moment[], channel: string): Promise<Blob> {
  const ready = moments.filter((m) => m.clipMp4);
  if (ready.length === 0) throw new Error('no ready clips to export');

  const files: Record<string, Uint8Array> = {};
  const manifestMoments: ManifestMoment[] = [];

  for (let i = 0; i < ready.length; i++) {
    const m = ready[i];
    const clipFile = `clip_${String(i + 1).padStart(4, '0')}.mp4`;
    const bytes = new Uint8Array(await m.clipMp4!.arrayBuffer());
    files[clipFile] = bytes;
    manifestMoments.push({
      id: m.id,
      highlight: m.highlight,
      startTs: m.startTs,
      endTs: m.endTs,
      durationSec: m.durationSec,
      clipFile,
    });
  }

  const manifest: Manifest = {
    version: ARCHIVE_VERSION,
    exportedAt: Date.now(),
    channel,
    moments: manifestMoments,
  };
  files[MANIFEST_NAME] = strToU8(JSON.stringify(manifest, null, 2));

  // No compression — mp4 video is already compressed and zip-deflate on it
  // wastes CPU for ~1 % size gain. `level: 0` = stored.
  const zipped = zipSync(files, { level: 0 });
  return new Blob([zipped], { type: 'application/zip' });
}

export function downloadArchive(blob: Blob, channel: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `twitchsnipbot_${channel}_${Date.now()}.tsbz`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

export interface ImportResult {
  channel: string;
  exportedAt: number;
  moments: Moment[];
}

export async function importArchive(file: File): Promise<ImportResult> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(buf);
  const manifestBytes = entries[MANIFEST_NAME];
  if (!manifestBytes) throw new Error('archive is missing manifest.json');

  let manifest: Manifest;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes));
  } catch (e) {
    throw new Error(`manifest.json is malformed: ${(e as Error).message}`);
  }
  if (manifest.version !== ARCHIVE_VERSION) {
    throw new Error(`unsupported archive version ${manifest.version}`);
  }

  const moments: Moment[] = manifest.moments.map((mm) => {
    const bytes = entries[mm.clipFile];
    if (!bytes) throw new Error(`archive missing clip file ${mm.clipFile}`);
    const blob = new Blob([new Uint8Array(bytes)], { type: 'video/mp4' });
    return {
      id: mm.id,
      highlight: mm.highlight,
      clipTs: null,
      clipMp4: blob,
      startTs: mm.startTs,
      endTs: mm.endTs,
      durationSec: mm.durationSec,
      state: 'ready' as const,
      remuxState: 'ready' as const,
    };
  });

  return { channel: manifest.channel, exportedAt: manifest.exportedAt, moments };
}
