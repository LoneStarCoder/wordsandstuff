# Words and Stuff

Little web games to play with friends. The first one is **Words**, a
crossword-style tile game in the spirit of Scrabble and Words With Friends:

- **Play a friend online.** No accounts: pick a nickname, create a game, and
  send the invite link. Moves, joins and chat show up live, and you can turn on
  notifications for when it's your turn.
- **Play the bot** (Easy / Medium / Hard). It runs entirely on your device and
  works offline.
- Two boards: **Modern** (casual layout, 104 tiles, 35-point bingo) and
  **Classic** (traditional layout, 100 tiles, 50-point bingo).
- Drag tiles, tap-to-place, or on a computer click a square and type. There's a
  live score preview, shuffle, swap, pass, resign, rematch, move history, a
  tiles-left view, and a "use on another device" link.
- Installable as an app (PWA), with dark mode.

## Built to use very little data

| What | Size (brotli) | When |
| --- | --- | --- |
| App (HTML + JS + CSS) | ~21 KB | first visit, then cached by the service worker |
| Word list (168,599 words) | ~182 KB | only when you first play the bot, then cached forever |
| Opening a game you've seen | ~200 B | `304 Not Modified` via ETags |
| A move (sent / received) | ~0.3 KB | small JSON deltas over one WebSocket |

There are no web fonts, images, frameworks, analytics or third-party requests.
The WebSocket is only open while the app is on screen. Online games are
validated by the server, so the dictionary never has to be downloaded to play
a friend.

## How it works

```
client/           vanilla JS app (no framework), bundled by esbuild
  js/words/       game screen, lobby, bot worker, online/bot "sources"
  sw.js           service worker: app shell + offline bot games + push
shared/words/     code used by both browser and server
  rules.js        boards, tiles, move validation and scoring
  game.js         turn-by-turn game state (JSON)
  dawg.js         dictionary lookups over a packed word graph (DAWG)
  pack.js         compact transport format for the DAWG
  bot.js          move generator (Appel–Jacobson) + bot strategy
server/           Node http server: JSON API, WebSocket, static files
  words.js        online games, per-player views, access control
  store.js        Redis (Render Key Value) or in-memory storage
  push.js         Web Push "your turn" notifications (VAPID)
tools/build.js    bundles, fingerprints and precompresses into dist/
data/             ENABLE word list (public domain) + a few modern words
```

The server is authoritative: it holds the bag and both racks, checks every
move against the dictionary, and sends each player only their own tiles.

## Develop

Requires Node 22+.

```sh
npm install
npm run dev           # build, then serve on http://localhost:3000 (in-memory store)
DATA_FILE=.data/dev.json npm start   # keep games across restarts
npm test              # rules, dictionary, bot (vs brute force), server + WebSocket
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
`client/js/main.js`, and (if online) an API module next to `server/words.js`.
Stored games already carry a `t` (type) field.

## Credits

Word list: ENABLE2K (public domain), plus a short supplement in
`data/supplement.txt`.
