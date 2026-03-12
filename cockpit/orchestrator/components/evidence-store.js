'use strict';

const path = require('path');
const { writeYaml, ensureDir } = require('../utils/yaml-utils');

const MANIFEST_FILENAME = 'evidence-manifest.yaml';

class EvidenceStore {
  /**
   * @param {string} runDir - absolute path to the run output directory
   */
  constructor(runDir) {
    if (!runDir || typeof runDir !== 'string') {
      throw new Error('EvidenceStore: runDir must be a non-empty string');
    }
    this.runDir = runDir;
    this.runId = Date.now().toString();
    /** @type {Map<string, { content: string, provider: string, duration: number }>} */
    this._evidence = new Map();
  }

  /**
   * Stores an evidence entry for a lane.
   * The full content is kept in memory; only an excerpt is written to YAML.
   *
   * @param {string} laneId
   * @param {{ content: string, provider: string, duration: number }} result
   */
  addEvidence(laneId, result) {
    if (!laneId || typeof laneId !== 'string') {
      throw new Error('EvidenceStore.addEvidence: laneId must be a non-empty string');
    }
    if (!result || typeof result !== 'object') {
      throw new Error('EvidenceStore.addEvidence: result must be an object');
    }
    this._evidence.set(laneId, {
      content: result.content || '',
      provider: result.provider || 'unknown',
      duration: result.duration || 0,
    });
  }

  /**
   * Retrieves the stored evidence for a lane.
   * @param {string} laneId
   * @returns {{ content: string, provider: string, duration: number } | null}
   */
  getEvidence(laneId) {
    return this._evidence.get(laneId) || null;
  }

  /**
   * Returns all stored evidence as a plain object (laneId → evidence).
   * @returns {object}
   */
  getAllEvidence() {
    const result = {};
    for (const [laneId, entry] of this._evidence) {
      result[laneId] = entry;
    }
    return result;
  }

  /**
   * Writes evidence-manifest.yaml to runDir.
   * The full content is NOT written — only a 200-char excerpt.
   */
  save() {
    ensureDir(this.runDir);

    const evidenceYaml = {};
    for (const [laneId, entry] of this._evidence) {
      evidenceYaml[laneId] = {
        provider: entry.provider,
        duration_ms: entry.duration,
        content_length: entry.content.length,
        excerpt: entry.content.slice(0, 200),
      };
    }

    const manifest = {
      run_id: this.runId,
      evidence: evidenceYaml,
    };

    const manifestPath = path.join(this.runDir, MANIFEST_FILENAME);
    try {
      writeYaml(manifestPath, manifest);
    } catch (err) {
      throw new Error(`EvidenceStore.save: failed to write manifest — ${err.message}`);
    }
  }
}

module.exports = { EvidenceStore };
