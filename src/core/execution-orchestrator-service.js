/**
 * ExecutionOrchestratorService
 * Milestone 3A — Execution Contracts & Evidence-Oriented Orchestrator
 *
 * Responsibilities:
 * - Materialise execution contracts per stage (brief, spec, implementation, test)
 * - Generate execution envelopes persisted per run on disk
 * - Verify evidence in disk (artifact file existence)
 * - Determine transition gate status (passing / blocked / no-contract)
 * - Select launch strategy per runtime agent
 */

const fs = require('fs');
const path = require('path');

// ─── Stage Execution Contracts ────────────────────────────────────────────────

const EXECUTION_CONTRACTS = {
  brief: {
    stage_id: 'brief',
    objective: 'Turn the product idea into a clear problem statement, target audience definition, and outcome brief.',
    role: 'product-designer',
    required_artifacts: ['brief'],
    optional_artifacts: [],
    context_inputs: ['product.summary', 'product.name'],
    completion_policy: 'artifact-verified'
  },
  spec: {
    stage_id: 'spec',
    objective: 'Define scope, acceptance criteria, system constraints, and technical decisions.',
    role: 'delivery-planner',
    required_artifacts: ['spec'],
    optional_artifacts: ['brief'],
    context_inputs: ['product.summary', 'handoff.brief'],
    completion_policy: 'artifact-verified'
  },
  implementation: {
    stage_id: 'implementation',
    objective: 'Execute the scoped work inside the repository with the correct runtime context.',
    role: 'implementation-agent',
    required_artifacts: [],
    optional_artifacts: ['spec', 'architecture'],
    context_inputs: ['product.summary', 'handoff.spec', 'handoff.architecture'],
    completion_policy: 'handoff-with-session'
  },
  test: {
    stage_id: 'test',
    objective: 'Validate quality, regression risk, and readiness against the spec.',
    role: 'qa-agent',
    required_artifacts: ['test-strategy'],
    optional_artifacts: ['spec'],
    context_inputs: ['product.summary', 'handoff.implementation'],
    completion_policy: 'artifact-verified'
  }
};

// ─── Output Contracts ─────────────────────────────────────────────────────────

const OUTPUT_CONTRACTS = {
  brief: {
    stage_id: 'brief',
    outputs: [
      { id: 'brief-doc', type: 'artifact', label: 'Brief Document', required: true, path_hint: 'docs/brief.md', verification_mode: 'file-exists' },
      { id: 'brief-session', type: 'session', label: 'Linked execution session', required: true, path_hint: null, verification_mode: 'session-linked' }
    ]
  },
  spec: {
    stage_id: 'spec',
    outputs: [
      { id: 'spec-doc', type: 'artifact', label: 'Spec Document', required: true, path_hint: 'docs/spec.md', verification_mode: 'file-exists' },
      { id: 'spec-session', type: 'session', label: 'Linked execution session', required: true, path_hint: null, verification_mode: 'session-linked' }
    ]
  },
  implementation: {
    stage_id: 'implementation',
    outputs: [
      { id: 'impl-session', type: 'session', label: 'Linked execution session', required: true, path_hint: null, verification_mode: 'session-linked' },
      { id: 'impl-handoff', type: 'handoff', label: 'Stage handoff with outcome summary', required: true, path_hint: null, verification_mode: 'handoff-recorded' }
    ]
  },
  test: {
    stage_id: 'test',
    outputs: [
      { id: 'test-strategy-doc', type: 'artifact', label: 'Test Strategy Document', required: true, path_hint: 'docs/test-strategy.md', verification_mode: 'file-exists' },
      { id: 'test-session', type: 'session', label: 'Linked execution session', required: true, path_hint: null, verification_mode: 'session-linked' }
    ]
  }
};

// ─── Launch Strategies ────────────────────────────────────────────────────────

