# wasm-git-apps

A devcontainer for AI-driven creation of web applications that use **Git as their application data store** — powered by [wasm-git](https://github.com/petersalomonsen/wasm-git) and the browser's Origin Private File System (OPFS).

Instead of a traditional database, these apps store all user data as Git commits. Every change is versioned, the app works offline, and users can export their data at any time by simply cloning a repo.

## Why Git Instead of a Database?

AI-powered app builders like Lovable and Bolt typically scaffold apps backed by a traditional database. This project explores an alternative: **Git as the data layer**, running entirely in the browser via WebAssembly.

### Versioned data by default

Every save is a commit. Users get full change history for free — undo, audit trails, and diffs — without building any of that into the application layer.

### Offline-first

The OPFS backend persists data locally in the browser. The app works without a network connection and syncs when back online. No "connection lost" error states to handle.

### Multi-tenancy via repos

Each user gets their own Git repository. This provides natural data isolation — no shared database tables, no row-level security policies, no tenant ID columns. Each user's data is a separate repo on the server.

### Git-native governance

Git's collaboration model can be applied to application data:

- **Branch protection** — require all data changes to go through a branch and merge, preventing direct writes to the main data
- **Required checks** — validation scripts stored inside the repo that must pass before a merge is accepted
- **Policy-as-code** — the validation rules themselves are versioned; changing them requires a reviewed PR, like a "policy change" that is auditable and reversible

This brings DevOps-style governance to user data — something databases don't offer natively.

### Data portability

A user's data is a Git repo. They can clone it, fork it, or move it to another server. This satisfies data export requirements (GDPR right to data portability) without building any export functionality into the app.

### Hidden complexity

The end user never sees Git. The app presents a normal UI — save, edit, delete — while Git handles versioning, sync, and conflict resolution behind the scenes. The complexity of Git becomes an implementation detail, not a user-facing concept.

## How It Works

This project provides a **devcontainer image** (`ghcr.io/petersalomonsen/wasm-git-apps`) with everything needed for an AI agent to autonomously build wasm-git OPFS web apps:

- **GitHub Copilot CLI** in `--yolo` mode for autonomous development
- **wasm-git OPFS templates** and **agent instructions** (`AGENTS.md`) baked into the image
- A **Git HTTP server** that auto-creates repos on first access
- **Playwright** with Chromium for end-to-end testing

The agent reads the instructions, scaffolds an app in `/workspaces`, writes Playwright tests, and runs them — all autonomously.

### Architecture

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
│  │ /workspaces (app's own git repo)             │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### wasm-git + OPFS

Web apps use [wasm-git](https://github.com/petersalomonsen/wasm-git) compiled to WebAssembly with the OPFS backend. Git operations run synchronously inside a Web Worker (pthreads + WASMFS), giving each app:

- A full Git repository running client-side in the browser
- Persistent file storage via the OPFS API
- The ability to commit, branch, push, and pull entirely in the browser

See the [wasm-git OPFS example](https://github.com/petersalomonsen/wasm-git/tree/master/examples/opfs) for the reference implementation.

## Quick Start

### Build the image

```bash
git clone https://github.com/petersalomonsen/wasm-git-apps.git
cd wasm-git-apps
devcontainer build --workspace-folder .
```

Or use the pre-built image from GitHub Packages: `ghcr.io/petersalomonsen/wasm-git-apps:latest`

### Run locally

```bash
docker run --rm -it \
  -e GITHUB_TOKEN="$GITHUB_TOKEN" \
  -p 8080:8080 -p 3000:3000 \
  ghcr.io/petersalomonsen/wasm-git-apps:latest \
  bash -c "bash /usr/local/share/scripts/setup-git-server.sh && bash"
```

Then ask the agent to create an app:

```bash
copilot --yolo -p "Create a note-taking app in /workspaces/notes-app. \
  Read /home/node/AGENTS.md for instructions. \
  Notes should be stored as git commits using wasm-git with OPFS."
```

### Deploy to Kubernetes

```bash
# Create the GitHub token secret
kubectl create secret generic github-pat --from-literal=token=$GITHUB_TOKEN

# Apply manifests
kubectl apply -f k8s/
```

The K8s deployment includes a PVC for persistent workspace storage, so apps survive pod restarts.

## Project Structure

```
wasm-git-apps/                        # Image source repo
├── .devcontainer/
│   ├── devcontainer.json             # Build config
│   ├── Dockerfile                    # Image definition
│   ├── scripts/
│   │   ├── git-server.js             # Git smart HTTP server
│   │   └── setup-git-server.sh       # Start git server
│   └── skills/
│       └── agent-skills.md           # Agent instructions (→ /home/node/AGENTS.md)
├── devcontainer-template/
│   └── devcontainer.json             # Drop-in config for using the pre-built image
├── templates/wasm-git-opfs/          # Starter template (→ /home/node/templates/)
├── k8s/                              # Kubernetes deployment manifests
├── .github/workflows/
│   └── publish-image.yml             # Build & push image to ghcr.io
└── README.md
```

## License

MIT
