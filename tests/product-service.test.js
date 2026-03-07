const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ProductService } = require('../src/core/product-service');
const { KnowledgePackService } = require('../src/core/knowledge-pack-service');
const { RunCoordinatorService } = require('../src/core/run-coordinator-service');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-workbook-test-'));
}

function makeKnowledgeService(dir, opts = {}) {
  const catalogDir = path.join(dir, 'knowledge');
  fs.mkdirSync(catalogDir, { recursive: true });
  const indexFile = path.join(catalogDir, 'index.json');
  const bindingsFile = path.join(dir, 'bindings.json');
  const recommendationsFile = path.join(dir, 'recommendations.json');

  fs.writeFileSync(indexFile, JSON.stringify({
    version: 1,
    knowledge_packs: (opts.packs || []).map((pack) => ({
      id: pack.id,
      manifest: `${pack.id}.pack.json`
    }))
  }, null, 2));

  for (const pack of opts.packs || []) {
    fs.writeFileSync(path.join(catalogDir, `${pack.id}.pack.json`), JSON.stringify(pack, null, 2));
  }

  fs.writeFileSync(bindingsFile, JSON.stringify({
    version: 1,
    bindings: opts.bindings || []
  }, null, 2));

  fs.writeFileSync(recommendationsFile, JSON.stringify({
    version: 1,
    recommendations: opts.recommendations || []
  }, null, 2));

  return new KnowledgePackService({
    catalogDir,
    indexFile,
    bindingsFile,
    recommendationsFile
  });
}

function makeProductService(dir, opts = {}) {
  const registryFile = opts.registryFile || path.join(dir, 'products.json');
  const handoffsFile = opts.handoffsFile || path.join(dir, 'handoffs.json');
  const runsFile = opts.runsFile || path.join(dir, 'runs.json');
  const knowledgePackService = opts.knowledgePackService || makeKnowledgeService(dir, {
    packs: [],
    bindings: [],
    recommendations: []
  });
  const runCoordinatorService = opts.runCoordinatorService || new RunCoordinatorService({ runsFile });

  return new ProductService({
    registryFile,
    handoffsFile,
    knowledgePackService,
    runCoordinatorService
  });
}

test('product service builds detail with pipeline, artifacts and sessions', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'zapcam');
  fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs', 'spec.md'), '# spec');
  fs.writeFileSync(path.join(repoDir, 'ARCHITECTURE.md'), '# architecture');
  fs.writeFileSync(path.join(repoDir, 'docs', 'test-strategy.md'), '# tests');

  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'zapcam',
        name: 'Zapcam',
        slug: 'zapcam',
        status: 'active',
        stage: 'build',
        owner: 'guibr',
        category: 'product',
        summary: 'Product summary',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: 'ws-zap', current_working_dir: repoDir, path_status: 'valid' },
        platform: {},
        governance: {}
      }
    ]
  }, null, 2));

  const handoffsFile = path.join(dir, 'handoffs.json');
  const knowledgePackService = makeKnowledgeService(dir, {
    packs: [
      {
        id: 'pm-skills',
        name: 'PM Skills',
        source: 'external-github',
        type: 'skills-pack',
        repo_url: 'https://github.com/phuryn/pm-skills',
        domains: ['product-discovery'],
        supported_runtimes: ['claude'],
        integration_mode: 'reference-first',
        status: 'active'
      }
    ],
    bindings: [
      {
        product_id: 'zapcam',
        knowledge_pack_id: 'pm-skills',
        enabled: true,
        notes: 'active'
      }
    ],
    recommendations: [
      {
        knowledge_pack_id: 'pm-skills',
        stage_id: 'brief',
        recommended_skills: ['identify-assumptions-new'],
        recommended_workflows: ['/discover'],
        recommended_roles: ['product-designer'],
        recommended_runtime_agents: ['claude']
      }
    ]
  });
  const service = new ProductService({ registryFile, handoffsFile, knowledgePackService });
  const detail = service.getProductDetail('zapcam', [{ id: 'ws-zap', name: 'Zapcam Workspace' }], [
    { id: 'sess-1', name: 'Zapcam Spec', workspaceId: 'ws-zap', status: 'running', agent: 'claude', stageId: 'spec', role: 'delivery-planner', workingDir: repoDir, updatedAt: Date.now() }
  ]);

  assert.equal(detail.product_id, 'zapcam');
  assert.equal(detail.workspace.linked_workspace_name, 'Zapcam Workspace');
  assert.ok(detail.pipeline.some((step) => step.stage_id === 'spec'));
  assert.ok(detail.artifacts.some((artifact) => artifact.id === 'spec' && artifact.exists));
  assert.ok(detail.related_sessions.some((session) => session.id === 'sess-1'));
  assert.equal(detail.knowledge_packs.length, 1);
  assert.ok(detail.knowledge_stage_recommendations.some((stage) => stage.stage_id === 'brief' && stage.recommendations.length === 1));
  assert.ok(Array.isArray(detail.next_actions));
});

