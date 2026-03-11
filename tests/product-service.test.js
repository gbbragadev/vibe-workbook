const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ProductService, deriveReadiness } = require('../src/core/product-service');
const { KnowledgePackService } = require('../src/core/knowledge-pack-service');
const { RunCoordinatorService, classifyOutputCategory } = require('../src/core/run-coordinator-service');

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
  const gitOrchestrator = opts.gitOrchestrator || {
    isRepo: async () => false,
    isDirty: async () => false,
    commitAll: async () => null,
    getHeadHash: async () => null,
    hardReset: async () => {},
    init: async () => {}
  };

  return new ProductService({
    registryFile,
    handoffsFile,
    knowledgePackService,
    runCoordinatorService,
    gitOrchestrator,
    projectCopilotService: opts.projectCopilotService
  });
}

test('product service builds detail with pipeline, artifacts and sessions', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'zapcam');
  fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, '.platform'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs', 'spec.md'), '# spec');
  fs.writeFileSync(path.join(repoDir, 'ARCHITECTURE.md'), '# architecture');
  fs.writeFileSync(path.join(repoDir, 'docs', 'test-strategy.md'), '# tests');
  fs.writeFileSync(path.join(repoDir, '.platform', 'product.json'), JSON.stringify({ name: 'Zapcam' }, null, 2));

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
        platform: { manifest_path: '.platform/product.json' },
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

test('product service recognizes discovery briefs as the brief artifact', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'zapcam');
  fs.mkdirSync(path.join(repoDir, 'docs', 'discovery'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, '.platform'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs', 'discovery', '2026-03-07-zapcam-discovery-brief.md'), '# discovery brief');
  fs.writeFileSync(path.join(repoDir, '.platform', 'product.json'), JSON.stringify({ name: 'Zapcam' }, null, 2));

  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'zapcam',
        name: 'Zapcam',
        slug: 'zapcam',
        status: 'active',
        stage: 'brief',
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
  const detail = service.getProductDetail('zapcam', [{ id: 'ws-zap', name: 'Zapcam Workspace' }], []);

  const briefArtifact = detail.artifacts.find((artifact) => artifact.id === 'brief');
  assert.ok(briefArtifact);
  assert.equal(briefArtifact.exists, true);
  assert.match(briefArtifact.path, /docs[\\/]+discovery$/);
});

