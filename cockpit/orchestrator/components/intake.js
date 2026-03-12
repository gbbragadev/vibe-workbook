'use strict';

const { readYaml } = require('../utils/yaml-utils');

const REQUIRED_FIELDS = ['id', 'title', 'objective', 'status'];

class Intake {
  /**
   * Reads and validates a work-item.yaml file.
   * @param {string} filePath - absolute path to the work-item.yaml
   * @returns {object} workItem
   * @throws {Error} if validation fails
   */
  loadWorkItem(filePath) {
    let workItem;
    try {
      workItem = readYaml(filePath);
    } catch (err) {
      throw new Error(`Intake: failed to read work item at "${filePath}": ${err.message}`);
    }

    const { valid, errors } = this.validate(workItem);
    if (!valid) {
      throw new Error(`Intake: invalid work item — ${errors.join('; ')}`);
    }

    return workItem;
  }

  /**
   * Validates a work item object.
   * @param {object} workItem
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate(workItem) {
    const errors = [];

    if (!workItem || typeof workItem !== 'object') {
      return { valid: false, errors: ['work item is not a valid object'] };
    }

    for (const field of REQUIRED_FIELDS) {
      if (!workItem[field]) {
        errors.push(`missing required field: "${field}"`);
      }
    }

    if (workItem.status && workItem.status !== 'ready') {
      // warn but do not block
      console.warn(`Intake: work item status is "${workItem.status}", expected "ready"`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

module.exports = { Intake };
