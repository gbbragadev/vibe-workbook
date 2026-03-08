const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-disc-test-'));
}

test('startDiscovery returns run metadata', async () => {
  const { IdeaDiscoveryService } = require('../src/core/idea-discovery-service');
  const { IdeaService } = require('../src/core/idea-service');
  const { MockDiscoveryProvider } = require('../src/core/discovery-providers/mock-provider');
  const dir = makeTempDir();
  const ideaSvc = new IdeaService({ filePath: path.join(dir, 'ideas.json') });
  const svc = new IdeaDiscoveryService({ ideaService: ideaSvc });
  svc.registerProvider(new MockDiscoveryProvider());
  const run = await svc.startDiscovery('automation');
  assert.equal(run.status, 'completed');
  assert.ok(run.ideasCreated > 0);
});

test('discovery creates ideas with signals', async () => {
  const { IdeaDiscoveryService } = require('../src/core/idea-discovery-service');
  const { IdeaService } = require('../src/core/idea-service');
  const { MockDiscoveryProvider } = require('../src/core/discovery-providers/mock-provider');
  const dir = makeTempDir();
  const ideaSvc = new IdeaService({ filePath: path.join(dir, 'ideas.json') });
  const svc = new IdeaDiscoveryService({ ideaService: ideaSvc });
  svc.registerProvider(new MockDiscoveryProvider());
  await svc.startDiscovery('');
  const ideas = ideaSvc.getIdeas();
  assert.ok(ideas.length > 0);
  assert.ok(ideas.some(i => i.signals.length > 0));
});

test('getDiscoveryStatus returns idle when no run', () => {
  const { IdeaDiscoveryService } = require('../src/core/idea-discovery-service');
  const svc = new IdeaDiscoveryService({});
  assert.equal(svc.getDiscoveryStatus().status, 'idle');
});

test('groupSignalsIntoIdeas groups by shared keywords', () => {
  const { IdeaDiscoveryService } = require('../src/core/idea-discovery-service');
  const svc = new IdeaDiscoveryService({});
  const signals = [
    { extractedUseCase: 'automate invoice processing', extractedPain: 'manual invoices', rawTitle: 'A' },
    { extractedUseCase: 'automate invoice matching', extractedPain: 'invoice errors', rawTitle: 'B' },
    { extractedUseCase: 'build a dashboard for sales', extractedPain: 'no visibility', rawTitle: 'C' }
  ];
  const groups = svc._groupSignalsIntoIdeas(signals);
  assert.ok(groups.length >= 2);
});
