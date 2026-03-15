# wasm-git OPFS Web App Development Skills

You are building web applications inside a devcontainer that uses **wasm-git** with the **OPFS (Origin Private File System)** backend for client-side Git storage. A local Git HTTP server is running for push/sync operations.

## Environment

- **Git HTTP server**: `http://localhost:3000` — auto-creates bare repos on first push/clone
- **Web app port**: `8080` — use this to serve your app
- **wasm-git npm package**: `wasm-git` — contains `lg2_opfs.js` and `lg2_opfs.wasm`
- **Playwright**: installed with Chromium for end-to-end testing
- **Node.js 22**: available for build tools and servers

## Required Headers

Web apps using wasm-git OPFS **must** be served with these headers for SharedArrayBuffer support:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

## wasm-git OPFS Architecture

The wasm-git OPFS integration works as follows:

1. **Web Worker**: All git operations run synchronously inside a Web Worker (pthreads + WASMFS)
2. **OPFS Backend**: Files are persisted in the browser's Origin Private File System
3. **Main Thread ↔ Worker**: Communication via `postMessage` with a simple command protocol

### Worker Setup Pattern

The worker must:
1. Import `lg2_opfs.js` from the `wasm-git` npm package
2. Create the OPFS backend via `lg._lg2_create_opfs_backend()`
3. Create a working directory mounted on the OPFS backend
4. Handle commands: `clone`, `writecommitandpush`, `readfile`, `deletelocal`, `synclocal`

```javascript
// worker.js - Web Worker for wasm-git OPFS operations
let stdout = [];
let stderr = [];

globalThis.wasmGitModuleOverrides = {
    print:    (text) => { console.log(text);   stdout.push(text); },
    printErr: (text) => { console.error(text); stderr.push(text); },
};

const lg2mod = await import(new URL('lg2_opfs.js', import.meta.url));
const lg = await lg2mod.default();
const FS = lg.FS;

// Set up git config
try { FS.mkdir('/home'); } catch (e) {}
try { FS.mkdir('/home/web_user'); } catch (e) {}
FS.writeFile('/home/web_user/.gitconfig',
    `[user]\nname = App User\nemail = user@example.com`);

// Create OPFS backend and working directory
const backend = lg._lg2_create_opfs_backend();
const workingDir = '/opfs';
lg.ccall('lg2_create_directory', 'number',
    ['string', 'number', 'number'],
    [workingDir, 0o777, backend]);
FS.chdir(workingDir);

let currentRepoDir;

// WASMFS getcwd() workaround — create symlink at root
function createMountPointSymlink(repoName) {
    try { FS.unlink('/' + repoName); } catch (e) {}
    FS.symlink(workingDir + '/' + repoName, '/' + repoName);
}

onmessage = async (msg) => {
    stdout = []; stderr = [];
    const { command } = msg.data;

    if (command === 'clone') {
        const repoName = msg.data.url.substring(msg.data.url.lastIndexOf('/') + 1);
        currentRepoDir = workingDir + '/' + repoName;
        try {
            const opfsRoot = await navigator.storage.getDirectory();
            await opfsRoot.removeEntry(repoName, { recursive: true });
        } catch (e) {}
        lg.callMain(['clone', msg.data.url, currentRepoDir]);
        createMountPointSymlink(repoName);
        FS.chdir(currentRepoDir);
        postMessage({ dircontents: FS.readdir('.') });

    } else if (command === 'writecommitandpush') {
        FS.chdir(currentRepoDir);
        FS.writeFile(msg.data.filename, msg.data.contents);
        lg.callMain(['add', '--verbose', msg.data.filename]);
        FS.chdir(currentRepoDir);
        lg.callMain(['commit', '-m', `add ${msg.data.filename}`]);
        FS.chdir(currentRepoDir);
        lg.callMain(['push']);
        FS.chdir(currentRepoDir);
        postMessage({ dircontents: FS.readdir('.') });

    } else if (command === 'readfile') {
        postMessage({
            filename: msg.data.filename,
            filecontents: FS.readFile(msg.data.filename, { encoding: 'utf8' }),
        });
    }
};

postMessage({ ready: true });
```

