#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 *  VIBE WORKBOOK — TEST SYNC SCANNER
 *  Escaneia o código-fonte em busca de:
 *    • Rotas HTTP (GET/POST/PUT/DELETE/PATCH) em server.js e routes/
 *    • data-testid em index.html
 *  Compara com os testes existentes em e2e/ e tests/
 *  Reporta o que está SEM cobertura e gera stub de teste pronto.
 *
 *  Uso:
 *    node scripts/sync-tests.js
 *    node scripts/sync-tests.js --generate    <- gera arquivo de stub
 *    node scripts/sync-tests.js --watch       <- fica monitorando mudanças
 * ═══════════════════════════════════════════════════════════════
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const ARGS  = process.argv.slice(2);
const GEN   = ARGS.includes('--generate');
const WATCH = ARGS.includes('--watch');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', gray: '\x1b[90m',
};
const c = (color, text) => `${C[color]}${text}${C.reset}`;

function read(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch (_) { return ''; }
}

function readAllJs(dir) {
  let result = '';
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !['node_modules', '.git', '.worktrees'].includes(entry.name)) {
      result += readAllJs(full);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      result += read(full) + '\n';
    }
  }
  return result;
}

function extractRoutes(sourceCode) {
  const routes = new Set();
  const re = /(?:app|router)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi;
  let m;
  while ((m = re.exec(sourceCode)) !== null) {
    const method = m[1].toUpperCase();
    const route  = m[2];
    if (route === '*' || route === '/') continue;
    const normalized = route.startsWith('/api') ? route : `/api${route}`;
    routes.add(`${method} ${normalized}`);
  }
  return routes;
}

function extractTestIds(htmlContent) {
  const ids = new Set();
  const re = /data-testid="([^"]+)"/g;
  let m;
  while ((m = re.exec(htmlContent)) !== null) ids.add(m[1]);
  return ids;
}

// Converte parâmetros :id → :param e ${...} → :param para comparação genérica
function normalize(route) {
  return route
    .replace(/\/:[a-zA-Z0-9_]+/g, '/:param')
    .replace(/\/\$\{[^}]+\}/g, '/:param')
    .replace(/\/[a-f0-9-]{20,}/g, '/:param'); // UUIDs inline
}

