import React from 'react';
import type { HLTVEvent } from '../../services/hltv-live';

interface GameEventsProps {
  events: HLTVEvent[];
}

const EVENT_ICONS: Record<string, string> = {
  kill: 'x',
  round_start: '>',
  round_end: '#',
  bomb_plant: '*',
  bomb_defuse: '+',
};

const EVENT_COLORS: Record<string, string> = {
  kill: '#ff6b6b',
  round_start: '#4ecdc4',
  round_end: '#45b7d1',
  bomb_plant: '#f9ca24',
  bomb_defuse: '#6c5ce7',
};

export default function GameEvents({ events }: GameEventsProps) {
  const recent = events.slice(-30).reverse();

  return (
    <div style={{
      background: '#1f1f23',
      borderRadius: '8px',
      padding: '16px',
    }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#adadb8' }}>
        Game Events
      </h3>
      <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
        {recent.length === 0 ? (
          <p style={{ color: '#adadb8', fontSize: '13px', margin: 0 }}>
            No game events. Connect to an HLTV match to see live events.
          </p>
        ) : (
          recent.map((event, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 0',
                fontSize: '12px',
                borderBottom: i < recent.length - 1 ? '1px solid #2a2a2e' : 'none',
              }}
            >
              <span style={{
                color: EVENT_COLORS[event.type] || '#adadb8',
                fontWeight: 700,
                width: '12px',
                textAlign: 'center',
              }}>
                {EVENT_ICONS[event.type] || '?'}
              </span>
              <span style={{ color: '#dedee3', flex: 1 }}>
                {formatEvent(event)}
              </span>
              <span style={{ color: '#adadb8', fontSize: '11px' }}>
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatEvent(event: HLTVEvent): string {
  switch (event.type) {
    case 'kill': {
      const hs = event.data.headshot ? ' (HS)' : '';
      return `${event.data.killer} [${event.data.weapon}] ${event.data.victim}${hs}`;
    }
    case 'round_start':
      return 'Round started';
    case 'round_end':
      return `Round over — ${event.data.winner} wins (${event.data.ctScore}-${event.data.tScore})`;
    case 'bomb_plant':
      return 'Bomb planted';
    case 'bomb_defuse':
      return 'Bomb defused';
    default:
      return event.type;
  }
}
