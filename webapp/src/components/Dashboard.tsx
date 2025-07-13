import React, { useState, memo, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AppState, VideoMode } from '../App';
import TwitchPlayer from './TwitchPlayer';
import ChatTimeline from './ChatTimeline';
import ChatStream from './ChatStream';
import MomentsPanel from './MomentsPanel';
import HighlightsEditor from './HighlightsEditor';
import AnimatedNumber from './AnimatedNumber';
import Button from './ui/Button';
import { tokens, radius, transition } from './ui/theme';
import { useViewport } from '../utils/use-viewport';

const CATEGORY_COLORS: Record<string, string> = {
  exciting: '#ff5a5a',
  funny: '#5ac95a',
  surprising: '#ffb84d',
  other: '#9147ff',
};

import type { Moment } from '../App';

interface DashboardProps {
  state: AppState;
  onConnect: (input: string) => void;
  onDisconnect: () => void;
  onManualClip: () => void;
  onRestartCapture: () => void;
  onDeleteMoment: (id: string) => void;
  onRetryRemux: (id: string) => void;
  onImportAdd: (moments: Moment[]) => void;
  onImportReplace: (moments: Moment[]) => void;
  onSetVideoMode: (m: VideoMode) => void;
}

export default function Dashboard({
  state, onConnect, onDisconnect, onManualClip, onRestartCapture,
  onDeleteMoment, onRetryRemux, onImportAdd, onImportReplace, onSetVideoMode,
}: DashboardProps) {
  const [input, setInput] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const vp = useViewport();
  const isMobile = vp === 'mobile';

  const timelineRanges = useMemo(
    () => state.moments.map((m) => ({
      detTs: m.highlight.timestamp,
      startTs: m.startTs || m.highlight.timestamp - 8_000,
      endTs: m.endTs || m.highlight.timestamp + 6_000,
      color: CATEGORY_COLORS[m.highlight.category] || tokens.brand,
    })),
    [state.moments],
  );

  const peakRate = state.chatRate.length ? Math.max(...state.chatRate) : 0;
  const avgRate = state.chatRate.length
    ? state.chatRate.reduce((a, b) => a + b, 0) / state.chatRate.length
    : 0;

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) onConnect(input.trim());
  };

  const padding = isMobile ? '14px 14px 24px' : '16px 24px 24px';

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        padding,
        maxWidth: '1760px',
        margin: '0 auto',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {!state.isConnected && (
        <ConnectForm
          input={input}
          setInput={setInput}
          connecting={state.isConnecting}
          error={state.connectError}
          onSubmit={handleConnect}
        />
      )}

      {state.connectError && (
        <div style={{ color: tokens.status.bad, fontSize: '12px' }}>
          {state.connectError}
        </div>
      )}

      {/* While connected, ffmpeg status rides as a slim banner; on the home
          screen it's shown as a prominent indicator inside EmptyState. */}
      {state.isConnected && <FFmpegBanner stage={state.ffmpegStage} error={state.ffmpegError} />}

      {state.isConnected && (
        <StatusStrip
          state={state}
          peakRate={peakRate}
          avgRate={avgRate}
          onSetVideoMode={onSetVideoMode}
          isMobile={isMobile}
        />
      )}

      {state.isConnected ? (
        isMobile ? (
          <MobileLayout
            state={state}
            ranges={timelineRanges}
            onDeleteMoment={onDeleteMoment}
            onRetryRemux={onRetryRemux}
            onOpenEditor={() => setEditorOpen(true)}
            onManualClip={onManualClip}
            onRestartCapture={onRestartCapture}
          />
        ) : (
          <DesktopLayout
            state={state}
            ranges={timelineRanges}
            onDeleteMoment={onDeleteMoment}
            onRetryRemux={onRetryRemux}
            onOpenEditor={() => setEditorOpen(true)}
            onManualClip={onManualClip}
            onRestartCapture={onRestartCapture}
          />
        )
      ) : (
        <EmptyState ffmpegStage={state.ffmpegStage} ffmpegError={state.ffmpegError} />
      )}

      <AnimatePresence>
        {editorOpen && (
          <HighlightsEditor
            moments={state.moments}
            channel={state.channel}
            onClose={() => setEditorOpen(false)}
            onDelete={onDeleteMoment}
            onImportAdd={onImportAdd}
            onImportReplace={onImportReplace}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

interface LayoutProps {
  state: AppState;
  ranges: Array<{ detTs: number; startTs: number; endTs: number; color: string }>;
  onDeleteMoment: (id: string) => void;
  onRetryRemux: (id: string) => void;
  onOpenEditor: () => void;
  onManualClip: () => void;
  onRestartCapture: () => void;
}

function DesktopLayout({
  state, ranges, onDeleteMoment, onRetryRemux, onOpenEditor, onManualClip, onRestartCapture,
}: LayoutProps) {
  const showPlayer = state.videoMode === 'embed';
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 380px)',
        gap: '14px',
      }}
    >
      <LeftColumn state={state} ranges={ranges} showPlayer={showPlayer} />
      <RightColumn
        state={state}
        onDeleteMoment={onDeleteMoment}
        onRetryRemux={onRetryRemux}
        onOpenEditor={onOpenEditor}
        onManualClip={onManualClip}
        onRestartCapture={onRestartCapture}
      />
    </div>
  );
}

