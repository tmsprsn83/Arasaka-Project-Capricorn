// Balises de CAPRI glissées dans ses réponses ([rire], [coeur], [colere], [joie]… : MOODS), avec ou sans accents :
// retirées du texte affiché et transmises au visage ([telephone] : la réponse part aussi sur le téléphone de Tommy). Le flux arrive par morceaux, une balise peut être coupée
// entre deux morceaux : on garde la fin en attente tant qu'elle peut encore devenir une balise.

const MOODS = ['rire', 'coeur', 'clin', 'glitch', 'surprise', 'boude', 'triste', 'fache', 'joie', 'colere', 'excitee', 'malice', 'fierte', 'peur', 'gene', 'ennui', 'telephone'];
const MAX_TAG = Math.max(...MOODS.map((mood) => mood.length)) + 2;
// « colère », « gêne », « fierté », « excitée » : on compare sans accents.
const bare = (word) => word.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function createTagStream(onText, onMood) {
  let pending = '';
  const flush = (final) => {
    let out = '';
    while (pending) {
      const open = pending.indexOf('[');
      if (open < 0) { out += pending; pending = ''; break; }
      out += pending.slice(0, open);
      pending = pending.slice(open);
      const close = pending.indexOf(']');
      if (close < 0) {
        // Balise peut-être incomplète : on attend la suite, sauf en fin de flux ou si c'est trop long.
        if (!final && pending.length <= MAX_TAG) break;
        out += pending[0];
        pending = pending.slice(1);
        continue;
      }
      const word = bare(pending.slice(1, close));
      if (MOODS.includes(word)) {
        onMood(word);
        pending = pending.slice(close + 1);
      } else {
        out += pending[0];
        pending = pending.slice(1);
      }
    }
    if (out) onText(out);
  };
  return {
    feed(chunk) { pending += chunk; flush(false); },
    end() { flush(true); },
  };
}

// Texte final sans balises (journal, mémoire).
function stripMoods(text) {
  return text.replace(/\[([^[\]]{1,24})\]/g, (tag, word) => (MOODS.includes(bare(word)) ? '' : tag)).replace(/[ \t]{2,}/g, ' ').trim();
}

// Node (tests, processus principal) ou page de la fenêtre (script classique).
if (typeof module !== 'undefined') module.exports = { MOODS, createTagStream, stripMoods };
else window.CapriTags = { MOODS, createTagStream, stripMoods };
