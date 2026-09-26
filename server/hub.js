// Live updates over WebSocket. Browsers connect to /ws while the app is in
// the foreground and send {t:'auth', k: token}; the server then pushes small
// JSON events about that player's games. Nothing is polled.
import { WebSocketServer } from 'ws';

export function createHub(server, { players }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 512, perMessageDeflate: false });
  const conns = new Map(); // playerId -> Set<ws>

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://x');
    const origin = req.headers.origin;
    let sameOrigin = true;
    try {
      if (origin) sameOrigin = new URL(origin).host === req.headers.host;
    } catch {
      sameOrigin = false;
    }
    if (pathname !== '/ws' || !sameOrigin) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });

  wss.on('connection', ws => {
    ws.alive = true;
    ws.on('pong', () => (ws.alive = true));
    const kick = setTimeout(() => ws.close(4001, 'auth'), 10_000);
    ws.on('message', async data => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.t === 'auth' && !ws.pid) {
        const p = await players.fromToken(msg.k);
        if (!p) return ws.close(4001, 'auth');
        clearTimeout(kick);
        ws.pid = p.id;
        if (!conns.has(p.id)) conns.set(p.id, new Set());
        conns.get(p.id).add(ws);
        ws.send('{"t":"hi"}');
      }
    });
    ws.on('close', () => {
      clearTimeout(kick);
      const set = ws.pid && conns.get(ws.pid);
      if (set) {
        set.delete(ws);
        if (!set.size) conns.delete(ws.pid);
      }
    });
  });

  // Heartbeat so dead connections (sleeping phones) get cleaned up.
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) ws.terminate();
      else {
        ws.alive = false;
        ws.ping();
      }
    }
  }, 30_000);
  beat.unref();

  return {
    online: pid => conns.has(pid),
    // Sends to every connection of a player; returns how many got it.
    send(pid, msg) {
      const set = conns.get(pid);
      if (!set) return 0;
      const data = JSON.stringify(msg);
      for (const ws of set) ws.send(data);
      return set.size;
    },
    close() {
      clearInterval(beat);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
