'use strict';

const fs = require('fs');
const path = require('path');

const { Intake } = require('./components/intake');
const { Gate } = require('./components/gate');
const { BriefResolver } = require('./components/brief-resolver');
const { BoardResolver } = require('./components/board-resolver');
const { LaneResolver } = require('./components/lane-resolver');
const { Router } = require('./components/router');
const { Executor } = require('./components/executor');
const { EvidenceStore } = require('./components/evidence-store');
const { QAEvaluator } = require('./components/qa-evaluator');
const { Summarizer } = require('./components/summarizer');

const { MockProvider } = require('./providers/mock');
const { GeminiProvider } = require('./providers/gemini');
const { CodexProvider } = require('./providers/codex');
const { ClaudeProvider } = require('./providers/claude');

const { readYaml, ensureDir, copyFile } = require('./utils/yaml-utils');
const logger = require('./utils/logger');

class Orchestrator {
  /**
   * @param {object} opts
   * @param {string} [opts.workDir]     - base directory for runs (default: 'cockpit/runs')
   * @param {string} [opts.pocDir]      - directory for PoC output (default: 'poc')
   * @param {string} [opts.templateDir] - directory for templates (default: 'cockpit/templates')
   */
  constructor(opts = {}) {
    const cwd = process.cwd();
    this.workDir = path.resolve(cwd, opts.workDir || 'cockpit/runs');
    this.pocBaseDir = path.resolve(cwd, opts.pocDir || 'poc');
    this.templateDir = path.resolve(cwd, opts.templateDir || 'cockpit/templates');
  }

  /**
   * Executes the full 12-step pipeline for a work item.
   *
   * @param {string} workItemPath - path to the work-item.yaml file
   * @returns {Promise<{ workItem, runDir, qaResult, summary, runJson }>}
   */
  async run(workItemPath) {
    const resolvedWorkItemPath = path.resolve(process.cwd(), workItemPath);

    const intake = new Intake();
    const gate = new Gate();
    const briefResolver = new BriefResolver();
    const boardResolver = new BoardResolver();
    const laneResolver = new LaneResolver();
    const executor = new Executor();
    const qaEvaluator = new QAEvaluator();
    const summarizer = new Summarizer();

    // ── Step 1: Intake ────────────────────────────────────────────────────────
    const workItem = intake.loadWorkItem(resolvedWorkItemPath);
    logger.step(1, 12, `Loaded work item: ${workItem.id}`);

    // ── Step 2: Create runDir and copy work-item ──────────────────────────────
    const runDir = path.join(this.workDir, workItem.id);
    ensureDir(runDir);
    copyFile(resolvedWorkItemPath, path.join(runDir, 'work-item.yaml'));
    logger.step(2, 12, `Run directory ready: ${runDir}`);

    // ── Step 3: BriefResolver ─────────────────────────────────────────────────
    const planningProvider = new MockProvider();
    const brief = await briefResolver.resolveBrief(workItem, runDir, planningProvider);
    logger.step(3, 12, `Architecture brief resolved (${brief.length} chars)`);

    // ── Step 4: Gate ──────────────────────────────────────────────────────────
    const gateResult = gate.validateArchitectureGate(brief);
    if (!gateResult.passed) {
      logger.error('Architecture gate failed. Aborting run.');
      gateResult.checks
        .filter((c) => !c.passed)
        .forEach((c) => logger.warn(`  ✗ ${c.question}`));
      throw new Error('Architecture gate failed');
    }
    logger.step(4, 12, `Architecture gate passed (${gateResult.checks.length} checks)`);

    // ── Step 5: BoardResolver ─────────────────────────────────────────────────
    const board = await boardResolver.resolveBoard(workItem, brief, runDir, planningProvider);
    logger.step(5, 12, `Task board resolved (${board.tasks ? board.tasks.length : 0} tasks)`);

    // ── Step 6: LaneResolver ──────────────────────────────────────────────────
    const lanes = await laneResolver.resolveLanes(workItem, board, runDir, planningProvider);
    logger.step(6, 12, `Lanes resolved (${lanes.length} lanes)`);

    // ── Step 7: Router ────────────────────────────────────────────────────────
    const routingYamlPath = path.join(this.templateDir, 'provider-routing.yaml');
    let routingYaml = {};
    try {
      routingYaml = readYaml(routingYamlPath);
    } catch (err) {
      logger.warn(`Router: could not read provider-routing.yaml — ${err.message}. Using mock for all lanes.`);
    }

    const providers = {
      mock: new MockProvider(),
      gemini: new GeminiProvider(),
      codex: new CodexProvider(),
      claude: new ClaudeProvider(),
    };
    const router = new Router(providers);
    const providerMap = router.buildRoutingMap(lanes, routingYaml);
    logger.step(7, 12, `Routing map built for ${providerMap.size} lanes`);

    // ── Step 8: Executor ──────────────────────────────────────────────────────
    const evidenceStore = new EvidenceStore(runDir);
    await executor.executeLanes(lanes, providerMap, evidenceStore, workItem.id);
    logger.step(8, 12, `Lanes executed`);

    // ── Step 9: EvidenceStore save ────────────────────────────────────────────
    evidenceStore.save();
    logger.step(9, 12, `Evidence manifest saved`);

    // ── Step 10: QAEvaluator ──────────────────────────────────────────────────
    const buildEvidence = evidenceStore.getEvidence('build');
    if (buildEvidence && buildEvidence.content) {
      const pocDir = path.join(this.pocBaseDir, 'idea-backlog');
      ensureDir(pocDir);
      fs.writeFileSync(path.join(pocDir, 'index.html'), buildEvidence.content, 'utf8');
      logger.done(`PoC written to ${pocDir}/index.html`);
    }
    const qaResult = await qaEvaluator.evaluate(board, evidenceStore, runDir);
    logger.step(10, 12, `QA evaluation complete — score: ${qaResult.score}/100`);

    // ── Step 11: Summarizer ───────────────────────────────────────────────────
    const { summary, runJson } = summarizer.summarize(workItem, board, evidenceStore, qaResult, runDir);
    logger.step(11, 12, `Summary generated`);

    // ── Step 12: Print final summary ──────────────────────────────────────────
    logger.step(12, 12, `Run finished`);
    logger.done('='.repeat(60));
    logger.done(`Run complete: ${workItem.id}`);
    logger.done(`QA Score: ${qaResult.score}/100 (${qaResult.passed ? 'PASSED' : 'FAILED'})`);
    logger.done(`Run dir: ${runDir}`);
    logger.done(`Summary: ${path.join(runDir, 'summary.md')}`);
    logger.done('='.repeat(60));

    return { workItem, runDir, qaResult, summary, runJson };
  }

