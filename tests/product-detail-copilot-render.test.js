const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createElementStub() {
  let textValue = '';
  return {
    innerHTML: '',
    value: '',
    dataset: {},
    style: {},
    classList: {
      add() {},
      remove() {},
      contains() { return false; }
    },
    appendChild() {},
    removeChild() {},
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {},
    click() {},
    set textContent(value) {
      textValue = String(value ?? '');
      this.innerHTML = escapeHtml(textValue);
    },
    get textContent() {
      return textValue;
    }
  };
}

function loadFrontendTestHooks() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'public', 'app.js'), 'utf8');
  const documentStub = {
    readyState: 'loading',
    body: { dataset: {} },
    addEventListener() {},
    removeEventListener() {},
    createElement() {
      return createElementStub();
    },
    getElementById() {
      return createElementStub();
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
  const context = {
    console,
    document: documentStub,
    window: {},
    localStorage: {
      getItem() { return ''; },
      setItem() {},
      removeItem() {}
    },
    fetch: async function() {
      throw new Error('fetch should not run in render smoke tests');
    },
    EventSource: function() {},
    confirm() { return true; },
    setTimeout() { return 1; },
    clearTimeout() {},
    URLSearchParams,
    AbortController,
    Date,
    Math
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'app.js' });
  return context.__VIBE_WORKBOOK_TEST__;
}

function artifactDefinition(id, exists) {
  const map = {
    manifest: { label: 'Product Manifest', relative_path: '.platform/product.json', path: 'C:/repo/.platform/product.json' },
    brief: { label: 'Brief', relative_path: 'docs/brief.md', path: 'C:/repo/docs/brief.md' },
    spec: { label: 'Spec', relative_path: 'docs/spec.md', path: 'C:/repo/docs/spec.md' },
    architecture: { label: 'Architecture', relative_path: 'ARCHITECTURE.md', path: 'C:/repo/ARCHITECTURE.md' },
    'test-strategy': { label: 'Test Strategy', relative_path: 'docs/test-strategy.md', path: 'C:/repo/docs/test-strategy.md' },
    runbook: { label: 'Runbook', relative_path: 'docs/runbook.md', path: 'C:/repo/docs/runbook.md' },
    'release-plan': { label: 'Release Plan', relative_path: 'docs/release-plan.md', path: 'C:/repo/docs/release-plan.md' }
  };
  const meta = map[id] || { label: id, relative_path: id + '.md', path: 'C:/repo/' + id + '.md' };
  return {
    id,
    label: meta.label,
    exists: exists !== false,
    relative_path: meta.relative_path,
    path: meta.path,
    content_status: exists === false ? 'missing' : 'valid'
  };
}

function makeDetail(overrides) {
  const baseArtifacts = [
    artifactDefinition('manifest', true),
    artifactDefinition('brief', true),
    artifactDefinition('spec', true),
    artifactDefinition('architecture', true),
    artifactDefinition('test-strategy', true),
    artifactDefinition('runbook', true),
    artifactDefinition('release-plan', true)
  ];
  const detail = {
    product_id: 'zapcam',
    name: 'Zapcam',
    summary: 'Produto de teste do Copilot.',
    category: 'product',
    current_stage_id: 'spec',
    computed_stage_signal: 'spec',
    declared_stage: 'spec',
    workspace: {},
    next_actions: [],
    artifacts: baseArtifacts,
    artifact_summary: { present: baseArtifacts.length, total: baseArtifacts.length },
    pipeline: [],
    handoffs: [],
    related_sessions: [],
    knowledge_packs: [],
    stage_guidance: [],
    runs: [],
    readiness: {
      status: 'needs-evidence',
      label: 'Needs evidence',
      summary: 'Ainda faltam evidências antes do próximo passo.',
      signals: [],
      gaps: []
    },
    release_packet: {
      key_artifacts: [],
      next_release_step: ''
    },
    operate_lite: null,
    copilot: undefined
  };
  const next = Object.assign({}, detail, overrides || {});
  next.workspace = Object.assign({}, detail.workspace, (overrides || {}).workspace || {});
  next.readiness = Object.assign({}, detail.readiness, (overrides || {}).readiness || {});
  next.release_packet = Object.assign({}, detail.release_packet, (overrides || {}).release_packet || {});
  if ((overrides || {}).artifacts) {
    next.artifacts = overrides.artifacts;
  }
  if (!next.artifact_summary) {
    const present = (next.artifacts || []).filter(function(item) { return item.exists; }).length;
    next.artifact_summary = { present, total: (next.artifacts || []).length };
  }
  return next;
}

