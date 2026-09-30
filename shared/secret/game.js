// Secret Word: guess a 5-letter word in 6 tries. Shared by server and browser.
import { rng } from '../rush/board.js';

export const LEN = 5, MAX_GUESSES = 6;

// Word file: every allowed 5-letter word concatenated, answers in UPPERCASE.
export function parseWords(text) {
  const allowed = new Set(), answers = [];
  for (let i = 0; i + LEN <= text.length; i += LEN) {
    const w = text.slice(i, i + LEN);
    allowed.add(w.toUpperCase());
    if (w !== w.toLowerCase()) answers.push(w);
  }
  return { allowed, answers };
}

export function packWords(allowed, answers) {
  const ans = new Set(answers.map(w => w.toLowerCase()));
  return [...new Set([...allowed, ...ans].map(w => w.toLowerCase()))].sort().map(w => (ans.has(w) ? w.toUpperCase() : w)).join('');
}

// Colours for a guess: 'g' right spot, 'y' in the word elsewhere, '.' not in
// it. Repeated letters are only marked as often as they appear.
export function feedback(guess, answer) {
  const out = Array(LEN).fill('.');
  const left = {};
  for (let i = 0; i < LEN; i++) {
    if (guess[i] === answer[i]) out[i] = 'g';
    else left[answer[i]] = (left[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < LEN; i++) {
    if (out[i] !== 'g' && left[guess[i]]) {
      out[i] = 'y';
      left[guess[i]]--;
    }
  }
  return out.join('');
}

// The daily word: walk through a fixed shuffle of the answers, one per day,
// so words don't repeat until the list runs out.
let order = null;
export function dailyAnswer(day, answers) {
  if (!order || order.n !== answers.length) {
    const rand = rng('secret-word-order');
    const idx = [...answers.keys()];
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    order = { n: answers.length, idx };
  }
  const [y, m, d] = day.split('-').map(Number);
  const n = Math.round(Date.UTC(y, m - 1, d) / 864e5);
  return answers[order.idx[((n % answers.length) + answers.length) % answers.length]];
}

// Result of a finished (or unfinished) list of guesses against an answer.
export function outcome(guesses, answer) {
  const solved = guesses.includes(answer);
  return { solved, tries: solved ? guesses.indexOf(answer) + 1 : null, done: solved || guesses.length >= MAX_GUESSES };
}

export const emojiGrid = rows => rows.map(r => [...r].map(c => (c === 'g' ? '🟩' : c === 'y' ? '🟨' : '⬜')).join('')).join('\n');
