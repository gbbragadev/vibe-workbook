#!/usr/bin/env node
/**
 * Vibe Workbook - GUI Entry Point
 * Starts the Express server and opens the browser
 */
const { createServer } = require('./web/server');
const { getStore } = require('./state/store');
const { execSync } = require('child_process');

async function main() {
  const store = getStore();
  store.createTimestampedBackup();

  // Seed demo data if --demo flag
  if (process.argv.includes('--demo')) {
    seedDemoData(store);
  }

  const { start } = createServer();
  const { port } = await start();

  // Auto-open browser (unless CWM_NO_OPEN env)
  if (!process.env.VIBE_NO_OPEN) {
    const url = `http://localhost:${port}`;
    try {
      if (process.platform === 'win32') {
        execSync(`start "" "${url}"`, { stdio: 'ignore' });
      } else if (process.platform === 'darwin') {
        execSync(`open "${url}"`, { stdio: 'ignore' });
      } else {
        execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
      }
    } catch {
      console.log(`  Open in browser: http://localhost:${port}`);
    }
  }
}

function seedDemoData(store) {
  if (Object.keys(store.state.workspaces).length > 0) return; // Already has data

  console.log('  Seeding demo data...');

  const ws1 = store.createWorkspace({
    name: 'E-Commerce App',
    description: 'Full-stack e-commerce platform',
    color: '#6366f1',
    agents: ['claude', 'codex']
  });

  const ws2 = store.createWorkspace({
    name: 'CLI Tool',
    description: 'Node.js command-line utility',
    color: '#10b981',
    agents: ['claude']
  });

  const ws3 = store.createWorkspace({
    name: 'Data Pipeline',
    description: 'ETL pipeline with Python',
    color: '#f59e0b',
    agents: ['codex']
  });

  // Demo sessions
  store.createSession({
    name: 'Backend API',
    workspaceId: ws1.id,
    agent: 'claude',
    workingDir: 'C:\\Projects\\ecommerce\\backend',
    model: 'claude-sonnet-4-6'
  });

  store.createSession({
    name: 'Frontend React',
    workspaceId: ws1.id,
    agent: 'codex',
    workingDir: 'C:\\Projects\\ecommerce\\frontend',
    model: 'gpt-5'
  });

  store.createSession({
    name: 'Auth Module',
    workspaceId: ws1.id,
    agent: 'claude',
    workingDir: 'C:\\Projects\\ecommerce\\auth',
    model: 'claude-opus-4-6'
  });

  store.createSession({
    name: 'CLI Parser',
    workspaceId: ws2.id,
    agent: 'claude',
    workingDir: 'C:\\Projects\\cli-tool',
    model: 'claude-sonnet-4-6'
  });

  store.createSession({
    name: 'Transform Scripts',
    workspaceId: ws3.id,
    agent: 'codex',
    workingDir: 'C:\\Projects\\data-pipeline',
    model: 'codex-mini'
  });

  console.log('  Demo data seeded: 3 workspaces, 5 sessions');
}

main().catch(e => {
  console.error('Failed to start Vibe Workbook:', e);
  process.exit(1);
});
