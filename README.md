# wasm-git-apps

A devcontainer image for autonomously creating, testing, and deploying web applications using GitHub Copilot CLI in yolo mode. This repository is the **image source and template** — each app built inside the container gets its own workspace and git repository.

Web apps use [wasm-git](https://github.com/petersalomonsen/wasm-git) with the OPFS (Origin Private File System) backend for client-side Git storage, and include a built-in Git server for push/sync operations.

## Overview

This project provides:

- A **devcontainer image** published to GitHub Packages (`ghcr.io/petersalomonsen/wasm-git-apps`)
- A **starter template** with wasm-git OPFS integration, ready for Copilot CLI to extend
- **GitHub Copilot CLI** in `--yolo` mode for autonomous development
- A **Git HTTP server** so web apps can push and sync data locally
- **Playwright** for end-to-end testing
- **Kubernetes manifests** for deploying persistent dev environments

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Devcontainer                                       │
│                                                     │
│  ┌───────────────┐   ┌──────────────────────────┐   │
│  │ Copilot CLI   │──▶│ Web App (served locally)  │   │
│  │ (yolo mode)   │   │                          │   │
│  └───────────────┘   │  ┌────────────────────┐  │   │
│         │            │  │ wasm-git + OPFS    │  │   │
│         ▼            │  │ (client-side git)  │  │   │
│  ┌───────────────┐   │  └────────┬───────────┘  │   │
│  │ Playwright    │   └───────────┼──────────────┘   │
│  │ (e2e tests)   │              │                   │
│  └───────────────┘              ▼                   │
│                       ┌──────────────────────┐      │
│                       │ Git Server (local)   │      │
│                       │ (push / sync)        │      │
│                       └──────────────────────┘      │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │ /workspace (app's own git repo)              │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## Quick Start

### Using the pre-built image (recommended)

1. Create a new directory for your app:

   ```bash
   mkdir my-app && cd my-app
   ```

2. Add the devcontainer configuration:

   ```bash
   mkdir -p .devcontainer
   cp /path/to/wasm-git-apps/devcontainer-template/devcontainer.json .devcontainer/
   ```

   Or create `.devcontainer/devcontainer.json` manually:

   ```json
   {
     "name": "wasm-git-app",
     "image": "ghcr.io/petersalomonsen/wasm-git-apps:latest",
     "remoteUser": "node",
     "containerEnv": {
       "GITHUB_TOKEN": "${localEnv:GITHUB_TOKEN}"
     },
     "forwardPorts": [3000, 8080],
     "postCreateCommand": "bash /usr/local/share/scripts/init-workspace.sh"
   }
   ```

3. Set your GitHub token:

   ```bash
   export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

4. Start the devcontainer:

   ```bash
   devcontainer up --workspace-folder .
   devcontainer exec --workspace-folder . bash
   ```

5. The workspace is automatically scaffolded with the wasm-git OPFS template and initialized as its own git repo. Start building:

   ```bash
   copilot --yolo -p "Build a note-taking app that stores notes as git commits"
   ```

### Building the image locally

1. Clone this repository:

   ```bash
   git clone https://github.com/petersalomonsen/wasm-git-apps.git
   cd wasm-git-apps
   ```

2. Open in VS Code with the Dev Containers extension, or build directly:

   ```bash
   devcontainer up --workspace-folder .
   devcontainer exec --workspace-folder . bash
   ```

## How It Works

### Workspace lifecycle

When the devcontainer starts, the `init-workspace.sh` script:

1. Starts the Git HTTP server on port 3000
2. Scaffolds `/workspace` from the wasm-git OPFS template (if empty)
3. Runs `npm install` and copies wasm-git OPFS files into `public/`
4. Initializes `/workspace` as its own git repo with an initial commit

The workspace is the app's own repository — completely independent from this image source repo.

### wasm-git + OPFS Storage

Web apps use [wasm-git](https://github.com/petersalomonsen/wasm-git) compiled to WebAssembly with the OPFS backend. This gives each web app:

- A full Git repository running client-side in the browser
- Persistent file storage via the OPFS API
- The ability to commit, branch, and manage versions entirely in the browser

See the [wasm-git OPFS example](https://github.com/petersalomonsen/wasm-git/tree/master/examples/opfs) for the reference implementation.

### Built-in Git Server

The devcontainer runs a lightweight Git HTTP server that auto-creates bare repos on first access. Web apps proxy git requests through their HTTP server to avoid CORS issues.

### Copilot CLI Agent Skills

The image includes agent skills (`/usr/local/share/skills/agent-skills.md`) that teach Copilot CLI the wasm-git OPFS patterns, COOP/COEP header requirements, Web Worker architecture, and Playwright testing conventions.

## Publishing to a Private GitHub Repository

Once your web app is ready, publish it from inside the devcontainer:

```bash
cd /workspace
gh repo create my-web-app --private --source=. --remote=origin --push
```

## Project Structure

```
wasm-git-apps/                        # Image source repo
├── .devcontainer/
│   ├── devcontainer.json             # Build config (for building the image)
│   ├── Dockerfile                    # Image definition
│   ├── scripts/
│   │   ├── git-server.js             # Git smart HTTP server
│   │   ├── init-workspace.sh         # Scaffold + git init on container start
│   │   ├── setup-git-server.sh       # Start git server
│   │   └── setup-playwright.sh       # Install Playwright browsers
│   └── skills/
│       └── agent-skills.md           # Copilot CLI agent skills
├── devcontainer-template/
│   └── devcontainer.json             # Drop-in config for new app projects
├── templates/wasm-git-opfs/          # Starter template scaffolded into /workspace
├── k8s/                              # Kubernetes deployment manifests
├── .github/workflows/
│   └── publish-image.yml             # Build & push image to ghcr.io
├── .env.example
├── .gitignore
└── README.md
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|---|---|---|
| `GITHUB_TOKEN` | GitHub PAT for Copilot CLI and repo access | Yes |
| `GIT_SERVER_PORT` | Port for the local Git server (default: `3000`) | No |
| `WEB_APP_PORT` | Port for serving the web app (default: `8080`) | No |

## License

MIT
