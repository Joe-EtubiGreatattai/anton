const state = {
  workspace: null,
  tabs: [],
  activePath: null,
  editor: null,
  models: new Map(),
  settings: {
    autosave: true,
    minimap: true,
    wordWrap: false,
    fontSize: 14
  },
  lastAiResponse: '',
  terminals: [],
  activeTerminalId: null,
  terminalCounter: 0,
  selectedEntry: null,
  expandedDirs: new Set(),
  aiBusy: false,
  currentRequestId: null,
  contextEntry: null,
  searchRoot: null
};

const els = {
  workspaceName: document.querySelector('#workspaceName'),
  fileTree: document.querySelector('#fileTree'),
  outline: document.querySelector('#outline'),
  tabs: document.querySelector('#tabs'),
  breadcrumb: document.querySelector('#breadcrumb'),
  editorEmpty: document.querySelector('#editorEmpty'),
  emptyOpenFile: document.querySelector('#emptyOpenFile'),
  modelSelect: document.querySelector('#modelSelect'),
  activeModel: document.querySelector('#activeModel'),
  messages: document.querySelector('#messages'),
  prompt: document.querySelector('#prompt'),
  statusLeft: document.querySelector('#statusLeft'),
  statusRight: document.querySelector('#statusRight'),
  searchInput: document.querySelector('#searchInput'),
  searchResults: document.querySelector('#searchResults'),
  gitBranch: document.querySelector('#gitBranch'),
  gitChanges: document.querySelector('#gitChanges'),
  terminalOutput: document.querySelector('#terminalOutput'),
  terminalTabs: document.querySelector('#terminalTabs'),
  newTerminal: document.querySelector('#newTerminal'),
  terminalPrompt: document.querySelector('#terminalPrompt'),
  terminalCommand: document.querySelector('#terminalCommand'),
  terminalStop: document.querySelector('#terminalStop'),
  outputLog: document.querySelector('#outputLog'),
  problems: document.querySelector('#problems'),
  shell: document.querySelector('.shell'),
  workspace: document.querySelector('.workspace'),
  editorWrap: document.querySelector('.editor-wrap'),
  sidebarResize: document.querySelector('#sidebarResize'),
  aiResize: document.querySelector('#aiResize'),
  panelResize: document.querySelector('#panelResize'),
  explorerSectionResize: document.querySelector('#explorerSectionResize'),
  palette: document.querySelector('#palette'),
  paletteInput: document.querySelector('#paletteInput'),
  paletteResults: document.querySelector('#paletteResults'),
  contextMenu: document.querySelector('#contextMenu'),
  sendPrompt: document.querySelector('#sendPrompt')
};

const commands = [
  ['Open folder', () => openWorkspace()],
  ['Open file', () => openFileDialog()],
  ['Save file', () => saveActive()],
  ['New file', () => createEntry(false)],
  ['New folder', () => createEntry(true)],
  ['Rename selected file', () => renameSelectedEntry()],
  ['Delete selected file', () => deleteSelectedEntry()],
  ['Search workspace', () => activateView('search')],
  ['Refresh Git status', () => refreshGit()],
  ['Explain current file', () => askAnton('explain')],
  ['Fix current file', () => askAnton('fix')],
  ['Generate tests', () => askAnton('tests')],
  ['Apply last AI response', () => applyLastResponse()],
  ['Toggle minimap', () => setSetting('minimap', !state.settings.minimap)],
  ['Toggle word wrap', () => setSetting('wordWrap', !state.settings.wordWrap)]
];

require.config({
  paths: {
    vs: '../../node_modules/monaco-editor/min/vs'
  }
});

require(['vs/editor/editor.main'], () => {
  restoreLayoutSizes();
  monaco.editor.defineTheme('anton-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6A9955' },
      { token: 'keyword', foreground: '569CD6' },
      { token: 'string', foreground: 'CE9178' },
      { token: 'number', foreground: 'B5CEA8' }
    ],
    colors: {
      'editor.background': '#1e1e1e',
      'editorLineNumber.foreground': '#858585',
      'editorCursor.foreground': '#aeafad',
      'editor.selectionBackground': '#264f78'
    }
  });

  state.editor = monaco.editor.create(document.querySelector('#editor'), {
    value: '',
    language: 'javascript',
    theme: 'anton-dark',
    automaticLayout: true,
    minimap: { enabled: true },
    fontSize: 14,
    fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
    tabSize: 2,
    insertSpaces: true,
    scrollBeyondLastLine: false,
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true }
  });

  state.editor.setModel(null);
  updateEditorEmptyState();
  updateBreadcrumb();
  updateOutline();
  bindEditorEvents();
  bindUi();
  bindResizableLayout();
  loadModels();
  renderPalette();
  updateProblems();
});

function log(text) {
  els.outputLog.textContent += `\n${text}`;
  els.outputLog.scrollTop = els.outputLog.scrollHeight;
}

function setStatus(text) {
  els.statusLeft.textContent = text;
}

function languageFromPath(filePath) {
  const ext = (filePath.split('.').pop() || '').toLowerCase();
  return {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    html: 'html',
    css: 'css',
    json: 'json',
    md: 'markdown',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    sh: 'shell',
    yaml: 'yaml',
    yml: 'yaml'
  }[ext] || 'plaintext';
}