test('product detail includes a copilot snapshot with candidate artifacts and recommendation', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'zapcam');
  fs.mkdirSync(path.join(repoDir, 'docs', 'discovery'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, '.platform'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs', 'discovery', '2026-03-07-zapcam-discovery-brief.md'), '# discovery brief');
  fs.writeFileSync(path.join(repoDir, '.platform', 'product.json'), JSON.stringify({ name: 'Zapcam' }, null, 2));

  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'zapcam',
        name: 'Zapcam',
        slug: 'zapcam',
        status: 'active',
        stage: 'brief',
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
  const detail = service.getProductDetail('zapcam', [{ id: 'ws-zap', name: 'Zapcam Workspace' }], []);

  assert.ok(detail.copilot);
  assert.match(detail.copilot.summary, /asset|evidence|testing/i);
  assert.ok(detail.copilot.candidate_artifacts.some((item) => /docs\/discovery\/2026-03-07-zapcam-discovery-brief\.md/i.test(item.relative_path)));
  assert.equal(detail.copilot.recommended_next_move.action_type, 'review-artifact-candidates');
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

test('product service includes current run and hydrated run outputs in detail', async () => {
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

  const start = await service.startStage('zapcam', 'spec', { runtimeAgent: 'claude' }, store);
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

test('startStage ignores non-blocking .claude untracked metadata entries for implementation stage', async () => {
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
        stage: 'brief',
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

  const service = makeProductService(dir, {
    registryFile,
    gitOrchestrator: {
      isRepo: async () => true,
      isDirty: async () => true,
      getDirtyState: async () => ({
        dirty: false,
        blockingEntries: [],
        ignoredEntries: [{ status: '??', path: '.claude/worktrees/test/' }]
      }),
      commitAll: async () => 'abc123',
      getHeadHash: async () => 'abc123',
      hardReset: async () => {},
      init: async () => {}
    }
  });

  let created = null;
  const store = {
    createSession(payload) {
      created = payload;
      return { id: 'sess-clean', status: 'running', updatedAt: Date.now(), ...payload };
    }
  };

  const result = await service.startStage('zapcam', 'implementation', { runtimeAgent: 'codex' }, store);
  assert.equal(result.error, undefined);
  assert.ok(result.session);
  assert.ok(created);
});

test('startStage does not block planning stages when repository is dirty', async () => {
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
        stage: 'brief',
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

  let commitCalls = 0;
  const service = makeProductService(dir, {
    registryFile,
    gitOrchestrator: {
      isRepo: async () => true,
      isDirty: async () => true,
      getDirtyState: async () => ({
        dirty: true,
        blockingEntries: [
          { status: ' M', path: 'docs/spec.md' },
          { status: '??', path: 'tmp/local-notes.txt' }
        ],
        ignoredEntries: []
      }),
      commitAll: async () => {
        commitCalls += 1;
        return null;
      },
      getHeadHash: async () => null,
      hardReset: async () => {},
      init: async () => {}
    }
  });

  const result = await service.startStage('zapcam', 'spec', { runtimeAgent: 'claude' }, {
    createSession(payload) {
      return { id: 'sess-spec', status: 'running', updatedAt: Date.now(), ...payload };
    }
  });

  assert.equal(result.error, undefined);
  assert.ok(result.session);
  assert.equal(commitCalls, 0);
});

test('startStage returns actionable dirty-tree error with directory and pending files for implementation stage', async () => {
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
        stage: 'brief',
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

  const service = makeProductService(dir, {
    registryFile,
    gitOrchestrator: {
      isRepo: async () => true,
      isDirty: async () => true,
      getDirtyState: async () => ({
        dirty: true,
        blockingEntries: [
          { status: ' M', path: 'docs/brief.md' },
          { status: '??', path: 'tmp/local-notes.txt' }
        ],
        ignoredEntries: []
      }),
      commitAll: async () => null,
      getHeadHash: async () => null,
      hardReset: async () => {},
      init: async () => {}
    }
  });

  const result = await service.startStage('zapcam', 'implementation', { runtimeAgent: 'codex' }, { createSession() {} });
  assert.equal(result.status, 400);
  assert.match(result.error, /Working directory is not clean:/);
  assert.match(result.error, /docs\/brief\.md/);
  assert.match(result.error, /tmp\/local-notes\.txt/);
  assert.match(result.error, /Commit or stash/);
});

test('startStage scopes git dirty checks and checkpoints to the product working directory for implementation stage', async () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'polyagent');
  fs.mkdirSync(repoDir, { recursive: true });

  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'polyagent',
        name: 'POLYAGENT',
        slug: 'polyagent',
        status: 'active',
        stage: 'brief',
        owner: 'guibr',
        category: 'product',
        summary: 'Product summary',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: 'ws-poly', current_working_dir: repoDir, path_status: 'valid' },
        platform: { manifest_path: '.platform/product.json' },
        governance: {}
      }
    ]
  }, null, 2));

  const captured = {
    dirtyArgs: null,
    commitArgs: null
  };
  const service = makeProductService(dir, {
    registryFile,
    gitOrchestrator: {
      isRepo: async () => true,
      isDirty: async () => false,
      getDirtyState: async (...args) => {
        captured.dirtyArgs = args;
        return { dirty: false, blockingEntries: [], ignoredEntries: [] };
      },
      commitAll: async (...args) => {
        captured.commitArgs = args;
        return 'abc123';
      },
      getHeadHash: async () => 'abc123',
      hardReset: async () => {},
      init: async () => {}
    }
  });

  const result = await service.startStage('polyagent', 'implementation', { runtimeAgent: 'codex' }, {
    createSession(payload) {
      return { id: 'sess-poly', status: 'running', updatedAt: Date.now(), ...payload };
    }
  });

  assert.equal(result.status, undefined);
  assert.deepEqual(captured.dirtyArgs, [repoDir, repoDir]);
  assert.deepEqual(captured.commitArgs, [repoDir, '[vibe-chkpt] Pre-Run Checkpoint for implementation', repoDir]);
});

test('startStage returns git-check-failed error when git status fails for implementation stage', async () => {
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
        stage: 'brief',
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

  const service = makeProductService(dir, {
    registryFile,
    gitOrchestrator: {
      isRepo: async () => true,
      isDirty: async () => true,
      getDirtyState: async () => ({
        dirty: true,
        blockingEntries: [],
        ignoredEntries: [],
        checkFailed: true
      }),
      commitAll: async () => null,
      getHeadHash: async () => null,
      hardReset: async () => {},
      init: async () => {}
    }
  });

  const result = await service.startStage('zapcam', 'implementation', { runtimeAgent: 'codex' }, { createSession() {} });
  assert.equal(result.status, 400);
  assert.match(result.error, /git check failed/i);
  assert.match(result.error, /zapcam/i);
});

test('product service hydrates current run with knowledge driver metadata when execution comes from pack', async () => {
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
      return { id: 'sess-run-' + created.length, status: 'running', updatedAt: Date.now(), ...payload };
    }
  };

  const result = await service.executeNextAction('zapcam', 'start:brief', { runtimeAgent: 'claude' }, store, [{ id: 'ws-zap', name: 'Zapcam Workspace' }], []);
  const detail = service.getProductDetail('zapcam', [{ id: 'ws-zap', name: 'Zapcam Workspace' }], created.map((session, index) => ({
    id: 'sess-run-' + (index + 1),
    name: session.name,
    workspaceId: 'ws-zap',
    status: 'running',
    agent: session.agent,
    stageId: session.stageId,
    role: session.role,
    sessionRole: session.sessionRole,
    workerKind: session.workerKind,
    displayOrder: session.displayOrder,
    workingDir: repoDir,
    updatedAt: Date.now(),
    productId: 'zapcam',
    runId: result.run.run_id
  })));

  assert.equal(created.length, 2);
  assert.ok(detail.current_run);
  assert.equal(detail.current_run.knowledge_pack_id, 'pm-skills');
  assert.equal(detail.current_run.knowledge_pack_name, 'PM Skills');
  assert.equal(detail.current_run.preset_type, 'workflow');
  assert.equal(detail.current_run.preset_id, '/discover');
  assert.equal(detail.current_run.preset_label, '/discover');
  assert.equal(detail.current_run.preset_origin, 'next-action');
  assert.equal(result.sessions.length, 2);
  assert.equal(result.primary_session_id, result.session.id);
  assert.match(created[0].promptSeed, /Knowledge Pack: PM Skills/);
  assert.match(created[0].promptSeed, /Knowledge Preset: workflow \/discover/);
});

