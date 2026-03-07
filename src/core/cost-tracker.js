/**
 * CostTracker - Unified cost calculation across all agents
 * Caches results for 60s, invalidated by file mtime
 */
const { createAdapter } = require('./agent-adapter');
const { getStore } = require('../state/store');

const CACHE_TTL = 60_000; // 60 seconds

class CostTracker {
  constructor() {
    this._cache = new Map(); // sessionId → { data, ts, mtime }
  }

  /**
   * Get cost data for a single session
   */
  async getSessionCost(sessionId) {
    const store = getStore();
    const session = store.getSession(sessionId);
    if (!session) return null;

    // Check cache
    const cached = this._cache.get(sessionId);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
      return cached.data;
    }

    try {
      const adapter = createAdapter(session);
      const costData = await adapter.getCostData();

      // Update cache
      this._cache.set(sessionId, { data: costData, ts: Date.now() });

      // Update session cost cache in store
      store.updateSession(sessionId, {
        costCache: {
          tokens: costData.tokens,
          cost: costData.cost,
          lastCalc: Date.now()
        }
      });

      return costData;
    } catch (e) {
      console.error(`[CostTracker] Error for session ${sessionId}:`, e.message);
      return session.costCache || { tokens: { input: 0, output: 0 }, cost: { total: 0 }, breakdown: {} };
    }
  }

  /**
   * Get aggregated cost for a workspace
   */
  async getWorkspaceCost(workspaceId) {
    const store = getStore();
    const sessions = store.getSessions(workspaceId);

    const result = {
      totalCost: 0,
      totalTokens: 0,
      byAgent: {},
      byModel: {},
      sessions: []
    };

    for (const session of sessions) {
      const cost = await this.getSessionCost(session.id);
      if (!cost) continue;

      result.totalCost += cost.cost.total || 0;
      result.totalTokens += cost.tokens.total || 0;

      // By agent
      const agent = session.agent;
      if (!result.byAgent[agent]) result.byAgent[agent] = { cost: 0, tokens: 0 };
      result.byAgent[agent].cost += cost.cost.total || 0;
      result.byAgent[agent].tokens += cost.tokens.total || 0;

      // By model
      if (cost.breakdown) {
        for (const [model, data] of Object.entries(cost.breakdown)) {
          if (!result.byModel[model]) result.byModel[model] = { cost: 0, tokens: 0 };
          result.byModel[model].cost += data.cost || 0;
          result.byModel[model].tokens += data.tokens || 0;
        }
      }

      result.sessions.push({
        id: session.id,
        name: session.name,
        agent: session.agent,
        cost: cost.cost.total || 0,
        tokens: cost.tokens.total || 0
      });
    }

    // Sort sessions by cost descending
    result.sessions.sort((a, b) => b.cost - a.cost);
    return result;
  }

  /**
   * Get cost dashboard data (all workspaces)
   */
  async getDashboard() {
    const store = getStore();
    const workspaces = store.getWorkspaces();

    const result = {
      totalCost: 0,
      totalTokens: 0,
      byAgent: {},
      byModel: {},
      byWorkspace: [],
      topSessions: []
    };

    for (const ws of workspaces) {
      const wsCost = await this.getWorkspaceCost(ws.id);
      result.totalCost += wsCost.totalCost;
      result.totalTokens += wsCost.totalTokens;

      // Merge agent data
      for (const [agent, data] of Object.entries(wsCost.byAgent)) {
        if (!result.byAgent[agent]) result.byAgent[agent] = { cost: 0, tokens: 0 };
        result.byAgent[agent].cost += data.cost;
        result.byAgent[agent].tokens += data.tokens;
      }

      // Merge model data
      for (const [model, data] of Object.entries(wsCost.byModel)) {
        if (!result.byModel[model]) result.byModel[model] = { cost: 0, tokens: 0 };
        result.byModel[model].cost += data.cost;
        result.byModel[model].tokens += data.tokens;
      }

      result.byWorkspace.push({
        id: ws.id,
        name: ws.name,
        cost: wsCost.totalCost,
        tokens: wsCost.totalTokens
      });

      result.topSessions.push(...wsCost.sessions);
    }

    // Also include sessions without workspace
    const orphanSessions = store.getSessions().filter(s => !s.workspaceId);
    for (const session of orphanSessions) {
      const cost = await this.getSessionCost(session.id);
      if (cost) {
        result.totalCost += cost.cost.total || 0;
        result.totalTokens += cost.tokens.total || 0;
        result.topSessions.push({
          id: session.id, name: session.name, agent: session.agent,
          cost: cost.cost.total || 0, tokens: cost.tokens.total || 0
        });
      }
    }

    result.byWorkspace.sort((a, b) => b.cost - a.cost);
    result.topSessions.sort((a, b) => b.cost - a.cost);
    result.topSessions = result.topSessions.slice(0, 10);

    return result;
  }

  clearCache(sessionId) {
    if (sessionId) this._cache.delete(sessionId);
    else this._cache.clear();
  }
}

// Singleton
let _instance = null;
function getCostTracker() {
  if (!_instance) _instance = new CostTracker();
  return _instance;
}

module.exports = { CostTracker, getCostTracker };
