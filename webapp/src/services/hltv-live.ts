/**
 * HLTV live match data via the public scorebot (scorebot-lb.hltv.org).
 *
 * Connection works entirely client-side: the scorebot is a socket.io v2
 * (Engine.IO 3) server that REFLECTS the requesting origin in its CORS
 * headers, so any page can talk to it — the only gate is Cloudflare's
 * `cf_clearance` cookie, which the user's browser already holds after
 * visiting an hltv.org page once. We send it with `withCredentials: true`.
 *
 * Protocol (captured from hltv.org itself):
 *   connect → emit `readyForMatch` `{"token":"","listId":"<matchId>"}`
 *   server → `log` events (kills / rounds / bomb / match) and
 *            `scoreboard` events (per-player live stats).
 *
 * The match id comes straight from the pasted HLTV URL — no page scraping
 * (the match page itself is NOT CORS-readable; only the scorebot is).
 *
 * IMPORTANT: the first `log` payload is the FULL match history. We replay it
 * to build round/feed state but stay "unprimed" so it does NOT fire notable
 * plays — those moments are already gone from the capture buffer and can't be
 * clipped. Only live events after the initial dump trigger notables/clips.
 */
import io from 'socket.io-client';

const SCOREBOT_URL = 'https://scorebot-lb.hltv.org';

export type HLTVEventType =
  | 'kill' | 'round_start' | 'round_end' | 'bomb_plant' | 'bomb_defuse' | 'match_started';

export interface HLTVEvent {
  type: HLTVEventType;
  timestamp: number;
  round: number;
  data: Record<string, unknown>;
}

export interface ScoreboardPlayer {
  name: string;
  side: 'CT' | 'TERRORIST';
  kills: number;
  deaths: number;
  assists: number;
  alive: boolean;
  hp: number;
  money: number;
}

export interface Scoreboard {
  ctScore: number;
  tScore: number;
  map: string;
  players: ScoreboardPlayer[];
}

export type NotableType = 'ace' | '4k' | '3k' | 'clutch' | 'bomb_defuse';

export interface NotablePlay {
  type: NotableType;
  player: string;
  description: string;
  timestamp: number;
  round: number;
}

/** Short HLTV-style tag + color for a notable play, used on clip badges. */
export const NOTABLE_TAG: Record<NotableType, { label: string; color: string }> = {
  ace: { label: 'ACE', color: '#ff4d4d' },
  '4k': { label: '4K', color: '#ff9d3d' },
  '3k': { label: '3K', color: '#ffd23d' },
  clutch: { label: 'CLUTCH', color: '#a855f7' },
  bomb_defuse: { label: 'DEFUSE', color: '#3dd6c4' },
};

type EventCb = (e: HLTVEvent) => void;
type ScoreboardCb = (s: Scoreboard) => void;
type NotableCb = (n: NotablePlay) => void;
type StatusCb = (status: 'connecting' | 'connected' | 'error' | 'closed', detail?: string) => void;

export function parseMatchId(input: string): string | null {
  const m = input.match(/(?:hltv\.org\/matches\/)?(\d{5,})/);
  return m ? m[1] : null;
}

export class HLTVLive {
  private socket: SocketIOClient.Socket | null = null;
  private eventCbs: EventCb[] = [];
  private scoreboardCbs: ScoreboardCb[] = [];
  private notableCbs: NotableCb[] = [];
  private statusCbs: StatusCb[] = [];

  /** False until the initial historical log dump has been replayed. */
  private primed = false;
  private roundNum = 0;
  /** Kills per killer in the current round, for multi-kill / clutch detection. */
  private roundKills = new Map<string, number>();
  private lastScoreboard: Scoreboard | null = null;

  onEvent(cb: EventCb) { this.eventCbs.push(cb); }
  onScoreboard(cb: ScoreboardCb) { this.scoreboardCbs.push(cb); }
  onNotable(cb: NotableCb) { this.notableCbs.push(cb); }
  onStatus(cb: StatusCb) { this.statusCbs.push(cb); }

  private emitStatus(s: Parameters<StatusCb>[0], detail?: string) {
    for (const cb of this.statusCbs) cb(s, detail);
  }

  connect(matchId: string): void {
    this.emitStatus('connecting');
    this.primed = false;
    this.roundNum = 0;
    // withCredentials sends the hltv.org cf_clearance cookie cross-site.
    // (Not in the v1 type defs, so widen ConnectOpts to include it.)
    const opts: SocketIOClient.ConnectOpts & { withCredentials?: boolean } = {
      withCredentials: true,
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 8,
      timeout: 10000,
    };
    this.socket = io(SCOREBOT_URL, opts);

    this.socket.on('connect', () => {
      this.emitStatus('connected');
      this.socket!.emit('readyForMatch', JSON.stringify({ token: '', listId: String(matchId) }));
    });
    this.socket.on('connect_error', (e: unknown) => this.emitStatus('error', String(e)));
    this.socket.on('reconnect_failed', () => this.emitStatus('error', 'reconnect failed'));
    this.socket.on('disconnect', () => this.emitStatus('closed'));

    this.socket.on('log', (raw: unknown) => this.handleLog(raw));
    this.socket.on('scoreboard', (raw: unknown) => this.handleScoreboard(raw));
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.roundKills.clear();
    this.primed = false;
    this.roundNum = 0;
  }

