'use strict';

const logger = require('../utils/logger');

class Router {
  /**
   * @param {object} providers - map of { mock, gemini, codex, claude }
   */
  constructor(providers) {
    if (!providers || typeof providers !== 'object') {
      throw new Error('Router: providers must be an object');
    }
    this.providers = providers;
  }

  /**
   * Builds a routing map from lane IDs to provider instances.
   * Resolution order: preferred_provider → fallback_provider → mock
   *
   * @param {object[]} lanes - array of lane objects with at least an `id` field
   * @param {object}   routingYaml - parsed provider-routing.yaml content
   * @returns {Map<string, object>} map of laneId → providerInstance
   */
  buildRoutingMap(lanes, routingYaml) {
    const map = new Map();
    const laneRouting = (routingYaml && routingYaml.lane_routing) || {};
    const mock = this.providers.mock;

    for (const lane of lanes) {
      const laneId = lane.id;
      const routing = laneRouting[laneId] || {};
      const preferredName = routing.preferred_provider;
      const fallbackName = routing.fallback_provider;

      let resolved = null;
      let resolvedName = null;

      // Try preferred provider
      if (preferredName) {
        const preferred = this.providers[preferredName];
        if (preferred && typeof preferred.isAvailable === 'function' && preferred.isAvailable()) {
          resolved = preferred;
          resolvedName = preferredName;
        }
      }

      // Try fallback provider
      if (!resolved && fallbackName) {
        const fallback = this.providers[fallbackName];
        if (fallback && typeof fallback.isAvailable === 'function' && fallback.isAvailable()) {
          resolved = fallback;
          resolvedName = fallbackName;
        }
      }

      // Last resort: mock
      if (!resolved) {
        resolved = mock;
        resolvedName = 'mock';
      }

      map.set(laneId, resolved);
      logger.lane(laneId, `routed to provider: ${resolvedName}`);
    }

    return map;
  }
}

module.exports = { Router };
