#!/bin/sh
# Installs the lane-protection git hooks into this checkout (one command per
# laptop — every machine that pushes to main should run this once):
#   sh script/git-hooks/install.sh
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cp "$ROOT/script/git-hooks/pre-push" "$ROOT/.git/hooks/pre-push"
chmod +x "$ROOT/.git/hooks/pre-push"
echo "installed: .git/hooks/pre-push (lane-protection)"