test('product service creates handoff and guided session', async () => {
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

  const start = await service.startStage('tool', 'architecture', { runtimeAgent: 'codex' }, store);
  const handoff = await service.createHandoff('tool', {
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

test('product service snapshots run context inside handoff records', async () => {
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

  const start = await service.startStage('snap', 'brief', {
    runtimeAgent: 'claude',
    knowledge_pack_id: 'pm-skills',
    knowledge_pack_name: 'PM Skills',
    preset_type: 'workflow',
    preset_id: '/discover',
    preset_label: '/discover'
  }, store);
  const handoff = await service.createHandoff('snap', {
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

test('product service carries latest handoff into the next stage prompt and current run', async () => {
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

  const briefRun = await service.startStage('flow', 'brief', { runtimeAgent: 'claude' }, store);
  await service.createHandoff('flow', {
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
  const specStart = await service.startStage('flow', 'spec', { runtimeAgent: 'claude' }, store);
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

test('product service executes next action by creating a run and linked session', async () => {
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
      return { id: 'sess-next-' + created.length, status: 'running', updatedAt: Date.now(), ...payload };
    }
  };

  assert.ok(action);
  const result = await service.executeNextAction('p1', action.id, { runtimeAgent: 'gemini' }, store, [{ id: 'ws-1', name: 'Workspace 1' }], []);

  assert.equal(result.reused, false);
  assert.equal(result.action.id, 'start:brief');
  assert.equal(result.run.product_id, 'p1');
  assert.equal(result.run.stage_id, 'brief');
  assert.equal(result.session.runId, result.run.run_id);
  assert.equal(result.session.agent, 'gemini');
  assert.equal(created.length, 2);
  assert.equal(result.sessions.length, 2);
  assert.equal(result.primary_session_id, result.session.id);
  assert.equal(result.terminal_layout, 2);
  assert.equal(created[0].sessionRole, 'orchestrator');
  assert.equal(created[1].sessionRole, 'worker');
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

test('product service reuses active run cluster when executing continue action', async () => {
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
    workspaceId: 'ws-2',
    sessionRole: 'orchestrator',
    workerKind: 'orchestrator',
    displayOrder: 0
  });
  service.runCoordinatorService.attachSession(run.run_id, {
    id: 'sess-worker',
    name: 'Brief Worker',
    agent: 'gemini',
    workspaceId: 'ws-2',
    sessionRole: 'worker',
    workerKind: 'brief-analyst',
    displayOrder: 1
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
    runId: run.run_id,
    sessionRole: 'orchestrator',
    workerKind: 'orchestrator',
    displayOrder: 0
  }, {
    id: 'sess-worker',
    name: 'Brief Worker',
    workspaceId: 'ws-2',
    status: 'running',
    agent: 'gemini',
    stageId: 'brief',
    role: 'brief-analyst',
    workingDir: repoDir,
    updatedAt: Date.now() - 1,
    productId: 'p2',
    runId: run.run_id,
    sessionRole: 'worker',
    workerKind: 'brief-analyst',
    displayOrder: 1
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
  const result = await service.executeNextAction('p2', action.id, {}, store, workspaces, sessions);

  assert.equal(result.reused, true);
  assert.equal(result.run.run_id, run.run_id);
  assert.equal(result.session.id, 'sess-existing');
  assert.equal(result.sessions.length, 2);
  assert.equal(result.primary_session_id, 'sess-existing');
  assert.equal(createCalls, 0);
  const reusedRun = service.runCoordinatorService.getRunById(run.run_id);
  assert.ok(reusedRun.produced_outputs.some((output) => output.type === 'action' && output.label === action.label));
});

test('product service creates release cluster with orchestrator and workers', async () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'release-repo');
  fs.mkdirSync(repoDir, { recursive: true });
  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'release-product',
        name: 'Release Product',
        slug: 'release-product',
        status: 'active',
        stage: 'build',
        owner: 'guibr',
        category: 'product',
        summary: 'release summary',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: 'ws-release', current_working_dir: repoDir, path_status: 'valid' },
        platform: {},
        governance: {}
      }
    ]
  }, null, 2));

  const service = makeProductService(dir, { registryFile });
  const action = {
    id: 'start:release',
    action_type: 'start-run',
    step_id: 'release',
    label: 'Start Release run',
    executable: true,
    objective: 'Prepare release readiness',
    recommended_runtime_agent: 'claude'
  };
  const originalDetail = service.getProductDetail.bind(service);
  service.getProductDetail = function(productId, workspaces, sessions) {
    const detail = originalDetail(productId, workspaces, sessions);
    detail.next_actions = [action];
    return detail;
  };

  const created = [];
  const store = {
    createSession(payload) {
      created.push(payload);
      return { id: 'sess-release-' + created.length, status: 'running', updatedAt: Date.now(), ...payload };
    }
  };

  const result = await service.executeNextAction('release-product', action.id, {}, store, [{ id: 'ws-release', name: 'Release Workspace' }], []);

  assert.equal(result.sessions.length, 4);
  assert.equal(result.terminal_layout, 4);
  assert.equal(result.session.sessionRole, 'orchestrator');
  assert.deepEqual(created.map(item => item.sessionRole), ['orchestrator', 'worker', 'worker', 'worker']);
});

test('product service uses latest incoming handoff to enrich next action continuity and guided prompt', async () => {
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
  const handoff = await service.createHandoff('p3', {
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

  const result = await service.executeNextAction('p3', action.id, {}, store, workspaces, sessions);

  assert.equal(result.previous_handoff?.handoff_id, handoff.handoff_id);
  assert.match(action.label, /Start Spec from Brief completion/);
  assert.match(created[0].promptSeed, /Previous handoff from: brief -> spec/);
  assert.match(created[0].promptSeed, /Handoff summary: Brief is ready for spec\./);
  assert.match(created[0].promptSeed, /Referenced outputs: artifact:brief/);
});

test('product service pipeline prioritizes runs and handoffs over artifact-only progress', async () => {
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
  const handoff = await service.createHandoff('p4', {
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
  assert.equal(brief.latest_completion?.handoff_id, handoff.handoff_id);
  assert.equal(spec.latest_incoming_handoff?.handoff_id, handoff.handoff_id);
  assert.ok(spec.active_run_id);
});

test('hydrated current run exposes primary session and conservative ready-to-complete signal', async () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs', 'spec.md'), '# spec');

  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'ready',
        name: 'Ready Product',
        slug: 'ready-product',
        status: 'active',
        stage: 'build',
        owner: 'guibr',
        category: 'product',
        summary: 'product summary',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: 'ws-ready', current_working_dir: repoDir, path_status: 'valid' },
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
      return { id: 'sess-ready', status: 'running', updatedAt: Date.now(), ...payload };
    }
  };

  await service.startStage('ready', 'spec', { runtimeAgent: 'claude' }, store);
  const detail = service.getProductDetail('ready', [{ id: 'ws-ready', name: 'Workspace Ready' }], [
    { id: 'sess-ready', name: created[0].name, workspaceId: 'ws-ready', status: 'running', agent: 'claude', stageId: 'spec', role: 'delivery-planner', workingDir: repoDir, updatedAt: Date.now(), productId: 'ready', runId: created[0].runId }
  ]);

  assert.ok(detail.current_run);
  assert.equal(detail.current_run.primary_session_id, 'sess-ready');
  assert.equal(detail.current_run.is_ready_to_complete, true);
});

test('getHandoffs returns enriched records with snapshots and knowledge driver metadata', async () => {
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

  await service.createHandoff('p5', {
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

test('createProduct creates registry entry, optional workspace, scaffold and default knowledge binding', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'new-product');
  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({ version: 1, products: [] }, null, 2));

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
    bindings: [],
    recommendations: []
  });
  const service = makeProductService(dir, { registryFile, knowledgePackService });
  const fakeStore = {
    createWorkspace(input) {
      return {
        id: 'ws-new',
        name: input.name,
        description: input.description,
        workingDir: input.workingDir
      };
    }
  };

  const result = service.createProduct({
    name: 'New Product',
    product_id: 'new-product',
    slug: 'new-product',
    owner: 'guibr',
    category: 'product',
    stage: 'brief',
    summary: 'New product summary',
    repo: { local_path: repoDir },
    workspace_mode: 'create',
    workspace_name: 'New Product Runtime',
    workspace_description: 'Runtime context',
    create_directory: true,
    create_minimal_structure: true,
    enable_pm_skills: true
  }, fakeStore);

  assert.equal(result.error, undefined);
  assert.equal(result.product.product_id, 'new-product');
  assert.equal(result.workspace.id, 'ws-new');
  assert.equal(result.created_directory, true);
  assert.equal(result.created_structure, true);
  assert.ok(fs.existsSync(path.join(repoDir, '.platform', 'product.json')));
  assert.ok(fs.existsSync(path.join(repoDir, 'docs', 'spec.md')));
  assert.ok(fs.existsSync(path.join(repoDir, 'PRODUCT.md')));

  const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  assert.equal(registry.products.length, 1);
  assert.equal(registry.products[0].workspace.runtime_workspace_id, 'ws-new');
  assert.equal(registry.products[0].platform.manifest_path, '.platform/product.json');

  const bindings = JSON.parse(fs.readFileSync(path.join(dir, 'bindings.json'), 'utf8'));
  assert.equal(bindings.bindings.length, 1);
  assert.equal(bindings.bindings[0].knowledge_pack_id, 'pm-skills');
});

test('createProduct supports existing directory and existing runtime workspace without scaffold', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'existing-product');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# existing');

  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({ version: 1, products: [] }, null, 2));

  const service = makeProductService(dir, { registryFile });
  const fakeStore = {
    getWorkspace(id) {
      if (id !== 'ws-existing') return null;
      return { id, name: 'Existing Runtime', workingDir: repoDir };
    }
  };

  const result = service.createProduct({
    name: 'Existing Product',
    owner: 'guibr',
    category: 'internal-tool',
    stage: 'brief',
    repo: { local_path: repoDir },
    workspace_mode: 'existing',
    workspace_id: 'ws-existing',
    create_directory: false,
    create_minimal_structure: false,
    enable_pm_skills: false
  }, fakeStore);

  assert.equal(result.error, undefined);
  assert.equal(result.product.product_id, 'existing-product');
  assert.equal(result.product.workspace.runtime_workspace_id, 'ws-existing');
  assert.equal(result.product.platform.artifact_tracking, 'manual');
  assert.equal(result.product.platform.manifest_path, '');
  assert.equal(fs.existsSync(path.join(repoDir, '.platform', 'product.json')), false);
});

