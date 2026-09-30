// Little sound effects synthesised on the fly: no audio files to download.
import { local } from '../dom.js';

let ctx = null;

export const muted = () => local.get('wns.mute', false);
export const setMuted = m => local.set('wns.mute', m);

// Must be called from a tap/click (browsers only allow audio after one).
export function initAudio() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {}
}

function tone(freq, { dur = 0.09, type = 'sine', gain = 0.06, at = 0 } = {}) {
  if (!ctx || muted()) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const buzz = ms => navigator.vibrate?.(ms);

export const sfx = {
  // Each tile in a path climbs the scale.
  tile(n) {
    tone(330 * 2 ** ((n * 2) / 12), { dur: 0.06, type: 'triangle', gain: 0.035 });
    buzz(6);
  },
  good(len) {
    const notes = [523, 659, 784, 1047, 1319].slice(0, Math.min(5, len - 1));
    notes.forEach((f, i) => tone(f, { dur: 0.12, type: 'triangle', gain: 0.06, at: i * 0.055 }));
    buzz(len >= 6 ? [20, 30, 40] : 25);
  },
  dupe() {
    tone(440, { dur: 0.1, type: 'sine', gain: 0.04 });
  },
  bad() {
    tone(160, { dur: 0.16, type: 'sawtooth', gain: 0.03 });
    buzz([10, 40, 10]);
  },
  tick() {
    tone(880, { dur: 0.04, type: 'square', gain: 0.02 });
  },
  go() {
    tone(660, { dur: 0.1, type: 'triangle' });
    tone(990, { dur: 0.18, type: 'triangle', at: 0.1 });
  },
  count() {
    tone(440, { dur: 0.08, type: 'triangle', gain: 0.05 });
  },
  end() {
    [784, 659, 523, 392].forEach((f, i) => tone(f, { dur: 0.16, type: 'triangle', at: i * 0.09 }));
    buzz(80);
  },
};
