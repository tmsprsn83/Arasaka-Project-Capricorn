// Mémoire de CAPRI sur le VPS : des notes Markdown (Souvenirs, Réveils…) dans un dossier du serveur. Le PC de Tommy
// en garde une copie dans son coffre Obsidian (« Mémoire de CAPRI »). Le nom d'une note vient du modèle : il est
// réduit à un nom simple (lettres, chiffres, espaces, tirets), jamais un chemin.
const fs = require('fs');
const path = require('path');

const NAME = /^[\p{L}\p{N}][\p{L}\p{N} _'’-]{0,79}$/u;
const MAX = 200 * 1000;

function noteName(raw) {
  let name = String(raw ?? '').trim().replace(/\\/g, '/').split('/').pop().replace(/\.md$/i, '').trim();
  name = name.normalize('NFC');
  if (!NAME.test(name)) throw new Error(`Nom de note invalide : « ${String(raw).slice(0, 80)} »`);
  return name;
}

function createMemoire(dir, onChange = () => {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (name) => path.join(dir, `${noteName(name)}.md`);
  return {
    list() {
      return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
    },
    read(name) {
      try { return fs.readFileSync(file(name), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    write(name, text) {
      const clean = noteName(name);
      const content = String(text ?? '');
      if (content.length > MAX) throw new Error(`Note trop longue (${content.length} caractères, ${MAX} au plus)`);
      const target = file(clean);
      fs.writeFileSync(`${target}.tmp`, content, 'utf8');
      fs.renameSync(`${target}.tmp`, target);
      onChange(clean, content);
      return clean;
    },
  };
}

module.exports = { createMemoire, noteName };
