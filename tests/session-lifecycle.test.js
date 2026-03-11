'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/state/store');

function makeStore() {
  const s = new Store();
  s._save = () => {};
  s.state = { version: 1, workspaces: {}, sessions: {}, activeWorkspace: null,
    workspaceOrder: [], settings: {} };
  return s;
}

test('createSession initializes lifecycle fields', () => {
  const store = makeStore();
  const ws = store.createWorkspace({ name: 'w' });
  const sess = store.createSession({ name: 's', workspaceId: ws.id });
  assert.equal(sess.lifecycleState, 'spawning');
  assert.equal(sess.awaitingInput, false);
  assert.equal(sess.awaitingInputReason, '');
  assert.equal(sess.completionState, null);
  assert.equal(sess.lifecycleTransitionAt, null);
  assert.equal(sess.bootstrapState, 'pending');
});

test('updateSession can transition lifecycleState', () => {
  const store = makeStore();
  const ws = store.createWorkspace({ name: 'w' });
  const sess = store.createSession({ name: 's', workspaceId: ws.id });
  const updated = store.updateSession(sess.id, { lifecycleState: 'running', lifecycleTransitionAt: Date.now() });
  assert.equal(updated.lifecycleState, 'running');
  assert.ok(updated.lifecycleTransitionAt > 0);
});
