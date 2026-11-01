#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu/Debian VM (Google Cloud e2-micro, 1 GB RAM).
# Usage:  bash setup.sh <git-repo-url> <domain>
# Example: bash setup.sh https://github.com/you/gac-desk.git gacdesk.duckdns.org
set -euo pipefail

REPO="${1:?git repo url}"
DOMAIN="${2:?domain pointing to this VM}"
APP=/opt/gac-desk

echo "==> 2 GB swap (lets the build fit in 1 GB RAM)"
if ! sudo swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo "==> Node 22, git, Caddy (automatic HTTPS)"
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo apt-get update
sudo apt-get install -y caddy

echo "==> App"
sudo mkdir -p "$APP"
sudo chown "$USER" "$APP"
[ -d "$APP/.git" ] || git clone "$REPO" "$APP"
cd "$APP"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "PUBLIC_URL=https://$DOMAIN" >> .env
  echo
  echo "!! Fill in $APP/.env (keys, password), then run this script again."
  exit 1
fi
npm ci
NODE_OPTIONS=--max-old-space-size=1024 npm run build

echo "==> Service (starts on boot, restarts on crash)"
sudo tee /etc/systemd/system/gac-desk.service >/dev/null <<EOF
[Unit]
Description=GAC Desk
After=network.target

[Service]
WorkingDirectory=$APP
ExecStart=/usr/bin/npm run start
Environment=NODE_ENV=production PORT=3000 NODE_OPTIONS=--max-old-space-size=512
Restart=always
RestartSec=5
User=$USER

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now gac-desk

echo "==> HTTPS for $DOMAIN"
echo "$DOMAIN {
  reverse_proxy localhost:3000
}" | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo systemctl reload caddy

echo
echo "Done. Open https://$DOMAIN — then Settings → Register webhook on the gateway."