test('product service enriches next actions with knowledge preset metadata when pack is active', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'zapcam');
  fs.mkdirSync(repoDir, { recursive: true });

  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'zapcam',
        name: 'Zapcam',
        slug: 'zapcam',
        status: 'active',
        stage: 'build',
        owner: 'guibr',
        category: 'product',
        summary: 'Product summary',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: 'ws-zap', current_working_dir: repoDir, path_status: 'valid' },
        platform: {},
        governance: {}
      }
    ]
  }, null, 2));

  const knowledgePackService = makeKnowledgeService(dir, {
    packs: [
      {
        id: 'pm-skills',
        name: 'PM Skills',
        source: 'external-github',
        type: 'skills-pack',
        repo_url: 'https://github.com/phuryn/pm-skills',
        domains: ['product-discovery'],
        supported_runtimes: ['claude'],
        integration_mode: 'reference-first',
        status: 'active'
      }
    ],
    bindings: [
      { product_id: 'zapcam', knowledge_pack_id: 'pm-skills', enabled: true }
    ],
    recommendations: [
      {
        knowledge_pack_id: 'pm-skills',
        stage_id: 'brief',
        recommended_skills: ['identify-assumptions-new'],
        recommended_workflows: ['/discover'],
        recommended_roles: ['product-designer'],
        recommended_runtime_agents: ['claude']
      }
    ]
  });

  const service = makeProductService(dir, { registryFile, knowledgePackService });
  const detail = service.getProductDetail('zapcam', [{ id: 'ws-zap', name: 'Zapcam Workspace' }], []);
  const action = detail.next_actions.find((item) => item.id === 'start:brief');

  assert.ok(action);
  assert.equal(action.knowledge_pack_id, 'pm-skills');
  assert.equal(action.knowledge_pack_name, 'PM Skills');
  assert.equal(action.preset_type, 'workflow');
  assert.equal(action.preset_id, '/discover');
  assert.equal(action.preset_label, '/discover');
  assert.equal(action.preset_origin_stage, 'brief');
});

test('product service includes current run and hydrated run outputs in detail', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'zapcam');
  fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs', 'spec.md'), '# spec');
  fs.writeFileSync(path.join(repoDir, 'ARCHITECTURE.md'), '# architecture');

  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'zapcam',
        name: 'Zapcam',
        slug: 'zapcam',
        status: 'active',
        stage: 'build',
        owner: 'guibr',
        category: 'product',
        summary: 'Product summary',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: 'ws-zap', current_working_dir: repoDir, path_status: 'valid' },
        platform: {},
        governance: {}
      }
    ]
  }, null, 2));

  const service = makeProductService(dir, { registryFile });
  const created = [];
  const store = {
    createSession(payload) {
      created.push(payload);
      return { id: 'sess-run', status: 'running', updatedAt: Date.now(), ...payload };
    }
  };

  const start = service.startStage('zapcam', 'spec', { runtimeAgent: 'claude' }, store);
  const detail = service.getProductDetail('zapcam', [{ id: 'ws-zap', name: 'Zapcam Workspace' }], [
    { id: 'sess-run', name: start.session.name, workspaceId: 'ws-zap', status: 'running', agent: 'claude', stageId: 'spec', role: 'delivery-planner', workingDir: repoDir, updatedAt: Date.now(), productId: 'zapcam', runId: start.run.run_id }
  ]);

  assert.equal(created.length, 1);
  assert.ok(detail.current_run);
  assert.equal(detail.current_run.run_id, start.run.run_id);
  assert.equal(detail.current_run.stage_id, 'spec');
  assert.ok(detail.current_run.expected_outputs.some((output) => output.type === 'artifact' && output.ref_id === 'spec'));
  assert.ok(detail.current_run.produced_outputs.some((output) => output.type === 'session' && output.ref_id === 'sess-run'));
  assert.ok(detail.current_run.produced_outputs.some((output) => output.type === 'artifact' && output.ref_id === 'spec'));
  assert.ok(detail.runs.some((run) => run.run_id === start.run.run_id));
});