function countOccurrences(text, needle) {
  return (text.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
}

test('product detail renders copilot hero even when detail.copilot is absent', () => {
  const hooks = loadFrontendTestHooks();
  const artifacts = [
    artifactDefinition('manifest', true),
    artifactDefinition('brief', true),
    artifactDefinition('spec', true),
    artifactDefinition('architecture', false)
  ];
  const detail = makeDetail({
    current_stage_id: 'spec',
    computed_stage_signal: 'spec',
    declared_stage: 'spec',
    workspace: {},
    artifacts,
    artifact_summary: { present: 3, total: 4 },
    copilot: undefined
  });

  const html = hooks.buildProductDetailHtml(detail);

  assert.match(html, /Project Copilot/);
  assert.match(html, /ARCHITECTURE\.md/);
  assert.match(html, /Atenção recomendada|Risco elevado de retrabalho/);
  assert.match(html, /Continuar Architecture \(Claude\)|Iniciar Architecture \(Claude\)/);
  assert.doesNotMatch(html, /<h3>Blockers<\/h3>/);
});

test('copilot absorbs readiness and keeps a single primary CTA in the detail body', () => {
  const hooks = loadFrontendTestHooks();
  const detail = makeDetail({
    current_stage_id: 'release',
    computed_stage_signal: 'release',
    declared_stage: 'release',
    copilot: {
      current_state: {
        current_stage_label: 'Release',
        blockers: [
          {
            kind: 'missing-artifact',
            artifact_id: 'runbook',
            action_type: 'continue-stage',
            action_label: 'Criar runbook',
            expected_path: 'docs/runbook.md'
          }
        ]
      },
      recommended_next_move: {
        stage_hint: 'release',
        agent_hint: 'Claude',
        risk_level: 'high',
        risk_label: 'Risco elevado de retrabalho',
        why_this_matters: 'Sem runbook, a entrega nao fica operacional.',
        expected_evidence: 'docs/runbook.md'
      },
      candidate_artifacts: [],
      decision_log: []
    }
  });

  const html = hooks.buildProductDetailHtml(detail);

  assert.match(html, /copilot-inline-section/);
  assert.match(html, /Release Readiness/);
  assert.equal(countOccurrences(html, 'copilot-cta-btn'), 1);
  assert.doesNotMatch(html, /confidence/);
  assert.doesNotMatch(html, /skills_hint/);
  assert.doesNotMatch(html, /execution_mode_hint/);
});

test('copilot shows clear path and Codex guidance during implementation when blockers are clear', () => {
  const hooks = loadFrontendTestHooks();
  const detail = makeDetail({
    current_stage_id: 'implementation',
    computed_stage_signal: 'implementation',
    declared_stage: 'implementation',
    readiness: {
      status: 'ready-for-release-candidate',
      label: 'Ready',
      summary: 'Base suficiente para seguir.'
    },
    copilot: {
      current_state: {
        current_stage_label: 'Implementation',
        blockers: [],
        created_assets_total: 4,
        candidate_artifacts_total: 0,
        open_decisions_total: 0
      },
      recommended_next_move: {
        stage_hint: 'implementation',
        agent_hint: 'Codex',
        risk_level: 'low',
        risk_label: 'Caminho seguro',
        why_this_matters: 'A base atual permite seguir para a implementacao com clareza.',
        expected_evidence: 'Evidencia de codigo e execucao da etapa atual.'
      },
      candidate_artifacts: [],
      decision_log: []
    }
  });

  const html = hooks.buildCopilotPanel(detail);

  assert.match(html, /Caminho seguro/);
  assert.match(html, /Codex/);
  assert.match(html, /Caminho livre — nenhum blocker crítico identificado\./);
});
