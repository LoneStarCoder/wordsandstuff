// Web Push "your turn" notifications for players who aren't connected.
// VAPID keys come from the environment, or are generated once and kept in
// the store.
import webpush from 'web-push';

export async function createPush({ store, players, subject }) {
  let keys = null;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    const raw = await store.get('vapid');
    keys = raw ? JSON.parse(raw) : webpush.generateVAPIDKeys();
    if (!raw) await store.set('vapid', JSON.stringify(keys));
  }
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);

  return {
    publicKey: keys.publicKey,

    async subscribe(player, sub) {
      if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) {
        return false;
      }
      const clean = { endpoint: sub.endpoint.slice(0, 1000), keys: { p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 100) } };
      player.push = [clean, ...(player.push || []).filter(s => s.endpoint !== clean.endpoint)].slice(0, 5);
      await players.save(player);
      return true;
    },

    async unsubscribe(player, endpoint) {
      player.push = (player.push || []).filter(s => s.endpoint !== endpoint);
      await players.save(player);
    },

    // payload: { title, body, url, tag }
    async send(pid, payload) {
      const p = await players.load(pid);
      if (!p?.push?.length) return;
      const dead = [];
      await Promise.all(
        p.push.map(sub =>
          webpush
            .sendNotification(sub, JSON.stringify(payload), { TTL: 3 * 86400, urgency: 'normal', topic: payload.tag?.replace(/[^\w-]/g, '').slice(0, 32) })
            .catch(e => {
              if (e.statusCode === 404 || e.statusCode === 410) dead.push(sub.endpoint);
              else console.error('push:', e.statusCode || e.message);
            }),
        ),
      );
      if (dead.length) {
        p.push = p.push.filter(s => !dead.includes(s.endpoint));
        await players.save(p);
      }
    },
  };
}