function fileName(filePath) {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function parentPath(filePath) {
  return filePath.replace(/[\\/][^\\/]+$/, '');
}

function relativePath(filePath) {
  if (!state.workspace?.root || !filePath.startsWith(state.workspace.root)) return filePath;
  return filePath.slice(state.workspace.root.length).replace(/^[/\\]/, '');
}

function fileIconClass(name, type) {
  if (type === 'directory') return 'folder';
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['js', 'jsx'].includes(ext)) return 'js';
  if (['ts', 'tsx'].includes(ext)) return 'ts';
  if (ext === 'json') return 'json';
  if (['md', 'markdown'].includes(ext)) return 'md';
  return 'file';
}

function fileIcon(name, type) {
  if (type === 'directory') return '▣';
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['js', 'jsx'].includes(ext)) return 'JS';
  if (['ts', 'tsx'].includes(ext)) return 'TS';
  if (ext === 'json') return '{}';
  if (['md', 'markdown'].includes(ext)) return 'M';
  if (ext === 'html') return '<>';
  if (ext === 'css') return '#';
  return '•';
}

function openVirtualTab(name, content, language) {
  const uri = monaco.Uri.parse(`anton:///${name}`);
  const model = monaco.editor.createModel(content, language, uri);
  const tab = { name, filePath: null, model, dirty: true, modifiedAt: Date.now() };
  state.tabs.push(tab);
  state.activePath = uri.toString();
  state.models.set(state.activePath, tab);
  state.editor.setModel(model);
  renderTabs();
  updateEditorEmptyState();
  updateBreadcrumb();
  updateOutline();
}

async function openWorkspace() {
  const workspace = await window.anton.openWorkspace();
  if (!workspace) return;
  state.workspace = workspace;
  state.selectedEntry = { type: 'directory', path: workspace.root, name: workspace.name };
  state.expandedDirs.add(workspace.root);
  els.workspaceName.textContent = workspace.name;
  renderTree(workspace.tree);
  updateSelectedEntry();
  resetActiveTerminalToWorkspaceRoot();
  refreshGit();
  setStatus(`Opened ${workspace.name}`);
}

async function refreshWorkspace() {
  const workspace = await window.anton.refreshWorkspace();
  if (!workspace) return;
  state.workspace = workspace;
  renderTree(workspace.tree);
  updateSelectedEntry();
  resetActiveTerminalToWorkspaceRoot();
}

async function openFileDialog() {
  const file = await window.anton.openFileDialog();
  if (file) openFile(file);
}

async function openFilePath(filePath) {
  const existing = state.tabs.find((tab) => tab.filePath === filePath);
  if (existing) {
    activateTab(existing);
    return;
  }
  const file = await window.anton.readFile(filePath);
  openFile(file);
}

function openFile(file) {
  const language = languageFromPath(file.filePath);
  const uri = monaco.Uri.file(file.filePath);
  const model = monaco.editor.createModel(file.content, language, uri);
  const tab = {
    name: file.name,
    filePath: file.filePath,
    model,
    dirty: false,
    modifiedAt: file.modifiedAt
  };
  state.tabs.push(tab);
  state.models.set(uri.toString(), tab);
  activateTab(tab);
  log(`Opened ${file.filePath}`);
}

function activateTab(tab) {
  state.activePath = tab.model.uri.toString();
  state.editor.setModel(tab.model);
  renderTabs();
  updateEditorEmptyState();
  updateBreadcrumb();
  updateOutline();
  updateCursor();
}

function activeTab() {
  return state.models.get(state.activePath) || null;
}

function updateEditorEmptyState() {
  const hasFile = Boolean(activeTab());
  els.editorEmpty.classList.toggle('hidden', hasFile);
}

async function saveActive() {
  const tab = activeTab();
  if (!tab) return;
  const result = await window.anton.saveFile({
    filePath: tab.filePath,
    content: tab.model.getValue()
  });
  if (!result) return;

  tab.filePath = result.filePath;
  tab.name = result.name;
  tab.dirty = false;
  tab.modifiedAt = result.modifiedAt;
  renderTabs();
  updateBreadcrumb();
  setStatus(`Saved ${tab.name}`);
}

function renderTabs() {
  els.tabs.innerHTML = '';
  for (const tab of state.tabs) {
    const node = document.createElement('button');
    node.className = `tab ${tab.model.uri.toString() === state.activePath ? 'active' : ''}`;
    node.innerHTML = `<span>${tab.dirty ? '● ' : ''}${tab.name}</span><span class="tab-close">×</span>`;
    node.addEventListener('click', (event) => {
      if (event.target.classList.contains('tab-close')) closeTab(tab);
      else activateTab(tab);
    });
    els.tabs.appendChild(node);
  }
}

function closeTab(tab) {
  const index = state.tabs.indexOf(tab);
  state.tabs.splice(index, 1);
  state.models.delete(tab.model.uri.toString());
  tab.model.dispose();

  if (state.activePath === tab.model.uri.toString()) {
    const next = state.tabs[Math.max(0, index - 1)];
    if (next) activateTab(next);
    else {
      state.activePath = null;
      state.editor.setModel(null);
      renderTabs();
      updateEditorEmptyState();
      updateBreadcrumb();
      updateOutline();
      updateCursor();
    }
  }
  renderTabs();
}

function renderTree(nodes) {
  els.fileTree.innerHTML = '';
  if (!nodes?.length) {
    els.fileTree.textContent = 'Workspace is empty.';
    return;
  }
  els.fileTree.appendChild(renderTreeNodes(nodes));
}

