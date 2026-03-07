const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getKnowledgePackService } = require('./knowledge-pack-service');

const ROOT_DIR = path.join(__dirname, '..', '..');
const REGISTRY_FILE = path.join(ROOT_DIR, 'products', 'registry', 'products.json');
const HANDOFFS_FILE = path.join(ROOT_DIR, 'state', 'product-handoffs.json');

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
  { id: 'brief', label: 'Brief', relativePath: 'docs/brief.md', optional: false },
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
      stageId: session.stageId || '',
      workspaceId: session.workspaceId || '',
      workingDir: session.workingDir || '',
      updatedAt: session.updatedAt
    }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function derivePipeline(product, artifacts, relatedSessions, handoffs) {
  const artifactMap = getArtifactMap(artifacts);
  const repoExists = !!(product?.repo?.local_path && fileExists(product.repo.local_path));

  return STAGE_PRESETS.map((stage, index) => {
    const activeSession = relatedSessions.find((session) => session.stageId === stage.id && session.status === 'running');
    const relevantHandoff = handoffs
      .filter((handoff) => handoff.from_stage === stage.id || handoff.to_stage === stage.id)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0] || null;
    const artifactsComplete = stage.requiredArtifacts.every((artifactId) => artifactMap[artifactId] && artifactMap[artifactId].exists);
    const previousStagesDone = STAGE_PRESETS.slice(0, index).every((previousStage) => {
      const previousArtifactComplete = previousStage.requiredArtifacts.every((artifactId) => artifactMap[artifactId] && artifactMap[artifactId].exists);
      if (previousStage.id === 'idea') return !!(product.summary || product.name);
      if (previousStage.id === 'implementation') {
        return relatedSessions.some((session) => session.stageId === 'implementation') ||
          handoffs.some((handoff) => handoff.from_stage === 'implementation');
      }
      return previousArtifactComplete;
    });

    let status = 'not-started';
    if (stage.id === 'idea') {
      status = product.summary ? 'done' : 'ready';
    } else if (!repoExists && stage.requiredArtifacts.length) {
      status = 'blocked';
    } else if (activeSession) {
      status = 'in-progress';
    } else if (artifactsComplete) {
      status = 'done';
    } else if (stage.id === 'implementation') {
      const anyImplementation = relatedSessions.some((session) => session.stageId === 'implementation') ||
        handoffs.some((handoff) => handoff.from_stage === 'implementation');
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
      active_session_id: activeSession ? activeSession.id : '',
      active_session_name: activeSession ? activeSession.name : '',
      latest_handoff: relevantHandoff,
      artifacts_complete: artifactsComplete
    };
  });
}

function deriveNextActions(product, artifacts, pipeline, relatedSessions) {
  const nextActions = [];
  const workspaceStatus = product?.workspace?.path_status || 'unknown';
  const workspaceId = product?.workspace?.runtime_workspace_id || '';

  if (workspaceStatus === 'mismatched') {
    nextActions.push({
      action_type: 'governance',
      step_id: '',
      label: 'Review workspace mapping',
      reason: 'Current workspace points to a different repository than the product repo.',
      priority: 'high'
    });
  } else if (workspaceStatus === 'invalid') {
    nextActions.push({
      action_type: 'governance',
      step_id: '',
      label: 'Fix legacy workspace path',
      reason: 'The linked runtime workspace still points to an invalid directory.',
      priority: 'high'
    });
  } else if (!workspaceId) {
    nextActions.push({
      action_type: 'governance',
      step_id: '',
      label: 'Associate a runtime workspace',
      reason: 'This product has no linked workspace for terminal execution.',
      priority: 'medium'
    });
  }

  const runningStage = pipeline.find((step) => step.status === 'in-progress');
  if (runningStage) {
    nextActions.push({
      action_type: 'continue-stage',
      step_id: runningStage.stage_id,
      label: `Continue ${runningStage.label}`,
      reason: `A ${runningStage.label.toLowerCase()} session is already running for this product.`,
      priority: 'high'
    });
  }

  const firstReady = pipeline.find((step) => step.status === 'ready');
  if (firstReady) {
    nextActions.push({
      action_type: 'start-stage',
      step_id: firstReady.stage_id,
      label: `Start ${firstReady.label}`,
      reason: `This is the next delivery step recommended by the current artifact state.`,
      priority: 'medium'
    });
  }

  const missingCoreArtifact = artifacts.find((artifact) => !artifact.exists && !artifact.optional);
  if (missingCoreArtifact) {
    nextActions.push({
      action_type: 'artifact',
      step_id: inferStepFromArtifact(missingCoreArtifact.id),
      label: `Create ${missingCoreArtifact.label}`,
      reason: 'A core product artifact is still missing.',
      priority: 'medium'
    });
  }

  if (!relatedSessions.length) {
    nextActions.push({
      action_type: 'session',
      step_id: '',
      label: 'Create first guided session',
      reason: 'There is no session linked to this product yet.',
      priority: 'low'
    });
  }

  return nextActions.slice(0, 4);
}

