/**
 * CodexAdapter - OpenAI Codex CLI integration
 * Launch: `codex` or `npx @openai/codex` in project directory
 * Cost: tracked via session-level token counting
 */
const { AgentAdapter, registerAgent } = require('../agent-adapter');
const { execFileSync } = require('child_process');

const TOKEN_PRICING = {
  'gpt-5':        { input: 1.25, output: 10.00 },
  'gpt-5.1-codex-max': { input: 1.25, output: 10.00 },
  'gpt-5.3-codex': { input: 1.25, output: 10.00 },
  'gpt-5.4':      { input: 1.25, output: 10.00 },
  'codex-mini':   { input: 1.50, output: 6.00 },
  'codex-mini-latest': { input: 1.50, output: 6.00 },
};
const DEFAULT_PRICING = { input: 1.50, output: 6.00 };

class CodexAdapter extends AgentAdapter {
  static get meta() {
    return { name: 'Codex CLI', icon: 'X', color: '#10b981', shortName: 'codex' };
  }

  buildCommand(opts = {}) {
    // Try to detect codex in PATH
    const bin = this._findCodexBin();
    const parts = [bin];

    if (opts.model || this.session.model) {
      parts.push('--model', opts.model || this.session.model);
    }

    if (opts.effort || this.session.effort) {
      parts.push('-c', `model_reasoning_effort="${opts.effort || this.session.effort}"`);
    }

    return parts.join(' ');
  }

  getEnv() {
    const env = {};
    // Codex uses OPENAI_API_KEY from environment
    if (process.env.OPENAI_API_KEY) {
      env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    }
    return env;
  }

  _findCodexBin() {
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      execFileSync(cmd, ['codex'], { stdio: 'pipe' });
      return 'codex';
    } catch {
      return 'npx @openai/codex';
    }
  }

  detectActivity(output) {
    const last = output.slice(-2000);
    if (/Reading file/i.test(last)) return { type: 'reading', detail: 'Reading files' };
    if (/Writing to/i.test(last)) return { type: 'writing', detail: 'Writing code' };
    if (/Running command/i.test(last) || /Executing/i.test(last)) return { type: 'running', detail: 'Running command' };
    if (/Searching/i.test(last)) return { type: 'searching', detail: 'Searching' };
    if (/Thinking/i.test(last) || /Reasoning/i.test(last)) return { type: 'thinking', detail: 'Thinking...' };
    return { type: 'idle', detail: '' };
  }

  detectIdle(output) {
    const last = output.slice(-500);
    // Codex TUI shows a prompt when ready
    return /[>❯]\s*$/.test(last) || /What would you like/i.test(last);
  }

  async getCostData() {
    // Codex CLI doesn't write JSONL like Claude Code
    // Cost tracking for Codex relies on:
    // 1. Manual token count entries (from session logs)
    // 2. API usage dashboard (external)
    // For MVP, return cached cost data from session or zeros
    const cached = this.session.costCache;
    if (cached) return cached;
    return { tokens: { input: 0, output: 0 }, cost: { total: 0 }, breakdown: {} };
  }

  /**
   * Update cost data manually (called from API when user reports usage)
   */
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
    // Codex doesn't maintain a session history like Claude Code
    // Sessions are created manually by the user
    return [];
  }
}

registerAgent('codex', CodexAdapter);
module.exports = CodexAdapter;
