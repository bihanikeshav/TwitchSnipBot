import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ChatReader, ChatMessage } from './services/chat-reader';
import { HighlightDetector, DetectedHighlight } from './services/highlight-detector';
import { HlsCapture } from './services/hls-capture';
import { preloadFFmpeg, tsToMp4, onFFmpegStage, type FFmpegStage } from './services/remuxer';
import { saveMoments, loadMoments, saveSession, loadSession, clearSession } from './services/persist';
import { findTensionWindow, type RateSample } from './utils/tension';
import { parseChannel } from './utils/parse-channel';
import Dashboard from './components/Dashboard';
import Settings from './components/Settings';
import Button from './components/ui/Button';
import { tokens } from './components/ui/theme';

export type VideoMode = 'off' | 'embed';

/**
 * Backup gate on top of the detector's own ratio/absolute/floor checks.
 * The new score is `log(spikeRatio) / log(8)` — so 0.2 already corresponds
 * to a ~1.5× spike. Set low so detector thresholds do most of the gating.
 */
const MIN_HIGHLIGHT_SCORE = 0.2;

export type MomentState = 'capturing' | 'ready' | 'failed';

export interface Moment {
  id: string;
  highlight: DetectedHighlight;
  /** Raw TS slice (always set when state === 'ready'). */
  clipTs: Blob | null;
  /** Browser-playable MP4 (set asynchronously after remuxing). */
  clipMp4: Blob | null;
  /** Wall-clock start of the captured range. */
  startTs: number;
  /** Wall-clock end of the captured range. */
  endTs: number;
  durationSec: number;
  state: MomentState;
  /** Status of the async TS→MP4 remux. */
  remuxState: 'pending' | 'remuxing' | 'ready' | 'failed';
}

export interface AppState {
  channel: string;
  isConnected: boolean;
  isConnecting: boolean;
  isRecording: boolean;
  ffmpegStage: FFmpegStage;
  ffmpegError: string | null;
  sensitivity: number;
  bufferLength: number;
  videoMode: VideoMode;
  messages: ChatMessage[];
  totalMessages: number;
  moments: Moment[];
  chatRate: number[];
  chatRateTimestamps: number[];
  connectError: string | null;
  captureStatus: { ready: boolean; bufferedSec: number; error: string | null };
}