function renderTreeNodes(nodes) {
  const wrapper = document.createElement('div');
  for (const node of nodes) {
    const row = document.createElement('div');
    row.className = `tree-node ${node.type} ${state.selectedEntry?.path === node.path ? 'selected' : ''}`;
    row.title = node.path;

    const caret = document.createElement('span');
    caret.className = 'tree-caret';
    caret.textContent = node.type === 'directory' ? (state.expandedDirs.has(node.path) ? '▾' : '▸') : '';

    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = node.name;

    const icon = document.createElement('span');
    icon.className = `tree-icon ${fileIconClass(node.name, node.type)}`;
    icon.textContent = fileIcon(node.name, node.type);

    row.append(caret, icon, label);
    row.addEventListener('click', () => {
      selectEntry(node);
      if (node.type === 'directory') toggleDirectory(node.path);
      else openFilePath(node.path);
    });
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectEntry(node);
      openContextMenu(event.clientX, event.clientY, node);
    });
    wrapper.appendChild(row);

    if (node.children?.length) {
      const children = document.createElement('div');
      children.className = `tree-children ${state.expandedDirs.has(node.path) ? '' : 'collapsed'}`;
      children.appendChild(renderTreeNodes(node.children));
      wrapper.appendChild(children);
    }
  }
  return wrapper;
}

function selectEntry(node) {
  state.selectedEntry = { type: node.type, path: node.path, name: node.name };
  renderTree(state.workspace?.tree || []);
}

function updateSelectedEntry() {
  renderTree(state.workspace?.tree || []);
}

function toggleDirectory(dirPath) {
  if (state.expandedDirs.has(dirPath)) state.expandedDirs.delete(dirPath);
  else state.expandedDirs.add(dirPath);
  renderTree(state.workspace?.tree || []);
}

async function createEntry(directory) {
  if (!state.workspace) {
    setStatus('Open a folder before creating files.');
    return;
  }
  const name = prompt(directory ? 'Folder name' : 'File name');
  if (!name) return;
  const parentPath = state.selectedEntry?.type === 'directory'
    ? state.selectedEntry.path
    : state.selectedEntry?.path
      ? state.selectedEntry.path.replace(/[\\/][^\\/]+$/, '')
      : state.workspace.root;
  const result = await window.anton.createFile({ parentPath, name, directory });
  state.workspace = result.workspace;
  state.selectedEntry = { path: result.createdPath, name, type: directory ? 'directory' : 'file' };
  if (directory) state.expandedDirs.add(result.createdPath);
  state.expandedDirs.add(parentPath);
  renderTree(state.workspace.tree);
  updateSelectedEntry();
  if (!directory) openFilePath(result.createdPath);
}

async function duplicateSelectedEntry() {
  if (!state.selectedEntry || state.selectedEntry.path === state.workspace?.root) {
    setStatus('Select a file or folder to duplicate.');
    return;
  }
  const result = await window.anton.duplicateFile(state.selectedEntry.path);
  state.workspace = result.workspace;
  state.selectedEntry = {
    type: state.selectedEntry.type,
    path: result.createdPath,
    name: result.name
  };
  renderTree(state.workspace.tree);
  if (state.selectedEntry.type === 'file') openFilePath(result.createdPath);
  setStatus(`Duplicated ${result.name}`);
}

async function renameSelectedEntry() {
  if (!state.selectedEntry || state.selectedEntry.path === state.workspace?.root) {
    setStatus('Select a file or folder to rename.');
    return;
  }
  const nextName = prompt('New name', state.selectedEntry.name);
  if (!nextName || nextName === state.selectedEntry.name) return;
  const result = await window.anton.renameFile({ filePath: state.selectedEntry.path, name: nextName });
  updateTabsAfterRename(result.oldPath, result.nextPath, nextName);
  state.workspace = result.workspace;
  state.selectedEntry = { path: result.nextPath, name: nextName, type: state.selectedEntry.type };
  renderTree(state.workspace.tree);
  updateSelectedEntry();
  setStatus(`Renamed ${nextName}`);
}

async function deleteSelectedEntry() {
  if (!state.selectedEntry || state.selectedEntry.path === state.workspace?.root) {
    setStatus('Select a file or folder to delete.');
    return;
  }
  const ok = confirm(`Delete ${state.selectedEntry.name}?`);
  if (!ok) return;
  const deletedPath = state.selectedEntry.path;
  const result = await window.anton.deleteFile(deletedPath);
  closeTabsUnderPath(deletedPath);
  state.workspace = result.workspace;
  state.selectedEntry = { type: 'directory', path: state.workspace.root, name: state.workspace.name };
  renderTree(state.workspace.tree);
  updateSelectedEntry();
  setStatus(`Deleted ${fileName(deletedPath)}`);
}

function updateTabsAfterRename(oldPath, nextPath, nextName) {
  for (const tab of state.tabs) {
    if (!tab.filePath) continue;
    if (tab.filePath === oldPath || tab.filePath.startsWith(`${oldPath}/`)) {
      tab.filePath = tab.filePath.replace(oldPath, nextPath);
      tab.name = tab.filePath === nextPath ? nextName : fileName(tab.filePath);
    }
  }
  renderTabs();
  updateBreadcrumb();
}

function closeTabsUnderPath(deletedPath) {
  const affected = state.tabs.filter((tab) => tab.filePath === deletedPath || tab.filePath?.startsWith(`${deletedPath}/`));
  for (const tab of affected) closeTab(tab);
}

