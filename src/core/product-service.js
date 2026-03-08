const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getKnowledgePackService } = require('./knowledge-pack-service');
const { getRunCoordinatorService, buildExpectedOutputs, classifyOutputCategory } = require('./run-coordinator-service');
const { getExecutionOrchestratorService } = require('./execution-orchestrator-service');
const { getProjectCopilotService } = require('./project-copilot-service');
const { getGitOrchestrator } = require('./git-orchestrator');

const ROOT_DIR = path.join(__dirname, '..', '..');
const REGISTRY_FILE = path.join(ROOT_DIR, 'products', 'registry', 'products.json');
const HANDOFFS_FILE = path.join(ROOT_DIR, 'state', 'product-handoffs.json');
const PRODUCT_TEMPLATE_DIR = path.join(ROOT_DIR, 'platform', 'templates', 'product-template');

const STAGE_PRESETS = [
  {
    id: 'idea',
    label: 'Idea',
    goal: 'Capture the product intent and current opportunity.',
    recommendedRole: 'product-designer',
    recommendedRuntimeAgent: 'claude',
    allowedRuntimeAgents: ['claude', 'codex', 'gemini'],
    requiredArtifacts: []
  },
  {
    id: 'brief',
    label: 'Brief',
    goal: 'Turn the idea into a problem, audience and outcome brief.',
    recommendedRole: 'product-designer',
    recommendedRuntimeAgent: 'claude',
    allowedRuntimeAgents: ['claude', 'codex', 'gemini'],
    requiredArtifacts: ['brief']
  },
  {
    id: 'spec',
    label: 'Spec',
    goal: 'Define scope, acceptance and system constraints.',
    recommendedRole: 'delivery-planner',
    recommendedRuntimeAgent: 'claude',
    allowedRuntimeAgents: ['claude', 'codex', 'gemini'],
    requiredArtifacts: ['spec']
  },
  {
    id: 'architecture',
    label: 'Architecture',
    goal: 'Establish product boundaries, design decisions and risks.',
    recommendedRole: 'principal-architect',
    recommendedRuntimeAgent: 'codex',
    allowedRuntimeAgents: ['codex', 'claude', 'gemini'],
    requiredArtifacts: ['architecture']
  },
  {
    id: 'implementation',
    label: 'Implementation',
    goal: 'Execute the scoped work with the correct repo context.',
    recommendedRole: 'implementation-agent',
    recommendedRuntimeAgent: 'codex',
    allowedRuntimeAgents: ['codex', 'claude', 'gemini'],
    requiredArtifacts: []
  },
  {
    id: 'test',
    label: 'Test',
    goal: 'Validate quality, regression risk and readiness.',
    recommendedRole: 'qa-agent',
    recommendedRuntimeAgent: 'claude',
    allowedRuntimeAgents: ['claude', 'codex', 'gemini'],
    requiredArtifacts: ['test-strategy']
  },
  {
    id: 'release',
    label: 'Release',
    goal: 'Prepare rollout, rollback and release readiness.',
    recommendedRole: 'release-agent',
    recommendedRuntimeAgent: 'claude',
    allowedRuntimeAgents: ['claude', 'codex', 'gemini'],
    requiredArtifacts: ['release-plan']
  }
];

const ARTIFACT_DEFS = [
  { id: 'manifest', label: 'Product Manifest', relativePath: '.platform/product.json', optional: false },
  { id: 'brief', label: 'Brief', relativePath: 'docs/brief.md', optional: false, alternates: ['docs/discovery'] },
  { id: 'spec', label: 'Spec', relativePath: 'docs/spec.md', optional: false },
  { id: 'architecture', label: 'Architecture', relativePath: 'ARCHITECTURE.md', optional: false, alternates: ['ADR'] },
  { id: 'runbook', label: 'Runbook', relativePath: 'docs/runbook.md', optional: false },
  { id: 'test-strategy', label: 'Test Strategy', relativePath: 'docs/test-strategy.md', optional: false },
  { id: 'release-plan', label: 'Release Plan', relativePath: 'docs/release-plan.md', optional: false }
];

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function directoryHasEntries(dirPath) {
  try {
    return fs.existsSync(dirPath) && fs.readdirSync(dirPath).length > 0;
  } catch {
    return false;
  }
}

function resolveArtifact(product, artifact) {
  const repoPath = product?.repo?.local_path || '';
  if (!repoPath) {
    return {
      id: artifact.id,
      label: artifact.label,
      path: '',
      exists: false,
      optional: artifact.optional,
      source: 'repo',
      reason: 'missing-repo-path'
    };
  }

  const primaryPath = path.join(repoPath, artifact.relativePath);
  let exists = fileExists(primaryPath);
  let matchedPath = primaryPath;

  if (!exists && Array.isArray(artifact.alternates)) {
    for (const alt of artifact.alternates) {
      const altPath = path.join(repoPath, alt);
      if (fileExists(altPath) || directoryHasEntries(altPath)) {
        exists = true;
        matchedPath = altPath;
        break;
      }
    }
  }

  return {
    id: artifact.id,
    label: artifact.label,
    path: matchedPath,
    exists,
    optional: artifact.optional,
    source: 'repo',
    updatedAt: exists ? safeMtime(matchedPath) : null
  };
}

function safeMtime(targetPath) {
  try {
    return fs.statSync(targetPath).mtimeMs;
  } catch {
    return null;
  }
}

function normalizeHandoffs(raw) {
  if (raw && Array.isArray(raw.handoffs)) return raw;
  return { version: 1, handoffs: [] };
}

function normalizePathForCompare(value) {
  return String(value || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function deriveWorkspaceLink(product, workspace) {
  const repoPath = product?.repo?.local_path || '';
  const workingDir = workspace?.workingDir || '';
  let pathStatus = 'unknown';

  if (!workspace) {
    pathStatus = 'unknown';
  } else if (!workingDir) {
    pathStatus = 'unknown';
  } else if (!fileExists(workingDir)) {
    pathStatus = 'invalid';
  } else if (repoPath && normalizePathForCompare(workingDir) === normalizePathForCompare(repoPath)) {
    pathStatus = 'valid';
  } else if (repoPath && normalizePathForCompare(workingDir) !== normalizePathForCompare(repoPath)) {
    pathStatus = 'mismatched';
  }

  return {
    runtime_workspace_id: workspace ? workspace.id : '',
    current_working_dir: workingDir,
    path_status: pathStatus
  };
}

function getArtifactMap(artifacts) {
  return artifacts.reduce((acc, artifact) => {
    acc[artifact.id] = artifact;
    return acc;
  }, {});
}

function getLastMeaningfulStep(pipeline) {
  const ranked = pipeline.filter((step) => step.status === 'done' || step.status === 'in-progress');
  return ranked[ranked.length - 1] || null;
}

function deriveCurrentStageId(pipeline, fallbackStageId = 'idea') {
  const inProgress = pipeline.find((step) => step.status === 'in-progress');
  if (inProgress) return inProgress.stage_id;
  const ready = pipeline.find((step) => step.status === 'ready');
  if (ready) return ready.stage_id;
  return fallbackStageId || 'idea';
}

function getStageKnowledge(stageRecommendations, stageId) {
  return (stageRecommendations || []).find((item) => item.stage_id === stageId) || null;
}

function getDefaultKnowledgePreset(stageRecommendations, stageId) {
  const stageKnowledge = getStageKnowledge(stageRecommendations, stageId);
  if (!stageKnowledge) return null;
  return stageKnowledge.default_preset || null;
}

function getLatestIncomingHandoff(handoffs, stageId) {
  return (handoffs || [])
    .filter((handoff) => handoff.to_stage === stageId)
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0] || null;
}

function getLatestOutgoingHandoff(handoffs, stageId) {
  return (handoffs || [])
    .filter((handoff) => handoff.from_stage === stageId)
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0] || null;
}

