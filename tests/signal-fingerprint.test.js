const { describe, it } = require('node:test');
const assert = require('node:assert');
const { computeFingerprint } = require('../src/core/signal-fingerprint');

describe('computeFingerprint', () => {
  it('same URL produces same fingerprint', () => {
    const a = computeFingerprint({ sourceUrl: 'https://reddit.com/r/SaaS/abc', rawTitle: 'Test' });
    const b = computeFingerprint({ sourceUrl: 'https://reddit.com/r/SaaS/abc', rawTitle: 'Different' });
    assert.strictEqual(a, b);
  });

  it('different URLs produce different fingerprints', () => {
    const a = computeFingerprint({ sourceUrl: 'https://reddit.com/r/SaaS/abc', rawTitle: 'Test' });
    const b = computeFingerprint({ sourceUrl: 'https://reddit.com/r/SaaS/xyz', rawTitle: 'Test' });
    assert.notStrictEqual(a, b);
  });

  it('falls back to content hash when no URL', () => {
    const a = computeFingerprint({ sourceUrl: '', rawTitle: 'Invoice Automation', rawText: 'I need to automate' });
    assert.ok(a && a.length === 16);
  });

  it('normalizes URLs (trailing slashes, case)', () => {
    const a = computeFingerprint({ sourceUrl: 'https://Reddit.com/r/SaaS/abc/' });
    const b = computeFingerprint({ sourceUrl: 'https://reddit.com/r/SaaS/abc' });
    assert.strictEqual(a, b);
  });
});
