// Twilio sans SDK : signature des webhooks, API REST (SMS, appels, médias) et TwiML.
// Une autre téléphonie (Telnyx, Vonage…) se brancherait en remplaçant ce fichier, sans toucher au reste.
const crypto = require('crypto');
const { sameSecret } = require('../commun/http');

// Signature X-Twilio-Signature : HMAC-SHA1 (jeton du compte) de l'URL appelée suivie des paramètres POST triés,
// chaque nom collé à sa valeur, en base64.
function signature(authToken, url, params) {
  const data = Object.keys(params).sort().reduce((text, key) => text + key + params[key], url);
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}
const signatureOk = (authToken, url, params, received) => !!received && sameSecret(signature(authToken, url, params), received);

// XML de TwiML : tout texte est échappé (ce que dit CAPRI ne doit jamais devenir une balise).
const esc = (text) => String(text).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
const twiml = (inner) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;

// Appels à l'API : avec une clé d'API (SID « SK… » et son secret) si elle est réglée, révocable sans toucher au
// compte ; sinon avec le jeton principal. L'adresse reste celle du compte (« AC… »).
function createTwilio({ accountSid, authToken, apiKey, apiSecret, from, api = 'https://api.twilio.com' }) {
  const user = apiKey && apiSecret ? `${apiKey}:${apiSecret}` : `${accountSid}:${authToken}`;
  const auth = `Basic ${Buffer.from(user).toString('base64')}`;
  async function post(resource, params) {
    const res = await fetch(`${api}/2010-04-01/Accounts/${accountSid}/${resource}.json`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Twilio ${res.status} : ${body.message || 'erreur'}`);
    return body;
  }
  return {
    sms: (to, text) => post('Messages', { To: to, From: from, Body: text.slice(0, 1500) }),
    call: (to, twimlText) => post('Calls', { To: to, From: from, Twiml: twimlText }),
    // Photo d'un MMS : les médias de Twilio demandent l'authentification du compte.
    async media(url, maxBytes = 5 * 1024 * 1024) {
      const res = await fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`Média ${res.status}`);
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length > maxBytes) throw new Error('Photo trop lourde');
      return data;
    },
  };
}

module.exports = { signature, signatureOk, esc, twiml, createTwilio };
