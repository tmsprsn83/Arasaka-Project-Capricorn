// Centrale de CAPRI (VPS) : son cerveau, sa mémoire et ses réveils, toujours allumés.
//   - CAPRI du PC : POST /api/parler (réponse en flux SSE), GET /api/evenements (réveils, échanges par téléphone,
//     notes modifiées), GET /api/memoire, PUT /api/memoire/:nom, POST /api/reinitialiser. Jeton CAPRI_JETON.
//   - Module de communication : POST /interne/parler (SMS, MMS, appels). Jeton CAPRI_JETON_INTERNE.
// Écoute sur 127.0.0.1 seulement : Caddy (HTTPS) ne publie que /api ; /interne reste dans le serveur.
const http = require('http');
const path = require('path');
const { loadEnv, need } = require('../commun/env');
loadEnv();
const { readJson, send, bearerOk, openSse } = require('../commun/http');
const { createMemoire, noteName } = require('./memoire');
const { createCerveau, MODEL } = require('./cerveau');
const { takeDue } = require('../../src/reveils');
const { stripMoods } = require('../../src/tags');

const JETON = need('CAPRI_JETON');
const JETON_INTERNE = need('CAPRI_JETON_INTERNE');
const PORT = Number(process.env.CAPRI_PORT_CENTRALE || 8710);
const DONNEES = process.env.CAPRI_DONNEES || path.join(__dirname, '..', 'donnees');
const COMMUNICATION = process.env.CAPRI_URL_COMMUNICATION || ''; // ex. http://127.0.0.1:8711 ; vide : pas de téléphone

// Clients connectés (CAPRI du PC) : ils reçoivent les évènements en direct.
const clients = new Set();
const broadcast = (name, data) => { for (const client of clients) client.event(name, data); };

const memoire = createMemoire(path.join(DONNEES, 'memoire'), (nom, contenu) => broadcast('memoire', { nom, contenu }));

// Le téléphone, vu de la centrale : le module de communication fait le travail.
async function interne(route, body) {
  const res = await fetch(`${COMMUNICATION}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${JETON_INTERNE}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const reply = await res.json().catch(() => ({}));
  if (!res.ok || !reply.ok) throw new Error(reply.error || `Module de communication : erreur ${res.status}`);
  return reply;
}
const telephone = COMMUNICATION ? {
  sms: (texte) => interne('/interne/sms', { texte: stripMoods(texte) }),
  appeler: (message) => interne('/interne/appeler', { message: stripMoods(message) }),
} : null;

const cerveau = createCerveau({ dossier: DONNEES, memoire, telephone });

// Réveils : chaque minute, ceux de la note « Réveils » arrivés à l'heure. Tommy devant son PC : CAPRI lui parle
// à l'écran ; sinon sa réponse part par SMS. « RIEN » : rien ne mérite de le déranger.
const WAKE = (tasks, present) => [
  '[Réveil automatique : ce message ne vient pas de Tommy, il ne l\'a pas écrit.]',
  'Réveils que tu as programmés et qui arrivent maintenant :',
  ...tasks.map((task) => `- ${task}`),
  present ? 'Tommy est devant son PC : ta réponse s\'affichera sur ton écran.' : 'Tommy n\'est pas devant son PC : ta réponse lui partira par SMS (court, sans balises).',
  'Fais-le maintenant. Si tu as quelque chose à dire à Tommy, parle-lui directement, comme si tu lançais la conversation.',
  'Si rien ne mérite de le déranger, réponds exactement : RIEN',
].join('\n');
async function checkReveils() {
  if (cerveau.busy) return;
  const note = memoire.read('Réveils');
  if (!note) return;
  const { fired, text } = takeDue(note);
  if (!fired.length) return;
  memoire.write('Réveils', text); // avant de réveiller, sinon il sonnerait en boucle
  const present = clients.size > 0;
  try {
    const { texte } = await cerveau.parler({ texte: WAKE(fired, present), canal: present ? 'ecran' : 'sms', note: 'Réveil automatique (pas un message de Tommy).' });
    const said = stripMoods(texte);
    if (!said || /^RIEN\.?$/i.test(said)) return;
    if (clients.size > 0) broadcast('reveil', { texte });
    else if (telephone) await telephone.sms(said);
  } catch (error) {
    console.error('Réveil :', error.message);
  }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://centrale');
  const route = `${req.method} ${url.pathname}`;
  if (route === 'GET /sante') return send(res, 200, { ok: true, modele: MODEL, telephone: !!telephone, clients: clients.size });

  if (url.pathname.startsWith('/interne/')) {
    if (!bearerOk(req, JETON_INTERNE)) return send(res, 401, { ok: false, error: 'Jeton interne invalide' });
    if (route === 'POST /interne/parler') {
      const body = await readJson(req, 12 * 1024 * 1024); // MMS : images en base64
      const canal = body.canal === 'appel' ? 'appel' : 'sms';
      if (typeof body.texte !== 'string') return send(res, 400, { ok: false, error: 'texte manquant' });
      const images = Array.isArray(body.images) ? body.images.slice(0, 4) : [];
      const { texte } = await cerveau.parler({ texte: body.texte || '(photo)', images, canal });
      broadcast('echange', { canal, tommy: body.texte, capri: texte }); // le PC voit la conversation téléphonique
      return send(res, 200, { ok: true, texte });
    }
    return send(res, 404, { ok: false, error: 'Route inconnue' });
  }

  if (!url.pathname.startsWith('/api/')) return send(res, 404, { ok: false, error: 'Route inconnue' });
  if (!bearerOk(req, JETON)) return send(res, 401, { ok: false, error: 'Jeton invalide' });

  if (route === 'POST /api/parler') {
    const body = await readJson(req);
    if (typeof body.texte !== 'string' || !body.texte.trim()) return send(res, 400, { ok: false, error: 'texte manquant' });
    const sse = openSse(res);
    try {
      await cerveau.parler({ texte: body.texte.trim().slice(0, 20000), canal: 'ecran', onText: (t) => sse.event('texte', { t }) });
      sse.event('fin', {});
    } catch (error) {
      console.error('Parler :', error.message);
      sse.event('fin', { error: 'Mon cerveau a buggé sur le serveur, réessaie.' });
    }
    return sse.end();
  }
  if (route === 'GET /api/evenements') {
    const sse = openSse(res);
    clients.add(sse);
    req.on('close', () => clients.delete(sse));
    return undefined;
  }
  if (route === 'GET /api/memoire') {
    return send(res, 200, { ok: true, notes: memoire.list().map((nom) => ({ nom, contenu: memoire.read(nom) })) });
  }
  if (req.method === 'PUT' && url.pathname.startsWith('/api/memoire/')) {
    const body = await readJson(req, 512 * 1024);
    const nom = memoire.write(noteName(decodeURIComponent(url.pathname.slice('/api/memoire/'.length))), body.contenu);
    return send(res, 200, { ok: true, nom });
  }
  if (route === 'POST /api/reinitialiser') { await cerveau.reset(); return send(res, 200, { ok: true }); }
  return send(res, 404, { ok: false, error: 'Route inconnue' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    if (!res.headersSent) send(res, error.status || 500, { ok: false, error: error.status ? error.message : 'Erreur du serveur' });
    if (!error.status) console.error(error);
  });
});
server.listen(PORT, process.env.CAPRI_HOTE || '127.0.0.1', () => {
  console.log(`Centrale de CAPRI sur le port ${PORT} (modèle ${MODEL}, téléphone ${telephone ? 'branché' : 'absent'})`);
});
setInterval(checkReveils, 60 * 1000);