test('product service hydrates current run with knowledge driver metadata when execution comes from pack', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'zapcam');
  fs.mkdirSync(repoDir, { recursive: true });

  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'zapcam',
        name: 'Zapcam',
        slug: 'zapcam',
        status: 'active',
        stage: 'build',
        owner: 'guibr',
        category: 'product',
        summary: 'Product summary',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: 'ws-zap', current_working_dir: repoDir, path_status: 'valid' },
        platform: {},
        governance: {}
      }
    ]
  }, null, 2));

  const knowledgePackService = makeKnowledgeService(dir, {
    packs: [
      {
        id: 'pm-skills',
        name: 'PM Skills',
        source: 'external-github',
        type: 'skills-pack',
        repo_url: 'https://github.com/phuryn/pm-skills',
        domains: ['product-discovery'],
        supported_runtimes: ['claude'],
        integration_mode: 'reference-first',
        status: 'active'
      }
    ],
    bindings: [
      { product_id: 'zapcam', knowledge_pack_id: 'pm-skills', enabled: true }
    ],
    recommendations: [
      {
        knowledge_pack_id: 'pm-skills',
        stage_id: 'brief',
        recommended_skills: ['identify-assumptions-new'],
        recommended_workflows: ['/discover'],
        recommended_roles: ['product-designer'],
        recommended_runtime_agents: ['claude']
      }
    ]
  });
  const service = makeProductService(dir, { registryFile, knowledgePackService });
  const created = [];
  const store = {
    createSession(payload) {
      created.push(payload);
      return { id: 'sess-run', status: 'running', updatedAt: Date.now(), ...payload };
    }
  };

  const result = service.executeNextAction('zapcam', 'start:brief', { runtimeAgent: 'claude' }, store, [{ id: 'ws-zap', name: 'Zapcam Workspace' }], []);
  const detail = service.getProductDetail('zapcam', [{ id: 'ws-zap', name: 'Zapcam Workspace' }], [
    { id: 'sess-run', name: result.session.name, workspaceId: 'ws-zap', status: 'running', agent: 'claude', stageId: 'brief', role: 'product-designer', workingDir: repoDir, updatedAt: Date.now(), productId: 'zapcam', runId: result.run.run_id }
  ]);

  assert.equal(created.length, 1);
  assert.ok(detail.current_run);
  assert.equal(detail.current_run.knowledge_pack_id, 'pm-skills');
  assert.equal(detail.current_run.knowledge_pack_name, 'PM Skills');
  assert.equal(detail.current_run.preset_type, 'workflow');
  assert.equal(detail.current_run.preset_id, '/discover');
  assert.equal(detail.current_run.preset_label, '/discover');
  assert.equal(detail.current_run.preset_origin, 'next-action');
  assert.match(created[0].promptSeed, /Knowledge Pack: PM Skills/);
  assert.match(created[0].promptSeed, /Knowledge Preset: workflow \/discover/);
});

test('product service creates handoff and guided session', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'tool');
  fs.mkdirSync(repoDir, { recursive: true });
  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'tool',
        name: 'Internal Tool',
        slug: 'tool',
        status: 'active',
        stage: 'build',
        owner: 'guibr',
        category: 'internal-tool',
        summary: 'Internal tool',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: 'ws-tool', current_working_dir: repoDir, path_status: 'valid' },
        platform: {},
        governance: {}
      }
    ]
  }, null, 2));

  const handoffsFile = path.join(dir, 'handoffs.json');
  const runsFile = path.join(dir, 'runs.json');
  const service = makeProductService(dir, {
    registryFile,
    handoffsFile,
    runsFile
  });
  const created = [];
  const store = {
    createSession(payload) {
      created.push(payload);
      return { id: 'sess-created', status: 'running', updatedAt: Date.now(), ...payload };
    }
  };

  const start = service.startStage('tool', 'architecture', { runtimeAgent: 'codex' }, store);
  const handoff = service.createHandoff('tool', {
    run_id: start.run.run_id,
    from_stage: 'architecture',
    to_stage: 'implementation',
    role: 'principal-architect',
    runtime_agent: 'codex',
    session_id: start.session.id,
    summary: 'Architecture completed',
    output_refs: ['artifact:architecture', `session:${start.session.id}`]
  });
  const detail = service.getProductDetail('tool', [{ id: 'ws-tool', name: 'Tool Workspace' }], [
    { id: 'sess-created', name: start.session.name, workspaceId: 'ws-tool', status: 'running', agent: 'codex', stageId: 'architecture', role: 'principal-architect', workingDir: repoDir, updatedAt: Date.now(), productId: 'tool', runId: start.run.run_id }
  ]);

  assert.equal(handoff.product_id, 'tool');
  assert.equal(handoff.run_id, start.run.run_id);
  assert.deepEqual(handoff.output_refs, ['artifact:architecture', `session:${start.session.id}`]);
  assert.equal(handoff.knowledge_driver, null);
  assert.ok(Array.isArray(handoff.expected_outputs_snapshot));
  assert.ok(Array.isArray(handoff.produced_outputs_snapshot));
  assert.ok(handoff.expected_outputs_snapshot.some((output) => output.type === 'artifact' && output.ref_id === 'architecture'));
  assert.ok(handoff.produced_outputs_snapshot.some((output) => output.type === 'session' && output.ref_id === start.session.id));
  assert.equal(start.session.stageId, 'architecture');
  assert.equal(start.session.role, 'principal-architect');
  assert.equal(created[0].productId, 'tool');
  assert.ok(detail.current_run);
  assert.equal(detail.current_run.run_id, start.run.run_id);
  assert.equal(detail.current_run.status, 'completed');
  assert.equal(detail.current_run.latest_handoff?.handoff_id, handoff.handoff_id);
  assert.equal(detail.current_run.next_stage_hint, 'implementation');
  assert.ok(detail.current_run.linked_handoffs.some((item) => item.handoff_id === handoff.handoff_id));
  assert.ok(detail.current_run.produced_outputs.some((output) => output.type === 'handoff' && output.ref_id === handoff.handoff_id));
});

