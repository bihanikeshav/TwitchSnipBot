/**
 * HLTV live match data via scorebot.
 * Provides real-time CS:GO match events (kills, rounds, aces, clutches).
 *
 * Note: Direct browser connection to HLTV may be CORS-blocked.
 * In production, use a Cloudflare Worker proxy (free tier).
 */

export interface HLTVEvent {
  type: 'kill' | 'round_start' | 'round_end' | 'bomb_plant' | 'bomb_defuse';
  timestamp: number;
  data: Record<string, unknown>;
}

export interface HLTVMatch {
  id: string;
  team1: string;
  team2: string;
  event: string;
  format: string;
  score: { team1: number; team2: number };
}

export interface KillEvent {
  killer: string;
  victim: string;
  weapon: string;
  headshot: boolean;
  killerSide: string;
  victimSide: string;
}

export interface RoundEndEvent {
  ctScore: number;
  tScore: number;
  winner: string;
  winType: string;
}

type EventCallback = (event: HLTVEvent) => void;

export class HLTVLive {
  private callbacks: EventCallback[] = [];
  private ws: WebSocket | null = null;
  private kills: KillEvent[] = [];
  private roundKills: Map<string, number> = new Map();

  onEvent(callback: EventCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Connect to HLTV scorebot for a match.
   * In production, proxyUrl should point to a Cloudflare Worker that proxies HLTV's Socket.IO.
   */
  async connect(matchId: string, proxyUrl?: string): Promise<void> {
    const url = proxyUrl || `wss://scorebot-secure.hltv.org/socket.io/?matchId=${matchId}`;

    this.ws = new WebSocket(url);

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    this.ws.onerror = (err) => {
      console.error('HLTV WebSocket error:', err);
    };

    this.ws.onclose = () => {
      console.log('HLTV WebSocket closed');
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.kills = [];
    this.roundKills.clear();
  }

  /**
   * Parse HLTV JSON log file (local data format).
   * Used for offline analysis.
   */
  static parseLogFile(events: Array<Record<string, unknown>>): HLTVEvent[] {
    const parsed: HLTVEvent[] = [];
    let eventIndex = 0;

    for (const entry of events) {
      const timestamp = eventIndex++;

      if ('Kill' in entry) {
        const kill = entry.Kill as Record<string, unknown>;
        parsed.push({
          type: 'kill',
          timestamp,
          data: {
            killer: kill.killerName,
            victim: kill.victimName,
            weapon: kill.weapon,
            headshot: kill.headShot,
            killerSide: kill.killerSide,
            victimSide: kill.victimSide,
          },
        });
      } else if ('RoundStart' in entry) {
        parsed.push({ type: 'round_start', timestamp, data: {} });
      } else if ('RoundEnd' in entry) {
        const round = entry.RoundEnd as Record<string, unknown>;
        parsed.push({
          type: 'round_end',
          timestamp,
          data: {
            ctScore: round.counterTerroristScore,
            tScore: round.terroristScore,
            winner: round.winner,
            winType: round.winType,
          },
        });
      }
    }

    return parsed;
  }

  /**
   * Detect notable events from a series of kills/rounds.
   */
  static detectNotableEvents(events: HLTVEvent[]): Array<{ type: string; description: string; events: HLTVEvent[] }> {
    const notable: Array<{ type: string; description: string; events: HLTVEvent[] }> = [];
    let roundKills: Map<string, HLTVEvent[]> = new Map();

    for (const event of events) {
      if (event.type === 'round_start') {
        roundKills = new Map();
      } else if (event.type === 'kill') {
        const killer = event.data.killer as string;
        if (!roundKills.has(killer)) roundKills.set(killer, []);
        roundKills.get(killer)!.push(event);
      } else if (event.type === 'round_end') {
        // Check for aces (5 kills)
        for (const [player, kills] of roundKills) {
          if (kills.length >= 5) {
            notable.push({
              type: 'ace',
              description: `${player} ACE!`,
              events: kills,
            });
          } else if (kills.length === 4) {
            notable.push({
              type: '4k',
              description: `${player} 4K`,
              events: kills,
            });
          } else if (kills.length === 3) {
            notable.push({
              type: '3k',
              description: `${player} 3K`,
              events: kills,
            });
          }
        }
      }
    }

    return notable;
  }

  private handleMessage(rawData: string): void {
    try {
      const data = JSON.parse(rawData);
      let event: HLTVEvent | null = null;

      if (data.type === 'kill' || data.Kill) {
        const kill = data.Kill || data;
        event = {
          type: 'kill',
          timestamp: Date.now(),
          data: {
            killer: kill.killerName || kill.killer,
            victim: kill.victimName || kill.victim,
            weapon: kill.weapon,
            headshot: kill.headShot || kill.headshot,
            killerSide: kill.killerSide,
            victimSide: kill.victimSide,
          },
        };

        // Track round kills for multi-kill detection
        const killerName = (event.data.killer as string) || '';
        this.roundKills.set(killerName, (this.roundKills.get(killerName) || 0) + 1);
        this.kills.push(event.data as unknown as KillEvent);
      } else if (data.type === 'roundStart' || data.RoundStart) {
        event = { type: 'round_start', timestamp: Date.now(), data: {} };
        this.roundKills.clear();
        this.kills = [];
      } else if (data.type === 'roundEnd' || data.RoundEnd) {
        const round = data.RoundEnd || data;
        event = {
          type: 'round_end',
          timestamp: Date.now(),
          data: {
            ctScore: round.counterTerroristScore ?? round.ctScore,
            tScore: round.terroristScore ?? round.tScore,
            winner: round.winner,
            winType: round.winType,
          },
        };
      } else if (data.type === 'bombPlanted' || data.BombPlant) {
        event = { type: 'bomb_plant', timestamp: Date.now(), data };
      } else if (data.type === 'bombDefused' || data.BombDefuse) {
        event = { type: 'bomb_defuse', timestamp: Date.now(), data };
      }

      if (event) {
        for (const cb of this.callbacks) {
          cb(event);
        }
      }
    } catch {
      // Ignore malformed messages (Socket.IO pings, etc.)
    }
  }
}
