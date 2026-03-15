/**
 * wasm-git OPFS Web Worker.
 *
 * Runs git operations synchronously inside a Worker using the OPFS
 * backend for persistent browser-side storage.
 *
 * Message API:
 *   clone              { url }                 → { dircontents }
 *   writecommitandpush { filename, contents }  → { dircontents }
 *   readfile           { filename }            → { filename, filecontents }
 *   deletelocal        {}                      → { deleted }
 *   synclocal          { url }                 → { dircontents } | { notfound }
 */

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
if (!backend) throw new Error('Failed to create OPFS backend');

const workingDir = '/opfs';
const mkdirResult = lg.ccall(
    'lg2_create_directory', 'number',
    ['string', 'number', 'number'],
    [workingDir, 0o777, backend]
);
if (mkdirResult !== 0) throw new Error('Failed to create OPFS directory: ' + mkdirResult);
FS.chdir(workingDir);

let currentRepoDir;

function rmdirRecursive(p) {
    for (const entry of FS.readdir(p).filter(e => e !== '.' && e !== '..')) {
        const full = p + '/' + entry;
        try { FS.readdir(full); rmdirRecursive(full); } catch (e) { FS.unlink(full); }
    }
    FS.rmdir(p);
}

// WASMFS getcwd() workaround
function createMountPointSymlink(repoName) {
    try { FS.unlink('/' + repoName); } catch (e) {}
    FS.symlink(workingDir + '/' + repoName, '/' + repoName);
}

function removeMountPointSymlink(repoName) {
    try { FS.unlink('/' + repoName); } catch (e) {}
}

onmessage = async (msg) => {
    stdout = []; stderr = [];
    const { command } = msg.data;

    if (command === 'clone') {
        const repoName = msg.data.url.substring(msg.data.url.lastIndexOf('/') + 1);
        currentRepoDir = workingDir + '/' + repoName;
        try { rmdirRecursive(currentRepoDir); } catch (e) {}
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
        FS.chdir(currentRepoDir);
        lg.callMain(['add', '--verbose', msg.data.filename]);
        FS.chdir(currentRepoDir);
        lg.callMain(['commit', '-m', `add ${msg.data.filename}`]);
        FS.chdir(currentRepoDir);
        lg.callMain(['push']);
        FS.chdir(currentRepoDir);
        postMessage({ dircontents: FS.readdir('.') });

    } else if (command === 'readfile') {
        try {
            postMessage({
                filename: msg.data.filename,
                filecontents: FS.readFile(msg.data.filename, { encoding: 'utf8' }),
            });
        } catch (e) {
            postMessage({ stderr: String(e) });
        }

    } else if (command === 'deletelocal') {
        const repoName = currentRepoDir ? currentRepoDir.split('/').pop() : null;
        try { FS.chdir(workingDir); if (currentRepoDir) rmdirRecursive(currentRepoDir); } catch (e) {}
        if (repoName) {
            try {
                const opfsRoot = await navigator.storage.getDirectory();
                await opfsRoot.removeEntry(repoName, { recursive: true });
            } catch (e) {}
            removeMountPointSymlink(repoName);
        }
        currentRepoDir = undefined;
        postMessage({ deleted: repoName });

    } else if (command === 'synclocal') {
        const repoName = msg.data.url.substring(msg.data.url.lastIndexOf('/') + 1);
        currentRepoDir = workingDir + '/' + repoName;
        try {
            const contents = FS.readdir(currentRepoDir);
            if (contents.find(f => f === '.git')) {
                createMountPointSymlink(repoName);
                FS.chdir(currentRepoDir);
                postMessage({ dircontents: contents });
            } else {
                postMessage({ notfound: true });
            }
        } catch (e) {
            postMessage({ notfound: true });
        }
    }
};

postMessage({ ready: true });
