const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.join(__dirname, '..', '..');
const COPILOT_FILE = path.join(ROOT_DIR, 'state', 'project-copilot.json');

const SCAN_DIRS = ['docs', '.platform'];
const ROOT_SCAN_FILES = [
  'README.md',
  'PRODUCT.md',
  'ARCHITECTURE.md',
  'package.json',
  'render.yaml',
  'docker-compose.yml',
  'Dockerfile'
];
const MAX_SCAN_FILES = 200;
const ALLOWED_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.json', '.yaml', '.yml']);

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function normalizeStore(raw) {
  if (raw && typeof raw === 'object' && raw.version === 1 && raw.products && typeof raw.products === 'object') {
    return raw;
  }
  return { version: 1, products: {} };
}

function normalizeProductState(raw) {
  if (raw && typeof raw === 'object') {
    return {
      decisions: Array.isArray(raw.decisions) ? raw.decisions : [],
      candidate_reviews: raw.candidate_reviews && typeof raw.candidate_reviews === 'object' ? raw.candidate_reviews : {},
      last_recommendation: raw.last_recommendation || null,
      last_summary: raw.last_summary || '',
      updated_at: raw.updated_at || 0
    };
  }
  return {
    decisions: [],
    candidate_reviews: {},
    last_recommendation: null,
    last_summary: '',
    updated_at: 0
  };
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function normalizeRelativePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.?\//, '');
}

function candidateIdFor(productId, relativePath) {
  const key = `${productId}:${normalizeRelativePath(relativePath).toLowerCase()}`;
  return `cand-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)}`;
}

function decisionId() {
  return `decision-${crypto.randomBytes(4).toString('hex')}`;
}

function detectArtifactKind(relativePath) {
  const rel = normalizeRelativePath(relativePath).toLowerCase();
  const fileName = path.posix.basename(rel);

  if (rel === '.platform/product.json') {
    return {
      kind_guess: 'manifest',
      mapped_stage: 'idea',
      confidence: 0.99,
      counts_as_artifact: true,
      reason: 'Matches the platform manifest path exactly.'
    };
  }
  if (rel === 'docs/brief.md') {
    return {
      kind_guess: 'brief',
      mapped_stage: 'brief',
      confidence: 0.99,
      counts_as_artifact: true,
      reason: 'Matches the canonical brief artifact path.'
    };
  }
  if (rel.startsWith('docs/discovery/')) {
    return {
      kind_guess: 'brief',
      mapped_stage: 'brief',
      confidence: 0.93,
      counts_as_artifact: true,
      reason: 'Discovery documentation is a strong brief candidate for this platform.'
    };
  }
  if (rel === 'docs/spec.md' || fileName.includes('spec')) {
    return {
      kind_guess: 'spec',
      mapped_stage: 'spec',
      confidence: rel === 'docs/spec.md' ? 0.99 : 0.86,
      counts_as_artifact: true,
      reason: rel === 'docs/spec.md'
        ? 'Matches the canonical spec artifact path.'
        : 'Filename strongly suggests a specification artifact.'
    };
  }
  if (rel === 'architecture.md' || rel === 'ARCHITECTURE.md'.toLowerCase() || rel.startsWith('adr/')) {
    return {
      kind_guess: 'architecture',
      mapped_stage: 'architecture',
      confidence: rel.startsWith('adr/') ? 0.89 : 0.95,
      counts_as_artifact: true,
      reason: rel.startsWith('adr/')
        ? 'ADR entries are accepted architecture evidence in this platform.'
        : 'Matches the primary architecture artifact name.'
    };
  }
  if (rel === 'docs/test-strategy.md' || fileName.includes('test-strategy') || fileName.includes('test_plan') || fileName.includes('test-plan')) {
    return {
      kind_guess: 'test-strategy',
      mapped_stage: 'test',
      confidence: rel === 'docs/test-strategy.md' ? 0.99 : 0.84,
      counts_as_artifact: true,
      reason: rel === 'docs/test-strategy.md'
        ? 'Matches the canonical test strategy artifact path.'
        : 'Filename strongly suggests a test planning artifact.'
    };
  }
  if (rel === 'docs/runbook.md' || fileName.includes('runbook')) {
    return {
      kind_guess: 'runbook',
      mapped_stage: 'release',
      confidence: rel === 'docs/runbook.md' ? 0.99 : 0.86,
      counts_as_artifact: true,
      reason: rel === 'docs/runbook.md'
        ? 'Matches the canonical runbook artifact path.'
        : 'Filename strongly suggests operational runbook content.'
    };
  }
  if (rel === 'docs/release-plan.md' || fileName.includes('release-plan') || fileName.includes('rollout')) {
    return {
      kind_guess: 'release-plan',
      mapped_stage: 'release',
      confidence: rel === 'docs/release-plan.md' ? 0.99 : 0.84,
      counts_as_artifact: true,
      reason: rel === 'docs/release-plan.md'
        ? 'Matches the canonical release plan artifact path.'
        : 'Filename strongly suggests release planning content.'
    };
  }
  if (fileName.includes('brief') || fileName.includes('discovery')) {
    return {
      kind_guess: 'brief',
      mapped_stage: 'brief',
      confidence: 0.74,
      counts_as_artifact: false,
      reason: 'Filename suggests discovery or brief content, but the path is not canonical.'
    };
  }
  return {
    kind_guess: 'document',
    mapped_stage: '',
    confidence: 0.42,
    counts_as_artifact: false,
    reason: 'File is relevant project documentation but does not map strongly to a governed artifact.'
  };
}