async function copySelectedPath(relative = false) {
  if (!state.selectedEntry) return;
  await window.anton.writeClipboard(relative ? relativePath(state.selectedEntry.path) : state.selectedEntry.path);
  setStatus(relative ? 'Copied relative path' : 'Copied path');
}

function revealSelectedEntry() {
  if (!state.selectedEntry) return;
  window.anton.revealFile(state.selectedEntry.path);
}

function runSelectedEntry() {
  if (!state.selectedEntry || state.selectedEntry.type !== 'file') return;
  runTerminalCommand(`"${state.selectedEntry.path}"`);
}

function searchInSelectedEntry() {
  if (!state.selectedEntry) return;
  activateView('search');
  state.searchRoot = state.selectedEntry.type === 'directory' ? state.selectedEntry.path : parentPath(state.selectedEntry.path);
  els.searchInput.value = '';
  els.searchInput.placeholder = state.selectedEntry.type === 'directory'
    ? `Search ${state.selectedEntry.name}`
    : `Search folder containing ${state.selectedEntry.name}`;
  els.searchInput.focus();
}

function openToSide() {
  if (!state.selectedEntry || state.selectedEntry.type !== 'file') return;
  openFilePath(state.selectedEntry.path);
  setStatus('Open to side is mapped to opening a tab in Anton.');
}

async function askSelectedFile(mode) {
  if (!state.selectedEntry || state.selectedEntry.type !== 'file') return;
  await openFilePath(state.selectedEntry.path);
  askAnton(mode);
}

function handleTreeBlankContext(event) {
  if (event.target !== els.fileTree) return;
  event.preventDefault();
  const root = state.workspace
    ? { type: 'directory', path: state.workspace.root, name: state.workspace.name }
    : null;
  if (root) {
    selectEntry(root);
    openContextMenu(event.clientX, event.clientY, root);
  }
}

function openContextMenu(x, y, entry) {
  state.contextEntry = entry;
  els.contextMenu.innerHTML = '';
  const isFile = entry.type === 'file';
  const isRoot = entry.path === state.workspace?.root;
  const items = [
    isFile && ['Open', () => openFilePath(entry.path), 'Enter'],
    isFile && ['Open to Side', openToSide],
    isFile && ['Run File', runSelectedEntry],
    isFile && ['Explain with Anton', () => askSelectedFile('explain')],
    isFile && ['Fix with Anton', () => askSelectedFile('fix')],
    isFile && ['Generate Tests', () => askSelectedFile('tests')],
    'separator',
    ['New File', () => createEntry(false)],
    ['New Folder', () => createEntry(true)],
    !isRoot && ['Rename', renameSelectedEntry, 'Enter'],
    !isRoot && ['Duplicate', duplicateSelectedEntry],
    !isRoot && ['Delete', deleteSelectedEntry, '⌫'],
    'separator',
    ['Copy Path', () => copySelectedPath(false)],
    ['Copy Relative Path', () => copySelectedPath(true)],
    ['Reveal in Finder', revealSelectedEntry],
    'separator',
    ['Search in Folder', searchInSelectedEntry]
  ].filter(Boolean);

  for (const item of items) {
    if (item === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'menu-separator';
      els.contextMenu.appendChild(sep);
      continue;
    }
    const [labelText, action, shortcut] = item;
    const row = document.createElement('div');
    row.className = 'menu-item';
    row.innerHTML = `<span>${labelText}</span><span class="menu-shortcut">${shortcut || ''}</span>`;
    row.addEventListener('click', () => {
      closeContextMenu();
      action();
    });
    els.contextMenu.appendChild(row);
  }

  els.contextMenu.style.left = `${Math.min(x, window.innerWidth - 240)}px`;
  els.contextMenu.style.top = `${Math.min(y, window.innerHeight - 320)}px`;
  els.contextMenu.classList.remove('hidden');
}

function closeContextMenu() {
  els.contextMenu.classList.add('hidden');
}

async function runSearch() {
  const query = els.searchInput.value.trim();
  let results = await window.anton.searchWorkspace(query);
  if (state.searchRoot) {
    results = results.filter((result) => result.filePath === state.searchRoot || result.filePath.startsWith(`${state.searchRoot}/`));
  }
  els.searchResults.innerHTML = '';
  if (!results.length) {
    els.searchResults.textContent = 'No matches.';
    return;
  }
  for (const result of results) {
    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `<div class="result-file">${result.file}:${result.row}:${result.column}</div><div class="result-line">${escapeHtml(result.text)}</div>`;
    item.addEventListener('click', async () => {
      await openFilePath(result.filePath);
      state.editor.setPosition({ lineNumber: Number(result.row), column: Number(result.column) });
      state.editor.revealLineInCenter(Number(result.row));
      state.editor.focus();
    });
    els.searchResults.appendChild(item);
  }
}

async function refreshGit() {
  const status = await window.anton.gitStatus();
  els.gitBranch.textContent = `Branch: ${status.branch}`;
  els.gitChanges.innerHTML = '';
  if (!status.changes.length) {
    els.gitChanges.textContent = 'Working tree clean.';
    return;
  }
  for (const change of status.changes) {
    const item = document.createElement('div');
    item.className = 'result-item';
    item.textContent = change;
    els.gitChanges.appendChild(item);
  }
}

