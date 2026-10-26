const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLine, takeDue } = require('./reveils');

const NOTE = [
  '# Réveils de CAPRI',
  '',
  '- 2026-10-25 09:00 | une fois | Dire bonjour.',
  '- 2026-11-10 09:00 | chaque jour | Vérifier la bourse.',
  '- 2026-10-20 08:30 | Chaque jour | Météo du matin.',
].join('\n');

test('lignes reconnues, le reste ignoré', () => {
  assert.deepEqual(parseLine('- 2026-11-10 09:00 | chaque jour | Vérifier la bourse.'), { at: new Date(2026, 10, 10, 9, 0), daily: true, task: 'Vérifier la bourse.' });
  assert.equal(parseLine('# Réveils de CAPRI'), null);
  assert.equal(parseLine('- demain | une fois | flou'), null);
});

test('unique retiré, quotidien manqué repoussé au prochain jour, futur intact', () => {
  const { fired, text } = takeDue(NOTE, new Date(2026, 9, 25, 10, 0));
  assert.deepEqual(fired, ['Dire bonjour.', 'Météo du matin.']);
  assert.equal(text, [
    '# Réveils de CAPRI',
    '',
    '- 2026-11-10 09:00 | chaque jour | Vérifier la bourse.',
    '- 2026-10-26 08:30 | chaque jour | Météo du matin.',
  ].join('\n'));
});

test('rien à l\'heure : note inchangée', () => {
  const { fired, text } = takeDue(NOTE, new Date(2026, 9, 1, 0, 0));
  assert.deepEqual(fired, []);
  assert.equal(text, NOTE);
});
