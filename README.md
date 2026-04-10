# FightersEdge Twitch Stream Worker

24/7 Twitch stream worker that pulls videos from the FightersEdge API and streams them as an infinite playlist to Twitch, with a live overlay showing the current match info.

## How it works

1. Fetches a shuffled batch of videos from `fightme-server` (your MongoDB-backed API)
2. For each video, uses `yt-dlp` to get the real YouTube stream URL
3. `ffmpeg` composites the video + the overlay and pushes to Twitch via RTMP
4. When a video ends, it moves to the next one automatically
5. When the batch is exhausted, it fetches a fresh shuffled batch

## Prerequisites

You must install these tools globally — they are **not** npm packages:

### ffmpeg
- Windows: https://ffmpeg.org/download.html — download a build, extract it, add `bin/` to your PATH
- Or via Chocolatey: `choco install ffmpeg`

### yt-dlp
- Windows: https://github.com/yt-dlp/yt-dlp/releases — download `yt-dlp.exe`, put it in your PATH
- Or via pip: `pip install yt-dlp`

Verify both are installed:
```bash
ffmpeg -version
yt-dlp --version
```

## Setup

```bash
npm install
```

Copy `.env` and fill in your values:
```
TWITCH_STREAM_KEY=your_stream_key_here
TWITCH_RTMP_URL=rtmp://live.twitch.tv/app
API_BASE_URL=https://fightme-server.herokuapp.com
OVERLAY_PORT=3001
QUEUE_SIZE=10
```

Get your stream key at: https://dashboard.twitch.tv/settings/stream

## Running

Development (auto-restarts on file changes):
```bash
npm run dev
```

Production (build first, then run):
```bash
npm run build
npm start
```

## Overlay

The overlay is a simple HTML page served at `http://localhost:3001`. It shows:
- FightersEdge watermark (top right)
- Now playing bar (bottom): channel name, video title, player matchup, game tag

The overlay page polls `/api/now-playing` every 3 seconds to update the display as videos change.

To preview the overlay in a browser: `npm run overlay` then open http://localhost:3001

## File structure

```
src/
  index.ts          — main loop: fetches queue, iterates playlist
  api.ts            — fetches videos from fightme-server API
  streamer.ts       — spawns yt-dlp + ffmpeg pipeline
  overlay-server.ts — Express server for overlay page + now-playing API
  overlay/
    index.html      — stream overlay UI (composited by ffmpeg)
```
# twitch-stream-worker