async function loadModels() {
  els.modelSelect.innerHTML = '';
  try {
    const models = await window.anton.listModels();
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model.name;
      option.textContent = model.name;
      els.modelSelect.appendChild(option);
    }
    const preferred = models.find((model) => model.name.includes('qwen2.5-coder:7b')) || models[0];
    if (preferred) els.modelSelect.value = preferred.name;
    els.activeModel.textContent = els.modelSelect.value || 'No model';
    setStatus(models.length ? `${models.length} Ollama models ready` : 'No Ollama models');
  } catch (error) {
    els.activeModel.textContent = 'Ollama offline';
    setStatus('Ollama offline');
  }
}

function addMessage(role, text) {
  const node = document.createElement('div');
  node.className = `message ${role}`;
  node.textContent = text;
  els.messages.appendChild(node);
  els.messages.scrollTop = els.messages.scrollHeight;
  return node;
}

function workspaceContext() {
  const files = [];
  function walk(nodes = []) {
    for (const node of nodes) {
      if (node.type === 'file') files.push(node.path.replace(state.workspace?.root || '', ''));
      if (node.children) walk(node.children);
    }
  }
  walk(state.workspace?.tree || []);
  return files.slice(0, 120).join('\n');
}

async function askAnton(mode = 'custom') {
  if (state.aiBusy) {
    setStatus('Anton is still thinking.');
    return;
  }
  const model = els.modelSelect.value;
  if (!model) {
    addMessage('system', 'No model selected. Start Ollama and refresh models.');
    return;
  }

  const tab = activeTab();
  const code = tab?.model.getValue() || '';
  const custom = els.prompt.value.trim();
  const instruction = {
    custom,
    explain: 'Explain this file clearly and list risks or bugs.',
    fix: 'Find and fix bugs in this file. Return the complete corrected file in one fenced code block.',
    tests: 'Write focused tests for this file. Include the test file name and complete code.'
  }[mode];

  if (!instruction) return;

  addMessage('user', instruction);
  els.prompt.value = '';
  const responseNode = addMessage('assistant pending', '');
  responseNode.innerHTML = '<span class="thinking-row"><span class="spinner"></span><span>Anton is thinking...</span></span>';
  state.lastAiResponse = '';
  const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  state.currentRequestId = requestId;
  setAiBusy(true);

  const prompt = [
    instruction,
    '',
    `Active file: ${tab?.filePath || tab?.name || 'untitled'}`,
    'Workspace files:',
    workspaceContext() || '(no workspace open)',
    '',
    'Current file content:',
    '```',
    code,
    '```'
  ].join('\n');

  const tokenHandler = (payload) => {
    if (payload.requestId !== requestId) return;
    const token = payload.token || '';
    state.lastAiResponse += token;
    responseNode.className = 'message assistant';
    responseNode.textContent = state.lastAiResponse;
    els.messages.scrollTop = els.messages.scrollHeight;
  };

  const previous = window.__antonTokenHandler;
  window.__antonTokenHandler = tokenHandler;
  try {
    const response = await window.anton.generate({ model, prompt, stream: true, requestId });
    if (!state.lastAiResponse) {
      state.lastAiResponse = response?.trim() || '';
      responseNode.className = 'message assistant';
      responseNode.textContent = state.lastAiResponse || 'Anton did not return text. Try again or switch to the smaller model.';
    }
  } catch (error) {
    responseNode.className = 'message system';
    responseNode.textContent = `Request failed: ${error.message}`;
  } finally {
    window.__antonTokenHandler = previous;
    if (state.currentRequestId === requestId) state.currentRequestId = null;
    setAiBusy(false);
  }
}

function setAiBusy(value) {
  state.aiBusy = value;
  els.sendPrompt.disabled = value;
  els.prompt.disabled = value;
  els.modelSelect.disabled = value;
  els.sendPrompt.textContent = value ? 'Wait' : 'Send';
  setStatus(value ? 'Anton is thinking...' : 'Ready');
}

function applyLastResponse() {
  const tab = activeTab();
  if (!tab || !state.lastAiResponse) return;
  const match = state.lastAiResponse.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/);
  const nextCode = match ? match[1].trimEnd() : state.lastAiResponse.trim();
  if (!nextCode) return;
  tab.model.pushEditOperations([], [{ range: tab.model.getFullModelRange(), text: nextCode }], () => null);
  tab.dirty = true;
  renderTabs();
  setStatus('Applied AI response to editor');
}

function updateBreadcrumb() {
  const tab = activeTab();
  els.breadcrumb.textContent = tab?.filePath || tab?.name || 'No file open';
}

function updateCursor() {
  if (!state.editor.getModel()) {
    els.statusRight.textContent = 'No file';
    return;
  }
  const position = state.editor.getPosition();
  els.statusRight.textContent = `Ln ${position.lineNumber}, Col ${position.column}`;
}

function updateOutline() {
  const tab = activeTab();
  if (!tab) {
    els.outline.textContent = 'No file open.';
    return;
  }
  const text = tab?.model.getValue() || '';
  const symbols = [];
  const rx = /^\s*(?:export\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)|^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?/gm;
  let match;
  while ((match = rx.exec(text))) {
    symbols.push({ name: match[1] || match[2], line: text.slice(0, match.index).split('\n').length });
  }
  els.outline.innerHTML = '';
  if (!symbols.length) {
    els.outline.textContent = 'No symbols.';
    return;
  }
  for (const symbol of symbols) {
    const item = document.createElement('div');
    item.className = 'outline-item';
    item.textContent = symbol.name;
    item.addEventListener('click', () => {
      state.editor.setPosition({ lineNumber: symbol.line, column: 1 });
      state.editor.revealLineInCenter(symbol.line);
    });
    els.outline.appendChild(item);
  }
}

