/**
 * Shared Twitch reverse-proxy logic for the snipprbot Cloudflare Pages
 * Functions. Files prefixed with `_` are treated as helpers by Pages and
 * are never routed directly.
 *
 * Because Pages Functions run at the SAME origin as the static site, the
 * browser sees `yoursite.pages.dev/tw-gql/...` as same-origin — no CORS
 * dance needed. We still forward the right Origin/Referer to Twitch so it
 * serves the ad-light embed playlist, same as the dev-mode Vite proxy.
 */
const STD_HEADERS: Record<string, string> = {
  Origin: 'https://www.twitch.tv',
  Referer: 'https://www.twitch.tv/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// Twitch serves its media playlists and segments from rotating hosts under
// these domains. They 403 any non-twitch Origin, so the browser can't fetch
// them directly from a public site — they go through proxyAbsolute below.
const ALLOWED_MEDIA_HOST = /(^|\.)ttvnw\.net$|(^|\.)cloudfront\.net$|(^|\.)akamaized\.net$/;

/**
 * Forward an arbitrary Twitch media URL passed as `?u=<encoded>`. Restricted
 * to Twitch CDN hosts so this isn't an open relay.
 */
export async function proxyAbsolute(request: Request): Promise<Response> {
  const reqUrl = new URL(request.url);
  const target = reqUrl.searchParams.get('u');
  if (!target) return new Response('missing u param', { status: 400 });

  let t: URL;
  try {
    t = new URL(target);
  } catch {
    return new Response('bad url', { status: 400 });
  }
  if (t.protocol !== 'https:' || !ALLOWED_MEDIA_HOST.test(t.hostname)) {
    return new Response('host not allowed', { status: 403 });
  }

  const headers = new Headers(STD_HEADERS);
  let upstream: Response;
  try {
    upstream = await fetch(t.toString(), { method: 'GET', headers, redirect: 'follow' });
  } catch (err) {
    return new Response(`media fetch failed: ${(err as Error).message}`, { status: 502 });
  }

  const out = new Headers();
  const ct = upstream.headers.get('Content-Type');
  if (ct) out.set('Content-Type', ct);
  out.set('Access-Control-Allow-Origin', '*');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export async function proxyTwitch(
  request: Request,
  upstreamBase: string,
  pathParam: string | string[] | undefined,
): Promise<Response> {
  const url = new URL(request.url);
  const segs = Array.isArray(pathParam) ? pathParam.join('/') : (pathParam ?? '');
  const suffix = segs ? `/${segs}` : '/';
  const target = upstreamBase + suffix + url.search;

  const headers = new Headers(STD_HEADERS);
  const clientId = request.headers.get('Client-ID');
  if (clientId) headers.set('Client-ID', clientId);
  const contentType = request.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);

  const init: RequestInit = {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'follow',
  };

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    return new Response(`upstream fetch failed: ${(err as Error).message}`, { status: 502 });
  }

  const out = new Headers();
  const ct = upstream.headers.get('Content-Type');
  if (ct) out.set('Content-Type', ct);
  // Harmless under same-origin; helps if ever served cross-origin.
  out.set('Access-Control-Allow-Origin', '*');

  return new Response(upstream.body, { status: upstream.status, headers: out });
}
