const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMemoire, noteName } = require('./memoire');

test('noms de notes : chemin et extension retirés', () => {
  assert.strictEqual(noteName('Souvenirs'), 'Souvenirs');
  assert.strictEqual(noteName('Souvenirs.md'), 'Souvenirs');
  assert.strictEqual(noteName('Mémoire/Réveils.md'), 'Réveils');
  assert.strictEqual(noteName('C:\\x\\Idées de Tommy'), 'Idées de Tommy');
});

test('noms de notes : jamais de sortie du dossier', () => {
  for (const bad of ['..', '../..', '', '.env', '../.env', 'a/..', 'x'.repeat(90), '<script>']) {
    assert.throws(() => noteName(bad), /invalide/, bad);
  }
});

test('écrire puis relire, liste triée, changement signalé', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-memoire-'));
  const changes = [];
  const memoire = createMemoire(dir, (nom) => changes.push(nom));
  assert.strictEqual(memoire.read('Souvenirs'), null);
  memoire.write('Souvenirs.md', '# Souvenirs\n- Tommy aime le violet');
  memoire.write('Réveils', '# Réveils');
  assert.strictEqual(memoire.read('Souvenirs'), '# Souvenirs\n- Tommy aime le violet');
  assert.deepStrictEqual(memoire.list(), ['Réveils', 'Souvenirs']);
  assert.deepStrictEqual(changes, ['Souvenirs', 'Réveils']);
  fs.rmSync(dir, { recursive: true, force: true });
});