test('product service snapshots run context inside handoff records', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'snap');
  fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs', 'brief.md'), '# brief');
  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'snap',
        name: 'Snap',
        slug: 'snap',
        status: 'active',
        stage: 'build',
        owner: 'guibr',
        category: 'product',
        summary: 'snapshot',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: 'ws-snap', current_working_dir: repoDir, path_status: 'valid' },
        platform: {},
        governance: {}
      }
    ]
  }, null, 2));

  const knowledgePackService = makeKnowledgeService(dir, {
    packs: [{ id: 'pm-skills', name: 'PM Skills', source: 'external-github', type: 'skills-pack', repo_url: 'https://github.com/phuryn/pm-skills', domains: ['product-discovery'], supported_runtimes: ['claude'], integration_mode: 'reference-first', status: 'active' }],
    bindings: [{ product_id: 'snap', knowledge_pack_id: 'pm-skills', enabled: true }],
    recommendations: [{ knowledge_pack_id: 'pm-skills', stage_id: 'brief', recommended_skills: ['identify-assumptions-new'], recommended_workflows: ['/discover'], recommended_roles: ['product-designer'], recommended_runtime_agents: ['claude'] }]
  });
  const service = makeProductService(dir, { registryFile, knowledgePackService });
  const store = {
    createSession(payload) {
      return { id: 'sess-snap', status: 'running', updatedAt: Date.now(), ...payload };
    }
  };

  const start = service.startStage('snap', 'brief', {
    runtimeAgent: 'claude',
    knowledge_pack_id: 'pm-skills',
    knowledge_pack_name: 'PM Skills',
    preset_type: 'workflow',
    preset_id: '/discover',
    preset_label: '/discover'
  }, store);
  const handoff = service.createHandoff('snap', {
    run_id: start.run.run_id,
    from_stage: 'brief',
    to_stage: 'spec',
    role: 'product-designer',
    runtime_agent: 'claude',
    session_id: 'sess-snap',
    summary: 'Brief completed with target audience and outcomes.',
    artifact_refs: ['brief'],
    output_refs: ['knowledge:pm-skills:workflow:/discover', 'session:sess-snap']
  });

  assert.equal(handoff.run_id, start.run.run_id);
  assert.ok(Array.isArray(handoff.expected_outputs_snapshot));
  assert.ok(handoff.expected_outputs_snapshot.some((item) => item.type === 'artifact' && item.ref_id === 'brief'));
  assert.ok(Array.isArray(handoff.produced_outputs_snapshot));
  assert.ok(handoff.produced_outputs_snapshot.some((item) => item.type === 'knowledge-driver'));
  assert.equal(handoff.knowledge_driver.knowledge_pack_id, 'pm-skills');
  assert.equal(handoff.knowledge_driver.preset_id, '/discover');
});

