// Daily board leaderboard. Everyone gets the same board for a date (it's
// generated from the date, so browsers build it themselves); finished
// players send their words here, the server re-scores them, and everyone
// who played that day can see the scores. Stored under dy:<YYYY-MM-DD>.
import { makeBoard, solve, scoreWords } from '../shared/rush/board.js';
import { HttpError } from './util.js';

const KEEP = 8 * 86400;
const MAX_PLAYERS = 500;

// The board for a date (must match client/js/rush/sources.js Daily).
export const dailyBoard = (day, dict) => makeBoard('daily:' + day, 2, dict, 80);

export function createDaily({ store, dict }) {
  let chain = Promise.resolve();
  const serial = fn => (chain = chain.then(fn, fn));
  const boards = new Map();
  const answers = day => {
    if (!boards.has(day)) {
      const b = dailyBoard(day, dict);
      boards.set(day, { b, valid: new Set(solve(b, dict).map(x => x.w)) });
      if (boards.size > 5) boards.delete(boards.keys().next().value);
    }
    return boards.get(day);
  };

  // Players' dates depend on their time zone, so accept today ± 1 day.
  const checkDay = day => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day));
    const t = m && Date.UTC(+m[1], +m[2] - 1, +m[3]);
    if (!t || Math.abs(t + 12 * 3600e3 - Date.now()) > 40 * 3600e3) throw new HttpError(400, 'That daily board has closed.');
    return day;
  };

  const load = async day => JSON.parse((await store.get('dy:' + day)) || '{}');

  function table(entries, pid) {
    return Object.entries(entries)
      .map(([id, e]) => ({ n: e.n, s: e.s, c: e.c, b: e.b, me: id === pid || undefined }))
      .sort((a, b) => b.s - a.s || b.c - a.c);
  }

  return {
    async scores(player, day) {
      return table(await load(checkDay(day)), player.id);
    },

    // First submission for the day counts.
    submit: (player, day, words) =>
      serial(async () => {
        checkDay(day);
        const entries = await load(day);
        if (!entries[player.id]) {
          if (Object.keys(entries).length >= MAX_PLAYERS) throw new HttpError(400, 'The daily board is full today.');
          const { b, valid } = answers(day);
          const res = scoreWords(b, Array.isArray(words) ? words.slice(0, 400) : [], w => valid.has(w));
          const best = res.words.slice().sort((x, y) => y.s - x.s)[0];
          entries[player.id] = { n: player.n, s: res.total, c: res.words.length, b: best?.w || null, at: Date.now() };
          await store.set('dy:' + day, JSON.stringify(entries), KEEP);
        }
        return table(entries, player.id);
      }),
  };
}
