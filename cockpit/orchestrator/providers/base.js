'use strict';

/**
 * BaseProvider — abstract interface for all LLM providers.
 * Concrete providers must extend this class and override:
 *   - get name()
 *   - isAvailable()
 *   - generate(lane, prompt, opts)
 */
class BaseProvider {
  constructor(opts = {}) {
    this.opts = opts;
  }

  /**
   * Human-readable provider identifier.
   * @returns {string}
   */
  get name() {
    return 'base';
  }

  /**
   * Generates content for the given lane using the given prompt.
   * @param {string} lane    — e.g. 'architecture', 'planning', 'build', ...
   * @param {string} prompt  — full prompt string
   * @param {object} [opts]  — optional overrides (timeout, model, etc.)
   * @returns {Promise<{ content: string, provider: string, duration: number }>}
   */
  async generate(lane, prompt, opts = {}) {
    throw new Error(`Provider "${this.name}" has not implemented generate()`);
  }

  /**
   * Returns true when the provider's underlying CLI / service is reachable.
   * Must be synchronous and must NOT throw.
   * @returns {boolean}
   */
  isAvailable() {
    return true;
  }
}

module.exports = { BaseProvider };
