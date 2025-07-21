import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HLTVLive, parseMatchId, type HLTVEvent, type Scoreboard, type NotablePlay } from './services/hltv-live';
import { HlsCapture } from './services/hls-capture';
import { tsToMp4, preloadFFmpeg } from './services/remuxer';
import { parseChannel } from './utils/parse-channel';
import GameEvents from './components/cs/GameEvents';
import ClipPreview from './components/cs/ClipPreview';
import Button from './components/ui/Button';
import { tokens, radius } from './components/ui/theme';

/**
 * CS-match companion (route: /cs).
 *
 * Connects to the HLTV scorebot CLIENT-SIDE (socket.io v2, withCredentials —
 * see hltv-live.ts) for live kills/rounds/scoreboard, and captures the match's
 * Twitch stream via the same zero-auth HLS pipeline the main app uses. When a
 * notable play fires (ace / 4K / 3K / defuse) it auto-clips the recent buffer.
 *
 * The scoreboard needs the user's browser to hold HLTV's cf_clearance cookie,
 * so the flow starts by sending them to the HLTV match page once.
 */
const CLIP_WINDOW_MS = 22_000;

export default function CsApp() {
  const [hltvUrl, setHltvUrl] = useState('');
  const [channelInput, setChannelInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<string>('idle');
  const [events, setEvents] = useState<HLTVEvent[]>([]);
  const [board, setBoard] = useState<Scoreboard | null>(null);
  const [notables, setNotables] = useState<NotablePlay[]>([]);
  const [clips, setClips] = useState<Blob[]>([]);
  const [buffered, setBuffered] = useState(0);
  const [clipping, setClipping] = useState(false);

  const hltvRef = useRef<HLTVLive | null>(null);
  const captureRef = useRef<HlsCapture | null>(null);

  useEffect(() => { preloadFFmpeg().catch(() => {}); }, []);
  useEffect(() => () => { hltvRef.current?.disconnect(); captureRef.current?.stop(); }, []);

  /** Slice the rolling buffer around `endTs` and remux to a playable mp4. */
  const makeClip = useCallback(async (endTs: number) => {
    const cap = captureRef.current;
    if (!cap?.isActive()) return;
    const slice = cap.getBufferRange(endTs - CLIP_WINDOW_MS, endTs);
    if (!slice) return;
    setClipping(true);
    try {
      const mp4 = await tsToMp4(slice.blob);
      setClips((prev) => [...prev, mp4]);
    } catch (e) {
      console.error('[cs] clip remux failed', e);
    } finally {
      setClipping(false);
    }
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    const matchId = parseMatchId(hltvUrl);
    const channel = parseChannel(channelInput);
    if (!matchId) { setError('paste a valid HLTV match URL (…/matches/<id>/…)'); return; }
    if (!channel) { setError('enter the match’s twitch channel'); return; }

    // Scorebot
    const live = new HLTVLive();
    hltvRef.current = live;
    live.onStatus((s, detail) => setStatus(detail ? `${s}: ${detail}` : s));
    live.onEvent((e) => setEvents((prev) => [...prev.slice(-200), e]));
    live.onScoreboard((b) => setBoard(b));
    live.onNotable((n) => {
      setNotables((prev) => [...prev.slice(-30), n]);
      void makeClip(n.timestamp + 3_000); // let the post-kill beat land in the window
    });
    live.connect(matchId);
    // Show the live view immediately — the scoreboard is useful on its own,
    // so a non-capturable stream (channel offline) only disables clipping.
    setConnected(true);

    const cap = new HlsCapture(channel, 60, {
      onSegment: (_n, durationSec) => setBuffered(durationSec),
      onError: (err) => setError(`capture: ${err.message}`),
    });
    captureRef.current = cap;
    cap.start().catch((err) =>
      setError(`stream "${channel}" not capturable (clips disabled): ${(err as Error).message}`),
    );
  }, [hltvUrl, channelInput, makeClip]);

  const disconnect = useCallback(() => {
    hltvRef.current?.disconnect(); hltvRef.current = null;
    captureRef.current?.stop(); captureRef.current = null;
    setConnected(false); setEvents([]); setBoard(null); setNotables([]); setBuffered(0);
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: tokens.bg.base, color: tokens.text.primary }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
        padding: '12px 22px', borderBottom: `1px solid ${tokens.border.subtle}`, background: tokens.bg.surface,
      }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(18px, 2.4vw, 24px)', fontWeight: 700, letterSpacing: '-0.028em' }}>
          twitchsnipbot
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {connected && <Button variant="ghost" size="sm" onClick={() => void makeClip(Date.now())}>clip now</Button>}
          {connected && <Button variant="ghost" size="sm" onClick={disconnect}>disconnect</Button>}
          <a href="/" style={{ fontSize: '12px', color: tokens.text.secondary, textDecoration: 'none', border: `1px solid ${tokens.border.default}`, borderRadius: radius.sm, padding: '6px 12px' }}>
            ← chat mode
          </a>
        </div>
      </header>

      <main style={{ maxWidth: '1500px', margin: '0 auto', padding: '16px 22px 32px', display: 'grid', gap: '14px' }}>
        {!connected ? (
          <Setup
            hltvUrl={hltvUrl} setHltvUrl={setHltvUrl}
            channelInput={channelInput} setChannelInput={setChannelInput}
            error={error} onConnect={() => void connect()}
          />
        ) : (
          <>
            <StatusBar status={status} board={board} buffered={buffered} clipping={clipping} error={error} />
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,360px)', gap: '14px' }}>
              <GameEvents events={events} />
              <div style={{ display: 'grid', gap: '14px', alignContent: 'start' }}>
                <ScoreboardPanel board={board} />
                <NotablePanel notables={notables} />
              </div>
            </div>
            <ClipPreview clips={clips} />
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
    <div style={{ ...panel(), maxWidth: '620px' }}>
      <div style={{ fontSize: '10.5px', color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: '10px' }}>
        track a cs match
      </div>
      <ol style={{ margin: '0 0 14px', paddingLeft: '18px', color: tokens.text.secondary, fontSize: '12.5px', lineHeight: 1.7 }}>
        <li>open the match on <strong>HLTV</strong> once (so your browser can read its live scoreboard)</li>
        <li>copy the match URL and the <strong>Twitch channel</strong> it links to</li>
        <li>paste both below</li>
      </ol>
      <form onSubmit={(e) => { e.preventDefault(); onConnect(); }} style={{ display: 'grid', gap: '8px' }}>
        <input value={hltvUrl} onChange={(e) => setHltvUrl(e.target.value)} spellCheck={false}
          placeholder="https://www.hltv.org/matches/2395147/…" style={inputStyle()} />
        <input value={channelInput} onChange={(e) => setChannelInput(e.target.value)} spellCheck={false}
          placeholder="twitch channel (e.g. titaanitv)" style={inputStyle()} />
        <Button type="submit" variant="primary" size="lg" uppercase={false}
          disabled={!hltvUrl.trim() || !channelInput.trim()}>
          connect
        </Button>
      </form>
      {error && <div style={{ marginTop: '10px', color: tokens.status.bad, fontSize: '12px' }}>{error}</div>}
    </div>
  );
}

function StatusBar({ status, board, buffered, clipping, error }: {
  status: string; board: Scoreboard | null; buffered: number; clipping: boolean; error: string | null;
}) {
  const ok = status === 'connected';
  return (
    <div style={{ ...panel(), display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap', padding: '10px 16px' }}>
      <Stat label="scorebot" value={status} accent={ok ? tokens.status.good : tokens.status.warn} />
      {board?.map && <Stat label="map" value={board.map} />}
      {board && <Stat label="score" value={`${board.ctScore} : ${board.tScore}`} accent={tokens.brand} />}
      <Stat label="buffered" value={`${buffered.toFixed(0)}s`} />
      {clipping && <Stat label="clip" value="remuxing…" accent={tokens.status.warn} />}
      {error && <span style={{ color: tokens.status.bad, fontSize: '12px' }}>{error}</span>}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
      <span style={{ fontSize: '9.5px', color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: '0.14em' }}>{label}</span>
      <span style={{ fontSize: '13px', fontWeight: 600, color: accent || tokens.text.primary }}>{value}</span>
    </div>
  );
}

function ScoreboardPanel({ board }: { board: Scoreboard | null }) {
  return (
    <div style={panel()}>
      <PanelTitle>scoreboard</PanelTitle>
      {!board ? (
        <p style={{ color: tokens.text.muted, fontSize: '12px', margin: 0 }}>waiting for live data…</p>
      ) : (
        ['TERRORIST', 'CT'].map((side) => (
          <div key={side} style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '10px', color: side === 'CT' ? '#6ca6ff' : '#f5b94d', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '3px' }}>{side}</div>
            {board.players.filter((p) => p.side === side).map((p) => (
              <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', padding: '2px 0', opacity: p.alive ? 1 : 0.45, fontVariantNumeric: 'tabular-nums' }}>
                <span>{p.name}</span>
                <span style={{ color: tokens.text.muted }}>{p.kills}-{p.deaths} · ${p.money}</span>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function NotablePanel({ notables }: { notables: NotablePlay[] }) {
  return (
    <div style={panel()}>
      <PanelTitle>notable plays · auto-clipped</PanelTitle>
      {notables.length === 0 ? (
        <p style={{ color: tokens.text.muted, fontSize: '12px', margin: 0 }}>aces, 4Ks, 3Ks and defuses get clipped here.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {[...notables].reverse().map((n, i) => (
            <span key={i} style={{ fontSize: '12px', color: tokens.brand, fontWeight: 600 }}>{n.description}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: '10.5px', color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: '10px' }}>{children}</div>;
}
function panel(): React.CSSProperties {
  return { background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, borderRadius: radius.md, padding: '14px' };
}
function inputStyle(): React.CSSProperties {
  return { padding: '11px 14px', background: tokens.bg.raised, border: `1px solid ${tokens.border.default}`, borderRadius: radius.md, color: tokens.text.primary, fontSize: '13px', outline: 'none', fontFamily: 'inherit' };
}
