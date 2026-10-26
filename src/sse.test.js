const test = require('node:test');
const assert = require('node:assert');
const { createSseParser } = require('./sse');

test('évènements coupés n’importe où entre deux morceaux', () => {
  const events = [];
  const feed = createSseParser((name, data) => events.push([name, data]));
  const stream = ': ok\n\nevent: texte\ndata: {"t":"Sa"}\n\nevent: texte\r\ndata: {"t":"lut"}\r\n\r\n: ping\n\nevent: fin\ndata: {}\n\n';
  for (let i = 0; i < stream.length; i += 3) feed(stream.slice(i, i + 3));
  assert.deepStrictEqual(events, [['texte', { t: 'Sa' }], ['texte', { t: 'lut' }], ['fin', {}]]);
});

test('données illisibles ignorées', () => {
  const events = [];
  const feed = createSseParser((name, data) => events.push([name, data]));
  feed('event: texte\ndata: {pas du json\n\nevent: fin\ndata: {"error":null}\n\n');
  assert.deepStrictEqual(events, [['fin', { error: null }]]);
});
