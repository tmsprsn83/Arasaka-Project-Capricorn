// Éclairage du PC (ventilateurs et LED de la carte mère MSI) : CAPRI prévient le service d'éclairage
// (tools/msi/CapriLumiere.cs, lancé en administrateur par `npm run lumiere`) quand elle se met à parler et quand elle
// se tait. Sans service installé, rien ne se passe ; il est recherché toutes les 15 s.
const net = require('net');

const PIPE = '\\\\.\\pipe\\capri-lumiere';

function createLumiere() {
  let socket = null;
  let connecting = false;
  let closed = false;
  let retry = null;
  let want = false;
  let sent = null;

  const flush = () => {
    if (!socket || sent === want) return;
    socket.write(`parle ${want ? 1 : 0}\n`);
    sent = want;
  };
  const connect = () => {
    if (closed || socket || connecting) return;
    connecting = true;
    const s = net.connect(PIPE);
    s.on('connect', () => { connecting = false; socket = s; sent = null; flush(); });
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
    parle(on) { want = !!on; flush(); },
    close() {
      closed = true;
      clearTimeout(retry);
      socket?.end('parle 0\n');
    },
  };
}

module.exports = { createLumiere };
