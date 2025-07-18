import React, { useState } from 'react';
import type { HLTVMatch } from '../../services/hltv-live';

interface MatchSelectorProps {
  onSelectMatch: (matchId: string) => void;
  selectedMatch: HLTVMatch | null;
}

export default function MatchSelector({ onSelectMatch, selectedMatch }: MatchSelectorProps) {
  const [matchId, setMatchId] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (matchId.trim()) {
      onSelectMatch(matchId.trim());
    }
  };

  return (
    <div style={{
      background: '#1f1f23',
      borderRadius: '8px',
      padding: '16px',
    }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#adadb8' }}>
        HLTV Match Tracker
      </h3>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <input
          type="text"
          value={matchId}
          onChange={(e) => setMatchId(e.target.value)}
          placeholder="Enter HLTV match ID..."
          style={{
            flex: 1,
            padding: '8px 12px',
            background: '#18181b',
            border: '1px solid #3a3a3d',
            borderRadius: '4px',
            color: '#efeff1',
            fontSize: '13px',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          style={{
            background: '#9147ff',
            color: '#fff',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '4px',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          Track
        </button>
      </form>

      {selectedMatch && (
        <div style={{
          padding: '10px',
          background: '#18181b',
          borderRadius: '4px',
          fontSize: '13px',
        }}>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>
            {selectedMatch.team1} vs {selectedMatch.team2}
          </div>
          <div style={{ color: '#adadb8', fontSize: '12px' }}>
            {selectedMatch.event} &middot; {selectedMatch.format}
          </div>
          <div style={{ marginTop: '6px', fontWeight: 700, fontSize: '16px' }}>
            {selectedMatch.score.team1} - {selectedMatch.score.team2}
          </div>
        </div>
      )}

      {!selectedMatch && (
        <p style={{ color: '#adadb8', fontSize: '12px', margin: 0 }}>
          Enter a match ID from HLTV to overlay live game events on the chat timeline.
          Combined chat + game event detection produces higher-confidence highlights.
        </p>
      )}
    </div>
  );
}
