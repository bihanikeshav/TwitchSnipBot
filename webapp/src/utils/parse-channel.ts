const CHANNEL_RE = /^[a-zA-Z0-9_]{3,25}$/;

export function parseChannel(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  if (s.includes('twitch.tv') || s.startsWith('http')) {
    try {
      const url = new URL(s.startsWith('http') ? s : `https://${s}`);
      if (url.hostname.replace(/^www\./, '') === 'twitch.tv') {
        const seg = url.pathname.split('/').filter(Boolean)[0];
        if (seg && CHANNEL_RE.test(seg)) return seg.toLowerCase();
      }
    } catch {
      return null;
    }
    return null;
  }

  if (CHANNEL_RE.test(s)) return s.toLowerCase();
  return null;
}

export function twitchUrl(channel: string): string {
  return `https://www.twitch.tv/${channel}`;
}
