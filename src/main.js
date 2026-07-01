const { app, BrowserWindow, clipboard, dialog, ipcMain, shell, powerSaveBlocker, screen } = require('electron');
const path = require('node:path');
const fsNative = require('node:fs');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const OLLAMA_URL = 'http://localhost:11434';
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.venv', 'venv']);
const MAX_TREE_DEPTH = 5;
const MAX_FILE_BYTES = 1_200_000;
const LARGE_FILE_BYTES = 80 * 1024;
const LARGE_FILE_LINES = 1200;
const RANGE_MAX_LINES = 320;
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.html', '.json', '.md', '.yml', '.yaml', '.toml', '.env', '.txt']);
const FALLBACK_MODEL_CATALOG = [
  { name: 'qwen2.5-coder', tag: 'qwen2.5-coder:0.5b', size: '0.5b', description: 'Code-specific Qwen model.' },
  { name: 'qwen2.5-coder', tag: 'qwen2.5-coder:1.5b', size: '1.5b', description: 'Code-specific Qwen model.' },
  { name: 'qwen2.5-coder', tag: 'qwen2.5-coder:3b', size: '3b', description: 'Code-specific Qwen model.' },
  { name: 'qwen2.5-coder', tag: 'qwen2.5-coder:7b', size: '7b', description: 'Code-specific Qwen model.' },
  { name: 'qwen2.5-coder', tag: 'qwen2.5-coder:14b', size: '14b', description: 'Code-specific Qwen model.' },
  { name: 'qwen2.5-coder', tag: 'qwen2.5-coder:32b', size: '32b', description: 'Code-specific Qwen model.' },
  { name: 'deepseek-coder-v2', tag: 'deepseek-coder-v2:16b', size: '16b', description: 'Code model for generation and reasoning.' },
  { name: 'codellama', tag: 'codellama:7b', size: '7b', description: 'Code generation model.' },
  { name: 'codellama', tag: 'codellama:13b', size: '13b', description: 'Code generation model.' },
  { name: 'starcoder2', tag: 'starcoder2:3b', size: '3b', description: 'Code generation model.' },
  { name: 'starcoder2', tag: 'starcoder2:7b', size: '7b', description: 'Code generation model.' },
  { name: 'llama3.2', tag: 'llama3.2:1b', size: '1b', description: 'General-purpose local model.' },
  { name: 'llama3.2', tag: 'llama3.2:3b', size: '3b', description: 'General-purpose local model.' }
];

let mainWindow;
let workspaceRoot = null;
let watcher = null;
const terminalSessions = new Map();
const activeOllamaControllers = new Map();
const pendingEdits = new Map();
const workspaceIndexState = new Map();
let browserVerificationServer = null;
let powerBlockerId = null;
let ollamaStartAttempt = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniquePathEntries(entries) {
  return [...new Set(entries.filter(Boolean))];
}

function nvmNodePaths() {
  const nvmVersions = path.join(app.getPath('home'), '.nvm', 'versions', 'node');
  try {
    return fsNative.readdirSync(nvmVersions)
      .filter((version) => fsNative.existsSync(path.join(nvmVersions, version, 'bin', 'npm')))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((version) => path.join(nvmVersions, version, 'bin'));
  } catch {
    return [];
  }
}

function commandEnv() {
  const basePath = process.env.PATH || '';
  const pathEntries = uniquePathEntries([
    ...nvmNodePaths(),
    ...basePath.split(':'),
    path.join(app.getPath('home'), '.local', 'bin'),
    path.join(app.getPath('home'), '.bun', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ]);
  return {
    ...process.env,
    PATH: pathEntries.join(':')
  };
}

function shellStartupPrefix() {
  const zshrc = path.join(app.getPath('home'), '.zshrc');
  return fsNative.existsSync(zshrc) ? 'source ~/.zshrc >/dev/null 2>&1 || true; ' : '';
}

function spawnUserCommand(command, { cwd, detached = false } = {}) {
  return spawn('/bin/zsh', ['-lc', `${shellStartupPrefix()}${command}`], {
    cwd,
    env: commandEnv(),
    detached
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function isOllamaReachable() {
  try {
    const response = await fetchWithTimeout(`${OLLAMA_URL}/api/tags`, {}, 2000);
    return response.ok;
  } catch {
    return false;
  }
}

async function startOllama() {
  if (ollamaStartAttempt) return ollamaStartAttempt;
  ollamaStartAttempt = (async () => {
    if (await isOllamaReachable()) return true;

    if (process.platform === 'darwin') {
      spawn('open', ['-ga', 'Ollama'], { detached: true, stdio: 'ignore' }).unref();
    }

    const serve = spawnUserCommand('command -v ollama >/dev/null 2>&1 && ollama serve', {
      cwd: app.getPath('home'),
      detached: true
    });
    serve.stdout?.resume();
    serve.stderr?.resume();
    serve.unref();

    for (let i = 0; i < 20; i += 1) {
      await sleep(500);
      if (await isOllamaReachable()) return true;
    }
    return false;
  })();

  try {
    return await ollamaStartAttempt;
  } finally {
    ollamaStartAttempt = null;
  }
}

async function ensureOllamaReady() {
  if (await isOllamaReachable()) return;
  const started = await startOllama();
  if (started) return;
  throw new Error(`Ollama is offline. Anton tried to start it but could not reach ${OLLAMA_URL}. Open Ollama or run "ollama serve", then retry.`);
}

async function listLocalOllamaModelNames({ startIfNeeded = false } = {}) {
  try {
    if (startIfNeeded) {
      await ensureOllamaReady();
    } else if (!(await isOllamaReachable())) {
      return [];
    }
    const response = await fetchWithTimeout(`${OLLAMA_URL}/api/tags`, {}, 3500);
    if (!response.ok) return [];
    const data = await response.json();
    return (data.models || [])
      .map((model) => model.name)
      .filter((name) => typeof name === 'string' && name.trim());
  } catch {
    return [];
  }
}

function createWindow() {
  const { width: workAreaWidth, height: workAreaHeight } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1440, workAreaWidth),
    height: Math.min(900, workAreaHeight),
    minWidth: Math.min(1080, workAreaWidth),
    minHeight: Math.min(640, workAreaHeight),
    title: 'Anton',
    icon: path.join(__dirname, '..', 'build', 'icon.icns'),
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  watcher?.close();
  for (const session of terminalSessions.values()) {
    session.process?.kill();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function send(channel, payload) {
  if (!mainWindow?.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function isIgnored(name) {
  return name.startsWith('.') && name !== '.env' ? true : IGNORE_DIRS.has(name);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function buildTree(dirPath, depth = 0) {
  if (depth > MAX_TREE_DEPTH) return [];

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const visible = entries
    .filter((entry) => !isIgnored(entry.name))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

  const nodes = [];
  for (const entry of visible.slice(0, 240)) {
    const fullPath = path.join(dirPath, entry.name);
    const node = {
      name: entry.name,
      path: fullPath,
      type: entry.isDirectory() ? 'directory' : 'file'
    };
    if (entry.isDirectory()) node.children = await buildTree(fullPath, depth + 1);
    nodes.push(node);
  }
  return nodes;
}

function watchWorkspace(root) {
  watcher?.close();
  watcher = fsNative.watch(root, { recursive: true }, (event, filePath) => {
    if (!filePath || filePath.split(path.sep).some((part) => IGNORE_DIRS.has(part))) return;
    send('workspace:changed', { event, filePath: path.join(root, filePath) });
  });
}

async function openWorkspace(folderPath) {
  const previousDefault = workspaceRoot || app.getPath('home');
  if (browserVerificationServer?.process && !browserVerificationServer.process.killed && folderPath !== workspaceRoot) {
    browserVerificationServer.process.kill();
    browserVerificationServer = null;
  }
  workspaceRoot = folderPath;
  for (const session of terminalSessions.values()) {
    if (!session.process && (!session.cwd || session.cwd === previousDefault || session.cwd === app.getPath('home'))) {
      session.cwd = folderPath;
      send('terminal:cwd', { terminalId: session.id, cwd: session.cwd });
      send('terminal:data', { terminalId: session.id, text: `[workspace root: ${folderPath}]\n` });
    }
  }
  watchWorkspace(folderPath);
  rebuildWorkspaceIndex().catch((error) => {
    workspaceIndexState.set(workspaceRoot, {
      status: 'error',
      fileCount: 0,
      updatedAt: new Date().toISOString(),
      error: error.message,
      dbPath: indexDbPath()
    });
  });
  return {
    root: folderPath,
    name: path.basename(folderPath),
    tree: await buildTree(folderPath)
  };
}

function chatFileForWorkspace(root = workspaceRoot) {
  if (!root) return null;
  const id = crypto.createHash('sha256').update(root).digest('hex');
  return path.join(app.getPath('userData'), 'workspace-chats', `${id}.json`);
}

function stripHtml(value = '') {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseOllamaCatalog(html) {
  const entries = [];
  const seen = new Set();
  const blocks = html.match(/<li x-test-model[\s\S]*?<\/li>/g) || [];
  for (const block of blocks) {
    const title = block.match(/x-test-model-title title="([^"]+)"/)?.[1];
    if (!title) continue;
    const description = stripHtml(block.match(/<p class="max-w-lg[\s\S]*?<\/p>/)?.[0] || '');
    const sizes = [...block.matchAll(/x-test-size[\s\S]*?>([^<]+)<\/span>/g)]
      .map((match) => stripHtml(match[1]).toLowerCase())
      .filter(Boolean);
    const uniqueSizes = [...new Set(sizes)];
    if (!uniqueSizes.length) uniqueSizes.push('latest');
    for (const size of uniqueSizes) {
      const tag = size === 'latest' ? `${title}:latest` : `${title}:${size}`;
      if (seen.has(tag)) continue;
      seen.add(tag);
      entries.push({ name: title, tag, size, description });
    }
  }
  return entries;
}

async function loadWorkspaceChat(root = workspaceRoot) {
  const chatFile = chatFileForWorkspace(root);
  if (!chatFile) return [];
  try {
    const raw = await fs.readFile(chatFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.messages) ? parsed.messages : [];
  } catch {
    return [];
  }
}

async function saveWorkspaceChat(messages, root = workspaceRoot) {
  const chatFile = chatFileForWorkspace(root);
  if (!chatFile) return false;
  await fs.mkdir(path.dirname(chatFile), { recursive: true });
  const payload = {
    workspaceRoot: root,
    savedAt: new Date().toISOString(),
    messages: Array.isArray(messages) ? messages.slice(-200) : []
  };
  await fs.writeFile(chatFile, JSON.stringify(payload, null, 2), 'utf8');
  return true;
}

function runCommand(command, args, cwd = workspaceRoot || app.getPath('home')) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: commandEnv(), shell: false });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: error.message }));
  });
}

function cleanGitError(resultOrError) {
  const message = typeof resultOrError === 'string'
    ? resultOrError
    : `${resultOrError?.stderr || ''}\n${resultOrError?.stdout || ''}`.trim();
  if (!message) return 'Git command failed.';
  if (/not a git repository/i.test(message)) return 'This workspace is not a Git repository.';
  if (/could not read Username|authentication failed|permission denied|repository not found/i.test(message)) {
    return 'Git remote authentication failed. Check your credentials and remote access.';
  }
  if (/not found|ENOENT/i.test(message)) return 'Git is not installed or is not available on PATH.';
  if (/unmerged|conflict|MERGE_HEAD/i.test(message)) return 'Git operation is blocked by merge conflicts. Resolve conflicts first.';
  return message.split('\n').filter(Boolean).slice(-4).join('\n');
}

function normalizeRepoRoot(repoRoot) {
  if (!workspaceRoot) throw new Error('Open a workspace before using Source Control.');
  const root = path.resolve(workspaceRoot);
  const candidate = repoRoot ? path.resolve(String(repoRoot)) : root;
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error('Git repository is outside the workspace.');
  }
  return candidate;
}

function repoRootFromPayload(payload = {}) {
  if (typeof payload === 'object' && payload?.repoRoot) return normalizeRepoRoot(payload.repoRoot);
  return normalizeRepoRoot();
}

async function runGit(args, { allowFailure = false, cwd = null } = {}) {
  const gitCwd = normalizeRepoRoot(cwd);
  const result = await runCommand('git', args, gitCwd);
  if (result.code !== 0 && !allowFailure) throw new Error(cleanGitError(result));
  return result;
}

async function isGitRepo(repoRoot = workspaceRoot) {
  if (!workspaceRoot || !repoRoot) return false;
  const result = await runCommand('git', ['rev-parse', '--is-inside-work-tree'], repoRoot);
  return result.code === 0 && result.stdout.trim() === 'true';
}

async function assertGitRepo(repoRoot = workspaceRoot) {
  const gitCwd = normalizeRepoRoot(repoRoot);
  if (!(await isGitRepo(gitCwd))) throw new Error('This workspace is not a Git repository.');
  return gitCwd;
}

async function findGitRepositories(root = workspaceRoot, depth = 0) {
  if (!root || depth > 3) return [];
  const repos = [];
  if (await pathExists(path.join(root, '.git'))) {
    repos.push({
      name: path.basename(root),
      path: root,
      relativePath: root === workspaceRoot ? '.' : path.relative(workspaceRoot, root)
    });
    return repos;
  }
  let entries = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return repos;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || isIgnored(entry.name)) continue;
    const child = path.join(root, entry.name);
    repos.push(...await findGitRepositories(child, depth + 1));
  }
  return repos;
}