function collectObservedPaths(product, context = {}) {
  const repoPath = product?.repo?.local_path || '';
  if (!repoPath) return [];
  const results = [];
  const seen = new Set();

  function maybePush(filePath, source) {
    if (!filePath || results.length >= MAX_SCAN_FILES) return;
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(repoPath, filePath);
    const stat = safeStat(absolutePath);
    if (!stat || !stat.isFile()) return;
    const relativePath = normalizeRelativePath(path.relative(repoPath, absolutePath));
    if (!relativePath || seen.has(relativePath)) return;
    seen.add(relativePath);
    results.push({
      path: absolutePath,
      relative_path: relativePath,
      mtime: stat.mtimeMs,
      size: stat.size,
      source
    });
  }

  for (const run of context.recent_runs || []) {
    for (const output of run.produced_outputs || []) {
      if (output && output.path) maybePush(output.path, 'run-output');
    }
  }
  for (const output of context.current_run?.produced_outputs || []) {
    if (output && output.path) maybePush(output.path, 'current-run-output');
  }
  for (const handoff of context.handoffs || []) {
    for (const output of handoff.produced_outputs_snapshot || []) {
      if (output && output.path) maybePush(output.path, 'handoff-output');
    }
  }

  return results;
}

function collectRepoFiles(repoPath, extraDirs = []) {
  const seen = new Set();
  const results = [];
  const scanDirs = [...new Set(SCAN_DIRS.concat(extraDirs || []).filter(Boolean))];

  function maybePush(filePath) {
    if (!filePath || results.length >= MAX_SCAN_FILES) return;
    const normalized = normalizeRelativePath(path.relative(repoPath, filePath));
    if (!normalized || seen.has(normalized)) return;
    const stat = safeStat(filePath);
    if (!stat || !stat.isFile()) return;
    const ext = path.extname(filePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext) && !ROOT_SCAN_FILES.includes(normalized)) return;
    seen.add(normalized);
    results.push({
      path: filePath,
      relative_path: normalized,
      mtime: stat.mtimeMs,
      size: stat.size
    });
  }

  function walk(dirPath, depth) {
    if (!dirPath || depth > 4 || results.length >= MAX_SCAN_FILES) return;
    for (const entry of safeReadDir(dirPath)) {
      if (results.length >= MAX_SCAN_FILES) return;
      const full = path.join(dirPath, entry.name);
      const rel = normalizeRelativePath(path.relative(repoPath, full));
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(entry.name)) continue;
        walk(full, depth + 1);
      } else {
        maybePush(full);
      }
      if (rel && ROOT_SCAN_FILES.includes(rel)) maybePush(full);
    }
  }

  for (const relPath of ROOT_SCAN_FILES) {
    maybePush(path.join(repoPath, relPath));
  }
  for (const dir of scanDirs) {
    const full = path.join(repoPath, dir);
    const stat = safeStat(full);
    if (stat && stat.isDirectory()) {
      walk(full, 0);
    } else if (stat && stat.isFile()) {
      maybePush(full);
    }
  }

  return results;
}

