/**
 * PtyManager - Manages pseudo-terminal sessions for all agent types
 * Each session gets a real PTY via node-pty, with scrollback and multi-client WebSocket
 */
const path = require('path');
const { createAdapter } = require('../core/agent-adapter');
const { getStore } = require('../state/store');
const { getProductService } = require('../core/product-service');

const MAX_SCROLLBACK = 100 * 1024; // 100KB per session

class PtySession {
  constructor(id, ptyProcess, agentType) {
    this.id = id;
    this.agentType = agentType;
    this.pty = ptyProcess;
    this.clients = new Set();
    this.scrollback = [];
    this.scrollbackSize = 0;
    this.alive = true;
    this.exitCode = null;
    this.pid = ptyProcess.pid;
    this.createdAt = Date.now();
    this.lastActive = Date.now();
    this._lastActiveThrottle = null;
    this._outputBuffer = '';

    // Forward PTY output to all WebSocket clients
    this.pty.onData((data) => {
      this._appendScrollback(data);
      this._updateLastActive();

      for (const ws of this.clients) {
        try {
          if (ws.readyState === 1 && ws.bufferedAmount < 65536) {
            ws.send(data);
          }
        } catch (e) { /* skip broken client */ }
      }
    });

    this.pty.onExit(({ exitCode }) => {
      this.alive = false;
      this.exitCode = exitCode;
      // Notify clients
      const msg = JSON.stringify({ type: 'exit', exitCode });
      for (const ws of this.clients) {
        try { ws.send(msg); } catch { /* ignore */ }
      }
      // Update store
      const store = getStore();
      store.updateSession(id, { status: 'stopped', pid: null });
      store.addSessionLog(id, `Process exited with code ${exitCode}`);
    });
  }

  _appendScrollback(data) {
    this.scrollback.push(data);
    this.scrollbackSize += data.length;
    // Prune if too large
    while (this.scrollbackSize > MAX_SCROLLBACK && this.scrollback.length > 1) {
      const removed = this.scrollback.shift();
      this.scrollbackSize -= removed.length;
    }
  }

  _updateLastActive() {
    if (this._lastActiveThrottle) return;
    this._lastActiveThrottle = setTimeout(() => {
      this._lastActiveThrottle = null;
      this.lastActive = Date.now();
    }, 30000);
  }

  addClient(ws) {
    // Send scrollback first
    for (const chunk of this.scrollback) {
      try { ws.send(chunk); } catch { break; }
    }
    this.clients.add(ws);
  }

  removeClient(ws) {
    this.clients.delete(ws);
  }

  write(data) {
    if (this.alive) {
      this.pty.write(data);
    }
  }

  resize(cols, rows) {
    if (this.alive) {
      try { this.pty.resize(cols, rows); } catch { /* ignore */ }
    }
  }

  kill() {
    if (this.alive) {
      try { this.pty.kill(); } catch { /* ignore */ }
    }
  }

  getInfo() {
    return {
      id: this.id,
      agentType: this.agentType,
      alive: this.alive,
      pid: this.pid,
      exitCode: this.exitCode,
      clients: this.clients.size,
      scrollbackSize: this.scrollbackSize,
      createdAt: this.createdAt,
      lastActive: this.lastActive
    };
  }
}

class PtyManager {
  constructor() {
    this.sessions = new Map(); // sessionId → PtySession
    this._pty = null; // lazy-loaded node-pty
  }

  _getPty() {
    if (!this._pty) {
      try {
        this._pty = require('node-pty');
      } catch (e) {
        console.error('[PtyManager] node-pty not available:', e.message);
        throw new Error('node-pty is required for terminal support. Run: npm install node-pty');
      }
    }
    return this._pty;
  }

