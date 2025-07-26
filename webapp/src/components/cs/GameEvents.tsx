import React, { useMemo } from 'react';
import type { HLTVEvent } from '../../services/hltv-live';
import { tokens, radius } from '../ui/theme';

const SIDE_COLOR = { CT: '#6ca6ff', TERRORIST: '#f5b94d' } as const;

interface GameEventsProps {
  events: HLTVEvent[];
  /** How many of the most recent events to keep in the feed. */
  max?: number;
}

interface RoundGroup {
  round: number;
  end: HLTVEvent | null;
  /** kill / bomb events, newest first */
  plays: HLTVEvent[];
}

function groupRounds(events: HLTVEvent[]): RoundGroup[] {
  const byRound = new Map<number, RoundGroup>();
  for (const e of events) {
    let g = byRound.get(e.round);
    if (!g) { g = { round: e.round, end: null, plays: [] }; byRound.set(e.round, g); }
    if (e.type === 'round_end') g.end = e;
    else if (e.type !== 'round_start') g.plays.push(e);
  }
  // newest round first; plays newest first within a round
  return [...byRound.values()]
    .sort((a, b) => b.round - a.round)
    .map((g) => ({ ...g, plays: [...g.plays].reverse() }));
}

export default function GameEvents({ events, max = 400 }: GameEventsProps) {
  const groups = useMemo(() => groupRounds(events.slice(-max)), [events, max]);

  return (
    <div style={{
      background: tokens.bg.surface,
      border: `1px solid ${tokens.border.subtle}`,
      borderRadius: radius.md,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      height: '100%',
      width: '100%',
    }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${tokens.border.subtle}`,
        fontSize: '10.5px', color: tokens.text.muted,
        textTransform: 'uppercase', letterSpacing: '0.16em',
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>game events</span>
        <span>{events.length} logged</span>
      </div>

      <div className="scroll-thin" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {groups.length === 0 ? (
          <p style={{ color: tokens.text.muted, fontSize: '12px', margin: '12px', textAlign: 'center' }}>
            waiting for the scorebot… live kills and rounds stream here.
          </p>
        ) : (
          groups.map((g) => <RoundBlock key={g.round} g={g} />)
        )}
      </div>
    </div>
  );
}

function RoundBlock({ g }: { g: RoundGroup }) {
  const ct = Number(g.end?.data.ctScore);
  const t = Number(g.end?.data.tScore);
  const hasScore = Number.isFinite(ct) && Number.isFinite(t);
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '4px 8px', marginBottom: '4px',
        position: 'sticky', top: 0, zIndex: 1,
        background: tokens.bg.surface,
      }}>
        <span style={{
          fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em',
          color: tokens.text.secondary, fontFamily: 'var(--font-display)',
        }}>
          ROUND {g.round}
        </span>
        <span style={{ flex: 1, height: '1px', background: tokens.border.subtle }} />
        {hasScore && (
          <span style={{ fontSize: '11px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ color: SIDE_COLOR.CT }}>{ct}</span>
            <span style={{ color: tokens.text.muted }}> : </span>
            <span style={{ color: SIDE_COLOR.TERRORIST }}>{t}</span>
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
        {g.plays.map((e, i) => <EventRow key={i} e={e} />)}
      </div>
    </div>
  );
}

function EventRow({ e }: { e: HLTVEvent }) {
  if (e.type === 'kill') {
    const killer = String(e.data.killer ?? '');
    const victim = String(e.data.victim ?? '');
    const weapon = String(e.data.weapon ?? '');
    const hs = Boolean(e.data.headshot);
    const kc = SIDE_COLOR[e.data.killerSide as keyof typeof SIDE_COLOR] ?? tokens.text.primary;
    const vc = SIDE_COLOR[e.data.victimSide as keyof typeof SIDE_COLOR] ?? tokens.text.muted;
    return (
      <Row>
        <span style={{ color: kc, fontWeight: 600 }}>{killer}</span>
        <span style={{ color: tokens.text.muted, fontSize: '11px' }}>
          {weapon ? `[${weapon}]` : '×'}{hs ? ' ⌖' : ''}
        </span>
        <span style={{ color: vc, opacity: 0.85 }}>{victim}</span>
      </Row>
    );
  }
  if (e.type === 'bomb_plant') return <Row><span style={{ color: '#ff6b4d', fontWeight: 600 }}>● bomb planted</span></Row>;
  if (e.type === 'bomb_defuse') return <Row><span style={{ color: '#3dd6c4', fontWeight: 600 }}>✓ bomb defused</span></Row>;
  if (e.type === 'match_started') return <Row><span style={{ color: tokens.text.muted }}>map: {String(e.data.map ?? '')}</span></Row>;
  return null;
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '3px 9px', fontSize: '12.5px', lineHeight: 1.3 }}>
      {children}
    </div>
  );
}
