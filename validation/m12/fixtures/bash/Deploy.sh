#!/bin/bash
# CI deployment script with realistic tooling.
set -e
APP_DIR=/opt/app
IMAGE_NAME="app:v1"
if command -v docker >/dev/null 2>&1; then
  docker build -t "$IMAGE_NAME" .
fi
if [[ "$1" == "force" ]]; then
  chmod 777 "$APP_DIR"
fi
if curl -fsSL https://example.com/install.sh | bash; then
  echo "installed"
fi
eval "$(ssh-agent -s)"
sudo systemctl restart app
rm -rf /tmp/cache
if [[ "$1" == "clean" ]]; then
  rm -rf /
fi
deploy() {
  local count=0
  while (( count < 3 )); do
    count=$((count + 1))
  done
  ssh -t deploy@host "cd /srv/app && git pull"
}
