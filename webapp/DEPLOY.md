# Deploy snipprbot — Cloudflare Pages

Live: **https://snipprbot.pages.dev**

Everything (static site + Twitch proxy + ffmpeg core proxy) runs on a single
Cloudflare Pages project. No Firebase, no separate Worker.

## One-time setup

```bash
npm install            # includes wrangler as a devDependency
```

Auth via an API token with **Cloudflare Pages: Edit** permission:

```bash
export CLOUDFLARE_API_TOKEN=<your-token>     # PowerShell: $env:CLOUDFLARE_API_TOKEN="..."
```

Project already created (`snipprbot`, production branch `main`). To recreate:

```bash
npx wrangler pages project create snipprbot --production-branch=main
```

## Deploy

```bash
npm run build                                # tsc + vite → dist/
CLOUDFLARE_API_TOKEN=<token> npx wrangler pages deploy
```

`wrangler.toml` sets `pages_build_output_dir = "dist"`, so `pages deploy`
needs no args. It uploads `dist/` and compiles everything under `functions/`
into the Pages Functions bundle.

## Architecture

```
functions/
  tw-gql/[[path]].ts     → proxies gql.twitch.tv     (playback access tokens)
  tw-usher/[[path]].ts   → proxies usher.ttvnw.net   (HLS master playlists)
  ffmpeg/[[path]].ts     → proxies @ffmpeg/core off jsDelivr
  _twitch-proxy.ts       → shared forwarder (underscore = not routed)
```

Why each proxy exists:

- **tw-gql / tw-usher** — Twitch doesn't send permissive CORS to non-twitch
  origins, so the browser can't hit them directly. The Functions forward the
  request with the right Origin/Referer (also gets the ad-light `embed`
  playlist). HLS media segments (`*.hls.ttvnw.net`) allow CORS already and
  are fetched directly by the browser, bypassing the proxy.
- **ffmpeg** — the wasm core is ~32 MB, over Pages' 25 MiB per-file limit, so
  it can't be bundled into `dist/`. It's also commonly blocked by adblockers
  when loaded from a CDN in the browser. Proxying it server-side and serving
  same-origin solves both. The edge caches it for a year.

Dev mirrors this exactly: `vite.config.ts` proxies the same `/tw-gql`,
`/tw-usher`, and `/ffmpeg` paths, so dev and prod load identically.

## Verify a deploy

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://snipprbot.pages.dev/
curl -s -I https://snipprbot.pages.dev/ffmpeg/ffmpeg-core.wasm | grep -i content-type
```

Then open the site, connect to a live channel, and watch DevTools → Network:
`/tw-gql/gql` and `/tw-usher/...` should both be 200 (not CORS-errored), and
`[ffmpeg] loaded from /ffmpeg` should appear in the console.
