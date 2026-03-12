/**
 * Product & Knowledge Pack Routes
 * Extracted from server.js — Express Router factory
 */
const express = require('express');

function createProductRoutes({ productService, knowledgePackService, store, ptyManager, broadcastSSE }) {
  const router = express.Router();

  // --- Knowledge Pack Routes ---

  router.get('/knowledge-packs', (req, res) => {
    res.json(knowledgePackService.getKnowledgePacks());
  });

  router.get('/knowledge-packs/:id', (req, res) => {
    const pack = knowledgePackService.getPackById(req.params.id);
    if (!pack) return res.status(404).json({ error: 'Not found' });
    res.json(pack);
  });

  // --- Product CRUD ---

  router.get('/products', (req, res) => {
    res.json(productService.getProducts(store.getWorkspaces(), store.getSessions()));
  });

  router.post('/products', (req, res) => {
    const result = productService.createProduct(req.body || {}, store);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    const detail = productService.getProductDetail(result.product.product_id, store.getWorkspaces(), store.getSessions());
    res.status(201).json({
      ...result,
      detail
    });
  });

  router.get('/products/:id', (req, res) => {
    const detail = productService.getProductDetail(req.params.id, store.getWorkspaces(), store.getSessions());
    if (!detail) return res.status(404).json({ error: 'Not found' });
    res.json(detail);
  });

  router.delete('/products/:id', (req, res) => {
    const result = productService.deleteProduct(req.params.id);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json(result);
  });

  router.post('/products/:id/reset', (req, res) => {
    const result = productService.resetProduct(req.params.id);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json(result);
  });

  router.put('/products/:id/workspace', (req, res) => {
    const product = productService.getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Not found' });

    const { workspaceId } = req.body || {};
    let workspace = null;

    if (workspaceId) {
      workspace = store.getWorkspace(workspaceId);
      if (!workspace) return res.status(400).json({ error: 'Workspace not found' });
    }

    const updated = productService.updateProductWorkspace(req.params.id, workspace);
    const detail = productService.getProductDetail(updated.product_id, store.getWorkspaces(), store.getSessions());
    res.json(detail);
  });

  router.get('/products/:id/pipeline', (req, res) => {
    const pipeline = productService.getPipeline(req.params.id, store.getWorkspaces(), store.getSessions());
    if (!pipeline) return res.status(404).json({ error: 'Not found' });
    res.json(pipeline);
  });

  router.get('/products/:id/artifacts', (req, res) => {
    const artifacts = productService.getArtifacts(req.params.id);
    if (!artifacts) return res.status(404).json({ error: 'Not found' });
    res.json(artifacts);
  });

  router.get('/products/:id/artifacts/:artifactId/content', (req, res) => {
    const fs = require('fs');
    const artifacts = productService.getArtifacts(req.params.id);
    if (!artifacts) return res.status(404).json({ content: '', path: '', exists: false });
    const artifact = artifacts.find(a => a.id === req.params.artifactId);
    if (!artifact || !artifact.exists || !artifact.path) {
      return res.json({ content: '', path: artifact ? (artifact.path || '') : '', exists: false });
    }
    try {
      const content = fs.readFileSync(artifact.path, 'utf-8');
      res.json({ content: content, path: artifact.path, exists: true });
    } catch (e) {
      res.json({ content: '', path: artifact.path, exists: false });
    }
  });

  router.get('/products/:id/knowledge', (req, res) => {
    const knowledge = productService.getKnowledge(req.params.id, store.getWorkspaces(), store.getSessions());
    if (!knowledge) return res.status(404).json({ error: 'Not found' });
    res.json(knowledge);
  });

  router.get('/products/:id/runs', (req, res) => {
    const runs = productService.getRuns(req.params.id, store.getWorkspaces(), store.getSessions());
    if (!runs) return res.status(404).json({ error: 'Not found' });
    res.json(runs);
  });

  router.get('/products/:id/runs/current', (req, res) => {
    const product = productService.getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Not found' });
    const run = productService.getCurrentRun(req.params.id, store.getWorkspaces(), store.getSessions());
    res.json(run);
  });

  router.post('/products/:id/copilot/candidates/:candidateId/review', (req, res) => {
    const accepted = req.body && req.body.accepted === true;
    const result = productService.reviewCopilotCandidate(
      req.params.id,
      req.params.candidateId,
      accepted,
      store.getWorkspaces(),
      store.getSessions()
    );
    if (result && result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json(result);
  });

  router.post('/products/:id/copilot/decisions', (req, res) => {
    const result = productService.addCopilotDecision(
      req.params.id,
      req.body || {},
      store.getWorkspaces(),
      store.getSessions()
    );
    if (result && result.error) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json(result);
  });

  router.put('/products/:id/copilot/decisions/:decisionId', (req, res) => {
    const result = productService.updateCopilotDecision(
      req.params.id,
      req.params.decisionId,
      req.body || {},
      store.getWorkspaces(),
      store.getSessions()
    );
    if (result && result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json(result);
  });

  router.get('/products/:id/stages', (req, res) => {
    const product = productService.getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Not found' });
    res.json(productService.getStagePresets());
  });

  router.post('/products/:id/stages/:stage/start', async (req, res) => {
    const result = await productService.startStage(req.params.id, req.params.stage, req.body || {}, store);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json(result);
  });

  router.post('/products/:id/next-actions/execute', async (req, res) => {
    const { action_id } = req.body || {};
    if (!action_id) return res.status(400).json({ error: 'action_id is required' });
    const result = await productService.executeNextAction(
      req.params.id,
      action_id,
      req.body || {},
      store,
      store.getWorkspaces(),
      store.getSessions()
    );
    if (result.error) return res.status(result.status || 400).json({ error: result.error });

    let started = false;
    let pid = null;
    const startedSessionIds = [];
    const clusterSessions = Array.isArray(result.sessions) && result.sessions.length
      ? result.sessions
      : (result.session ? [result.session] : []);
    const hydratedSessions = [];
    for (const clusterSession of clusterSessions) {
      if (!clusterSession || !clusterSession.id) continue;
      const latestSession = store.getSession(clusterSession.id) || clusterSession;
      hydratedSessions.push({ ...latestSession, ...clusterSession });
      const isRunning = latestSession && latestSession.status === 'running';
      if (!isRunning) {
        const pty = ptyManager.spawn(clusterSession.id, req.body || {});
        started = true;
        startedSessionIds.push(clusterSession.id);
        if (clusterSession.id === (result.primary_session_id || result.session?.id || '')) {
          pid = pty.pid;
        }
      } else if (clusterSession.id === (result.primary_session_id || result.session?.id || '')) {
        pid = latestSession.pid || null;
      }
    }
    res.status(201).json({
      ...result,
      session: result.session ? ({ ...(store.getSession(result.session.id) || result.session), ...((hydratedSessions.find((item) => item.id === result.session.id)) || {}) }) : null,
      sessions: hydratedSessions,
      primary_session_id: result.primary_session_id || (result.session ? result.session.id : ''),
      started,
      started_session_ids: startedSessionIds,
      pid
    });
  });

  router.get('/products/:id/handoffs', (req, res) => {
    const product = productService.getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Not found' });
    res.json(productService.getHandoffs(req.params.id));
  });

  router.post('/products/:id/handoffs', async (req, res) => {
    const product = productService.getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Not found' });
    const { from_stage, to_stage, role, summary } = req.body || {};
    if (!from_stage || !to_stage || !role || !summary) {
      return res.status(400).json({ error: 'from_stage, to_stage, role and summary are required' });
    }
    const handoff = await productService.createHandoff(req.params.id, req.body || {});
    res.status(201).json(handoff);
  });

  // --- Lifecycle Routes ---

  router.patch('/products/:id/stage', (req, res) => {
    const { phase } = req.body || {};
    if (!phase) return res.status(400).json({ error: 'phase is required' });
    const result = productService.updateLifecyclePhase(req.params.id, phase);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    broadcastSSE('product:updated', { productId: req.params.id });
    const detail = productService.getProductDetail(req.params.id, store.getWorkspaces(), store.getSessions());
    res.json(detail);
  });

  router.post('/products/:id/launch', (req, res) => {
    const { checklist } = req.body || {};
    const result = productService.launchProduct(req.params.id, checklist);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    broadcastSSE('product:updated', { productId: req.params.id });
    const detail = productService.getProductDetail(req.params.id, store.getWorkspaces(), store.getSessions());
    res.status(201).json({ launched_at: result.launched_at, detail });
  });

  router.get('/products/:id/health', (req, res) => {
    const result = productService.getProductHealth(req.params.id);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json(result);
  });

  router.post('/products/:id/metrics', (req, res) => {
    const result = productService.addMetric(req.params.id, req.body || {});
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    broadcastSSE('product:updated', { productId: req.params.id });
    res.status(201).json(result);
  });

  router.post('/products/:id/feedback', (req, res) => {
    const result = productService.addFeedback(req.params.id, req.body || {});
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    broadcastSSE('product:updated', { productId: req.params.id });
    res.status(201).json(result);
  });

  router.post('/products/:id/improvement-runs', (req, res) => {
    const result = productService.createImprovementRun(req.params.id, req.body || {});
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    broadcastSSE('product:updated', { productId: req.params.id });
    res.status(201).json(result);
  });

  router.post('/products/:id/retrospectives', (req, res) => {
    const result = productService.createRetrospective(req.params.id, req.body || {});
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    broadcastSSE('product:updated', { productId: req.params.id });
    res.status(201).json(result);
  });

  // --- Evidence & Envelope Routes ---

  router.post('/products/:id/runs/:runId/evidence', (req, res) => {
    try {
      const product = productService.getProductById(req.params.id);
      if (!product) return res.status(404).json({ error: 'Product not found' });
      const run = productService.runCoordinatorService.getRunById(req.params.runId);
      if (!run) return res.status(404).json({ error: 'Run not found' });
      const orchestrator = require('../../core/execution-orchestrator-service').getExecutionOrchestratorService();
      const report = orchestrator.verifyEvidence(run, product, run.execution_envelope_path || '');
      res.json(report);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/products/:id/runs/:runId/envelope', (req, res) => {
    try {
      const product = productService.getProductById(req.params.id);
      if (!product) return res.status(404).json({ error: 'Product not found' });
      const run = productService.runCoordinatorService.getRunById(req.params.runId);
      if (!run) return res.status(404).json({ error: 'Run not found' });
      const orchestrator = require('../../core/execution-orchestrator-service').getExecutionOrchestratorService();
      const envelope = orchestrator.loadEnvelope(run.execution_envelope_path || '');
      if (!envelope) return res.status(404).json({ error: 'Envelope not found for this run' });
      res.json({ envelope, envelope_path: run.execution_envelope_path || '' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Rollback Route ---

  router.post('/products/:id/runs/:runId/rollback', async (req, res) => {
    try {
      const product = productService.getProductById(req.params.id);
      if (!product) return res.status(404).json({ error: 'Product not found' });
      const run = productService.runCoordinatorService.getRunById(req.params.runId);
      if (!run) return res.status(404).json({ error: 'Run not found' });

      const preRunHash = run.pre_run_hash;
      if (!preRunHash) return res.status(400).json({ error: 'No pre-run checkpoint available for this run.' });

      const workingDir = product?.repo?.local_path || product?.workspace?.current_working_dir || '';
      if (!workingDir) return res.status(400).json({ error: 'Working directory not configured.' });

      const git = require('../../core/git-orchestrator').getGitOrchestrator();
      const isRepo = await git.isRepo(workingDir);
      if (!isRepo) return res.status(400).json({ error: 'Not a git repository.' });

      await git.hardReset(workingDir, preRunHash);

      res.json({ success: true, message: `Rolled back to ${preRunHash}` });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createProductRoutes };