test('manual-tracking products do not treat repo files as official artifacts before scaffold', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'existing-product');
  fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs', 'spec.md'), '# legacy spec');
  fs.writeFileSync(path.join(repoDir, 'docs', 'runbook.md'), '# legacy runbook');

  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'existing-product',
        name: 'Existing Product',
        slug: 'existing-product',
        status: 'active',
        stage: 'brief',
        owner: 'guibr',
        category: 'internal-tool',
        summary: '',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: 'ws-existing', current_working_dir: repoDir, path_status: 'valid' },
        platform: {
          artifact_tracking: 'manual',
          manifest_path: '',
          runbook_path: '',
          spec_path: ''
        },
        governance: {}
      }
    ]
  }, null, 2));

  const service = makeProductService(dir, { registryFile });
  const detail = service.getProductDetail('existing-product', [{ id: 'ws-existing', name: 'Existing Runtime' }], []);

  assert.equal(detail.artifacts.find((artifact) => artifact.id === 'spec')?.exists, false);
  assert.equal(detail.artifacts.find((artifact) => artifact.id === 'runbook')?.exists, false);
  assert.equal(detail.artifact_summary.present, 0);
});

test('createProduct rejects duplicate product ids and invalid directories', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'product-a');
  fs.mkdirSync(repoDir, { recursive: true });
  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [
      {
        product_id: 'product-a',
        name: 'Product A',
        slug: 'product-a',
        status: 'active',
        stage: 'brief',
        owner: 'guibr',
        category: 'product',
        summary: '',
        repo: { local_path: repoDir },
        workspace: { runtime_workspace_id: '', current_working_dir: '', path_status: 'unknown' },
        platform: {},
        governance: {},
        timestamps: { created_at: '', updated_at: '' }
      }
    ]
  }, null, 2));

  const service = makeProductService(dir, { registryFile });
  const duplicate = service.createProduct({
    name: 'Duplicate',
    product_id: 'product-a',
    owner: 'guibr',
    category: 'product',
    stage: 'brief',
    repo: { local_path: path.join(dir, 'other') }
  }, {});
  assert.equal(duplicate.status, 409);

  const missingDir = service.createProduct({
    name: 'Missing Dir',
    owner: 'guibr',
    category: 'product',
    stage: 'brief',
    repo: { local_path: path.join(dir, 'missing') },
    create_directory: false,
    create_minimal_structure: false
  }, {});
  assert.equal(missingDir.status, 400);
});

