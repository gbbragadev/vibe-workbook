const test = require('node:test');
const assert = require('node:assert/strict');

const { AgentAdapter } = require('../src/core/agent-adapter');
const ClaudeAdapter = require('../src/core/agents/claude-adapter');

test('buildSpawnEnv removes inherited variables overridden with null', () => {
  class TestAdapter extends AgentAdapter {
    getEnv() {
      return {
        KEEP_ME: 'override',
        REMOVE_ME: null
      };
    }
  }

  const adapter = new TestAdapter({ agent: 'test' });
  const env = adapter.buildSpawnEnv({
    KEEP_ME: 'base',
    REMOVE_ME: 'present',
    UNCHANGED: 'value'
  });

  assert.equal(env.KEEP_ME, 'override');
  assert.equal(env.UNCHANGED, 'value');
  assert.equal('REMOVE_ME' in env, false);
});

test('claude adapter unsets CLAUDECODE for spawned sessions', () => {
  const adapter = new ClaudeAdapter({ agent: 'claude' });
  const env = adapter.buildSpawnEnv({
    CLAUDECODE: '1',
    PATH: process.env.PATH || ''
  });

  assert.equal('CLAUDECODE' in env, false);
  assert.equal(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
});

test('claude adapter strips CLAUDECODE in shell command on windows', () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });

  try {
    const adapter = new ClaudeAdapter({ agent: 'claude', model: 'claude-sonnet-4-6' });
    const command = adapter.buildCommand({});
    assert.match(command, /\$env:CLAUDECODE=\$null/);
    assert.match(command, /Remove-Item Env:CLAUDECODE/);
    assert.match(command, /claude --model claude-sonnet-4-6/);
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  }
});
