# TwitchSnipBot

Detects highlight-worthy moments in Twitch streams by watching chat activity. When chat gets loud, something interesting just happened. The bot reads a channel's IRC chat, extracts a feature vector every few seconds (message rate, unique users, emote density, caps ratio, keyword hits, entropy, and a handful more), and feeds the rolling window into a two-headed LSTM that scores each window for highlight likelihood and classifies it as funny, exciting, surprising, or other.

Three ways to run it.

## Modes

**Web app (zero setup).** A standalone browser app under `webapp/`. Reads chat anonymously over Twitch IRC (anonymous justinfan login), captures the stream itself via its HLS playlist — no screen share, no auth — and keeps a rolling buffer in memory. A statistical chat-spike detector flags hot moments; the matching slice is cut and remuxed to MP4 entirely in-browser with ffmpeg.wasm. Open the page, paste a channel, and clips collect themselves. Session state is shareable via the URL (`/?c=<channel>`) and restored on refresh. Deployed on Cloudflare Pages, with Pages Functions proxying the Twitch GraphQL/usher/segment requests and the ffmpeg core (see `webapp/functions/`).

**CLI.** Python pipeline. Reads from IRC live or replays a log file, runs the same feature extraction, scores with the trained PyTorch model, and emits timestamps. With `--clip` it pulls the VOD via yt-dlp and cuts highlights with ffmpeg.

**CLI + Dashboard.** The CLI plus a FastAPI server (`snipbot server`) that exposes a websocket for live feature/score data and REST endpoints for clips, matches, and recordings. The React dashboard under `dashboard/` consumes both.

**CS match mode (`/cs`) — under development.** A companion view in the web app for CS2/CS:GO matches. Paste an HLTV match URL plus the match's Twitch channel and it connects to HLTV's public scorebot **client-side** (socket.io, using the browser's existing `cf_clearance` cookie — visit the HLTV match page once first) for a live kill/round feed and scoreboard, alongside the same chat-spike detection. Clips auto-fire on notable plays (ace / 4K / 3K / clutch / defuse) and chat spikes, each tagged by type. Shareable via `/cs?m=<matchId>&c=<channel>`. Note: HLTV's site itself is Cloudflare-walled, so the stream URL can't be auto-discovered (you paste the channel), and the scorebot needs that `cf_clearance` cookie to be present.

## Quick start

```
pip install -r requirements.txt
cp config.example.yaml config.yaml
cp .env.example .env   # fill in twitch + youtube creds if uploading

# auto-label a chat log with the statistical labeler
python main.py label data/chat.log --threshold 1.0

# train
python main.py train --epochs 50

# batch inference over a log
python main.py batch data/chat.log

# live capture
python main.py live --channel <name>

# export onnx for the webapp
python main.py export
```

Webapp:

```
cd webapp
npm install
npm run dev      # local dev (vite proxies the twitch + ffmpeg requests)
npm run build    # production bundle in dist/
npx wrangler pages deploy   # deploy to cloudflare pages
```

Dashboard:

```
cd dashboard && npm install && npm run dev   # frontend
python main.py server                         # backend
```

## How it works

Each sliding window over chat (default 10s with 2s stride) produces a 12-dim feature vector:

```
msg_rate, unique_users, user_ratio, emote_density,
caps_ratio, avg_msg_len, msg_len_variance,
keyword_score, repetition_score, question_ratio,
exclamation_ratio, entropy
```

The LSTM consumes sequences of these vectors and outputs two heads: a binary highlight score (logit) and 4-way category logits. Training uses `BCEWithLogitsLoss` on the binary head and cross-entropy on the category head. Sigmoid/softmax are applied at inference, not inside the model, so the same weights serve PyTorch and ONNX without double activation.

The statistical labeler (`snipbot/labeling/statistical.py`) is a zero-shot fallback that scores each window by the z-score of `msg_rate` against a rolling baseline. Useful for bootstrapping labels before any supervised data exists, and as a sanity check against the trained model.

## Project layout

```
snipbot/
  ingestion/      irc client + log parsers (twitch irc, blast, hltv json)
  features/       12-dim extractor, sliding window manager
  model/          lstm, dataset, train, predict, onnx export
  labeling/       statistical labeler, sqlite label store, annotation ui
  pipeline/       batch + realtime moment detection
  clipping/       vod download, cutter, timestamp mapping, reel compiler
  upload/         youtube upload + metadata generator
  server/         fastapi app, websocket, route handlers
  scheduler/      cron-style jobs
  storage/        sqlite layer
  plugins/        plugin base, registry, csgo reference
  utils/          emote handling, rate limiting

webapp/           standalone vite + react app (HLS capture, ffmpeg.wasm clips)
  functions/      cloudflare pages functions: twitch + ffmpeg-core proxies
  src/CsApp.tsx   /cs companion — live HLTV scorebot + tagged clips
dashboard/        react + react-router + react-query frontend
shared/           react components shared between webapp and dashboard
tests/            pytest suite for features, ingestion, labeling, model
```

## Plugins

Game-specific context plugins. A plugin can supply extra event streams (e.g. a CS:GO kill feed from an HLTV log), add to the keyword score, and register scheduler jobs (auto-clip on round end, etc.).

Subclass `snipbot.plugins.base.SnipbotPlugin`, drop the file under `~/.snipbot/plugins/` or expose it via entry points, and the registry picks it up at startup. The bundled CS:GO plugin under `snipbot/plugins/csgo/` is the reference implementation.

## Configuration

`config.yaml` controls model paths, IRC settings, feature window sizes, label thresholds, output dirs, and upload toggles. `.env` holds credentials (Twitch OAuth, YouTube API). Defaults are in `config.example.yaml`.

## Tests

```
pytest tests/
```

## Data formats

The log parsers accept three input formats:

- **Twitch IRC dumps:** `YYYY-MM-DD_HH:MM:SS — :user!... PRIVMSG #channel :text`
- **BLAST broadcast logs:** `[H:MM:SS] username: message`
- **HLTV JSON event logs:** array of `{"Kill": {...}}`, `{"RoundStart": {}}`, `{"RoundEnd": {...}}`

## Notes

This started as a side project to skip the boring parts of long CS:GO tournament VODs. The chat-frequency premise generalizes well to most stream genres where chat reacts in real time. It works less well on stream types where chat is a slow conversation rather than a reaction stream (cooking, ASMR, quiet IRL).