// --- Phase 2H readiness tests ---

test('deriveReadiness returns not-ready when no artifacts or stages are complete', () => {
  const result = deriveReadiness({}, [], [
    { stage_id: 'implementation', status: 'not-started' },
    { stage_id: 'test', status: 'not-started' },
    { stage_id: 'release', status: 'not-started' }
  ], []);
  assert.equal(result.status, 'not-ready');
  assert.equal(result.label, 'Not ready');
  assert.equal(result.signals.length, 5);
  assert.equal(result.signals.filter(s => s.met).length, 0);
  assert.equal(result.gaps.length, 5);
  assert.ok(result.gaps.every(g => g.severity === 'required'));
  assert.equal(result.evaluated, 'on-demand');
});

test('deriveReadiness returns needs-evidence when 3 of 5 required signals are met', () => {
  const result = deriveReadiness({}, [
    { id: 'test-strategy', exists: true },
    { id: 'release-plan', exists: true },
    { id: 'runbook', exists: true }
  ], [
    { stage_id: 'implementation', status: 'not-started' },
    { stage_id: 'test', status: 'not-started' },
    { stage_id: 'release', status: 'not-started' }
  ], []);
  assert.equal(result.status, 'needs-evidence');
  assert.equal(result.signals.filter(s => s.met).length, 3);
  assert.equal(result.gaps.length, 2);
});

