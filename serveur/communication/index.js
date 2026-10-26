// Module de communication de CAPRI (VPS) : son numéro de téléphone. Reçoit les SMS, MMS et appels de Tommy (webhooks
// Twilio), les passe à la centrale et renvoie ses réponses ; la centrale l'utilise pour écrire ou appeler Tommy.
// Seul le numéro de Tommy est accepté ; chaque webhook est signé par Twilio et vérifié.
//   - Twilio : POST /twilio/sms, /twilio/voix, /twilio/voix/parole, /twilio/voix/attente, /twilio/voix/silence
//   - Centrale : POST /interne/sms, /interne/appeler (jeton CAPRI_JETON_INTERNE)
const http = require('http');
const { loadEnv, need } = require('../commun/env');
loadEnv();
const { readJson, readForm, send, bearerOk } = require('../commun/http');
const { signatureOk, esc, twiml, createTwilio } = require('./twilio');
const { stripMoods } = require('../../src/tags');

const JETON_INTERNE = need('CAPRI_JETON_INTERNE');
const PORT = Number(process.env.CAPRI_PORT_COMMUNICATION || 8711);
const PUBLIC = need('CAPRI_URL_PUBLIQUE').replace(/\/$/, ''); // ex. https://capri.omnirith.com (celle que Twilio appelle)
const CENTRALE = process.env.CAPRI_URL_CENTRALE || 'http://127.0.0.1:8710';
const TOMMY = need('CAPRI_NUMERO_TOMMY'); // format international : +33…
const AUTH_TOKEN = need('TWILIO_AUTH_TOKEN'); // jeton principal : Twilio signe ses webhooks avec lui
const twilio = createTwilio({ accountSid: need('TWILIO_ACCOUNT_SID'), authToken: AUTH_TOKEN, apiKey: process.env.TWILIO_API_KEY, apiSecret: process.env.TWILIO_API_SECRET, from: need('TWILIO_NUMERO'), api: process.env.TWILIO_API });
const VOIX = process.env.CAPRI_VOIX || 'Polly.Lea-Neural'; // voix française de synthèse (pas de clonage)
const IMAGES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// Ce qu'elle dit au téléphone ou par SMS : sans balises d'humeur ni Markdown.
const plain = (text) => stripMoods(text).replace(/^\s*(?:>+|#+)\s?/gm, '').replace(/[*`]+/g, '').replace(/\s+/g, ' ').trim();

async function centrale(texte, canal, images) {
  const res = await fetch(`${CENTRALE}/interne/parler`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${JETON_INTERNE}` },
    body: JSON.stringify({ texte, canal, images }),
    signal: AbortSignal.timeout(180000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(body.error || `Centrale : erreur ${res.status}`);
  return plain(body.texte);
}

// --- Appels ---------------------------------------------------------------------------------------------------
const say = (text) => `<Say voice="${esc(VOIX)}" language="fr-FR">${esc(text)}</Say>`;
const listen = (n = 0) => `<Gather input="speech" language="fr-FR" speechTimeout="auto" action="${esc(`${PUBLIC}/twilio/voix/parole`)}" method="POST"></Gather>`
  + `<Redirect method="POST">${esc(`${PUBLIC}/twilio/voix/silence?n=${n + 1}`)}</Redirect>`;
const GOODBYE = /\b(au revoir|raccroche|bonne nuit|à plus|a plus|bye)\b/i;
// Réponse de CAPRI en préparation, par appel : Twilio attend au plus 15 s une réponse, on le fait patienter.
const pending = new Map();
setInterval(() => { const old = Date.now() - 10 * 60 * 1000; for (const [sid, job] of pending) if (job.at < old) pending.delete(sid); }, 60000);

function answerWhenReady(callSid) {
  const job = pending.get(callSid);
  if (!job) return Promise.resolve(twiml(listen()));
  const wait = new Promise((resolve) => setTimeout(resolve, 8000, null));
  return Promise.race([job.promise, wait]).then((reply) => {
    if (reply === null) return twiml(`<Pause length="1"/><Redirect method="POST">${esc(`${PUBLIC}/twilio/voix/attente`)}</Redirect>`);
    pending.delete(callSid);
    if (job.error) return twiml(`${say('Bzzt, mon serveur a buggé. Rappelle-moi dans un instant !')}<Hangup/>`);
    return twiml(job.bye ? `${say(reply)}<Hangup/>` : say(reply) + listen());
  });
}

// --- Routes -----------------------------------------------------------------------------------------------------
async function handle(req, res) {
  const url = new URL(req.url, PUBLIC);
  const route = `${req.method} ${url.pathname}`;
  if (route === 'GET /sante') return send(res, 200, { ok: true });

  if (url.pathname.startsWith('/interne/')) {
    if (!bearerOk(req, JETON_INTERNE)) return send(res, 401, { ok: false, error: 'Jeton interne invalide' });
    const body = await readJson(req);
    if (route === 'POST /interne/sms' && typeof body.texte === 'string' && body.texte.trim()) {
      await twilio.sms(TOMMY, plain(body.texte));
      return send(res, 200, { ok: true });
    }
    if (route === 'POST /interne/appeler' && typeof body.message === 'string' && body.message.trim()) {
      await twilio.call(TOMMY, twiml(say(plain(body.message)) + listen()));
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { ok: false, error: 'Requête invalide' });
  }

  if (!url.pathname.startsWith('/twilio/') || req.method !== 'POST') return send(res, 404, { ok: false, error: 'Route inconnue' });
  const params = await readForm(req);
  if (!signatureOk(AUTH_TOKEN, PUBLIC + req.url, params, req.headers['x-twilio-signature'])) return send(res, 403, 'Signature invalide', 'text/plain');
  const xml = (body) => send(res, 200, body, 'text/xml; charset=utf-8');

  if (url.pathname === '/twilio/sms') {
    xml(twiml('')); // réponse tout de suite ; CAPRI répond par l'API quand elle a fini de réfléchir
    if (params.From !== TOMMY) return undefined; // personne d'autre ne parle à CAPRI
    try {
      const images = [];
      for (let i = 0; i < Math.min(4, Number(params.NumMedia) || 0); i++) {
        const type = params[`MediaContentType${i}`];
        if (IMAGES.includes(type)) images.push({ type, data: (await twilio.media(params[`MediaUrl${i}`])).toString('base64') });
      }
      const reply = await centrale(params.Body || '', 'sms', images);
      if (reply) await twilio.sms(TOMMY, reply);
    } catch (error) {
      console.error('SMS :', error.message);
      await twilio.sms(TOMMY, 'Bzzt, mon serveur a buggé. Réessaie dans un instant !').catch(() => {});
    }
    return undefined;
  }

  // Appel : Tommy l'appelle, ou elle l'appelle (alors Tommy est le destinataire).
  if (params.From !== TOMMY && params.To !== TOMMY) return xml(twiml('<Reject/>'));
  if (url.pathname === '/twilio/voix') return xml(twiml(say('Allô Tommy ? C\'est CAPRI !') + listen()));
  if (url.pathname === '/twilio/voix/silence') {
    const n = Number(url.searchParams.get('n')) || 1;
    return xml(twiml(n >= 3 ? `${say('Bon, je raccroche. À plus tard !')}<Hangup/>` : say('Tu es toujours là ?') + listen(n)));
  }
  if (url.pathname === '/twilio/voix/parole') {
    const heard = (params.SpeechResult || '').trim();
    if (!heard) return xml(twiml(listen()));
    const job = { at: Date.now(), bye: GOODBYE.test(heard), error: null };
    job.promise = centrale(heard, 'appel').catch((error) => { job.error = error; console.error('Appel :', error.message); return ''; });
    pending.set(params.CallSid, job);
    return xml(await answerWhenReady(params.CallSid));
  }
  if (url.pathname === '/twilio/voix/attente') return xml(await answerWhenReady(params.CallSid));
  return send(res, 404, { ok: false, error: 'Route inconnue' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    if (!res.headersSent) send(res, error.status || 500, { ok: false, error: error.status ? error.message : 'Erreur du serveur' });
    if (!error.status) console.error(error);
  });
});
server.listen(PORT, process.env.CAPRI_HOTE || '127.0.0.1', () => console.log(`Communication de CAPRI sur le port ${PORT}`));
