const test = require('node:test');
const assert = require('node:assert');
const { isPlaying } = require('./jeu');

const LIST = [
  '"System Idle Process","0","Services","0","8 Ko"',
  '"explorer.exe","5124","Console","1","182 340 Ko"',
];

test('jeu absent', () => {
  assert.strictEqual(isPlaying(LIST.join('\r\n')), false);
  assert.strictEqual(isPlaying(''), false);
});

test('jeu lancé, quelle que soit la casse', () => {
  assert.strictEqual(isPlaying([...LIST, '"Cyberpunk2077.exe","20480","Console","1","9 812 004 Ko"'].join('\r\n')), true);
  assert.strictEqual(isPlaying('"CYBERPUNK2077.EXE","1","Console","1","1 Ko"'), true);
});

test('ni le lanceur ni un nom qui le contient', () => {
  assert.strictEqual(isPlaying('"REDprelauncher.exe","1","Console","1","1 Ko"'), false);
  assert.strictEqual(isPlaying('"Cyberpunk2077.exe.bak","1","Console","1","1 Ko"'), false);
});
