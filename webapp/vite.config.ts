import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-only mirror of the prod Pages Function functions/tw-media.ts. Twitch's
// media playlists + segments live on rotating *.ttvnw.net hosts that 403 any
// non-twitch Origin, so they're fetched through /tw-media?u=<url> with the
// right headers. Implementing it as dev middleware keeps dev and prod loading
// from the identical same-origin path.
function twitchMediaProxy(): Plugin {
  const ALLOWED = /(^|\.)ttvnw\.net$|(^|\.)cloudfront\.net$|(^|\.)akamaized\.net$/;
  return {
    name: 'twitch-media-proxy-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/tw-media')) return next();
        const target = new URL(req.url, 'http://localhost').searchParams.get('u');
        if (!target) { res.statusCode = 400; res.end('missing u'); return; }
        let t: URL;
        try { t = new URL(target); } catch { res.statusCode = 400; res.end('bad url'); return; }
        if (t.protocol !== 'https:' || !ALLOWED.test(t.hostname)) {
          res.statusCode = 403; res.end('host not allowed'); return;
        }
        try {
          const upstream = await fetch(t.toString(), {
            headers: { Origin: 'https://www.twitch.tv', Referer: 'https://www.twitch.tv/' },
          });
          res.statusCode = upstream.status;
          const ct = upstream.headers.get('content-type');
          if (ct) res.setHeader('content-type', ct);
          res.setHeader('access-control-allow-origin', '*');
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.end(buf);
        } catch (err) {
          res.statusCode = 502; res.end(`media fetch failed: ${(err as Error).message}`);
        }
      });
    },
  };
}

// Vite dev-server proxy. Twitch's GQL + HLS endpoints don't send permissive
// CORS headers to non-twitch.tv origins, so the browser blocks a direct
// fetch with "Failed to fetch". Routing through the dev server bypasses
// it — same-origin requests don't trigger CORS.
export default defineConfig({
  plugins: [react(), twitchMediaProxy()],
  server: {
    port: 3000,
    proxy: {
      '/tw-gql': {
        target: 'https://gql.twitch.tv',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/tw-gql/, ''),
        secure: true,
        headers: { Origin: 'https://www.twitch.tv', Referer: 'https://www.twitch.tv/' },
      },
      '/tw-usher': {
        target: 'https://usher.ttvnw.net',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/tw-usher/, ''),
        secure: true,
        headers: { Origin: 'https://www.twitch.tv', Referer: 'https://www.twitch.tv/' },
      },
      '/tw-cdn': {
        target: 'https://video-edge-aws.hls.ttvnw.net',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/tw-cdn/, ''),
        secure: true,
        headers: { Origin: 'https://www.twitch.tv', Referer: 'https://www.twitch.tv/' },
      },
      // ffmpeg core, ESM build (mirrors the prod Pages Function functions/ffmpeg).
      // Keeps dev and prod loading the wasm from the same same-origin path.
      '/ffmpeg': {
        target: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ffmpeg/, ''),
        secure: true,
      },
    },
  },
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web', '@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
});
