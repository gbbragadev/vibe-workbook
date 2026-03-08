const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-idea-test-'));
}

function makeService(dir) {
  const { IdeaService } = require('../src/core/idea-service');
  return new IdeaService({ filePath: path.join(dir, 'ideas.json') });
}

test('createIdea returns idea with generated id and new status', () => {
  const svc = makeService(makeTempDir());
  const idea = svc.createIdea({ title: 'Test Idea', summary: 'A test', problem: 'Testing' });
  assert.ok(idea.id.startsWith('idea-'));
  assert.equal(idea.status, 'new');
  assert.equal(idea.title, 'Test Idea');
  assert.ok(idea.createdAt);
});

test('createIdea requires title', () => {
  const svc = makeService(makeTempDir());
  const result = svc.createIdea({ summary: 'no title' });
  assert.ok(result.error);
});

test('getIdeas returns all ideas', () => {
  const svc = makeService(makeTempDir());
  svc.createIdea({ title: 'A' });
  svc.createIdea({ title: 'B' });
  assert.equal(svc.getIdeas().length, 2);
});

test('getIdeas filters by status', () => {
  const svc = makeService(makeTempDir());
  svc.createIdea({ title: 'A' });
  const b = svc.createIdea({ title: 'B' });
  svc.updateIdeaStatus(b.id, 'reviewing');
  assert.equal(svc.getIdeas({ status: 'reviewing' }).length, 1);
});

test('getIdeaById returns null for missing', () => {
  const svc = makeService(makeTempDir());
  assert.equal(svc.getIdeaById('nope'), null);
});

test('updateIdea merges fields and bumps updatedAt', () => {
  const svc = makeService(makeTempDir());
  const idea = svc.createIdea({ title: 'Old' });
  const updated = svc.updateIdea(idea.id, { title: 'New' });
  assert.equal(updated.title, 'New');
  assert.ok(updated.updatedAt >= idea.updatedAt);
});

test('updateIdeaStatus new->reviewing succeeds', () => {
  const svc = makeService(makeTempDir());
  const idea = svc.createIdea({ title: 'Test' });
  const result = svc.updateIdeaStatus(idea.id, 'reviewing');
  assert.equal(result.status, 'reviewing');
});

test('updateIdeaStatus new->approved fails', () => {
  const svc = makeService(makeTempDir());
  const idea = svc.createIdea({ title: 'Test' });
  const result = svc.updateIdeaStatus(idea.id, 'approved');
  assert.ok(result.error);
});

test('deleteIdea removes idea', () => {
  const svc = makeService(makeTempDir());
  const idea = svc.createIdea({ title: 'Del' });
  svc.deleteIdea(idea.id);
  assert.equal(svc.getIdeas().length, 0);
});

test('calculateScore returns weighted average', () => {
  const { IdeaService } = require('../src/core/idea-service');
  const score = IdeaService.calculateScore({
    signals: [{ relevanceScore: 0.8 }, { relevanceScore: 0.6 }],
    _dimensions: { painFrequency: 8, painIntensity: 7, useCaseClarity: 6, workaroundPresence: 5, nichePotential: 7, productFit: 8 }
  });
  assert.ok(score.score > 0 && score.score <= 10);
  assert.ok(score.confidence >= 0 && score.confidence <= 1);
});

test('addSignals appends and recalculates', () => {
  const svc = makeService(makeTempDir());
  const idea = svc.createIdea({ title: 'Sig' });
  const updated = svc.addSignals(idea.id, [{
    id: 'sig-001', sourceType: 'reddit', sourceName: 'r/test',
    sourceUrl: 'https://reddit.com/r/test/1', authorHandle: 'user1',
    capturedAt: new Date().toISOString(), rawTitle: 'Help',
    rawText: 'I need help automating X', extractedPain: 'manual work',
    extractedDesire: 'automation', extractedUseCase: 'automate X',
    engagement: { score: 10, comments: 5, likes: 10, shares: 0 },
    relevanceScore: 0.8
  }]);
  assert.equal(updated.signals.length, 1);
});

test('persistence survives re-instantiation', () => {
  const dir = makeTempDir();
  const svc1 = makeService(dir);
  svc1.createIdea({ title: 'Persist' });
  const svc2 = makeService(dir);
  assert.equal(svc2.getIdeas().length, 1);
});