function normalizeDecision(raw) {
  return {
    decision_id: raw.decision_id || '',
    title: raw.title || '',
    status: raw.status || 'open',
    source: raw.source || 'user-confirmed',
    accepted_by_user: raw.accepted_by_user !== false,
    linked_stage: raw.linked_stage || '',
    linked_artifacts: Array.isArray(raw.linked_artifacts) ? raw.linked_artifacts : [],
    note: raw.note || '',
    created_at: raw.created_at || 0,
    updated_at: raw.updated_at || 0
  };
}

class ProjectCopilotService {
  constructor(opts = {}) {
    this.storeFile = opts.storeFile || COPILOT_FILE;
  }

  getStore() {
    return normalizeStore(readJson(this.storeFile, { version: 1, products: {} }));
  }

  getProductState(productId) {
    const store = this.getStore();
    return normalizeProductState(store.products[productId]);
  }

  saveProductState(productId, nextState) {
    const store = this.getStore();
    store.products[productId] = {
      ...normalizeProductState(store.products[productId]),
      ...nextState,
      updated_at: Date.now()
    };
    writeJsonAtomic(this.storeFile, store);
    return normalizeProductState(store.products[productId]);
  }

  reviewCandidate(productId, candidateId, accepted) {
    const state = this.getProductState(productId);
    state.candidate_reviews[candidateId] = {
      accepted: accepted === true ? true : false,
      reviewed_at: Date.now()
    };
    return this.saveProductState(productId, state);
  }

  addDecision(productId, payload = {}) {
    const state = this.getProductState(productId);
    const now = Date.now();
    const record = normalizeDecision({
      decision_id: decisionId(),
      title: String(payload.title || '').trim(),
      status: payload.status || 'open',
      source: payload.source || 'user-confirmed',
      accepted_by_user: true,
      linked_stage: payload.linked_stage || '',
      linked_artifacts: Array.isArray(payload.linked_artifacts) ? payload.linked_artifacts : [],
      note: String(payload.note || '').trim(),
      created_at: now,
      updated_at: now
    });
    if (!record.title) throw new Error('Decision title is required');
    state.decisions.unshift(record);
    this.saveProductState(productId, state);
    return record;
  }

  updateDecision(productId, decisionIdValue, updates = {}) {
    const state = this.getProductState(productId);
    const index = state.decisions.findIndex((item) => item.decision_id === decisionIdValue);
    if (index === -1) return null;
    const now = Date.now();
    state.decisions[index] = normalizeDecision({
      ...state.decisions[index],
      ...updates,
      updated_at: now
    });
    this.saveProductState(productId, state);
    return state.decisions[index];
  }

  _buildCandidateArtifacts(product, context, persistedState) {
    const repoPath = product?.repo?.local_path || '';
    if (!repoPath || !fs.existsSync(repoPath)) return [];

    const knownArtifacts = Array.isArray(context.artifacts) ? context.artifacts : [];
    const knownPaths = new Set(
      knownArtifacts
        .filter((item) => item && item.exists && item.path)
        .map((item) => normalizeRelativePath(path.relative(repoPath, item.path)))
    );
    const extraScanDirs = knownArtifacts
      .map((item) => {
        if (!item || !item.path) return '';
        const rel = normalizeRelativePath(path.relative(repoPath, item.path));
        return rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      })
      .filter(Boolean);
    const files = collectRepoFiles(repoPath, extraScanDirs);
    const observedFiles = collectObservedPaths(product, context);
    const candidateFiles = [...observedFiles, ...files];
    const candidates = [];

    for (const file of candidateFiles) {
      if (knownPaths.has(file.relative_path)) continue;
      const classification = detectArtifactKind(file.relative_path);
      if (classification.confidence < 0.55) continue;
      const candidateId = candidateIdFor(product.product_id, file.relative_path);
      const review = persistedState.candidate_reviews[candidateId] || null;
      candidates.push({
        candidate_id: candidateId,
        path: file.path,
        relative_path: file.relative_path,
        kind_guess: classification.kind_guess,
        mapped_stage: classification.mapped_stage,
        confidence: classification.confidence,
        counts_as_artifact: classification.counts_as_artifact,
        reason: classification.reason,
        accepted: review ? review.accepted : null,
        reviewed_at: review ? review.reviewed_at : null,
        mtime: file.mtime,
        size: file.size,
        state: review
          ? (review.accepted ? 'accepted' : 'blocked')
          : (classification.counts_as_artifact ? 'candidate' : 'blocked')
      });
    }

    return candidates
      .sort((a, b) => (b.confidence - a.confidence) || ((b.mtime || 0) - (a.mtime || 0)))
      .slice(0, 12);
  }