test('product service carries latest handoff into the next stage prompt and current run', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'flow');
  fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs', 'brief.md'), '# brief');
  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'flow',
        name: 'Flow',
        slug: 'flow',
        status: 'active',
        stage: 'build',
        owner: 'guibr',
        category: 'product',
        summary: 'handoff continuity',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: 'ws-flow', current_working_dir: repoDir, path_status: 'valid' },
        platform: {},
        governance: {}
      }
    ]
  }, null, 2));

  const service = makeProductService(dir, { registryFile });
  const created = [];
  const store = {
    createSession(payload) {
      created.push(payload);
      return { id: 'sess-flow-' + created.length, status: 'running', updatedAt: Date.now(), ...payload };
    }
  };

  const briefRun = service.startStage('flow', 'brief', { runtimeAgent: 'claude' }, store);
  service.createHandoff('flow', {
    run_id: briefRun.run.run_id,
    from_stage: 'brief',
    to_stage: 'spec',
    role: 'product-designer',
    runtime_agent: 'claude',
    session_id: briefRun.session.id,
    summary: 'Use the brief as the baseline for the spec.',
    artifact_refs: ['brief'],
    output_refs: ['artifact:brief']
  });
  const specStart = service.startStage('flow', 'spec', { runtimeAgent: 'claude' }, store);
  const detail = service.getProductDetail('flow', [{ id: 'ws-flow', name: 'Flow Workspace' }], [
    { id: briefRun.session.id, name: briefRun.session.name, workspaceId: 'ws-flow', status: 'running', agent: 'claude', stageId: 'brief', role: 'product-designer', workingDir: repoDir, updatedAt: Date.now(), productId: 'flow', runId: briefRun.run.run_id },
    { id: specStart.session.id, name: specStart.session.name, workspaceId: 'ws-flow', status: 'running', agent: 'claude', stageId: 'spec', role: 'delivery-planner', workingDir: repoDir, updatedAt: Date.now(), productId: 'flow', runId: specStart.run.run_id }
  ]);

  assert.match(created[1].promptSeed, /Previous handoff from: brief -> spec/);
  assert.match(created[1].promptSeed, /Handoff summary: Use the brief as the baseline for the spec\./);
  assert.match(created[1].promptSeed, /Referenced outputs: artifact:brief/);
  assert.ok(detail.current_run);
  assert.equal(detail.current_run.stage_id, 'spec');
  assert.ok(detail.current_run.incoming_handoffs.some((item) => item.from_stage === 'brief' && item.to_stage === 'spec'));
  const briefStage = detail.pipeline.find((item) => item.stage_id === 'brief');
  assert.equal(briefStage.status, 'done');
  const nextAction = detail.next_actions.find((item) => item.step_id === 'spec' || item.action_type === 'continue-run');
  assert.ok(nextAction);
});

test('product service updates linked workspace and path status', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'repo');
  const otherDir = path.join(dir, 'other');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(otherDir, { recursive: true });

  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'p1',
        name: 'P1',
        slug: 'p1',
        status: 'active',
        stage: 'build',
        owner: 'guibr',
        category: 'product',
        summary: 'x',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: '', current_working_dir: '', path_status: 'unknown' },
        platform: {},
        governance: { notes: [] },
        timestamps: {}
      }
    ]
  }, null, 2));

  const service = new ProductService({
    registryFile,
    handoffsFile: path.join(dir, 'handoffs.json'),
    knowledgePackService: makeKnowledgeService(dir, { packs: [], bindings: [], recommendations: [] })
  });
  const valid = service.updateProductWorkspace('p1', { id: 'ws-1', name: 'Repo', workingDir: repoDir });
  const mismatched = service.updateProductWorkspace('p1', { id: 'ws-2', name: 'Other', workingDir: otherDir });

  assert.equal(valid.workspace.path_status, 'valid');
  assert.equal(mismatched.workspace.runtime_workspace_id, 'ws-2');
  assert.equal(mismatched.workspace.path_status, 'mismatched');
});

test('product service resolves consolidated working directory from workspace link', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });

  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'rondax',
        name: 'Ronda X',
        slug: 'rondax',
        status: 'active',
        stage: 'build',
        owner: 'guibr',
        category: 'product',
        summary: 'x',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: 'ws-ronda', current_working_dir: 'C:\\invalid', path_status: 'invalid' },
        platform: {},
        governance: {},
        timestamps: {}
      }
    ]
  }, null, 2));

  const service = new ProductService({
    registryFile,
    handoffsFile: path.join(dir, 'handoffs.json'),
    knowledgePackService: makeKnowledgeService(dir, { packs: [], bindings: [], recommendations: [] }),
    runCoordinatorService: new RunCoordinatorService({ runsFile: path.join(dir, 'runs.json') })
  });
  const resolved = service.resolveWorkingDirectory('ws-ronda', 'C:\\missing-path');

  assert.equal(resolved, repoDir);
});

