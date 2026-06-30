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
  workspaceRoot = folderPath;
  for (const session of terminalSessions.values()) {
    if (!session.process && (!session.cwd || session.cwd === previousDefault || session.cwd === app.getPath('home'))) {
      session.cwd = folderPath;
      send('terminal:cwd', { terminalId: session.id, cwd: session.cwd });
      send('terminal:data', { terminalId: session.id, text: `[workspace root: ${folderPath}]\n` });
    }
  }
  watchWorkspace(folderPath);
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

ipcMain.handle('ollama:generate', async (event, { model, prompt, stream = true, requestId, format, timeoutMs }) => {
  await ensureOllamaReady();
  const payload = { model, prompt, stream };
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
