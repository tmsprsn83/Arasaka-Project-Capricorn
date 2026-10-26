// Cerveau de CAPRI sur le VPS : API Claude (clé ANTHROPIC_API_KEY du .env), une seule conversation pour tous les
// canaux (PC, SMS, appels, réveils), gardée sur le disque. L'historique ne fait que s'allonger (jamais réécrit) :
// la compaction côté serveur le résume quand il devient long, et le prompt système fixe reste en cache.
// Le canal et l'heure arrivent par un message système à chaque tour, pour ne pas casser ce cache.
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const ROOT = path.join(__dirname, '..', '..');
const MODEL = process.env.CAPRI_MODELE || 'claude-opus-5-5';
const EFFORT = process.env.CAPRI_EFFORT || 'low'; // conversation : réponses rapides ; un seul niveau pour garder le cache
const BETAS = ['server-side-fallback-2026-07-01', 'compact-2026-01-12'];
const MAX_ROUNDS = 12;

function persona() {
  const read = (file) => fs.readFileSync(path.join(ROOT, 'capri', file), 'utf8');
  return read('personnalite.md')
    .replace('Nous sommes le {{DATE}}.', '')
    .replaceAll('{{COFFRE}}', 'tes notes sur ton serveur')
    .replaceAll('{{MEMOIRE}}', 'Mémoire')
    .replaceAll('{{REVEILS}}', 'Réveils')
    .replaceAll('{{EVEIL}}', 'Sur ton serveur, tu es toujours éveillée, même quand le PC de Tommy est éteint.')
    + '\n\n' + read('canaux.md');
}

const CANAUX = {
  ecran: 'Tommy te parle sur son PC : ton visage est affiché sur son écran.',
  sms: 'Ce message de Tommy arrive par SMS (ou MMS). Ta réponse partira par SMS : 1 à 3 phrases, 450 caractères au plus, sans balises ni Markdown.',
  appel: "Tommy te parle au téléphone (transcription de sa voix). Ta réponse sera lue par ta voix : 1 à 3 phrases courtes, à l'oral, sans balises, listes, symboles ni liens.",
};
const now = () => new Date().toLocaleString('fr-FR', { timeZone: process.env.TZ || 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const context = (canal, note) => `${note || CANAUX[canal] || CANAUX.ecran} Nous sommes le ${now()}.`;

function tools(withPhone) {
  const tool = (name, description, properties, required) => ({
    name, description, eager_input_streaming: true,
    input_schema: { type: 'object', properties, required, additionalProperties: false },
  });
  const list = [
    tool('lister_notes', 'Liste les noms de tes notes de mémoire.', {}, []),
    tool('lire_note', "Lit une de tes notes (par exemple « Souvenirs » ou « Réveils »). Renvoie son texte, ou indique qu'elle n'existe pas.", { nom: { type: 'string' } }, ['nom']),
    tool('ecrire_note', 'Remplace tout le texte d\'une note (la crée si besoin). Relis-la avant pour ne rien perdre.', { nom: { type: 'string' }, contenu: { type: 'string' } }, ['nom', 'contenu']),
  ];
  if (withPhone) {
    list.push(
      tool('envoyer_sms', 'Envoie un SMS à Tommy (et à personne d\'autre).', { texte: { type: 'string' } }, ['texte']),
      tool('appeler_tommy', 'Appelle Tommy sur son téléphone maintenant ; ta voix lui dit ce message, puis vous pouvez parler.', { message: { type: 'string' } }, ['message']),
    );
  }
  list.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 5 });
  return list;
}

// Entrées d'outils venues du modèle : vérifiées avant d'agir (le flux d'entrée n'est plus validé par l'API).
function checkInput(name, input) {
  const need = { lire_note: ['nom'], ecrire_note: ['nom', 'contenu'], envoyer_sms: ['texte'], appeler_tommy: ['message'] }[name] || [];
  if (!input || typeof input !== 'object') return 'entrée invalide';
  const missing = need.filter((key) => typeof input[key] !== 'string');
  return missing.length ? `champ manquant ou invalide : ${missing.join(', ')}` : null;
}

