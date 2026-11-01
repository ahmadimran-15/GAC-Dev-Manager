#!/usr/bin/env bash
# Pull the latest code and restart. Run on the VM:  bash /opt/gac-desk/deploy/update.sh
set -euo pipefail
cd /opt/gac-desk
git pull
npm ci
NODE_OPTIONS=--max-old-space-size=1024 npm run build
sudo systemctl restart gac-desk
echo "Updated and restarted."
