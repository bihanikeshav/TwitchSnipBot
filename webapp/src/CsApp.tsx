import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatReader, type ChatMessage } from './services/chat-reader';
import { HighlightDetector } from './services/highlight-detector';
import { HlsCapture } from './services/hls-capture';
import { tsToMp4, preloadFFmpeg } from './services/remuxer';
import {
  saveCsClips, loadCsClips, saveCsSession, loadCsSession, clearCsSession,
  type StoredCsClip,
} from './services/persist';
import { parseChannel } from './utils/parse-channel';
import {
  HLTVLive, parseMatchId, NOTABLE_TAG,
  type HLTVEvent, type Scoreboard,
} from './services/hltv-live';
import GameEvents from './components/cs/GameEvents';
import ChatTimeline, { type TimelineRange } from './components/ChatTimeline';
import ChatStream from './components/ChatStream';
import Button from './components/ui/Button';
import { tokens, radius } from './components/ui/theme';

/**
 * CS-match companion (route: /cs) — an addon to the main highlighter.
 *
 * Same chat-spike detection + zero-auth Twitch HLS capture as the main app,
 * PLUS a live HLTV layer (scorebot kills/rounds/scoreboard, client-side — see
 * hltv-live.ts). Clips fire on BOTH a chat spike (tag: HYPE) and a notable CS
 * play (ACE / 4K / 3K / CLUTCH / DEFUSE), and are tagged accordingly.
 *
 * Only NEW notable plays clip — the scorebot's initial historical dump is
 * replayed silently (it can't be clipped retroactively).
 */
const CLIP_WINDOW_MS = 22_000;
const MIN_BUFFERED_SEC = 22;
const CHAT_CLIP_COOLDOWN_MS = 9_000;

interface CsClip {
  id: string;
  label: string;
  color: string;
  type: 'chat' | 'game' | 'manual';
  round: number | null;
  ts: number;
  mp4: Blob | null;
  url: string | null;
}

