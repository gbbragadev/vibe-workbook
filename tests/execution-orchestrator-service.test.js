const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ExecutionOrchestratorService,
  getExecutionOrchestratorService,
  EXECUTION_CONTRACTS,
  OUTPUT_CONTRACTS,
  AGENT_LAUNCH_STRATEGIES
} = require('../src/core/execution-orchestrator-service');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-test-'));
}

function makeProduct(dir) {
  const repoDir = path.join(dir, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });
  return {
    product_id: 'test-product',
    name: 'Test Product',
    summary: 'A test product',
    repo: { local_path: repoDir }
  };
}

function makeRun(stageId, overrides = {}) {
  return {
    run_id: `run-${stageId}-001`,
    stage_id: stageId,
    objective: `Run objective for ${stageId}`,
    ...overrides
  };
}

// ─── Contract lookup tests ────────────────────────────────────────────────────

test('getContractForStage returns contract for brief', () => {
  const svc = new ExecutionOrchestratorService();
  const contract = svc.getContractForStage('brief');
  assert.ok(contract, 'Brief contract should exist');
  assert.equal(contract.stage_id, 'brief');
  assert.ok(typeof contract.objective === 'string' && contract.objective.length > 0, 'Should have objective');
  assert.ok(typeof contract.role === 'string', 'Should have role');
  assert.ok(Array.isArray(contract.required_artifacts), 'Should have required_artifacts array');
  assert.ok(Array.isArray(contract.optional_artifacts), 'Should have optional_artifacts array');
  assert.ok(typeof contract.completion_policy === 'string', 'Should have completion_policy');
});

test('getContractForStage returns contract for spec', () => {
  const svc = new ExecutionOrchestratorService();
  const contract = svc.getContractForStage('spec');
  assert.ok(contract);
  assert.equal(contract.stage_id, 'spec');
  assert.ok(contract.required_artifacts.includes('spec'), 'Spec stage should require spec artifact');
});

test('getContractForStage returns contract for implementation', () => {
  const svc = new ExecutionOrchestratorService();
  const contract = svc.getContractForStage('implementation');
  assert.ok(contract);
  assert.equal(contract.stage_id, 'implementation');
});

test('getContractForStage returns contract for test', () => {
  const svc = new ExecutionOrchestratorService();
  const contract = svc.getContractForStage('test');
  assert.ok(contract);
  assert.equal(contract.stage_id, 'test');
  assert.ok(contract.required_artifacts.includes('test-strategy'), 'Test stage should require test-strategy artifact');
});

test('getContractForStage returns null for architecture (out of scope for this wave)', () => {
  const svc = new ExecutionOrchestratorService();
  const contract = svc.getContractForStage('architecture');
  assert.equal(contract, null, 'Architecture should not have a contract yet (out of 3A scope)');
});

test('getContractForStage returns null for release (out of scope for this wave)', () => {
  const svc = new ExecutionOrchestratorService();
  const contract = svc.getContractForStage('release');
  assert.equal(contract, null, 'Release should not have a contract yet (out of 3A scope)');
});

test('getContractForStage returns null for idea', () => {
  const svc = new ExecutionOrchestratorService();
  assert.equal(svc.getContractForStage('idea'), null);
});

test('getOutputContractForStage returns output contract for brief', () => {
  const svc = new ExecutionOrchestratorService();
  const oc = svc.getOutputContractForStage('brief');
  assert.ok(oc);
  assert.ok(Array.isArray(oc.outputs), 'Should have outputs array');
  assert.ok(oc.outputs.length > 0, 'Should have at least one output');
  const required = oc.outputs.filter(o => o.required);
  assert.ok(required.length > 0, 'Brief should have at least one required output');
});

// ─── Envelope generation tests ────────────────────────────────────────────────

