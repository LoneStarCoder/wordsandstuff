// Turn-by-turn game state, shared by online games (server) and bot games
// (browser). State is plain JSON so it can be stored as-is:
//   v     variant id           b    board, 225 chars ('.' = empty)
//   bag   remaining tiles       r    [rack0, rack1] as strings
//   s     [score0, score1]      turn seat to move
//   m     moves                 sl   consecutive scoreless turns
//   over  true when finished    win  winning seat, 2 for a tie
//   end   { why: 'out'|'passes'|'resign', adj: [delta0, delta1] }
// A move is { p: seat, k: 'play'|'swap'|'pass'|'resign', t, w, s, n, at }.
import { variant, newBag, analyzeMove, takeFromRack, rackValue, RACK, CELLS } from './rules.js';

export const boardArray = b => [...b].map(c => (c === '.' ? '' : c));
export const boardString = a => a.map(c => c || '.').join('');

export function createState(variantId, rand) {
  const v = variant(variantId);
  const bag = newBag(v, rand);
  const r0 = bag.splice(0, RACK).join('');
  const r1 = bag.splice(0, RACK).join('');
  return {
    v: variantId in { modern: 1, classic: 1 } ? variantId : 'modern',
    b: '.'.repeat(CELLS),
    bag: bag.join(''),
    r: [r0, r1],
    s: [0, 0],
    turn: 0,
    m: [],
    sl: 0,
    over: false,
    win: -1,
  };
}

const fail = error => ({ ok: false, error });

function checkTurn(st, seat) {
  if (st.over) return 'This game is over.';
  if (seat !== st.turn) return "It's not your turn.";
  return null;
}

function finish(st, why, outSeat) {
  const v = variant(st.v);
  const adj = [0, 0];
  if (why === 'out') {
    const other = 1 - outSeat;
    const left = rackValue(v, [...st.r[other]]);
    adj[other] = -left;
    adj[outSeat] = left;
  } else if (why === 'passes') {
    for (const p of [0, 1]) adj[p] = -rackValue(v, [...st.r[p]]);
  }
  st.s = st.s.map((s, p) => s + adj[p]);
  st.over = true;
  st.end = { why, adj };
  if (why === 'resign') st.win = 1 - outSeat;
  else st.win = st.s[0] === st.s[1] ? 2 : st.s[0] > st.s[1] ? 0 : 1;
}

function nextTurn(st, scoreless) {
  st.sl = scoreless ? st.sl + 1 : 0;
  if (st.sl >= variant(st.v).maxScoreless) finish(st, 'passes');
  else st.turn = 1 - st.turn;
}

// Validates and applies a word. `dict` is anything with has(word).
export function play(st, seat, tiles, dict, now = Date.now()) {
  const err = checkTurn(st, seat);
  if (err) return fail(err);
  const v = variant(st.v);
  const board = boardArray(st.b);
  const res = analyzeMove(v, board, tiles);
  if (!res.ok) return res;
  const rack = takeFromRack([...st.r[seat]], tiles.map(t => t[1]));
  if (!rack) return fail("Those tiles aren't on your rack.");
  const bad = res.words.filter(w => !dict.has(w.w)).map(w => w.w);
  if (bad.length) {
    return { ok: false, error: bad.length === 1 ? `${bad[0]} isn't in the word list.` : `${bad.join(', ')} aren't in the word list.`, bad };
  }
  for (const [i, ch] of tiles) board[i] = ch;
  st.b = boardString(board);
  const bag = [...st.bag];
  rack.push(...bag.splice(0, RACK - rack.length));
  st.bag = bag.join('');
  st.r[seat] = rack.join('');
  st.s[seat] += res.score;
  const move = { p: seat, k: 'play', t: tiles.map(([i, ch]) => [i, ch]), w: res.words.map(w => w.w), s: res.score, at: now };
  st.m.push(move);
  if (!rack.length && !bag.length) {
    st.sl = 0;
    finish(st, 'out', seat);
  } else nextTurn(st, false);
  return { ok: true, move, words: res.words };
}

export function swap(st, seat, letters, rand, now = Date.now()) {
  const err = checkTurn(st, seat);
  if (err) return fail(err);
  const v = variant(st.v);
  if (!Array.isArray(letters) || !letters.length || letters.length > RACK) return fail('Pick tiles to swap.');
  if (st.bag.length < Math.max(v.swapMin, letters.length)) return fail('Not enough tiles left in the bag to swap.');
  const rack = takeFromRack([...st.r[seat]], letters.map(c => (c === '?' ? '?' : String(c).toUpperCase())));
  if (!rack) return fail("Those tiles aren't on your rack.");
  const bag = [...st.bag];
  rack.push(...bag.splice(0, letters.length));
  // Return the swapped tiles to random spots in the bag.
  for (const ch of letters) bag.splice(rand(bag.length + 1), 0, ch === '?' ? '?' : String(ch).toUpperCase());
  st.bag = bag.join('');
  st.r[seat] = rack.join('');
  const move = { p: seat, k: 'swap', n: letters.length, s: 0, at: now };
  st.m.push(move);
  nextTurn(st, true);
  return { ok: true, move };
}

export function pass(st, seat, now = Date.now()) {
  const err = checkTurn(st, seat);
  if (err) return fail(err);
  const move = { p: seat, k: 'pass', s: 0, at: now };
  st.m.push(move);
  nextTurn(st, true);
  return { ok: true, move };
}

export function resign(st, seat, now = Date.now()) {
  if (st.over) return fail('This game is over.');
  const move = { p: seat, k: 'resign', s: 0, at: now };
  st.m.push(move);
  finish(st, 'resign', seat);
  return { ok: true, move };
}
