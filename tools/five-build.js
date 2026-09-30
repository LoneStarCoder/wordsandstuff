// Builds the Secret Word list: all 5-letter dictionary words, answers marked.
import { readFileSync } from 'node:fs';
import { loadWords } from './dawg-build.js';
import { packWords } from '../shared/secret/game.js';

export function fiveWords(dataDir) {
  const allowed = loadWords([dataDir + '/enable1.txt', dataDir + '/supplement.txt'], 5).filter(w => w.length === 5);
  const answers = readFileSync(dataDir + '/secret-answers.txt', 'utf8').split('\n').map(w => w.trim()).filter(w => /^[a-z]{5}$/.test(w));
  return packWords(allowed, answers);
}
