'use strict';

const path = require('path');
const { readYaml, writeYaml, fileExists } = require('../utils/yaml-utils');
const { PROMPTS } = require('../utils/prompts');

const BOARD_FILENAME = 'task-board.yaml';

class BoardResolver {
  /**
   * Resolves the task board for a work item and brief.
   * Returns the cached board if it already exists in runDir, otherwise generates it.
   * @param {object} workItem
   * @param {string} brief - architecture brief (markdown string)
   * @param {string} runDir - absolute path to the run output directory
   * @param {object} provider - provider instance with generate(lane, prompt, opts) → { content }
   * @returns {Promise<object>} board object
   */
  async resolveBoard(workItem, brief, runDir, provider) {
    const boardPath = path.join(runDir, BOARD_FILENAME);

    if (fileExists(boardPath)) {
      return readYaml(boardPath);
    }

    const prompt = PROMPTS.planning(workItem, brief);
    const result = await provider.generate('planning', prompt);
    const content = result.content;

    const board = {
      work_item_id: workItem.id,
      generated_at: new Date().toISOString(),
      tasks: [
        { id: 'T-001', title: 'Architecture & Planning', lane: 'architecture', status: 'todo', depends_on: [] },
        { id: 'T-002', title: 'Research',                lane: 'research',     status: 'todo', depends_on: ['T-001'] },
        { id: 'T-003', title: 'Build',                   lane: 'build',        status: 'todo', depends_on: ['T-001'] },
        { id: 'T-004', title: 'QA',                      lane: 'qa',           status: 'todo', depends_on: ['T-003'] },
        { id: 'T-005', title: 'Evaluation',              lane: 'evaluation',   status: 'todo', depends_on: ['T-004'] },
      ],
      planning_notes: content,
    };

    writeYaml(boardPath, board);

    return board;
  }
}

module.exports = { BoardResolver };
