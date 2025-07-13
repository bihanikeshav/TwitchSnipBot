import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AppState } from '../App';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import { tokens, radius } from './ui/theme';
import { listStoredChannels, clearChannel, clearAll, type StoredChannel } from '../services/persist';

interface SettingsProps {
  open: boolean;
  sensitivity: number;
  bufferLength: number;
  onUpdate: (updates: Partial<AppState>) => void;
  onClose: () => void;
}

export default function Settings({ open, sensitivity, bufferLength, onUpdate, onClose }: SettingsProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          style={{
            position: 'fixed', inset: 0,
            background: tokens.bg.overlay,
            backdropFilter: 'blur(6px)',
            zIndex: 1100,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px',
          }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 12 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: tokens.bg.surface,
              border: `1px solid ${tokens.border.subtle}`,
              borderRadius: radius.lg,
              width: '100%',
              maxWidth: '560px',
              maxHeight: '88vh',
              overflowY: 'auto',
              padding: '22px 26px 24px',
              boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: '22px',
            }}>
              <h2 style={{
                margin: 0,
                fontFamily: 'var(--font-display)',
                fontSize: '22px',
                fontWeight: 700,
                letterSpacing: '-0.025em',
              }}>
                settings
              </h2>
              <Button variant="ghost" size="sm" onClick={onClose}>close</Button>
            </div>

            <SliderField
              label="Detection sensitivity"
              value={`${(sensitivity * 100).toFixed(0)}%`}
              min={0} max={1} step={0.05}
              current={sensitivity}
              onChange={(v) => onUpdate({ sensitivity: v })}
              hintLeft="fewer alerts"
              hintRight="more alerts"
            />

            <SliderField
              label="Recording buffer"
              value={`${bufferLength}s`}
              min={30} max={180} step={10}
              current={bufferLength}
              onChange={(v) => onUpdate({ bufferLength: v })}
              hintLeft="30s · clips around 20s"
              hintRight="180s · more headroom"
            />

            <StoredSessions />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StoredSessions() {
  const [channels, setChannels] = useState<StoredChannel[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    setChannels(await listStoredChannels());
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const handleClear = async (channel: string) => {
    await clearChannel(channel);
    refresh();
  };
  const handleClearAll = async () => {
    await clearAll();
    refresh();
  };

  return (
    <div style={{ marginTop: '26px', marginBottom: '12px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: '10px',
      }}>
        <label style={{ fontSize: '13px', color: tokens.text.primary }}>Stored sessions</label>
        {channels.length > 0 && (
          <button
            onClick={handleClearAll}
            style={{
              background: 'transparent', border: 'none',
              color: tokens.text.muted, fontSize: '10px',
              textTransform: 'uppercase', letterSpacing: '0.14em',
              cursor: 'pointer', fontFamily: 'inherit',
              padding: 0,
            }}
          >
            clear all
          </button>
        )}
      </div>
      <div style={{
        background: tokens.bg.raised,
        border: `1px solid ${tokens.border.subtle}`,
        borderRadius: radius.md,
        padding: channels.length === 0 ? '14px' : '4px',
        fontSize: '12px',
      }}>
        {loading ? (
          <span style={{ color: tokens.text.muted, padding: '0 10px' }}>loading…</span>
        ) : channels.length === 0 ? (
          <span style={{ color: tokens.text.muted }}>nothing saved yet.</span>
        ) : (
          channels.map((c) => (
            <div
              key={c.channel}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px',
                borderRadius: radius.sm,
              }}
            >
              <span style={{
                fontWeight: 600, color: tokens.brand, fontVariantNumeric: 'tabular-nums',
              }}>
                #{c.channel}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{
                  fontSize: '11px', color: tokens.text.muted, fontVariantNumeric: 'tabular-nums',
                }}>
                  {c.count} moments · {(c.bytes / 1024 / 1024).toFixed(1)} MB
                </span>
                <IconButton title="clear this session" onClick={() => handleClear(c.channel)} size={22}>
                  ×
                </IconButton>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface SliderFieldProps {
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  current: number;
  onChange: (v: number) => void;
  hintLeft: string;
  hintRight: string;
}
function SliderField({ label, value, min, max, step, current, onChange, hintLeft, hintRight }: SliderFieldProps) {
  return (
    <div style={{ marginBottom: '22px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: '10px',
      }}>
        <label style={{ fontSize: '13px', color: tokens.text.primary }}>{label}</label>
        <span style={{
          fontSize: '13px', color: tokens.brand,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {value}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={current}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: tokens.brand }}
      />
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: '10px', color: tokens.text.muted,
        textTransform: 'uppercase', letterSpacing: '0.12em',
        marginTop: '4px',
      }}>
        <span>{hintLeft}</span>
        <span>{hintRight}</span>
      </div>
    </div>
  );
}
