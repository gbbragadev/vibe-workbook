/**
 * Vibe Workbook - Frontend SPA Controller
 * Manages: auth, workspace sidebar, terminal grid, cost dashboard, session history
 * Note: innerHTML usage is safe here - all user content goes through esc() which uses textContent for sanitization
 */
(function() {
  'use strict';

  // ============ STATE ============
  let token = localStorage.getItem('vibe_token') || '';
  let workspaces = [];
  let products = [];
  let productDetails = {};
  let allSessions = []; // ALL sessions (unfiltered, for sidebar counts)
  let sessions = [];    // Filtered sessions (for current view)
  let activeWorkspaceId = null;
  let activeProductId = null;
  let activeView = 'products';
  let gridLayout = 2;
  let terminalPanes = [];
  let closedTerminalSessionIds = new Set();
  let startingSessionIds = new Set();
  let terminalWorkspaceSlots = {};
  let agentFilter = '';
  let eventSource = null;
  let modelsByAgent = {}; // loaded from /api/models
  let contextMenuWorkspaceId = null;
  let settings = { theme: 'dark' };
  let currentTheme = 'dark';

  const AGENT_META = {
    claude: { name: 'Claude Code', icon: 'C', color: '#d97706' },
    codex: { name: 'Codex CLI', icon: 'X', color: '#10b981' },
    gemini: { name: 'Gemini CLI', icon: 'G', color: '#4285f4' },
    antigravity: { name: 'Antigravity', icon: 'A', color: '#9333ea' }
  };

  const STAGE_ORDER = ['idea', 'brief', 'spec', 'architecture', 'implementation', 'test', 'release'];
  const THEME_META = {
    dark: { name: 'Midnight Indigo' },
    teal: { name: 'Teal Signal' },
    ember: { name: 'Ember Ops' }
  };

  // ============ API ============
  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`/api${path}`, { ...opts, headers });
    if (res.status === 401) { showLogin(); throw new Error('Unauthorized'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('Request failed: ' + res.status));
    return data;
  }

  function applyTheme(themeId, persistSelect) {
    const nextTheme = THEME_META[themeId] ? themeId : 'dark';
    currentTheme = nextTheme;
    document.body.dataset.theme = nextTheme;
    const select = document.getElementById('theme-select');
    if (select && persistSelect !== false) select.value = nextTheme;
    if (select && persistSelect === false) select.value = nextTheme;
  }

  function getTerminalTheme() {
    if (currentTheme === 'teal') {
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
    if (currentTheme === 'ember') {
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
  function showLogin() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
  }

  function showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
  }

  async function login(password) {
    try {
      const data = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      }).then(r => r.json());

      if (data.token) {
        token = data.token;
        localStorage.setItem('vibe_token', token);
        showApp();
        await loadData();
        connectSSE();
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
  function connectSSE() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource(`/api/events?token=${token}`);
    eventSource.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        handleSSE(msg);
      } catch { /* ignore */ }
    };
    eventSource.onerror = () => {
      setTimeout(connectSSE, 5000);
    };
  }

  function handleSSE(msg) {
    const { type } = msg;
    if (type === 'workspace:created' || type === 'workspace:updated' || type === 'workspace:deleted') {
      loadWorkspaces().then(() => loadProducts(true)).then(renderCurrentView);
    }
    if (type === 'session:created' || type === 'session:updated' || type === 'session:deleted') {
      loadAllSessions().then(() => {
        return loadProducts(true);
      }).then(() => {
        renderWorkspaceList();
        renderCurrentView();
      });
    }
    if (type === 'settings:updated') {
      loadSettings().then(renderCurrentView);
    }
  }

  // ============ DATA LOADING ============
  async function loadData() {
    await Promise.all([loadSettings(), loadWorkspaces(), loadAllSessions(), loadModels(), loadProducts()]);
    updateStats();
    renderWorkspaceList();
    renderCurrentView();
  }

  async function loadSettings() {
    try {
      settings = await api('/settings');
    } catch {
      settings = { theme: 'dark' };
    }
    applyTheme(settings.theme || 'dark', false);
  }

  async function loadModels() {
    try { modelsByAgent = await api('/models'); } catch { modelsByAgent = {}; }
  }

  async function loadWorkspaces() {
    try { workspaces = await api('/workspaces'); } catch { workspaces = []; }
    renderWorkspaceList();
  }

  async function loadProducts(force = false) {
    if (force) productDetails = {};
    try { products = await api('/products'); } catch { products = []; }
    if (!activeProductId && products.length) activeProductId = products[0].product_id;
  }

  async function loadProductDetail(productId, force = false) {
    if (!productId) return null;
    if (force) delete productDetails[productId];
    if (!productDetails[productId]) {
      productDetails[productId] = await api('/products/' + encodeURIComponent(productId));
    }
    return productDetails[productId];
  }

  async function loadAllSessions() {
    try {
      allSessions = await api('/sessions');
    } catch { allSessions = []; }

    sessions = allSessions;
    if (activeWorkspaceId) sessions = sessions.filter(s => s.workspaceId === activeWorkspaceId);
    if (agentFilter) sessions = sessions.filter(s => s.agent === agentFilter);

    updateStats();
  }

  function updateStats() {
    const running = allSessions.filter(s => s.status === 'running').length;
    const total = allSessions.length;
    const el = document.getElementById('header-stats');
    el.textContent = `${running} running / ${total} total`;
  }

  // ============ WORKSPACE SIDEBAR ============
  // All dynamic content is sanitized through esc() which uses textContent-based escaping
  function renderWorkspaceList() {
    const container = document.getElementById('workspace-list');
    if (!workspaces.length) {
      container.innerHTML = '<div style="padding: 20px 14px; color: var(--text-muted); font-size: 13px; text-align: center;">No runtime workspaces yet<br><small>Click &quot;+ Workspace&quot; to create one</small></div>';
      return;
    }

    container.innerHTML = workspaces.map(ws => {
      const isActive = ws.id === activeWorkspaceId;
      const wsSessions = allSessions.filter(s => s.workspaceId === ws.id);
      const runningCount = wsSessions.filter(s => s.status === 'running').length;
      const agents = [...new Set(wsSessions.map(s => s.agent))];

      let html = '<div class="ws-item ' + (isActive ? 'active' : '') + '" data-id="' + ws.id + '" draggable="true">';
      html += '<div class="ws-item-name">';
      html += '<span class="ws-color" style="background:' + ws.color + '"></span>';
      html += esc(ws.name);
      html += agents.map(a => '<span class="agent-badge ' + a + '" title="' + (AGENT_META[a] ? AGENT_META[a].name : a) + '">' + (AGENT_META[a] ? AGENT_META[a].icon : '?') + '</span>').join('');
      html += '</div>';
      html += '<div class="ws-item-meta"><span>' + wsSessions.length + ' sessions</span>';
      if (runningCount) html += '<span style="color:var(--success)">' + runningCount + ' running</span>';
      html += '</div>';

      // Show sessions expanded under active runtime workspace
      if (isActive && wsSessions.length) {
        html += '<div class="ws-sessions">';
        for (const s of wsSessions) {
          const statusClass = s.status === 'running' ? 'running' : (s.status === 'error' ? 'error' : 'stopped');
          html += '<div class="ws-session-item" data-sess-id="' + s.id + '" draggable="true">';
          html += '<span class="session-status ' + statusClass + '"></span>';
          html += '<span class="agent-badge ' + s.agent + '" style="width:14px;height:14px;font-size:8px">' + (AGENT_META[s.agent] ? AGENT_META[s.agent].icon : '?') + '</span>';
          html += '<span class="ws-session-name">' + esc(s.name) + '</span>';
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
        hideContextMenu();
        setActiveWorkspace(el.dataset.id);
        renderWorkspaceList();
        renderCurrentView();
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        contextMenuWorkspaceId = el.dataset.id;
        setActiveWorkspace(el.dataset.id);
        renderWorkspaceList();
        showWorkspaceContextMenu(e.clientX, e.clientY, el.dataset.id);
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
        addSessionToTerminalSlots(el.dataset.sessId);
        switchView('terminals');
      });
      el.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'session', sessionId: el.dataset.sessId }));
        e.dataTransfer.effectAllowed = 'move';
      });
    });
  }

  // ============ VIEW SWITCHING ============
  function switchView(view) {
    activeView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + view).classList.add('active');
    updateViewButtons();
    renderCurrentView();
  }

  function updateViewButtons() {
    const buttonMap = {
      products: document.getElementById('btn-products'),
      terminals: document.getElementById('btn-terminals'),
      history: document.getElementById('btn-history'),
      discover: document.getElementById('btn-discover'),
      costs: document.getElementById('btn-cost-dashboard')
    };
    Object.entries(buttonMap).forEach(([key, btn]) => {
      if (!btn) return;
      btn.classList.toggle('btn-primary', key === activeView);
    });
  }

  function renderCurrentView() {
    switch (activeView) {
      case 'products': renderProductsView(); break;
      case 'terminals': renderTerminalView(); break;
      case 'costs': renderCostDashboard(); break;
      case 'history': renderSessionHistory(); break;
      case 'discover': renderDiscovery(); break;
    }
  }

  function setActiveWorkspace(workspaceId) {
    if (activeWorkspaceId !== workspaceId) {
      closedTerminalSessionIds = new Set();
    }
    activeWorkspaceId = workspaceId || null;
    ensureTerminalSlots(activeWorkspaceId);
    sessions = allSessions;
    if (activeWorkspaceId) sessions = sessions.filter(s => s.workspaceId === activeWorkspaceId);
    if (agentFilter) sessions = sessions.filter(s => s.agent === agentFilter);
    document.getElementById('active-workspace-name').textContent =
      (workspaces.find(w => w.id === activeWorkspaceId) || {}).name || 'Select a runtime workspace';
  }

  function getWorkspaceSessions(workspaceId) {
    return workspaceId ? allSessions.filter(s => s.workspaceId === workspaceId) : [];
  }

  function ensureTerminalSlots(workspaceId) {
    if (!workspaceId) return [];
    const workspaceSessions = getWorkspaceSessions(workspaceId);
    const availableIds = workspaceSessions
      .filter(s => !closedTerminalSessionIds.has(s.id))
      .map(s => s.id);
    const current = Array.isArray(terminalWorkspaceSlots[workspaceId]) ? terminalWorkspaceSlots[workspaceId].slice(0, 4) : [];
    const normalized = current.filter(id => availableIds.includes(id));
    for (const sessionId of availableIds) {
      if (normalized.length >= 4) break;
      if (!normalized.includes(sessionId)) normalized.push(sessionId);
    }
    terminalWorkspaceSlots[workspaceId] = normalized.slice(0, 4);
    return terminalWorkspaceSlots[workspaceId];
  }

  function getTerminalSlots(workspaceId) {
    if (!workspaceId) return [];
    return ensureTerminalSlots(workspaceId).slice();
  }

  function setTerminalSlots(workspaceId, slots) {
    if (!workspaceId) return;
    terminalWorkspaceSlots[workspaceId] = (slots || []).filter(Boolean).slice(0, 4);
  }

  function addSessionToTerminalSlots(sessionId, targetIndex = null) {
    const session = allSessions.find(s => s.id === sessionId);
    if (!session || !session.workspaceId) return false;
    if (activeWorkspaceId !== session.workspaceId) setActiveWorkspace(session.workspaceId);
    closedTerminalSessionIds.delete(sessionId);
    const workspaceId = session.workspaceId;
    const slots = getTerminalSlots(workspaceId).filter(id => id !== sessionId);
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
    setTerminalSlots(workspaceId, slots.filter(Boolean));
    return true;
  }

  function handleTerminalDrop(rawData, targetIndex = null) {
    if (!rawData) return;
    let payload = null;
    try { payload = JSON.parse(rawData); } catch { return; }
    if (!payload || !payload.type) return;
    if (payload.type === 'workspace' && payload.workspaceId) {
      setActiveWorkspace(payload.workspaceId);
      switchView('terminals');
      return;
    }
    if (payload.type === 'session' && payload.sessionId) {
      addSessionToTerminalSlots(payload.sessionId, targetIndex);
      switchView('terminals');
      renderWorkspaceList();
      renderCurrentView();
    }
  }

  function setActiveProduct(productId) {
    activeProductId = productId;
    const product = products.find(p => p.product_id === productId);
    if (product && product.workspace && product.workspace.runtime_workspace_id) {
      setActiveWorkspace(product.workspace.runtime_workspace_id);
      renderWorkspaceList();
    }
    renderCurrentView();
  }

  function resolveOverviewPrimaryAction(product) {
    const currentRun = resolveCurrentRun(product);
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

  function buildOverviewPrimaryActionButton(product, action) {
    if (!action) return '';
    if (action.action === 'execute-next-action') {
      return '<button class="btn btn-primary btn-cta" data-product-card-action="execute-next-action" data-product-id="' + esc(product.product_id) + '" data-action-id="' + esc(action.actionId || '') + '" data-stage-id="' + esc(action.stageId || '') + '">' + esc(action.label) + '</button>';
    }
    if (action.action === 'start-stage') {
      return '<button class="btn btn-primary btn-cta" data-product-card-action="start-stage" data-product-id="' + esc(product.product_id) + '" data-stage-id="' + esc(action.stageId || '') + '">' + esc(action.label) + '</button>';
    }
    if (action.action === 'complete-stage') {
      return '<button class="btn btn-primary btn-cta" data-product-card-action="complete-stage" data-product-id="' + esc(product.product_id) + '" data-stage-id="' + esc(action.stageId || '') + '">' + esc(action.label) + '</button>';
    }
    return '<button class="btn btn-cta" data-product-card-action="open-detail" data-product-id="' + esc(product.product_id) + '">' + esc(action.label) + '</button>';
  }

  async function handleOverviewPrimaryAction(actionEl) {
    const productId = actionEl.dataset.productId;
    const actionType = actionEl.dataset.productCardAction;
    if (!productId) return;
    if (actionType === 'execute-next-action') {
      await executeNextAction(productId, { id: actionEl.dataset.actionId, step_id: actionEl.dataset.stageId });
      return;
    }
    if (actionType === 'start-stage') {
      await startGuidedStage(productId, actionEl.dataset.stageId);
      return;
    }
    if (actionType === 'complete-stage') {
      await registerHandoff(productId, actionEl.dataset.stageId);
      return;
    }
    setActiveProduct(productId);
  }

  async function renderProductsView() {
    const overview = document.getElementById('products-overview');
    const summary = document.getElementById('products-summary');
    const detail = document.getElementById('product-detail');

    if (!products.length) {
      summary.textContent = 'No products registered.';
      overview.innerHTML = '<div class="empty-panel"><h3>No products</h3><p class="empty-subtext">Registry data is unavailable.</p></div>';
      detail.innerHTML = '<div class="empty-panel"><h3>Product detail</h3><p class="empty-subtext">Select a product when the catalog is available.</p></div>';
      return;
    }

    if (!activeProductId || !products.find(p => p.product_id === activeProductId)) activeProductId = products[0].product_id;

    summary.textContent = products.length + ' registered products';
    overview.innerHTML = products.map(product => {
      const artifact = product.artifact_summary || { present: 0, total: 0 };
      const nextAction = (product.next_actions || [])[0];
      const knowledgeSummary = product.knowledge_summary || { active_packs: 0, active_pack_names: [] };
      const currentRun = resolveCurrentRun(product);
      const primaryAction = resolveOverviewPrimaryAction(product);
      const productStatus = (product.pipeline || []).some(step => step.status === 'in-progress')
        ? 'in-progress'
        : ((product.pipeline || []).some(step => step.status === 'ready') ? 'ready' : 'not-started');
      const stageLabel = currentRun ? (currentRun.stage_label || currentRun.stage_id || 'active run') : (product.current_stage_id || product.computed_stage_signal || product.declared_stage || 'idea');
      const readinessLabel = (product.readiness && product.readiness.status) ? String(product.readiness.status).replace(/-/g, ' ') : 'not assessed';
      const workspaceWarning = (product.workspace || {}).path_status && (product.workspace || {}).path_status !== 'valid'
        ? '<span class="chip warn">runtime workspace needs attention</span>'
        : '';
      return '<article class="product-card ' + (product.product_id === activeProductId ? 'active' : '') + '" data-product-id="' + product.product_id + '">' +
        '<div class="product-card-top"><div><div class="product-card-name">' + esc(product.name) + '</div>' +
        '<div class="chip-row" style="margin-top:6px"><span class="chip">' + esc(product.category) + '</span><span class="chip subtle">stage: ' + esc(stageLabel) + '</span>' + workspaceWarning + '</div></div>' +
        '<span class="status-pill ' + productStatus + '">' + stageStatusLabel(productStatus) + '</span></div>' +
        '<div class="product-card-summary">' + esc(product.summary || 'No product summary available.') + '</div>' +
        '<div class="product-card-stats"><div class="product-stat"><div class="product-stat-label">Artifacts</div><div class="product-stat-value">' + artifact.present + '/' + artifact.total + '</div></div><div class="product-stat"><div class="product-stat-label">Sessions</div><div class="product-stat-value">' + ((product.related_sessions || []).length) + '</div></div><div class="product-stat"><div class="product-stat-label">Readiness</div><div class="product-stat-value">' + esc(readinessLabel) + '</div></div><div class="product-stat"><div class="product-stat-label">Knowledge</div><div class="product-stat-value">' + esc(String(knowledgeSummary.active_packs || 0)) + '</div></div></div>' +
        '<div class="chip-row knowledge-chip-row" style="margin-top:10px">' + buildKnowledgePackChips(product.active_knowledge_packs || [], true) + '</div>' +
        (currentRun ? '<div class="product-card-run"><span class="product-card-run-label">Current run</span><strong>' + esc(currentRun.stage_label || currentRun.stage_id || currentRun.status || 'active') + '</strong><span class="artifact-row-meta">' + esc(currentRun.objective || 'Coordinated execution in progress.') + '</span></div>' : '') +
        '<div class="product-card-footer"><div><div class="product-card-next-label">Recommended next move</div><div class="artifact-row-meta" style="margin-top:4px">' + esc(primaryAction ? primaryAction.description : (nextAction ? nextAction.label : 'Review the product detail to decide the next move.')) + '</div></div><div class="product-card-footer-actions">' + buildOverviewPrimaryActionButton(product, primaryAction) + '</div></div>' +
        '</article>';
    }).join('');

    overview.querySelectorAll('.product-card').forEach(card => {
      card.addEventListener('click', () => setActiveProduct(card.dataset.productId));
    });
    overview.querySelectorAll('[data-product-card-action]').forEach(button => {
      button.addEventListener('click', async function(event) {
        event.stopPropagation();
        await handleOverviewPrimaryAction(button);
      });
    });

    detail.innerHTML = '<div class="empty-panel"><h3>Loading product</h3><p class="empty-subtext">Preparing detail...</p></div>';
    try {
      const data = await loadProductDetail(activeProductId);
      if (data.product_id !== activeProductId) return;
      detail.innerHTML = buildProductDetailHtml(data);
      bindProductDetailActions(data);
    } catch (e) {
      detail.innerHTML = '<div class="empty-panel"><h3>Failed to load product</h3><p class="empty-subtext">' + esc(e.message) + '</p></div>';
    }
  }

  function buildReadinessPanel(detail) {
    var readiness = detail.readiness;
    if (!readiness) return '';
    var releasePacket = detail.release_packet || {};
    var statusClass = readiness.status === 'ready-for-release-candidate' ? 'readiness-ready' : readiness.status === 'needs-evidence' ? 'readiness-needs-evidence' : 'readiness-not-ready';
    var signalsHtml = (readiness.signals || []).map(function(s) {
      var strength = s.strength || 'none';
      var dots = strength === 'strong' ? '●●●' : strength === 'sufficient' ? '●●' : strength === 'weak' ? '●' : '';
      var strengthBadge = dots ? '<span class="signal-strength ' + strength + '" title="Signal strength: ' + strength + '">' + dots + '</span>' : '';
      return '<div class="readiness-signal-row ' + (s.met ? 'met' : 'unmet') + '">' + (s.met ? '&#10003;' : '&#10007;') + ' ' + esc(s.label) + strengthBadge + '</div>';
    }).join('');
    var gapsHtml = (readiness.gaps || []).length
      ? '<div class="chip-row" style="margin-top:10px">' + readiness.gaps.map(function(g) { return '<span class="chip ' + (g.severity === 'required' ? 'warn' : 'subtle') + '">' + esc(g.label) + '</span>'; }).join('') + '</div>'
      : '';
    var keyArtifactsHtml = (releasePacket.key_artifacts || []).map(function(a) {
      return '<span class="artifact-chip ' + (a.exists ? 'exists' : 'missing') + '">' + esc(a.label) + ': ' + (a.exists ? 'present' : 'missing') + '</span>';
    }).join('');
    return '<section class="detail-panel"><div class="panel-header"><h3>Release Readiness</h3><span class="status-pill ' + esc(statusClass) + '">' + esc(readiness.label) + '</span></div><div class="panel-body">' +
      '<div class="summary-callout ' + statusClass + '"><strong>' + esc(readiness.label) + '</strong><p style="margin-top:6px;font-size:13px;color:var(--text-secondary)">' + esc(readiness.summary || '') + '</p></div>' +
      '<div class="readiness-signals">' + signalsHtml + '</div>' +
      gapsHtml +
      (keyArtifactsHtml ? '<div style="margin-top:12px"><span class="meta-item-label">Key Artifacts</span><div class="chip-row" style="margin-top:6px">' + keyArtifactsHtml + '</div></div>' : '') +
      (releasePacket.next_release_step ? '<div class="summary-callout" style="margin-top:12px"><span class="meta-item-label">Next Release Step</span><p style="margin-top:6px;font-size:13px">' + esc(releasePacket.next_release_step) + '</p></div>' : '') +
      '</div></section>';
  }

  function formatConfidence(value) {
    var num = Number(value || 0);
    if (!isFinite(num) || num <= 0) return 'low';
    if (num >= 0.85) return 'high';
    if (num >= 0.7) return 'medium';
    return 'low';
  }

  function buildCopilotStateChip(state) {
    var normalized = String(state || '').toLowerCase();
    var chipClass = normalized === 'accepted' ? 'ok' : normalized === 'candidate' ? 'warn' : normalized === 'blocked' ? '' : 'subtle';
    return '<span class="chip ' + chipClass + '">' + esc(normalized || 'unknown') + '</span>';
  }

  function buildCopilotPanel(detail) {
    var copilot = detail.copilot;
    if (!copilot) return '';
    var blockers = ((copilot.current_state || {}).blockers || []).slice(0, 3);
    var createdAssets = (copilot.created_assets || []).slice(0, 6);
    var candidates = (copilot.candidate_artifacts || []).slice(0, 6);
    var decisions = (copilot.decision_log || []).slice(0, 6);
    var recommendation = copilot.recommended_next_move || null;
    var primaryAction = resolvePrimaryProductAction(detail);
    var delivery = copilot.delivery_readiness || { blocking_reasons: [] };
    var state = copilot.current_state || {};

    var blockersHtml = blockers.length
      ? '<div class="chip-row" style="margin-top:10px">' + blockers.map(function(item) {
          return '<span class="chip ' + (item.state === 'missing' || item.state === 'blocked' ? 'warn' : 'subtle') + '">' + esc(item.label) + '</span>';
        }).join('') + '</div>'
      : '<div class="artifact-row-meta" style="margin-top:10px">No critical blockers surfaced by the copilot.</div>';

    var createdHtml = createdAssets.length
      ? '<div class="copilot-list">' + createdAssets.map(function(item) {
          return '<div class="copilot-row"><div><strong>' + esc(item.label || item.relative_path || item.path) + '</strong><div class="artifact-row-meta mono" style="margin-top:6px">' + esc(item.relative_path || item.path || '') + '</div></div><div class="chip-row">' + buildCopilotStateChip(item.status) + (item.stage ? '<span class="chip subtle">' + esc(item.stage) + '</span>' : '') + '</div></div>';
        }).join('') + '</div>'
      : '<p class="empty-subtext">No concrete created assets registered yet.</p>';

    var candidatesHtml = candidates.length
      ? '<div class="copilot-list">' + candidates.map(function(item) {
          var actionButtons = item.accepted === null
            ? '<button class="btn btn-sm btn-primary" data-copilot-action="accept-candidate" data-candidate-id="' + esc(item.candidate_id) + '">Accept</button><button class="btn btn-sm" data-copilot-action="reject-candidate" data-candidate-id="' + esc(item.candidate_id) + '">Reject</button>'
            : '<button class="btn btn-sm" data-copilot-action="review-candidate" data-candidate-id="' + esc(item.candidate_id) + '">Change</button>';
          return '<div class="copilot-row"><div><strong>' + esc(item.kind_guess || item.relative_path) + '</strong><div class="artifact-row-meta mono" style="margin-top:6px">' + esc(item.relative_path || item.path || '') + '</div><div class="artifact-row-meta" style="margin-top:6px">' + esc(item.reason || '') + '</div></div><div class="copilot-row-actions"><div class="chip-row">' + buildCopilotStateChip(item.state) + (item.mapped_stage ? '<span class="chip subtle">' + esc(item.mapped_stage) + '</span>' : '') + '<span class="chip subtle">' + esc(formatConfidence(item.confidence)) + ' confidence</span></div><div class="chip-row" style="margin-top:8px">' + actionButtons + '</div></div></div>';
        }).join('') + '</div>'
      : '<p class="empty-subtext">No artifact candidates need review right now.</p>';

    var decisionsHtml = decisions.length
      ? '<div class="copilot-list">' + decisions.map(function(item) {
          return '<div class="copilot-row"><div><strong>' + esc(item.title || 'Untitled decision') + '</strong><div class="artifact-row-meta" style="margin-top:6px">' + esc(item.note || 'No extra note recorded.') + '</div><div class="artifact-row-meta" style="margin-top:6px">' + esc(item.linked_stage || 'no linked stage') + (item.linked_artifacts && item.linked_artifacts.length ? ' | ' + esc(item.linked_artifacts.join(', ')) : '') + '</div></div><div class="copilot-row-actions"><div class="chip-row">' + buildCopilotStateChip(item.status) + '</div><div class="chip-row" style="margin-top:8px"><button class="btn btn-sm" data-copilot-action="' + (item.status === 'resolved' ? 'reopen-decision' : 'resolve-decision') + '" data-decision-id="' + esc(item.decision_id) + '">' + (item.status === 'resolved' ? 'Reopen' : 'Resolve') + '</button></div></div></div>';
        }).join('') + '</div>'
      : '<p class="empty-subtext">No decision memory recorded yet.</p>';

    var recommendationHtml = recommendation
      ? '<div class="summary-callout"><div class="product-row"><strong>' + esc(recommendation.action_type || 'next-move') + '</strong><span class="artifact-row-meta">' + esc(formatConfidence(recommendation.confidence)) + ' confidence</span></div><p style="margin-top:8px">' + esc(recommendation.reason || '') + '</p><div class="chip-row" style="margin-top:10px"><span class="chip subtle">' + esc(recommendation.execution_mode_hint || 'plan-mode') + '</span>' + (recommendation.stage_hint ? '<span class="chip subtle">' + esc(recommendation.stage_hint) + '</span>' : '') + (recommendation.skills_hint ? '<span class="chip subtle">' + esc(recommendation.skills_hint) + '</span>' : '') + '</div>' + (primaryAction ? '<div class="product-detail-actions" style="margin-top:12px">' + buildPrimaryActionButton(primaryAction, 'btn btn-primary btn-cta', primaryAction.label) + '</div>' : '') + '</div>'
      : '<p class="empty-subtext">No recommendation available yet.</p>';

    var readinessHtml = '<div class="chip-row" style="margin-top:10px">' +
      '<span class="chip ' + (delivery.ready_for_test ? 'ok' : 'warn') + '">test: ' + esc(delivery.ready_for_test ? 'ready' : 'not ready') + '</span>' +
      '<span class="chip ' + (delivery.ready_for_test_deploy ? 'ok' : 'warn') + '">test deploy: ' + esc(delivery.ready_for_test_deploy ? 'ready' : 'not ready') + '</span>' +
      '<span class="chip ' + (delivery.ready_for_production ? 'ok' : 'warn') + '">production: ' + esc(delivery.ready_for_production ? 'ready' : 'not ready') + '</span>' +
      '</div>' +
      ((delivery.blocking_reasons || []).length ? '<div class="chip-row" style="margin-top:10px">' + delivery.blocking_reasons.slice(0, 3).map(function(item) {
        return '<span class="chip warn">' + esc(item) + '</span>';
      }).join('') + '</div>' : '');

    return '<section class="detail-panel"><div class="panel-header"><h3>Project Copilot</h3><span class="artifact-row-meta">semantic project guidance</span></div><div class="panel-body">' +
      '<div class="summary-callout"><strong>Project State</strong><p style="margin-top:6px;font-size:13px;color:var(--text-secondary)">' + esc(copilot.summary || state.summary || 'No copilot summary available.') + '</p><div class="meta-list" style="margin-top:10px">' +
      metaItem('Created Assets', String(state.created_assets_total || createdAssets.length || 0)) +
      metaItem('Candidates', String(state.candidate_artifacts_total || candidates.length || 0)) +
      metaItem('Open Decisions', String(state.open_decisions_total || 0)) +
      '</div>' + blockersHtml + '</div>' +
      '<div class="detail-grid"><section class="run-card"><div class="product-row"><span class="meta-item-label">Created / Candidate Artifacts</span><div class="chip-row"><button class="btn btn-sm" data-copilot-action="refresh">Refresh</button></div></div><div style="margin-top:10px">' + createdHtml + '</div><div style="margin-top:12px"><div class="meta-item-label">Artifact candidates</div>' + candidatesHtml + '</div></section>' +
      '<section class="run-card"><div class="product-row"><span class="meta-item-label">Decisions & Open Issues</span><div class="chip-row"><button class="btn btn-sm btn-primary" data-copilot-action="add-decision">Add decision</button></div></div><div style="margin-top:10px">' + decisionsHtml + '</div></section></div>' +
      '<div class="detail-grid" style="margin-top:12px"><section class="run-card"><span class="meta-item-label">Recommended Next Move</span><div style="margin-top:10px">' + recommendationHtml + '</div></section><section class="run-card"><span class="meta-item-label">Delivery Readiness</span><div style="margin-top:10px">' + readinessHtml + '</div></section></div>' +
      '</div></section>';
  }

  function resolvePrimaryProductAction(detail) {
    const currentRun = resolveCurrentRun(detail);
    const nextAction = (detail.next_actions || []).find(item => item && item.executable !== false && (item.step_id || item.stage_id));
    const primarySession = currentRun ? pickPrimaryRunSession(currentRun, detail) : null;
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

  function buildPrimaryActionButton(action, classNames, overrideLabel) {
    if (!action) return '';
    var label = overrideLabel || action.label || 'Continue';
    var btnClass = classNames || 'btn btn-primary';
    if (action.type === 'execute-next-action') {
      return '<button class="' + esc(btnClass) + '" data-product-action="execute-next-action" data-action-id="' + esc(action.actionId || '') + '" data-stage-id="' + esc(action.stageId || '') + '">' + esc(label) + '</button>';
    }
    if (action.type === 'start-stage') {
      return '<button class="' + esc(btnClass) + '" data-product-action="start-stage" data-stage-id="' + esc(action.stageId || '') + '">' + esc(label) + '</button>';
    }
    if (action.type === 'complete-stage') {
      return '<button class="' + esc(btnClass) + '" data-stage-action="complete" data-stage-id="' + esc(action.stageId || '') + '">' + esc(label) + '</button>';
    }
    if (action.type === 'open-session') {
      return '<button class="' + esc(btnClass) + '" data-stage-action="open-session" data-session-id="' + esc(action.sessionId || '') + '">' + esc(label) + '</button>';
    }
    if (action.type === 'open-workspace') {
      return '<button class="' + esc(btnClass) + '" data-product-action="open-workspace">' + esc(label) + '</button>';
    }
    return '';
  }

  function buildCollapsiblePanel(title, meta, bodyHtml, open) {
    return '<section class="detail-panel collapsible-panel"><details class="panel-disclosure"' + (open ? ' open' : '') + '><summary class="panel-disclosure-summary"><div><strong>' + esc(title) + '</strong><div class="artifact-row-meta">' + esc(meta || '') + '</div></div><span class="chip subtle">details</span></summary><div class="panel-body">' + bodyHtml + '</div></details></section>';
  }

  function buildExecutiveSummaryPanel(detail, currentRun, latestHandoff) {
    var primaryAction = resolvePrimaryProductAction(detail);
    var copilot = detail.copilot || {};
    var blockers = ((copilot.current_state || {}).blockers || []).slice(0, 3);
    var artifactSummary = detail.artifact_summary || { present: 0, total: 0 };
    var stageLabel = detail.current_stage_id || detail.computed_stage_signal || detail.declared_stage || 'idea';
    var readiness = detail.readiness || {};
    var technicalSummary = '<details class="inline-details"><summary>Technical context</summary><div class="inline-details-body"><div class="meta-list">' +
      metaItem('Owner', detail.owner) +
      metaItem('Runtime Workspace', ((detail.workspace || {}).linked_workspace_name || (detail.workspace || {}).runtime_workspace_id || 'none')) +
      metaItem('Repo', ((detail.repo || {}).local_path || 'unknown')) +
      metaItem('Declared Stage', detail.declared_stage || 'unknown') +
      metaItem('Stage Signal', detail.computed_stage_signal || 'unknown') +
      metaItem('Tracked Runs', String(((detail.runs || []).length))) +
      metaItem('Handoffs', String(((detail.handoffs || []).length))) +
      metaItem('Latest Completion', latestHandoff ? formatDateTime(latestHandoff.created_at) : 'none') +
      '</div></div></details>';
    var blockerHtml = blockers.length
      ? '<div class="chip-row" style="margin-top:10px">' + blockers.map(function(item) {
          return '<span class="chip warn">' + esc(item.label) + '</span>';
        }).join('') + '</div>'
      : '<div class="artifact-row-meta" style="margin-top:10px">No critical blockers surfaced right now.</div>';
    var openSessionButton = currentRun && pickPrimaryRunSession(currentRun, detail)
      ? buildPrimaryActionButton({
          type: 'open-session',
          sessionId: pickPrimaryRunSession(currentRun, detail).id,
          label: 'Open active session'
        }, 'btn')
      : '';

    return '<section class="detail-panel executive-panel"><div class="panel-header"><h3>Product State</h3><span class="artifact-row-meta">executive summary</span></div><div class="panel-body"><div class="executive-grid"><div><div class="chip-row"><span class="chip subtle">stage: ' + esc(stageLabel) + '</span><span class="chip ' + stageSignalClass(detail.computed_stage_signal) + '">signal: ' + esc(detail.computed_stage_signal || stageLabel) + '</span><span class="chip ' + (readiness.status === 'ready-for-release-candidate' ? 'ok' : readiness.status === 'needs-evidence' ? 'warn' : 'subtle') + '">' + esc(readiness.label || 'not assessed') + '</span></div><p class="executive-summary">' + esc(copilot.summary || detail.summary || 'Review the product state, evidence and next move.') + '</p><div class="meta-list executive-meta"><div><span class="meta-item-label">Artifacts</span><span class="mono">' + esc(String(artifactSummary.present || 0) + '/' + String(artifactSummary.total || 0)) + '</span></div><div><span class="meta-item-label">Current Run</span><span class="mono">' + esc(currentRun ? (currentRun.stage_label || currentRun.stage_id || currentRun.status || 'active') : 'none') + '</span></div><div><span class="meta-item-label">Open Blockers</span><span class="mono">' + esc(String(blockers.length)) + '</span></div><div><span class="meta-item-label">Ready for Test</span><span class="mono">' + esc(((copilot.delivery_readiness || {}).ready_for_test) ? 'yes' : 'no') + '</span></div></div>' + blockerHtml + technicalSummary + '</div><div class="executive-cta-card"><div class="run-kicker">Recommended next move</div><strong>' + esc(primaryAction ? primaryAction.label : 'Review product state') + '</strong><p class="artifact-row-meta" style="margin-top:8px">' + esc(primaryAction ? primaryAction.description : 'Use the product detail below to choose the next step.') + '</p><div class="product-detail-actions executive-actions">' + (primaryAction ? buildPrimaryActionButton(primaryAction, 'btn btn-primary btn-cta') : '') + openSessionButton + '</div></div></div></div></section>';
  }

  function buildOperateLitePanel(detail) {
    var op = detail.operate_lite;
    if (!op) return '';
    var evidenceSummary = op.evidence_summary || {};
    var evidenceHtml = '<div class="evidence-summary">' +
      '<div class="evidence-summary-stat"><div class="product-stat-label">Total Handoffs</div><div class="product-stat-value">' + (evidenceSummary.total_handoffs || 0) + '</div></div>' +
      '<div class="evidence-summary-stat"><div class="product-stat-label">Evidence Outputs</div><div class="product-stat-value">' + (evidenceSummary.total_evidence_outputs || 0) + '</div></div>' +
      '</div>';
    var body = '<div class="meta-list">' +
      metaItem('Runbook Status', op.runbook_status) +
      metaItem('Runbook Path', op.runbook_path || 'N/A') +
      metaItem('Readiness Evaluation', 'On-demand (computed per request)') +
      metaItem('Operational Notes', op.operational_notes || 'None') +
      '</div>' +
      evidenceHtml +
      (op.next_post_release_action ? '<div class="summary-callout" style="margin-top:12px"><span class="meta-item-label">Next Post-Release Action</span><p style="margin-top:6px;font-size:13px">' + esc(op.next_post_release_action) + '</p></div>' : '');
    return buildCollapsiblePanel('Operate Lite', 'runbook: ' + esc(op.runbook_status), body, false);
  }

  function buildProductDetailHtml(detail) {
    const currentRun = resolveCurrentRun(detail);
    const latestHandoff = resolveLatestHandoff(detail.handoffs || []);
    const pipelineBody = '<div class="pipeline-list">' + detail.pipeline.map(step => buildStepCard(step)).join('') + '</div>';
    const knowledgeBody = buildKnowledgePackPanel(detail) + '<div style="margin-top:14px">' + buildStageKnowledgePanel(detail) + '</div>';
    const technicalBody = buildHandoffHistoryPanel(detail);
    const sessionsBody = '<div class="session-list">' + ((detail.related_sessions || []).map(session => buildProductSessionRow(session)).join('') || '<p>No linked sessions yet.</p>') + '</div>';
    return '<div class="product-detail-header"><div class="product-row"><div><h2>' + esc(detail.name) + '</h2><div class="product-subtitle">' + esc(detail.summary || 'No summary available.') + '</div></div><div class="detail-badges"><span class="chip">' + esc(detail.category) + '</span><span class="chip subtle">stage: ' + esc(detail.current_stage_id || detail.computed_stage_signal || detail.declared_stage || 'idea') + '</span>' + buildKnowledgePackChips(detail.knowledge_packs || [], true) + '</div></div><div class="product-detail-actions">' +
      ((detail.workspace || {}).runtime_workspace_id ? '<button class="btn btn-sm btn-primary" data-product-action="open-workspace">Open Runtime Workspace</button>' : '') +
      '<button class="btn btn-sm" data-product-action="change-workspace">Change Runtime Workspace</button>' +
      '</div></div><div class="product-detail-scroll">' +
      buildExecutiveSummaryPanel(detail, currentRun, latestHandoff) +
      buildCopilotPanel(detail) +
      '<div class="detail-grid"><section class="detail-panel"><div class="panel-header"><h3>Artifacts</h3><span class="artifact-row-meta">' + detail.artifact_summary.present + '/' + detail.artifact_summary.total + ' present</span></div><div class="panel-body"><div class="artifact-list">' + detail.artifacts.map(artifact => '<div class="artifact-row"><div class="product-row"><h4>' + esc(artifact.label) + '</h4><span class="artifact-chip ' + (artifact.exists ? 'exists' : 'missing') + '">' + (artifact.exists ? 'present' : 'missing') + '</span></div><div class="artifact-row-meta mono" style="margin-top:8px">' + esc(artifact.path || 'No path configured') + '</div></div>').join('') + '</div></div></section>' +
      buildReadinessPanel(detail) + '</div>' +
      '<div class="detail-grid"><section class="detail-panel run-panel"><div class="panel-header"><h3>Current Run</h3><span class="artifact-row-meta">' + esc(currentRun ? (currentRun.status || 'active') : 'no active run') + '</span></div><div class="panel-body">' + buildCurrentRunPanel(detail, currentRun) + '</div></section>' +
      '<section class="detail-panel"><div class="panel-header"><h3>Next Actions</h3><span class="artifact-row-meta">' + ((detail.next_actions || []).length) + ' suggested</span></div><div class="panel-body"><div class="next-actions-list">' + ((detail.next_actions || []).map(action => buildNextActionRow(action, detail)).join('') || '<p>No next actions available.</p>') + '</div></div></section></div>' +
      '<div class="detail-grid">' + buildCollapsiblePanel('Pipeline', detail.pipeline.length + ' stages', pipelineBody, false) +
      '<section class="detail-panel"><div class="panel-header"><h3>Technical History</h3><span class="artifact-row-meta">collapsed by default</span></div><div class="panel-body"><div class="detail-grid"><div>' + buildCollapsiblePanel('Stage Completions', ((detail.handoffs || []).length) + ' records', technicalBody, false) + '</div><div>' + buildCollapsiblePanel('Related Sessions', ((detail.related_sessions || []).length) + ' linked', sessionsBody, false) + '</div></div></div></section></div>' +
      '<div class="detail-grid">' + buildCollapsiblePanel('Knowledge Packs & Guidance', ((detail.knowledge_packs || []).length) + ' active', knowledgeBody, false) +
      buildOperateLitePanel(detail) + '</div>' +
      '</div></div>';
  }

  function buildStepCard(step) {
    var technicalRows = '';
    if (step.active_run_id) {
      technicalRows += '<div class="action-row-meta"><span class="meta-item-label">Active run</span><div class="chip-row"><span class="chip subtle">' + esc(step.active_run_id) + '</span></div></div>';
    }
    if (step.latest_completion) {
      technicalRows += '<div class="action-row-meta"><span class="meta-item-label">Latest completion</span>' + buildHandoffSummaryInline(step.latest_completion) + '</div>';
    }
    if (step.latest_incoming_handoff) {
      technicalRows += '<div class="action-row-meta"><span class="meta-item-label">Incoming context</span>' + buildHandoffSummaryInline(step.latest_incoming_handoff) + '</div>';
    }
    return '<article class="step-card"><div class="step-card-top"><div><h4>' + esc(step.label) + '</h4><div class="step-card-meta"><span class="status-pill ' + esc(step.status) + '">' + esc(stageStatusLabel(step.status)) + '</span><span class="chip">' + esc(step.recommended_role) + '</span><span class="chip">' + esc(step.recommended_runtime_agent) + '</span></div></div></div><div class="step-card-goal">' + esc(step.goal) + '</div>' +
      (technicalRows ? '<details class="inline-details"><summary>Execution details</summary><div class="inline-details-body">' + technicalRows + '</div></details>' : '') +
      '<div class="step-card-actions"><button class="btn btn-sm btn-primary" data-stage-action="start" data-stage-id="' + step.stage_id + '">Continue</button>' + (step.active_session_id ? '<button class="btn btn-sm" data-stage-action="open-session" data-session-id="' + step.active_session_id + '">Open Session</button>' : '') + (step.stage_id !== 'idea' ? '<button class="btn btn-sm" data-stage-action="complete" data-stage-id="' + step.stage_id + '">Finish Stage</button>' : '') + '</div></article>';
  }

  function buildNextActionRow(action, detail) {
    const stageId = action.step_id || action.stage_id || '';
    const role = action.recommended_role || action.role || '';
    const runtime = action.recommended_runtime_agent || action.runtime_agent || '';
    const runId = action.run_id || action.runId || '';
    const knowledge = resolveActionKnowledge(action, detail, stageId);
    const outputs = normalizeOutputList(action.expected_outputs || action.outputs_expected || []);
    const trace = [stageId ? ('stage: ' + stageId) : '', role ? ('role: ' + role) : '', runtime ? ('runtime: ' + runtime) : '', runId ? ('run: ' + runId) : ''].filter(Boolean).join(' | ');
    const executable = action.executable !== false && !!stageId;
    const technicalDetails = (trace || knowledge || (action.uses_previous_handoff && action.previous_handoff_summary) || outputs.length)
      ? '<details class="inline-details"><summary>Why this step is recommended</summary><div class="inline-details-body">' +
        (trace ? '<div class="action-row-trace">' + esc(trace) + '</div>' : '') +
        (knowledge ? '<div class="action-row-meta"><span class="meta-item-label">Knowledge preset</span>' + buildKnowledgeDriverInline(knowledge) + '</div>' : '') +
        (action.uses_previous_handoff && action.previous_handoff_summary
          ? '<div class="action-row-meta"><span class="meta-item-label">Previous stage completion</span><div class="artifact-row-meta">' + esc(action.previous_handoff_summary) + '</div><div class="chip-row" style="margin-top:6px"><span class="chip knowledge">uses previous stage completion</span>' + (action.previous_handoff_id ? '<span class="chip subtle">' + esc(action.previous_handoff_id) + '</span>' : '') + '</div></div>'
          : '') +
        (outputs.length ? '<div class="action-row-meta"><span class="meta-item-label">Expected outputs</span><div class="chip-row">' + outputs.map(item => '<span class="chip">' + esc(item) + '</span>').join('') + '</div></div>' : '') +
      '</div></details>'
      : '';
    return '<div class="action-row">' +
      '<div class="action-row-copy"><strong>' + esc(action.label) + '</strong><span>' + esc(action.reason || 'No rationale available.') + '</span>' +
      technicalDetails +
      '</div>' +
      '<div class="action-row-actions">' +
      (executable ? '<button class="btn btn-sm btn-primary btn-cta" data-product-action="execute-next-action" data-action-id="' + esc(action.id || '') + '" data-stage-id="' + esc(stageId) + '">Execute next step</button>' : '') +
      (stageId ? '<button class="btn btn-sm" data-product-action="start-stage" data-stage-id="' + esc(stageId) + '">Customize</button>' : '') +
      '</div></div>';
  }

  function buildProductSessionRow(session) {
    const meta = AGENT_META[session.agent] || { icon: '?' };
    const runId = session.runId || session.run_id || '';
    const sessionMeta = ['stage: ' + (session.stageId || 'manual'), 'role: ' + (session.role || 'none')].concat([runId ? ('run:' + runId) : '', session.model || '', session.effort ? ('effort:' + session.effort) : ''].filter(Boolean)).join(' | ');
    return '<div class="session-row-inline"><div class="product-row"><h4>' + esc(session.name) + '</h4><div class="chip-row"><span class="agent-badge ' + session.agent + '">' + meta.icon + '</span><span class="status-pill ' + session.status + '">' + esc(stageStatusLabel(session.status)) + '</span></div></div><div class="session-inline-meta">' + esc((session.agent || 'agent') + ' | ' + (session.status || 'unknown')) + '</div><details class="inline-details"><summary>Technical context</summary><div class="inline-details-body"><div class="artifact-row-meta">' + esc(sessionMeta) + '</div><div class="session-inline-path">' + esc(session.workingDir || 'No working directory') + '</div></div></details><div class="step-card-actions"><button class="btn btn-sm" data-stage-action="open-session" data-session-id="' + session.id + '">Open Session</button>' + (session.status === 'running' ? '<button class="btn btn-sm" data-session-action="stop" data-session-id="' + session.id + '">Stop</button><button class="btn btn-sm" data-session-action="restart" data-session-id="' + session.id + '">Restart</button>' : '<button class="btn btn-sm btn-primary" data-session-action="start" data-session-id="' + session.id + '">Start</button><button class="btn btn-sm" data-session-action="restart" data-session-id="' + session.id + '">Restart</button>') + '<button class="btn btn-sm" data-session-action="delete" data-session-id="' + session.id + '">Delete</button></div></div>';
  }

  function buildKnowledgePackChips(packs, compact) {
    if (!packs || !packs.length) {
      return compact ? '<span class="chip">no knowledge packs</span>' : '';
    }
    const items = compact ? packs.slice(0, 2) : packs;
    const chips = items.map(pack => '<span class="chip knowledge">' + esc(pack.name) + ' active</span>').join('');
    if (compact && packs.length > items.length) {
      return chips + '<span class="chip knowledge">+' + esc(String(packs.length - items.length)) + ' more</span>';
    }
    return chips;
  }

  function buildKnowledgePackPanel(detail) {
    const packs = detail.knowledge_packs || [];
    const current = detail.current_stage_knowledge || [];
    const currentStage = detail.current_stage_id || detail.computed_stage_signal || 'idea';
    if (!packs.length) {
      return '<p>No active knowledge packs for this product yet.</p>';
    }

    const currentHtml = current.length
      ? '<div class="knowledge-now"><div class="knowledge-now-title">Recommended now: ' + esc(currentStage) + '</div><div class="knowledge-suggestion-group">' + current.map(rec => buildKnowledgeRecommendationSummary(rec, { emphasizeDefault: true })).join('') + '</div></div>'
      : '<div class="knowledge-now"><div class="knowledge-now-title">Recommended now: ' + esc(currentStage) + '</div><p>No stage recommendation available for the current stage.</p></div>';

    return currentHtml + '<div class="knowledge-pack-list">' + packs.map(pack => {
      const domains = (pack.domains || []).map(item => '<span class="chip">' + esc(item) + '</span>').join('');
      const runtimes = (pack.supported_runtimes || []).map(item => '<span class="chip">' + esc(item) + '</span>').join('');
      const entrypoints = (pack.entrypoints || []).map(item => '<span class="chip knowledge">' + esc(item) + '</span>').join('');
      return '<div class="knowledge-pack-row"><div class="product-row"><h4>' + esc(pack.name) + '</h4><div class="chip-row"><span class="chip knowledge">' + esc(pack.type || 'knowledge-pack') + '</span><span class="chip ok">' + esc(pack.integration_mode || 'reference-first') + '</span><span class="chip subtle">drives execution</span></div></div>' +
        '<div class="artifact-row-meta" style="margin-top:6px">' + esc(pack.description || 'No pack description available.') + '</div>' +
        '<div class="knowledge-pack-meta"><div><span class="meta-item-label">Domains</span><div class="chip-row">' + (domains || '<span class="chip">none</span>') + '</div></div><div><span class="meta-item-label">Runtimes</span><div class="chip-row">' + (runtimes || '<span class="chip">none</span>') + '</div></div></div>' +
        '<div class="knowledge-pack-meta" style="margin-top:10px"><div><span class="meta-item-label">Repo</span><div class="artifact-row-meta mono"><a href="' + pack.repo_url + '" target="_blank" rel="noreferrer">' + esc(pack.repo_url || '') + '</a></div></div><div><span class="meta-item-label">Entrypoints</span><div class="chip-row">' + (entrypoints || '<span class="chip">none</span>') + '</div></div></div>' +
        (pack.binding && pack.binding.notes ? '<div class="artifact-row-meta" style="margin-top:10px">' + esc(pack.binding.notes) + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  function buildStageKnowledgePanel(detail) {
    const stages = detail.knowledge_stage_recommendations || [];
    if (!stages.length) return '<p>No stage knowledge recommendations available.</p>';
    return '<div class="stage-knowledge-list">' + stages.map(stage => {
      const recommendations = stage.recommendations || [];
      const defaultPreset = resolveStageDefaultPreset(detail, stage.stage_id);
      return '<div class="stage-knowledge-row ' + (stage.is_current ? 'current' : '') + '"><div class="product-row"><h4>' + esc(stage.label) + '</h4><div class="chip-row"><span class="status-pill ' + esc(stage.status) + '">' + esc(stageStatusLabel(stage.status)) + '</span>' + (stage.is_current ? '<span class="chip knowledge">current</span>' : '') + '</div></div>' +
        (defaultPreset ? '<div class="knowledge-default-row"><span class="meta-item-label">Execution default</span>' + buildKnowledgeDriverInline(defaultPreset) + '</div>' : '') +
        (recommendations.length
          ? '<div class="knowledge-suggestion-group">' + recommendations.map(rec => buildKnowledgeRecommendationSummary(rec, { emphasizeDefault: true })).join('') + '</div>'
          : '<div class="artifact-row-meta" style="margin-top:8px">No knowledge recommendation for this stage.</div>') +
        '</div>';
    }).join('') + '</div>';
  }

  function buildKnowledgeRecommendationSummary(rec, options) {
    const settings = options || {};
    const skills = (rec.recommended_skills || []).map(item => '<span class="chip">' + esc(item) + '</span>').join('');
    const workflows = (rec.recommended_workflows || []).map(item => '<span class="chip knowledge">' + esc(item) + '</span>').join('');
    const roles = (rec.recommended_roles || []).map(item => '<span class="chip">' + esc(item) + '</span>').join('');
    const agents = (rec.recommended_runtime_agents || []).map(item => '<span class="chip">' + esc(item) + '</span>').join('');
    const presets = getRecommendationPresets(rec);
    const defaultPreset = resolvePresetFromRecommendation(rec);
    return '<div class="knowledge-suggestion-card"><div class="product-row"><strong>' + esc(rec.knowledge_pack_name || rec.knowledge_pack_id) + '</strong><span class="chip knowledge">' + esc(rec.knowledge_pack_id || '') + '</span></div>' +
      (settings.emphasizeDefault && defaultPreset ? '<div class="knowledge-default-row"><span class="meta-item-label">Default execution preset</span>' + buildKnowledgeDriverInline(defaultPreset) + '</div>' : '') +
      '<div class="knowledge-pack-meta"><div><span class="meta-item-label">Skills</span><div class="chip-row">' + (skills || '<span class="chip">none</span>') + '</div></div><div><span class="meta-item-label">Workflows</span><div class="chip-row">' + (workflows || '<span class="chip">none</span>') + '</div></div></div>' +
      '<div class="knowledge-pack-meta" style="margin-top:10px"><div><span class="meta-item-label">Roles</span><div class="chip-row">' + (roles || '<span class="chip">none</span>') + '</div></div><div><span class="meta-item-label">Runtime Agents</span><div class="chip-row">' + (agents || '<span class="chip">none</span>') + '</div></div></div>' +
      (presets.length ? '<div class="knowledge-pack-meta" style="margin-top:10px"><div style="grid-column:1 / -1"><span class="meta-item-label">Execution presets</span><div class="chip-row">' + presets.map(item => '<span class="chip ' + (item.is_default ? 'knowledge' : 'subtle') + '">' + esc(item.preset_label) + '</span>').join('') + '</div></div></div>' : '') +
      '</div>';
  }

  function bindProductDetailActions(detail) {
    const root = document.getElementById('product-detail');
    root.querySelectorAll('[data-product-action="open-workspace"]').forEach(el => el.addEventListener('click', () => {
      setActiveWorkspace(detail.workspace.runtime_workspace_id);
      renderWorkspaceList();
      switchView('terminals');
    }));
    root.querySelectorAll('[data-product-action="change-workspace"]').forEach(el => el.addEventListener('click', () => changeProductWorkspace(detail)));
    root.querySelectorAll('[data-product-action="execute-next-action"]').forEach(el => el.addEventListener('click', () => executeNextAction(detail.product_id, {
      id: el.dataset.actionId,
      step_id: el.dataset.stageId
    })));
    root.querySelectorAll('[data-product-action="start-stage"], [data-stage-action="start"]').forEach(el => el.addEventListener('click', () => startGuidedStage(detail.product_id, el.dataset.stageId)));
    root.querySelectorAll('[data-stage-action="complete"]').forEach(el => el.addEventListener('click', () => registerHandoff(detail.product_id, el.dataset.stageId)));
    root.querySelectorAll('[data-stage-action="open-session"]').forEach(el => el.addEventListener('click', () => openSessionInTerminals(el.dataset.sessionId, detail.product_id)));
    root.querySelectorAll('[data-run-action="open-session"]').forEach(el => el.addEventListener('click', () => openSessionInTerminals(el.dataset.sessionId, detail.product_id)));
    root.querySelectorAll('[data-run-action="complete-stage"]').forEach(el => el.addEventListener('click', () => registerHandoff(detail.product_id, el.dataset.stageId)));
    root.querySelectorAll('[data-run-action="discard-run"]').forEach(el => el.addEventListener('click', () => discardRun(detail.product_id, el.dataset.runId)));
    root.querySelectorAll('[data-run-action="start-session"]').forEach(el => el.addEventListener('click', () => startSession(el.dataset.sessionId)));
    root.querySelectorAll('[data-run-action="restart-session"]').forEach(el => el.addEventListener('click', () => restartSession(el.dataset.sessionId)));
    root.querySelectorAll('[data-session-action="start"]').forEach(el => el.addEventListener('click', () => startSession(el.dataset.sessionId)));
    root.querySelectorAll('[data-session-action="restart"]').forEach(el => el.addEventListener('click', () => restartSession(el.dataset.sessionId)));
    root.querySelectorAll('[data-session-action="stop"]').forEach(el => el.addEventListener('click', () => stopSession(el.dataset.sessionId)));
    root.querySelectorAll('[data-session-action="delete"]').forEach(el => el.addEventListener('click', () => deleteSession(el.dataset.sessionId)));
    root.querySelectorAll('[data-copilot-action="refresh"]').forEach(el => el.addEventListener('click', () => refreshCopilot(detail.product_id)));
    root.querySelectorAll('[data-copilot-action="accept-candidate"]').forEach(el => el.addEventListener('click', () => reviewCopilotCandidate(detail.product_id, el.dataset.candidateId, true)));
    root.querySelectorAll('[data-copilot-action="reject-candidate"]').forEach(el => el.addEventListener('click', () => reviewCopilotCandidate(detail.product_id, el.dataset.candidateId, false)));
    root.querySelectorAll('[data-copilot-action="review-candidate"]').forEach(el => el.addEventListener('click', () => openCandidateReviewDialog(detail.product_id, el.dataset.candidateId)));
    root.querySelectorAll('[data-copilot-action="add-decision"]').forEach(el => el.addEventListener('click', () => openCopilotDecisionDialog(detail)));
    root.querySelectorAll('[data-copilot-action="resolve-decision"]').forEach(el => el.addEventListener('click', () => updateCopilotDecisionStatus(detail.product_id, el.dataset.decisionId, 'resolved')));
    root.querySelectorAll('[data-copilot-action="reopen-decision"]').forEach(el => el.addEventListener('click', () => updateCopilotDecisionStatus(detail.product_id, el.dataset.decisionId, 'open')));
  }

  async function refreshCopilot(productId) {
    await loadProducts(true);
    await loadProductDetail(productId, true);
    renderCurrentView();
  }

  async function reviewCopilotCandidate(productId, candidateId, accepted) {
    const detail = await api('/products/' + encodeURIComponent(productId) + '/copilot/candidates/' + encodeURIComponent(candidateId) + '/review', {
      method: 'POST',
      body: JSON.stringify({ accepted: accepted })
    });
    productDetails[productId] = detail;
    await loadProducts(true);
    renderCurrentView();
  }

  function openCandidateReviewDialog(productId, candidateId) {
    showDialog('Review Artifact Candidate', '<p style="font-size:13px">Choose whether this candidate should be treated as accepted evidence for project memory.</p>', [
      { label: 'Cancel', onClick: function() {} },
      { label: 'Reject', onClick: function() { reviewCopilotCandidate(productId, candidateId, false); } },
      { label: 'Accept', primary: true, onClick: function() { reviewCopilotCandidate(productId, candidateId, true); } }
    ]);
  }

  function openCopilotDecisionDialog(detail) {
    var currentStage = detail.current_stage_id || detail.computed_stage_signal || '';
    var artifactOptions = (detail.artifacts || []).map(function(item) {
      return '<option value="' + esc(item.id) + '">' + esc(item.label) + '</option>';
    }).join('');
    showDialog('Add Project Decision', '<label>Decision Title</label><input type="text" id="dlg-copilot-decision-title" placeholder="Example: use discovery brief as the working brief"><label>Linked Stage</label><input type="text" id="dlg-copilot-decision-stage" value="' + esc(currentStage) + '"><label>Linked Artifact (optional)</label><select id="dlg-copilot-decision-artifact"><option value="">None</option>' + artifactOptions + '</select><label>Note</label><textarea id="dlg-copilot-decision-note" placeholder="Why this decision matters and what it unblocks."></textarea>', [
      { label: 'Cancel', onClick: function() {} },
      { label: 'Save Decision', primary: true, onClick: async function() {
        var title = document.getElementById('dlg-copilot-decision-title').value.trim();
        if (!title) return;
        var linkedArtifact = document.getElementById('dlg-copilot-decision-artifact').value;
        var nextDetail = await api('/products/' + encodeURIComponent(detail.product_id) + '/copilot/decisions', {
          method: 'POST',
          body: JSON.stringify({
            title: title,
            linked_stage: document.getElementById('dlg-copilot-decision-stage').value.trim(),
            linked_artifacts: linkedArtifact ? [linkedArtifact] : [],
            note: document.getElementById('dlg-copilot-decision-note').value.trim()
          })
        });
        productDetails[detail.product_id] = nextDetail;
        await loadProducts(true);
        renderCurrentView();
      } }
    ]);
  }

  async function updateCopilotDecisionStatus(productId, decisionId, status) {
    var detail = await api('/products/' + encodeURIComponent(productId) + '/copilot/decisions/' + encodeURIComponent(decisionId), {
      method: 'PUT',
      body: JSON.stringify({ status: status })
    });
    productDetails[productId] = detail;
    await loadProducts(true);
    renderCurrentView();
  }

  function openSessionInTerminals(sessionId, productId) {
    const product = products.find(p => p.product_id === productId);
    if (product && product.workspace && product.workspace.runtime_workspace_id) setActiveWorkspace(product.workspace.runtime_workspace_id);
    const session = allSessions.find(s => s.id === sessionId);
    if (session && session.workspaceId) setActiveWorkspace(session.workspaceId);
    renderWorkspaceList();
    switchView('terminals');
  }

  function buildAgentOptions(defaultAgent, allowedAgents) {
    return (allowedAgents || Object.keys(AGENT_META)).map(agent => '<option value="' + agent + '"' + (agent === defaultAgent ? ' selected' : '') + '>' + esc((AGENT_META[agent] || { name: agent }).name) + '</option>').join('');
  }

  function getAgentCatalog(agent) {
    const entry = modelsByAgent[agent];
    if (Array.isArray(entry)) {
      return { models: entry, supportsEffort: false, effortLevels: [] };
    }
    return entry || { models: [], supportsEffort: false, effortLevels: [] };
  }

  function buildModelOptionsFor(agent) {
    const models = getAgentCatalog(agent).models || [];
    if (!models.length) return '<option value="">Default</option>';
    return models.map((model, index) => '<option value="' + esc(model.id) + '"' + (index === 0 ? ' selected' : '') + '>' + esc(model.name) + '</option>').join('');
  }

  function buildEffortOptionsFor(agent) {
    const catalog = getAgentCatalog(agent);
    if (!catalog.supportsEffort || !(catalog.effortLevels || []).length) {
      return '<option value="">Default</option>';
    }
    return [''].concat(catalog.effortLevels).map((effort, index) => {
      const label = effort ? effort : 'Default';
      return '<option value="' + esc(effort) + '"' + (index === 0 ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
  }

  function updateEffortField(agent, selectId, wrapperId) {
    const select = document.getElementById(selectId);
    const wrapper = document.getElementById(wrapperId);
    if (!select || !wrapper) return;
    const catalog = getAgentCatalog(agent);
    select.innerHTML = buildEffortOptionsFor(agent);
    wrapper.style.display = catalog.supportsEffort ? 'block' : 'none';
  }

  async function startGuidedStage(productId, stageId) {
    const detail = await loadProductDetail(productId);
    const stage = (detail.pipeline || []).find(item => item.stage_id === stageId);
    if (!stage) return;
    const latestIncomingHandoff = findLatestIncomingHandoff(detail, stageId);
    const defaultAgent = stage.recommended_runtime_agent;
    const defaultName = detail.name + ' - ' + stage.label;
    const workingDir = ((detail.repo || {}).local_path || '');
    const stageRecommendations = resolveStageKnowledgeEntries(detail, stageId);
    const stagePresets = stageRecommendations.flatMap(rec => getRecommendationPresets(rec)).filter(item => item && item.preset_id);
    const uniqueStagePresets = stagePresets.filter((item, index, list) => list.findIndex(other => other.knowledge_pack_id === item.knowledge_pack_id && other.preset_type === item.preset_type && other.preset_id === item.preset_id) === index);
    const defaultPreset = uniqueStagePresets.find(item => item.is_default) || uniqueStagePresets[0] || null;
    const knowledgeBlock = defaultPreset
      ? '<div class="dialog-knowledge-block"><div class="meta-item-label">Knowledge preset</div>' + buildKnowledgeDriverInline(defaultPreset) + '<div class="artifact-row-meta" style="margin-top:8px">Default execution guidance for this stage.</div></div>'
      : '<div class="dialog-knowledge-block"><div class="meta-item-label">Knowledge preset</div><div class="artifact-row-meta">No active preset for this stage.</div></div>';
    const handoffBlock = latestIncomingHandoff
      ? '<div class="dialog-knowledge-block"><div class="meta-item-label">Previous stage completion</div><div class="handoff-summary">' + esc(latestIncomingHandoff.summary || '') + '</div><div class="artifact-row-meta" style="margin-top:8px">' + esc((latestIncomingHandoff.from_stage || 'unknown') + ' -> ' + (latestIncomingHandoff.to_stage || stageId)) + '</div><div class="action-row-meta"><span class="meta-item-label">Referenced outputs</span>' + buildOutputReferenceChips((latestIncomingHandoff.output_refs || []).map(item => ({ label: item })), 'No outputs referenced.') + '</div></div>'
      : '';
    const presetOptions = uniqueStagePresets.map((item, index) => '<option value="' + esc(JSON.stringify({
      knowledge_pack_id: item.knowledge_pack_id || '',
      knowledge_pack_name: item.knowledge_pack_name || '',
      preset_type: item.preset_type || '',
      preset_id: item.preset_id || '',
      preset_label: item.preset_label || ''
    })) + '"' + ((defaultPreset && item.preset_id === defaultPreset.preset_id && item.preset_type === defaultPreset.preset_type && item.knowledge_pack_id === defaultPreset.knowledge_pack_id) || (!defaultPreset && index === 0) ? ' selected' : '') + '>' + esc((item.knowledge_pack_name || item.knowledge_pack_id || 'Knowledge Pack') + ' - ' + item.preset_label) + '</option>').join('');
    showDialog('Start ' + stage.label, '<label>Stage</label><input type="text" value="' + esc(stage.label) + '" disabled><label>Recommended Role</label><input type="text" value="' + esc(stage.recommended_role) + '" disabled>' + knowledgeBlock + handoffBlock + (uniqueStagePresets.length > 1 ? '<label>Execution Preset</label><select id="dlg-stage-preset">' + presetOptions + '</select>' : '') + '<label>Session Name</label><input type="text" id="dlg-stage-name" value="' + esc(defaultName) + '"><label>Runtime Agent</label><select id="dlg-stage-agent">' + buildAgentOptions(defaultAgent, stage.allowed_runtime_agents) + '</select><label>Model</label><select id="dlg-stage-model">' + buildModelOptionsFor(defaultAgent) + '</select><div id="dlg-stage-effort-wrap"><label>Effort</label><select id="dlg-stage-effort">' + buildEffortOptionsFor(defaultAgent) + '</select></div><label>Working Directory</label><input type="text" id="dlg-stage-dir" value="' + esc(workingDir) + '"><label>Goal</label><textarea disabled>' + esc(stage.goal) + '</textarea>', [
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
        await api('/products/' + encodeURIComponent(productId) + '/stages/' + encodeURIComponent(stageId) + '/start', {
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
        await loadAllSessions();
        await loadProducts(true);
        renderWorkspaceList();
        renderCurrentView();
      }}
    ]);
    setTimeout(() => {
      const agentSelect = document.getElementById('dlg-stage-agent');
      const modelSelect = document.getElementById('dlg-stage-model');
      if (!agentSelect || !modelSelect) return;
      updateEffortField(defaultAgent, 'dlg-stage-effort', 'dlg-stage-effort-wrap');
      agentSelect.addEventListener('change', () => {
        modelSelect.innerHTML = buildModelOptionsFor(agentSelect.value);
        updateEffortField(agentSelect.value, 'dlg-stage-effort', 'dlg-stage-effort-wrap');
      });
    }, 50);
  }

  async function executeNextAction(productId, actionRef) {
    const detail = await loadProductDetail(productId, true);
    const action = ((detail.next_actions || []).find(item => String(item.id || '') === String(actionRef.id || ''))
      || (detail.next_actions || []).find(item => String(item.step_id || item.stage_id || '') === String(actionRef.step_id || ''))
      || actionRef);
    const stageId = action.step_id || action.stage_id || actionRef.step_id;
    const knowledge = resolveActionKnowledge(action, detail, stageId);
    const latestIncomingHandoff = findLatestIncomingHandoff(detail, stageId);
    if (!stageId) return;

    const payload = {
      action_id: action.id || '',
      stage_id: stageId,
      role: action.recommended_role || action.role || '',
      runtimeAgent: action.recommended_runtime_agent || action.runtime_agent || '',
      expectedOutputs: normalizeOutputList(action.expected_outputs || action.outputs_expected || []),
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
      const result = await api('/products/' + encodeURIComponent(productId) + '/next-actions/execute', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      await loadAllSessions();
      await loadProducts(true);
      await loadProductDetail(productId, true);
      renderWorkspaceList();
      if (result && result.session && result.session.id) {
        openSessionInTerminals(result.session.id, productId);
      } else {
        renderCurrentView();
      }
      return;
    } catch (e) {
      console.warn('Next action execution failed, falling back to guided stage:', e);
    }

    await startGuidedStage(productId, stageId);
  }

  async function discardRun(productId, runId) {
    if (!confirm('Are you sure you want to discard this run\'s changes? This will hard reset the working directory to the pre-run checkpoint and cannot be undone.')) return;
    try {
      const res = await api('/products/' + encodeURIComponent(productId) + '/runs/' + encodeURIComponent(runId) + '/rollback', {
        method: 'POST'
      });
      alert(res.message || 'Rollback successful');
      await loadProducts(true);
      await loadProductDetail(productId, true);
      renderCurrentView();
    } catch (e) {
      alert('Rollback failed: ' + e.message);
    }
  }

  async function registerHandoff(productId, fromStage) {
    const detail = await loadProductDetail(productId, true);
    const currentRun = resolveCurrentRun(detail);
    const linkedRunId = currentRun && (currentRun.stage_id === fromStage) ? (currentRun.run_id || currentRun.id || '') : '';
    const linkedRun = linkedRunId ? currentRun : null;
    const nextStage = STAGE_ORDER[Math.min(STAGE_ORDER.indexOf(fromStage) + 1, STAGE_ORDER.length - 1)];
    const primarySession = pickPrimaryRunSession(linkedRun, detail);
    const defaultSessionId = primarySession ? (primarySession.id || '') : '';
    const currentKnowledge = linkedRun ? resolveRunKnowledge(linkedRun, detail) : null;
    const suggestedOutputs = pickCarryForwardOutputs(linkedRun);
    const existingArtifacts = (detail.artifacts || []).filter(function(item) { return item && item.exists; });
    const evidenceCount = ((linkedRun && Array.isArray(linkedRun.produced_outputs)) ? linkedRun.produced_outputs.filter(function(item) { var cat = item.category || ''; return cat === 'evidence'; }).length : 0) + existingArtifacts.length;
    const lowEvidenceHtml = evidenceCount === 0 ? '<div class="low-evidence-warning">No concrete evidence outputs (artifacts, handoffs) will be registered in this handoff. Consider producing artifacts before completing this stage.</div>' : '';
    const selectedOutputRefs = suggestedOutputs.map(item => item.output_id || item.ref_id).filter(Boolean);
    const outputChecks = buildOutputChecklist(linkedRun ? (linkedRun.produced_outputs || []) : [], 'handoff-output', selectedOutputRefs, 'data-handoff-output-ref');
    const artifactChecks = buildOutputChecklist(existingArtifacts.map(item => ({
      output_id: item.id,
      type: 'artifact',
      ref_id: item.id,
      label: item.label
    })), 'handoff-artifact', [], 'data-handoff-artifact-ref');
    const expectedSnapshot = buildOutputReferenceChips(linkedRun ? (linkedRun.expected_outputs || []) : [], 'No expected outputs declared for this run.');
    const summaryDraft = buildCompletionDraft(detail, linkedRun, fromStage, nextStage, primarySession);

    // Milestone 3A: transition gate status callout
    var gateStatus3A = detail.transition_gate_status || 'no-contract';
    var evRpt3A = detail.evidence_report;
    var gateHtml3A = '';
    const gateLabel = gateStatus3A === 'passing' ? 'Ready to finish' : gateStatus3A === 'blocked' ? 'Needs more evidence' : 'Manual review';
    const carryForwardCount = selectedOutputRefs.length + existingArtifacts.length;
    if (gateStatus3A === 'blocked' && evRpt3A && evRpt3A.stage_in_scope) {
      var missingList3A = (evRpt3A.missing_required || []).map(function(a) { return '<span class="chip warn">' + esc(a) + '</span>'; }).join('');
      gateHtml3A = '<div class="gate-warning-callout"><strong>&#9940; Execution gate: blocked</strong><p>Required artifacts not yet verified on disk:</p><div class="chip-row" style="margin-top:8px">' + (missingList3A || '<span class="chip warn">unknown</span>') + '</div><p style="margin-top:8px;font-size:12px;color:var(--text-muted)">You can still complete this stage, but the gate will be recorded as blocked.</p></div>';
    } else if (gateStatus3A === 'passing') {
      gateHtml3A = '<div class="gate-passing-callout"><strong>&#10003; Execution gate: passing</strong></div>';
    }

    const runContext = linkedRun
      ? '<section class="dialog-section"><div class="dialog-section-title">Execution Context</div><div class="dialog-knowledge-block"><div class="meta-list">' +
        metaItem('Stage', fromStage) +
        metaItem('Run', linkedRun.run_id || '') +
        metaItem('Primary Session', defaultSessionId || 'none') +
        metaItem('Runtime', (linkedRun.suggested_runtime_agent || 'unknown-agent')) +
        '</div><div class="artifact-row-meta" style="margin-top:10px">' + esc(linkedRun.objective || 'No run objective registered.') + '</div>' +
        (currentKnowledge ? '<div style="margin-top:10px">' + buildKnowledgeDriverInline(currentKnowledge) + '</div>' : '') +
        '</div></section>'
      : '<section class="dialog-section"><div class="dialog-section-title">Execution Context</div><div class="dialog-knowledge-block"><div class="artifact-row-meta">No active run is linked to this stage right now. This completion will still be saved manually.</div></div></section>';
    showDialog('Finish Stage', '<section class="dialog-section"><div class="dialog-section-title">Quick Finish</div><div class="summary-callout"><div class="product-row"><strong>' + esc(fromStage) + ' -> ' + esc(nextStage) + '</strong><span class="chip ' + (gateStatus3A === 'passing' ? 'ok' : gateStatus3A === 'blocked' ? 'warn' : 'subtle') + '">' + esc(gateLabel) + '</span></div><div class="chip-row" style="margin-top:10px"><span class="chip subtle">carry forward: ' + esc(String(carryForwardCount)) + '</span><span class="chip subtle">artifacts on disk: ' + esc(String(existingArtifacts.length)) + '</span><span class="chip subtle">evidence seen: ' + esc(String(evidenceCount)) + '</span></div><p style="margin-top:8px;font-size:13px;color:var(--text-secondary)">The platform already filled the next stage, session and runtime context for you. Review the handoff summary, then finish the stage.</p></div></section>' + runContext + lowEvidenceHtml + gateHtml3A +
      '<section class="dialog-section"><div class="dialog-section-title">What the next stage should continue with</div>' +
      '<label>Completion summary</label><textarea id="dlg-handoff-summary" placeholder="Review and adjust the suggested completion summary.">' + esc(summaryDraft) + '</textarea>' +
      '<div class="dialog-inline-summary"><div><span class="meta-item-label">Current stage</span><span class="mono">' + esc(fromStage) + '</span></div><div><span class="meta-item-label">Next stage</span><span class="mono">' + esc(nextStage) + '</span></div><div><span class="meta-item-label">Linked session</span><span class="mono">' + esc(defaultSessionId || 'auto') + '</span></div></div>' +
      '</section>' +
      '<details class="dialog-accordion"><summary>Advanced options</summary><div class="dialog-accordion-body">' +
      '<label>Next stage</label><select id="dlg-handoff-to">' + STAGE_ORDER.filter(stage => stage !== 'idea').map(stage => '<option value="' + stage + '"' + (stage === nextStage ? ' selected' : '') + '>' + esc(stage) + '</option>').join('') + '</select>' +
      '<label>Role</label><input type="text" id="dlg-handoff-role" value="' + esc((linkedRun && linkedRun.role) || 'delivery-handoff') + '">' +
      '<label>Runtime Agent</label><select id="dlg-handoff-agent">' + buildAgentOptions((linkedRun && linkedRun.suggested_runtime_agent) || 'claude', Object.keys(AGENT_META)) + '</select>' +
      '<label>Linked Session ID (optional)</label><input type="text" id="dlg-handoff-session" placeholder="sess-..." value="' + esc(defaultSessionId) + '">' +
      '<label>Carry forward outputs</label>' + outputChecks +
      '<label style="margin-top:10px">Carry forward artifacts</label>' + artifactChecks +
      '<label style="margin-top:10px">Expected output snapshot</label><div class="dialog-knowledge-block compact">' + expectedSnapshot + '</div>' +
      '</div></details>', [
      { label: 'Cancel', onClick: function() {} },
      { label: 'Finish Stage', primary: true, onClick: async function() {
        await api('/products/' + encodeURIComponent(productId) + '/handoffs', {
          method: 'POST',
          body: JSON.stringify({
            run_id: linkedRunId,
            from_stage: fromStage,
            to_stage: document.getElementById('dlg-handoff-to').value,
            role: document.getElementById('dlg-handoff-role').value.trim(),
            runtime_agent: document.getElementById('dlg-handoff-agent').value,
            session_id: document.getElementById('dlg-handoff-session').value.trim(),
            summary: document.getElementById('dlg-handoff-summary').value.trim(),
            artifact_refs: getCheckedValues('[data-handoff-artifact-ref]', 'data-handoff-artifact-ref'),
            output_refs: getCheckedValues('[data-handoff-output-ref]', 'data-handoff-output-ref')
          })
        });
        await loadProducts(true);
        await loadProductDetail(productId, true);
        renderCurrentView();
      }}
    ]);
  }

  async function changeProductWorkspace(detail) {
    const currentWorkspaceId = ((detail.workspace || {}).runtime_workspace_id || '');
    const options = ['<option value="">No linked workspace</option>'].concat(
      workspaces.map(ws => '<option value="' + ws.id + '"' + (ws.id === currentWorkspaceId ? ' selected' : '') + '>' + esc(ws.name) + ' - ' + esc(ws.workingDir || 'no working dir') + '</option>')
    ).join('');

    showDialog('Change Runtime Workspace Link',
      '<label>Product</label><input type="text" value="' + esc(detail.name) + '" disabled>' +
      '<label>Linked Runtime Workspace</label><select id="dlg-product-workspace">' + options + '</select>' +
      '<p style="font-size:12px;color:var(--text-secondary);margin-top:6px">Product is the main delivery unit. Runtime workspace is only the execution context used by sessions.</p>',
      [
        { label: 'Cancel', onClick: function() {} },
        { label: 'Save', primary: true, onClick: async function() {
          const workspaceId = document.getElementById('dlg-product-workspace').value;
          await api('/products/' + encodeURIComponent(detail.product_id) + '/workspace', {
            method: 'PUT',
            body: JSON.stringify({ workspaceId: workspaceId })
          });
          await loadWorkspaces();
          await loadAllSessions();
          await loadProducts(true);
          renderWorkspaceList();
          renderCurrentView();
        } }
      ]);
  }

  function slugifyClient(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }

  function showProductWizard(initialDraft) {
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
          '<label>Product Name</label><input type="text" id="dlg-product-name" value="' + esc(draft.name) + '" placeholder="Zapcam">' +
          '<label>Product ID</label><input type="text" id="dlg-product-id" value="' + esc(draft.product_id) + '" placeholder="zapcam">' +
          '<label>Slug</label><input type="text" id="dlg-product-slug" value="' + esc(draft.slug) + '" placeholder="zapcam">' +
          '<label>Owner</label><input type="text" id="dlg-product-owner" value="' + esc(draft.owner) + '" placeholder="guibr">' +
          '<label>Category</label><select id="dlg-product-category"><option value="product"' + (draft.category === 'product' ? ' selected' : '') + '>product</option><option value="internal-tool"' + (draft.category === 'internal-tool' ? ' selected' : '') + '>internal-tool</option><option value="experiment"' + (draft.category === 'experiment' ? ' selected' : '') + '>experiment</option></select>' +
          '<label>Initial Stage</label><select id="dlg-product-stage">' + STAGE_ORDER.filter(item => item !== 'test' && item !== 'release').map(item => '<option value="' + item + '"' + (draft.stage === item ? ' selected' : '') + '>' + esc(item) + '</option>').join('') + '</select>' +
          '<label>Summary</label><textarea id="dlg-product-summary" placeholder="Short product summary.">' + esc(draft.summary) + '</textarea>' +
          '<p class="wizard-help">Create the delivery unit first. Runtime workspace and scaffold stay optional in the next step.</p>';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', hideDialog);
        const nextBtn = document.createElement('button');
        nextBtn.className = 'btn btn-primary';
        nextBtn.textContent = 'Next';
        nextBtn.addEventListener('click', () => {
          draft.name = document.getElementById('dlg-product-name').value.trim();
          draft.product_id = slugifyClient(document.getElementById('dlg-product-id').value.trim());
          draft.slug = slugifyClient(document.getElementById('dlg-product-slug').value.trim());
          draft.owner = document.getElementById('dlg-product-owner').value.trim();
          draft.category = document.getElementById('dlg-product-category').value;
          draft.stage = document.getElementById('dlg-product-stage').value;
          draft.summary = document.getElementById('dlg-product-summary').value.trim();
          if (!draft.name || !draft.owner) {
            alert('Product name and owner are required.');
            return;
          }
          if (!draft.product_id) draft.product_id = slugifyClient(draft.name);
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
          const nextSlug = slugifyClient(nameInput.value);
          if (!idInput.value || draft.auto_slug) idInput.value = nextSlug;
          if (!slugInput.value || draft.auto_slug) slugInput.value = nextSlug;
        };
        idInput.addEventListener('input', () => { draft.auto_slug = false; });
        slugInput.addEventListener('input', () => { draft.auto_slug = false; });
        nameInput.addEventListener('input', syncIds);
      } else {
        const workspaceOptions = ['<option value="">Select runtime workspace</option>']
          .concat(workspaces.map(ws => '<option value="' + ws.id + '"' + (ws.id === draft.workspace_id ? ' selected' : '') + '>' + esc(ws.name) + ' - ' + esc(ws.workingDir || 'no working dir') + '</option>'))
          .join('');
        const workspaceCreateBlock = draft.workspace_mode === 'create'
          ? '<label>Runtime Workspace Name</label><input type="text" id="dlg-product-workspace-name" value="' + esc(draft.workspace_name || (draft.name ? (draft.name + ' Runtime') : '')) + '">' +
            '<label>Workspace Description</label><input type="text" id="dlg-product-workspace-description" value="' + esc(draft.workspace_description) + '" placeholder="Optional execution context description">'
          : '';
        const workspaceExistingBlock = draft.workspace_mode === 'existing'
          ? '<label>Existing Runtime Workspace</label><select id="dlg-product-workspace-id">' + workspaceOptions + '</select>'
          : '';

        body.innerHTML = stepper +
          '<label>Product Directory</label><div class="inline-field-row"><input type="text" id="dlg-product-path" value="' + esc(draft.local_path) + '" placeholder="C:\\Projects\\zapcam" style="flex:1"><button class="btn btn-sm" id="dlg-product-path-browse" type="button">&#128193;</button></div>' +
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
            const result = await api('/products', {
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
            hideDialog();
            activeProductId = result.product.product_id;
            if (result.detail) productDetails[result.product.product_id] = result.detail;
            await loadWorkspaces();
            await loadAllSessions();
            await loadProducts(true);
            if (result.detail && result.detail.workspace && result.detail.workspace.runtime_workspace_id) {
              setActiveWorkspace(result.detail.workspace.runtime_workspace_id);
            }
            switchView('products');
            renderWorkspaceList();
            renderCurrentView();
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
              const data = await api('/browse?path=' + encodeURIComponent(currentDir));
              showDirBrowser(data, (selectedPath) => {
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

  function metaItem(label, value) {
    return '<div><span class="meta-item-label">' + esc(label) + '</span><span class="mono">' + esc(value || 'unknown') + '</span></div>';
  }

  function resolveCurrentRun(detail) {
    if (!detail) return null;
    if (detail.current_run && typeof detail.current_run === 'object') return detail.current_run;
    if (detail.active_run && typeof detail.active_run === 'object') return detail.active_run;
    const runs = Array.isArray(detail.runs) ? detail.runs : [];
    return runs.find(run => ['active', 'running', 'in-progress'].includes(run.status)) || runs[0] || null;
  }

  function normalizeOutputList(values) {
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

  function normalizeOutputRecords(values) {
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

  function findLatestIncomingHandoff(detail, stageId) {
    const handoffs = Array.isArray(detail && detail.handoffs) ? detail.handoffs : [];
    const matching = handoffs
      .filter(item => (item.to_stage || '') === stageId)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    return matching[0] || null;
  }

  function buildOutputReferenceChips(items, emptyText) {
    const normalized = normalizeOutputRecords(items);
    if (!normalized.length) {
      return '<div class="artifact-row-meta">' + esc(emptyText || 'No outputs linked.') + '</div>';
    }
    return '<div class="chip-row">' + normalized.map(item => '<span class="chip ' + (item.required ? 'warn' : 'subtle') + '">' + esc(item.label) + '</span>').join('') + '</div>';
  }

  function buildOutputChecklist(items, idPrefix, selectedRefs, dataAttrName) {
    const normalized = normalizeOutputRecords(items);
    if (!normalized.length) return '<div class="artifact-row-meta">No outputs available from the current run.</div>';
    const selected = new Set((selectedRefs || []).filter(Boolean));
    const attrName = dataAttrName || 'data-handoff-output-ref';
    return '<div class="handoff-output-checklist">' + normalized.map((item, index) => {
      const refValue = item.output_id || item.ref_id || ('output-' + index);
      const checkboxId = idPrefix + '-' + index;
      const checked = selected.size === 0 || selected.has(refValue) || selected.has(item.ref_id);
      return '<label class="handoff-output-option" for="' + esc(checkboxId) + '"><input type="checkbox" id="' + esc(checkboxId) + '" ' + attrName + '="' + esc(refValue) + '"' + (checked ? ' checked' : '') + '><span>' + esc(item.label) + '</span><span class="chip subtle">' + esc(item.type || 'output') + '</span></label>';
    }).join('') + '</div>';
  }

  function pickPrimaryRunSession(run, detail) {
    if (!run) return null;
    const runSessions = resolveRunSessions(run, detail);
    if (!runSessions.length) return null;
    const primaryId = run.primary_session_id || run.current_session_id || '';
    return runSessions.find(item => item.id === primaryId) || runSessions[0];
  }

  function pickCarryForwardOutputs(run) {
    const produced = normalizeOutputRecords(run && run.produced_outputs);
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

  function buildCompletionDraft(detail, run, fromStage, toStage, primarySession) {
    const productName = detail && detail.name ? detail.name : 'this product';
    const producedOutputs = pickCarryForwardOutputs(run).map(item => item.label).filter(Boolean);
    const objective = run && run.objective ? run.objective : '';
    const knowledge = resolveRunKnowledge(run, detail);
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

  function getCheckedValues(selector, attrName) {
    const attribute = attrName || 'data-handoff-output-ref';
    return Array.from(document.querySelectorAll(selector))
      .filter(input => input.checked)
      .map(input => input.getAttribute(attribute) || '')
      .filter(Boolean);
  }

  function resolveLatestHandoff(handoffs) {
    const list = Array.isArray(handoffs) ? handoffs.slice() : [];
    return list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0] || null;
  }

  function buildHandoffSummaryInline(handoff) {
    if (!handoff) return '';
    return '<div class="handoff-inline"><strong>' + esc((handoff.from_stage || 'unknown') + ' -> ' + (handoff.to_stage || 'unknown')) + '</strong><div class="artifact-row-meta">' + esc(handoff.summary || 'No summary recorded.') + '</div></div>';
  }

  function resolveLatestHandoff(handoffs) {
    const list = Array.isArray(handoffs) ? handoffs.slice() : [];
    return list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0] || null;
  }

  function buildHandoffSummaryInline(handoff) {
    if (!handoff) return '';
    return '<div class="handoff-inline"><strong>' + esc((handoff.from_stage || 'unknown') + ' -> ' + (handoff.to_stage || 'unknown')) + '</strong><div class="artifact-row-meta">' + esc(handoff.summary || 'No summary recorded.') + '</div></div>';
  }

  function normalizePresetType(type) {
    if (!type) return '';
    return String(type).toLowerCase() === 'workflow' ? 'workflow' : 'skill';
  }

  function buildPresetLabel(type, id, explicitLabel) {
    if (explicitLabel) return explicitLabel;
    if (!id) return '';
    const normalizedType = normalizePresetType(type);
    return normalizedType ? (normalizedType + ' ' + id) : String(id);
  }

  function buildKnowledgeDriverInline(driver) {
    if (!driver) return '';
    const packName = driver.knowledge_pack_name || driver.name || driver.knowledge_pack_id || 'knowledge-pack';
    const presetType = normalizePresetType(driver.preset_type || driver.type || '');
    const presetId = driver.preset_id || driver.id || '';
    const presetLabel = buildPresetLabel(presetType, presetId, driver.preset_label || driver.label || '');
    return '<div class="knowledge-driver-inline"><span class="chip knowledge">' + esc(packName) + '</span>' + (presetLabel ? '<span class="chip subtle">' + esc(presetLabel) + '</span>' : '') + '</div>';
  }

  function getRecommendationPresets(rec) {
    if (!rec || typeof rec !== 'object') return [];
    const explicit = Array.isArray(rec.available_presets) ? rec.available_presets
      : (Array.isArray(rec.presets) ? rec.presets : []);
    const normalizedExplicit = explicit.map((item, index) => {
      const presetType = normalizePresetType(item.preset_type || item.type || '');
      const presetId = item.preset_id || item.id || '';
      const presetLabel = buildPresetLabel(presetType, presetId, item.preset_label || item.label || '');
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
      preset_label: buildPresetLabel('workflow', item),
      is_default: index === 0
    })).concat(skills.map((item, index) => ({
      knowledge_pack_id: rec.knowledge_pack_id || '',
      knowledge_pack_name: rec.knowledge_pack_name || '',
      preset_type: 'skill',
      preset_id: item,
      preset_label: buildPresetLabel('skill', item),
      is_default: workflows.length === 0 && index === 0
    })));
  }

  function resolvePresetFromRecommendation(rec) {
    const presets = getRecommendationPresets(rec);
    return presets.find(item => item.is_default) || presets[0] || null;
  }

  function resolveStageKnowledgeEntries(detail, stageId) {
    if (!detail || !stageId) return [];
    const stages = Array.isArray(detail.knowledge_stage_recommendations) ? detail.knowledge_stage_recommendations : [];
    const stage = stages.find(item => item.stage_id === stageId);
    if (!stage) return [];
    return Array.isArray(stage.recommendations) ? stage.recommendations : [];
  }

  function resolveStageDefaultPreset(detail, stageId) {
    const recommendations = resolveStageKnowledgeEntries(detail, stageId);
    for (const rec of recommendations) {
      const preset = resolvePresetFromRecommendation(rec);
      if (preset) return preset;
    }
    return null;
  }

  function resolveActionKnowledge(action, detail, stageId) {
    if (!action) return null;
    if (action.knowledge_pack_id || action.preset_id || action.preset_label) {
      return {
        knowledge_pack_id: action.knowledge_pack_id || '',
        knowledge_pack_name: action.knowledge_pack_name || '',
        preset_type: normalizePresetType(action.preset_type || ''),
        preset_id: action.preset_id || '',
        preset_label: buildPresetLabel(action.preset_type, action.preset_id, action.preset_label)
      };
    }
    return resolveStageDefaultPreset(detail, stageId);
  }

  function resolveRunKnowledge(run, detail) {
    if (!run) return null;
    if (run.knowledge_pack_id || run.preset_id || run.preset_label) {
      return {
        knowledge_pack_id: run.knowledge_pack_id || '',
        knowledge_pack_name: run.knowledge_pack_name || '',
        preset_type: normalizePresetType(run.preset_type || ''),
        preset_id: run.preset_id || '',
        preset_label: buildPresetLabel(run.preset_type, run.preset_id, run.preset_label)
      };
    }
    return resolveStageDefaultPreset(detail, run.stage_id || run.stageId || detail.current_stage_id);
  }

  function resolveRunSessions(run, detail) {
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

  function buildHandoffHistoryPanel(detail) {
    const handoffs = Array.isArray(detail && detail.handoffs) ? detail.handoffs : [];
    if (!handoffs.length) return '<p>No stage completions recorded yet.</p>';
    const currentRun = resolveCurrentRun(detail);
    const currentRunId = currentRun ? (currentRun.run_id || currentRun.id || '') : '';
    return '<div class="handoff-list">' + handoffs.map(handoff => {
      const fromCurrentRun = currentRunId && (handoff.run_id || handoff.runId || '') === currentRunId;
      return '<div class="handoff-row">' +
        '<div class="product-row"><strong>' + esc(handoff.from_stage) + ' -> ' + esc(handoff.to_stage) + '</strong><div class="chip-row"><span class="chip">' + esc(handoff.role || 'unknown-role') + '</span>' + (fromCurrentRun ? '<span class="chip knowledge">from current run</span>' : '') + '</div></div>' +
        '<div class="handoff-summary">' + esc(handoff.summary || '') + '</div>' +
        '<details class="inline-details"><summary>Technical context</summary><div class="inline-details-body"><div class="handoff-meta-grid">' +
          metaItem('Run', handoff.run_id || 'none') +
          metaItem('Session', handoff.session_id || 'none') +
          metaItem('Runtime', handoff.runtime_agent || 'unknown-agent') +
          metaItem('Created', formatDateTime(handoff.created_at)) +
        '</div>' +
        (handoff.knowledge_driver ? '<div class="action-row-meta"><span class="meta-item-label">Knowledge Driver</span>' + buildKnowledgeDriverInline(handoff.knowledge_driver) + '</div>' : '') +
        '<div class="action-row-meta"><span class="meta-item-label">Artifacts</span>' + buildOutputReferenceChips((handoff.artifact_refs || []).map(item => ({ label: item })), 'No artifacts referenced.') + '</div>' +
        '<div class="action-row-meta"><span class="meta-item-label">Outputs</span>' + buildOutputReferenceChips((handoff.output_refs || []).map(item => ({ label: item })), 'No outputs referenced.') + '</div></div></details>' +
      '</div>';
    }).join('') + '</div>';
  }

  function buildCurrentRunPanel(detail, run) {
    if (!run) {
      return '<div class="run-empty"><strong>No coordinated run active</strong><p class="empty-subtext">Execute a next action or start a stage to create the first tracked run for this product.</p></div>';
    }

    const runId = run.id || run.run_id || 'run-pending';
    const expectedOutputs = normalizeOutputRecords(run.expected_outputs || run.outputs_expected || []);
    const producedOutputs = normalizeOutputRecords(run.produced_outputs || run.outputs_produced || run.outputs || []);
    const runSessions = resolveRunSessions(run, detail);
    const stageId = run.stage_id || run.stageId || detail.current_stage_id || detail.computed_stage_signal || 'idea';
    const role = run.role || run.recommended_role || 'unassigned';
    const runtimeAgent = run.suggested_runtime_agent || run.runtime_agent || run.recommended_runtime_agent || 'unspecified';
    const workspaceName = ((detail.workspace || {}).linked_workspace_name || (detail.workspace || {}).runtime_workspace_id || 'none');
    const knowledge = resolveRunKnowledge(run, detail);
    const latestHandoff = run.latest_handoff || ((run.linked_handoffs || [])[0]) || null;
    const incomingHandoff = Array.isArray(run.incoming_handoffs) && run.incoming_handoffs.length ? run.incoming_handoffs[0] : null;
    const primarySession = pickPrimaryRunSession(run, detail);
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
      '<div class="run-status-row"><div><div class="run-kicker">Execution</div><div class="artifact-row-meta">Current stage in motion</div></div><div class="chip-row"><span class="status-pill ' + esc(run.status || 'in-progress') + '">' + esc(stageStatusLabel(run.status || 'in-progress')) + '</span><span class="chip">' + esc(stageId) + '</span><span class="chip">' + esc(role) + '</span><span class="chip">' + esc(runtimeAgent) + '</span></div></div>' +
      '<div class="run-objective">' + esc(run.objective || 'No run objective registered yet.') + '</div>' +
      (run.is_ready_to_complete ? '<div class="summary-callout ok"><span class="meta-item-label">Ready to complete</span><div class="artifact-row-meta">This run has linked execution context and produced outputs that can be carried into the next stage.</div></div>' : '') +
      (run.pre_run_hash ? '<div class="summary-callout warn" style="margin-top:8px"><span class="meta-item-label">Safe Checkpoint Available</span><div class="artifact-row-meta">This run started from a clean repository state (' + esc(run.pre_run_hash.substring(0, 7)) + '). You can safely discard all changes if things go wrong.</div></div>' : '') +
      '<div class="meta-list run-meta-list">' +
      metaItem('Product', detail.name) +
      metaItem('Stage', stageId) +
      metaItem('Linked Sessions', String(runSessions.length)) +
      metaItem('Handoffs', String(handoffCount)) +
      metaItem('Required Outputs', String(completion.required_produced_total || 0) + '/' + String(completion.required_expected_total || 0)) +
      metaItem('Outputs', String(completion.produced_total || 0) + '/' + String(completion.expected_total || 0)) +
      metaItem('Updated', formatDateTime(run.updated_at || run.created_at || Date.now())) +
      '</div>' +
      ((knowledge || incomingHandoff || latestHandoff || primarySession) ? '<details class="inline-details"><summary>Execution details</summary><div class="inline-details-body"><div class="meta-list run-meta-list">' +
        metaItem('Run ID', runId) +
        metaItem('Runtime Workspace', workspaceName) +
        metaItem('Primary Session', primarySession ? primarySession.id : 'none') +
        '</div>' +
        (knowledge ? '<div class="run-card"><span class="meta-item-label">Knowledge Driver</span>' + buildKnowledgeDriverInline(knowledge) + '<div class="artifact-row-meta" style="margin-top:8px">This execution was started from a curated preset.</div></div>' : '') +
        (incomingHandoff ? '<div class="run-card"><span class="meta-item-label">Incoming Context</span><div class="handoff-summary">' + esc(incomingHandoff.summary || '') + '</div><div class="artifact-row-meta" style="margin-top:8px">' + esc((incomingHandoff.from_stage || 'unknown') + ' -> ' + (incomingHandoff.to_stage || stageId)) + '</div>' + buildOutputReferenceChips((incomingHandoff.output_refs || []).map(item => ({ label: item })), 'No outputs referenced from the previous stage.') + '</div>' : '') +
        (latestHandoff ? '<div class="run-card"><div class="product-row"><span class="meta-item-label">Latest Completion</span><span class="artifact-row-meta">' + esc(formatDateTime(latestHandoff.created_at)) + '</span></div><div class="handoff-summary">' + esc(latestHandoff.summary || '') + '</div><div class="artifact-row-meta" style="margin-top:8px">' + esc((latestHandoff.from_stage || stageId) + ' -> ' + (latestHandoff.to_stage || 'unknown')) + '</div>' + ((run.next_stage_hint || latestHandoff.to_stage) ? '<div class="artifact-row-meta" style="margin-top:6px">Next stage hint: ' + esc(run.next_stage_hint || latestHandoff.to_stage) + '</div>' : '') + '</div>' : '') +
      '</div></details>' : '') +
      '<div class="run-body-grid">' +
        '<div class="run-card"><span class="meta-item-label">Expected Outputs</span>' + buildRunOutputList(expectedOutputs, 'No expected outputs declared.') + '</div>' +
        '<div class="run-card"><span class="meta-item-label">Produced Outputs</span>' + buildCategorizedOutputList(producedOutputs) + '</div>' +
      '</div>' +
      '<div class="run-card" style="margin-top:12px"><div class="product-row"><span class="meta-item-label">Run Sessions</span><span class="artifact-row-meta">' + esc(String(runSessions.length)) + ' linked</span></div>' +
      (runSessions.length
        ? '<div class="run-session-list">' + runSessions.map(session => '<div class="run-session-row"><div><strong>' + esc(session.name) + '</strong><div class="artifact-row-meta">' + esc((session.agent || 'agent') + ' | ' + (session.status || 'unknown')) + '</div></div><div class="chip-row"><button class="btn btn-sm" data-run-action="open-session" data-session-id="' + esc(session.id) + '">Open</button>' + (session.status === 'running' ? '<button class="btn btn-sm" data-run-action="restart-session" data-session-id="' + esc(session.id) + '">Restart</button>' : '<button class="btn btn-sm btn-primary" data-run-action="start-session" data-session-id="' + esc(session.id) + '">Start</button>') + '</div></div>').join('') + '</div>'
        : '<p class="empty-subtext" style="margin-top:8px">This run has no linked sessions yet. Executing the next action or starting the current stage will attach the first executor session.</p>') +
      '</div>' +
      (stageId !== 'idea' ? '<div class="step-card-actions run-primary-actions"><button class="btn btn-primary" data-run-action="complete-stage" data-stage-id="' + esc(stageId) + '">Complete Current Stage</button>' + (run.pre_run_hash ? '<button class="btn" style="color:var(--text-warn)" data-run-action="discard-run" data-run-id="' + esc(runId) + '">Discard Run Changes</button>' : '') + '</div>' : '') +
      '</div>';
  }

  function buildRunOutputList(items, emptyText) {
    const normalized = normalizeOutputRecords(items);
    if (!normalized.length) return '<p class="empty-subtext">' + esc(emptyText) + '</p>';
    return '<div class="run-output-list">' + normalized.map(item => '<div class="run-output-row"><span class="chip ' + (item.required ? 'warn' : 'subtle') + '">' + esc(item.label) + '</span>' + (item.type ? '<span class="artifact-row-meta">' + esc(item.type) + '</span>' : '') + '</div>').join('') + '</div>';
  }

  function buildCategorizedOutputList(items) {
    var normalized = normalizeOutputRecords(items);
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
        return '<div class="run-output-row"><span class="chip ' + (cat === 'evidence' ? 'ok' : cat === 'metadata' ? '' : 'subtle') + '">' + esc(item.label) + '</span>' + (item.type ? '<span class="artifact-row-meta">' + esc(item.type) + '</span>' : '') + '</div>';
      }).join('') + '</div></div>';
    });
    return html;
  }

  function stageSignalClass(stageId) {
    if (['implementation', 'test', 'release'].includes(stageId)) return 'ok';
    if (['architecture', 'spec'].includes(stageId)) return 'warn';
    return '';
  }

  function stageStatusLabel(status) {
    if (status === 'in-progress') return 'in progress';
    if (status === 'not-started') return 'not started';
    return status || 'unknown';
  }

  function formatDateTime(ts) {
    if (!ts) return 'unknown';
    try { return new Date(ts).toLocaleString('pt-BR'); } catch { return 'unknown'; }
  }

  // ============ TERMINAL GRID ============
  function renderTerminalView() {
    const grid = document.getElementById('terminal-grid');
    const workspaceSessions = activeWorkspaceId
      ? allSessions.filter(s => s.workspaceId === activeWorkspaceId)
      : [];
    const stopAllBtn = document.getElementById('btn-stop-all-sessions');
    if (stopAllBtn) stopAllBtn.disabled = !activeWorkspaceId || !workspaceSessions.some(s => s.status === 'running');
    const terminalSlots = getTerminalSlots(activeWorkspaceId);
    const maxPanes = gridLayout === 4 ? 4 : (gridLayout === 2 ? 2 : 1);

    if (!activeWorkspaceId) {
      grid.className = 'grid-1';
      grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#9889;</div><div class="empty-state-text">Select a runtime workspace to start</div><div class="empty-subtext">Products are the delivery unit. Drag a runtime workspace here only when you want to operate sessions.</div></div>';
      bindTerminalGridDropZone(grid, null);
      return;
    }

    if (!workspaceSessions.length) {
      grid.className = 'grid-1';
      grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#9889;</div><div class="empty-state-text">No sessions in this runtime workspace</div><div class="empty-subtext">Create one or drag a session here after linking the runtime workspace.</div><button class="btn btn-primary" onclick="window._app.newSession()">+ New Session</button></div>';
      bindTerminalGridDropZone(grid, null);
      return;
    }

    grid.className = 'grid-' + maxPanes;

    closeAllTerminals();
    grid.innerHTML = '';
    bindTerminalGridDropZone(grid, null);

    for (let i = 0; i < maxPanes; i++) {
      const sessionId = terminalSlots[i];
      const session = sessionId ? workspaceSessions.find(s => s.id === sessionId) : null;

      const paneEl = document.createElement('div');
      paneEl.className = 'terminal-pane' + (session ? '' : ' terminal-pane-empty');
      paneEl.dataset.slotIndex = String(i);
      bindTerminalPaneDropZone(paneEl, i);

      if (!session) {
        paneEl.innerHTML = '<div class="terminal-pane-header"><div class="terminal-pane-title">Pane ' + (i + 1) + '</div></div><div class="terminal-pane-body"><div class="empty-state"><div class="empty-state-icon">&#10515;</div><div class="empty-state-text">Drop a session here</div><div class="empty-subtext">Drag a session from the runtime workspace sidebar into this slot.</div></div></div>';
        grid.appendChild(paneEl);
        continue;
      }

      const sessionMeta = AGENT_META[session.agent] ? AGENT_META[session.agent].icon : '?';
      const actions = '<button onclick="window._app.startSession(\'' + session.id + '\')" title="Start">&#9654;</button><button onclick="window._app.restartSession(\'' + session.id + '\')" title="Restart">&#8635;</button><button onclick="window._app.stopSession(\'' + session.id + '\')" title="Stop">&#9209;</button><button onclick="window._app.closeTerminalPane(\'' + session.id + '\')" title="Close Pane">&#10005;</button>';
      const modelMeta = [session.model || '', session.effort ? ('effort:' + session.effort) : ''].filter(Boolean).join(' | ');
      paneEl.innerHTML = '<div class="terminal-pane-header"><div class="terminal-pane-title"><span class="agent-badge ' + session.agent + '">' + sessionMeta + '</span>' + esc(session.name) + '<span style="color:var(--text-muted); font-size:10px">' + esc(modelMeta) + '</span></div><div class="terminal-pane-actions">' + actions + '</div></div><div class="terminal-pane-body" id="term-body-' + session.id + '"></div>';

      grid.appendChild(paneEl);
      const bodyEl = paneEl.querySelector('.terminal-pane-body');
      if (session.status === 'running' || startingSessionIds.has(session.id)) {
        createTerminal(session.id, bodyEl);
      } else {
        bodyEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#9209;</div><div class="empty-state-text">Session is ' + esc(stageStatusLabel(session.status || 'stopped')) + '</div><div style="display:flex;gap:8px"><button class="btn btn-primary" onclick="window._app.startSession(\'' + session.id + '\')">Start</button><button class="btn" onclick="window._app.restartSession(\'' + session.id + '\')">Restart</button><button class="btn" onclick="window._app.closeTerminalPane(\'' + session.id + '\')">Close</button></div></div>';
      }
    }

    if (workspaceSessions.length > maxPanes) {
      const extra = document.createElement('div');
      extra.style.cssText = 'padding:8px 12px;font-size:12px;color:var(--text-muted);background:var(--bg-secondary);border-top:1px solid var(--border)';
      extra.textContent = '+' + Math.max(0, workspaceSessions.length - terminalSlots.filter(Boolean).length) + ' more sessions available in this runtime workspace';
      grid.appendChild(extra);
    }
  }

  function closeTerminalPane(sessionId) {
    if (!sessionId) return;
    startingSessionIds.delete(sessionId);
    closedTerminalSessionIds.add(sessionId);
    if (activeWorkspaceId) {
      setTerminalSlots(activeWorkspaceId, getTerminalSlots(activeWorkspaceId).filter(id => id !== sessionId));
    }
    closeTerminal(sessionId);
    renderTerminalView();
  }

  function reopenClosedTerminals() {
    closedTerminalSessionIds = new Set();
    ensureTerminalSlots(activeWorkspaceId);
    renderTerminalView();
  }

  function bindTerminalGridDropZone(grid, targetIndex) {
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
      handleTerminalDrop(e.dataTransfer.getData('text/plain'), targetIndex);
    };
  }

  function bindTerminalPaneDropZone(paneEl, targetIndex) {
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
      handleTerminalDrop(e.dataTransfer.getData('text/plain'), targetIndex);
    });
  }

  function createTerminal(sessionId, container) {
    if (typeof Terminal === 'undefined') {
      container.textContent = 'xterm.js not loaded';
      container.style.cssText = 'padding:20px;color:var(--text-muted)';
      return;
    }

    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      theme: getTerminalTheme(),
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
    const wsUrl = wsProto + '//' + location.host + '/ws/terminal?token=' + token + '&sessionId=' + sessionId + '&cols=' + term.cols + '&rows=' + term.rows;
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

    terminalPanes.push({
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

  function closeAllTerminals() {
    for (var i = 0; i < terminalPanes.length; i++) {
      try { terminalPanes[i].ws.close(); } catch (e) { /* ignore */ }
      try { terminalPanes[i].term.dispose(); } catch (e) { /* ignore */ }
    }
    terminalPanes = [];
  }

  function closeTerminal(sessionId) {
    if (!sessionId) return;
    terminalPanes = terminalPanes.filter(function(pane) {
      if (pane.sessionId !== sessionId) return true;
      try { if (pane.cleanup) pane.cleanup(); } catch (e) { /* ignore */ }
      try { pane.ws.close(); } catch (e) { /* ignore */ }
      try { pane.term.dispose(); } catch (e) { /* ignore */ }
      return false;
    });
  }

  // ============ COST DASHBOARD ============
  async function renderCostDashboard() {
    var container = document.getElementById('cost-content');
    container.textContent = 'Loading cost data...';
    container.className = 'loading';
    container.style.cssText = 'padding:20px;color:var(--text-muted)';

    try {
      var data = await api('/cost/dashboard');
      var maxCost = Math.max.apply(null, Object.values(data.byAgent).map(function(a) { return a.cost; }).concat([0.01]));

      var html = '<div class="cost-cards"><div class="cost-card"><div class="cost-card-label">Total Spent</div><div class="cost-card-value">$' + data.totalCost.toFixed(2) + '</div><div class="cost-card-sub">' + formatTokens(data.totalTokens) + ' tokens</div></div>';

      Object.entries(data.byAgent).forEach(function(entry) {
        var agent = entry[0], info = entry[1];
        var meta = AGENT_META[agent] || { icon: '?', name: agent, color: '#888' };
        html += '<div class="cost-card"><div class="cost-card-label"><span class="agent-badge ' + agent + '" style="margin-right:4px">' + meta.icon + '</span>' + meta.name + '</div><div class="cost-card-value" style="color:' + meta.color + '">$' + info.cost.toFixed(2) + '</div><div class="cost-card-sub">' + formatTokens(info.tokens) + ' tokens</div></div>';
      });
      html += '</div>';

      html += '<h3 style="font-size:14px;margin-bottom:12px">By Agent</h3>';
      Object.entries(data.byAgent).forEach(function(entry) {
        var agent = entry[0], info = entry[1];
        var meta = AGENT_META[agent] || { name: agent, color: '#888' };
        var pct = (info.cost / maxCost) * 100;
        html += '<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:12px"><span>' + meta.name + '</span><span>$' + info.cost.toFixed(2) + '</span></div><div class="cost-bar"><div class="cost-bar-fill" style="width:' + pct + '%;background:' + meta.color + '"></div></div></div>';
      });

      if (Object.keys(data.byModel).length) {
        html += '<h3 style="font-size:14px;margin:20px 0 12px">By Model</h3>';
        html += '<table class="cost-table"><thead><tr><th>Model</th><th>Cost</th><th>Tokens</th></tr></thead><tbody>';
        var sortedModels = Object.entries(data.byModel).sort(function(a, b) { return b[1].cost - a[1].cost; });
        sortedModels.forEach(function(entry) {
          html += '<tr><td style="font-family:var(--font-mono);font-size:12px">' + esc(entry[0]) + '</td><td>$' + entry[1].cost.toFixed(4) + '</td><td>' + formatTokens(entry[1].tokens) + '</td></tr>';
        });
        html += '</tbody></table>';
      }

      if (data.topSessions && data.topSessions.length) {
        html += '<h3 style="font-size:14px;margin:20px 0 12px">Top Sessions by Cost</h3>';
        html += '<table class="cost-table"><thead><tr><th>Session</th><th>Agent</th><th>Cost</th><th>Tokens</th></tr></thead><tbody>';
        data.topSessions.forEach(function(s) {
          var meta = AGENT_META[s.agent] || { icon: '?' };
          html += '<tr><td>' + esc(s.name) + '</td><td><span class="agent-badge ' + s.agent + '">' + meta.icon + '</span></td><td>$' + s.cost.toFixed(4) + '</td><td>' + formatTokens(s.tokens) + '</td></tr>';
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
  function renderSessionHistory() {
    var container = document.getElementById('history-content');
    if (!allSessions.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128203;</div><div class="empty-state-text">No sessions found</div></div>';
      return;
    }

    var sorted = allSessions.slice().sort(function(a, b) { return b.updatedAt - a.updatedAt; });

    container.innerHTML = sorted.map(function(s) {
      var ws = workspaces.find(function(w) { return w.id === s.workspaceId; });
      var age = timeAgo(s.updatedAt);
      var meta = AGENT_META[s.agent] || { icon: '?' };
      return '<div class="session-row" data-id="' + s.id + '"><span class="session-status ' + s.status + '"></span><span class="agent-badge ' + s.agent + '">' + meta.icon + '</span><span class="session-name">' + esc(s.name) + '</span><span class="session-meta">' + (ws ? esc(ws.name) : 'Unassigned') + '</span><span class="session-meta">' + esc([s.model || '', s.effort ? ('effort:' + s.effort) : ''].filter(Boolean).join(' | ')) + '</span><span class="session-meta">' + age + '</span><button class="btn btn-sm" onclick="window._app.startSession(\'' + s.id + '\');event.stopPropagation()">&#9654;</button><button class="btn btn-sm" title="Restart Session" onclick="window._app.restartSession(\'' + s.id + '\');event.stopPropagation()">&#8635;</button><button class="btn btn-sm" title="Delete Session" onclick="window._app.deleteSession(\'' + s.id + '\');event.stopPropagation()">&#128465;</button></div>';
    }).join('');
  }

  // ============ DISCOVERY ============
  async function renderDiscovery() {
    var container = document.getElementById('discover-content');
    container.textContent = 'Click "Scan" to discover sessions...';
    container.className = 'loading';
    container.style.cssText = 'padding:20px;color:var(--text-muted)';
  }

  async function runDiscovery() {
    var container = document.getElementById('discover-content');
    container.textContent = 'Scanning for sessions...';
    container.className = 'loading';

    try {
      var data = await api('/agents/discover', { method: 'POST' });
      var html = '<div style="margin-bottom:12px;font-size:13px;color:var(--text-secondary)">' + data.total + ' sessions found</div>';

      if (data.claude && data.claude.length) {
        html += '<h3 style="font-size:14px;margin-bottom:10px"><span class="agent-badge claude">C</span> Claude Code Sessions</h3>';
        data.claude.slice(0, 20).forEach(function(s) {
          html += '<div class="discover-item"><span class="agent-badge claude">C</span><div class="discover-item-info"><div class="discover-item-topic">' + esc(s.topic || s.resumeSessionId) + '</div><div class="discover-item-path">' + esc(s.projectPath || s.projectDir) + ' &middot; ' + timeAgo(s.lastActive) + '</div></div><button class="btn btn-sm btn-primary" onclick="window._app.importSession(\'claude\', ' + JSON.stringify(JSON.stringify(s)) + ')">Import</button></div>';
        });
      }

      if (data.codex && data.codex.length) {
        html += '<h3 style="font-size:14px;margin:16px 0 10px"><span class="agent-badge codex">X</span> Codex Sessions</h3>';
        data.codex.forEach(function(s) {
          html += '<div class="discover-item"><span class="agent-badge codex">X</span><div class="discover-item-info"><div class="discover-item-topic">' + esc(s.topic || 'Codex session') + '</div></div></div>';
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

  // ============ DIRECTORY BROWSER ============
  function showDirBrowser(data, onSelect) {
    document.getElementById('dialog-title').textContent = 'Select Directory';

    function render(d) {
      var html = '<div style="margin-bottom:8px;padding:6px 10px;background:var(--bg-tertiary);border-radius:var(--radius-sm);font-size:12px;font-family:var(--font-mono);word-break:break-all">' + esc(d.path) + '</div>';
      html += '<div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-primary)">';

      if (d.parent) {
        html += '<div class="dir-item" data-path="' + esc(d.parent) + '" style="padding:6px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);color:var(--accent)">&#128193; ..</div>';
      }

      d.dirs.forEach(function(dir) {
        var fullPath = (d.path.endsWith('\\') || d.path.endsWith('/')) ? d.path + dir : d.path + '\\' + dir;
        html += '<div class="dir-item" data-path="' + esc(fullPath) + '" style="padding:6px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border)">&#128193; ' + esc(dir) + '</div>';
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
            var newData = await api('/browse?path=' + encodeURIComponent(el.dataset.path));
            render(newData);
          } catch (ex) { /* ignore */ }
        });
      });
    }

    render(data);
  }

  // ============ DIALOGS ============
  function showDialog(title, bodyHTML, actions) {
    document.getElementById('dialog-title').textContent = title;
    document.getElementById('dialog-body').innerHTML = bodyHTML;
    var actionsEl = document.getElementById('dialog-actions');
    actionsEl.innerHTML = '';
    actions.forEach(function(action) {
      var btn = document.createElement('button');
      btn.className = 'btn ' + (action.primary ? 'btn-primary' : '');
      btn.textContent = action.label;
      btn.addEventListener('click', function() {
        hideDialog();
        action.onClick();
      });
      actionsEl.appendChild(btn);
    });
    document.getElementById('dialog-overlay').classList.remove('hidden');
  }

  function hideDialog() {
    document.getElementById('dialog-overlay').classList.add('hidden');
  }

  function showWorkspaceContextMenu(x, y, workspaceId) {
    const menu = document.getElementById('context-menu');
    const workspace = workspaces.find(ws => ws.id === workspaceId);
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
        hideContextMenu();
        if (action === 'edit') return editWorkspace(workspaceId);
        if (action === 'session') {
          setActiveWorkspace(workspaceId);
          renderWorkspaceList();
          return newSession();
        }
        if (action === 'delete') return deleteWorkspace(workspaceId);
      });
    });

    const rect = menu.getBoundingClientRect();
    const overflowX = rect.right - window.innerWidth;
    const overflowY = rect.bottom - window.innerHeight;
    if (overflowX > 0) menu.style.left = Math.max(8, x - overflowX - 8) + 'px';
    if (overflowY > 0) menu.style.top = Math.max(8, y - overflowY - 8) + 'px';
  }

  function hideContextMenu() {
    const menu = document.getElementById('context-menu');
    if (!menu) return;
    menu.classList.add('hidden');
    menu.innerHTML = '';
    contextMenuWorkspaceId = null;
  }

  // ============ ACTIONS ============
  function newWorkspace(draft) {
    const state = Object.assign({
      name: '',
      description: '',
      workingDir: '',
      color: '#6366f1'
    }, draft || {});

    showDialog('New Runtime Workspace', '<label>Workspace Name</label><input type="text" id="dlg-ws-name" placeholder="ZapCam Runtime" value="' + esc(state.name) + '"><label>Description</label><input type="text" id="dlg-ws-desc" placeholder="Optional execution context description" value="' + esc(state.description) + '"><label>Working Directory</label><div style="display:flex;gap:6px"><input type="text" id="dlg-ws-dir" placeholder="C:\\Projects\\my-app" value="' + esc(state.workingDir) + '" style="flex:1"><button class="btn btn-sm" id="dlg-ws-browse" type="button">&#128193;</button></div><label>Color</label><input type="color" id="dlg-ws-color" value="' + esc(state.color) + '" style="height:36px;padding:2px">', [
      { label: 'Cancel', onClick: function() {} },
      { label: 'Create', primary: true, onClick: async function() {
        var name = document.getElementById('dlg-ws-name').value.trim();
        if (!name) return;
        await api('/workspaces', {
          method: 'POST',
          body: JSON.stringify({
            name: name,
            description: document.getElementById('dlg-ws-desc').value,
            workingDir: document.getElementById('dlg-ws-dir').value,
            color: document.getElementById('dlg-ws-color').value
          })
        });
        await loadData();
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
            var data = await api('/browse?path=' + encodeURIComponent(currentDir));
            showDirBrowser(data, function(selectedPath) {
              newWorkspace({
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

  function editWorkspace(workspaceId, draft) {
    const ws = workspaces.find(w => w.id === workspaceId);
    if (!ws) return;
    const state = Object.assign({
      name: ws.name,
      description: ws.description || '',
      workingDir: ws.workingDir || '',
      color: ws.color || '#6366f1'
    }, draft || {});

    showDialog('Edit Runtime Workspace', '<label>Workspace Name</label><input type="text" id="dlg-edit-ws-name" value="' + esc(state.name) + '"><label>Description</label><input type="text" id="dlg-edit-ws-desc" value="' + esc(state.description) + '"><label>Working Directory</label><div style="display:flex;gap:6px"><input type="text" id="dlg-edit-ws-dir" value="' + esc(state.workingDir) + '" style="flex:1"><button class="btn btn-sm" id="dlg-edit-ws-browse" type="button">&#128193;</button></div><label>Color</label><input type="color" id="dlg-edit-ws-color" value="' + esc(state.color) + '" style="height:36px;padding:2px">', [
      { label: 'Cancel', onClick: function() {} },
      { label: 'Save', primary: true, onClick: async function() {
        const name = document.getElementById('dlg-edit-ws-name').value.trim();
        if (!name) return;
        await api('/workspaces/' + workspaceId, {
          method: 'PUT',
          body: JSON.stringify({
            name: name,
            description: document.getElementById('dlg-edit-ws-desc').value,
            workingDir: document.getElementById('dlg-edit-ws-dir').value,
            color: document.getElementById('dlg-edit-ws-color').value
          })
        });
        await loadWorkspaces();
        await loadAllSessions();
        await loadProducts(true);
        renderWorkspaceList();
        renderCurrentView();
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
            var data = await api('/browse?path=' + encodeURIComponent(currentDir));
            showDirBrowser(data, function(selectedPath) {
              editWorkspace(workspaceId, {
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

  async function deleteWorkspace(workspaceId) {
    const ws = workspaces.find(w => w.id === workspaceId);
    if (!ws) return;
    if (!confirm('Delete runtime workspace "' + ws.name + '" and its sessions?')) return;
    try {
      await api('/workspaces/' + workspaceId, { method: 'DELETE' });
      if (activeWorkspaceId === workspaceId) setActiveWorkspace(null);
      await loadWorkspaces();
      await loadAllSessions();
      await loadProducts(true);
      renderWorkspaceList();
      renderCurrentView();
    } catch (e) {
      console.error('Failed to delete workspace:', e);
    }
  }

  function newSession() {
    if (!activeWorkspaceId) {
      showDialog('Select a Runtime Workspace', '<p style="font-size:13px">Please select a runtime workspace first.</p>', [
        { label: 'OK', primary: true, onClick: function() {} }
      ]);
      return;
    }

    var ws = workspaces.find(function(w) { return w.id === activeWorkspaceId; });
    var defaultAgent = 'claude';

    function buildModelOptions(agent) {
      var models = getAgentCatalog(agent).models || [];
      if (!models.length) return '<option value="">Default</option>';
      return models.map(function(m, i) { return '<option value="' + m.id + '"' + (i === 0 ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('');
    }

    var wsDir = (ws && ws.workingDir) ? ws.workingDir : '';

    showDialog('New Session', '<label>Session Name</label><input type="text" id="dlg-sess-name" placeholder="Feature X"><label>Agent</label><select id="dlg-sess-agent"><option value="claude">Claude Code</option><option value="codex">Codex CLI</option><option value="gemini">Gemini CLI</option></select><label>Model</label><select id="dlg-sess-model">' + buildModelOptions(defaultAgent) + '</select><div id="dlg-sess-effort-wrap"><label>Effort</label><select id="dlg-sess-effort">' + buildEffortOptionsFor(defaultAgent) + '</select></div><label>Working Directory</label><div style="display:flex;gap:6px"><input type="text" id="dlg-sess-dir" placeholder="' + (wsDir || 'Inherits from runtime workspace') + '" value="' + wsDir + '" style="flex:1"><button class="btn btn-sm" id="dlg-sess-browse" type="button">&#128193;</button></div><label>Resume Session ID (Claude only)</label><input type="text" id="dlg-sess-resume" placeholder="Optional: paste session UUID">', [
      { label: 'Cancel', onClick: function() {} },
      { label: 'Create', primary: true, onClick: async function() {
        var name = document.getElementById('dlg-sess-name').value.trim();
        if (!name) return;
        await api('/sessions', {
          method: 'POST',
          body: JSON.stringify({
            name: name,
            workspaceId: activeWorkspaceId,
            agent: document.getElementById('dlg-sess-agent').value,
            workingDir: document.getElementById('dlg-sess-dir').value,
            model: document.getElementById('dlg-sess-model').value,
            effort: document.getElementById('dlg-sess-effort').value,
            resumeSessionId: document.getElementById('dlg-sess-resume').value
          })
        });
        await loadAllSessions();
        await loadProducts(true);
        renderWorkspaceList();
        renderCurrentView();
      }}
    ]);

    setTimeout(function() {
      var agentSelect = document.getElementById('dlg-sess-agent');
      var modelSelect = document.getElementById('dlg-sess-model');
      if (agentSelect && modelSelect) {
        updateEffortField(defaultAgent, 'dlg-sess-effort', 'dlg-sess-effort-wrap');
        agentSelect.addEventListener('change', function() {
          modelSelect.innerHTML = buildModelOptions(agentSelect.value);
          updateEffortField(agentSelect.value, 'dlg-sess-effort', 'dlg-sess-effort-wrap');
        });
      }

      var browseBtn = document.getElementById('dlg-sess-browse');
      if (browseBtn) {
        browseBtn.addEventListener('click', async function() {
          var currentDir = document.getElementById('dlg-sess-dir').value || wsDir || 'C:\\Users';
          try {
            var browseData = await api('/browse?path=' + encodeURIComponent(currentDir));
            var origTitle = document.getElementById('dialog-title').textContent;
            var origBody = document.getElementById('dialog-body').innerHTML;

            showDirBrowser(browseData, function(selectedPath) {
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
              cancelBtn.addEventListener('click', hideDialog);
              var createBtn = document.createElement('button');
              createBtn.className = 'btn btn-primary';
              createBtn.textContent = 'Create';
              createBtn.addEventListener('click', async function() {
                hideDialog();
                var n = document.getElementById('dlg-sess-name').value.trim();
                if (!n) return;
                await api('/sessions', {
                  method: 'POST',
                  body: JSON.stringify({
                    name: n,
                    workspaceId: activeWorkspaceId,
                    agent: document.getElementById('dlg-sess-agent').value,
                    workingDir: document.getElementById('dlg-sess-dir').value,
                    model: document.getElementById('dlg-sess-model').value,
                    effort: document.getElementById('dlg-sess-effort').value,
                    resumeSessionId: document.getElementById('dlg-sess-resume').value
                  })
                });
                await loadAllSessions();
                await loadProducts(true);
                renderWorkspaceList();
                renderCurrentView();
              });
              actionsEl.appendChild(cancelBtn);
              actionsEl.appendChild(createBtn);
            });
          } catch (e) { console.error(e); }
        });
      }
    }, 50);
  }

  async function startSession(id) {
    try {
      const session = allSessions.find(s => s.id === id);
      if (!session) return;
      if (session.status === 'running') {
        closedTerminalSessionIds.delete(id);
        startingSessionIds.delete(id);
        if (session.workspaceId) setActiveWorkspace(session.workspaceId);
        addSessionToTerminalSlots(id);
        renderWorkspaceList();
        switchView('terminals');
        renderCurrentView();
        return;
      }
      closedTerminalSessionIds.delete(id);
      startingSessionIds.add(id);
      if (session.workspaceId) setActiveWorkspace(session.workspaceId);
      addSessionToTerminalSlots(id);
      if (needsRestartCooldown(session)) await wait(900);
      await api('/sessions/' + id + '/start', { method: 'POST' });
      await loadAllSessions();
      await loadProducts(true);
      startingSessionIds.delete(id);
      renderWorkspaceList();
      switchView('terminals');
      renderCurrentView();
    } catch (e) {
      startingSessionIds.delete(id);
      console.error('Failed to start session:', e);
    }
  }

  async function restartSession(id) {
    try {
      const session = allSessions.find(s => s.id === id);
      if (!session) return;
      try {
        await api('/sessions/' + id + '/stop', { method: 'POST' });
      } catch (stopError) {
        console.warn('Stop before restart failed:', stopError);
      }
      closedTerminalSessionIds.delete(id);
      startingSessionIds.add(id);
      if (session.workspaceId) setActiveWorkspace(session.workspaceId);
      addSessionToTerminalSlots(id);
      await wait(1000);
      await api('/sessions/' + id + '/start', { method: 'POST' });
      await loadAllSessions();
      await loadProducts(true);
      startingSessionIds.delete(id);
      renderWorkspaceList();
      switchView('terminals');
      renderCurrentView();
    } catch (e) {
      startingSessionIds.delete(id);
      console.error('Failed to restart session:', e);
    }
  }

  async function stopSession(id) {
    try {
      startingSessionIds.delete(id);
      await api('/sessions/' + id + '/stop', { method: 'POST' });
      await loadAllSessions();
      await loadProducts(true);
      renderWorkspaceList();
      renderCurrentView();
    } catch (e) {
      console.error('Failed to stop session:', e);
    }
  }

  async function stopAllWorkspaceSessions() {
    if (!activeWorkspaceId) return;
    const workspace = workspaces.find(w => w.id === activeWorkspaceId);
    const runningSessions = allSessions.filter(s => s.workspaceId === activeWorkspaceId && s.status === 'running');
    if (!runningSessions.length) return;
    if (!confirm('Stop all running sessions in runtime workspace "' + (workspace ? workspace.name : activeWorkspaceId) + '"?')) return;
    try {
      for (const session of runningSessions) {
        startingSessionIds.delete(session.id);
        await api('/sessions/' + session.id + '/stop', { method: 'POST' });
      }
      await loadAllSessions();
      await loadProducts(true);
      renderWorkspaceList();
      renderCurrentView();
    } catch (e) {
      console.error('Failed to stop all sessions:', e);
    }
  }

  async function deleteSession(id) {
    if (!confirm('Delete this session?')) return;
    try {
      startingSessionIds.delete(id);
      await api('/sessions/' + id, { method: 'DELETE' });
      await loadAllSessions();
      await loadProducts(true);
      renderWorkspaceList();
      renderCurrentView();
    } catch (e) {
      console.error('Failed to delete session:', e);
    }
  }

  async function importSession(agent, metadataStr) {
    var metadata = JSON.parse(metadataStr);
    if (!activeWorkspaceId) {
      showDialog('Select a Runtime Workspace', '<p style="font-size:13px">Please select a runtime workspace to import into.</p>', [
        { label: 'OK', primary: true, onClick: function() {} }
      ]);
      return;
    }

    await api('/sessions', {
      method: 'POST',
      body: JSON.stringify({
        name: metadata.topic || metadata.resumeSessionId || 'Imported session',
        workspaceId: activeWorkspaceId,
        agent: agent,
        workingDir: metadata.projectPath || '',
        resumeSessionId: metadata.resumeSessionId || ''
      })
    });
    await loadAllSessions();
    await loadProducts(true);
    renderWorkspaceList();
    renderCurrentView();
  }

  // ============ UTILITIES ============
  // XSS-safe text escaping using textContent
  function esc(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function formatTokens(n) {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
  }

  function timeAgo(ts) {
    if (!ts) return '';
    var diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function needsRestartCooldown(session) {
    if (!session || !session.updatedAt) return false;
    return (Date.now() - session.updatedAt) < 2000;
  }

  // ============ EVENT BINDINGS ============
  function init() {
    document.getElementById('login-btn').addEventListener('click', function() {
      login(document.getElementById('login-password').value);
    });
    document.getElementById('login-password').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') login(e.target.value);
    });

    document.getElementById('btn-products').addEventListener('click', function() { switchView('products'); });
    document.getElementById('btn-terminals').addEventListener('click', function() { switchView('terminals'); });
    document.getElementById('btn-history').addEventListener('click', function() { switchView('history'); });
    document.getElementById('btn-cost-dashboard').addEventListener('click', function() { switchView('costs'); });
    document.getElementById('btn-discover').addEventListener('click', function() { switchView('discover'); });
    document.getElementById('btn-new-product').addEventListener('click', function() { showProductWizard(); });
    document.getElementById('btn-new-workspace').addEventListener('click', newWorkspace);
    document.getElementById('btn-new-session').addEventListener('click', newSession);
    document.getElementById('btn-stop-all-sessions').addEventListener('click', stopAllWorkspaceSessions);
    document.getElementById('btn-run-discover').addEventListener('click', runDiscovery);

    document.getElementById('btn-layout-1').addEventListener('click', function() { gridLayout = 1; renderTerminalView(); });
    document.getElementById('btn-layout-2').addEventListener('click', function() { gridLayout = 2; renderTerminalView(); });
    document.getElementById('btn-layout-4').addEventListener('click', function() { gridLayout = 4; renderTerminalView(); });

    document.getElementById('agent-filter').addEventListener('change', function(e) {
      agentFilter = e.target.value;
      sessions = allSessions;
      if (activeWorkspaceId) sessions = sessions.filter(function(s) { return s.workspaceId === activeWorkspaceId; });
      if (agentFilter) sessions = sessions.filter(function(s) { return s.agent === agentFilter; });
      renderCurrentView();
    });
    document.getElementById('theme-select').addEventListener('change', async function(e) {
      const nextTheme = THEME_META[e.target.value] ? e.target.value : 'dark';
      settings = { ...settings, theme: nextTheme };
      applyTheme(nextTheme, false);
      try {
        await api('/settings', {
          method: 'PUT',
          body: JSON.stringify({ theme: nextTheme })
        });
      } catch (error) {
        console.warn('Failed to persist theme, keeping local selection:', error);
      }
      if (activeView !== 'terminals') renderCurrentView();
    });

    var searchTimeout;
    document.getElementById('search-input').addEventListener('input', function(e) {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(async function() {
        var q = e.target.value.trim();
        if (q) {
          try { allSessions = await api('/search?q=' + encodeURIComponent(q)); } catch (ex) { allSessions = []; }
          sessions = allSessions;
        } else {
          await loadAllSessions();
        }
        renderWorkspaceList();
        renderCurrentView();
      }, 300);
    });

    document.getElementById('dialog-overlay').addEventListener('click', function(e) {
      if (e.target === document.getElementById('dialog-overlay')) hideDialog();
    });
    document.addEventListener('click', function() { hideContextMenu(); });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') hideContextMenu(); });

    window._app = {
      newSession: newSession,
      startSession: startSession,
      restartSession: restartSession,
      stopSession: stopSession,
      stopAllWorkspaceSessions: stopAllWorkspaceSessions,
      closeTerminalPane: closeTerminalPane,
      reopenClosedTerminals: reopenClosedTerminals,
      deleteSession: deleteSession,
      importSession: importSession,
      editWorkspace: editWorkspace,
      deleteWorkspace: deleteWorkspace,
      showProductWizard: showProductWizard,
      startGuidedStage: startGuidedStage,
      registerHandoff: registerHandoff
    };

    updateViewButtons();

    if (token) {
      api('/health').then(function() {
        showApp();
        loadData();
        connectSSE();
      }).catch(showLogin);
    } else {
      showLogin();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
