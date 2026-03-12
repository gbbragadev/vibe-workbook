'use strict';

const path = require('path');
const { readYaml, writeYaml, fileExists } = require('../utils/yaml-utils');

const LANES_FILENAME = 'agent-lanes.yaml';

class LaneResolver {
  /**
   * Resolves the agent lanes from the task board.
   * Returns the cached lanes if they already exist in runDir, otherwise derives them from the board.
   * @param {object} workItem
   * @param {object} board - task board object (produced by BoardResolver)
   * @param {string} runDir - absolute path to the run output directory
   * @param {object} provider - provider instance (unused here; reserved for future use)
   * @returns {Promise<object[]>} lanes array
   */
  async resolveLanes(workItem, board, runDir, provider) {
    const lanesPath = path.join(runDir, LANES_FILENAME);

    if (fileExists(lanesPath)) {
      const stored = readYaml(lanesPath);
      return stored.lanes;
    }

    const lanes = board.tasks.map((task) => ({
      id: task.lane,
      task_id: task.id,
      title: task.title,
      status: 'pending',
      provider: null,
      depends_on: task.depends_on,
      deliverable: `Output for ${task.title}`,
      entry_conditions: task.depends_on.map((d) => `${d} complete`),
      exit_conditions: [`${task.title} artifact produced`],
    }));

    writeYaml(lanesPath, {
      work_item_id: workItem.id,
      lanes,
    });

    return lanes;
  }
}

module.exports = { LaneResolver };