const AGENT_LAUNCH_STRATEGIES = {
  gemini: 'file-reference',
  codex: 'file-reference',
  claude: 'ready-gated',
  antigravity: 'stdin-full'
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeMtime(filePath) {
  try { return fs.statSync(filePath).mtimeMs; } catch { return null; }
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function resolveArtifactPath(repoPath, artifactId) {
  const pathHints = {
    'brief': ['docs/brief.md', 'docs/discovery'],
    'spec': ['docs/spec.md'],
    'architecture': ['ARCHITECTURE.md', 'ADR'],
    'test-strategy': ['docs/test-strategy.md'],
    'release-plan': ['docs/release-plan.md'],
    'runbook': ['docs/runbook.md'],
    'manifest': ['.platform/product.json']
  };
  const hints = pathHints[artifactId] || [];
  for (const hint of hints) {
    const full = path.join(repoPath, hint);
    if (fs.existsSync(full)) return { path: full, exists: true };
  }
  // Return the primary hint even if it doesn't exist
  const primary = hints[0] ? path.join(repoPath, hints[0]) : null;
  return { path: primary, exists: false };
}

// ─── Envelope Builder ─────────────────────────────────────────────────────────

function buildExecutionBriefMarkdown(product, stage, run, contract, previousHandoff) {
  const lines = [
    `# Execution Brief`,
    ``,
    `**Product**: ${product.name}`,
    product.summary ? `**Summary**: ${product.summary}` : '',
    `**Stage**: ${stage.label || stage.stage_id} (${stage.stage_id})`,
    `**Run ID**: ${run.run_id}`,
    `**Role**: ${contract.role}`,
    ``,
    `## Objective`,
    ``,
    contract.objective,
    ``
  ];

  if (previousHandoff) {
    lines.push(
      `## Context from Previous Stage`,
      ``,
      `**Handoff from**: ${previousHandoff.from_stage} → ${previousHandoff.to_stage}`,
      previousHandoff.summary ? `**Summary**: ${previousHandoff.summary}` : '',
      ``
    );
    if (Array.isArray(previousHandoff.output_refs) && previousHandoff.output_refs.length) {
      lines.push(`**Referenced outputs**: ${previousHandoff.output_refs.join(', ')}`, ``);
    }
  }

  if (contract.required_artifacts.length) {
    lines.push(
      `## Required Outputs`,
      ``,
      ...contract.required_artifacts.map(a => `- [ ] \`${a}\` artifact (required)`),
      ``
    );
  }
  if (contract.optional_artifacts.length) {
    lines.push(
      `## Optional Inputs`,
      ``,
      ...contract.optional_artifacts.map(a => `- \`${a}\` (if available)`),
      ``
    );
  }

  if (run.knowledge_pack_id) {
    lines.push(
      `## Knowledge Context`,
      ``,
      `**Pack**: ${run.knowledge_pack_name || run.knowledge_pack_id}`,
      run.preset_type ? `**Preset**: ${run.preset_type} ${run.preset_label || run.preset_id}` : '',
      ``
    );
  }

  lines.push(
    `## Instructions`,
    ``,
    `Work inside the current repository/runtime workspace context.`,
    `Advance only this stage.`,
    `When finished, leave a concise handoff-ready summary of what was produced, what remains, and the next recommended step.`,
    ``
  );

  return lines.filter(l => l !== undefined).join('\n');
}

// ─── Main Class ───────────────────────────────────────────────────────────────

class ExecutionOrchestratorService {
  /**
   * Returns the execution contract for a stage, or null if not in scope.
   * @param {string} stageId
   * @returns {Object|null}
   */
  getContractForStage(stageId) {
    return EXECUTION_CONTRACTS[stageId] || null;
  }

  /**
   * Returns the output contract for a stage, or null if not in scope.
   * @param {string} stageId
   * @returns {Object|null}
   */
  getOutputContractForStage(stageId) {
    return OUTPUT_CONTRACTS[stageId] || null;
  }

  /**
   * Generate execution envelope on disk for a run.
   * Creates .platform/runtime/runs/<run_id>/ with 3 files.
   *
   * @param {Object} run - The run record
   * @param {Object} product - Product record
   * @param {Object} stage - Stage preset object (with stage_id, label, goal, etc.)
   * @param {Object} [opts]
   * @param {Object} [opts.previousHandoff] - Latest incoming handoff for context
   * @returns {{ envelopePath: string, envelopeFile: string, briefFile: string, reportFile: string }}
   */
  generateEnvelope(run, product, stage, opts = {}) {
    const repoPath = product?.repo?.local_path || '';
    if (!repoPath) {
      return { envelopePath: '', envelopeFile: '', briefFile: '', reportFile: '', skipped: true, reason: 'no-repo-path' };
    }

    const contract = this.getContractForStage(run.stage_id || stage?.stage_id);
    const outputContract = this.getOutputContractForStage(run.stage_id || stage?.stage_id);
    const envelopeDir = path.join(repoPath, '.platform', 'runtime', 'runs', run.run_id);
    const envelopeFile = path.join(envelopeDir, 'execution-envelope.json');
    const briefFile = path.join(envelopeDir, 'execution-brief.md');
    const reportFile = path.join(envelopeDir, 'evidence-report.json');

    const now = Date.now();

    // Write envelope JSON
    const envelopeData = {
      version: '3a',
      run_id: run.run_id,
      product_id: product.product_id || '',
      product_name: product.name || '',
      stage_id: stage?.stage_id || run.stage_id || '',
      stage_label: stage?.label || run.stage_id || '',
      created_at: now,
      execution_contract: contract || null,
      output_contract: outputContract || null,
      knowledge_pack_id: run.knowledge_pack_id || '',
      knowledge_pack_name: run.knowledge_pack_name || '',
      preset_type: run.preset_type || '',
      preset_id: run.preset_id || '',
      preset_label: run.preset_label || '',
      workspace_id: run.workspace_id || '',
      objective: run.objective || stage?.goal || ''
    };
    writeJsonAtomic(envelopeFile, envelopeData);

    // Write human-readable brief
    const briefContent = buildExecutionBriefMarkdown(product, stage || { stage_id: run.stage_id, label: run.stage_id }, run, contract || { role: '', objective: run.objective || '', required_artifacts: [], optional_artifacts: [] }, opts.previousHandoff || null);
    fs.mkdirSync(path.dirname(briefFile), { recursive: true });
    fs.writeFileSync(briefFile, briefContent, 'utf8');

    // Initialise evidence report (empty, filled during verification)
    if (!fs.existsSync(reportFile)) {
      writeJsonAtomic(reportFile, {
        version: '3a',
        run_id: run.run_id,
        stage_id: stage?.stage_id || run.stage_id || '',
        verified_at: null,
        all_required_met: false,
        artifacts: [],
        missing_required: []
      });
    }

    return { envelopePath: envelopeDir, envelopeFile, briefFile, reportFile };
  }

  /**
   * Verify evidence on disk for a run's required artifacts.
   * Updates evidence-report.json in the envelope directory.
   *
   * @param {Object} run - The run record (must have execution_envelope_path or product/stage to derive it)
   * @param {Object} product - Product record
   * @param {string} [envelopePath] - Override envelope directory path
   * @returns {Object} EvidenceVerificationReport
   */
  verifyEvidence(run, product, envelopePath) {
    const repoPath = product?.repo?.local_path || '';
    const contract = this.getContractForStage(run.stage_id);
    const now = Date.now();

    if (!contract) {
      return {
        verified_at: now,
        all_required_met: null,
        contract_stage: run.stage_id,
        stage_in_scope: false,
        artifacts: [],
        missing_required: []
      };
    }

    const artifacts = contract.required_artifacts.map(artifactId => {
      const resolved = repoPath ? resolveArtifactPath(repoPath, artifactId) : { path: null, exists: false };
      return {
        artifact_id: artifactId,
        required: true,
        exists: resolved.exists,
        matched_path: resolved.path || null,
        mtime: resolved.exists && resolved.path ? safeMtime(resolved.path) : null,
        verified_at: now
      };
    });

    const allRequiredMet = artifacts.filter(a => a.required).every(a => a.exists);
    const missingRequired = artifacts.filter(a => a.required && !a.exists).map(a => a.artifact_id);

    const report = {
      version: '3a',
      run_id: run.run_id,
      stage_id: run.stage_id,
      verified_at: now,
      all_required_met: allRequiredMet,
      stage_in_scope: true,
      artifacts,
      missing_required: missingRequired
    };

    // Persist updated report to disk if envelope path provided
    const resolvedEnvelopePath = envelopePath || run.execution_envelope_path || '';
    if (resolvedEnvelopePath) {
      const reportFile = path.join(resolvedEnvelopePath, 'evidence-report.json');
      try {
        writeJsonAtomic(reportFile, report);
      } catch {
        // Best-effort write — don't fail verification if write fails
      }
    }

    return report;
  }

  /**
   * Derive transition gate status for a run.
   * @param {Object} run
   * @param {Object} product
   * @param {string} [envelopePath]
   * @returns {'passing'|'blocked'|'no-contract'}
   */
  getTransitionGateStatus(run, product, envelopePath) {
    const contract = this.getContractForStage(run.stage_id);
    if (!contract) return 'no-contract';

    // For stages with no required artifacts, gate is always passing
    if (!contract.required_artifacts.length) return 'passing';

    const report = this.verifyEvidence(run, product, envelopePath);
    return report.all_required_met ? 'passing' : 'blocked';
  }

  /**
   * Get launch strategy for a given agent.
   * @param {string} agent - 'gemini' | 'claude' | 'codex' | 'antigravity'
   * @param {string} [envelopePath] - Path to envelope directory (for file-reference)
   * @returns {{ strategy: string, bootstrap_instruction: string, envelope_path: string }}
   */
  getLaunchStrategy(agent, envelopePath) {
    const strategy = AGENT_LAUNCH_STRATEGIES[agent] || 'stdin-full';
    const ep = envelopePath || '';
    const briefFile = ep ? path.join(ep, 'execution-brief.md') : '';

    let bootstrapInstruction = '';
    if (strategy === 'file-reference' && briefFile) {
      bootstrapInstruction = `Please read the execution brief at: ${briefFile}\n\nProceed with the work described in that brief. When done, summarise what was produced and what the next step should be.`;
    } else if (strategy === 'ready-gated' && briefFile) {
      bootstrapInstruction = `Context for this run is in: ${briefFile}\n\nPlease read it and proceed.`;
    }
    // stdin-full: bootstrap_instruction is empty; PtyManager uses the full promptSeed instead

    return { strategy, bootstrap_instruction: bootstrapInstruction, envelope_path: ep };
  }

  /**
   * Load evidence report from disk (if envelope exists).
   * @param {string} envelopePath
   * @returns {Object|null}
   */
  loadEvidenceReport(envelopePath) {
    if (!envelopePath) return null;
    const reportFile = path.join(envelopePath, 'evidence-report.json');
    try {
      if (!fs.existsSync(reportFile)) return null;
      return JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * Load envelope JSON from disk.
   * @param {string} envelopePath
   * @returns {Object|null}
   */
  loadEnvelope(envelopePath) {
    if (!envelopePath) return null;
    const envelopeFile = path.join(envelopePath, 'execution-envelope.json');
    try {
      if (!fs.existsSync(envelopeFile)) return null;
      return JSON.parse(fs.readFileSync(envelopeFile, 'utf8'));
    } catch {
      return null;
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let instance = null;

function getExecutionOrchestratorService() {
  if (!instance) instance = new ExecutionOrchestratorService();
  return instance;
}

module.exports = {
  ExecutionOrchestratorService,
  getExecutionOrchestratorService,
  EXECUTION_CONTRACTS,
  OUTPUT_CONTRACTS,
  AGENT_LAUNCH_STRATEGIES
};
