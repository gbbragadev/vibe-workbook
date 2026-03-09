/**
 * Idea Routes — Express Router
 * Extracted from server.js for modularization.
 */
const express = require('express');

function createIdeaRoutes({ ideaService, ideaDiscoveryService, productService, store, broadcastSSE }) {
  const router = express.Router();

  router.get('/ideas', (req, res) => {
    res.json(ideaService.getIdeas(req.query));
  });

  router.post('/ideas', (req, res) => {
    const result = ideaService.createIdea(req.body || {});
    if (result.error) return res.status(400).json(result);
    broadcastSSE('idea:created', result);
    res.status(201).json(result);
  });

  router.post('/ideas/deduplicate', (req, res) => {
    const cleaned = ideaService.deduplicateIdeas();
    res.json(cleaned);
  });

  router.get('/ideas/clusters', (req, res) => {
    const clusters = ideaService.clusterIdeas();
    res.json(clusters);
  });

  router.get('/ideas/discover/status', (req, res) => {
    res.json(ideaDiscoveryService.getDiscoveryStatus());
  });

  router.post('/ideas/discover', async (req, res) => {
    const run = await ideaDiscoveryService.startDiscovery((req.body || {}).query || '');
    if (run.error) return res.status(409).json(run);
    broadcastSSE('idea:discovery:completed', run);
    res.json(run);
  });

  router.get('/ideas/:id', (req, res) => {
    const idea = ideaService.getIdeaById(req.params.id);
    if (!idea) return res.status(404).json({ error: 'Not found' });
    res.json(idea);
  });

  router.put('/ideas/:id', (req, res) => {
    const result = ideaService.updateIdea(req.params.id, req.body || {});
    if (result.error) return res.status(400).json(result);
    broadcastSSE('idea:updated', result);
    res.json(result);
  });

  router.delete('/ideas/:id', (req, res) => {
    ideaService.deleteIdea(req.params.id);
    broadcastSSE('idea:deleted', { id: req.params.id });
    res.json({ ok: true });
  });

  router.put('/ideas/:id/status', (req, res) => {
    const result = ideaService.updateIdeaStatus(req.params.id, (req.body || {}).status);
    if (result.error) return res.status(400).json(result);
    broadcastSSE('idea:updated', result);
    res.json(result);
  });

  router.post('/ideas/:id/convert', (req, res) => {
    const idea = ideaService.getIdeaById(req.params.id);
    if (!idea) return res.status(404).json({ error: 'Not found' });
    if (idea.status !== 'approved') return res.status(400).json({ error: 'Only approved ideas can be converted' });

    const payload = req.body || {};
    const productPayload = {
      name: payload.name || idea.title,
      owner: payload.owner || 'idea-discovery',
      summary: idea.problem || idea.summary,
      category: payload.category || 'product',
      stage: 'idea',
      slug: payload.slug || idea.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40),
      local_path: payload.local_path || '',
      workspace_mode: payload.workspace_mode || 'none'
    };

    const product = productService.createProduct(productPayload, store);
    if (product.error) return res.status(product.status || 400).json(product);

    ideaService.updateIdeaStatus(idea.id, 'converted');
    ideaService.updateIdea(idea.id, { convertedProductId: product.product.product_id });
    broadcastSSE('idea:updated', ideaService.getIdeaById(idea.id));
    res.json({ idea: ideaService.getIdeaById(idea.id), product: product.product });
  });

  return router;
}

module.exports = { createIdeaRoutes };