  /**
   * Create or attach to a PTY session
   */
  spawn(sessionId, opts = {}) {
    // If already exists and alive, return it
    if (this.sessions.has(sessionId)) {
      const existing = this.sessions.get(sessionId);
      if (existing.alive) return existing;
      // Dead session, clean up
      this.sessions.delete(sessionId);
    }

    const store = getStore();
    const productService = getProductService();
    const session = store.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const adapter = createAdapter(session);
    const command = adapter.buildCommand(opts);
    const shell = adapter.getShell();
    const shellArgs = adapter.getShellArgs(command);
    const env = {
      ...process.env,
      TERM: process.env.TERM || 'xterm-256color',
      COLORTERM: process.env.COLORTERM || 'truecolor',
      FORCE_COLOR: process.env.FORCE_COLOR || '1',
      ...adapter.getEnv()
    };

    const cols = opts.cols || 120;
    const rows = opts.rows || 30;

    // Resolve CWD: session → workspace → HOME
    let cwd = session.workingDir;
    if (!cwd && session.workspaceId) {
      const workspace = store.getWorkspace(session.workspaceId);
      if (workspace && workspace.workingDir) cwd = workspace.workingDir;
    }
    const fs = require('fs');
    if ((!cwd || !fs.existsSync(cwd)) && session.workspaceId) {
      const resolvedCwd = productService.resolveWorkingDirectory(session.workspaceId, cwd);
      if (resolvedCwd) cwd = resolvedCwd;
    }
    if (!cwd) cwd = process.env.USERPROFILE || process.env.HOME || '.';

    // Validate CWD exists (error 267 on Windows if invalid)
    if (!fs.existsSync(cwd)) {
      console.warn(`[PtyManager] CWD does not exist: ${cwd}, falling back to HOME`);
      cwd = process.env.USERPROFILE || process.env.HOME || '.';
    }

    const pty = this._getPty();

    console.log(`[PtyManager] Spawning ${session.agent}: ${shell} ${shellArgs.join(' ')} in ${cwd}`);

    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env
    });

    const ptySession = new PtySession(sessionId, ptyProcess, session.agent);
    this.sessions.set(sessionId, ptySession);

    // Update store
    store.updateSession(sessionId, {
      status: 'running',
      pid: ptyProcess.pid,
      command
    });
    store.addSessionLog(sessionId, `Launched ${session.agent}: ${command}`);

    if (session.promptSeed && session.promptSeedPending !== false && opts.injectPrompt !== false) {
      const promptToSend = session.promptSeed.endsWith('\n') ? session.promptSeed : `${session.promptSeed}\r`;
      setTimeout(() => {
        try {
          ptySession.write(promptToSend);
          store.updateSession(sessionId, {
            promptSeedPending: false,
            promptSeedSentAt: Date.now()
          });
          store.addSessionLog(sessionId, 'Injected guided prompt seed');
        } catch (e) {
          store.addSessionLog(sessionId, `Prompt seed injection failed: ${e.message}`);
        }
      }, opts.promptDelayMs || 400);
    }

    return ptySession;
  }

  /**
   * Attach a WebSocket client to a session
   */
  attachClient(sessionId, ws, opts = {}) {
    let ptySession = this.sessions.get(sessionId);

    if (!ptySession || !ptySession.alive) {
      if (opts.autoSpawn === false) {
        try { ws.send(JSON.stringify({ type: 'inactive', sessionId })); } catch { /* ignore */ }
        ws.close();
        return null;
      }
      ptySession = this.spawn(sessionId, opts);
    }

    ptySession.addClient(ws);

    // Handle incoming data from client
    ws.on('message', (data) => {
      const str = data.toString();
      // Check for JSON control messages
      try {
        const msg = JSON.parse(str);
        if (msg.type === 'resize' && msg.cols && msg.rows) {
          ptySession.resize(msg.cols, msg.rows);
          return;
        }
        if (msg.type === 'input') {
          ptySession.write(msg.data);
          return;
        }
      } catch { /* not JSON, treat as raw input */ }
      ptySession.write(str);
    });

    ws.on('close', () => {
      ptySession.removeClient(ws);
    });

    ws.on('error', () => {
      ptySession.removeClient(ws);
    });

    return ptySession;
  }

  /**
   * Kill a PTY session
   */
  kill(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.kill();
      this.sessions.delete(sessionId);
      return true;
    }
    return false;
  }

  /**
   * Get info about all PTY sessions
   */
  listSessions() {
    const result = [];
    for (const [id, session] of this.sessions) {
      result.push(session.getInfo());
    }
    return result;
  }

  /**
   * Kill all orphaned PTYs (no clients and not recently active)
   */
  cleanupOrphans(maxIdleMs = 300_000) {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.clients.size === 0 && (now - session.lastActive) > maxIdleMs) {
        console.log(`[PtyManager] Cleaning up orphan: ${id}`);
        session.kill();
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Shutdown all sessions
   */
  shutdown() {
    for (const [id, session] of this.sessions) {
      session.kill();
    }
    this.sessions.clear();
  }
}

// Singleton
let _instance = null;
function getPtyManager() {
  if (!_instance) _instance = new PtyManager();
  return _instance;
}

module.exports = { PtyManager, PtySession, getPtyManager };