function normalizeGitPath(filePath) {
  const value = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!value || value.includes('\0') || value.split('/').includes('..')) {
    throw new Error('Invalid Git path.');
  }
  return value;
}

function resolveWorkspacePath(relativeFilePath, repoRoot = workspaceRoot) {
  const normalized = normalizeGitPath(relativeFilePath);
  const root = normalizeRepoRoot(repoRoot);
  const absolutePath = path.resolve(root, normalized);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error('Path is outside the workspace.');
  }
  return absolutePath;
}

function parseBranchLine(line) {
  const raw = line.replace(/^##\s*/, '').trim();
  const [left, tracking = ''] = raw.split(' [');
  const [branchPart, upstream] = left.split('...');
  const meta = tracking.replace(/\]$/, '');
  const ahead = Number((meta.match(/ahead\s+(\d+)/) || [])[1] || 0);
  const behind = Number((meta.match(/behind\s+(\d+)/) || [])[1] || 0);
  return {
    branch: branchPart || 'detached',
    upstream: upstream || '',
    ahead,
    behind
  };
}

function parseStatusLine(line) {
  const x = line[0] || ' ';
  const y = line[1] || ' ';
  let rawPath = line.slice(3);
  let oldPath = null;
  if (rawPath.includes(' -> ')) {
    const parts = rawPath.split(' -> ');
    oldPath = parts[0];
    rawPath = parts.slice(1).join(' -> ');
  }
  const conflictPairs = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
  const conflicted = conflictPairs.has(`${x}${y}`) || x === 'U' || y === 'U';
  const untracked = x === '?' && y === '?';
  return {
    path: rawPath,
    oldPath,
    indexStatus: x,
    worktreeStatus: y,
    status: untracked ? '?' : conflicted ? 'U' : (x.trim() || y.trim()),
    untracked,
    conflicted
  };
}

function splitGitChanges(lines) {
  const staged = [];
  const unstaged = [];
  const untracked = [];
  const conflicts = [];

  for (const line of lines) {
    if (!line || line.startsWith('##')) continue;
    const change = parseStatusLine(line);
    if (change.conflicted) {
      conflicts.push(change);
      continue;
    }
    if (change.untracked) {
      untracked.push(change);
      unstaged.push(change);
      continue;
    }
    if (change.indexStatus.trim()) staged.push({ ...change, status: change.indexStatus });
    if (change.worktreeStatus.trim()) unstaged.push({ ...change, status: change.worktreeStatus });
  }

  return { staged, unstaged, untracked, conflicts };
}

async function gitShow(refAndPath, repoRoot = workspaceRoot) {
  const result = await runGit(['show', refAndPath], { allowFailure: true, cwd: repoRoot });
  return result.code === 0 ? result.stdout : '';
}

async function readWorkspaceText(relativeFilePath, repoRoot = workspaceRoot) {
  try {
    return await fs.readFile(resolveWorkspacePath(relativeFilePath, repoRoot), 'utf8');
  } catch {
    return '';
  }
}

function workspaceRelativePath(filePath) {
  if (!workspaceRoot || !filePath) return filePath;
  return path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
}

function safeWorkspaceFilePath(relativeFilePath) {
  if (!workspaceRoot) throw new Error('Open a workspace first.');
  const normalized = String(relativeFilePath || '').replace(/^[/\\]+/, '').replace(/\\/g, '/');
  if (!normalized || normalized.includes('\0') || normalized.split('/').includes('..')) {
    throw new Error('Invalid workspace path.');
  }
  const absolutePath = path.resolve(workspaceRoot, normalized);
  const root = path.resolve(workspaceRoot);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error('Path is outside the workspace.');
  }
  return absolutePath;
}

