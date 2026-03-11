'use strict';
const express = require('express');

function _validate(store, runId, sessionId, res) {
  const session = store.getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' }), null;
  if (session.runId && session.runId !== runId) return res.status(403).json({ error: 'Session not in this run' }), null;
  return session;
}

function handleAwaitingInput(store, req, res) {
  const { runId, sessionId } = req.params;
  const { reason = '' } = req.body || {};
  const session = _validate(store, runId, sessionId, res);
  if (!session) return;
  const updated = store.updateSession(sessionId, {
    lifecycleState: 'awaiting_input', awaitingInput: true, awaitingInputReason: reason,
    lifecycleTransitionAt: Date.now()
  });
  store.addSessionLog(sessionId, JSON.stringify({ at: Date.now(), type: 'lifecycle', from: session.lifecycleState, to: 'awaiting_input', reason }));
  res.json(updated);
}

function handleResolve(store, req, res) {
  const { runId, sessionId } = req.params;
  const session = _validate(store, runId, sessionId, res);
  if (!session) return;
  const updated = store.updateSession(sessionId, {
    lifecycleState: 'running', awaitingInput: false, awaitingInputReason: '', lifecycleTransitionAt: Date.now()
  });
  store.addSessionLog(sessionId, JSON.stringify({ at: Date.now(), type: 'lifecycle', from: 'awaiting_input', to: 'running', reason: 'resolved' }));
  res.json(updated);
}

function handleComplete(store, req, res) {
  const { runId, sessionId } = req.params;
  const { outcome = 'success' } = req.body || {};
  const session = _validate(store, runId, sessionId, res);
  if (!session) return;
  const updated = store.updateSession(sessionId, {
    lifecycleState: 'completed', completionState: outcome === 'failure' ? 'failure' : 'success',
    lifecycleTransitionAt: Date.now()
  });
  store.addSessionLog(sessionId, JSON.stringify({ at: Date.now(), type: 'lifecycle', from: session.lifecycleState, to: 'completed', reason: outcome }));
  res.json(updated);
}

function handleFail(store, req, res) {
  const { runId, sessionId } = req.params;
  const { reason = '' } = req.body || {};
  const session = _validate(store, runId, sessionId, res);
  if (!session) return;
  const updated = store.updateSession(sessionId, {
    lifecycleState: 'failed', completionState: 'failure', lifecycleTransitionAt: Date.now()
  });
  store.addSessionLog(sessionId, JSON.stringify({ at: Date.now(), type: 'lifecycle', from: session.lifecycleState, to: 'failed', reason }));
  res.json(updated);
}

function handleTerminate(store, ptyManager, req, res) {
  const { runId, sessionId } = req.params;
  const session = _validate(store, runId, sessionId, res);
  if (!session) return;
  ptyManager.kill(sessionId);
  const updated = store.updateSession(sessionId, {
    lifecycleState: 'terminated', lifecycleTransitionAt: Date.now()
  });
  store.addSessionLog(sessionId, JSON.stringify({ at: Date.now(), type: 'lifecycle', from: session.lifecycleState, to: 'terminated', reason: 'operator' }));
  res.json(updated);
}

function handleRedirect(store, ptyManager, req, res) {
  const { runId, sessionId } = req.params;
  const { newObjective = '' } = req.body || {};
  if (!newObjective) return res.status(400).json({ error: 'newObjective required' });
  const session = _validate(store, runId, sessionId, res);
  if (!session) return;
  const ptySession = ptyManager.sessions && ptyManager.sessions.get(sessionId);
  if (ptySession && ptySession.alive) {
    ptySession.write(newObjective.endsWith('\n') ? newObjective : `${newObjective}\r`);
  }
  const updated = store.updateSession(sessionId, {
    lifecycleState: 'running', awaitingInput: false, awaitingInputReason: '', lifecycleTransitionAt: Date.now()
  });
  store.addSessionLog(sessionId, JSON.stringify({ at: Date.now(), type: 'lifecycle', from: session.lifecycleState, to: 'running', reason: `redirect: ${newObjective.slice(0,80)}` }));
  res.json(updated);
}

function createWorkerControlRoutes({ store, ptyManager }) {
  const router = express.Router();
  router.post('/runs/:runId/workers/:sessionId/awaiting',  (req, res) => handleAwaitingInput(store, req, res));
  router.post('/runs/:runId/workers/:sessionId/resolve',   (req, res) => handleResolve(store, req, res));
  router.post('/runs/:runId/workers/:sessionId/complete',  (req, res) => handleComplete(store, req, res));
  router.post('/runs/:runId/workers/:sessionId/fail',      (req, res) => handleFail(store, req, res));
  router.post('/runs/:runId/workers/:sessionId/terminate', (req, res) => handleTerminate(store, ptyManager, req, res));
  router.post('/runs/:runId/workers/:sessionId/redirect',  (req, res) => handleRedirect(store, ptyManager, req, res));
  return router;
}

module.exports = { createWorkerControlRoutes, handleAwaitingInput, handleResolve, handleComplete, handleFail, handleTerminate, handleRedirect };
