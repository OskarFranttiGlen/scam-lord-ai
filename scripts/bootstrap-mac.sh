#!/usr/bin/env bash
set -euo pipefail
# Run this in Terminal.app (outside Cursor sandbox) to finish machine setup.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$ROOT/.tmp-node/bin:$PATH"

echo "==> Installing Homebrew (if missing)"
if ! command -v brew >/dev/null 2>&1; then
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
  fi
fi

echo "==> Installing Node 22 via brew"
brew install node@22 || brew install node
brew link --overwrite --force node@22 2>/dev/null || true

echo "==> Installing Docker Desktop"
if [ ! -d /Applications/Docker.app ]; then
  if [ -f "$ROOT/.tmp-Docker.dmg" ]; then
    open "$ROOT/.tmp-Docker.dmg"
    echo "Mount the DMG, drag Docker to Applications, then open Docker Desktop and finish setup."
  else
    brew install --cask docker
  fi
fi

echo "==> Configuring git hooks"
cd "$ROOT"
npm install
git config core.hooksPath .husky || npx husky

echo "==> When Docker Desktop shows Running, execute:"
echo "    cd \"$ROOT\" && ./start-local-supabase.sh && npm run dev"