function indexDbPath(root = workspaceRoot) {
  if (!root) return null;
  const id = crypto.createHash('sha256').update(root).digest('hex');
  return path.join(app.getPath('userData'), 'workspace-indexes', `${id}.sqlite`);
}

function snapshotsDir(root = workspaceRoot) {
  const id = crypto.createHash('sha256').update(root || 'no-workspace').digest('hex');
  return path.join(app.getPath('userData'), 'snapshots', id);
}

function isIndexableRelativePath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  if (!normalized || normalized.includes('\0')) return false;
  if (/(^|\/)(\.git|node_modules|dist|build|\.next|coverage|\.venv|venv)\//.test(normalized)) return false;
  if (/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(normalized)) return false;
  return /\.(js|jsx|ts|tsx|css|scss|html|json|md|yml|yaml|toml|env|txt|vue|svelte|py|go|rs|java|c|cpp|h|hpp)$/i.test(normalized);
}

async function listIndexableFiles(root = workspaceRoot, dir = root, acc = []) {
  if (!root || !dir) return acc;
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (isIgnored(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relative = path.relative(root, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (/(^|\/)(node_modules|dist|build|\.next|coverage|\.git)\b/.test(relative)) continue;
      await listIndexableFiles(root, fullPath, acc);
      continue;
    }
    if (!isIndexableRelativePath(relative)) continue;
    try {
      const stats = await fileStats(fullPath);
      if (stats.binary || stats.size > MAX_FILE_BYTES || stats.lineCount > 4000) continue;
      acc.push({ fullPath, relative, stats });
    } catch {
      // Skip unreadable files.
    }
  }
  return acc;
}

function runSqlite(dbPath, sql) {
  return new Promise((resolve) => {
    const child = spawn('sqlite3', [dbPath], { env: commandEnv(), shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: error.message }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(sql);
  });
}

function sqlString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

async function rebuildWorkspaceIndex() {
  if (!workspaceRoot) throw new Error('Open a workspace before indexing.');
  const dbPath = indexDbPath();
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const files = await listIndexableFiles(workspaceRoot);
  const startedAt = Date.now();
  workspaceIndexState.set(workspaceRoot, { status: 'indexing', fileCount: 0, updatedAt: new Date().toISOString(), dbPath });
  const statements = [
    'PRAGMA journal_mode=WAL;',
    'DROP TABLE IF EXISTS files;',
    'DROP TABLE IF EXISTS file_index;',
    'CREATE TABLE files(path TEXT PRIMARY KEY, size INTEGER, line_count INTEGER, updated_at TEXT);',
    "CREATE VIRTUAL TABLE file_index USING fts5(path, content, tokenize='porter unicode61');",
    'BEGIN;'
  ];
  for (const file of files) {
    let content = '';
    try {
      content = await fs.readFile(file.fullPath, 'utf8');
    } catch {
      continue;
    }
    statements.push(`INSERT OR REPLACE INTO files(path,size,line_count,updated_at) VALUES(${sqlString(file.relative)},${Number(file.stats.size) || 0},${Number(file.stats.lineCount) || 0},${sqlString(new Date().toISOString())});`);
    statements.push(`INSERT INTO file_index(path,content) VALUES(${sqlString(file.relative)},${sqlString(content.slice(0, 200000))});`);
  }
  statements.push('COMMIT;');
  const result = await runSqlite(dbPath, statements.join('\n'));
  if (result.code !== 0) {
    workspaceIndexState.set(workspaceRoot, { status: 'error', fileCount: 0, updatedAt: new Date().toISOString(), error: result.stderr || result.stdout, dbPath });
    throw new Error(result.stderr || 'Could not build SQLite index.');
  }
  const state = {
    status: 'ready',
    fileCount: files.length,
    updatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    dbPath
  };
  workspaceIndexState.set(workspaceRoot, state);
  return state;
}

async function searchWorkspaceIndex(query, limit = 30) {
  if (!workspaceRoot || !query?.trim()) return [];
  const dbPath = indexDbPath();
  if (!(await pathExists(dbPath))) return [];
  const safeLimit = Math.max(1, Math.min(80, Number(limit) || 30));
  const sql = [
    '.mode json',
    `SELECT path, snippet(file_index, 1, '[', ']', ' ... ', 12) AS snippet`,
    `FROM file_index WHERE file_index MATCH ${sqlString(query)}`,
    `LIMIT ${safeLimit};`
  ].join('\n');
  const result = await runSqlite(dbPath, sql);
  if (result.code !== 0) return [];
  try {
    return JSON.parse(result.stdout || '[]');
  } catch {
    return [];
  }
}

function classifyCommand(command = '') {
  const text = String(command || '').trim();
  const lower = text.toLowerCase();
  if (!text) return { classification: 'blocked', reason: 'Empty command.' };
  if (/(^|\s)(rm\s+-rf|git\s+reset\s+--hard|sudo\b|chmod\s+-r|chown\s+-r)\b/i.test(text)) {
    return { classification: 'blocked', reason: 'Destructive command blocked by Anton policy.' };
  }
  if (/(curl|wget).*(token|secret|password|authorization)|(\.env|id_rsa).*(curl|wget|scp|nc)/i.test(text)) {
    return { classification: 'blocked', reason: 'Command resembles credential exfiltration.' };
  }
  if (/[>|;&]|\|\||&&/.test(text) || /\b(npm\s+install|pnpm\s+install|yarn\s+add|git\s+(push|pull|checkout|commit|reset|clean|stash)|kill|pkill|rm|mv|cp|scp|curl|wget)\b/i.test(lower)) {
    return { classification: 'needs_approval', reason: 'Command can mutate files, access network, or chain shell operations.' };
  }
  if (/^(pwd|ls|find|rg|grep|cat|sed -n|git status|git diff|npm run (test|check|typecheck|lint|build)|npm test|node --check)\b/i.test(text)) {
    return { classification: 'safe', reason: 'Read-only or project verification command.' };
  }
  return { classification: 'needs_approval', reason: 'Unknown command requires approval.' };
}

async function detectVerificationPlan() {
  if (!workspaceRoot) throw new Error('Open a workspace first.');
  const packagePath = path.join(workspaceRoot, 'package.json');
  const scripts = {};
  let projectType = 'generic';
  try {
    const parsed = JSON.parse(await fs.readFile(packagePath, 'utf8'));
    Object.assign(scripts, parsed.scripts || {});
    const deps = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
    if (deps.vite || await pathExists(path.join(workspaceRoot, 'vite.config.ts')) || await pathExists(path.join(workspaceRoot, 'vite.config.js'))) projectType = 'vite';
    else if (deps.next || await pathExists(path.join(workspaceRoot, 'next.config.js')) || await pathExists(path.join(workspaceRoot, 'next.config.mjs'))) projectType = 'next';
    else if (deps.react) projectType = 'react';
  } catch {
    // Non-node project.
  }
  const sequence = [];
  for (const name of ['typecheck', 'lint', 'test', 'check', 'build']) {
    if (typeof scripts[name] === 'string' && scripts[name].trim()) {
      sequence.push(name === 'test' ? 'npm test' : `npm run ${name}`);
    }
  }
  if (!sequence.length && scripts.build) sequence.push('npm run build');
  return {
    projectType,
    scripts,
    commands: [...new Set(sequence)],
    browserCapable: ['vite', 'next', 'react'].includes(projectType)
  };
}

function verificationHasSeriousWarning(output = '') {
  return /\b(error|failed|syntax-error|parse error|unterminated|string token|expected identifier|cannot find module|module not found|ts\d{4}|type error)\b/i.test(output);
}

function validatePendingSourceContent(relativePath, content) {
  const text = String(content || '');
  if (/"editedCode"\s*:/.test(text) || /^\s*```/m.test(text)) {
    throw new Error(`Refusing pending edit for ${relativePath}: source contains model wrapper artifacts.`);
  }
  if (/\.jsonc?$/i.test(relativePath)) {
    JSON.parse(text);
  }
  if (/\.css$/i.test(relativePath)) {
    const quoteCount = (text.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      throw new Error(`Refusing pending edit for ${relativePath}: unterminated string token.`);
    }
  }
}

async function runVerificationPlan() {
  const plan = await detectVerificationPlan();
  const results = [];
  for (const command of plan.commands) {
    const result = await new Promise((resolve) => {
      const child = spawnUserCommand(command, { cwd: workspaceRoot });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('close', (code) => {
        const output = `${stdout}\n${stderr}`.trim();
        resolve({ command, code, stdout, stderr, seriousWarnings: verificationHasSeriousWarning(output) });
      });
      child.on('error', (error) => resolve({ command, code: 1, stdout, stderr: error.message, seriousWarnings: true }));
    });
    results.push(result);
    if (result.code !== 0 || result.seriousWarnings) break;
  }
  return {
    ...plan,
    results,
    ok: results.length > 0 && results.every((result) => result.code === 0 && !result.seriousWarnings)
  };
}

function findDevServerUrlFromText(text = '') {
  const match = String(text).match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+[^\s"'<>)]*/i) ||
    String(text).match(/\b(?:localhost|127\.0\.0\.1):\d+[^\s"'<>)]*/i);
  if (!match) return '';
  return match[0].startsWith('http') ? match[0] : `http://${match[0]}`;
}

async function ensureBrowserVerificationServer(timeoutMs = 12000) {
  if (browserVerificationServer?.process && !browserVerificationServer.process.killed) {
    return browserVerificationServer.url || findDevServerUrlFromText(browserVerificationServer.output || '');
  }
  const plan = await detectVerificationPlan();
  if (!plan.scripts?.dev) return '';

  return new Promise((resolve) => {
    const child = spawnUserCommand('npm run dev', { cwd: workspaceRoot });
    const server = {
      process: child,
      url: '',
      output: '',
      startedAt: new Date().toISOString()
    };
    browserVerificationServer = server;
    let settled = false;
    const finish = (url = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.url = url;
      resolve(url);
    };
    const handleChunk = (chunk) => {
      server.output += chunk.toString();
      const url = findDevServerUrlFromText(server.output);
      if (url) finish(url);
    };
    const timer = setTimeout(() => finish(server.url || findDevServerUrlFromText(server.output)), timeoutMs);
    child.stdout.on('data', handleChunk);
    child.stderr.on('data', handleChunk);
    child.on('close', () => {
      if (browserVerificationServer === server) browserVerificationServer = null;
      finish(server.url || findDevServerUrlFromText(server.output));
    });
    child.on('error', () => {
      if (browserVerificationServer === server) browserVerificationServer = null;
      finish('');
    });
  });
}

async function verifyBrowser({ url, timeoutMs = 8000 } = {}) {
  const detectedUrl = url || await ensureBrowserVerificationServer(Math.max(timeoutMs, 12000));
  const targetUrl = detectedUrl || 'http://127.0.0.1:5173';
  const result = { url: targetUrl, ok: false, errors: [], warnings: [], screenshotPath: '' };
  try {
    const playwright = require('playwright');
    const browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') result.errors.push(message.text());
      if (message.type() === 'warning') result.warnings.push(message.text());
    });
    page.on('pageerror', (error) => result.errors.push(error.message));
    const response = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: timeoutMs });
    const shotDir = path.join(app.getPath('userData'), 'browser-verification');
    await fs.mkdir(shotDir, { recursive: true });
    result.screenshotPath = path.join(shotDir, `${Date.now()}.png`);
    await page.screenshot({ path: result.screenshotPath, fullPage: true });
    result.status = response?.status?.() || 0;
    result.ok = Boolean(response && response.ok()) && !result.errors.length;
    await browser.close();
    return result;
  } catch (error) {
    try {
      const response = await fetchWithTimeout(targetUrl, {}, timeoutMs);
      result.status = response.status;
      result.ok = response.ok;
      if (!response.ok) result.errors.push(`HTTP ${response.status}`);
    } catch (fallbackError) {
      result.errors.push(error.message || String(error));
      result.errors.push(`HTTP fallback failed: ${fallbackError.message}`);
    }
    return result;
  }
}

