/**
 * GeminiAdapter - Google Gemini CLI integration
 * Launch: `gemini` in project directory
 * Cost: manual tracking (no local JSONL like Claude)
 */
const { AgentAdapter, registerAgent } = require('../agent-adapter');
const { execFileSync } = require('child_process');

const TOKEN_PRICING = {
  'gemini-3.1-pro-preview': { input: 1.25, output: 10.00 },
  'gemini-3-flash-preview': { input: 0.15, output: 0.60 },
  'gemini-3.1-flash-lite-preview': { input: 0.10, output: 0.40 },
  'gemini-3-pro-preview': { input: 1.25, output: 10.00 },
};
const DEFAULT_PRICING = { input: 0.15, output: 0.60 };

class GeminiAdapter extends AgentAdapter {
  static get meta() {
    return { name: 'Gemini CLI', icon: 'G', color: '#4285f4', shortName: 'gemini' };
  }

  buildCommand(opts = {}) {
    const bin = this._findGeminiBin();
    const parts = [bin];

    if (opts.model || this.session.model) {
      parts.push('--model', opts.model || this.session.model);
    }

    return parts.join(' ');
  }

  getEnv() {
    const env = {};
    if (process.env.GOOGLE_API_KEY) {
      env.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    }
    if (process.env.GEMINI_API_KEY) {
      env.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    }
    return env;
  }

  _findGeminiBin() {
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      execFileSync(cmd, ['gemini'], { stdio: 'pipe' });
      return 'gemini';
    } catch {
      return 'npx @anthropic-ai/gemini-cli';
    }
  }

  detectActivity(output) {
    const last = output.slice(-2000);
    if (/Reading/i.test(last)) return { type: 'reading', detail: 'Reading files' };
    if (/Writing/i.test(last) || /Editing/i.test(last)) return { type: 'writing', detail: 'Writing code' };
    if (/Running/i.test(last) || /Executing/i.test(last)) return { type: 'running', detail: 'Running command' };
    if (/Searching/i.test(last)) return { type: 'searching', detail: 'Searching' };
    if (/Thinking/i.test(last)) return { type: 'thinking', detail: 'Thinking...' };
    return { type: 'idle', detail: '' };
  }

  detectIdle(output) {
    const last = output.slice(-500);
    // Gemini CLI ready indicators: prompt symbols, waiting for input messages
    return /[>❯$]\s*$/.test(last) ||
      /gemini[>:]\s*$/i.test(last) ||
      /\(type.*to quit\)/i.test(last) ||
      /You can now start/i.test(last);
  }

  /** Milestone 3A — Gemini uses file-reference to avoid stdin timing dependency */
  getLaunchStrategy() {
    return 'file-reference';
  }

  /**
   * Milestone 3A — Return a short bootstrap instruction pointing to the brief file.
   * Gemini CLI supports reading files via its standard chat interface.
   * @param {string} envelopePath
   * @returns {string}
   */
  buildBootstrapInstruction(envelopePath) {
    const path = require('path');
    const briefFile = envelopePath ? path.join(envelopePath, 'execution-brief.md') : '';
    if (!briefFile) return '';
    return `Please read the execution brief at: ${briefFile}\n\nProceed with the work described in that brief. When done, summarise what was produced and what the next step should be.`;
  }

  /** Milestone 3A — Same as detectIdle for Gemini */
  detectReadyForBootstrap(output) {
    return this.detectIdle(output);
  }

  async getCostData() {
    const cached = this.session.costCache;
    if (cached) return cached;
    return { tokens: { input: 0, output: 0 }, cost: { total: 0 }, breakdown: {} };
  }

  static calculateCost(model, inputTokens, outputTokens) {
    const pricing = TOKEN_PRICING[model] || DEFAULT_PRICING;
    const costIn = (inputTokens / 1_000_000) * pricing.input;
    const costOut = (outputTokens / 1_000_000) * pricing.output;
    return {
      tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
      cost: { input: costIn, output: costOut, total: costIn + costOut },
      breakdown: { [model]: { tokens: inputTokens + outputTokens, cost: costIn + costOut } }
    };
  }

  static async discoverSessions() {
    return [];
  }
}

registerAgent('gemini', GeminiAdapter);
module.exports = GeminiAdapter;
