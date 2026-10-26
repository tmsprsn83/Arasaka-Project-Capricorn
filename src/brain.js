// Cerveau de CAPRI : Claude Code en mode programme (claude -p), avec la connexion déjà faite par Tommy.
// Une conversation suivie (--resume), la personnalité ajoutée au prompt système, la mémoire dans le coffre
// Obsidian. Pas de commandes système (Bash interdit) : lecture, écriture de notes et recherche web seulement.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VAULT = process.env.CAPRI_VAULT || path.join(os.homedir(), 'OneDrive', 'Documents', 'OBSIDIAN', 'CAPRICORN', 'CAPRICORN');
const MEMORY_DIR = 'Mémoire de CAPRI';
const REVEILS = path.join(VAULT, MEMORY_DIR, 'Réveils.md');

const versionOf = (name) => (name.match(/(\d+)\.(\d+)\.(\d+)/) || [0, 0, 0, 0]).slice(1).map(Number);
const newer = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

// claude.exe : variable CAPRI_CLAUDE, sinon celui de l'extension VS Code la plus récente, sinon « claude » du PATH.
function findClaude() {
  if (process.env.CAPRI_CLAUDE && fs.existsSync(process.env.CAPRI_CLAUDE)) return process.env.CAPRI_CLAUDE;
  const dir = path.join(os.homedir(), '.vscode', 'extensions');
  try {
    const found = fs.readdirSync(dir)
      .filter((name) => name.startsWith('anthropic.claude-code-'))
      .sort((a, b) => newer(versionOf(a), versionOf(b)))
      .map((name) => path.join(dir, name, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude'))
      .filter((file) => fs.existsSync(file));
    if (found.length) return found[found.length - 1];
  } catch {
    /* pas d'extension VS Code */
  }
  return 'claude';
}

// Souvenirs relus à chaque message et joints au prompt : elle les a toujours sous les yeux, même en pleine conversation.
function souvenirs() {
  try { return `\n\n## Tes souvenirs (Souvenirs.md, à respecter)\n${fs.readFileSync(path.join(VAULT, MEMORY_DIR, 'Souvenirs.md'), 'utf8')}`; } catch { return ''; }
}

function persona() {
  const text = fs.readFileSync(path.join(ROOT, 'capri', 'personnalite.md'), 'utf8') + souvenirs();
  return text
    .replaceAll('{{COFFRE}}', VAULT)
    .replaceAll('{{MEMOIRE}}', path.join(VAULT, MEMORY_DIR))
    .replaceAll('{{REVEILS}}', REVEILS)
    .replaceAll('{{EVEIL}}', "Tu n'es réveillée que si ta fenêtre tourne sur son PC : dis-le à Tommy quand c'est important. S'il n'est pas devant son PC à ce moment-là, ton message lui arrive aussi sur son téléphone.")
    .replaceAll('{{DATE}}', new Date().toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
}

// Une réplique : le texte arrive par morceaux (onText), puis la fin (onDone) avec l'identifiant de session.
function ask({ text, sessionId, onText, onDone, onError }) {
  const args = [
    '-p',
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--append-system-prompt', persona(),
    // Réglages du projet seulement : ni les extensions ni les règles de développement de la session de Tommy.
    '--setting-sources', 'project',
    '--add-dir', VAULT,
    '--allowedTools', 'Read,Write,Edit,Glob,Grep,WebSearch,WebFetch',
    '--disallowedTools', 'Bash',
    '--permission-mode', 'acceptEdits',
    ...(sessionId ? ['--resume', sessionId] : []),
  ];
  const child = spawn(findClaude(), args, { cwd: ROOT, windowsHide: true });
  let buffer = '';
  let errors = '';
  let finished = false;
  const finish = (value) => { if (!finished) { finished = true; onDone(value); } };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let line;
    while ((line = buffer.indexOf('\n')) >= 0) {
      const raw = buffer.slice(0, line).trim();
      buffer = buffer.slice(line + 1);
      if (!raw) continue;
      let event;
      try { event = JSON.parse(raw); } catch { continue; }
      const delta = event.type === 'stream_event' && event.event?.type === 'content_block_delta' ? event.event.delta : null;
      if (delta?.type === 'text_delta' && delta.text) onText(delta.text);
      if (event.type === 'result') finish({ sessionId: event.session_id, text: event.result || '', error: event.is_error ? event.result : null });
    }
  });
  child.stderr.on('data', (chunk) => { errors += chunk; });
  child.on('error', (error) => { if (!finished) { finished = true; onError(error.message); } });
  child.on('close', (code) => {
    if (finished) return;
    finished = true;
    onError(errors.trim().split('\n').pop() || `Claude Code s'est arrêté (code ${code})`);
  });
  child.stdin.end(text, 'utf8');
  return () => { if (!finished) child.kill(); };
}

module.exports = { ask, findClaude, VAULT, REVEILS };