  _buildCreatedAssets(product, context, candidates) {
    const repoPath = product?.repo?.local_path || '';
    const items = [];
    const seen = new Set();

    for (const artifact of context.artifacts || []) {
      if (!artifact || !artifact.exists) continue;
      const key = `artifact:${artifact.id}:${artifact.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: `artifact:${artifact.id}`,
        label: artifact.label,
        path: artifact.path,
        relative_path: repoPath && artifact.path ? normalizeRelativePath(path.relative(repoPath, artifact.path)) : '',
        type: 'artifact',
        stage: artifact.id === 'brief' ? 'brief'
          : artifact.id === 'spec' ? 'spec'
          : artifact.id === 'architecture' ? 'architecture'
          : artifact.id === 'test-strategy' ? 'test'
          : artifact.id === 'runbook' || artifact.id === 'release-plan' ? 'release'
          : '',
        source: 'governed-artifact',
        status: 'accepted'
      });
    }

    for (const candidate of candidates || []) {
      if (candidate.accepted !== true) continue;
      const key = `candidate:${candidate.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: candidate.candidate_id,
        label: candidate.kind_guess === 'document' ? candidate.relative_path : candidate.kind_guess,
        path: candidate.path,
        relative_path: candidate.relative_path,
        type: 'candidate-artifact',
        stage: candidate.mapped_stage,
        source: 'accepted-candidate',
        status: 'accepted'
      });
    }

