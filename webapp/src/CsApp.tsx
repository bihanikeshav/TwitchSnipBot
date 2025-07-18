import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChatReader } from './services/chat-reader';
import { HighlightDetector, type DetectedHighlight } from './services/highlight-detector';
import { VideoCapture } from './services/video-capture';
import { ClipAssembler } from './services/clip-assembler';
import { HLTVLive, type HLTVEvent, type HLTVMatch } from './services/hltv-live';
import { parseChannel } from './utils/parse-channel';
import MatchSelector from './components/cs/MatchSelector';
import GameEvents from './components/cs/GameEvents';
import HighlightFeed from './components/cs/HighlightFeed';
import ClipPreview from './components/cs/ClipPreview';
import RecordingControls from './components/cs/RecordingControls';
import Button from './components/ui/Button';
import { tokens, radius } from './components/ui/theme';

/**
 * CS-match companion view (route: /cs).
 *
 * The streamlined `/` app is chat-only and zero-config. This view is the
 * "pro" mode for CS:GO/CS2: it pairs Twitch chat-spike highlights with live
 * HLTV game events (kills, rounds, multi-kills) and screen-capture clipping.
 *
 * Live HLTV needs a Socket.IO proxy (see hltv-live.ts) so the in-browser
 * scorebot connection is best-effort; the reliable path is loading an HLTV
 * JSON match log, which is parsed entirely client-side.
 */
