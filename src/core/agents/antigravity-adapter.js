/**
 * AntigravityAdapter - Google Antigravity IDE (stub for v2)
 */
const { AgentAdapter, registerAgent } = require('../agent-adapter');

class AntigravityAdapter extends AgentAdapter {
  static get meta() {
    return { name: 'Antigravity', icon: 'G', color: '#4285f4', shortName: 'antigravity' };
  }

  buildCommand(opts = {}) {
    // Antigravity is an IDE, not a CLI tool
    // This would launch the Antigravity agent mode if available
    return 'echo "Antigravity integration coming in v2"';
  }

  detectActivity(output) {
    return { type: 'idle', detail: '' };
  }

  detectIdle(output) {
    return true;
  }

  async getCostData() {
    return { tokens: { input: 0, output: 0 }, cost: { total: 0 }, breakdown: {} };
  }

  static async discoverSessions() {
    return [];
  }
}

registerAgent('antigravity', AntigravityAdapter);
module.exports = AntigravityAdapter;
