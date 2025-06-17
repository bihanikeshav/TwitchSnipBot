import React, { useState } from 'react';
import type { AppState } from '../App';
import TwitchPlayer from './TwitchPlayer';
import ChatTimeline from './ChatTimeline';
import HighlightFeed from './HighlightFeed';
import ClipPreview from './ClipPreview';
import RecordingControls from './RecordingControls';
import MatchSelector from './MatchSelector';
import GameEvents from './GameEvents';
import type { HLTVMatch, HLTVEvent } from '../services/hltv-live';

interface DashboardProps {
  state: AppState;
  onConnect: (channel: string) => void;
  onDisconnect: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onManualClip: () => void;
}

export default function Dashboard({
  state,
  onConnect,
  onDisconnect,
  onStartRecording,
  onStopRecording,
  onManualClip,
}: DashboardProps) {
  const [channelInput, setChannelInput] = useState('');
  const [selectedMatch, setSelectedMatch] = useState<HLTVMatch | null>(null);
  const [gameEvents] = useState<HLTVEvent[]>([]);

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (channelInput.trim()) {
      onConnect(channelInput.trim());
    }
  };

  return (
    <div style={{ padding: '16px 24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Top bar: channel input + recording controls */}
      <div style={{
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
        marginBottom: '16px',
        flexWrap: 'wrap',
      }}>
        <form onSubmit={handleConnect} style={{ display: 'flex', gap: '8px', flex: 1, minWidth: '280px' }}>
          <input
            type="text"
            value={channelInput}
            onChange={(e) => setChannelInput(e.target.value)}
            placeholder="Enter Twitch channel..."
            disabled={state.isConnected}
            style={{
              flex: 1,
              padding: '10px 14px',
              background: '#1f1f23',
              border: '1px solid #3a3a3d',
              borderRadius: '4px',
              color: '#efeff1',
              fontSize: '14px',
              outline: 'none',
            }}
          />
          {!state.isConnected ? (
            <button
              type="submit"
              disabled={!channelInput.trim()}
              style={{
                background: channelInput.trim() ? '#9147ff' : '#3a3a3d',
                color: '#fff',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: channelInput.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              Connect
            </button>
          ) : (
            <button
              type="button"
              onClick={onDisconnect}
              style={{
                background: '#3a3a3d',
                color: '#efeff1',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Disconnect
            </button>
          )}
        </form>

        <RecordingControls
          isRecording={state.isRecording}
          isConnected={state.isConnected}
          onStartRecording={onStartRecording}
          onStopRecording={onStopRecording}
          onManualClip={onManualClip}
        />
      </div>

      {/* Status bar */}
      {state.isConnected && (
        <div style={{
          display: 'flex',
          gap: '16px',
          marginBottom: '16px',
          fontSize: '13px',
          color: '#adadb8',
        }}>
          <span>
            <span style={{ color: '#44bb44', marginRight: '4px' }}>&#9679;</span>
            Connected to #{state.channel}
          </span>
          <span>{state.messages.length} messages</span>
          <span>{state.highlights.length} highlights</span>
          {state.isRecording && (
            <span style={{ color: '#ff4444' }}>
              Recording active
            </span>
          )}
        </div>
      )}

      {/* Main grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 360px',
        gap: '16px',
      }}>
        {/* Left column: player + timeline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <TwitchPlayer channel={state.channel} />
          <ChatTimeline
            data={state.chatRate}
            timestamps={state.chatRateTimestamps}
            highlights={state.highlights}
          />
        </div>

        {/* Right column: highlights, clips, match tracker */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <HighlightFeed highlights={state.highlights} />
          <ClipPreview clips={state.clips} />
          <MatchSelector
            onSelectMatch={(id) => setSelectedMatch({ id, team1: '...', team2: '...', event: '', format: '', score: { team1: 0, team2: 0 } })}
            selectedMatch={selectedMatch}
          />
          {gameEvents.length > 0 && <GameEvents events={gameEvents} />}
        </div>
      </div>
    </div>
  );
}
