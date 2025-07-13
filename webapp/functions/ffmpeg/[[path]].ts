/**
 * Same-origin proxy for the ffmpeg.wasm core (ffmpeg-core.js / .wasm).
 *
 * Two reasons this exists instead of bundling the core into the static
 * site or loading it from a CDN in the browser:
 *  1. Cloudflare Pages rejects any single asset over 25 MiB. The wasm core
 *     is ~32 MB, so it can't live in dist/.
 *  2. Browser-side CDN fetches (unpkg / jsDelivr) get blocked by ad / privacy
 *     blockers like Brave Shields. Fetching server-side and serving it
 *     same-origin sidesteps that entirely.
 *
 * The edge caches the upstream response for a year, so this is a cheap
 * one-time fetch per cache-cold POP.
 */
// ESM build (dist/esm) — the Vite-bundled @ffmpeg worker is a module worker
// and loads the core via `(await import(coreURL)).default`, which only the
// ESM build provides.
const CORE_VERSION = '0.12.10';
const UPSTREAM = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

export const onRequest: PagesFunction = async ({ params }) => {
  const segs = Array.isArray(params.path) ? params.path.join('/') : (params.path ?? '');
  const upstream = await fetch(`${UPSTREAM}/${segs}`, {
    cf: { cacheEverything: true, cacheTtl: 31536000 },
  });
  if (!upstream.ok) {
    return new Response(`ffmpeg core fetch failed (${upstream.status})`, { status: 502 });
  }
  const headers = new Headers();
  if (segs.endsWith('.wasm')) headers.set('Content-Type', 'application/wasm');
  else if (segs.endsWith('.js')) headers.set('Content-Type', 'text/javascript');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(upstream.body, { status: 200, headers });
};
