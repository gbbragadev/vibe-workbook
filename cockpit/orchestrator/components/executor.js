'use strict';

const { MockProvider } = require('../providers/mock');
const { PROMPTS } = require('../utils/prompts');
const logger = require('../utils/logger');

const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 2;

/**
 * Pauses execution for the given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class Executor {
  /**
   * Executes each lane using its assigned provider, with retry + mock fallback.
   *
   * @param {object[]} lanes          - array of lane objects (each has id, title, deliverable, ...)
   * @param {Map<string, object>} providerMap - laneId → providerInstance (from Router)
   * @param {object} evidenceStore    - EvidenceStore instance
   * @param {string} [workItemId]     - optional work item ID for context
   * @returns {Promise<Array<{ laneId, content, provider, duration, retries }>>}
   */
  async executeLanes(lanes, providerMap, evidenceStore, workItemId = 'unknown') {
    const results = [];
    const mockProvider = new MockProvider();

    for (const lane of lanes) {
      const laneId = lane.id;
      const provider = providerMap.get(laneId) || mockProvider;

      // Build a context object to pass to the prompt function
      const context = {
        id: workItemId,
        title: lane.title || laneId,
        objective: lane.deliverable || `Produce output for ${laneId}`,
        context: lane.deliverable || '',
        constraints: [],
        success_criteria: [],
      };

      // Resolve the prompt function for this lane
      const promptFn = PROMPTS[laneId] || PROMPTS['planning'];
      let prompt;
      try {
        prompt = promptFn(context);
      } catch (err) {
        logger.warn(`Executor: failed to build prompt for lane "${laneId}": ${err.message}`);
        prompt = `Execute lane: ${laneId}\nObjective: ${context.objective}`;
      }

      let result = null;
      let retries = 0;
      let lastError = null;

      // Attempt up to MAX_RETRIES times with the assigned provider
      while (retries < MAX_RETRIES) {
        try {
          result = await provider.generate(laneId, prompt);
          break; // success
        } catch (err) {
          lastError = err;
          retries++;
          logger.warn(
            `Executor: lane "${laneId}" attempt ${retries}/${MAX_RETRIES} failed — ${err.message}`
          );
          if (retries < MAX_RETRIES) {
            await sleep(RETRY_DELAY_MS);
          }
        }
      }

      // If all retries failed, fall back to mock
      if (!result) {
        logger.warn(
          `Executor: lane "${laneId}" exhausted ${MAX_RETRIES} retries — falling back to mock. Last error: ${lastError && lastError.message}`
        );
        try {
          result = await mockProvider.generate(laneId, prompt);
        } catch (err) {
          // Mock should never fail, but guard anyway
          logger.error(`Executor: mock fallback also failed for lane "${laneId}": ${err.message}`);
          result = {
            content: `[Error: could not generate content for lane ${laneId}]`,
            provider: 'mock',
            duration: 0,
          };
        }
      }

      const finalResult = {
        laneId,
        content: result.content,
        provider: result.provider || 'mock',
        duration: result.duration || 0,
        retries,
      };

      evidenceStore.addEvidence(laneId, finalResult);

      logger.lane(
        laneId,
        `executed: provider=${finalResult.provider}, chars=${finalResult.content.length}`
      );

      results.push(finalResult);
    }

    return results;
  }
}

module.exports = { Executor };