function extractCoveredRoutes(testCode) {
  const covered = new Set();

  // api(page, 'METHOD', '/route') — string literal
  const r1 = /api\s*\(\s*\w+\s*,\s*['"](\w+)['"]\s*,\s*['"](\/[^'"]+)['"]/gi;
  // api(page, 'METHOD', `/route/${id}`) — template literal
  const r2 = /api\s*\(\s*\w+\s*,\s*['"](\w+)['"]\s*,\s*`(\/[^`]+)`/gi;
  // fetch('/api/route') — direct fetch
  const r3 = /fetch\s*\(\s*['"](\/api[^'"]+)['"]/gi;
  // fetch(`/api/route/${...}`) — template literal fetch
  const r4 = /fetch\s*\(\s*`(\/api[^`]+)`/gi;

  let m;
  while ((m = r1.exec(testCode)) !== null) covered.add(`${m[1].toUpperCase()} /api${m[2]}`);
  while ((m = r2.exec(testCode)) !== null) covered.add(`${m[1].toUpperCase()} /api${m[2]}`);
  while ((m = r3.exec(testCode)) !== null) covered.add(`GET ${m[1]}`);
  while ((m = r4.exec(testCode)) !== null) covered.add(`GET ${m[1]}`);

  return covered;
}

function extractCoveredTestIds(testCode) {
  const covered = new Set();
  const re = /\[data-testid="([^"]+)"\]/g;
  let m;
  while ((m = re.exec(testCode)) !== null) covered.add(m[1]);
  return covered;
}

// Gera stub de teste para uma rota
function generateStubForRoute(method, route) {
  const safe = route.replace('/api', '').replace(/:[a-zA-Z0-9_]+/g, 'existing-id');
  let body = '';
  if (['POST', 'PUT', 'PATCH'].includes(method)) body = `, { /* TODO: body */ }`;
  const desc = `${method} ${route}`;
  return `\n  test(${JSON.stringify(desc)}, async ({ page }) => {
    const r = await api(page, '${method}', '${safe}'${body});
    // TODO: ajustar status esperado e asserções
    expect([200, 201, 204, 400, 404]).toContain(r.status);
  });`;
}

// Gera stub de teste para um data-testid
function generateStubForTestId(testId) {
  return `\n  test('UI [data-testid="${testId}"]', async ({ page }) => {
    // TODO: verificar visibilidade ou interagir com o elemento
    await expect(page.locator('[data-testid="${testId}"]')).toBeVisible();
  });`;
}

function scan() {
  console.log(c('bold', '\n═══ VIBE WORKBOOK — TEST SYNC SCANNER ═══\n'));

  const serverCode = read(path.join(ROOT, 'src/web/server.js'));
  const routeCode  = readAllJs(path.join(ROOT, 'src/web/routes'));
  const allSource  = serverCode + '\n' + routeCode;
  const htmlCode   = read(path.join(ROOT, 'src/web/public/index.html'));
  const testCode   = readAllJs(path.join(ROOT, 'e2e')) + readAllJs(path.join(ROOT, 'tests'));

  const allRoutes      = extractRoutes(allSource);
  const allTestIds     = extractTestIds(htmlCode);
  const coveredRoutes  = extractCoveredRoutes(testCode);
  const coveredTestIds = extractCoveredTestIds(testCode);

  // Normalizar cobertura para comparação genérica com :param
  const covNorm = new Set([...coveredRoutes].map(normalize));

  const missingRoutes  = [...allRoutes].filter(r => !covNorm.has(normalize(r)));
  const missingTestIds = [...allTestIds].filter(id => !coveredTestIds.has(id));

  const covCount  = allRoutes.size - missingRoutes.length;
  const pct       = allRoutes.size > 0 ? Math.round(covCount / allRoutes.size * 100) : 100;
  const pctColor  = pct >= 80 ? 'green' : pct >= 50 ? 'yellow' : 'red';

  console.log(c('cyan',  `📡 Rotas encontradas:   ${allRoutes.size}`));
  console.log(c('green', `✅ Com cobertura:        ${covCount}  (${c(pctColor, pct + '%')})`));
  if (missingRoutes.length)
    console.log(c('red',   `❌ Sem cobertura:        ${missingRoutes.length}`));
  console.log('');
  console.log(c('cyan',  `🏷  data-testid no HTML: ${allTestIds.size}`));
  console.log(c('green', `✅ Com cobertura:        ${allTestIds.size - missingTestIds.length}`));
  if (missingTestIds.length)
    console.log(c('red',   `❌ Sem cobertura:        ${missingTestIds.length}`));
  console.log('');

  if (missingRoutes.length > 0) {
    console.log(c('yellow', '── ROTAS SEM TESTE ──────────────────────'));
    for (const r of missingRoutes.sort()) {
      const [method, ...rest] = r.split(' ');
      console.log(`  ${c('red', method.padEnd(7))} ${rest.join(' ')}`);
    }
    console.log('');
  }

  if (missingTestIds.length > 0) {
    console.log(c('yellow', '── data-testid SEM TESTE ────────────────'));
    for (const id of missingTestIds.sort())
      console.log(`  ${c('gray', '•')} ${id}`);
    console.log('');
  }

  if (!missingRoutes.length && !missingTestIds.length)
    console.log(c('green', '🎉 Cobertura completa!\n'));

  return { missingRoutes, missingTestIds, allRoutes, allTestIds, covCount, pct };
}

function generateStubs({ missingRoutes, missingTestIds }) {
  const now     = new Date().toISOString().slice(0,16).replace('T',' ');
  const outFile = path.join(ROOT, 'e2e/full-suite/auto-generated.spec.js');

  const header = `/**
 * AUTO-GERADO por scripts/sync-tests.js em ${now}
 * Cobre lacunas detectadas automaticamente.
 * Substitua os TODO pela lógica real antes de commitar.
 * NÃO edite manualmente — re-execute --generate para atualizar.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

async function login(page) {
  let pwd = 'vibe';
  try {
    const cfg = path.join(__dirname, '../../state/config.json');
    if (fs.existsSync(cfg)) { const c = JSON.parse(fs.readFileSync(cfg,'utf8')); if(c.password) pwd=c.password; }
  } catch (_) {}
  await page.goto('/');
  await page.waitForSelector('[data-testid="login-password"]', { timeout: 12000 });
  await page.fill('[data-testid="login-password"]', pwd);
  await page.click('[data-testid="login-submit"]');
  await expect(page.locator('[data-testid="app-layout"]')).toBeVisible({ timeout: 12000 });
}

async function api(page, method, route, body = null) {
  return page.evaluate(async ({ method, route, body }) => {
    const tok = localStorage.getItem('vibe_token') || sessionStorage.getItem('vibe_token');
    const r = await fetch(\`/api\${route}\`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: \`Bearer \${tok}\` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: r.status, data: await r.json().catch(() => null) };
  }, { method, route, body });
}
`;

  let body = header;

  if (missingRoutes.length > 0) {
    body += `\ntest.describe('AUTO — Novas rotas sem cobertura', () => {\n`;
    body += `  test.beforeEach(async ({ page }) => { await login(page); });\n`;
    for (const r of missingRoutes.sort()) {
      const [method, route] = r.split(' ');
      body += generateStubForRoute(method, route) + '\n';
    }
    body += `});\n`;
  }

  if (missingTestIds.length > 0) {
    body += `\ntest.describe('AUTO — Novos data-testid sem cobertura', () => {\n`;
    body += `  test.beforeEach(async ({ page }) => { await login(page); });\n`;
    for (const id of missingTestIds.sort()) {
      body += generateStubForTestId(id) + '\n';
    }
    body += `});\n`;
  }

  fs.writeFileSync(outFile, body, 'utf8');
  console.log(c('green', `✅ Stubs gerados → ${outFile}`));
  console.log(c('gray',  `   ${missingRoutes.length} rotas + ${missingTestIds.length} testIds\n`));
  return outFile;
}

function startWatch() {
  console.log(c('cyan', '👁  Watch mode — monitorando src/ e public/...\n'));
  const watchPaths = [
    path.join(ROOT, 'src/web/server.js'),
    path.join(ROOT, 'src/web/routes'),
    path.join(ROOT, 'src/web/public/index.html'),
  ];
  let debounce;
  const trigger = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      console.clear();
      console.log(c('yellow', `🔄 Mudança — ${new Date().toLocaleTimeString()}`));
      const result = scan();
      if (result.missingRoutes.length > 0 || result.missingTestIds.length > 0) {
        generateStubs(result);
        console.log(c('yellow', '💡 Stubs atualizados em e2e/full-suite/auto-generated.spec.js'));
      }
    }, 400);
  };
  for (const p of watchPaths) {
    if (fs.existsSync(p)) fs.watch(p, { recursive: true }, trigger);
  }
}

// ─── ENTRY POINT ────────────────────────────────────────────────
const result = scan();

if (GEN) {
  generateStubs(result);
} else if (result.missingRoutes.length > 0 || result.missingTestIds.length > 0) {
  console.log(c('yellow', `💡 node scripts/sync-tests.js --generate   → gera stubs`));
  console.log(c('yellow', `💡 node scripts/sync-tests.js --watch      → monitora mudanças\n`));
}

if (WATCH) startWatch();
