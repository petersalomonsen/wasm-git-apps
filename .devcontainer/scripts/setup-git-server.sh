#!/bin/bash
set -e

echo "Setting up git server..."

# Ensure repos directory exists
mkdir -p /repos

# Symlink AGENTS.md into /workspaces so copilot auto-discovers it
ln -sf /home/node/AGENTS.md /workspaces/AGENTS.md 2>/dev/null || true

# Start git server in background
node /usr/local/share/scripts/git-server.js &
echo "Git HTTP server started on port ${GIT_SERVER_PORT:-3000}"

echo "Setup complete!"
