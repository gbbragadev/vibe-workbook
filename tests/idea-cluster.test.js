const { describe, it } = require('node:test');
const assert = require('node:assert');
const { clusterIdeas, cosineSimilarity } = require('../src/core/idea-cluster');

describe('idea-cluster', () => {
  it('clusters related invoice ideas together', () => {
    const ideas = [
      { id: '1', title: 'invoice automation', problem: 'manual invoicing', tags: ['invoice'], signals: [] },
      { id: '2', title: 'billing dashboard', problem: 'invoice tracking hard', tags: ['billing', 'invoice'], signals: [] },
      { id: '3', title: 'social media scheduler', problem: 'posting is tedious', tags: ['social'], signals: [] }
    ];
    const clusters = clusterIdeas(ideas);
    const invoiceCluster = clusters.find(c => c.ideas.some(i => i.id === '1'));
    assert.ok(invoiceCluster.ideas.some(i => i.id === '2'), 'invoice ideas should cluster');
    assert.ok(!invoiceCluster.ideas.some(i => i.id === '3'), 'social idea should be separate');
  });

  it('cosineSimilarity returns 1.0 for identical vectors', () => {
    const v = new Map([['invoice', 3], ['automate', 2]]);
    assert.strictEqual(cosineSimilarity(v, v), 1.0);
  });

  it('cosineSimilarity returns 0.0 for disjoint vectors', () => {
    const a = new Map([['invoice', 3]]);
    const b = new Map([['social', 2]]);
    assert.strictEqual(cosineSimilarity(a, b), 0.0);
  });
});