function updateProblems() {
  const markers = monaco.editor.getModelMarkers({}).slice(0, 80);
  els.problems.innerHTML = '';
  if (!markers.length) {
    els.problems.textContent = 'No diagnostics reported by Monaco.';
    return;
  }
  for (const marker of markers) {
    const item = document.createElement('div');
    item.className = 'result-item';
    item.textContent = `${fileName(marker.resource.path)}:${marker.startLineNumber}:${marker.startColumn} ${marker.message}`;
    els.problems.appendChild(item);
  }
}

function setSetting(key, value) {
  state.settings[key] = value;
  document.querySelector('#autosaveToggle').checked = state.settings.autosave;
  document.querySelector('#minimapToggle').checked = state.settings.minimap;
  document.querySelector('#wordWrapToggle').checked = state.settings.wordWrap;
  document.querySelector('#fontSizeInput').value = state.settings.fontSize;
  state.editor.updateOptions({
    minimap: { enabled: state.settings.minimap },
    wordWrap: state.settings.wordWrap ? 'on' : 'off',
    fontSize: state.settings.fontSize
  });
}

function clamp(value, min, max) {
  const upper = Math.max(min, max);
  return Math.min(Math.max(value, min), upper);
}

function setCssSize(name, value) {
  document.documentElement.style.setProperty(name, `${Math.round(value)}px`);
}

function restoreLayoutSizes() {
  const sidebar = Number(localStorage.getItem('anton.sidebarWidth')) || 286;
  const ai = Number(localStorage.getItem('anton.aiWidth')) || 390;
  const panel = Number(localStorage.getItem('anton.panelHeight')) || 210;
  const explorerTree = Number(localStorage.getItem('anton.explorerTreeHeight')) || 250;
  setCssSize('--sidebar-width', clamp(sidebar, 190, 520));
  setCssSize('--ai-width', clamp(ai, 280, 640));
  setCssSize('--panel-height', clamp(panel, 70, 640));
  setCssSize('--explorer-tree-height', clamp(explorerTree, 96, 520));
}

function relayoutEditorSoon() {
  requestAnimationFrame(() => state.editor?.layout());
}