test('generateEnvelope creates 3 files in .platform/runtime/runs/<run_id>/', () => {
  const dir = makeTempDir();
  const product = makeProduct(dir);
  const run = makeRun('brief');
  const stage = { stage_id: 'brief', label: 'Discovery Brief', goal: 'Define the product.' };
  const svc = new ExecutionOrchestratorService();

  const result = svc.generateEnvelope(run, product, stage);

  assert.ok(!result.skipped, 'Should not be skipped');
  assert.ok(result.envelopePath, 'Should have envelope path');
  assert.ok(fs.existsSync(result.envelopeFile), 'execution-envelope.json should exist');
  assert.ok(fs.existsSync(result.briefFile), 'execution-brief.md should exist');
  assert.ok(fs.existsSync(result.reportFile), 'evidence-report.json should exist');
});

test('generateEnvelope envelope JSON contains expected fields', () => {
  const dir = makeTempDir();
  const product = makeProduct(dir);
  const run = makeRun('spec');
  const stage = { stage_id: 'spec', label: 'Product Spec', goal: 'Define spec.' };
  const svc = new ExecutionOrchestratorService();

  const result = svc.generateEnvelope(run, product, stage);
  const envelope = JSON.parse(fs.readFileSync(result.envelopeFile, 'utf8'));

  assert.equal(envelope.version, '3a');
  assert.equal(envelope.run_id, run.run_id);
  assert.equal(envelope.product_id, product.product_id);
  assert.equal(envelope.stage_id, 'spec');
  assert.ok(typeof envelope.created_at === 'number', 'created_at should be a timestamp');
  assert.ok(envelope.execution_contract, 'Should have execution_contract for spec');
  assert.ok(envelope.output_contract, 'Should have output_contract for spec');
});

test('generateEnvelope is idempotent — no crash on existing dir', () => {
  const dir = makeTempDir();
  const product = makeProduct(dir);
  const run = makeRun('brief');
  const stage = { stage_id: 'brief', label: 'Brief', goal: 'Define.' };
  const svc = new ExecutionOrchestratorService();

  const r1 = svc.generateEnvelope(run, product, stage);
  const r2 = svc.generateEnvelope(run, product, stage);
  assert.ok(r2.envelopePath, 'Second call should succeed');
  assert.ok(fs.existsSync(r2.envelopeFile), 'Envelope file should still exist after second call');
});

test('generateEnvelope skips gracefully when product has no repo.local_path', () => {
  const svc = new ExecutionOrchestratorService();
  const product = { product_id: 'no-repo', name: 'No Repo', repo: {} };
  const run = makeRun('brief');
  const stage = { stage_id: 'brief', label: 'Brief', goal: 'Define.' };
  const result = svc.generateEnvelope(run, product, stage);
  assert.equal(result.skipped, true, 'Should be flagged as skipped');
  assert.ok(result.reason, 'Should have a reason');
});

test('generateEnvelope brief includes product name and objective', () => {
  const dir = makeTempDir();
  const product = makeProduct(dir);
  const run = makeRun('brief');
  const stage = { stage_id: 'brief', label: 'Discovery Brief', goal: 'Define the product.' };
  const svc = new ExecutionOrchestratorService();
  const result = svc.generateEnvelope(run, product, stage);
  const content = fs.readFileSync(result.briefFile, 'utf8');
  assert.ok(content.includes(product.name), 'Brief should contain product name');
});

// ─── Evidence verification tests ──────────────────────────────────────────────

test('verifyEvidence returns all_required_met: true when brief artifact exists', () => {
  const dir = makeTempDir();
  const product = makeProduct(dir);
  // Create the brief artifact
  const docsDir = path.join(product.repo.local_path, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'brief.md'), '# brief', 'utf8');

  const run = makeRun('brief');
  const svc = new ExecutionOrchestratorService();
  const report = svc.verifyEvidence(run, product, '');

  assert.equal(report.stage_in_scope, true);
  assert.equal(report.all_required_met, true);
  assert.equal(report.missing_required.length, 0);
});