  private parse(raw: unknown): Record<string, unknown> | Array<Record<string, unknown>> {
    return typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>);
  }

  private handleLog(raw: unknown): void {
    let parsed: Record<string, unknown>;
    try { parsed = this.parse(raw) as Record<string, unknown>; } catch { return; }
    const entries = (Array.isArray(parsed) ? parsed : parsed.log) as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(entries)) return;

    for (const entry of entries) {
      const now = Date.now();
      if ('RoundStart' in entry) {
        this.roundNum += 1;
        this.roundKills.clear();
        this.fire({ type: 'round_start', timestamp: now, round: this.roundNum, data: {} });
      } else if ('MatchStarted' in entry) {
        const d = entry.MatchStarted as Record<string, unknown>;
        this.fire({ type: 'match_started', timestamp: now, round: this.roundNum, data: { map: d?.map } });
      } else if ('Kill' in entry) {
        const k = entry.Kill as Record<string, unknown>;
        const killer = String(k.killerName ?? k.killerNick ?? '');
        this.fire({
          type: 'kill', timestamp: now, round: this.roundNum,
          data: {
            killer,
            victim: k.victimName ?? k.victimNick,
            weapon: k.weapon,
            headshot: k.headShot ?? k.headshot,
            killerSide: k.killerSide,
            victimSide: k.victimSide,
          },
        });
        if (killer) this.roundKills.set(killer, (this.roundKills.get(killer) ?? 0) + 1);
      } else if ('RoundEnd' in entry) {
        const r = entry.RoundEnd as Record<string, unknown>;
        this.fire({
          type: 'round_end', timestamp: now, round: this.roundNum,
          data: {
            ctScore: r?.counterTerroristScore ?? r?.ctScore,
            tScore: r?.terroristScore ?? r?.tScore,
            winner: r?.winner, winType: r?.winType,
          },
        });
        if (this.primed) this.flushRoundNotables(now);
        else this.roundKills.clear();
      } else if ('BombPlanted' in entry) {
        this.fire({ type: 'bomb_plant', timestamp: now, round: this.roundNum, data: entry.BombPlanted as Record<string, unknown> });
      } else if ('BombDefused' in entry) {
        const d = entry.BombDefused as Record<string, unknown>;
        this.fire({ type: 'bomb_defuse', timestamp: now, round: this.roundNum, data: d });
        const player = String(d?.playerName ?? d?.playerNick ?? '');
        if (this.primed && player) {
          this.fireNotable({ type: 'bomb_defuse', player, description: `${player} defused the bomb`, timestamp: now, round: this.roundNum });
        }
      }
    }

    // Everything processed before this point was the historical dump.
    this.primed = true;
  }

  /**
   * Fire notables for the just-ended round. One per standout player:
   * a lone survivor with 2+ kills is a CLUTCH, otherwise 3K/4K/ACE.
   */
  private flushRoundNotables(ts: number): void {
    const board = this.lastScoreboard;
    for (const [player, kills] of this.roundKills) {
      if (kills < 3) {
        // 2-kill rounds are only notable as a clutch.
        const sbp = board?.players.find((p) => p.name === player);
        const aliveOnSide = sbp ? board!.players.filter((p) => p.side === sbp.side && p.alive).length : 99;
        if (sbp?.alive && aliveOnSide === 1 && kills >= 2) {
          this.fireNotable({ type: 'clutch', player, description: `${player} clutch (${kills}K)`, timestamp: ts, round: this.roundNum });
        }
        continue;
      }
      const sbp = board?.players.find((p) => p.name === player);
      const aliveOnSide = sbp ? board!.players.filter((p) => p.side === sbp.side && p.alive).length : 99;
      if (sbp?.alive && aliveOnSide === 1) {
        this.fireNotable({ type: 'clutch', player, description: `${player} clutch (${kills}K)`, timestamp: ts, round: this.roundNum });
      } else if (kills >= 5) {
        this.fireNotable({ type: 'ace', player, description: `${player} ACE`, timestamp: ts, round: this.roundNum });
      } else if (kills === 4) {
        this.fireNotable({ type: '4k', player, description: `${player} 4K`, timestamp: ts, round: this.roundNum });
      } else {
        this.fireNotable({ type: '3k', player, description: `${player} 3K`, timestamp: ts, round: this.roundNum });
      }
    }
    this.roundKills.clear();
  }

  private handleScoreboard(raw: unknown): void {
    let obj: Record<string, unknown>;
    try { obj = this.parse(raw) as Record<string, unknown>; } catch { return; }
    const toPlayers = (arr: unknown, side: 'CT' | 'TERRORIST'): ScoreboardPlayer[] =>
      (Array.isArray(arr) ? arr : []).map((p: Record<string, unknown>) => ({
        name: String(p.name ?? p.nick ?? ''),
        side,
        kills: Number(p.score ?? p.kills ?? 0),
        deaths: Number(p.deaths ?? 0),
        assists: Number(p.assists ?? 0),
        alive: Boolean(p.alive),
        hp: Number(p.hp ?? 0),
        money: Number(p.money ?? 0),
      }));
    const players = [
      ...toPlayers(obj.CT, 'CT'),
      ...toPlayers(obj.TERRORIST, 'TERRORIST'),
    ];
    if (players.length === 0) return;
    const board: Scoreboard = {
      ctScore: Number((obj.ctScore as number) ?? (obj.counterTerroristScore as number) ?? 0),
      tScore: Number((obj.tScore as number) ?? (obj.terroristScore as number) ?? 0),
      map: String(obj.map ?? ''),
      players,
    };
    this.lastScoreboard = board;
    for (const cb of this.scoreboardCbs) cb(board);
  }

  private fire(e: HLTVEvent) { for (const cb of this.eventCbs) cb(e); }
  private fireNotable(n: NotablePlay) { for (const cb of this.notableCbs) cb(n); }
}
