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

test('buildSnapshot returns operational_summary with expected structure and risk levels', () => {
  const dir = makeTempDir();
  const repoDir = path.join(dir, 'repo');
  const storeFile = path.join(dir, 'project-copilot.json');
  fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });

  const service = new ProjectCopilotService({ storeFile });
  const product = makeProduct(repoDir, { product_id: 'ops-test', name: 'OpsTest', declared_stage: 'spec' });

  // --- Low risk: no candidates, no blockers beyond test-readiness ---
  const snapshotLow = service.buildSnapshot(product, makeContext({
    current_stage_id: 'spec',
    pipeline: [{ stage_id: 'spec', status: 'not-started', required_artifacts: [] }],
    next_actions: [{ label: 'Write the spec', step_id: 'spec', executable: true, expected_output: 'docs/spec.md', reason: 'Spec is missing.' }],
    current_stage_knowledge: { available_presets: ['deep-research'] }
  }));

  assert.ok(snapshotLow.operational_summary, 'snapshot should contain operational_summary');
  const os1 = snapshotLow.operational_summary;

  // Structure checks
  assert.equal(typeof os1.current_stage, 'string');
  assert.ok(Array.isArray(os1.blockers));
  assert.equal(typeof os1.next_action, 'string');
  assert.equal(typeof os1.reason, 'string');
  assert.equal(typeof os1.expected_evidence, 'string');
  assert.ok(['low', 'medium', 'high'].includes(os1.risk_level), `risk_level should be low|medium|high, got ${os1.risk_level}`);
  assert.equal(typeof os1.risk_message, 'string');
  assert.equal(typeof os1.suggested_workflow, 'string');

  // Value checks for minimal product
  assert.equal(os1.current_stage, 'spec');
  assert.equal(os1.next_action, 'Write the spec');
  assert.equal(os1.expected_evidence, 'docs/spec.md');
  assert.equal(os1.suggested_workflow, 'deep-research');

  // --- High risk: multiple blockers via required_artifacts that are missing ---
  const snapshotHigh = service.buildSnapshot(product, makeContext({
    current_stage_id: 'implementation',
    pipeline: [{ stage_id: 'implementation', status: 'in-progress', required_artifacts: ['spec', 'architecture'] }],
    artifacts: [
      { id: 'spec', exists: false, path: '' },
      { id: 'architecture', exists: false, path: '' }
    ]
  }));

  const os2 = snapshotHigh.operational_summary;
  assert.ok(os2.blockers.length > 1, 'should have multiple blockers');
  assert.equal(os2.risk_level, 'high');
  assert.equal(os2.risk_message, 'Multiple blockers detected');

  // --- Medium risk: one blocker ---
  fs.writeFileSync(path.join(repoDir, 'docs', 'spec.md'), '# spec');
  const snapshotMed = service.buildSnapshot(makeProduct(repoDir, { product_id: 'ops-med' }), makeContext({
    current_stage_id: 'brief',
    pipeline: [{ stage_id: 'brief', status: 'in-progress', required_artifacts: [] }]
  }));

  const os3 = snapshotMed.operational_summary;
  // candidates need review -> medium risk
  assert.ok(['medium', 'high'].includes(os3.risk_level), `expected medium or high, got ${os3.risk_level}`);
});