test('deriveReadiness returns ready-for-release-candidate when all 5 required signals met with evidence', () => {
  const result = deriveReadiness({}, [
    { id: 'test-strategy', exists: true },
    { id: 'release-plan', exists: true },
    { id: 'runbook', exists: true }
  ], [
    { stage_id: 'implementation', status: 'done' },
    { stage_id: 'test', status: 'done' },
    { stage_id: 'release', status: 'not-started' }
  ], [
    { from_stage: 'implementation', to_stage: 'test', evidence_output_count: 2, created_at: 1000 },
    { from_stage: 'test', to_stage: 'release', evidence_output_count: 1, created_at: 2000 }
  ]);
  assert.equal(result.status, 'ready-for-release-candidate');
  assert.equal(result.signals.filter(s => s.met).length, 5);
  assert.equal(result.gaps.length, 0);
  assert.equal(result.summary, 'All signals met.');
});

test('deriveReadiness returns needs-evidence with test done + artifacts incomplete', () => {
  const result = deriveReadiness({}, [
    { id: 'test-strategy', exists: true },
    { id: 'release-plan', exists: false },
    { id: 'runbook', exists: false }
  ], [
    { stage_id: 'implementation', status: 'done' },
    { stage_id: 'test', status: 'done' },
    { stage_id: 'release', status: 'not-started' }
  ], []);
  assert.equal(result.status, 'needs-evidence');
  assert.equal(result.signals.filter(s => s.met).length, 3);
  const gapIds = result.gaps.map(g => g.id);
  assert.ok(gapIds.includes('release-plan-exists'));
  assert.ok(gapIds.includes('runbook-exists'));
});

test('deriveReadiness does not include removed weak signals', () => {
  const result = deriveReadiness({}, [], [
    { stage_id: 'implementation', status: 'done' },
    { stage_id: 'test', status: 'done' },
    { stage_id: 'release', status: 'in-progress' }
  ], [{ handoff_id: 'h1' }]);
  assert.ok(!result.signals.find(s => s.id === 'has-completion-history'));
  assert.ok(!result.signals.find(s => s.id === 'release-stage-started'));
  assert.equal(result.signals.length, 5);
});

test('product snapshot includes readiness, release_packet and operate_lite', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });
  const service = makeProductService(dir);
  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [{
      product_id: 'readiness-test',
      name: 'Readiness Test',
      slug: 'readiness-test',
      status: 'active',
      stage: 'brief',
      owner: 'test',
      category: 'product',
      summary: 'Test readiness',
      repo: { local_path: repoDir },
      workspace: {},
      platform: {},
      governance: {},
      timestamps: {}
    }]
  }, null, 2));
  const svc = makeProductService(dir, { registryFile });
  const detail = svc.getProductDetail('readiness-test', [], []);
  assert.ok(detail.readiness);
  assert.ok(['not-ready', 'needs-evidence'].includes(detail.readiness.status),
    'Readiness should be not-ready or needs-evidence for a minimal product');
  assert.equal(detail.readiness.evaluated, 'on-demand');
  assert.ok(detail.release_packet);
  assert.equal(detail.release_packet.latest_completion, null);
  assert.ok(detail.operate_lite);
  assert.ok(detail.operate_lite.last_readiness_check === 'on-demand' || detail.operate_lite.last_readiness_check === null,
    'last_readiness_check should be on-demand or null');
  assert.equal(detail.operate_lite.runbook_status, 'missing');
});

// ===== Milestone 2I: Evidence-Driven Readiness =====

test('classifyOutputCategory returns correct categories', () => {
  assert.equal(classifyOutputCategory('artifact'), 'evidence');
  assert.equal(classifyOutputCategory('handoff'), 'evidence');
  assert.equal(classifyOutputCategory('session'), 'context');
  assert.equal(classifyOutputCategory('knowledge-driver'), 'metadata');
  assert.equal(classifyOutputCategory('action'), 'metadata');
  assert.equal(classifyOutputCategory(''), 'context');
  assert.equal(classifyOutputCategory(null), 'context');
  assert.equal(classifyOutputCategory('unknown-type'), 'context');
});

test('createHandoff computes evidence_output_count from run produced outputs', async () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'test-product');
  fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
  const svc = makeProductService(dir);
  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [{
      product_id: 'test-ev', name: 'Test Evidence', slug: 'test-ev', status: 'active',
      stage: 'implementation', owner: 'test', category: 'product', summary: '',
      repo: { local_path: repoDir }, workspace: {}, platform: {}, governance: {}
    }]
  }, null, 2));

  // Create a run with artifact + session outputs
  const runsFile = path.join(dir, 'runs.json');
  const runId = 'run-evidence-test';
  fs.writeFileSync(runsFile, JSON.stringify({
    version: 1,
    runs: [{
      run_id: runId, product_id: 'test-ev', stage_id: 'implementation',
      objective: 'Test', role: 'dev', suggested_runtime_agent: 'claude',
      workspace_id: '', status: 'active',
      expected_outputs: [],
      produced_outputs: [
        { output_id: 'artifact:spec', type: 'artifact', ref_id: 'spec', label: 'Spec', created_at: 1000 },
        { output_id: 'artifact:arch', type: 'handoff', ref_id: 'h1', label: 'Handoff', created_at: 1001 },
        { output_id: 'session:s1', type: 'session', ref_id: 's1', label: 'Session', created_at: 1002 },
        { output_id: 'action:a1', type: 'action', ref_id: '', label: 'Action', created_at: 1003 }
      ],
      session_ids: [], current_session_id: '', handoff_ids: [],
      knowledge_pack_id: '', knowledge_pack_name: '', preset_type: '', preset_id: '', preset_label: '', preset_origin: '',
      created_at: 1000, updated_at: 1003
    }]
  }, null, 2));

  const handoff = await svc.createHandoff('test-ev', {
    run_id: runId,
    from_stage: 'implementation',
    to_stage: 'test',
    summary: 'Test handoff'
  });

  assert.equal(handoff.evidence_output_count, 2, 'Should count 2 evidence outputs (artifact + handoff types)');
});

