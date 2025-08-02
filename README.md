# TwitchSnipBot

**Find the highlights in a Twitch stream by watching its chat.** When chat suddenly spikes, something worth clipping just happened. TwitchSnipBot scores each rolling window of chat activity, flags the hot moments, categorizes them, and cuts them.

**Live:** [twitch.meownikov.xyz](https://twitch.meownikov.xyz)

---

## Modes

Two ways to run it, sharing one detection core.

| | Runtime | Summary |
|---|---|---|
| **Web app** | Browser | Zero setup, zero auth. Paste a channel; clips collect themselves. |
| **CLI** *(alpha)* | Python | Live IRC or log replay, PyTorch scoring, ffmpeg clips, optional dashboard. |

### Web app

Reads chat anonymously over Twitch IRC and captures the stream from its HLS playlist — no screen share, no auth. A statistical chat-spike detector flags moments; the matching slice is remuxed to MP4 in-browser with ffmpeg.wasm. Session state is shareable and refresh-safe via the URL (`/?c=<channel>`). Runs on Cloudflare Pages, with Pages Functions proxying the Twitch and ffmpeg-core requests.

#### CS mode  *(under development)*

A companion view at `/cs` for CS2 / CS:GO. Paste an HLTV match URL plus the match's Twitch channel; it connects to HLTV's public scorebot **client-side** (socket.io, reusing the browser's `cf_clearance` cookie — visit the HLTV match page once first) for a live kill/round feed and scoreboard, alongside the same chat detection. Clips auto-fire on aces, 4Ks, 3Ks, clutches, defuses, and chat spikes, each tagged by type. Shareable via `/cs?m=<matchId>&c=<channel>`.

### CLI  *(alpha)*

The Python pipeline reads IRC live or replays a log, runs the same feature extraction, scores with the trained PyTorch model, and emits timestamps (`--clip` pulls the VOD via yt-dlp and cuts with ffmpeg). `snipbot server` adds a FastAPI websocket + REST layer that the React dashboard under `dashboard/` consumes.

---

## Quick start

**Python**

```
pip install -r requirements.txt
cp config.example.yaml config.yaml
cp .env.example .env                                # twitch + youtube creds (upload)

python main.py label data/chat.log --threshold 1.0  # auto-label a log
python main.py train --epochs 50                     # train
python main.py batch data/chat.log                   # batch inference
python main.py live --channel <name>                 # live capture
python main.py export                                # onnx for the webapp
```

**Dashboard**

```
cd dashboard && npm install && npm run dev   # frontend
python main.py server                         # backend
```

---

## How it works

Every sliding window over chat (default 10s, 2s stride) becomes a 12-dimension feature vector:

| Group | Features |
|---|---|
| Volume | `msg_rate`, `unique_users`, `user_ratio` |
| Content | `emote_density`, `caps_ratio`, `avg_msg_len`, `msg_len_variance` |
| Signal | `keyword_score`, `repetition_score`, `question_ratio`, `exclamation_ratio`, `entropy` |

Two detectors consume these:

- **Statistical** — z-score of `msg_rate` against a rolling baseline. Zero-shot; powers the web app and bootstraps labels.
- **LSTM** — two heads: a binary highlight score and a 4-way category (funny / exciting / surprising / other). Trained with `BCEWithLogitsLoss` + cross-entropy; sigmoid/softmax are applied at inference, so the same weights serve PyTorch and ONNX without double activation.

---

## Custom plugins

Game-specific context. Subclass `snipbot.plugins.base.SnipbotPlugin`, drop it under `~/.snipbot/plugins/` (or expose it via entry points), and the registry loads it at startup. A plugin can add event streams, boost the keyword score, and register scheduler jobs. The CS:GO plugin under `snipbot/plugins/csgo/` is the reference implementation.

---

## Project layout

```
snipbot/            Python core
  ingestion/        irc client + log parsers (twitch, blast, hltv)
  features/         12-dim extractor, sliding-window manager
  model/            lstm, dataset, train, predict, onnx export
  labeling/         statistical labeler, sqlite store, annotation ui
  pipeline/         batch + realtime detection
  clipping/         vod download, cutter, reel compiler
  upload/           youtube upload + metadata
  server/           fastapi app, websocket, routes
  plugins/          plugin base + csgo reference
webapp/             vite + react app (HLS capture, ffmpeg.wasm clips)
  functions/        cloudflare pages functions (twitch + ffmpeg proxies)
  src/CsApp.tsx     /cs — live HLTV scorebot + tagged clips
dashboard/          react dashboard for the python backend
shared/             components shared by webapp + dashboard
tests/              pytest suite
```

---

## Reference

**Configuration.** `config.yaml` holds model paths, IRC settings, window sizes, thresholds, and output dirs; `.env` holds Twitch/YouTube credentials. Defaults live in `config.example.yaml`.

**Data formats.**

| Source | Format |
|---|---|
| Twitch IRC | `YYYY-MM-DD_HH:MM:SS — :user!... PRIVMSG #channel :text` |
| BLAST | `[H:MM:SS] username: message` |
| HLTV JSON | array of `{"Kill": {...}}`, `{"RoundStart": {}}`, `{"RoundEnd": {...}}` |

**Tests.** `pytest tests/`

---

## Notes

Started as a way to skip the boring parts of long CS:GO tournament VODs. The chat-frequency premise generalizes to most genres where chat reacts in real time — and works less well where chat is slow conversation (cooking, ASMR, quiet IRL).
