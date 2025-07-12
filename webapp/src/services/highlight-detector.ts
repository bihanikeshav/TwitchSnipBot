/**
 * Chat spike detection in JavaScript.
 * Statistical Z-score approach — no LSTM needed for initial version.
 * Matches Python features/extractors.py logic.
 */
import type { ChatMessage } from './chat-reader';

export interface DetectedHighlight {
  timestamp: number;
  /**
   * Spike strength — z-score / 5 clamped to [0, 1]. Useful for filtering
   * but a poor stand-alone display value because it's relative to recent
   * baseline only.
   */
  score: number;
  /** Mean rate over the recent rolling history, used as the spike's baseline. */
  baselineRate: number;
  /** baselineRate × this = current peak. I.e. "9× normal." */
  spikeRatio: number;
  category: 'exciting' | 'funny' | 'surprising' | 'other';
  /** msg/s at detection time (also the peak of the spike). */
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
  private lastHistoryTs = 0;
  private readonly COOLDOWN_MS = 15000;
  /**
   * History is sampled at a fixed cadence and capped to a few minutes so
   * the baseline reflects a real time window, not an arbitrary slice that
   * shrinks during busy chat.
   */
  private readonly SAMPLE_INTERVAL_MS = 500;
  private readonly MAX_HISTORY = 480; // ~4 minutes at 500ms

  constructor(sensitivity = 0.5, windowSizeSeconds = 5) {
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

    // Time-cadence sampling: one history entry per ~500ms regardless of
    // message arrival rate. This makes baseline computation independent of
    // how busy chat is.
    if (now - this.lastHistoryTs >= this.SAMPLE_INTERVAL_MS) {
      this.lastHistoryTs = now;
      this.windowHistory.push(stats);
      if (this.windowHistory.length > this.MAX_HISTORY) {
        this.windowHistory = this.windowHistory.slice(-this.MAX_HISTORY);
      }
    }

    let highlight: DetectedHighlight | null = null;

    // ~60 samples = 30 s of history before we'll attempt detection. Otherwise
    // the percentile baseline isn't meaningful yet.
    if (now > this.cooldownUntil && this.windowHistory.length >= 60) {
      const baseline = this.computeBaseline();

      // Sensitivity 0.0–1.0 maps to:
      //  - requiredRatio    : 2.5 (low sens) → 1.5 (max sens)
      //  - requiredAbsolute : 1.5 → 0.7 msg/s above baseline
      //  - floor            : 1.5 → 0.7 msg/s minimum absolute rate
      const requiredRatio = 2.5 - this.sensitivity * 1.0;
      const requiredAbsolute = 1.5 - this.sensitivity * 0.8;
      const floor = 1.5 - this.sensitivity * 0.8;

      const meetsRatio = stats.messageRate >= baseline * requiredRatio;
      const meetsAbsolute = stats.messageRate >= baseline + requiredAbsolute;
      const meetsFloor = stats.messageRate >= floor;

      if (meetsRatio && meetsAbsolute && meetsFloor) {
        const spikeRatio = baseline > 0.1 ? stats.messageRate / baseline : stats.messageRate / 0.1;
        // Score maps the relative spike magnitude into [0, 1] for display
        // and downstream gating. Tuned so a 2× spike ≈ 0.35, a 4× ≈ 0.7,
        // anything bigger saturates at 1.
        const score = Math.min(1, Math.log(spikeRatio) / Math.log(8));
        highlight = {
          timestamp: now,
          score,
          baselineRate: baseline,
          spikeRatio,
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

  /**
   * Baseline = 30th percentile of recent rate samples. Robust to spikes —
   * the spike's own samples sit in the top of the distribution and don't
   * pull the percentile up the way they pull the mean up.
   */
  private computeBaseline(): number {
    if (this.windowHistory.length === 0) return 0;
    const rates = this.windowHistory.map((w) => w.messageRate).sort((a, b) => a - b);
    const idx = Math.floor(rates.length * 0.3);
    return rates[idx] || 0;
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