function getTerminalSession(id = 'terminal-1') {
  if (!terminalSessions.has(id)) {
    terminalSessions.set(id, {
      id,
      cwd: workspaceRoot || app.getPath('home'),
      process: null
    });
  }
  return terminalSessions.get(id);
}

function currentTerminalCwd(id) {
  return getTerminalSession(id).cwd;
}

async function resolveTerminalPath(inputPath, terminalId) {
  if (!inputPath || inputPath === '~') return app.getPath('home');
  if (inputPath.startsWith('~/')) return path.join(app.getPath('home'), inputPath.slice(2));
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(currentTerminalCwd(terminalId), inputPath);
}

async function handleTerminalBuiltin(command, terminalId) {
  const session = getTerminalSession(terminalId);
  const trimmed = command.trim();
  const [name, ...parts] = trimmed.split(/\s+/);
  const lower = name.toLowerCase();

  if (lower === 'clear' || lower === 'cls') {
    send('terminal:clear', { terminalId });
    return true;
  }

  if (lower === 'pwd') {
    send('terminal:data', { terminalId, text: `${session.cwd}\n` });
    return true;
  }

  if (lower === 'exit') {
    send('terminal:data', { terminalId, text: '[terminal session cleared]\n' });
    session.cwd = workspaceRoot || app.getPath('home');
    send('terminal:cwd', { terminalId, cwd: session.cwd });
    return true;
  }

  if (lower === 'cd') {
    const target = await resolveTerminalPath(parts.join(' ') || '~', terminalId);
    try {
      const stat = await fs.stat(target);
      if (!stat.isDirectory()) {
        send('terminal:data', { terminalId, text: `cd: not a directory: ${target}\n` });
        return true;
      }
      session.cwd = target;
      send('terminal:data', { terminalId, text: `${session.cwd}\n` });
      send('terminal:cwd', { terminalId, cwd: session.cwd });
    } catch {
      send('terminal:data', { terminalId, text: `cd: no such file or directory: ${target}\n` });
    }
    return true;
  }

  return false;
}

ipcMain.handle('workspace:open', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return openWorkspace(result.filePaths[0]);
});

ipcMain.handle('workspace:refresh', async () => {
  if (!workspaceRoot) return null;
  return openWorkspace(workspaceRoot);
});

ipcMain.handle('chat:load', async (_event, workspacePath) => loadWorkspaceChat(workspacePath || workspaceRoot));

ipcMain.handle('chat:save', async (_event, { workspacePath, messages }) => saveWorkspaceChat(messages, workspacePath || workspaceRoot));

ipcMain.handle('chat:list', async () => {
  const dir = path.join(app.getPath('userData'), 'workspace-chats');
  try {
    const files = await fs.readdir(dir);
    const sessions = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(dir, file), 'utf8');
        const parsed = JSON.parse(raw);
        const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
        sessions.push({
          id: file.replace('.json', ''),
          workspaceRoot: parsed.workspaceRoot || 'Unknown',
          savedAt: parsed.savedAt || null,
          messageCount: messages.length,
          preview: messages.find((message) => message.role === 'user')?.text?.slice(0, 80) || ''
        });
      } catch {
        // Skip malformed history files.
      }
    }
    return sessions.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  } catch {
    return [];
  }
});

ipcMain.handle('chat:loadById', async (_event, id) => {
  const chatFile = path.join(app.getPath('userData'), 'workspace-chats', `${id}.json`);
  try {
    const raw = await fs.readFile(chatFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.messages) ? parsed.messages : [];
  } catch {
    return [];
  }
});

ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    defaultPath: workspaceRoot || undefined,
    filters: [
      { name: 'Code', extensions: ['js', 'ts', 'jsx', 'tsx', 'py', 'html', 'css', 'json', 'md', 'txt', 'go', 'rs', 'java', 'c', 'cpp', 'sh', 'yml', 'yaml'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePaths[0]) return null;
  return readFile(result.filePaths[0]);
});

async function readFile(filePath) {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_FILE_BYTES) throw new Error('File is too large to open in Anton.');
  const content = await fs.readFile(filePath, 'utf8');
  return { filePath, name: path.basename(filePath), content, modifiedAt: stat.mtimeMs };
}

function assertTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SOURCE_EXTENSIONS.has(ext)) throw new Error(`Range tools only support source-like text files. Unsupported extension: ${ext || '(none)'}`);
}

function splitTextLines(content) {
  return content.split(/\r?\n/);
}

async function readTextFileForRange(filePath) {
  assertTextFile(filePath);
  const buffer = await fs.readFile(filePath);
  if (buffer.includes(0)) throw new Error('Binary files are not supported by Anton range tools.');
  return buffer.toString('utf8');
}

