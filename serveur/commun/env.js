// Réglages des services : fichier `serveur/.env` (jamais commité, jamais copié dans Obsidian ni dans la mémoire de
// CAPRI), une ligne CLÉ=valeur par réglage. Une variable déjà définie (systemd, terminal) passe avant le fichier.
const fs = require('fs');
const path = require('path');

function loadEnv(file = path.join(__dirname, '..', '.env')) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; /* pas de fichier : variables du système seulement */ }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

// Réglage obligatoire : le service refuse de démarrer sans lui, avec un message clair.
function need(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Réglage manquant : ${name} (serveur/.env, voir .env.exemple)`);
  return value;
}

module.exports = { loadEnv, need };
