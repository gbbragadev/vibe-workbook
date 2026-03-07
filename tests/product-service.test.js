const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ProductService } = require('../src/core/product-service');
const { KnowledgePackService } = require('../src/core/knowledge-pack-service');

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
  const service = new ProductService({
    registryFile,
    handoffsFile,
    knowledgePackService: makeKnowledgeService(dir, { packs: [], bindings: [], recommendations: [] })
  });
  const created = [];
  const store = {
    createSession(payload) {
      created.push(payload);
      return { id: 'sess-created', ...payload };
    }
  };

  const handoff = service.createHandoff('tool', {
    from_stage: 'spec',
    to_stage: 'architecture',
    role: 'delivery-planner',
    runtime_agent: 'claude',
    summary: 'Spec completed'
  });
  const start = service.startStage('tool', 'architecture', { runtimeAgent: 'codex' }, store);

  assert.equal(handoff.product_id, 'tool');
  assert.equal(start.session.stageId, 'architecture');
  assert.equal(start.session.role, 'principal-architect');
  assert.equal(created[0].productId, 'tool');
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
    knowledgePackService: makeKnowledgeService(dir, { packs: [], bindings: [], recommendations: [] })
  });
  const resolved = service.resolveWorkingDirectory('ws-ronda', 'C:\\missing-path');

  assert.equal(resolved, repoDir);
});