export default function CsApp() {
  const [channel, setChannel] = useState('');
  const [channelInput, setChannelInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [highlights, setHighlights] = useState<DetectedHighlight[]>([]);

  const [match, setMatch] = useState<HLTVMatch | null>(null);
  const [events, setEvents] = useState<HLTVEvent[]>([]);
  const [notable, setNotable] = useState<{ type: string; description: string }[]>([]);
  const [liveNote, setLiveNote] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [clips, setClips] = useState<Blob[]>([]);

  const chatRef = useRef<ChatReader | null>(null);
  const detectorRef = useRef<HighlightDetector | null>(null);
  const captureRef = useRef<VideoCapture | null>(null);
  const hltvRef = useRef<HLTVLive | null>(null);
  const recordingRef = useRef(false);

  useEffect(() => { recordingRef.current = recording; }, [recording]);

  // ─────────────────────────── Twitch chat ───────────────────────────
  const connectChat = useCallback(async () => {
    const ch = parseChannel(channelInput);
    if (!ch) return;
    chatRef.current?.disconnect();
    const reader = new ChatReader(ch);
    const detector = new HighlightDetector(0.6);
    chatRef.current = reader;
    detectorRef.current = detector;
    reader.onMessage((msg) => {
      const { highlight } = detector.addMessage(msg);
      if (!highlight) return;
      setHighlights((prev) => [...prev, highlight]);
      // Auto-clip on a chat spike when we're recording.
      if (recordingRef.current && captureRef.current) {
        const buf = captureRef.current.getBuffer();
        if (buf) setClips((prev) => [...prev, ClipAssembler.assembleClip(buf)]);
      }
    });
    await reader.connect();
    setChannel(ch);
    setConnected(true);
  }, [channelInput]);

  const disconnectChat = useCallback(() => {
    chatRef.current?.disconnect();
    chatRef.current = null;
    detectorRef.current = null;
    setConnected(false);
    setChannel('');
  }, []);

  // ─────────────────────────── HLTV match ───────────────────────────
  const selectMatch = useCallback(async (matchId: string) => {
    hltvRef.current?.disconnect();
    setEvents([]);
    setNotable([]);
    setMatch({ id: matchId, team1: 'team 1', team2: 'team 2', event: 'live', format: '', score: { team1: 0, team2: 0 } });
    const live = new HLTVLive();
    hltvRef.current = live;
    live.onEvent((ev) => setEvents((prev) => [...prev, ev]));
    try {
      await live.connect(matchId);
      setLiveNote('connected to scorebot — waiting for events…');
    } catch (err) {
      setLiveNote(`live connect unavailable (${(err as Error).message}). load a match log below.`);
    }
  }, []);

  // Recompute notable plays (aces / multi-kills) whenever events change.
  useEffect(() => {
    if (events.length === 0) { setNotable([]); return; }
    setNotable(HLTVLive.detectNotableEvents(events).map((n) => ({ type: n.type, description: n.description })));
  }, [events]);

  const loadLog = useCallback((file: File) => {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const json = JSON.parse(String(fr.result));
        const arr = Array.isArray(json) ? json : [];
        setEvents(HLTVLive.parseLogFile(arr));
        setLiveNote(`loaded ${arr.length} log entries.`);
      } catch (e) {
        setLiveNote(`couldn't parse log: ${(e as Error).message}`);
      }
    };
    fr.readAsText(file);
  }, []);

  // ─────────────────────────── Recording ───────────────────────────
  const startRecording = useCallback(async () => {
    const cap = new VideoCapture(30);
    try {
      await cap.start();
      captureRef.current = cap;
      setRecording(true);
    } catch (err) {
      console.error('screen capture failed', err);
    }
  }, []);
  const stopRecording = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    setRecording(false);
  }, []);
  const manualClip = useCallback(() => {
    const buf = captureRef.current?.getBuffer();
    if (buf) setClips((prev) => [...prev, ClipAssembler.assembleClip(buf)]);
  }, []);

  useEffect(() => () => {
    chatRef.current?.disconnect();
    hltvRef.current?.disconnect();
    captureRef.current?.stop();
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: tokens.bg.base, color: tokens.text.primary }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '12px', flexWrap: 'wrap',
        padding: '12px 22px',
        borderBottom: `1px solid ${tokens.border.subtle}`, background: tokens.bg.surface,
      }}>
        <h1 style={{
          margin: 0, fontFamily: 'var(--font-display)',
          fontSize: 'clamp(18px, 2.4vw, 24px)', fontWeight: 700, letterSpacing: '-0.028em',
        }}>
          twitchsnipbot <span style={{ color: tokens.brand }}>· cs</span>
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <RecordingControls
            isRecording={recording}
            isConnected={connected}
            onStartRecording={startRecording}
            onStopRecording={stopRecording}
            onManualClip={manualClip}
          />
          <a href="/" style={{
            fontSize: '12px', color: tokens.text.secondary, textDecoration: 'none',
            border: `1px solid ${tokens.border.default}`, borderRadius: radius.sm, padding: '6px 12px',
          }}>
            ← chat mode
          </a>
        </div>
      </header>

      <main style={{
        maxWidth: '1500px', margin: '0 auto', padding: '16px 22px 32px',
        display: 'grid', gap: '14px',
      }}>
        {/* Connect row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '14px' }}>
          <div style={panel()}>
            <SectionLabel>twitch chat</SectionLabel>
            {!connected ? (
              <form
                onSubmit={(e) => { e.preventDefault(); void connectChat(); }}
                style={{ display: 'flex', gap: '8px' }}
              >
                <input
                  value={channelInput}
                  onChange={(e) => setChannelInput(e.target.value)}
                  placeholder="twitch url or channel"
                  spellCheck={false}
                  style={inputStyle()}
                />
                <Button type="submit" variant="primary" size="md" uppercase={false} disabled={!channelInput.trim()}>
                  connect
                </Button>
              </form>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '13px' }}>
                  tracking <span style={{ color: tokens.brand, fontWeight: 600 }}>#{channel}</span> chat
                </span>
                <Button variant="ghost" size="sm" onClick={disconnectChat}>disconnect</Button>
              </div>
            )}
          </div>

          <div style={panel()}>
            <MatchSelector onSelectMatch={(id) => void selectMatch(id)} selectedMatch={match} />
            <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <label style={{
                fontSize: '12px', color: tokens.text.secondary, cursor: 'pointer',
                border: `1px solid ${tokens.border.default}`, borderRadius: radius.sm, padding: '6px 10px',
              }}>
                load HLTV log (.json)
                <input
                  type="file" accept="application/json,.json"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) loadLog(f); }}
                  style={{ display: 'none' }}
                />
              </label>
              {liveNote && <span style={{ fontSize: '11px', color: tokens.text.muted }}>{liveNote}</span>}
            </div>
          </div>
        </div>

        {notable.length > 0 && (
          <div style={panel()}>
            <SectionLabel>notable plays</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {notable.map((n, i) => (
                <span key={i} style={{
                  fontSize: '11px', fontWeight: 600, color: tokens.brand,
                  background: `${tokens.brand}14`, border: `1px solid ${tokens.brand}40`,
                  borderRadius: '3px', padding: '2px 8px',
                }}>
                  {n.description}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Feeds */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '14px' }}>
          <GameEvents events={events} />
          <HighlightFeed highlights={highlights} />
        </div>

        <ClipPreview clips={clips} />
      </main>
    </div>
  );
}

function panel(): React.CSSProperties {
  return {
    background: tokens.bg.surface,
    border: `1px solid ${tokens.border.subtle}`,
    borderRadius: radius.md,
    padding: '14px',
  };
}
function inputStyle(): React.CSSProperties {
  return {
    flex: 1, minWidth: 0, padding: '9px 12px',
    background: tokens.bg.raised, border: `1px solid ${tokens.border.default}`,
    borderRadius: radius.sm, color: tokens.text.primary, fontSize: '13px',
    outline: 'none', fontFamily: 'inherit',
  };
}
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '10.5px', color: tokens.text.muted, textTransform: 'uppercase',
      letterSpacing: '0.16em', marginBottom: '10px',
    }}>
      {children}
    </div>
  );
}