### Main Thread Communication Pattern

```javascript
let worker, resolveNext;

function createWorker() {
    if (worker) worker.terminate();
    worker = new Worker(new URL('worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (msg) => resolveNext?.(msg.data);
}

const next = () => new Promise(resolve => { resolveNext = resolve; });
const send = (command, params = {}) => {
    worker.postMessage({ command, ...params });
    return next();
};

// Usage:
createWorker();
await next(); // wait for ready

await send('clone', { url: 'http://localhost:3000/myrepo.git' });
await send('writecommitandpush', { filename: 'data.json', contents: '{}' });
const result = await send('readfile', { filename: 'data.json' });
```

### Clearing OPFS (Main Thread)

Before cloning, clear stale OPFS data from the main thread:

```javascript
async function clearOPFS(repoName) {
    try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(repoName, { recursive: true });
    } catch (e) { /* directory does not exist */ }
}
```

## Data Storage Patterns

Git is the data layer for these apps. To avoid merge conflicts when multiple browsers or users access the same app, follow these patterns:

### One file per record

**Never** store all records in a single JSON file. Instead, create one file per record in a directory:

```
data/
├── entries/
│   ├── 2026-03-15T14-30-00-abc123.json
│   ├── 2026-03-15T15-00-00-def456.json
│   └── 2026-03-15T15-30-00-ghi789.json
└── (optional) index.json  ← regenerated from entries/
```

This way, two users adding records simultaneously create different files — no conflict. Use a unique identifier in the filename (timestamp + random suffix, or a UUID).

### Fetch and merge before push

wasm-git does **not** have a `pull` command. Use `fetch` + `merge` instead. Always fetch before pushing to pick up changes from other clients:

```javascript
// In the worker: fetch-merge-commit-push
function fetchMergeCommitAndPush(filename, contents, commitMsg) {
    FS.chdir(currentRepoDir);
    // Fetch latest changes from remote
    try { lg.callMain(['fetch', 'origin']); } catch (e) { /* empty repo */ }
    // Merge remote changes into local branch
    try { lg.callMain(['merge', 'origin/master']); } catch (e) { /* nothing to merge */ }
    FS.chdir(currentRepoDir);
    FS.writeFile(filename, contents);
    lg.callMain(['add', '--verbose', filename]);
    FS.chdir(currentRepoDir);
    lg.callMain(['commit', '-m', commitMsg]);
    FS.chdir(currentRepoDir);
    lg.callMain(['push']);
}
```

If push fails with "cannot push because a reference that you are trying to update on the remote contains commits that are not present locally", fetch + merge and retry:

```javascript
// Push with retry on conflict
function pushWithRetry() {
    FS.chdir(currentRepoDir);
    try {
        lg.callMain(['push']);
    } catch (e) {
        // Conflict — fetch, merge, and retry
        FS.chdir(currentRepoDir);
        lg.callMain(['fetch', 'origin']);
        FS.chdir(currentRepoDir);
        lg.callMain(['merge', 'origin/master']);
        FS.chdir(currentRepoDir);
        lg.callMain(['push']);
    }
}
```

### Reading data

To list all records, read the directory and parse each file:

```javascript
// In the worker: list all entries
const entries = FS.readdir('data/entries')
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(FS.readFile('data/entries/' + f, { encoding: 'utf8' })));
```

### Conflict resolution strategy

For the rare case where two users edit the **same** file:
- The second push will fail with: `cannot push because a reference that you are trying to update on the remote contains commits that are not present locally`
- Fetch + merge to get the other user's changes
- If there's a merge conflict, `status` will show: `conflict: a:<file> o:<file> t:<file>`
- Resolve by writing the desired content, then `add`, `commit`, and `push`
- For most apps, **last-write-wins** is acceptable — just overwrite the conflicted file and commit
- For collaborative apps, consider **branch-per-user** where each user pushes to their own branch and merges happen server-side

## Creating a New Web App

When asked to create a web app, set it up in `/workspaces/<app-name>` as its own git repo. A starter template is available at `/home/node/templates/wasm-git-opfs/` — use it as reference or copy from it.

Steps:

