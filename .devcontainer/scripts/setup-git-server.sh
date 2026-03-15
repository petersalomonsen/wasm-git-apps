#!/bin/bash
set -e

echo "Setting up git server..."

# Ensure repos directory exists
mkdir -p /repos

# Start git server in background
node /usr/local/share/scripts/git-server.js &
echo "Git HTTP server started on port ${GIT_SERVER_PORT:-3000}"

echo "Setup complete!"