test('product service executes next action by creating a run and linked session', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });
  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'p1',
        name: 'P1',
        slug: 'p1',
        status: 'active',
        stage: 'build',
        owner: 'guibr',
        category: 'product',
        summary: 'product summary',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: 'ws-1', current_working_dir: repoDir, path_status: 'valid' },
        platform: {},
        governance: {}
      }
    ]
  }, null, 2));

  const service = makeProductService(dir, { registryFile });
  const productDetail = service.getProductDetail('p1', [{ id: 'ws-1', name: 'Workspace 1' }], []);
  const action = productDetail.next_actions.find((item) => item.id === 'start:brief');
  const created = [];
  const store = {
    createSession(payload) {
      created.push(payload);
      return { id: 'sess-next', status: 'running', updatedAt: Date.now(), ...payload };
    }
  };

  assert.ok(action);
  const result = service.executeNextAction('p1', action.id, { runtimeAgent: 'gemini' }, store, [{ id: 'ws-1', name: 'Workspace 1' }], []);

  assert.equal(result.reused, false);
  assert.equal(result.action.id, 'start:brief');
  assert.equal(result.run.product_id, 'p1');
  assert.equal(result.run.stage_id, 'brief');
  assert.equal(result.session.runId, result.run.run_id);
  assert.equal(result.session.agent, 'gemini');
  assert.equal(created.length, 1);
  assert.equal(created[0].runId, result.run.run_id);
  assert.match(created[0].promptSeed, new RegExp(result.run.run_id));
});

test('product service falls back safely when product has no active knowledge pack', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });
  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'plain-product',
        name: 'Plain Product',
        slug: 'plain-product',
        status: 'active',
        stage: 'build',
        owner: 'guibr',
        category: 'product',
        summary: 'No pack bound',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: 'ws-plain', current_working_dir: repoDir, path_status: 'valid' },
        platform: {},
        governance: {}
      }
    ]
  }, null, 2));

  const service = makeProductService(dir, { registryFile });
  const detail = service.getProductDetail('plain-product', [{ id: 'ws-plain', name: 'Plain Workspace' }], []);
  const action = detail.next_actions.find((item) => item.id === 'start:brief');

  assert.ok(action);
  assert.equal(action.knowledge_pack_id || '', '');
  assert.equal(action.knowledge_pack_name || '', '');
  assert.equal(action.preset_type || '', '');
  assert.equal(action.preset_id || '', '');
  assert.equal(action.preset_label || '', '');
});

test('product service falls back safely when stage has no knowledge recommendation', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });
  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'zapcam',
        name: 'Zapcam',
        slug: 'zapcam',
        status: 'active',
        stage: 'build',
        owner: 'guibr',
        category: 'product',
        summary: 'Only spec recommendation exists',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: 'ws-zap', current_working_dir: repoDir, path_status: 'valid' },
        platform: {},
        governance: {}
      }
    ]
  }, null, 2));

  const knowledgePackService = makeKnowledgeService(dir, {
    packs: [
      {
        id: 'pm-skills',
        name: 'PM Skills',
        source: 'external-github',
        type: 'skills-pack',
        repo_url: 'https://github.com/phuryn/pm-skills',
        domains: ['product-discovery'],
        supported_runtimes: ['claude'],
        integration_mode: 'reference-first',
        status: 'active'
      }
    ],
    bindings: [
      { product_id: 'zapcam', knowledge_pack_id: 'pm-skills', enabled: true }
    ],
    recommendations: [
      {
        knowledge_pack_id: 'pm-skills',
        stage_id: 'spec',
        recommended_skills: ['prioritize-features'],
        recommended_workflows: ['/write-prd'],
        recommended_roles: ['delivery-planner'],
        recommended_runtime_agents: ['claude']
      }
    ]
  });

  const service = makeProductService(dir, { registryFile, knowledgePackService });
  const detail = service.getProductDetail('zapcam', [{ id: 'ws-zap', name: 'Zapcam Workspace' }], []);
  const action = detail.next_actions.find((item) => item.id === 'start:brief');

  assert.ok(action);
  assert.equal(action.knowledge_pack_id || '', '');
  assert.equal(action.preset_type || '', '');
  assert.equal(action.preset_id || '', '');
  assert.equal(action.preset_label || '', '');
});