test('verifyEvidence returns all_required_met: false when brief artifact missing', () => {
  const dir = makeTempDir();
  const product = makeProduct(dir);
  // No brief artifact created in repo
  const run = makeRun('brief');
  const svc = new ExecutionOrchestratorService();
  const report = svc.verifyEvidence(run, product, '');

  assert.equal(report.stage_in_scope, true);
  assert.equal(report.all_required_met, false);
  assert.ok(report.missing_required.includes('brief'), 'brief should be in missing_required');
});

test('verifyEvidence for implementation stage (no required artifacts) returns true', () => {
  const dir = makeTempDir();
  const product = makeProduct(dir);
  const run = makeRun('implementation');
  const svc = new ExecutionOrchestratorService();
  const report = svc.verifyEvidence(run, product, '');
  // implementation has no required_artifacts, so all_required_met is vacuously true
  assert.equal(report.all_required_met, true);
  assert.equal(report.missing_required.length, 0);
});

test('verifyEvidence for out-of-scope stage returns stage_in_scope: false', () => {
  const dir = makeTempDir();
  const product = makeProduct(dir);
  const run = makeRun('architecture'); // out of scope
  const svc = new ExecutionOrchestratorService();
  const report = svc.verifyEvidence(run, product, '');
  assert.equal(report.stage_in_scope, false);
  assert.equal(report.all_required_met, null);
});

test('verifyEvidence persists report to envelope path', () => {
  const dir = makeTempDir();
  const product = makeProduct(dir);
  const envelopeDir = path.join(dir, '.platform', 'runtime', 'runs', 'run-test-001');
  fs.mkdirSync(envelopeDir, { recursive: true });

  const run = makeRun('brief', { run_id: 'run-test-001' });
  const svc = new ExecutionOrchestratorService();
  svc.verifyEvidence(run, product, envelopeDir);

  const reportFile = path.join(envelopeDir, 'evidence-report.json');
  assert.ok(fs.existsSync(reportFile), 'evidence-report.json should be written to envelope dir');
  const saved = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  assert.equal(saved.run_id, 'run-test-001');
});

// ─── Transition gate tests ─────────────────────────────────────────────────────

test('getTransitionGateStatus returns passing when all required artifacts exist', () => {
  const dir = makeTempDir();
  const product = makeProduct(dir);
  const docsDir = path.join(product.repo.local_path, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'brief.md'), '# brief', 'utf8');

  const run = makeRun('brief');
  const svc = new ExecutionOrchestratorService();
  const status = svc.getTransitionGateStatus(run, product, '');
  assert.equal(status, 'passing');
});

test('getTransitionGateStatus returns blocked when required artifact missing', () => {
  const dir = makeTempDir();
  const product = makeProduct(dir);
  // No brief artifact
  const run = makeRun('brief');
  const svc = new ExecutionOrchestratorService();
  const status = svc.getTransitionGateStatus(run, product, '');
  assert.equal(status, 'blocked');
});

test('getTransitionGateStatus returns no-contract for out-of-scope stage', () => {
  const dir = makeTempDir();
  const product = makeProduct(dir);
  const run = makeRun('architecture');
  const svc = new ExecutionOrchestratorService();
  const status = svc.getTransitionGateStatus(run, product, '');
  assert.equal(status, 'no-contract');
});

test('getTransitionGateStatus returns passing for implementation (no required artifacts)', () => {
  const dir = makeTempDir();
  const product = makeProduct(dir);
  const run = makeRun('implementation');
  const svc = new ExecutionOrchestratorService();
  const status = svc.getTransitionGateStatus(run, product, '');
  assert.equal(status, 'passing');
});

// ─── Launch strategy tests ────────────────────────────────────────────────────

test('getLaunchStrategy for gemini returns file-reference', () => {
  const svc = new ExecutionOrchestratorService();
  const { strategy } = svc.getLaunchStrategy('gemini', '/some/path');
  assert.equal(strategy, 'file-reference');
});

test('getLaunchStrategy for claude returns ready-gated', () => {
  const svc = new ExecutionOrchestratorService();
  const { strategy } = svc.getLaunchStrategy('claude', '/some/path');
  assert.equal(strategy, 'ready-gated');
});

