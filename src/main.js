const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fsNative = require('node:fs');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');

const OLLAMA_URL = 'http://localhost:11434';
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.venv', 'venv']);
const MAX_TREE_DEPTH = 5;
const MAX_FILE_BYTES = 1_200_000;

let mainWindow;
let workspaceRoot = null;
let watcher = null;
const terminalSessions = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    title: 'Anton',
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

function runCommand(command, args, cwd = workspaceRoot || app.getPath('home')) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false });
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

ipcMain.handle('git:status', async () => {
  if (!workspaceRoot) return { branch: 'No workspace', changes: [] };
  const branch = await runCommand('git', ['branch', '--show-current'], workspaceRoot);
  const status = await runCommand('git', ['status', '--short'], workspaceRoot);
  return {
    branch: branch.stdout.trim() || 'detached',
    changes: status.stdout.split('\n').filter(Boolean)
  };
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
  session.process = spawn(command, { cwd: session.cwd, shell: true, detached: true });
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

ipcMain.handle('ollama:listModels', async () => {
  const response = await fetch(`${OLLAMA_URL}/api/tags`);
  if (!response.ok) throw new Error(`Ollama responded with ${response.status}`);
  const data = await response.json();
  return data.models || [];
});

ipcMain.handle('ollama:generate', async (event, { model, prompt, stream = true, requestId }) => {
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Ollama responded with ${response.status}`);
  }

  if (!stream) {
    const data = await response.json();
    return data.response || '';
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
  if (buffer.trim()) processLine(buffer);

  return output;
});