export default function App() {
  const [state, setState] = useState<AppState>({
    channel: '',
    isConnected: false,
    isConnecting: false,
    isRecording: false,
    ffmpegStage: 'idle',
    ffmpegError: null,
    sensitivity: 0.5,
    bufferLength: 60,
    videoMode: 'off',
    messages: [],
    totalMessages: 0,
    moments: [],
    chatRate: [],
    chatRateTimestamps: [],
    connectError: null,
    captureStatus: { ready: false, bufferedSec: 0, error: null },
  });

  const [showSettings, setShowSettings] = useState(false);

  const chatReaderRef = useRef<ChatReader | null>(null);
  const detectorRef = useRef<HighlightDetector | null>(null);
  const captureRef = useRef<HlsCapture | null>(null);

  // High-frequency message arrivals are batched once per animation frame.
  // Each chat message would otherwise trigger a full React render (~100/sec
  // on a busy stream), which the eye reads as jagged. The pendingRef
  // accumulates between rAFs and gets flushed in one setState.
  const pendingRef = useRef<{
    messages: ChatMessage[];
  }>({ messages: [] });
  const flushScheduledRef = useRef(false);
  // Live rate (updated per message in callback, sampled on a timer for the chart).
  const currentRateRef = useRef(0);
  // Full ring of 500ms rate samples — kept in a ref so tension detection
  // can read the latest values synchronously without waiting on React state.
  const rateSamplesRef = useRef<RateSample[]>([]);
  /**
   * Pending finalization tracking. Centralized so a single ticker (resilient
   * to background-tab throttling) can advance all of them, rather than one
   * setInterval per moment (which compounds Chrome's intensive throttling).
   */
  const pendingFinalizeRef = useRef<Map<string, { detTs: number; startedAt: number }>>(new Map());
  /**
   * Stable reference to the latest tickFinalize. Lets long-lived callbacks
   * (like the HlsCapture `onSegment` callback registered once at capture
   * start) call the up-to-date function without needing to be recreated.
   */
  const tickFinalizeRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (detectorRef.current) {
      detectorRef.current.setSensitivity(state.sensitivity);
    }
  }, [state.sensitivity]);

  // Live-sync the recording buffer length to the active capture so changing
  // the slider in Settings takes effect immediately.
  useEffect(() => {
    captureRef.current?.setBufferLength(state.bufferLength);
  }, [state.bufferLength]);

  // Warm up ffmpeg.wasm immediately on page load so the core (a one-time
  // ~30 MB download) is ready well before the first clip — the home screen
  // shows a "getting ffmpeg" indicator meanwhile. Errors surface through the
  // stage listener below, not swallowed.
  useEffect(() => {
    preloadFFmpeg().catch((err) => {
      console.error('[ffmpeg] preload failed:', err);
    });
  }, []);

  // Mirror the global ffmpeg loader state into React state so the UI can
  // show "loading 35 MB ffmpeg core" / "failed to load" banners.
  useEffect(() => {
    return onFFmpegStage((s, err) => {
      setState((p) => ({ ...p, ffmpegStage: s, ffmpegError: err }));
    });
  }, []);

  const startCapture = useCallback(async (channel: string) => {
    if (captureRef.current) {
      captureRef.current.stop();
      captureRef.current = null;
    }
    const capture = new HlsCapture(channel, state.bufferLength, {
      onSegment: (_n, durationSec) => {
        setState((p) => ({
          ...p,
          captureStatus: { ready: true, bufferedSec: durationSec, error: null },
        }));
        // Segment arrivals are the most reliable steady tick we have —
        // they happen every ~2 s independent of tab visibility or rAF/
        // setInterval throttling. Use them to keep pending finalizations
        // moving even when the main thread is otherwise idle.
        tickFinalizeRef.current();
      },
      onError: (err) => {
        setState((p) => ({
          ...p,
          captureStatus: { ...p.captureStatus, error: err.message },
        }));
      },
    });
    captureRef.current = capture;
    try {
      await capture.start();
      setState((p) => ({
        ...p,
        isRecording: true,
        captureStatus: { ready: true, bufferedSec: 0, error: null },
      }));
    } catch (err) {
      captureRef.current = null;
      setState((p) => ({
        ...p,
        isRecording: false,
        captureStatus: { ready: false, bufferedSec: 0, error: (err as Error).message },
      }));
    }
  }, [state.bufferLength]);

  /**
   * Run ffmpeg.wasm with a hard timeout, so a hung core process can't leave
   * a moment in 'remuxing' forever. Called from both highlight finalization
   * and the manual retry button.
   */
  const remuxWithTimeout = useCallback((id: string, ts: Blob) => {
    setState((prev) => ({
      ...prev,
      moments: prev.moments.map((m) => m.id === id ? { ...m, remuxState: 'remuxing' } : m),
    }));
    const HARD_TIMEOUT_MS = 90_000;
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn('[remux] timed out after 90s, marking as failed');
      setState((prev) => ({
        ...prev,
        moments: prev.moments.map((m) => m.id === id ? { ...m, remuxState: 'failed' } : m),
      }));
    }, HARD_TIMEOUT_MS);
    tsToMp4(ts).then((mp4) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      setState((prev) => ({
        ...prev,
        moments: prev.moments.map((m) => m.id === id ? { ...m, clipMp4: mp4, remuxState: 'ready' } : m),
      }));
    }).catch((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      console.error('[remux] failed:', err);
      setState((prev) => ({
        ...prev,
        moments: prev.moments.map((m) => m.id === id ? { ...m, remuxState: 'failed' } : m),
      }));
    });
  }, []);

  const retryRemux = useCallback((id: string) => {
    setState((prev) => {
      const m = prev.moments.find((x) => x.id === id);
      if (!m?.clipTs) return prev;
      queueMicrotask(() => remuxWithTimeout(id, m.clipTs!));
      return prev;
    });
  }, [remuxWithTimeout]);

  const MAX_WAIT_MS = 35_000;

  /**
   * Slice the buffer to the tension window and kick off MP4 remux.
   * Pure side-effect — called from the centralized ticker, never recurs.
   */
  const finishMoment = useCallback((id: string, detTs: number, finalEnd: number) => {
    pendingFinalizeRef.current.delete(id);
    const capture = captureRef.current;
    if (!capture?.isActive()) {
      setState((prev) => ({
        ...prev,
        moments: prev.moments.map((m) => m.id === id ? { ...m, state: 'failed' } : m),
      }));
      return;
    }
    const win = findTensionWindow(detTs, finalEnd, rateSamplesRef.current);
    const slice = capture.getBufferRange(win.startTs, finalEnd);
    if (!slice) {
      setState((prev) => ({
        ...prev,
        moments: prev.moments.map((m) => m.id === id ? { ...m, state: 'failed' } : m),
      }));
      return;
    }
    setState((prev) => {
      if (!prev.moments.some((m) => m.id === id)) {
        // Should never happen now that placeholders are added via direct
        // setState — but log loudly if it ever does.
        console.warn('[finishMoment] target moment not in state', id);
        return prev;
      }
      return {
        ...prev,
        moments: prev.moments.map((m) =>
          m.id === id
            ? {
                ...m,
                clipTs: slice.blob,
                durationSec: slice.durationSec,
                startTs: win.startTs,
                endTs: finalEnd,
                state: 'ready',
                remuxState: 'remuxing',
              }
            : m
        ),
      };
    });
    remuxWithTimeout(id, slice.blob);
  }, [remuxWithTimeout]);

  /**
   * Walk all pending moments and finalize any that have reached their end.
   *
   * Two routes to finalization:
   *  1) Tension calmed AND wall-clock has reached the ideal endTs
   *     (calm-point + post-roll padding). This is what makes clip length
   *     dynamic — a long sustained spike runs the end further out, a quick
   *     spike calms early and the end is just past the peak.
   *  2) MAX_WAIT elapsed — give up waiting for calm, take what we have.
   */
  const tickFinalize = useCallback(() => {
    const pending = pendingFinalizeRef.current;
    if (pending.size === 0) return;
    const now = Date.now();
    for (const [id, info] of pending) {
      const elapsed = now - info.startedAt;
      const w = findTensionWindow(info.detTs, now, rateSamplesRef.current);
      const minWaitMet = elapsed >= 4_000;
      const postRollReady = w.calmFound && now >= w.endTs;
      const timedOut = elapsed >= MAX_WAIT_MS;
      if ((postRollReady && minWaitMet) || timedOut) {
        const finalEnd = postRollReady ? w.endTs : Math.min(w.endTs, now);
        finishMoment(id, info.detTs, finalEnd);
      }
    }
  }, [finishMoment]);

  // Keep the ref in sync with the latest tickFinalize closure so callbacks
  // registered once (HlsCapture's onSegment) always invoke the current one.
  useEffect(() => { tickFinalizeRef.current = tickFinalize; }, [tickFinalize]);

  /**
   * On return-to-foreground, force-finalize any pending entry that's been
   * waiting long enough to plausibly be done. Without this, an entry queued
   * 30 s before the tab was frozen could land in pending with elapsed ≈ 0
   * after the unfreeze burst (if it was the LAST highlight before freeze,
   * the timing math gets tangled) and stay stuck for another 35 s.
   */
  const forceFinalizePending = useCallback(() => {
    const now = Date.now();
    for (const [, info] of pendingFinalizeRef.current) {
      const elapsed = now - info.startedAt;
      // If pending for at least 4 s, force it past the timeout so the next
      // tick will resolve it (ready or failed, depending on whether the
      // rolling buffer still contains the requested range).
      if (elapsed >= 4_000) {
        info.startedAt = now - MAX_WAIT_MS - 100;
      }
    }
    tickFinalize();
  }, [tickFinalize]);

  // Centralized 500 ms ticker plus return-to-foreground triggers. Chrome may
  // throttle setInterval to ~1 Hz in background tabs and even freeze the
  // page entirely after a few minutes. We layer multiple triggers so the
  // finalizer recovers regardless of which suspend state Chrome was in:
  //  - setInterval        : steady cadence in foreground
  //  - chat message       : keeps progress while WebSocket events flow
  //  - HlsCapture segment : reliable ~2 s tick that survives most throttling
  //  - visibilitychange   : fires on return from background
  //  - focus / pageshow   : fires on return from BFCache or window swap
  useEffect(() => {
    if (!state.isConnected) return;
    const id = window.setInterval(tickFinalize, 500);
    const onVis = () => { if (!document.hidden) forceFinalizePending(); };
    const onFocus = () => forceFinalizePending();
    const onPageShow = () => forceFinalizePending();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [state.isConnected, tickFinalize, forceFinalizePending]);

  const queueFinalize = useCallback((id: string, detTs: number) => {
    pendingFinalizeRef.current.set(id, { detTs, startedAt: Date.now() });
  }, []);

  const deleteMoment = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      moments: prev.moments.filter((m) => m.id !== id),
    }));
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    requestAnimationFrame(() => {
      flushScheduledRef.current = false;
      const p = pendingRef.current;
      if (p.messages.length === 0) return;
      const messagesBatch = p.messages;
      pendingRef.current = { messages: [] };
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, ...messagesBatch].slice(-500),
        totalMessages: prev.totalMessages + messagesBatch.length,
      }));
    });
  }, []);

  // Sample the live rate at a fixed 500ms cadence — keeps the chart time-series
  // stable (older history doesn't reshape) and decouples rate scrolling from
  // message arrival bursts.
  useEffect(() => {
    if (!state.isConnected) return;
    const SAMPLE_MS = 500;
    const MAX_SAMPLES = 480; // 4 minutes of history at 500ms cadence
    const id = window.setInterval(() => {
      const now = Date.now();
      const rate = currentRateRef.current;
      rateSamplesRef.current.push({ ts: now, rate });
      if (rateSamplesRef.current.length > MAX_SAMPLES) {
        rateSamplesRef.current = rateSamplesRef.current.slice(-MAX_SAMPLES);
      }
      setState((prev) => ({
        ...prev,
        chatRate: [...prev.chatRate, rate].slice(-MAX_SAMPLES),
        chatRateTimestamps: [...prev.chatRateTimestamps, now].slice(-MAX_SAMPLES),
      }));
    }, SAMPLE_MS);
    return () => clearInterval(id);
  }, [state.isConnected]);

  const connect = useCallback(async (input: string) => {
    const channel = parseChannel(input);
    if (!channel) {
      setState((p) => ({ ...p, connectError: 'enter a twitch url or channel name' }));
      return;
    }

    setState((p) => ({ ...p, isConnecting: true, connectError: null }));

    if (chatReaderRef.current) chatReaderRef.current.disconnect();

    const reader = new ChatReader(channel);
    const detector = new HighlightDetector(state.sensitivity);
    chatReaderRef.current = reader;
    detectorRef.current = detector;

    reader.onMessage((msg) => {
      const result = detector.addMessage(msg);
      currentRateRef.current = result.currentRate;
      const pending = pendingRef.current;
      pending.messages.push(msg);
      // Three gates before a highlight becomes a moment:
      // 1) score floor   — backstop on the detector itself
      // 2) buffer ready  — must have enough captured to make a real clip,
      //                    avoids the post-init-flush "tiny garbage" case
      const bufferedSec = captureRef.current?.getBufferedSec() ?? 0;
      const MIN_BUFFERED_SEC = 24;
      if (
        result.highlight &&
        result.highlight.score >= MIN_HIGHLIGHT_SCORE &&
        bufferedSec >= MIN_BUFFERED_SEC
      ) {
        const detTs = result.highlight.timestamp;
        const id = `m_${detTs}_${Math.floor(Math.random() * 1e6)}`;
        const placeholder: Moment = {
          id,
          highlight: result.highlight,
          clipTs: null,
          clipMp4: null,
          startTs: 0,
          endTs: 0,
          durationSec: 0,
          state: 'capturing',
          remuxState: 'pending',
        };
        // Direct setState (not batched). The tickFinalize may update this
        // moment via setState before any rAF flush would have run — if it
        // weren't in state.moments yet, the update would be a silent no-op
        // and the moment would be stuck forever. Background tabs throttle
        // rAF heavily, so we can't rely on the batch.
        setState((prev) => ({ ...prev, moments: [...prev.moments, placeholder] }));
        queueFinalize(id, detTs);
      }
      // Chat-message arrivals also tick the finalizer — this is what keeps
      // background tabs progressing when setInterval is throttled.
      tickFinalize();
      scheduleFlush();
    });

    try {
      await reader.connect();
      // Restore any previously saved moments for this channel before flipping
      // isConnected, so the UI never momentarily shows "no moments yet" for
      // a channel that already has stored history.
      const restored = await loadMoments(channel).catch(() => null);
      setState((prev) => ({
        ...prev,
        channel,
        isConnected: true,
        isConnecting: false,
        connectError: null,
        moments: restored ?? [],
      }));
      // Shareable + refresh-restorable: /?c=<channel>
      saveSession(channel);
      try { window.history.replaceState(null, '', `/?c=${encodeURIComponent(channel)}`); } catch { /* ignore */ }
      // Kick off background HLS capture automatically — no prompt, no screen share.
      void startCapture(channel);
    } catch (err) {
      setState((p) => ({
        ...p,
        isConnecting: false,
        connectError: `failed to connect: ${(err as Error).message}`,
      }));
    }
  }, [state.sensitivity, startCapture]);

  const disconnect = useCallback(() => {
    chatReaderRef.current?.disconnect();
    chatReaderRef.current = null;
    detectorRef.current = null;
    captureRef.current?.stop();
    captureRef.current = null;
    currentRateRef.current = 0;
    clearSession();
    try { window.history.replaceState(null, '', '/'); } catch { /* ignore */ }
    setState((prev) => ({
      ...prev,
      isConnected: false,
      isRecording: false,
      messages: [],
      totalMessages: 0,
      chatRate: [],
      chatRateTimestamps: [],
      moments: [],
      captureStatus: { ready: false, bufferedSec: 0, error: null },
    }));
  }, []);

  // On load, auto-reconnect from the URL (?c=<channel>) or the saved session.
  const autoConnectedRef = useRef(false);
  useEffect(() => {
    if (autoConnectedRef.current) return;
    autoConnectedRef.current = true;
    const c = new URLSearchParams(window.location.search).get('c') || loadSession();
    if (c) void connect(c);
  }, [connect]);

  const manualClip = useCallback(() => {
    const capture = captureRef.current;
    if (!capture?.isActive()) return;
    const now = Date.now();
    const startTs = now - 20_000;
    const endTs = now;
    const slice = capture.getBufferRange(startTs, endTs);
    if (!slice) return;
    const fakeHighlight: DetectedHighlight = {
      timestamp: now,
      score: 0.5,
      baselineRate: 0,
      spikeRatio: 1,
      category: 'other',
      messageRate: currentRateRef.current,
      windowMessages: [],
    };
    const id = `m_manual_${now}_${Math.floor(Math.random() * 1e6)}`;
    setState((prev) => ({
      ...prev,
      moments: [
        ...prev.moments,
        {
          id,
          highlight: fakeHighlight,
          clipTs: slice.blob,
          clipMp4: null,
          startTs,
          endTs,
          durationSec: slice.durationSec,
          state: 'ready',
          remuxState: 'remuxing',
        },
      ],
    }));
    remuxWithTimeout(id, slice.blob);
  }, [remuxWithTimeout]);

  const restartCapture = useCallback(() => {
    if (state.channel) void startCapture(state.channel);
  }, [state.channel, startCapture]);

  const updateSettings = useCallback((updates: Partial<AppState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  const importMomentsAdd = useCallback((newMoments: Moment[]) => {
    setState((prev) => ({ ...prev, moments: [...prev.moments, ...newMoments] }));
  }, []);

  const importMomentsReplace = useCallback((newMoments: Moment[]) => {
    setState((prev) => ({ ...prev, moments: newMoments }));
  }, []);

  // Debounced persist: every meaningful change to `state.moments` while
  // connected schedules a save ~800 ms later. Repeated changes collapse
  // into a single write. IndexedDB stores Blobs natively so MP4 clips
  // round-trip without copy or base64.
  const persistTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!state.isConnected || !state.channel) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      void saveMoments(state.channel, state.moments).catch((e) =>
        console.warn('[persist] save failed:', e),
      );
    }, 800);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [state.moments, state.channel, state.isConnected]);

  return (
    <div style={{
      height: '100vh',
      background: tokens.bg.base,
      color: tokens.text.primary,
      display: 'flex',
      flexDirection: 'column',
    }}>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 22px',
        borderBottom: `1px solid ${tokens.border.subtle}`,
        background: tokens.bg.surface,
        flexShrink: 0,
      }}>
        <h1 style={{
          margin: 0,
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(20px, 2.4vw, 26px)',
          fontWeight: 700,
          letterSpacing: '-0.028em',
        }}>
          twitchsnipbot
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {state.isConnected && (
            <Button variant="ghost" size="sm" onClick={disconnect}>disconnect</Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)}>settings</Button>
        </div>
      </header>

      <Dashboard
        state={state}
        onConnect={connect}
        onDisconnect={disconnect}
        onManualClip={manualClip}
        onRestartCapture={restartCapture}
        onDeleteMoment={deleteMoment}
        onRetryRemux={retryRemux}
        onImportAdd={importMomentsAdd}
        onImportReplace={importMomentsReplace}
        onSetVideoMode={(m) => setState((p) => ({ ...p, videoMode: m }))}
      />

      <Settings
        open={showSettings}
        sensitivity={state.sensitivity}
        bufferLength={state.bufferLength}
        onUpdate={updateSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  );
}