  /**
   * Executes only steps 1-6 (planning only, no execution).
   *
   * @param {string} workItemPath - path to the work-item.yaml file
   * @returns {Promise<{ workItem, runDir, brief, board, lanes }>}
   */
  async plan(workItemPath) {
    const resolvedWorkItemPath = path.resolve(process.cwd(), workItemPath);

    const intake = new Intake();
    const gate = new Gate();
    const briefResolver = new BriefResolver();
    const boardResolver = new BoardResolver();
    const laneResolver = new LaneResolver();

    // ── Step 1: Intake ────────────────────────────────────────────────────────
    const workItem = intake.loadWorkItem(resolvedWorkItemPath);
    logger.step(1, 6, `Loaded work item: ${workItem.id}`);

    // ── Step 2: Create runDir and copy work-item ──────────────────────────────
    const runDir = path.join(this.workDir, workItem.id);
    ensureDir(runDir);
    copyFile(resolvedWorkItemPath, path.join(runDir, 'work-item.yaml'));
    logger.step(2, 6, `Run directory ready: ${runDir}`);

    // ── Step 3: BriefResolver ─────────────────────────────────────────────────
    const planningProvider = new MockProvider();
    const brief = await briefResolver.resolveBrief(workItem, runDir, planningProvider);
    logger.step(3, 6, `Architecture brief resolved (${brief.length} chars)`);

    // ── Step 4: Gate ──────────────────────────────────────────────────────────
    const gateResult = gate.validateArchitectureGate(brief);
    if (!gateResult.passed) {
      logger.error('Architecture gate failed. Aborting plan.');
      gateResult.checks
        .filter((c) => !c.passed)
        .forEach((c) => logger.warn(`  ✗ ${c.question}`));
      throw new Error('Architecture gate failed');
    }
    logger.step(4, 6, `Architecture gate passed`);

    // ── Step 5: BoardResolver ─────────────────────────────────────────────────
    const board = await boardResolver.resolveBoard(workItem, brief, runDir, planningProvider);
    logger.step(5, 6, `Task board resolved (${board.tasks ? board.tasks.length : 0} tasks)`);

    // ── Step 6: LaneResolver ──────────────────────────────────────────────────
    const lanes = await laneResolver.resolveLanes(workItem, board, runDir, planningProvider);
    logger.step(6, 6, `Lanes resolved (${lanes.length} lanes)`);

    return { workItem, runDir, brief, board, lanes };
  }
}

module.exports = { Orchestrator };