1. **Create the project**:
   ```bash
   mkdir -p /workspaces/my-app && cd /workspaces/my-app
   npm init -y
   npm install wasm-git @playwright/test
   ```

2. **Copy wasm-git OPFS files** into a servable location:
   ```bash
   mkdir -p public
   cp node_modules/wasm-git/lg2_opfs.js public/
   cp node_modules/wasm-git/lg2_opfs.wasm public/
   ```

3. **Create `public/worker.js`** using the Worker Setup Pattern above

4. **Create `public/index.html`** with the app UI and Main Thread Communication Pattern

5. **Create `serve.mjs`** — HTTP server with COOP/COEP headers and git proxy:
   - Serve static files from `public/` with COOP/COEP headers
   - Proxy `*.git/*` requests to the git server at `localhost:3000`
   - Add a `/ping` health check for Playwright
   - See `/home/node/templates/wasm-git-opfs/serve.mjs` for reference

6. **Initialize git repo**:
   ```bash
   git init && git add -A && git commit -m "Initial app scaffold"
   ```

7. **Write Playwright tests** and run them

Use URLs like `http://localhost:8080/myrepo.git` (proxied to git server) for clone/push from the browser. The git server auto-creates bare repos on first access.

## Service Worker for Offline Support

Every app **must** include a service worker for offline availability. Use the **network-first** strategy for app files (HTML, JS, CSS) so users always get fresh content when online, and fall back to cache when offline.

### Strategy

- **Network-first** for HTML, JS, CSS, JSON — always fetch fresh when online, prevents stale cache bugs
- **Cache-first** for wasm assets (`lg2_opfs.js`, `lg2_opfs.wasm`) — large files that are versioned by npm
- **Never cache** git protocol requests or `/ping`
- **skipWaiting + clients.claim** — new service worker activates immediately

### Service Worker (`public/sw.js`)

See `/home/node/templates/wasm-git-opfs/public/sw.js` for the reference implementation.

Key points:
- `self.skipWaiting()` in the install event
- `self.clients.claim()` in the activate event
- Clean up old caches on activate
- Network-first fetch handler with cache fallback for offline

### Registration (in `index.html`)

```javascript
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
}
```

### Service Worker Playwright Tests

You **must** test that:
1. The service worker registers and activates
2. The app loads when offline (after initial visit)
3. Updated content is served when online (no stale cache)

See `/home/node/templates/wasm-git-opfs/tests/sw.spec.js` for the test patterns. This is critical — stale cache bugs confuse users and must be caught by tests.

## Writing Playwright Tests

Every web app must have Playwright tests. Use this pattern:

```javascript
// playwright.config.js
import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: './tests',
    use: { baseURL: 'http://localhost:8080' },
    webServer: {
        command: 'node serve.mjs',
        url: 'http://localhost:8080',
        reuseExistingServer: true,
    },
});
```

```javascript
// tests/app.spec.js
import { test, expect } from '@playwright/test';

test('app loads and git operations work', async ({ page }) => {
    await page.goto('/');
    // Test your specific app functionality
    // Verify wasm-git operations complete successfully
});
```

Run tests with:
```bash
npx playwright test
```

## Key Rules

1. **Always serve with COOP/COEP headers** — without them, SharedArrayBuffer is unavailable and wasm-git will fail
2. **Git operations must run in a Web Worker** — they are synchronous and would block the main thread
3. **Clear OPFS before cloning** from the main thread to avoid stale data
4. **Use the WASMFS getcwd() symlink workaround** — create a symlink at the root for the repo name
5. **Proxy git requests** through the web app server to avoid CORS issues
6. **Write Playwright tests** for all functionality and run them after each significant change
7. **Use `FS.chdir(currentRepoDir)` before each git operation** — WASMFS can lose track of cwd
8. **Include a service worker** for offline availability — use network-first strategy to prevent stale cache
9. **Test the service worker** with Playwright — verify offline access works AND that updates are served fresh when online
10. **One file per record** — never store all data in a single file; use a directory of individual JSON files to avoid merge conflicts
11. **Fetch + merge before push** — always `fetch('origin')` + `merge('origin/master')` before pushing; wasm-git has no `pull` command
