#!/usr/bin/env bash
# Installation ou mise à jour de CAPRI sur un VPS Debian/Ubuntu (Node 20+ et Caddy déjà installés), en root.
# À lancer depuis le dossier CAPRICORN copié sur le serveur : bash serveur/deploiement/installer.sh
# Ne touche jamais au .env existant.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
DEST=/opt/capri

id capri >/dev/null 2>&1 || useradd --system --home "$DEST" --shell /usr/sbin/nologin capri
mkdir -p "$DEST/serveur/donnees" "$DEST/src" "$DEST/capri"
# Seulement ce dont les services ont besoin : pas le visage, ni live2d, ni les images.
cp -r "$SRC/serveur/commun" "$SRC/serveur/centrale" "$SRC/serveur/communication" "$SRC/serveur/outils" "$SRC/serveur/package.json" "$SRC/serveur/package-lock.json" "$DEST/serveur/"
cp "$SRC/src/reveils.js" "$SRC/src/tags.js" "$DEST/src/"
cp "$SRC/capri/personnalite.md" "$SRC/capri/canaux.md" "$DEST/capri/"
if [ ! -f "$DEST/serveur/.env" ]; then
  cp "$SRC/serveur/.env.exemple" "$DEST/serveur/.env"
  echo "À REMPLIR : $DEST/serveur/.env (puis relancer ce script)"
fi
chmod 600 "$DEST/serveur/.env"
(cd "$DEST/serveur" && timeout 300 npm ci --omit=dev)
chown -R capri:capri "$DEST"
cp "$SRC/serveur/deploiement/capri-centrale.service" "$SRC/serveur/deploiement/capri-communication.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now capri-centrale capri-communication
systemctl restart capri-centrale capri-communication
sleep 2
curl -fsS http://127.0.0.1:8710/sante && echo
curl -fsS http://127.0.0.1:8711/sante && echo
echo "Caddy : ajouter le bloc de serveur/deploiement/Caddyfile (avec le vrai domaine), puis systemctl reload caddy."
