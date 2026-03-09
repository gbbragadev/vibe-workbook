/**
 * Vibe Workbook - Express API Server
 * REST API + SSE events + WebSocket terminal upgrade
 */
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { getStore } = require('../state/store');
const { getPtyManager } = require('./pty-manager');
const { getCostTracker } = require('../core/cost-tracker');
const { createAdapter, getRegisteredAgents } = require('../core/agent-adapter');
const { getProductService } = require('../core/product-service');
const { getKnowledgePackService } = require('../core/knowledge-pack-service');
const { getIdeaService } = require('../core/idea-service');
const { getIdeaDiscoveryService } = require('../core/idea-discovery-service');
const { MockDiscoveryProvider } = require('../core/discovery-providers/mock-provider');
const { RedditProvider } = require('../core/discovery-providers/reddit-provider');
const { WebProvider } = require('../core/discovery-providers/web-provider');
const { XProvider } = require('../core/discovery-providers/x-provider');
const { createIdeaRoutes } = require('./routes/idea-routes');
const { createProductRoutes } = require('./routes/product-routes');

// Load all agent adapters
require('../core/agents/claude-adapter');
require('../core/agents/codex-adapter');
require('../core/agents/gemini-adapter');
require('../core/agents/antigravity-adapter');

const PORT = parseInt(process.env.PORT || '3457', 10);