function hydrateHandoffRecord(handoff, run = null) {
  if (!handoff) return null;
  const expectedOutputs = Array.isArray(handoff.expected_outputs_snapshot)
    ? handoff.expected_outputs_snapshot
    : (Array.isArray(run?.expected_outputs) ? run.expected_outputs : []);
  const producedOutputs = Array.isArray(handoff.produced_outputs_snapshot)
    ? handoff.produced_outputs_snapshot
    : (Array.isArray(run?.produced_outputs) ? run.produced_outputs : []);
  const knowledgeDriver = handoff.knowledge_driver || (run?.knowledge_driver || (run?.knowledge_pack_id ? {
    knowledge_pack_id: run.knowledge_pack_id,
    knowledge_pack_name: run.knowledge_pack_name || run.knowledge_pack_id,
    preset_type: run.preset_type || '',
    preset_id: run.preset_id || '',
    preset_label: run.preset_label || run.preset_id || '',
    preset_origin: run.preset_origin || 'manual'
  } : null));

  return {
    ...handoff,
    run_id: handoff.run_id || run?.run_id || '',
    output_refs: Array.isArray(handoff.output_refs) ? handoff.output_refs : [],
    expected_outputs_snapshot: expectedOutputs,
    produced_outputs_snapshot: producedOutputs,
    knowledge_driver: knowledgeDriver
  };
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function directoryIsEmpty(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return true;
    return fs.readdirSync(dirPath).length === 0;
  } catch {
    return false;
  }
}

