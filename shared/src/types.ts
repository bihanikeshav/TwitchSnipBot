/**
 * Shared TypeScript types used by both webapp and dashboard.
 */

export interface ChatMessage {
  username: string;
  text: string;
  timestamp: number;
  channel: string;
  emotes: string[];
  isAction: boolean;
}

export interface DetectedHighlight {
  id?: string;
  timestamp: number;
  score: number;
  category: 'exciting' | 'funny' | 'surprising' | 'other';
  messageRate: number;
  duration: number;
  clipPath?: string;
  gameEvents?: GameEvent[];
  metadata?: Record<string, unknown>;
}

export interface GameEvent {
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface Recording {
  id: string;
  channel: string;
  startTime: number;
  endTime?: number;
  status: 'scheduled' | 'recording' | 'completed' | 'failed';
  title?: string;
  highlightCount?: number;
}

export interface Clip {
  id: string;
  highlightId: string;
  path: string;
  duration: number;
  category: string;
  thumbnail?: string;
  uploaded?: boolean;
}

export interface PluginInfo {
  name: string;
  version: string;
  enabled: boolean;
  description?: string;
  config?: Record<string, unknown>;
}

export interface MatchInfo {
  id: string;
  team1: string;
  team2: string;
  event: string;
  startTime: number;
  format: string;
  isLive: boolean;
  twitchChannel?: string;
}
