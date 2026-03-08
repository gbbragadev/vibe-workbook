const fs = require('fs');
const path = require('path');
const { getGitOrchestrator } = require('./src/core/git-orchestrator');
const { execSync } = require('child_process');

async function test() {
  const dir = path.join(__dirname, 'test-rollback-sandbox');
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir);

  console.log('--- Setting up Git sandbox ---');
  try {
    execSync('git init', { cwd: dir });
    execSync('git config user.name "Tester"', { cwd: dir });
    execSync('git config user.email "test@example.com"', { cwd: dir });
    fs.writeFileSync(path.join(dir, 'app.txt'), 'Hello v1');
    execSync('git add . && git commit -m "initial commit" --allow-empty', { cwd: dir });
  } catch (e) {
    console.error('Failed to init git repo:', e.message);
    return;
  }

  const git = getGitOrchestrator();
  
  const isRepo = await git.isRepo(dir);
  console.log('isRepo:', isRepo);

  console.log('--- Committing Pre-Run Checkpoint ---');
  const hash = await git.commitAll(dir, '[vibe-chkpt] Pre-Run Checkpoint');
  console.log('Generated Checkpoint Hash:', hash);

  console.log('--- Simulating Run Modifying Files ---');
  fs.writeFileSync(path.join(dir, 'app.txt'), 'Hello v2 - THIS WAS A MISTAKE!');
  fs.writeFileSync(path.join(dir, 'new-file.txt'), 'This file should be removed.');
  const dirtyRun = await git.isDirty(dir);
  console.log('Run modified files. Dirty:', dirtyRun);

  console.log('--- Hard Resetting to Checkpoint ---');
  await git.hardReset(dir, hash);

  const newAppCtx = fs.readFileSync(path.join(dir, 'app.txt'), 'utf8');
  console.log('App content after rollback:', newAppCtx);
  const newFileExists = fs.existsSync(path.join(dir, 'new-file.txt'));
  console.log('New file exists?', newFileExists);

  if (newAppCtx === 'Hello v1' && !newFileExists) {
    console.log('SUCCESS: Rollback worked correctly.');
  } else {
    console.log('ERROR: Rollback failed.');
  }

  fs.rmSync(dir, { recursive: true, force: true });
}

test().catch(console.error);
