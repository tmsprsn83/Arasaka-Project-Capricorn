const test = require('node:test');
const assert = require('node:assert/strict');
const { createTagStream, stripMoods } = require('./tags');

const run = (chunks) => {
  let text = '';
  const moods = [];
  const stream = createTagStream((part) => { text += part; }, (mood) => moods.push(mood));
  for (const chunk of chunks) stream.feed(chunk);
  stream.end();
  return { text, moods };
};

test('balises retirées et transmises, même coupées entre deux morceaux', () => {
  assert.deepEqual(run(['[rire] Salut ', 'Tommy ! [co', 'eur] Ça va ?']), { text: ' Salut Tommy !  Ça va ?', moods: ['rire', 'coeur'] });
});

test('crochets ordinaires conservés', () => {
  assert.deepEqual(run(['Tableau [a] et [lien](x)']), { text: 'Tableau [a] et [lien](x)', moods: [] });
  assert.deepEqual(run(['fin [']), { text: 'fin [', moods: [] });
});

test('stripMoods nettoie le texte final', () => {
  assert.equal(stripMoods('[clin] Hé hé  [GLITCH] bug !'), 'Hé hé bug !');
});
