const http = require('http');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPOS_DIR = process.env.REPOS_DIR || '/repos';
const PORT = process.env.GIT_SERVER_PORT || 3000;

function ensureRepo(repoName) {
  const repoPath = path.join(REPOS_DIR, repoName);
  if (!fs.existsSync(repoPath)) {
    fs.mkdirSync(repoPath, { recursive: true });
    execSync('git init --bare', { cwd: repoPath });
    // Enable http push
    execSync('git config http.receivepack true', { cwd: repoPath });
  }
  return repoPath;
}

const server = http.createServer((req, res) => {
  // CORS headers for browser-based wasm-git
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Parse URL: /<repo-name>.git/info/refs?service=git-upload-pack
  //            /<repo-name>.git/git-upload-pack
  //            /<repo-name>.git/git-receive-pack
  const urlMatch = req.url.match(/^\/([^/]+\.git)(\/.*)?$/);
  if (!urlMatch) {
    // List available repos
    if (req.url === '/' || req.url === '') {
      const repos = fs.existsSync(REPOS_DIR)
        ? fs.readdirSync(REPOS_DIR).filter(f => f.endsWith('.git'))
        : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ repos }));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const repoName = urlMatch[1];
  const repoPath = ensureRepo(repoName);
  const pathInfo = (urlMatch[2] || '/').split('?')[0];

  // git smart HTTP protocol
  if (pathInfo === '/info/refs') {
    const service = new URL(req.url, `http://localhost`).searchParams.get('service');
    if (!service || !['git-upload-pack', 'git-receive-pack'].includes(service)) {
      res.writeHead(400);
      res.end('Invalid service');
      return;
    }

    res.writeHead(200, {
      'Content-Type': `application/x-${service}-advertisement`,
      'Cache-Control': 'no-cache',
    });

    // Write pkt-line header
    const header = `# service=${service}\n`;
    const headerPkt = (header.length + 4).toString(16).padStart(4, '0') + header;
    res.write(headerPkt);
    res.write('0000');

    const gitProc = spawn(service, ['--stateless-rpc', '--advertise-refs', repoPath]);
    gitProc.stdout.pipe(res);
    gitProc.stderr.on('data', (data) => console.error(`${service} stderr:`, data.toString()));
    return;
  }

  if (pathInfo === '/git-upload-pack' || pathInfo === '/git-receive-pack') {
    const service = pathInfo.slice(1);
    res.writeHead(200, {
      'Content-Type': `application/x-${service}-result`,
      'Cache-Control': 'no-cache',
    });

    const gitProc = spawn(service, ['--stateless-rpc', repoPath]);
    req.pipe(gitProc.stdin);
    gitProc.stdout.pipe(res);
    gitProc.stderr.on('data', (data) => console.error(`${service} stderr:`, data.toString()));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Git HTTP server listening on port ${PORT}`);
  console.log(`Repos directory: ${REPOS_DIR}`);
});
