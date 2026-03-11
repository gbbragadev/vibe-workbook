/**
 * Store - JSON persistence + EventEmitter for real-time state
 * Singleton pattern, atomic writes with backup
 */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const crypto = require('crypto');

const STATE_DIR = path.join(__dirname, '..', '..', 'state');
const STATE_FILE = path.join(STATE_DIR, 'workspaces.json');
const BACKUP_FILE = path.join(STATE_DIR, 'workspaces.backup.json');
const BACKUPS_DIR = path.join(STATE_DIR, 'backups');
const CONFIG_FILE = path.join(STATE_DIR, 'config.json');

const DEFAULT_STATE = {
  version: 1,
  workspaces: {},
  sessions: {},
  activeWorkspace: null,
  workspaceOrder: [],
  settings: {
    theme: 'dark',
    autoRecover: true,
    terminalFontSize: 14,
    maxPanes: 4
  }
};

let _instance = null;

class Store extends EventEmitter {
  constructor() {
    super();
    this.state = null;
    this.config = null;
    this._dirty = false;
    this._saveTimer = null;
    this._load();
  }

  static getInstance() {
    if (!_instance) _instance = new Store();
    return _instance;
  }

  // --- State Persistence ---

  _load() {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });

    // Try primary → backup → timestamped backups → defaults
    for (const file of [STATE_FILE, BACKUP_FILE]) {
      try {
        if (fs.existsSync(file)) {
          const raw = fs.readFileSync(file, 'utf8');
          this.state = JSON.parse(raw);
          if (this.state.version) return;
        }
      } catch (e) { /* try next */ }
    }

    // Try timestamped backups
    try {
      const backups = fs.readdirSync(BACKUPS_DIR)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();
      for (const b of backups) {
        try {
          const raw = fs.readFileSync(path.join(BACKUPS_DIR, b), 'utf8');
          this.state = JSON.parse(raw);
          if (this.state.version) return;
        } catch (e) { /* try next */ }
      }
    } catch (e) { /* no backups dir */ }

    this.state = { ...DEFAULT_STATE };
  }

  _save() {
    if (this._saveTimer) return;
    this._dirty = true;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._doSave();
    }, 500);
  }

  _doSave() {
    if (!this._dirty) return;
    try {
      const data = JSON.stringify(this.state, null, 2);
      // Atomic write: write to temp, rename
      const tmp = STATE_FILE + '.tmp';
      fs.writeFileSync(tmp, data, 'utf8');
      // Rolling backup
      if (fs.existsSync(STATE_FILE)) {
        fs.copyFileSync(STATE_FILE, BACKUP_FILE);
      }
      fs.renameSync(tmp, STATE_FILE);
      this._dirty = false;
    } catch (e) {
      console.error('[Store] Save failed:', e.message);
    }
  }

  createTimestampedBackup() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const dest = path.join(BACKUPS_DIR, `workspaces-${ts}.json`);
        fs.copyFileSync(STATE_FILE, dest);
        // Keep only last 10
        const files = fs.readdirSync(BACKUPS_DIR).filter(f => f.endsWith('.json')).sort();
        while (files.length > 10) {
          fs.unlinkSync(path.join(BACKUPS_DIR, files.shift()));
        }
      }
    } catch (e) { /* non-critical */ }
  }

  forceSave() {
    this._dirty = true;
    this._doSave();
  }

  // --- Config ---

  getConfig() {
    if (!this.config) {
      try {
        if (fs.existsSync(CONFIG_FILE)) {
          this.config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
      } catch (e) { /* ignore */ }
      if (!this.config) {
        this.config = {
          password: crypto.randomBytes(16).toString('hex'),
          apiKeys: {},
          agentPaths: {
            claudeProjects: path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'projects')
          }
        };
        this.saveConfig();
      }
    }
    return this.config;
  }

  saveConfig() {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
  }

  // --- Workspace CRUD ---

  getWorkspaces() {
    const order = this.state.workspaceOrder || [];
    const all = Object.values(this.state.workspaces);
    // Return in order, then any not in order list
    const ordered = order.map(id => this.state.workspaces[id]).filter(Boolean);
    const rest = all.filter(w => !order.includes(w.id));
    return [...ordered, ...rest];
  }

  getWorkspace(id) {
    return this.state.workspaces[id] || null;
  }

  createWorkspace({ name, description = '', color = '#6366f1', agents = ['claude', 'codex'], workingDir = '' }) {
    const id = 'ws-' + crypto.randomBytes(4).toString('hex');
    const workspace = {
      id, name, description, color, agents, workingDir,
      createdAt: Date.now(), updatedAt: Date.now()
    };
    this.state.workspaces[id] = workspace;
    this.state.workspaceOrder.push(id);
    this._save();
    this.emit('workspace:created', workspace);
    return workspace;
  }

  updateWorkspace(id, updates) {
    const ws = this.state.workspaces[id];
    if (!ws) return null;
    Object.assign(ws, updates, { updatedAt: Date.now() });
    this._save();
    this.emit('workspace:updated', ws);
    return ws;
  }

  deleteWorkspace(id) {
    const ws = this.state.workspaces[id];
    if (!ws) return false;
    delete this.state.workspaces[id];
    this.state.workspaceOrder = this.state.workspaceOrder.filter(x => x !== id);
    // Remove sessions in this workspace
    Object.values(this.state.sessions).forEach(s => {
      if (s.workspaceId === id) delete this.state.sessions[s.id];
    });
    this._save();
    this.emit('workspace:deleted', { id });
    return true;
  }

  setActiveWorkspace(id) {
    this.state.activeWorkspace = id;
    this._save();
    this.emit('workspace:activated', { id });
  }

  // --- Session CRUD ---

  getSessions(workspaceId = null) {
    const all = Object.values(this.state.sessions);
    if (workspaceId) return all.filter(s => s.workspaceId === workspaceId);
    return all;
  }

  getSession(id) {
    return this.state.sessions[id] || null;
  }

  createSession({
    name,
    workspaceId,
    agent = 'claude',
    workingDir = '',
    model = '',
    effort = '',
    resumeSessionId = '',
    productId = '',
    runId = '',
    stageId = '',
    role = '',
    sessionRole = '',
    workerKind = '',
    workerPreset = '',
    displayOrder = 0,
    knowledgePackId = '',
    knowledgePackName = '',
    presetType = '',
    presetId = '',
    presetLabel = '',
    promptSeed = '',
    promptSeedPending = !!promptSeed
  }) {
    const id = 'sess-' + crypto.randomBytes(4).toString('hex');
    const session = {
      id, name, workspaceId, agent,
      status: 'idle',
      pid: null,
      workingDir,
      command: '',
      model,
      effort,
      resumeSessionId,
      productId,
      runId,
      stageId,
      role,
      sessionRole,
      workerKind,
      workerPreset,
      displayOrder,
      knowledgePackId,
      knowledgePackName,
      presetType,
      presetId,
      presetLabel,
      promptSeed,
      promptSeedPending,
      lifecycleState: 'spawning',
      awaitingInput: false,
      awaitingInputReason: '',
      completionState: null,
      lifecycleTransitionAt: null,
      bootstrapState: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      costCache: null,
      logs: []
    };
    this.state.sessions[id] = session;
    this._save();
    this.emit('session:created', session);
    return session;
  }

  updateSession(id, updates) {
    const sess = this.state.sessions[id];
    if (!sess) return null;
    Object.assign(sess, updates, { updatedAt: Date.now() });
    this._save();
    this.emit('session:updated', sess);
    return sess;
  }

  deleteSession(id) {
    if (!this.state.sessions[id]) return false;
    delete this.state.sessions[id];
    this._save();
    this.emit('session:deleted', { id });
    return true;
  }

  addSessionLog(id, message) {
    const sess = this.state.sessions[id];
    if (!sess) return;
    sess.logs.push({ ts: Date.now(), msg: message });
    if (sess.logs.length > 200) sess.logs = sess.logs.slice(-100);
    this._save();
    this.emit('session:log', { id, message });
  }

  // --- Settings ---

  getSettings() {
    return this.state.settings || DEFAULT_STATE.settings;
  }

  updateSettings(updates) {
    this.state.settings = { ...this.state.settings, ...updates };
    this._save();
    this.emit('settings:updated', this.state.settings);
  }

  // --- Search ---

  searchSessions(query) {
    const q = (query || '').toLowerCase();
    if (!q) return this.getSessions();
    return Object.values(this.state.sessions).filter(s =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.workingDir || '').toLowerCase().includes(q) ||
      (s.agent || '').toLowerCase().includes(q) ||
      (s.model || '').toLowerCase().includes(q)
    );
  }
}

module.exports = { Store, getStore: Store.getInstance.bind(Store) };