async function fileStats(filePath) {
  const stat = await fs.stat(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const sourceLike = SOURCE_EXTENSIONS.has(ext);
  let lineCount = 0;
  let binary = false;
  if (sourceLike) {
    try {
      const buffer = await fs.readFile(filePath);
      binary = buffer.includes(0);
      if (!binary) lineCount = buffer.toString('utf8').split(/\r?\n/).length;
    } catch {
      lineCount = 0;
    }
  }
  return {
    filePath,
    name: path.basename(filePath),
    size: stat.size,
    lineCount,
    sourceLike,
    binary,
    isLarge: stat.size > LARGE_FILE_BYTES || lineCount > LARGE_FILE_LINES,
    thresholds: { bytes: LARGE_FILE_BYTES, lines: LARGE_FILE_LINES },
    modifiedAt: stat.mtimeMs
  };
}

function normalizeLineRange(startLine, endLine, lineCount) {
  const start = Math.max(1, Number(startLine) || 1);
  const requestedEnd = Number(endLine) || start;
  const cappedEnd = Math.min(Math.max(start, requestedEnd), start + RANGE_MAX_LINES - 1);
  return {
    startLine: Math.min(start, Math.max(1, lineCount)),
    endLine: Math.min(cappedEnd, Math.max(1, lineCount))
  };
}

async function readFileRange({ filePath, startLine = 1, endLine = startLine + 80 }) {
  const content = await readTextFileForRange(filePath);
  const lines = splitTextLines(content);
  const range = normalizeLineRange(startLine, endLine, lines.length);
  return {
    filePath,
    lineCount: lines.length,
    startLine: range.startLine,
    endLine: range.endLine,
    content: lines.slice(range.startLine - 1, range.endLine).join('\n')
  };
}

async function searchFile({ filePath, query, context = 2, maxMatches = 40 }) {
  if (!query || typeof query !== 'string') throw new Error('Search query is required.');
  const content = await readTextFileForRange(filePath);
  const lines = splitTextLines(content);
  const needle = query.toLowerCase();
  const seen = new Set();
  const matches = [];
  const safeContext = Math.max(0, Math.min(12, Number(context) || 0));
  for (let index = 0; index < lines.length && matches.length < maxMatches; index += 1) {
    if (!lines[index].toLowerCase().includes(needle)) continue;
    const startLine = Math.max(1, index + 1 - safeContext);
    const endLine = Math.min(lines.length, index + 1 + safeContext);
    const key = `${startLine}:${endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({
      line: index + 1,
      startLine,
      endLine,
      preview: lines.slice(startLine - 1, endLine).join('\n')
    });
  }
  return { filePath, query, lineCount: lines.length, matches };
}

async function outlineFile(filePath) {
  const content = await readTextFileForRange(filePath);
  const lines = splitTextLines(content);
  const ext = path.extname(filePath).toLowerCase();
  const symbols = [];
  const push = (line, kind, name, text) => {
    if (symbols.length < 160) symbols.push({ line, kind, name: name || text.trim().slice(0, 80), text: text.trim().slice(0, 160) });
  };
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    let match = trimmed.match(/^import\s+(.+?)\s+from\s+['"]([^'"]+)['"]/);
    if (match) return push(lineNo, 'import', match[2], trimmed);
    match = trimmed.match(/^(export\s+)?(async\s+)?function\s+([A-Za-z0-9_$]+)/);
    if (match) return push(lineNo, 'function', match[3], trimmed);
    match = trimmed.match(/^(export\s+)?class\s+([A-Za-z0-9_$]+)/);
    if (match) return push(lineNo, 'class', match[2], trimmed);
    match = trimmed.match(/^(export\s+)?(const|let|var)\s+([A-Z][A-Za-z0-9_$]*)\s*=\s*(\(|function|async|\w+\s*=>|React\.)/);
    if (match) return push(lineNo, 'component', match[3], trimmed);
    match = trimmed.match(/^(export\s+)?(const|let|var)\s+([A-Za-z0-9_$]+)/);
    if (match) return push(lineNo, 'variable', match[3], trimmed);
    if (ext === '.css' || ext === '.scss') {
      match = trimmed.match(/^([^@{}][^{};]{0,120})\s*\{/);
      if (match) return push(lineNo, 'selector', match[1].trim(), trimmed);
      match = trimmed.match(/^@(media|keyframes|supports)\b(.+)?\{/);
      if (match) return push(lineNo, `@${match[1]}`, match[0], trimmed);
    }
    if (ext === '.html') {
      match = trimmed.match(/^<(main|section|header|footer|nav|div|form|article)\b([^>]*)>/i);
      if (match) return push(lineNo, 'element', match[1].toLowerCase(), trimmed);
    }
  });
  return { filePath, lineCount: lines.length, symbols };
}

async function writeTextLines(filePath, lines, hadFinalNewline) {
  const content = lines.join('\n') + (hadFinalNewline ? '\n' : '');
  await fs.writeFile(filePath, content, 'utf8');
  return fileStats(filePath);
}

async function replaceRange({ filePath, startLine, endLine, content }) {
  if (typeof content !== 'string') throw new Error('Replacement content must be a string.');
  const original = await readTextFileForRange(filePath);
  const hadFinalNewline = /\r?\n$/.test(original);
  const lines = splitTextLines(original);
  if (hadFinalNewline && lines[lines.length - 1] === '') lines.pop();
  const range = normalizeLineRange(startLine, endLine, lines.length);
  const nextLines = content.split(/\r?\n/);
  if (nextLines[nextLines.length - 1] === '') nextLines.pop();
  lines.splice(range.startLine - 1, range.endLine - range.startLine + 1, ...nextLines);
  const stats = await writeTextLines(filePath, lines, hadFinalNewline);
  return { ...stats, changedRange: { startLine: range.startLine, endLine: range.startLine + nextLines.length - 1 } };
}

async function insertAtLine({ filePath, line, content }) {
  if (typeof content !== 'string') throw new Error('Inserted content must be a string.');
  const original = await readTextFileForRange(filePath);
  const hadFinalNewline = /\r?\n$/.test(original);
  const lines = splitTextLines(original);
  if (hadFinalNewline && lines[lines.length - 1] === '') lines.pop();
  const insertAt = Math.max(1, Math.min(Number(line) || lines.length + 1, lines.length + 1));
  const nextLines = content.split(/\r?\n/);
  if (nextLines[nextLines.length - 1] === '') nextLines.pop();
  lines.splice(insertAt - 1, 0, ...nextLines);
  const stats = await writeTextLines(filePath, lines, hadFinalNewline);
  return { ...stats, changedRange: { startLine: insertAt, endLine: insertAt + nextLines.length - 1 } };
}

async function deleteRange({ filePath, startLine, endLine }) {
  const original = await readTextFileForRange(filePath);
  const hadFinalNewline = /\r?\n$/.test(original);
  const lines = splitTextLines(original);
  if (hadFinalNewline && lines[lines.length - 1] === '') lines.pop();
  const range = normalizeLineRange(startLine, endLine, lines.length);
  lines.splice(range.startLine - 1, range.endLine - range.startLine + 1);
  const stats = await writeTextLines(filePath, lines, hadFinalNewline);
  return { ...stats, changedRange: { startLine: range.startLine, endLine: range.startLine } };
}

async function copyRecursive(source, target) {
  const stat = await fs.stat(source);
  if (stat.isDirectory()) {
    await fs.mkdir(target, { recursive: true });
    const entries = await fs.readdir(source);
    for (const entry of entries) {
      await copyRecursive(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  await fs.copyFile(source, target);
}

async function nextCopyPath(filePath) {
  const parsed = path.parse(filePath);
  let suffix = ' copy';
  let candidate = path.join(parsed.dir, `${parsed.name}${suffix}${parsed.ext}`);
  let index = 2;
  while (await pathExists(candidate)) {
    suffix = ` copy ${index}`;
    candidate = path.join(parsed.dir, `${parsed.name}${suffix}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

ipcMain.handle('file:read', async (_event, filePath) => readFile(filePath));

ipcMain.handle('file:stats', async (_event, filePath) => fileStats(filePath));

ipcMain.handle('file:readRange', async (_event, payload) => readFileRange(payload));

ipcMain.handle('file:search', async (_event, payload) => searchFile(payload));

ipcMain.handle('file:outline', async (_event, filePath) => outlineFile(filePath));

ipcMain.handle('file:replaceRange', async (_event, payload) => replaceRange(payload));

ipcMain.handle('file:insertAtLine', async (_event, payload) => insertAtLine(payload));

ipcMain.handle('file:deleteRange', async (_event, payload) => deleteRange(payload));

ipcMain.handle('file:save', async (_event, { filePath, content }) => {
  if (!filePath) {
    const result = await dialog.showSaveDialog({
      title: 'Save file',
      defaultPath: workspaceRoot ? path.join(workspaceRoot, 'untitled.js') : 'untitled.js'
    });
    if (result.canceled || !result.filePath) return null;
    filePath = result.filePath;
  }

  await fs.writeFile(filePath, content, 'utf8');
  return readFile(filePath);
});

ipcMain.handle('file:create', async (_event, { parentPath, name, directory }) => {
  const target = path.join(parentPath || workspaceRoot, name);
  if (await pathExists(target)) throw new Error('A file or folder already exists at that path.');
  if (directory) await fs.mkdir(target, { recursive: true });
  else await fs.writeFile(target, '', 'utf8');
  const workspace = workspaceRoot ? await openWorkspace(workspaceRoot) : null;
  return { workspace, createdPath: target };
});

ipcMain.handle('file:delete', async (_event, filePath) => {
  await fs.rm(filePath, { recursive: true, force: true });
  const workspace = workspaceRoot ? await openWorkspace(workspaceRoot) : null;
  return { workspace, deletedPath: filePath };
});

ipcMain.handle('file:rename', async (_event, { filePath, name }) => {
  const nextPath = path.join(path.dirname(filePath), name);
  await fs.rename(filePath, nextPath);
  const workspace = workspaceRoot ? await openWorkspace(workspaceRoot) : null;
  return { workspace, oldPath: filePath, nextPath };
});

ipcMain.handle('file:duplicate', async (_event, filePath) => {
  const target = await nextCopyPath(filePath);
  await copyRecursive(filePath, target);
  const workspace = workspaceRoot ? await openWorkspace(workspaceRoot) : null;
  return { workspace, createdPath: target, name: path.basename(target) };
});

ipcMain.handle('file:reveal', async (_event, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle('clipboard:write', async (_event, text) => {
  clipboard.writeText(text);
});

ipcMain.handle('shell:openExternal', async (_event, url) => {
  await shell.openExternal(url);
});

ipcMain.handle('workspace:search', async (_event, query) => {
  if (!workspaceRoot || !query.trim()) return [];
  const result = await runCommand('rg', ['--line-number', '--column', '--hidden', '--glob', '!node_modules', '--glob', '!dist', query], workspaceRoot);
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .slice(0, 300)
    .map((line) => {
      const [file, row, column, ...rest] = line.split(':');
      return { filePath: path.join(workspaceRoot, file), file, row, column, text: rest.join(':') };
    });
});

ipcMain.handle('index:rebuild', async () => rebuildWorkspaceIndex());

ipcMain.handle('index:search', async (_event, { query, limit } = {}) => searchWorkspaceIndex(query, limit));

ipcMain.handle('index:status', async () => {
  if (!workspaceRoot) return { status: 'no-workspace', fileCount: 0 };
  return workspaceIndexState.get(workspaceRoot) || {
    status: await pathExists(indexDbPath()) ? 'ready' : 'missing',
    fileCount: 0,
    updatedAt: null,
    dbPath: indexDbPath()
  };
});

ipcMain.handle('command:classify', async (_event, { command } = {}) => classifyCommand(command));

async function createSnapshot({ files, prompt = '', model = '', verification = null } = {}) {
  if (!workspaceRoot) throw new Error('Open a workspace first.');
  const id = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  const dir = path.join(snapshotsDir(), id);
  await fs.mkdir(dir, { recursive: true });
  const entries = [];
  for (const relative of files || []) {
    const absolutePath = safeWorkspaceFilePath(relative);
    let content = '';
    let existed = true;
    try {
      content = await fs.readFile(absolutePath, 'utf8');
    } catch {
      existed = false;
      content = '';
    }
    const snapshotPath = path.join(dir, relative);
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    await fs.writeFile(snapshotPath, content, 'utf8');
    entries.push({ path: relative, snapshotPath, existed });
  }
  const metadata = {
    id,
    workspaceRoot,
    prompt,
    model,
    verification,
    files: entries.map((entry) => entry.path),
    entries: entries.map((entry) => ({ path: entry.path, existed: entry.existed })),
    createdAt: new Date().toISOString()
  };
  await fs.writeFile(path.join(dir, 'snapshot.json'), JSON.stringify(metadata, null, 2), 'utf8');
  return metadata;
}

ipcMain.handle('snapshot:create', async (_event, payload = {}) => createSnapshot(payload));

ipcMain.handle('snapshot:list', async () => {
  if (!workspaceRoot) return [];
  const dir = snapshotsDir();
  try {
    const ids = await fs.readdir(dir);
    const snapshots = [];
    for (const id of ids) {
      try {
        const raw = await fs.readFile(path.join(dir, id, 'snapshot.json'), 'utf8');
        snapshots.push(JSON.parse(raw));
      } catch {
        // Skip malformed snapshot metadata.
      }
    }
    return snapshots.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  } catch {
    return [];
  }
});

ipcMain.handle('snapshot:restore', async (_event, { snapshotId } = {}) => {
  if (!workspaceRoot) throw new Error('Open a workspace first.');
  if (!snapshotId) throw new Error('Snapshot id is required.');
  const dir = path.join(snapshotsDir(), snapshotId);
  const metadata = JSON.parse(await fs.readFile(path.join(dir, 'snapshot.json'), 'utf8'));
  const entries = Array.isArray(metadata.entries) && metadata.entries.length
    ? metadata.entries
    : (metadata.files || []).map((relative) => ({ path: relative, existed: true }));
  for (const entry of entries) {
    const relative = entry.path;
    const snapshotPath = path.join(dir, relative);
    const targetPath = safeWorkspaceFilePath(relative);
    if (entry.existed === false) {
      await fs.rm(targetPath, { force: true });
    } else {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(snapshotPath, targetPath);
    }
  }
  return { restored: metadata.files || [], snapshot: metadata, workspace: await openWorkspace(workspaceRoot) };
});

ipcMain.handle('agent:createPendingEdit', async (_event, { path: relativePath, content, prompt = '', model = '', source = 'agent' } = {}) => {
  if (typeof content !== 'string') throw new Error('Pending edit content must be a string.');
  const absolutePath = safeWorkspaceFilePath(relativePath);
  const normalizedPath = workspaceRelativePath(absolutePath);
  validatePendingSourceContent(normalizedPath, content);
  let original = '';
  try {
    original = await fs.readFile(absolutePath, 'utf8');
  } catch {
    original = '';
  }
  const id = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  const pending = {
    id,
    path: normalizedPath,
    original,
    content,
    prompt,
    model,
    source,
    createdAt: new Date().toISOString()
  };
  pendingEdits.set(id, pending);
  return pending;
});

ipcMain.handle('agent:applyPendingEdit', async (_event, { id, prompt = '', model = '' } = {}) => {
  const pending = pendingEdits.get(id);
  if (!pending) throw new Error('Pending edit was not found.');
  validatePendingSourceContent(pending.path, pending.content);
  const snapshot = await createSnapshot({ files: [pending.path], prompt: prompt || pending.prompt, model: model || pending.model });
  const targetPath = safeWorkspaceFilePath(pending.path);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, pending.content, 'utf8');
  pendingEdits.delete(id);
  return { applied: pending.path, snapshot, file: await readFile(targetPath), workspace: await openWorkspace(workspaceRoot) };
});

ipcMain.handle('agent:rejectPendingEdit', async (_event, { id } = {}) => {
  const existed = pendingEdits.delete(id);
  return { rejected: existed };
});

ipcMain.handle('verify:detect', async () => detectVerificationPlan());

ipcMain.handle('verify:run', async () => runVerificationPlan());

ipcMain.handle('browser:verify', async (_event, payload = {}) => verifyBrowser(payload));

async function gitStatusForRepo(repoRoot) {
  const gitCwd = await assertGitRepo(repoRoot);
  const repositories = await findGitRepositories();
  const status = await runGit(['status', '--porcelain=v1', '-b'], { cwd: gitCwd });
  const lines = status.stdout.split('\n').filter(Boolean);
  const branchInfo = parseBranchLine(lines.find((line) => line.startsWith('##')) || '## detached');
  const changes = splitGitChanges(lines);
  return {
    isRepo: true,
    repoRoot: gitCwd,
    repoName: path.basename(gitCwd),
    repoRelativePath: gitCwd === workspaceRoot ? '.' : path.relative(workspaceRoot, gitCwd),
    repositories,
    ...branchInfo,
    ...changes,
    clean: !changes.staged.length && !changes.unstaged.length && !changes.conflicts.length
  };
}

ipcMain.handle('git:status', async (_event, payload = {}) => {
  if (!workspaceRoot) return { isRepo: false, reason: 'No workspace', branch: 'No workspace', staged: [], unstaged: [], untracked: [], conflicts: [], clean: true };
  const repositories = await findGitRepositories();
  if (!repositories.length) return { isRepo: false, reason: 'No Git repository', branch: 'No repository', repositories: [], staged: [], unstaged: [], untracked: [], conflicts: [], clean: true };
  const requested = payload?.repoRoot ? normalizeRepoRoot(payload.repoRoot) : null;
  const repoRoot = requested && repositories.some((repo) => repo.path === requested) ? requested : repositories[0].path;
  return gitStatusForRepo(repoRoot);
});

ipcMain.handle('git:branches', async (_event, payload = {}) => {
  const repoRoot = await assertGitRepo(repoRootFromPayload(payload));
  const result = await runGit(['branch', '--format=%(refname:short)|%(upstream:short)|%(HEAD)'], { cwd: repoRoot });
  return result.stdout.split('\n').filter(Boolean).map((line) => {
    const [name, upstream, head] = line.split('|');
    return { name, upstream, current: head === '*' };
  });
});

ipcMain.handle('git:createBranch', async (_event, payload = {}) => {
  const repoRoot = await assertGitRepo(repoRootFromPayload(payload));
  const name = String(payload.branchName || '').trim();
  if (!name) throw new Error('Branch name is required.');
  await runGit(['checkout', '-b', name], { cwd: repoRoot });
  return true;
});

ipcMain.handle('git:checkoutBranch', async (_event, payload = {}) => {
  const repoRoot = await assertGitRepo(repoRootFromPayload(payload));
  const name = String(payload.branchName || '').trim();
  if (!name) throw new Error('Branch name is required.');
  await runGit(['checkout', name], { cwd: repoRoot });
  return true;
});

ipcMain.handle('git:diff', async (_event, payload = {}) => {
  const repoRoot = await assertGitRepo(repoRootFromPayload(payload));
  const relativeFilePath = normalizeGitPath(payload.path);
  const status = String(payload.status || '');
  const staged = Boolean(payload.staged);
  const deleted = status === 'D';
  const untracked = status === '?' || payload.untracked;
  const original = untracked ? '' : await gitShow(`HEAD:${relativeFilePath}`, repoRoot);
  let modified = '';

  if (staged) {
    modified = deleted ? '' : await gitShow(`:${relativeFilePath}`, repoRoot);
  } else {
    modified = deleted ? '' : await readWorkspaceText(relativeFilePath, repoRoot);
  }

  return {
    path: relativeFilePath,
    staged,
    status,
    original,
    modified
  };
});

ipcMain.handle('git:stage', async (_event, payload = {}) => {
  const repoRoot = await assertGitRepo(repoRootFromPayload(payload));
  await runGit(['add', '--', normalizeGitPath(payload.path)], { cwd: repoRoot });
  return true;
});

ipcMain.handle('git:unstage', async (_event, payload = {}) => {
  const repoRoot = await assertGitRepo(repoRootFromPayload(payload));
  const filePath = normalizeGitPath(payload.path);
  const result = await runGit(['restore', '--staged', '--', filePath], { allowFailure: true, cwd: repoRoot });
  if (result.code !== 0) await runGit(['reset', 'HEAD', '--', filePath], { cwd: repoRoot });
  return true;
});

ipcMain.handle('git:stageAll', async (_event, payload = {}) => {
  const repoRoot = await assertGitRepo(repoRootFromPayload(payload));
  await runGit(['add', '-A'], { cwd: repoRoot });
  return true;
});

ipcMain.handle('git:unstageAll', async (_event, payload = {}) => {
  const repoRoot = await assertGitRepo(repoRootFromPayload(payload));
  await runGit(['reset'], { cwd: repoRoot });
  return true;
});

ipcMain.handle('git:discard', async (_event, payload = {}) => {
  const repoRoot = await assertGitRepo(repoRootFromPayload(payload));
  const filePath = normalizeGitPath(payload.path);
  if (payload.untracked || payload.status === '?') {
    await fs.rm(resolveWorkspacePath(filePath, repoRoot), { recursive: true, force: true });
  } else {
    const result = await runGit(['restore', '--worktree', '--', filePath], { allowFailure: true, cwd: repoRoot });
    if (result.code !== 0) await runGit(['checkout', '--', filePath], { cwd: repoRoot });
  }
  return true;
});

ipcMain.handle('git:discardAll', async (_event, payload = {}) => {
  const repoRoot = await assertGitRepo(repoRootFromPayload(payload));
  await runGit(['reset', '--hard'], { cwd: repoRoot });
  await runGit(['clean', '-fd'], { cwd: repoRoot });
  return true;
});

ipcMain.handle('git:commit', async (_event, payload = {}) => {
  const repoRoot = await assertGitRepo(repoRootFromPayload(payload));
  const commitMessage = String(payload.message || '').trim();
  if (!commitMessage) throw new Error('Commit message is required.');
  await runGit(['commit', '-m', commitMessage], { cwd: repoRoot });
  return true;
});

ipcMain.handle('git:pull', async (_event, payload = {}) => {
  const repoRoot = await assertGitRepo(repoRootFromPayload(payload));
  await runGit(['pull'], { cwd: repoRoot });
  return true;
});

ipcMain.handle('git:push', async (_event, payload = {}) => {
  const repoRoot = await assertGitRepo(repoRootFromPayload(payload));
  await runGit(['push'], { cwd: repoRoot });
  return true;
});

ipcMain.handle('git:sync', async (_event, payload = {}) => {
  const repoRoot = await assertGitRepo(repoRootFromPayload(payload));
  await runGit(['pull'], { cwd: repoRoot });
  await runGit(['push'], { cwd: repoRoot });
  return true;
});

ipcMain.handle('git:stash', async (_event, payload = {}) => {
  const repoRoot = await assertGitRepo(repoRootFromPayload(payload));
  await runGit(['stash', 'push', '-u', '-m', String(payload.message || 'Anton stash')], { cwd: repoRoot });
  return true;
});

ipcMain.handle('git:stashPop', async (_event, payload = {}) => {
  const repoRoot = await assertGitRepo(repoRootFromPayload(payload));
  await runGit(['stash', 'pop', String(payload.stashRef || 'stash@{0}')], { cwd: repoRoot });
  return true;
});

ipcMain.handle('git:stashList', async (_event, payload = {}) => {
  const repoRoot = await assertGitRepo(repoRootFromPayload(payload));
  const result = await runGit(['stash', 'list'], { allowFailure: true, cwd: repoRoot });
  if (result.code !== 0) return [];
  return result.stdout.split('\n').filter(Boolean).map((line) => {
    const [ref, ...rest] = line.split(': ');
    return { ref, message: rest.join(': ') };
  });
});

ipcMain.handle('terminal:create', async (_event, { terminalId }) => {
  const session = getTerminalSession(terminalId);
  send('terminal:cwd', { terminalId, cwd: session.cwd });
  return { terminalId, cwd: session.cwd };
});

ipcMain.handle('terminal:useWorkspaceRoot', async (_event, { terminalId }) => {
  const session = getTerminalSession(terminalId);
  session.cwd = workspaceRoot || app.getPath('home');
  send('terminal:cwd', { terminalId, cwd: session.cwd });
  send('terminal:data', { terminalId, text: `[workspace root: ${session.cwd}]\n` });
  return { terminalId, cwd: session.cwd };
});

ipcMain.handle('terminal:run', async (_event, { terminalId = 'terminal-1', command }) => {
  if (!command.trim()) return;
  const session = getTerminalSession(terminalId);
  if (session.process && !session.process.killed) {
    send('terminal:data', { terminalId, text: '\nA terminal process is already running. Stop it before starting another command.\n' });
    return { running: true };
  }
  send('terminal:data', { terminalId, text: `$ ${command}\n` });
  if (await handleTerminalBuiltin(command, terminalId)) return { running: false };
  session.process = spawnUserCommand(command, { cwd: session.cwd, detached: true });
  send('terminal:state', { terminalId, running: true, command });
  session.process.stdout.on('data', (chunk) => send('terminal:data', { terminalId, text: chunk.toString() }));
  session.process.stderr.on('data', (chunk) => send('terminal:data', { terminalId, text: chunk.toString() }));
  session.process.on('close', (code, signal) => {
    send('terminal:data', { terminalId, text: `\n[${signal ? `signal ${signal}` : `exit ${code}`}]\n` });
    session.process = null;
    send('terminal:state', { terminalId, running: false });
  });
  return { running: true };
});

ipcMain.handle('terminal:kill', async (_event, { terminalId = 'terminal-1' } = {}) => {
  const session = getTerminalSession(terminalId);
  if (!session.process || session.process.killed) {
    send('terminal:state', { terminalId, running: false });
    return { killed: false };
  }

  const pid = session.process.pid;
  send('terminal:data', { terminalId, text: `\n[stopping process ${pid}]\n` });
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    session.process.kill('SIGTERM');
  }

  setTimeout(() => {
    if (session.process && !session.process.killed) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        session.process?.kill('SIGKILL');
      }
    }
  }, 1800);

  return { killed: true };
});

ipcMain.handle('terminal:executeCommand', async (_event, { command }) => {
  if (!workspaceRoot) throw new Error('No workspace open to run commands.');
  return new Promise((resolve) => {
    const child = spawnUserCommand(command, { cwd: workspaceRoot });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    child.on('error', (error) => {
      resolve({ code: 1, stdout, stderr: error.message });
    });
  });
});

ipcMain.handle('power:toggleKeepAwake', async (_event, enabled) => {
  if (enabled && powerBlockerId === null) {
    powerBlockerId = powerSaveBlocker.start('prevent-display-sleep');
  }
  if (!enabled && powerBlockerId !== null) {
    powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
  }
  return powerBlockerId !== null;
});

ipcMain.handle('ollama:listModels', async () => {
  await ensureOllamaReady();
  const response = await fetch(`${OLLAMA_URL}/api/tags`);
  if (!response.ok) throw new Error(`Ollama responded with ${response.status}`);
  const data = await response.json();
  return data.models || [];
});

ipcMain.handle('ollama:catalogModels', async () => {
  try {
    const response = await fetch('https://ollama.com/library');
    if (!response.ok) throw new Error(`Ollama library responded with ${response.status}`);
    const html = await response.text();
    const catalog = parseOllamaCatalog(html);
    return catalog.length ? { source: 'ollama.com', models: catalog } : { source: 'fallback', models: FALLBACK_MODEL_CATALOG };
  } catch {
    return { source: 'fallback', models: FALLBACK_MODEL_CATALOG };
  }
});

ipcMain.handle('ollama:deleteModel', async (_event, { name }) => {
  if (!name || typeof name !== 'string') throw new Error('Model name is required.');
  await ensureOllamaReady();
  const response = await fetch(`${OLLAMA_URL}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Ollama responded with ${response.status}`);
  }
  return { deleted: name };
});

