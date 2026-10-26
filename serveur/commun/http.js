// Petits outils HTTP communs à la centrale et au module de communication (node:http, sans framework).
const crypto = require('crypto');

// Corps de requête limité en taille (texte, JSON ou formulaire Twilio).
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(Object.assign(new Error('Requête trop grosse'), { status: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  const text = await readBody(req, limit);
  try { return text ? JSON.parse(text) : {}; } catch { throw Object.assign(new Error('JSON invalide'), { status: 400 }); }
}

const readForm = async (req) => Object.fromEntries(new URLSearchParams(await readBody(req)));

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

// Jeton d'accès (« Authorization: Bearer … ») comparé en temps constant.
const digest = (text) => crypto.createHash('sha256').update(String(text)).digest();
function sameSecret(a, b) { return crypto.timingSafeEqual(digest(a), digest(b)); }
function bearerOk(req, secret) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') && sameSecret(header.slice(7), secret);
}

// Flux SSE ouvert vers un client ; `event(name, data)` envoie un évènement, un commentaire garde la connexion en vie.
function openSse(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': ok\n\n');
  const keep = setInterval(() => res.write(': ping\n\n'), 25000);
  res.on('close', () => clearInterval(keep));
  return { event: (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`), end: () => { clearInterval(keep); res.end(); } };
}

module.exports = { readBody, readJson, readForm, send, sameSecret, bearerOk, openSse };
