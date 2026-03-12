'use strict';

const path = require('path');
const fs = require('fs');
const { fileExists, ensureDir } = require('../utils/yaml-utils');
const { PROMPTS } = require('../utils/prompts');

const BRIEF_FILENAME = 'architecture-brief.md';

class BriefResolver {
  /**
   * Resolves the architecture brief for a work item.
   * Returns the cached brief if it already exists in runDir, otherwise generates it.
   * @param {object} workItem
   * @param {string} runDir - absolute path to the run output directory
   * @param {object} provider - provider instance with generate(lane, prompt, opts) → { content }
   * @returns {Promise<string>} architecture brief (markdown)
   */
  async resolveBrief(workItem, runDir, provider) {
    const briefPath = path.join(runDir, BRIEF_FILENAME);

    if (fileExists(briefPath)) {
      return fs.readFileSync(briefPath, 'utf8');
    }

    const prompt = PROMPTS.architecture(workItem);
    const result = await provider.generate('architecture', prompt);
    const content = result.content;

    ensureDir(runDir);
    fs.writeFileSync(briefPath, content, 'utf8');

    return content;
  }
}

module.exports = { BriefResolver };
