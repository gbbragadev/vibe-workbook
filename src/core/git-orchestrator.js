const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const execAsync = util.promisify(exec);

const NON_BLOCKING_UNTRACKED_PREFIXES = [
  '.claude/',
  '.codex/',
  '.gemini/'
];

function normalizeGitPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function parsePorcelainLine(line) {
  const rawLine = String(line || '');
  if (rawLine.length < 4) return null;
  const status = rawLine.slice(0, 2);
  const rawPath = rawLine.slice(3).trim();
  if (!rawPath) return null;
  const finalPath = rawPath.includes(' -> ')
    ? rawPath.split(' -> ').pop().trim()
    : rawPath;
  return {
    status,
    path: finalPath
  };
}

function isNonBlockingUntrackedEntry(entry) {
  if (!entry || entry.status !== '??') return false;
  const normalizedPath = normalizeGitPath(entry.path);
  return NON_BLOCKING_UNTRACKED_PREFIXES.some((prefix) => (
    normalizedPath === prefix.slice(0, -1) || normalizedPath.startsWith(prefix)
  ));
}

/**
 * GitOrchestrator
 * Provides a safe and semantic abstraction over local Git repositories
 * for Milestone 4A (Checkpoints & Rollbacks).
 */
class GitOrchestrator {
  constructor() {
    this.authorString = 'VibePlatform <bot@localhost>';
  }

  /**
   * Internal helper to run git commands in a specific directory
   */
  async _runGit(cwd, command) {
    if (!cwd || !fs.existsSync(cwd)) {
      throw new Error(`Directory does not exist: ${cwd}`);
    }
    // We use exec instead of execFile for easier combined commands (like add -A && commit), but carefully
    try {
      const { stdout } = await execAsync(`git ${command}`, { cwd, windowsHide: true });
      return stdout.trim();
    } catch (error) {
      // In some cases git commands throw if there's nothing to do or if it's not a repo.
      // We attach stdout/stderr to the error if present.
      error.stdout = error.stdout ? error.stdout.toString().trim() : '';
      error.stderr = error.stderr ? error.stderr.toString().trim() : '';
      throw error;
    }
  }

  /**
   * Checks if a directory is a git repository
   */
  async isRepo(cwd) {
    try {
      await this._runGit(cwd, 'rev-parse --is-inside-work-tree');
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Initializes a git repository
   */
  async init(cwd) {
    await this._runGit(cwd, 'init');
  }

  /**
   * Returns true if there are uncommitted local changes (tracked or untracked)
   */
  async isDirty(cwd) {
    const state = await this.getDirtyState(cwd);
    return state.dirty;
  }

  /**
   * Returns parsed dirty entries from git status porcelain format
   */
  async listDirtyEntries(cwd) {
    try {
      const status = await this._runGit(cwd, 'status --porcelain');
      if (!status) return [];
      return status
        .split(/\r?\n/)
        .map((line) => parsePorcelainLine(line))
        .filter(Boolean);
    } catch (e) {
      return null;
    }
  }

  /**
   * Returns dirty state with non-blocking entry filtering.
   * Non-blocking entries are tool metadata folders that should not block safe checkpoints.
   */
  async getDirtyState(cwd) {
    const entries = await this.listDirtyEntries(cwd);
    if (entries === null) {
      // If it fails, assume dirty just to be safe, or if it's not a repo
      return {
        dirty: true,
        blockingEntries: [],
        ignoredEntries: [],
        checkFailed: true
      };
    }

    const ignoredEntries = entries.filter((entry) => isNonBlockingUntrackedEntry(entry));
    const blockingEntries = entries.filter((entry) => !isNonBlockingUntrackedEntry(entry));
    return {
      dirty: blockingEntries.length > 0,
      blockingEntries,
      ignoredEntries,
      checkFailed: false
    };
  }

  /**
   * Gets the current HEAD commit hash
   */
  async getHeadHash(cwd) {
    try {
      return await this._runGit(cwd, 'rev-parse HEAD');
    } catch (e) {
      return null;
    }
  }

  /**
   * Stages all changes and creates a commit with a specific message and bot author.
   * Returns the new commit hash.
   */
  async commitAll(cwd, message) {
    const isClean = !(await this.isDirty(cwd));
    if (isClean) {
      // Nothing to commit, return current head
      return await this.getHeadHash(cwd);
    }

    try {
      // Add all changes
      await this._runGit(cwd, 'add -A');
      // Escape message quotes for inline command (simple escaping for windows/posix)
      const safeMessage = message.replace(/"/g, '\\"');
      // Commit
      await this._runGit(cwd, `commit --author="${this.authorString}" -m "${safeMessage}"`);
      
      return await this.getHeadHash(cwd);
    } catch (e) {
      console.error('[GitOrchestrator] Failed to commitAll:', e.message, e.stdout, e.stderr);
      throw e;
    }
  }

  /**
   * Resets the working tree to a specific commit hash and cleans untracked files
   */
  async hardReset(cwd, hash) {
    if (!hash || typeof hash !== 'string') {
      throw new Error('Valid commit hash required for hardReset');
    }
    try {
      await this._runGit(cwd, `reset --hard ${hash}`);
      await this._runGit(cwd, 'clean -fd');
    } catch (e) {
      console.error(`[GitOrchestrator] Failed to hardReset to ${hash}:`, e.message);
      throw e;
    }
  }
}

// Singleton Pattern
let instance = null;
function getGitOrchestrator() {
  if (!instance) {
    instance = new GitOrchestrator();
  }
  return instance;
}

module.exports = {
  GitOrchestrator,
  getGitOrchestrator
};
