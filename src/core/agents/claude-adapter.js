/**
 * ClaudeAdapter - Claude Code integration
 * Discovery: scans ~/.claude/projects/ for JSONL session files
 * Cost: parses JSONL for message.usage token data
 */
const fs = require('fs');
const path = require('path');
const { AgentAdapter, registerAgent } = require('../agent-adapter');

const TOKEN_PRICING = {
  'claude-opus-4-6':          { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-sonnet-4-6':        { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-sonnet-4-5-20250514': { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-haiku-3-5-20241022': { input: 0.80, output: 4.00, cacheWrite: 1.00, cacheRead: 0.08 },
};
const DEFAULT_PRICING = { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 };

class ClaudeAdapter extends AgentAdapter {
  static get meta() {
    return { name: 'Claude Code', icon: 'C', color: '#d97706', shortName: 'claude' };
  }

  buildCommand(opts = {}) {
    const parts = ['claude'];
    if (this.session.resumeSessionId) {
      parts.push('--resume', this.session.resumeSessionId);
    }
    if (opts.model || this.session.model) {
      parts.push('--model', opts.model || this.session.model);
    }
    if (opts.effort || this.session.effort) {
      parts.push('--effort', opts.effort || this.session.effort);
    }
    if (opts.verbose) parts.push('--verbose');
    if (opts.continue) parts.push('--continue');
    const claudeCommand = parts.join(' ');

    if (process.platform === 'win32') {
      return `$env:CLAUDECODE=$null; Remove-Item Env:CLAUDECODE -ErrorAction SilentlyContinue; ${claudeCommand}`;
    }

    return `unset CLAUDECODE; ${claudeCommand}`;
  }

  getEnv() {
    return {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDECODE: null
    };
  }

  detectActivity(output) {
    const last = output.slice(-2000);
    if (/⏺\s+(Read|Glob|Grep)\(/i.test(last)) return { type: 'reading', detail: 'Reading files' };
    if (/⏺\s+(Write|Edit)\(/i.test(last)) return { type: 'writing', detail: 'Writing code' };
    if (/⏺\s+Bash\(/i.test(last)) return { type: 'running', detail: 'Running command' };
    if (/⏺\s+(WebSearch|WebFetch)\(/i.test(last)) return { type: 'searching', detail: 'Searching web' };
    if (/Thinking/i.test(last)) return { type: 'thinking', detail: 'Thinking...' };
    return { type: 'idle', detail: '' };
  }

  detectIdle(output) {
    const last = output.slice(-500);
    return /[❯$>]\s*$/.test(last) || /^Human:/m.test(last);
  }

  detectLaunchFailure(output) {
    const baseFailure = super.detectLaunchFailure(output);
    if (baseFailure) return baseFailure;
    if (/cannot be launched inside another claude code session/i.test(output || '')) {
      return 'Claude Code detected a nested session. CLAUDECODE is now unset for spawned Claude sessions.';
    }
    return '';
  }

  /** Milestone 3A — Claude uses ready-gated: retry until idle prompt detected */
  getLaunchStrategy() {
    return 'ready-gated';
  }

  /**
   * Milestone 3A — Short bootstrap instruction referencing the envelope brief.
   * Claude receives a concise pointer instead of a full prompt.
   * @param {string} envelopePath
   * @returns {string}
   */
  buildBootstrapInstruction(envelopePath) {
    const path = require('path');
    const briefFile = envelopePath ? path.join(envelopePath, 'execution-brief.md') : '';
    if (!briefFile) return '';
    return `Context for this run is in: ${briefFile}\n\nPlease read it and proceed.`;
  }

  async getCostData() {
    const claudeDir = this._getClaudeProjectsDir();
    if (!claudeDir) return { tokens: { input: 0, output: 0 }, cost: { total: 0 }, breakdown: {} };

    const jsonlPath = this._findSessionJsonl(claudeDir);
    if (!jsonlPath) return { tokens: { input: 0, output: 0 }, cost: { total: 0 }, breakdown: {} };

    return this._parseJsonlCost(jsonlPath);
  }

  _getClaudeProjectsDir() {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    const dir = path.join(home, '.claude', 'projects');
    return fs.existsSync(dir) ? dir : null;
  }

  _findSessionJsonl(claudeDir) {
    if (!this.session.resumeSessionId) return null;
    const targetId = this.session.resumeSessionId;

    try {
      // Walk project dirs looking for matching session JSONL
      const projectDirs = fs.readdirSync(claudeDir).filter(d => {
        try { return fs.statSync(path.join(claudeDir, d)).isDirectory(); } catch { return false; }
      });

      for (const dir of projectDirs) {
        const full = path.join(claudeDir, dir);
        const files = fs.readdirSync(full).filter(f => f.endsWith('.jsonl'));
        for (const f of files) {
          if (f.replace('.jsonl', '') === targetId) {
            return path.join(full, f);
          }
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  _parseJsonlCost(jsonlPath) {
    const result = {
      tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 },
      cost: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 },
      breakdown: {},
      messageCount: 0,
      contextGrowth: []
    };

    try {
      const content = fs.readFileSync(jsonlPath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type !== 'assistant' || !entry.message?.usage) continue;

          const usage = entry.message.usage;
          const model = entry.message?.model || entry.model || 'unknown';
          const pricing = TOKEN_PRICING[model] || DEFAULT_PRICING;

          const inp = usage.input_tokens || 0;
          const out = usage.output_tokens || 0;
          const cw = usage.cache_creation_input_tokens || 0;
          const cr = usage.cache_read_input_tokens || 0;

          result.tokens.input += inp;
          result.tokens.output += out;
          result.tokens.cacheWrite += cw;
          result.tokens.cacheRead += cr;

          const costInp = (inp / 1_000_000) * pricing.input;
          const costOut = (out / 1_000_000) * pricing.output;
          const costCW = (cw / 1_000_000) * pricing.cacheWrite;
          const costCR = (cr / 1_000_000) * pricing.cacheRead;

          result.cost.input += costInp;
          result.cost.output += costOut;
          result.cost.cacheWrite += costCW;
          result.cost.cacheRead += costCR;

          // Per-model breakdown
          if (!result.breakdown[model]) {
            result.breakdown[model] = { tokens: 0, cost: 0 };
          }
          result.breakdown[model].tokens += inp + out;
          result.breakdown[model].cost += costInp + costOut + costCW + costCR;

          result.messageCount++;

          // Context growth sampling (max 50 points)
          if (result.contextGrowth.length < 50 || result.messageCount % Math.ceil(lines.length / 50) === 0) {
            result.contextGrowth.push({
              msg: result.messageCount,
              tokens: inp,
              ts: entry.timestamp || null
            });
          }
        } catch (e) { /* skip malformed line */ }
      }

      result.tokens.total = result.tokens.input + result.tokens.output + result.tokens.cacheWrite + result.tokens.cacheRead;
      result.cost.total = result.cost.input + result.cost.output + result.cost.cacheWrite + result.cost.cacheRead;
    } catch (e) {
      console.error('[ClaudeAdapter] Cost parse error:', e.message);
    }

    return result;
  }

  static async discoverSessions() {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    const claudeDir = path.join(home, '.claude', 'projects');
    if (!fs.existsSync(claudeDir)) return [];

    const discovered = [];

    try {
      const projectDirs = fs.readdirSync(claudeDir).filter(d => {
        try { return fs.statSync(path.join(claudeDir, d)).isDirectory(); } catch { return false; }
      });

      for (const dir of projectDirs) {
        const fullDir = path.join(claudeDir, dir);
        const files = fs.readdirSync(fullDir)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => {
            const fp = path.join(fullDir, f);
            try {
              const stat = fs.statSync(fp);
              return { file: f, path: fp, mtime: stat.mtimeMs, size: stat.size };
            } catch { return null; }
          })
          .filter(Boolean)
          .sort((a, b) => b.mtime - a.mtime);

        for (const fInfo of files) {
          const sessionId = fInfo.file.replace('.jsonl', '');
          // Decode dir name to get project path
          const projectPath = dir.replace(/-/g, path.sep);

          // Try to extract topic from first few KB
          let topic = '';
          try {
            const fd = fs.openSync(fInfo.path, 'r');
            const buf = Buffer.alloc(8192);
            const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
            fs.closeSync(fd);
            const chunk = buf.toString('utf8', 0, bytesRead);
            const firstLines = chunk.split('\n').slice(0, 5);
            for (const line of firstLines) {
              try {
                const entry = JSON.parse(line);
                if (entry.type === 'user' && entry.message?.content) {
                  const content = typeof entry.message.content === 'string'
                    ? entry.message.content
                    : JSON.stringify(entry.message.content);
                  topic = content.slice(0, 80);
                  break;
                }
              } catch { /* skip */ }
            }
          } catch { /* ignore */ }

          discovered.push({
            agent: 'claude',
            resumeSessionId: sessionId,
            projectDir: dir,
            projectPath,
            topic,
            lastActive: fInfo.mtime,
            size: fInfo.size,
            jsonlPath: fInfo.path
          });
        }
      }
    } catch (e) {
      console.error('[ClaudeAdapter] Discovery error:', e.message);
    }

    // Sort by most recent
    discovered.sort((a, b) => b.lastActive - a.lastActive);
    return discovered;
  }
}

registerAgent('claude', ClaudeAdapter);
module.exports = ClaudeAdapter;
