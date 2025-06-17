/**
 * Emote lookup utilities.
 */

const COMMON_EMOTES = new Set([
  // Twitch global
  'Kappa', 'PogChamp', 'LUL', 'OMEGALUL', 'KEKW', 'Pepega', 'monkaS',
  'Pog', 'PogU', 'POGGERS', 'ResidentSleeper', 'Kreygasm', 'TriHard',
  'cmonBruh', 'PepeHands', 'widepeepoSad', 'widepeepoHappy', 'PepeD',
  'Copium', 'Sadge', 'forsenCD', 'catJAM', 'PepeLaugh', 'pepeJAM',
  'monkaW', 'PagMan', 'BatChest', 'Aware', 'Despair', 'modTime',
  'BASED', 'GIGACHAD', 'Clap', 'EZ', 'D:', 'MonkaHmm',
  'FeelsBadMan', 'FeelsGoodMan', 'FeelsStrongMan', 'Jebaited',
  'NotLikeThis', 'HeyGuys', 'VoHiYo', 'DansGame', 'WutFace',
  'BibleThump', 'haHAA', 'CoolStoryBob', 'MingLee',
]);

const EMOTE_LOWER = new Set(Array.from(COMMON_EMOTES).map((e) => e.toLowerCase()));

export function isEmote(word: string): boolean {
  return COMMON_EMOTES.has(word) || EMOTE_LOWER.has(word.toLowerCase());
}

export function extractEmotes(text: string): string[] {
  return text.split(/\s+/).filter((word) => isEmote(word));
}

export function countEmotes(text: string): number {
  return extractEmotes(text).length;
}
