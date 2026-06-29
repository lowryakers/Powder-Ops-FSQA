#!/bin/bash
# deploy.sh — Zero-downtime deploy for Powder Ops FSQA Platform
#
# Usage:
#   ./deploy.sh              # Pull latest from current branch, build, restart
#   ./deploy.sh main         # Pull from specific branch
#
# Setup (run once):
#   chmod +x deploy.sh
#   npm install -g pm2       # Process manager for auto-restart
#   pm2 start server.js --name powder-ops
#   pm2 save && pm2 startup  # Auto-start on boot
#
# Auto-deploy (cron, runs every 5 minutes):
#   */5 * * * * cd /path/to/Preventative-Maintenance && ./deploy.sh >> deploy.log 2>&1

set -e

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
APP_NAME="powder-ops"

echo "[deploy] $(date '+%Y-%m-%d %H:%M:%S') — Checking for updates on $BRANCH..."

# Fetch latest
git fetch origin "$BRANCH" --quiet

# Check if there are new commits
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "[deploy] Already up to date ($LOCAL). Nothing to do."
  exit 0
fi

echo "[deploy] New commits detected: $LOCAL → $REMOTE"

# Pull changes
git pull origin "$BRANCH" --quiet

# Install any new dependencies
npm install --production --quiet 2>/dev/null || npm install --quiet

# Build frontend
echo "[deploy] Building frontend..."
npx vite build --mode production

# Graceful restart via pm2 (waits for connections to drain)
if command -v pm2 &> /dev/null; then
  if pm2 describe "$APP_NAME" &> /dev/null; then
    echo "[deploy] Restarting $APP_NAME via pm2 (graceful)..."
    pm2 reload "$APP_NAME" --update-env
  else
    echo "[deploy] Starting $APP_NAME via pm2..."
    pm2 start server.js --name "$APP_NAME" --wait-ready --listen-timeout 10000
  fi
  pm2 save --force
else
  echo "[deploy] pm2 not found — restarting with node directly..."
  echo "[deploy] Consider: npm install -g pm2"
  # Find and gracefully stop existing process
  PID=$(lsof -ti :3000 2>/dev/null || true)
  if [ -n "$PID" ]; then
    echo "[deploy] Sending SIGTERM to PID $PID..."
    kill -TERM "$PID" 2>/dev/null || true
    # Wait up to 10s for graceful shutdown
    for i in {1..10}; do
      if ! kill -0 "$PID" 2>/dev/null; then break; fi
      sleep 1
    done
    kill -9 "$PID" 2>/dev/null || true
  fi
  nohup node server.js > server.log 2>&1 &
  echo "[deploy] Started with PID $!"
fi

NEW_VERSION=$(git rev-parse --short HEAD)
echo "[deploy] Deploy complete! Version: $NEW_VERSION"
echo "[deploy] Users with open browsers will see a refresh prompt within 60 seconds."
