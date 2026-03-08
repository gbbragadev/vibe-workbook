const crypto = require('crypto');
const { BaseDiscoveryProvider } = require('./base-provider');
const { FIXTURES } = require('./fixtures');

class MockDiscoveryProvider extends BaseDiscoveryProvider {
  constructor(opts = {}) {
    super({ name: 'mock', sourceType: 'mock' });
  }

  async discover(query) {
    const q = (query || '').toLowerCase();
    if (!q) return FIXTURES;
    return FIXTURES.filter(f =>
      f.title.toLowerCase().includes(q) ||
      f.text.toLowerCase().includes(q) ||
      f.extractedUseCase.toLowerCase().includes(q)
    );
  }

  normalizeSignal(raw) {
    return {
      id: 'sig-' + crypto.randomBytes(4).toString('hex'),
      sourceType: raw.sourceType || 'mock',
      sourceName: raw.sourceName || 'mock',
      sourceUrl: raw.sourceUrl || '',
      authorHandle: raw.author || '',
      capturedAt: new Date().toISOString(),
      rawTitle: raw.title || '',
      rawText: raw.text || '',
      extractedPain: raw.extractedPain || '',
      extractedDesire: raw.extractedDesire || '',
      extractedUseCase: raw.extractedUseCase || '',
      engagement: {
        score: raw.score || 0,
        comments: raw.comments || 0,
        likes: raw.score || 0,
        shares: 0
      },
      relevanceScore: this._calcRelevance(raw)
    };
  }

  _calcRelevance(raw) {
    let score = 0.5;
    if (raw.extractedPain) score += 0.15;
    if (raw.extractedUseCase) score += 0.15;
    if ((raw.score || 0) > 100) score += 0.1;
    if ((raw.comments || 0) > 20) score += 0.1;
    return Math.min(1.0, Math.round(score * 100) / 100);
  }
}

module.exports = { MockDiscoveryProvider };
