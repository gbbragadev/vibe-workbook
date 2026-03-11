'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  handleAwaitingInput, handleResolve, handleComplete, handleFail
} = require('../src/web/routes/worker-control-routes');

function mkStore(initialSession) {
  const sessions = initialSession ? { [initialSession.id]: { ...initialSession } } : {};
  return {
    getSession: (id) => sessions[id] || null,
    updateSession: (id, u) => { sessions[id] = { ...sessions[id], ...u, id }; return sessions[id]; },
    addSessionLog: () => {}
  };
}
function mkReq(params, body) { return { params, body }; }
function mkRes() {
  const r = { _status: 200, _json: null };
  r.status = (c) => { r._status = c; return r; };
  r.json = (d) => { r._json = d; return r; };
  return r;
}

test('awaiting: transiciona para awaiting_input', () => {
  const store = mkStore({ id: 'sess-1', runId: 'run-x', lifecycleState: 'running' });
  const res = mkRes();
  handleAwaitingInput(store, mkReq({ runId: 'run-x', sessionId: 'sess-1' }, { reason: 'Bloqueado' }), res);
  assert.equal(res._status, 200);
  assert.equal(res._json.lifecycleState, 'awaiting_input');
  assert.equal(res._json.awaitingInputReason, 'Bloqueado');
});

test('complete: transiciona para completed com outcome=success', () => {
  const store = mkStore({ id: 'sess-2', runId: 'run-x', lifecycleState: 'running' });
  const res = mkRes();
  handleComplete(store, mkReq({ runId: 'run-x', sessionId: 'sess-2' }, { outcome: 'success' }), res);
  assert.equal(res._json.lifecycleState, 'completed');
  assert.equal(res._json.completionState, 'success');
});

test('fail: transiciona para failed', () => {
  const store = mkStore({ id: 'sess-3', runId: 'run-x', lifecycleState: 'running' });
  const res = mkRes();
  handleFail(store, mkReq({ runId: 'run-x', sessionId: 'sess-3' }, { reason: 'API key missing' }), res);
  assert.equal(res._json.lifecycleState, 'failed');
  assert.equal(res._json.completionState, 'failure');
});

test('404 quando sessão não existe', () => {
  const store = mkStore(null);
  const res = mkRes();
  handleAwaitingInput(store, mkReq({ runId: 'run-x', sessionId: 'nonexistent' }, {}), res);
  assert.equal(res._status, 404);
});

test('403 quando runId não bate', () => {
  const store = mkStore({ id: 'sess-4', runId: 'run-OTHER' });
  const res = mkRes();
  handleAwaitingInput(store, mkReq({ runId: 'run-WRONG', sessionId: 'sess-4' }, {}), res);
  assert.equal(res._status, 403);
});
