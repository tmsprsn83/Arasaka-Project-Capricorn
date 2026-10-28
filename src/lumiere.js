// Éclairage du PC (ventilateurs et LED de la carte mère MSI) : CAPRI prévient le service d'éclairage
// (tools/msi/CapriLumiere.cs, lancé en administrateur par `npm run lumiere`) quand elle se met à parler et quand elle
// se tait, et quand Cyberpunk 2077 démarre ou s'arrête (ambiance Night City). Sans service installé, rien ne se
// passe ; il est recherché toutes les 15 s.
const net = require('net');

const PIPE = '\\\\.\\pipe\\capri-lumiere';

function createLumiere() {
  let socket = null;
  let connecting = false;
  let closed = false;
  let retry = null;
  const want = { parle: false, jeu: false };
  let sent = {};

  // Le jeu d'abord : si elle parle déjà, le service reprendra l'ambiance du jeu quand elle se taira.
  const flush = () => {
    if (!socket) return;
    for (const key of ['jeu', 'parle']) {
      if (sent[key] === want[key]) continue;
      socket.write(`${key} ${want[key] ? 1 : 0}\n`);
      sent[key] = want[key];
    }
  };
  const connect = () => {
    if (closed || socket || connecting) return;
    connecting = true;
    const s = net.connect(PIPE);
    s.on('connect', () => { connecting = false; socket = s; sent = {}; flush(); });
    s.on('error', () => {});
    s.on('close', () => {
      connecting = false;
      socket = null;
      clearTimeout(retry);
      if (!closed) retry = setTimeout(connect, 15000);
    });
  };
  connect();

  return {
    parle(on) { want.parle = !!on; flush(); },
    jeu(on) { want.jeu = !!on; flush(); },
    // En jeu (ambiance.js) : couleur dominante de l'écran, dégâts, coupure brutale. Perdus si le service est absent.
    ecran([r, g, b]) { if (socket) socket.write(`ecran ${r | 0} ${g | 0} ${b | 0}\n`); },
    degats() { if (socket) socket.write('degats\n'); },
    glitch() { if (socket) socket.write('glitch\n'); },
    close() {
      closed = true;
      clearTimeout(retry);
      socket?.end('parle 0\njeu 0\n');
    },
  };
}

module.exports = { createLumiere };
