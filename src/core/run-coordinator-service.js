const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.join(__dirname, '..', '..');
const RUNS_FILE = path.join(ROOT_DIR, 'state', 'product-runs.json');

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

function normalizeRuns(raw) {
  return raw && Array.isArray(raw.runs) ? raw : { version: 1, runs: [] };
}

function dedupe(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function compareLinkedSessions(a, b) {
  const orderA = Number.isFinite(Number(a?.displayOrder)) ? Number(a.displayOrder) : Number.MAX_SAFE_INTEGER;
  const orderB = Number.isFinite(Number(b?.displayOrder)) ? Number(b.displayOrder) : Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  const updatedA = Number(a?.updatedAt || 0);
  const updatedB = Number(b?.updatedAt || 0);
  if (updatedA !== updatedB) return updatedB - updatedA;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

function buildKnowledgeDriver(payload = {}) {
  if (!payload.knowledge_pack_id || !payload.preset_type || !payload.preset_id) return null;
  return {
    knowledge_pack_id: payload.knowledge_pack_id,
    knowledge_pack_name: payload.knowledge_pack_name || payload.knowledge_pack_id,
    preset_type: payload.preset_type,
    preset_id: payload.preset_id,
    preset_label: payload.preset_label || payload.preset_id,
    preset_origin: payload.preset_origin || 'manual'
  };
}

function ensureKnowledgeDriverOutput(run, driver, now) {
  if (!driver) return;
  const produced = Array.isArray(run.produced_outputs) ? run.produced_outputs : [];
  const outputId = `knowledge:${driver.knowledge_pack_id}:${driver.preset_type}:${driver.preset_id}`;
  if (!produced.some((item) => item.output_id === outputId)) {
    produced.unshift({
      output_id: outputId,
      type: 'knowledge-driver',
      ref_id: driver.preset_id,
      label: `${driver.knowledge_pack_name} · ${driver.preset_type} ${driver.preset_label}`,
      knowledge_pack_id: driver.knowledge_pack_id,
      preset_type: driver.preset_type,
      preset_id: driver.preset_id,
      created_at: now
    });
  }
  run.produced_outputs = produced;
}

function buildExpectedOutputs(stage, artifactMap = {}) {
  const outputs = [];
  for (const artifactId of stage?.required_artifacts || []) {
    const artifact = artifactMap[artifactId];
    outputs.push({
      output_id: `artifact:${artifactId}`,
      type: 'artifact',
      ref_id: artifactId,
      label: artifact ? artifact.label : artifactId,
      required: true
    });
  }
  outputs.push({
    output_id: `session:${stage?.stage_id || 'unknown'}`,
    type: 'session',
    ref_id: '',
    label: 'Linked execution session',
    required: true
  });
  if (stage?.stage_id && stage.stage_id !== 'idea') {
    outputs.push({
      output_id: `handoff:${stage.stage_id}`,
      type: 'handoff',
      ref_id: '',
      label: 'Stage handoff or outcome summary',
      required: false
    });
  }
  return outputs;
}

function normalizeOutputRecord(item) {
  if (!item || typeof item !== 'object') {
    const value = String(item || '');
    return {
      output_id: value,
      type: '',
      ref_id: value,
      label: value,
      required: false,
      created_at: 0
    };
  }
  return {
    output_id: item.output_id || item.id || '',
    type: item.type || '',
    ref_id: item.ref_id || '',
    label: item.label || item.ref_id || item.output_id || 'Output',
    required: !!item.required,
    created_at: item.created_at || 0
  };
}

function buildCompletionSummary(expectedOutputs, producedOutputs) {
  const expected = (expectedOutputs || []).map(normalizeOutputRecord);
  const produced = (producedOutputs || []).map(normalizeOutputRecord);
  const producedKeys = new Set(produced.map((item) => item.ref_id || item.output_id).filter(Boolean));
  const requiredExpected = expected.filter((item) => item.required);
  const requiredProduced = requiredExpected.filter((item) => producedKeys.has(item.ref_id || item.output_id));
  return {
    expected_total: expected.length,
    produced_total: produced.length,
    required_expected_total: requiredExpected.length,
    required_produced_total: requiredProduced.length
  };
}

function isMeaningfulProducedOutput(item) {
  const type = String(item?.type || '').toLowerCase();
  return !!type && !['session', 'knowledge-driver', 'action'].includes(type);
}

function classifyOutputCategory(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'artifact' || t === 'handoff') return 'evidence';
  if (t === 'session') return 'context';
  if (t === 'knowledge-driver' || t === 'action') return 'metadata';
  return 'context';
}

class RunCoordinatorService {
  constructor(opts = {}) {
    this.runsFile = opts.runsFile || RUNS_FILE;
  }

  getStore() {
    return normalizeRuns(readJson(this.runsFile, { version: 1, runs: [] }));
  }

  listRuns(productId = '') {
    const data = this.getStore();
    const runs = productId
      ? data.runs.filter((run) => run.product_id === productId)
      : data.runs;
    return runs.slice().sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  }

  getRunById(runId) {
    return this.listRuns().find((run) => run.run_id === runId) || null;
  }

  getCurrentRun(productId) {
    const runs = this.listRuns(productId);
    return runs.find((run) => run.status === 'active' || run.status === 'in-progress') || runs[0] || null;
  }

  createOrReuseRun(product, stage, payload = {}) {
    const data = this.getStore();
    const now = Date.now();
    const knowledgeDriver = buildKnowledgeDriver(payload);
    const existing = data.runs.find((run) =>
      run.product_id === product.product_id &&
      run.stage_id === stage.stage_id &&
      (run.status === 'active' || run.status === 'in-progress')
    );

    if (existing) {
      existing.objective = payload.objective || existing.objective || stage.goal || '';
      existing.role = payload.role || existing.role || stage.recommended_role || '';
      existing.suggested_runtime_agent = payload.suggested_runtime_agent || existing.suggested_runtime_agent || stage.recommended_runtime_agent || '';
      existing.workspace_id = payload.workspace_id || existing.workspace_id || product?.workspace?.runtime_workspace_id || '';
      existing.expected_outputs = Array.isArray(existing.expected_outputs) && existing.expected_outputs.length
        ? existing.expected_outputs
        : (payload.expected_outputs || []);
      if (knowledgeDriver) {
        existing.knowledge_pack_id = knowledgeDriver.knowledge_pack_id;
        existing.knowledge_pack_name = knowledgeDriver.knowledge_pack_name;
        existing.preset_type = knowledgeDriver.preset_type;
        existing.preset_id = knowledgeDriver.preset_id;
        existing.preset_label = knowledgeDriver.preset_label;
        existing.preset_origin = knowledgeDriver.preset_origin;
        ensureKnowledgeDriverOutput(existing, knowledgeDriver, now);
      }
      if (payload.action_label) {
        const produced = Array.isArray(existing.produced_outputs) ? existing.produced_outputs : [];
        produced.unshift({
          output_id: `action:${Date.now()}:${existing.run_id}`,
          type: 'action',
          ref_id: '',
          label: payload.action_label,
          created_at: now
        });
        existing.produced_outputs = produced;
      }
      existing.updated_at = now;
      writeJsonAtomic(this.runsFile, data);
      return existing;
    }

    const run = {
      run_id: 'run-' + crypto.randomBytes(4).toString('hex'),
      product_id: product.product_id,
      stage_id: stage.stage_id,
      objective: payload.objective || stage.goal || '',
      role: payload.role || stage.recommended_role || '',
      suggested_runtime_agent: payload.suggested_runtime_agent || stage.recommended_runtime_agent || '',
      workspace_id: payload.workspace_id || product?.workspace?.runtime_workspace_id || '',
      status: payload.status || 'active',
      expected_outputs: Array.isArray(payload.expected_outputs) ? payload.expected_outputs : [],
      produced_outputs: Array.isArray(payload.produced_outputs) ? payload.produced_outputs : (payload.action_label ? [{
        output_id: `action:${now}`,
        type: 'action',
        ref_id: '',
        label: payload.action_label,
        created_at: now
      }] : []),
      knowledge_pack_id: knowledgeDriver ? knowledgeDriver.knowledge_pack_id : '',
      knowledge_pack_name: knowledgeDriver ? knowledgeDriver.knowledge_pack_name : '',
      preset_type: knowledgeDriver ? knowledgeDriver.preset_type : '',
      preset_id: knowledgeDriver ? knowledgeDriver.preset_id : '',
      preset_label: knowledgeDriver ? knowledgeDriver.preset_label : '',
      preset_origin: knowledgeDriver ? knowledgeDriver.preset_origin : '',
      session_ids: Array.isArray(payload.session_ids) ? dedupe(payload.session_ids) : [],
      current_session_id: payload.current_session_id || '',
      handoff_ids: Array.isArray(payload.handoff_ids) ? dedupe(payload.handoff_ids) : [],
      created_at: now,
      updated_at: now
    };

    ensureKnowledgeDriverOutput(run, knowledgeDriver, now);
    data.runs.unshift(run);
    writeJsonAtomic(this.runsFile, data);
    return run;
  }

  attachSession(runId, session) {
    const data = this.getStore();
    const run = data.runs.find((item) => item.run_id === runId);
    if (!run || !session) return null;

    run.session_ids = dedupe([...(run.session_ids || []), session.id]);
    if (!run.current_session_id || session.sessionRole === 'orchestrator') {
      run.current_session_id = session.id;
    }
    run.suggested_runtime_agent = run.suggested_runtime_agent || session.agent || '';
    run.workspace_id = run.workspace_id || session.workspaceId || '';
    run.status = 'active';
    run.updated_at = Date.now();

    const produced = Array.isArray(run.produced_outputs) ? run.produced_outputs : [];
    const sessionOutputId = `session:${session.id}`;
    if (!produced.some((item) => item.output_id === sessionOutputId)) {
      produced.unshift({
        output_id: sessionOutputId,
        type: 'session',
        ref_id: session.id,
        label: session.name || 'Linked session',
        created_at: Date.now()
      });
    }
    run.produced_outputs = produced;

    writeJsonAtomic(this.runsFile, data);
    return run;
  }

  linkHandoff(runId, handoff, opts = {}) {
    const data = this.getStore();
    const run = data.runs.find((item) => item.run_id === runId);
    if (!run || !handoff) return null;

    run.handoff_ids = dedupe([...(run.handoff_ids || []), handoff.handoff_id]);
    run.updated_at = Date.now();
    if (opts.complete !== false) {
      run.status = 'completed';
    }

    const produced = Array.isArray(run.produced_outputs) ? run.produced_outputs : [];
    const handoffOutputId = `handoff:${handoff.handoff_id}`;
    if (!produced.some((item) => item.output_id === handoffOutputId)) {
      produced.unshift({
        output_id: handoffOutputId,
        type: 'handoff',
        ref_id: handoff.handoff_id,
        label: `${handoff.from_stage} -> ${handoff.to_stage}`,
        created_at: Date.now()
      });
    }
    run.produced_outputs = produced;

    writeJsonAtomic(this.runsFile, data);
    return run;
  }

  hydrateRun(run, context = {}) {
    if (!run) return null;
    const sessions = Array.isArray(context.sessions) ? context.sessions : [];
    const handoffs = Array.isArray(context.handoffs) ? context.handoffs : [];
    const pipeline = Array.isArray(context.pipeline) ? context.pipeline : [];
    const artifacts = Array.isArray(context.artifacts) ? context.artifacts : [];

    const stage = pipeline.find((item) => item.stage_id === run.stage_id) || null;
    const artifactMap = artifacts.reduce((acc, artifact) => {
      acc[artifact.id] = artifact;
      return acc;
    }, {});

    const expectedOutputs = Array.isArray(run.expected_outputs) && run.expected_outputs.length
      ? run.expected_outputs
      : buildExpectedOutputs(stage, artifactMap);

    const linkedSessions = sessions
      .filter((session) => (run.session_ids || []).includes(session.id))
      .sort(compareLinkedSessions);

    const linkedHandoffs = handoffs
      .filter((handoff) => (run.handoff_ids || []).includes(handoff.handoff_id))
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    const incomingHandoffs = handoffs
      .filter((handoff) => handoff.to_stage === run.stage_id && handoff.product_id === run.product_id)
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    const producedOutputs = [...(run.produced_outputs || [])];
    for (const expected of expectedOutputs) {
      if (expected.type !== 'artifact') continue;
      const artifact = artifactMap[expected.ref_id];
      if (!artifact || !artifact.exists) continue;
      const artifactOutputId = `artifact:${artifact.id}`;
      if (!producedOutputs.some((item) => item.output_id === artifactOutputId)) {
        producedOutputs.push({
          output_id: artifactOutputId,
          type: 'artifact',
          ref_id: artifact.id,
          label: artifact.label,
          path: artifact.path,
          created_at: artifact.updatedAt || null
        });
      }
    }

    for (const item of producedOutputs) {
      if (!item.category) item.category = classifyOutputCategory(item.type);
    }
    const sortedProducedOutputs = producedOutputs.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    const completionSummary = buildCompletionSummary(expectedOutputs, sortedProducedOutputs);
    const latestHandoff = linkedHandoffs[0] || null;
    const orchestratorSession = linkedSessions.find((session) => (session.sessionRole || '') === 'orchestrator') || null;
    const primarySessionId = orchestratorSession?.id
      || run.current_session_id
      || (linkedSessions[0]?.id || '')
      || ((run.session_ids || [])[0] || '');
    const meaningfulProducedOutputs = sortedProducedOutputs.filter(isMeaningfulProducedOutput);
    const isReadyToComplete = ['active', 'in-progress'].includes(run.status)
      && !!primarySessionId
      && (
        meaningfulProducedOutputs.length > 0
        || (completionSummary.required_expected_total > 0
          && completionSummary.required_produced_total >= completionSummary.required_expected_total)
      );

    return {
      ...run,
      knowledge_driver: run.knowledge_pack_id && run.preset_type && run.preset_id ? {
        knowledge_pack_id: run.knowledge_pack_id,
        knowledge_pack_name: run.knowledge_pack_name || run.knowledge_pack_id,
        preset_type: run.preset_type,
        preset_id: run.preset_id,
        preset_label: run.preset_label || run.preset_id,
        preset_origin: run.preset_origin || 'manual'
      } : null,
      stage_label: stage ? stage.label : run.stage_id,
      goal: stage ? stage.goal : '',
      linked_sessions: linkedSessions,
      linked_handoffs: linkedHandoffs,
      incoming_handoffs: incomingHandoffs,
      latest_handoff: latestHandoff,
      latest_completion: latestHandoff,
      completion_summary: completionSummary,
      next_stage_hint: latestHandoff ? (latestHandoff.to_stage || '') : '',
      primary_session_id: primarySessionId,
      is_ready_to_complete: isReadyToComplete,
      expected_outputs: expectedOutputs,
      produced_outputs: sortedProducedOutputs
    };
  }

  getHydratedRuns(productId, context = {}) {
    return this.listRuns(productId).map((run) => this.hydrateRun(run, context));
  }

  getHydratedCurrentRun(productId, context = {}) {
    const run = this.getCurrentRun(productId);
    return run ? this.hydrateRun(run, context) : null;
  }
}

let instance = null;

function getRunCoordinatorService() {
  if (!instance) instance = new RunCoordinatorService();
  return instance;
}

module.exports = {
  RunCoordinatorService,
  getRunCoordinatorService,
  buildExpectedOutputs,
  classifyOutputCategory
};