    return items;
  }

  _buildDeliveryReadiness(context, candidates) {
    const artifacts = Array.isArray(context.artifacts) ? context.artifacts : [];
    const pipeline = Array.isArray(context.pipeline) ? context.pipeline : [];
    const readiness = context.readiness || { status: 'not-ready', gaps: [] };
    const acceptedKinds = new Set(
      (candidates || [])
        .filter((item) => item.accepted === true)
        .map((item) => item.kind_guess)
    );
    const hasArtifact = (artifactId) => {
      const artifact = artifacts.find((item) => item.id === artifactId);
      return !!(artifact && artifact.exists) || acceptedKinds.has(artifactId);
    };
    const stageStatus = (stageId) => {
      const stage = pipeline.find((item) => item.stage_id === stageId);
      return stage ? stage.status : 'not-started';
    };
    const implementationReady = ['done', 'in-progress'].includes(stageStatus('implementation'));
    const testReady = implementationReady && (hasArtifact('spec') || hasArtifact('architecture') || hasArtifact('brief'));
    const testDeployReady = testReady && hasArtifact('runbook');
    const productionReady = readiness.status === 'ready-for-release-candidate'
      && hasArtifact('test-strategy')
      && hasArtifact('release-plan')
      && hasArtifact('runbook');
    const blockingReasons = [];

    if (!implementationReady) blockingReasons.push('Implementation has not produced enough evidence yet.');
    if (!hasArtifact('spec') && !hasArtifact('architecture') && !hasArtifact('brief')) {
      blockingReasons.push('Core product documentation is still too thin for reliable testing.');
    }
    if (!hasArtifact('runbook')) blockingReasons.push('Runbook is missing for test deploy readiness.');
    if (!hasArtifact('release-plan')) blockingReasons.push('Release plan is missing for production readiness.');
    if (!hasArtifact('test-strategy')) blockingReasons.push('Test strategy is missing for production readiness.');

    return {
      ready_for_test: testReady,
      ready_for_test_deploy: testDeployReady,
      ready_for_production: productionReady,
      blocking_reasons: [...new Set(blockingReasons)].slice(0, 5)
    };
  }

  _buildCurrentState(product, context, createdAssets, candidates, deliveryReadiness, decisions) {
    const pipeline = Array.isArray(context.pipeline) ? context.pipeline : [];
    const currentStageId = context.current_stage_id || '';
    const currentStage = pipeline.find((item) => item.stage_id === currentStageId) || null;
    const blockers = [];
    const candidateNeedsReview = (candidates || []).filter((item) => item.accepted === null && item.counts_as_artifact);
    const openDecisions = (decisions || []).filter((item) => item.status === 'open');

    if (currentStage && currentStage.required_artifacts && currentStage.required_artifacts.length) {
      for (const artifactId of currentStage.required_artifacts) {
        const artifact = (context.artifacts || []).find((item) => item.id === artifactId);
        if (!artifact || !artifact.exists) {
          blockers.push({
            id: `artifact:${artifactId}`,
            label: `${artifactId} is still missing for stage ${currentStageId}.`,
            state: 'missing'
          });
        }
      }
    }
    if (candidateNeedsReview.length) {
      blockers.push({
        id: 'candidate-review',
        label: `${candidateNeedsReview.length} artifact candidate(s) need review before more work is created.`,
        state: 'candidate'
      });
    }
    if (openDecisions.length) {
      blockers.push({
        id: 'open-decisions',
        label: `${openDecisions.length} project decision(s) are still open.`,
        state: 'blocked'
      });
    }
    if (!deliveryReadiness.ready_for_test) {
      blockers.push({
        id: 'test-readiness',
        label: 'The product is not ready for testing yet.',
        state: 'blocked'
      });
    }

    const summaryBits = [
      `${createdAssets.length} created asset(s) are currently visible to the platform.`,
      currentStage ? `Current stage signal is ${currentStage.stage_id} (${currentStage.status}).` : '',
      candidateNeedsReview.length ? `${candidateNeedsReview.length} artifact candidate(s) need semantic review.` : '',
      deliveryReadiness.ready_for_production
        ? 'The product is heuristically ready for production review.'
        : deliveryReadiness.ready_for_test_deploy
          ? 'The product looks close to test deploy readiness.'
          : deliveryReadiness.ready_for_test
            ? 'The product looks ready for structured testing.'
            : 'The product still needs more evidence before testing.'
    ].filter(Boolean);

    return {
      summary: summaryBits.join(' '),
      blockers: blockers.slice(0, 3),
      created_assets_total: createdAssets.length,
      candidate_artifacts_total: candidates.length,
      open_decisions_total: openDecisions.length
    };
  }

  _buildSkillsHint(currentStageKnowledge = []) {
    const rec = Array.isArray(currentStageKnowledge) ? currentStageKnowledge[0] : null;
    if (!rec) return '';
    const workflow = Array.isArray(rec.recommended_workflows) ? rec.recommended_workflows[0] : '';
    const skill = Array.isArray(rec.recommended_skills) ? rec.recommended_skills[0] : '';
    if (workflow && skill) return `${workflow} + ${skill}`;
    return workflow || skill || '';
  }

  _buildRecommendation(product, context, candidates, decisions, deliveryReadiness) {
    const currentStageId = context.current_stage_id || '';
    const nextAction = Array.isArray(context.next_actions) ? context.next_actions[0] : null;
    const candidateNeedsReview = (candidates || []).filter((item) => item.accepted === null && item.counts_as_artifact);
    const openDecisions = (decisions || []).filter((item) => item.status === 'open');
    const skillsHint = this._buildSkillsHint(context.current_stage_knowledge || []);
    const hasCurrentRun = !!context.current_run;
    const pipeline = Array.isArray(context.pipeline) ? context.pipeline : [];
    const currentStage = pipeline.find((item) => item.stage_id === currentStageId) || null;

    if (candidateNeedsReview.length) {
      return {
        action_type: 'review-artifact-candidates',
        reason: 'There are plausible artifact candidates outside the canonical path. Review them before creating duplicate work.',
        confidence: 0.9,
        execution_mode_hint: 'plan-mode',
        skills_hint: skillsHint,
        stage_hint: candidateNeedsReview[0].mapped_stage || currentStageId || ''
      };
    }

    if (openDecisions.length) {
      return {
        action_type: 'resolve-open-issues',
        reason: 'Open project decisions are still blocking coherence. Resolve them before pushing the workflow forward.',
        confidence: 0.82,
        execution_mode_hint: 'plan-mode',
        skills_hint: skillsHint,
        stage_hint: currentStageId || ''
      };
    }

    if (currentStage && currentStage.status === 'in-progress' && hasCurrentRun) {
      return {
        action_type: 'rework-current-stage',
        reason: 'The current stage is already in progress. Tighten the artifact evidence before moving on.',
        confidence: 0.78,
        execution_mode_hint: currentStageId === 'implementation' ? 'subagents' : 'direct-execution',
        skills_hint: skillsHint,
        stage_hint: currentStageId
      };
    }

    if (nextAction && nextAction.executable !== false) {
      return {
        action_type: 'advance-stage',
        reason: nextAction.reason || 'The next governed action is ready to execute.',
        confidence: 0.74,
        execution_mode_hint: (nextAction.step_id || '') === 'implementation' ? 'subagents' : 'direct-execution',
        skills_hint: skillsHint,
        stage_hint: nextAction.step_id || nextAction.stage_id || currentStageId || ''
      };
    }

    if (deliveryReadiness.ready_for_test && !deliveryReadiness.ready_for_test_deploy) {
      return {
        action_type: 'prepare-test-deploy',
        reason: 'The product looks testable, but operational release evidence is still thin.',
        confidence: 0.68,
        execution_mode_hint: 'plan-mode',
        skills_hint: '',
        stage_hint: 'release'
      };
    }

    if (deliveryReadiness.ready_for_production) {
      return {
        action_type: 'review-for-production',
        reason: 'Heuristics say the product is close to production review. Validate manually before treating it as ready.',
        confidence: 0.66,
        execution_mode_hint: 'plan-mode',
        skills_hint: '',
        stage_hint: 'release'
      };
    }

    return {
      action_type: 'clarify-project-state',
      reason: `The platform still lacks enough semantic evidence to move ${product.name} confidently.`,
      confidence: 0.6,
      execution_mode_hint: 'plan-mode',
      skills_hint: skillsHint,
      stage_hint: currentStageId || ''
    };
  }

  _buildOperationalSummary(product, context, currentState, candidates, deliveryReadiness, recommendation) {
    const currentStage = context.current_stage_id || product.declared_stage || 'idea';
    const blockers = (currentState.blockers || []).slice(0, 3).map((b) => b.label || b);

    const nextActions = Array.isArray(context.next_actions) ? context.next_actions : [];
    const firstNextAction = nextActions[0] || {};
    const nextAction = firstNextAction.label || recommendation.action_type || 'continue';

    const fullReason = recommendation.reason || '';
    const reason = fullReason.includes('.') ? fullReason.split('.')[0] + '.' : fullReason;

    const expectedEvidence = (firstNextAction.expected_output || '');

    const candidateNeedsReview = (candidates || []).filter((item) => item.accepted === null && item.counts_as_artifact);
    let riskLevel;
    let riskMessage;
    if (blockers.length > 1) {
      riskLevel = 'high';
      riskMessage = 'Multiple blockers detected';
    } else if (blockers.length === 1 || candidateNeedsReview.length > 0) {
      riskLevel = 'medium';
      riskMessage = 'One issue needs attention';
    } else {
      riskLevel = 'low';
      riskMessage = '';
    }

    const stageKnowledge = context.current_stage_knowledge || {};
    const suggestedWorkflow = (Array.isArray(stageKnowledge.available_presets) ? stageKnowledge.available_presets : [])[0] || '';

    return {
      current_stage: currentStage,
      blockers,
      next_action: nextAction,
      reason,
      expected_evidence: expectedEvidence,
      risk_level: riskLevel,
      risk_message: riskMessage,
      suggested_workflow: suggestedWorkflow
    };
  }

  buildSnapshot(product, context = {}) {
    if (!product || !product.product_id) return null;
    const persistedState = this.getProductState(product.product_id);
    const decisionLog = persistedState.decisions.map(normalizeDecision).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    const candidateArtifacts = this._buildCandidateArtifacts(product, context, persistedState);
    const createdAssets = this._buildCreatedAssets(product, context, candidateArtifacts);
    const deliveryReadiness = this._buildDeliveryReadiness(context, candidateArtifacts);
    const currentState = this._buildCurrentState(product, context, createdAssets, candidateArtifacts, deliveryReadiness, decisionLog);
    const recommendedNextMove = this._buildRecommendation(product, context, candidateArtifacts, decisionLog, deliveryReadiness);
    const openQuestions = decisionLog.filter((item) => item.status === 'open').map((item) => item.title).slice(0, 3);
    const summary = currentState.summary;

    this.saveProductState(product.product_id, {
      ...persistedState,
      last_summary: summary,
      last_recommendation: recommendedNextMove
    });

    return {
      summary,
      current_state: currentState,
      created_assets: createdAssets,
      candidate_artifacts: candidateArtifacts,
      decision_log: decisionLog,
      open_questions: openQuestions,
      recommended_next_move: recommendedNextMove,
      delivery_readiness: deliveryReadiness,
      operational_summary: this._buildOperationalSummary(product, context, currentState, candidateArtifacts, deliveryReadiness, recommendedNextMove)
    };
  }
}

let instance = null;

function getProjectCopilotService() {
  if (!instance) instance = new ProjectCopilotService();
  return instance;
}

module.exports = {
  ProjectCopilotService,
  getProjectCopilotService
};