function readPixelVar(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

function startResize(handle, axis, onMove, onEnd) {
  return (event) => {
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add(axis === 'x' ? 'resizing' : 'resizing-y');
    const start = {
      x: event.clientX,
      y: event.clientY,
      sidebarWidth: readPixelVar('--sidebar-width', 286),
      aiWidth: readPixelVar('--ai-width', 390),
      panelHeight: readPixelVar('--panel-height', 210),
      explorerTreeHeight: readPixelVar('--explorer-tree-height', 250)
    };

    const move = (moveEvent) => {
      onMove(moveEvent, start);
      relayoutEditorSoon();
    };
    const up = () => {
      handle.releasePointerCapture?.(event.pointerId);
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing', 'resizing-y');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onEnd?.();
      relayoutEditorSoon();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };
}

function bindResizableLayout() {
  els.sidebarResize.addEventListener('pointerdown', startResize(
    els.sidebarResize,
    'x',
    (event) => {
      const width = clamp(event.clientX - 48, 190, Math.min(560, window.innerWidth - 620));
      setCssSize('--sidebar-width', width);
      localStorage.setItem('anton.sidebarWidth', String(Math.round(width)));
    }
  ));

  els.aiResize.addEventListener('pointerdown', startResize(
    els.aiResize,
    'x',
    (event) => {
      const rect = els.editorWrap.getBoundingClientRect();
      const width = clamp(rect.right - event.clientX, 280, Math.min(680, rect.width - 360));
      setCssSize('--ai-width', width);
      localStorage.setItem('anton.aiWidth', String(Math.round(width)));
    }
  ));

  els.panelResize.addEventListener('pointerdown', startResize(
    els.panelResize,
    'y',
    (event, start) => {
      const rect = els.workspace.getBoundingClientRect();
      const topChrome = 36 + 26;
      const handle = 6;
      const statusbar = 22;
      const minEditor = 48;
      const maxHeight = rect.height - topChrome - handle - statusbar - minEditor;
      const dragUpDistance = start.y - event.clientY;
      const height = clamp(start.panelHeight + dragUpDistance, 70, maxHeight);
      setCssSize('--panel-height', height);
      localStorage.setItem('anton.panelHeight', String(Math.round(height)));
    }
  ));

  els.explorerSectionResize.addEventListener('pointerdown', startResize(
    els.explorerSectionResize,
    'y',
    (event) => {
      const explorer = document.querySelector('#view-explorer').getBoundingClientRect();
      const height = clamp(event.clientY - explorer.top - 34, 96, explorer.height - 140);
      setCssSize('--explorer-tree-height', height);
      localStorage.setItem('anton.explorerTreeHeight', String(Math.round(height)));
    }
  ));
}

function activateView(view) {
  document.querySelectorAll('.activity').forEach((node) => node.classList.toggle('active', node.dataset.view === view));
  document.querySelectorAll('.side-view').forEach((node) => node.classList.toggle('active', node.id === `view-${view}`));
}

function activatePanel(panel) {
  document.querySelectorAll('.panel-tab').forEach((node) => node.classList.toggle('active', node.dataset.panel === panel));
  document.querySelectorAll('.panel-body').forEach((node) => node.classList.toggle('active', node.id === `panel-${panel}`));
}

function renderPalette(filter = '') {
  els.paletteResults.innerHTML = '';
  const visible = commands.filter(([label]) => label.toLowerCase().includes(filter.toLowerCase()));
  for (const [label, action] of visible) {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.textContent = label;
    item.addEventListener('click', () => {
      closePalette();
      action();
    });
    els.paletteResults.appendChild(item);
  }
}

function openPalette() {
  els.palette.classList.remove('hidden');
  els.paletteInput.value = '';
  renderPalette();
  els.paletteInput.focus();
}

function closePalette() {
  els.palette.classList.add('hidden');
}

function createLocalTerminal() {
  state.terminalCounter += 1;
  const terminal = {
    id: `terminal-${state.terminalCounter}`,
    name: `Terminal ${state.terminalCounter}`,
    output: '',
    cwd: '',
    running: false,
    command: ''
  };
  state.terminals.push(terminal);
  state.activeTerminalId = terminal.id;
  window.anton.createTerminal({ terminalId: terminal.id });
  if (state.workspace) window.anton.useWorkspaceRootTerminal({ terminalId: terminal.id });
  renderTerminalTabs();
  renderActiveTerminal();
  activatePanel('terminal');
  return terminal;
}

function resetActiveTerminalToWorkspaceRoot() {
  if (!state.workspace || !state.activeTerminalId) return;
  window.anton.useWorkspaceRootTerminal({ terminalId: state.activeTerminalId });
}

function activeTerminal() {
  if (!state.terminals.length) return createLocalTerminal();
  return state.terminals.find((terminal) => terminal.id === state.activeTerminalId) || state.terminals[0];
}

function renderTerminalTabs() {
  els.terminalTabs.innerHTML = '';
  for (const terminal of state.terminals) {
    const tab = document.createElement('button');
    tab.className = `terminal-tab ${terminal.id === state.activeTerminalId ? 'active' : ''}`;
    tab.innerHTML = `<span class="terminal-tab-title">${terminal.running ? '● ' : ''}${terminal.name}</span><span class="terminal-tab-close">×</span>`;
    tab.addEventListener('click', (event) => {
      if (event.target.classList.contains('terminal-tab-close')) {
        closeTerminal(terminal.id);
        return;
      }
      state.activeTerminalId = terminal.id;
      renderTerminalTabs();
      renderActiveTerminal();
    });
    els.terminalTabs.appendChild(tab);
  }
}

function renderActiveTerminal() {
  const terminal = activeTerminal();
  els.terminalOutput.textContent = '';
  appendTerminalOutput(terminal.output || '');
  setTerminalRunning(terminal.running, terminal.command);
  setTerminalPrompt(terminal.cwd);
}

function appendTerminalToSession(terminalId, text) {
  const terminal = state.terminals.find((item) => item.id === terminalId);
  if (!terminal) return;
  terminal.output += text;
  if (terminal.id === state.activeTerminalId) {
    appendTerminalOutput(text);
    els.terminalOutput.scrollTop = els.terminalOutput.scrollHeight;
  }
}

function clearTerminalSession(terminalId) {
  const terminal = state.terminals.find((item) => item.id === terminalId);
  if (!terminal) return;
  terminal.output = '';
  if (terminal.id === state.activeTerminalId) els.terminalOutput.textContent = '';
}

function updateTerminalState(payload) {
  const terminal = state.terminals.find((item) => item.id === payload.terminalId);
  if (!terminal) return;
  terminal.running = Boolean(payload.running);
  terminal.command = payload.running ? payload.command || terminal.command : '';
  renderTerminalTabs();
  if (terminal.id === state.activeTerminalId) setTerminalRunning(terminal.running, terminal.command);
}

function updateTerminalCwd(payload) {
  const terminal = state.terminals.find((item) => item.id === payload.terminalId);
  if (!terminal) return;
  terminal.cwd = payload.cwd;
  if (terminal.id === state.activeTerminalId) setTerminalPrompt(payload.cwd);
}

function closeTerminal(terminalId) {
  const terminal = state.terminals.find((item) => item.id === terminalId);
  if (!terminal) return;
  if (terminal.running) window.anton.killTerminal({ terminalId });
  const index = state.terminals.indexOf(terminal);
  state.terminals.splice(index, 1);
  if (!state.terminals.length) {
    createLocalTerminal();
    return;
  }
  if (state.activeTerminalId === terminalId) {
    state.activeTerminalId = state.terminals[Math.max(0, index - 1)].id;
  }
  renderTerminalTabs();
  renderActiveTerminal();
}

function bindEditorEvents() {
  state.editor.onDidChangeCursorPosition(updateCursor);
  state.editor.onDidChangeModelContent(() => {
    const tab = activeTab();
    if (!tab) return;
    tab.dirty = true;
    renderTabs();
    updateOutline();
    if (state.settings.autosave) {
      clearTimeout(tab.autosaveTimer);
      tab.autosaveTimer = setTimeout(() => {
        if (tab.filePath) saveActive();
      }, 900);
    }
  });
  monaco.editor.onDidChangeMarkers(updateProblems);
}

function bindUi() {
  document.querySelectorAll('.activity').forEach((node) => node.addEventListener('click', () => activateView(node.dataset.view)));
  document.querySelectorAll('.panel-tab').forEach((node) => node.addEventListener('click', () => activatePanel(node.dataset.panel)));

  document.querySelector('#openWorkspace').addEventListener('click', openWorkspace);
  document.querySelector('#refreshWorkspace').addEventListener('click', refreshWorkspace);
  document.querySelector('#searchButton').addEventListener('click', runSearch);
  document.querySelector('#refreshGit').addEventListener('click', refreshGit);
  document.querySelector('#refreshModels').addEventListener('click', loadModels);
  document.querySelector('#sendPrompt').addEventListener('click', () => askAnton('custom'));
  document.querySelector('#commandButton').addEventListener('click', openPalette);
  els.emptyOpenFile.addEventListener('click', openFileDialog);

  document.querySelector('#runCurrent').addEventListener('click', () => {
    const tab = activeTab();
    if (tab?.filePath) runTerminalCommand(`"${tab.filePath}"`);
  });
  document.querySelector('#runTests').addEventListener('click', () => runTerminalCommand('npm test'));
  els.newTerminal.addEventListener('click', createLocalTerminal);

  els.modelSelect.addEventListener('change', () => {
    els.activeModel.textContent = els.modelSelect.value || 'No model';
  });

  els.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runSearch();
  });
  els.searchInput.addEventListener('input', () => {
    if (!els.searchInput.value.trim()) state.searchRoot = null;
  });

  els.prompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) askAnton('custom');
  });

  els.terminalCommand.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      runTerminalCommand(els.terminalCommand.value);
      els.terminalCommand.value = '';
    }
  });
  els.terminalStop.addEventListener('click', () => {
    window.anton.killTerminal({ terminalId: activeTerminal().id });
  });

  document.querySelector('#autosaveToggle').addEventListener('change', (event) => setSetting('autosave', event.target.checked));
  document.querySelector('#minimapToggle').addEventListener('change', (event) => setSetting('minimap', event.target.checked));
  document.querySelector('#wordWrapToggle').addEventListener('change', (event) => setSetting('wordWrap', event.target.checked));
  document.querySelector('#fontSizeInput').addEventListener('change', (event) => setSetting('fontSize', Number(event.target.value)));

  els.paletteInput.addEventListener('input', () => renderPalette(els.paletteInput.value));
  els.paletteInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePalette();
    if (event.key === 'Enter') {
      const first = els.paletteResults.querySelector('.palette-item');
      if (first) first.click();
    }
  });

  document.addEventListener('keydown', (event) => {
    closeContextMenu();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveActive();
    }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      openPalette();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      state.editor.getAction('actions.find').run();
    }
    if (document.activeElement?.closest?.('#fileTree') || document.activeElement === document.body) {
      if (event.key === 'Enter' && state.selectedEntry?.type === 'file') openFilePath(state.selectedEntry.path);
      if (event.key === 'Delete' || event.key === 'Backspace') deleteSelectedEntry();
    }
  });

  els.fileTree.addEventListener('contextmenu', handleTreeBlankContext);
  document.addEventListener('click', closeContextMenu);

  window.anton.onWorkspaceChanged(() => {
    clearTimeout(window.__refreshWorkspaceTimer);
    window.__refreshWorkspaceTimer = setTimeout(refreshWorkspace, 500);
  });
  window.anton.onTerminalData((payload) => {
    appendTerminalToSession(payload.terminalId, payload.text);
  });
  window.anton.onTerminalClear((payload) => {
    clearTerminalSession(payload.terminalId);
  });
  window.anton.onTerminalCwd((payload) => {
    updateTerminalCwd(payload);
  });
  window.anton.onTerminalState((payload) => {
    updateTerminalState(payload);
  });
  window.anton.onOllamaToken((payload) => {
    if (window.__antonTokenHandler) window.__antonTokenHandler(payload);
  });
  createLocalTerminal();
}

