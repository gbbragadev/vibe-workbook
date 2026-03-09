'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ProductService } = require('../src/core/product-service');

test('Product critical path: readiness has traffic_light, copilot has operational_summary', async (t) => {
  // Use a temp directory as the repo path so createProduct succeeds
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-api-'));
  const registryFile = path.join(tmpDir, 'products.json');
  const handoffsFile = path.join(tmpDir, 'handoffs.json');

  // Write empty registry and handoffs
  fs.writeFileSync(registryFile, JSON.stringify({ version: 1, products: [] }), 'utf8');
  fs.writeFileSync(handoffsFile, JSON.stringify({ version: 1, handoffs: [] }), 'utf8');

  const svc = new ProductService({ registryFile, handoffsFile });

  const productId = 'smoke-test-' + Date.now();
  const repoDir = path.join(tmpDir, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });

  // Create product
  const result = svc.createProduct({
    name: 'Smoke Test Product',
    product_id: productId,
    slug: 'smoke-test',
    owner: 'test',
    category: 'product',
    stage: 'implementation',
    summary: 'Smoke test product',
    local_path: repoDir
  });

  assert.ok(result.product, 'createProduct should return a product');
  assert.equal(result.product.product_id, productId);

  try {
    // Get detail (pass empty workspaces and sessions arrays)
    const detail = svc.getProductDetail(productId, [], []);
    assert.ok(detail, 'detail should exist');

    // Verify readiness.traffic_light
    assert.ok(detail.readiness, 'readiness should exist');
    assert.ok(detail.readiness.traffic_light, 'traffic_light should exist');
    assert.ok(['green', 'yellow', 'red'].includes(detail.readiness.traffic_light), 'traffic_light should be green/yellow/red');

    // Verify copilot.operational_summary
    assert.ok(detail.copilot, 'copilot should exist');
    assert.ok(detail.copilot.operational_summary, 'operational_summary should exist');
    const ops = detail.copilot.operational_summary;
    assert.equal(typeof ops.current_stage, 'string', 'current_stage should be string');
    assert.ok(Array.isArray(ops.blockers), 'blockers should be array');
    assert.equal(typeof ops.next_action, 'string', 'next_action should be string');
    assert.equal(typeof ops.reason, 'string', 'reason should be string');
    assert.equal(typeof ops.expected_evidence, 'string', 'expected_evidence should be string');
    assert.ok(['low', 'medium', 'high'].includes(ops.risk_level), 'risk_level should be low/medium/high');
    assert.equal(typeof ops.risk_message, 'string', 'risk_message should be string');
    assert.equal(typeof ops.suggested_workflow, 'string', 'suggested_workflow should be string');

    // Verify next_actions exists
    assert.ok(Array.isArray(detail.next_actions), 'next_actions should be array');
  } finally {
    // Cleanup temp directory
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});
