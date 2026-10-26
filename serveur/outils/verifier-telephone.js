// État du téléphone de CAPRI chez Twilio, en lecture seule : compte (essai ou payant), numéros du compte et leurs
// possibilités (SMS, MMS, voix), webhooks branchés, numéro de Tommy vérifié (obligatoire en essai).
//   npm run verifier          : lecture seule
//   npm run verifier -- --sms : envoie en plus un SMS de test à Tommy depuis le numéro de CAPRI
const { loadEnv, need } = require('../commun/env');
loadEnv();
const { createTwilio } = require('../communication/twilio');

const SID = need('TWILIO_ACCOUNT_SID');
const KEY = process.env.TWILIO_API_KEY && process.env.TWILIO_API_SECRET ? [process.env.TWILIO_API_KEY, process.env.TWILIO_API_SECRET] : null;
const AUTH = `Basic ${Buffer.from(KEY ? KEY.join(':') : `${SID}:${need('TWILIO_AUTH_TOKEN')}`).toString('base64')}`;
const API = process.env.TWILIO_API || 'https://api.twilio.com';
const TOMMY = process.env.CAPRI_NUMERO_TOMMY || '';
const CAPRI = process.env.TWILIO_NUMERO || '';
const PUBLIC = (process.env.CAPRI_URL_PUBLIQUE || '').replace(/\/$/, '');

async function get(resource) {
  const res = await fetch(`${API}/2010-04-01/Accounts/${SID}${resource}.json`, { headers: { Authorization: AUTH }, signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 401 ? `identifiants refusés (${KEY ? "clé d'API" : 'SID ou jeton'} faux, ou changé sans mettre .env à jour)` : `Twilio ${res.status} : ${body.message}`);
  return body;
}

(async () => {
  const problems = [];
  console.log(`Accès : ${KEY ? `clé d'API ${KEY[0].slice(0, 6)}…` : 'jeton principal'}`);
  const account = await get('');
  const trial = account.type === 'Trial';
  console.log(`Compte : ${trial ? 'essai' : 'payant'}, ${account.status === 'active' ? 'actif' : account.status}`);

  const { incoming_phone_numbers: numbers } = await get('/IncomingPhoneNumbers');
  if (!numbers.length) problems.push('aucun numéro sur le compte : en acheter un (Phone Numbers → Buy a number), SMS + Voice');
  for (const n of numbers) {
    const caps = Object.entries(n.capabilities).filter(([, on]) => on).map(([k]) => k.toUpperCase()).join(', ');
    console.log(`Numéro ${n.phone_number}${n.phone_number === CAPRI ? ' (CAPRI)' : ''} : ${caps || 'aucune possibilité'}`);
    if (n.phone_number !== CAPRI) continue;
    if (!n.capabilities.sms) problems.push('le numéro de CAPRI ne fait pas les SMS');
    if (!n.capabilities.voice) problems.push('le numéro de CAPRI ne fait pas les appels');
    if (!n.capabilities.mms) console.log('  MMS indisponibles sur ce numéro : CAPRI ne verra pas les photos');
    for (const [label, got, want] of [['SMS', n.sms_url, `${PUBLIC}/twilio/sms`], ['appels', n.voice_url, `${PUBLIC}/twilio/voix`]]) {
      if (!PUBLIC) console.log(`  Webhook ${label} : ${got || 'aucun'} (adresse publique de CAPRI pas encore choisie)`);
      else if (got !== want) problems.push(`webhook ${label} : ${got || 'aucun'} au lieu de ${want}`);
    }
  }
  if (!CAPRI) problems.push('TWILIO_NUMERO vide dans .env : y mettre le numéro de CAPRI');
  else if (!numbers.some((n) => n.phone_number === CAPRI)) problems.push(`TWILIO_NUMERO (${CAPRI}) n'appartient pas au compte`);

  if (trial) {
    const { outgoing_caller_ids: verified } = await get('/OutgoingCallerIds');
    if (!verified.some((c) => c.phone_number === TOMMY)) problems.push(`compte d'essai : le numéro de Tommy (${TOMMY || 'non réglé'}) doit être vérifié (Verified Caller IDs)`);
    console.log("Essai : chaque SMS commence par un message de Twilio, et seuls les numéros vérifiés sont joignables");
  }

  if (process.argv.includes('--sms')) {
    if (problems.length) console.log('SMS de test non envoyé : régler d\'abord les points ci-dessous');
    else {
      const sent = await createTwilio({ accountSid: SID, authToken: process.env.TWILIO_AUTH_TOKEN, apiKey: KEY?.[0], apiSecret: KEY?.[1], from: CAPRI, api: API }).sms(TOMMY, "Coucou Tommy, c'est CAPRI ! Test de mon numéro.");
      console.log(`SMS de test envoyé (${sent.status})`);
    }
  }

  console.log(problems.length ? `\nÀ faire :\n${problems.map((p) => `- ${p}`).join('\n')}` : '\nTout est prêt côté Twilio.');
})().catch((error) => { console.error(`Échec : ${error.message}`); process.exit(1); });
