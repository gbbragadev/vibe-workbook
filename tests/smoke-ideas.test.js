'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { IdeaService } = require('../src/core/idea-service');

test('Ideas workflow: create, transition, deduplicate, cluster', async (t) => {
  // Use an isolated temp file so we don't pollute real state
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-ideas-'));
  const ideasFile = path.join(tmpDir, 'ideas.json');
  const svc = new IdeaService({ filePath: ideasFile });

  try {
    // Create idea
    const idea = svc.createIdea({
      title: 'Smoke Test Idea ' + Date.now(),
      summary: 'A test idea for smoke testing',
      problem: 'Testing',
      opportunityType: 'automation'
    });
    assert.ok(idea.id, 'idea should have id');
    assert.equal(idea.status, 'new', 'initial status should be new');

    // Transition: new -> reviewing -> approved
    const reviewing = svc.updateIdeaStatus(idea.id, 'reviewing');
    assert.ok(!reviewing.error, 'transition to reviewing should succeed');
    let updated = svc.getIdeaById(idea.id);
    assert.equal(updated.status, 'reviewing');

    const approved = svc.updateIdeaStatus(idea.id, 'approved');
    assert.ok(!approved.error, 'transition to approved should succeed');
    updated = svc.getIdeaById(idea.id);
    assert.equal(updated.status, 'approved');

    // Create duplicate for dedup test
    const dup = svc.createIdea({
      title: idea.title,
      summary: 'Duplicate idea',
      problem: 'Duplicate',
      opportunityType: 'automation'
    });

    // Verify we now have 2 ideas
    assert.equal(svc.getIdeas().length, 2, 'should have 2 ideas before dedup');

    // Deduplicate
    const cleaned = svc.deduplicateIdeas();
    const remaining = cleaned.filter(i => i.title === idea.title || i.title === dup.title);
    assert.ok(remaining.length <= 1, 'duplicates should be merged');

    // Cluster
    const clusters = svc.clusterIdeas();
    assert.ok(Array.isArray(clusters), 'clusters should be array');
    clusters.forEach(c => {
      assert.ok(c.label, 'cluster should have label');
      assert.ok(Array.isArray(c.ideas), 'cluster should have ideas array');
      assert.equal(typeof c.count, 'number', 'cluster should have count');
    });
  } finally {
    // Cleanup temp directory
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});
