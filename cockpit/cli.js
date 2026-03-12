#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { Orchestrator } = require('./orchestrator/index');

const [,, cmd, ...args] = process.argv;

function printHelp() {
  console.log(`
cockpit — Orchestrator CLI

Usage:
  node cockpit/cli.js <command> [options]

Commands:
  run <work-item-path>    Execute the full 12-step pipeline for a work item
  plan <work-item-path>   Execute planning only (steps 1-6, no lane execution)
  status [run-id]         Print the status of a run (or all runs if no ID given)
  list                    List all runs in cockpit/runs/

Examples:
  node cockpit/cli.js run cockpit/examples/idea-backlog.yaml
  node cockpit/cli.js plan cockpit/examples/idea-backlog.yaml
  node cockpit/cli.js status idea-backlog
  node cockpit/cli.js list
`);
}

async function cmdRun(workItemPath) {
  if (!workItemPath) {
    console.error('Error: run requires a work-item-path argument');
    console.error('Usage: node cockpit/cli.js run <work-item-path>');
    process.exit(1);
  }

  const orchestrator = new Orchestrator();
  await orchestrator.run(workItemPath);
}

async function cmdPlan(workItemPath) {
  if (!workItemPath) {
    console.error('Error: plan requires a work-item-path argument');
    console.error('Usage: node cockpit/cli.js plan <work-item-path>');
    process.exit(1);
  }

  const orchestrator = new Orchestrator();
  const result = await orchestrator.plan(workItemPath);

  console.log('\n── Plan Result ──────────────────────────────────────────');
  console.log(`Work Item : ${result.workItem.id} — ${result.workItem.title}`);
  console.log(`Objective : ${result.workItem.objective}`);
  console.log(`Run Dir   : ${result.runDir}`);
  console.log(`Brief     : ${result.brief.length} chars`);
  console.log(`\nTasks (${result.board.tasks ? result.board.tasks.length : 0}):`);
  if (result.board.tasks) {
    result.board.tasks.forEach((t) => {
      console.log(`  [${t.id}] ${t.title} → lane: ${t.lane}`);
    });
  }
  console.log(`\nLanes (${result.lanes.length}):`);
  result.lanes.forEach((l) => {
    const deps = l.depends_on && l.depends_on.length > 0 ? ` (depends: ${l.depends_on.join(', ')})` : '';
    console.log(`  [${l.id}] ${l.title}${deps}`);
  });
  console.log('─────────────────────────────────────────────────────────\n');
}

async function cmdStatus(runId) {
  const runsDir = path.resolve(process.cwd(), 'cockpit/runs');

  if (!fs.existsSync(runsDir)) {
    console.error(`No runs directory found at: ${runsDir}`);
    process.exit(1);
  }

  if (runId) {
    // Show status for a specific run
    const runJsonPath = path.join(runsDir, runId, 'run.json');
    if (!fs.existsSync(runJsonPath)) {
      console.error(`No run.json found for run "${runId}" at: ${runJsonPath}`);
      process.exit(1);
    }

    let runJson;
    try {
      runJson = JSON.parse(fs.readFileSync(runJsonPath, 'utf8'));
    } catch (err) {
      console.error(`Failed to parse run.json: ${err.message}`);
      process.exit(1);
    }

    console.log('\n── Run Status ───────────────────────────────────────────');
    console.log(`Run ID      : ${runJson.runId}`);
    console.log(`Work Item   : ${runJson.workItemId}`);
    console.log(`Status      : ${runJson.status}`);
    console.log(`Started     : ${runJson.startedAt || 'n/a'}`);
    console.log(`Completed   : ${runJson.completedAt || 'n/a'}`);
    console.log(`QA Score    : ${runJson.qaScore}/100 (${runJson.qaPassed ? 'PASSED' : 'FAILED'})`);
    if (runJson.lanes && runJson.lanes.length > 0) {
      console.log(`\nLanes (${runJson.lanes.length}):`);
      runJson.lanes.forEach((l) => {
        const executed = l.executed ? '✓' : '–';
        const provider = l.provider || 'n/a';
        const duration = l.duration != null ? `${l.duration}ms` : 'n/a';
        console.log(`  [${executed}] ${l.laneId} — provider: ${provider}, duration: ${duration}`);
      });
    }
    if (runJson.artifacts && runJson.artifacts.length > 0) {
      console.log(`\nArtifacts:`);
      runJson.artifacts.forEach((a) => console.log(`  - ${a}`));
    }
    console.log('─────────────────────────────────────────────────────────\n');
  } else {
    // No runId — delegate to list behavior
    await cmdList();
  }
}

async function cmdList() {
  const runsDir = path.resolve(process.cwd(), 'cockpit/runs');

  if (!fs.existsSync(runsDir)) {
    console.log('No runs directory found. No runs yet.');
    return;
  }

  let entries;
  try {
    entries = fs.readdirSync(runsDir, { withFileTypes: true });
  } catch (err) {
    console.error(`Failed to read runs directory: ${err.message}`);
    process.exit(1);
  }

  const runDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  if (runDirs.length === 0) {
    console.log('No runs found in cockpit/runs/');
    return;
  }

  console.log(`\n── Runs (${runDirs.length}) ─────────────────────────────────────────`);
  console.log(
    `${'Run ID'.padEnd(30)} ${'Status'.padEnd(12)} ${'QA Score'.padEnd(10)} Completed`
  );
  console.log('─'.repeat(80));

  for (const runId of runDirs) {
    const runJsonPath = path.join(runsDir, runId, 'run.json');

    if (!fs.existsSync(runJsonPath)) {
      console.log(`${runId.padEnd(30)} ${'(no run.json)'.padEnd(12)}`);
      continue;
    }

    let runJson;
    try {
      runJson = JSON.parse(fs.readFileSync(runJsonPath, 'utf8'));
    } catch {
      console.log(`${runId.padEnd(30)} ${'(parse error)'.padEnd(12)}`);
      continue;
    }

    const status = (runJson.status || 'unknown').padEnd(12);
    const qaScore = runJson.qaScore != null
      ? `${runJson.qaScore}/100`.padEnd(10)
      : 'n/a'.padEnd(10);
    const completedAt = runJson.completedAt
      ? runJson.completedAt.slice(0, 19).replace('T', ' ')
      : 'n/a';

    console.log(`${runId.padEnd(30)} ${status} ${qaScore} ${completedAt}`);
  }

  console.log('─'.repeat(80));
  console.log();
}

async function main() {
  switch (cmd) {
    case 'run':
      await cmdRun(args[0]);
      break;

    case 'plan':
      await cmdPlan(args[0]);
      break;

    case 'status':
      await cmdStatus(args[0]);
      break;

    case 'list':
      await cmdList();
      break;

    default:
      if (cmd && cmd !== '--help' && cmd !== '-h') {
        console.error(`Unknown command: "${cmd}"\n`);
      }
      printHelp();
      if (cmd && cmd !== '--help' && cmd !== '-h') {
        process.exit(1);
      }
      break;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
