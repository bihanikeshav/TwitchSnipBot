/**
 * Chat spike detection in JavaScript.
 * Statistical Z-score approach — no LSTM needed for initial version.
 * Matches Python features/extractors.py logic.
 */
import type { ChatMessage } from './chat-reader';

export interface DetectedHighlight {
  timestamp: number;
  score: number;
  category: 'exciting' | 'funny' | 'surprising' | 'other';
  messageRate: number;
  windowMessages: ChatMessage[];
}

interface WindowStats {
  timestamp: number;
  messageRate: number;
  emoteDensity: number;
  capsRatio: number;
  keywordScore: number;
  exclamationRatio: number;
  uniqueUserRatio: number;
}

const HYPE_KEYWORDS = new Set([
  'ace', 'clutch', 'insane', 'omg', 'wtf', 'lets go', 'pog', 'pogchamp',
  'poggers', 'letsgo', 'holy', 'wow', 'goat', 'god', 'beast', 'crazy',
  'nuts', 'unreal', 'inhuman', 'collateral', 'noscope', 'flick',
  'dink', 'wallbang', 'sick', 'nasty', 'clean', 'ez', 'gg',
]);

const FUNNY_KEYWORDS = new Set([
  'lol', 'lmao', 'lmfao', 'rofl', 'haha', 'hahaha', 'kekw', 'lul',
  'omegalul', 'pepega', 'clown', 'bruh', 'dead', 'dying',
]);

const COMMON_EMOTES = new Set([
  'kappa', 'pogchamp', 'lul', 'omegalul', 'kekw', 'pepega', 'monkas',
  'pog', 'poggers', 'residentsleeper', 'kreygasm', 'trihard', 'cmonbruh',
  'pepehands', 'widepeeposad', 'widepeepo', 'peped', 'copium', 'sadge',
  'forsencd', 'catjam', 'pepelaugh', 'pepejam', 'monkaw', 'pagman',
  'batchest', 'aware', 'despair', 'modtime', 'based',
]);

export class HighlightDetector {
  private windowSize: number; // ms
  private messageBuffer: ChatMessage[] = [];
  private windowHistory: WindowStats[] = [];
  private sensitivity: number;
  private cooldownUntil = 0;
  private readonly COOLDOWN_MS = 15000;
  private readonly MAX_HISTORY = 200;

  constructor(sensitivity = 0.7, windowSizeSeconds = 5) {
    this.sensitivity = sensitivity;
    this.windowSize = windowSizeSeconds * 1000;
  }

  setSensitivity(s: number): void {
    this.sensitivity = s;
  }

  addMessage(msg: ChatMessage): { currentRate: number; highlight: DetectedHighlight | null } {
    this.messageBuffer.push(msg);

    const now = Date.now();
    const windowStart = now - this.windowSize;

    // Remove old messages outside window
    this.messageBuffer = this.messageBuffer.filter((m) => m.timestamp > windowStart);

    const windowMessages = this.messageBuffer;
    const stats = this.computeWindowStats(windowMessages, now);

    // Store window stats for Z-score calculation
    this.windowHistory.push(stats);
    if (this.windowHistory.length > this.MAX_HISTORY) {
      this.windowHistory = this.windowHistory.slice(-this.MAX_HISTORY);
    }

    let highlight: DetectedHighlight | null = null;

    if (now > this.cooldownUntil && this.windowHistory.length >= 10) {
      const zScore = this.computeZScore(stats);

      // Threshold adjusts with sensitivity: lower sensitivity = higher threshold needed
      const threshold = 3.5 - this.sensitivity * 2; // range: 1.5 (max sens) to 3.5 (min sens)

      if (zScore > threshold) {
        highlight = {
          timestamp: now,
          score: Math.min(zScore / 5, 1),
          category: this.classifyHighlight(windowMessages, stats),
          messageRate: stats.messageRate,
          windowMessages: [...windowMessages],
        };
        this.cooldownUntil = now + this.COOLDOWN_MS;
      }
    }

    return { currentRate: stats.messageRate, highlight };
  }

  private computeWindowStats(messages: ChatMessage[], now: number): WindowStats {
    const count = messages.length;
    const durationSec = this.windowSize / 1000;
    const messageRate = count / durationSec;

    if (count === 0) {
      return {
        timestamp: now,
        messageRate: 0,
        emoteDensity: 0,
        capsRatio: 0,
        keywordScore: 0,
        exclamationRatio: 0,
        uniqueUserRatio: 0,
      };
    }

    let emoteCount = 0;
    let capsCount = 0;
    let keywordCount = 0;
    let exclamationCount = 0;
    const users = new Set<string>();

    for (const msg of messages) {
      const lower = msg.text.toLowerCase();
      const words = lower.split(/\s+/);

      users.add(msg.username);

      // Emote detection
      if (msg.emotes.length > 0 || words.some((w) => COMMON_EMOTES.has(w))) {
        emoteCount++;
      }

      // Caps detection
      if (msg.text.length > 3 && msg.text === msg.text.toUpperCase() && /[A-Z]/.test(msg.text)) {
        capsCount++;
      }

      // Keyword detection
      for (const word of words) {
        if (HYPE_KEYWORDS.has(word)) keywordCount++;
      }

      // Exclamation
      if (msg.text.trim().endsWith('!')) exclamationCount++;
    }

    return {
      timestamp: now,
      messageRate,
      emoteDensity: emoteCount / count,
      capsRatio: capsCount / count,
      keywordScore: keywordCount / count,
      exclamationRatio: exclamationCount / count,
      uniqueUserRatio: users.size / count,
    };
  }

  private computeZScore(current: WindowStats): number {
    const rates = this.windowHistory.map((w) => w.messageRate);
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    const variance = rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length;
    const std = Math.sqrt(variance) || 1;

    const rateZ = (current.messageRate - mean) / std;

    // Boost score with secondary signals
    const emoteBoost = current.emoteDensity > 0.5 ? 0.5 : 0;
    const capsBoost = current.capsRatio > 0.3 ? 0.3 : 0;
    const keywordBoost = current.keywordScore > 0.1 ? 0.4 : 0;

    return rateZ + emoteBoost + capsBoost + keywordBoost;
  }

  private classifyHighlight(messages: ChatMessage[], stats: WindowStats): DetectedHighlight['category'] {
    let funnyScore = 0;
    let excitingScore = 0;
    let surprisingScore = 0;

    for (const msg of messages) {
      const lower = msg.text.toLowerCase();
      const words = lower.split(/\s+/);

      for (const word of words) {
        if (FUNNY_KEYWORDS.has(word)) funnyScore++;
        if (HYPE_KEYWORDS.has(word)) excitingScore++;
      }

      if (lower.includes('?') || lower.includes('what') || lower.includes('how')) {
        surprisingScore++;
      }
    }

    // Caps and exclamations suggest excitement
    excitingScore += stats.capsRatio * messages.length;
    excitingScore += stats.exclamationRatio * messages.length;

    const scores = { funny: funnyScore, exciting: excitingScore, surprising: surprisingScore };
    const maxCategory = Object.entries(scores).sort(([, a], [, b]) => b - a)[0];

    if (maxCategory[1] === 0) return 'other';
    return maxCategory[0] as 'funny' | 'exciting' | 'surprising';
  }
}
