'use strict';

const chalk = require('chalk');

/**
 * Returns the current time as HH:MM:SS string.
 * @returns {string}
 */
function timestamp() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

const logger = {
  /**
   * Logs an informational message with a cyan [INFO] prefix.
   * @param {string} msg
   */
  info(msg) {
    console.log(`${chalk.cyan('[INFO]')}  ${chalk.dim(timestamp())} ${msg}`);
  },

  /**
   * Logs a warning message with a yellow [WARN] prefix.
   * @param {string} msg
   */
  warn(msg) {
    console.log(`${chalk.yellow('[WARN]')}  ${chalk.dim(timestamp())} ${msg}`);
  },

  /**
   * Logs an error message with a red [ERROR] prefix.
   * @param {string} msg
   */
  error(msg) {
    console.log(`${chalk.red('[ERROR]')} ${chalk.dim(timestamp())} ${msg}`);
  },

  /**
   * Logs a success message with a green [DONE] prefix.
   * @param {string} msg
   */
  done(msg) {
    console.log(`${chalk.green('[DONE]')}  ${chalk.dim(timestamp())} ${msg}`);
  },

  /**
   * Logs a step message with a blue [n/total] prefix.
   * @param {number} n      - current step number
   * @param {number} total  - total number of steps
   * @param {string} msg
   */
  step(n, total, msg) {
    console.log(`${chalk.blue(`[${n}/${total}]`)} ${chalk.dim(timestamp())} ${msg}`);
  },

  /**
   * Logs a lane message with a magenta [LANE:name] prefix.
   * @param {string} name - lane name
   * @param {string} msg
   */
  lane(name, msg) {
    console.log(`${chalk.magenta(`[LANE:${name}]`)} ${chalk.dim(timestamp())} ${msg}`);
  },
};

module.exports = logger;
