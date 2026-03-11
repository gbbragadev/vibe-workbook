const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { GitOrchestrator } = require('../src/core/git-orchestrator');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-workbook-git-test-'));
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function setupMonorepo() {
  const dir = makeTempDir();
  const repoRoot = path.join(dir, 'mono');
  const productDir = path.join(repoRoot, 'products', 'polyagent');
  const siblingDir = path.join(repoRoot, 'vibe-workbook');

  fs.mkdirSync(path.join(productDir, 'docs'), { recursive: true });
  fs.mkdirSync(siblingDir, { recursive: true });
  fs.writeFileSync(path.join(productDir, 'docs', 'spec.md'), '# spec\n');
  fs.writeFileSync(path.join(siblingDir, 'README.md'), '# workspace\n');

  git(dir, 'init', repoRoot);
  git(repoRoot, 'config', 'user.name', 'Test User');
  git(repoRoot, 'config', 'user.email', 'test@example.com');
  git(repoRoot, 'add', '.');
  git(repoRoot, 'commit', '-m', 'initial');

  return { dir, repoRoot, productDir, siblingDir };
}

test('getDirtyState can be scoped to the product directory inside a monorepo', async () => {
  const { productDir, siblingDir } = setupMonorepo();
  fs.writeFileSync(path.join(siblingDir, 'README.md'), '# workspace changed\n');

  const orchestrator = new GitOrchestrator();
  const repoWideState = await orchestrator.getDirtyState(productDir);
  const scopedState = await orchestrator.getDirtyState(productDir, productDir);

  assert.equal(repoWideState.dirty, true);
  assert.equal(scopedState.dirty, false);
});

test('commitAll only stages and commits changes from the scoped product directory', async () => {
  const { repoRoot, productDir, siblingDir } = setupMonorepo();
  const productFile = path.join(productDir, 'docs', 'spec.md');
  const siblingFile = path.join(siblingDir, 'README.md');

  fs.writeFileSync(productFile, '# spec updated\n');
  fs.writeFileSync(siblingFile, '# sibling dirty\n');

  const orchestrator = new GitOrchestrator();
  const previousHead = git(repoRoot, 'rev-parse', 'HEAD');
  const nextHead = await orchestrator.commitAll(productDir, 'scoped checkpoint', productDir);
  const status = git(repoRoot, 'status', '--porcelain');
  const committedFiles = git(repoRoot, 'show', '--name-only', '--pretty=format:', 'HEAD');

  assert.notEqual(nextHead, previousHead);
  assert.match(status, /vibe-workbook\/README\.md/);
  assert.doesNotMatch(status, /products\/polyagent\/docs\/spec\.md/);
  assert.match(committedFiles, /products\/polyagent\/docs\/spec\.md/);
  assert.doesNotMatch(committedFiles, /vibe-workbook\/README\.md/);
});