function readTemplate(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeFileSafely(filePath, content) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function buildManifest(product, workspaceId, timestamp) {
  return {
    version: 1,
    product_id: product.product_id,
    name: product.name,
    slug: product.slug,
    owner: product.owner,
    stage: product.stage,
    status: product.status,
    category: product.category,
    platform_template: 'standard-product-v1',
    repository: {
      local_path: product.repo.local_path,
      remote_url: '',
      default_branch: 'main'
    },
    paths: {
      spec: 'docs/spec.md',
      runbook: 'docs/runbook.md',
      test_strategy: 'docs/test-strategy.md',
      release_plan: 'docs/release-plan.md'
    },
    runtime: {
      workspace_id: workspaceId || '',
      primary_agent: 'claude'
    },
    governance: {
      has_architecture_doc: true,
      has_runbook: true,
      has_release_plan: true
    },
    timestamps: {
      created_at: timestamp,
      updated_at: timestamp
    }
  };
}

function scaffoldProductStructure(product, workspaceId) {
  const repoPath = product?.repo?.local_path || '';
  if (!repoPath) return;

  const timestamp = new Date().toISOString();
  const manifest = buildManifest(product, workspaceId, timestamp);
  const replacements = [
    ['Example Product', product.name],
    ['example-product', product.slug],
    ['owner-id', product.owner],
    ['discovery', product.stage],
    ['C:\\Projects\\example-product', product.repo.local_path],
    ['Describe the product in one short paragraph.', product.summary || 'Describe the product in one short paragraph.']
  ];

  const textWithReplacements = (filePath) => {
    let text = readTemplate(filePath);
    replacements.forEach(([from, to]) => {
      text = text.split(from).join(to);
    });
    return text;
  };

  writeFileSafely(path.join(repoPath, 'README.md'), readTemplate(path.join(PRODUCT_TEMPLATE_DIR, 'README.md')));
  writeFileSafely(path.join(repoPath, 'PRODUCT.md'), textWithReplacements(path.join(PRODUCT_TEMPLATE_DIR, 'PRODUCT.md')));
  writeFileSafely(path.join(repoPath, 'ARCHITECTURE.md'), textWithReplacements(path.join(PRODUCT_TEMPLATE_DIR, 'ARCHITECTURE.md')));
  writeFileSafely(path.join(repoPath, 'docs', 'spec.md'), textWithReplacements(path.join(PRODUCT_TEMPLATE_DIR, 'docs', 'spec.md')));
  writeFileSafely(path.join(repoPath, 'docs', 'runbook.md'), readTemplate(path.join(PRODUCT_TEMPLATE_DIR, 'docs', 'runbook.md')));
  writeFileSafely(path.join(repoPath, 'docs', 'test-strategy.md'), readTemplate(path.join(PRODUCT_TEMPLATE_DIR, 'docs', 'test-strategy.md')));
  writeFileSafely(path.join(repoPath, 'docs', 'release-plan.md'), readTemplate(path.join(PRODUCT_TEMPLATE_DIR, 'docs', 'release-plan.md')));
  writeFileSafely(path.join(repoPath, '.platform', 'product.json'), JSON.stringify(manifest, null, 2));
  ensureDirectory(path.join(repoPath, 'ADR'));
}

function enrichWithKnowledgeDriver(target, preset, opts = {}) {
  if (!preset) return target;
  return {
    ...target,
    knowledge_pack_id: preset.knowledge_pack_id || preset.preset_source_pack_id || '',
    knowledge_pack_name: preset.knowledge_pack_name || preset.knowledge_pack_id || preset.preset_source_pack_id || '',
    preset_type: preset.preset_type || '',
    preset_id: preset.preset_id || '',
    preset_label: preset.preset_label || preset.preset_id || '',
    preset_origin_stage: opts.stage_id || target.step_id || target.stage_id || '',
    preset_origin: opts.preset_origin || target.preset_origin || ''
  };
}

function buildRelatedSessions(product, sessions) {
  const workspaceId = product?.workspace?.runtime_workspace_id || '';
  return sessions
    .filter((session) => {
      if (workspaceId && session.workspaceId === workspaceId) return true;
      return session.productId === product.product_id;
    })
    .map((session) => ({
      id: session.id,
      name: session.name,
      status: session.status,
      agent: session.agent,
      model: session.model || '',
      effort: session.effort || '',
      role: session.role || '',
      runId: session.runId || '',
      stageId: session.stageId || '',
      workspaceId: session.workspaceId || '',
      workingDir: session.workingDir || '',
      updatedAt: session.updatedAt
    }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function derivePipeline(product, artifacts, relatedSessions, handoffs, runs) {
  const artifactMap = getArtifactMap(artifacts);
  const repoExists = !!(product?.repo?.local_path && fileExists(product.repo.local_path));

  return STAGE_PRESETS.map((stage, index) => {
    const activeSession = relatedSessions.find((session) => session.stageId === stage.id && session.status === 'running');
    const stageRuns = (runs || []).filter((run) => run.stage_id === stage.id);
    const activeRun = stageRuns.find((run) => run.status === 'active' || run.status === 'in-progress') || null;
    const completedRun = stageRuns.find((run) => run.status === 'completed') || null;
    const relevantHandoff = handoffs
      .filter((handoff) => handoff.from_stage === stage.id || handoff.to_stage === stage.id)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0] || null;
    const latestOutgoingHandoff = getLatestOutgoingHandoff(handoffs, stage.id);
    const latestIncomingHandoff = getLatestIncomingHandoff(handoffs, stage.id);
    const latestCompletion = latestOutgoingHandoff
      || (completedRun?.latest_completion || completedRun?.latest_handoff || null)
      || null;
    const artifactsComplete = stage.requiredArtifacts.every((artifactId) => artifactMap[artifactId] && artifactMap[artifactId].exists);
    const previousStagesDone = STAGE_PRESETS.slice(0, index).every((previousStage) => {
      const previousArtifactComplete = previousStage.requiredArtifacts.every((artifactId) => artifactMap[artifactId] && artifactMap[artifactId].exists);
      if (previousStage.id === 'idea') return !!(product.summary || product.name);
      if (previousStage.id === 'implementation') {
        return relatedSessions.some((session) => session.stageId === 'implementation') ||
          handoffs.some((handoff) => handoff.from_stage === 'implementation') ||
          (runs || []).some((run) => run.stage_id === 'implementation' && ['active', 'in-progress', 'completed'].includes(run.status));
      }
      return previousArtifactComplete ||
        handoffs.some((handoff) => handoff.from_stage === previousStage.id) ||
        (runs || []).some((run) => run.stage_id === previousStage.id && ['active', 'in-progress', 'completed'].includes(run.status));
    });

    let status = 'not-started';
    if (stage.id === 'idea') {
      status = product.summary ? 'done' : 'ready';
    } else if (!repoExists && stage.requiredArtifacts.length) {
      status = 'blocked';
    } else if (activeRun) {
      status = 'in-progress';
    } else if (latestOutgoingHandoff || completedRun) {
      status = 'done';
    } else if (activeSession) {
      status = 'in-progress';
    } else if (artifactsComplete) {
      status = 'done';
    } else if (stage.id === 'implementation') {
      const anyImplementation = relatedSessions.some((session) => session.stageId === 'implementation') ||
        handoffs.some((handoff) => handoff.from_stage === 'implementation') ||
        (runs || []).some((run) => run.stage_id === 'implementation' && ['active', 'in-progress', 'completed'].includes(run.status));
      status = anyImplementation ? 'done' : (previousStagesDone ? 'ready' : 'not-started');
    } else if (previousStagesDone) {
      status = 'ready';
    }

    return {
      stage_id: stage.id,
      label: stage.label,
      goal: stage.goal,
      recommended_role: stage.recommendedRole,
      recommended_runtime_agent: stage.recommendedRuntimeAgent,
      allowed_runtime_agents: stage.allowedRuntimeAgents,
      required_artifacts: stage.requiredArtifacts,
      status,
      active_run_id: activeRun ? activeRun.run_id : '',
      latest_run_id: (activeRun || completedRun) ? (activeRun || completedRun).run_id : '',
      active_session_id: activeSession ? activeSession.id : '',
      active_session_name: activeSession ? activeSession.name : '',
      latest_handoff: relevantHandoff,
      latest_completion: latestCompletion,
      latest_incoming_handoff: latestIncomingHandoff,
      artifacts_complete: artifactsComplete
    };
  });
}

function deriveNextActions(product, artifacts, pipeline, relatedSessions, currentRun, stageRecommendations, readiness) {
  const nextActions = [];
  const artifactMap = getArtifactMap(artifacts);

  if (currentRun && (currentRun.status === 'active' || currentRun.status === 'in-progress')) {
    const runStage = pipeline.find((step) => step.stage_id === currentRun.stage_id);
    const previousHandoff = getLatestIncomingHandoff(currentRun.incoming_handoffs || [], currentRun.stage_id) || null;
    const continuedAction = {
      id: `continue:${currentRun.run_id}`,
      action_type: 'continue-run',
      step_id: currentRun.stage_id,
      run_id: currentRun.run_id,
      label: `Continue ${currentRun.stage_label || currentRun.stage_id} run`,
      reason: 'There is an active coordinated run for this product.',
      priority: 'high'
      ,objective: currentRun.objective || (runStage ? runStage.goal : ''),
      recommended_role: currentRun.role || (runStage ? runStage.recommended_role : ''),
      recommended_runtime_agent: currentRun.suggested_runtime_agent || (runStage ? runStage.recommended_runtime_agent : ''),
      expected_outputs: currentRun.expected_outputs || [],
      uses_previous_handoff: !!previousHandoff,
      previous_handoff_id: previousHandoff ? previousHandoff.handoff_id : '',
      previous_handoff_summary: previousHandoff ? previousHandoff.summary : '',
      executable: true
    };
    nextActions.push(enrichWithKnowledgeDriver(continuedAction, currentRun.knowledge_driver || (currentRun.knowledge_pack_id ? currentRun : null) || getDefaultKnowledgePreset(stageRecommendations, currentRun.stage_id), {
      stage_id: currentRun.stage_id,
      preset_origin: currentRun.preset_origin || 'next-action'
    }));
  }

  const firstReady = pipeline.find((step) => step.status === 'ready');
  if (firstReady && (!currentRun || currentRun.stage_id !== firstReady.stage_id || (currentRun.status !== 'active' && currentRun.status !== 'in-progress'))) {
    const previousHandoff = getLatestIncomingHandoff([firstReady.latest_incoming_handoff].filter(Boolean), firstReady.stage_id) || null;
    const previousStageLabel = previousHandoff?.from_stage
      ? String(previousHandoff.from_stage).replace(/(^\w)/, (c) => c.toUpperCase())
      : '';
    const startAction = {
      id: `start:${firstReady.stage_id}`,
      action_type: 'start-run',
      step_id: firstReady.stage_id,
      label: previousStageLabel ? `Start ${firstReady.label} from ${previousStageLabel} completion` : `Start ${firstReady.label} run`,
      reason: `This is the next delivery step recommended by the current artifact state.`,
      priority: 'medium',
      objective: firstReady.goal,
      recommended_role: firstReady.recommended_role,
      recommended_runtime_agent: firstReady.recommended_runtime_agent,
      expected_outputs: buildExpectedOutputs(firstReady, artifactMap),
      uses_previous_handoff: !!previousHandoff,
      previous_handoff_id: previousHandoff ? previousHandoff.handoff_id : '',
      previous_handoff_summary: previousHandoff ? previousHandoff.summary : '',
      executable: true
    };
    nextActions.push(enrichWithKnowledgeDriver(startAction, getDefaultKnowledgePreset(stageRecommendations, firstReady.stage_id), {
      stage_id: firstReady.stage_id,
      preset_origin: 'next-action'
    }));
  }

  // Gap-driven readiness actions
  const gapCoveredArtifacts = new Set();
  if (readiness && Array.isArray(readiness.gaps)) {
    const stageOrder = ['idea', 'brief', 'spec', 'architecture', 'implementation', 'test', 'release', 'operate'];
    const advancedStages = pipeline.filter(s => s.status === 'in-progress' || s.status === 'done');
    const furthestStage = advancedStages.length ? advancedStages[advancedStages.length - 1] : null;
    const currentIdx = stageOrder.indexOf(furthestStage ? furthestStage.stage_id : 'idea');
    const implIdx = stageOrder.indexOf('implementation');
    const testIdx = stageOrder.indexOf('test');

    const signalMap = {};
    (readiness.signals || []).forEach(s => { signalMap[s.id] = s; });
    function gapPriority(signalId) {
      const s = signalMap[signalId];
      if (!s) return 'medium';
      if (s.strength === 'weak') return 'high';
      if (s.strength === 'none') return 'medium';
      return 'low';
    }

    const releasePlanGap = readiness.gaps.find(g => g.id === 'release-plan-exists');
    const runbookGap = readiness.gaps.find(g => g.id === 'runbook-exists');
    const testGap = readiness.gaps.find(g => g.id === 'test-stage-done');
    const releasePlanArtifact = artifacts.find(a => a.id === 'release-plan');

    if (releasePlanGap && currentIdx >= testIdx) {
      gapCoveredArtifacts.add('release-plan');
      nextActions.push({
        id: 'gap:release-plan',
        action_type: 'produce-output',
        step_id: 'release',
        label: 'Prepare release plan',
        reason: 'Release plan artifact is missing — needed for release readiness.',
        priority: gapPriority('release-plan-exists'),
        artifact_id: 'release-plan',
        executable: true
      });
    }

    if (runbookGap && currentIdx >= implIdx) {
      gapCoveredArtifacts.add('runbook');
      nextActions.push({
        id: 'gap:runbook',
        action_type: 'produce-output',
        step_id: 'implementation',
        label: 'Fill runbook gap',
        reason: 'Runbook artifact is missing — needed for release readiness and operations.',
        priority: gapPriority('runbook-exists'),
        artifact_id: 'runbook',
        executable: true
      });
    }

    if (testGap && currentIdx >= implIdx) {
      nextActions.push({
        id: 'gap:test-readiness',
        action_type: 'produce-output',
        step_id: 'test',
        label: 'Complete test readiness',
        reason: 'Test stage is not yet complete — needed for release readiness.',
        priority: gapPriority('test-stage-done'),
        executable: true
      });
    }

    if (releasePlanArtifact && releasePlanArtifact.exists && testGap) {
      nextActions.push({
        id: 'gap:review-release-plan',
        action_type: 'produce-output',
        step_id: 'release',
        label: 'Review release plan',
        reason: 'Release plan exists but test stage is not complete — review for alignment.',
        priority: 'low',
        executable: false
      });
    }
  }

  const missingCoreArtifact = artifacts.find((artifact) => !artifact.exists && !artifact.optional && !gapCoveredArtifacts.has(artifact.id));
  if (missingCoreArtifact) {
    const stageId = inferStepFromArtifact(missingCoreArtifact.id);
    const stage = pipeline.find((item) => item.stage_id === stageId);
    const previousHandoff = stage ? getLatestIncomingHandoff([stage.latest_incoming_handoff].filter(Boolean), stageId) : null;
    const previousStageLabel = previousHandoff?.from_stage
      ? String(previousHandoff.from_stage).replace(/(^\w)/, (c) => c.toUpperCase())
      : '';
    const artifactAction = {
      id: `artifact:${missingCoreArtifact.id}`,
      action_type: 'produce-output',
      step_id: stageId,
      label: previousStageLabel ? `Create ${missingCoreArtifact.label} from ${previousStageLabel} completion` : `Create ${missingCoreArtifact.label}`,
      reason: 'A core product artifact is still missing.',
      priority: 'medium',
      objective: stage ? `Produce ${missingCoreArtifact.label} to move ${stage.label} forward.` : `Produce ${missingCoreArtifact.label}.`,
      recommended_role: stage ? stage.recommended_role : '',
      recommended_runtime_agent: stage ? stage.recommended_runtime_agent : '',
      expected_outputs: stage ? buildExpectedOutputs(stage, artifactMap) : [],
      artifact_id: missingCoreArtifact.id,
      uses_previous_handoff: !!previousHandoff,
      previous_handoff_id: previousHandoff ? previousHandoff.handoff_id : '',
      previous_handoff_summary: previousHandoff ? previousHandoff.summary : '',
      executable: !!stage
    };
    nextActions.push(enrichWithKnowledgeDriver(artifactAction, getDefaultKnowledgePreset(stageRecommendations, stageId), {
      stage_id: stageId,
      preset_origin: 'next-action'
    }));
  }

  if (!relatedSessions.length) {
    const bootstrapAction = {
      id: 'bootstrap:idea',
      action_type: 'start-run',
      step_id: 'idea',
      label: 'Create first guided run',
      reason: 'There is no session linked to this product yet.',
      priority: 'low',
      objective: 'Create the first coordinated execution for this product.',
      recommended_role: 'product-designer',
      recommended_runtime_agent: 'claude',
      expected_outputs: [],
      executable: true
    };
    nextActions.push(enrichWithKnowledgeDriver(bootstrapAction, getDefaultKnowledgePreset(stageRecommendations, 'idea'), {
      stage_id: 'idea',
      preset_origin: 'next-action'
    }));
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return nextActions
    .filter((action, index, arr) => action.id && arr.findIndex((item) => item.id === action.id) === index)
    .sort((a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1))
    .slice(0, 4);
}

function inferStepFromArtifact(artifactId) {
  if (artifactId === 'brief') return 'brief';
  if (artifactId === 'spec') return 'spec';
  if (artifactId === 'architecture') return 'architecture';
  if (artifactId === 'test-strategy') return 'test';
  if (artifactId === 'release-plan') return 'release';
  return '';
}

function deriveReadiness(product, artifacts, pipeline, handoffs) {
  const artifactMap = {};
  (artifacts || []).forEach(a => { artifactMap[a.id] = a; });
  const pipelineMap = {};
  (pipeline || []).forEach(s => { pipelineMap[s.stage_id] = s; });
  const handoffList = Array.isArray(handoffs) ? handoffs : [];

  function stageSignalStrength(stageId) {
    const stage = pipelineMap[stageId] || {};
    if (stage.status !== 'done') return 'none';
    const stageHandoffs = handoffList.filter(h => h.from_stage === stageId);
    if (!stageHandoffs.length) return 'weak';
    const maxEvidence = Math.max(0, ...stageHandoffs.map(h => h.evidence_output_count || 0));
    if (maxEvidence >= 2) return 'strong';
    if (maxEvidence >= 1) return 'sufficient';
    return 'weak';
  }

  const signals = [];
  const implStrength = stageSignalStrength('implementation');
  signals.push({ id: 'implementation-done', label: 'Implementation stage completed', strength: implStrength, met: implStrength !== 'none', required: true });

  const testStrategyExists = !!(artifactMap['test-strategy'] && artifactMap['test-strategy'].exists);
  signals.push({ id: 'test-strategy-exists', label: 'Test strategy artifact exists', strength: testStrategyExists ? 'strong' : 'none', met: testStrategyExists, required: true });

  const testStrength = stageSignalStrength('test');
  signals.push({ id: 'test-stage-done', label: 'Test stage completed', strength: testStrength, met: testStrength !== 'none', required: true });

  const releasePlanExists = !!(artifactMap['release-plan'] && artifactMap['release-plan'].exists);
  signals.push({ id: 'release-plan-exists', label: 'Release plan artifact exists', strength: releasePlanExists ? 'strong' : 'none', met: releasePlanExists, required: true });

  const runbookExists = !!(artifactMap['runbook'] && artifactMap['runbook'].exists);
  signals.push({ id: 'runbook-exists', label: 'Runbook artifact exists', strength: runbookExists ? 'strong' : 'none', met: runbookExists, required: true });

  const requiredSignals = signals.filter(s => s.required);
  const requiredMet = requiredSignals.filter(s => s.met).length;
  const hasWeakRequired = requiredSignals.some(s => s.met && s.strength === 'weak');

  let status, label;
  if (requiredMet >= 5 && !hasWeakRequired) {
    status = 'ready-for-release-candidate';
    label = 'Ready for release candidate';
  } else if (requiredMet >= 3 || hasWeakRequired) {
    status = 'needs-evidence';
    label = 'Needs more evidence';
  } else {
    status = 'not-ready';
    label = 'Not ready';
  }

  const gaps = signals.filter(s => !s.met).map(s => ({
    id: s.id,
    label: s.label,
    severity: s.required ? 'required' : 'recommended'
  }));

  return {
    status,
    label,
    evaluated: 'on-demand',
    signals: signals.map(s => ({ id: s.id, label: s.label, met: s.met, strength: s.strength })),
    gaps,
    summary: gaps.length ? gaps.map(g => g.label).join('; ') : 'All signals met.'
  };
}

function deriveReleasePacket(readiness, currentStageId, artifacts, handoffs) {
  const sortedHandoffs = (handoffs || []).slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  const releaseCompletion = sortedHandoffs[0] || null;
  const artifactMap = {};
  (artifacts || []).forEach(a => { artifactMap[a.id] = a; });
  const keyArtifactIds = ['release-plan', 'runbook', 'test-strategy'];
  const keyArtifacts = keyArtifactIds.map(id => {
    const a = artifactMap[id];
    return { id, label: a ? a.label : id, exists: !!(a && a.exists), path: a ? (a.path || '') : '' };
  });

  const signalMap = {};
  (readiness.signals || []).forEach(s => { signalMap[s.id] = s; });

  let nextReleaseStep;
  if (!signalMap['implementation-done'] || !signalMap['implementation-done'].met) {
    nextReleaseStep = 'Complete implementation first.';
  } else if (!signalMap['test-strategy-exists'] || !signalMap['test-strategy-exists'].met) {
    nextReleaseStep = 'Create the test strategy artifact.';
  } else if (!signalMap['test-stage-done'] || !signalMap['test-stage-done'].met) {
    nextReleaseStep = 'Complete the test stage.';
  } else if (!signalMap['release-plan-exists'] || !signalMap['release-plan-exists'].met) {
    nextReleaseStep = 'Create the release plan artifact.';
  } else if (!signalMap['runbook-exists'] || !signalMap['runbook-exists'].met) {
    nextReleaseStep = 'Create the runbook artifact.';
  } else {
    nextReleaseStep = 'Product is ready for release candidate review.';
  }

  return {
    current_stage: currentStageId || '',
    readiness_status: readiness.status,
    latest_completion: releaseCompletion,
    key_artifacts: keyArtifacts,
    open_gaps: readiness.gaps,
    next_release_step: nextReleaseStep
  };
}

function deriveOperateLite(artifacts, pipeline, readiness, handoffs) {
  const artifactMap = {};
  (artifacts || []).forEach(a => { artifactMap[a.id] = a; });
  const runbook = artifactMap['runbook'];
  const runbookExists = !!(runbook && runbook.exists);

  const handoffList = Array.isArray(handoffs) ? handoffs : [];
  const totalEvidenceOutputs = handoffList.reduce((sum, h) => sum + (h.evidence_output_count || 0), 0);

  let nextAction;
  if (readiness.status === 'ready-for-release-candidate') {
    nextAction = runbookExists ? 'Review runbook and prepare for go-live.' : 'Create the runbook before go-live.';
  } else if (readiness.status === 'needs-evidence') {
    nextAction = 'Address remaining readiness gaps before considering operations.';
  } else {
    nextAction = 'Product is not yet ready for operational planning.';
  }

  return {
    runbook_status: runbookExists ? 'present' : 'missing',
    runbook_path: runbook ? (runbook.path || '') : '',
    last_readiness_check: null,
    operational_notes: '',
    next_post_release_action: nextAction,
    evidence_summary: {
      total_handoffs: handoffList.length,
      total_evidence_outputs: totalEvidenceOutputs
    }
  };
}

function buildGuidedPrompt(product, stage, run, expectedOutputs = [], previousHandoff = null) {
  const outputLabels = (expectedOutputs || [])
    .map((item) => item.label || item.ref_id || item.output_id)
    .filter(Boolean);
  const knowledgeDriver = run?.knowledge_driver || (run?.knowledge_pack_id ? {
    knowledge_pack_name: run.knowledge_pack_name || run.knowledge_pack_id,
    knowledge_pack_id: run.knowledge_pack_id,
    preset_type: run.preset_type,
    preset_id: run.preset_id,
    preset_label: run.preset_label || run.preset_id
  } : null);

  return [
    `Product: ${product.name}`,
    product.summary ? `Summary: ${product.summary}` : '',
    `Run: ${run.run_id}`,
    `Stage: ${stage.label} (${stage.stage_id})`,
    `Role: ${run.role || stage.recommended_role || ''}`,
    `Objective: ${run.objective || stage.goal || ''}`,
    knowledgeDriver ? `Knowledge Pack: ${knowledgeDriver.knowledge_pack_name} (${knowledgeDriver.knowledge_pack_id})` : '',
    knowledgeDriver ? `Knowledge Preset: ${knowledgeDriver.preset_type} ${knowledgeDriver.preset_label || knowledgeDriver.preset_id}` : '',
    previousHandoff ? `Previous handoff from: ${previousHandoff.from_stage || 'unknown'} -> ${previousHandoff.to_stage || stage.stage_id}` : '',
    previousHandoff ? `Handoff summary: ${previousHandoff.summary || ''}` : '',
    previousHandoff && Array.isArray(previousHandoff.output_refs) && previousHandoff.output_refs.length ? `Referenced outputs: ${previousHandoff.output_refs.join(', ')}` : '',
    outputLabels.length ? `Expected outputs: ${outputLabels.join(', ')}` : '',
    '',
    'Work inside the current repository/runtime workspace context.',
    'Advance only this stage.',
    knowledgeDriver ? 'Use the referenced knowledge preset as operational guidance for this execution.' : '',
    previousHandoff ? 'Use the previous stage handoff as the continuity baseline for this execution.' : '',
    'When finished, leave a concise handoff-ready summary of what was produced, what remains, and the next recommended step.'
  ].filter(Boolean).join('\n');
}

class ProductService {
  constructor(opts = {}) {
    this.registryFile = opts.registryFile || REGISTRY_FILE;
    this.handoffsFile = opts.handoffsFile || HANDOFFS_FILE;
    this.knowledgePackService = opts.knowledgePackService || getKnowledgePackService();
    this.runCoordinatorService = opts.runCoordinatorService || getRunCoordinatorService();
    this.orchestratorService = opts.orchestratorService || getExecutionOrchestratorService();
    this.projectCopilotService = opts.projectCopilotService || getProjectCopilotService();
    this.gitOrchestrator = opts.gitOrchestrator || getGitOrchestrator();
  }

  getRegistry() {
    const data = readJson(this.registryFile, { version: 1, products: [] });
    return Array.isArray(data.products) ? data : { version: 1, products: [] };
  }

  getProductById(productId) {
    return this.getRegistry().products.find((product) => product.product_id === productId) || null;
  }

  getProductByWorkspaceId(workspaceId) {
    if (!workspaceId) return null;
    return this.getRegistry().products.find((product) => {
      return product?.workspace?.runtime_workspace_id === workspaceId;
    }) || null;
  }

  resolveWorkingDirectory(workspaceId, preferredPath = '') {
    if (preferredPath && fileExists(preferredPath)) return preferredPath;

    const product = this.getProductByWorkspaceId(workspaceId);
    const repoPath = product?.repo?.local_path || '';
    if (repoPath && fileExists(repoPath)) return repoPath;

    const workspacePath = product?.workspace?.current_working_dir || '';
    if (workspacePath && fileExists(workspacePath)) return workspacePath;

    return preferredPath || workspacePath || repoPath || '';
  }

  updateProductWorkspace(productId, workspace, opts = {}) {
    const registry = this.getRegistry();
    const product = registry.products.find((item) => item.product_id === productId);
    if (!product) return null;

    product.workspace = deriveWorkspaceLink(product, workspace);
    if (!product.timestamps) product.timestamps = {};
    product.timestamps.updated_at = new Date().toISOString();

    if (!product.governance) product.governance = {};
    if (!Array.isArray(product.governance.notes)) product.governance.notes = [];

    const note = workspace
      ? `Workspace link updated to ${workspace.name} (${workspace.id})`
      : 'Workspace link cleared manually';
    if (!product.governance.notes.includes(note)) {
      product.governance.notes.unshift(note);
      product.governance.notes = product.governance.notes.slice(0, 10);
    }

    if (opts.generatedAt !== false) {
      registry.generated_at = new Date().toISOString();
    }
    writeJsonAtomic(this.registryFile, registry);
    return product;
  }

  createProduct(payload, store) {
    const registry = this.getRegistry();
    const timestamp = new Date().toISOString();
    const name = String(payload.name || '').trim();
    const owner = String(payload.owner || '').trim();
    const category = String(payload.category || 'product').trim() || 'product';
    const stage = STAGE_PRESETS.some((item) => item.id === payload.stage) ? payload.stage : 'brief';
    const summary = String(payload.summary || '').trim();
    const slug = slugify(payload.slug || payload.product_id || name);
    const productId = slugify(payload.product_id || slug);
    const repoPath = String(payload?.repo?.local_path || payload.local_path || '').trim();
    const createRuntimeWorkspace = payload.workspace_mode === 'create';
    const existingWorkspaceId = payload.workspace_mode === 'existing' ? String(payload.workspace_id || '').trim() : '';
    const createDirectory = payload.create_directory === true;
    const createMinimalStructure = payload.create_minimal_structure === true;
    const enablePmSkills = payload.enable_pm_skills !== false && category === 'product';

    if (!name) return { error: 'Product name is required', status: 400 };
    if (!owner) return { error: 'Owner is required', status: 400 };
    if (!productId) return { error: 'product_id is required', status: 400 };
    if (!repoPath) return { error: 'repo.local_path is required', status: 400 };
    if (registry.products.some((item) => item.product_id === productId || item.slug === slug)) {
      return { error: 'Product id or slug already exists', status: 409 };
    }

    const repoExists = fs.existsSync(repoPath);
    if (!repoExists && !(createDirectory || createMinimalStructure)) {
      return { error: 'Directory does not exist. Choose create directory or select an existing path.', status: 400 };
    }
    if (repoExists && createDirectory && !directoryIsEmpty(repoPath)) {
      return { error: 'Target directory already exists and is not empty.', status: 409 };
    }
    if (createMinimalStructure && repoExists && !directoryIsEmpty(repoPath)) {
      return { error: 'Cannot scaffold into a non-empty directory.', status: 409 };
    }

    let linkedWorkspace = null;
    if (existingWorkspaceId) {
      linkedWorkspace = store?.getWorkspace ? store.getWorkspace(existingWorkspaceId) : null;
      if (!linkedWorkspace) return { error: 'Selected runtime workspace was not found', status: 400 };
    }

    if (!repoExists && (createDirectory || createMinimalStructure)) {
      ensureDirectory(repoPath);
    }

    if (createRuntimeWorkspace) {
      const workspaceName = String(payload.workspace_name || `${name} Runtime`).trim() || `${name} Runtime`;
      const workspaceDescription = String(payload.workspace_description || '').trim();
      linkedWorkspace = store?.createWorkspace
        ? store.createWorkspace({
            name: workspaceName,
            description: workspaceDescription,
            workingDir: repoPath
          })
        : null;
    }

    const product = {
      product_id: productId,
      name,
      slug,
      status: 'active',
      stage,
      owner,
      category,
      summary,
      repo: {
        mode: 'local',
        local_path: repoPath,
        remote_url: '',
        default_branch: 'main'
      },
      workspace: deriveWorkspaceLink({
        repo: { local_path: repoPath },
        workspace: {}
      }, linkedWorkspace),
      platform: {
        template: 'standard-product-v1',
        manifest_path: createMinimalStructure ? '.platform/product.json' : '',
        runbook_path: createMinimalStructure ? 'docs/runbook.md' : '',
        spec_path: createMinimalStructure ? 'docs/spec.md' : ''
      },
      governance: {
        source_of_truth: 'registry',
        decision_status: 'created-via-ui',
        notes: []
      },
      timestamps: {
        created_at: timestamp,
        updated_at: timestamp
      }
    };

    if (createMinimalStructure) {
      scaffoldProductStructure(product, linkedWorkspace?.id || existingWorkspaceId || '');
    }

    registry.generated_at = timestamp;
    registry.products.push(product);
    writeJsonAtomic(this.registryFile, registry);

    if (enablePmSkills && this.knowledgePackService.getPackById('pm-skills')) {
      this.knowledgePackService.upsertBinding({
        product_id: productId,
        knowledge_pack_id: 'pm-skills',
        enabled: true,
        notes: 'Enabled by native onboarding.'
      });
    }

    return {
      product,
      workspace: linkedWorkspace || null,
      created_structure: createMinimalStructure,
      created_directory: !repoExists && (createDirectory || createMinimalStructure),
      knowledge_pack_ids: enablePmSkills ? ['pm-skills'] : []
    };
  }

  getHandoffs(productId = '') {
    const data = normalizeHandoffs(readJson(this.handoffsFile, { version: 1, handoffs: [] }));
    const handoffs = productId
      ? data.handoffs.filter((handoff) => handoff.product_id === productId)
      : data.handoffs;
    const runsById = this.runCoordinatorService.listRuns(productId).reduce((acc, run) => {
      acc[run.run_id] = run;
      return acc;
    }, {});
    return handoffs
      .map((handoff) => hydrateHandoffRecord(handoff, runsById[handoff.run_id] || null))
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }

  async createHandoff(productId, payload) {
    const data = normalizeHandoffs(readJson(this.handoffsFile, { version: 1, handoffs: [] }));
    const product = this.getProductById(productId);
    const explicitRunId = payload.run_id || '';
    const currentRun = explicitRunId
      ? this.runCoordinatorService.getRunById(explicitRunId)
      : this.runCoordinatorService.getCurrentRun(productId);
    const linkedRun = currentRun && currentRun.stage_id === (payload.from_stage || '') ? currentRun : null;
    const artifacts = product ? this.getArtifacts(productId) || [] : [];
    const pipeline = product ? derivePipeline(product, artifacts, [], data.handoffs, this.runCoordinatorService.listRuns(productId)) : [];
    const runSnapshot = linkedRun
      ? this.runCoordinatorService.hydrateRun(linkedRun, {
        sessions: [],
        handoffs: data.handoffs,
        pipeline,
        artifacts
      })
      : null;
    const knowledgeDriver = runSnapshot?.knowledge_driver || (linkedRun && linkedRun.knowledge_pack_id ? {
      knowledge_pack_id: linkedRun.knowledge_pack_id,
      knowledge_pack_name: linkedRun.knowledge_pack_name || linkedRun.knowledge_pack_id,
      preset_type: linkedRun.preset_type || '',
      preset_id: linkedRun.preset_id || '',
      preset_label: linkedRun.preset_label || linkedRun.preset_id || '',
      preset_origin: linkedRun.preset_origin || 'manual'
    } : null);
    const producedSnapshot = Array.isArray(runSnapshot?.produced_outputs) ? runSnapshot.produced_outputs : (Array.isArray(linkedRun?.produced_outputs) ? linkedRun.produced_outputs : []);
    const evidenceOutputCount = producedSnapshot.filter(item => classifyOutputCategory(item.type) === 'evidence').length;
    const handoff = {
      handoff_id: 'handoff-' + crypto.randomBytes(4).toString('hex'),
      product_id: productId,
      run_id: linkedRun ? linkedRun.run_id : explicitRunId,
      from_stage: payload.from_stage || '',
      to_stage: payload.to_stage || '',
      role: payload.role || '',
      runtime_agent: payload.runtime_agent || '',
      session_id: payload.session_id || '',
      summary: payload.summary || '',
      artifact_refs: Array.isArray(payload.artifact_refs) ? payload.artifact_refs : [],
      output_refs: Array.isArray(payload.output_refs) ? payload.output_refs : [],
      expected_outputs_snapshot: Array.isArray(runSnapshot?.expected_outputs) ? runSnapshot.expected_outputs : (Array.isArray(linkedRun?.expected_outputs) ? linkedRun.expected_outputs : []),
      produced_outputs_snapshot: Array.isArray(runSnapshot?.produced_outputs) ? runSnapshot.produced_outputs : (Array.isArray(linkedRun?.produced_outputs) ? linkedRun.produced_outputs : []),
      knowledge_driver: knowledgeDriver,
      created_at: Date.now(),
      evidence_output_count: evidenceOutputCount
    };
    const workingDir = payload.workingDir || product?.repo?.local_path || product?.workspace?.current_working_dir || '';
    if (workingDir) {
      const isRepo = await this.gitOrchestrator.isRepo(workingDir);
      if (isRepo) {
        try {
          const baselineHash = await this.gitOrchestrator.commitAll(workingDir, `[vibe-baseline] Stage Completed: ${payload.to_stage || payload.from_stage || 'Unknown'}`);
          if (baselineHash) handoff.baseline_hash = baselineHash;
        } catch (e) {
          console.error('[Milestone 4A] Failed to create Stage Baseline:', e);
        }
      }
    }

    data.handoffs.unshift(handoff);
    writeJsonAtomic(this.handoffsFile, data);

    if (handoff.run_id) {
      this.runCoordinatorService.linkHandoff(handoff.run_id, handoff);
    }

    return handoff;
  }

  getArtifacts(productId) {
    const product = this.getProductById(productId);
    if (!product) return null;
    return ARTIFACT_DEFS.map((artifact) => resolveArtifact(product, artifact));
  }

  buildProductSnapshot(product, workspaces, sessions) {
    const artifacts = ARTIFACT_DEFS.map((artifact) => resolveArtifact(product, artifact));
    const relatedSessions = buildRelatedSessions(product, sessions);
    const handoffs = this.getHandoffs(product.product_id);
    const rawRuns = this.runCoordinatorService.listRuns(product.product_id);
    const pipeline = derivePipeline(product, artifacts, relatedSessions, handoffs, rawRuns);
    const linkedWorkspace = workspaces.find((workspace) => workspace.id === product?.workspace?.runtime_workspace_id) || null;
    const lastStep = getLastMeaningfulStep(pipeline);
    const currentStageId = deriveCurrentStageId(pipeline, lastStep ? lastStep.stage_id : 'idea');
    const knowledge = this.knowledgePackService.buildProductKnowledge(product, pipeline, currentStageId);
    const runContext = { sessions: relatedSessions, handoffs, pipeline, artifacts };
    const currentRun = this.runCoordinatorService.getHydratedCurrentRun(product.product_id, runContext);
    const recentRuns = this.runCoordinatorService.getHydratedRuns(product.product_id, runContext).slice(0, 5);
    const readiness = deriveReadiness(product, artifacts, pipeline, handoffs);
    const releasePacket = deriveReleasePacket(readiness, currentStageId, artifacts, handoffs);
    const operateLite = deriveOperateLite(artifacts, pipeline, readiness, handoffs);
    const nextActions = deriveNextActions(product, artifacts, pipeline, relatedSessions, currentRun, knowledge.stage_recommendations || [], readiness);

    // Milestone 3A: Derive transition gate and evidence report for current run
    let transitionGateStatus = 'no-contract';
    let evidenceReport = null;
    if (currentRun) {
      transitionGateStatus = this.orchestratorService.getTransitionGateStatus(
        currentRun,
        product,
        currentRun.execution_envelope_path || ''
      );
      evidenceReport = this.orchestratorService.loadEvidenceReport(
        currentRun.execution_envelope_path || ''
      );
    }

    return {
      product_id: product.product_id,
      name: product.name,
      slug: product.slug,
      status: product.status,
      category: product.category,
      owner: product.owner,
      summary: product.summary,
      declared_stage: product.stage,
      computed_stage_signal: lastStep ? lastStep.stage_id : 'idea',
      repo: product.repo,
      workspace: {
        ...product.workspace,
        linked_workspace_name: linkedWorkspace ? linkedWorkspace.name : ''
      },
      platform: product.platform,
      governance: product.governance,
      current_stage_id: currentStageId,
      artifact_summary: {
        total: artifacts.length,
        present: artifacts.filter((artifact) => artifact.exists).length,
        missing: artifacts.filter((artifact) => !artifact.exists).length
      },
      knowledge_summary: knowledge.summary,
      active_knowledge_packs: knowledge.active_packs,
      current_run: currentRun,
      recent_runs: recentRuns,
      handoff_summary: {
        total: handoffs.length,
        latest_handoff_id: handoffs[0]?.handoff_id || '',
        latest_handoff_stage: handoffs[0]?.to_stage || handoffs[0]?.from_stage || ''
      },
      latest_handoff: handoffs[0] || null,
      latest_completion: handoffs[0] || null,
      readiness,
      release_packet: releasePacket,
      operate_lite: operateLite,
      next_actions: nextActions,
      related_sessions: relatedSessions.slice(0, 5),
      pipeline,
      // Milestone 3A
      transition_gate_status: transitionGateStatus,
      evidence_report: evidenceReport
    };
  }

  getProducts(workspaces, sessions) {
    return this.getRegistry().products.map((product) => this.buildProductSnapshot(product, workspaces, sessions));
  }

  getProductDetail(productId, workspaces, sessions) {
    const product = this.getProductById(productId);
    if (!product) return null;
    const snapshot = this.buildProductSnapshot(product, workspaces, sessions);
    const artifacts = this.getArtifacts(productId) || [];
    const handoffs = this.getHandoffs(productId);
    const knowledge = this.knowledgePackService.buildProductKnowledge(product, snapshot.pipeline, snapshot.current_stage_id);
    const copilot = this.projectCopilotService.buildSnapshot(product, {
      ...snapshot,
      artifacts,
      handoffs,
      current_stage_knowledge: knowledge.current_stage_recommendations || [],
      knowledge_stage_recommendations: knowledge.stage_recommendations || []
    });
    return {
      ...snapshot,
      artifacts,
      handoffs,
      knowledge_packs: knowledge.active_packs,
      knowledge_stage_recommendations: knowledge.stage_recommendations,
      current_stage_knowledge: knowledge.current_stage_recommendations,
      runs: snapshot.recent_runs || [],
      current_run: snapshot.current_run || null,
      copilot
    };
  }

  reviewCopilotCandidate(productId, candidateId, accepted, workspaces, sessions) {
    const product = this.getProductById(productId);
    if (!product) return { error: 'Product not found', status: 404 };
    this.projectCopilotService.reviewCandidate(productId, candidateId, accepted);
    return this.getProductDetail(productId, workspaces, sessions);
  }

  addCopilotDecision(productId, payload, workspaces, sessions) {
    const product = this.getProductById(productId);
    if (!product) return { error: 'Product not found', status: 404 };
    try {
      this.projectCopilotService.addDecision(productId, payload);
    } catch (e) {
      return { error: e.message, status: 400 };
    }
    return this.getProductDetail(productId, workspaces, sessions);
  }

  updateCopilotDecision(productId, decisionId, payload, workspaces, sessions) {
    const product = this.getProductById(productId);
    if (!product) return { error: 'Product not found', status: 404 };
    const updated = this.projectCopilotService.updateDecision(productId, decisionId, payload);
    if (!updated) return { error: 'Decision not found', status: 404 };
    return this.getProductDetail(productId, workspaces, sessions);
  }

  getPipeline(productId, workspaces, sessions) {
    const detail = this.getProductDetail(productId, workspaces, sessions);
    return detail ? detail.pipeline : null;
  }

  getStagePresets() {
    return STAGE_PRESETS;
  }

  getKnowledge(productId, workspaces, sessions) {
    const detail = this.getProductDetail(productId, workspaces, sessions);
    if (!detail) return null;
    return {
      product_id: detail.product_id,
      active_packs: detail.knowledge_packs || [],
      stage_recommendations: detail.knowledge_stage_recommendations || [],
      current_stage_id: detail.current_stage_id || '',
      current_stage_recommendations: detail.current_stage_knowledge || []
    };
  }

  getRuns(productId, workspaces, sessions) {
    const detail = this.getProductDetail(productId, workspaces, sessions);
    return detail ? (detail.runs || []) : null;
  }

  getCurrentRun(productId, workspaces, sessions) {
    const detail = this.getProductDetail(productId, workspaces, sessions);
    return detail ? (detail.current_run || null) : null;
  }

  async startStage(productId, stageId, payload, store) {
    const product = this.getProductById(productId);
    if (!product) return { error: 'Product not found', status: 404 };
    const stage = STAGE_PRESETS.find((item) => item.id === stageId);
    if (!stage) return { error: 'Stage not found', status: 404 };
    const stageHandoffs = this.getHandoffs(productId);
    const latestIncomingHandoff = (payload.previous_handoff_id
      ? stageHandoffs.find((handoff) => handoff.handoff_id === payload.previous_handoff_id)
      : null) || getLatestIncomingHandoff(stageHandoffs, stageId);

    const workspaceId = payload.workspaceId || product?.workspace?.runtime_workspace_id || '';
    const workingDir = payload.workingDir || product?.repo?.local_path || product?.workspace?.current_working_dir || '';
    
    let preRunHash = '';
    if (workingDir) {
      const isRepo = await this.gitOrchestrator.isRepo(workingDir);
      if (isRepo) {
        const isDirty = await this.gitOrchestrator.isDirty(workingDir);
        if (isDirty) {
          return { error: 'Working directory has uncommitted changes. Please commit or stash them before starting an AI run to ensure a safe checkpoint.', status: 400 };
        }
        try {
          preRunHash = await this.gitOrchestrator.commitAll(workingDir, `[vibe-chkpt] Pre-Run Checkpoint for ${stageId}`);
        } catch (e) {
          console.error('[Milestone 4A] Failed to create Pre-Run Checkpoint:', e);
        }
      }
    }

    const agent = payload.runtimeAgent || stage.recommendedRuntimeAgent;
    const model = payload.model || '';
    const effort = payload.effort || '';
    const role = stage.recommendedRole;
    const sessionName = payload.name || `${product.name} - ${stage.label}`;
    const stageForRun = {
      stage_id: stage.id,
      label: stage.label,
      goal: payload.objective || stage.goal,
      recommended_role: role,
      recommended_runtime_agent: agent,
      required_artifacts: stage.requiredArtifacts
    };
    const artifacts = this.getArtifacts(productId) || [];
    const artifactMap = getArtifactMap(artifacts);
    const knowledge = this.knowledgePackService.buildProductKnowledge(product, [{ ...stageForRun, status: 'ready' }], stageId);
    const selectedPreset = payload.preset_id
      ? {
          knowledge_pack_id: payload.knowledge_pack_id || payload.preset_source_pack_id || '',
          knowledge_pack_name: payload.knowledge_pack_name || payload.knowledge_pack_id || payload.preset_source_pack_id || '',
          preset_type: payload.preset_type || '',
          preset_id: payload.preset_id || '',
          preset_label: payload.preset_label || payload.preset_id || ''
        }
      : getDefaultKnowledgePreset(knowledge.stage_recommendations || [], stageId);
    const run = this.runCoordinatorService.createOrReuseRun(product, stageForRun, {
      objective: payload.objective || stage.goal,
      role,
      suggested_runtime_agent: agent,
      workspace_id: workspaceId,
      expected_outputs: buildExpectedOutputs(stageForRun, artifactMap),
      action_label: payload.actionLabel || `Start ${stage.label} run`,
      knowledge_pack_id: selectedPreset?.knowledge_pack_id || '',
      knowledge_pack_name: selectedPreset?.knowledge_pack_name || '',
      preset_type: selectedPreset?.preset_type || '',
      preset_id: selectedPreset?.preset_id || '',
      preset_label: selectedPreset?.preset_label || '',
      preset_origin: payload.presetOrigin || 'guided-stage'
    });
    const promptSeed = buildGuidedPrompt(product, stageForRun, run, run.expected_outputs || [], latestIncomingHandoff);

    // Milestone 3A: Generate execution envelope and determine launch strategy
    const envelopeResult = this.orchestratorService.generateEnvelope(run, product, stageForRun, {
      previousHandoff: latestIncomingHandoff || null
    });
    const launchStrategyResult = this.orchestratorService.getLaunchStrategy(agent, envelopeResult.envelopePath || '');

    // Persist envelope path and contract into the run record
    if (envelopeResult.envelopePath) {
      const contract = this.orchestratorService.getContractForStage(stage.id);
      const outputContract = this.orchestratorService.getOutputContractForStage(stage.id);
      const runsData = this.runCoordinatorService.getStore();
      const runRecord = runsData.runs.find(r => r.run_id === run.run_id);
      if (runRecord) {
        runRecord.execution_envelope_path = envelopeResult.envelopePath;
        runRecord.execution_contract = contract || null;
        runRecord.output_contract = outputContract || null;
        runRecord.launch_strategy = launchStrategyResult.strategy;
        if (preRunHash) runRecord.pre_run_hash = preRunHash;
        writeJsonAtomic(this.runCoordinatorService.runsFile, runsData);
      }
    }

    const session = store.createSession({
      name: sessionName,
      workspaceId,
      agent,
      workingDir,
      model,
      effort,
      resumeSessionId: '',
      productId,
      runId: run.run_id,
      stageId,
      role,
      promptSeed,
      // Milestone 3A: launch strategy and envelope path for PtyManager
      launchStrategy: launchStrategyResult.strategy,
      executionEnvelopePath: envelopeResult.envelopePath || '',
      knowledgePackId: selectedPreset?.knowledge_pack_id || '',
      knowledgePackName: selectedPreset?.knowledge_pack_name || '',
      presetType: selectedPreset?.preset_type || '',
      presetId: selectedPreset?.preset_id || '',
      presetLabel: selectedPreset?.preset_label || ''
    });
    this.runCoordinatorService.attachSession(run.run_id, session);

    return { session, stage: stageForRun, product, run, previous_handoff: latestIncomingHandoff || null, execution_envelope: envelopeResult.envelopePath ? envelopeResult : null };
  }

  async executeNextAction(productId, actionId, payload, store, workspaces, sessions) {
    const detail = this.getProductDetail(productId, workspaces, sessions);
    if (!detail) return { error: 'Product not found', status: 404 };

    const action = (detail.next_actions || []).find((item) => item.id === actionId);
    if (!action) return { error: 'Action not found', status: 404 };
    if (!action.executable || !action.step_id) return { error: 'Action is not executable', status: 400 };

    if (action.run_id) {
      const currentRun = detail.current_run;
      if (currentRun && currentRun.run_id === action.run_id) {
        const currentSession = (currentRun.linked_sessions || [])[0] || null;
        if (currentSession) {
          const updatedRun = this.runCoordinatorService.createOrReuseRun(detail, {
            stage_id: currentRun.stage_id,
            label: currentRun.stage_label,
            goal: currentRun.objective,
            recommended_role: currentRun.role,
            recommended_runtime_agent: currentRun.suggested_runtime_agent,
            required_artifacts: (detail.pipeline || []).find((stage) => stage.stage_id === currentRun.stage_id)?.required_artifacts || []
          }, {
            objective: currentRun.objective,
            role: currentRun.role,
            suggested_runtime_agent: currentRun.suggested_runtime_agent,
            workspace_id: currentRun.workspace_id,
            expected_outputs: currentRun.expected_outputs,
            action_label: action.label,
            knowledge_pack_id: action.knowledge_pack_id || currentRun.knowledge_pack_id || '',
            knowledge_pack_name: action.knowledge_pack_name || currentRun.knowledge_pack_name || '',
            preset_type: action.preset_type || currentRun.preset_type || '',
            preset_id: action.preset_id || currentRun.preset_id || '',
            preset_label: action.preset_label || currentRun.preset_label || '',
            preset_origin: action.preset_origin || currentRun.preset_origin || 'next-action'
          });
          return {
            action,
            product: detail,
            run: updatedRun,
            session: currentSession,
            reused: true
          };
        }
      }
    }

    const runtimeAgent = payload.runtimeAgent || action.recommended_runtime_agent || '';
    const name = payload.name || `${detail.name} - ${action.step_id} run`;
    const result = await this.startStage(productId, action.step_id, {
      ...payload,
      runtimeAgent,
      objective: action.objective || '',
      actionLabel: action.label,
      name,
      knowledge_pack_id: action.knowledge_pack_id || '',
      knowledge_pack_name: action.knowledge_pack_name || '',
      preset_type: action.preset_type || '',
      preset_id: action.preset_id || '',
      preset_label: action.preset_label || '',
      presetOrigin: 'next-action'
    }, store);

    if (result.error) return result;
    return {
      action,
      ...result,
      reused: false
    };
  }
}

let instance = null;

function getProductService() {
  if (!instance) instance = new ProductService();
  return instance;
}

module.exports = {
  ProductService,
  getProductService,
  STAGE_PRESETS,
  ARTIFACT_DEFS,
  deriveReadiness
};
