import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import type { Moment } from '../App';
import { ClipAssembler } from '../services/clip-assembler';
import { trimMp4, concatMp4, onFFmpegProgress } from '../services/remuxer';
import { exportArchive, downloadArchive, importArchive } from '../services/archive';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import { tokens, radius, transition } from './ui/theme';
import { useViewport } from '../utils/use-viewport';

interface HighlightsEditorProps {
  moments: Moment[];
  channel: string;
  onClose: () => void;
  onDelete: (id: string) => void;
  onImportAdd: (moments: Moment[]) => void;
  onImportReplace: (moments: Moment[]) => void;
}

interface Trim { in: number; out: number }
interface Fade { in: number; out: number }

const DEFAULT_FADE_SEC = 0.4;
const MAX_FADE_SEC = 2.0;

export default function HighlightsEditor({
  moments, channel, onClose, onDelete, onImportAdd, onImportReplace,
}: HighlightsEditorProps) {
  // Chronological order for the editor: first-captured clip is the first
  // in the reel. Lets the user build a timeline from start to finish.
  const playable = useMemo(
    () => moments.filter((m) => m.clipMp4),
    [moments],
  );

  const [trims, setTrims] = useState<Record<string, Trim>>({});
  const [fades, setFades] = useState<Record<string, Fade>>({});
  const [autoFade, setAutoFade] = useState(true);
  const [orderIds, setOrderIds] = useState<string[]>(playable.map((m) => m.id));

  useEffect(() => {
    setTrims((prev) => {
      const next: Record<string, Trim> = {};
      for (const m of playable) {
        next[m.id] = prev[m.id] || { in: 0, out: m.durationSec };
      }
      return next;
    });
    setFades((prev) => {
      const next: Record<string, Fade> = {};
      for (const m of playable) {
        next[m.id] = prev[m.id] || { in: DEFAULT_FADE_SEC, out: DEFAULT_FADE_SEC };
      }
      return next;
    });
    setOrderIds((prev) => {
      const set = new Set(playable.map((m) => m.id));
      const kept = prev.filter((id) => set.has(id));
      const appended = playable.map((m) => m.id).filter((id) => !kept.includes(id));
      return [...kept, ...appended];
    });
  }, [playable]);

  const ordered = useMemo(
    () => orderIds.map((id) => playable.find((m) => m.id === id)).filter(Boolean) as Moment[],
    [orderIds, playable],
  );

  const [currentIdx, setCurrentIdx] = useState(0);
  const [playingAll, setPlayingAll] = useState(false);
  const [opacity, setOpacity] = useState(1);
  const videoRef = useRef<HTMLVideoElement>(null);
  const vp = useViewport();
  const mobile = vp === 'mobile';

  const current = ordered[currentIdx];
  const currentTrim = current ? trims[current.id] ?? { in: 0, out: current.durationSec } : null;
  const currentFade = current ? fades[current.id] ?? { in: 0, out: 0 } : null;

  const currentUrl = useMemo(
    () => (current?.clipMp4 ? URL.createObjectURL(current.clipMp4) : null),
    [current],
  );
  useEffect(() => () => { if (currentUrl) URL.revokeObjectURL(currentUrl); }, [currentUrl]);

  const onLoaded = () => {
    if (!videoRef.current || !currentTrim) return;
    videoRef.current.currentTime = currentTrim.in;
    videoRef.current.volume = (currentFade?.in ?? 0) > 0.05 ? 0 : 1;
  };
  const onTimeUpdate = () => {
    if (!videoRef.current || !currentTrim) return;
    const t = videoRef.current.currentTime;
    if (currentFade) {
      const relT = t - currentTrim.in;
      const clipDur = Math.max(0.01, currentTrim.out - currentTrim.in);
      let vol = 1;
      if (currentFade.in > 0.01 && relT < currentFade.in) {
        vol = Math.max(0, relT / currentFade.in);
      } else if (currentFade.out > 0.01 && relT > clipDur - currentFade.out) {
        vol = Math.max(0, (clipDur - relT) / currentFade.out);
      }
      videoRef.current.volume = Math.max(0, Math.min(1, vol));
    }
    if (t >= currentTrim.out) {
      if (playingAll) advance();
      else videoRef.current.pause();
    }
  };

  const advance = () => {
    setOpacity(0);
    window.setTimeout(() => {
      setCurrentIdx((i) => {
        if (i + 1 >= ordered.length) { setPlayingAll(false); return 0; }
        return i + 1;
      });
      setOpacity(1);
    }, 280);
  };

  useEffect(() => {
    if (playingAll && videoRef.current && currentTrim) {
      videoRef.current.currentTime = currentTrim.in;
      videoRef.current.play().catch(() => {});
    }
  }, [currentIdx, playingAll]);

  const playAll = () => {
    if (ordered.length === 0) return;
    setCurrentIdx(0); setPlayingAll(true);
    setOpacity(0); window.setTimeout(() => setOpacity(1), 80);
  };
  const stop = () => { setPlayingAll(false); videoRef.current?.pause(); };

  const updateTrim = (id: string, patch: Partial<Trim>) => {
    setTrims((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  };
  const updateFade = (id: string, patch: Partial<Fade>) => {
    setFades((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  };

  // ──────────────────────────── Export reel ────────────────────────────
  const [exporting, setExporting] = useState<{ stage: string; progress: number } | null>(null);
  useEffect(() => {
    const off = onFFmpegProgress((p) => {
      setExporting((s) => s ? { ...s, progress: p } : null);
    });
    return off;
  }, []);

  const exportReel = async () => {
    if (ordered.length === 0) return;
    setExporting({ stage: 'preparing', progress: 0 });
    try {
      const pieces: Blob[] = [];
      for (let i = 0; i < ordered.length; i++) {
        const m = ordered[i];
        const t = trims[m.id];
        const f = autoFade ? (fades[m.id] || { in: DEFAULT_FADE_SEC, out: DEFAULT_FADE_SEC }) : { in: 0, out: 0 };
        setExporting({ stage: `clip ${i + 1}/${ordered.length}`, progress: 0 });
        pieces.push(await trimMp4(m.clipMp4!, t.in, t.out, { fadeInSec: f.in, fadeOutSec: f.out }));
      }
      setExporting({ stage: 'stitching', progress: 0 });
      const out = await concatMp4(pieces);
      ClipAssembler.downloadClip(out, `highlights_reel_${Date.now()}`);
    } catch (err) {
      console.error('export failed', err);
    } finally {
      setExporting(null);
    }
  };

  // ──────────────────────────── Archive in/out ────────────────────────────
  const [exportingArchive, setExportingArchive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPrompt, setImportPrompt] = useState<{ moments: Moment[]; existing: number } | null>(null);

  const exportArchiveNow = async () => {
    if (moments.length === 0) return;
    setExportingArchive(true);
    try {
      const blob = await exportArchive(moments, channel);
      downloadArchive(blob, channel);
    } catch (e) {
      console.error('archive export failed', e);
    } finally {
      setExportingArchive(false);
    }
  };

  const onPickArchive = () => fileInputRef.current?.click();
  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-import of the same file
    if (!file) return;
    try {
      const result = await importArchive(file);
      if (result.moments.length === 0) {
        console.warn('archive contained no moments');
        return;
      }
      setImportPrompt({ moments: result.moments, existing: moments.length });
    } catch (err) {
      console.error('archive import failed', err);
      alert(`Couldn't import archive: ${(err as Error).message}`);
    }
  };

  const totalSec = ordered.reduce((s, m) => {
    const t = trims[m.id];
    return s + (t ? Math.max(0, t.out - t.in) : m.durationSec);
  }, 0);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      style={modalBackdrop(mobile)}
      onClick={onClose}
    >
      <motion.div
        initial={mobile ? { y: 24, opacity: 0 } : { scale: 0.96, y: 12 }}
        animate={mobile ? { y: 0, opacity: 1 } : { scale: 1, y: 0 }}
        exit={mobile ? { y: 24, opacity: 0 } : { scale: 0.96, y: 12 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        style={mobile ? {
          background: tokens.bg.base,
          width: '100%', height: '100%',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        } : {
          background: tokens.bg.base,
          border: `1px solid ${tokens.border.subtle}`,
          borderRadius: radius.lg,
          width: '100%', maxWidth: '1340px', height: '100%', maxHeight: '880px',
          display: 'grid',
          gridTemplateRows: 'auto minmax(0, 1fr) auto auto auto',
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
        }}
      >
        <Header onClose={onClose} mobile={mobile} count={ordered.length} totalSec={totalSec} />

        {mobile ? (
          <>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <PlayerArea
                url={currentUrl} videoRef={videoRef}
                onLoaded={onLoaded} onTimeUpdate={onTimeUpdate}
                opacity={opacity} current={current} mobile
              />
              {current && currentTrim && (
                <TrimRibbon
                  key={current.id}
                  durationSec={current.durationSec}
                  trim={currentTrim}
                  onChange={(t) => updateTrim(current.id, t)}
                  videoRef={videoRef}
                  accent={tokens.category[current.highlight.category] || tokens.brand}
                  mobile
                />
              )}
              {current && currentTrim && currentFade ? (
                <Inspector
                  moment={current} trim={currentTrim} fade={currentFade}
                  onTrim={(patch) => current && updateTrim(current.id, patch)}
                  onFade={(patch) => current && updateFade(current.id, patch)}
                  mobile onDelete={() => onDelete(current.id)}
                />
              ) : (
                <div style={{ padding: '16px', fontSize: '12.5px', color: tokens.text.muted }}>
                  select a clip in the timeline below to edit
                </div>
              )}
              <Timeline
                ordered={ordered} orderIds={orderIds} setOrderIds={setOrderIds}
                currentIdx={currentIdx}
                setCurrentIdx={(i) => { setCurrentIdx(i); setOpacity(1); }}
                trims={trims} fades={fades} autoFade={autoFade}
              />
            </div>
            <Controls
              ordered={ordered} totalSec={totalSec} playingAll={playingAll}
              onPlayAll={playAll} onStop={stop} onExport={exportReel}
              onExportArchive={exportArchiveNow} onImportArchive={onPickArchive}
              exporting={exporting} exportingArchive={exportingArchive}
              autoFade={autoFade} setAutoFade={setAutoFade} mobile
            />
          </>
        ) : (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 340px)',
              overflow: 'hidden',
              borderBottom: `1px solid ${tokens.border.subtle}`,
            }}>
              <PlayerArea
                url={currentUrl} videoRef={videoRef}
                onLoaded={onLoaded} onTimeUpdate={onTimeUpdate}
                opacity={opacity} current={current}
              />
              <Sidebar
                ordered={ordered} currentIdx={currentIdx}
                onSelect={(i) => { setCurrentIdx(i); setOpacity(1); }}
                onDelete={onDelete} current={current}
                trim={currentTrim} fade={currentFade}
                onTrim={(patch) => current && updateTrim(current.id, patch)}
                onFade={(patch) => current && updateFade(current.id, patch)}
              />
            </div>

            {current && currentTrim && (
              <TrimRibbon
                key={current.id}
                durationSec={current.durationSec}
                trim={currentTrim}
                onChange={(t) => updateTrim(current.id, t)}
                videoRef={videoRef}
                accent={tokens.category[current.highlight.category] || tokens.brand}
              />
            )}

            <Timeline
              ordered={ordered} orderIds={orderIds} setOrderIds={setOrderIds}
              currentIdx={currentIdx}
              setCurrentIdx={(i) => { setCurrentIdx(i); setOpacity(1); }}
              trims={trims} fades={fades} autoFade={autoFade}
            />

            <Controls
              ordered={ordered} totalSec={totalSec} playingAll={playingAll}
              onPlayAll={playAll} onStop={stop} onExport={exportReel}
              onExportArchive={exportArchiveNow} onImportArchive={onPickArchive}
              exporting={exporting} exportingArchive={exportingArchive}
              autoFade={autoFade} setAutoFade={setAutoFade}
            />
          </>
        )}
      </motion.div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".tsbz,.zip"
        onChange={onFileChosen}
        style={{ display: 'none' }}
      />

      <AnimatePresence>
        {importPrompt && (
          <ImportConfirm
            incoming={importPrompt.moments.length}
            existing={importPrompt.existing}
            onAdd={() => { onImportAdd(importPrompt.moments); setImportPrompt(null); }}
            onReplace={() => { onImportReplace(importPrompt.moments); setImportPrompt(null); }}
            onCancel={() => setImportPrompt(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ───────────────────────────── Subcomponents ─────────────────────────────

function Header({
  onClose, mobile, count, totalSec,
}: { onClose: () => void; mobile?: boolean; count?: number; totalSec?: number }) {
  return (
    <div style={{
      padding: mobile ? '12px 14px' : '14px 18px',
      borderBottom: `1px solid ${tokens.border.subtle}`,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      gap: '10px', flexShrink: 0,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: mobile ? '18px' : '22px',
          fontWeight: 700,
          letterSpacing: '-0.025em',
        }}>
          highlights editor
        </div>
        {mobile && count !== undefined && (
          <div style={{
            fontSize: '10.5px', color: tokens.text.muted,
            fontVariantNumeric: 'tabular-nums', marginTop: '1px',
          }}>
            {count} clip{count === 1 ? '' : 's'} · {(totalSec ?? 0).toFixed(1)}s out
          </div>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={onClose}>close</Button>
    </div>
  );
}

interface PlayerAreaProps {
  url: string | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  onLoaded: () => void;
  onTimeUpdate: () => void;
  opacity: number;
  current: Moment | undefined;
  mobile?: boolean;
}
function PlayerArea({ url, videoRef, onLoaded, onTimeUpdate, opacity, current, mobile }: PlayerAreaProps) {
  return (
    <div style={{
      minWidth: 0,
      position: 'relative',
      background: '#000',
      overflow: 'hidden',
      ...(mobile ? { width: '100%', aspectRatio: '16 / 9' } : null),
    }}>
      {url ? (
        <video
          key={current?.id}
          ref={videoRef}
          src={url}
          controls
          onLoadedMetadata={onLoaded}
          onTimeUpdate={onTimeUpdate}
          style={{
            width: '100%', height: '100%', objectFit: 'contain',
            opacity, transition: 'opacity 280ms ease',
          }}
        />
      ) : (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: tokens.text.muted, fontSize: '13px',
        }}>
          no clips ready yet
        </div>
      )}
      {current && (
        <div style={{
          position: 'absolute', top: 12, left: 12,
          background: 'rgba(0,0,0,0.55)',
          color: '#fff',
          padding: '5px 10px',
          borderRadius: radius.sm,
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '0.10em',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: tokens.category[current.highlight.category] || tokens.brand,
          }} />
          {current.highlight.category} · {new Date(current.highlight.timestamp).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

interface SidebarProps {
  ordered: Moment[];
  currentIdx: number;
  onSelect: (i: number) => void;
  onDelete: (id: string) => void;
  current: Moment | undefined;
  trim: Trim | null;
  fade: Fade | null;
  onTrim: (patch: Partial<Trim>) => void;
  onFade: (patch: Partial<Fade>) => void;
}
function Sidebar({
  ordered, currentIdx, onSelect, onDelete,
  current, trim, fade, onTrim, onFade,
}: SidebarProps) {
  return (
    <div style={{
      minWidth: 0,
      borderLeft: `1px solid ${tokens.border.subtle}`,
      display: 'grid',
      gridTemplateRows: 'auto minmax(0, 1fr) auto',
      background: tokens.bg.surface,
    }}>
      <div style={sectionHeader()}>
        all clips
        <span style={{ color: tokens.text.muted, marginLeft: '6px' }}>{ordered.length}</span>
      </div>

      <div style={{
        position: 'relative',
        minHeight: 0,
        borderBottom: `1px solid ${tokens.border.subtle}`,
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          overflowY: 'auto',
          padding: '6px 8px',
        }}>
          {ordered.length === 0 ? (
            <p style={{ color: tokens.text.muted, fontSize: '12px', margin: '6px 4px' }}>
              clips appear here once they finish remuxing to mp4
            </p>
          ) : ordered.map((m, i) => {
            const c = tokens.category[m.highlight.category] || tokens.brand;
            const isCurrent = i === currentIdx;
            return (
              <div
                key={m.id}
                onClick={() => onSelect(i)}
                style={{
                  display: 'flex', gap: '8px', alignItems: 'center',
                  padding: '8px 10px',
                  marginBottom: '4px',
                  background: isCurrent ? tokens.bg.raised : 'transparent',
                  border: `1px solid ${isCurrent ? tokens.border.strong : 'transparent'}`,
                  borderRadius: radius.sm,
                  cursor: 'pointer',
                  transition: `background ${transition.fast}, border-color ${transition.fast}`,
                }}
              >
                <span style={{
                  fontSize: '10px', color: tokens.text.muted,
                  fontVariantNumeric: 'tabular-nums', width: '18px',
                }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span style={{
                  width: '7px', height: '7px', borderRadius: '50%',
                  background: c, flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '11px', fontWeight: 700,
                    color: c,
                    textTransform: 'uppercase',
                    letterSpacing: '0.10em',
                  }}>
                    {m.highlight.category}
                  </div>
                  <div style={{
                    fontSize: '10px', color: tokens.text.muted,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {new Date(m.highlight.timestamp).toLocaleTimeString()} · {m.durationSec.toFixed(1)}s
                  </div>
                </div>
                <IconButton
                  title="delete"
                  size={22}
                  onClick={(e) => { e.stopPropagation(); onDelete(m.id); }}
                >×</IconButton>
              </div>
            );
          })}
        </div>
      </div>

      {current && trim && fade ? (
        <Inspector moment={current} trim={trim} fade={fade} onTrim={onTrim} onFade={onFade} />
      ) : (
        <div style={{ padding: '14px', fontSize: '12px', color: tokens.text.muted }}>
          select a clip to edit
        </div>
      )}
    </div>
  );
}

interface InspectorProps {
  moment: Moment;
  trim: Trim;
  fade: Fade;
  onTrim: (patch: Partial<Trim>) => void;
  onFade: (patch: Partial<Fade>) => void;
  mobile?: boolean;
  onDelete?: () => void;
}
function Inspector({ moment, trim, fade, onTrim, onFade, mobile, onDelete }: InspectorProps) {
  const outSec = Math.max(0, trim.out - trim.in);
  const color = tokens.category[moment.highlight.category] || tokens.brand;
  return (
    <div style={{
      padding: mobile ? '14px' : '12px 14px',
      borderTop: `1px solid ${tokens.border.subtle}`,
      display: 'flex', flexDirection: 'column', gap: mobile ? '16px' : '12px',
      background: tokens.bg.base,
    }}>
      {mobile && onDelete ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: '12px', fontWeight: 700, color,
              textTransform: 'uppercase', letterSpacing: '0.10em',
            }}>
              {moment.highlight.category}
            </div>
            <div style={{ fontSize: '10.5px', color: tokens.text.muted, marginTop: '2px' }}>
              out {outSec.toFixed(1)}s of {moment.durationSec.toFixed(1)}s
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onDelete}>delete</Button>
        </div>
      ) : (
        <div>
          <Label>selected · out {outSec.toFixed(1)}s of {moment.durationSec.toFixed(1)}s</Label>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <CompactSlider
          label="fade in"
          value={fade.in}
          onChange={(v) => onFade({ in: v })}
          max={MAX_FADE_SEC}
        />
        <CompactSlider
          label="fade out"
          value={fade.out}
          onChange={(v) => onFade({ out: v })}
          max={MAX_FADE_SEC}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <NumberField
          label="trim in"
          value={trim.in}
          onChange={(v) => onTrim({ in: Math.min(v, trim.out - 0.1) })}
          min={0} max={moment.durationSec} step={0.1}
        />
        <NumberField
          label="trim out"
          value={trim.out}
          onChange={(v) => onTrim({ out: Math.max(v, trim.in + 0.1) })}
          min={0} max={moment.durationSec} step={0.1}
        />
      </div>
    </div>
  );
}

function CompactSlider({
  label, value, onChange, max,
}: { label: string; value: number; onChange: (v: number) => void; max: number }) {
  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: '10px', color: tokens.text.muted,
        textTransform: 'uppercase', letterSpacing: '0.12em',
        marginBottom: '4px',
      }}>
        <span>{label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value.toFixed(2)}s</span>
      </div>
      <input
        type="range" min={0} max={max} step={0.05} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: tokens.brand }}
      />
    </div>
  );
}

function NumberField({
  label, value, onChange, min, max, step,
}: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number }) {
  return (
    <div>
      <div style={{
        fontSize: '10px', color: tokens.text.muted,
        textTransform: 'uppercase', letterSpacing: '0.12em',
        marginBottom: '4px',
      }}>{label}</div>
      <input
        type="number" value={value.toFixed(2)} min={min} max={max} step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
        style={{
          width: '100%', padding: '5px 7px',
          background: tokens.bg.raised,
          border: `1px solid ${tokens.border.default}`,
          borderRadius: radius.sm,
          color: tokens.text.primary, fontSize: '11.5px',
          fontFamily: 'inherit', outline: 'none',
          fontVariantNumeric: 'tabular-nums',
        }}
      />
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '10px', color: tokens.text.muted,
      textTransform: 'uppercase', letterSpacing: '0.14em',
    }}>
      {children}
    </div>
  );
}

function sectionHeader(): React.CSSProperties {
  return {
    padding: '12px 14px',
    fontSize: '10.5px', color: tokens.text.secondary,
    textTransform: 'uppercase', letterSpacing: '0.16em',
    borderBottom: `1px solid ${tokens.border.subtle}`,
  };
}

interface TimelineProps {
  ordered: Moment[];
  orderIds: string[];
  setOrderIds: (ids: string[]) => void;
  currentIdx: number;
  setCurrentIdx: (i: number) => void;
  trims: Record<string, Trim>;
  fades: Record<string, Fade>;
  autoFade: boolean;
}
function Timeline({
  ordered, orderIds, setOrderIds, currentIdx, setCurrentIdx,
  trims, fades, autoFade,
}: TimelineProps) {
  return (
    <div
      style={{
        borderTop: `1px solid ${tokens.border.subtle}`,
        padding: '10px 18px 12px',
        // Constrain the row to its grid cell width — without minWidth: 0 the
        // intrinsic max-content size of the inner Reorder.Group bleeds and
        // the modal expands instead of the timeline scrolling.
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{
        fontSize: '10px', color: tokens.text.muted,
        textTransform: 'uppercase', letterSpacing: '0.14em',
        marginBottom: '8px',
      }}>
        timeline · drag to reorder
      </div>
      {ordered.length === 0 ? (
        <div style={{ color: tokens.text.muted, fontSize: '12px', padding: '6px 0' }}>
          no clips
        </div>
      ) : (
        <div style={{
          width: '100%',
          overflowX: 'auto',
          overflowY: 'hidden',
        }}>
          <Reorder.Group
            axis="x"
            values={orderIds}
            onReorder={setOrderIds}
            style={{
              display: 'flex',
              gap: '6px',
              listStyle: 'none',
              padding: '0 0 8px',
              margin: 0,
              minHeight: '64px',
              // width: max-content forces the Reorder.Group to its content
              // size so the parent's overflow-x: auto produces a scrollbar
              // instead of squeezing children narrower.
              width: 'max-content',
            }}
          >
            {ordered.map((m, i) => (
              <TimelineBlock
                key={m.id}
                moment={m}
                index={i}
                isCurrent={i === currentIdx}
                trim={trims[m.id]}
                fade={autoFade ? fades[m.id] : { in: 0, out: 0 }}
                onClick={() => setCurrentIdx(i)}
              />
            ))}
          </Reorder.Group>
        </div>
      )}
    </div>
  );
}

interface TimelineBlockProps {
  moment: Moment;
  index: number;
  isCurrent: boolean;
  trim: Trim | undefined;
  fade: Fade | undefined;
  onClick: () => void;
}
function TimelineBlock({ moment, index, isCurrent, trim, fade, onClick }: TimelineBlockProps) {
  const color = tokens.category[moment.highlight.category] || tokens.brand;
  const outSec = trim ? Math.max(0, trim.out - trim.in) : moment.durationSec;
  const widthPx = Math.max(90, Math.min(220, 18 + outSec * 7));
  const fIn = fade?.in ?? 0;
  const fOut = fade?.out ?? 0;
  return (
    <Reorder.Item
      value={moment.id}
      whileDrag={{ scale: 1.04, zIndex: 5, boxShadow: '0 6px 18px rgba(0,0,0,0.4)' }}
      transition={{ type: 'spring', stiffness: 360, damping: 30 }}
      onClick={onClick}
      style={{
        listStyle: 'none',
        width: widthPx,
        background: isCurrent ? tokens.bg.raised : tokens.bg.surface,
        border: `1px solid ${isCurrent ? color : tokens.border.subtle}`,
        borderRadius: radius.sm,
        cursor: 'grab',
        userSelect: 'none',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div style={{
        height: '4px',
        background: `linear-gradient(90deg, transparent 0%, ${color} ${(fIn / Math.max(0.1, outSec) * 100).toFixed(1)}%, ${color} ${((1 - fOut / Math.max(0.1, outSec)) * 100).toFixed(1)}%, transparent 100%)`,
        opacity: 0.9,
      }} />
      <div style={{ padding: '6px 8px', flex: 1 }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          fontSize: '9px', color: tokens.text.muted, fontVariantNumeric: 'tabular-nums',
        }}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <span>{outSec.toFixed(1)}s</span>
        </div>
        <div style={{
          fontSize: '10.5px', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.10em',
          color, marginTop: '2px',
        }}>
          {moment.highlight.category}
        </div>
      </div>
    </Reorder.Item>
  );
}

interface ControlsProps {
  ordered: Moment[];
  totalSec: number;
  playingAll: boolean;
  onPlayAll: () => void;
  onStop: () => void;
  onExport: () => void;
  onExportArchive: () => void;
  onImportArchive: () => void;
  exporting: { stage: string; progress: number } | null;
  exportingArchive: boolean;
  autoFade: boolean;
  setAutoFade: (b: boolean) => void;
  mobile?: boolean;
}
function Controls({
  ordered, totalSec, playingAll, onPlayAll, onStop,
  onExport, onExportArchive, onImportArchive,
  exporting, exportingArchive, autoFade, setAutoFade, mobile,
}: ControlsProps) {
  const empty = ordered.length === 0;
  const fadeToggle = (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      fontSize: '10.5px', color: tokens.text.secondary, cursor: 'pointer',
      textTransform: 'uppercase', letterSpacing: '0.10em',
    }}>
      <input
        type="checkbox" checked={autoFade}
        onChange={(e) => setAutoFade(e.target.checked)}
        style={{ accentColor: tokens.brand, width: '15px', height: '15px' }}
      />
      fades on export
    </label>
  );

  if (mobile) {
    return (
      <div style={{
        borderTop: `1px solid ${tokens.border.subtle}`,
        padding: '12px 14px calc(12px + env(safe-area-inset-bottom))',
        display: 'flex', flexDirection: 'column', gap: '10px',
        background: tokens.bg.surface, flexShrink: 0,
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          {!playingAll ? (
            <Button variant="primary" fullWidth disabled={empty} onClick={onPlayAll}>play all</Button>
          ) : (
            <Button variant="ghost" fullWidth onClick={onStop}>pause</Button>
          )}
          <Button
            variant="primary" fullWidth
            disabled={empty || exporting !== null}
            loading={exporting !== null}
            loadingText={exporting ? `${exporting.stage} ${(exporting.progress * 100).toFixed(0)}%` : ''}
            onClick={onExport}
          >
            export reel
          </Button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <Button
            variant="soft" fullWidth
            disabled={empty || exportingArchive}
            loading={exportingArchive} loadingText="bundling"
            onClick={onExportArchive}
          >
            export archive
          </Button>
          <Button variant="soft" fullWidth onClick={onImportArchive}>import archive</Button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '2px' }}>{fadeToggle}</div>
      </div>
    );
  }

  return (
    <div style={{
      borderTop: `1px solid ${tokens.border.subtle}`,
      padding: '12px 18px',
      display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap',
    }}>
      {!playingAll ? (
        <Button variant="primary" disabled={empty} onClick={onPlayAll}>play all</Button>
      ) : (
        <Button variant="ghost" onClick={onStop}>pause</Button>
      )}
      <Button
        variant="ghost"
        disabled={empty || exporting !== null}
        loading={exporting !== null}
        loadingText={exporting ? `${exporting.stage} ${(exporting.progress * 100).toFixed(0)}%` : ''}
        onClick={onExport}
      >
        export mp4 reel
      </Button>
      <Button
        variant="soft"
        disabled={empty || exportingArchive}
        loading={exportingArchive}
        loadingText="bundling"
        onClick={onExportArchive}
      >
        export archive
      </Button>
      <Button variant="soft" onClick={onImportArchive}>import archive</Button>
      <div style={{ marginLeft: '4px' }}>{fadeToggle}</div>
      <span style={{
        fontSize: '11px', color: tokens.text.muted,
        marginLeft: 'auto', fontVariantNumeric: 'tabular-nums',
      }}>
        {ordered.length} clips · {totalSec.toFixed(1)}s out
      </span>
    </div>
  );
}

interface ImportConfirmProps {
  incoming: number;
  existing: number;
  onAdd: () => void;
  onReplace: () => void;
  onCancel: () => void;
}
function ImportConfirm({ incoming, existing, onAdd, onReplace, onCancel }: ImportConfirmProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
        zIndex: 1200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
      }}
    >
      <motion.div
        initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 12 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: tokens.bg.surface,
          border: `1px solid ${tokens.border.subtle}`,
          borderRadius: radius.lg,
          padding: '24px 26px',
          maxWidth: '440px',
          width: '100%',
        }}
      >
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: '18px', fontWeight: 700,
          letterSpacing: '-0.02em', marginBottom: '10px',
        }}>
          import {incoming} moments
        </div>
        <div style={{
          fontSize: '12.5px', color: tokens.text.secondary,
          lineHeight: 1.6, marginBottom: '20px',
        }}>
          {existing > 0
            ? `${existing} moments already in this session.`
            : `no moments in this session yet.`}
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onCancel}>cancel</Button>
          {existing > 0 && <Button variant="ghost" onClick={onReplace}>replace</Button>}
          <Button variant="primary" onClick={onAdd}>
            {existing > 0 ? 'add' : 'import'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────── Trim ribbon (unchanged behavior) ───────────────────────────────

interface TrimRibbonProps {
  durationSec: number;
  trim: Trim;
  onChange: (t: Partial<Trim>) => void;
  videoRef: React.RefObject<HTMLVideoElement>;
  accent: string;
  mobile?: boolean;
}
function TrimRibbon({ durationSec, trim, onChange, videoRef, accent, mobile }: TrimRibbonProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<'in' | 'out' | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [playT, setPlayT] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (videoRef.current) setPlayT(videoRef.current.currentTime);
    }, 80);
    return () => clearInterval(id);
  }, [videoRef]);

  const pxToSec = (px: number): number => {
    const el = wrapRef.current;
    if (!el) return 0;
    return Math.max(0, Math.min(durationSec, (px / el.clientWidth) * durationSec));
  };

  // Pointer events cover both mouse and touch, so trim handles drag on phones.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      if (!wrapRef.current) return;
      e.preventDefault();
      const r = wrapRef.current.getBoundingClientRect();
      const sec = pxToSec(e.clientX - r.left);
      if (drag === 'in') onChange({ in: Math.min(sec, trim.out - 0.5) });
      else onChange({ out: Math.max(sec, trim.in + 0.5) });
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  });

  const scrub = (e: React.PointerEvent) => {
    if (drag) return;
    if (!wrapRef.current || !videoRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    videoRef.current.currentTime = pxToSec(e.clientX - r.left);
  };
  const pct = (s: number) => (s / Math.max(0.001, durationSec)) * 100;
  const trackHeight = mobile ? 44 : 30;

  return (
    <div style={{
      padding: mobile ? '12px 14px 10px' : '10px 18px 6px',
      borderTop: `1px solid ${tokens.border.subtle}`,
      background: tokens.bg.base,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: '10px', color: tokens.text.muted,
        textTransform: 'uppercase', letterSpacing: '0.14em',
        marginBottom: mobile ? '8px' : '6px',
      }}>
        <span>trim {mobile ? '· drag handles' : ''}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {trim.in.toFixed(1)}s — {trim.out.toFixed(1)}s · ({Math.max(0, trim.out - trim.in).toFixed(1)}s out)
        </span>
      </div>
      <div
        ref={wrapRef}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHoverX(e.clientX - r.left);
        }}
        onMouseLeave={() => setHoverX(null)}
        onPointerDown={scrub}
        style={{
          position: 'relative', width: '100%', height: `${trackHeight}px`,
          background: 'repeating-linear-gradient(90deg, #18181b, #18181b 2px, #1c1c20 2px, #1c1c20 4px)',
          border: `1px solid ${tokens.border.subtle}`,
          borderRadius: radius.sm, cursor: 'pointer',
          touchAction: 'none',
        }}
      >
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct(trim.in)}%`, background: 'rgba(0,0,0,0.6)' }} />
        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${100 - pct(trim.out)}%`, background: 'rgba(0,0,0,0.6)' }} />
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${pct(trim.in)}%`,
          width: `${pct(trim.out) - pct(trim.in)}%`,
          border: `1px solid ${accent}`,
          boxShadow: `inset 0 0 0 1px ${accent}33`,
        }} />
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${pct(playT)}%`, width: '2px',
          background: '#fff', transition: 'left 80ms linear',
        }} />
        {hoverX !== null && !drag && !mobile && (
          <div style={{
            position: 'absolute', top: -16, left: hoverX, transform: 'translateX(-50%)',
            fontSize: '10px', color: tokens.text.secondary, fontVariantNumeric: 'tabular-nums',
            background: tokens.bg.base, padding: '1px 4px', borderRadius: '3px',
            border: `1px solid ${tokens.border.subtle}`, pointerEvents: 'none',
          }}>
            {pxToSec(hoverX).toFixed(1)}s
          </div>
        )}
        <TrimHandle pct={pct(trim.in)} accent={accent} onDown={() => setDrag('in')} mobile={mobile} />
        <TrimHandle pct={pct(trim.out)} accent={accent} onDown={() => setDrag('out')} mobile={mobile} />
      </div>
    </div>
  );
}

function TrimHandle({
  pct, accent, onDown, mobile,
}: { pct: number; accent: string; onDown: () => void; mobile?: boolean }) {
  // Visible grip stays slim; an invisible wider hit-zone makes it easy to grab
  // with a fingertip on touch screens.
  const grip = mobile ? 6 : 10;
  const hit = mobile ? 36 : 16;
  return (
    <div
      onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onDown(); }}
      style={{
        position: 'absolute', top: -4, bottom: -4,
        left: `${pct}%`, width: `${hit}px`, marginLeft: `${-hit / 2}px`,
        display: 'flex', alignItems: 'stretch', justifyContent: 'center',
        cursor: 'ew-resize', touchAction: 'none',
      }}
    >
      <div style={{
        width: `${grip}px`,
        background: accent, borderRadius: '3px',
        boxShadow: `0 0 0 2px ${tokens.bg.base}`,
      }} />
    </div>
  );
}

function modalBackdrop(mobile?: boolean): React.CSSProperties {
  return {
    position: 'fixed', inset: 0,
    background: tokens.bg.overlay, backdropFilter: 'blur(6px)',
    zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: mobile ? 0 : '24px',
  };
}