test('createHandoff with zero evidence outputs sets evidence_output_count to 0', async () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'test-product-zero');
  fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
  const svc = makeProductService(dir);
  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [{
      product_id: 'test-zero', name: 'Test Zero', slug: 'test-zero', status: 'active',
      stage: 'implementation', owner: 'test', category: 'product', summary: '',
      repo: { local_path: repoDir }, workspace: {}, platform: {}, governance: {}
    }]
  }, null, 2));

  const runsFile = path.join(dir, 'runs.json');
  fs.writeFileSync(runsFile, JSON.stringify({
    version: 1,
    runs: [{
      run_id: 'run-zero', product_id: 'test-zero', stage_id: 'implementation',
      objective: 'Test', role: 'dev', suggested_runtime_agent: 'claude',
      workspace_id: '', status: 'active',
      expected_outputs: [],
      produced_outputs: [
        { output_id: 'session:s1', type: 'session', ref_id: 's1', label: 'Session', created_at: 1000 },
        { output_id: 'action:a1', type: 'action', ref_id: '', label: 'Action', created_at: 1001 }
      ],
      session_ids: [], current_session_id: '', handoff_ids: [],
      knowledge_pack_id: '', knowledge_pack_name: '', preset_type: '', preset_id: '', preset_label: '', preset_origin: '',
      created_at: 1000, updated_at: 1001
    }]
  }, null, 2));

  const handoff = await svc.createHandoff('test-zero', {
    run_id: 'run-zero',
    from_stage: 'implementation',
    to_stage: 'test',
    summary: 'No evidence'
  });

  assert.equal(handoff.evidence_output_count, 0);
});

test('deriveReadiness returns not-ready with none strength when product has nothing', () => {
  const result = deriveReadiness({}, [], [], []);
  assert.equal(result.status, 'not-ready');
  result.signals.forEach(s => {
    assert.equal(s.strength, 'none');
    assert.equal(s.met, false);
  });
});

test('deriveReadiness returns weak strength when impl done but no handoff evidence', () => {
  const pipeline = [
    { stage_id: 'implementation', status: 'done' },
    { stage_id: 'test', status: 'not-started' }
  ];
  const result = deriveReadiness({}, [], pipeline, []);
  const implSignal = result.signals.find(s => s.id === 'implementation-done');
  assert.equal(implSignal.strength, 'weak');
  assert.equal(implSignal.met, true);
});

test('deriveReadiness returns strong strength when impl done with handoff evidence >= 2', () => {
  const pipeline = [
    { stage_id: 'implementation', status: 'done' },
    { stage_id: 'test', status: 'not-started' }
  ];
  const handoffs = [
    { from_stage: 'implementation', to_stage: 'test', evidence_output_count: 3, created_at: 1000 }
  ];
  const result = deriveReadiness({}, [], pipeline, handoffs);
  const implSignal = result.signals.find(s => s.id === 'implementation-done');
  assert.equal(implSignal.strength, 'strong');
});

test('deriveReadiness caps at needs-evidence when all 5 met but one is weak', () => {
  const artifacts = [
    { id: 'test-strategy', exists: true },
    { id: 'release-plan', exists: true },
    { id: 'runbook', exists: true }
  ];
  const pipeline = [
    { stage_id: 'implementation', status: 'done' },
    { stage_id: 'test', status: 'done' }
  ];
  // impl has handoff with evidence but test has no handoff -> test is weak
  const handoffs = [
    { from_stage: 'implementation', to_stage: 'test', evidence_output_count: 2, created_at: 1000 }
  ];
  const result = deriveReadiness({}, artifacts, pipeline, handoffs);
  assert.equal(result.status, 'needs-evidence', 'Should be capped at needs-evidence because test-stage-done is weak');
  const testSignal = result.signals.find(s => s.id === 'test-stage-done');
  assert.equal(testSignal.strength, 'weak');
});

