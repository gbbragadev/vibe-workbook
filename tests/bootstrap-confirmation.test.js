'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// Replica exata da lógica de _scheduleBootstrapConfirmation para teste isolado
function scheduleConfirmation({ sessionId, ptySession, adapter, store, maxRetries, retryDelayMs, attempt }) {
  setTimeout(() => {
    if (!ptySession.alive) return;
    const output = ptySession.getRecentOutput();
    if (adapter.confirmBootstrap(output)) {
      store.updateSession(sessionId, { bootstrapState: 'confirmed' });
      store.addSessionLog(sessionId, JSON.stringify({ type: 'lifecycle', to: 'confirmed' }));
      return;
    }
    if (attempt < maxRetries) {
      scheduleConfirmation({ sessionId, ptySession, adapter, store, maxRetries, retryDelayMs, attempt: attempt + 1 });
      return;
    }
    store.updateSession(sessionId, { bootstrapState: 'failed', lifecycleState: 'bootstrap_failed', lifecycleTransitionAt: Date.now() });
    store.addSessionLog(sessionId, JSON.stringify({ type: 'lifecycle', to: 'bootstrap_failed' }));
  }, retryDelayMs);
}

test('confirma bootstrap na primeira checagem com output idle', (t, done) => {
  const updates = []; const logs = [];
  const store = {
    updateSession: (id, u) => { updates.push(u); return u; },
    addSessionLog: (id, m) => { logs.push(m); }
  };
  scheduleConfirmation({
    sessionId: 'sess-a',
    ptySession: { alive: true, getRecentOutput: () => '❯ ' },
    adapter: { confirmBootstrap: (o) => /[❯$>]\s*$/.test(o) },
    store, maxRetries: 5, retryDelayMs: 10, attempt: 0
  });
  setTimeout(() => {
    assert.ok(updates.some(u => u.bootstrapState === 'confirmed'));
    assert.ok(logs.some(l => l.includes('confirmed')));
    done();
  }, 100);
});

test('marca bootstrap_failed após esgotar retries', (t, done) => {
  const updates = [];
  const store = {
    updateSession: (id, u) => { updates.push(u); return u; },
    addSessionLog: () => {}
  };
  scheduleConfirmation({
    sessionId: 'sess-b',
    ptySession: { alive: true, getRecentOutput: () => 'still processing...' },
    adapter: { confirmBootstrap: () => false },
    store, maxRetries: 3, retryDelayMs: 10, attempt: 0
  });
  setTimeout(() => {
    assert.ok(updates.some(u => u.bootstrapState === 'failed'));
    assert.ok(updates.some(u => u.lifecycleState === 'bootstrap_failed'));
    done();
  }, 200);
});
