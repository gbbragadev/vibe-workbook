#!/usr/bin/env node
/**
 * Instala os githooks e configura git para usar .githooks/
 * Execute: node scripts/install-hooks.js
 */
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

try {
  execSync('git config core.hooksPath .githooks', { cwd: ROOT, stdio: 'inherit' });
  console.log('✅ Git hooks configurado: .githooks/');
} catch (e) {
  console.error('❌ Falha ao configurar hooks:', e.message);
}

// Garantir permissão de execução no hook (para WSL / Git Bash)
const hookFile = path.join(ROOT, '.githooks/pre-commit');
if (fs.existsSync(hookFile)) {
  try {
    fs.chmodSync(hookFile, 0o755);
    console.log('✅ pre-commit hook configurado');
  } catch (_) {
    console.log('⚠️  Não foi possível alterar permissões (normal no Windows)');
  }
}

console.log('\nPronto! O scanner rodará automaticamente antes de cada commit.');
console.log('Para rodar manualmente: npm run test:sync');
