const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ProjectCopilotService } = require('../src/core/project-copilot-service');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'project-copilot-test-'));
}

function makeProduct(repoDir, overrides = {}) {
  return {
    product_id: overrides.product_id || 'zapcam',
    name: overrides.name || 'Zapcam',
    repo: { local_path: repoDir },
    ...overrides
  };
}

function makeContext(overrides = {}) {
  return {
    artifacts: [],
    handoffs: [],
    recent_runs: [],
    pipeline: [],
    current_run: null,
    current_stage_id: 'brief',
    next_actions: [],
    readiness: { status: 'not-ready', gaps: [] },
    current_stage_knowledge: [],
    ...overrides
  };
}

test('project copilot snapshot detects artifact candidates outside canonical paths', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'zapcam');
  fs.mkdirSync(path.join(repoDir, 'docs', 'discovery'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs', 'discovery', '2026-03-07-zapcam-discovery-brief.md'), '# brief');

  const service = new ProjectCopilotService({ storeFile: path.join(dir, 'project-copilot.json') });
  const snapshot = service.buildSnapshot(makeProduct(repoDir), makeContext());

  assert.ok(snapshot);
  assert.ok(snapshot.candidate_artifacts.some((item) => item.kind_guess === 'brief' && item.mapped_stage === 'brief'));
  assert.equal(snapshot.recommended_next_move.action_type, 'review-artifact-candidates');
  assert.match(snapshot.summary, /testing|asset|candidate/i);
});

test('project copilot persists candidate reviews and decisions across service instances', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'zapcam');
  const storeFile = path.join(dir, 'project-copilot.json');
  fs.mkdirSync(path.join(repoDir, 'docs', 'discovery'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs', 'discovery', 'brief-v2.md'), '# brief');

  const service = new ProjectCopilotService({ storeFile });
  const product = makeProduct(repoDir);
  const before = service.buildSnapshot(product, makeContext());
  const candidate = before.candidate_artifacts[0];

  assert.ok(candidate);
  service.reviewCandidate(product.product_id, candidate.candidate_id, true);
  const decision = service.addDecision(product.product_id, {
    title: 'Use discovery brief as working brief',
    linked_stage: 'brief',
    linked_artifacts: ['brief'],
    note: 'Accepted because it captures the current scope.'
  });
  assert.ok(decision.decision_id);

  const reloaded = new ProjectCopilotService({ storeFile });
  const after = reloaded.buildSnapshot(product, makeContext());

  assert.ok(after.created_assets.some((item) => item.id === candidate.candidate_id));
  assert.ok(after.decision_log.some((item) => item.title === 'Use discovery brief as working brief'));
  assert.equal(reloaded.getProductState(product.product_id).candidate_reviews[candidate.candidate_id].accepted, true);
});

test('project copilot recommendation prioritizes open decisions after candidate review is resolved', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'repo');
  const storeFile = path.join(dir, 'project-copilot.json');
  fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs', 'spec-outline.md'), '# spec');

  const service = new ProjectCopilotService({ storeFile });
  const product = makeProduct(repoDir, { product_id: 'p1', name: 'P1' });
  const initial = service.buildSnapshot(product, makeContext({
    current_stage_id: 'spec',
    pipeline: [{ stage_id: 'spec', status: 'in-progress', required_artifacts: ['spec'] }]
  }));
  service.reviewCandidate(product.product_id, initial.candidate_artifacts[0].candidate_id, true);
  service.addDecision(product.product_id, {
    title: 'Confirm spec scope before implementation',
    linked_stage: 'spec'
  });

  const snapshot = service.buildSnapshot(product, makeContext({
    current_stage_id: 'spec',
    pipeline: [{ stage_id: 'spec', status: 'in-progress', required_artifacts: ['spec'] }]
  }));

  assert.equal(snapshot.recommended_next_move.action_type, 'resolve-open-issues');
  assert.equal(snapshot.recommended_next_move.execution_mode_hint, 'plan-mode');
});

test('project copilot uses observed run output paths without requiring Gemini', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'repo');
  const storeFile = path.join(dir, 'project-copilot.json');
  fs.mkdirSync(path.join(repoDir, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'notes', 'spec-draft.md'), '# spec draft');

  const service = new ProjectCopilotService({ storeFile });
  const snapshot = service.buildSnapshot(makeProduct(repoDir, { product_id: 'p2' }), makeContext({
    current_stage_id: 'spec',
    recent_runs: [{
      run_id: 'run-1',
      produced_outputs: [{
        output_id: 'artifact:spec-draft',
        type: 'artifact',
        ref_id: 'spec-draft',
        path: path.join(repoDir, 'notes', 'spec-draft.md')
      }]
    }]
  }));

  assert.ok(snapshot.candidate_artifacts.some((item) => item.relative_path === 'notes/spec-draft.md'));
  assert.ok(snapshot.recommended_next_move);
  assert.equal(typeof snapshot.recommended_next_move.reason, 'string');
});

test('project copilot builds conservative delivery readiness for the ZapCam-style brief state', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'zapcam');
  const storeFile = path.join(dir, 'project-copilot.json');
  fs.mkdirSync(path.join(repoDir, 'docs', 'discovery'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs', 'discovery', '2026-03-07-zapcam-discovery-brief.md'), '# brief');

  const service = new ProjectCopilotService({ storeFile });
  const initial = service.buildSnapshot(makeProduct(repoDir), makeContext({
    current_stage_id: 'brief',
    pipeline: [{ stage_id: 'implementation', status: 'not-started', required_artifacts: [] }]
  }));
  service.reviewCandidate('zapcam', initial.candidate_artifacts[0].candidate_id, true);

  const snapshot = service.buildSnapshot(makeProduct(repoDir), makeContext({
    current_stage_id: 'brief',
    pipeline: [{ stage_id: 'implementation', status: 'not-started', required_artifacts: [] }]
  }));

  assert.equal(snapshot.delivery_readiness.ready_for_test, false);
  assert.equal(snapshot.delivery_readiness.ready_for_test_deploy, false);
  assert.equal(snapshot.delivery_readiness.ready_for_production, false);
  assert.ok(snapshot.created_assets.some((item) => item.stage === 'brief'));
});
