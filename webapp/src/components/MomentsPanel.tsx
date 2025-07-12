import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Moment } from '../App';
import { ClipAssembler } from '../services/clip-assembler';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import { tokens, radius, transition } from './ui/theme';

interface MomentsPanelProps {
  moments: Moment[];
  onDelete: (id: string) => void;
  onRetryRemux: (id: string) => void;
  onOpenEditor: () => void;
}

function MomentsPanelInner({ moments, onDelete, onRetryRemux, onOpenEditor }: MomentsPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Newest at top — when a new clip arrives, the user sees it immediately
  // and older clips push down out of view.
  const sorted = useMemo(() => [...moments].reverse(), [moments]);
  const playableCount = moments.filter((m) => m.clipMp4).length;

  const scrollRef = useRef<HTMLDivElement>(null);
  // When prepending (new clip at top) browser's overflow-anchor handles
  // keeping visible content stable if the user has scrolled down. No
  // manual auto-scroll needed.
  const totalBytes = moments.reduce((s, m) => s + ((m.clipMp4 || m.clipTs)?.size || 0), 0);

  // Show a fade + chevron at the bottom whenever there's more list below the
  // fold, so it's obvious the panel scrolls. Hidden once scrolled to the end.
  const [moreBelow, setMoreBelow] = useState(false);
  const recomputeFade = useCallback(() => {
    const el = scrollRef.current;
    setMoreBelow(!!el && el.scrollHeight - el.scrollTop - el.clientHeight > 8);
  }, []);
  useEffect(() => {
    recomputeFade();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(recomputeFade);
    ro.observe(el);
    return () => ro.disconnect();
  }, [recomputeFade, sorted.length, expandedId]);

  return (
    <div style={panelShell()}>
      <div style={panelHeader()}>
        <span style={panelTitle()}>
          Moments
          <span style={{ color: tokens.text.muted, marginLeft: '8px' }}>{moments.length}</span>
          {playableCount !== moments.length && (
            <span style={{ color: tokens.status.warn, marginLeft: '6px' }}>
              · {moments.length - playableCount} pending
            </span>
          )}
        </span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{
            fontSize: '11px', color: tokens.text.muted, fontVariantNumeric: 'tabular-nums',
          }}>
            {(totalBytes / 1024 / 1024).toFixed(1)} MB
          </span>
          <Button
            variant="primary"
            size="sm"
            disabled={playableCount === 0}
            onClick={onOpenEditor}
          >
            editor
          </Button>
        </div>
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div
          ref={scrollRef}
          onScroll={recomputeFade}
          className="scroll-hidden"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            // No visible scrollbar; wheel / touchpad / touch all still work.
            // Newest clips appear at the top via the sorted.reverse() above.
            overflowAnchor: 'auto',
            // Leave room so the last row isn't permanently hidden under the fade.
            paddingBottom: moreBelow ? '18px' : 0,
          }}
        >
          {sorted.length === 0 ? (
            <p style={{ color: tokens.text.muted, fontSize: '12px', margin: '8px 0 0' }}>
              no moments yet.
            </p>
          ) : (
            <AnimatePresence initial={false}>
              {sorted.map((m) => (
                <MomentRow
                  key={m.id}
                  moment={m}
                  expanded={expandedId === m.id}
                  onToggle={() => setExpandedId(expandedId === m.id ? null : m.id)}
                  onDelete={() => onDelete(m.id)}
                  onRetryRemux={() => onRetryRemux(m.id)}
                />
              ))}
            </AnimatePresence>
          )}
        </div>

        <AnimatePresence>
          {moreBelow && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              style={{
                position: 'absolute', left: 0, right: 0, bottom: 0,
                height: '44px',
                background: `linear-gradient(to top, ${tokens.bg.surface} 18%, transparent)`,
                pointerEvents: 'none',
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                paddingBottom: '4px',
              }}
            >
              <motion.span
                aria-hidden
                animate={{ y: [0, 2, 0] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  fontSize: '12px', lineHeight: 1, color: tokens.text.muted,
                  textShadow: `0 0 6px ${tokens.bg.surface}`,
                }}
              >
                ⌄
              </motion.span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

interface MomentRowProps {
  moment: Moment;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onRetryRemux: () => void;
}
function MomentRow({ moment, expanded, onToggle, onDelete, onRetryRemux }: MomentRowProps) {
  const color = tokens.category[moment.highlight.category] || tokens.brand;
  const playable = moment.clipMp4;
  const sliceReady = moment.state === 'ready' && moment.clipTs;
  const failed = moment.state === 'failed';
  const remuxing = sliceReady && moment.remuxState === 'remuxing';
  const remuxFailed = sliceReady && moment.remuxState === 'failed';
  const time = new Date(moment.highlight.timestamp).toLocaleTimeString();

  const previewUrl = useMemo(
    () => (playable ? URL.createObjectURL(playable) : null),
    [playable],
  );
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const download = (e: React.MouseEvent) => {
    e.stopPropagation();
    const blob = playable || moment.clipTs;
    if (blob) {
      ClipAssembler.downloadClip(blob, `moment_${moment.highlight.category}_${moment.highlight.timestamp}`);
    }
  };
  const remove = (e: React.MouseEvent) => { e.stopPropagation(); onDelete(); };

  const [hover, setHover] = useState(false);
  const clipBlob = playable || moment.clipTs;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      transition={{ type: 'spring', stiffness: 340, damping: 28 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: tokens.bg.base,
        border: `1px solid ${hover && playable ? tokens.border.default : tokens.border.subtle}`,
        borderRadius: radius.sm,
        overflow: 'hidden',
        transition: `border-color ${transition.fast}`,
        // CRITICAL: rows are flex children of a column flex parent. Default
        // flex-shrink: 1 would compress each row when the parent has many
        // children, clipping the second line of stats inside each row's
        // overflow:hidden. Locking shrink to 0 keeps natural height and
        // lets the parent's overflow:auto produce a real scroll instead.
        flexShrink: 0,
      }}
    >
      <div
        onClick={playable ? onToggle : undefined}
        style={{
          padding: '10px 12px',
          cursor: playable ? 'pointer' : 'default',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CategoryDot color={color} />
            <span style={{
              fontSize: '11px', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.10em',
              color,
            }}>
              {moment.highlight.category}
            </span>
            <span style={{ fontSize: '11px', color: tokens.text.muted, fontVariantNumeric: 'tabular-nums' }}>
              {time}
            </span>
            {moment.state === 'capturing' && <StatusPill color={tokens.status.warn}>waiting for calm</StatusPill>}
            {remuxing && <StatusPill color={tokens.status.warn}>remuxing</StatusPill>}
            {remuxFailed && <StatusPill color={tokens.status.bad}>remux failed · ts only</StatusPill>}
            {failed && <StatusPill color={tokens.status.bad}>capture failed</StatusPill>}
          </div>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            {remuxFailed && (
              <IconButton
                title="retry mp4 remux"
                size={22}
                onClick={(e) => { e.stopPropagation(); onRetryRemux(); }}
              >
                ↻
              </IconButton>
            )}
            {clipBlob && (
              <>
                <span style={{
                  fontSize: '10px', color: tokens.text.muted,
                  fontVariantNumeric: 'tabular-nums',
                  marginRight: '2px',
                }}>
                  {moment.durationSec.toFixed(0)}s · {(clipBlob.size / 1024 / 1024).toFixed(1)}MB
                </span>
                <IconButton title="download" onClick={download} size={22}>↓</IconButton>
              </>
            )}
            <IconButton title="delete" onClick={remove} size={22}>×</IconButton>
          </div>
        </div>
        <div style={{
          fontSize: '11px', color: tokens.text.secondary,
          fontVariantNumeric: 'tabular-nums',
          display: 'flex', gap: '10px',
        }}>
          <span>
            <span style={{ color: tokens.text.primary, fontWeight: 600 }}>
              {moment.highlight.messageRate.toFixed(1)}
            </span>
            <span style={{ color: tokens.text.muted }}> msg/s peak</span>
          </span>
          {moment.highlight.baselineRate > 0 && (
            <span title="how many times louder than the recent calm baseline">
              <span style={{ color: tokens.text.primary, fontWeight: 600 }}>
                {moment.highlight.spikeRatio.toFixed(1)}×
              </span>
              <span style={{ color: tokens.text.muted }}> baseline</span>
            </span>
          )}
        </div>
      </div>

      <AnimatePresence>
        {expanded && previewUrl && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden', padding: '0 12px 12px' }}
          >
            <video
              src={previewUrl}
              controls
              autoPlay
              style={{
                width: '100%',
                maxHeight: '240px',
                objectFit: 'contain',
                borderRadius: radius.sm,
                background: '#000',
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function CategoryDot({ color }: { color: string }) {
  return (
    <span style={{
      display: 'inline-block',
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: color,
    }} />
  );
}

function StatusPill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: '10px',
      color,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      padding: '1px 6px',
      borderRadius: '3px',
      background: `${color}14`,
      border: `1px solid ${color}40`,
    }}>
      {children}
    </span>
  );
}

function panelShell(): React.CSSProperties {
  return {
    background: tokens.bg.surface,
    border: `1px solid ${tokens.border.subtle}`,
    borderRadius: radius.md,
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    width: '100%',
    // Defensive — absolute boundary even if a child miscomputes its height
    // (e.g. an inline video preview taking a beat to apply object-fit).
    overflow: 'hidden',
  };
}
function panelHeader(): React.CSSProperties {
  return {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  };
}
function panelTitle(): React.CSSProperties {
  return {
    fontSize: '11px',
    color: tokens.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
  };
}

export default memo(MomentsPanelInner);