function createServer() {
  const app = express();
  const server = http.createServer(app);
  const store = getStore();
  const ptyManager = getPtyManager();
  const costTracker = getCostTracker();
  const productService = getProductService();
  const knowledgePackService = getKnowledgePackService();
  const ideaService = getIdeaService();
  const ideaDiscoveryService = getIdeaDiscoveryService();

  // --- Auth ---
  const config = store.getConfig();
  const password = process.env.VIBE_PASSWORD || config.password;
  const tokens = new Set();

  function generateToken() {
    const token = crypto.randomBytes(32).toString('hex');
    tokens.add(token);
    return token;
  }

  function isValidToken(token) {
    return tokens.has(token);
  }

  // --- Middleware ---
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // Auth middleware (skip for login, health, and static files)
  function authMiddleware(req, res, next) {
    // req.path is relative to mount point '/api', so /api/login → /login
    if (req.path === '/login' || req.path === '/health') return next();
    const tok = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (!isValidToken(tok)) return res.status(401).json({ error: 'Unauthorized' });
    next();
  }
  app.use('/api', authMiddleware);

  // --- SSE ---
  const sseClients = new Set();

  function broadcastSSE(type, data) {
    const msg = `data: ${JSON.stringify({ type, data, ts: Date.now() })}\n\n`;
    for (const res of sseClients) {
      try { res.write(msg); } catch { sseClients.delete(res); }
    }
  }

  // Register discovery providers
  if (ideaDiscoveryService.getProviders().length === 0) {
    const discConfig = config.discovery || {};
    const ua = discConfig.userAgent || 'nodejs:vibe-workbook:1.0.0';
    ideaDiscoveryService.registerProvider(new RedditProvider({ userAgent: ua }));
    ideaDiscoveryService.registerProvider(new WebProvider({ userAgent: ua }));
    ideaDiscoveryService.registerProvider(new XProvider({
      username: discConfig.x?.username || '',
      password: discConfig.x?.password || '',
      userAgent: ua
    }));
    ideaDiscoveryService.registerProvider(new MockDiscoveryProvider());
  }
  if (!ideaDiscoveryService.ideaService) {
    ideaDiscoveryService.ideaService = ideaService;
  }
  ideaDiscoveryService._onProgress = (run) => broadcastSSE('idea:discovery:progress', run);

  // Wire store events to SSE
  ['workspace:created', 'workspace:updated', 'workspace:deleted', 'workspace:activated',
   'session:created', 'session:updated', 'session:deleted', 'session:log',
   'settings:updated'
  ].forEach(event => {
    store.on(event, (data) => broadcastSSE(event, data));
  });

  // --- Auth Routes ---

  app.post('/api/login', (req, res) => {
    const { password: pw } = req.body;
    if (pw === password) {
      const token = generateToken();
      res.json({ token, password });
    } else {
      res.status(401).json({ error: 'Invalid password' });
    }
  });

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: '1.0.0', uptime: process.uptime() });
  });

  // --- SSE Route ---

  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('data: {"type":"connected"}\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  });

  // --- Agent Routes ---

  app.get('/api/agents', (req, res) => {
    res.json(getRegisteredAgents());
  });

  app.post('/api/agents/discover', async (req, res) => {
    try {
      const ClaudeAdapter = require('../core/agents/claude-adapter');
      const CodexAdapter = require('../core/agents/codex-adapter');

      const [claudeSessions, codexSessions] = await Promise.all([
        ClaudeAdapter.discoverSessions(),
        CodexAdapter.discoverSessions()
      ]);

      res.json({
        claude: claudeSessions.slice(0, 50), // Limit for performance
        codex: codexSessions,
        total: claudeSessions.length + codexSessions.length
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Product & Knowledge Pack Routes ---
  app.use('/api', createProductRoutes({ productService, knowledgePackService, store, ptyManager, broadcastSSE }));

  // --- Idea Routes ---
  app.use('/api', createIdeaRoutes({ ideaService, ideaDiscoveryService, productService, store, broadcastSSE }));

  // --- Workspace Routes ---

  app.get('/api/workspaces', (req, res) => {
    res.json(store.getWorkspaces());
  });

  app.post('/api/workspaces', (req, res) => {
    const { name, description, color, agents, workingDir } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const ws = store.createWorkspace({ name, description, color, agents, workingDir });
    res.status(201).json(ws);
  });

  app.get('/api/workspaces/:id', (req, res) => {
    const ws = store.getWorkspace(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Not found' });
    res.json(ws);
  });

  app.put('/api/workspaces/:id', (req, res) => {
    const ws = store.updateWorkspace(req.params.id, req.body);
    if (!ws) return res.status(404).json({ error: 'Not found' });
    res.json(ws);
  });

  app.delete('/api/workspaces/:id', (req, res) => {
    const ok = store.deleteWorkspace(req.params.id);
    res.json({ ok });
  });

  app.post('/api/workspaces/:id/activate', (req, res) => {
    store.setActiveWorkspace(req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/workspaces/:id/cost', async (req, res) => {
    try {
      const cost = await costTracker.getWorkspaceCost(req.params.id);
      res.json(cost);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Session Routes ---

  app.get('/api/sessions', (req, res) => {
    const { workspace, agent, q } = req.query;
    let sessions = workspace ? store.getSessions(workspace) : store.getSessions();
    if (agent) sessions = sessions.filter(s => s.agent === agent);
    if (q) sessions = store.searchSessions(q);
    res.json(sessions);
  });

  app.post('/api/sessions', (req, res) => {
    const { name, workspaceId, agent, workingDir, model, effort, resumeSessionId } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const session = store.createSession({ name, workspaceId, agent, workingDir, model, effort, resumeSessionId });
    res.status(201).json(session);
  });

  app.get('/api/sessions/:id', (req, res) => {
    const session = store.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Not found' });
    res.json(session);
  });

  app.put('/api/sessions/:id', (req, res) => {
    const session = store.updateSession(req.params.id, req.body);
    if (!session) return res.status(404).json({ error: 'Not found' });
    res.json(session);
  });

  app.delete('/api/sessions/:id', (req, res) => {
    ptyManager.kill(req.params.id);
    const ok = store.deleteSession(req.params.id);
    res.json({ ok });
  });

  app.post('/api/sessions/:id/start', (req, res) => {
    try {
      const pty = ptyManager.spawn(req.params.id, req.body);
      res.json({ ok: true, pid: pty.pid });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/sessions/:id/stop', (req, res) => {
    const ok = ptyManager.kill(req.params.id);
    res.json({ ok });
  });

  app.get('/api/sessions/:id/cost', async (req, res) => {
    try {
      const cost = await costTracker.getSessionCost(req.params.id);
      if (!cost) return res.status(404).json({ error: 'Session not found' });
      res.json(cost);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Cost Dashboard ---

  app.get('/api/cost/dashboard', async (req, res) => {
    try {
      const dashboard = await costTracker.getDashboard();
      res.json(dashboard);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- PTY Info ---

  app.get('/api/pty/sessions', (req, res) => {
    res.json(ptyManager.listSessions());
  });

  // --- Settings ---

  app.get('/api/settings', (req, res) => {
    res.json(store.getSettings());
  });

  app.put('/api/settings', (req, res) => {
    store.updateSettings(req.body);
    res.json(store.getSettings());
  });

  // --- Browse Directories ---

  app.get('/api/browse', (req, res) => {
    const fs = require('fs');
    const dirPath = req.query.path || process.env.USERPROFILE || process.env.HOME || 'C:\\';
    try {
      if (!fs.existsSync(dirPath)) return res.json({ path: dirPath, dirs: [], error: 'Path not found' });
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const dirs = entries
        .filter(e => {
          if (!e.isDirectory()) return false;
          // Skip hidden/system dirs
          if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '$Recycle.Bin') return false;
          return true;
        })
        .map(e => e.name)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      const parentDir = require('path').dirname(dirPath);
      res.json({ path: dirPath, parent: parentDir !== dirPath ? parentDir : null, dirs });
    } catch (e) {
      res.json({ path: dirPath, dirs: [], error: e.message });
    }
  });

  // --- Model List per Agent ---

  app.get('/api/models', (req, res) => {
    res.json({
      claude: {
        supportsEffort: true,
        effortLevels: ['low', 'medium', 'high'],
        models: [
          { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
          { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
          { id: 'claude-sonnet-4-5-20250514', name: 'Claude Sonnet 4.5' },
          { id: 'claude-haiku-3-5-20241022', name: 'Claude Haiku 3.5' }
        ]
      },
      codex: {
        supportsEffort: true,
        effortLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
        models: [
          { id: 'gpt-5.4', name: 'GPT-5.4' },
          { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex' }
        ]
      },
      gemini: {
        supportsEffort: false,
        effortLevels: [],
        models: [
          { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
          { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash' },
          { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash-Lite' },
          { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro (Deprecated - shutdown Mar 9, 2026)' }
        ]
      },
      antigravity: {
        supportsEffort: false,
        effortLevels: [],
        models: [
          { id: 'default', name: 'Default' }
        ]
      }
    });
  });

  // --- Search ---

  app.get('/api/search', (req, res) => {
    const { q } = req.query;
    res.json(store.searchSessions(q));
  });

  // --- WebSocket Upgrade for Terminals ---

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname !== '/ws/terminal') {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get('token');
    if (!isValidToken(token)) {
      socket.destroy();
      return;
    }

    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
      socket.destroy();
      return;
    }

    const cols = parseInt(url.searchParams.get('cols') || '120', 10);
    const rows = parseInt(url.searchParams.get('rows') || '30', 10);

    wss.handleUpgrade(request, socket, head, (ws) => {
      try {
        ptyManager.attachClient(sessionId, ws, { cols, rows });
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: e.message }));
        ws.close();
      }
    });
  });

  // --- SPA Fallback ---

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // --- Cleanup ---

  const cleanupInterval = setInterval(() => {
    ptyManager.cleanupOrphans();
  }, 60_000);

  function shutdown() {
    clearInterval(cleanupInterval);
    ptyManager.shutdown();
    store.forceSave();
    store.createTimestampedBackup();
    server.close();
  }

  process.on('SIGINT', () => { shutdown(); process.exit(0); });
  process.on('SIGTERM', () => { shutdown(); process.exit(0); });

  return { app, server, start: () => {
    return new Promise((resolve) => {
      server.listen(PORT, () => {
        console.log(`\n  🚀 Vibe Workbook running at http://localhost:${PORT}\n`);
        resolve({ port: PORT });
      });
    });
  }};
}

module.exports = { createServer, PORT };
