# Words and Stuff

Little web games to play with friends. The first one is **Word Rush**: 16
letters, 90 seconds. Swipe through touching letters (diagonals count) to spell
as many words as you can.

- **Challenge a friend.** No accounts: pick a nickname and send an invite link.
  A match is 3 rounds on the same boards for both of you, and you each play
  whenever you like. You can see their score before you play ("beat 132!"),
  then compare words afterwards. There are turn notifications and rematches.
- **Play the bot** (Easy / Medium / Hard). It plays each round alongside you,
  with a live score ticker. It runs on your device and works offline.
- **Daily board.** One board a day, the same for everyone, with a shared
  leaderboard of today's scores (re-scored by the server), a streak and a
  shareable score.
- Bonus tiles (double/triple letter, double word, and a triple-word tile in the
  final round), long-word bonuses, the path lighting up green on real words,
  sounds synthesised in the browser, haptics, and keyboard entry on computers.
- Installable as an app (PWA), with dark mode.

## Built to use very little data

| What | Size (brotli) | When |
| --- | --- | --- |
| App (HTML + JS + CSS) | ~21 KB | first visit, then cached by the service worker |
| Word list (168,599 words) | ~182 KB | only for bot matches / the daily board, then cached forever |
| A friend round (board + answer hashes) | ~1–2 KB | when you start the round |
| Opening a match you've seen | ~200 B | `304 Not Modified` via ETags |

There are no web fonts, images, frameworks, analytics or third-party requests.
The WebSocket is only open while the app is on screen. Friend matches send
the valid words as salted hashes, so the browser can check words instantly
without downloading the dictionary (or seeing the answers).

## How it works

```
client/           vanilla JS app (no framework), bundled by esbuild
  js/rush/        round screen, match & recap screens, lobby, daily board
  sw.js           service worker: app shell + offline play + push
shared/
  rush/board.js   dice, boards, solver, scoring, word hashes, bot
  dict/           packed dictionary (DAWG) reader + transport format
server/           Node http server: JSON API, WebSocket, static files
  rush.js         friend matches, per-player views, access control
  daily.js        daily board leaderboard
  store.js        Redis (Render Key Value) or in-memory storage
  push.js         Web Push "your turn" notifications (VAPID)
tools/build.js    bundles, fingerprints and precompresses into dist/
data/             ENABLE word list (public domain) + a few modern words
```

The server generates the boards, scores submitted words itself, and only
reveals a friend's words for a round once you've played it.

## Develop

Requires Node 22+.

```sh
npm install
npm run dev           # build, then serve on http://localhost:3000 (in-memory store)
DATA_FILE=.data/dev.json npm start   # keep games across restarts
npm test              # dictionary, board solver (vs brute force), scoring, server + WebSocket
ROUND_SECONDS=15 npm start           # shorter friend rounds for testing
```

Set `TEST_REDIS_URL=redis://…` to run the server tests against a real Redis.

## Deploy (Render)

It runs as one **free web service** with a **Render Key Value** store
(`render.yaml` describes the setup):

- Build: `npm ci && npm run build` · Start: `node server/index.js` · Health check: `/healthz`
- `REDIS_URL`: the Key Value **internal** connection string
- `KEY_PREFIX` (default `wns:`): namespace, so the store can be shared with other apps
- Optional: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` for fixed push keys (otherwise
  generated once and kept in the store), `PUBLIC_URL` (defaults to Render's URL)

Free-tier notes:

- The web service sleeps after ~15 minutes idle. The app still opens instantly
  from the service worker, and bot games work, but the first online request
  after a nap takes 30–60 s (the app shows a "waking up" banner).
- Free Key Value doesn't save to disk. If Render restarts it, players and
  online games are lost. Moving to a paid Key Value plan with persistence fixes
  this without code changes.

## Adding more games

The home screen (`client/js/hub.js`) is a catalog. A new game gets its own
folder under `client/js/<game>/` and `shared/<game>/`, routes in
`client/js/main.js`, and (if online) an API module next to `server/rush.js`.

## Credits

Word list: ENABLE2K (public domain), plus a short supplement in
`data/supplement.txt`.