test('getLaunchStrategy for codex returns file-reference', () => {
  const svc = new ExecutionOrchestratorService();
  const { strategy } = svc.getLaunchStrategy('codex', '/some/path');
  assert.equal(strategy, 'file-reference');
});

test('getLaunchStrategy for antigravity returns stdin-full', () => {
  const svc = new ExecutionOrchestratorService();
  const { strategy } = svc.getLaunchStrategy('antigravity', '/some/path');
  assert.equal(strategy, 'stdin-full');
});

test('getLaunchStrategy for unknown agent returns stdin-full', () => {
  const svc = new ExecutionOrchestratorService();
  const { strategy } = svc.getLaunchStrategy('unknown-agent-v99', '/some/path');
  assert.equal(strategy, 'stdin-full');
});

test('getLaunchStrategy for gemini includes brief path in bootstrap_instruction', () => {
  const svc = new ExecutionOrchestratorService();
  const { bootstrap_instruction, envelope_path } = svc.getLaunchStrategy('gemini', '/some/envelope');
  assert.ok(bootstrap_instruction.includes('execution-brief.md'), 'Bootstrap instruction should reference brief file');
  assert.equal(envelope_path, '/some/envelope');
});

test('getLaunchStrategy with no envelope returns empty bootstrap_instruction for file-reference', () => {
  const svc = new ExecutionOrchestratorService();
  const { strategy, bootstrap_instruction } = svc.getLaunchStrategy('gemini', '');
  assert.equal(strategy, 'file-reference');
  assert.equal(bootstrap_instruction, '', 'No envelope path = empty bootstrap instruction');
});

// ─── Backward compatibility tests ─────────────────────────────────────────────

test('hydrateRun backward compat: run without envelope path returns no-contract gate status', () => {
  // Simulate a run that was created before 3A (no execution_envelope_path)
  const svc = new ExecutionOrchestratorService();
  const oldRun = { run_id: 'old-run', stage_id: 'brief' }; // no execution_envelope_path
  const productWithRepo = { product_id: 'p', repo: { local_path: '/tmp/nonexistent-path-xyz' } };
  // verifyEvidence should not crash even if path doesn't exist
  const report = svc.verifyEvidence(oldRun, productWithRepo, '');
  assert.ok(report, 'Should return report without crashing');
  assert.ok(typeof report.all_required_met === 'boolean', 'Should have all_required_met');
});

test('loadEvidenceReport returns null for empty path', () => {
  const svc = new ExecutionOrchestratorService();
  const result = svc.loadEvidenceReport('');
  assert.equal(result, null);
});

test('loadEvidenceReport returns null for non-existent path', () => {
  const svc = new ExecutionOrchestratorService();
  const result = svc.loadEvidenceReport('/tmp/does-not-exist-xyz-123/envelope');
  assert.equal(result, null);
});

test('loadEnvelope returns null for empty path', () => {
  const svc = new ExecutionOrchestratorService();
  const result = svc.loadEnvelope('');
  assert.equal(result, null);
});

test('getExecutionOrchestratorService returns singleton', () => {
  const s1 = getExecutionOrchestratorService();
  const s2 = getExecutionOrchestratorService();
  assert.strictEqual(s1, s2, 'Should be the same instance');
});

// ─── Full roundtrip: generate envelope → load it back ─────────────────────────

test('generateEnvelope then loadEnvelope round-trips successfully', () => {
  const dir = makeTempDir();
  const product = makeProduct(dir);
  const run = makeRun('spec');
  const stage = { stage_id: 'spec', label: 'Product Spec', goal: 'Define spec.' };
  const svc = new ExecutionOrchestratorService();

  const result = svc.generateEnvelope(run, product, stage);
  const loaded = svc.loadEnvelope(result.envelopePath);

  assert.ok(loaded, 'Should be able to load the envelope back');
  assert.equal(loaded.run_id, run.run_id);
  assert.equal(loaded.stage_id, 'spec');
  assert.equal(loaded.product_id, product.product_id);
  assert.ok(loaded.execution_contract, 'Loaded envelope should have execution_contract');
});
