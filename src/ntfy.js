// Messages de CAPRI sur le téléphone de Tommy par ntfy (application ntfy, gratuite, sans compte) : une simple requête
// POST sur l'adresse de son sujet. Le nom du sujet est long et aléatoire : c'est lui qui le garde privé.
async function push(url, text, { title = 'CAPRI' } = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Title: title, Tags: 'robot', 'Content-Type': 'text/plain; charset=utf-8' },
    body: String(text).slice(0, 3500),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`ntfy : erreur ${res.status}`);
}

module.exports = { push };
