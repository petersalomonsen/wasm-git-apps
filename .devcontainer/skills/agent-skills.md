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
