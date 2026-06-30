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
    fontSize: 14,
    keepAwake: false
  },
  lastAiResponse: '',
  terminals: [],
  activeTerminalId: null,
  terminalCounter: 0,
  selectedEntry: null,
  expandedDirs: new Set(),
  aiBusy: false,
  currentRequestId: null,
  userAborted: false,
  contextEntry: null,
  searchRoot: null,
  chatHistory: [],
  ollamaModels: [],
  modelDownloadQueue: [],
  activeModelDownload: null,
  modelDownloadStatus: new Map(),
  gitStatus: null,
  gitStatuses: [],
  selectedGitRepoRoot: null,
  mentionCandidates: [],
  mentionActiveIndex: 0,
  gitBusy: false,
  diffEditor: null
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
  mentionMenu: document.querySelector('#mentionMenu'),
  aiLoader: document.querySelector('#aiLoader'),
  keepAwakeToggle: document.querySelector('#keepAwakeToggle'),
  statusLeft: document.querySelector('#statusLeft'),
  statusRight: document.querySelector('#statusRight'),
  searchInput: document.querySelector('#searchInput'),
  searchResults: document.querySelector('#searchResults'),
  scmActivity: document.querySelector('#scmActivity'),
  gitEmpty: document.querySelector('#gitEmpty'),
  gitPanel: document.querySelector('#gitPanel'),
  gitRepoSelect: document.querySelector('#gitRepoSelect'),
  gitRepositories: document.querySelector('#gitRepositories'),
  gitBranchName: document.querySelector('#gitBranchName'),
  gitMeta: document.querySelector('#gitMeta'),
  gitBranchSelect: document.querySelector('#gitBranchSelect'),
  gitNewBranch: document.querySelector('#gitNewBranch'),
  gitCommitMessage: document.querySelector('#gitCommitMessage'),
  gitCommitButton: document.querySelector('#gitCommitButton'),
  gitSync: document.querySelector('#gitSync'),
  gitPull: document.querySelector('#gitPull'),
  gitPush: document.querySelector('#gitPush'),
  gitStageAll: document.querySelector('#gitStageAll'),
  gitUnstageAll: document.querySelector('#gitUnstageAll'),
  gitDiscardAll: document.querySelector('#gitDiscardAll'),
  gitStash: document.querySelector('#gitStash'),
  gitConflictsSection: document.querySelector('#gitConflictsSection'),
  gitConflictsCount: document.querySelector('#gitConflictsCount'),
  gitUnstagedCount: document.querySelector('#gitUnstagedCount'),
  gitStagedCount: document.querySelector('#gitStagedCount'),
  gitConflicts: document.querySelector('#gitConflicts'),
  gitUnstaged: document.querySelector('#gitUnstaged'),
  gitStaged: document.querySelector('#gitStaged'),
  gitStashes: document.querySelector('#gitStashes'),
  terminalOutput: document.querySelector('#terminalOutput'),
  terminalTabs: document.querySelector('#terminalTabs'),
  newTerminal: document.querySelector('#newTerminal'),
  terminalPrompt: document.querySelector('#terminalPrompt'),
  terminalCommand: document.querySelector('#terminalCommand'),
  terminalStop: document.querySelector('#terminalStop'),
  outputLog: document.querySelector('#outputLog'),
  problems: document.querySelector('#problems'),
  modelNameInput: document.querySelector('#modelNameInput'),
  pullModel: document.querySelector('#pullModel'),
  modelProgress: document.querySelector('#modelProgress'),
  modelProgressStatus: document.querySelector('#modelProgressStatus'),
  modelProgressPercent: document.querySelector('#modelProgressPercent'),
  modelProgressFill: document.querySelector('#modelProgressFill'),
  modelList: document.querySelector('#modelList'),
  refreshCatalog: document.querySelector('#refreshCatalog'),
  modelCatalog: document.querySelector('#modelCatalog'),
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
  sendPrompt: document.querySelector('#sendPrompt'),
  planWorkBtn: document.querySelector('#planWorkBtn'),
  newChatBtn: document.querySelector('#newChatBtn'),
  chatHistoryBtn: document.querySelector('#chatHistoryBtn'),
  historyPanel: document.querySelector('#historyPanel'),
  historyList: document.querySelector('#historyList'),
  historyClose: document.querySelector('#historyClose'),
  searchButton: document.querySelector('#searchButton')
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
  ['Plan work from prompt', () => askAnton('plan')],
  ['Fix current file', () => askAnton('fix')],
  ['Generate tests', () => askAnton('tests')],
  ['Apply last AI response', () => applyLastResponse()],
  ['Toggle minimap', () => setSetting('minimap', !state.settings.minimap)],
  ['Toggle word wrap', () => setSetting('wordWrap', !state.settings.wordWrap)]
];

const icons = {
  files: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M4 7h2"/><path d="M4 11h2"/><path d="M4 15h2"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.5-4.5"/></svg>',
  branch: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 9v3a6 6 0 0 0 6 6h3"/><path d="M6 9v9"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>',
  blocks: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1-2 3.4-.2-.1a1.7 1.7 0 0 0-1.8-.1 1.7 1.7 0 0 0-1 1.5V22H9.2v-.3a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.1l-.2.1-2-3.4.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.4-1H3v-4h.2a1.7 1.7 0 0 0 1.4-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1 2-3.4.2.1a1.7 1.7 0 0 0 1.8.1 1.7 1.7 0 0 0 1-1.5V2h5.6v.3a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.1l.2-.1 2 3.4-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.4 1h.2v4h-.2a1.7 1.7 0 0 0-1.4 1z"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m6 6 1 15h10l1-15"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  'list-checks': '<svg viewBox="0 0 24 24"><path d="m3 7 2 2 4-4"/><path d="M11 7h10"/><path d="m3 17 2 2 4-4"/><path d="M11 17h10"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18 9a7 7 0 0 0-11.5-2.7L4 8.8"/><path d="M6 15a7 7 0 0 0 11.5 2.7L20 15.2"/></svg>',
  sync: '<svg viewBox="0 0 24 24"><path d="M7 7h11l-3-3"/><path d="m18 7-3 3"/><path d="M17 17H6l3 3"/><path d="m6 17 3-3"/></svg>',
  'arrow-down': '<svg viewBox="0 0 24 24"><path d="M12 4v14"/><path d="m6 12 6 6 6-6"/></svg>',
  'arrow-up': '<svg viewBox="0 0 24 24"><path d="M12 20V6"/><path d="m6 12 6-6 6 6"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  archive: '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M5 7l1 13h12l1-13"/><path d="M8 3h8l2 4H6z"/><path d="M10 12h4"/></svg>',
  diff: '<svg viewBox="0 0 24 24"><path d="M6 4v16"/><path d="M18 4v16"/><path d="M9 8h4"/><path d="M9 12h7"/><path d="M9 16h5"/></svg>',
  'folder-plus': '<svg viewBox="0 0 24 24"><path d="M3 6h7l2 2h9v11H3z"/><path d="M12 14h6"/><path d="M15 11v6"/></svg>',
  'folder-open': '<svg viewBox="0 0 24 24"><path d="M3 7h7l2 2h9v3"/><path d="M3 19l3-8h16l-3 8z"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 6h7l2 2h9v10H3z"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path d="m9 18-6-6 6-6"/><path d="m15 6 6 6-6 6"/></svg>',
  json: '<svg viewBox="0 0 24 24"><path d="M8 4H6a3 3 0 0 0-3 3v2a3 3 0 0 1-2 3 3 3 0 0 1 2 3v2a3 3 0 0 0 3 3h2"/><path d="M16 4h2a3 3 0 0 1 3 3v2a3 3 0 0 0 2 3 3 3 0 0 0-2 3v2a3 3 0 0 1-3 3h-2"/></svg>',
  css: '<svg viewBox="0 0 24 24"><path d="M4 4h16l-1.5 15L12 21l-6.5-2z"/><path d="M8 8h8"/><path d="M8 12h7"/><path d="m15 12-.4 4-2.6.8-2.6-.8-.2-2"/></svg>',
  markdown: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12"/><path d="M7 15V9l2.5 3L12 9v6"/><path d="M15 9v6"/><path d="m13 13 2 2 2-2"/></svg>',
  terminal: '<svg viewBox="0 0 24 24"><path d="m4 7 5 5-5 5"/><path d="M12 17h8"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  square: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
};

function iconSvg(name) {
  return icons[name] || icons.file;
}

function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((node) => {
    const label = node.textContent.trim();
    node.innerHTML = `<span class="svg-icon" aria-hidden="true">${iconSvg(node.dataset.icon)}</span>${label ? `<span>${label}</span>` : ''}`;
  });
}

require.config({
  paths: {
    vs: '../../node_modules/monaco-editor/min/vs'
  }
});

require(['vs/editor/editor.main'], () => {
  hydrateIcons();
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

  state.diffEditor = monaco.editor.createDiffEditor(document.querySelector('#diffEditor'), {
    theme: 'anton-dark',
    automaticLayout: true,
    readOnly: true,
    originalEditable: false,
    renderSideBySide: true,
    minimap: { enabled: true },
    fontSize: 14,
    fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
    scrollBeyondLastLine: false
  });

  state.editor.setModel(null);
  updateEditorEmptyState();
  updateBreadcrumb();
  updateOutline();
  bindEditorEvents();
  bindUi();
  bindResizableLayout();
  loadModels();
  loadModelCatalog();
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
  if (type === 'directory') return 'folder';
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['js', 'jsx', 'ts', 'tsx', 'html'].includes(ext)) return 'code';
  if (ext === 'json') return 'json';
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  if (ext === 'css') return 'css';
  return 'file';
}

function openVirtualTab(name, content, language) {
  const uri = monaco.Uri.parse(`anton:///${name}`);
  const model = monaco.editor.createModel(content, language, uri);
  const tab = { type: 'file', name, filePath: null, model, dirty: true, modifiedAt: Date.now() };
  state.tabs.push(tab);
  state.activePath = uri.toString();
  state.models.set(state.activePath, tab);
  activateTab(tab);
}

async function openGitDiff(change, staged = false) {
  if (!change?.path) return;
  const repoRoot = change.repoRoot || currentGitRepoRoot();
  const diff = await window.anton.gitDiff({
    repoRoot,
    path: change.path,
    staged,
    status: change.status,
    untracked: change.untracked
  });
  const repoKey = repoRoot || state.workspace?.root || 'workspace';
  const key = `git-diff:${staged ? 'staged' : 'working'}:${repoKey}:${diff.path}`;
  const existing = state.models.get(key);
  if (existing) {
    existing.originalModel.setValue(diff.original || '');
    existing.modifiedModel.setValue(diff.modified || '');
    activateTab(existing);
    return;
  }
  const language = languageFromPath(diff.path);
  const originalModel = monaco.editor.createModel(
    diff.original || '',
    language,
    monaco.Uri.parse(`anton-git-original:///${encodeURIComponent(key)}`)
  );
  const modifiedModel = monaco.editor.createModel(
    diff.modified || '',
    language,
    monaco.Uri.parse(`anton-git-modified:///${encodeURIComponent(key)}`)
  );
  const tab = {
    type: 'diff',
    name: `${fileName(diff.path)} (${staged ? 'Staged' : 'Working Tree'})`,
    filePath: null,
    diffPath: diff.path,
    repoRoot,
    diffKey: key,
    staged,
    originalModel,
    modifiedModel,
    dirty: false
  };
  state.tabs.push(tab);
  state.models.set(key, tab);
  activateTab(tab);
}

function tabKey(tab) {
  return tab?.type === 'diff' ? tab.diffKey : tab?.model?.uri.toString();
}

function setEditorMode(tab) {
  const editorNode = document.querySelector('#editor');
  const diffNode = document.querySelector('#diffEditor');
  const isDiff = tab?.type === 'diff';
  editorNode.classList.toggle('hidden', isDiff);
  diffNode.classList.toggle('hidden', !isDiff);
  if (isDiff) {
    state.editor.setModel(null);
    state.diffEditor.setModel({ original: tab.originalModel, modified: tab.modifiedModel });
  } else {
    state.diffEditor.setModel(null);
    state.editor.setModel(tab?.model || null);
  }
  renderTabs();
  updateEditorEmptyState();
  updateBreadcrumb();
  updateOutline();
}

async function openWorkspace() {
  const workspace = await window.anton.openWorkspace();
  if (!workspace) return;
  state.workspace = workspace;
  state.selectedGitRepoRoot = null;
  state.gitStatus = null;
  state.selectedEntry = { type: 'directory', path: workspace.root, name: workspace.name };
  state.expandedDirs.add(workspace.root);
  els.workspaceName.textContent = workspace.name;
  renderTree(workspace.tree);
  updateSelectedEntry();
  await restoreWorkspaceChat();
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
    type: 'file',
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
  state.activePath = tabKey(tab);
  setEditorMode(tab);
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
  if (!tab || tab.type === 'diff') return;
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
  queueGitRefresh();
}

