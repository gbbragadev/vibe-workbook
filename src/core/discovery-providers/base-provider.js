class BaseDiscoveryProvider {
  constructor(opts = {}) {
    this.name = opts.name || 'base';
    this.sourceType = opts.sourceType || 'other';
  }
  async discover(query) { throw new Error('discover() must be implemented by subclass'); }
  normalizeSignal(raw) { throw new Error('normalizeSignal() must be implemented by subclass'); }
}
module.exports = { BaseDiscoveryProvider };