function appendTerminalOutput(text) {
  const urlPattern = /(https?:\/\/[^\s"'<>]+|localhost:\d+(?:\/[^\s"'<>]*)?|127\.0\.0\.1:\d+(?:\/[^\s"'<>]*)?)/g;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  for (const match of text.matchAll(urlPattern)) {
    const url = match[0].replace(/[),.;]+$/, '');
    const start = match.index;
    const trailing = match[0].slice(url.length);
    fragment.append(document.createTextNode(text.slice(lastIndex, start)));

    const link = document.createElement('a');
    const href = url.startsWith('http') ? url : `http://${url}`;
    link.href = href;
    link.textContent = url;
    link.className = 'terminal-link';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      window.anton.openExternal(href);
    });
    fragment.append(link);
    if (trailing) fragment.append(document.createTextNode(trailing));
    lastIndex = start + match[0].length;
  }

  fragment.append(document.createTextNode(text.slice(lastIndex)));
  els.terminalOutput.append(fragment);
}

function runTerminalCommand(command) {
  if (!command.trim()) return;
  activatePanel('terminal');
  const terminal = activeTerminal();
  window.anton.runTerminal({ terminalId: terminal.id, command });
}

function setTerminalRunning(running, command = '') {
  els.terminalStop.disabled = !running;
  els.terminalCommand.disabled = running;
  els.terminalCommand.placeholder = running
    ? `Running: ${command || 'process'}`
    : 'Run command in workspace';
}

function setTerminalPrompt(cwd = '') {
  els.terminalPrompt.textContent = cwd ? `${cwd.split(/[\\/]/).pop() || cwd} $` : '$';
  els.terminalPrompt.title = cwd;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}
