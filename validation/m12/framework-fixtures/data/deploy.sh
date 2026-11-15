#!/bin/bash
set -euo pipefail

echo "Deploying..."
cp -r dist /var/www/app
systemctl reload nginx
echo "Done."