test('product service reuses active run and session when executing continue action', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs', 'brief.md'), '# brief');

  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'p2',
        name: 'P2',
        slug: 'p2',
        status: 'active',
        stage: 'build',
        owner: 'guibr',
        category: 'product',
        summary: 'product summary',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: 'ws-2', current_working_dir: repoDir, path_status: 'valid' },
        platform: {},
        governance: {}
      }
    ]
  }, null, 2));

  const service = makeProductService(dir, { registryFile });
  const run = service.runCoordinatorService.createOrReuseRun(
    service.getProductById('p2'),
    {
      stage_id: 'brief',
      label: 'Brief',
      goal: 'Turn the idea into a problem, audience and outcome brief.',
      recommended_role: 'product-designer',
      recommended_runtime_agent: 'claude',
      required_artifacts: ['brief']
    },
    {
      objective: 'Refine the brief',
      role: 'product-designer',
      suggested_runtime_agent: 'claude',
      workspace_id: 'ws-2',
      expected_outputs: [{ output_id: 'artifact:brief', type: 'artifact', ref_id: 'brief', label: 'Brief', required: true }],
      action_label: 'Start Brief run'
    }
  );
  service.runCoordinatorService.attachSession(run.run_id, {
    id: 'sess-existing',
    name: 'Existing Brief',
    agent: 'claude',
    workspaceId: 'ws-2'
  });

  const workspaces = [{ id: 'ws-2', name: 'Workspace 2' }];
  const sessions = [{
    id: 'sess-existing',
    name: 'Existing Brief',
    workspaceId: 'ws-2',
    status: 'running',
    agent: 'claude',
    stageId: 'brief',
    role: 'product-designer',
    workingDir: repoDir,
    updatedAt: Date.now(),
    productId: 'p2',
    runId: run.run_id
  }];
  const detail = service.getProductDetail('p2', workspaces, sessions);
  const action = detail.next_actions.find((item) => item.action_type === 'continue-run');
  let createCalls = 0;
  const store = {
    createSession() {
      createCalls += 1;
      return null;
    }
  };

  assert.ok(action);
  const result = service.executeNextAction('p2', action.id, {}, store, workspaces, sessions);

  assert.equal(result.reused, true);
  assert.equal(result.run.run_id, run.run_id);
  assert.equal(result.session.id, 'sess-existing');
  assert.equal(createCalls, 0);
  const reusedRun = service.runCoordinatorService.getRunById(run.run_id);
  assert.ok(reusedRun.produced_outputs.some((output) => output.type === 'action' && output.label === action.label));
});

test('product service uses latest incoming handoff to enrich next action continuity and guided prompt', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs', 'brief.md'), '# brief');

  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'p3',
        name: 'P3',
        slug: 'p3',
        status: 'active',
        stage: 'build',
        owner: 'guibr',
        category: 'product',
        summary: 'product summary',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: 'ws-3', current_working_dir: repoDir, path_status: 'valid' },
        platform: {},
        governance: {}
      }
    ]
  }, null, 2));

  const service = makeProductService(dir, { registryFile });
  const briefRun = service.runCoordinatorService.createOrReuseRun(
    service.getProductById('p3'),
    {
      stage_id: 'brief',
      label: 'Brief',
      goal: 'Turn the idea into a problem, audience and outcome brief.',
      recommended_role: 'product-designer',
      recommended_runtime_agent: 'claude',
      required_artifacts: ['brief']
    },
    {
      objective: 'Produce the brief',
      role: 'product-designer',
      suggested_runtime_agent: 'claude',
      workspace_id: 'ws-3',
      expected_outputs: [{ output_id: 'artifact:brief', type: 'artifact', ref_id: 'brief', label: 'Brief', required: true }]
    }
  );
  service.runCoordinatorService.attachSession(briefRun.run_id, {
    id: 'sess-brief',
    name: 'Brief Session',
    workspaceId: 'ws-3',
    agent: 'claude'
  });
  const handoff = service.createHandoff('p3', {
    run_id: briefRun.run_id,
    from_stage: 'brief',
    to_stage: 'spec',
    role: 'product-designer',
    runtime_agent: 'claude',
    session_id: 'sess-brief',
    summary: 'Brief is ready for spec.',
    output_refs: ['artifact:brief']
  });

  const workspaces = [{ id: 'ws-3', name: 'Workspace 3' }];
  const sessions = [{
    id: 'sess-brief',
    name: 'Brief Session',
    workspaceId: 'ws-3',
    status: 'running',
    agent: 'claude',
    stageId: 'brief',
    role: 'product-designer',
    workingDir: repoDir,
    updatedAt: Date.now(),
    productId: 'p3',
    runId: briefRun.run_id
  }];
  const detail = service.getProductDetail('p3', workspaces, sessions);
  const action = detail.next_actions.find((item) => item.id === 'start:spec');
  const created = [];
  const store = {
    createSession(payload) {
      created.push(payload);
      return { id: 'sess-spec', status: 'running', updatedAt: Date.now(), ...payload };
    }
  };

  assert.ok(action);
  assert.equal(action.uses_previous_handoff, true);
  assert.equal(action.previous_handoff_id, handoff.handoff_id);
  assert.equal(action.previous_handoff_summary, 'Brief is ready for spec.');

  const result = service.executeNextAction('p3', action.id, {}, store, workspaces, sessions);

  assert.equal(result.previous_handoff?.handoff_id, handoff.handoff_id);
  assert.match(created[0].promptSeed, /Previous handoff from: brief -> spec/);
  assert.match(created[0].promptSeed, /Handoff summary: Brief is ready for spec\./);
  assert.match(created[0].promptSeed, /Referenced outputs: artifact:brief/);
});

