// Lancement de CAPRI à l'ouverture de session Windows (clé « Exécuter » de l'utilisateur) :
//   npm run demarrage         → active
//   npm run demarrage:retirer → retire
// Lance l'Electron du projet sur ce dossier, comme `npm start`.
const path = require('path');
const { execFileSync } = require('child_process');
const { app } = require('electron');

const enable = !process.argv.includes('--retirer');
app.setLoginItemSettings({ name: 'CAPRICORN', path: process.execPath, args: [path.join(__dirname, '..')], openAtLogin: enable });
// Contrôle dans le registre (getLoginItemSettings ne reconnaît pas toujours une entrée avec arguments).
let entry = '';
try { entry = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'CAPRICORN'], { encoding: 'utf8' }); } catch { /* absente */ }
const value = entry.match(/CAPRICORN\s+REG_SZ\s+(.+)/)?.[1].trim();
console.log(value ? `Lancement au démarrage de Windows : activé\nCommande : ${value}` : 'Lancement au démarrage de Windows : retiré');
app.exit(0);
