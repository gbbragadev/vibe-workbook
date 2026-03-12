'use strict';

const fs = require('fs');
const path = require('path');
const { writeJson, ensureDir } = require('../utils/yaml-utils');
const logger = require('../utils/logger');

class Summarizer {
  /**
   * Produces summary.md and run.json in runDir, then returns both.
   *
   * @param {object} workItem      - work item object (id, title, objective, ...)
   * @param {object} board         - task board object (has `tasks` array)
   * @param {object} evidenceStore - EvidenceStore instance
   * @param {object} qaResult      - { score, passed, checks, report }
   * @param {string} runDir        - absolute path to the run output directory
   * @returns {{ summary: string, runJson: object }}
   */
  summarize(workItem, board, evidenceStore, qaResult, runDir) {
    ensureDir(runDir);

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // e.g. 2026-03-11
    const completedAt = now.toISOString();

    // Use workItem.startedAt if available, else fall back to now
    const startedAt = workItem.startedAt || completedAt;

    const qaScore = (qaResult && qaResult.score != null) ? qaResult.score : 0;
    const qaPassed = (qaResult && qaResult.passed != null) ? qaResult.passed : false;
    const qaVerdict = qaPassed ? 'passed' : 'failed';

    // ── 1. Build lane table rows ──────────────────────────────────────────────
    const lanes = board && board.tasks ? board.tasks : [];
    const allEvidence = evidenceStore.getAllEvidence();

    const laneRows = lanes.map((task) => {
      const laneId = task.lane || task.id;
      const ev = allEvidence[laneId];
      const providerName = ev ? ev.provider : 'n/a';
      const durationRaw = ev ? ev.duration : 0;
      const durationStr = durationRaw >= 1000
        ? `${(durationRaw / 1000).toFixed(0)}s`
        : `${durationRaw}ms`;
      const status = ev ? '✓' : '–';
      return `| ${laneId} | ${providerName} | ${durationStr} | ${status} |`;
    });

    // ── 2. Build summary.md ───────────────────────────────────────────────────
    const workItemId = workItem.id || 'unknown';
    const summaryLines = [
      `# Run Summary: ${workItemId}`,
      '',
      `**Status:** completed`,
      `**Date:** ${dateStr}`,
      `**QA Score:** ${qaScore}/100 (${qaVerdict})`,
      '',
      '## Work Item',
      `- **Title:** ${workItem.title || '(no title)'}`,
      `- **Objective:** ${workItem.objective || '(no objective)'}`,
      '',
      '## Lanes Executed',
      '| Lane | Provider | Duration | Status |',
      '|------|----------|----------|--------|',
      ...laneRows,
      '',
      '## QA Results',
      `Score: ${qaScore}/100 — ${qaVerdict}`,
      '',
      '## Next Step',
      'Review poc/idea-backlog/index.html and run it in the browser.',
      '',
    ];

    const summary = summaryLines.join('\n');

    const summaryPath = path.join(runDir, 'summary.md');
    try {
      fs.writeFileSync(summaryPath, summary, 'utf8');
      logger.done(`Summarizer: summary.md written to ${summaryPath}`);
    } catch (err) {
      logger.error(`Summarizer: failed to write summary.md — ${err.message}`);
    }

    // ── 3. Build run.json ─────────────────────────────────────────────────────
    const runId = `${workItemId}-${dateStr.replace(/-/g, '')}`;

    const lanesForJson = lanes.map((task) => {
      const laneId = task.lane || task.id;
      const ev = allEvidence[laneId];
      return {
        laneId,
        taskId: task.id,
        title: task.title,
        provider: ev ? ev.provider : null,
        duration: ev ? ev.duration : null,
        executed: !!ev,
      };
    });

    const artifacts = [
      'architecture-brief.md',
      'task-board.yaml',
      'agent-lanes.yaml',
      'evidence-manifest.yaml',
      'qa-report.md',
      'summary.md',
    ];

    const runJson = {
      runId,
      workItemId,
      status: 'completed',
      startedAt,
      completedAt,
      qaScore,
      qaPassed,
      lanes: lanesForJson,
      artifacts,
    };

    const runJsonPath = path.join(runDir, 'run.json');
    try {
      writeJson(runJsonPath, runJson, 2);
      logger.done(`Summarizer: run.json written to ${runJsonPath}`);
    } catch (err) {
      logger.error(`Summarizer: failed to write run.json — ${err.message}`);
    }

    return { summary, runJson };
  }
}

module.exports = { Summarizer };