function inferStepFromArtifact(artifactId) {
  if (artifactId === 'brief') return 'brief';
  if (artifactId === 'spec') return 'spec';
  if (artifactId === 'architecture') return 'architecture';
  if (artifactId === 'test-strategy') return 'test';
  if (artifactId === 'release-plan') return 'release';
  return '';
}

class ProductService {
  constructor(opts = {}) {
    this.registryFile = opts.registryFile || REGISTRY_FILE;
    this.handoffsFile = opts.handoffsFile || HANDOFFS_FILE;
    this.knowledgePackService = opts.knowledgePackService || getKnowledgePackService();
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

  getHandoffs(productId = '') {
    const data = normalizeHandoffs(readJson(this.handoffsFile, { version: 1, handoffs: [] }));
    const handoffs = productId
      ? data.handoffs.filter((handoff) => handoff.product_id === productId)
      : data.handoffs;
    return handoffs.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }

  createHandoff(productId, payload) {
    const data = normalizeHandoffs(readJson(this.handoffsFile, { version: 1, handoffs: [] }));
    const handoff = {
      handoff_id: 'handoff-' + crypto.randomBytes(4).toString('hex'),
      product_id: productId,
      from_stage: payload.from_stage || '',
      to_stage: payload.to_stage || '',
      role: payload.role || '',
      runtime_agent: payload.runtime_agent || '',
      session_id: payload.session_id || '',
      summary: payload.summary || '',
      artifact_refs: Array.isArray(payload.artifact_refs) ? payload.artifact_refs : [],
      created_at: Date.now()
    };
    data.handoffs.unshift(handoff);
    writeJsonAtomic(this.handoffsFile, data);
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
    const pipeline = derivePipeline(product, artifacts, relatedSessions, handoffs);
    const nextActions = deriveNextActions(product, artifacts, pipeline, relatedSessions);
    const linkedWorkspace = workspaces.find((workspace) => workspace.id === product?.workspace?.runtime_workspace_id) || null;
    const lastStep = getLastMeaningfulStep(pipeline);
    const currentStageId = deriveCurrentStageId(pipeline, lastStep ? lastStep.stage_id : 'idea');
    const knowledge = this.knowledgePackService.buildProductKnowledge(product, pipeline, currentStageId);

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
      next_actions: nextActions,
      related_sessions: relatedSessions.slice(0, 5),
      pipeline
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
    return {
      ...snapshot,
      artifacts,
      handoffs,
      knowledge_packs: knowledge.active_packs,
      knowledge_stage_recommendations: knowledge.stage_recommendations,
      current_stage_knowledge: knowledge.current_stage_recommendations
    };
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

  startStage(productId, stageId, payload, store) {
    const product = this.getProductById(productId);
    if (!product) return { error: 'Product not found', status: 404 };
    const stage = STAGE_PRESETS.find((item) => item.id === stageId);
    if (!stage) return { error: 'Stage not found', status: 404 };

    const workspaceId = payload.workspaceId || product?.workspace?.runtime_workspace_id || '';
    const workingDir = payload.workingDir || product?.repo?.local_path || product?.workspace?.current_working_dir || '';
    const agent = payload.runtimeAgent || stage.recommendedRuntimeAgent;
    const model = payload.model || '';
    const effort = payload.effort || '';
    const role = stage.recommendedRole;
    const sessionName = payload.name || `${product.name} - ${stage.label}`;
    const promptSeed = `${product.name} :: ${stage.label} :: ${role}`;

    const session = store.createSession({
      name: sessionName,
      workspaceId,
      agent,
      workingDir,
      model,
      effort,
      resumeSessionId: '',
      productId,
      stageId,
      role,
      promptSeed
    });

    return { session, stage, product };
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
  ARTIFACT_DEFS
};