test('product service pipeline prioritizes runs and handoffs over artifact-only progress', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs', 'brief.md'), '# brief');

  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'p4',
        name: 'P4',
        slug: 'p4',
        status: 'active',
        stage: 'build',
        owner: 'guibr',
        category: 'product',
        summary: 'product summary',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: 'ws-4', current_working_dir: repoDir, path_status: 'valid' },
        platform: {},
        governance: {}
      }
    ]
  }, null, 2));

  const service = makeProductService(dir, { registryFile });
  const product = service.getProductById('p4');
  const briefStage = {
    stage_id: 'brief',
    label: 'Brief',
    goal: 'Turn the idea into a problem, audience and outcome brief.',
    recommended_role: 'product-designer',
    recommended_runtime_agent: 'claude',
    required_artifacts: ['brief']
  };
  const specStage = {
    stage_id: 'spec',
    label: 'Spec',
    goal: 'Define scope, acceptance and system constraints.',
    recommended_role: 'delivery-planner',
    recommended_runtime_agent: 'claude',
    required_artifacts: ['spec']
  };
  const briefRun = service.runCoordinatorService.createOrReuseRun(product, briefStage, {
    objective: 'Produce brief',
    role: 'product-designer',
    suggested_runtime_agent: 'claude',
    workspace_id: 'ws-4',
    expected_outputs: [{ output_id: 'artifact:brief', type: 'artifact', ref_id: 'brief', label: 'Brief', required: true }]
  });
  const handoff = service.createHandoff('p4', {
    run_id: briefRun.run_id,
    from_stage: 'brief',
    to_stage: 'spec',
    role: 'product-designer',
    runtime_agent: 'claude',
    session_id: '',
    summary: 'Brief completed.'
  });
  service.runCoordinatorService.createOrReuseRun(product, specStage, {
    objective: 'Define spec',
    role: 'delivery-planner',
    suggested_runtime_agent: 'claude',
    workspace_id: 'ws-4',
    expected_outputs: [{ output_id: 'artifact:spec', type: 'artifact', ref_id: 'spec', label: 'Spec', required: true }]
  });

  const detail = service.getProductDetail('p4', [{ id: 'ws-4', name: 'Workspace 4' }], []);
  const brief = detail.pipeline.find((stage) => stage.stage_id === 'brief');
  const spec = detail.pipeline.find((stage) => stage.stage_id === 'spec');

  assert.equal(brief.status, 'done');
  assert.equal(spec.status, 'in-progress');
  assert.equal(brief.latest_handoff?.handoff_id, handoff.handoff_id);
  assert.ok(spec.active_run_id);
});

test('getHandoffs returns enriched records with snapshots and knowledge driver metadata', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-service-'));
  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'p5',
        name: 'Product 5',
        slug: 'product-5',
        owner: 'owner',
        stage: 'brief',
        status: 'active',
        category: 'product',
        summary: 'Summary',
        repo: { mode: 'local', local_path: dir, remote_url: '', default_branch: 'main' },
        workspace: { runtime_workspace_id: 'ws-5', current_working_dir: dir, path_status: 'valid' },
        platform: {},
        governance: {}
      }
    ]
  }, null, 2));

  const service = makeProductService(dir, { registryFile });
  const product = service.getProductById('p5');
  const briefStage = {
    stage_id: 'brief',
    label: 'Brief',
    goal: 'Turn the idea into a problem, audience and outcome brief.',
    recommended_role: 'product-designer',
    recommended_runtime_agent: 'claude',
    required_artifacts: ['brief']
  };

  const run = service.runCoordinatorService.createOrReuseRun(product, briefStage, {
    objective: 'Produce brief',
    role: 'product-designer',
    suggested_runtime_agent: 'claude',
    workspace_id: 'ws-5',
    expected_outputs: [{ output_id: 'artifact:brief', type: 'artifact', ref_id: 'brief', label: 'Brief', required: true }],
    knowledge_pack_id: 'pm-skills',
    knowledge_pack_name: 'PM Skills Marketplace',
    preset_type: 'workflow',
    preset_id: '/discover',
    preset_label: '/discover',
    preset_origin: 'next-action'
  });

  service.createHandoff('p5', {
    run_id: run.run_id,
    from_stage: 'brief',
    to_stage: 'spec',
    role: 'product-designer',
    runtime_agent: 'claude',
    summary: 'Carry brief context into spec.'
  });

  const handoff = service.getHandoffs('p5')[0];
  assert.equal(handoff.run_id, run.run_id);
  assert.ok(Array.isArray(handoff.expected_outputs_snapshot));
  assert.ok(Array.isArray(handoff.produced_outputs_snapshot));
  assert.equal(handoff.knowledge_driver?.knowledge_pack_id, 'pm-skills');
  assert.equal(handoff.knowledge_driver?.preset_id, '/discover');
});