ipcMain.handle('openclaw:getModelInfo', async () => {
  let primary = '';
  const models = new Set();
  try {
    const os = require('node:os');
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    if (fsNative.existsSync(configPath)) {
      const config = JSON.parse(fsNative.readFileSync(configPath, 'utf8'));
      primary = config?.agents?.defaults?.model?.primary || '';
      
      const providers = config?.models?.providers || {};
      for (const [providerName, providerData] of Object.entries(providers)) {
        const providerModels = providerData?.models || [];
        for (const model of providerModels) {
          if (model?.id) models.add(`${providerName}/${model.id}`);
        }
      }
    }
  } catch (e) {
    console.error('Failed to get OpenClaw model info:', e);
  }
  const localModels = await listLocalOllamaModelNames({ startIfNeeded: false });
  for (const modelName of localModels) {
    models.add(`ollama/${modelName}`);
  }
  if (primary && !models.has(primary)) models.add(primary);
  return { primary, models: Array.from(models).sort((a, b) => a.localeCompare(b)) };
});

function openClawConfigPath() {
  const os = require('node:os');
  return path.join(os.homedir(), '.openclaw', 'openclaw.json');
}

function setOpenClawPrimaryModel(selectedModel) {
  const configPath = openClawConfigPath();
  const config = fsNative.existsSync(configPath)
    ? JSON.parse(fsNative.readFileSync(configPath, 'utf8'))
    : {};
  if (!config.agents) config.agents = {};
  if (!config.agents.defaults) config.agents.defaults = {};
  if (!config.agents.defaults.model) config.agents.defaults.model = {};
  if (!config.agents.defaults.models) config.agents.defaults.models = {};

  config.agents.defaults.model.primary = selectedModel;
  if (selectedModel) config.agents.defaults.models[selectedModel] = config.agents.defaults.models[selectedModel] || {};

  const slashIndex = String(selectedModel || '').indexOf('/');
  const providerName = slashIndex > 0 ? selectedModel.slice(0, slashIndex) : '';
  const modelId = slashIndex > 0 ? selectedModel.slice(slashIndex + 1) : '';
  if (providerName && modelId) {
    if (!config.models) config.models = {};
    if (!config.models.providers) config.models.providers = {};
    if (!config.models.providers[providerName]) {
      config.models.providers[providerName] = { models: [] };
    }
    const provider = config.models.providers[providerName];
    if (!Array.isArray(provider.models)) provider.models = [];
    if (!provider.models.some((model) => model?.id === modelId)) {
      provider.models.push({ id: modelId });
    }
  }

  config.meta = config.meta || {};
  config.meta.lastTouchedAt = new Date().toISOString();

  fsNative.mkdirSync(path.dirname(configPath), { recursive: true });
  fsNative.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  return true;
}

