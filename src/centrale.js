// CAPRI du PC branchée sur sa centrale (VPS) : le cerveau, la mémoire et les réveils sont là-bas, le PC garde le
// visage, le calque et la lumière. Réglage : `centrale.json` dans le dossier de données de l'application
// ({ "url": "https://capri…", "jeton": "…" }) ou variables CAPRI_CENTRALE_URL / CAPRI_CENTRALE_JETON.
// Sans réglage, rien ne change : CAPRI réfléchit sur le PC comme avant.
const fs = require('fs');
const path = require('path');
const { createSseParser } = require('./sse');

function readConfig(userData) {
  if (process.env.CAPRI_CENTRALE_URL && process.env.CAPRI_CENTRALE_JETON) return { url: process.env.CAPRI_CENTRALE_URL, jeton: process.env.CAPRI_CENTRALE_JETON };
  try {
    const { url, jeton } = JSON.parse(fs.readFileSync(path.join(userData, 'centrale.json'), 'utf8'));
    return url && jeton ? { url, jeton } : null;
  } catch { return null; }
}

// Lit un flux SSE de la centrale jusqu'à sa fin.
async function readStream(res, onEvent) {
  const parse = createSseParser(onEvent);
  const decoder = new TextDecoder();
  for await (const chunk of res.body) parse(decoder.decode(chunk, { stream: true }));
}

// memoryDir : dossier « Mémoire de CAPRI » du coffre Obsidian, copie lisible des notes du serveur.
function createCentrale({ url, jeton, memoryDir, onReveil, onEchange, onState }) {
  const base = url.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${jeton}` };
  let connected = false;
  let stopped = false;
  const setState = (value) => { if (connected !== value) { connected = value; onState?.(value); } };

  const writeNote = (nom, contenu) => {
    try { fs.mkdirSync(memoryDir, { recursive: true }); fs.writeFileSync(path.join(memoryDir, `${nom}.md`), contenu, 'utf8'); } catch { /* copie seulement */ }
  };

  // À la connexion : les notes du serveur sont recopiées dans Obsidian. Serveur encore vide (premier branchement) :
  // la mémoire du PC (Souvenirs, Réveils) part sur le serveur.
  async function syncMemory() {
    const res = await fetch(`${base}/api/memoire`, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Mémoire : erreur ${res.status}`);
    const { notes } = await res.json();
    if (notes.length) { for (const note of notes) writeNote(note.nom, note.contenu); return; }
    let files = [];
    try { files = fs.readdirSync(memoryDir).filter((f) => f.endsWith('.md')); } catch { /* rien à envoyer */ }
    for (const file of files) {
      await fetch(`${base}/api/memoire/${encodeURIComponent(file.slice(0, -3))}`, {
        method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contenu: fs.readFileSync(path.join(memoryDir, file), 'utf8') }),
        signal: AbortSignal.timeout(15000),
      });
    }
  }

  // Évènements en direct, reconnectés tout seuls (5 s, puis jusqu'à 1 min entre deux essais).
  async function listen() {
    let delay = 5000;
    while (!stopped) {
      try {
        const res = await fetch(`${base}/api/evenements`, { headers });
        if (!res.ok) throw new Error(`Évènements : erreur ${res.status}`);
        setState(true);
        delay = 5000;
        syncMemory().catch(() => {});
        await readStream(res, (name, data) => {
          if (name === 'reveil') onReveil?.(data.texte);
          if (name === 'echange') onEchange?.(data);
          if (name === 'memoire') writeNote(data.nom, data.contenu);
        });
      } catch { /* centrale injoignable : on réessaie */ }
      setState(false);
      if (stopped) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(60000, delay * 2);
    }
  }
  listen();

  return {
    get connected() { return connected; },
    // Même forme que brain.ask. `offline` : la centrale n'a pas répondu du tout (le PC peut prendre le relais).
    ask({ text, onText, onDone, onError }) {
      const abort = new AbortController();
      let finished = false;
      const done = (fn, value) => { if (!finished) { finished = true; fn(value); } };
      (async () => {
        let res;
        try {
          res = await fetch(`${base}/api/parler`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ texte: text }), signal: abort.signal });
        } catch (error) {
          if (!abort.signal.aborted) done(onError, Object.assign(new Error('Centrale injoignable'), { offline: true }));
          return;
        }
        if (!res.ok) { done(onError, new Error(res.status === 401 ? 'Jeton de la centrale refusé' : `Centrale : erreur ${res.status}`)); return; }
        let said = '';
        try {
          await readStream(res, (name, data) => {
            if (name === 'texte') { said += data.t; onText(data.t); }
            if (name === 'fin') done(onDone, { text: said, error: data.error || null });
          });
          done(onDone, { text: said, error: said ? null : 'La centrale a coupé la réponse.' });
        } catch (error) {
          if (!abort.signal.aborted) done(onDone, { text: said, error: 'Connexion à la centrale coupée.' });
        }
      })();
      return () => abort.abort();
    },
    reset: () => fetch(`${base}/api/reinitialiser`, { method: 'POST', headers, signal: AbortSignal.timeout(15000) }).catch(() => {}),
    close() { stopped = true; },
  };
}

module.exports = { readConfig, createCentrale };
