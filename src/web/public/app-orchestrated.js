(function() {
  'use strict';
  var App = window.App;
  if (!App || !App.state) return;
  var state = App.state;

  App.sortClusterSessions = function sortClusterSessions(sessionList) {
    return (sessionList || []).slice().sort(function(a, b) {
      var orderA = Number.isFinite(Number(a && a.displayOrder)) ? Number(a.displayOrder) : Number.MAX_SAFE_INTEGER;
      var orderB = Number.isFinite(Number(b && b.displayOrder)) ? Number(b.displayOrder) : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      var orchestratorA = (a && a.sessionRole) === 'orchestrator' ? 0 : 1;
      var orchestratorB = (b && b.sessionRole) === 'orchestrator' ? 0 : 1;
      if (orchestratorA !== orchestratorB) return orchestratorA - orchestratorB;
      return String((a && a.id) || '').localeCompare(String((b && b.id) || ''));
    });
  };

  App.getSessionClusterLabel = function getSessionClusterLabel(session) {
    if (!session) return '';
    if ((session.sessionRole || '') === 'orchestrator') {
      return 'Orchestrator';
    }
    return String(session.workerKind || session.role || 'Worker')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, function(ch) { return ch.toUpperCase(); });
  };

  App.getSessionClusterLabelHtml = function getSessionClusterLabelHtml(session) {
    var label = App.getSessionClusterLabel(session);
    if (!label) return '';
    var className = (session && session.sessionRole) === 'orchestrator' ? 'chip' : 'chip subtle';
    return '<span class="' + className + '">' + App.esc(label) + '</span>';
  };

  App.openRunInTerminals = function openRunInTerminals(productId, sessionRefs, terminalLayout, primarySessionId) {
    var sessions = (sessionRefs || []).map(function(ref) {
      var id = typeof ref === 'string' ? ref : ((ref || {}).id || '');
      var persisted = state.allSessions.find(function(item) { return item.id === id; }) || null;
      return persisted ? Object.assign({}, persisted, ref || {}) : ref;
    }).filter(function(item) { return item && item.id; });
    if (!sessions.length && primarySessionId) {
      var fallback = state.allSessions.find(function(item) { return item.id === primarySessionId; });
      if (fallback) sessions = [fallback];
    }
    if (!sessions.length) return;

    var ordered = App.sortClusterSessions(sessions);
    var workspaceId = (ordered[0] && ordered[0].workspaceId) || '';
    if (!workspaceId) {
      var product = state.products.find(function(item) { return item.product_id === productId; });
      workspaceId = (((product || {}).workspace || {}).runtime_workspace_id || '');
    }
    if (workspaceId) App.setActiveWorkspace(workspaceId);

    ordered.forEach(function(session) {
      state.closedTerminalSessionIds.delete(session.id);
    });

    var nextLayout = Number(terminalLayout || 0);
    if (nextLayout !== 1 && nextLayout !== 2 && nextLayout !== 4) {
      nextLayout = ordered.length > 2 ? 4 : 2;
    }
    state.gridLayout = nextLayout;
    App.setTerminalSlots(workspaceId, ordered.map(function(session) { return session.id; }));
    App.renderWorkspaceList();
    App.switchView('terminals');
    App.renderCurrentView();
  };

  var originalBuildProductSessionRow = App.buildProductSessionRow;
  App.buildProductSessionRow = function buildProductSessionRow(session) {
    var base = originalBuildProductSessionRow(session);
    var chips = '<div class="chip-row"><span class="agent-badge ' + session.agent + '">' + App.esc((App.AGENT_META[session.agent] || { icon: '?' }).icon) + '</span>' + App.getSessionClusterLabelHtml(session) + '<span class="status-pill ' + session.status + '">' + App.esc(App.stageStatusLabel(session.status)) + '</span></div>';
    return base.replace(/<div class="chip-row">[\s\S]*?<\/div><\/div><div class="session-inline-meta">/, chips + '</div><div class="session-inline-meta">');
  };

  var originalExecuteNextAction = App.executeNextAction;
  App.executeNextAction = async function executeNextAction(productId, actionRef) {
    var detail = await App.loadProductDetail(productId, true);
    var action = ((detail.next_actions || []).find(function(item) { return String(item.id || '') === String((actionRef || {}).id || ''); })
      || (detail.next_actions || []).find(function(item) { return String(item.step_id || item.stage_id || '') === String((actionRef || {}).step_id || ''); })
      || actionRef);
    var stageId = action.step_id || action.stage_id || (actionRef || {}).step_id;
    var knowledge = App.resolveActionKnowledge(action, detail, stageId);
    var latestIncomingHandoff = App.findLatestIncomingHandoff(detail, stageId);
    if (!stageId) return originalExecuteNextAction(productId, actionRef);

    var payload = {
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
      var result = await App.api('/products/' + encodeURIComponent(productId) + '/next-actions/execute', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      await App.loadAllSessions();
      await App.loadProducts(true);
      await App.loadProductDetail(productId, true);
      App.renderWorkspaceList();
      if (result && Array.isArray(result.sessions) && result.sessions.length) {
        App.openRunInTerminals(productId, result.sessions, result.terminal_layout, result.primary_session_id || ((result.session || {}).id || ''));
      } else if (result && result.session && result.session.id) {
        App.openSessionInTerminals(result.session.id, productId);
      } else {
        App.renderCurrentView();
      }
    } catch (e) {
      console.error('Next action execution failed:', e);
      alert(e.message || 'Failed to create the guided session.');
    }
  };

  var originalRenderTerminalView = App.renderTerminalView;
  App.renderTerminalView = function renderTerminalView() {
    originalRenderTerminalView();
    if (state.activeView !== 'terminals' || !state.activeWorkspaceId) return;
    var grid = document.getElementById('terminal-grid');
    if (!grid) return;
    var slots = App.getTerminalSlots(state.activeWorkspaceId);
    slots.forEach(function(sessionId, index) {
      var session = state.allSessions.find(function(item) { return item.id === sessionId; });
      if (!session) return;
      var pane = grid.querySelector('.terminal-pane[data-slot-index="' + index + '"]');
      if (!pane) return;
      var title = pane.querySelector('.terminal-pane-title');
      if (!title || title.querySelector('.session-cluster-label')) return;
      var labelHtml = App.getSessionClusterLabelHtml(session);
      if (!labelHtml) return;
      title.insertAdjacentHTML('beforeend', '<span class="session-cluster-label" style="margin-left:8px">' + labelHtml + '</span>');
    });
  };
})();