function createCerveau({ dossier, memoire, telephone, factice = process.env.CAPRI_CERVEAU_FACTICE === '1' }) {
  const historyFile = path.join(dossier, 'conversation.json');
  let messages = [];
  try { messages = JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch { /* nouvelle conversation */ }
  const save = () => { fs.writeFileSync(`${historyFile}.tmp`, JSON.stringify(messages)); fs.renameSync(`${historyFile}.tmp`, historyFile); };
  const client = factice ? null : new Anthropic();
  const base = factice ? '' : persona();
  // Souvenirs relus à chaque tour et joints au prompt système : le cache ne se recalcule que s'ils ont changé.
  const system = () => {
    const souvenirs = factice ? null : memoire.read('Souvenirs');
    return souvenirs ? `${base}\n\n## Tes souvenirs (note Souvenirs, à respecter)\n${souvenirs}` : base;
  };
  let queue = Promise.resolve();
  let busy = false;

  async function runTool(name, input) {
    switch (name) {
      case 'lister_notes': return memoire.list().join('\n') || '(aucune note)';
      case 'lire_note': return memoire.read(input.nom) ?? `La note « ${input.nom} » n'existe pas encore.`;
      case 'ecrire_note': return `Note « ${memoire.write(input.nom, input.contenu)} » enregistrée.`;
      case 'envoyer_sms': await telephone.sms(input.texte); return 'SMS envoyé à Tommy.';
      case 'appeler_tommy': await telephone.appeler(input.message); return 'Appel lancé : son téléphone sonne.';
      default: throw new Error(`Outil inconnu : ${name}`);
    }
  }

  // Un tour : le message (texte et images éventuelles), puis les appels d'outils jusqu'à la réponse finale.
  async function turn({ texte, images = [], canal, note, onText }) {
    if (factice) { // banc de test sans clé : CAPRI répète
      const said = `[joie] Écho (${canal}) : ${texte}`;
      for (const part of said.match(/.{1,6}/gs)) { onText?.(part); await new Promise((r) => setTimeout(r, 5)); }
      return { texte: said };
    }
    const start = messages.length;
    const content = [...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.type, data: img.data } })), { type: 'text', text: texte }];
    messages.push({ role: 'user', content }, { role: 'system', content: context(canal, note) });
    const prompt = system();
    let said = '';
    let jsonRetries = 0;
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const stream = client.beta.messages.stream({
          model: MODEL, max_tokens: 16000, betas: BETAS, fallbacks: 'default',
          context_management: { edits: [{ type: 'compact_20260112' }] },
          cache_control: { type: 'ephemeral' },
          output_config: { effort: EFFORT },
          system: prompt, tools: tools(!!telephone), messages,
        });
        stream.on('text', (delta) => { said += delta; onText?.(delta); });
        let message;
        try {
          message = await stream.finalMessage();
          jsonRetries = 0;
        } catch (error) {
          if (error instanceof Anthropic.APIError || jsonRetries++ >= 2) throw error;
          continue; // entrée d'outil illisible : on rejoue ce tour
        }
        messages.push({ role: 'assistant', content: message.content });
        if (message.stop_reason === 'pause_turn') continue;
        if (message.stop_reason !== 'tool_use') break;
        const results = [];
        for (const block of message.content.filter((b) => b.type === 'tool_use')) {
          const problem = checkInput(block.name, block.input);
          try {
            if (problem) throw new Error(problem);
            results.push({ type: 'tool_result', tool_use_id: block.id, content: await runTool(block.name, block.input) });
          } catch (error) {
            results.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: error.message });
          }
        }
        messages.push({ role: 'user', content: results });
      }
      save();
      return { texte: said.trim() };
    } catch (error) {
      messages.length = start; // tour raté : l'historique revient tel qu'il était, pour ne pas le laisser bancal
      throw error;
    }
  }

  return {
    get busy() { return busy; },
    // Les tours passent l'un après l'autre (un SMS qui arrive pendant qu'elle parle sur le PC attend son tour).
    parler(options) {
      const run = queue.then(async () => { busy = true; try { return await turn(options); } finally { busy = false; } });
      queue = run.catch(() => {});
      return run;
    },
    reset() { queue = queue.then(() => { messages = []; save(); }); return queue; },
  };
}

module.exports = { createCerveau, MODEL };
