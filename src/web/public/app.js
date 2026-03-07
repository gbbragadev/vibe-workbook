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

  const AGENT_META = {
    claude: { name: 'Claude Code', icon: 'C', color: '#d97706' },
    codex: { name: 'Codex CLI', icon: 'X', color: '#10b981' },
    gemini: { name: 'Gemini CLI', icon: 'G', color: '#4285f4' },
    antigravity: { name: 'Antigravity', icon: 'A', color: '#9333ea' }
  };

  const STAGE_ORDER = ['idea', 'brief', 'spec', 'architecture', 'implementation', 'test', 'release'];

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
  }

  // ============ DATA LOADING ============
  async function loadData() {
    await Promise.all([loadWorkspaces(), loadAllSessions(), loadModels(), loadProducts()]);
    updateStats();
    renderWorkspaceList();
    renderCurrentView();
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
      container.innerHTML = '<div style="padding: 20px 14px; color: var(--text-muted); font-size: 13px; text-align: center;">No projects yet<br><small>Click &quot;+ Project&quot; to create one</small></div>';
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

      // Show sessions expanded under active project
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
      (workspaces.find(w => w.id === activeWorkspaceId) || {}).name || 'Select a project';
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
      const productStatus = (product.pipeline || []).some(step => step.status === 'in-progress')
        ? 'in-progress'
        : ((product.pipeline || []).some(step => step.status === 'ready') ? 'ready' : 'not-started');
      return '<article class="product-card ' + (product.product_id === activeProductId ? 'active' : '') + '" data-product-id="' + product.product_id + '">' +
        '<div class="product-card-top"><div><div class="product-card-name">' + esc(product.name) + '</div>' +
        '<div class="chip-row" style="margin-top:6px"><span class="chip">' + esc(product.category) + '</span><span class="chip ok">declared: ' + esc(product.declared_stage) + '</span><span class="chip ' + stageSignalClass(product.computed_stage_signal) + '">signal: ' + esc(product.computed_stage_signal) + '</span></div></div>' +
        '<span class="status-pill ' + productStatus + '">' + stageStatusLabel(productStatus) + '</span></div>' +
        '<div class="product-card-summary">' + esc(product.summary || 'No product summary available.') + '</div>' +
        '<div class="product-card-stats"><div class="product-stat"><div class="product-stat-label">Artifacts</div><div class="product-stat-value">' + artifact.present + '/' + artifact.total + '</div></div><div class="product-stat"><div class="product-stat-label">Sessions</div><div class="product-stat-value">' + ((product.related_sessions || []).length) + '</div></div><div class="product-stat"><div class="product-stat-label">Workspace</div><div class="product-stat-value">' + esc((product.workspace || {}).path_status || 'none') + '</div></div><div class="product-stat"><div class="product-stat-label">Knowledge</div><div class="product-stat-value">' + esc(String(knowledgeSummary.active_packs || 0)) + '</div></div></div>' +
        '<div class="chip-row knowledge-chip-row" style="margin-top:10px">' + buildKnowledgePackChips(product.active_knowledge_packs || [], true) + '</div>' +
        '<div style="margin-top:12px"><strong style="font-size:12px">Next</strong><div class="artifact-row-meta" style="margin-top:4px">' + esc(nextAction ? nextAction.label : 'No next action') + '</div></div>' +
        '</article>';
    }).join('');

    overview.querySelectorAll('.product-card').forEach(card => {
      card.addEventListener('click', () => setActiveProduct(card.dataset.productId));
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

  function buildProductDetailHtml(detail) {
    return '<div class="product-detail-header"><div class="product-row"><div><h2>' + esc(detail.name) + '</h2><div class="product-subtitle">' + esc(detail.summary || 'No summary available.') + '</div></div><div class="detail-badges"><span class="chip">' + esc(detail.category) + '</span><span class="chip ok">declared: ' + esc(detail.declared_stage) + '</span><span class="chip ' + stageSignalClass(detail.computed_stage_signal) + '">signal: ' + esc(detail.computed_stage_signal) + '</span>' + buildKnowledgePackChips(detail.knowledge_packs || []) + '</div></div><div class="product-detail-actions">' +
      ((detail.workspace || {}).runtime_workspace_id ? '<button class="btn btn-sm btn-primary" data-product-action="open-workspace">Open Workspace</button>' : '') +
      '<button class="btn btn-sm" data-product-action="change-workspace">Change Workspace</button>' +
      '</div></div><div class="product-detail-scroll">' +
      '<section class="detail-panel"><div class="panel-header"><h3>Operational Summary</h3><span class="status-pill ' + esc((detail.workspace || {}).path_status || 'unknown') + '">' + esc((detail.workspace || {}).path_status || 'unknown') + '</span></div><div class="panel-body"><div class="meta-list">' +
      metaItem('Owner', detail.owner) + metaItem('Status', detail.status) + metaItem('Workspace', ((detail.workspace || {}).linked_workspace_name || (detail.workspace || {}).runtime_workspace_id || 'none')) + metaItem('Repo', ((detail.repo || {}).local_path || 'unknown')) + metaItem('Knowledge Packs', String(((detail.knowledge_packs || []).length))) + metaItem('Current Stage', detail.current_stage_id || detail.computed_stage_signal || 'idea') +
      '</div></div></section>' +
      '<div class="detail-grid"><section class="detail-panel"><div class="panel-header"><h3>Pipeline</h3><span class="artifact-row-meta">' + detail.pipeline.length + ' stages</span></div><div class="panel-body"><div class="pipeline-list">' + detail.pipeline.map(step => buildStepCard(step)).join('') + '</div></div></section>' +
      '<section class="detail-panel"><div class="panel-header"><h3>Artifacts</h3><span class="artifact-row-meta">' + detail.artifact_summary.present + '/' + detail.artifact_summary.total + ' present</span></div><div class="panel-body"><div class="artifact-list">' + detail.artifacts.map(artifact => '<div class="artifact-row"><div class="product-row"><h4>' + esc(artifact.label) + '</h4><span class="artifact-chip ' + (artifact.exists ? 'exists' : 'missing') + '">' + (artifact.exists ? 'present' : 'missing') + '</span></div><div class="artifact-row-meta mono" style="margin-top:8px">' + esc(artifact.path || 'No path configured') + '</div></div>').join('') + '</div></div></section></div>' +
      '<div class="detail-grid"><section class="detail-panel"><div class="panel-header"><h3>Knowledge Packs</h3><span class="artifact-row-meta">' + ((detail.knowledge_packs || []).length) + ' active</span></div><div class="panel-body">' + buildKnowledgePackPanel(detail) + '</div></section>' +
      '<section class="detail-panel"><div class="panel-header"><h3>Stage Knowledge</h3><span class="artifact-row-meta">current: ' + esc(detail.current_stage_id || detail.computed_stage_signal || 'idea') + '</span></div><div class="panel-body">' + buildStageKnowledgePanel(detail) + '</div></section></div>' +
      '<div class="detail-grid"><section class="detail-panel"><div class="panel-header"><h3>Next Actions</h3><span class="artifact-row-meta">' + ((detail.next_actions || []).length) + ' suggested</span></div><div class="panel-body"><div class="next-actions-list">' + ((detail.next_actions || []).map(action => buildNextActionRow(action)).join('') || '<p>No next actions available.</p>') + '</div></div></section>' +
      '<section class="detail-panel"><div class="panel-header"><h3>Related Sessions</h3><span class="artifact-row-meta">' + ((detail.related_sessions || []).length) + ' linked</span></div><div class="panel-body"><div class="session-list">' + ((detail.related_sessions || []).map(session => buildProductSessionRow(session)).join('') || '<p>No linked sessions yet.</p>') + '</div></div></section></div>' +
      '<section class="detail-panel"><div class="panel-header"><h3>Handoff History</h3><span class="artifact-row-meta">' + ((detail.handoffs || []).length) + ' records</span></div><div class="panel-body"><div class="handoff-list">' + ((detail.handoffs || []).map(handoff => '<div class="handoff-row"><div class="product-row"><strong>' + esc(handoff.from_stage) + ' -> ' + esc(handoff.to_stage) + '</strong><span class="chip">' + esc(handoff.role || 'unknown-role') + '</span></div><div class="handoff-summary">' + esc(handoff.summary || '') + '</div><div class="artifact-row-meta" style="margin-top:8px">' + esc((handoff.runtime_agent || 'unknown-agent') + ' | ' + formatDateTime(handoff.created_at)) + '</div></div>').join('') || '<p>No handoffs recorded yet.</p>') + '</div></div></section></div>';
  }

  function buildStepCard(step) {
    return '<article class="step-card"><div class="step-card-top"><div><h4>' + esc(step.label) + '</h4><div class="step-card-meta"><span class="status-pill ' + esc(step.status) + '">' + esc(stageStatusLabel(step.status)) + '</span><span class="chip">' + esc(step.recommended_role) + '</span><span class="chip">' + esc(step.recommended_runtime_agent) + '</span></div></div></div><div class="step-card-goal">' + esc(step.goal) + '</div><div class="step-card-actions"><button class="btn btn-sm btn-primary" data-stage-action="start" data-stage-id="' + step.stage_id + '">Start Step</button>' + (step.active_session_id ? '<button class="btn btn-sm" data-stage-action="open-session" data-session-id="' + step.active_session_id + '">Open Session</button>' : '') + (step.stage_id !== 'idea' ? '<button class="btn btn-sm" data-stage-action="handoff" data-stage-id="' + step.stage_id + '">Register Handoff</button>' : '') + '</div></article>';
  }

  function buildNextActionRow(action) {
    return '<div class="action-row"><div class="action-row-copy"><strong>' + esc(action.label) + '</strong><span>' + esc(action.reason) + '</span></div>' + (action.step_id ? '<div class="action-row-actions"><button class="btn btn-sm btn-primary" data-product-action="start-stage" data-stage-id="' + action.step_id + '">Start</button></div>' : '') + '</div>';
  }

  function buildProductSessionRow(session) {
    const meta = AGENT_META[session.agent] || { icon: '?' };
    const sessionMeta = ['stage: ' + (session.stageId || 'manual'), 'role: ' + (session.role || 'none')].concat([session.model || '', session.effort ? ('effort:' + session.effort) : ''].filter(Boolean)).join(' | ');
    return '<div class="session-row-inline"><div class="product-row"><h4>' + esc(session.name) + '</h4><div class="chip-row"><span class="agent-badge ' + session.agent + '">' + meta.icon + '</span><span class="status-pill ' + session.status + '">' + esc(stageStatusLabel(session.status)) + '</span></div></div><div class="session-inline-meta">' + esc(sessionMeta) + '</div><div class="session-inline-path">' + esc(session.workingDir || 'No working directory') + '</div><div class="step-card-actions"><button class="btn btn-sm" data-stage-action="open-session" data-session-id="' + session.id + '">Open Session</button>' + (session.status === 'running' ? '<button class="btn btn-sm" data-session-action="stop" data-session-id="' + session.id + '">Stop</button><button class="btn btn-sm" data-session-action="restart" data-session-id="' + session.id + '">Restart</button>' : '<button class="btn btn-sm btn-primary" data-session-action="start" data-session-id="' + session.id + '">Start</button><button class="btn btn-sm" data-session-action="restart" data-session-id="' + session.id + '">Restart</button>') + '<button class="btn btn-sm" data-session-action="delete" data-session-id="' + session.id + '">Delete</button></div></div>';
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
      ? '<div class="knowledge-now"><div class="knowledge-now-title">Recommended now: ' + esc(currentStage) + '</div><div class="knowledge-suggestion-group">' + current.map(buildKnowledgeRecommendationSummary).join('') + '</div></div>'
      : '<div class="knowledge-now"><div class="knowledge-now-title">Recommended now: ' + esc(currentStage) + '</div><p>No stage recommendation available for the current stage.</p></div>';

    return currentHtml + '<div class="knowledge-pack-list">' + packs.map(pack => {
      const domains = (pack.domains || []).map(item => '<span class="chip">' + esc(item) + '</span>').join('');
      const runtimes = (pack.supported_runtimes || []).map(item => '<span class="chip">' + esc(item) + '</span>').join('');
      const entrypoints = (pack.entrypoints || []).map(item => '<span class="chip knowledge">' + esc(item) + '</span>').join('');
      return '<div class="knowledge-pack-row"><div class="product-row"><h4>' + esc(pack.name) + '</h4><div class="chip-row"><span class="chip knowledge">' + esc(pack.type || 'knowledge-pack') + '</span><span class="chip ok">' + esc(pack.integration_mode || 'reference-first') + '</span></div></div>' +
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
      return '<div class="stage-knowledge-row ' + (stage.is_current ? 'current' : '') + '"><div class="product-row"><h4>' + esc(stage.label) + '</h4><div class="chip-row"><span class="status-pill ' + esc(stage.status) + '">' + esc(stageStatusLabel(stage.status)) + '</span>' + (stage.is_current ? '<span class="chip knowledge">current</span>' : '') + '</div></div>' +
        (recommendations.length
          ? '<div class="knowledge-suggestion-group">' + recommendations.map(buildKnowledgeRecommendationSummary).join('') + '</div>'
          : '<div class="artifact-row-meta" style="margin-top:8px">No knowledge recommendation for this stage.</div>') +
        '</div>';
    }).join('') + '</div>';
  }

  function buildKnowledgeRecommendationSummary(rec) {
    const skills = (rec.recommended_skills || []).map(item => '<span class="chip">' + esc(item) + '</span>').join('');
    const workflows = (rec.recommended_workflows || []).map(item => '<span class="chip knowledge">' + esc(item) + '</span>').join('');
    const roles = (rec.recommended_roles || []).map(item => '<span class="chip">' + esc(item) + '</span>').join('');
    const agents = (rec.recommended_runtime_agents || []).map(item => '<span class="chip">' + esc(item) + '</span>').join('');
    return '<div class="knowledge-suggestion-card"><div class="product-row"><strong>' + esc(rec.knowledge_pack_name || rec.knowledge_pack_id) + '</strong><span class="chip knowledge">' + esc(rec.knowledge_pack_id || '') + '</span></div>' +
      '<div class="knowledge-pack-meta"><div><span class="meta-item-label">Skills</span><div class="chip-row">' + (skills || '<span class="chip">none</span>') + '</div></div><div><span class="meta-item-label">Workflows</span><div class="chip-row">' + (workflows || '<span class="chip">none</span>') + '</div></div></div>' +
      '<div class="knowledge-pack-meta" style="margin-top:10px"><div><span class="meta-item-label">Roles</span><div class="chip-row">' + (roles || '<span class="chip">none</span>') + '</div></div><div><span class="meta-item-label">Runtime Agents</span><div class="chip-row">' + (agents || '<span class="chip">none</span>') + '</div></div></div>' +
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
    root.querySelectorAll('[data-product-action="start-stage"], [data-stage-action="start"]').forEach(el => el.addEventListener('click', () => startGuidedStage(detail.product_id, el.dataset.stageId)));
    root.querySelectorAll('[data-stage-action="handoff"]').forEach(el => el.addEventListener('click', () => registerHandoff(detail.product_id, el.dataset.stageId)));
    root.querySelectorAll('[data-stage-action="open-session"]').forEach(el => el.addEventListener('click', () => openSessionInTerminals(el.dataset.sessionId, detail.product_id)));
    root.querySelectorAll('[data-session-action="start"]').forEach(el => el.addEventListener('click', () => startSession(el.dataset.sessionId)));
    root.querySelectorAll('[data-session-action="restart"]').forEach(el => el.addEventListener('click', () => restartSession(el.dataset.sessionId)));
    root.querySelectorAll('[data-session-action="stop"]').forEach(el => el.addEventListener('click', () => stopSession(el.dataset.sessionId)));
    root.querySelectorAll('[data-session-action="delete"]').forEach(el => el.addEventListener('click', () => deleteSession(el.dataset.sessionId)));
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
    const defaultAgent = stage.recommended_runtime_agent;
    const defaultName = detail.name + ' - ' + stage.label;
    const workingDir = ((detail.repo || {}).local_path || '');
    showDialog('Start ' + stage.label, '<label>Stage</label><input type="text" value="' + esc(stage.label) + '" disabled><label>Recommended Role</label><input type="text" value="' + esc(stage.recommended_role) + '" disabled><label>Session Name</label><input type="text" id="dlg-stage-name" value="' + esc(defaultName) + '"><label>Runtime Agent</label><select id="dlg-stage-agent">' + buildAgentOptions(defaultAgent, stage.allowed_runtime_agents) + '</select><label>Model</label><select id="dlg-stage-model">' + buildModelOptionsFor(defaultAgent) + '</select><div id="dlg-stage-effort-wrap"><label>Effort</label><select id="dlg-stage-effort">' + buildEffortOptionsFor(defaultAgent) + '</select></div><label>Working Directory</label><input type="text" id="dlg-stage-dir" value="' + esc(workingDir) + '"><label>Goal</label><textarea disabled>' + esc(stage.goal) + '</textarea>', [
      { label: 'Cancel', onClick: function() {} },
      { label: 'Create Session', primary: true, onClick: async function() {
        await api('/products/' + encodeURIComponent(productId) + '/stages/' + encodeURIComponent(stageId) + '/start', {
          method: 'POST',
          body: JSON.stringify({
            name: document.getElementById('dlg-stage-name').value.trim() || defaultName,
            runtimeAgent: document.getElementById('dlg-stage-agent').value,
            model: document.getElementById('dlg-stage-model').value,
            effort: document.getElementById('dlg-stage-effort').value,
            workingDir: document.getElementById('dlg-stage-dir').value
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

  async function registerHandoff(productId, fromStage) {
    const nextStage = STAGE_ORDER[Math.min(STAGE_ORDER.indexOf(fromStage) + 1, STAGE_ORDER.length - 1)];
    showDialog('Register Handoff', '<label>From Stage</label><input type="text" value="' + esc(fromStage) + '" disabled><label>To Stage</label><select id="dlg-handoff-to">' + STAGE_ORDER.filter(stage => stage !== 'idea').map(stage => '<option value="' + stage + '"' + (stage === nextStage ? ' selected' : '') + '>' + esc(stage) + '</option>').join('') + '</select><label>Role</label><input type="text" id="dlg-handoff-role" value="delivery-handoff"><label>Runtime Agent</label><select id="dlg-handoff-agent">' + buildAgentOptions('claude', Object.keys(AGENT_META)) + '</select><label>Session ID (optional)</label><input type="text" id="dlg-handoff-session" placeholder="sess-..."><label>Summary</label><textarea id="dlg-handoff-summary" placeholder="What was completed, what remains, and what the next stage should do."></textarea>', [
      { label: 'Cancel', onClick: function() {} },
      { label: 'Save Handoff', primary: true, onClick: async function() {
        await api('/products/' + encodeURIComponent(productId) + '/handoffs', {
          method: 'POST',
          body: JSON.stringify({
            from_stage: fromStage,
            to_stage: document.getElementById('dlg-handoff-to').value,
            role: document.getElementById('dlg-handoff-role').value.trim(),
            runtime_agent: document.getElementById('dlg-handoff-agent').value,
            session_id: document.getElementById('dlg-handoff-session').value.trim(),
            summary: document.getElementById('dlg-handoff-summary').value.trim(),
            artifact_refs: []
          })
        });
        await loadProducts(true);
        renderCurrentView();
      }}
    ]);
  }

  async function changeProductWorkspace(detail) {
    const currentWorkspaceId = ((detail.workspace || {}).runtime_workspace_id || '');
    const options = ['<option value="">No linked workspace</option>'].concat(
      workspaces.map(ws => '<option value="' + ws.id + '"' + (ws.id === currentWorkspaceId ? ' selected' : '') + '>' + esc(ws.name) + ' - ' + esc(ws.workingDir || 'no working dir') + '</option>')
    ).join('');

    showDialog('Change Workspace Link',
      '<label>Product</label><input type="text" value="' + esc(detail.name) + '" disabled>' +
      '<label>Linked Workspace</label><select id="dlg-product-workspace">' + options + '</select>' +
      '<p style="font-size:12px;color:var(--text-secondary);margin-top:6px">This updates the product registry only. It does not rename or modify the runtime workspace itself.</p>',
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

  function metaItem(label, value) {
    return '<div><span class="meta-item-label">' + esc(label) + '</span><span class="mono">' + esc(value || 'unknown') + '</span></div>';
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
      grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#9889;</div><div class="empty-state-text">Select a project to start</div><div class="empty-subtext">You can also drag a project from the sidebar into this area.</div></div>';
      bindTerminalGridDropZone(grid, null);
      return;
    }

    if (!workspaceSessions.length) {
      grid.className = 'grid-1';
      grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#9889;</div><div class="empty-state-text">No sessions in this project</div><div class="empty-subtext">Create one or drag a session here after linking the workspace.</div><button class="btn btn-primary" onclick="window._app.newSession()">+ New Session</button></div>';
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
        paneEl.innerHTML = '<div class="terminal-pane-header"><div class="terminal-pane-title">Pane ' + (i + 1) + '</div></div><div class="terminal-pane-body"><div class="empty-state"><div class="empty-state-icon">&#10515;</div><div class="empty-state-text">Drop a session here</div><div class="empty-subtext">Drag a session from the project sidebar into this slot.</div></div></div>';
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
      extra.textContent = '+' + Math.max(0, workspaceSessions.length - terminalSlots.filter(Boolean).length) + ' more sessions available in this project';
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
      theme: {
        background: '#0f0f14', foreground: '#e0e0e8', cursor: '#e0e0e8',
        selectionBackground: '#6366f140',
        black: '#1e1e2e', red: '#ef4444', green: '#10b981', yellow: '#f59e0b',
        blue: '#6366f1', magenta: '#c084fc', cyan: '#22d3ee', white: '#e0e0e8',
        brightBlack: '#5a5a70', brightRed: '#f87171', brightGreen: '#34d399',
        brightYellow: '#fbbf24', brightBlue: '#818cf8', brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9', brightWhite: '#ffffff'
      },
      cursorBlink: true, scrollback: 5000, allowTransparency: true
    });

    let fitAddon = null;
    if (typeof FitAddon !== 'undefined') {
      fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
    }

    term.open(container);
    if (fitAddon) setTimeout(function() { fitAddon.fit(); }, 100);

    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = wsProto + '//' + location.host + '/ws/terminal?token=' + token + '&sessionId=' + sessionId + '&cols=' + term.cols + '&rows=' + term.rows;
    const ws = new WebSocket(wsUrl);

    ws.onopen = function() {
      term.write('\r\n\x1b[90m[Connected to ' + sessionId + ']\x1b[0m\r\n');
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
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    term.onResize(function(size) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
      }
    });

    terminalPanes.push({ sessionId: sessionId, term: term, ws: ws, fitAddon: fitAddon });

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
      '<button class="context-menu-item" data-menu-action="edit">Edit project</button>' +
      '<button class="context-menu-item" data-menu-action="session">New session</button>' +
      '<div class="context-menu-sep"></div>' +
      '<button class="context-menu-item" data-menu-action="delete">Delete project</button>';

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
  function newWorkspace() {
    showDialog('New Project', '<label>Project Name</label><input type="text" id="dlg-ws-name" placeholder="My Awesome Project"><label>Description</label><input type="text" id="dlg-ws-desc" placeholder="Optional description"><label>Working Directory</label><div style="display:flex;gap:6px"><input type="text" id="dlg-ws-dir" placeholder="C:\\Projects\\my-app" style="flex:1"><button class="btn btn-sm" id="dlg-ws-browse" type="button">&#128193;</button></div><label>Color</label><input type="color" id="dlg-ws-color" value="#6366f1" style="height:36px;padding:2px">', [
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
          var currentDir = document.getElementById('dlg-ws-dir').value || 'C:\\Users';
          try {
            var data = await api('/browse?path=' + encodeURIComponent(currentDir));
            var origTitle = document.getElementById('dialog-title').textContent;
            var origBody = document.getElementById('dialog-body').innerHTML;

            showDirBrowser(data, function(selectedPath) {
              document.getElementById('dialog-title').textContent = origTitle;
              document.getElementById('dialog-body').innerHTML = origBody;
              document.getElementById('dlg-ws-dir').value = selectedPath;
              // Re-bind create button
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
                var n = document.getElementById('dlg-ws-name').value.trim();
                if (!n) return;
                await api('/workspaces', {
                  method: 'POST',
                  body: JSON.stringify({
                    name: n,
                    description: document.getElementById('dlg-ws-desc').value,
                    workingDir: document.getElementById('dlg-ws-dir').value,
                    color: document.getElementById('dlg-ws-color').value
                  })
                });
                await loadData();
              });
              actionsEl.appendChild(cancelBtn);
              actionsEl.appendChild(createBtn);
              // Re-bind browse
              var nb = document.getElementById('dlg-ws-browse');
              if (nb) nb.addEventListener('click', browseBtn._handler || function() {});
            });
          } catch (e) { console.error(e); }
        });
      }
    }, 50);
  }

  function editWorkspace(workspaceId) {
    const ws = workspaces.find(w => w.id === workspaceId);
    if (!ws) return;

    showDialog('Edit Project', '<label>Project Name</label><input type="text" id="dlg-edit-ws-name" value="' + esc(ws.name) + '"><label>Description</label><input type="text" id="dlg-edit-ws-desc" value="' + esc(ws.description || '') + '"><label>Working Directory</label><div style="display:flex;gap:6px"><input type="text" id="dlg-edit-ws-dir" value="' + esc(ws.workingDir || '') + '" style="flex:1"><button class="btn btn-sm" id="dlg-edit-ws-browse" type="button">&#128193;</button></div><label>Color</label><input type="color" id="dlg-edit-ws-color" value="' + esc(ws.color || '#6366f1') + '" style="height:36px;padding:2px">', [
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
          var currentDir = document.getElementById('dlg-edit-ws-dir').value || 'C:\\Users';
          try {
            var data = await api('/browse?path=' + encodeURIComponent(currentDir));
            var origTitle = document.getElementById('dialog-title').textContent;
            var origBody = document.getElementById('dialog-body').innerHTML;
            showDirBrowser(data, function(selectedPath) {
              document.getElementById('dialog-title').textContent = origTitle;
              document.getElementById('dialog-body').innerHTML = origBody;
              document.getElementById('dlg-edit-ws-dir').value = selectedPath;
            });
          } catch (e) { console.error(e); }
        });
      }
    }, 50);
  }

  async function deleteWorkspace(workspaceId) {
    const ws = workspaces.find(w => w.id === workspaceId);
    if (!ws) return;
    if (!confirm('Delete project "' + ws.name + '" and its sessions?')) return;
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
      showDialog('Select a Project', '<p style="font-size:13px">Please select a project first.</p>', [
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

    showDialog('New Session', '<label>Session Name</label><input type="text" id="dlg-sess-name" placeholder="Feature X"><label>Agent</label><select id="dlg-sess-agent"><option value="claude">Claude Code</option><option value="codex">Codex CLI</option><option value="gemini">Gemini CLI</option></select><label>Model</label><select id="dlg-sess-model">' + buildModelOptions(defaultAgent) + '</select><div id="dlg-sess-effort-wrap"><label>Effort</label><select id="dlg-sess-effort">' + buildEffortOptionsFor(defaultAgent) + '</select></div><label>Working Directory</label><div style="display:flex;gap:6px"><input type="text" id="dlg-sess-dir" placeholder="' + (wsDir || 'Inherits from project') + '" value="' + wsDir + '" style="flex:1"><button class="btn btn-sm" id="dlg-sess-browse" type="button">&#128193;</button></div><label>Resume Session ID (Claude only)</label><input type="text" id="dlg-sess-resume" placeholder="Optional: paste session UUID">', [
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
    if (!confirm('Stop all running sessions in "' + (workspace ? workspace.name : activeWorkspaceId) + '"?')) return;
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
      showDialog('Select a Project', '<p style="font-size:13px">Please select a project to import into.</p>', [
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
