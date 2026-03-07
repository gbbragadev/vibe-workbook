/**
 * AgentAdapter - Abstract base class for AI coding agent integrations
 * Each agent (Claude Code, Codex, Antigravity) implements this interface
 */

class AgentAdapter {
  constructor(session) {
    this.session = session;
    this.agent = session.agent;
  }

  /** Agent display info */
  static get meta() {
    return { name: 'Unknown', icon: '?', color: '#888' };
  }

  /**
   * Build the shell command to launch this agent
   * @param {Object} opts - { workingDir, model, resumeSessionId, flags }
   * @returns {string} command string
   */
  buildCommand(opts = {}) {
    throw new Error('buildCommand() not implemented');
  }

  /**
   * Get the shell to use for spawning
   * @returns {string} shell path/name
   */
  getShell() {
    if (process.platform === 'win32') return 'powershell.exe';
    return process.env.SHELL || '/bin/bash';
  }

  /**
   * Get shell args for the command
   * @param {string} command
   * @returns {string[]}
   */
  getShellArgs(command) {
    if (process.platform === 'win32') return ['-NoLogo', '-NoExit', '-Command', command];
    return ['-l', '-c', command];
  }

  /**
   * Get environment variables to inject
   * @returns {Object}
   */
  getEnv() {
    return {};
  }

  /**
   * Calculate cost data for this session
   * @returns {Promise<{tokens: Object, cost: Object, breakdown: Object}>}
   */
  async getCostData() {
    return { tokens: { input: 0, output: 0 }, cost: { total: 0 }, breakdown: {} };
  }

  /**
   * Discover existing sessions for this agent type
   * @returns {Promise<Array>} discovered session metadata
   */
  static async discoverSessions() {
    return [];
  }

  /**
   * Detect activity patterns in terminal output
   * @param {string} output - recent terminal text
   * @returns {{ type: string, detail: string }} activity info
   */
  detectActivity(output) {
    return { type: 'unknown', detail: '' };
  }

  /**
   * Detect if the agent is idle (waiting for input)
   * @param {string} output - last few KB of terminal output
   * @returns {boolean}
   */
  detectIdle(output) {
    return false;
  }
}

// Agent registry
const AGENTS = {};

function registerAgent(type, AdapterClass) {
  AGENTS[type] = AdapterClass;
}

function getAdapterClass(type) {
  return AGENTS[type] || null;
}

function createAdapter(session) {
  const Cls = AGENTS[session.agent];
  if (!Cls) throw new Error(`Unknown agent type: ${session.agent}`);
  return new Cls(session);
}

function getRegisteredAgents() {
  return Object.entries(AGENTS).map(([type, Cls]) => ({
    type,
    ...Cls.meta
  }));
}

module.exports = { AgentAdapter, registerAgent, getAdapterClass, createAdapter, getRegisteredAgents };
