const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-int-test-'));
}

test('full discovery flow: mock provider → ideas with signals', async () => {
  const { IdeaDiscoveryService } = require('../src/core/idea-discovery-service');
  const { IdeaService } = require('../src/core/idea-service');
  const { MockDiscoveryProvider } = require('../src/core/discovery-providers/mock-provider');

  const dir = makeTempDir();
  const ideaSvc = new IdeaService({ filePath: path.join(dir, 'ideas.json') });
  const discSvc = new IdeaDiscoveryService({ ideaService: ideaSvc });
  discSvc.registerProvider(new MockDiscoveryProvider());

  const run = await discSvc.startDiscovery('automation');
  assert.equal(run.status, 'completed');
  assert.ok(run.ideasCreated > 0);
  assert.ok(run.signalsCollected > 0);

  const ideas = ideaSvc.getIdeas();
  assert.ok(ideas.length > 0);
  const withSignals = ideas.filter(i => i.signals.length > 0);
  assert.ok(withSignals.length > 0);
  // Each idea should have sources derived from signals
  for (const idea of withSignals) {
    assert.ok(idea.sources.length > 0);
  }
});

test('status lifecycle: new → reviewing → approved', () => {
  const { IdeaService } = require('../src/core/idea-service');
  const dir = makeTempDir();
  const svc = new IdeaService({ filePath: path.join(dir, 'ideas.json') });

  const idea = svc.createIdea({ title: 'Lifecycle Test' });
  assert.equal(idea.status, 'new');

  const r1 = svc.updateIdeaStatus(idea.id, 'reviewing');
  assert.equal(r1.status, 'reviewing');

  const r2 = svc.updateIdeaStatus(idea.id, 'approved');
  assert.equal(r2.status, 'approved');

  // Cannot go back to new
  const r3 = svc.updateIdeaStatus(idea.id, 'new');
  assert.ok(r3.error);
});

test('persistence roundtrip', () => {
  const { IdeaService } = require('../src/core/idea-service');
  const dir = makeTempDir();
  const filePath = path.join(dir, 'ideas.json');

  const svc1 = new IdeaService({ filePath });
  svc1.createIdea({ title: 'Persist A' });
  svc1.createIdea({ title: 'Persist B' });

  const svc2 = new IdeaService({ filePath });
  const ideas = svc2.getIdeas();
  assert.equal(ideas.length, 2);
  assert.ok(ideas.some(i => i.title === 'Persist A'));
  assert.ok(ideas.some(i => i.title === 'Persist B'));
});

test('empty discovery query still produces ideas from fixtures', async () => {
  const { IdeaDiscoveryService } = require('../src/core/idea-discovery-service');
  const { IdeaService } = require('../src/core/idea-service');
  const { MockDiscoveryProvider } = require('../src/core/discovery-providers/mock-provider');

  const dir = makeTempDir();
  const ideaSvc = new IdeaService({ filePath: path.join(dir, 'ideas.json') });
  const discSvc = new IdeaDiscoveryService({ ideaService: ideaSvc });
  discSvc.registerProvider(new MockDiscoveryProvider());

  const run = await discSvc.startDiscovery('');
  assert.equal(run.status, 'completed');
  assert.ok(run.ideasCreated > 0);
});

test('two sequential discovery runs both complete', async () => {
  const { IdeaDiscoveryService } = require('../src/core/idea-discovery-service');
  const { IdeaService } = require('../src/core/idea-service');
  const { MockDiscoveryProvider } = require('../src/core/discovery-providers/mock-provider');

  const dir = makeTempDir();
  const ideaSvc = new IdeaService({ filePath: path.join(dir, 'ideas.json') });
  const discSvc = new IdeaDiscoveryService({ ideaService: ideaSvc });
  discSvc.registerProvider(new MockDiscoveryProvider());

  const run1 = await discSvc.startDiscovery('automation');
  assert.equal(run1.status, 'completed');
  const count1 = ideaSvc.getIdeas().length;

  const run2 = await discSvc.startDiscovery('dashboard');
  assert.equal(run2.status, 'completed');
  const count2 = ideaSvc.getIdeas().length;
  assert.ok(count2 >= count1);
});