test('deriveReadiness returns ready-for-release-candidate when all strong/sufficient', () => {
  const artifacts = [
    { id: 'test-strategy', exists: true },
    { id: 'release-plan', exists: true },
    { id: 'runbook', exists: true }
  ];
  const pipeline = [
    { stage_id: 'implementation', status: 'done' },
    { stage_id: 'test', status: 'done' }
  ];
  const handoffs = [
    { from_stage: 'implementation', to_stage: 'test', evidence_output_count: 2, created_at: 1000 },
    { from_stage: 'test', to_stage: 'release', evidence_output_count: 1, created_at: 2000 }
  ];
  const result = deriveReadiness({}, artifacts, pipeline, handoffs);
  assert.equal(result.status, 'ready-for-release-candidate');
});

test('deriveReadiness 3/5 met with mix of strengths gives needs-evidence', () => {
  const artifacts = [
    { id: 'test-strategy', exists: true }
  ];
  const pipeline = [
    { stage_id: 'implementation', status: 'done' },
    { stage_id: 'test', status: 'done' }
  ];
  const handoffs = [
    { from_stage: 'implementation', to_stage: 'test', evidence_output_count: 3, created_at: 1000 }
  ];
  const result = deriveReadiness({}, artifacts, pipeline, handoffs);
  assert.equal(result.status, 'needs-evidence');
  const metSignals = result.signals.filter(s => s.met);
  assert.ok(metSignals.length >= 3);
});

test('deriveReleasePacket latest_completion is most recent handoff by timestamp', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'test-packet');
  fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
  const svc = makeProductService(dir);
  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [{
      product_id: 'test-packet', name: 'Test Packet', slug: 'test-packet', status: 'active',
      stage: 'test', owner: 'test', category: 'product', summary: '',
      repo: { local_path: repoDir }, workspace: {}, platform: {}, governance: {}
    }]
  }, null, 2));

  const snapshot = svc.buildProductSnapshot(
    svc.getProductById('test-packet'), [], []
  );
  // With no handoffs, latest_completion should be null
  assert.equal(snapshot.release_packet.latest_completion, null);
});

test('deriveOperateLite has null last_readiness_check and evidence_summary', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'test-op');
  fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
  const svc = makeProductService(dir);
  const registryFile = path.join(dir, 'products.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    products: [{
      product_id: 'test-op', name: 'Test Op', slug: 'test-op', status: 'active',
      stage: 'implementation', owner: 'test', category: 'product', summary: '',
      repo: { local_path: repoDir }, workspace: {}, platform: {}, governance: {}
    }]
  }, null, 2));

  const snapshot = svc.buildProductSnapshot(
    svc.getProductById('test-op'), [], []
  );
  assert.equal(snapshot.operate_lite.last_readiness_check, null);
  assert.ok(snapshot.operate_lite.evidence_summary);
  assert.equal(typeof snapshot.operate_lite.evidence_summary.total_handoffs, 'number');
  assert.equal(typeof snapshot.operate_lite.evidence_summary.total_evidence_outputs, 'number');
});

test('handoffs without evidence_output_count are treated as 0 in deriveReadiness', () => {
  const pipeline = [
    { stage_id: 'implementation', status: 'done' }
  ];
  const handoffs = [
    { from_stage: 'implementation', to_stage: 'test', created_at: 1000 }
    // no evidence_output_count field
  ];
  const result = deriveReadiness({}, [], pipeline, handoffs);
  const implSignal = result.signals.find(s => s.id === 'implementation-done');
  assert.equal(implSignal.strength, 'weak', 'Missing evidence_output_count should fallback to 0 -> weak');
  assert.equal(implSignal.met, true);
});

test('readiness signals include strength field in output', () => {
  const result = deriveReadiness({}, [], [], []);
  result.signals.forEach(s => {
    assert.ok(['strong', 'sufficient', 'weak', 'none'].includes(s.strength),
      `Signal ${s.id} should have valid strength, got: ${s.strength}`);
  });
});

test('deriveReadiness includes traffic_light field', () => {
  // All 5 signals met -> green
  const allMet = deriveReadiness({}, [
    { id: 'test-strategy', exists: true },
    { id: 'release-plan', exists: true },
    { id: 'runbook', exists: true }
  ], [
    { stage_id: 'implementation', status: 'done' },
    { stage_id: 'test', status: 'done' }
  ], [
    { from_stage: 'implementation', to_stage: 'test', evidence_output_count: 2, created_at: 1000 },
    { from_stage: 'test', to_stage: 'release', evidence_output_count: 1, created_at: 2000 }
  ]);
  assert.equal(allMet.traffic_light, 'green');

  // 3 signals met -> yellow
  const threeMet = deriveReadiness({}, [
    { id: 'test-strategy', exists: true },
    { id: 'release-plan', exists: true },
    { id: 'runbook', exists: true }
  ], [
    { stage_id: 'implementation', status: 'not-started' },
    { stage_id: 'test', status: 'not-started' }
  ], []);
  assert.equal(threeMet.traffic_light, 'yellow');

  // 1 signal met -> red
  const oneMet = deriveReadiness({}, [
    { id: 'test-strategy', exists: true }
  ], [
    { stage_id: 'implementation', status: 'not-started' },
    { stage_id: 'test', status: 'not-started' }
  ], []);
  assert.equal(oneMet.traffic_light, 'red');
});
