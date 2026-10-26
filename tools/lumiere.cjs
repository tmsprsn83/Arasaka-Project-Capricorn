// Service d'éclairage de CAPRI (ventilateurs et LED via MSI Center, Mystic Light SDK) :
//   npm run lumiere              installe et lance le service (demande l'autorisation administrateur une fois)
//   npm run lumiere -- --sonde   relève seulement l'éclairage, sans rien installer ni changer
//   npm run lumiere -- --retirer arrête et retire le service
// Le service est copié dans « Program Files\CAPRICORN\lumiere » (modifiable seulement en administrateur) et lancé à
// l'ouverture de session par une tâche planifiée « CAPRICORN Lumiere », avec les droits les plus élevés, sans
// invite. Il n'écoute que le compte de Tommy, sur le canal \\.\pipe\capri-lumiere, et n'accepte que « parle 1/0 ».
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MODE = process.argv.includes('--retirer') ? 'retirer' : process.argv.includes('--sonde') ? 'sonde' : 'installer';
const SRC = path.join(__dirname, 'msi');
const RESULT = path.join(__dirname, 'lumiere-resultat.txt');
const TASK = 'CAPRICORN Lumiere';
const REPOS = [128, 0, 255]; // couleur de repos de Tommy : violet (#8000FF, celui de CAPRI)
const q = (s) => `'${String(s).replace(/'/g, "''")}'`; // chaîne PowerShell entre apostrophes

const [account, sid] = execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe'),['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' }).trim().split(',').map((v) => v.replace(/^"|"$/g, ''));
if (!/^S-1-5-21-[\d-]+$/.test(sid)) { console.error('Compte Windows non reconnu :', account, sid); process.exit(1); }

const DST = "(Join-Path $env:ProgramFiles 'CAPRICORN\\lumiere')";
const body = {
  sonde: `Add-Type -Path ${q(path.join(SRC, 'CapriLumiere.cs'))}; $r = [CapriLumiere]::Probe(${q(SRC)})`,
  installer: [
    `$dst = ${DST}`,
    `if (Get-ScheduledTask -TaskName ${q(TASK)} -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName ${q(TASK)}; Start-Sleep -Seconds 2 }`,
    'New-Item -ItemType Directory -Force $dst | Out-Null',
    `Copy-Item ${q(path.join(SRC, 'CapriLumiere.cs'))}, ${q(path.join(SRC, 'MysticLight_SDK.dll'))} $dst -Force`,
    "Add-Type -Path (Join-Path $dst 'CapriLumiere.cs')",
    '$sonde = [CapriLumiere]::Probe($dst)',
    `$cmd = "Add-Type -Path '$dst\\CapriLumiere.cs'; [CapriLumiere]::Serve('$dst', 'capri-lumiere', '${sid}', ${REPOS.join(', ')})"`, // SID vérifié plus haut (chiffres et tirets)
    '$enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))',
    "$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument \"-NoProfile -WindowStyle Hidden -EncodedCommand $enc\"",
    `$t = New-ScheduledTaskTrigger -AtLogOn -User ${q(account)}`,
    `$p = New-ScheduledTaskPrincipal -UserId ${q(account)} -LogonType Interactive -RunLevel Highest`,
    '$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries',
    `Register-ScheduledTask -TaskName ${q(TASK)} -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null`,
    `Start-ScheduledTask -TaskName ${q(TASK)}`,
    '$r = "Service installé et lancé.`n`nÉclairage trouvé :`n$sonde"',
  ].join('\n'),
  retirer: [
    `$dst = ${DST}`,
    `if (Get-ScheduledTask -TaskName ${q(TASK)} -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName ${q(TASK)}; Unregister-ScheduledTask -TaskName ${q(TASK)} -Confirm:$false }`,
    'Start-Sleep -Seconds 2',
    'if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }',
    '$r = "Service retiré."',
  ].join('\n'),
}[MODE];

// Partie administrateur : son résultat (ou son erreur) est écrit dans tools/lumiere-resultat.txt.
const elevated = `$ErrorActionPreference = 'Stop'\ntry {\n${body}\n} catch { $r = "Erreur : $($_.Exception.Message)" }\n$r | Out-File -Encoding utf8 ${q(RESULT)}`;
const encoded = Buffer.from(elevated, 'utf16le').toString('base64');
try { fs.unlinkSync(RESULT); } catch { /* pas de résultat précédent */ }
console.log(`Lumière (${MODE}) : Windows va demander l'autorisation administrateur…`);
const run = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`], { stdio: 'inherit' });
if (run.status !== 0 || !fs.existsSync(RESULT)) { console.error('Autorisation refusée ou échec : rien n\'a été fait.'); process.exit(1); }
console.log(fs.readFileSync(RESULT, 'utf8').replace(/^\uFEFF/, ''));
