'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Reads and parses a YAML file synchronously.
 * @param {string} filePath
 * @returns {object}
 */
function readYaml(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return yaml.load(content);
}

/**
 * Serializes data to YAML and writes to file synchronously.
 * @param {string} filePath
 * @param {object} data
 */
function writeYaml(filePath, data) {
  ensureDir(path.dirname(filePath));
  const content = yaml.dump(data, { indent: 2, lineWidth: 120 });
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Reads and parses a JSON file synchronously.
 * @param {string} filePath
 * @returns {object}
 */
function readJson(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

/**
 * Serializes data to JSON and writes to file synchronously.
 * @param {string} filePath
 * @param {object} data
 * @param {number} [indent=2]
 */
function writeJson(filePath, data, indent = 2) {
  ensureDir(path.dirname(filePath));
  const content = JSON.stringify(data, null, indent);
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Creates a directory (and all parent directories) if it does not exist.
 * @param {string} dirPath
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Returns true if the file exists at the given path.
 * @param {string} filePath
 * @returns {boolean}
 */
function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies a file from src to dest synchronously.
 * Creates destination directory if it does not exist.
 * @param {string} src
 * @param {string} dest
 */
function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

module.exports = {
  readYaml,
  writeYaml,
  readJson,
  writeJson,
  ensureDir,
  fileExists,
  copyFile,
};
