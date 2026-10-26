// Réveils de CAPRI : la note `Réveils.md` de sa mémoire, une ligne par réveil, qu'elle écrit elle-même quand
// Tommy lui demande de le prévenir. La fenêtre les relit chaque minute et réveille CAPRI à l'heure dite.
//   - 2026-11-10 09:00 | chaque jour | Vérifie si Anthropic est entrée en bourse.
//   - 2026-10-26 18:30 | une fois | Rappelle à Tommy d'appeler sa mère.

const LINE = /^\s*-\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*\|\s*(une fois|chaque jour)\s*\|\s*(.+?)\s*$/i;

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

function parseLine(line) {
  const m = line.match(LINE);
  if (!m) return null;
  const [, y, mo, d, h, mi, repeat, task] = m;
  return { at: new Date(+y, +mo - 1, +d, +h, +mi), daily: repeat.toLowerCase() === 'chaque jour', task };
}

// Réveils arrivés à l'heure : retirés s'ils sont uniques, repoussés au prochain jour à venir s'ils sont quotidiens
// (un réveil manqué pendant que la fenêtre était fermée sonne une seule fois, au retour).
function takeDue(text, now = new Date()) {
  const fired = [];
  const lines = [];
  for (const line of text.split(/\r?\n/)) {
    const reveil = parseLine(line);
    if (!reveil || reveil.at > now) { lines.push(line); continue; }
    fired.push(reveil.task);
    if (!reveil.daily) continue;
    const next = new Date(reveil.at);
    while (next <= now) next.setDate(next.getDate() + 1);
    lines.push(`- ${stamp(next)} | chaque jour | ${reveil.task}`);
  }
  return { fired, text: lines.join('\n') };
}

module.exports = { parseLine, takeDue };
