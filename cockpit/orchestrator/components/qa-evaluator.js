'use strict';

const fs = require('fs');
const path = require('path');
const { writeYaml, ensureDir, fileExists } = require('../utils/yaml-utils');
const logger = require('../utils/logger');

// Lazy-load Playwright — may not be installed
let chromium;
try {
  ({ chromium } = require('@playwright/test'));
} catch {
  chromium = null;
}

/** data-testids required in the build artifact */
const REQUIRED_TESTIDS = [
  'idea-title-input',
  'idea-priority-select',
  'add-idea-btn',
  'idea-list',
  'idea-item',
  'remove-idea-btn',
];

/** HTML structural markers that earn bonus points */
const BONUS_PATTERNS = [
  { pattern: /<html/i, label: 'has <html' },
  { pattern: /<head/i, label: 'has <head' },
  { pattern: /<body/i, label: 'has <body' },
  { pattern: /localStorage/,  label: 'uses localStorage' },
];

const BONUS_POINTS_EACH = 10;
const MAX_BONUS = 40;

class QAEvaluator {
  /**
   * Evaluates the evidence collected for the run.
   *
   * @param {object}   board          - task board (has `tasks` array)
   * @param {object}   evidenceStore  - EvidenceStore instance
   * @param {string}   runDir         - absolute path to the run output directory
   * @returns {Promise<{ score: number, passed: boolean, checks: object[], report: string }>}
   */
  async evaluate(board, evidenceStore, runDir) {
    const checks = [];
    let playwrightResult = null;

    // ── 1. Check build evidence exists ───────────────────────────────────────
    const buildEvidence = evidenceStore.getEvidence('build');
    if (!buildEvidence) {
      const report = this._writeReport(runDir, 0, false, checks, '(no build evidence)');
      return { score: 0, passed: false, checks, report };
    }

    const html = buildEvidence.content || '';
    const allEvidence = evidenceStore.getAllEvidence();
    const totalLanes = board && board.tasks ? board.tasks.length : Object.keys(allEvidence).length;
    const lanesWithEvidence = Object.keys(allEvidence).length;

    // ── 2. Check presence of required data-testids ───────────────────────────
    let testidsFound = 0;
    for (const testid of REQUIRED_TESTIDS) {
      const found = html.includes(`data-testid="${testid}"`);
      checks.push({ testid, found });
      if (found) testidsFound++;
    }

    // ── 3. Base score ─────────────────────────────────────────────────────────
    const testidScore = totalLanes > 0
      ? (testidsFound / REQUIRED_TESTIDS.length) * 60 + (lanesWithEvidence / totalLanes) * 40
      : (testidsFound / REQUIRED_TESTIDS.length) * 60;

    // ── 4. Bonus points for structural HTML markers ───────────────────────────
    let bonusPoints = 0;
    const bonusChecks = [];
    for (const bonus of BONUS_PATTERNS) {
      const found = bonus.pattern.test(html);
      bonusChecks.push({ label: bonus.label, found });
      if (found) bonusPoints += BONUS_POINTS_EACH;
    }
    bonusPoints = Math.min(bonusPoints, MAX_BONUS);

    const rawScore = testidScore + bonusPoints;
    const score = Math.min(Math.round(rawScore), 100);
    const passed = score >= 60;

    // ── 5. Playwright screenshot (best-effort) ────────────────────────────────
    const pocHtmlPath = path.join(runDir, '..', '..', '..', 'poc', 'idea-backlog', 'index.html');

    if (chromium && fileExists(pocHtmlPath)) {
      playwrightResult = await this._runPlaywright(pocHtmlPath, runDir);
    } else if (!chromium) {
      playwrightResult = 'skipped (Playwright not available)';
      logger.warn('QAEvaluator: @playwright/test not available — skipping screenshot');
    } else {
      playwrightResult = `skipped (poc file not found at ${pocHtmlPath})`;
      logger.warn(`QAEvaluator: poc HTML not found at "${pocHtmlPath}" — skipping screenshot`);
    }

    const allChecks = [
      ...checks.map(c => ({ type: 'testid', ...c })),
      ...bonusChecks.map(c => ({ type: 'bonus', ...c })),
    ];

    const report = this._writeReport(runDir, score, passed, allChecks, playwrightResult);

    return { score, passed, checks: allChecks, report };
  }

  /**
   * Attempts to take a Playwright screenshot of the built HTML.
   * @param {string} htmlPath  - absolute path to the HTML file
   * @param {string} runDir    - run directory to place the screenshot
   * @returns {Promise<string>} - result message
   */
  async _runPlaywright(htmlPath, runDir) {
    const screenshotsDir = path.join(runDir, 'screenshots');
    ensureDir(screenshotsDir);
    const screenshotPath = path.join(screenshotsDir, 'qa-01.png');

    // Normalize path for file:// URL (Windows paths need forward slashes)
    const normalizedHtmlPath = htmlPath.replace(/\\/g, '/');
    const fileUrl = `file:///${normalizedHtmlPath}`;

    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(fileUrl, { waitUntil: 'networkidle' });
      await page.screenshot({ path: screenshotPath, fullPage: true });
      logger.done(`QAEvaluator: screenshot saved to ${screenshotPath}`);
      return `screenshot saved: ${screenshotPath}`;
    } catch (err) {
      logger.warn(`QAEvaluator: Playwright screenshot failed — ${err.message}`);
      return `failed: ${err.message}`;
    } finally {
      if (browser) {
        try { await browser.close(); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Writes qa-report.md and returns its content as a string.
   * @param {string}   runDir
   * @param {number}   score
   * @param {boolean}  passed
   * @param {object[]} checks
   * @param {string|null} playwrightResult
   * @returns {string} report content
   */
  _writeReport(runDir, score, passed, checks, playwrightResult) {
    const verdict = passed ? 'PASSED' : 'FAILED';
    const lines = [
      '# QA Report',
      '',
      `**Score:** ${score}/100`,
      `**Verdict:** ${verdict}`,
      '',
      '## Checks',
      '',
    ];

    for (const check of checks) {
      if (check.type === 'testid') {
        const mark = check.found ? '✓' : '✗';
        lines.push(`- [${mark}] data-testid="${check.testid}"`);
      } else if (check.type === 'bonus') {
        const mark = check.found ? '✓' : '✗';
        lines.push(`- [${mark}] Bonus: ${check.label}`);
      }
    }

    lines.push('');
    lines.push('## Playwright');
    lines.push('');
    lines.push(playwrightResult ? String(playwrightResult) : 'not attempted');
    lines.push('');

    const content = lines.join('\n');

    ensureDir(runDir);
    const reportPath = path.join(runDir, 'qa-report.md');
    try {
      fs.writeFileSync(reportPath, content, 'utf8');
      logger.done(`QAEvaluator: report written to ${reportPath}`);
    } catch (err) {
      logger.error(`QAEvaluator: failed to write qa-report.md — ${err.message}`);
    }

    return content;
  }
}

module.exports = { QAEvaluator };
