'use strict';

const { spawn, spawnSync } = require('child_process');
const { BaseProvider } = require('./base');
const logger = require('../utils/logger');

/**
 * Returns true if `cmd` is available on PATH.
 * Uses `where` on Windows, `which` on Unix.
 * Never throws.
 * @param {string} cmd
 * @returns {boolean}
 */
function commandExists(cmd) {
  try {
    const checker = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(checker, [cmd], { encoding: 'utf8', timeout: 5000 });
    return result.status === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

class ClaudeProvider extends BaseProvider {
  get name() {
    return 'claude';
  }

  isAvailable() {
    return commandExists('claude');
  }

  async generate(lane, prompt, opts = {}) {
    const timeout = opts.timeout || 90000;
    const start = Date.now();

    logger.lane('claude', `Generating content for lane "${lane}" (timeout ${timeout}ms)`);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // claude CLI: -p / --print flag sends a single prompt and returns output to stdout
      const child = spawn('claude', ['-p', prompt], {
        env: { ...process.env },
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
        reject(new Error(`ClaudeProvider timed out after ${timeout}ms for lane "${lane}"`));
      }, timeout);

      child.stdout.on('data', chunk => { stdout += chunk.toString(); });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });

      child.on('error', err => {
        clearTimeout(timer);
        reject(new Error(`ClaudeProvider spawn error: ${err.message}`));
      });

      child.on('close', code => {
        clearTimeout(timer);
        if (timedOut) return; // already rejected

        const duration = Date.now() - start;

        if (code !== 0) {
          const detail = stderr.trim() || `exit code ${code}`;
          reject(new Error(`ClaudeProvider failed for lane "${lane}": ${detail}`));
          return;
        }

        const content = stdout.trim();
        logger.done(`ClaudeProvider finished in ${duration}ms`);
        resolve({ content, provider: 'claude', duration });
      });
    });
  }
}

module.exports = { ClaudeProvider };
