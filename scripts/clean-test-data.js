#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '..', 'state');
const BACKUP_DIR = path.join(STATE_DIR, 'backups');

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = path.basename(filePath, '.json');
  const dest = path.join(BACKUP_DIR, name + '-clean-' + Date.now() + '.json');
  fs.copyFileSync(filePath, dest);
  console.log('  Backup: ' + dest);
}

function cleanWorkspaces() {
  const wsPath = path.join(STATE_DIR, 'workspaces.json');
  if (!fs.existsSync(wsPath)) { console.log('No workspaces.json found.'); return; }
  backup(wsPath);
  const data = JSON.parse(fs.readFileSync(wsPath, 'utf8'));
  const testPattern = /e2e|test/i;
  const before = (data.workspaces || []).length;
  const removedIds = new Set();
  data.workspaces = (data.workspaces || []).filter(ws => {
    if (testPattern.test(ws.name || '')) { removedIds.add(ws.id); return false; }
    return true;
  });
  const sessionsBefore = (data.sessions || []).length;
  data.sessions = (data.sessions || []).filter(s => !removedIds.has(s.workspaceId));
  fs.writeFileSync(wsPath, JSON.stringify(data, null, 2));
  console.log('Workspaces: ' + before + ' -> ' + data.workspaces.length + ' (removed ' + removedIds.size + ')');
  console.log('Sessions: ' + sessionsBefore + ' -> ' + data.sessions.length);
}

function cleanCopilotState() {
  const copilotPath = path.join(STATE_DIR, 'project-copilot.json');
  if (!fs.existsSync(copilotPath)) { console.log('No project-copilot.json found.'); return; }
  backup(copilotPath);
  const data = JSON.parse(fs.readFileSync(copilotPath, 'utf8'));
  const testPattern = /e2e|test/i;
  const keys = Object.keys(data);
  let removed = 0;
  keys.forEach(key => {
    if (testPattern.test(key)) { delete data[key]; removed++; }
  });
  fs.writeFileSync(copilotPath, JSON.stringify(data, null, 2));
  console.log('Copilot entries: removed ' + removed + ' test entries');
}

console.log('=== Cleaning test data ===\n');
cleanWorkspaces();
console.log('');
cleanCopilotState();
console.log('\nDone.');