function MobileLayout({
  state, ranges, onDeleteMoment, onRetryRemux, onOpenEditor, onManualClip, onRestartCapture,
}: LayoutProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
    }}>
      {state.videoMode === 'embed' && <TwitchPlayer channel={state.channel} />}
      <ChatTimeline data={state.chatRate} timestamps={state.chatRateTimestamps} ranges={ranges} />
      <div style={{ height: '320px', display: 'flex' }}>
        <ChatStream messages={state.messages} totalCount={state.totalMessages} />
      </div>
      <MomentsPanel
        moments={state.moments}
        onDelete={onDeleteMoment}
        onRetryRemux={onRetryRemux}
        onOpenEditor={onOpenEditor}
      />
      <CapturePanel state={state} onManualClip={onManualClip} onRestartCapture={onRestartCapture} />
    </div>
  );
}

interface LeftColumnProps {
  state: AppState;
  ranges: Array<{ detTs: number; startTs: number; endTs: number; color: string }>;
  showPlayer: boolean;
}
function LeftColumn({ state, ranges, showPlayer }: LeftColumnProps) {
  return (
    <div
      style={{
        minWidth: 0,
        minHeight: 0,
        display: 'grid',
        // Chart takes a bigger fixed share so the chat row underneath
        // doesn't end up disproportionately tall. Bottom row capped to a
        // sane portion of viewport height so chat stays compact.
        gridTemplateRows: 'minmax(220px, 32vh) minmax(0, 1fr)',
        gap: '12px',
      }}
    >
      <ChatTimeline data={state.chatRate} timestamps={state.chatRateTimestamps} ranges={ranges} />
      <div
        style={{
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: showPlayer
            ? 'minmax(0, 1fr) minmax(0, 1.4fr)'
            : 'minmax(0, 1fr)',
          gap: '12px',
        }}
      >
        <div style={{ minWidth: 0, minHeight: 0, display: 'flex' }}>
          <ChatStream messages={state.messages} totalCount={state.totalMessages} />
        </div>
        {showPlayer && (
          <div style={{
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
            borderRadius: radius.md,
            background: '#000',
            // Center the iframe in its box: the inner aspect-locked div is
            // sized to fit 16:9 within the available area, and the flex
            // centering surrounds it with even letterbox space.
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <div style={{
              width: '100%',
              aspectRatio: '16 / 9',
              maxHeight: '100%',
            }}>
              <TwitchPlayer channel={state.channel} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface RightColumnProps {
  state: AppState;
  onDeleteMoment: (id: string) => void;
  onRetryRemux: (id: string) => void;
  onOpenEditor: () => void;
  onManualClip: () => void;
  onRestartCapture: () => void;
}
function RightColumn({
  state, onDeleteMoment, onRetryRemux, onOpenEditor, onManualClip, onRestartCapture,
}: RightColumnProps) {
  return (
    <div style={{
      minWidth: 0,
      minHeight: 0,
      display: 'grid',
      gridTemplateRows: 'minmax(0, 1fr) auto',
      gap: '12px',
    }}>
      <div style={{ minHeight: 0, display: 'flex' }}>
        <MomentsPanel
          moments={state.moments}
          onDelete={onDeleteMoment}
          onRetryRemux={onRetryRemux}
          onOpenEditor={onOpenEditor}
        />
      </div>
      <CapturePanel state={state} onManualClip={onManualClip} onRestartCapture={onRestartCapture} />
    </div>
  );
}

interface ConnectFormProps {
  input: string;
  setInput: (s: string) => void;
  connecting: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
}
function ConnectForm({ input, setInput, connecting, error, onSubmit }: ConnectFormProps) {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? tokens.status.bad : focused ? tokens.brand : tokens.border.default;
  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="twitch url or channel name"
        disabled={connecting}
        autoFocus
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flex: 1, minWidth: '200px',
          padding: '11px 14px',
          background: tokens.bg.raised,
          border: `1px solid ${borderColor}`,
          borderRadius: radius.md,
          color: tokens.text.primary,
          fontSize: '13px',
          outline: 'none', fontFamily: 'inherit',
          transition: `border-color ${transition.med}, background ${transition.med}`,
          opacity: connecting ? 0.7 : 1,
        }}
      />
      <Button
        type="submit" variant="primary" size="lg" uppercase={false}
        disabled={!input.trim()} loading={connecting} loadingText="connecting"
      >
        Connect
      </Button>
    </form>
  );
}

interface StatusStripProps {
  state: AppState;
  peakRate: number;
  avgRate: number;
  onSetVideoMode: (m: VideoMode) => void;
  isMobile: boolean;
}
function StatusStrip({ state, peakRate, avgRate, onSetVideoMode, isMobile }: StatusStripProps) {
  return (
    <div style={{
      display: 'flex',
      gap: isMobile ? '14px' : '22px',
      padding: '10px 14px',
      background: tokens.bg.surface,
      border: `1px solid ${tokens.border.subtle}`,
      borderRadius: radius.md,
      fontSize: '13px',
      alignItems: 'center',
      flexWrap: 'wrap',
    }}>
      <Stat label="channel" value={`#${state.channel}`} accent={tokens.brand} />
      <Stat label="messages" numeric={state.totalMessages} />
      <Stat label="msg/s peak" numeric={peakRate} decimals={1} />
      {!isMobile && <Stat label="msg/s avg" numeric={avgRate} decimals={1} />}
      <Stat label="moments" numeric={state.moments.length} accent={tokens.status.good} />
      <CaptureIndicator state={state} />
      <div style={{
        marginLeft: 'auto',
        display: 'flex',
        gap: '4px',
        padding: '3px',
        background: tokens.bg.raised,
        border: `1px solid ${tokens.border.subtle}`,
        borderRadius: '5px',
      }}>
        <Segment active={state.videoMode === 'off'} onClick={() => onSetVideoMode('off')}>chat only</Segment>
        <Segment active={state.videoMode === 'embed'} onClick={() => onSetVideoMode('embed')}>with preview</Segment>
      </div>
    </div>
  );
}

interface StatProps {
  label: string;
  value?: string;
  numeric?: number;
  decimals?: number;
  accent?: string;
  pulse?: boolean;
}
const Stat = memo(function Stat({ label, value, numeric, decimals = 0, accent, pulse }: StatProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, minWidth: '64px' }}>
      <span style={{
        fontSize: '9.5px', color: tokens.text.muted,
        textTransform: 'uppercase', letterSpacing: '0.14em',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: '14px', fontWeight: 600,
        color: accent || tokens.text.primary,
        fontVariantNumeric: 'tabular-nums',
        animation: pulse ? 'snipPulse 1.4s ease-in-out infinite' : undefined,
      }}>
        {numeric !== undefined ? <AnimatedNumber value={numeric} decimals={decimals} /> : value}
      </span>
      <style>{`@keyframes snipPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
});

function CaptureIndicator({ state }: { state: AppState }) {
  const { isRecording, captureStatus } = state;
  if (captureStatus.error) return <Stat label="capture" value="error" accent={tokens.status.bad} />;
  if (!isRecording) return <Stat label="capture" value="idle" accent={tokens.text.muted} />;
  if (!captureStatus.ready || captureStatus.bufferedSec < 2) {
    return <Stat label="capture" value="buffering" accent={tokens.status.warn} pulse />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, minWidth: '96px' }}>
      <span style={{
        fontSize: '9.5px', color: tokens.text.muted,
        textTransform: 'uppercase', letterSpacing: '0.14em',
      }}>
        capture
      </span>
      <span style={{
        fontSize: '14px', fontWeight: 600, color: tokens.status.good,
        fontVariantNumeric: 'tabular-nums',
      }}>
        <AnimatedNumber value={captureStatus.bufferedSec} decimals={0} duration={1800} />s buffered
      </span>
    </div>
  );
}

function Segment({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: active ? tokens.brand : hover ? '#2f2f35' : 'transparent',
        color: active ? '#fff' : tokens.text.secondary,
        border: 'none',
        padding: '5px 11px',
        borderRadius: '3px',
        fontSize: '10.5px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        transition: `background ${transition.med}, color ${transition.med}`,
      }}
    >
      {children}
    </button>
  );
}

interface CapturePanelProps {
  state: AppState;
  onManualClip: () => void;
  onRestartCapture: () => void;
}
function CapturePanel({ state, onManualClip, onRestartCapture }: CapturePanelProps) {
  const ready = state.isRecording && state.captureStatus.bufferedSec >= 2;
  const error = state.captureStatus.error;
  return (
    <div style={{
      background: tokens.bg.surface,
      border: `1px solid ${tokens.border.subtle}`,
      borderRadius: radius.md,
      padding: '12px 14px',
    }}>
      <div style={{
        fontSize: '10.5px', color: tokens.text.muted,
        textTransform: 'uppercase', letterSpacing: '0.16em',
        marginBottom: '8px',
      }}>
        Background capture
      </div>
      <div style={{
        fontSize: '11.5px', color: tokens.text.secondary,
        lineHeight: 1.55, marginBottom: '10px',
      }}>
        {error ? (
          <span style={{ color: tokens.status.bad }}>{error}</span>
        ) : ready ? (
          <>{state.captureStatus.bufferedSec.toFixed(0)} s buffered.</>
        ) : state.isRecording ? (
          <>connecting…</>
        ) : (
          <>stopped.</>
        )}
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>
        <Button variant="primary" size="md" uppercase={false} disabled={!ready} onClick={onManualClip}>
          Clip now
        </Button>
        <Button variant="ghost" size="md" uppercase={false} onClick={onRestartCapture}>
          Restart
        </Button>
      </div>
    </div>
  );
}

function FFmpegBanner({ stage, error }: { stage: AppState['ffmpegStage']; error: string | null }) {
  if (stage === 'idle' || stage === 'ready') return null;
  if (stage === 'loading') {
    return (
      <div style={bannerShell(tokens.status.warn)}>
        <span style={{
          width: '8px', height: '8px', borderRadius: '50%',
          background: tokens.status.warn,
          animation: 'snipPulse 1.2s ease-in-out infinite',
        }} />
        <span>loading ffmpeg core, one-time download.</span>
      </div>
    );
  }
  return (
    <div style={{ ...bannerShell(tokens.status.bad), flexDirection: 'column', alignItems: 'flex-start' }}>
      <div style={{
        fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.14em',
        color: tokens.status.bad, marginBottom: '4px',
      }}>
        ffmpeg failed to load
      </div>
      <div style={{ color: tokens.text.secondary }}>
        {error || 'unknown error.'} clips will save as raw <code>.ts</code> (VLC only).
      </div>
    </div>
  );
}

function bannerShell(_accent: string): React.CSSProperties {
  return {
    background: tokens.bg.surface,
    border: `1px solid ${tokens.border.subtle}`,
    borderRadius: radius.md,
    padding: '10px 14px',
    fontSize: '12px',
    color: tokens.text.secondary,
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  };
}

function EmptyState({
  ffmpegStage, ffmpegError,
}: { ffmpegStage: AppState['ffmpegStage']; ffmpegError: string | null }) {
  return (
    <div style={{
      flex: 1, minHeight: 0,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '24px',
      textAlign: 'center',
    }}>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'clamp(28px, 5vw, 44px)',
        fontWeight: 700,
        color: tokens.text.primary,
        letterSpacing: '-0.025em',
        opacity: 0.92,
      }}>
        paste a twitch url to begin
      </div>
      <FFmpegLoadIndicator stage={ffmpegStage} error={ffmpegError} />
    </div>
  );
}

/**
 * Home-screen indicator for the one-time ffmpeg core download. Shows a
 * spinner + "getting ffmpeg" while loading, a quiet confirmation when ready,
 * and a non-blocking note if it fails (capture still works; clips just save
 * as raw .ts). Reserves a fixed height so the headline doesn't jump.
 */
function FFmpegLoadIndicator({
  stage, error,
}: { stage: AppState['ffmpegStage']; error: string | null }) {
  const subtext: React.CSSProperties = {
    fontSize: '12.5px', letterSpacing: '0.04em', color: tokens.text.muted,
  };
  // Once loaded, collapse entirely — no "ready" line, no reserved gap.
  if (stage === 'ready') return null;
  return (
    <div style={{
      marginTop: '20px', height: '22px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
    }}>
      {(stage === 'idle' || stage === 'loading') && (
        <>
          <span style={{
            width: '14px', height: '14px', borderRadius: '50%',
            border: `2px solid ${tokens.border.default}`,
            borderTopColor: tokens.brand,
            animation: 'snipSpin 0.8s linear infinite',
            flexShrink: 0,
          }} />
          <span style={subtext}>getting ffmpeg…</span>
        </>
      )}
      {stage === 'failed' && (
        <span style={{ ...subtext, color: tokens.status.warn }}>
          {error ? `ffmpeg unavailable (${error})` : 'ffmpeg unavailable'} — clips save as raw .ts
        </span>
      )}
      <style>{`@keyframes snipSpin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
