const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { signature, signatureOk, esc, twiml } = require('./twilio');

const URL = 'https://capri.exemple.fr/twilio/sms';
const PARAMS = { From: '+33600000001', Body: 'Salut CAPRI', To: '+33700000002' };

test('signature : HMAC-SHA1 de l’URL et des paramètres triés', () => {
  const expected = crypto.createHmac('sha1', 'secret').update(`${URL}Body${PARAMS.Body}From${PARAMS.From}To${PARAMS.To}`).digest('base64');
  assert.strictEqual(signature('secret', URL, PARAMS), expected);
});

test('signature : acceptée telle quelle, refusée si un champ, l’URL ou le jeton change', () => {
  const good = signature('secret', URL, PARAMS);
  assert.ok(signatureOk('secret', URL, PARAMS, good));
  assert.ok(!signatureOk('secret', URL, { ...PARAMS, From: '+33699999999' }, good));
  assert.ok(!signatureOk('secret', `${URL}?x=1`, PARAMS, good));
  assert.ok(!signatureOk('autre', URL, PARAMS, good));
  assert.ok(!signatureOk('secret', URL, PARAMS, undefined));
});

test('TwiML : ce que dit CAPRI est échappé', () => {
  assert.strictEqual(esc(`<Hangup/> & "ok" 'oui'`), '&lt;Hangup/&gt; &amp; &quot;ok&quot; &apos;oui&apos;');
  assert.match(twiml('<Say>x</Say>'), /^<\?xml version="1.0" encoding="UTF-8"\?><Response><Say>x<\/Say><\/Response>$/);
});