function renderTabs() {
  els.tabs.innerHTML = '';
  for (const tab of state.tabs) {
    const node = document.createElement('button');
    node.className = `tab ${tabKey(tab) === state.activePath ? 'active' : ''}`;
    node.innerHTML = `<span>${tab.dirty ? '● ' : ''}${tab.name}</span><span class="tab-close svg-icon">${iconSvg('close')}</span>`;
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
  const key = tabKey(tab);
  state.models.delete(key);
  if (tab.type === 'diff') {
    tab.originalModel.dispose();
    tab.modifiedModel.dispose();
  } else {
    tab.model.dispose();
  }

  if (state.activePath === key) {
    const next = state.tabs[Math.max(0, index - 1)];
    if (next) activateTab(next);
    else {
      state.activePath = null;
      setEditorMode(null);
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
    const isExpanded = node.type === 'directory' && state.expandedDirs.has(node.path);
    caret.className = `tree-caret ${node.type === 'directory' ? (isExpanded ? 'expanded' : 'collapsed') : 'empty'}`;
    caret.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = node.name;

    const icon = document.createElement('span');
    icon.className = `tree-icon svg-icon ${fileIcon(node.name, node.type)} ${fileIconClass(node.name, node.type)}`;
    icon.innerHTML = iconSvg(fileIcon(node.name, node.type));

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

function queueGitRefresh(delay = 500) {
  clearTimeout(window.__refreshGitTimer);
  window.__refreshGitTimer = setTimeout(() => refreshGit(), delay);
}

function currentGitRepoRoot() {
  return state.selectedGitRepoRoot || state.gitStatus?.repoRoot || state.workspace?.root || null;
}

function gitPayload(extra = {}) {
  return { repoRoot: currentGitRepoRoot(), ...extra };
}

function gitMetaText(status) {
  const parts = [];
  if (status.repoRelativePath && status.repoRelativePath !== '.') parts.push(status.repoRelativePath);
  if (status.upstream) parts.push(status.upstream);
  if (status.ahead) parts.push(`ahead ${status.ahead}`);
  if (status.behind) parts.push(`behind ${status.behind}`);
  if (status.clean) parts.push('clean');
  return parts.join(' · ') || 'No upstream';
}

function gitBadge(change) {
  if (change.conflicted) return 'U';
  if (change.untracked) return '?';
  return change.status?.trim() || change.indexStatus?.trim() || change.worktreeStatus?.trim() || 'M';
}

function gitChangeCount(status) {
  return (status?.unstaged?.length || 0) + (status?.staged?.length || 0) + (status?.conflicts?.length || 0);
}

function updateScmActivityBadge(total = 0) {
  if (!els.scmActivity) return;
  els.scmActivity.dataset.count = total > 99 ? '99+' : String(total);
  els.scmActivity.classList.toggle('has-badge', total > 0);
}

function renderGitSection(container, changes, mode) {
  container.innerHTML = '';
  if (!changes.length) {
    const empty = document.createElement('div');
    empty.className = 'scm-section-empty';
    empty.textContent = mode === 'staged' ? 'No staged changes.' : mode === 'conflict' ? 'No merge changes.' : 'No changes.';
    container.appendChild(empty);
    return;
  }
  for (const change of changes) {
    change.repoRoot = change.repoRoot || state.gitStatus?.repoRoot || currentGitRepoRoot();
    const row = document.createElement('div');
    row.className = `scm-file-row ${mode}`;
    const staged = mode === 'staged';
    row.innerHTML = `
      <span class="scm-status-badge ${change.conflicted ? 'conflict' : ''}">${gitBadge(change)}</span>
      <span class="svg-icon scm-file-icon">${iconSvg(fileIcon(change.path, 'file'))}</span>
      <span class="scm-file-main">
        <span class="scm-file-name">${escapeHtml(fileName(change.path))}</span>
        <span class="scm-file-path">${escapeHtml(change.path.replace(/[/\\][^/\\]+$/, '') || '.')}</span>
      </span>
      <span class="scm-row-actions">
        <button data-action="diff" title="Open changes">${iconSvg('diff')}</button>
        ${staged ? `<button data-action="unstage" title="Unstage">${iconSvg('minus')}</button>` : `<button data-action="stage" title="Stage">${iconSvg('plus')}</button>`}
        ${!staged ? `<button data-action="discard" title="Discard">${iconSvg('trash')}</button>` : ''}
      </span>
    `;
    row.addEventListener('click', () => openGitDiff(change, staged));
    row.addEventListener('contextmenu', (event) => openScmContextMenu(event, change, staged));
    row.querySelectorAll('button[data-action]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const action = button.dataset.action;
        if (action === 'diff') openGitDiff(change, staged);
        if (action === 'stage') runGitAction(`Staged ${change.path}`, () => window.anton.gitStage(gitPayload({ repoRoot: change.repoRoot, path: change.path })));
        if (action === 'unstage') runGitAction(`Unstaged ${change.path}`, () => window.anton.gitUnstage(gitPayload({ repoRoot: change.repoRoot, path: change.path })));
        if (action === 'discard') discardGitChange(change);
      });
    });
    container.appendChild(row);
  }
}

function renderGitRepositoryGroups(statuses = []) {
  els.gitRepositories.innerHTML = '';
  const repos = statuses.filter((status) => status?.isRepo);
  if (repos.length <= 1) {
    els.gitRepositories.classList.add('hidden');
    return;
  }
  els.gitRepositories.classList.remove('hidden');

  for (const status of repos) {
    const count = gitChangeCount(status);
    const repoLabel = status.repoRelativePath && status.repoRelativePath !== '.' ? status.repoRelativePath : status.repoName;
    const group = document.createElement('section');
    group.className = `scm-repo-group ${status.repoRoot === state.selectedGitRepoRoot ? 'active' : ''}`;
    group.innerHTML = `
      <button class="scm-repo-group-head" type="button">
        <span class="svg-icon scm-repo-group-icon">${iconSvg('branch')}</span>
        <span class="scm-repo-group-main">
          <span class="scm-repo-group-name">${escapeHtml(repoLabel || 'Repository')}</span>
          <span class="scm-repo-group-meta">${escapeHtml(status.branch || 'detached')}${status.upstream ? ` · ${escapeHtml(status.upstream)}` : ''}</span>
        </span>
        <span class="scm-repo-group-count">${count}</span>
      </button>
      <div class="scm-repo-group-body">
        <div class="scm-repo-commit">
          <textarea placeholder="Message" rows="1"></textarea>
          <button type="button" disabled>Commit</button>
        </div>
      </div>
    `;
    group.querySelector('.scm-repo-group-head').addEventListener('click', async () => {
      state.selectedGitRepoRoot = status.repoRoot;
      await refreshGit();
    });

    const body = group.querySelector('.scm-repo-group-body');
    const commitInput = group.querySelector('.scm-repo-commit textarea');
    const commitButton = group.querySelector('.scm-repo-commit button');
    const updateRepoCommitButton = () => {
      commitButton.disabled = state.gitBusy || !status.staged.length || !commitInput.value.trim();
    };
    commitInput.addEventListener('input', updateRepoCommitButton);
    commitButton.addEventListener('click', () => runGitAction(`Committed changes in ${repoLabel || 'repository'}`, async () => {
      await window.anton.gitCommit({ repoRoot: status.repoRoot, message: commitInput.value });
      commitInput.value = '';
    }));
    updateRepoCommitButton();

    if (status.conflicts.length) {
      const title = document.createElement('div');
      title.className = 'scm-section-title nested';
      title.innerHTML = `<span>Merge Changes</span><span>${status.conflicts.length}</span>`;
      const list = document.createElement('div');
      body.append(title, list);
      renderGitSection(list, status.conflicts.map((change) => ({ ...change, repoRoot: status.repoRoot })), 'conflict');
    }
    const changesTitle = document.createElement('div');
    changesTitle.className = 'scm-section-title nested';
    changesTitle.innerHTML = `<span>Changes</span><span>${status.unstaged.length}</span>`;
    const changesList = document.createElement('div');
    body.append(changesTitle, changesList);
    renderGitSection(changesList, status.unstaged.map((change) => ({ ...change, repoRoot: status.repoRoot })), 'unstaged');

    const stagedTitle = document.createElement('div');
    stagedTitle.className = 'scm-section-title nested';
    stagedTitle.innerHTML = `<span>Staged Changes</span><span>${status.staged.length}</span>`;
    const stagedList = document.createElement('div');
    body.append(stagedTitle, stagedList);
    renderGitSection(stagedList, status.staged.map((change) => ({ ...change, repoRoot: status.repoRoot })), 'staged');

    els.gitRepositories.appendChild(group);
  }
}

function renderGitStashes(stashes) {
  els.gitStashes.innerHTML = '';
  if (!stashes.length) {
    const empty = document.createElement('div');
    empty.className = 'scm-section-empty';
    empty.textContent = 'No stashes.';
    els.gitStashes.appendChild(empty);
    return;
  }
  for (const stash of stashes) {
    const row = document.createElement('div');
    row.className = 'scm-stash-row';
    row.innerHTML = `<span>${escapeHtml(stash.ref)}</span><small>${escapeHtml(stash.message || '')}</small><button title="Pop stash">Pop</button>`;
    row.querySelector('button').addEventListener('click', () => runGitAction(`Popped ${stash.ref}`, () => window.anton.gitStashPop(gitPayload({ stashRef: stash.ref }))));
    els.gitStashes.appendChild(row);
  }
}

function renderGitRepositories(repositories = [], currentRoot) {
  els.gitRepoSelect.innerHTML = '';
  if (!repositories.length) {
    els.gitRepoSelect.classList.add('hidden');
    return;
  }
  els.gitRepoSelect.classList.add('hidden');
  for (const repo of repositories) {
    const option = document.createElement('option');
    option.value = repo.path;
    option.textContent = repo.relativePath === '.' ? repo.name : `${repo.name} (${repo.relativePath})`;
    els.gitRepoSelect.appendChild(option);
  }
  if (currentRoot) els.gitRepoSelect.value = currentRoot;
}

function renderGitBranches(branches, currentBranch) {
  els.gitBranchSelect.innerHTML = '';
  for (const branch of branches) {
    const option = document.createElement('option');
    option.value = branch.name;
    option.textContent = branch.current ? `${branch.name} ✓` : branch.name;
    els.gitBranchSelect.appendChild(option);
  }
  if (currentBranch) els.gitBranchSelect.value = currentBranch;
}

function renderGit(status, branches = [], stashes = [], statuses = []) {
  state.gitStatus = status;
  state.gitStatuses = statuses.length ? statuses : (status?.isRepo ? [status] : []);
  updateScmActivityBadge(state.gitStatuses.reduce((total, item) => total + gitChangeCount(item), 0));
  const isRepo = Boolean(status?.isRepo);
  els.gitPanel.classList.toggle('hidden', !isRepo);
  els.gitPanel.classList.toggle('multi-repo', state.gitStatuses.length > 1);
  els.gitEmpty.classList.toggle('hidden', isRepo);
  if (!isRepo) {
    els.gitEmpty.textContent = status?.reason || 'No Git repository.';
    renderGitRepositories(status?.repositories || [], null);
    renderGitRepositoryGroups([]);
    return;
  }
  state.selectedGitRepoRoot = status.repoRoot || state.selectedGitRepoRoot;
  renderGitRepositories(status.repositories || [], status.repoRoot);
  renderGitRepositoryGroups(state.gitStatuses);
  const repoLabel = status.repoRelativePath && status.repoRelativePath !== '.' ? status.repoRelativePath : status.repoName;
  els.gitBranchName.textContent = `${repoLabel || 'Repository'} · ${status.branch || 'detached'}`;
  els.gitMeta.textContent = gitMetaText(status);
  els.gitUnstagedCount.textContent = String(status.unstaged.length);
  els.gitStagedCount.textContent = String(status.staged.length);
  els.gitConflictsCount.textContent = String(status.conflicts.length);
  els.gitConflictsSection.classList.toggle('hidden', !status.conflicts.length);
  renderGitBranches(branches, status.branch);
  renderGitSection(els.gitConflicts, status.conflicts, 'conflict');
  renderGitSection(els.gitUnstaged, status.unstaged, 'unstaged');
  renderGitSection(els.gitStaged, status.staged, 'staged');
  renderGitStashes(stashes);
  updateGitButtons();
}

function updateGitButtons() {
  const status = state.gitStatus;
  const hasStaged = Boolean(status?.staged?.length);
  const hasUnstaged = Boolean(status?.unstaged?.length || status?.conflicts?.length);
  const isRepo = Boolean(status?.isRepo);
  const busy = state.gitBusy;
  els.gitCommitButton.disabled = busy || !isRepo || !hasStaged || !els.gitCommitMessage.value.trim();
  [els.gitSync, els.gitPull, els.gitPush, els.gitStageAll, els.gitUnstageAll, els.gitDiscardAll, els.gitStash, els.gitBranchSelect, els.gitRepoSelect, els.gitNewBranch].forEach((node) => {
    node.disabled = busy || !isRepo;
  });
  els.gitStageAll.disabled = busy || !isRepo || !hasUnstaged;
  els.gitUnstageAll.disabled = busy || !isRepo || !hasStaged;
  els.gitDiscardAll.disabled = busy || !isRepo || !hasUnstaged;
}

async function refreshGit() {
  try {
    const status = await window.anton.gitStatus({ repoRoot: state.selectedGitRepoRoot });
    if (status.isRepo) state.selectedGitRepoRoot = status.repoRoot;
    const repositories = status.repositories || [];
    const statuses = status.isRepo
      ? await Promise.all(
        repositories.map((repo) =>
          window.anton.gitStatus({ repoRoot: repo.path }).catch(() => null)
        )
      ).then((items) => items.filter(Boolean))
      : [];
    let branches = [];
    let stashes = [];
    if (status.isRepo) {
      const payload = { repoRoot: status.repoRoot };
      [branches, stashes] = await Promise.all([
        window.anton.gitBranches(payload).catch(() => []),
        window.anton.gitStashList(payload).catch(() => [])
      ]);
    }
    renderGit(status, branches, stashes, statuses);
  } catch (error) {
    renderGit({ isRepo: false, reason: error.message, branch: 'Git error', staged: [], unstaged: [], conflicts: [], clean: true });
    setStatus(error.message);
  }
}

async function runGitAction(successMessage, action) {
  try {
    state.gitBusy = true;
    updateGitButtons();
    setStatus('Running Git command...');
    await action();
    setStatus(successMessage);
  } catch (error) {
    setStatus(error.message);
    alert(error.message);
  } finally {
    state.gitBusy = false;
    await refreshGit();
  }
}

function discardGitChange(change) {
  const ok = confirm(`Discard changes in ${change.path}? This cannot be undone.`);
  if (!ok) return;
  runGitAction(`Discarded ${change.path}`, () => window.anton.gitDiscard(gitPayload(change)));
}

function openScmContextMenu(event, change, staged) {
  event.preventDefault();
  els.contextMenu.innerHTML = '';
  const repoRoot = change.repoRoot || currentGitRepoRoot();
  const absolutePath = repoRoot ? `${repoRoot}/${change.path}` : change.path;
  const items = [
    ['Open File', () => openFilePath(absolutePath)],
    ['Open Changes', () => openGitDiff(change, staged)],
    staged ? ['Unstage', () => runGitAction(`Unstaged ${change.path}`, () => window.anton.gitUnstage(gitPayload({ repoRoot, path: change.path })))] : ['Stage', () => runGitAction(`Staged ${change.path}`, () => window.anton.gitStage(gitPayload({ repoRoot, path: change.path })))],
    !staged && ['Discard Changes', () => discardGitChange(change)],
    'separator',
    ['Copy Path', () => window.anton.writeClipboard(absolutePath)],
    ['Reveal in Finder', () => window.anton.revealFile(absolutePath)]
  ].filter(Boolean);
  for (const item of items) {
    if (item === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'menu-separator';
      els.contextMenu.appendChild(sep);
      continue;
    }
    const [labelText, action] = item;
    const row = document.createElement('div');
    row.className = 'menu-item';
    row.innerHTML = `<span>${labelText}</span><span></span>`;
    row.addEventListener('click', () => {
      closeContextMenu();
      action();
    });
    els.contextMenu.appendChild(row);
  }
  els.contextMenu.style.left = `${Math.min(event.clientX, window.innerWidth - 240)}px`;
  els.contextMenu.style.top = `${Math.min(event.clientY, window.innerHeight - 320)}px`;
  els.contextMenu.classList.remove('hidden');
}

async function loadModels() {
  const selected = els.modelSelect.value;
  els.modelSelect.innerHTML = '';
  try {
    const models = await window.anton.listModels();
    state.ollamaModels = models.map((model) => model.name);
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model.name;
      option.textContent = model.name;
      els.modelSelect.appendChild(option);
    }
    const preferred =
      models.find((model) => model.name === selected) ||
      models.find((model) => model.name.includes('qwen2.5-coder:3b')) ||
      models.find((model) => model.name.includes('qwen2.5-coder:7b')) ||
      models[0];
    if (preferred) els.modelSelect.value = preferred.name;
    els.activeModel.textContent = els.modelSelect.value || 'No model';
    renderModelList(models);
    if (els.modelCatalog.children.length) renderModelCatalog(window.__antonModelCatalog || [], window.__antonModelCatalogSource || '');
    setStatus(models.length ? `${models.length} Ollama models ready` : 'No Ollama models');
  } catch (error) {
    state.ollamaModels = [];
    els.activeModel.textContent = 'Ollama offline';
    renderModelList([]);
    setStatus('Ollama offline');
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function renderModelList(models) {
  els.modelList.innerHTML = '';
  if (!models.length) {
    els.modelList.className = 'model-list empty';
    els.modelList.textContent = 'No models installed.';
    return;
  }
  els.modelList.className = 'model-list';
  for (const model of models) {
    const row = document.createElement('div');
    row.className = 'model-item';
    const size = formatBytes(model.size);
    row.innerHTML = `
      <div class="model-item-main">
        <strong>${escapeHtml(model.name)}</strong>
        <span>${size || 'Local model'}</span>
      </div>
      <button class="model-use">Use</button>
      <button class="model-delete" title="Delete model"><span data-icon="trash"></span></button>
    `;
    row.querySelector('.model-use').addEventListener('click', () => {
      els.modelSelect.value = model.name;
      els.activeModel.textContent = model.name;
      setStatus(`Using ${model.name}`);
    });
    row.querySelector('.model-delete').addEventListener('click', () => deleteModel(model.name));
    hydrateIcons(row);
    els.modelList.appendChild(row);
  }
}

async function loadModelCatalog() {
  els.modelCatalog.className = 'model-catalog empty';
  els.modelCatalog.textContent = 'Loading available models...';
  try {
    const result = await window.anton.catalogModels();
    renderModelCatalog(result.models || [], result.source);
  } catch (error) {
    els.modelCatalog.textContent = `Could not load model catalog: ${error.message}`;
  }
}

function renderModelCatalog(models, source = '') {
  window.__antonModelCatalog = models;
  window.__antonModelCatalogSource = source;
  const installed = new Set(state.ollamaModels);
  els.modelCatalog.innerHTML = '';
  if (!models.length) {
    els.modelCatalog.className = 'model-catalog empty';
    els.modelCatalog.textContent = 'No downloadable models found.';
    return;
  }

  els.modelCatalog.className = 'model-catalog';
  const sourceRow = document.createElement('div');
  sourceRow.className = 'catalog-source';
  sourceRow.textContent = source === 'ollama.com'
    ? 'From Ollama library. Size labels are model parameter sizes.'
    : 'Fallback catalog. Connect to the internet and refresh for the full Ollama library.';
  els.modelCatalog.appendChild(sourceRow);

  for (const model of models.slice(0, 220)) {
    const row = document.createElement('div');
    row.className = 'catalog-item';
    const isInstalled = installed.has(model.tag);
    const downloadStatus = state.modelDownloadStatus.get(model.tag);
    const isQueued = downloadStatus?.state === 'queued';
    const isDownloading = downloadStatus?.state === 'downloading';
    const isFailed = downloadStatus?.state === 'failed';
    const label = isInstalled
      ? 'Installed'
      : isDownloading
        ? 'Downloading'
        : isQueued
          ? 'Queued'
          : isFailed
            ? 'Retry'
            : 'Download';
    row.innerHTML = `
      <div class="catalog-item-main">
        <strong>${escapeHtml(model.tag)}</strong>
        <span>${escapeHtml(model.size || 'latest')} parameters${model.description ? ` · ${escapeHtml(model.description)}` : ''}</span>
      </div>
      <button class="catalog-download" ${isInstalled || isQueued || isDownloading ? 'disabled' : ''}>
        <span data-icon="${isInstalled ? 'square' : isQueued || isDownloading ? 'clock' : 'download'}"></span>
        <span>${label}</span>
      </button>
    `;
    row.querySelector('.catalog-download').addEventListener('click', () => {
      els.modelNameInput.value = model.tag;
      enqueueModelDownload(model.tag);
    });
    hydrateIcons(row);
    els.modelCatalog.appendChild(row);
  }
}

function setModelProgress({ visible, status = '', percent = null }) {
  els.modelProgress.classList.toggle('hidden', !visible);
  if (!visible) return;
  els.modelProgressStatus.textContent = status || 'Working';
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
  els.modelProgressPercent.textContent = safePercent === null ? '' : `${Math.round(safePercent)}%`;
  els.modelProgressFill.style.width = safePercent === null ? '100%' : `${safePercent}%`;
  els.modelProgressFill.classList.toggle('indeterminate', safePercent === null);
}

function setModelDownloadStatus(name, patch) {
  const current = state.modelDownloadStatus.get(name) || {};
  state.modelDownloadStatus.set(name, { ...current, ...patch });
  if (window.__antonModelCatalog) renderModelCatalog(window.__antonModelCatalog, window.__antonModelCatalogSource || '');
}

function enqueueModelDownload(name) {
  if (!name) {
    setStatus('Enter a model name to download.');
    return;
  }
  if (state.ollamaModels.includes(name)) {
    setStatus(`${name} is already installed.`);
    return;
  }
  if (state.activeModelDownload?.name === name || state.modelDownloadQueue.some((item) => item.name === name)) {
    setStatus(`${name} is already queued.`);
    return;
  }
  const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  state.modelDownloadQueue.push({ name, requestId });
  setModelDownloadStatus(name, { state: 'queued', percent: 0 });
  els.modelNameInput.value = '';
  setModelProgress({ visible: true, status: `Queued ${name}`, percent: null });
  setStatus(`Queued ${name}`);
  processModelDownloadQueue();
}

async function processModelDownloadQueue() {
  if (state.activeModelDownload || !state.modelDownloadQueue.length) return;
  const item = state.modelDownloadQueue.shift();
  state.activeModelDownload = item;
  setModelDownloadStatus(item.name, { state: 'downloading', percent: null });
  setModelProgress({ visible: true, status: `Starting ${item.name}`, percent: null });
  setStatus(`Downloading ${item.name}...`);
  try {
    await window.anton.pullModel(item);
    state.modelDownloadStatus.delete(item.name);
    setModelProgress({ visible: true, status: `Downloaded ${item.name}`, percent: 100 });
    await loadModels();
    els.modelSelect.value = item.name;
    els.activeModel.textContent = item.name;
    setStatus(`Downloaded ${item.name}`);
  } catch (error) {
    setModelDownloadStatus(item.name, { state: 'failed', error: error.message });
    setModelProgress({ visible: true, status: `${item.name} failed: ${error.message}`, percent: null });
    setStatus(`Download failed: ${item.name}`);
  } finally {
    state.activeModelDownload = null;
    renderDownloadQueueSummary();
    processModelDownloadQueue();
  }
}

async function pullModel() {
  const name = els.modelNameInput.value.trim();
  enqueueModelDownload(name);
}

function updateActiveDownloadProgress(payload) {
  if (!payload?.name) return;
  const isComplete = /success|done|complete/i.test(payload.status || '');
  const percent = isComplete
    ? 100
    : Number.isFinite(payload.total) && payload.total > 0
    ? (Number(payload.completed || 0) / Number(payload.total)) * 100
    : null;
  setModelDownloadStatus(payload.name, {
    state: 'downloading',
    percent,
    status: payload.status
  });
  const detail = payload.total
    ? `${payload.name}: ${payload.status || 'Downloading'} ${formatBytes(payload.completed || 0)} / ${formatBytes(payload.total)}`
    : `${payload.name}: ${payload.status || 'Downloading'}`;
  setModelProgress({ visible: true, status: detail, percent });
  setStatus(`${payload.name}: ${payload.status || 'downloading'}`);
}

function renderDownloadQueueSummary() {
  if (!state.activeModelDownload && !state.modelDownloadQueue.length) {
    setModelProgress({ visible: false });
    return;
  }
  const active = state.activeModelDownload ? `Active: ${state.activeModelDownload.name}` : '';
  const queued = state.modelDownloadQueue.length ? `Queued: ${state.modelDownloadQueue.map((item) => item.name).join(', ')}` : '';
  if (active || queued) {
    setModelProgress({ visible: true, status: [active, queued].filter(Boolean).join(' · '), percent: null });
  }
}

async function deleteModel(name) {
  if (!name) return;
  const confirmed = window.confirm(`Delete ${name} from Ollama?`);
  if (!confirmed) return;
  setStatus(`Deleting ${name}...`);
  try {
    await window.anton.deleteModel({ name });
    await loadModels();
    setStatus(`Deleted ${name}`);
  } catch (error) {
    setStatus(`Could not delete ${name}: ${error.message}`);
  }
}

function addMessage(role, text, { persist = true, durationMs = null } = {}) {
  const baseRole = role.split(/\s+/)[0];
  const shouldStick = baseRole === 'user' || isMessagesNearBottom();
  const node = renderMessageNode(role, text, { durationMs });
  els.messages.appendChild(node);
  if (shouldStick) scrollMessagesToBottom();
  if (persist && !role.includes('pending')) persistMessage(baseRole, text, { durationMs });
  return node;
}

function isMessagesNearBottom(threshold = 80) {
  return els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight <= threshold;
}

function scrollMessagesToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderInlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
}

function renderMarkdown(text) {
  const source = (text || '').trim();
  if (!source) return '';

  const blocks = source.split(/(```[\s\S]*?```)/g);
  return blocks.map((block) => {
    if (block.startsWith('```')) {
      const code = block.replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/```$/, '');
      return `<pre><code>${escapeHtml(code.trimEnd())}</code></pre>`;
    }

    const lines = block.split('\n');
    const html = [];
    let listType = null;

    const closeList = () => {
      if (!listType) return;
      html.push(`</${listType}>`);
      listType = null;
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        closeList();
        continue;
      }

      const ordered = line.match(/^\d+\.\s+(.+)$/);
      const unordered = line.match(/^[-*]\s+(.+)$/);
      if (ordered || unordered) {
        const nextList = ordered ? 'ol' : 'ul';
        if (listType !== nextList) {
          closeList();
          html.push(`<${nextList}>`);
          listType = nextList;
        }
        html.push(`<li>${renderInlineMarkdown((ordered || unordered)[1])}</li>`);
        continue;
      }

      closeList();
      html.push(`<p>${renderInlineMarkdown(line)}</p>`);
    }

    closeList();
    return html.join('');
  }).join('');
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins ? `${mins}m ${String(secs).padStart(2, '0')}s` : `${secs}s`;
}

function messageMetaHtml(durationMs) {
  return Number.isFinite(durationMs) ? `<div class="message-meta">Completed in ${formatDuration(durationMs)}</div>` : '';
}

function setMessageMarkdown(node, text, { durationMs = null } = {}) {
  node.innerHTML = `<div class="message-content">${renderMarkdown(text)}</div>${messageMetaHtml(durationMs)}`;
}

function setMessageText(node, text, { durationMs = null } = {}) {
  node.textContent = text;
  if (Number.isFinite(durationMs)) {
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = `Completed in ${formatDuration(durationMs)}`;
    node.appendChild(meta);
  }
}

function renderMessageNode(role, text, { durationMs = null } = {}) {
  const node = document.createElement('div');
  node.className = `message ${role}`;
  if (role === 'assistant') setMessageMarkdown(node, text, { durationMs });
  else setMessageText(node, text, { durationMs });
  return node;
}

function createRunProgress(node, steps) {
  const startedAt = Date.now();
  let progressSteps = [...steps];
  let currentIndex = 0;
  let currentTitle = progressSteps[0] || 'Working';
  let currentLocation = null;
  let detailed = false;
  let done = false;

  // Keep the node collapsed until the first render fills it with content
  node.style.display = 'none';

  const render = () => {
    const shouldStick = isMessagesNearBottom();
    node.className = 'message assistant pending';
    if (!detailed) {
      node.innerHTML = `
        <div class="thinking-row">
          <span class="spinner"></span>
          <span>Anton is thinking...</span>
          <span class="agent-progress-time">${formatDuration(Date.now() - startedAt)}</span>
        </div>`;
      node.style.display = '';
      if (shouldStick) scrollMessagesToBottom();
      return;
    }
    const locationHtml = currentLocation ? `
        <div class="agent-current ${currentLocation.file ? '' : 'agent-current-muted'}">
          <div class="agent-current-row">
            <span class="agent-current-label">File</span>
            <span class="agent-current-value">${escapeHtml(currentLocation.file || 'No file selected yet')}</span>
          </div>
          <div class="agent-current-row">
            <span class="agent-current-label">Section</span>
            <span class="agent-current-value">${escapeHtml(currentLocation.section || 'Choosing the next section')}</span>
          </div>
          <div class="agent-current-row">
            <span class="agent-current-label">Action</span>
            <span class="agent-current-value">${escapeHtml(currentLocation.action || currentTitle || 'Working')}</span>
          </div>
        </div>` : '';
    node.innerHTML = `
      <div class="agent-progress">
        <div class="agent-progress-head">
          <span class="spinner"></span>
          <span class="agent-progress-title">${escapeHtml(formatAgentText(currentTitle || progressSteps[currentIndex] || 'Working'))}</span>
          <span class="agent-progress-time">${formatDuration(Date.now() - startedAt)}</span>
        </div>
        ${locationHtml}
        <ol class="agent-steps">
          ${progressSteps.map((step, index) => {
            const stateClass = index < currentIndex ? 'done' : index === currentIndex ? 'active' : '';
            return `<li class="${stateClass}"><span></span>${escapeHtml(step)}</li>`;
          }).join('')}
        </ol>
      </div>`;
    node.style.display = '';
    if (shouldStick) scrollMessagesToBottom();
  };

  const interval = setInterval(() => {
    if (!done) render();
  }, 1000);
  render();

  return {
    startedAt,
    setStep(label) {
      const index = progressSteps.indexOf(label);
      currentIndex = index >= 0 ? index : Math.min(currentIndex + 1, progressSteps.length - 1);
      if (index < 0 && progressSteps.length) progressSteps[currentIndex] = label;
      currentTitle = label;
      render();
    },
    setTaskPlan(plan, stepIndex = 0, title = '', location = undefined) {
      detailed = true;
      if (Array.isArray(plan) && plan.length) {
        progressSteps = plan.map(formatAgentPlanStep);
        currentIndex = Math.max(0, Math.min(progressSteps.length - 1, Number(stepIndex) || 0));
      }
      currentTitle = title || progressSteps[currentIndex] || 'Working through task plan';
      if (location !== undefined) currentLocation = location;
      render();
    },
    expandToSteps(nextSteps = progressSteps, title = '') {
      detailed = true;
      if (Array.isArray(nextSteps) && nextSteps.length) {
        progressSteps = nextSteps;
        currentIndex = Math.max(0, Math.min(currentIndex, progressSteps.length - 1));
      }
      currentTitle = title || currentTitle || progressSteps[currentIndex] || 'Working';
      render();
    },
    setLocation(location = null) {
      currentLocation = location;
      render();
    },
    completeTaskPlan(title = 'Task finished') {
      currentIndex = progressSteps.length;
      currentTitle = title;
      currentLocation = {
        file: '',
        section: 'All planned work has completed',
        action: title
      };
      render();
    },
    stopUpdates() {
      done = true;
      clearInterval(interval);
    },
    finish() {
      done = true;
      clearInterval(interval);
      return Date.now() - startedAt;
    }
  };
}

function formatAgentPlanStep(step) {
  if (typeof step === 'string') {
    const trimmed = step.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(formatAgentPlanStep).join(' -> ');
        return formatAgentPlanStep(parsed);
      } catch {
        return step;
      }
    }
    return step;
  }
  if (!step || typeof step !== 'object') return String(step || 'Work on task');
  if (step.action && !step.tool) return describeAgentAction(step.action, step.arguments || {});
  if (step.task || step.description || step.step || step.title || step.name) {
    const label = step.task || step.description || step.step || step.title || step.name;
    const toolName = step.tool || step.action;
    const action = toolName ? ` (${toolName}${step.arguments?.path ? `: ${step.arguments.path}` : step.arguments?.command ? `: ${step.arguments.command}` : ''})` : '';
    return `${label}${action}`;
  }
  if (step.tool) return describeAgentAction(step.tool, step.arguments || {});
  return JSON.stringify(step);
}

function formatAgentText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return String(value || '');
  return formatAgentPlanStep(value);
}

function normalizeAgentPlan(plan) {
  if (Array.isArray(plan)) return plan;
  if (!plan || typeof plan !== 'object') return [];
  if (Array.isArray(plan.steps)) return plan.steps;
  if (Array.isArray(plan.tasks)) return plan.tasks;
  if (Array.isArray(plan.plan)) return plan.plan;
  return Object.values(plan).filter((value) => typeof value === 'string' || typeof value === 'object');
}

function isLowQualityAgentPlan(plan) {
  if (!Array.isArray(plan) || !plan.length) return true;
  const formatted = plan.map(formatAgentPlanStep).map((step) => step.trim()).filter(Boolean);
  if (formatted.length < 3) return true;
  const generic = new Set(['readfile', 'writefile', 'runcommand', 'done', 'edit', 'read', 'write', 'inspect', 'update', 'change', 'fix']);
  const genericCount = formatted.filter((step) => generic.has(step.toLowerCase())).length;
  return genericCount >= Math.ceil(formatted.length * 0.5);
}

function buildInitialEditPlan(instruction, files = []) {
  const lowerInstruction = instruction.toLowerCase();
  const mentionedFiles = resolvePromptMentions(instruction).map((mention) => mention.path);
  const likelyFiles = files.filter((file) => {
    const lowerFile = file.toLowerCase();
    if (/\btheme|style|layout|color|background|font|button|ui|screen|page|webpage\b/.test(lowerInstruction)) {
      return /\.(css|scss|html|tsx|jsx|ts|js)$/.test(lowerFile) &&
        /(style|css|app|main|index|component|page|layout)/.test(lowerFile);
    }
    return /\.(tsx|jsx|ts|js|css|html|json)$/.test(lowerFile);
  }).slice(0, 4);
  const targetFiles = [
    ...mentionedFiles,
    ...likelyFiles.filter((file) => !mentionedFiles.includes(file))
  ].slice(0, 6);
  const targetLabel = targetFiles.length ? targetFiles.join(', ') : 'the relevant project files';
  return [
    `Understand the requested change: ${instruction}`,
    `Inspect likely target files: ${targetLabel}`,
    'Apply the code changes to the affected file or files',
    'Verify the result and report the changed files'
  ];
}

function inferPlanStepIndex(plan, tool, args = {}, fallback = 0) {
  if (!Array.isArray(plan) || !plan.length) return 0;
  const needle = String(args.path || args.command || tool || '').toLowerCase();
  if (!needle) return Math.max(0, Math.min(plan.length - 1, Number(fallback) || 0));
  const index = plan.findIndex((step) => formatAgentPlanStep(step).toLowerCase().includes(needle));
  if (index >= 0) return index;
  return Math.max(0, Math.min(plan.length - 1, Number(fallback) || 0));
}

function describeAgentAction(tool, args = {}) {
  if (tool === 'runCommand') return `Running command: ${args.command || '(missing command)'}`;
  if (tool === 'fileStats') return `Checking file size: ${args.path || '(missing path)'}`;
  if (tool === 'outlineFile') return `Outlining file: ${args.path || '(missing path)'}`;
  if (tool === 'searchFile') return `Searching ${args.path || '(missing path)'} for "${args.query || ''}"`;
  if (tool === 'readFileRange') return `Reading ${args.path || '(missing path)'} lines ${args.startLine || '?'}-${args.endLine || '?'}`;
  if (tool === 'replaceRange') return `Replacing ${args.path || '(missing path)'} lines ${args.startLine || '?'}-${args.endLine || '?'}`;
  if (tool === 'insertAtLine') return `Inserting into ${args.path || '(missing path)'} at line ${args.line || '?'}`;
  if (tool === 'deleteRange') return `Deleting ${args.path || '(missing path)'} lines ${args.startLine || '?'}-${args.endLine || '?'}`;
  if (tool === 'readFile') return `Reading file: ${args.path || '(missing path)'}`;
  if (tool === 'writeFile') return `Writing file: ${args.path || '(missing path)'}`;
  if (tool === 'done') return 'Finishing task';
  return `Using tool: ${tool || 'unknown'}`;
}

function describeAgentLocation(tool, args = {}) {
  const path = args.path || '';
  const action = describeAgentAction(tool, args);
  let section = '';

  if (tool === 'runCommand') {
    section = args.command ? `Command: ${args.command}` : 'Terminal command';
  } else if (tool === 'fileStats') {
    section = 'Checking file size, line count, and large-file status';
  } else if (tool === 'outlineFile') {
    section = 'Building symbols, imports, selectors, and line references';
  } else if (tool === 'searchFile') {
    section = `Searching for "${args.query || ''}"`;
  } else if (tool === 'readFileRange') {
    section = `Reading lines ${args.startLine || '?'}-${args.endLine || '?'}`;
  } else if (tool === 'replaceRange') {
    section = `Replacing lines ${args.startLine || '?'}-${args.endLine || '?'}`;
  } else if (tool === 'insertAtLine') {
    section = `Inserting at line ${args.line || '?'}`;
  } else if (tool === 'deleteRange') {
    section = `Deleting lines ${args.startLine || '?'}-${args.endLine || '?'}`;
  } else if (tool === 'readFile') {
    section = 'Reading the full file';
  } else if (tool === 'writeFile') {
    section = 'Writing the full file';
  } else if (tool === 'done') {
    section = 'Finalizing the task';
  } else {
    section = 'Choosing the next section';
  }

  return { file: path, section, action };
}

function saveChatHistory() {
  if (!state.workspace?.root) return;
  window.anton.saveChat({
    workspacePath: state.workspace.root,
    messages: state.chatHistory
  }).catch(() => setStatus('Could not save chat history.'));
}

function persistMessage(role, text, { durationMs = null } = {}) {
  if (!state.workspace?.root || !text?.trim()) return;
  state.chatHistory.push({
    role,
    text: text.trim(),
    durationMs,
    createdAt: new Date().toISOString()
  });
  saveChatHistory();
}

async function restoreWorkspaceChat() {
  els.messages.innerHTML = '';
  state.chatHistory = [];
  if (!state.workspace?.root) return;
  try {
    const messages = await window.anton.loadChat(state.workspace.root);
    state.chatHistory = Array.isArray(messages)
      ? messages.filter((message) => ['user', 'assistant', 'system'].includes(message.role) && typeof message.text === 'string')
      : [];
    for (const message of state.chatHistory) {
      els.messages.appendChild(renderMessageNode(message.role, message.text, { durationMs: message.durationMs }));
    }
    scrollMessagesToBottom();
  } catch {
    setStatus('Could not load chat history.');
  }
}

function newChat() {
  els.messages.innerHTML = '<div class="message system">New conversation started.</div>';
  state.chatHistory = [];
  saveChatHistory();
  setStatus('New chat started');
}

function playNotificationSound() {
  const audio = new Audio('assets/mixkit-long-pop-2358.wav');
  audio.play().catch((err) => console.error('Error playing notification sound:', err));
}

async function openChatHistory() {
  els.historyPanel.classList.remove('hidden');
  els.historyList.innerHTML = '<div class="history-empty">Loading...</div>';
  try {
    const sessions = await window.anton.listChats();
    els.historyList.innerHTML = '';
    if (!sessions.length) {
      els.historyList.innerHTML = '<div class="history-empty">No saved conversations yet.</div>';
      return;
    }
    for (const session of sessions) {
      const item = document.createElement('div');
      item.className = 'history-item';
      const workspaceName = session.workspaceRoot.split('/').pop() || session.workspaceRoot;
      const savedDate = session.savedAt ? new Date(session.savedAt).toLocaleString() : 'Unknown date';
      item.innerHTML = `
        <div class="history-item-workspace">${escapeHtml(workspaceName)}</div>
        <div class="history-item-meta">${savedDate} · ${session.messageCount} messages</div>
        <div class="history-item-preview">${escapeHtml(session.preview || '(no messages)')}</div>
      `;
      item.addEventListener('click', async () => {
        els.historyPanel.classList.add('hidden');
        const messages = await window.anton.loadChatById(session.id);
        els.messages.innerHTML = '';
        state.chatHistory = Array.isArray(messages)
          ? messages.filter((m) => ['user', 'assistant', 'system'].includes(m.role))
          : [];
        for (const message of state.chatHistory) {
          els.messages.appendChild(renderMessageNode(message.role, message.text, { durationMs: message.durationMs }));
        }
        scrollMessagesToBottom();
        setStatus(`Loaded conversation from ${workspaceName}`);
      });
      els.historyList.appendChild(item);
    }
  } catch {
    els.historyList.innerHTML = '<div class="history-empty">Could not load history.</div>';
  }
}

function normalizeAiResponse(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';

  const fencedJson = trimmed.match(/^```json\s*([\s\S]*?)\s*```$/i);
  if (fencedJson) {
    try {
      const parsed = JSON.parse(fencedJson[1]);
      if (typeof parsed.response === 'string') return parsed.response.trim();
      if (typeof parsed.answer === 'string') return parsed.answer.trim();
      if (typeof parsed.message === 'string') return parsed.message.trim();
    } catch {
      return fencedJson[1].trim();
    }
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed.response === 'string') return parsed.response.trim();
    if (typeof parsed.answer === 'string') return parsed.answer.trim();
    if (typeof parsed.message === 'string') return parsed.message.trim();
  } catch {
    // Plain text is the expected path.
  }

  return trimmed;
}

function directChatResponse(instruction, route) {
  const text = String(instruction || '').trim().toLowerCase();
  if (!text || route?.needsProjectContext || route?.intent === 'edit') return '';

  if (/^(hi|hello|hey|yo|sup|good\s+(morning|afternoon|evening))[\s!.?]*$/.test(text)) {
    return 'Hi, I am Anton. I can help you understand this project, edit files, plan work, run terminal commands, and manage local models.';
  }

  if (/\b(what(?:'s| is)\s+your\s+name|who\s+are\s+you|your\s+name)\b/.test(text)) {
    return 'My name is Anton. I am the local coding assistant built into this IDE.';
  }

  if (/\b(what\s+can\s+you\s+do|how\s+can\s+you\s+help|what\s+do\s+you\s+do)\b/.test(text)) {
    return [
      'I can help with coding inside this IDE: explain files, summarize projects, plan changes, edit files, run terminal commands, and manage local Ollama models.',
      'For simple safe edits I can act directly. For larger tasks I break the work into steps and use the agent loop.'
    ].join('\n\n');
  }

  return '';
}

function parseJsonObject(text) {
  const trimmed = (text || '').trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const source = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1));
    throw new Error('The model did not return valid edit JSON.');
  }
}

function workspacePathFromRelative(relative) {
  if (!state.workspace?.root || !relative) return null;
  const clean = relative.replace(/^[/\\]+/, '');
  return `${state.workspace.root}/${clean}`;
}

async function validateWorkspaceEdit(filePath, nextContent) {
  let current = '';
  try {
    current = (await window.anton.readFile(filePath)).content || '';
  } catch {
    return;
  }

  const currentLength = current.trim().length;
  const nextLength = nextContent.trim().length;
  if (currentLength < 600) return;

  const removedTooMuch = nextLength < currentLength * 0.65;
  const lostManyLines = nextContent.split('\n').length < current.split('\n').length * 0.65;
  if (removedTooMuch || lostManyLines) {
    throw new Error(`Refusing destructive edit to ${relativeWorkspacePath(filePath)}. The model removed too much existing content. Ask for a more specific edit or open the target file first.`);
  }
}

function makeFuzzyRegex(oldText) {
  const escaped = oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const optionalSemicolons = escaped.replace(/;/g, ';?');
  const pattern = optionalSemicolons.replace(/\s+/g, (match, offset, string) => {
    const prevChar = string[offset - 1];
    const nextChar = string[offset + match.length];
    const isPrevWord = prevChar && /\w/.test(prevChar);
    const isNextWord = nextChar && /\w/.test(nextChar);
    return (isPrevWord && isNextWord) ? '\\s+' : '\\s*';
  });
  return new RegExp(pattern);
}

async function applyWorkspaceEdits(editPlan) {
  const edits = Array.isArray(editPlan?.edits) ? editPlan.edits : [];
  if (!edits.length) throw new Error('The model did not return any file edits.');

  const byPath = new Map();
  for (const edit of edits.slice(0, 16)) {
    if (!edit?.path) continue;
    const list = byPath.get(edit.path) || [];
    list.push(edit);
    byPath.set(edit.path, list);
  }

  const changed = [];
  for (const [editPath, fileEdits] of byPath) {
    const filePath = workspacePathFromRelative(editPath);
    if (!filePath) continue;
    if (!filePath.startsWith(`${state.workspace.root}/`)) throw new Error(`Refusing to edit outside the workspace: ${editPath}`);

    let nextContent = '';
    try {
      nextContent = (await window.anton.readFile(filePath)).content || '';
    } catch {
      nextContent = '';
    }

    for (const edit of fileEdits) {
      const operation = edit.operation || (typeof edit.oldText === 'string' && typeof edit.newText === 'string' ? 'replace' : 'rewrite');
      if (operation === 'replace') {
        if (typeof edit.oldText !== 'string' || typeof edit.newText !== 'string') {
          throw new Error(`Invalid replace edit for ${editPath}.`);
        }
        if (nextContent.includes(edit.oldText)) {
          nextContent = nextContent.replace(edit.oldText, edit.newText);
        } else {
          const fuzzyRegex = makeFuzzyRegex(edit.oldText);
          if (!fuzzyRegex.test(nextContent)) {
            throw new Error(`Could not apply edit to ${editPath}; the target text was not found.`);
          }
          nextContent = nextContent.replace(fuzzyRegex, edit.newText);
        }
      } else if (operation === 'append') {
        nextContent += edit.content || edit.newText || '';
      } else if (operation === 'prepend') {
        nextContent = `${edit.content || edit.newText || ''}${nextContent}`;
      } else if (operation === 'rewrite') {
        if (typeof edit.content !== 'string') throw new Error(`Invalid rewrite edit for ${editPath}.`);
        nextContent = edit.content;
      } else {
        throw new Error(`Unsupported edit operation "${operation}" for ${editPath}.`);
      }
    }

    await validateWorkspaceEdit(filePath, nextContent);
    const result = await window.anton.saveFile({ filePath, content: nextContent });
    changed.push(result.filePath);

    const tab = state.tabs.find((candidate) => candidate.filePath === result.filePath);
    if (tab) {
      tab.model.setValue(result.content);
      tab.dirty = false;
      tab.modifiedAt = result.modifiedAt;
      tab.name = result.name;
    }
  }

  const workspace = await window.anton.refreshWorkspace();
  if (workspace) {
    state.workspace = workspace;
    renderTree(workspace.tree);
    updateSelectedEntry();
  }
  renderTabs();
  if (changed[0]) await openFilePath(changed[0]);
  return changed.map(relativeWorkspacePath);
}

function extractRequestedCssColor(instruction) {
  const tokens = extractCssColorTokens(instruction);
  return tokens[0]?.value || '';
}

function extractCssColorTokens(instruction) {
  const namedColors = [
    'black', 'white', 'pink', 'purple', 'green', 'blue', 'red', 'yellow',
    'orange', 'gray', 'grey', 'brown', 'cyan', 'teal', 'navy', 'lime'
  ];
  const tokens = [];
  const patterns = [
    /#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi,
    /rgba?\([^)]+\)/gi,
    new RegExp(`\\b(?:${namedColors.join('|')})\\b`, 'gi')
  ];
  for (const pattern of patterns) {
    for (const match of instruction.matchAll(pattern)) {
      tokens.push({ value: match[0], index: match.index || 0 });
    }
  }
  return tokens.sort((a, b) => a.index - b.index);
}

function nearestColorAfterKeyword(instruction, keywordPattern) {
  const tokens = extractCssColorTokens(instruction);
  if (!tokens.length) return '';
  const matches = [...instruction.matchAll(keywordPattern)];
  if (!matches.length) return '';
  for (const match of matches) {
    const keywordIndex = match.index || 0;
    const after = tokens.find((token) => token.index >= keywordIndex);
    if (after) return after.value;
  }
  return '';
}

function requestedCssColorChanges(instruction) {
  const text = instruction.toLowerCase();
  const tokens = extractCssColorTokens(instruction);
  if (!tokens.length) return [];

  const changes = [];
  const backgroundColor = nearestColorAfterKeyword(instruction, /\bbackground(?:-color)?\b/gi);
  const textColor = nearestColorAfterKeyword(instruction, /\b(?:text|font|foreground)\b/gi);

  if (backgroundColor) changes.push({ property: 'background', value: backgroundColor });
  if (textColor) changes.push({ property: 'color', value: textColor });

  if (!changes.length) {
    const property = /\b(text|font|foreground)\b/.test(text) && !/\bbackground\b/.test(text) ? 'color' : 'background';
    changes.push({ property, value: tokens[0].value });
  }

  return changes.filter((change, index, all) =>
    all.findIndex((candidate) => candidate.property === change.property) === index
  );
}

function isSimpleCssColorRequest(instruction) {
  const text = instruction.toLowerCase();
  const asksColor = /\b(background|background-color|text|font|color|theme)\b/.test(text);
  const asksChange = /\b(make|change|set|turn|give|update)\b/.test(text);
  const hasColor = Boolean(extractRequestedCssColor(instruction));
  const avoidsComplexWork = !/\b(layout|spacing|responsive|animation|component|button|navbar|sidebar|rewrite|build|implement|fix)\b/.test(text);
  return asksColor && asksChange && hasColor && avoidsComplexWork;
}

function pickCssEditTarget() {
  const files = editableWorkspaceFiles().filter((file) => /\.css$/i.test(file));
  if (!files.length) return '';
  const tab = activeTab();
  const activeRelative = tab?.filePath ? relativeWorkspacePath(tab.filePath) : '';
  if (activeRelative && /\.css$/i.test(activeRelative) && files.includes(activeRelative)) return activeRelative;

  const preferred = [
    /src\/styles\/app\.css$/i,
    /src\/app\.css$/i,
    /src\/styles\/index\.css$/i,
    /src\/index\.css$/i,
    /src\/main\.css$/i,
    /app\.css$/i,
    /index\.css$/i
  ];
  for (const pattern of preferred) {
    const match = files.find((file) => pattern.test(file));
    if (match) return match;
  }
  return files[0];
}

function upsertCssPropertyInRule(content, selectorPattern, property, value) {
  const rule = content.match(selectorPattern);
  if (!rule) return null;

  const fullRule = rule[0];
  const openIndex = fullRule.indexOf('{');
  const closeIndex = fullRule.lastIndexOf('}');
  if (openIndex < 0 || closeIndex < openIndex) return null;

  const body = fullRule.slice(openIndex + 1, closeIndex);
  const propertyRegex = new RegExp(`(^|\\n)(\\s*)${property}\\s*:\\s*[^;]+;?`, 'i');
  let nextBody = '';
  if (propertyRegex.test(body)) {
    nextBody = body.replace(propertyRegex, (match, prefix, indent) => `${prefix}${indent}${property}: ${value};`);
  } else {
    const indent = body.match(/\n(\s*)\S/)?.[1] || '  ';
    const trimmed = body.trimEnd();
    const needsSemicolon = trimmed && !/[;{]\s*$/.test(trimmed);
    nextBody = `${trimmed}${needsSemicolon ? ';' : ''}\n${indent}${property}: ${value};\n`;
  }
  return content.replace(fullRule, `${fullRule.slice(0, openIndex + 1)}${nextBody}${fullRule.slice(closeIndex)}`);
}

function applySimpleCssColorChange(content, instruction) {
  const changes = requestedCssColorChanges(instruction);
  if (!changes.length) return null;

  const selectors = [
    /(?:^|\n)\s*:root\s*\{[\s\S]*?\}/i,
    /(?:^|\n)\s*(?:html\s*,\s*)?body(?:\s*,\s*#root)?\s*\{[\s\S]*?\}/i,
    /(?:^|\n)\s*#root\s*\{[\s\S]*?\}/i,
    /(?:^|\n)\s*\.app-shell\s*\{[\s\S]*?\}/i,
    /(?:^|\n)\s*\.app\s*\{[\s\S]*?\}/i,
    /(?:^|\n)\s*\.App\s*\{[\s\S]*?\}/
  ];

  let next = content;
  let applied = false;
  for (const change of changes) {
    let changedThisProperty = false;
    for (const selector of selectors) {
      const changed = upsertCssPropertyInRule(next, selector, change.property, change.value);
      if (changed && changed !== next) {
        next = changed;
        applied = true;
        changedThisProperty = true;
      }
    }
    if (!changedThisProperty) {
      next = `html,\nbody,\n#root {\n  ${change.property}: ${change.value};\n}\n\n${next}`;
      applied = true;
    }
  }

  if (applied) return next;
  const declarations = changes.map((change) => `  ${change.property}: ${change.value};`).join('\n');
  return `html,\nbody,\n#root {\n${declarations}\n}\n\n${content}`;
}

async function tryQuickCssColorEdit(instruction, progress) {
  if (!state.workspace?.root || !isSimpleCssColorRequest(instruction)) return null;
  const target = pickCssEditTarget();
  if (!target) return null;

  progress.setTaskPlan(
    [`Patch ${target}`, 'Refresh workspace', 'Open changed stylesheet'],
    0,
    `Applying quick CSS edit to ${target}`,
    {
      file: target,
      section: 'Simple CSS color change',
      action: 'Applying direct stylesheet patch'
    }
  );

  const filePath = workspacePathFromRelative(target);
  const current = (await window.anton.readFile(filePath)).content || '';
  const next = applySimpleCssColorChange(current, instruction);
  if (!next || next === current) return null;

  const result = await window.anton.saveFile({ filePath, content: next });
  const tab = state.tabs.find((candidate) => candidate.filePath === result.filePath);
  if (tab) {
    tab.model.setValue(result.content);
    tab.dirty = false;
    tab.modifiedAt = result.modifiedAt;
    tab.name = result.name;
  }

  progress.setTaskPlan(
    [`Patch ${target}`, 'Refresh workspace', 'Open changed stylesheet'],
    1,
    `Saved ${target}`,
    {
      file: target,
      section: 'Saved stylesheet',
      action: 'Refreshing workspace'
    }
  );

  const workspace = await window.anton.refreshWorkspace();
  if (workspace) {
    state.workspace = workspace;
    renderTree(workspace.tree);
    updateSelectedEntry();
  }
  renderTabs();
  await openFilePath(result.filePath);
  progress.completeTaskPlan('Quick CSS edit finished.');
  return {
    changedFiles: [target],
    summary: `Applied the simple CSS color change directly in ${target}.`
  };
}

function findEditableFileByHint(hint, extensions = []) {
  const cleaned = String(hint || '').trim().replace(/^['"`]|['"`]$/g, '');
  if (!cleaned) return '';
  const files = editableWorkspaceFiles();
  const lower = cleaned.toLowerCase();
  const extensionSet = new Set(extensions.map((ext) => ext.replace(/^\./, '').toLowerCase()));
  const extensionOk = (file) => {
    if (!extensionSet.size) return true;
    const ext = (file.split('.').pop() || '').toLowerCase();
    return extensionSet.has(ext);
  };
  return files.find((file) => file.toLowerCase() === lower && extensionOk(file)) ||
    files.find((file) => file.toLowerCase().endsWith(`/${lower}`) && extensionOk(file)) ||
    files.find((file) => file.toLowerCase().includes(lower) && extensionOk(file)) ||
    '';
}

function parseQuotedValue(text) {
  const quoted = String(text || '').match(/["'`](.+?)["'`]/);
  return quoted ? quoted[1].trim() : '';
}

function detectExactReplaceTask(instruction) {
  const active = activeTab();
  if (!active?.filePath) return null;
  const text = instruction.trim();
  const match = text.match(/\b(?:replace|change)\s+["'`](.+?)["'`]\s+(?:with|to)\s+["'`](.+?)["'`]/i);
  if (!match) return null;
  return {
    kind: 'exactReplace',
    file: relativeWorkspacePath(active.filePath),
    oldText: match[1],
    newText: match[2]
  };
}

function detectHtmlTitleTask(instruction) {
  const text = instruction.trim();
  if (!/\b(title|browser tab|document title)\b/i.test(text)) return null;
  if (!/\b(change|set|update|make)\b/i.test(text)) return null;
  const title = parseQuotedValue(text) || text.match(/\b(?:to|as)\s+(.+?)\s*$/i)?.[1]?.trim();
  if (!title || title.length > 120) return null;
  const target = findEditableFileByHint('index.html', ['html']);
  if (!target) return null;
  return { kind: 'htmlTitle', file: target, title };
}

function detectPackageScriptTask(instruction) {
  const text = instruction.trim();
  if (!/\b(script|npm script|package\.json)\b/i.test(text)) return null;
  if (!/\b(add|create|set|update|change)\b/i.test(text)) return null;
  const explicit = text.match(/\b(?:script|npm script)\s+["'`]?([a-z0-9:_-]+)["'`]?\s+(?:to|as|that runs|run|=)\s+["'`](.+?)["'`]/i);
  const compact = text.match(/\b(?:add|create|set)\s+["'`]?([a-z0-9:_-]+)["'`]?\s+(?:script\s+)?(?:to|as|that runs|run|=)\s+["'`](.+?)["'`]/i);
  const match = explicit || compact;
  if (!match) return null;
  const target = findEditableFileByHint('package.json', ['json']);
  if (!target) return null;
  return { kind: 'packageScript', file: target, scriptName: match[1], command: match[2] };
}

function detectCreateFileTask(instruction) {
  const text = instruction.trim();
  const match = text.match(/\b(?:create|add|make)\s+(?:a\s+)?(?:new\s+)?file\s+(?:called|named)?\s*["'`]?([A-Za-z0-9_./ -]+\.[A-Za-z0-9]+)["'`]?/i);
  if (!match) return null;
  const file = match[1].trim().replace(/\s+$/, '');
  if (!file || file.includes('..') || file.startsWith('/')) return null;
  const quotedContent = text.match(/\b(?:with|containing)\s+["'`]([\s\S]+?)["'`]\s*$/i);
  return { kind: 'createFile', file, content: quotedContent ? quotedContent[1] : '' };
}

function detectQuickTask(instruction) {
  const candidates = [
    detectExactReplaceTask,
    detectHtmlTitleTask,
    detectPackageScriptTask,
    detectCreateFileTask
  ];
  for (const detect of candidates) {
    const task = detect(instruction);
    if (task) return task;
  }
  if (isSimpleCssColorRequest(instruction)) {
    return { kind: 'cssColor' };
  }
  return null;
}

async function saveQuickTaskFile(relative, content) {
  const filePath = workspacePathFromRelative(relative);
  if (!filePath) throw new Error(`Invalid path ${relative}`);
  await validateWorkspaceEdit(filePath, content);
  const result = await window.anton.saveFile({ filePath, content });
  const tab = state.tabs.find((candidate) => candidate.filePath === result.filePath);
  if (tab) {
    tab.model.setValue(result.content);
    tab.dirty = false;
    tab.modifiedAt = result.modifiedAt;
    tab.name = result.name;
  }
  return result;
}

async function finishQuickTask(progress, result, statusText = 'Quick task finished.') {
  const changed = Array.isArray(result.changedFiles) ? result.changedFiles : [];
  progress.completeTaskPlan(statusText);
  const workspace = await window.anton.refreshWorkspace();
  if (workspace) {
    state.workspace = workspace;
    renderTree(workspace.tree);
    updateSelectedEntry();
  }
  renderTabs();
  if (changed[0]) {
    const filePath = workspacePathFromRelative(changed[0]);
    if (filePath) await openFilePath(filePath);
  }
  return result;
}

async function tryQuickTask(instruction, progress) {
  if (!state.workspace?.root) return null;
  const task = detectQuickTask(instruction);
  if (!task) return null;

  if (task.kind === 'cssColor') {
    return tryQuickCssColorEdit(instruction, progress);
  }

  const target = task.file;
  progress.setTaskPlan(
    [`Understand single-step task`, `Update ${target}`, 'Refresh workspace'],
    0,
    `Running quick task: ${task.kind}`,
    {
      file: target || '',
      section: 'Single-step deterministic task',
      action: `Preparing ${task.kind}`
    }
  );

  if (task.kind === 'exactReplace') {
    const filePath = workspacePathFromRelative(task.file);
    const current = (await window.anton.readFile(filePath)).content || '';
    if (!current.includes(task.oldText)) return null;
    const next = current.replace(task.oldText, task.newText);
    await saveQuickTaskFile(task.file, next);
    return finishQuickTask(progress, {
      changedFiles: [task.file],
      summary: `Replaced the exact text in ${task.file}.`
    });
  }

  if (task.kind === 'htmlTitle') {
    const filePath = workspacePathFromRelative(task.file);
    const current = (await window.anton.readFile(filePath)).content || '';
    const safeTitle = escapeHtml(task.title);
    const next = /<title>[\s\S]*?<\/title>/i.test(current)
      ? current.replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`)
      : current.replace(/<head([^>]*)>/i, `<head$1>\n    <title>${safeTitle}</title>`);
    if (next === current) return null;
    await saveQuickTaskFile(task.file, next);
    return finishQuickTask(progress, {
      changedFiles: [task.file],
      summary: `Updated the HTML title in ${task.file}.`
    });
  }

  if (task.kind === 'packageScript') {
    const filePath = workspacePathFromRelative(task.file);
    const current = (await window.anton.readFile(filePath)).content || '';
    const json = JSON.parse(current);
    json.scripts = json.scripts && typeof json.scripts === 'object' ? json.scripts : {};
    json.scripts[task.scriptName] = task.command;
    await saveQuickTaskFile(task.file, `${JSON.stringify(json, null, 2)}\n`);
    return finishQuickTask(progress, {
      changedFiles: [task.file],
      summary: `Updated the ${task.scriptName} script in ${task.file}.`
    });
  }

  if (task.kind === 'createFile') {
    await saveQuickTaskFile(task.file, task.content);
    return finishQuickTask(progress, {
      changedFiles: [task.file],
      summary: `Created ${task.file}.`
    });
  }

  return null;
}

function workspaceContext() {
  const files = [];
  function walk(nodes = []) {
    for (const node of nodes) {
      if (node.type === 'file') files.push(node);
      if (node.children) walk(node.children);
    }
  }
  walk(state.workspace?.tree || []);
  return files;
}

function relativeWorkspacePath(filePath) {
  if (!state.workspace?.root) return filePath;
  return filePath.replace(state.workspace.root, '').replace(/^[/\\]/, '');
}

function shouldIncludeInAiContext(filePath) {
  const relative = relativeWorkspacePath(filePath);
  if (/package-lock\.json$/.test(relative)) return false;
  if (/(^|\/)(node_modules|dist|build|\.git)\//.test(relative)) return false;
  return /\.(js|jsx|ts|tsx|json|css|html|md|yml|yaml|toml|env|txt)$/i.test(relative);
}

function shouldUseProjectContext(mode, instruction) {
  if (mode !== 'custom') return true;
  if (/@[^\s]+/.test(instruction)) return true;
  return /\b(project|workspace|folder|file|files|codebase|app|component|function|bug|fix|error|summari[sz]e|explain|review|implement|add|change|refactor|test|read|inspect)\b/i.test(instruction);
}

function deterministicIntentRoute(instruction, mode) {
  if (mode !== 'custom') {
    return {
      intent: ['explain', 'tests', 'plan'].includes(mode) ? 'chat' : 'edit',
      needsProjectContext: true,
      effectiveInstruction: instruction
    };
  }

  const text = instruction.toLowerCase();
  const asksAboutProject = /\b(current\s+project|this\s+project|the\s+project|my\s+project|workspace|codebase|folder|files)\b/.test(text);
  const asksForSummary = /\b(summarize|summarise|summary|overview|what\s+is\s+this|explain\s+this\s+project|describe\s+this\s+project)\b/.test(text);
  if (state.workspace?.root && (asksAboutProject || asksForSummary) && shouldUseProjectContext(mode, instruction)) {
    return {
      intent: 'chat',
      needsProjectContext: true,
      effectiveInstruction: instruction,
      reason: 'Project-aware question detected locally.'
    };
  }

  const asksForEdit = /\b(change|modify|update|fix|create|delete|remove|add|implement|build|refactor|rename|style|make)\b/.test(text);
  if (state.workspace?.root && asksForEdit && shouldUseProjectContext(mode, instruction)) {
    return {
      intent: 'edit',
      needsProjectContext: true,
      effectiveInstruction: instruction,
      reason: 'Project edit request detected locally.'
    };
  }

  return null;
}

function workspaceSummary() {
  const files = workspaceContext();
  if (!state.workspace) return '(no workspace open)';
  return `Workspace open: ${state.workspace.name} (${files.length} files). File contents are only attached when the request needs project context.`;
}

async function buildWorkspaceContext({ includeSnippets = true } = {}) {
  const files = workspaceContext();
  if (!files.length) return '(no workspace open)';

  const paths = files.map((file) => relativeWorkspacePath(file.path)).slice(0, 100);
  if (!includeSnippets) {
    return [
      'Workspace file tree:',
      paths.join('\n')
    ].join('\n');
  }

  const candidates = files
    .filter((file) => shouldIncludeInAiContext(file.path))
    .sort((a, b) => {
      const ar = relativeWorkspacePath(a.path);
      const br = relativeWorkspacePath(b.path);
      const score = (name) => {
        if (/package\.json$/.test(name)) return 0;
        if (/src\/App\.(tsx|jsx|ts|js)$/.test(name)) return 1;
        if (/src\/main\.(tsx|jsx|ts|js)$/.test(name)) return 2;
        if (/src\//.test(name)) return 3;
        return 4;
      };
      return score(ar) - score(br) || ar.localeCompare(br);
    })
    .slice(0, 8);

  let budget = 16000;
  const snippets = [];
  const outlines = [];
  for (const file of candidates) {
    if (budget <= 0) break;
    try {
      const relative = relativeWorkspacePath(file.path);
      const stats = await window.anton.fileStats(file.path);
      if (stats.isLarge) {
        const outline = await window.anton.outlineFile(file.path);
        outlines.push([
          `--- ${relative} (large file: ${stats.lineCount} lines, ${formatBytes(stats.size)}) ---`,
          outline.symbols.slice(0, 60).map((symbol) => `${symbol.line}: ${symbol.kind} ${symbol.name}`).join('\n') || '(no outline symbols found)'
        ].join('\n'));
        continue;
      }
      const result = await window.anton.readFile(file.path);
      const content = result.content.slice(0, Math.min(2500, budget));
      budget -= content.length;
      snippets.push(`--- ${relative} ---\n${content}`);
    } catch {
      // Skip unreadable files rather than failing the AI request.
    }
  }

  return [
    'Workspace file tree:',
    paths.join('\n'),
    '',
    'Large-file outlines:',
    outlines.length ? outlines.join('\n\n') : '(no large source files detected in selected context)',
    '',
    'Readable project file excerpts:',
    snippets.length ? snippets.join('\n\n') : '(no readable source files included)'
  ].join('\n');
}

function editableWorkspaceFiles() {
  return workspaceContext()
    .filter((file) => shouldIncludeInAiContext(file.path))
    .map((file) => relativeWorkspacePath(file.path));
}

function pageMentionCandidates() {
  const files = workspaceContext()
    .filter((file) => shouldIncludeInAiContext(file.path))
    .map((file) => {
      const relative = relativeWorkspacePath(file.path);
      const lower = relative.toLowerCase();
      let score = 40;
      if (/(^|\/)(pages?|app|routes?|views?|screens?)\//.test(lower)) score -= 16;
      if (/(page|route|screen|view|layout|index|app)\.(tsx|jsx|ts|js|html|css)$/i.test(relative)) score -= 12;
      if (/\.(tsx|jsx|html)$/i.test(relative)) score -= 8;
      if (/\.(css|scss)$/i.test(relative)) score -= 5;
      if (/(component|components)\//.test(lower)) score -= 4;
      return {
        path: relative,
        absolutePath: file.path,
        name: fileName(relative),
        directory: relative.replace(/[/\\][^/\\]+$/, '') || '.',
        score
      };
    })
    .sort((a, b) => a.score - b.score || a.path.localeCompare(b.path));
  return files.slice(0, 250);
}

function mentionQueryAtCaret() {
  const input = els.prompt;
  const caret = input.selectionStart || 0;
  const before = input.value.slice(0, caret);
  const match = before.match(/(^|\s)@([^\s@]*)$/);
  if (!match) return null;
  return {
    query: match[2] || '',
    start: caret - match[2].length - 1,
    end: caret
  };
}

function matchingMentionCandidates(query) {
  const needle = String(query || '').toLowerCase();
  return pageMentionCandidates()
    .filter((candidate) => {
      if (!needle) return true;
      return candidate.path.toLowerCase().includes(needle) || candidate.name.toLowerCase().includes(needle);
    })
    .slice(0, 12);
}

function closeMentionMenu() {
  els.mentionMenu.classList.add('hidden');
  els.mentionMenu.innerHTML = '';
  state.mentionCandidates = [];
  state.mentionActiveIndex = 0;
}

function renderMentionMenu(queryInfo) {
  if (!queryInfo || !state.workspace?.root) {
    closeMentionMenu();
    return;
  }
  const candidates = matchingMentionCandidates(queryInfo.query);
  state.mentionCandidates = candidates;
  state.mentionActiveIndex = Math.max(0, Math.min(state.mentionActiveIndex, candidates.length - 1));
  if (!candidates.length) {
    closeMentionMenu();
    return;
  }

  els.mentionMenu.innerHTML = '';
  candidates.forEach((candidate, index) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `mention-item ${index === state.mentionActiveIndex ? 'active' : ''}`;
    row.innerHTML = `
      <span class="svg-icon mention-icon">${iconSvg(fileIcon(candidate.path, 'file'))}</span>
      <span class="mention-main">
        <span class="mention-name">${escapeHtml(candidate.name)}</span>
        <span class="mention-path">${escapeHtml(candidate.directory)}</span>
      </span>
    `;
    row.addEventListener('mousedown', (event) => {
      event.preventDefault();
      insertMention(candidate, queryInfo);
    });
    els.mentionMenu.appendChild(row);
  });
  els.mentionMenu.classList.remove('hidden');
}

function updateMentionMenu() {
  renderMentionMenu(mentionQueryAtCaret());
}

function insertMention(candidate, queryInfo = mentionQueryAtCaret()) {
  if (!candidate || !queryInfo) return;
  const value = els.prompt.value;
  const mention = `@${candidate.path}`;
  const nextValue = `${value.slice(0, queryInfo.start)}${mention} ${value.slice(queryInfo.end)}`;
  const nextCaret = queryInfo.start + mention.length + 1;
  els.prompt.value = nextValue;
  els.prompt.focus();
  els.prompt.setSelectionRange(nextCaret, nextCaret);
  closeMentionMenu();
}

function resolvePromptMentions(instruction) {
  const candidates = pageMentionCandidates();
  if (!candidates.length) return [];
  const byPath = new Map(candidates.map((candidate) => [candidate.path.toLowerCase(), candidate]));
  const byName = new Map();
  for (const candidate of candidates) {
    const key = candidate.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, candidate);
  }
  const found = [];
  const seen = new Set();
  const matches = String(instruction || '').matchAll(/@([^\s,;:)\]}]+)/g);
  for (const match of matches) {
    const token = match[1].replace(/[.?!]+$/, '').toLowerCase();
    const candidate = byPath.get(token) || byName.get(token) || candidates.find((item) => item.path.toLowerCase().endsWith(`/${token}`));
    if (candidate && !seen.has(candidate.path)) {
      seen.add(candidate.path);
      found.push(candidate);
    }
  }
  return found;
}

async function buildMentionContext(mentions) {
  if (!mentions.length) return '';
  const blocks = [];
  for (const mention of mentions.slice(0, 4)) {
    try {
      const stats = await window.anton.fileStats(mention.absolutePath);
      if (stats.isLarge) {
        const outline = await window.anton.outlineFile(mention.absolutePath);
        blocks.push([
          `--- @${mention.path} (large file: ${stats.lineCount} lines, ${formatBytes(stats.size)}) ---`,
          outline.symbols.slice(0, 80).map((symbol) => `${symbol.line}: ${symbol.kind} ${symbol.name}`).join('\n') || '(no outline symbols found)'
        ].join('\n'));
      } else {
        const result = await window.anton.readFile(mention.absolutePath);
        blocks.push(`--- @${mention.path} ---\n${(result.content || '').slice(0, 8000)}`);
      }
    } catch (error) {
      blocks.push(`--- @${mention.path} ---\nCould not read referenced file: ${error.message}`);
    }
  }
  return [
    'User-mentioned page/file targets:',
    mentions.map((mention) => `- @${mention.path}`).join('\n'),
    '',
    blocks.join('\n\n')
  ].join('\n');
}

function mentionInstructionSuffix(mentions) {
  if (!mentions.length) return '';
  return [
    '',
    'The user explicitly referenced these page/file targets. Prioritize them when answering, planning, or editing:',
    mentions.map((mention) => `- @${mention.path}`).join('\n')
  ].join('\n');
}

function heuristicEditTargets(instruction, tab) {
  const files = editableWorkspaceFiles();

  return files
    .map((relative) => {
      const ext = (relative.split('.').pop() || '').toLowerCase();
      let score = 20;
      if (tab?.filePath && relativeWorkspacePath(tab.filePath) === relative) score -= 20;
      if (/src\/App\.(tsx|jsx|ts|js)$/i.test(relative)) score -= 8;
      if (/src\/main\.(tsx|jsx|ts|js)$/i.test(relative)) score -= 7;
      if (/src\/index\.(tsx|jsx|ts|js|html)$/i.test(relative)) score -= 6;
      if (/src\/styles?\/.+\.css$/i.test(relative) || /src\/.+\.css$/i.test(relative)) score -= 5;
      if (['tsx', 'jsx', 'ts', 'js', 'css', 'html'].includes(ext)) score -= 3;
      if (/package\.json$/i.test(relative)) score -= 2;
      return { relative, score };
    })
    .sort((a, b) => a.score - b.score || a.relative.localeCompare(b.relative))
    .slice(0, 4)
    .map((item) => item.relative);
}

async function selectEditTargets({ model, instruction, tab, requestId }) {
  const files = editableWorkspaceFiles();
  if (!files.length) return [];
  const prompt = [
    'You are Anton selecting the smallest set of project files needed for an edit.',
    'Return ONLY JSON: {"targetFiles":["relative/path"],"reason":"short reason"}',
    'Pick at most 4 files. Prefer the exact CSS/component/config file that likely owns the requested change.',
    'Do not pick package-lock.json unless explicitly requested.',
    '',
    '<user_request>',
    instruction,
    '</user_request>',
    '',
    `<active_file>${tab?.filePath ? relativeWorkspacePath(tab.filePath) : '(none)'}</active_file>`,
    '',
    '<workspace_files>',
    files.slice(0, 200).join('\n'),
    '</workspace_files>'
  ].join('\n');

  try {
    const raw = await generateWithFallback({ model, prompt, stream: false, requestId, format: 'json', timeoutMs: 0, allowFallback: false });
    const parsed = parseJsonObject(raw);
    const targets = Array.isArray(parsed.targetFiles)
      ? parsed.targetFiles.filter((file) => files.includes(file)).slice(0, 4)
      : [];
    return targets.length ? targets : heuristicEditTargets(instruction, tab);
  } catch {
    return heuristicEditTargets(instruction, tab);
  }
}

async function buildTargetedEditContext(targetFiles) {
  const files = editableWorkspaceFiles();
  const sections = [];
  for (const relative of targetFiles.slice(0, 4)) {
    const filePath = workspacePathFromRelative(relative);
    if (!filePath) continue;
    try {
      const result = await window.anton.readFile(filePath);
      sections.push(`--- ${relative} ---\n${result.content || ''}`);
    } catch {
      // Ignore unreadable files.
    }
  }

  return [
    'Editable workspace files:',
    files.slice(0, 200).join('\n'),
    '',
    'Selected target file contents:',
    sections.join('\n\n') || '(no target files could be read)'
  ].join('\n');
}

function cleanIpcErrorMessage(error) {
  return String(error?.message || error || 'Unknown error')
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();
}

async function generateWithFallback({ model, prompt, stream, requestId, format, timeoutMs }) {
  if (!model) throw new Error('No local model is selected.');
  try {
    return await window.anton.generate({ model, prompt, stream, requestId, format, timeoutMs });
  } catch (error) {
    throw new Error(`Selected model ${model} failed: ${cleanIpcErrorMessage(error)}`);
  }
}

function buildEditPrompt({ instruction, projectContext, tab, code, previousFailure = '' }) {
  const prompt = [
    'You are Anton, a local coding agent inside a desktop IDE.',
    'The user wants you to modify project files. Return ONLY valid JSON. No Markdown and no explanation outside JSON.',
    'Required JSON shape: {"summary":"short human summary","edits":[{"path":"relative/path/from/workspace/root","operation":"replace","oldText":"exact existing text","newText":"replacement text"}]}',
    'Supported operations are replace, append, prepend, and rewrite.',
    'Use replace operations with exact oldText whenever possible. Keep oldText small but unique.',
    'Use rewrite only for new files or when exact replace is impossible. A rewrite must contain the complete final file.',
    'Preserve unrelated code, CSS selectors, imports, layout, and behavior exactly.',
    'Make the smallest change that satisfies the request.',
    'Do not include package-lock.json unless the user explicitly asks.',
    'The edits array must not be empty when the request asks for a project change.',
    '',
    '<user_request>',
    instruction,
    '</user_request>',
    '',
    '<workspace_context>',
    projectContext,
    '</workspace_context>'
  ];
  if (tab && code.trim()) {
    prompt.push('', `<active_file path="${tab.filePath ? relativeWorkspacePath(tab.filePath) : tab.name}">`, code, '</active_file>');
  }
  if (previousFailure) {
    prompt.push(
      '',
      '<previous_invalid_result>',
      previousFailure,
      '</previous_invalid_result>',
      '',
      'The previous result was invalid. Return a corrected JSON edit plan with at least one concrete edit.'
    );
  }
  return prompt.join('\n');
}

async function generateFocusedRewritePlan({ model, instruction, targetFiles, tab, code, requestId, previousFailure = '' }) {
  const candidates = targetFiles.length
    ? targetFiles
    : heuristicEditTargets(instruction, tab);

  for (const relative of candidates.slice(0, 3)) {
    const filePath = workspacePathFromRelative(relative);
    if (!filePath) continue;

    let content = '';
    try {
      content = (await window.anton.readFile(filePath)).content || '';
    } catch {
      continue;
    }

    const prompt = [
      'You are Anton, a local coding agent inside a desktop IDE.',
      'The patch planner failed, so update one selected file directly.',
      'Return ONLY valid JSON. No Markdown and no explanation outside JSON.',
      'Required JSON shape: {"path":"relative/path","changed":true|false,"summary":"short summary","content":"complete final file content"}',
      'If this file should not be changed for the request, return changed:false and content as an empty string.',
      'When changed is true, content must be the complete final content for this exact file.',
      'Preserve unrelated code, formatting, imports, selectors, and behavior exactly.',
      'Make the smallest correct change for the user request.',
      previousFailure ? `Previous failure: ${previousFailure}` : '',
      '',
      '<user_request>',
      instruction,
      '</user_request>',
      '',
      `<selected_file path="${relative}">`,
      content,
      '</selected_file>',
      '',
      tab && code.trim()
        ? `<active_file path="${tab.filePath ? relativeWorkspacePath(tab.filePath) : tab.name}">\n${code}\n</active_file>`
        : '<active_file>(none)</active_file>'
    ].filter(Boolean).join('\n');

    try {
      const raw = await generateWithFallback({ model, prompt, stream: false, requestId, format: 'json', timeoutMs: 0, allowFallback: false });
      const result = parseJsonObject(raw);
      if (result.changed && result.path === relative && typeof result.content === 'string' && result.content !== content) {
        return {
          summary: result.summary || `Updated ${relative}.`,
          edits: [{ path: relative, operation: 'rewrite', content: result.content }]
        };
      }
    } catch {
      // Try the next selected file before giving up.
    }
  }

  return null;
}

async function generateEditPlan({ model, instruction, projectContext, tab, code, requestId, targetFiles = [] }) {
  const focusedPlan = await generateFocusedRewritePlan({ model, instruction, targetFiles, tab, code, requestId });
  if (focusedPlan) return focusedPlan;

  let previousFailure = '';
  for (let attempt = 0; attempt < 1; attempt += 1) {
    const prompt = buildEditPrompt({ instruction, projectContext, tab, code, previousFailure });
    let raw = '';
    try {
      raw = await generateWithFallback({ model, prompt, stream: false, requestId, format: 'json', timeoutMs: 0, allowFallback: false });
    } catch (error) {
      const fallbackPlan = await generateFocusedRewritePlan({ model, instruction, targetFiles, tab, code, requestId, previousFailure: error.message });
      if (fallbackPlan) return fallbackPlan;
      throw error;
    }
    try {
      const plan = parseJsonObject(raw);
      if (Array.isArray(plan.edits) && plan.edits.length) return plan;
      previousFailure = raw || 'The model returned an empty edits array.';
    } catch (error) {
      previousFailure = `${error.message}\n\n${raw}`;
    }
  }
  const fallbackPlan = await generateFocusedRewritePlan({ model, instruction, targetFiles, tab, code, requestId, previousFailure });
  if (fallbackPlan) return fallbackPlan;
  throw new Error('The model did not produce a usable file edit plan after retrying.');
}

function recentConversationForIntent(latestInstruction) {
  const history = state.chatHistory.slice();
  const last = history[history.length - 1];
  if (last?.role === 'user' && last.text === latestInstruction) history.pop();
  return history
    .slice(-10)
    .map((message) => `${message.role}: ${message.text}`)
    .join('\n');
}

async function classifyUserIntent({ model, instruction, mode, requestId }) {
  const deterministic = deterministicIntentRoute(instruction, mode);
  if (deterministic) return deterministic;

  if (!state.workspace?.root) return { intent: 'chat', needsProjectContext: false, effectiveInstruction: instruction };

  const prompt = [
    'You are the routing brain for Anton, a desktop coding IDE agent.',
    'Analyze the latest user message and determine:',
    '1. The intent: "edit" (if asking to change, write, fix, create, delete, run, or build code/files in the project) or "chat" (if asking to explain, summarize, greet, or discuss).',
    '2. Whether project files need to be loaded into memory to answer this: true (if the user query refers to specific files, codebase structure, hooks, styles, or errors in this project) or false (if it is a general greeting, general coding question, or general chat).',
    '',
    'Return ONLY valid JSON matching this schema:',
    '{"intent": "edit" | "chat", "needsProjectContext": true | false, "effectiveInstruction": "resolved standalone query", "reason": "short explanation"}',
    '',
    '<recent_conversation>',
    recentConversationForIntent(instruction) || '(none)',
    '</recent_conversation>',
    '',
    '<latest_user_message>',
    instruction,
    '</latest_user_message>'
  ].join('\n');

  try {
    const raw = await generateWithFallback({ model, prompt, stream: false, requestId, format: 'json', timeoutMs: 0, allowFallback: false });
    const parsed = parseJsonObject(raw);
    return {
      intent: parsed.intent === 'edit' ? 'edit' : 'chat',
      needsProjectContext: parsed.needsProjectContext === true,
      effectiveInstruction: typeof parsed.effectiveInstruction === 'string' && parsed.effectiveInstruction.trim()
        ? parsed.effectiveInstruction.trim()
        : instruction,
      reason: parsed.reason || ''
    };
  } catch {
    return { intent: 'chat', needsProjectContext: false, effectiveInstruction: instruction };
  }
}

const agentTools = {
  runCommand: async (args) => {
    const { command } = args;
    if (!command) return "Error: 'command' argument is required.";
    try {
      const result = await window.anton.executeCommand({ command });
      return `Exit Code: ${result.code}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`;
    } catch (err) {
      return `Error executing command: ${err.message}`;
    }
  },

  readFile: async (args) => {
    const { path: relativePath } = args;
    if (!relativePath) return "Error: 'path' argument is required.";
    const filePath = workspacePathFromRelative(relativePath);
    if (!filePath) return `Error: Invalid path ${relativePath}`;
    try {
      const stats = await window.anton.fileStats(filePath);
      if (stats.isLarge) {
        return [
          `Error: ${relativePath} is a large file (${stats.lineCount} lines, ${formatBytes(stats.size)}).`,
          'Use fileStats, outlineFile, searchFile, readFileRange, and range edit tools instead of readFile.'
        ].join(' ');
      }
      const result = await window.anton.readFile(filePath);
      return result.content || '';
    } catch (err) {
      return `Error reading file: ${err.message}`;
    }
  },

  fileStats: async (args) => {
    const { path: relativePath } = args;
    if (!relativePath) return "Error: 'path' argument is required.";
    const filePath = workspacePathFromRelative(relativePath);
    if (!filePath) return `Error: Invalid path ${relativePath}`;
    try {
      const stats = await window.anton.fileStats(filePath);
      return JSON.stringify({
        path: relativePath,
        size: stats.size,
        sizeLabel: formatBytes(stats.size),
        lineCount: stats.lineCount,
        isLarge: stats.isLarge,
        sourceLike: stats.sourceLike,
        binary: stats.binary,
        thresholds: stats.thresholds
      }, null, 2);
    } catch (err) {
      return `Error getting file stats: ${err.message}`;
    }
  },

  readFileRange: async (args) => {
    const { path: relativePath, startLine, endLine } = args;
    if (!relativePath) return "Error: 'path' argument is required.";
    const filePath = workspacePathFromRelative(relativePath);
    if (!filePath) return `Error: Invalid path ${relativePath}`;
    try {
      const result = await window.anton.readFileRange({ filePath, startLine, endLine });
      return [
        `Range ${relativePath}:${result.startLine}-${result.endLine} of ${result.lineCount}`,
        '```',
        result.content,
        '```'
      ].join('\n');
    } catch (err) {
      return `Error reading file range: ${err.message}`;
    }
  },

  searchFile: async (args) => {
    const { path: relativePath, query, context, maxMatches } = args;
    if (!relativePath) return "Error: 'path' argument is required.";
    if (!query) return "Error: 'query' argument is required.";
    const filePath = workspacePathFromRelative(relativePath);
    if (!filePath) return `Error: Invalid path ${relativePath}`;
    try {
      const result = await window.anton.searchFile({ filePath, query, context, maxMatches });
      return JSON.stringify({
        path: relativePath,
        query,
        lineCount: result.lineCount,
        matches: result.matches
      }, null, 2);
    } catch (err) {
      return `Error searching file: ${err.message}`;
    }
  },

  outlineFile: async (args) => {
    const { path: relativePath } = args;
    if (!relativePath) return "Error: 'path' argument is required.";
    const filePath = workspacePathFromRelative(relativePath);
    if (!filePath) return `Error: Invalid path ${relativePath}`;
    try {
      const result = await window.anton.outlineFile(filePath);
      return JSON.stringify({
        path: relativePath,
        lineCount: result.lineCount,
        symbols: result.symbols
      }, null, 2);
    } catch (err) {
      return `Error outlining file: ${err.message}`;
    }
  },

  writeFile: async (args) => {
    const { path: relativePath, content } = args;
    if (!relativePath) return "Error: 'path' argument is required.";
    if (typeof content !== 'string') return "Error: 'content' argument must be a string.";
    const filePath = workspacePathFromRelative(relativePath);
    if (!filePath) return `Error: Invalid path ${relativePath}`;
    try {
      await window.anton.saveFile({ filePath, content });
      return `Successfully wrote file to ${relativePath}`;
    } catch (err) {
      return `Error writing file: ${err.message}`;
    }
  },

  replaceRange: async (args) => {
    const { path: relativePath, startLine, endLine, content } = args;
    if (!relativePath) return "Error: 'path' argument is required.";
    if (typeof content !== 'string') return "Error: 'content' argument must be a string.";
    const filePath = workspacePathFromRelative(relativePath);
    if (!filePath) return `Error: Invalid path ${relativePath}`;
    try {
      const result = await window.anton.replaceRange({ filePath, startLine, endLine, content });
      return `Successfully replaced ${relativePath}:${result.changedRange.startLine}-${result.changedRange.endLine}`;
    } catch (err) {
      return `Error replacing range: ${err.message}`;
    }
  },

  insertAtLine: async (args) => {
    const { path: relativePath, line, content } = args;
    if (!relativePath) return "Error: 'path' argument is required.";
    if (typeof content !== 'string') return "Error: 'content' argument must be a string.";
    const filePath = workspacePathFromRelative(relativePath);
    if (!filePath) return `Error: Invalid path ${relativePath}`;
    try {
      const result = await window.anton.insertAtLine({ filePath, line, content });
      return `Successfully inserted into ${relativePath}:${result.changedRange.startLine}-${result.changedRange.endLine}`;
    } catch (err) {
      return `Error inserting at line: ${err.message}`;
    }
  },

  deleteRange: async (args) => {
    const { path: relativePath, startLine, endLine } = args;
    if (!relativePath) return "Error: 'path' argument is required.";
    const filePath = workspacePathFromRelative(relativePath);
    if (!filePath) return `Error: Invalid path ${relativePath}`;
    try {
      const result = await window.anton.deleteRange({ filePath, startLine, endLine });
      return `Successfully deleted ${relativePath}:${startLine}-${endLine}. Next content starts around line ${result.changedRange.startLine}`;
    } catch (err) {
      return `Error deleting range: ${err.message}`;
    }
  }
};

function renderAgentStatus(plan = [], currentStepIndex = 0, explanation = '', currentAction = '') {
  let md = '';
  if (explanation) {
    md += `*Thinking:* ${explanation}\n\n`;
  }
  if (plan && plan.length) {
    md += `### Plan:\n`;
    plan.forEach((step, index) => {
      let icon = '[ ]';
      if (index < currentStepIndex) icon = '[x]';
      else if (index === currentStepIndex) icon = '[/]';
      md += `- ${icon} ${step}\n`;
    });
    md += `\n`;
  }
  if (currentAction) {
    md += `**Current Action:** ${currentAction}\n`;
  }
  return md;
}

function buildAgentLoopPrompt({ instruction, history, projectContext, fileCache, lockedPlan = null }) {
  const cachedFiles = Object.entries(fileCache || {});
  const prompt = [
    'You are Anton, an agentic coding assistant inside a desktop IDE.',
    'You handle complex tasks by planning and invoking tools sequentially.',
    'Return ONLY valid JSON matching this schema:',
    '{',
    '  "plan": ["human-readable task step", "another human-readable task step", ...],',
    '  "currentStepIndex": 0,',
    '  "explanation": "brief description of current action",',
    '  "action": {',
    '    "tool": "runCommand" | "fileStats" | "outlineFile" | "searchFile" | "readFileRange" | "replaceRange" | "insertAtLine" | "deleteRange" | "readFile" | "writeFile" | "done",',
    '    "arguments": {',
      '      "command": "optional shell command to run",',
      '      "path": "optional relative file path",',
      '      "query": "optional search query",',
      '      "startLine": "optional 1-based start line",',
      '      "endLine": "optional 1-based end line",',
      '      "line": "optional 1-based insertion line",',
      '      "content": "optional full content for writing file"',
    '    }',
    '  }',
    '}',
    'CRITICAL RULES:',
    '1. Break down the user instruction into a specific checklist (the "plan") that names the real files, UI areas, commands, or behavior you will inspect or change. Each plan item must be a plain human-readable string, not a JSON object and not a tool call.',
    '2. Execute one tool call at a time. The loop will continue and feed you the results.',
    '3. NEVER use readFile for a file already listed under <files_already_read>. The content is right there — use it.',
    '4. For edit, build, fix, create, delete, style, or layout requests, at least one relevant writeFile action must succeed before you call tool "done". Reading files is not enough.',
    '5. Do not output markdown, notes, or explanations outside the JSON object.',
    '6. After writing a file, move on — do not re-read it unless you need to verify a specific value.',
    '7. Read only files needed for the current task. Do not inspect every project file unless the user explicitly asks for a full-project audit.',
    '8. If the target file is obvious from the request or workspace context, read that file first, then write the corrected full file content.',
    '9. Large files must use this flow: fileStats, then outlineFile or searchFile, then readFileRange, then replaceRange/insertAtLine/deleteRange, then readFileRange again to verify.',
    '10. Never use readFile or writeFile on a file reported as large. Patch the exact line range instead so the selected small model only sees relevant context.',
    '',
    '<user_request>',
    instruction,
    '</user_request>',
    '',
    '<workspace_context>',
    projectContext,
    '</workspace_context>',
  ];

  if (Array.isArray(lockedPlan) && lockedPlan.length) {
    prompt.push('');
    prompt.push('<locked_plan>');
    lockedPlan.forEach((step, index) => {
      prompt.push(`${index + 1}. ${formatAgentPlanStep(step)}`);
    });
    prompt.push('</locked_plan>');
    prompt.push('The plan above is already established. Keep returning the same plan and update currentStepIndex/action only; do not replace it with a new checklist.');
  }

  if (cachedFiles.length > 0) {
    prompt.push('');
    prompt.push('<files_already_read>');
    for (const [path, content] of cachedFiles) {
      prompt.push(`### ${path}`);
      prompt.push('```');
      prompt.push(content);
      prompt.push('```');
    }
    prompt.push('</files_already_read>');
  }

  if (history.length > 0) {
    prompt.push('');
    prompt.push('<execution_history>');
    history.forEach((step, i) => {
      prompt.push(`[Step ${i + 1}] ${step.role.toUpperCase()}: ${step.content}`);
    });
    prompt.push('</execution_history>');
  }

  return prompt.join('\n');
}

async function askAnton(mode = 'custom') {
  if (state.aiBusy) {
    setStatus('Anton is still thinking.');
    return;
  }
  state.userAborted = false;
  const model = els.modelSelect.value;
  if (!model) {
    addMessage('system', 'No model selected. Start Ollama and refresh models.');
    return;
  }

  const tab = activeTab();
  const code = tab?.type === 'file' ? tab.model.getValue() : '';
  const custom = els.prompt.value.trim();
  const instruction = {
    custom,
    plan: custom,
    explain: 'Explain this file clearly and list risks or bugs.',
    fix: 'Find and fix bugs in this file. Return the complete corrected file in one fenced code block.',
    tests: 'Write focused tests for this file. Include the test file name and complete code.'
  }[mode];

  if (mode === 'plan' && !instruction) {
    addMessage('system', 'Type the idea, feature, or vague task you want planned, then click Plan Work.');
    return;
  }
  if (!instruction) return;

  const mentionedTargets = resolvePromptMentions(instruction);
  const instructionWithMentions = mentionedTargets.length
    ? `${instruction}${mentionInstructionSuffix(mentionedTargets)}`
    : instruction;

  addMessage('user', instruction);
  els.prompt.value = '';
  closeMentionMenu();
  const responseNode = addMessage('assistant pending', '');
  state.lastAiResponse = '';
  const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  state.currentRequestId = requestId;
  setAiBusy(true);

  const progress = createRunProgress(responseNode, [
    'Routing request',
    'Gathering context',
    'Executing steps'
  ]);
  const route = await classifyUserIntent({ model, instruction: instructionWithMentions, mode, requestId });
  const effectiveInstruction = mentionedTargets.length
    ? instructionWithMentions
    : route.effectiveInstruction || instruction;

  if (route.intent === 'edit') {
    try {
      progress.setStep('Starting Multi-Step Agent...');
      const editableFiles = editableWorkspaceFiles();
      const mentionContext = await buildMentionContext(mentionedTargets);
      const projectContext = [
        'Workspace file tree:',
        editableFiles.join('\n'),
        mentionContext ? `\n${mentionContext}` : ''
      ].join('\n');

      const quickTask = await tryQuickTask(effectiveInstruction, progress);
      if (quickTask) {
        const durationMs = progress.finish();
        responseNode.className = 'message assistant';
        const finalSummary = [
          quickTask.summary,
          '',
          'Changed files:',
          ...quickTask.changedFiles.map((file) => `- ${file}`)
        ].join('\n');
        setMessageMarkdown(responseNode, finalSummary, { durationMs });
        persistMessage('assistant', finalSummary, { durationMs });
        setStatus('Quick task finished.');
        playNotificationSound();
        return;
      }

      const history = [];
      const actionHistory = [];
      const fileCache = {}; // Tracks files already read to avoid redundant reads
      const commandCache = {};
      const changedFiles = new Set();
      let successfulWrites = 0;
      let stepCount = 0;
      let maxSteps = 10;
      let agentState = {
        plan: buildInitialEditPlan(effectiveInstruction, editableFiles),
        currentStepIndex: 0,
        explanation: 'Planning initial steps...'
      };
      let lockedPlan = null;
      let lastAgentLocation = null;
      const waitingLocation = (section, action) => lastAgentLocation ? {
        ...lastAgentLocation,
        section,
        action
      } : {
        file: '',
        section,
        action
      };

      progress.setTaskPlan(agentState.plan, 0, 'Planning subtasks', {
        file: '',
        section: 'Creating the initial task breakdown',
        action: 'Planning subtasks'
      });

      while (true) {
        if (stepCount >= maxSteps) {
          // Pause execution and ask the user to continue or stop
          setAiBusy(false);
          const promptNode = document.createElement('div');
          promptNode.className = 'message system';
          promptNode.style.border = '1px solid var(--blue-glow)';
          promptNode.style.background = 'rgba(0, 242, 254, 0.03)';
          promptNode.innerHTML = `
            <div style="margin-bottom: 10px; font-weight: 500;">Anton has reached the turn limit of ${maxSteps}. Would you like to continue?</div>
            <div style="display: flex; gap: 8px;">
              <button class="primary-button continue-btn" style="width: auto; height: 30px; font-size: 12px; padding: 0 14px;">Continue (5 turns)</button>
              <button class="secondary-button stop-btn" style="width: auto; height: 30px; font-size: 12px; padding: 0 14px; background: rgba(255,255,255,0.05); border: 1px solid var(--line-2); color: var(--text);">Stop</button>
            </div>
          `;
          els.messages.appendChild(promptNode);
          scrollMessagesToBottom();

          const userChoice = await new Promise((resolve) => {
            promptNode.querySelector('.continue-btn').addEventListener('click', () => {
              promptNode.remove();
              resolve('continue');
            });
            promptNode.querySelector('.stop-btn').addEventListener('click', () => {
              promptNode.remove();
              resolve('stop');
            });
          });

          if (userChoice === 'continue') {
            maxSteps += 5;
            setAiBusy(true);
          } else {
            break;
          }
        }

        stepCount++;
        progress.setTaskPlan(
          agentState.plan,
          agentState.currentStepIndex,
          stepCount === 1 ? 'Asking model to create a task plan' : 'Asking model for the next action',
          waitingLocation(
            stepCount === 1 ? 'Preparing the task plan' : 'Choosing the next file and section',
            stepCount === 1 ? 'Asking model to create a task plan' : 'Asking model for the next action'
          )
        );

        const prompt = buildAgentLoopPrompt({
          instruction: effectiveInstruction,
          history,
          projectContext,
          fileCache,
          lockedPlan
        });

        let rawResponse = '';
        try {
          rawResponse = await generateWithFallback({
            model,
            prompt,
            stream: false,
            requestId,
            format: 'json',
            timeoutMs: 0,
            allowFallback: false
          });
        } catch (error) {
          throw new Error(`AI turn failed to generate: ${error.message}`);
        }

        let parsed;
        try {
          parsed = parseJsonObject(rawResponse);
        } catch (error) {
          throw new Error(`AI returned invalid JSON: ${error.message}\nRaw: ${rawResponse}`);
        }

        const normalizedPlan = normalizeAgentPlan(parsed.plan);
        if (!lockedPlan && normalizedPlan.length && !isLowQualityAgentPlan(normalizedPlan)) {
          lockedPlan = normalizedPlan;
          agentState.plan = lockedPlan;
        } else if (!lockedPlan && (!agentState.plan.length || isLowQualityAgentPlan(agentState.plan))) {
          agentState.plan = buildInitialEditPlan(effectiveInstruction, editableFiles);
        }
        agentState.currentStepIndex = typeof parsed.currentStepIndex === 'number' ? parsed.currentStepIndex : agentState.currentStepIndex;
        agentState.explanation = parsed.explanation || agentState.explanation;
        progress.setTaskPlan(
          agentState.plan,
          agentState.currentStepIndex,
          agentState.explanation || 'Choosing next action',
          waitingLocation('Interpreting the model response', agentState.explanation || 'Choosing next action')
        );

        // Dynamic turn scaling on the first planning step
        if (stepCount === 1 && agentState.plan && agentState.plan.length > 0) {
          maxSteps = Math.max(10, agentState.plan.length * 2);
          progress.setTaskPlan(
            agentState.plan,
            agentState.currentStepIndex,
            agentState.explanation || 'Task plan ready',
            waitingLocation('Task plan is ready', agentState.explanation || 'Task plan ready')
          );
        }

        const action = parsed.action || {};
        const tool = action.tool || action.action;
        const args = action.arguments || {};
        if (agentState.plan.length) {
          agentState.currentStepIndex = inferPlanStepIndex(agentState.plan, tool, args, agentState.currentStepIndex);
        }
        const toolDesc = describeAgentAction(tool, args);
        const toolLocation = describeAgentLocation(tool, args);
        if (!lockedPlan && tool === 'readFile' && args.path) {
          agentState.currentStepIndex = Math.max(agentState.currentStepIndex, 1);
        } else if (!lockedPlan && tool === 'writeFile' && args.path) {
          agentState.currentStepIndex = Math.max(agentState.currentStepIndex, 2);
        } else if (!lockedPlan && tool === 'done') {
          agentState.currentStepIndex = Math.max(agentState.currentStepIndex, 3);
        }

        // Guard: if tool is missing or not recognized, inject corrective feedback and retry
        const validTools = new Set([
          'runCommand',
          'fileStats',
          'outlineFile',
          'searchFile',
          'readFileRange',
          'replaceRange',
          'insertAtLine',
          'deleteRange',
          'readFile',
          'writeFile',
          'done'
        ]);
        if (!tool || !validTools.has(tool)) {
          history.push({
            role: 'assistant',
            content: rawResponse
          });
          history.push({
            role: 'system',
            content: `Error: Your response did not contain a valid "action.tool". Valid values are: ${Array.from(validTools).join(', ')}. Please respond again with a valid JSON action.`
          });
          progress.setTaskPlan(agentState.plan, agentState.currentStepIndex, 'Correcting invalid response...', {
            file: '',
            section: 'Model returned an invalid action',
            action: 'Asking Anton to choose a valid tool'
          });
          continue;
        }

        if (tool !== 'done') lastAgentLocation = toolLocation;

        // Loop / repetitive action detection (only for valid tool calls)
        const actionKey = JSON.stringify({ tool, arguments: args });
        actionHistory.push(actionKey);
        if (actionHistory.length > 3) {
          actionHistory.shift();
        }
        const repeatedAction = actionHistory.length === 3 && actionHistory[0] === actionHistory[1] && actionHistory[1] === actionHistory[2];
        if (repeatedAction) {
          history.push({
            role: 'assistant',
            content: rawResponse
          });
          history.push({
            role: 'system',
            content: `Repeated action detected: ${tool} was requested with the same arguments three times. Do not repeat it again. Use the latest cached result if available, then choose a different next action or finish with done.`
          });
          progress.setTaskPlan(agentState.plan, agentState.currentStepIndex, `Avoiding repeated action: ${toolDesc}`, toolLocation);
          continue;
        }

        progress.setTaskPlan(agentState.plan, agentState.currentStepIndex, toolDesc, toolLocation);

        const writeTools = new Set(['writeFile', 'replaceRange', 'insertAtLine', 'deleteRange']);

        if (tool === 'done' && successfulWrites === 0) {
          history.push({
            role: 'assistant',
            content: rawResponse
          });
          history.push({
            role: 'system',
            content: [
              'The user requested an edit task, but no file has been changed yet.',
              'Do not call done after only reading or planning.',
              'Choose the relevant writeFile or range edit action now. If the file is large, use replaceRange, insertAtLine, or deleteRange instead of writeFile.'
            ].join(' ')
          });
          progress.setTaskPlan(agentState.plan, agentState.currentStepIndex, 'Waiting for Anton to write the actual file change', {
            file: '',
            section: 'No file has been changed yet',
            action: 'Selecting a write or range-edit action'
          });
          continue;
        }

        if (tool === 'done') {
          break;
        }

        let observation = '';
        if (tool === 'runCommand') {
          if (commandCache[args.command]) {
            observation = [
              `The command "${args.command}" was already run. Use the cached result below and choose a different next action instead of running it again.`,
              '',
              commandCache[args.command]
            ].join('\n');
          } else {
            observation = await agentTools.runCommand(args);
            commandCache[args.command] = observation;
          }
        } else if (tool === 'fileStats') {
          observation = await agentTools.fileStats(args);
        } else if (tool === 'outlineFile') {
          observation = await agentTools.outlineFile(args);
        } else if (tool === 'searchFile') {
          observation = await agentTools.searchFile(args);
        } else if (tool === 'readFileRange') {
          observation = await agentTools.readFileRange(args);
        } else if (tool === 'readFile') {
          // Serve from cache if already read — do not call readFile again
          if (fileCache[args.path]) {
            observation = [
              `The file ${args.path} was already read. Use the cached content below and choose the next different action instead of reading it again.`,
              '',
              fileCache[args.path]
            ].join('\n');
          } else {
            observation = await agentTools.readFile(args);
            if (observation && !observation.startsWith('Error')) {
              fileCache[args.path] = observation;
            }
          }
        } else if (tool === 'writeFile') {
          observation = await agentTools.writeFile(args);
          if (observation && !observation.startsWith('Error')) {
            successfulWrites += 1;
            if (args.path) changedFiles.add(args.path);
          }
          // Invalidate cache after a write so re-reads get fresh content
          if (fileCache[args.path]) delete fileCache[args.path];
        } else if (tool === 'replaceRange') {
          observation = await agentTools.replaceRange(args);
        } else if (tool === 'insertAtLine') {
          observation = await agentTools.insertAtLine(args);
        } else if (tool === 'deleteRange') {
          observation = await agentTools.deleteRange(args);
        }

        if (writeTools.has(tool) && observation && !observation.startsWith('Error')) {
          if (tool !== 'writeFile') successfulWrites += 1;
          if (args.path) {
            changedFiles.add(
              ['replaceRange', 'deleteRange'].includes(tool)
                ? `${args.path}:${args.startLine || '?'}-${args.endLine || '?'}`
                : tool === 'insertAtLine'
                  ? `${args.path}:${args.line || '?'}`
                  : args.path
            );
            if (fileCache[args.path]) delete fileCache[args.path];
          }
        }

        history.push({
          role: 'assistant',
          content: rawResponse
        });
        history.push({
          role: 'system',
          content: `Tool Execution Result:\n${observation}`
        });

        progress.setTaskPlan(agentState.plan, agentState.currentStepIndex, `Completed: ${toolDesc}`, {
          ...toolLocation,
          action: `Completed: ${toolDesc}`
        });
        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      if (successfulWrites === 0) {
        throw new Error('No files were changed. Anton only inspected the project, so the webpage could not update.');
      }

      progress.completeTaskPlan('Task finished successfully.');
      const durationMs = progress.finish();
      responseNode.className = 'message assistant';
      const changedList = Array.from(changedFiles);
      const finalSummary = [
        renderAgentStatus(agentState.plan, agentState.plan.length, 'Completed all plan steps.', 'Task finished successfully.'),
        changedList.length
          ? `\nChanged files:\n${changedList.map((file) => `- ${file}`).join('\n')}`
          : ''
      ].join('');
      setMessageMarkdown(responseNode, finalSummary, { durationMs });
      persistMessage('assistant', finalSummary, { durationMs });
      setStatus('Task finished successfully.');
      playNotificationSound();

      const workspace = await window.anton.refreshWorkspace();
      if (workspace) {
        state.workspace = workspace;
        renderTree(workspace.tree);
        updateSelectedEntry();
      }
      renderTabs();

    } catch (error) {
      const durationMs = progress.finish();
      responseNode.className = 'message system';
      const msg = state.userAborted ? 'Task stopped by user.' : `Agent task failed: ${error.message}`;
      setMessageText(responseNode, msg, { durationMs });
      persistMessage('system', msg, { durationMs });
      playNotificationSound();
    } finally {
      if (state.currentRequestId === requestId) state.currentRequestId = null;
      setAiBusy(false);
    }
    return;
  }

  const needsProjectContext = route.needsProjectContext || mentionedTargets.length > 0;
  const directResponse = directChatResponse(effectiveInstruction, route);
  if (directResponse) {
    const durationMs = progress.finish();
    responseNode.className = 'message assistant';
    state.lastAiResponse = directResponse;
    setMessageMarkdown(responseNode, directResponse, { durationMs });
    persistMessage('assistant', directResponse, { durationMs });
    if (state.currentRequestId === requestId) state.currentRequestId = null;
    setAiBusy(false);
    playNotificationSound();
    return;
  }

  const detailedChatProgress = needsProjectContext || mode === 'plan';
  if (detailedChatProgress) {
    progress.expandToSteps(['Routing request', 'Gathering context', 'Writing response'], `Routing with ${model}`);
    progress.setStep('Gathering context');
  }
  const mentionContext = await buildMentionContext(mentionedTargets);
  const baseProjectContext = needsProjectContext
    ? await buildWorkspaceContext({ includeSnippets: mode !== 'custom' || /\b(project|workspace|codebase|summari[sz]e|review|inspect|read|files)\b/i.test(effectiveInstruction) })
    : workspaceSummary();
  const projectContext = mentionContext ? `${baseProjectContext}\n\n${mentionContext}` : baseProjectContext;

  const promptParts = [
    'You are Anton, a local coding assistant inside a desktop IDE.',
    'Your name is Anton. If the user asks your name or who you are, say you are Anton, the local coding assistant inside this IDE.',
    'Answer benign coding, project, and greeting requests directly in plain text.',
    'Be specific to Anton. Do not answer as a generic assistant when asked about yourself.',
    'Do not wrap your answer in JSON unless the user explicitly asks for JSON.',
    'If no editor file is open, use the workspace context below instead of saying the file is empty.',
    needsProjectContext
      ? 'The user is asking about the loaded workspace. You must answer from the workspace context, naming the project type, main files, and likely behavior. Do not give a generic greeting.'
      : 'If the user is only greeting you, a brief greeting is fine.',
    'Never output placeholder expressions such as obj["current_file_content"]; answer naturally from the provided information.',
    '',
    '<user_request>',
    effectiveInstruction,
    '</user_request>',
    '',
    '<workspace_context>',
    projectContext,
    '</workspace_context>'
  ];

  if (mode === 'plan') {
    promptParts.push(
      '',
      'This is a planning request. Turn the user idea into a practical implementation plan.',
      'Use these sections:',
      '1. Goal',
      '2. Assumptions',
      '3. Task list in execution order',
      '4. File-by-file implementation plan',
      '5. Commands or checks to run',
      '6. Risks or decisions to confirm',
      'Keep it specific to the loaded workspace when project context is available.'
    );
  }

  if (tab && code.trim()) {
    promptParts.push(
      '',
      `<active_file path="${tab.filePath || tab.name}">`,
      code,
      '</active_file>'
    );
  }

  const prompt = promptParts.join('\n');
  if (detailedChatProgress) progress.setStep(`Writing response (${model})`);
  let responseStarted = false;

  const tokenHandler = (payload) => {
    if (payload.requestId !== requestId) return;
    const token = payload.token || '';
    if (!responseStarted) {
      responseStarted = true;
      progress.stopUpdates();
    }
    state.lastAiResponse += token;
    responseNode.className = 'message assistant';
    const shouldStick = isMessagesNearBottom();
    setMessageMarkdown(responseNode, state.lastAiResponse);
    if (shouldStick) scrollMessagesToBottom();
  };

  const previous = window.__antonTokenHandler;
  window.__antonTokenHandler = tokenHandler;
  try {
    const response = await generateWithFallback({ model, prompt, stream: true, requestId, timeoutMs: 0 });
    if (!state.lastAiResponse) {
      state.lastAiResponse = response?.trim() || '';
    }
    state.lastAiResponse = normalizeAiResponse(state.lastAiResponse);
    const durationMs = progress.finish();
    responseNode.className = 'message assistant';
    const shouldStick = isMessagesNearBottom();
    setMessageMarkdown(responseNode, state.lastAiResponse || 'Anton did not return text. Try again or switch to the smaller model.', { durationMs });
    persistMessage('assistant', state.lastAiResponse || 'Anton did not return text. Try again or switch to the smaller model.', { durationMs });
    if (shouldStick) scrollMessagesToBottom();
    playNotificationSound();
  } catch (error) {
    const durationMs = progress.finish();
    responseNode.className = 'message system';
    const msg = state.userAborted ? 'Task stopped by user.' : `Request failed: ${error.message}`;
    setMessageText(responseNode, msg, { durationMs });
    persistMessage('system', msg, { durationMs });
    playNotificationSound();
  } finally {
    window.__antonTokenHandler = previous;
    if (state.currentRequestId === requestId) state.currentRequestId = null;
    setAiBusy(false);
  }
}

function setAiBusy(value) {
  state.aiBusy = value;
  els.prompt.disabled = value;
  els.modelSelect.disabled = value;
  els.sendPrompt.textContent = value ? 'Stop' : 'Send';
  if (value) {
    els.sendPrompt.classList.add('stop-button-active');
  } else {
    els.sendPrompt.classList.remove('stop-button-active');
  }
  setStatus(value ? 'Anton is thinking...' : 'Ready');
  if (els.aiLoader) {
    if (value) {
      els.aiLoader.classList.remove('hidden');
    } else {
      els.aiLoader.classList.add('hidden');
    }
  }
}

function stopAiGeneration() {
  if (!state.currentRequestId) return;
  state.userAborted = true;
  window.anton.abortGenerate(state.currentRequestId).catch(() => null);
  setStatus('Stopping generation...');
}

function applyLastResponse() {
  const tab = activeTab();
  if (!tab || tab.type === 'diff' || !state.lastAiResponse) return;
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
  if (!state.editor.getModel() || activeTab()?.type === 'diff') {
    els.statusRight.textContent = 'No file';
    return;
  }
  const position = state.editor.getPosition();
  els.statusRight.textContent = `Ln ${position.lineNumber}, Col ${position.column}`;
}

function updateOutline() {
  const tab = activeTab();
  if (!tab || tab.type === 'diff') {
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
  document.querySelector('#keepAwakeToggle').checked = state.settings.keepAwake;
  document.querySelector('#fontSizeInput').value = state.settings.fontSize;

  if (key === 'keepAwake') {
    window.anton.toggleKeepAwake(value);
  }

  state.editor.updateOptions({
    minimap: { enabled: state.settings.minimap },
    wordWrap: state.settings.wordWrap ? 'on' : 'off',
    fontSize: state.settings.fontSize
  });
  state.diffEditor?.updateOptions({
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
  setCssSize('--panel-height', clamp(panel, 132, 640));
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
      const height = clamp(start.panelHeight + dragUpDistance, 132, maxHeight);
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
    tab.innerHTML = `<span class="terminal-tab-title"><span class="terminal-tab-icon svg-icon">${iconSvg('terminal')}</span>${terminal.running ? '● ' : ''}${terminal.name}</span><span class="terminal-tab-close svg-icon">${iconSvg('close')}</span>`;
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
  const wasRunning = terminal.running;
  terminal.running = Boolean(payload.running);
  terminal.command = payload.running ? payload.command || terminal.command : '';
  renderTerminalTabs();
  if (terminal.id === state.activeTerminalId) setTerminalRunning(terminal.running, terminal.command);

  if (wasRunning && !terminal.running) {
    playNotificationSound();
  }
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
    if (!tab || tab.type === 'diff') return;
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
  els.gitRepoSelect.addEventListener('change', () => {
    state.selectedGitRepoRoot = els.gitRepoSelect.value || null;
    refreshGit();
  });
  els.gitCommitMessage.addEventListener('input', updateGitButtons);
  els.gitCommitButton.addEventListener('click', () => runGitAction('Committed changes', async () => {
    await window.anton.gitCommit(gitPayload({ message: els.gitCommitMessage.value }));
    els.gitCommitMessage.value = '';
  }));
  els.gitStageAll.addEventListener('click', () => runGitAction('Staged all changes', () => window.anton.gitStageAll(gitPayload())));
  els.gitUnstageAll.addEventListener('click', () => runGitAction('Unstaged all changes', () => window.anton.gitUnstageAll(gitPayload())));
  els.gitDiscardAll.addEventListener('click', () => {
    const ok = confirm('Discard all working tree changes and remove untracked files? This cannot be undone.');
    if (ok) runGitAction('Discarded all changes', () => window.anton.gitDiscardAll(gitPayload()));
  });
  els.gitPull.addEventListener('click', () => runGitAction('Pulled latest changes', () => window.anton.gitPull(gitPayload())));
  els.gitPush.addEventListener('click', () => runGitAction('Pushed commits', () => window.anton.gitPush(gitPayload())));
  els.gitSync.addEventListener('click', () => runGitAction('Synced repository', () => window.anton.gitSync(gitPayload())));
  els.gitNewBranch.addEventListener('click', () => {
    const branchName = prompt('New branch name');
    if (branchName) runGitAction(`Created branch ${branchName}`, () => window.anton.gitCreateBranch(gitPayload({ branchName })));
  });
  els.gitBranchSelect.addEventListener('change', () => {
    const branchName = els.gitBranchSelect.value;
    if (branchName && branchName !== state.gitStatus?.branch) {
      runGitAction(`Checked out ${branchName}`, () => window.anton.gitCheckoutBranch(gitPayload({ branchName })));
    }
  });
  els.gitStash.addEventListener('click', () => {
    const message = prompt('Stash message', 'Anton stash');
    if (message !== null) runGitAction('Stashed changes', () => window.anton.gitStash(gitPayload({ message })));
  });
  document.querySelector('#refreshModels').addEventListener('click', loadModels);
  els.pullModel.addEventListener('click', pullModel);
  els.refreshCatalog.addEventListener('click', loadModelCatalog);
  document.querySelector('#sendPrompt').addEventListener('click', () => {
    if (state.aiBusy) {
      stopAiGeneration();
    } else {
      askAnton('custom');
    }
  });
  document.querySelector('#commandButton').addEventListener('click', openPalette);
  els.emptyOpenFile.addEventListener('click', openWorkspace);

  document.querySelector('#runCurrent').addEventListener('click', () => {
    const tab = activeTab();
    if (tab?.filePath) runTerminalCommand(`"${tab.filePath}"`);
  });
  document.querySelector('#runTests').addEventListener('click', () => runTerminalCommand('npm test'));
  els.newTerminal.addEventListener('click', createLocalTerminal);

  els.modelSelect.addEventListener('change', () => {
    els.activeModel.textContent = els.modelSelect.value || 'No model';
  });

  els.modelNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') pullModel();
  });

  els.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runSearch();
  });
  els.searchInput.addEventListener('input', () => {
    if (!els.searchInput.value.trim()) state.searchRoot = null;
  });
  els.searchButton.addEventListener('click', () => runSearch());

  els.newChatBtn.addEventListener('click', () => newChat());
  els.chatHistoryBtn.addEventListener('click', () => openChatHistory());
  els.planWorkBtn.addEventListener('click', () => askAnton('plan'));
  els.historyClose.addEventListener('click', () => els.historyPanel.classList.add('hidden'));

  els.prompt.addEventListener('keydown', (event) => {
    const mentionOpen = els.mentionMenu && !els.mentionMenu.classList.contains('hidden') && state.mentionCandidates.length > 0;
    if (mentionOpen && event.key === 'ArrowDown') {
      event.preventDefault();
      state.mentionActiveIndex = (state.mentionActiveIndex + 1) % state.mentionCandidates.length;
      renderMentionMenu(mentionQueryAtCaret());
      return;
    }
    if (mentionOpen && event.key === 'ArrowUp') {
      event.preventDefault();
      state.mentionActiveIndex = (state.mentionActiveIndex - 1 + state.mentionCandidates.length) % state.mentionCandidates.length;
      renderMentionMenu(mentionQueryAtCaret());
      return;
    }
    if (mentionOpen && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault();
      insertMention(state.mentionCandidates[state.mentionActiveIndex]);
      return;
    }
    if (mentionOpen && event.key === 'Escape') {
      event.preventDefault();
      closeMentionMenu();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      askAnton('custom');
    }
  });
  els.prompt.addEventListener('input', updateMentionMenu);
  els.prompt.addEventListener('click', updateMentionMenu);
  els.prompt.addEventListener('blur', () => setTimeout(closeMentionMenu, 120));

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
  document.querySelector('#keepAwakeToggle').addEventListener('change', (event) => setSetting('keepAwake', event.target.checked));
  // Use 'input' so font size changes apply immediately as the user types
  document.querySelector('#fontSizeInput').addEventListener('input', (event) => {
    const val = Number(event.target.value);
    if (val >= 11 && val <= 24) setSetting('fontSize', val);
  });

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
    queueGitRefresh(700);
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
    if (!payload.running) queueGitRefresh(500);
  });
  window.anton.onOllamaToken((payload) => {
    if (window.__antonTokenHandler) window.__antonTokenHandler(payload);
  });
  window.anton.onOllamaPullProgress((payload) => {
    updateActiveDownloadProgress(payload);
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
