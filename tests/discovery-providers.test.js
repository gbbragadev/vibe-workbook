const test = require('node:test');
const assert = require('node:assert/strict');

test('BaseDiscoveryProvider.discover throws', async () => {
  const { BaseDiscoveryProvider } = require('../src/core/discovery-providers/base-provider');
  const p = new BaseDiscoveryProvider();
  await assert.rejects(() => p.discover('test'), /must be implemented/);
});

test('MockDiscoveryProvider.discover returns results', async () => {
  const { MockDiscoveryProvider } = require('../src/core/discovery-providers/mock-provider');
  const p = new MockDiscoveryProvider();
  const results = await p.discover('automate');
  assert.ok(Array.isArray(results));
  assert.ok(results.length > 0);
});

test('MockDiscoveryProvider.normalizeSignal returns IdeaSignal shape', () => {
  const { MockDiscoveryProvider } = require('../src/core/discovery-providers/mock-provider');
  const { FIXTURES } = require('../src/core/discovery-providers/fixtures');
  const p = new MockDiscoveryProvider();
  const sig = p.normalizeSignal(FIXTURES[0]);
  assert.ok(sig.id.startsWith('sig-'));
  assert.ok(sig.sourceType);
  assert.ok(sig.sourceUrl);
  assert.ok(sig.rawText);
  assert.ok(typeof sig.relevanceScore === 'number');
});

test('fixtures have required fields', () => {
  const { FIXTURES } = require('../src/core/discovery-providers/fixtures');
  for (const f of FIXTURES) {
    assert.ok(f.title, 'fixture must have title');
    assert.ok(f.text, 'fixture must have text');
    assert.ok(f.sourceType, 'fixture must have sourceType');
  }
});

test('RedditProvider.normalizeSignal maps reddit post to IdeaSignal', () => {
  const { RedditProvider } = require('../src/core/discovery-providers/reddit-provider');
  const p = new RedditProvider({});
  const sig = p.normalizeSignal({
    data: {
      title: 'Test post', selftext: 'Body text',
      subreddit: 'automation', author: 'testuser',
      permalink: '/r/automation/test', score: 50,
      num_comments: 10, ups: 50, created_utc: Date.now() / 1000
    }
  });
  assert.ok(sig.id.startsWith('sig-'));
  assert.equal(sig.sourceType, 'reddit');
  assert.equal(sig.rawTitle, 'Test post');
});

test('WebProvider.normalizeSignal maps DuckDuckGo result to IdeaSignal', () => {
  const { WebProvider } = require('../src/core/discovery-providers/web-provider');
  const p = new WebProvider({});
  const sig = p.normalizeSignal({
    title: 'Test result', snippet: 'A search snippet', url: 'https://example.com'
  });
  assert.ok(sig.id.startsWith('sig-'));
  assert.equal(sig.sourceType, 'web');
  assert.equal(sig.rawTitle, 'Test result');
});
