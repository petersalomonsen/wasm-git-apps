FROM mcr.microsoft.com/devcontainers/javascript-node:22

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub Copilot CLI
RUN npm install -g @github/copilot

# Install Playwright
RUN npx playwright install --with-deps chromium

# Set up git server directories
RUN mkdir -p /repos && chown node:node /repos

# Copy git server and startup scripts
COPY .devcontainer/scripts/ /usr/local/share/scripts/
RUN chmod +x /usr/local/share/scripts/*.sh

# Copy templates and instructions into node user's home
COPY --chown=node:node templates/ /home/node/templates/
COPY --chown=node:node .devcontainer/skills/agent-skills.md /home/node/AGENTS.md

# Set working directory to workspaces (where the app will be created)
RUN mkdir -p /workspaces
WORKDIR /workspaces

# Expose ports for web app and git server
EXPOSE 8080 3000
