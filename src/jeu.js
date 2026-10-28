// Cyberpunk 2077 lancé sur le PC : la liste des processus de Windows (tasklist) est relue toutes les 5 s, et onChange
// n'est appelé que quand le jeu démarre ou s'arrête. Le jeu a le même exécutable sur Steam, GOG et Epic.
const { execFile } = require('child_process');

const GAME = 'cyberpunk2077.exe';

// Sortie de `tasklist /FO CSV /NH` : une ligne par processus, le nom en premier champ entre guillemets.
function isPlaying(csv) {
  return String(csv).split(/\r?\n/).some((line) => line.split(',')[0].replace(/"/g, '').trim().toLowerCase() === GAME);
}

// onChange({ playing, since }) ; since : instant du lancement (ms), null quand le jeu est fermé.
function createJeu(onChange, { every = 5000 } = {}) {
  let playing = false;
  let closed = false;
  let timer = null;
  const check = () => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (closed) return;
      if (!error) {
        const now = isPlaying(stdout);
        if (now !== playing) { playing = now; onChange({ playing, since: playing ? Date.now() : null }); }
      }
      timer = setTimeout(check, every);
    });
  };
  check();
  return {
    get playing() { return playing; },
    close() { closed = true; clearTimeout(timer); },
  };
}

module.exports = { createJeu, isPlaying };