ipcMain.handle('openclaw:setModel', async (_event, selectedModel) => {
  try {
    setOpenClawPrimaryModel(selectedModel);
    return true;
  } catch (e) {
    console.error('Failed to set OpenClaw model:', e);
  }
  return false;
});

ipcMain.handle('openclaw:send', async (_event, { endpoint, model, messages }) => {
  const selectedModel = String(model || '').trim();
  if (!endpoint) throw new Error('API Endpoint is required.');
  if (selectedModel) {
    setOpenClawPrimaryModel(selectedModel);
  }
  
  // Try to find the local OpenClaw token dynamically from ~/.openclaw/openclaw.json
  let token = '';
  try {
    const os = require('node:os');
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    if (fsNative.existsSync(configPath)) {
      const config = JSON.parse(fsNative.readFileSync(configPath, 'utf8'));
      token = config?.gateway?.auth?.token || '';
    }
  } catch (e) {
    console.error('Failed to read OpenClaw config:', e);
  }

  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'openclaw',
      messages
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `HTTP error! status: ${response.status}`);
  }
  return await response.json();
});

ipcMain.handle('ollama:pullModel', async (event, { name, requestId }) => {
  if (!name || typeof name !== 'string') throw new Error('Model name is required.');
  await ensureOllamaReady();
  const response = await fetch(`${OLLAMA_URL}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, stream: true })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Ollama responded with ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let last = null;
  const sendProgress = (payload) => {
    last = payload;
    event.sender.send('ollama:pullProgress', { requestId, name, ...payload });
  };
  const processLine = (line) => {
    if (!line.trim()) return;
    const payload = JSON.parse(line);
    sendProgress(payload);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) processLine(line);
  }
  if (buffer.trim()) processLine(buffer);
  return { name, status: last?.status || 'done' };
});

ipcMain.handle('ollama:abort', async (_event, requestId) => {
  const controller = activeOllamaControllers.get(requestId);
  if (!controller) return false;
  controller.abort();
  activeOllamaControllers.delete(requestId);
  return true;
});

ipcMain.handle('ollama:generate', async (event, { model, prompt, stream = true, requestId, format, timeoutMs, options = {} }) => {
  await ensureOllamaReady();
  const payload = {
    model,
    prompt,
    stream,
    options: {
      temperature: 0.15,
      num_ctx: 32768,
      ...options
    }
  };
  if (format) payload.format = format;
  const controller = new AbortController();
  if (requestId) activeOllamaControllers.set(requestId, controller);
  const timeout = timeoutMs === 0
    ? null
    : setTimeout(() => controller.abort(), timeoutMs || (stream ? 90_000 : 60_000));
  const clearRequestTimeout = () => {
    if (timeout) clearTimeout(timeout);
    if (requestId) activeOllamaControllers.delete(requestId);
  };
  let response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    clearRequestTimeout();
    if (error.name === 'AbortError') {
      throw new Error(`Ollama request stopped for ${model}.`);
    }
    throw new Error(`Could not reach Ollama at ${OLLAMA_URL}. Make sure Ollama is running and the selected model is available. (${error.message})`);
  }

  if (!response.ok) {
    const body = await response.text();
    clearRequestTimeout();
    throw new Error(body || `Ollama responded with ${response.status}`);
  }

  if (!stream) {
    try {
      const data = await response.json();
      clearRequestTimeout();
      return data.response || '';
    } catch (error) {
      clearRequestTimeout();
      if (error.name === 'AbortError') {
        throw new Error(`Ollama request stopped for ${model}.`);
      }
      throw error;
    }
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let output = '';
  let buffer = '';
  const processLine = (line) => {
    if (!line.trim()) return;
    const payload = JSON.parse(line);
    if (payload.response) {
      output += payload.response;
      event.sender.send('ollama:token', { requestId, token: payload.response });
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        processLine(line);
      }
    }
  } catch (error) {
    clearRequestTimeout();
    if (error.name === 'AbortError') {
      throw new Error(`Ollama request stopped for ${model}.`);
    }
    throw error;
  }
  if (buffer.trim()) processLine(buffer);
  clearRequestTimeout();

  return output;
});
