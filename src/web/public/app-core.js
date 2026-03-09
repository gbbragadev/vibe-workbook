/**
 * Vibe Workbook - Frontend SPA Controller
 * Manages: auth, workspace sidebar, terminal grid, cost dashboard, session history
 * Note: innerHTML usage is safe here - all user content goes through App.esc() which uses textContent for sanitization
 */
(function() {
  'use strict';
  var App = window.App = {};

  // ============ STATE ============
  App.state = {
    token: localStorage.getItem('vibe_token') || '',
    workspaces: [],
    products: [],
    productDetails: {},
    allSessions: [],
    sessions: [],
    activeWorkspaceId: null,
    activeProductId: null,
    activeView: 'products',
    gridLayout: 2,
    terminalPanes: [],
    closedTerminalSessionIds: new Set(),
    startingSessionIds: new Set(),
    terminalWorkspaceSlots: {},
    agentFilter: '',
    eventSource: null,
    modelsByAgent: {},
    contextMenuWorkspaceId: null,
    settings: { theme: 'dark' },
    currentTheme: 'dark',
    ideas: [],
    activeIdeaId: null,
    discoveryStatus: null
  };
  var state = App.state;

  App.AGENT_META = {
    claude: { name: 'Claude Code', icon: 'C', color: '#d97706' },
    codex: { name: 'Codex CLI', icon: 'X', color: '#10b981' },
    gemini: { name: 'Gemini CLI', icon: 'G', color: '#4285f4' },
    antigravity: { name: 'Antigravity', icon: 'A', color: '#9333ea' }
  };

  App.STAGE_ORDER = ['idea', 'brief', 'spec', 'architecture', 'implementation', 'test', 'release'];
  App.THEME_META = {
    dark: { name: 'Midnight Indigo' },
    teal: { name: 'Teal Signal' },
    ember: { name: 'Ember Ops' }
  };

  // ============ API ============
  App.api = async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
    // Force no-store to avoid stale API responses (fixes BUG-001 frontend mismatch)
    opts.cache = opts.cache || 'no-store';
    const res = await fetch(`/api${path}`, { ...opts, headers });
    if (res.status === 401) { App.showLogin(); throw new Error('Unauthorized'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('Request failed: ' + res.status));
    return data;
  }

  App.applyTheme = function applyTheme(themeId, persistSelect) {
    const nextTheme = App.THEME_META[themeId] ? themeId : 'dark';
    state.currentTheme = nextTheme;
    document.body.dataset.theme = nextTheme;
    const select = document.getElementById('theme-select');
    if (select && persistSelect !== false) select.value = nextTheme;
    if (select && persistSelect === false) select.value = nextTheme;
  }

  App.getTerminalTheme = function getTerminalTheme() {
    if (state.currentTheme === 'teal') {
      return {
        background: '#081317', foreground: '#e4fbff', cursor: '#2dd4bf',
        selectionBackground: '#14b8a640',
        black: '#11232b', red: '#ef4444', green: '#14b8a6', yellow: '#f59e0b',
        blue: '#38bdf8', magenta: '#22d3ee', cyan: '#67e8f9', white: '#e4fbff',
        brightBlack: '#61848f', brightRed: '#f87171', brightGreen: '#2dd4bf',
        brightYellow: '#fbbf24', brightBlue: '#7dd3fc', brightMagenta: '#a5f3fc',
        brightCyan: '#cffafe', brightWhite: '#ffffff'
      };
    }
    if (state.currentTheme === 'ember') {
      return {
        background: '#15100c', foreground: '#f7eadf', cursor: '#fb923c',
        selectionBackground: '#f9731640',
        black: '#261c15', red: '#ef4444', green: '#22c55e', yellow: '#f59e0b',
        blue: '#fb923c', magenta: '#fb7185', cyan: '#fdba74', white: '#f7eadf',
        brightBlack: '#8f7561', brightRed: '#fca5a5', brightGreen: '#86efac',
        brightYellow: '#fcd34d', brightBlue: '#fdba74', brightMagenta: '#fda4af',
        brightCyan: '#fed7aa', brightWhite: '#ffffff'
      };
    }
    return {
      background: '#0f0f14', foreground: '#e0e0e8', cursor: '#e0e0e8',
      selectionBackground: '#6366f140',
      black: '#1e1e2e', red: '#ef4444', green: '#10b981', yellow: '#f59e0b',
      blue: '#6366f1', magenta: '#c084fc', cyan: '#22d3ee', white: '#e0e0e8',
      brightBlack: '#5a5a70', brightRed: '#f87171', brightGreen: '#34d399',
      brightYellow: '#fbbf24', brightBlue: '#818cf8', brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9', brightWhite: '#ffffff'
    };
  }

  // ============ AUTH ============
  App.showLogin = function showLogin() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
  }

  App.showApp = function showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
  }

  App.login = async function login(password) {
    try {
      const data = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      }).then(r => r.json());

      if (data.token) {
        state.token = data.token;
        localStorage.setItem('vibe_token', state.token);
        App.showApp();
        await App.loadData();
        App.connectSSE();
      } else {
        document.getElementById('login-error').textContent = 'Invalid password';
        document.getElementById('login-error').classList.remove('hidden');
      }
    } catch (e) {
      document.getElementById('login-error').textContent = 'Connection failed';
      document.getElementById('login-error').classList.remove('hidden');
    }
  }

  // ============ SSE ============
  App.connectSSE = function connectSSE() {
    if (state.eventSource) state.eventSource.close();
    state.eventSource = new EventSource(`/api/events?token=${state.token}`);
    state.eventSource.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        App.handleSSE(msg);
      } catch { /* ignore */ }
    };
    state.eventSource.onerror = () => {
      setTimeout(App.connectSSE, 5000);
    };
  }

  App.handleSSE = function handleSSE(msg) {
    const { type } = msg;
    if (type === 'workspace:created' || type === 'workspace:updated' || type === 'workspace:deleted') {
      App.loadWorkspaces().then(() => App.loadProducts(true)).then(App.renderCurrentView);
    }
    if (type === 'session:created' || type === 'session:updated' || type === 'session:deleted') {
      App.loadAllSessions().then(() => {
        return App.loadProducts(true);
      }).then(() => {
        App.renderWorkspaceList();
        App.renderCurrentView();
      });
    }
    if (type === 'settings:updated') {
      App.loadSettings().then(App.renderCurrentView);
    }
    if (type.startsWith('idea:')) {
      if (state.activeView === 'ideas') App.renderIdeasView();
    }
  }

  // ============ DATA LOADING ============
  App.loadData = async function loadData() {
    await Promise.all([App.loadSettings(), App.loadWorkspaces(), App.loadAllSessions(), App.loadModels(), App.loadProducts()]);
    App.updateStats();
    App.renderWorkspaceList();
    App.renderCurrentView();
  }

  App.loadSettings = async function loadSettings() {
    try {
      state.settings = await App.api('/settings');
    } catch {
      state.settings = { theme: 'dark' };
    }
    App.applyTheme(state.settings.theme || 'dark', false);
  }

  App.loadModels = async function loadModels() {
    try { state.modelsByAgent = await App.api('/models'); } catch { state.modelsByAgent = {}; }
  }

  App.loadWorkspaces = async function loadWorkspaces() {
    try { state.workspaces = await App.api('/workspaces'); } catch { state.workspaces = []; }
    App.renderWorkspaceList();
  }

  App.loadProducts = async function loadProducts(force = false) {
    if (force) state.productDetails = {};
    try { state.products = await App.api('/products'); } catch { state.products = []; }
    if (!state.activeProductId && state.products.length) state.activeProductId = state.products[0].product_id;
  }

  App.loadProductDetail = async function loadProductDetail(productId, force = false) {
    if (!productId) return null;
    if (force) delete state.productDetails[productId];
    if (!state.productDetails[productId]) {
      state.productDetails[productId] = await App.api('/products/' + encodeURIComponent(productId));
    }
    return state.productDetails[productId];
  }

  App.loadAllSessions = async function loadAllSessions() {
    try {
      state.allSessions = await App.api('/sessions');
    } catch { state.allSessions = []; }

    state.sessions = state.allSessions;
    if (state.activeWorkspaceId) state.sessions = state.sessions.filter(s => s.workspaceId === state.activeWorkspaceId);
    if (state.agentFilter) state.sessions = state.sessions.filter(s => s.agent === state.agentFilter);

    App.updateStats();
  }

  App.updateStats = function updateStats() {
    const running = state.allSessions.filter(s => s.status === 'running').length;
    const total = state.allSessions.length;
    const el = document.getElementById('header-stats');
    el.textContent = `${running} running / ${total} total`;
  }

  // ============ WORKSPACE SIDEBAR ============
  // All dynamic content is sanitized through App.esc() which uses textContent-based escaping
  App.renderWorkspaceList = function renderWorkspaceList() {
    const container = document.getElementById('workspace-list');
    if (!state.workspaces.length) {
      container.innerHTML = '<div style="padding: 20px 14px; color: var(--text-muted); font-size: 13px; text-align: center;">No runtime workspaces yet<br><small>Click &quot;+ Workspace&quot; to create one</small></div>';
      return;
    }

    container.innerHTML = state.workspaces.map(ws => {
      const isActive = ws.id === state.activeWorkspaceId;
      const wsSessions = state.allSessions.filter(s => s.workspaceId === ws.id);
      const runningCount = wsSessions.filter(s => s.status === 'running').length;
      const agents = [...new Set(wsSessions.map(s => s.agent))];

      let html = '<div class="ws-item ' + (isActive ? 'active' : '') + '" data-id="' + ws.id + '" draggable="true">';
      html += '<div class="ws-item-name">';
      html += '<span class="ws-color" style="background:' + ws.color + '"></span>';
      html += App.esc(ws.name);
      html += agents.map(a => '<span class="agent-badge ' + a + '" title="' + (App.AGENT_META[a] ? App.AGENT_META[a].name : a) + '">' + (App.AGENT_META[a] ? App.AGENT_META[a].icon : '?') + '</span>').join('');
      html += '</div>';
      html += '<div class="ws-item-meta"><span>' + wsSessions.length + ' sessions</span>';
      if (runningCount) html += '<span style="color:var(--success)">' + runningCount + ' running</span>';
      html += '</div>';

      // Show state.sessions expanded under active runtime workspace
      if (isActive && wsSessions.length) {
        html += '<div class="ws-sessions">';
        for (const s of wsSessions) {
          const statusClass = s.status === 'running' ? 'running' : (s.status === 'error' ? 'error' : 'stopped');
          html += '<div class="ws-session-item" data-sess-id="' + s.id + '" draggable="true">';
          html += '<span class="session-status ' + statusClass + '"></span>';
          html += '<span class="agent-badge ' + s.agent + '" style="width:14px;height:14px;font-size:8px">' + (App.AGENT_META[s.agent] ? App.AGENT_META[s.agent].icon : '?') + '</span>';
          html += '<span class="ws-session-name">' + App.esc(s.name) + '</span>';
          html += '<div class="ws-session-actions">';
          html += '<button onclick="window._app.startSession(\'' + s.id + '\');event.stopPropagation()" title="Start">&#9654;</button>';
          html += '<button onclick="window._app.restartSession(\'' + s.id + '\');event.stopPropagation()" title="Restart">&#8635;</button>';
          html += '<button onclick="window._app.stopSession(\'' + s.id + '\');event.stopPropagation()" title="Stop">&#9209;</button>';
          html += '<button onclick="window._app.deleteSession(\'' + s.id + '\');event.stopPropagation()" title="Delete Session">&#128465;</button>';
          html += '</div></div>';
        }
        html += '</div>';
      }

      html += '</div>';
      return html;
    }).join('');

    // Click handlers for workspace items
    container.querySelectorAll('.ws-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.ws-session-item') || e.target.closest('.ws-session-actions')) return;
        App.hideContextMenu();
        App.setActiveWorkspace(el.dataset.id);
        App.renderWorkspaceList();
        App.renderCurrentView();
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        state.contextMenuWorkspaceId = el.dataset.id;
        App.setActiveWorkspace(el.dataset.id);
        App.renderWorkspaceList();
        App.showWorkspaceContextMenu(e.clientX, e.clientY, el.dataset.id);
      });
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'workspace', workspaceId: el.dataset.id }));
        e.dataTransfer.effectAllowed = 'move';
      });
    });

    // Click handlers for session items
    container.querySelectorAll('.ws-session-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.ws-session-actions')) return;
        App.addSessionToTerminalSlots(el.dataset.sessId);
        App.switchView('terminals');
      });
      el.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'session', sessionId: el.dataset.sessId }));
        e.dataTransfer.effectAllowed = 'move';
      });
    });
  }

  // ============ SIDEBAR PRODUCTS ============
  App.renderSidebarProducts = function renderSidebarProducts() {
    var container = document.getElementById('sidebar-product-list');
    if (!container) return;
    if (!state.products || !state.products.length) {
      container.innerHTML = '<div style="padding:8px 14px;font-size:12px;color:var(--text-muted)">No products</div>';
      return;
    }
    container.innerHTML = state.products.map(function(product) {
      var isActive = product.product_id === state.activeProductId;
      var productStatus = (product.pipeline || []).some(function(s) { return s.status === 'in-progress'; })
        ? 'in-progress'
        : ((product.pipeline || []).some(function(s) { return s.status === 'ready'; }) ? 'ready' : 'not-started');
      var stageLabel = product.current_stage_id || product.computed_stage_signal || product.declared_stage || 'idea';
      return '<div class="sidebar-product-item' + (isActive ? ' active' : '') + '" data-product-id="' + product.product_id + '">' +
        '<span class="sidebar-product-dot ' + productStatus + '"></span>' +
        '<span class="sidebar-product-name">' + App.esc(product.name) + '</span>' +
        '<span class="sidebar-product-stage">' + App.esc(stageLabel) + '</span>' +
        '</div>';
    }).join('');
    container.querySelectorAll('.sidebar-product-item').forEach(function(el) {
      el.addEventListener('click', function() {
        App.setActiveProduct(el.dataset.productId);
        App.switchView('products');
      });
    });
  }

  // ============ VIEW SWITCHING ============
  App.switchView = function switchView(view) {
    state.activeView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + view).classList.add('active');
    App.updateViewButtons();
    App.renderCurrentView();
  }

  App.updateViewButtons = function updateViewButtons() {
    const buttonMap = {
      products: document.getElementById('btn-products'),
      terminals: document.getElementById('btn-terminals'),
      history: document.getElementById('btn-history'),
      discover: document.getElementById('btn-discover'),
      costs: document.getElementById('btn-cost-dashboard'),
      ideas: document.getElementById('btn-ideas')
    };
    Object.entries(buttonMap).forEach(([key, btn]) => {
      if (!btn) return;
      btn.classList.toggle('btn-primary', key === state.activeView);
    });
  }

  App.renderCurrentView = function renderCurrentView() {
    switch (state.activeView) {
      case 'products': App.renderProductsView(); break;
      case 'terminals': App.renderTerminalView(); break;
      case 'costs': App.renderCostDashboard(); break;
      case 'history': App.renderSessionHistory(); break;
      case 'discover': App.renderDiscovery(); break;
      case 'ideas': App.renderIdeasView(); break;
    }
  }

  App.setActiveWorkspace = function setActiveWorkspace(workspaceId) {
    if (state.activeWorkspaceId !== workspaceId) {
      state.closedTerminalSessionIds = new Set();
    }
    state.activeWorkspaceId = workspaceId || null;
    App.ensureTerminalSlots(state.activeWorkspaceId);
    state.sessions = state.allSessions;
    if (state.activeWorkspaceId) state.sessions = state.sessions.filter(s => s.workspaceId === state.activeWorkspaceId);
    if (state.agentFilter) state.sessions = state.sessions.filter(s => s.agent === state.agentFilter);
    document.getElementById('active-workspace-name').textContent =
      (state.workspaces.find(w => w.id === state.activeWorkspaceId) || {}).name || 'Select a runtime workspace';
  }

  App.getWorkspaceSessions = function getWorkspaceSessions(workspaceId) {
    return workspaceId ? state.allSessions.filter(s => s.workspaceId === workspaceId) : [];
  }

  App.ensureTerminalSlots = function ensureTerminalSlots(workspaceId) {
    if (!workspaceId) return [];
    const workspaceSessions = App.getWorkspaceSessions(workspaceId);
    const availableIds = workspaceSessions
      .filter(s => !state.closedTerminalSessionIds.has(s.id))
      .map(s => s.id);
    const current = Array.isArray(state.terminalWorkspaceSlots[workspaceId]) ? state.terminalWorkspaceSlots[workspaceId].slice(0, 4) : [];
    const normalized = current.filter(id => availableIds.includes(id));
    for (const sessionId of availableIds) {
      if (normalized.length >= 4) break;
      if (!normalized.includes(sessionId)) normalized.push(sessionId);
    }
    state.terminalWorkspaceSlots[workspaceId] = normalized.slice(0, 4);
    return state.terminalWorkspaceSlots[workspaceId];
  }

  App.getTerminalSlots = function getTerminalSlots(workspaceId) {
    if (!workspaceId) return [];
    return App.ensureTerminalSlots(workspaceId).slice();
  }

  App.setTerminalSlots = function setTerminalSlots(workspaceId, slots) {
    if (!workspaceId) return;
    state.terminalWorkspaceSlots[workspaceId] = (slots || []).filter(Boolean).slice(0, 4);
  }

  App.addSessionToTerminalSlots = function addSessionToTerminalSlots(sessionId, targetIndex = null) {
    const session = state.allSessions.find(s => s.id === sessionId);
    if (!session || !session.workspaceId) return false;
    if (state.activeWorkspaceId !== session.workspaceId) App.setActiveWorkspace(session.workspaceId);
    state.closedTerminalSessionIds.delete(sessionId);
    const workspaceId = session.workspaceId;
    const slots = App.getTerminalSlots(workspaceId).filter(id => id !== sessionId);
    if (targetIndex === null || targetIndex === undefined || targetIndex < 0) {
      if (slots.length < 4) {
        slots.push(sessionId);
      } else {
        slots[slots.length - 1] = sessionId;
      }
    } else {
      const boundedIndex = Math.max(0, Math.min(3, targetIndex));
      while (slots.length < boundedIndex) slots.push(null);
      slots.splice(boundedIndex, 0, sessionId);
    }
    App.setTerminalSlots(workspaceId, slots.filter(Boolean));
    return true;
  }

  App.handleTerminalDrop = function handleTerminalDrop(rawData, targetIndex = null) {
    if (!rawData) return;
    let payload = null;
    try { payload = JSON.parse(rawData); } catch { return; }
    if (!payload || !payload.type) return;
    if (payload.type === 'workspace' && payload.workspaceId) {
      App.setActiveWorkspace(payload.workspaceId);
      App.switchView('terminals');
      return;
    }
    if (payload.type === 'session' && payload.sessionId) {
      App.addSessionToTerminalSlots(payload.sessionId, targetIndex);
      App.switchView('terminals');
      App.renderWorkspaceList();
      App.renderCurrentView();
    }
  }

  App.setActiveProduct = function setActiveProduct(productId) {
    state.activeProductId = productId;
    const product = state.products.find(p => p.product_id === productId);
    if (product && product.workspace && product.workspace.runtime_workspace_id) {
      App.setActiveWorkspace(product.workspace.runtime_workspace_id);
      App.renderWorkspaceList();
    }
    App.renderCurrentView();
  }

  App.resolveOverviewPrimaryAction = function resolveOverviewPrimaryAction(product) {
    const currentRun = App.resolveCurrentRun(product);
    const nextAction = (product.next_actions || []).find(item => item && item.executable !== false && (item.step_id || item.stage_id));
    const readyStage = (product.pipeline || []).find(step => step && step.status === 'ready');

    if (currentRun && currentRun.stage_id && currentRun.stage_id !== 'idea' && currentRun.is_ready_to_complete) {
      return {
        action: 'complete-stage',
        label: 'Finish stage',
        description: 'This run already has enough evidence to close the current stage.',
        stageId: currentRun.stage_id
      };
    }
    if (nextAction) {
      return {
        action: 'execute-next-action',
        label: currentRun ? 'Execute next step' : 'Continue stage',
        description: nextAction.label || nextAction.reason || 'Use the next recommended action for this product.',
        actionId: nextAction.id || '',
        stageId: nextAction.step_id || nextAction.stage_id || ''
      };
    }
    if (readyStage) {
      return {
        action: 'start-stage',
        label: 'Start ready stage',
        description: readyStage.goal || (readyStage.label + ' is ready to continue.'),
        stageId: readyStage.stage_id
      };
    }
    return {
      action: 'open-detail',
      label: 'Open product',
      description: currentRun
        ? 'Review the active run and decide the next move.'
        : 'Open the product cockpit to review the current state.'
    };
  }

  App.buildOverviewPrimaryActionButton = function buildOverviewPrimaryActionButton(product, action) {
    if (!action) return '';
    if (action.action === 'execute-next-action') {
      return '<button class="btn btn-primary btn-cta" data-product-card-action="execute-next-action" data-product-id="' + App.esc(product.product_id) + '" data-action-id="' + App.esc(action.actionId || '') + '" data-stage-id="' + App.esc(action.stageId || '') + '">' + App.esc(action.label) + '</button>';
    }
    if (action.action === 'start-stage') {
      return '<button class="btn btn-primary btn-cta" data-product-card-action="start-stage" data-product-id="' + App.esc(product.product_id) + '" data-stage-id="' + App.esc(action.stageId || '') + '">' + App.esc(action.label) + '</button>';
    }
    if (action.action === 'complete-stage') {
      return '<button class="btn btn-primary btn-cta" data-product-card-action="complete-stage" data-product-id="' + App.esc(product.product_id) + '" data-stage-id="' + App.esc(action.stageId || '') + '">' + App.esc(action.label) + '</button>';
    }
    return '<button class="btn btn-cta" data-product-card-action="open-detail" data-product-id="' + App.esc(product.product_id) + '">' + App.esc(action.label) + '</button>';
  }

  App.handleOverviewPrimaryAction = async function handleOverviewPrimaryAction(actionEl) {
    const productId = actionEl.dataset.productId;
    const actionType = actionEl.dataset.productCardAction;
    if (!productId) return;
    if (actionType === 'execute-next-action') {
      await App.executeNextAction(productId, { id: actionEl.dataset.actionId, step_id: actionEl.dataset.stageId });
      return;
    }
    if (actionType === 'start-stage') {
      await App.startGuidedStage(productId, actionEl.dataset.stageId);
      return;
    }
    if (actionType === 'complete-stage') {
      await App.registerHandoff(productId, actionEl.dataset.stageId);
      return;
    }
    App.setActiveProduct(productId);
  }

  App.renderProductsView = async function renderProductsView() {
    const overview = document.getElementById('products-overview');
    const summary = document.getElementById('products-summary');
    const detail = document.getElementById('product-detail');

    if (!state.products.length) {
      summary.textContent = 'No products registered.';
      overview.innerHTML = '<div class="empty-panel"><h3>No products</h3><p class="empty-subtext">Registry data is unavailable.</p></div>';
      detail.innerHTML = '<div class="empty-panel"><h3>Product detail</h3><p class="empty-subtext">Select a product when the catalog is available.</p></div>';
      return;
    }

    if (!state.activeProductId || !state.products.find(p => p.product_id === state.activeProductId)) state.activeProductId = state.products[0].product_id;

    summary.textContent = state.products.length + ' registered products';
    overview.innerHTML = state.products.map(product => {
      const artifact = product.artifact_summary || { present: 0, total: 0 };
      const nextAction = (product.next_actions || [])[0];
      const knowledgeSummary = product.knowledge_summary || { active_packs: 0, active_pack_names: [] };
      const currentRun = App.resolveCurrentRun(product);
      const primaryAction = App.resolveOverviewPrimaryAction(product);
      const productStatus = (product.pipeline || []).some(step => step.status === 'in-progress')
        ? 'in-progress'
        : ((product.pipeline || []).some(step => step.status === 'ready') ? 'ready' : 'not-started');
      const stageLabel = currentRun ? (currentRun.stage_label || currentRun.stage_id || 'active run') : (product.current_stage_id || product.computed_stage_signal || product.declared_stage || 'idea');
      const readinessLabel = (product.readiness && product.readiness.status) ? String(product.readiness.status).replace(/-/g, ' ') : 'not assessed';
      const workspaceWarning = (product.workspace || {}).path_status && (product.workspace || {}).path_status !== 'valid'
        ? '<span class="chip warn">runtime workspace needs attention</span>'
        : '';
      return '<article class="product-card ' + (product.product_id === state.activeProductId ? 'active' : '') + '" data-product-id="' + product.product_id + '">' +
        '<div class="product-card-top"><div><div class="product-card-name">' + App.esc(product.name) + '</div>' +
        '<div class="chip-row" style="margin-top:6px"><span class="chip">' + App.esc(product.category) + '</span><span class="chip subtle">stage: ' + App.esc(stageLabel) + '</span>' + workspaceWarning + '</div></div>' +
        '<span class="status-pill ' + productStatus + '">' + App.stageStatusLabel(productStatus) + '</span></div>' +
        '<div class="product-card-summary">' + App.esc(product.summary || 'No product summary available.') + '</div>' +
        '<div class="product-card-stats"><div class="product-stat"><div class="product-stat-label">Artifacts</div><div class="product-stat-value">' + artifact.present + '/' + artifact.total + '</div></div><div class="product-stat"><div class="product-stat-label">Sessions</div><div class="product-stat-value">' + ((product.related_sessions || []).length) + '</div></div><div class="product-stat"><div class="product-stat-label">Readiness</div><div class="product-stat-value">' + App.esc(readinessLabel) + '</div></div><div class="product-stat"><div class="product-stat-label">Knowledge</div><div class="product-stat-value">' + App.esc(String(knowledgeSummary.active_packs || 0)) + '</div></div></div>' +
        '<div class="chip-row knowledge-chip-row" style="margin-top:10px">' + App.buildKnowledgePackChips(product.active_knowledge_packs || [], true) + '</div>' +
        (currentRun ? '<div class="product-card-run"><span class="product-card-run-label">Current run</span><strong>' + App.esc(currentRun.stage_label || currentRun.stage_id || currentRun.status || 'active') + '</strong><span class="artifact-row-meta">' + App.esc(currentRun.objective || 'Coordinated execution in progress.') + '</span></div>' : '') +
        '<div class="product-card-footer"><div><div class="product-card-next-label">Recommended next move</div><div class="artifact-row-meta" style="margin-top:4px">' + App.esc(primaryAction ? primaryAction.description : (nextAction ? nextAction.label : 'Review the product detail to decide the next move.')) + '</div></div><div class="product-card-footer-actions">' + App.buildOverviewPrimaryActionButton(product, primaryAction) + '</div></div>' +
        '</article>';
    }).join('');

    overview.querySelectorAll('.product-card').forEach(card => {
      card.addEventListener('click', () => App.setActiveProduct(card.dataset.productId));
    });
    overview.querySelectorAll('[data-product-card-action]').forEach(button => {
      button.addEventListener('click', async function(event) {
        event.stopPropagation();
        await App.handleOverviewPrimaryAction(button);
      });
    });

    detail.innerHTML = '<div class="empty-panel"><h3>Loading product</h3><p class="empty-subtext">Preparing detail...</p></div>';
    try {
      const data = await App.loadProductDetail(state.activeProductId);
      if (data.product_id !== state.activeProductId) return;
      detail.innerHTML = App.buildProductDetailHtml(data);
      App.bindProductDetailActions(data);
    } catch (e) {
      detail.innerHTML = '<div class="empty-panel"><h3>Failed to load product</h3><p class="empty-subtext">' + App.esc(e.message) + '</p></div>';
    }
    App.renderSidebarProducts();
  }

  App.buildReadinessPanel = function buildReadinessPanel(detail) {
    var readiness = detail.readiness;
    if (!readiness) return '';
    var releasePacket = detail.release_packet || {};
    var displayReadiness = App.deriveReadinessDisplay(readiness);
    var statusClass = displayReadiness.status === 'ready-for-release-candidate' ? 'readiness-ready' : displayReadiness.status === 'needs-evidence' ? 'readiness-needs-evidence' : 'readiness-not-ready';
    var signalsHtml = (readiness.signals || []).map(function(s) {
      var strength = s.strength || 'none';
      var dots = strength === 'strong' ? '●●●' : strength === 'sufficient' ? '●●' : strength === 'weak' ? '●' : '';
      var strengthBadge = dots ? '<span class="signal-strength ' + strength + '" title="Signal strength: ' + strength + '">' + dots + '</span>' : '';
      return '<div class="readiness-signal-row ' + (s.met ? 'met' : 'unmet') + '">' + (s.met ? '&#10003;' : '&#10007;') + ' ' + App.esc(s.label) + strengthBadge + '</div>';
    }).join('');
    var gapsHtml = (readiness.gaps || []).length
      ? '<div class="chip-row" style="margin-top:10px">' + readiness.gaps.map(function(g) { return '<span class="chip ' + (g.severity === 'required' ? 'warn' : 'subtle') + '">' + App.esc(g.label) + '</span>'; }).join('') + '</div>'
      : '';
    var keyArtifactsHtml = (releasePacket.key_artifacts || []).map(function(a) {
      var contentState = a.content_status || (a.exists ? 'valid' : 'missing');
      var label = contentState === 'skeletal' ? 'skeletal' : (a.exists ? 'present' : 'missing');
      return '<span class="artifact-chip ' + App.esc(contentState === 'valid' ? 'exists' : contentState) + '">' + App.esc(a.label) + ': ' + label + '</span>';
    }).join('');
    return '<section class="detail-panel"><div class="panel-header"><h3>Release Readiness</h3><span class="status-pill ' + App.esc(statusClass) + '">' + App.esc(displayReadiness.label) + '</span></div><div class="panel-body">' +
      '<div class="summary-callout ' + statusClass + '"><strong>' + App.esc(displayReadiness.label) + '</strong><p style="margin-top:6px;font-size:13px;color:var(--text-secondary)">' + App.esc(displayReadiness.summary) + '</p></div>' +
      '<div class="readiness-signals">' + signalsHtml + '</div>' +
      gapsHtml +
      (keyArtifactsHtml ? '<div style="margin-top:12px"><span class="meta-item-label">Key Artifacts</span><div class="chip-row" style="margin-top:6px">' + keyArtifactsHtml + '</div></div>' : '') +
      (releasePacket.next_release_step ? '<div class="summary-callout" style="margin-top:12px"><span class="meta-item-label">Next Release Step</span><p style="margin-top:6px;font-size:13px">' + App.esc(releasePacket.next_release_step) + '</p></div>' : '') +
      '</div></section>';
  }

  App.deriveReadinessDisplay = function deriveReadinessDisplay(readiness) {
    var fallbackStatus = (readiness && readiness.status) || 'not-ready';
    var fallbackLabel = (readiness && readiness.label) || 'Not ready';
    var signals = Array.isArray(readiness && readiness.signals) ? readiness.signals : [];
    if (!signals.length) {
      return {
        status: fallbackStatus,
        label: fallbackLabel,
        summary: (readiness && readiness.summary) || ''
      };
    }

    var metSignals = signals.filter(function(signal) { return !!signal.met; }).length;
    if (metSignals === signals.length) {
      return {
        status: 'ready-for-release-candidate',
        label: 'All signals met',
        summary: (readiness && readiness.summary) || 'All signals met.'
      };
    }
    if (metSignals >= 3) {
      return {
        status: 'needs-evidence',
        label: 'Needs more evidence',
        summary: (readiness && readiness.summary) || ''
      };
    }
    return {
      status: 'not-ready',
      label: fallbackLabel === 'Needs more evidence' ? 'Not ready' : fallbackLabel,
      summary: (readiness && readiness.summary) || ''
    };
  }

  App.formatConfidence = function formatConfidence(value) {
    var num = Number(value || 0);
    if (!isFinite(num) || num <= 0) return 'low';
    if (num >= 0.85) return 'high';
    if (num >= 0.7) return 'medium';
    return 'low';
  }

  App.buildCopilotStateChip = function buildCopilotStateChip(state) {
    var normalized = String(state || '').toLowerCase();
    var chipClass = normalized === 'accepted' ? 'ok' : normalized === 'candidate' ? 'warn' : normalized === 'blocked' ? '' : 'subtle';
    return '<span class="chip ' + chipClass + '">' + App.esc(normalized || 'unknown') + '</span>';
  }

  App.formatStageLabel = function formatStageLabel(stageId, detail) {
    var normalized = String(stageId || '').trim();
    var pipelineStage = (detail && detail.pipeline || []).find(function(step) { return step && step.stage_id === normalized; });
    if (pipelineStage && pipelineStage.label) return pipelineStage.label;
    if (!normalized) return 'Idea';
    return normalized
      .replace(/[_-]+/g, ' ')
      .split(' ')
      .filter(Boolean)
      .map(function(part) { return part.charAt(0).toUpperCase() + part.slice(1); })
      .join(' ');
  }

  App.resolveAuthoritativeStageId = function resolveAuthoritativeStageId(detail) {
    return detail.current_stage_id || detail.computed_stage_signal || detail.declared_stage || 'idea';
  }

  App.resolveStageById = function resolveStageById(detail, stageId) {
    return (detail.pipeline || []).find(function(step) { return step && step.stage_id === stageId; }) || null;
  }

  App.resolveAgentLabel = function resolveAgentLabel(agentId) {
    var normalized = String(agentId || '').toLowerCase();
    if (!normalized) return '';
    var meta = App.AGENT_META[normalized];
    if (meta && meta.name) return meta.name.replace(' CLI', '').replace(' Code', '');
    return App.formatStageLabel(normalized);
  }

  App.toRepoRelativePath = function toRepoRelativePath(detail, targetPath) {
    var fullPath = String(targetPath || '');
    var repoPath = (((detail || {}).repo || {}).local_path || '');
    if (!fullPath) return '';
    if (!repoPath) return fullPath;
    var normalizedTarget = fullPath.replace(/\\/g, '/');
    var normalizedRepo = repoPath.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normalizedTarget.toLowerCase().indexOf(normalizedRepo.toLowerCase() + '/') === 0) {
      return normalizedTarget.slice(normalizedRepo.length + 1);
    }
    return fullPath;
  }

  App.resolveCopilotStatus = function resolveCopilotStatus(detail, pendingItems, primaryAction) {
    var blockers = (pendingItems || []).filter(function(item) { return item.status === 'missing' || item.status === 'blocked'; });
    var reviews = (pendingItems || []).filter(function(item) { return item.status === 'review'; });
    if (blockers.length) {
      return { label: 'Blocked', summary: 'Stop and fix this first', tone: 'danger', className: 'blocked' };
    }
    if (reviews.length) {
      return { label: 'Needs review', summary: 'Validate new evidence before moving on', tone: 'warning', className: 'ready' };
    }
    if (primaryAction && primaryAction.type === 'complete-stage') {
      return { label: 'Ready to finish', summary: 'Enough evidence to close the stage', tone: 'success', className: 'done' };
    }
    return { label: 'Ready to move', summary: 'One guided next step is available', tone: 'success', className: 'done' };
  }

  App.resolveCopilotRiskMeta = function resolveCopilotRiskMeta(detail, pendingItems) {
    var recommendation = (detail.copilot || {}).recommended_next_move || {};
    var confidence = Number(recommendation.confidence || 0);
    var topItem = (pendingItems || [])[0] || null;
    var level = 'danger';
    if (isFinite(confidence) && confidence >= 0.8) {
      level = 'success';
    } else if (isFinite(confidence) && confidence >= 0.6) {
      level = 'warning';
    }
    var blockers = (pendingItems || []).filter(function(item) { return item.status === 'missing' || item.status === 'blocked'; });
    if (blockers.length > 0 && level === 'success') {
      level = 'warning';
    }
    var label = level === 'success' ? 'Caminho seguro' : (level === 'warning' ? 'Atencao recomendada' : 'Risco elevado de retrabalho');
    var message = 'Avance somente depois de revisar a proxima evidencia recomendada.';
    if (topItem) {
      if (topItem.kind === 'artifact-gap') {
        message = 'Sem ' + topItem.shortLabel + ', a proxima etapa tende a abrir retrabalho.';
      } else if (topItem.kind === 'candidate-review') {
        message = 'Se voce ignorar esta revisao, a memoria do produto pode seguir com contexto errado.';
      } else if (topItem.kind === 'open-decision') {
        message = 'Sem fechar esta decisao, implementacao e testes podem seguir premissas conflitantes.';
      } else if (topItem.kind === 'readiness-gap') {
        message = topItem.detail || message;
      }
    } else if ((detail.current_run || {}).is_ready_to_complete) {
      message = 'A etapa atual ja acumulou evidencia suficiente para um handoff seguro.';
    } else if (recommendation.reason) {
      message = recommendation.reason;
    }
    return { level: level, label: label, message: message };
  }

  App.resolveExpectedEvidence = function resolveExpectedEvidence(detail, stageId, pendingItems) {
    var artifactItem = (pendingItems || []).find(function(item) { return item.kind === 'artifact-gap' && item.evidencePath; });
    if (artifactItem) {
      return {
        label: artifactItem.shortLabel,
        path: artifactItem.evidencePath,
        helper: 'Registre esta evidencia para liberar ' + App.formatStageLabel(stageId, detail) + '.'
      };
    }
    var nextAction = (detail.next_actions || []).find(function(item) { return item && item.executable !== false; });
    var outputs = nextAction ? App.normalizeOutputList(nextAction.expected_outputs || nextAction.outputs_expected || []) : [];
    if (outputs.length) {
      return {
        label: 'Expected output',
        path: outputs[0],
        helper: 'Esta e a evidencia esperada pela proxima acao oficial.'
      };
    }
    var currentRun = App.resolveCurrentRun(detail);
    var runOutputs = currentRun ? App.normalizeOutputList(currentRun.expected_outputs || []) : [];
    if (runOutputs.length) {
      return {
        label: 'Run output',
        path: runOutputs[0],
        helper: 'O run atual espera este output como proxima prova.'
      };
    }
    var stage = App.resolveStageById(detail, stageId);
    var fallbackArtifactId = stage && stage.required_artifacts && stage.required_artifacts[0];
    var artifact = fallbackArtifactId ? (detail.artifacts || []).find(function(item) { return item.id === fallbackArtifactId; }) : null;
    if (artifact) {
      return {
        label: artifact.label,
        path: App.toRepoRelativePath(detail, artifact.path),
        helper: artifact.exists ? 'Arquivo ja encontrado no repositorio.' : 'Arquivo esperado para esta etapa.'
      };
    }
    return { label: 'No evidence mapped yet', path: '', helper: 'O repositorio ainda nao sinalizou uma evidencia unica para esta etapa.' };
  }

  App.buildCopilotPendingItems = function buildCopilotPendingItems(detail, stageId) {
    var items = [];
    var stage = App.resolveStageById(detail, stageId);
    var artifactsById = (detail.artifacts || []).reduce(function(acc, artifact) {
      acc[artifact.id] = artifact;
      return acc;
    }, {});

    ((stage && stage.required_artifacts) || []).forEach(function(artifactId) {
      var artifact = artifactsById[artifactId];
      var missing = !artifact || !artifact.exists;
      var skeletal = artifact && artifact.content_status === 'skeletal';
      if (!missing && !skeletal) return;
      items.push({
        key: 'artifact:' + artifactId,
        kind: 'artifact-gap',
        status: missing ? 'missing' : 'blocked',
        icon: missing ? 'x' : '!',
        title: (artifact ? artifact.label : App.formatStageLabel(artifactId)) + (missing ? ' ausente' : ' precisa de conteudo'),
        shortLabel: artifact ? artifact.label : App.formatStageLabel(artifactId),
        detail: App.formatStageLabel(stageId, detail) + ' ainda nao tem a evidencia minima para seguir com seguranca.',
        evidencePath: artifact ? App.toRepoRelativePath(detail, artifact.path) : '',
        actionType: 'start-stage',
        actionLabel: missing ? 'Criar' : 'Completar',
        stageId: stageId
      });
    });

    ((detail.copilot || {}).candidate_artifacts || [])
      .filter(function(item) { return item && item.accepted === null && item.counts_as_artifact; })
      .slice(0, 3)
      .forEach(function(item) {
        items.push({
          key: 'candidate:' + item.candidate_id,
          kind: 'candidate-review',
          status: 'review',
          icon: '...',
          title: item.kind_guess || item.relative_path || 'Artifact candidate',
          shortLabel: item.kind_guess || 'Artifact candidate',
          detail: item.reason || 'A IA gerou material fora do caminho canonico e ele precisa de revisao.',
          evidencePath: App.toRepoRelativePath(detail, item.relative_path || item.path || ''),
          actionType: 'review-candidate',
          actionLabel: 'Revisar',
          candidateId: item.candidate_id
        });
      });

    ((detail.copilot || {}).decision_log || [])
      .filter(function(item) { return item && item.status === 'open'; })
      .slice(0, 3)
      .forEach(function(item) {
        items.push({
          key: 'decision:' + item.decision_id,
          kind: 'open-decision',
          status: 'blocked',
          icon: '!',
          title: item.title || 'Decisao em aberto',
          shortLabel: item.title || 'Decisao em aberto',
          detail: item.note || 'Registre a decisao para liberar o fluxo da etapa atual.',
          evidencePath: item.linked_stage ? ('stage: ' + item.linked_stage) : '',
          actionType: 'resolve-decision',
          actionLabel: 'Resolver',
          decisionId: item.decision_id
        });
      });

    if (!items.length && ((detail.readiness || {}).gaps || []).length) {
      var readinessGap = detail.readiness.gaps[0];
      items.push({
        key: 'readiness:' + (readinessGap.label || 'gap'),
        kind: 'readiness-gap',
        status: 'blocked',
        icon: '!',
        title: readinessGap.label || 'Readiness gap',
        shortLabel: readinessGap.label || 'Readiness gap',
        detail: 'A plataforma ainda nao considera o produto pronto para avancar sem revisao manual.',
        evidencePath: '',
        actionType: 'start-stage',
        actionLabel: 'Continuar',
        stageId: stageId
      });
    }

    return items.slice(0, 5);
  }

  App.buildCopilotDoneItems = function buildCopilotDoneItems(detail) {
    var created = ((detail.copilot || {}).created_assets || []).filter(Boolean).slice(0, 3).map(function(item) {
      return {
        label: item.label || item.relative_path || item.path || 'Registered asset',
        meta: App.toRepoRelativePath(detail, item.relative_path || item.path || ''),
        state: item.status || 'accepted'
      };
    });
    if (created.length) return created;
    return (detail.artifacts || []).filter(function(item) { return item && item.exists; }).slice(0, 3).map(function(item) {
      return {
        label: item.label,
        meta: App.toRepoRelativePath(detail, item.path),
        state: item.content_status === 'skeletal' ? 'needs-content' : 'accepted'
      };
    });
  }

  App.buildCopilotReason = function buildCopilotReason(detail, stageId, pendingItems, primaryAction) {
    var topItem = (pendingItems || [])[0] || null;
    if (topItem && topItem.kind === 'artifact-gap') {
      return 'O fluxo para em ' + App.formatStageLabel(stageId, detail) + ' porque a evidencia minima ainda nao foi registrada no repositorio.';
    }
    if (topItem && topItem.kind === 'candidate-review') {
      return 'Os novos artefatos ainda nao entraram na memoria oficial do produto. Revise antes de abrir mais trabalho.';
    }
    if (topItem && topItem.kind === 'open-decision') {
      return 'Existe uma decisao aberta bloqueando coerencia entre handoff, implementacao e teste.';
    }
    if (primaryAction && primaryAction.type === 'complete-stage') {
      return 'A etapa atual ja acumulou contexto suficiente para fechar o handoff e passar bastao.';
    }
    if (primaryAction && (primaryAction.type === 'execute-next-action' || primaryAction.type === 'start-stage')) {
      return 'O estado real do produto ja permite uma proxima acao guiada sem abrir uma refatoracao maior.';
    }
    return ((detail.copilot || {}).recommended_next_move || {}).reason || 'Revise o estado real do produto e avance uma acao por vez.';
  }

  App.buildCopilotNarrative = function buildCopilotNarrative(detail, stageId, pendingItems, primaryAction) {
    var stageLabel = App.formatStageLabel(stageId, detail);
    var topItem = (pendingItems || [])[0] || null;
    if (topItem && topItem.kind === 'artifact-gap') {
      return stageLabel + ' esta em andamento, mas ainda falta ' + topItem.shortLabel + ' para avancar com seguranca.';
    }
    if (topItem && topItem.kind === 'candidate-review') {
      return 'A IA gerou novos materiais para ' + stageLabel + '. Valide esse handoff antes de criar trabalho em cima dele.';
    }
    if (topItem && topItem.kind === 'open-decision') {
      return 'Ainda ha uma decisao aberta segurando ' + stageLabel + '. Resolva isso para liberar o fluxo.';
    }
    if (stageId === 'idea' && !(detail.summary || '').trim()) {
      return 'O projeto ainda esta em branco. Defina a visao do produto antes de abrir novas frentes.';
    }
    if (primaryAction && primaryAction.type === 'complete-stage') {
      return stageLabel + ' ja acumulou evidencia suficiente para ser concluido.';
    }
    if (primaryAction && (primaryAction.type === 'execute-next-action' || primaryAction.type === 'start-stage')) {
      return 'O terreno esta limpo para continuar ' + stageLabel + ' com a proxima acao guiada.';
    }
    return (detail.copilot || {}).summary || 'O Copilot ainda esta organizando o estado real do produto.';
  }

  App.resolveCopilotHeroAction = function resolveCopilotHeroAction(detail, stageId, pendingItems, statusMeta) {
    var topItem = (pendingItems || [])[0] || null;
    var currentRun = App.resolveCurrentRun(detail);
    var nextAction = (detail.next_actions || []).find(function(item) { return item && item.executable !== false && (item.step_id || item.stage_id); });
    var action = App.resolvePrimaryProductAction(detail);
    var actionStageId = (action && action.stageId) || (nextAction && (nextAction.step_id || nextAction.stage_id)) || stageId;
    var actionStage = App.resolveStageById(detail, actionStageId);
    var actionAgent = App.resolveAgentLabel((nextAction && (nextAction.recommended_runtime_agent || nextAction.runtime_agent)) || (actionStage && actionStage.recommended_runtime_agent) || ((currentRun || {}).suggested_runtime_agent) || '');
    var toneClass = statusMeta.tone === 'danger' ? 'tone-danger' : (statusMeta.tone === 'warning' ? 'tone-warning' : 'tone-success');

    if (topItem && topItem.actionType === 'review-candidate') {
      return {
        html: '<button class="btn btn-cta copilot-primary-btn ' + toneClass + '" data-copilot-action="review-candidate" data-candidate-id="' + App.esc(topItem.candidateId) + '">Revisar handoff</button>',
        support: 'Valide o material antes de usa-lo como memoria oficial.'
      };
    }
    if (topItem && topItem.actionType === 'resolve-decision') {
      return {
        html: '<button class="btn btn-cta copilot-primary-btn ' + toneClass + '" data-copilot-action="resolve-decision" data-decision-id="' + App.esc(topItem.decisionId) + '">Resolver decisao aberta</button>',
        support: 'Feche a premissa que esta bloqueando a etapa atual.'
      };
    }
    if (topItem && topItem.actionType === 'start-stage') {
      return {
        html: '<button class="btn btn-cta copilot-primary-btn ' + toneClass + '" data-product-action="start-stage" data-stage-id="' + App.esc(topItem.stageId || stageId) + '">Continuar ' + App.esc(App.formatStageLabel(topItem.stageId || stageId, detail)) + (actionAgent ? ' (' + App.esc(actionAgent) + ')' : '') + '</button>',
        support: 'Abra a sessao guiada para produzir a evidencia que falta.'
      };
    }
    if (action) {
      var overrideLabel = action.label || 'Continuar';
      if (action.type === 'execute-next-action' || action.type === 'start-stage') {
        overrideLabel = 'Continuar ' + App.formatStageLabel(actionStageId, detail) + (actionAgent ? ' (' + actionAgent + ')' : '');
      } else if (action.type === 'complete-stage') {
        overrideLabel = 'Finalizar ' + App.formatStageLabel(action.stageId || stageId, detail);
      } else if (action.type === 'open-session') {
        overrideLabel = 'Retomar execucao';
      } else if (action.type === 'open-workspace') {
        overrideLabel = 'Abrir runtime workspace';
      }
      return {
        html: App.buildPrimaryActionButton(action, 'btn btn-cta copilot-primary-btn ' + toneClass, overrideLabel),
        support: action.description || 'Siga a proxima acao oficial do produto.'
      };
    }
    return {
      html: '<button class="btn btn-cta copilot-primary-btn ' + toneClass + '" data-copilot-action="refresh">Atualizar leitura</button>',
      support: 'Recarregue o snapshot do produto para ver a proxima recomendacao.'
    };
  }

  App.buildCopilotTaskAction = function buildCopilotTaskAction(item) {
    if (!item) return '';
    if (item.actionType === 'start-stage') {
      return '<button class="btn btn-sm" data-product-action="start-stage" data-stage-id="' + App.esc(item.stageId || '') + '">' + App.esc(item.actionLabel || 'Continuar') + '</button>';
    }
    if (item.actionType === 'review-candidate') {
      return '<button class="btn btn-sm" data-copilot-action="review-candidate" data-candidate-id="' + App.esc(item.candidateId || '') + '">' + App.esc(item.actionLabel || 'Revisar') + '</button>';
    }
    if (item.actionType === 'resolve-decision') {
      return '<button class="btn btn-sm" data-copilot-action="resolve-decision" data-decision-id="' + App.esc(item.decisionId || '') + '">' + App.esc(item.actionLabel || 'Resolver') + '</button>';
    }
    return '';
  }

  App.buildCopilotPanel = function buildCopilotPanel(detail) {
    var copilot = detail.copilot;
    if (!copilot) return '';

    var stageId = App.resolveAuthoritativeStageId(detail);
    var pendingItems = App.buildCopilotPendingItems(detail, stageId);
    var doneItems = App.buildCopilotDoneItems(detail);
    var primaryAction = App.resolvePrimaryProductAction(detail);
    var statusMeta = App.resolveCopilotStatus(detail, pendingItems, primaryAction);
    var riskMeta = App.resolveCopilotRiskMeta(detail, pendingItems);
    var evidence = App.resolveExpectedEvidence(detail, stageId, pendingItems);
    var narrative = App.buildCopilotNarrative(detail, stageId, pendingItems, primaryAction);
    var reason = App.buildCopilotReason(detail, stageId, pendingItems, primaryAction);
    var heroAction = App.resolveCopilotHeroAction(detail, stageId, pendingItems, statusMeta);
    var artifactSummary = detail.artifact_summary || { present: 0, total: 0 };
    var displayReadiness = App.deriveReadinessDisplay(detail.readiness || {});
    var blockers = ((copilot.current_state || {}).blockers || []).slice(0, 3);
    var stageLabel = detail.current_stage_id || detail.computed_stage_signal || detail.declared_stage || 'idea';

    var riskClass = riskMeta.level === 'success' ? 'tone-success' : (riskMeta.level === 'warning' || riskMeta.level === 'medium' ? 'tone-warning' : 'tone-danger');

    var pendingHtml = pendingItems.length
      ? '<div class="copilot-task-list">' + pendingItems.map(function(item) {
          var statusIcon = item.status === 'missing' ? '<span class="copilot-icon missing">&#10007;</span>'
            : item.status === 'blocked' ? '<span class="copilot-icon blocked">!</span>'
            : '<span class="copilot-icon review">...</span>';
          return '<div class="copilot-task-row"><div class="copilot-task-info">' + statusIcon + '<div><strong>' + App.esc(item.title) + '</strong><div class="artifact-row-meta">' + App.esc(item.detail || '') + '</div></div></div><div class="copilot-task-action">' + App.buildCopilotTaskAction(item) + '</div></div>';
        }).join('') + '</div>'
      : '';

    var doneHtml = doneItems.length
      ? '<div class="copilot-done-list">' + doneItems.map(function(item) {
          return '<div class="copilot-done-row"><span class="copilot-icon done">&#10003;</span><div><span>' + App.esc(item.label) + '</span><span class="artifact-row-meta mono">' + App.esc(item.meta || '') + '</span></div></div>';
        }).join('') + '</div>'
      : '';

    return '<section class="detail-panel copilot-hero-panel">' +
      '<div class="copilot-hero-header">' +
        '<div class="copilot-hero-status"><h3>Project Copilot</h3><span class="chip ' + App.esc(statusMeta.className) + '">' + App.esc(statusMeta.label) + '</span></div>' +
        '<div class="copilot-hero-risk ' + App.esc(riskClass) + '"><span class="risk-label">' + App.esc(riskMeta.label) + '</span></div>' +
      '</div>' +
      '<div class="copilot-hero-stats">' +
        '<div class="copilot-stat"><span class="copilot-stat-label">Stage</span><span class="copilot-stat-value">' + App.esc(stageLabel) + '</span></div>' +
        '<div class="copilot-stat"><span class="copilot-stat-label">Artifacts</span><span class="copilot-stat-value">' + App.esc(String(artifactSummary.present) + '/' + String(artifactSummary.total)) + '</span></div>' +
        '<div class="copilot-stat"><span class="copilot-stat-label">Readiness</span><span class="copilot-stat-value">' + App.esc(displayReadiness.label || 'N/A') + '</span></div>' +
        '<div class="copilot-stat"><span class="copilot-stat-label">Blockers</span><span class="copilot-stat-value">' + App.esc(String(blockers.length)) + '</span></div>' +
      '</div>' +
      '<div class="copilot-hero-body">' +
        '<p class="copilot-narrative">' + App.esc(narrative) + '</p>' +
        '<p class="copilot-reason">' + App.esc(reason) + '</p>' +
        (evidence.path ? '<div class="copilot-evidence"><span class="meta-item-label">Evidencia esperada</span><span class="mono">' + App.esc(evidence.path) + '</span><span class="artifact-row-meta">' + App.esc(evidence.helper || '') + '</span></div>' : '') +
        '<div class="copilot-hero-cta">' + heroAction.html + '<span class="artifact-row-meta">' + App.esc(heroAction.support || '') + '</span></div>' +
        (riskMeta.message ? '<div class="copilot-risk-message ' + App.esc(riskClass) + '"><span>' + App.esc(riskMeta.message) + '</span></div>' : '') +
      '</div>' +
      (blockers.length ? '<div class="copilot-blocker-chips">' + blockers.map(function(b) { return '<span class="chip warn">' + App.esc(b.label) + '</span>'; }).join('') + '</div>' : '') +
      (pendingHtml ? '<div class="copilot-hero-pending"><div class="meta-item-label">Pendencias</div>' + pendingHtml + '</div>' : '') +
      (doneHtml ? '<div class="copilot-hero-done"><div class="meta-item-label">Concluido</div>' + doneHtml + '</div>' : '') +
      '</section>';
  }

  App.resolvePrimaryProductAction = function resolvePrimaryProductAction(detail) {
    const currentRun = App.resolveCurrentRun(detail);
    const nextAction = (detail.next_actions || []).find(item => item && item.executable !== false && (item.step_id || item.stage_id));
    const primarySession = currentRun ? App.pickPrimaryRunSession(currentRun, detail) : null;
    const recommendedStage = ((detail.copilot || {}).recommended_next_move || {}).stage_hint
      || (((detail.pipeline || []).find(step => step && step.status === 'ready') || {}).stage_id || '');

    if (currentRun && currentRun.stage_id && currentRun.stage_id !== 'idea' && currentRun.is_ready_to_complete) {
      return {
        type: 'complete-stage',
        label: 'Finish current stage',
        description: 'The current run already has enough evidence to save the handoff.',
        stageId: currentRun.stage_id
      };
    }
    if (nextAction) {
      return {
        type: 'execute-next-action',
        label: 'Execute next step',
        description: nextAction.reason || nextAction.label || 'Use the recommended next step for this product.',
        actionId: nextAction.id || '',
        stageId: nextAction.step_id || nextAction.stage_id || ''
      };
    }
    if (recommendedStage) {
      return {
        type: 'start-stage',
        label: 'Continue stage',
        description: ((detail.copilot || {}).recommended_next_move || {}).reason || 'Continue the next stage with the available context.',
        stageId: recommendedStage
      };
    }
    if (primarySession) {
      return {
        type: 'open-session',
        label: 'Open active session',
        description: 'Jump back into the main execution session for this product.',
        sessionId: primarySession.id
      };
    }
    if ((detail.workspace || {}).runtime_workspace_id) {
      return {
        type: 'open-workspace',
        label: 'Open runtime workspace',
        description: 'Review the execution environment for this product.',
        workspaceId: detail.workspace.runtime_workspace_id
      };
    }
    return null;
  }

  App.buildPrimaryActionButton = function buildPrimaryActionButton(action, classNames, overrideLabel) {
    if (!action) return '';
    var label = overrideLabel || action.label || 'Continue';
    var btnClass = classNames || 'btn btn-primary';
    if (action.type === 'execute-next-action') {
      return '<button class="' + App.esc(btnClass) + '" data-product-action="execute-next-action" data-action-id="' + App.esc(action.actionId || '') + '" data-stage-id="' + App.esc(action.stageId || '') + '">' + App.esc(label) + '</button>';
    }
    if (action.type === 'start-stage') {
      return '<button class="' + App.esc(btnClass) + '" data-product-action="start-stage" data-stage-id="' + App.esc(action.stageId || '') + '">' + App.esc(label) + '</button>';
    }
    if (action.type === 'complete-stage') {
      return '<button class="' + App.esc(btnClass) + '" data-stage-action="complete" data-stage-id="' + App.esc(action.stageId || '') + '">' + App.esc(label) + '</button>';
    }
    if (action.type === 'open-session') {
      return '<button class="' + App.esc(btnClass) + '" data-stage-action="open-session" data-session-id="' + App.esc(action.sessionId || '') + '">' + App.esc(label) + '</button>';
    }
    if (action.type === 'open-workspace') {
      return '<button class="' + App.esc(btnClass) + '" data-product-action="open-workspace">' + App.esc(label) + '</button>';
    }
    return '';
  }

  App.buildCollapsiblePanel = function buildCollapsiblePanel(title, meta, bodyHtml, open) {
    return '<section class="detail-panel collapsible-panel"><details class="panel-disclosure"' + (open ? ' open' : '') + '><summary class="panel-disclosure-summary"><div><strong>' + App.esc(title) + '</strong><div class="artifact-row-meta">' + App.esc(meta || '') + '</div></div><span class="chip subtle">details</span></summary><div class="panel-body">' + bodyHtml + '</div></details></section>';
  }

  App.buildExecutiveSummaryPanel = function buildExecutiveSummaryPanel(detail, currentRun, latestHandoff) {
    var primaryAction = App.resolvePrimaryProductAction(detail);
    var copilot = detail.copilot || {};
    var blockers = ((copilot.current_state || {}).blockers || []).slice(0, 3);
    var artifactSummary = detail.artifact_summary || { present: 0, total: 0 };
    var stageLabel = detail.current_stage_id || detail.computed_stage_signal || detail.declared_stage || 'idea';
    var readiness = detail.readiness || {};
    var displayReadiness = App.deriveReadinessDisplay(readiness);
    var technicalSummary = '<details class="inline-details"><summary>Technical context</summary><div class="inline-details-body"><div class="meta-list">' +
      App.metaItem('Owner', detail.owner) +
      App.metaItem('Runtime Workspace', ((detail.workspace || {}).linked_workspace_name || (detail.workspace || {}).runtime_workspace_id || 'none')) +
      App.metaItem('Repo', ((detail.repo || {}).local_path || 'unknown')) +
      App.metaItem('Declared Stage', detail.declared_stage || 'unknown') +
      App.metaItem('Stage Signal', detail.computed_stage_signal || 'unknown') +
      App.metaItem('Tracked Runs', String(((detail.runs || []).length))) +
      App.metaItem('Handoffs', String(((detail.handoffs || []).length))) +
      App.metaItem('Latest Completion', latestHandoff ? App.formatDateTime(latestHandoff.created_at) : 'none') +
      '</div></div></details>';
    var blockerHtml = blockers.length
      ? '<div class="chip-row" style="margin-top:10px">' + blockers.map(function(item) {
          return '<span class="chip warn">' + App.esc(item.label) + '</span>';
        }).join('') + '</div>'
      : '<div class="artifact-row-meta" style="margin-top:10px">No critical blockers surfaced right now.</div>';
    var openSessionButton = currentRun && App.pickPrimaryRunSession(currentRun, detail)
      ? App.buildPrimaryActionButton({
          type: 'open-session',
          sessionId: App.pickPrimaryRunSession(currentRun, detail).id,
          label: 'Open active session'
        }, 'btn')
      : '';

    return '<section class="detail-panel executive-panel"><div class="panel-header"><h3>Product State</h3><span class="artifact-row-meta">executive summary</span></div><div class="panel-body"><div class="executive-grid"><div><div class="chip-row"><span class="chip subtle">stage: ' + App.esc(stageLabel) + '</span><span class="chip ' + stageSignalClass(detail.computed_stage_signal) + '">signal: ' + App.esc(detail.computed_stage_signal || stageLabel) + '</span><span class="chip ' + (displayReadiness.status === 'ready-for-release-candidate' ? 'ok' : displayReadiness.status === 'needs-evidence' ? 'warn' : 'subtle') + '">' + App.esc(displayReadiness.label || 'not assessed') + '</span></div><p class="executive-summary">' + App.esc(copilot.summary || detail.summary || 'Review the product state, evidence and next move.') + '</p><div class="meta-list executive-meta"><div><span class="meta-item-label">Artifacts</span><span class="mono">' + App.esc(String(artifactSummary.present || 0) + '/' + String(artifactSummary.total || 0)) + '</span></div><div><span class="meta-item-label">Current Run</span><span class="mono">' + App.esc(currentRun ? (currentRun.stage_label || currentRun.stage_id || currentRun.status || 'active') : 'none') + '</span></div><div><span class="meta-item-label">Open Blockers</span><span class="mono">' + App.esc(String(blockers.length)) + '</span></div><div><span class="meta-item-label">Ready for Test</span><span class="mono">' + App.esc(((copilot.delivery_readiness || {}).ready_for_test) ? 'yes' : 'no') + '</span></div></div>' + blockerHtml + technicalSummary + '</div><div class="executive-cta-card"><div class="run-kicker">Recommended next move</div><strong>' + App.esc(primaryAction ? primaryAction.label : 'Review product state') + '</strong><p class="artifact-row-meta" style="margin-top:8px">' + App.esc(primaryAction ? primaryAction.description : 'Use the product detail below to choose the next step.') + '</p><div class="product-detail-actions executive-actions">' + (primaryAction ? App.buildPrimaryActionButton(primaryAction, 'btn btn-primary btn-cta') : '') + openSessionButton + '</div></div></div></div></section>';
  }

  App.buildOperateLitePanel = function buildOperateLitePanel(detail) {
    var op = detail.operate_lite;
    if (!op) return '';
    var evidenceSummary = op.evidence_summary || {};
    var evidenceHtml = '<div class="evidence-summary">' +
      '<div class="evidence-summary-stat"><div class="product-stat-label">Total Handoffs</div><div class="product-stat-value">' + (evidenceSummary.total_handoffs || 0) + '</div></div>' +
      '<div class="evidence-summary-stat"><div class="product-stat-label">Evidence Outputs</div><div class="product-stat-value">' + (evidenceSummary.total_evidence_outputs || 0) + '</div></div>' +
      '</div>';
    var body = '<div class="meta-list">' +
      App.metaItem('Runbook Status', op.runbook_status) +
      App.metaItem('Runbook Path', op.runbook_path || 'N/A') +
      App.metaItem('Readiness Evaluation', 'On-demand (computed per request)') +
      App.metaItem('Operational Notes', op.operational_notes || 'None') +
      '</div>' +
      evidenceHtml +
      (op.next_post_release_action ? '<div class="summary-callout" style="margin-top:12px"><span class="meta-item-label">Next Post-Release Action</span><p style="margin-top:6px;font-size:13px">' + App.esc(op.next_post_release_action) + '</p></div>' : '');
    return App.buildCollapsiblePanel('Operate Lite', 'runbook: ' + App.esc(op.runbook_status), body, false);
  }

  App.buildProductDetailHtml = function buildProductDetailHtml(detail) {
    const currentRun = App.resolveCurrentRun(detail);
    const latestHandoff = App.resolveLatestHandoff(detail.handoffs || []);
    const pipelineBody = '<div class="pipeline-list">' + detail.pipeline.map(step => App.buildStepCard(step)).join('') + '</div>';
    const knowledgeBody = App.buildKnowledgePackPanel(detail) + '<div style="margin-top:14px">' + App.buildStageKnowledgePanel(detail) + '</div>';
    const technicalBody = App.buildHandoffHistoryPanel(detail);
    const sessionsBody = '<div class="session-list">' + ((detail.related_sessions || []).map(session => App.buildProductSessionRow(session)).join('') || '<p>No linked sessions yet.</p>') + '</div>';
    return '<div class="product-detail-header"><div class="product-row"><div><h2>' + App.esc(detail.name) + '</h2><div class="product-subtitle">' + App.esc(detail.summary || 'No summary available.') + '</div></div><div class="detail-badges"><span class="chip">' + App.esc(detail.category) + '</span><span class="chip subtle">stage: ' + App.esc(detail.current_stage_id || detail.computed_stage_signal || detail.declared_stage || 'idea') + '</span>' + App.buildKnowledgePackChips(detail.knowledge_packs || [], true) + '</div></div><div class="product-detail-actions">' +
      ((detail.workspace || {}).runtime_workspace_id ? '<button class="btn btn-sm btn-primary" data-product-action="open-workspace">Open Runtime Workspace</button>' : '') +
      '<button class="btn btn-sm" data-product-action="change-workspace">Change Runtime Workspace</button>' +
      '</div></div><div class="product-detail-scroll">' +
      App.buildCopilotPanel(detail) +
      '<div class="detail-grid"><section class="detail-panel"><div class="panel-header"><h3>Artifacts</h3><span class="artifact-row-meta">' + detail.artifact_summary.present + '/' + detail.artifact_summary.total + ' present</span></div><div class="panel-body"><div class="artifact-list">' + detail.artifacts.map(artifact => App.buildArtifactRow(artifact)).join('') + '</div></div></section>' +
      App.buildReadinessPanel(detail) + '</div>' +
      '<div class="detail-grid">' + App.buildCollapsiblePanel('Current Run', App.esc(currentRun ? (currentRun.status || 'active') : 'no active run'), App.buildCurrentRunPanel(detail, currentRun), false) +
      App.buildCollapsiblePanel('Next Actions', ((detail.next_actions || []).length) + ' suggested', '<div class="next-actions-list">' + ((detail.next_actions || []).map(function(action) { return App.buildNextActionRow(action, detail); }).join('') || '<p>No next actions available.</p>') + '</div>', false) + '</div>' +
      '<div class="detail-grid">' + App.buildCollapsiblePanel('Pipeline', detail.pipeline.length + ' stages', pipelineBody, false) +
      '<section class="detail-panel"><div class="panel-header"><h3>Technical History</h3><span class="artifact-row-meta">collapsed by default</span></div><div class="panel-body"><div class="detail-grid"><div>' + App.buildCollapsiblePanel('Stage Completions', ((detail.handoffs || []).length) + ' records', technicalBody, false) + '</div><div>' + App.buildCollapsiblePanel('Related Sessions', ((detail.related_sessions || []).length) + ' linked', sessionsBody, false) + '</div></div></div></section></div>' +
      '<div class="detail-grid">' + App.buildCollapsiblePanel('Knowledge Packs & Guidance', ((detail.knowledge_packs || []).length) + ' active', knowledgeBody, false) +
      App.buildOperateLitePanel(detail) + '</div>' +
      '</div></div>';
  }

  App.buildStepCard = function buildStepCard(step) {
    var technicalRows = '';
    if (step.active_run_id) {
      technicalRows += '<div class="action-row-meta"><span class="meta-item-label">Active run</span><div class="chip-row"><span class="chip subtle">' + App.esc(step.active_run_id) + '</span></div></div>';
    }
    if (step.latest_completion) {
      technicalRows += '<div class="action-row-meta"><span class="meta-item-label">Latest completion</span>' + App.buildHandoffSummaryInline(step.latest_completion) + '</div>';
    }
    if (step.latest_incoming_handoff) {
      technicalRows += '<div class="action-row-meta"><span class="meta-item-label">Incoming context</span>' + App.buildHandoffSummaryInline(step.latest_incoming_handoff) + '</div>';
    }
    return '<article class="step-card"><div class="step-card-top"><div><h4>' + App.esc(step.label) + '</h4><div class="step-card-meta"><span class="status-pill ' + App.esc(step.status) + '">' + App.esc(App.stageStatusLabel(step.status)) + '</span><span class="chip">' + App.esc(step.recommended_role) + '</span><span class="chip">' + App.esc(step.recommended_runtime_agent) + '</span></div></div></div><div class="step-card-goal">' + App.esc(step.goal) + '</div>' +
      (technicalRows ? '<details class="inline-details"><summary>Execution details</summary><div class="inline-details-body">' + technicalRows + '</div></details>' : '') +
      '<div class="step-card-actions"><button class="btn btn-sm btn-primary" data-stage-action="start" data-stage-id="' + step.stage_id + '">Continue</button>' + (step.active_session_id ? '<button class="btn btn-sm" data-stage-action="open-session" data-session-id="' + step.active_session_id + '">Open Session</button>' : '') + (step.stage_id !== 'idea' ? '<button class="btn btn-sm" data-stage-action="complete" data-stage-id="' + step.stage_id + '">Finish Stage</button>' : '') + '</div></article>';
  }

  App.buildNextActionRow = function buildNextActionRow(action, detail) {
    const stageId = action.step_id || action.stage_id || '';
    const role = action.recommended_role || action.role || '';
    const runtime = action.recommended_runtime_agent || action.runtime_agent || '';
    const runId = action.run_id || action.runId || '';
    const knowledge = App.resolveActionKnowledge(action, detail, stageId);
    const outputs = App.normalizeOutputList(action.expected_outputs || action.outputs_expected || []);
    const trace = [stageId ? ('stage: ' + stageId) : '', role ? ('role: ' + role) : '', runtime ? ('runtime: ' + runtime) : '', runId ? ('run: ' + runId) : ''].filter(Boolean).join(' | ');
    const executable = action.executable !== false && !!stageId;
    const technicalDetails = (trace || knowledge || (action.uses_previous_handoff && action.previous_handoff_summary) || outputs.length)
      ? '<details class="inline-details"><summary>Why this step is recommended</summary><div class="inline-details-body">' +
        (trace ? '<div class="action-row-trace">' + App.esc(trace) + '</div>' : '') +
        (knowledge ? '<div class="action-row-meta"><span class="meta-item-label">Knowledge preset</span>' + App.buildKnowledgeDriverInline(knowledge) + '</div>' : '') +
        (action.uses_previous_handoff && action.previous_handoff_summary
          ? '<div class="action-row-meta"><span class="meta-item-label">Previous stage completion</span><div class="artifact-row-meta">' + App.esc(action.previous_handoff_summary) + '</div><div class="chip-row" style="margin-top:6px"><span class="chip knowledge">uses previous stage completion</span>' + (action.previous_handoff_id ? '<span class="chip subtle">' + App.esc(action.previous_handoff_id) + '</span>' : '') + '</div></div>'
          : '') +
        (outputs.length ? '<div class="action-row-meta"><span class="meta-item-label">Expected outputs</span><div class="chip-row">' + outputs.map(item => '<span class="chip">' + App.esc(item) + '</span>').join('') + '</div></div>' : '') +
      '</div></details>'
      : '';
    return '<div class="action-row">' +
      '<div class="action-row-copy"><strong>' + App.esc(action.label) + '</strong><span>' + App.esc(action.reason || 'No rationale available.') + '</span>' +
      technicalDetails +
      '</div>' +
      '<div class="action-row-actions">' +
      (executable ? '<button class="btn btn-sm btn-primary btn-cta" data-product-action="execute-next-action" data-action-id="' + App.esc(action.id || '') + '" data-stage-id="' + App.esc(stageId) + '">Execute next step</button>' : '') +
      (stageId ? '<button class="btn btn-sm" data-product-action="start-stage" data-stage-id="' + App.esc(stageId) + '">Customize</button>' : '') +
      '</div></div>';
  }

  App.buildProductSessionRow = function buildProductSessionRow(session) {
    const meta = App.AGENT_META[session.agent] || { icon: '?' };
    const runId = session.runId || session.run_id || '';
    const sessionMeta = ['stage: ' + (session.stageId || 'manual'), 'role: ' + (session.role || 'none')].concat([runId ? ('run:' + runId) : '', session.model || '', session.effort ? ('effort:' + session.effort) : ''].filter(Boolean)).join(' | ');
    return '<div class="session-row-inline"><div class="product-row"><h4>' + App.esc(session.name) + '</h4><div class="chip-row"><span class="agent-badge ' + session.agent + '">' + meta.icon + '</span><span class="status-pill ' + session.status + '">' + App.esc(App.stageStatusLabel(session.status)) + '</span></div></div><div class="session-inline-meta">' + App.esc((session.agent || 'agent') + ' | ' + (session.status || 'unknown')) + '</div><details class="inline-details"><summary>Technical context</summary><div class="inline-details-body"><div class="artifact-row-meta">' + App.esc(sessionMeta) + '</div><div class="session-inline-path">' + App.esc(session.workingDir || 'No working directory') + '</div></div></details><div class="step-card-actions"><button class="btn btn-sm" data-stage-action="open-session" data-session-id="' + session.id + '">Open Session</button>' + (session.status === 'running' ? '<button class="btn btn-sm" data-session-action="stop" data-session-id="' + session.id + '">Stop</button><button class="btn btn-sm" data-session-action="restart" data-session-id="' + session.id + '">Restart</button>' : '<button class="btn btn-sm btn-primary" data-session-action="start" data-session-id="' + session.id + '">Start</button><button class="btn btn-sm" data-session-action="restart" data-session-id="' + session.id + '">Restart</button>') + '<button class="btn btn-sm" data-session-action="delete" data-session-id="' + session.id + '">Delete</button></div></div>';
  }

  App.buildKnowledgePackChips = function buildKnowledgePackChips(packs, compact) {
    if (!packs || !packs.length) {
      return compact ? '<span class="chip">no knowledge packs</span>' : '';
    }
    const items = compact ? packs.slice(0, 2) : packs;
    const chips = items.map(pack => '<span class="chip knowledge">' + App.esc(pack.name) + ' active</span>').join('');
    if (compact && packs.length > items.length) {
      return chips + '<span class="chip knowledge">+' + App.esc(String(packs.length - items.length)) + ' more</span>';
    }
    return chips;
  }

  App.buildKnowledgePackPanel = function buildKnowledgePackPanel(detail) {
    const packs = detail.knowledge_packs || [];
    const current = detail.current_stage_knowledge || [];
    const currentStage = detail.current_stage_id || detail.computed_stage_signal || 'idea';
    if (!packs.length) {
      return '<p>No active knowledge packs for this product yet.</p>';
    }

    const currentHtml = current.length
      ? '<div class="knowledge-now"><div class="knowledge-now-title">Recommended now: ' + App.esc(currentStage) + '</div><div class="knowledge-suggestion-group">' + current.map(rec => App.buildKnowledgeRecommendationSummary(rec, { emphasizeDefault: true })).join('') + '</div></div>'
      : '<div class="knowledge-now"><div class="knowledge-now-title">Recommended now: ' + App.esc(currentStage) + '</div><p>No stage recommendation available for the current stage.</p></div>';

    return currentHtml + '<div class="knowledge-pack-list">' + packs.map(pack => {
      const domains = (pack.domains || []).map(item => '<span class="chip">' + App.esc(item) + '</span>').join('');
      const runtimes = (pack.supported_runtimes || []).map(item => '<span class="chip">' + App.esc(item) + '</span>').join('');
      const entrypoints = (pack.entrypoints || []).map(item => '<span class="chip knowledge">' + App.esc(item) + '</span>').join('');
      return '<div class="knowledge-pack-row"><div class="product-row"><h4>' + App.esc(pack.name) + '</h4><div class="chip-row"><span class="chip knowledge">' + App.esc(pack.type || 'knowledge-pack') + '</span><span class="chip ok">' + App.esc(pack.integration_mode || 'reference-first') + '</span><span class="chip subtle">drives execution</span></div></div>' +
        '<div class="artifact-row-meta" style="margin-top:6px">' + App.esc(pack.description || 'No pack description available.') + '</div>' +
        '<div class="knowledge-pack-meta"><div><span class="meta-item-label">Domains</span><div class="chip-row">' + (domains || '<span class="chip">none</span>') + '</div></div><div><span class="meta-item-label">Runtimes</span><div class="chip-row">' + (runtimes || '<span class="chip">none</span>') + '</div></div></div>' +
        '<div class="knowledge-pack-meta" style="margin-top:10px"><div><span class="meta-item-label">Repo</span><div class="artifact-row-meta mono"><a href="' + pack.repo_url + '" target="_blank" rel="noreferrer">' + App.esc(pack.repo_url || '') + '</a></div></div><div><span class="meta-item-label">Entrypoints</span><div class="chip-row">' + (entrypoints || '<span class="chip">none</span>') + '</div></div></div>' +
        (pack.binding && pack.binding.notes ? '<div class="artifact-row-meta" style="margin-top:10px">' + App.esc(pack.binding.notes) + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  App.buildStageKnowledgePanel = function buildStageKnowledgePanel(detail) {
    const stages = detail.knowledge_stage_recommendations || [];
    if (!stages.length) return '<p>No stage knowledge recommendations available.</p>';
    return '<div class="stage-knowledge-list">' + stages.map(stage => {
      const recommendations = stage.recommendations || [];
      const defaultPreset = App.resolveStageDefaultPreset(detail, stage.stage_id);
      return '<div class="stage-knowledge-row ' + (stage.is_current ? 'current' : '') + '"><div class="product-row"><h4>' + App.esc(stage.label) + '</h4><div class="chip-row"><span class="status-pill ' + App.esc(stage.status) + '">' + App.esc(App.stageStatusLabel(stage.status)) + '</span>' + (stage.is_current ? '<span class="chip knowledge">current</span>' : '') + '</div></div>' +
        (defaultPreset ? '<div class="knowledge-default-row"><span class="meta-item-label">Execution default</span>' + App.buildKnowledgeDriverInline(defaultPreset) + '</div>' : '') +
        (recommendations.length
          ? '<div class="knowledge-suggestion-group">' + recommendations.map(rec => App.buildKnowledgeRecommendationSummary(rec, { emphasizeDefault: true })).join('') + '</div>'
          : '<div class="artifact-row-meta" style="margin-top:8px">No knowledge recommendation for this stage.</div>') +
        '</div>';
    }).join('') + '</div>';
  }

  App.buildKnowledgeRecommendationSummary = function buildKnowledgeRecommendationSummary(rec, options) {
    const settings = options || {};
    const skills = (rec.recommended_skills || []).map(item => '<span class="chip">' + App.esc(item) + '</span>').join('');
    const workflows = (rec.recommended_workflows || []).map(item => '<span class="chip knowledge">' + App.esc(item) + '</span>').join('');
    const roles = (rec.recommended_roles || []).map(item => '<span class="chip">' + App.esc(item) + '</span>').join('');
    const agents = (rec.recommended_runtime_agents || []).map(item => '<span class="chip">' + App.esc(item) + '</span>').join('');
    const presets = App.getRecommendationPresets(rec);
    const defaultPreset = App.resolvePresetFromRecommendation(rec);
    return '<div class="knowledge-suggestion-card"><div class="product-row"><strong>' + App.esc(rec.knowledge_pack_name || rec.knowledge_pack_id) + '</strong><span class="chip knowledge">' + App.esc(rec.knowledge_pack_id || '') + '</span></div>' +
      (state.settings.emphasizeDefault && defaultPreset ? '<div class="knowledge-default-row"><span class="meta-item-label">Default execution preset</span>' + App.buildKnowledgeDriverInline(defaultPreset) + '</div>' : '') +
      '<div class="knowledge-pack-meta"><div><span class="meta-item-label">Skills</span><div class="chip-row">' + (skills || '<span class="chip">none</span>') + '</div></div><div><span class="meta-item-label">Workflows</span><div class="chip-row">' + (workflows || '<span class="chip">none</span>') + '</div></div></div>' +
      '<div class="knowledge-pack-meta" style="margin-top:10px"><div><span class="meta-item-label">Roles</span><div class="chip-row">' + (roles || '<span class="chip">none</span>') + '</div></div><div><span class="meta-item-label">Runtime Agents</span><div class="chip-row">' + (agents || '<span class="chip">none</span>') + '</div></div></div>' +
      (presets.length ? '<div class="knowledge-pack-meta" style="margin-top:10px"><div style="grid-column:1 / -1"><span class="meta-item-label">Execution presets</span><div class="chip-row">' + presets.map(item => '<span class="chip ' + (item.is_default ? 'knowledge' : 'subtle') + '">' + App.esc(item.preset_label) + '</span>').join('') + '</div></div></div>' : '') +
      '</div>';
  }

  App.bindProductDetailActions = function bindProductDetailActions(detail) {
    const root = document.getElementById('product-detail');
    root.querySelectorAll('[data-product-action="open-workspace"]').forEach(el => el.addEventListener('click', () => {
      App.setActiveWorkspace(detail.workspace.runtime_workspace_id);
      App.renderWorkspaceList();
      App.switchView('terminals');
    }));
    root.querySelectorAll('[data-product-action="change-workspace"]').forEach(el => el.addEventListener('click', () => App.changeProductWorkspace(detail)));
    root.querySelectorAll('[data-product-action="execute-next-action"]').forEach(el => el.addEventListener('click', () => App.executeNextAction(detail.product_id, {
      id: el.dataset.actionId,
      step_id: el.dataset.stageId
    })));
    root.querySelectorAll('[data-product-action="start-stage"], [data-stage-action="start"]').forEach(el => el.addEventListener('click', () => App.startGuidedStage(detail.product_id, el.dataset.stageId)));
    root.querySelectorAll('[data-stage-action="complete"]').forEach(el => el.addEventListener('click', () => App.registerHandoff(detail.product_id, el.dataset.stageId)));
    root.querySelectorAll('[data-stage-action="open-session"]').forEach(el => el.addEventListener('click', () => App.openSessionInTerminals(el.dataset.sessionId, detail.product_id)));
    root.querySelectorAll('[data-run-action="open-session"]').forEach(el => el.addEventListener('click', () => App.openSessionInTerminals(el.dataset.sessionId, detail.product_id)));
    root.querySelectorAll('[data-run-action="complete-stage"]').forEach(el => el.addEventListener('click', () => App.registerHandoff(detail.product_id, el.dataset.stageId)));
    root.querySelectorAll('[data-run-action="discard-run"]').forEach(el => el.addEventListener('click', () => App.discardRun(detail.product_id, el.dataset.runId)));
    root.querySelectorAll('[data-run-action="start-session"]').forEach(el => el.addEventListener('click', () => App.startSession(el.dataset.sessionId)));
    root.querySelectorAll('[data-run-action="restart-session"]').forEach(el => el.addEventListener('click', () => App.restartSession(el.dataset.sessionId)));
    root.querySelectorAll('[data-session-action="start"]').forEach(el => el.addEventListener('click', () => App.startSession(el.dataset.sessionId)));
    root.querySelectorAll('[data-session-action="restart"]').forEach(el => el.addEventListener('click', () => App.restartSession(el.dataset.sessionId)));
    root.querySelectorAll('[data-session-action="stop"]').forEach(el => el.addEventListener('click', () => App.stopSession(el.dataset.sessionId)));
    root.querySelectorAll('[data-session-action="delete"]').forEach(el => el.addEventListener('click', () => App.deleteSession(el.dataset.sessionId)));
    root.querySelectorAll('[data-copilot-action="refresh"]').forEach(el => el.addEventListener('click', () => App.refreshCopilot(detail.product_id)));
    root.querySelectorAll('[data-copilot-action="accept-candidate"]').forEach(el => el.addEventListener('click', () => App.reviewCopilotCandidate(detail.product_id, el.dataset.candidateId, true)));
    root.querySelectorAll('[data-copilot-action="reject-candidate"]').forEach(el => el.addEventListener('click', () => App.reviewCopilotCandidate(detail.product_id, el.dataset.candidateId, false)));
    root.querySelectorAll('[data-copilot-action="review-candidate"]').forEach(el => el.addEventListener('click', () => App.openCandidateReviewDialog(detail.product_id, el.dataset.candidateId)));
    root.querySelectorAll('[data-copilot-action="add-decision"]').forEach(el => el.addEventListener('click', () => App.openCopilotDecisionDialog(detail)));
    root.querySelectorAll('[data-copilot-action="resolve-decision"]').forEach(el => el.addEventListener('click', () => App.updateCopilotDecisionStatus(detail.product_id, el.dataset.decisionId, 'resolved')));
    root.querySelectorAll('[data-copilot-action="reopen-decision"]').forEach(el => el.addEventListener('click', () => App.updateCopilotDecisionStatus(detail.product_id, el.dataset.decisionId, 'open')));
  }

  App.refreshCopilot = async function refreshCopilot(productId) {
    await App.loadProducts(true);
    await App.loadProductDetail(productId, true);
    App.renderCurrentView();
  }

  App.reviewCopilotCandidate = async function reviewCopilotCandidate(productId, candidateId, accepted) {
    const detail = await App.api('/products/' + encodeURIComponent(productId) + '/copilot/candidates/' + encodeURIComponent(candidateId) + '/review', {
      method: 'POST',
      body: JSON.stringify({ accepted: accepted })
    });
    state.productDetails[productId] = detail;
    await App.loadProducts(true);
    App.renderCurrentView();
  }

  App.openCandidateReviewDialog = function openCandidateReviewDialog(productId, candidateId) {
    App.showDialog('Review Artifact Candidate', '<p style="font-size:13px">Choose whether this candidate should be treated as accepted evidence for project memory.</p>', [
      { label: 'Cancel', onClick: function() {} },
      { label: 'Reject', onClick: function() { App.reviewCopilotCandidate(productId, candidateId, false); } },
      { label: 'Accept', primary: true, onClick: function() { App.reviewCopilotCandidate(productId, candidateId, true); } }
    ]);
  }

  App.openCopilotDecisionDialog = function openCopilotDecisionDialog(detail) {
    var currentStage = detail.current_stage_id || detail.computed_stage_signal || '';
    var artifactOptions = (detail.artifacts || []).map(function(item) {
      return '<option value="' + App.esc(item.id) + '">' + App.esc(item.label) + '</option>';
    }).join('');
    App.showDialog('Add Project Decision', '<label>Decision Title</label><input type="text" id="dlg-copilot-decision-title" placeholder="Example: use discovery brief as the working brief"><label>Linked Stage</label><input type="text" id="dlg-copilot-decision-stage" value="' + App.esc(currentStage) + '"><label>Linked Artifact (optional)</label><select id="dlg-copilot-decision-artifact"><option value="">None</option>' + artifactOptions + '</select><label>Note</label><textarea id="dlg-copilot-decision-note" placeholder="Why this decision matters and what it unblocks."></textarea>', [
      { label: 'Cancel', onClick: function() {} },
      { label: 'Save Decision', primary: true, onClick: async function() {
        var title = document.getElementById('dlg-copilot-decision-title').value.trim();
        if (!title) return;
        var linkedArtifact = document.getElementById('dlg-copilot-decision-artifact').value;
        var nextDetail = await App.api('/products/' + encodeURIComponent(detail.product_id) + '/copilot/decisions', {
          method: 'POST',
          body: JSON.stringify({
            title: title,
            linked_stage: document.getElementById('dlg-copilot-decision-stage').value.trim(),
            linked_artifacts: linkedArtifact ? [linkedArtifact] : [],
            note: document.getElementById('dlg-copilot-decision-note').value.trim()
          })
        });
        state.productDetails[detail.product_id] = nextDetail;
        await App.loadProducts(true);
        App.renderCurrentView();
      } }
    ]);
  }

  App.updateCopilotDecisionStatus = async function updateCopilotDecisionStatus(productId, decisionId, status) {
    var detail = await App.api('/products/' + encodeURIComponent(productId) + '/copilot/decisions/' + encodeURIComponent(decisionId), {
      method: 'PUT',
      body: JSON.stringify({ status: status })
    });
    state.productDetails[productId] = detail;
    await App.loadProducts(true);
    App.renderCurrentView();
  }

  App.openSessionInTerminals = function openSessionInTerminals(sessionId, productId) {
    const product = state.products.find(p => p.product_id === productId);
    if (product && product.workspace && product.workspace.runtime_workspace_id) App.setActiveWorkspace(product.workspace.runtime_workspace_id);
    const session = state.allSessions.find(s => s.id === sessionId);
    if (session && session.workspaceId) App.setActiveWorkspace(session.workspaceId);
    App.renderWorkspaceList();
    App.switchView('terminals');
  }

  App.buildAgentOptions = function buildAgentOptions(defaultAgent, allowedAgents) {
    return (allowedAgents || Object.keys(App.AGENT_META)).map(agent => '<option value="' + agent + '"' + (agent === defaultAgent ? ' selected' : '') + '>' + App.esc((App.AGENT_META[agent] || { name: agent }).name) + '</option>').join('');
  }

  App.getAgentCatalog = function getAgentCatalog(agent) {
    const entry = state.modelsByAgent[agent];
    if (Array.isArray(entry)) {
      return { models: entry, supportsEffort: false, effortLevels: [] };
    }
    return entry || { models: [], supportsEffort: false, effortLevels: [] };
  }

  App.buildModelOptionsFor = function buildModelOptionsFor(agent) {
    const models = App.getAgentCatalog(agent).models || [];
    if (!models.length) return '<option value="">Default</option>';
    return models.map((model, index) => '<option value="' + App.esc(model.id) + '"' + (index === 0 ? ' selected' : '') + '>' + App.esc(model.name) + '</option>').join('');
  }

  App.buildEffortOptionsFor = function buildEffortOptionsFor(agent) {
    const catalog = App.getAgentCatalog(agent);
    if (!catalog.supportsEffort || !(catalog.effortLevels || []).length) {
      return '<option value="">Default</option>';
    }
    return [''].concat(catalog.effortLevels).map((effort, index) => {
      const label = effort ? effort : 'Default';
      return '<option value="' + App.esc(effort) + '"' + (index === 0 ? ' selected' : '') + '>' + App.esc(label) + '</option>';
    }).join('');
  }

  App.updateEffortField = function updateEffortField(agent, selectId, wrapperId) {
    const select = document.getElementById(selectId);
    const wrapper = document.getElementById(wrapperId);
    if (!select || !wrapper) return;
    const catalog = App.getAgentCatalog(agent);
    select.innerHTML = App.buildEffortOptionsFor(agent);
    wrapper.style.display = catalog.supportsEffort ? 'block' : 'none';
  }

  App.startGuidedStage = async function startGuidedStage(productId, stageId) {
    const detail = await App.loadProductDetail(productId);
    const stage = (detail.pipeline || []).find(item => item.stage_id === stageId);
    if (!stage) return;
    const latestIncomingHandoff = App.findLatestIncomingHandoff(detail, stageId);
    const defaultAgent = stage.recommended_runtime_agent;
    const defaultName = detail.name + ' - ' + stage.label;
    const workingDir = ((detail.repo || {}).local_path || '');
    const stageRecommendations = App.resolveStageKnowledgeEntries(detail, stageId);
    const stagePresets = stageRecommendations.flatMap(rec => App.getRecommendationPresets(rec)).filter(item => item && item.preset_id);
    const uniqueStagePresets = stagePresets.filter((item, index, list) => list.findIndex(other => other.knowledge_pack_id === item.knowledge_pack_id && other.preset_type === item.preset_type && other.preset_id === item.preset_id) === index);
    const defaultPreset = uniqueStagePresets.find(item => item.is_default) || uniqueStagePresets[0] || null;
    const knowledgeBlock = defaultPreset
      ? '<div class="dialog-knowledge-block"><div class="meta-item-label">Knowledge preset</div>' + App.buildKnowledgeDriverInline(defaultPreset) + '<div class="artifact-row-meta" style="margin-top:8px">Default execution guidance for this stage.</div></div>'
      : '<div class="dialog-knowledge-block"><div class="meta-item-label">Knowledge preset</div><div class="artifact-row-meta">No active preset for this stage.</div></div>';
    const handoffBlock = latestIncomingHandoff
      ? '<div class="dialog-knowledge-block"><div class="meta-item-label">Previous stage completion</div><div class="handoff-summary">' + App.esc(latestIncomingHandoff.summary || '') + '</div><div class="artifact-row-meta" style="margin-top:8px">' + App.esc((latestIncomingHandoff.from_stage || 'unknown') + ' -> ' + (latestIncomingHandoff.to_stage || stageId)) + '</div><div class="action-row-meta"><span class="meta-item-label">Referenced outputs</span>' + App.buildOutputReferenceChips((latestIncomingHandoff.output_refs || []).map(item => ({ label: item })), 'No outputs referenced.') + '</div></div>'
      : '';
    const presetOptions = uniqueStagePresets.map((item, index) => '<option value="' + App.esc(JSON.stringify({
      knowledge_pack_id: item.knowledge_pack_id || '',
      knowledge_pack_name: item.knowledge_pack_name || '',
      preset_type: item.preset_type || '',
      preset_id: item.preset_id || '',
      preset_label: item.preset_label || ''
    })) + '"' + ((defaultPreset && item.preset_id === defaultPreset.preset_id && item.preset_type === defaultPreset.preset_type && item.knowledge_pack_id === defaultPreset.knowledge_pack_id) || (!defaultPreset && index === 0) ? ' selected' : '') + '>' + App.esc((item.knowledge_pack_name || item.knowledge_pack_id || 'Knowledge Pack') + ' - ' + item.preset_label) + '</option>').join('');
    App.showDialog('Start ' + stage.label, '<label>Stage</label><input type="text" value="' + App.esc(stage.label) + '" disabled><label>Recommended Role</label><input type="text" value="' + App.esc(stage.recommended_role) + '" disabled>' + knowledgeBlock + handoffBlock + (uniqueStagePresets.length > 1 ? '<label>Execution Preset</label><select id="dlg-stage-preset">' + presetOptions + '</select>' : '') + '<label>Session Name</label><input type="text" id="dlg-stage-name" value="' + App.esc(defaultName) + '"><label>Runtime Agent</label><select id="dlg-stage-agent">' + App.buildAgentOptions(defaultAgent, stage.allowed_runtime_agents) + '</select><label>Model</label><select id="dlg-stage-model">' + App.buildModelOptionsFor(defaultAgent) + '</select><div id="dlg-stage-effort-wrap"><label>Effort</label><select id="dlg-stage-effort">' + App.buildEffortOptionsFor(defaultAgent) + '</select></div><label>Working Directory</label><input type="text" id="dlg-stage-dir" value="' + App.esc(workingDir) + '"><label>Goal</label><textarea disabled>' + App.esc(stage.goal) + '</textarea>', [
      { label: 'Cancel', onClick: function() {} },
      { label: 'Create Session', primary: true, onClick: async function() {
        const presetSelect = document.getElementById('dlg-stage-preset');
        let selectedPreset = defaultPreset;
        if (presetSelect && presetSelect.value) {
          try {
            selectedPreset = JSON.parse(presetSelect.value);
          } catch (_error) {
            selectedPreset = defaultPreset;
          }
        }
        await App.api('/products/' + encodeURIComponent(productId) + '/stages/' + encodeURIComponent(stageId) + '/start', {
          method: 'POST',
          body: JSON.stringify({
            name: document.getElementById('dlg-stage-name').value.trim() || defaultName,
            runtimeAgent: document.getElementById('dlg-stage-agent').value,
            model: document.getElementById('dlg-stage-model').value,
            effort: document.getElementById('dlg-stage-effort').value,
            workingDir: document.getElementById('dlg-stage-dir').value,
            knowledge_pack_id: selectedPreset ? selectedPreset.knowledge_pack_id : '',
            knowledge_pack_name: selectedPreset ? selectedPreset.knowledge_pack_name : '',
            preset_type: selectedPreset ? selectedPreset.preset_type : '',
            preset_id: selectedPreset ? selectedPreset.preset_id : '',
            preset_label: selectedPreset ? selectedPreset.preset_label : '',
            previous_handoff_id: latestIncomingHandoff ? latestIncomingHandoff.handoff_id : '',
            previous_handoff_summary: latestIncomingHandoff ? latestIncomingHandoff.summary : ''
          })
        });
        await App.loadAllSessions();
        await App.loadProducts(true);
        App.renderWorkspaceList();
        App.renderCurrentView();
      }}
    ]);
    setTimeout(() => {
      const agentSelect = document.getElementById('dlg-stage-agent');
      const modelSelect = document.getElementById('dlg-stage-model');
      if (!agentSelect || !modelSelect) return;
      App.updateEffortField(defaultAgent, 'dlg-stage-effort', 'dlg-stage-effort-wrap');
      agentSelect.addEventListener('change', () => {
        modelSelect.innerHTML = App.buildModelOptionsFor(agentSelect.value);
        App.updateEffortField(agentSelect.value, 'dlg-stage-effort', 'dlg-stage-effort-wrap');
      });
    }, 50);
  }

  App.executeNextAction = async function executeNextAction(productId, actionRef) {
    const detail = await App.loadProductDetail(productId, true);
    const action = ((detail.next_actions || []).find(item => String(item.id || '') === String(actionRef.id || ''))
      || (detail.next_actions || []).find(item => String(item.step_id || item.stage_id || '') === String(actionRef.step_id || ''))
      || actionRef);
    const stageId = action.step_id || action.stage_id || actionRef.step_id;
    const knowledge = App.resolveActionKnowledge(action, detail, stageId);
    const latestIncomingHandoff = App.findLatestIncomingHandoff(detail, stageId);
    if (!stageId) return;

    const payload = {
      action_id: action.id || '',
      stage_id: stageId,
      role: action.recommended_role || action.role || '',
      runtimeAgent: action.recommended_runtime_agent || action.runtime_agent || '',
      expectedOutputs: App.normalizeOutputList(action.expected_outputs || action.outputs_expected || []),
      objective: action.objective || action.label || '',
      previous_handoff_id: action.previous_handoff_id || (latestIncomingHandoff ? latestIncomingHandoff.handoff_id : ''),
      previous_handoff_summary: action.previous_handoff_summary || (latestIncomingHandoff ? latestIncomingHandoff.summary : ''),
      knowledge_pack_id: knowledge ? knowledge.knowledge_pack_id : '',
      knowledge_pack_name: knowledge ? knowledge.knowledge_pack_name : '',
      preset_type: knowledge ? knowledge.preset_type : '',
      preset_id: knowledge ? knowledge.preset_id : '',
      preset_label: knowledge ? knowledge.preset_label : ''
    };

    try {
      const result = await App.api('/products/' + encodeURIComponent(productId) + '/next-actions/execute', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      await App.loadAllSessions();
      await App.loadProducts(true);
      await App.loadProductDetail(productId, true);
      App.renderWorkspaceList();
      if (result && result.session && result.session.id) {
        App.openSessionInTerminals(result.session.id, productId);
      } else {
        App.renderCurrentView();
      }
      return;
    } catch (e) {
      console.warn('Next action execution failed, falling back to guided stage:', e);
    }

    await App.startGuidedStage(productId, stageId);
  }

  App.discardRun = async function discardRun(productId, runId) {
    if (!confirm('Are you sure you want to discard this run\'s changes? This will hard reset the working directory to the pre-run checkpoint and cannot be undone.')) return;
    try {
      const res = await App.api('/products/' + encodeURIComponent(productId) + '/runs/' + encodeURIComponent(runId) + '/rollback', {
        method: 'POST'
      });
      alert(res.message || 'Rollback successful');
      await App.loadProducts(true);
      await App.loadProductDetail(productId, true);
      App.renderCurrentView();
    } catch (e) {
      alert('Rollback failed: ' + e.message);
    }
  }

  App.registerHandoff = async function registerHandoff(productId, fromStage) {
    const detail = await App.loadProductDetail(productId, true);
    const currentRun = App.resolveCurrentRun(detail);
    const linkedRunId = currentRun && (currentRun.stage_id === fromStage) ? (currentRun.run_id || currentRun.id || '') : '';
    const linkedRun = linkedRunId ? currentRun : null;
    const nextStage = App.STAGE_ORDER[Math.min(App.STAGE_ORDER.indexOf(fromStage) + 1, App.STAGE_ORDER.length - 1)];
    const primarySession = App.pickPrimaryRunSession(linkedRun, detail);
    const defaultSessionId = primarySession ? (primarySession.id || '') : '';
    const currentKnowledge = linkedRun ? App.resolveRunKnowledge(linkedRun, detail) : null;
    const suggestedOutputs = App.pickCarryForwardOutputs(linkedRun);
    const existingArtifacts = (detail.artifacts || []).filter(function(item) { return item && item.exists; });
    const evidenceCount = ((linkedRun && Array.isArray(linkedRun.produced_outputs)) ? linkedRun.produced_outputs.filter(function(item) { var cat = item.category || ''; return cat === 'evidence'; }).length : 0) + existingArtifacts.length;
    const lowEvidenceHtml = evidenceCount === 0 ? '<div class="low-evidence-warning">No concrete evidence outputs (artifacts, handoffs) will be registered in this handoff. Consider producing artifacts before completing this stage.</div>' : '';
    const selectedOutputRefs = suggestedOutputs.map(item => item.output_id || item.ref_id).filter(Boolean);
    const outputChecks = App.buildOutputChecklist(linkedRun ? (linkedRun.produced_outputs || []) : [], 'handoff-output', selectedOutputRefs, 'data-handoff-output-ref');
    const artifactChecks = App.buildOutputChecklist(existingArtifacts.map(item => ({
      output_id: item.id,
      type: 'artifact',
      ref_id: item.id,
      label: item.label
    })), 'handoff-artifact', [], 'data-handoff-artifact-ref');
    const expectedSnapshot = App.buildOutputReferenceChips(linkedRun ? (linkedRun.expected_outputs || []) : [], 'No expected outputs declared for this run.');
    const summaryDraft = App.buildCompletionDraft(detail, linkedRun, fromStage, nextStage, primarySession);

    // Milestone 3A: transition gate status callout
    var gateStatus3A = detail.transition_gate_status || 'no-contract';
    var evRpt3A = detail.evidence_report;
    var gateHtml3A = '';
    const gateLabel = gateStatus3A === 'passing' ? 'Ready to finish' : gateStatus3A === 'blocked' ? 'Needs more evidence' : 'Manual review';
    const carryForwardCount = selectedOutputRefs.length + existingArtifacts.length;
    if (gateStatus3A === 'blocked' && evRpt3A && evRpt3A.stage_in_scope) {
      var missingList3A = (evRpt3A.missing_required || []).map(function(a) { return '<span class="chip warn">' + App.esc(a) + '</span>'; }).join('');
      gateHtml3A = '<div class="gate-warning-callout"><strong>&#9940; Execution gate: blocked</strong><p>Required artifacts not yet verified on disk:</p><div class="chip-row" style="margin-top:8px">' + (missingList3A || '<span class="chip warn">unknown</span>') + '</div><p style="margin-top:8px;font-size:12px;color:var(--text-muted)">You can still complete this stage, but the gate will be recorded as blocked.</p></div>';
    } else if (gateStatus3A === 'passing') {
      gateHtml3A = '<div class="gate-passing-callout"><strong>&#10003; Execution gate: passing</strong></div>';
    }

    const runContext = linkedRun
      ? '<section class="dialog-section"><div class="dialog-section-title">Execution Context</div><div class="dialog-knowledge-block"><div class="meta-list">' +
        App.metaItem('Stage', fromStage) +
        App.metaItem('Run', linkedRun.run_id || '') +
        App.metaItem('Primary Session', defaultSessionId || 'none') +
        App.metaItem('Runtime', (linkedRun.suggested_runtime_agent || 'unknown-agent')) +
        '</div><div class="artifact-row-meta" style="margin-top:10px">' + App.esc(linkedRun.objective || 'No run objective registered.') + '</div>' +
        (currentKnowledge ? '<div style="margin-top:10px">' + App.buildKnowledgeDriverInline(currentKnowledge) + '</div>' : '') +
        '</div></section>'
      : '<section class="dialog-section"><div class="dialog-section-title">Execution Context</div><div class="dialog-knowledge-block"><div class="artifact-row-meta">No active run is linked to this stage right now. This completion will still be saved manually.</div></div></section>';
    App.showDialog('Finish Stage', '<section class="dialog-section"><div class="dialog-section-title">Quick Finish</div><div class="summary-callout"><div class="product-row"><strong>' + App.esc(fromStage) + ' -> ' + App.esc(nextStage) + '</strong><span class="chip ' + (gateStatus3A === 'passing' ? 'ok' : gateStatus3A === 'blocked' ? 'warn' : 'subtle') + '">' + App.esc(gateLabel) + '</span></div><div class="chip-row" style="margin-top:10px"><span class="chip subtle">carry forward: ' + App.esc(String(carryForwardCount)) + '</span><span class="chip subtle">artifacts on disk: ' + App.esc(String(existingArtifacts.length)) + '</span><span class="chip subtle">evidence seen: ' + App.esc(String(evidenceCount)) + '</span></div><p style="margin-top:8px;font-size:13px;color:var(--text-secondary)">The platform already filled the next stage, session and runtime context for you. Review the handoff summary, then finish the stage.</p></div></section>' + runContext + lowEvidenceHtml + gateHtml3A +
      '<section class="dialog-section"><div class="dialog-section-title">What the next stage should continue with</div>' +
      '<label>Completion summary</label><textarea id="dlg-handoff-summary" placeholder="Review and adjust the suggested completion summary.">' + App.esc(summaryDraft) + '</textarea>' +
      '<div class="dialog-inline-summary"><div><span class="meta-item-label">Current stage</span><span class="mono">' + App.esc(fromStage) + '</span></div><div><span class="meta-item-label">Next stage</span><span class="mono">' + App.esc(nextStage) + '</span></div><div><span class="meta-item-label">Linked session</span><span class="mono">' + App.esc(defaultSessionId || 'auto') + '</span></div></div>' +
      '</section>' +
      '<details class="dialog-accordion"><summary>Advanced options</summary><div class="dialog-accordion-body">' +
      '<label>Next stage</label><select id="dlg-handoff-to">' + App.STAGE_ORDER.filter(stage => stage !== 'idea').map(stage => '<option value="' + stage + '"' + (stage === nextStage ? ' selected' : '') + '>' + App.esc(stage) + '</option>').join('') + '</select>' +
      '<label>Role</label><input type="text" id="dlg-handoff-role" value="' + App.esc((linkedRun && linkedRun.role) || 'delivery-handoff') + '">' +
      '<label>Runtime Agent</label><select id="dlg-handoff-agent">' + App.buildAgentOptions((linkedRun && linkedRun.suggested_runtime_agent) || 'claude', Object.keys(App.AGENT_META)) + '</select>' +
      '<label>Linked Session ID (optional)</label><input type="text" id="dlg-handoff-session" placeholder="sess-..." value="' + App.esc(defaultSessionId) + '">' +
      '<label>Carry forward outputs</label>' + outputChecks +
      '<label style="margin-top:10px">Carry forward artifacts</label>' + artifactChecks +
      '<label style="margin-top:10px">Expected output snapshot</label><div class="dialog-knowledge-block compact">' + expectedSnapshot + '</div>' +
      '</div></details>', [
      { label: 'Cancel', onClick: function() {} },
      { label: 'Finish Stage', primary: true, onClick: async function() {
        await App.api('/products/' + encodeURIComponent(productId) + '/handoffs', {
          method: 'POST',
          body: JSON.stringify({
            run_id: linkedRunId,
            from_stage: fromStage,
            to_stage: document.getElementById('dlg-handoff-to').value,
            role: document.getElementById('dlg-handoff-role').value.trim(),
            runtime_agent: document.getElementById('dlg-handoff-agent').value,
            session_id: document.getElementById('dlg-handoff-session').value.trim(),
            summary: document.getElementById('dlg-handoff-summary').value.trim(),
            artifact_refs: App.getCheckedValues('[data-handoff-artifact-ref]', 'data-handoff-artifact-ref'),
            output_refs: App.getCheckedValues('[data-handoff-output-ref]', 'data-handoff-output-ref')
          })
        });
        await App.loadProducts(true);
        await App.loadProductDetail(productId, true);
        App.renderCurrentView();
      }}
    ]);
  }

  App.changeProductWorkspace = async function changeProductWorkspace(detail) {
    const currentWorkspaceId = ((detail.workspace || {}).runtime_workspace_id || '');
    const options = ['<option value="">No linked workspace</option>'].concat(
      state.workspaces.map(ws => '<option value="' + ws.id + '"' + (ws.id === currentWorkspaceId ? ' selected' : '') + '>' + App.esc(ws.name) + ' - ' + App.esc(ws.workingDir || 'no working dir') + '</option>')
    ).join('');

    App.showDialog('Change Runtime Workspace Link',
      '<label>Product</label><input type="text" value="' + App.esc(detail.name) + '" disabled>' +
      '<label>Linked Runtime Workspace</label><select id="dlg-product-workspace">' + options + '</select>' +
      '<p style="font-size:12px;color:var(--text-secondary);margin-top:6px">Product is the main delivery unit. Runtime workspace is only the execution context used by sessions.</p>',
      [
        { label: 'Cancel', onClick: function() {} },
        { label: 'Save', primary: true, onClick: async function() {
          const workspaceId = document.getElementById('dlg-product-workspace').value;
          await App.api('/products/' + encodeURIComponent(detail.product_id) + '/workspace', {
            method: 'PUT',
            body: JSON.stringify({ workspaceId: workspaceId })
          });
          await App.loadWorkspaces();
          await App.loadAllSessions();
          await App.loadProducts(true);
          App.renderWorkspaceList();
          App.renderCurrentView();
        } }
      ]);
  }

  App.slugifyClient = function slugifyClient(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }

  App.showProductWizard = function showProductWizard(initialDraft) {
    const draft = Object.assign({
      name: '',
      product_id: '',
      slug: '',
      owner: 'guibr',
      category: 'product',
      stage: 'brief',
      summary: '',
      local_path: '',
      directory_mode: 'existing',
      create_directory: false,
      create_minimal_structure: false,
      workspace_mode: 'none',
      workspace_id: '',
      workspace_name: '',
      workspace_description: '',
      enable_pm_skills: true,
      auto_slug: true
    }, initialDraft || {});

    function renderStep(step) {
      document.getElementById('dialog-title').textContent = 'New Product';
      const body = document.getElementById('dialog-body');
      const actions = document.getElementById('dialog-actions');
      actions.innerHTML = '';

      const stepper = '<div class="wizard-steps"><span class="wizard-step ' + (step === 1 ? 'active' : '') + '">1. Basics</span><span class="wizard-step ' + (step === 2 ? 'active' : '') + '">2. Structure & Runtime</span></div>';
      if (step === 1) {
        body.innerHTML = stepper +
          '<label>Product Name</label><input type="text" id="dlg-product-name" value="' + App.esc(draft.name) + '" placeholder="Zapcam">' +
          '<label>Product ID</label><input type="text" id="dlg-product-id" value="' + App.esc(draft.product_id) + '" placeholder="zapcam">' +
          '<label>Slug</label><input type="text" id="dlg-product-slug" value="' + App.esc(draft.slug) + '" placeholder="zapcam">' +
          '<label>Owner</label><input type="text" id="dlg-product-owner" value="' + App.esc(draft.owner) + '" placeholder="guibr">' +
          '<label>Category</label><select id="dlg-product-category"><option value="product"' + (draft.category === 'product' ? ' selected' : '') + '>product</option><option value="internal-tool"' + (draft.category === 'internal-tool' ? ' selected' : '') + '>internal-tool</option><option value="experiment"' + (draft.category === 'experiment' ? ' selected' : '') + '>experiment</option></select>' +
          '<label>Initial Stage</label><select id="dlg-product-stage">' + App.STAGE_ORDER.filter(item => item !== 'test' && item !== 'release').map(item => '<option value="' + item + '"' + (draft.stage === item ? ' selected' : '') + '>' + App.esc(item) + '</option>').join('') + '</select>' +
          '<label>Summary</label><textarea id="dlg-product-summary" placeholder="Short product summary.">' + App.esc(draft.summary) + '</textarea>' +
          '<p class="wizard-help">Create the delivery unit first. Runtime workspace and scaffold stay optional in the next step.</p>';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', App.hideDialog);
        const nextBtn = document.createElement('button');
        nextBtn.className = 'btn btn-primary';
        nextBtn.textContent = 'Next';
        nextBtn.addEventListener('click', () => {
          draft.name = document.getElementById('dlg-product-name').value.trim();
          draft.product_id = App.slugifyClient(document.getElementById('dlg-product-id').value.trim());
          draft.slug = App.slugifyClient(document.getElementById('dlg-product-slug').value.trim());
          draft.owner = document.getElementById('dlg-product-owner').value.trim();
          draft.category = document.getElementById('dlg-product-category').value;
          draft.stage = document.getElementById('dlg-product-stage').value;
          draft.summary = document.getElementById('dlg-product-summary').value.trim();
          if (!draft.name || !draft.owner) {
            alert('Product name and owner are required.');
            return;
          }
          if (!draft.product_id) draft.product_id = App.slugifyClient(draft.name);
          if (!draft.slug) draft.slug = draft.product_id;
          draft.enable_pm_skills = draft.category === 'product';
          renderStep(2);
        });
        actions.appendChild(cancelBtn);
        actions.appendChild(nextBtn);

        const nameInput = document.getElementById('dlg-product-name');
        const idInput = document.getElementById('dlg-product-id');
        const slugInput = document.getElementById('dlg-product-slug');
        const syncIds = () => {
          const nextSlug = App.slugifyClient(nameInput.value);
          if (!idInput.value || draft.auto_slug) idInput.value = nextSlug;
          if (!slugInput.value || draft.auto_slug) slugInput.value = nextSlug;
        };
        idInput.addEventListener('input', () => { draft.auto_slug = false; });
        slugInput.addEventListener('input', () => { draft.auto_slug = false; });
        nameInput.addEventListener('input', syncIds);
      } else {
        const workspaceOptions = ['<option value="">Select runtime workspace</option>']
          .concat(state.workspaces.map(ws => '<option value="' + ws.id + '"' + (ws.id === draft.workspace_id ? ' selected' : '') + '>' + App.esc(ws.name) + ' - ' + App.esc(ws.workingDir || 'no working dir') + '</option>'))
          .join('');
        const workspaceCreateBlock = draft.workspace_mode === 'create'
          ? '<label>Runtime Workspace Name</label><input type="text" id="dlg-product-workspace-name" value="' + App.esc(draft.workspace_name || (draft.name ? (draft.name + ' Runtime') : '')) + '">' +
            '<label>Workspace Description</label><input type="text" id="dlg-product-workspace-description" value="' + App.esc(draft.workspace_description) + '" placeholder="Optional execution context description">'
          : '';
        const workspaceExistingBlock = draft.workspace_mode === 'existing'
          ? '<label>Existing Runtime Workspace</label><select id="dlg-product-workspace-id">' + workspaceOptions + '</select>'
          : '';

        body.innerHTML = stepper +
          '<label>Product Directory</label><div class="inline-field-row"><input type="text" id="dlg-product-path" value="' + App.esc(draft.local_path) + '" placeholder="C:\\Projects\\zapcam" style="flex:1"><button class="btn btn-sm" id="dlg-product-path-browse" type="button">&#128193;</button></div>' +
          '<label>Directory Mode</label><select id="dlg-product-directory-mode"><option value="existing"' + (draft.directory_mode === 'existing' ? ' selected' : '') + '>Use existing directory</option><option value="create"' + (draft.directory_mode === 'create' ? ' selected' : '') + '>Create new directory</option></select>' +
          '<label class="checkbox-row"><input type="checkbox" id="dlg-product-create-structure"' + (draft.create_minimal_structure ? ' checked' : '') + '> Create minimal product structure from template</label>' +
          '<label>Runtime Workspace</label><select id="dlg-product-workspace-mode"><option value="none"' + (draft.workspace_mode === 'none' ? ' selected' : '') + '>No runtime workspace for now</option><option value="create"' + (draft.workspace_mode === 'create' ? ' selected' : '') + '>Create runtime workspace</option><option value="existing"' + (draft.workspace_mode === 'existing' ? ' selected' : '') + '>Link existing runtime workspace</option></select>' +
          workspaceCreateBlock + workspaceExistingBlock +
          '<label class="checkbox-row"><input type="checkbox" id="dlg-product-pm-skills"' + (draft.category === 'product' && draft.enable_pm_skills ? ' checked' : '') + (draft.category !== 'product' ? ' disabled' : '') + '> Enable PM Skills guidance</label>' +
          '<p class="wizard-help">Safe defaults: no Git automation, no code generation, and no overwrite of non-empty directories.</p>';

        const backBtn = document.createElement('button');
        backBtn.className = 'btn';
        backBtn.textContent = 'Back';
        backBtn.addEventListener('click', () => {
          draft.local_path = document.getElementById('dlg-product-path').value.trim();
          draft.create_minimal_structure = document.getElementById('dlg-product-create-structure').checked;
          draft.directory_mode = document.getElementById('dlg-product-directory-mode').value;
          draft.workspace_mode = document.getElementById('dlg-product-workspace-mode').value;
          renderStep(1);
        });

        const createBtn = document.createElement('button');
        createBtn.className = 'btn btn-primary';
        createBtn.textContent = 'Create Product';
        createBtn.addEventListener('click', async () => {
          draft.local_path = document.getElementById('dlg-product-path').value.trim();
          draft.directory_mode = document.getElementById('dlg-product-directory-mode').value;
          draft.create_directory = draft.directory_mode === 'create';
          draft.create_minimal_structure = document.getElementById('dlg-product-create-structure').checked;
          draft.workspace_mode = document.getElementById('dlg-product-workspace-mode').value;
          draft.workspace_id = document.getElementById('dlg-product-workspace-id') ? document.getElementById('dlg-product-workspace-id').value : '';
          draft.workspace_name = document.getElementById('dlg-product-workspace-name') ? document.getElementById('dlg-product-workspace-name').value.trim() : '';
          draft.workspace_description = document.getElementById('dlg-product-workspace-description') ? document.getElementById('dlg-product-workspace-description').value.trim() : '';
          draft.enable_pm_skills = draft.category === 'product' && !!(document.getElementById('dlg-product-pm-skills') && document.getElementById('dlg-product-pm-skills').checked);

          if (!draft.local_path) {
            alert('Product directory is required.');
            return;
          }
          if (draft.workspace_mode === 'existing' && !draft.workspace_id) {
            alert('Select a runtime workspace or choose another workspace mode.');
            return;
          }

          try {
            const result = await App.api('/products', {
              method: 'POST',
              body: JSON.stringify({
                name: draft.name,
                product_id: draft.product_id,
                slug: draft.slug,
                owner: draft.owner,
                category: draft.category,
                stage: draft.stage || 'brief',
                summary: draft.summary,
                repo: { local_path: draft.local_path },
                workspace_mode: draft.workspace_mode,
                workspace_id: draft.workspace_id,
                workspace_name: draft.workspace_name,
                workspace_description: draft.workspace_description,
                create_directory: draft.create_directory,
                create_minimal_structure: draft.create_minimal_structure,
                enable_pm_skills: draft.enable_pm_skills
              })
            });
            App.hideDialog();
            state.activeProductId = result.product.product_id;
            if (result.detail) state.productDetails[result.product.product_id] = result.detail;
            await App.loadWorkspaces();
            await App.loadAllSessions();
            await App.loadProducts(true);
            if (result.detail && result.detail.workspace && result.detail.workspace.runtime_workspace_id) {
              App.setActiveWorkspace(result.detail.workspace.runtime_workspace_id);
            }
            App.switchView('products');
            App.renderWorkspaceList();
            App.renderCurrentView();
          } catch (error) {
            alert(error.message);
          }
        });

        actions.appendChild(backBtn);
        actions.appendChild(createBtn);

        const browseBtn = document.getElementById('dlg-product-path-browse');
        if (browseBtn) {
          browseBtn.addEventListener('click', async () => {
            const currentDir = document.getElementById('dlg-product-path').value || 'C:\\Users';
            try {
              const data = await App.api('/browse?path=' + encodeURIComponent(currentDir));
              App.showDirBrowser(data, (selectedPath) => {
                draft.local_path = selectedPath;
                renderStep(2);
              });
            } catch (error) {
              console.error(error);
            }
          });
        }

        const workspaceModeSelect = document.getElementById('dlg-product-workspace-mode');
        if (workspaceModeSelect) {
          workspaceModeSelect.addEventListener('change', () => {
            draft.local_path = document.getElementById('dlg-product-path').value.trim();
            draft.create_minimal_structure = document.getElementById('dlg-product-create-structure').checked;
            draft.directory_mode = document.getElementById('dlg-product-directory-mode').value;
            draft.workspace_mode = workspaceModeSelect.value;
            draft.workspace_id = document.getElementById('dlg-product-workspace-id') ? document.getElementById('dlg-product-workspace-id').value : '';
            draft.workspace_name = document.getElementById('dlg-product-workspace-name') ? document.getElementById('dlg-product-workspace-name').value.trim() : draft.workspace_name;
            draft.workspace_description = document.getElementById('dlg-product-workspace-description') ? document.getElementById('dlg-product-workspace-description').value.trim() : draft.workspace_description;
            renderStep(2);
          });
        }
      }

      document.getElementById('dialog-overlay').classList.remove('hidden');
    }

    renderStep(1);
  }

  App.metaItem = function metaItem(label, value) {
    return '<div><span class="meta-item-label">' + App.esc(label) + '</span><span class="mono">' + App.esc(value || 'unknown') + '</span></div>';
  }

  App.resolveCurrentRun = function resolveCurrentRun(detail) {
    if (!detail) return null;
    if (detail.current_run && typeof detail.current_run === 'object') return detail.current_run;
    if (detail.active_run && typeof detail.active_run === 'object') return detail.active_run;
    const runs = Array.isArray(detail.runs) ? detail.runs : [];
    return runs.find(run => ['active', 'running', 'in-progress'].includes(run.status)) || runs[0] || null;
  }

  App.normalizeOutputList = function normalizeOutputList(values) {
    if (!values) return [];
    if (Array.isArray(values)) {
      return values.filter(Boolean).map(item => {
        if (item && typeof item === 'object') {
          return item.label || item.ref_id || item.output_id || JSON.stringify(item);
        }
        return String(item);
      });
    }
    return [String(values)];
  }

  App.normalizeOutputRecords = function normalizeOutputRecords(values) {
    if (!Array.isArray(values)) return [];
    return values
      .filter(Boolean)
      .map(item => {
        if (item && typeof item === 'object') {
          return {
            output_id: item.output_id || item.id || '',
            type: item.type || '',
            ref_id: item.ref_id || '',
            label: item.label || item.ref_id || item.output_id || 'Output',
            required: !!item.required,
            created_at: item.created_at || 0
          };
        }
        const value = String(item);
        return {
          output_id: value,
          type: '',
          ref_id: value,
          label: value,
          required: false,
          created_at: 0
        };
      });
  }

  App.findLatestIncomingHandoff = function findLatestIncomingHandoff(detail, stageId) {
    const handoffs = Array.isArray(detail && detail.handoffs) ? detail.handoffs : [];
    const matching = handoffs
      .filter(item => (item.to_stage || '') === stageId)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    return matching[0] || null;
  }

  App.buildOutputReferenceChips = function buildOutputReferenceChips(items, emptyText) {
    const normalized = App.normalizeOutputRecords(items);
    if (!normalized.length) {
      return '<div class="artifact-row-meta">' + App.esc(emptyText || 'No outputs linked.') + '</div>';
    }
    return '<div class="chip-row">' + normalized.map(item => '<span class="chip ' + (item.required ? 'warn' : 'subtle') + '">' + App.esc(item.label) + '</span>').join('') + '</div>';
  }

  App.buildOutputChecklist = function buildOutputChecklist(items, idPrefix, selectedRefs, dataAttrName) {
    const normalized = App.normalizeOutputRecords(items);
    if (!normalized.length) return '<div class="artifact-row-meta">No outputs available from the current run.</div>';
    const selected = new Set((selectedRefs || []).filter(Boolean));
    const attrName = dataAttrName || 'data-handoff-output-ref';
    return '<div class="handoff-output-checklist">' + normalized.map((item, index) => {
      const refValue = item.output_id || item.ref_id || ('output-' + index);
      const checkboxId = idPrefix + '-' + index;
      const checked = selected.size === 0 || selected.has(refValue) || selected.has(item.ref_id);
      return '<label class="handoff-output-option" for="' + App.esc(checkboxId) + '"><input type="checkbox" id="' + App.esc(checkboxId) + '" ' + attrName + '="' + App.esc(refValue) + '"' + (checked ? ' checked' : '') + '><span>' + App.esc(item.label) + '</span><span class="chip subtle">' + App.esc(item.type || 'output') + '</span></label>';
    }).join('') + '</div>';
  }

  App.pickPrimaryRunSession = function pickPrimaryRunSession(run, detail) {
    if (!run) return null;
    const runSessions = App.resolveRunSessions(run, detail);
    if (!runSessions.length) return null;
    const primaryId = run.primary_session_id || run.current_session_id || '';
    return runSessions.find(item => item.id === primaryId) || runSessions[0];
  }

  App.pickCarryForwardOutputs = function pickCarryForwardOutputs(run) {
    const produced = App.normalizeOutputRecords(run && run.produced_outputs);
    const preferred = produced.filter(item => !['knowledge-driver', 'action', 'handoff'].includes(String(item.type || '').toLowerCase()));
    const base = preferred.length ? preferred : produced;
    const seen = new Set();
    var categoryOrder = { evidence: 0, context: 1, metadata: 2 };
    return base.filter(item => {
      const key = [item.type || '', item.ref_id || item.output_id || '', item.label || ''].join('::');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort(function(a, b) {
      return (categoryOrder[a.category] || 1) - (categoryOrder[b.category] || 1);
    });
  }

  App.buildCompletionDraft = function buildCompletionDraft(detail, run, fromStage, toStage, primarySession) {
    const productName = detail && detail.name ? detail.name : 'this product';
    const producedOutputs = App.pickCarryForwardOutputs(run).map(item => item.label).filter(Boolean);
    const objective = run && run.objective ? run.objective : '';
    const knowledge = App.resolveRunKnowledge(run, detail);
    const parts = [
      `Stage ${fromStage} executed for product ${productName}.`,
      objective ? `Objective covered: ${objective}.` : '',
      producedOutputs.length ? `Produced outputs: ${producedOutputs.join(', ')}.` : 'Produced outputs still need confirmation by the operator.',
      primarySession ? `Primary execution session: ${primarySession.name} (${primarySession.id}).` : '',
      knowledge ? `Execution guidance used: ${knowledge.knowledge_pack_name} ${knowledge.preset_label || knowledge.preset_id}.` : '',
      `Next stage should continue in ${toStage} with the outputs and context carried forward from ${fromStage}.`
    ].filter(Boolean);
    return parts.join(' ');
  }

  App.getCheckedValues = function getCheckedValues(selector, attrName) {
    const attribute = attrName || 'data-handoff-output-ref';
    return Array.from(document.querySelectorAll(selector))
      .filter(input => input.checked)
      .map(input => input.getAttribute(attribute) || '')
      .filter(Boolean);
  }

  App.resolveLatestHandoff = function resolveLatestHandoff(handoffs) {
    const list = Array.isArray(handoffs) ? handoffs.slice() : [];
    return list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0] || null;
  }

  App.buildHandoffSummaryInline = function buildHandoffSummaryInline(handoff) {
    if (!handoff) return '';
    return '<div class="handoff-inline"><strong>' + App.esc((handoff.from_stage || 'unknown') + ' -> ' + (handoff.to_stage || 'unknown')) + '</strong><div class="artifact-row-meta">' + App.esc(handoff.summary || 'No summary recorded.') + '</div></div>';
  }

  App.resolveLatestHandoff = function resolveLatestHandoff(handoffs) {
    const list = Array.isArray(handoffs) ? handoffs.slice() : [];
    return list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0] || null;
  }

  App.buildHandoffSummaryInline = function buildHandoffSummaryInline(handoff) {
    if (!handoff) return '';
    return '<div class="handoff-inline"><strong>' + App.esc((handoff.from_stage || 'unknown') + ' -> ' + (handoff.to_stage || 'unknown')) + '</strong><div class="artifact-row-meta">' + App.esc(handoff.summary || 'No summary recorded.') + '</div></div>';
  }

  App.normalizePresetType = function normalizePresetType(type) {
    if (!type) return '';
    return String(type).toLowerCase() === 'workflow' ? 'workflow' : 'skill';
  }

  App.buildPresetLabel = function buildPresetLabel(type, id, explicitLabel) {
    if (explicitLabel) return explicitLabel;
    if (!id) return '';
    const normalizedType = App.normalizePresetType(type);
    return normalizedType ? (normalizedType + ' ' + id) : String(id);
  }

  App.buildKnowledgeDriverInline = function buildKnowledgeDriverInline(driver) {
    if (!driver) return '';
    const packName = driver.knowledge_pack_name || driver.name || driver.knowledge_pack_id || 'knowledge-pack';
    const presetType = App.normalizePresetType(driver.preset_type || driver.type || '');
    const presetId = driver.preset_id || driver.id || '';
    const presetLabel = App.buildPresetLabel(presetType, presetId, driver.preset_label || driver.label || '');
    return '<div class="knowledge-driver-inline"><span class="chip knowledge">' + App.esc(packName) + '</span>' + (presetLabel ? '<span class="chip subtle">' + App.esc(presetLabel) + '</span>' : '') + '</div>';
  }

  App.getRecommendationPresets = function getRecommendationPresets(rec) {
    if (!rec || typeof rec !== 'object') return [];
    const explicit = Array.isArray(rec.available_presets) ? rec.available_presets
      : (Array.isArray(rec.presets) ? rec.presets : []);
    const normalizedExplicit = explicit.map((item, index) => {
      const presetType = App.normalizePresetType(item.preset_type || item.type || '');
      const presetId = item.preset_id || item.id || '';
      const presetLabel = App.buildPresetLabel(presetType, presetId, item.preset_label || item.label || '');
      return {
        knowledge_pack_id: rec.knowledge_pack_id || item.knowledge_pack_id || '',
        knowledge_pack_name: rec.knowledge_pack_name || item.knowledge_pack_name || '',
        preset_type: presetType,
        preset_id: presetId,
        preset_label: presetLabel,
        is_default: !!item.is_default || index === 0
      };
    }).filter(item => item.preset_id);
    if (normalizedExplicit.length) return normalizedExplicit;

    const workflows = Array.isArray(rec.recommended_workflows) ? rec.recommended_workflows : [];
    const skills = Array.isArray(rec.recommended_skills) ? rec.recommended_skills : [];
    return workflows.map((item, index) => ({
      knowledge_pack_id: rec.knowledge_pack_id || '',
      knowledge_pack_name: rec.knowledge_pack_name || '',
      preset_type: 'workflow',
      preset_id: item,
      preset_label: App.buildPresetLabel('workflow', item),
      is_default: index === 0
    })).concat(skills.map((item, index) => ({
      knowledge_pack_id: rec.knowledge_pack_id || '',
      knowledge_pack_name: rec.knowledge_pack_name || '',
      preset_type: 'skill',
      preset_id: item,
      preset_label: App.buildPresetLabel('skill', item),
      is_default: workflows.length === 0 && index === 0
    })));
  }

  App.resolvePresetFromRecommendation = function resolvePresetFromRecommendation(rec) {
    const presets = App.getRecommendationPresets(rec);
    return presets.find(item => item.is_default) || presets[0] || null;
  }

  App.resolveStageKnowledgeEntries = function resolveStageKnowledgeEntries(detail, stageId) {
    if (!detail || !stageId) return [];
    const stages = Array.isArray(detail.knowledge_stage_recommendations) ? detail.knowledge_stage_recommendations : [];
    const stage = stages.find(item => item.stage_id === stageId);
    if (!stage) return [];
    return Array.isArray(stage.recommendations) ? stage.recommendations : [];
  }

  App.resolveStageDefaultPreset = function resolveStageDefaultPreset(detail, stageId) {
    const recommendations = App.resolveStageKnowledgeEntries(detail, stageId);
    for (const rec of recommendations) {
      const preset = App.resolvePresetFromRecommendation(rec);
      if (preset) return preset;
    }
    return null;
  }

  App.resolveActionKnowledge = function resolveActionKnowledge(action, detail, stageId) {
    if (!action) return null;
    if (action.knowledge_pack_id || action.preset_id || action.preset_label) {
      return {
        knowledge_pack_id: action.knowledge_pack_id || '',
        knowledge_pack_name: action.knowledge_pack_name || '',
        preset_type: App.normalizePresetType(action.preset_type || ''),
        preset_id: action.preset_id || '',
        preset_label: App.buildPresetLabel(action.preset_type, action.preset_id, action.preset_label)
      };
    }
    return App.resolveStageDefaultPreset(detail, stageId);
  }

  App.resolveRunKnowledge = function resolveRunKnowledge(run, detail) {
    if (!run) return null;
    if (run.knowledge_pack_id || run.preset_id || run.preset_label) {
      return {
        knowledge_pack_id: run.knowledge_pack_id || '',
        knowledge_pack_name: run.knowledge_pack_name || '',
        preset_type: App.normalizePresetType(run.preset_type || ''),
        preset_id: run.preset_id || '',
        preset_label: App.buildPresetLabel(run.preset_type, run.preset_id, run.preset_label)
      };
    }
    return App.resolveStageDefaultPreset(detail, run.stage_id || run.stageId || detail.current_stage_id);
  }

  App.resolveRunSessions = function resolveRunSessions(run, detail) {
    if (!run) return [];
    const relatedSessions = detail.related_sessions || [];
    if (Array.isArray(run.sessions) && run.sessions.length) {
      return run.sessions.map(item => {
        if (item && typeof item === 'object') return item;
        return relatedSessions.find(session => session.id === item);
      }).filter(Boolean);
    }
    if (Array.isArray(run.session_ids) && run.session_ids.length) {
      return run.session_ids.map(id => relatedSessions.find(session => session.id === id)).filter(Boolean);
    }
    const runId = run.id || run.run_id;
    if (!runId) return [];
    return relatedSessions.filter(session => (session.runId || session.run_id) === runId);
  }

  App.buildHandoffHistoryPanel = function buildHandoffHistoryPanel(detail) {
    const handoffs = Array.isArray(detail && detail.handoffs) ? detail.handoffs : [];
    if (!handoffs.length) return '<p>No stage completions recorded yet.</p>';
    const currentRun = App.resolveCurrentRun(detail);
    const currentRunId = currentRun ? (currentRun.run_id || currentRun.id || '') : '';
    return '<div class="handoff-list">' + handoffs.map(handoff => {
      const fromCurrentRun = currentRunId && (handoff.run_id || handoff.runId || '') === currentRunId;
      return '<div class="handoff-row">' +
        '<div class="product-row"><strong>' + App.esc(handoff.from_stage) + ' -> ' + App.esc(handoff.to_stage) + '</strong><div class="chip-row"><span class="chip">' + App.esc(handoff.role || 'unknown-role') + '</span>' + (fromCurrentRun ? '<span class="chip knowledge">from current run</span>' : '') + '</div></div>' +
        '<div class="handoff-summary">' + App.esc(handoff.summary || '') + '</div>' +
        '<details class="inline-details"><summary>Technical context</summary><div class="inline-details-body"><div class="handoff-meta-grid">' +
          App.metaItem('Run', handoff.run_id || 'none') +
          App.metaItem('Session', handoff.session_id || 'none') +
          App.metaItem('Runtime', handoff.runtime_agent || 'unknown-agent') +
          App.metaItem('Created', App.formatDateTime(handoff.created_at)) +
        '</div>' +
        (handoff.knowledge_driver ? '<div class="action-row-meta"><span class="meta-item-label">Knowledge Driver</span>' + App.buildKnowledgeDriverInline(handoff.knowledge_driver) + '</div>' : '') +
        '<div class="action-row-meta"><span class="meta-item-label">Artifacts</span>' + App.buildOutputReferenceChips((handoff.artifact_refs || []).map(item => ({ label: item })), 'No artifacts referenced.') + '</div>' +
        '<div class="action-row-meta"><span class="meta-item-label">Outputs</span>' + App.buildOutputReferenceChips((handoff.output_refs || []).map(item => ({ label: item })), 'No outputs referenced.') + '</div></div></details>' +
      '</div>';
    }).join('') + '</div>';
  }

  App.buildCurrentRunPanel = function buildCurrentRunPanel(detail, run) {
    if (!run) {
      return '<div class="run-empty"><strong>No coordinated run active</strong><p class="empty-subtext">Execute a next action or start a stage to create the first tracked run for this product.</p></div>';
    }

    const runId = run.id || run.run_id || 'run-pending';
    const expectedOutputs = App.normalizeOutputRecords(run.expected_outputs || run.outputs_expected || []);
    const producedOutputs = App.normalizeOutputRecords(run.produced_outputs || run.outputs_produced || run.outputs || []);
    const runSessions = App.resolveRunSessions(run, detail);
    const stageId = run.stage_id || run.stageId || detail.current_stage_id || detail.computed_stage_signal || 'idea';
    const role = run.role || run.recommended_role || 'unassigned';
    const runtimeAgent = run.suggested_runtime_agent || run.runtime_agent || run.recommended_runtime_agent || 'unspecified';
    const workspaceName = ((detail.workspace || {}).linked_workspace_name || (detail.workspace || {}).runtime_workspace_id || 'none');
    const knowledge = App.resolveRunKnowledge(run, detail);
    const latestHandoff = run.latest_handoff || ((run.linked_handoffs || [])[0]) || null;
    const incomingHandoff = Array.isArray(run.incoming_handoffs) && run.incoming_handoffs.length ? run.incoming_handoffs[0] : null;
    const primarySession = App.pickPrimaryRunSession(run, detail);
    const completion = run.completion_summary || {
      expected_total: expectedOutputs.length,
      produced_total: producedOutputs.length,
      required_expected_total: expectedOutputs.filter(item => item.required).length,
      required_produced_total: producedOutputs.filter(item => item.required).length
    };
    const handoffCount = Array.isArray(run.linked_handoffs)
      ? run.linked_handoffs.length
      : (Array.isArray(run.handoffs) ? run.handoffs.length : ((detail.handoffs || []).filter(item => (item.run_id || item.runId) === runId).length));

    return '<div class="run-shell">' +
      '<div class="run-status-row"><div><div class="run-kicker">Execution</div><div class="artifact-row-meta">Current stage in motion</div></div><div class="chip-row"><span class="status-pill ' + App.esc(run.status || 'in-progress') + '">' + App.esc(App.stageStatusLabel(run.status || 'in-progress')) + '</span><span class="chip">' + App.esc(stageId) + '</span><span class="chip">' + App.esc(role) + '</span><span class="chip">' + App.esc(runtimeAgent) + '</span></div></div>' +
      '<div class="run-objective">' + App.esc(run.objective || 'No run objective registered yet.') + '</div>' +
      (run.is_ready_to_complete ? '<div class="summary-callout ok"><span class="meta-item-label">Ready to complete</span><div class="artifact-row-meta">This run has linked execution context and produced outputs that can be carried into the next stage.</div></div>' : '') +
      (run.pre_run_hash ? '<div class="summary-callout warn" style="margin-top:8px"><span class="meta-item-label">Safe Checkpoint Available</span><div class="artifact-row-meta">This run started from a clean repository state (' + App.esc(run.pre_run_hash.substring(0, 7)) + '). You can safely discard all changes if things go wrong.</div></div>' : '') +
      '<div class="meta-list run-meta-list">' +
      App.metaItem('Product', detail.name) +
      App.metaItem('Stage', stageId) +
      App.metaItem('Linked Sessions', String(runSessions.length)) +
      App.metaItem('Handoffs', String(handoffCount)) +
      App.metaItem('Required Outputs', String(completion.required_produced_total || 0) + '/' + String(completion.required_expected_total || 0)) +
      App.metaItem('Outputs', String(completion.produced_total || 0) + '/' + String(completion.expected_total || 0)) +
      App.metaItem('Updated', App.formatDateTime(run.updated_at || run.created_at || Date.now())) +
      '</div>' +
      ((knowledge || incomingHandoff || latestHandoff || primarySession) ? '<details class="inline-details"><summary>Execution details</summary><div class="inline-details-body"><div class="meta-list run-meta-list">' +
        App.metaItem('Run ID', runId) +
        App.metaItem('Runtime Workspace', workspaceName) +
        App.metaItem('Primary Session', primarySession ? primarySession.id : 'none') +
        '</div>' +
        (knowledge ? '<div class="run-card"><span class="meta-item-label">Knowledge Driver</span>' + App.buildKnowledgeDriverInline(knowledge) + '<div class="artifact-row-meta" style="margin-top:8px">This execution was started from a curated preset.</div></div>' : '') +
        (incomingHandoff ? '<div class="run-card"><span class="meta-item-label">Incoming Context</span><div class="handoff-summary">' + App.esc(incomingHandoff.summary || '') + '</div><div class="artifact-row-meta" style="margin-top:8px">' + App.esc((incomingHandoff.from_stage || 'unknown') + ' -> ' + (incomingHandoff.to_stage || stageId)) + '</div>' + App.buildOutputReferenceChips((incomingHandoff.output_refs || []).map(item => ({ label: item })), 'No outputs referenced from the previous stage.') + '</div>' : '') +
        (latestHandoff ? '<div class="run-card"><div class="product-row"><span class="meta-item-label">Latest Completion</span><span class="artifact-row-meta">' + App.esc(App.formatDateTime(latestHandoff.created_at)) + '</span></div><div class="handoff-summary">' + App.esc(latestHandoff.summary || '') + '</div><div class="artifact-row-meta" style="margin-top:8px">' + App.esc((latestHandoff.from_stage || stageId) + ' -> ' + (latestHandoff.to_stage || 'unknown')) + '</div>' + ((run.next_stage_hint || latestHandoff.to_stage) ? '<div class="artifact-row-meta" style="margin-top:6px">Next stage hint: ' + App.esc(run.next_stage_hint || latestHandoff.to_stage) + '</div>' : '') + '</div>' : '') +
      '</div></details>' : '') +
      '<div class="run-body-grid">' +
        '<div class="run-card"><span class="meta-item-label">Expected Outputs</span>' + App.buildRunOutputList(expectedOutputs, 'No expected outputs declared.') + '</div>' +
        '<div class="run-card"><span class="meta-item-label">Produced Outputs</span>' + App.buildCategorizedOutputList(producedOutputs) + '</div>' +
      '</div>' +
      '<div class="run-card" style="margin-top:12px"><div class="product-row"><span class="meta-item-label">Run Sessions</span><span class="artifact-row-meta">' + App.esc(String(runSessions.length)) + ' linked</span></div>' +
      (runSessions.length
        ? '<div class="run-session-list">' + runSessions.map(session => '<div class="run-session-row"><div><strong>' + App.esc(session.name) + '</strong><div class="artifact-row-meta">' + App.esc((session.agent || 'agent') + ' | ' + (session.status || 'unknown')) + '</div></div><div class="chip-row"><button class="btn btn-sm" data-run-action="open-session" data-session-id="' + App.esc(session.id) + '">Open</button>' + (session.status === 'running' ? '<button class="btn btn-sm" data-run-action="restart-session" data-session-id="' + App.esc(session.id) + '">Restart</button>' : '<button class="btn btn-sm btn-primary" data-run-action="start-session" data-session-id="' + App.esc(session.id) + '">Start</button>') + '</div></div>').join('') + '</div>'
        : '<p class="empty-subtext" style="margin-top:8px">This run has no linked sessions yet. Executing the next action or starting the current stage will attach the first executor session.</p>') +
      '</div>' +
      (stageId !== 'idea' ? '<div class="step-card-actions run-primary-actions"><button class="btn btn-primary" data-run-action="complete-stage" data-stage-id="' + App.esc(stageId) + '">Complete Current Stage</button>' + (run.pre_run_hash ? '<button class="btn" style="color:var(--text-warn)" data-run-action="discard-run" data-run-id="' + App.esc(runId) + '">Discard Run Changes</button>' : '') + '</div>' : '') +
      '</div>';
  }

  App.buildRunOutputList = function buildRunOutputList(items, emptyText) {
    const normalized = App.normalizeOutputRecords(items);
    if (!normalized.length) return '<p class="empty-subtext">' + App.esc(emptyText) + '</p>';
    return '<div class="run-output-list">' + normalized.map(item => '<div class="run-output-row"><span class="chip ' + (item.required ? 'warn' : 'subtle') + '">' + App.esc(item.label) + '</span>' + (item.type ? '<span class="artifact-row-meta">' + App.esc(item.type) + '</span>' : '') + '</div>').join('') + '</div>';
  }

  App.buildCategorizedOutputList = function buildCategorizedOutputList(items) {
    var normalized = App.normalizeOutputRecords(items);
    if (!normalized.length) return '<p class="empty-subtext">No outputs registered yet.</p>';
    var groups = { evidence: [], context: [], metadata: [] };
    normalized.forEach(function(item) {
      var cat = item.category || 'context';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });
    var labels = { evidence: 'Evidence', context: 'Context', metadata: 'Metadata' };
    var html = '';
    ['evidence', 'context', 'metadata'].forEach(function(cat) {
      if (!groups[cat] || !groups[cat].length) return;
      html += '<div class="output-category-group"><div class="output-category-group-title">' + labels[cat] + ' (' + groups[cat].length + ')</div>';
      html += '<div class="run-output-list">' + groups[cat].map(function(item) {
        return '<div class="run-output-row"><span class="chip ' + (cat === 'evidence' ? 'ok' : cat === 'metadata' ? '' : 'subtle') + '">' + App.esc(item.label) + '</span>' + (item.type ? '<span class="artifact-row-meta">' + App.esc(item.type) + '</span>' : '') + '</div>';
      }).join('') + '</div></div>';
    });
    return html;
  }

  App.stageSignalClass = function stageSignalClass(stageId) {
    if (['implementation', 'test', 'release'].includes(stageId)) return 'ok';
    if (['architecture', 'spec'].includes(stageId)) return 'warn';
    return '';
  }

  App.stageStatusLabel = function stageStatusLabel(status) {
    if (status === 'in-progress') return 'in progress';
    if (status === 'not-started') return 'not started';
    if (status === 'ready-for-handoff') return 'ready for handoff';
    if (status === 'ready') return 'ready to start';
    return status || 'unknown';
  }

  App.artifactContentLabel = function artifactContentLabel(artifact) {
    var state = (artifact && artifact.content_status) || ((artifact && artifact.exists) ? 'valid' : 'missing');
    if (state === 'skeletal') return 'empty/skeletal';
    if (state === 'valid') return 'present';
    return 'missing';
  }

  App.buildArtifactRow = function buildArtifactRow(artifact) {
    var contentState = (artifact && artifact.content_status) || ((artifact && artifact.exists) ? 'valid' : 'missing');
    var subtleMeta = '';
    if (contentState === 'skeletal') {
      subtleMeta = '<div class="artifact-row-meta" style="margin-top:6px">Exists on disk but still looks empty or skeletal.</div>';
    } else if (artifact && artifact.exists && artifact.sizeBytes) {
      subtleMeta = '<div class="artifact-row-meta" style="margin-top:6px">Size: ' + App.esc(String(artifact.sizeBytes)) + ' bytes</div>';
    }
    return '<div class="artifact-row"><div class="product-row"><h4>' + App.esc(artifact.label) + '</h4><div class="chip-row"><span class="artifact-chip ' + App.esc(contentState === 'valid' ? 'exists' : contentState) + '">' + App.esc(App.artifactContentLabel(artifact)) + '</span>' + (contentState === 'skeletal' ? '<span class="chip subtle">needs content</span>' : '') + '</div></div><div class="artifact-row-meta mono" style="margin-top:8px">' + App.esc(artifact.path || 'No path configured') + '</div>' + subtleMeta + '</div>';
  }

  App.formatDateTime = function formatDateTime(ts) {
    if (!ts) return 'unknown';
    try { return new Date(ts).toLocaleString('pt-BR'); } catch { return 'unknown'; }
  }

  // ============ TERMINAL GRID ============
  App.renderTerminalView = function renderTerminalView() {
    const grid = document.getElementById('terminal-grid');
    const workspaceSessions = state.activeWorkspaceId
      ? state.allSessions.filter(s => s.workspaceId === state.activeWorkspaceId)
      : [];
    const stopAllBtn = document.getElementById('btn-stop-all-sessions');
    if (stopAllBtn) stopAllBtn.disabled = !state.activeWorkspaceId || !workspaceSessions.some(s => s.status === 'running');
    const terminalSlots = App.getTerminalSlots(state.activeWorkspaceId);
    const maxPanes = state.gridLayout === 4 ? 4 : (state.gridLayout === 2 ? 2 : 1);

    if (!state.activeWorkspaceId) {
      grid.className = 'grid-1';
      grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#9889;</div><div class="empty-state-text">Select a runtime workspace to start</div><div class="empty-subtext">Products are the delivery unit. Drag a runtime workspace here only when you want to operate sessions.</div></div>';
      App.bindTerminalGridDropZone(grid, null);
      return;
    }

    if (!workspaceSessions.length) {
      grid.className = 'grid-1';
      grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#9889;</div><div class="empty-state-text">No sessions in this runtime workspace</div><div class="empty-subtext">Create one or drag a session here after linking the runtime workspace.</div><button class="btn btn-primary" onclick="window._app.newSession()">+ New Session</button></div>';
      App.bindTerminalGridDropZone(grid, null);
      return;
    }

    grid.className = 'grid-' + maxPanes;

    App.closeAllTerminals();
    grid.innerHTML = '';
    App.bindTerminalGridDropZone(grid, null);

    for (let i = 0; i < maxPanes; i++) {
      const sessionId = terminalSlots[i];
      const session = sessionId ? workspaceSessions.find(s => s.id === sessionId) : null;

      const paneEl = document.createElement('div');
      paneEl.className = 'terminal-pane' + (session ? '' : ' terminal-pane-empty');
      paneEl.dataset.slotIndex = String(i);
      App.bindTerminalPaneDropZone(paneEl, i);

      if (!session) {
        paneEl.innerHTML = '<div class="terminal-pane-header"><div class="terminal-pane-title">Pane ' + (i + 1) + '</div></div><div class="terminal-pane-body"><div class="empty-state"><div class="empty-state-icon">&#10515;</div><div class="empty-state-text">Drop a session here</div><div class="empty-subtext">Drag a session from the runtime workspace sidebar into this slot.</div></div></div>';
        grid.appendChild(paneEl);
        continue;
      }

      const sessionMeta = App.AGENT_META[session.agent] ? App.AGENT_META[session.agent].icon : '?';
      const actions = '<button onclick="window._app.startSession(\'' + session.id + '\')" title="Start">&#9654;</button><button onclick="window._app.restartSession(\'' + session.id + '\')" title="Restart">&#8635;</button><button onclick="window._app.stopSession(\'' + session.id + '\')" title="Stop">&#9209;</button><button onclick="window._app.closeTerminalPane(\'' + session.id + '\')" title="Close Pane">&#10005;</button>';
      const modelMeta = [session.model || '', session.effort ? ('effort:' + session.effort) : ''].filter(Boolean).join(' | ');
      paneEl.innerHTML = '<div class="terminal-pane-header"><div class="terminal-pane-title"><span class="agent-badge ' + session.agent + '">' + sessionMeta + '</span>' + App.esc(session.name) + '<span style="color:var(--text-muted); font-size:10px">' + App.esc(modelMeta) + '</span></div><div class="terminal-pane-actions">' + actions + '</div></div><div class="terminal-pane-body" id="term-body-' + session.id + '"></div>';

      grid.appendChild(paneEl);
      const bodyEl = paneEl.querySelector('.terminal-pane-body');
      if (session.status === 'running' || state.startingSessionIds.has(session.id)) {
        App.createTerminal(session.id, bodyEl);
      } else {
        bodyEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#9209;</div><div class="empty-state-text">Session is ' + App.esc(App.stageStatusLabel(session.status || 'stopped')) + '</div><div style="display:flex;gap:8px"><button class="btn btn-primary" onclick="window._app.startSession(\'' + session.id + '\')">Start</button><button class="btn" onclick="window._app.restartSession(\'' + session.id + '\')">Restart</button><button class="btn" onclick="window._app.closeTerminalPane(\'' + session.id + '\')">Close</button></div></div>';
      }
    }

    if (workspaceSessions.length > maxPanes) {
      const extra = document.createElement('div');
      extra.style.cssText = 'padding:8px 12px;font-size:12px;color:var(--text-muted);background:var(--bg-secondary);border-top:1px solid var(--border)';
      extra.textContent = '+' + Math.max(0, workspaceSessions.length - terminalSlots.filter(Boolean).length) + ' more sessions available in this runtime workspace';
      grid.appendChild(extra);
    }
  }

  App.closeTerminalPane = function closeTerminalPane(sessionId) {
    if (!sessionId) return;
    state.startingSessionIds.delete(sessionId);
    state.closedTerminalSessionIds.add(sessionId);
    if (state.activeWorkspaceId) {
      App.setTerminalSlots(state.activeWorkspaceId, App.getTerminalSlots(state.activeWorkspaceId).filter(id => id !== sessionId));
    }
    App.closeTerminal(sessionId);
    App.renderTerminalView();
  }

  App.reopenClosedTerminals = function reopenClosedTerminals() {
    state.closedTerminalSessionIds = new Set();
    App.ensureTerminalSlots(state.activeWorkspaceId);
    App.renderTerminalView();
  }

  App.bindTerminalGridDropZone = function bindTerminalGridDropZone(grid, targetIndex) {
    if (!grid) return;
    grid.ondragover = function(e) {
      e.preventDefault();
      grid.classList.add('terminal-grid-drop');
      e.dataTransfer.dropEffect = 'move';
    };
    grid.ondragleave = function(e) {
      if (e.target === grid) grid.classList.remove('terminal-grid-drop');
    };
    grid.ondrop = function(e) {
      e.preventDefault();
      grid.classList.remove('terminal-grid-drop');
      App.handleTerminalDrop(e.dataTransfer.getData('text/plain'), targetIndex);
    };
  }

  App.bindTerminalPaneDropZone = function bindTerminalPaneDropZone(paneEl, targetIndex) {
    if (!paneEl) return;
    paneEl.addEventListener('dragover', function(e) {
      e.preventDefault();
      paneEl.classList.add('drop-target');
      e.dataTransfer.dropEffect = 'move';
    });
    paneEl.addEventListener('dragleave', function() {
      paneEl.classList.remove('drop-target');
    });
    paneEl.addEventListener('drop', function(e) {
      e.preventDefault();
      paneEl.classList.remove('drop-target');
      App.handleTerminalDrop(e.dataTransfer.getData('text/plain'), targetIndex);
    });
  }

  App.createTerminal = function createTerminal(sessionId, container) {
    if (typeof Terminal === 'undefined') {
      container.textContent = 'xterm.js not loaded';
      container.style.cssText = 'padding:20px;color:var(--text-muted)';
      return;
    }

    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      theme: App.getTerminalTheme(),
      cursorBlink: true, scrollback: 5000, allowTransparency: true
    });

    let fitAddon = null;
    if (typeof FitAddon !== 'undefined') {
      fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
    }

    term.open(container);
    if (fitAddon) setTimeout(function() { fitAddon.fit(); }, 100);
    setTimeout(function() { term.focus(); }, 0);

    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = wsProto + '//' + location.host + '/ws/terminal?token=' + state.token + '&sessionId=' + sessionId + '&cols=' + term.cols + '&rows=' + term.rows;
    const ws = new WebSocket(wsUrl);
    const sendInput = function(data) {
      if (ws.readyState === WebSocket.OPEN && data) ws.send(data);
    };
    const focusTerminal = function() {
      try { term.focus(); } catch (e) { /* ignore */ }
    };
    const pasteFromClipboardEvent = function(e) {
      var text = e && e.clipboardData ? e.clipboardData.getData('text') : '';
      if (!text) return;
      e.preventDefault();
      sendInput(text);
      focusTerminal();
    };
    const onContainerClick = function() { focusTerminal(); };
    const onContainerPaste = function(e) { pasteFromClipboardEvent(e); };

    container.addEventListener('click', onContainerClick);
    container.addEventListener('paste', onContainerPaste);

    ws.onopen = function() {
      term.write('\r\n\x1b[90m[Connected to ' + sessionId + ']\x1b[0m\r\n');
      focusTerminal();
    };

    ws.onmessage = function(e) {
      if (typeof e.data === 'string') {
        try {
          var msg = JSON.parse(e.data);
          if (msg.type === 'exit') { term.write('\r\n\x1b[90m[Process exited: ' + msg.exitCode + ']\x1b[0m\r\n'); return; }
          if (msg.type === 'error') { term.write('\r\n\x1b[31m[Error: ' + msg.message + ']\x1b[0m\r\n'); return; }
        } catch (ex) { /* not JSON */ }
        term.write(e.data);
      }
    };

    ws.onerror = function() { term.write('\r\n\x1b[31m[WebSocket error]\x1b[0m\r\n'); };
    ws.onclose = function() { term.write('\r\n\x1b[90m[Disconnected]\x1b[0m\r\n'); };

    term.onData(function(data) {
      sendInput(data);
    });

    if (typeof term.attachCustomKeyEventHandler === 'function') {
      term.attachCustomKeyEventHandler(function(ev) {
        var isPasteShortcut = (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && String(ev.key || '').toLowerCase() === 'v';
        if (!isPasteShortcut) return true;
        if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
          navigator.clipboard.readText().then(function(text) {
            if (text) sendInput(text);
            focusTerminal();
          }).catch(function() {
            focusTerminal();
          });
        } else {
          focusTerminal();
        }
        ev.preventDefault();
        return false;
      });
    }

    term.onResize(function(size) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
      }
    });

    state.terminalPanes.push({
      sessionId: sessionId,
      term: term,
      ws: ws,
      fitAddon: fitAddon,
      cleanup: function() {
        container.removeEventListener('click', onContainerClick);
        container.removeEventListener('paste', onContainerPaste);
      }
    });

    window.addEventListener('resize', function() {
      if (fitAddon) setTimeout(function() { fitAddon.fit(); }, 50);
    });
  }

  App.closeAllTerminals = function closeAllTerminals() {
    for (var i = 0; i < state.terminalPanes.length; i++) {
      try { state.terminalPanes[i].ws.close(); } catch (e) { /* ignore */ }
      try { state.terminalPanes[i].term.dispose(); } catch (e) { /* ignore */ }
    }
    state.terminalPanes = [];
  }

  App.closeTerminal = function closeTerminal(sessionId) {
    if (!sessionId) return;
    state.terminalPanes = state.terminalPanes.filter(function(pane) {
      if (pane.sessionId !== sessionId) return true;
      try { if (pane.cleanup) pane.cleanup(); } catch (e) { /* ignore */ }
      try { pane.ws.close(); } catch (e) { /* ignore */ }
      try { pane.term.dispose(); } catch (e) { /* ignore */ }
      return false;
    });
  }

  // ============ COST DASHBOARD ============
  App.renderCostDashboard = async function renderCostDashboard() {
    var container = document.getElementById('cost-content');
    container.textContent = 'Loading cost data...';
    container.className = 'loading';
    container.style.cssText = 'padding:20px;color:var(--text-muted)';

    try {
      var data = await App.api('/cost/dashboard');
      var maxCost = Math.max.apply(null, Object.values(data.byAgent).map(function(a) { return a.cost; }).concat([0.01]));

      var html = '<div class="cost-cards"><div class="cost-card"><div class="cost-card-label">Total Spent</div><div class="cost-card-value">$' + data.totalCost.toFixed(2) + '</div><div class="cost-card-sub">' + App.formatTokens(data.totalTokens) + ' tokens</div></div>';

      Object.entries(data.byAgent).forEach(function(entry) {
        var agent = entry[0], info = entry[1];
        var meta = App.AGENT_META[agent] || { icon: '?', name: agent, color: '#888' };
        html += '<div class="cost-card"><div class="cost-card-label"><span class="agent-badge ' + agent + '" style="margin-right:4px">' + meta.icon + '</span>' + meta.name + '</div><div class="cost-card-value" style="color:' + meta.color + '">$' + info.cost.toFixed(2) + '</div><div class="cost-card-sub">' + App.formatTokens(info.tokens) + ' tokens</div></div>';
      });
      html += '</div>';

      html += '<h3 style="font-size:14px;margin-bottom:12px">By Agent</h3>';
      Object.entries(data.byAgent).forEach(function(entry) {
        var agent = entry[0], info = entry[1];
        var meta = App.AGENT_META[agent] || { name: agent, color: '#888' };
        var pct = (info.cost / maxCost) * 100;
        html += '<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:12px"><span>' + meta.name + '</span><span>$' + info.cost.toFixed(2) + '</span></div><div class="cost-bar"><div class="cost-bar-fill" style="width:' + pct + '%;background:' + meta.color + '"></div></div></div>';
      });

      if (Object.keys(data.byModel).length) {
        html += '<h3 style="font-size:14px;margin:20px 0 12px">By Model</h3>';
        html += '<table class="cost-table"><thead><tr><th>Model</th><th>Cost</th><th>Tokens</th></tr></thead><tbody>';
        var sortedModels = Object.entries(data.byModel).sort(function(a, b) { return b[1].cost - a[1].cost; });
        sortedModels.forEach(function(entry) {
          html += '<tr><td style="font-family:var(--font-mono);font-size:12px">' + App.esc(entry[0]) + '</td><td>$' + entry[1].cost.toFixed(4) + '</td><td>' + App.formatTokens(entry[1].tokens) + '</td></tr>';
        });
        html += '</tbody></table>';
      }

      if (data.topSessions && data.topSessions.length) {
        html += '<h3 style="font-size:14px;margin:20px 0 12px">Top Sessions by Cost</h3>';
        html += '<table class="cost-table"><thead><tr><th>Session</th><th>Agent</th><th>Cost</th><th>Tokens</th></tr></thead><tbody>';
        data.topSessions.forEach(function(s) {
          var meta = App.AGENT_META[s.agent] || { icon: '?' };
          html += '<tr><td>' + App.esc(s.name) + '</td><td><span class="agent-badge ' + s.agent + '">' + meta.icon + '</span></td><td>$' + s.cost.toFixed(4) + '</td><td>' + App.formatTokens(s.tokens) + '</td></tr>';
        });
        html += '</tbody></table>';
      }

      container.className = '';
      container.style.cssText = 'flex:1;overflow-y:auto;padding:16px';
      container.innerHTML = html;
    } catch (e) {
      container.className = '';
      container.style.cssText = 'padding:20px;color:var(--danger)';
      container.textContent = 'Failed to load costs: ' + e.message;
    }
  }

  // ============ SESSION HISTORY ============
  App.renderSessionHistory = function renderSessionHistory() {
    var container = document.getElementById('history-content');
    if (!state.allSessions.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128203;</div><div class="empty-state-text">No sessions found</div></div>';
      return;
    }

    var sorted = state.allSessions.slice().sort(function(a, b) { return b.updatedAt - a.updatedAt; });

    container.innerHTML = sorted.map(function(s) {
      var ws = state.workspaces.find(function(w) { return w.id === s.workspaceId; });
      var age = App.timeAgo(s.updatedAt);
      var meta = App.AGENT_META[s.agent] || { icon: '?' };
      return '<div class="session-row" data-id="' + s.id + '"><span class="session-status ' + s.status + '"></span><span class="agent-badge ' + s.agent + '">' + meta.icon + '</span><span class="session-name">' + App.esc(s.name) + '</span><span class="session-meta">' + (ws ? App.esc(ws.name) : 'Unassigned') + '</span><span class="session-meta">' + App.esc([s.model || '', s.effort ? ('effort:' + s.effort) : ''].filter(Boolean).join(' | ')) + '</span><span class="session-meta">' + age + '</span><button class="btn btn-sm" onclick="window._app.startSession(\'' + s.id + '\');event.stopPropagation()">&#9654;</button><button class="btn btn-sm" title="Restart Session" onclick="window._app.restartSession(\'' + s.id + '\');event.stopPropagation()">&#8635;</button><button class="btn btn-sm" title="Delete Session" onclick="window._app.deleteSession(\'' + s.id + '\');event.stopPropagation()">&#128465;</button></div>';
    }).join('');
  }

  // ============ DISCOVERY ============
  App.renderDiscovery = async function renderDiscovery() {
    var container = document.getElementById('discover-content');
    container.textContent = 'Click "Scan" to discover sessions...';
    container.className = 'loading';
    container.style.cssText = 'padding:20px;color:var(--text-muted)';
  }

  App.runDiscovery = async function runDiscovery() {
    var container = document.getElementById('discover-content');
    container.textContent = 'Scanning for sessions...';
    container.className = 'loading';

    try {
      var data = await App.api('/agents/discover', { method: 'POST' });
      var html = '<div style="margin-bottom:12px;font-size:13px;color:var(--text-secondary)">' + data.total + ' sessions found</div>';

      if (data.claude && data.claude.length) {
        html += '<h3 style="font-size:14px;margin-bottom:10px"><span class="agent-badge claude">C</span> Claude Code Sessions</h3>';
        data.claude.slice(0, 20).forEach(function(s) {
          html += '<div class="discover-item"><span class="agent-badge claude">C</span><div class="discover-item-info"><div class="discover-item-topic">' + App.esc(s.topic || s.resumeSessionId) + '</div><div class="discover-item-path">' + App.esc(s.projectPath || s.projectDir) + ' &middot; ' + App.timeAgo(s.lastActive) + '</div></div><button class="btn btn-sm btn-primary" onclick="window._app.importSession(\'claude\', ' + JSON.stringify(JSON.stringify(s)) + ')">Import</button></div>';
        });
      }

      if (data.codex && data.codex.length) {
        html += '<h3 style="font-size:14px;margin:16px 0 10px"><span class="agent-badge codex">X</span> Codex Sessions</h3>';
        data.codex.forEach(function(s) {
          html += '<div class="discover-item"><span class="agent-badge codex">X</span><div class="discover-item-info"><div class="discover-item-topic">' + App.esc(s.topic || 'Codex session') + '</div></div></div>';
        });
      }

      if (!data.total) {
        html = '<div class="empty-state"><div class="empty-state-icon">&#128269;</div><div class="empty-state-text">No sessions found. Make sure you have Claude Code or Codex CLI installed.</div></div>';
      }

      container.className = '';
      container.style.cssText = 'flex:1;overflow-y:auto;padding:16px';
      container.innerHTML = html;
    } catch (e) {
      container.className = '';
      container.style.cssText = 'padding:20px;color:var(--danger)';
      container.textContent = 'Discovery failed: ' + e.message;
    }
  }

  // ============ IDEAS VIEW ============
  // Note: innerHTML usage is safe here - all user content goes through App.esc() which uses textContent for sanitization

  App.loadIdeas = async function loadIdeas() {
    try { state.ideas = await App.api('/ideas'); } catch { state.ideas = []; }
  }

  App.renderIdeasView = async function renderIdeasView() {
    await App.loadIdeas();
    var summaryEl = document.getElementById('ideas-summary');
    var overviewEl = document.getElementById('ideas-overview');
    var detailEl = document.getElementById('idea-detail');
    var discBarEl = document.getElementById('ideas-discovery-bar');

    summaryEl.textContent = state.ideas.length + ' idea' + (state.ideas.length !== 1 ? 's' : '');

    // Discovery bar
    if (state.discoveryStatus && state.discoveryStatus.status === 'running') {
      discBarEl.className = 'discovery-bar';
      var p = state.discoveryStatus.progress || {};
      discBarEl.innerHTML = '<div class="spinner"></div><span>Discovering... ' + (p.completed || 0) + '/' + (p.total || 0) + ' providers, ' + (p.signals || 0) + ' signals</span>';
    } else {
      discBarEl.className = 'hidden';
      discBarEl.innerHTML = '';
    }

    // Bind header buttons
    document.getElementById('btn-start-discovery').onclick = App.startIdeaDiscovery;
    document.getElementById('btn-new-idea').onclick = App.showNewIdeaDialog;

    if (!state.ideas.length) {
      overviewEl.innerHTML = '<div class="empty-panel"><h3>No ideas yet</h3><p>Click "Discover" to find product opportunities from Reddit, DuckDuckGo and X, or add ideas manually.</p></div>';
      detailEl.innerHTML = '';
      return;
    }

    // Render cards
    var html = '';
    state.ideas.forEach(function(idea) {
      var scoreClass = idea.score >= 7 ? 'high' : idea.score >= 4 ? 'mid' : 'low';
      var isActive = idea.id === state.activeIdeaId;
      html += '<div class="idea-card' + (isActive ? ' active' : '') + '" data-idea-id="' + idea.id + '">';
      html += '<div class="idea-card-top">';
      html += '<div class="idea-card-name">' + App.esc(idea.title) + '</div>';
      html += '<div class="idea-card-score ' + scoreClass + '">' + (idea.score || 0) + '</div>';
      html += '</div>';
      html += '<div class="idea-card-summary">' + App.esc(idea.summary || idea.problem || '') + '</div>';
      html += '<div class="idea-card-footer">';
      html += '<span class="status-badge status-' + App.esc(idea.status) + '">' + App.esc(idea.status) + '</span>';
      if (idea.signals && idea.signals.length) {
        html += '<span style="font-size:11px;color:var(--text-muted)">' + idea.signals.length + ' signal' + (idea.signals.length > 1 ? 's' : '') + '</span>';
      }
      if (idea.opportunityType && idea.opportunityType !== 'other') {
        html += '<span style="font-size:11px;color:var(--text-muted)">' + App.esc(idea.opportunityType) + '</span>';
      }
      html += '</div></div>';
    });
    overviewEl.innerHTML = html;

    // Bind card clicks
    overviewEl.querySelectorAll('.idea-card').forEach(function(card) {
      card.addEventListener('click', function() {
        state.activeIdeaId = card.dataset.ideaId;
        App.renderIdeasView();
      });
    });

    // Render detail
    if (state.activeIdeaId) {
      App.renderIdeaDetail(detailEl);
    } else {
      detailEl.innerHTML = '<div class="empty-panel"><h3>Select an idea</h3><p>Click on an idea card to see details, signals, and scoring.</p></div>';
    }
  }

  App.renderIdeaDetail = function renderIdeaDetail(container) {
    var idea = state.ideas.find(function(i) { return i.id === state.activeIdeaId; });
    if (!idea) {
      container.innerHTML = '<div class="empty-panel"><h3>Idea not found</h3></div>';
      return;
    }

    var scoreClass = idea.score >= 7 ? 'high' : idea.score >= 4 ? 'mid' : 'low';
    var html = '<div class="idea-detail-header">';
    html += '<h2>' + App.esc(idea.title) + '</h2>';
    html += '<div style="display:flex;gap:8px;align-items:center;margin-top:6px">';
    html += '<span class="status-badge status-' + App.esc(idea.status) + '">' + App.esc(idea.status) + '</span>';
    html += '<span class="idea-card-score ' + scoreClass + '" style="width:32px;height:32px;font-size:13px">' + (idea.score || 0) + '</span>';
    html += '<span style="font-size:12px;color:var(--text-muted)">confidence: ' + ((idea.confidence || 0) * 100).toFixed(0) + '%</span>';
    html += '</div></div>';

    if (idea.problem) {
      html += '<div class="idea-detail-problem"><strong>Problem:</strong> ' + App.esc(idea.problem) + '</div>';
    }

    // Score dimensions
    var dims = idea._dimensions || {};
    var dimLabels = {
      painFrequency: 'Pain Frequency', painIntensity: 'Pain Intensity',
      useCaseClarity: 'Use Case Clarity', workaroundPresence: 'Workaround Presence',
      nichePotential: 'Niche Potential', productFit: 'Product Fit'
    };
    if (Object.keys(dims).length) {
      html += '<h3 style="font-size:13px;margin-top:16px">Score Breakdown</h3>';
      html += '<div class="idea-score-grid">';
      Object.entries(dimLabels).forEach(function(entry) {
        var key = entry[0], label = entry[1];
        var val = dims[key] || 0;
        html += '<div><div class="idea-score-dim"><span>' + App.esc(label) + '</span><span>' + val + '/10</span></div>';
        html += '<div class="idea-score-bar"><div class="idea-score-fill" style="width:' + (val * 10) + '%"></div></div></div>';
      });
      html += '</div>';
    }

    // Tags
    if (idea.tags && idea.tags.length) {
      html += '<div style="margin-top:10px">';
      idea.tags.forEach(function(tag) {
        html += '<span style="display:inline-block;padding:2px 8px;margin:2px;background:var(--bg-tertiary);border-radius:10px;font-size:11px">' + App.esc(tag) + '</span>';
      });
      html += '</div>';
    }

    // Sources
    if (idea.sources && idea.sources.length) {
      html += '<h3 style="font-size:13px;margin-top:16px">Sources</h3>';
      idea.sources.forEach(function(src) {
        html += '<div style="font-size:12px;margin:2px 0"><a href="' + App.esc(src.url) + '" target="_blank" rel="noopener" style="color:var(--accent)">' + App.esc(src.label || src.type) + '</a></div>';
      });
    }

    // Signals
    if (idea.signals && idea.signals.length) {
      html += '<h3 style="font-size:13px;margin-top:16px">Signals (' + idea.signals.length + ')</h3>';
      html += '<div class="idea-signals-list">';
      idea.signals.forEach(function(sig) {
        html += '<div class="idea-signal-row">';
        html += '<div><strong>' + App.esc(sig.rawTitle || 'Signal') + '</strong></div>';
        if (sig.rawText) html += '<div style="margin-top:4px">' + App.esc(sig.rawText.slice(0, 200)) + (sig.rawText.length > 200 ? '...' : '') + '</div>';
        html += '<div class="idea-signal-source">';
        html += App.esc(sig.sourceType) + ' - ' + App.esc(sig.sourceName || '');
        if (sig.authorHandle) html += ' - ' + App.esc(sig.authorHandle);
        if (sig.engagement && sig.engagement.score) html += ' - score: ' + sig.engagement.score;
        html += '</div></div>';
      });
      html += '</div>';
    }

    // Actions
    html += '<div class="idea-actions">';
    var transitions = { new: ['reviewing'], reviewing: ['approved', 'rejected'], approved: ['converted'], rejected: ['reviewing'] };
    var allowed = transitions[idea.status] || [];
    allowed.forEach(function(nextStatus) {
      if (nextStatus === 'converted') {
        html += '<button class="btn btn-sm btn-primary" onclick="window._app.convertIdea(\'' + App.esc(idea.id) + '\')">Convert to Product</button>';
      } else {
        var label = nextStatus === 'reviewing' ? 'Start Review' : nextStatus === 'approved' ? 'Approve' : nextStatus === 'rejected' ? 'Reject' : nextStatus;
        var cls = nextStatus === 'approved' ? 'btn-primary' : nextStatus === 'rejected' ? '' : 'btn-primary';
        html += '<button class="btn btn-sm ' + cls + '" onclick="window._app.updateIdeaStatus(\'' + App.esc(idea.id) + '\', \'' + App.esc(nextStatus) + '\')">' + App.esc(label) + '</button>';
      }
    });
    html += '<button class="btn btn-sm" style="margin-left:auto;color:var(--danger)" onclick="window._app.deleteIdea(\'' + App.esc(idea.id) + '\')">Delete</button>';
    html += '</div>';

    container.innerHTML = html;
  }

  App.startIdeaDiscovery = async function startIdeaDiscovery() {
    App.showDialog('Start Discovery',
      '<div style="margin-bottom:8px;font-size:13px">Enter a search query to discover product/automation opportunities from Reddit, DuckDuckGo, and X.</div>' +
      '<input type="text" id="discovery-query" placeholder="e.g. automation, dashboard, workflow" style="width:100%;padding:8px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:13px" value="automation">',
      [
        { label: 'Cancel' },
        { label: 'Discover', primary: true, action: async function() {
          var query = document.getElementById('discovery-query').value.trim() || 'automation';
          state.discoveryStatus = { status: 'running', progress: { total: 4, completed: 0, signals: 0 } };
          App.renderIdeasView();
          try {
            var run = await App.api('/ideas/discover', { method: 'POST', body: JSON.stringify({ query: query }) });
            state.discoveryStatus = run;
          } catch (e) {
            state.discoveryStatus = { status: 'error', error: e.message };
          }
          App.renderIdeasView();
        }}
      ]
    );
  }

  App.showNewIdeaDialog = function showNewIdeaDialog() {
    App.showDialog('New Idea',
      '<label style="font-size:12px;display:block;margin-bottom:4px">Title *</label>' +
      '<input type="text" id="new-idea-title" style="width:100%;padding:6px 8px;margin-bottom:8px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:13px">' +
      '<label style="font-size:12px;display:block;margin-bottom:4px">Problem</label>' +
      '<textarea id="new-idea-problem" rows="3" style="width:100%;padding:6px 8px;margin-bottom:8px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:13px;resize:vertical"></textarea>',
      [
        { label: 'Cancel' },
        { label: 'Create', primary: true, action: async function() {
          var title = document.getElementById('new-idea-title').value.trim();
          var problem = document.getElementById('new-idea-problem').value.trim();
          if (!title) return;
          try {
            await App.api('/ideas', { method: 'POST', body: JSON.stringify({ title: title, problem: problem }) });
            App.renderIdeasView();
          } catch (e) {
            console.error('Failed to create idea:', e);
          }
        }}
      ]
    );
  }

  App.updateIdeaStatus = async function updateIdeaStatus(id, status) {
    try {
      await App.api('/ideas/' + id + '/status', { method: 'PUT', body: JSON.stringify({ status: status }) });
      App.renderIdeasView();
    } catch (e) {
      console.error('Failed to update status:', e);
    }
  }

  App.deleteIdea = async function deleteIdea(id) {
    try {
      await App.api('/ideas/' + id, { method: 'DELETE' });
      if (state.activeIdeaId === id) state.activeIdeaId = null;
      App.renderIdeasView();
    } catch (e) {
      console.error('Failed to delete idea:', e);
    }
  }

  App.convertIdea = async function convertIdea(id) {
    var idea = state.ideas.find(function(i) { return i.id === id; });
    if (!idea) return;
    App.showDialog('Convert to Product',
      '<div style="margin-bottom:8px;font-size:13px">Convert "' + App.esc(idea.title) + '" into a Product.</div>' +
      '<label style="font-size:12px;display:block;margin-bottom:4px">Product Name</label>' +
      '<input type="text" id="convert-name" value="' + App.esc(idea.title) + '" style="width:100%;padding:6px 8px;margin-bottom:8px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:13px">' +
      '<label style="font-size:12px;display:block;margin-bottom:4px">Owner</label>' +
      '<input type="text" id="convert-owner" value="idea-discovery" style="width:100%;padding:6px 8px;margin-bottom:8px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:13px">',
      [
        { label: 'Cancel' },
        { label: 'Convert', primary: true, action: async function() {
          var name = document.getElementById('convert-name').value.trim();
          var owner = document.getElementById('convert-owner').value.trim();
          if (!name) return;
          try {
            await App.api('/ideas/' + id + '/convert', {
              method: 'POST',
              body: JSON.stringify({ name: name, owner: owner })
            });
            await App.loadProducts(true);
            App.renderIdeasView();
          } catch (e) {
            console.error('Failed to convert idea:', e);
          }
        }}
      ]
    );
  }

  // ============ DIRECTORY BROWSER ============
  App.showDirBrowser = function showDirBrowser(data, onSelect) {
    document.getElementById('dialog-title').textContent = 'Select Directory';

    function render(d) {
      var html = '<div style="margin-bottom:8px;padding:6px 10px;background:var(--bg-tertiary);border-radius:var(--radius-sm);font-size:12px;font-family:var(--font-mono);word-break:break-all">' + App.esc(d.path) + '</div>';
      html += '<div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-primary)">';

      if (d.parent) {
        html += '<div class="dir-item" data-path="' + App.esc(d.parent) + '" style="padding:6px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);color:var(--accent)">&#128193; ..</div>';
      }

      d.dirs.forEach(function(dir) {
        var fullPath = (d.path.endsWith('\\') || d.path.endsWith('/')) ? d.path + dir : d.path + '\\' + dir;
        html += '<div class="dir-item" data-path="' + App.esc(fullPath) + '" style="padding:6px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border)">&#128193; ' + App.esc(dir) + '</div>';
      });

      if (!d.dirs.length && !d.parent) {
        html += '<div style="padding:10px;color:var(--text-muted);font-size:12px">No subdirectories</div>';
      }
      html += '</div>';

      document.getElementById('dialog-body').innerHTML = html;
      document.getElementById('dialog-actions').innerHTML = '';

      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', function() { onSelect(d.path); });

      var selectBtn = document.createElement('button');
      selectBtn.className = 'btn btn-primary';
      selectBtn.textContent = 'Select This Folder';
      selectBtn.addEventListener('click', function() { onSelect(d.path); });

      document.getElementById('dialog-actions').appendChild(cancelBtn);
      document.getElementById('dialog-actions').appendChild(selectBtn);

      document.querySelectorAll('.dir-item').forEach(function(el) {
        el.addEventListener('click', async function() {
          try {
            var newData = await App.api('/browse?path=' + encodeURIComponent(el.dataset.path));
            render(newData);
          } catch (ex) { /* ignore */ }
        });
      });
    }

    render(data);
  }

  // ============ DIALOGS ============
  App.showDialog = function showDialog(title, bodyHTML, actions) {
    document.getElementById('dialog-title').textContent = title;
    document.getElementById('dialog-body').innerHTML = bodyHTML;
    var actionsEl = document.getElementById('dialog-actions');
    actionsEl.innerHTML = '';
    actions.forEach(function(action) {
      var btn = document.createElement('button');
      btn.className = 'btn ' + (action.primary ? 'btn-primary' : '');
      btn.textContent = action.label;
      btn.addEventListener('click', function() {
        App.hideDialog();
        action.onClick();
      });
      actionsEl.appendChild(btn);
    });
    document.getElementById('dialog-overlay').classList.remove('hidden');
  }

  App.hideDialog = function hideDialog() {
    document.getElementById('dialog-overlay').classList.add('hidden');
  }

  App.showWorkspaceContextMenu = function showWorkspaceContextMenu(x, y, workspaceId) {
    const menu = document.getElementById('context-menu');
    const workspace = state.workspaces.find(ws => ws.id === workspaceId);
    if (!menu || !workspace) return;

    menu.innerHTML =
      '<button class="context-menu-item" data-menu-action="edit">Edit runtime workspace</button>' +
      '<button class="context-menu-item" data-menu-action="session">New session</button>' +
      '<div class="context-menu-sep"></div>' +
      '<button class="context-menu-item" data-menu-action="delete">Delete runtime workspace</button>';

    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.remove('hidden');

    menu.querySelectorAll('[data-menu-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.menuAction;
        App.hideContextMenu();
        if (action === 'edit') return App.editWorkspace(workspaceId);
        if (action === 'session') {
          App.setActiveWorkspace(workspaceId);
          App.renderWorkspaceList();
          return App.newSession();
        }
        if (action === 'delete') return App.deleteWorkspace(workspaceId);
      });
    });

    const rect = menu.getBoundingClientRect();
    const overflowX = rect.right - window.innerWidth;
    const overflowY = rect.bottom - window.innerHeight;
    if (overflowX > 0) menu.style.left = Math.max(8, x - overflowX - 8) + 'px';
    if (overflowY > 0) menu.style.top = Math.max(8, y - overflowY - 8) + 'px';
  }

  App.hideContextMenu = function hideContextMenu() {
    const menu = document.getElementById('context-menu');
    if (!menu) return;
    menu.classList.add('hidden');
    menu.innerHTML = '';
    state.contextMenuWorkspaceId = null;
  }

  // ============ ACTIONS ============
  App.newWorkspace = function newWorkspace(draft) {
    const formState = Object.assign({
      name: '',
      description: '',
      workingDir: '',
      color: '#6366f1'
    }, draft || {});

    App.showDialog('New Runtime Workspace', '<label>Workspace Name</label><input type="text" id="dlg-ws-name" placeholder="ZapCam Runtime" value="' + App.esc(formState.name) + '"><label>Description</label><input type="text" id="dlg-ws-desc" placeholder="Optional execution context description" value="' + App.esc(formState.description) + '"><label>Working Directory</label><div style="display:flex;gap:6px"><input type="text" id="dlg-ws-dir" placeholder="C:\\Projects\\my-app" value="' + App.esc(formState.workingDir) + '" style="flex:1"><button class="btn btn-sm" id="dlg-ws-browse" type="button">&#128193;</button></div><label>Color</label><input type="color" id="dlg-ws-color" value="' + App.esc(formState.color) + '" style="height:36px;padding:2px">', [
      { label: 'Cancel', onClick: function() {} },
      { label: 'Create', primary: true, onClick: async function() {
        var name = document.getElementById('dlg-ws-name').value.trim();
        if (!name) return;
        await App.api('/workspaces', {
          method: 'POST',
          body: JSON.stringify({
            name: name,
            description: document.getElementById('dlg-ws-desc').value,
            workingDir: document.getElementById('dlg-ws-dir').value,
            color: document.getElementById('dlg-ws-color').value
          })
        });
        await App.loadData();
      }}
    ]);

    setTimeout(function() {
      var browseBtn = document.getElementById('dlg-ws-browse');
      if (browseBtn) {
        browseBtn.addEventListener('click', async function() {
          var nextDraft = {
            name: document.getElementById('dlg-ws-name').value,
            description: document.getElementById('dlg-ws-desc').value,
            workingDir: document.getElementById('dlg-ws-dir').value,
            color: document.getElementById('dlg-ws-color').value
          };
          var currentDir = nextDraft.workingDir || 'C:\\Users';
          try {
            var data = await App.api('/browse?path=' + encodeURIComponent(currentDir));
            App.showDirBrowser(data, function(selectedPath) {
              App.newWorkspace({
                name: nextDraft.name,
                description: nextDraft.description,
                workingDir: selectedPath,
                color: nextDraft.color
              });
            });
          } catch (e) { console.error(e); }
        });
      }
    }, 50);
  }

  App.editWorkspace = function editWorkspace(workspaceId, draft) {
    const ws = state.workspaces.find(w => w.id === workspaceId);
    if (!ws) return;
    const formState = Object.assign({
      name: ws.name,
      description: ws.description || '',
      workingDir: ws.workingDir || '',
      color: ws.color || '#6366f1'
    }, draft || {});

    App.showDialog('Edit Runtime Workspace', '<label>Workspace Name</label><input type="text" id="dlg-edit-ws-name" value="' + App.esc(formState.name) + '"><label>Description</label><input type="text" id="dlg-edit-ws-desc" value="' + App.esc(formState.description) + '"><label>Working Directory</label><div style="display:flex;gap:6px"><input type="text" id="dlg-edit-ws-dir" value="' + App.esc(formState.workingDir) + '" style="flex:1"><button class="btn btn-sm" id="dlg-edit-ws-browse" type="button">&#128193;</button></div><label>Color</label><input type="color" id="dlg-edit-ws-color" value="' + App.esc(formState.color) + '" style="height:36px;padding:2px">', [
      { label: 'Cancel', onClick: function() {} },
      { label: 'Save', primary: true, onClick: async function() {
        const name = document.getElementById('dlg-edit-ws-name').value.trim();
        if (!name) return;
        await App.api('/workspaces/' + workspaceId, {
          method: 'PUT',
          body: JSON.stringify({
            name: name,
            description: document.getElementById('dlg-edit-ws-desc').value,
            workingDir: document.getElementById('dlg-edit-ws-dir').value,
            color: document.getElementById('dlg-edit-ws-color').value
          })
        });
        await App.loadWorkspaces();
        await App.loadAllSessions();
        await App.loadProducts(true);
        App.renderWorkspaceList();
        App.renderCurrentView();
      }}
    ]);

    setTimeout(function() {
      var browseBtn = document.getElementById('dlg-edit-ws-browse');
      if (browseBtn) {
        browseBtn.addEventListener('click', async function() {
          var nextDraft = {
            name: document.getElementById('dlg-edit-ws-name').value,
            description: document.getElementById('dlg-edit-ws-desc').value,
            workingDir: document.getElementById('dlg-edit-ws-dir').value,
            color: document.getElementById('dlg-edit-ws-color').value
          };
          var currentDir = nextDraft.workingDir || 'C:\\Users';
          try {
            var data = await App.api('/browse?path=' + encodeURIComponent(currentDir));
            App.showDirBrowser(data, function(selectedPath) {
              App.editWorkspace(workspaceId, {
                name: nextDraft.name,
                description: nextDraft.description,
                workingDir: selectedPath,
                color: nextDraft.color
              });
            });
          } catch (e) { console.error(e); }
        });
      }
    }, 50);
  }

  App.deleteWorkspace = async function deleteWorkspace(workspaceId) {
    const ws = state.workspaces.find(w => w.id === workspaceId);
    if (!ws) return;
    if (!confirm('Delete runtime workspace "' + ws.name + '" and its sessions?')) return;
    try {
      await App.api('/workspaces/' + workspaceId, { method: 'DELETE' });
      if (state.activeWorkspaceId === workspaceId) App.setActiveWorkspace(null);
      await App.loadWorkspaces();
      await App.loadAllSessions();
      await App.loadProducts(true);
      App.renderWorkspaceList();
      App.renderCurrentView();
    } catch (e) {
      console.error('Failed to delete workspace:', e);
    }
  }

  App.newSession = function newSession() {
    if (!state.activeWorkspaceId) {
      App.showDialog('Select a Runtime Workspace', '<p style="font-size:13px">Please select a runtime workspace first.</p>', [
        { label: 'OK', primary: true, onClick: function() {} }
      ]);
      return;
    }

    var ws = state.workspaces.find(function(w) { return w.id === state.activeWorkspaceId; });
    var defaultAgent = 'claude';

    function buildModelOptions(agent) {
      var models = App.getAgentCatalog(agent).models || [];
      if (!models.length) return '<option value="">Default</option>';
      return models.map(function(m, i) { return '<option value="' + m.id + '"' + (i === 0 ? ' selected' : '') + '>' + App.esc(m.name) + '</option>'; }).join('');
    }

    var wsDir = (ws && ws.workingDir) ? ws.workingDir : '';

    App.showDialog('New Session', '<label>Session Name</label><input type="text" id="dlg-sess-name" placeholder="Feature X"><label>Agent</label><select id="dlg-sess-agent"><option value="claude">Claude Code</option><option value="codex">Codex CLI</option><option value="gemini">Gemini CLI</option></select><label>Model</label><select id="dlg-sess-model">' + buildModelOptions(defaultAgent) + '</select><div id="dlg-sess-effort-wrap"><label>Effort</label><select id="dlg-sess-effort">' + App.buildEffortOptionsFor(defaultAgent) + '</select></div><label>Working Directory</label><div style="display:flex;gap:6px"><input type="text" id="dlg-sess-dir" placeholder="' + (wsDir || 'Inherits from runtime workspace') + '" value="' + wsDir + '" style="flex:1"><button class="btn btn-sm" id="dlg-sess-browse" type="button">&#128193;</button></div><label>Resume Session ID (Claude only)</label><input type="text" id="dlg-sess-resume" placeholder="Optional: paste session UUID">', [
      { label: 'Cancel', onClick: function() {} },
      { label: 'Create', primary: true, onClick: async function() {
        var name = document.getElementById('dlg-sess-name').value.trim();
        if (!name) return;
        await App.api('/sessions', {
          method: 'POST',
          body: JSON.stringify({
            name: name,
            workspaceId: state.activeWorkspaceId,
            agent: document.getElementById('dlg-sess-agent').value,
            workingDir: document.getElementById('dlg-sess-dir').value,
            model: document.getElementById('dlg-sess-model').value,
            effort: document.getElementById('dlg-sess-effort').value,
            resumeSessionId: document.getElementById('dlg-sess-resume').value
          })
        });
        await App.loadAllSessions();
        await App.loadProducts(true);
        App.renderWorkspaceList();
        App.renderCurrentView();
      }}
    ]);

    setTimeout(function() {
      var agentSelect = document.getElementById('dlg-sess-agent');
      var modelSelect = document.getElementById('dlg-sess-model');
      if (agentSelect && modelSelect) {
        App.updateEffortField(defaultAgent, 'dlg-sess-effort', 'dlg-sess-effort-wrap');
        agentSelect.addEventListener('change', function() {
          modelSelect.innerHTML = buildModelOptions(agentSelect.value);
          App.updateEffortField(agentSelect.value, 'dlg-sess-effort', 'dlg-sess-effort-wrap');
        });
      }

      var browseBtn = document.getElementById('dlg-sess-browse');
      if (browseBtn) {
        browseBtn.addEventListener('click', async function() {
          var currentDir = document.getElementById('dlg-sess-dir').value || wsDir || 'C:\\Users';
          try {
            var browseData = await App.api('/browse?path=' + encodeURIComponent(currentDir));
            var origTitle = document.getElementById('dialog-title').textContent;
            var origBody = document.getElementById('dialog-body').innerHTML;

            App.showDirBrowser(browseData, function(selectedPath) {
              document.getElementById('dialog-title').textContent = origTitle;
              document.getElementById('dialog-body').innerHTML = origBody;
              document.getElementById('dlg-sess-dir').value = selectedPath;
              // Re-bind agent/model change
              var as = document.getElementById('dlg-sess-agent');
              var ms = document.getElementById('dlg-sess-model');
              if (as && ms) {
                as.addEventListener('change', function() { ms.innerHTML = buildModelOptions(as.value); });
              }
              // Re-bind actions
              var actionsEl = document.getElementById('dialog-actions');
              actionsEl.innerHTML = '';
              var cancelBtn = document.createElement('button');
              cancelBtn.className = 'btn';
              cancelBtn.textContent = 'Cancel';
              cancelBtn.addEventListener('click', App.hideDialog);
              var createBtn = document.createElement('button');
              createBtn.className = 'btn btn-primary';
              createBtn.textContent = 'Create';
              createBtn.addEventListener('click', async function() {
                App.hideDialog();
                var n = document.getElementById('dlg-sess-name').value.trim();
                if (!n) return;
                await App.api('/sessions', {
                  method: 'POST',
                  body: JSON.stringify({
                    name: n,
                    workspaceId: state.activeWorkspaceId,
                    agent: document.getElementById('dlg-sess-agent').value,
                    workingDir: document.getElementById('dlg-sess-dir').value,
                    model: document.getElementById('dlg-sess-model').value,
                    effort: document.getElementById('dlg-sess-effort').value,
                    resumeSessionId: document.getElementById('dlg-sess-resume').value
                  })
                });
                await App.loadAllSessions();
                await App.loadProducts(true);
                App.renderWorkspaceList();
                App.renderCurrentView();
              });
              actionsEl.appendChild(cancelBtn);
              actionsEl.appendChild(createBtn);
            });
          } catch (e) { console.error(e); }
        });
      }
    }, 50);
  }

  App.startSession = async function startSession(id) {
    try {
      const session = state.allSessions.find(s => s.id === id);
      if (!session) return;
      if (session.status === 'running') {
        state.closedTerminalSessionIds.delete(id);
        state.startingSessionIds.delete(id);
        if (session.workspaceId) App.setActiveWorkspace(session.workspaceId);
        App.addSessionToTerminalSlots(id);
        App.renderWorkspaceList();
        App.switchView('terminals');
        App.renderCurrentView();
        return;
      }
      state.closedTerminalSessionIds.delete(id);
      state.startingSessionIds.add(id);
      if (session.workspaceId) App.setActiveWorkspace(session.workspaceId);
      App.addSessionToTerminalSlots(id);
      if (App.needsRestartCooldown(session)) await App.wait(900);
      await App.api('/sessions/' + id + '/start', { method: 'POST' });
      await App.loadAllSessions();
      await App.loadProducts(true);
      state.startingSessionIds.delete(id);
      App.renderWorkspaceList();
      App.switchView('terminals');
      App.renderCurrentView();
    } catch (e) {
      state.startingSessionIds.delete(id);
      console.error('Failed to start session:', e);
    }
  }

  App.restartSession = async function restartSession(id) {
    try {
      const session = state.allSessions.find(s => s.id === id);
      if (!session) return;
      try {
        await App.api('/sessions/' + id + '/stop', { method: 'POST' });
      } catch (stopError) {
        console.warn('Stop before restart failed:', stopError);
      }
      state.closedTerminalSessionIds.delete(id);
      state.startingSessionIds.add(id);
      if (session.workspaceId) App.setActiveWorkspace(session.workspaceId);
      App.addSessionToTerminalSlots(id);
      await App.wait(1000);
      await App.api('/sessions/' + id + '/start', { method: 'POST' });
      await App.loadAllSessions();
      await App.loadProducts(true);
      state.startingSessionIds.delete(id);
      App.renderWorkspaceList();
      App.switchView('terminals');
      App.renderCurrentView();
    } catch (e) {
      state.startingSessionIds.delete(id);
      console.error('Failed to restart session:', e);
    }
  }

  App.stopSession = async function stopSession(id) {
    try {
      state.startingSessionIds.delete(id);
      await App.api('/sessions/' + id + '/stop', { method: 'POST' });
      await App.loadAllSessions();
      await App.loadProducts(true);
      App.renderWorkspaceList();
      App.renderCurrentView();
    } catch (e) {
      console.error('Failed to stop session:', e);
    }
  }

  App.stopAllWorkspaceSessions = async function stopAllWorkspaceSessions() {
    if (!state.activeWorkspaceId) return;
    const workspace = state.workspaces.find(w => w.id === state.activeWorkspaceId);
    const runningSessions = state.allSessions.filter(s => s.workspaceId === state.activeWorkspaceId && s.status === 'running');
    if (!runningSessions.length) return;
    if (!confirm('Stop all running sessions in runtime workspace "' + (workspace ? workspace.name : activeWorkspaceId) + '"?')) return;
    try {
      for (const session of runningSessions) {
        state.startingSessionIds.delete(session.id);
        await App.api('/sessions/' + session.id + '/stop', { method: 'POST' });
      }
      await App.loadAllSessions();
      await App.loadProducts(true);
      App.renderWorkspaceList();
      App.renderCurrentView();
    } catch (e) {
      console.error('Failed to stop all sessions:', e);
    }
  }

  App.deleteSession = async function deleteSession(id) {
    if (!confirm('Delete this session?')) return;
    try {
      state.startingSessionIds.delete(id);
      await App.api('/sessions/' + id, { method: 'DELETE' });
      await App.loadAllSessions();
      await App.loadProducts(true);
      App.renderWorkspaceList();
      App.renderCurrentView();
    } catch (e) {
      console.error('Failed to delete session:', e);
    }
  }

  App.importSession = async function importSession(agent, metadataStr) {
    var metadata = JSON.parse(metadataStr);
    if (!state.activeWorkspaceId) {
      App.showDialog('Select a Runtime Workspace', '<p style="font-size:13px">Please select a runtime workspace to import into.</p>', [
        { label: 'OK', primary: true, onClick: function() {} }
      ]);
      return;
    }

    await App.api('/sessions', {
      method: 'POST',
      body: JSON.stringify({
        name: metadata.topic || metadata.resumeSessionId || 'Imported session',
        workspaceId: state.activeWorkspaceId,
        agent: agent,
        workingDir: metadata.projectPath || '',
        resumeSessionId: metadata.resumeSessionId || ''
      })
    });
    await App.loadAllSessions();
    await App.loadProducts(true);
    App.renderWorkspaceList();
    App.renderCurrentView();
  }

  // ============ UTILITIES ============
  // XSS-safe text escaping using textContent
  App.esc = function esc(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  App.formatTokens = function formatTokens(n) {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
  }

  App.timeAgo = function timeAgo(ts) {
    if (!ts) return '';
    var diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
  }

  App.wait = function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  App.needsRestartCooldown = function needsRestartCooldown(session) {
    if (!session || !session.updatedAt) return false;
    return (Date.now() - session.updatedAt) < 2000;
  }

  // ============ EVENT BINDINGS ============
  App.init = function init() {
    document.getElementById('login-btn').addEventListener('click', function() {
      App.login(document.getElementById('login-password').value);
    });
    document.getElementById('login-password').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') App.login(e.target.value);
    });

    document.getElementById('btn-products').addEventListener('click', function() { App.switchView('products'); });
    document.getElementById('btn-terminals').addEventListener('click', function() { App.switchView('terminals'); });
    document.getElementById('btn-history').addEventListener('click', function() { App.switchView('history'); });
    document.getElementById('btn-cost-dashboard').addEventListener('click', function() { App.switchView('costs'); });
    document.getElementById('btn-discover').addEventListener('click', function() { App.switchView('discover'); });
    document.getElementById('btn-ideas').addEventListener('click', function() { App.switchView('ideas'); });
    document.getElementById('btn-new-product').addEventListener('click', function() { App.showProductWizard(); });
    document.getElementById('btn-new-workspace').addEventListener('click', App.newWorkspace);
    document.getElementById('btn-new-session').addEventListener('click', App.newSession);
    document.getElementById('btn-stop-all-sessions').addEventListener('click', App.stopAllWorkspaceSessions);
    document.getElementById('btn-run-discover').addEventListener('click', App.runDiscovery);

    document.getElementById('btn-layout-1').addEventListener('click', function() { state.gridLayout = 1; App.renderTerminalView(); });
    document.getElementById('btn-layout-2').addEventListener('click', function() { state.gridLayout = 2; App.renderTerminalView(); });
    document.getElementById('btn-layout-4').addEventListener('click', function() { state.gridLayout = 4; App.renderTerminalView(); });

    document.getElementById('agent-filter').addEventListener('change', function(e) {
      state.agentFilter = e.target.value;
      state.sessions = state.allSessions;
      if (state.activeWorkspaceId) state.sessions = state.sessions.filter(function(s) { return s.workspaceId === state.activeWorkspaceId; });
      if (state.agentFilter) state.sessions = state.sessions.filter(function(s) { return s.agent === state.agentFilter; });
      App.renderCurrentView();
    });
    document.getElementById('theme-select').addEventListener('change', async function(e) {
      const nextTheme = App.THEME_META[e.target.value] ? e.target.value : 'dark';
      state.settings = { ...state.settings, theme: nextTheme };
      App.applyTheme(nextTheme, false);
      try {
        await App.api('/settings', {
          method: 'PUT',
          body: JSON.stringify({ theme: nextTheme })
        });
      } catch (error) {
        console.warn('Failed to persist theme, keeping local selection:', error);
      }
      if (state.activeView !== 'terminals') App.renderCurrentView();
    });

    var searchTimeout;
    document.getElementById('search-input').addEventListener('input', function(e) {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(async function() {
        var q = e.target.value.trim();
        if (q) {
          try { state.allSessions = await App.api('/search?q=' + encodeURIComponent(q)); } catch (ex) { state.allSessions = []; }
          state.sessions = state.allSessions;
        } else {
          await App.loadAllSessions();
        }
        App.renderWorkspaceList();
        App.renderCurrentView();
      }, 300);
    });

    document.getElementById('dialog-overlay').addEventListener('click', function(e) {
      if (e.target === document.getElementById('dialog-overlay')) App.hideDialog();
    });
    document.addEventListener('click', function() { App.hideContextMenu(); });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') App.hideContextMenu(); });

    window._app = {
      newSession: App.newSession,
      startSession: App.startSession,
      restartSession: App.restartSession,
      stopSession: App.stopSession,
      stopAllWorkspaceSessions: App.stopAllWorkspaceSessions,
      closeTerminalPane: App.closeTerminalPane,
      reopenClosedTerminals: App.reopenClosedTerminals,
      deleteSession: App.deleteSession,
      importSession: App.importSession,
      editWorkspace: App.editWorkspace,
      deleteWorkspace: App.deleteWorkspace,
      showProductWizard: App.showProductWizard,
      startGuidedStage: App.startGuidedStage,
      registerHandoff: App.registerHandoff,
      updateIdeaStatus: App.updateIdeaStatus,
      deleteIdea: App.deleteIdea,
      convertIdea: App.convertIdea
    };

    App.updateViewButtons();

    if (state.token) {
      App.api('/health').then(function() {
        App.showApp();
        App.loadData();
        App.connectSSE();
      }).catch(App.showLogin);
    } else {
      App.showLogin();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', App.init);
  } else {
    App.init();
  }
})();