export default function CsApp() {
  const [hltvUrl, setHltvUrl] = useState('');
  const [channelInput, setChannelInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [channel, setChannel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState('idle');
  const [events, setEvents] = useState<HLTVEvent[]>([]);
  const [board, setBoard] = useState<Scoreboard | null>(null);
  const [clips, setClips] = useState<CsClip[]>([]);
  const [buffered, setBuffered] = useState(0);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [chatRate, setChatRate] = useState<number[]>([]);
  const [chatRateTs, setChatRateTs] = useState<number[]>([]);

  const chatRef = useRef<ChatReader | null>(null);
  const detectorRef = useRef<HighlightDetector | null>(null);
  const captureRef = useRef<HlsCapture | null>(null);
  const hltvRef = useRef<HLTVLive | null>(null);
  const currentRateRef = useRef(0);
  const pendingMsgsRef = useRef<ChatMessage[]>([]);
  const lastChatClipRef = useRef(0);

  useEffect(() => { preloadFFmpeg().catch(() => {}); }, []);
  useEffect(() => () => {
    chatRef.current?.disconnect();
    hltvRef.current?.disconnect();
    captureRef.current?.stop();
  }, []);

  /** Slice the rolling buffer ending at `endTs`, remux to mp4, add a tagged clip. */
  const makeClip = useCallback((endTs: number, label: string, color: string, type: CsClip['type'], round: number | null = null) => {
    const cap = captureRef.current;
    if (!cap?.isActive()) return;
    const slice = cap.getBufferRange(endTs - CLIP_WINDOW_MS, endTs);
    if (!slice) return;
    const id = `c_${endTs}_${Math.floor(Math.random() * 1e6)}`;
    setClips((prev) => [{ id, label, color, type, round, ts: endTs, mp4: null, url: null }, ...prev]);
    tsToMp4(slice.blob)
      .then((mp4) => setClips((prev) => prev.map((c) => c.id === id ? { ...c, mp4, url: URL.createObjectURL(mp4) } : c)))
      .catch((e) => {
        console.error('[cs] remux failed', e);
        setClips((prev) => prev.filter((c) => c.id !== id));
      });
  }, []);

  // 500ms cadence: sample chat rate for the timeline + flush batched messages.
  useEffect(() => {
    if (!connected) return;
    const MAX = 480;
    const id = window.setInterval(() => {
      const now = Date.now();
      setChatRate((p) => [...p, currentRateRef.current].slice(-MAX));
      setChatRateTs((p) => [...p, now].slice(-MAX));
      const pend = pendingMsgsRef.current;
      if (pend.length) {
        pendingMsgsRef.current = [];
        setMessages((p) => [...p, ...pend].slice(-400));
        setTotalMessages((n) => n + pend.length);
      }
    }, 500);
    return () => clearInterval(id);
  }, [connected]);

  const connect = useCallback(async (url: string, chInput: string) => {
    setError(null);
    const matchId = parseMatchId(url);
    const ch = parseChannel(chInput);
    if (!matchId) { setError('paste a valid HLTV match URL (…/matches/<id>/…)'); return; }
    if (!ch) { setError('enter the match’s twitch channel'); return; }

    // Persist inputs for refresh auto-reconnect, and restore this channel's clips.
    saveCsSession({ hltvUrl: url, channel: ch });
    const saved = await loadCsClips(ch).catch(() => null);
    setClips(saved ? saved.map((s) => ({ ...s, url: URL.createObjectURL(s.mp4) })) : []);

    // ── Twitch chat detection ──
    const detector = new HighlightDetector(0.5);
    const reader = new ChatReader(ch);
    detectorRef.current = detector;
    chatRef.current = reader;
    reader.onMessage((msg) => {
      const { currentRate, highlight } = detector.addMessage(msg);
      currentRateRef.current = currentRate;
      pendingMsgsRef.current.push(msg);
      const bufSec = captureRef.current?.getBufferedSec() ?? 0;
      const now = Date.now();
      if (
        highlight && highlight.score >= 0.2 &&
        bufSec >= MIN_BUFFERED_SEC &&
        now - lastChatClipRef.current > CHAT_CLIP_COOLDOWN_MS
      ) {
        lastChatClipRef.current = now;
        makeClip(now, 'HYPE', tokens.brand, 'chat');
      }
    });

    // ── HLTV scorebot ──
    const live = new HLTVLive();
    hltvRef.current = live;
    live.onStatus((s, detail) => setStatus(detail ? `${s}: ${detail.slice(0, 40)}` : s));
    live.onEvent((e) => setEvents((prev) => [...prev.slice(-600), e]));
    live.onScoreboard((b) => setBoard(b));
    live.onNotable((n) => {
      const tag = NOTABLE_TAG[n.type];
      // round_end just fired live → the play is in the last ~20s of buffer.
      makeClip(Date.now(), tag.label, tag.color, 'game', n.round);
    });
    live.connect(matchId);

    // ── Twitch stream capture ──
    const cap = new HlsCapture(ch, 60, {
      onSegment: (_n, durationSec) => setBuffered(durationSec),
      onError: (err) => setError(`capture: ${err.message}`),
    });
    captureRef.current = cap;

    setChannel(ch);
    setConnected(true);
    // Shareable + refresh-restorable: /cs?m=<matchId>&c=<channel>
    try { window.history.replaceState(null, '', `/cs?m=${matchId}&c=${encodeURIComponent(ch)}`); } catch { /* ignore */ }
    try { await reader.connect(); } catch (e) { setError(`chat: ${(e as Error).message}`); }
    cap.start().catch((err) => setError(`stream "${ch}" not capturable (clips disabled): ${(err as Error).message}`));
  }, [makeClip]);

  const disconnect = useCallback(() => {
    chatRef.current?.disconnect(); chatRef.current = null; detectorRef.current = null;
    hltvRef.current?.disconnect(); hltvRef.current = null;
    captureRef.current?.stop(); captureRef.current = null;
    currentRateRef.current = 0; pendingMsgsRef.current = [];
    clearCsSession();
    try { window.history.replaceState(null, '', '/cs'); } catch { /* ignore */ }
    setConnected(false); setEvents([]); setBoard(null); setBuffered(0);
    setMessages([]); setTotalMessages(0); setChatRate([]); setChatRateTs([]);
  }, []);

  // Persist this channel's ready clips (debounced) so a refresh keeps them.
  useEffect(() => {
    if (!connected || !channel) return;
    const t = window.setTimeout(() => {
      const ready: StoredCsClip[] = clips
        .filter((c) => c.mp4)
        .map((c) => ({ id: c.id, label: c.label, color: c.color, type: c.type, round: c.round, ts: c.ts, mp4: c.mp4! }));
      void saveCsClips(channel, ready).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [clips, connected, channel]);

  // On load, auto-reconnect from the URL (?m=&c=) or the saved session.
  const autoConnectedRef = useRef(false);
  useEffect(() => {
    if (autoConnectedRef.current) return;
    autoConnectedRef.current = true;
    const p = new URLSearchParams(window.location.search);
    const m = p.get('m'); const c = p.get('c');
    let url = '', ch = '';
    if (m && c) { url = `https://www.hltv.org/matches/${m}/`; ch = c; }
    else { const s = loadCsSession(); if (s) { url = s.hltvUrl; ch = s.channel; } }
    if (url && ch) { setHltvUrl(url); setChannelInput(ch); void connect(url, ch); }
  }, [connect]);

  const manualClip = useCallback(() => makeClip(Date.now(), 'CLIP', tokens.text.secondary, 'manual'), [makeClip]);

  const ranges = useMemo<TimelineRange[]>(
    () => clips.map((c) => ({ detTs: c.ts, startTs: c.ts - CLIP_WINDOW_MS, endTs: c.ts, color: c.color })),
    [clips],
  );

  return (
    <div style={{ height: '100vh', overflowY: 'auto', background: tokens.bg.base, color: tokens.text.primary }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
        padding: '12px 22px', borderBottom: `1px solid ${tokens.border.subtle}`, background: tokens.bg.surface,
      }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(18px, 2.4vw, 24px)', fontWeight: 700, letterSpacing: '-0.028em' }}>
          twitchsnipbot
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {connected && <Button variant="ghost" size="sm" onClick={manualClip}>clip now</Button>}
          {connected && <Button variant="ghost" size="sm" onClick={disconnect}>disconnect</Button>}
          <a href="/" style={{ fontSize: '12px', color: tokens.text.secondary, textDecoration: 'none', border: `1px solid ${tokens.border.default}`, borderRadius: radius.sm, padding: '6px 12px' }}>
            ← chat mode
          </a>
        </div>
      </header>

      <main style={{ maxWidth: '1600px', margin: '0 auto', padding: '16px 22px 40px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {!connected ? (
          <Setup
            hltvUrl={hltvUrl} setHltvUrl={setHltvUrl}
            channelInput={channelInput} setChannelInput={setChannelInput}
            error={error} onConnect={() => void connect(hltvUrl, channelInput)}
          />
        ) : (
          <>
            <StatusStrip channel={channel} status={status} board={board} buffered={buffered} clipCount={clips.length} error={error} />

            <div style={{ height: '230px' }}>
              <ChatTimeline data={chatRate} timestamps={chatRateTs} ranges={ranges} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '14px' }}>
              <div style={{ height: '360px', display: 'flex' }}>
                <ChatStream messages={messages} totalCount={totalMessages} />
              </div>
              <ClipsPanel clips={clips} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 380px)', gap: '14px', alignItems: 'start' }}>
              <div style={{ height: '480px' }}>
                <GameEvents events={events} />
              </div>
              <ScoreboardPanel board={board} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

interface SetupProps {
  hltvUrl: string; setHltvUrl: (s: string) => void;
  channelInput: string; setChannelInput: (s: string) => void;
  error: string | null; onConnect: () => void;
}
function Setup({ hltvUrl, setHltvUrl, channelInput, setChannelInput, error, onConnect }: SetupProps) {
  return (
    <div style={{ ...panel(), maxWidth: '640px', marginTop: '6vh', alignSelf: 'center', width: '100%' }}>
      <div style={{ fontSize: '10.5px', color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: '12px' }}>
        track a cs match
      </div>
      <ol style={{ margin: '0 0 16px', paddingLeft: '18px', color: tokens.text.secondary, fontSize: '12.5px', lineHeight: 1.8 }}>
        <li>open the match on <strong>HLTV</strong> once — this lets your browser read the live scoreboard</li>
        <li>copy the match URL and the <strong>Twitch channel</strong> it streams on</li>
        <li>paste both below — chat spikes <em>and</em> big plays get auto-clipped</li>
      </ol>
      <form onSubmit={(e) => { e.preventDefault(); onConnect(); }} style={{ display: 'grid', gap: '8px' }}>
        <input value={hltvUrl} onChange={(e) => setHltvUrl(e.target.value)} spellCheck={false} autoFocus
          placeholder="https://www.hltv.org/matches/2395147/…" style={inputStyle()} />
        <input value={channelInput} onChange={(e) => setChannelInput(e.target.value)} spellCheck={false}
          placeholder="twitch channel (e.g. titaanitv)" style={inputStyle()} />
        <Button type="submit" variant="primary" size="lg" uppercase={false} disabled={!hltvUrl.trim() || !channelInput.trim()}>
          connect
        </Button>
      </form>
      {error && <div style={{ marginTop: '10px', color: tokens.status.bad, fontSize: '12px' }}>{error}</div>}
    </div>
  );
}

function StatusStrip({ channel, status, board, buffered, clipCount, error }: {
  channel: string; status: string; board: Scoreboard | null; buffered: number; clipCount: number; error: string | null;
}) {
  const ok = status === 'connected';
  return (
    <div style={{ ...panel(), display: 'flex', alignItems: 'center', gap: '22px', flexWrap: 'wrap', padding: '10px 16px' }}>
      <Stat label="channel" value={`#${channel}`} accent={tokens.brand} />
      <Stat label="scorebot" value={status} accent={ok ? tokens.status.good : tokens.status.warn} />
      {board && <Stat label="score" value={`${board.ctScore} : ${board.tScore}`} accent={tokens.text.primary} />}
      {board?.map && <Stat label="map" value={board.map} />}
      <Stat label="buffered" value={`${buffered.toFixed(0)}s`} accent={buffered >= MIN_BUFFERED_SEC ? tokens.status.good : tokens.status.warn} />
      <Stat label="clips" value={String(clipCount)} accent={tokens.status.good} />
      {error && <span style={{ color: tokens.status.bad, fontSize: '11.5px', marginLeft: 'auto', maxWidth: '40%' }}>{error}</span>}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, minWidth: '54px' }}>
      <span style={{ fontSize: '9.5px', color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: '0.14em' }}>{label}</span>
      <span style={{ fontSize: '13.5px', fontWeight: 600, color: accent || tokens.text.primary, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function ClipsPanel({ clips }: { clips: CsClip[] }) {
  return (
    <div style={{ ...panel(), height: '360px', display: 'flex', flexDirection: 'column', padding: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${tokens.border.subtle}`, fontSize: '10.5px', color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: '0.16em', display: 'flex', justifyContent: 'space-between' }}>
        <span>clips</span><span>{clips.length}</span>
      </div>
      {clips.length === 0 ? (
        <p style={{ color: tokens.text.muted, fontSize: '12px', margin: 'auto', textAlign: 'center', padding: '20px' }}>
          aces, 4Ks, clutches, defuses and chat spikes get clipped here, each tagged by type.
        </p>
      ) : (
        <div style={{ overflowY: 'auto', padding: '10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px', alignContent: 'start' }}>
          {clips.map((c) => <ClipCard key={c.id} c={c} />)}
        </div>
      )}
    </div>
  );
}

function ClipCard({ c }: { c: CsClip }) {
  return (
    <div style={{ background: tokens.bg.raised, border: `1px solid ${tokens.border.subtle}`, borderRadius: radius.sm, overflow: 'hidden' }}>
      <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {c.url ? (
          <video src={c.url} controls preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <span style={{ fontSize: '10.5px', color: tokens.text.muted }}>remuxing…</span>
        )}
        <span style={{
          position: 'absolute', top: '5px', left: '5px',
          fontSize: '9.5px', fontWeight: 800, letterSpacing: '0.05em',
          color: '#fff', background: c.color, padding: '2px 6px', borderRadius: '3px',
        }}>
          {c.label}{c.round ? ` · R${c.round}` : ''}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px' }}>
        <span style={{ fontSize: '10px', color: tokens.text.muted }}>{new Date(c.ts).toLocaleTimeString()}</span>
        {c.url && (
          <a href={c.url} download={`${c.label.toLowerCase()}_${c.ts}.mp4`} style={{ fontSize: '10.5px', color: tokens.brand, textDecoration: 'none', fontWeight: 600 }}>
            download
          </a>
        )}
      </div>
    </div>
  );
}

function ScoreboardPanel({ board }: { board: Scoreboard | null }) {
  return (
    <div style={panel()}>
      <div style={{ fontSize: '10.5px', color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: '12px' }}>scoreboard</div>
      {!board ? (
        <p style={{ color: tokens.text.muted, fontSize: '12px', margin: 0 }}>waiting for live data…</p>
      ) : (
        (['TERRORIST', 'CT'] as const).map((side) => (
          <div key={side} style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '10px', color: side === 'CT' ? '#6ca6ff' : '#f5b94d', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px', fontWeight: 700 }}>{side}</div>
            {board.players.filter((p) => p.side === side).map((p) => (
              <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', padding: '2.5px 0', opacity: p.alive ? 1 : 0.4, fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: p.alive ? tokens.status.good : tokens.text.muted, flexShrink: 0 }} />
                  {p.name}
                </span>
                <span style={{ color: tokens.text.muted }}>{p.kills}-{p.deaths}-{p.assists} · ${p.money}</span>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function panel(): React.CSSProperties {
  return { background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, borderRadius: radius.md, padding: '14px' };
}
function inputStyle(): React.CSSProperties {
  return { padding: '11px 14px', background: tokens.bg.raised, border: `1px solid ${tokens.border.default}`, borderRadius: radius.md, color: tokens.text.primary, fontSize: '13px', outline: 'none', fontFamily: 'inherit' };
}
