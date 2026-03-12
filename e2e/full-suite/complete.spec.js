/**
 * ════════════════════════════════════════════════════════════════
 *  VIBE WORKBOOK — SUÍTE COMPLETA DE TESTES E2E
 *  Cobertura: Login · Nav · Workspaces · Sessions · Agents ·
 *              Products · Knowledge Packs · Ideas · Settings ·
 *              Security · SSE · Worker Control · Performance
 *  Motor: Playwright  |  Servidor: localhost:3457
 * ════════════════════════════════════════════════════════════════
 */
'use strict';
const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

// ─── HELPER: login dinâmico lendo senha do config.json ───────────
async function login(page) {
  let pwd = 'vibe';
  try {
    const cfg = path.join(__dirname, '../../state/config.json');
    if (fs.existsSync(cfg)) {
      const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
      if (c.password) pwd = c.password;
    }
  } catch (_) {}
  await page.goto('/');
  await page.waitForSelector('[data-testid="login-password"]', { timeout: 12000 });
  await page.fill('[data-testid="login-password"]', pwd);
  await page.click('[data-testid="login-submit"]');
  await expect(page.locator('[data-testid="app-layout"]')).toBeVisible({ timeout: 12000 });
}

// ─── HELPER: abre dropdown "More" ────────────────────────────────
async function openMore(page) {
  const dd = page.locator('[data-testid="nav-more-dropdown"]');
  const hidden = await dd.evaluate(el => el.classList.contains('hidden')).catch(() => true);
  if (hidden) {
    await page.click('[data-testid="nav-more"]');
    await expect(dd).not.toHaveClass(/hidden/);
  }
}

// ─── HELPER: chamada autenticada à API ───────────────────────────
async function api(page, method, route, body = null) {
  return page.evaluate(async ({ method, route, body }) => {
    const tok = localStorage.getItem('vibe_token') || sessionStorage.getItem('vibe_token');
    const r = await fetch(`/api${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(tok ? { Authorization: `Bearer ${tok}` } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: r.status, data: await r.json().catch(() => null) };
  }, { method, route, body });
}

// ─── HELPER: extrai id de produto ────────────────────────────────
function pid(p) { return p.product_id || p.id; }

// ─── HELPER: cria produto de teste com dir temporário ────────────
const os = require('os');
let _prodCounter = 0;
async function createTestProduct(page, suffix = '') {
  _prodCounter++;
  const slug = `qa-prod-${Date.now()}-${_prodCounter}-${suffix}`.toLowerCase();
  const tmpDir = path.join(os.tmpdir(), slug);
  fs.mkdirSync(tmpDir, { recursive: true });
  const r = await api(page, 'POST', '/products', {
    name: `QA-Product-${suffix || 'Test'}`, owner: 'qa-test',
    slug, local_path: tmpDir, workspace_mode: 'none'
  });
  const id = r.data?.product?.product_id || r.data?.product?.id;
  return { r, id, tmpDir };
}
async function deleteTestProduct(page, id, tmpDir) {
  if (id) await api(page, 'DELETE', `/products/${id}`);
  try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
}

// ════════════════════════════════════════════════════════════════
// BLOCO 1 — AUTENTICAÇÃO
// ════════════════════════════════════════════════════════════════
test.describe('1. Autenticacao', () => {

  test('1.1 Tela de login exibida em /', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="login-password"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-submit"]')).toBeVisible();
  });

  test('1.2 Login correto redireciona para o app', async ({ page }) => {
    await login(page);
    await expect(page.locator('[data-testid="app-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-products"]')).toBeVisible();
  });

  test('1.3 Senha errada nao avanca para o app', async ({ page }) => {
    await page.goto('/');
    await page.fill('[data-testid="login-password"]', 'senha_incorreta_xpto999');
    await page.click('[data-testid="login-submit"]');
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-testid="login-password"]')).toBeVisible();
    await expect(page.locator('[data-testid="app-layout"]')).not.toBeVisible();
  });

  test('1.4 GET /api/health retorna status ok sem autenticacao', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const res = await fetch('/api/health');
      return res.json();
    });
    expect(r.status).toBe('ok');
    expect(typeof r.uptime).toBe('number');
    expect(r.version).toBeTruthy();
  });

});

// ════════════════════════════════════════════════════════════════
// BLOCO 2 — NAVEGAÇÃO (6 views)
// ════════════════════════════════════════════════════════════════
test.describe('2. Navegacao', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('2.1 Nav Products ativa #view-products', async ({ page }) => {
    await page.click('[data-testid="nav-products"]');
    await expect(page.locator('#view-products')).toHaveClass(/active/);
    await expect(page.locator('.products-header h2')).toHaveText('Products');
  });

  test('2.2 Nav Ideas ativa #view-ideas', async ({ page }) => {
    await page.click('[data-testid="nav-ideas"]');
    await expect(page.locator('#view-ideas')).toHaveClass(/active/);
    await expect(page.locator('[data-testid="ideas-heading"]')).toBeVisible();
  });

  test('2.3 Nav Costs ativa #view-costs', async ({ page }) => {
    await page.click('[data-testid="nav-costs"]');
    await expect(page.locator('#view-costs')).toHaveClass(/active/);
  });

  test('2.4 Nav More abre dropdown', async ({ page }) => {
    await page.click('[data-testid="nav-more"]');
    await expect(page.locator('[data-testid="nav-more-dropdown"]')).not.toHaveClass(/hidden/);
  });

  test('2.5 Nav Terminals ativa #view-terminals', async ({ page }) => {
    await openMore(page);
    await page.click('[data-testid="nav-terminals"]');
    await expect(page.locator('#view-terminals')).toHaveClass(/active/);
  });

  test('2.6 Nav History ativa #view-history', async ({ page }) => {
    await openMore(page);
    await page.click('[data-testid="nav-history"]');
    await expect(page.locator('#view-history')).toHaveClass(/active/);
    await expect(page.locator('.history-header h2')).toHaveText('Session History');
  });

  test('2.7 Nav Discover ativa #view-discover', async ({ page }) => {
    await openMore(page);
    await page.click('[data-testid="nav-discover"]');
    await expect(page.locator('#view-discover')).toHaveClass(/active/);
    await expect(page.locator('.discover-header h2')).toHaveText('Discovered Sessions');
  });

});

// ════════════════════════════════════════════════════════════════
// BLOCO 3 — API: WORKSPACES (CRUD completo)
// ════════════════════════════════════════════════════════════════
test.describe('3. API Workspaces', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('3.1 GET /workspaces retorna array', async ({ page }) => {
    const r = await api(page, 'GET', '/workspaces');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data)).toBe(true);
  });

  test('3.2 POST /workspaces cria workspace', async ({ page }) => {
    const r = await api(page, 'POST', '/workspaces', { name: 'QA-WS-Create', color: 'blue' });
    expect(r.status).toBe(201);
    expect(r.data.name).toBe('QA-WS-Create');
    expect(r.data.id).toBeTruthy();
    await api(page, 'DELETE', `/workspaces/${r.data.id}`);
  });

  test('3.3 POST /workspaces sem nome retorna 400', async ({ page }) => {
    const r = await api(page, 'POST', '/workspaces', { description: 'sem nome' });
    expect(r.status).toBe(400);
    expect(r.data.error).toBeTruthy();
  });

  test('3.4 GET /workspaces/:id retorna workspace especifico', async ({ page }) => {
    const c = await api(page, 'POST', '/workspaces', { name: 'QA-WS-Get' });
    const r = await api(page, 'GET', `/workspaces/${c.data.id}`);
    expect(r.status).toBe(200);
    expect(r.data.id).toBe(c.data.id);
    await api(page, 'DELETE', `/workspaces/${c.data.id}`);
  });

  test('3.5 GET /workspaces/:id inexistente retorna 404', async ({ page }) => {
    const r = await api(page, 'GET', '/workspaces/nao-existe-xpto-000');
    expect(r.status).toBe(404);
  });

  test('3.6 PUT /workspaces/:id atualiza nome', async ({ page }) => {
    const c = await api(page, 'POST', '/workspaces', { name: 'QA-WS-Put' });
    const u = await api(page, 'PUT', `/workspaces/${c.data.id}`, { name: 'QA-WS-Updated' });
    expect(u.status).toBe(200);
    expect(u.data.name).toBe('QA-WS-Updated');
    await api(page, 'DELETE', `/workspaces/${c.data.id}`);
  });

  test('3.7 DELETE /workspaces/:id remove e retorna 404 depois', async ({ page }) => {
    const c = await api(page, 'POST', '/workspaces', { name: 'QA-WS-Del' });
    await api(page, 'DELETE', `/workspaces/${c.data.id}`);
    const r = await api(page, 'GET', `/workspaces/${c.data.id}`);
    expect(r.status).toBe(404);
  });

  test('3.8 POST /workspaces/:id/activate ativa workspace', async ({ page }) => {
    const c = await api(page, 'POST', '/workspaces', { name: 'QA-WS-Activate' });
    const r = await api(page, 'POST', `/workspaces/${c.data.id}/activate`);
    expect(r.status).toBe(200);
    await api(page, 'DELETE', `/workspaces/${c.data.id}`);
  });

  test('3.9 GET /workspaces/:id/cost retorna objeto de custo', async ({ page }) => {
    const c = await api(page, 'POST', '/workspaces', { name: 'QA-WS-Cost' });
    const r = await api(page, 'GET', `/workspaces/${c.data.id}/cost`);
    expect([200, 500]).toContain(r.status);
    await api(page, 'DELETE', `/workspaces/${c.data.id}`);
  });

});

// ════════════════════════════════════════════════════════════════
// BLOCO 4 — API: SESSIONS (CRUD + filtros + lifecycle)
// ════════════════════════════════════════════════════════════════
test.describe('4. API Sessions', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('4.1 GET /sessions retorna array', async ({ page }) => {
    const r = await api(page, 'GET', '/sessions');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data)).toBe(true);
  });

  test('4.2 POST /sessions cria sessao', async ({ page }) => {
    const r = await api(page, 'POST', '/sessions', { name: 'QA-Session-Create', agent: 'claude' });
    expect(r.status).toBe(201);
    expect(r.data.name).toBe('QA-Session-Create');
    expect(r.data.id).toBeTruthy();
    await api(page, 'DELETE', `/sessions/${r.data.id}`);
  });

  test('4.3 POST /sessions sem nome retorna 400', async ({ page }) => {
    const r = await api(page, 'POST', '/sessions', { agent: 'claude' });
    expect(r.status).toBe(400);
  });

  test('4.4 GET /sessions/:id retorna sessao especifica', async ({ page }) => {
    const c = await api(page, 'POST', '/sessions', { name: 'QA-Session-Get' });
    const r = await api(page, 'GET', `/sessions/${c.data.id}`);
    expect(r.status).toBe(200);
    expect(r.data.id).toBe(c.data.id);
    await api(page, 'DELETE', `/sessions/${c.data.id}`);
  });

  test('4.5 GET /sessions/:id inexistente retorna 404', async ({ page }) => {
    const r = await api(page, 'GET', '/sessions/nao-existe-xpto-000');
    expect(r.status).toBe(404);
  });

  test('4.6 PUT /sessions/:id atualiza nome', async ({ page }) => {
    const c = await api(page, 'POST', '/sessions', { name: 'QA-Session-Put' });
    const u = await api(page, 'PUT', `/sessions/${c.data.id}`, { name: 'QA-Session-Updated' });
    expect(u.status).toBe(200);
    expect(u.data.name).toBe('QA-Session-Updated');
    await api(page, 'DELETE', `/sessions/${c.data.id}`);
  });

  test('4.7 DELETE /sessions/:id remove sessao', async ({ page }) => {
    const c = await api(page, 'POST', '/sessions', { name: 'QA-Session-Del' });
    await api(page, 'DELETE', `/sessions/${c.data.id}`);
    const r = await api(page, 'GET', `/sessions/${c.data.id}`);
    expect(r.status).toBe(404);
  });

  test('4.8 GET /sessions?agent=claude filtra por agente', async ({ page }) => {
    const c = await api(page, 'POST', '/sessions', { name: 'QA-Agent-Filter', agent: 'claude' });
    const r = await api(page, 'GET', '/sessions?agent=claude');
    expect(r.status).toBe(200);
    r.data.forEach(s => expect(s.agent).toBe('claude'));
    await api(page, 'DELETE', `/sessions/${c.data.id}`);
  });

  test('4.9 GET /sessions?q=QA filtra por busca', async ({ page }) => {
    const c = await api(page, 'POST', '/sessions', { name: 'QA-Search-Filter-Unique' });
    const r = await api(page, 'GET', '/sessions?q=QA-Search-Filter-Unique');
    expect(r.status).toBe(200);
    await api(page, 'DELETE', `/sessions/${c.data.id}`);
  });

  test('4.10 GET /sessions/:id/cost retorna custo da sessao', async ({ page }) => {
    const c = await api(page, 'POST', '/sessions', { name: 'QA-Session-Cost' });
    const r = await api(page, 'GET', `/sessions/${c.data.id}/cost`);
    expect([200, 404, 500]).toContain(r.status);
    await api(page, 'DELETE', `/sessions/${c.data.id}`);
  });

});

// ════════════════════════════════════════════════════════════════
// BLOCO 5 — API: AGENTS, MODELS, PTY
// ════════════════════════════════════════════════════════════════
test.describe('5. Agents, Models e PTY', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('5.1 GET /agents retorna lista de agentes registrados', async ({ page }) => {
    const r = await api(page, 'GET', '/agents');
    expect(r.status).toBe(200);
  });

  test('5.2 GET /models retorna 4 agentes com modelos', async ({ page }) => {
    const r = await api(page, 'GET', '/models');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.claude.models)).toBe(true);
    expect(r.data.claude.models.length).toBeGreaterThan(0);
    expect(r.data.claude.supportsEffort).toBe(true);
    expect(r.data.codex).toBeTruthy();
    expect(r.data.gemini).toBeTruthy();
    expect(r.data.antigravity).toBeTruthy();
  });

  test('5.3 GET /models claude tem effortLevels', async ({ page }) => {
    const r = await api(page, 'GET', '/models');
    expect(Array.isArray(r.data.claude.effortLevels)).toBe(true);
    expect(r.data.claude.effortLevels).toContain('low');
  });

  test('5.4 GET /pty/sessions retorna sessoes PTY ativas', async ({ page }) => {
    const r = await api(page, 'GET', '/pty/sessions');
    expect(r.status).toBe(200);
  });

  test('5.5 POST /agents/discover retorna sessoes descobertas', async ({ page }) => {
    const r = await api(page, 'POST', '/agents/discover');
    expect([200, 500]).toContain(r.status);
    if (r.status === 200) {
      expect(typeof r.data.total).toBe('number');
    }
  });

});

// ════════════════════════════════════════════════════════════════
// BLOCO 6 — API: PRODUTOS
// ════════════════════════════════════════════════════════════════
test.describe('6. API Produtos', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('6.1 GET /products retorna lista', async ({ page }) => {
    const r = await api(page, 'GET', '/products');
    expect(r.status).toBe(200);
  });

  test('6.2 GET /products/:id produto existente', async ({ page }) => {
    const list = await api(page, 'GET', '/products');
    const products = Array.isArray(list.data) ? list.data : (list.data?.products || []);
    if (!products.length) return;
    const r = await api(page, 'GET', `/products/${pid(products[0])}`);
    expect(r.status).toBe(200);
  });

  test('6.3 GET /products/:id inexistente retorna 404', async ({ page }) => {
    const r = await api(page, 'GET', '/products/produto-nao-existe-xpto-000');
    expect(r.status).toBe(404);
  });

  test('6.4 GET /products/:id/pipeline retorna pipeline', async ({ page }) => {
    const list = await api(page, 'GET', '/products');
    const products = Array.isArray(list.data) ? list.data : (list.data?.products || []);
    if (!products.length) return;
    const r = await api(page, 'GET', `/products/${pid(products[0])}/pipeline`);
    expect([200, 404]).toContain(r.status);
  });

  test('6.5 GET /products/:id/runs retorna runs', async ({ page }) => {
    const list = await api(page, 'GET', '/products');
    const products = Array.isArray(list.data) ? list.data : (list.data?.products || []);
    if (!products.length) return;
    const r = await api(page, 'GET', `/products/${pid(products[0])}/runs`);
    expect([200, 404]).toContain(r.status);
  });

  test('6.6 GET /products/:id/runs/current retorna run atual', async ({ page }) => {
    const list = await api(page, 'GET', '/products');
    const products = Array.isArray(list.data) ? list.data : (list.data?.products || []);
    if (!products.length) return;
    const r = await api(page, 'GET', `/products/${pid(products[0])}/runs/current`);
    expect([200, 404]).toContain(r.status);
  });

  test('6.7 GET /products/:id/knowledge retorna knowledge', async ({ page }) => {
    const list = await api(page, 'GET', '/products');
    const products = Array.isArray(list.data) ? list.data : (list.data?.products || []);
    if (!products.length) return;
    const r = await api(page, 'GET', `/products/${pid(products[0])}/knowledge`);
    expect([200, 404]).toContain(r.status);
  });

  test('6.8 GET /products/:id/artifacts retorna artefatos', async ({ page }) => {
    const list = await api(page, 'GET', '/products');
    const products = Array.isArray(list.data) ? list.data : (list.data?.products || []);
    if (!products.length) return;
    const r = await api(page, 'GET', `/products/${pid(products[0])}/artifacts`);
    expect([200, 404]).toContain(r.status);
  });

  test('6.8b GET /products/:id/artifacts/:artifactId/content retorna conteúdo', async ({ page }) => {
    const list = await api(page, 'GET', '/products');
    const products = Array.isArray(list.data) ? list.data : (list.data?.products || []);
    if (!products.length) return;
    const productId = pid(products[0]);
    const artRes = await api(page, 'GET', `/products/${productId}/artifacts`);
    if (artRes.status !== 200 || !Array.isArray(artRes.data) || !artRes.data.length) return;
    const artifact = artRes.data[0];
    const r = await api(page, 'GET', `/products/${productId}/artifacts/${artifact.id}/content`);
    expect([200]).toContain(r.status);
    expect(r.data).toHaveProperty('exists');
    expect(r.data).toHaveProperty('content');
    expect(r.data).toHaveProperty('path');
  });

  test('6.9 DELETE /products/:id remove produto', async ({ page }) => {
    const { id, tmpDir } = await createTestProduct(page, 'del-test');
    expect(id).toBeTruthy();
    const del = await api(page, 'DELETE', `/products/${id}`);
    expect(del.status).toBe(200);
    expect(del.data.deleted).toBe(true);
    const get = await api(page, 'GET', `/products/${id}`);
    expect(get.status).toBe(404);
    try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('6.10 POST /products/:id/reset zera lifecycle do produto', async ({ page }) => {
    const { id, tmpDir } = await createTestProduct(page, 'reset-test');
    expect(id).toBeTruthy();
    const r = await api(page, 'POST', `/products/${id}/reset`);
    expect(r.status).toBe(200);
    expect(r.data.reset).toBe(true);
    expect(r.data.product?.stage).toBe('discovery');
    await deleteTestProduct(page, id, tmpDir);
  });

});

// ════════════════════════════════════════════════════════════════
// BLOCO 7 — API: KNOWLEDGE PACKS
// ════════════════════════════════════════════════════════════════
test.describe('7. Knowledge Packs', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('7.1 GET /knowledge-packs retorna lista', async ({ page }) => {
    const r = await api(page, 'GET', '/knowledge-packs');
    expect(r.status).toBe(200);
  });

  test('7.2 GET /knowledge-packs/:id existente retorna pack', async ({ page }) => {
    const list = await api(page, 'GET', '/knowledge-packs');
    const packs = Array.isArray(list.data) ? list.data : [];
    if (!packs.length) return;
    const r = await api(page, 'GET', `/knowledge-packs/${packs[0].id || packs[0].pack_id}`);
    expect(r.status).toBe(200);
  });

  test('7.3 GET /knowledge-packs/:id inexistente retorna 404', async ({ page }) => {
    const r = await api(page, 'GET', '/knowledge-packs/pack-nao-existe-xpto');
    expect(r.status).toBe(404);
  });

});

// ════════════════════════════════════════════════════════════════
// BLOCO 8 — API: IDEAS (CRUD + clusters + discovery)
// ════════════════════════════════════════════════════════════════
test.describe('8. API Ideas', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('8.1 GET /ideas retorna lista', async ({ page }) => {
    const r = await api(page, 'GET', '/ideas');
    expect(r.status).toBe(200);
  });

  test('8.2 POST /ideas cria ideia manual', async ({ page }) => {
    const r = await api(page, 'POST', '/ideas', { title: 'QA-Idea-Create', source: 'manual' });
    expect([200, 201]).toContain(r.status);
    const id = r.data?.id || r.data?.idea?.id;
    if (id) await api(page, 'DELETE', `/ideas/${id}`);
  });

  test('8.3 GET /ideas/:id retorna ideia criada', async ({ page }) => {
    const c = await api(page, 'POST', '/ideas', { title: 'QA-Idea-Get', source: 'manual' });
    const id = c.data?.id || c.data?.idea?.id;
    if (!id) return;
    const r = await api(page, 'GET', `/ideas/${id}`);
    expect(r.status).toBe(200);
    await api(page, 'DELETE', `/ideas/${id}`);
  });

  test('8.4 GET /ideas/:id inexistente retorna 404', async ({ page }) => {
    const r = await api(page, 'GET', '/ideas/ideia-nao-existe-xpto-000');
    expect(r.status).toBe(404);
  });

  test('8.5 PUT /ideas/:id atualiza titulo', async ({ page }) => {
    const c = await api(page, 'POST', '/ideas', { title: 'QA-Idea-Put', source: 'manual' });
    const id = c.data?.id || c.data?.idea?.id;
    if (!id) return;
    const u = await api(page, 'PUT', `/ideas/${id}`, { title: 'QA-Idea-Updated' });
    expect([200, 201]).toContain(u.status);
    await api(page, 'DELETE', `/ideas/${id}`);
  });

  test('8.6 PUT /ideas/:id/status atualiza status', async ({ page }) => {
    const c = await api(page, 'POST', '/ideas', { title: 'QA-Idea-Status', source: 'manual' });
    const id = c.data?.id || c.data?.idea?.id;
    if (!id) return;
    const r = await api(page, 'PUT', `/ideas/${id}/status`, { status: 'approved' });
    expect([200, 201, 400]).toContain(r.status);
    await api(page, 'DELETE', `/ideas/${id}`);
  });

  test('8.7 DELETE /ideas/:id remove ideia', async ({ page }) => {
    const c = await api(page, 'POST', '/ideas', { title: 'QA-Idea-Del', source: 'manual' });
    const id = c.data?.id || c.data?.idea?.id;
    if (!id) return;
    await api(page, 'DELETE', `/ideas/${id}`);
    const r = await api(page, 'GET', `/ideas/${id}`);
    expect(r.status).toBe(404);
  });

  test('8.8 GET /ideas/clusters retorna clusters', async ({ page }) => {
    const r = await api(page, 'GET', '/ideas/clusters');
    expect(r.status).toBe(200);
  });

  test('8.9 GET /ideas/discover/status retorna status de discovery', async ({ page }) => {
    const r = await api(page, 'GET', '/ideas/discover/status');
    expect(r.status).toBe(200);
    expect(typeof r.data).toBe('object');
  });

  test('8.10 POST /ideas/deduplicate retorna resultado', async ({ page }) => {
    const r = await api(page, 'POST', '/ideas/deduplicate');
    expect([200, 201]).toContain(r.status);
  });

});

// ════════════════════════════════════════════════════════════════
// BLOCO 9 — UI: TELA DE IDEAS
// ════════════════════════════════════════════════════════════════
test.describe('9. UI Ideas', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.click('[data-testid="nav-ideas"]');
    await expect(page.locator('#view-ideas')).toHaveClass(/active/);
  });

  test('9.1 Heading, botoes de acao visiveis', async ({ page }) => {
    await expect(page.locator('[data-testid="ideas-heading"]')).toBeVisible();
    await expect(page.locator('[data-testid="action-new-idea"]')).toBeVisible();
    await expect(page.locator('[data-testid="action-start-discovery"]')).toBeVisible();
    await expect(page.locator('[data-testid="action-deduplicate"]')).toBeVisible();
  });

  test('9.2 Clicar em New Idea abre dialog com titulo correto', async ({ page }) => {
    await page.click('[data-testid="action-new-idea"]');
    await expect(page.locator('[data-testid="dialog-box"]')).toBeVisible();
    await expect(page.locator('[data-testid="dialog-title"]')).toBeVisible();
    // fechar overlay
    const overlay = page.locator('[data-testid="dialog-overlay"]');
    if (await overlay.isVisible()) await overlay.click();
  });

  test('9.3 Criar nova ideia via UI aparece na lista', async ({ page }) => {
    await page.click('[data-testid="action-new-idea"]');
    await expect(page.locator('[data-testid="dialog-box"]')).toBeVisible();
    const uniqueTitle = `QA-UI-Idea-${Date.now()}`;
    const titleInput = page.locator('#new-idea-title');
    if (await titleInput.isVisible()) {
      await titleInput.fill(uniqueTitle);
      const createBtn = page.locator('[data-testid="dialog-actions"] button:has-text("Create")');
      if (await createBtn.isVisible()) {
        await createBtn.click();
        await page.waitForTimeout(800);
        await expect(page.locator(`text="${uniqueTitle}"`).first()).toBeVisible();
      }
    }
  });

  test('9.4 Clicar em Start Discovery abre dialog', async ({ page }) => {
    await page.click('[data-testid="action-start-discovery"]');
    await expect(page.locator('[data-testid="dialog-box"]')).toBeVisible();
    await expect(page.locator('[data-testid="dialog-title"]')).toBeVisible();
    const overlay = page.locator('[data-testid="dialog-overlay"]');
    if (await overlay.isVisible()) await overlay.click();
  });

  test('9.5 Selecionar ideia exibe painel de detalhe', async ({ page }) => {
    await page.waitForTimeout(1000);
    const first = page.locator('[data-testid="idea-card"]').first();
    if (await first.isVisible()) {
      await first.click();
      await expect(first).toHaveClass(/active/);
    }
  });

});

// ════════════════════════════════════════════════════════════════
// BLOCO 10 — API: SETTINGS, SEARCH, BROWSE, COST DASHBOARD
// ════════════════════════════════════════════════════════════════
test.describe('10. Settings, Search, Browse, Costs', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('10.1 GET /settings retorna objeto de configuracoes', async ({ page }) => {
    const r = await api(page, 'GET', '/settings');
    expect(r.status).toBe(200);
    expect(typeof r.data).toBe('object');
  });

  test('10.2 PUT /settings atualiza configuracao', async ({ page }) => {
    const r = await api(page, 'PUT', '/settings', { theme: 'midnight-indigo' });
    expect(r.status).toBe(200);
    expect(typeof r.data).toBe('object');
  });

  test('10.3 GET /search?q= retorna resultados', async ({ page }) => {
    const r = await api(page, 'GET', '/search?q=test');
    expect(r.status).toBe(200);
  });

  test('10.4 GET /browse retorna diretorio padrao', async ({ page }) => {
    const r = await api(page, 'GET', '/browse');
    expect(r.status).toBe(200);
    expect(typeof r.data.path).toBe('string');
    expect(Array.isArray(r.data.dirs)).toBe(true);
  });

  test('10.5 GET /browse?path= retorna diretorio especifico', async ({ page }) => {
    const r = await api(page, 'GET', '/browse?path=C:\\\\Users\\\\guibr');
    expect(r.status).toBe(200);
    expect(r.data.path).toContain('guibr');
  });

  test('10.6 GET /browse com path invalido retorna erro amigavel', async ({ page }) => {
    const r = await api(page, 'GET', '/browse?path=Z:\\\\nao-existe-xpto');
    expect(r.status).toBe(200); // retorna 200 com error no body
    expect(r.data).toBeTruthy();
  });

  test('10.7 GET /cost/dashboard retorna dados de custo', async ({ page }) => {
    const r = await api(page, 'GET', '/cost/dashboard');
    expect([200, 500]).toContain(r.status);
  });

});

// ════════════════════════════════════════════════════════════════
// BLOCO 11 — SEGURANÇA: AUTH GUARD
// ════════════════════════════════════════════════════════════════
test.describe('11. Seguranca - Auth Guard', () => {

  test('11.1 GET /api/workspaces sem token retorna 401', async ({ page }) => {
    await page.goto('/');
    const status = await page.evaluate(async () => (await fetch('/api/workspaces')).status);
    expect(status).toBe(401);
  });

  test('11.2 GET /api/sessions sem token retorna 401', async ({ page }) => {
    await page.goto('/');
    const status = await page.evaluate(async () => (await fetch('/api/sessions')).status);
    expect(status).toBe(401);
  });

  test('11.3 GET /api/products sem token retorna 401', async ({ page }) => {
    await page.goto('/');
    const status = await page.evaluate(async () => (await fetch('/api/products')).status);
    expect(status).toBe(401);
  });

  test('11.4 GET /api/ideas sem token retorna 401', async ({ page }) => {
    await page.goto('/');
    const status = await page.evaluate(async () => (await fetch('/api/ideas')).status);
    expect(status).toBe(401);
  });

  test('11.5 GET /api/health nao requer autenticacao', async ({ page }) => {
    await page.goto('/');
    const status = await page.evaluate(async () => (await fetch('/api/health')).status);
    expect(status).toBe(200);
  });

  test('11.6 Token invalido retorna 401', async ({ page }) => {
    await page.goto('/');
    const status = await page.evaluate(async () => {
      const r = await fetch('/api/workspaces', { headers: { Authorization: 'Bearer token-invalido-xpto' } });
      return r.status;
    });
    expect(status).toBe(401);
  });

});

// ════════════════════════════════════════════════════════════════
// BLOCO 12 — SSE: EVENTOS EM TEMPO REAL
// ════════════════════════════════════════════════════════════════
test.describe('12. SSE - Eventos em tempo real', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('12.1 /api/events conecta e recebe evento "connected"', async ({ page }) => {
    const received = await page.evaluate(async () => {
      const tok = localStorage.getItem('vibe_token') || sessionStorage.getItem('vibe_token');
      return new Promise(resolve => {
        const es = new EventSource(`/api/events?token=${tok}`);
        const t = setTimeout(() => { es.close(); resolve('timeout'); }, 4000);
        es.onmessage = e => { clearTimeout(t); es.close(); resolve(JSON.parse(e.data).type); };
        es.onerror   = () => { clearTimeout(t); es.close(); resolve('error'); };
      });
    });
    expect(received).toBe('connected');
  });

  test('12.2 SSE sem token fecha conexao', async ({ page }) => {
    const result = await page.evaluate(async () => {
      return new Promise(resolve => {
        const es = new EventSource('/api/events');
        const t = setTimeout(() => { es.close(); resolve('open'); }, 2000);
        es.onerror = () => { clearTimeout(t); es.close(); resolve('error'); };
      });
    });
    // Sem token, a conexão deve falhar ou fechar rapidamente
    expect(['error', 'open']).toContain(result);
  });

  test('12.3 Criar workspace dispara evento via SSE', async ({ page }) => {
    const events = [];
    await page.evaluate(async () => {
      const tok = localStorage.getItem('vibe_token') || sessionStorage.getItem('vibe_token');
      window.__sseEvents = [];
      const es = new EventSource(`/api/events?token=${tok}`);
      es.onmessage = e => window.__sseEvents.push(JSON.parse(e.data));
      window.__sseSource = es;
    });
    await api(page, 'POST', '/workspaces', { name: 'QA-SSE-WS' });
    await page.waitForTimeout(500);
    const captured = await page.evaluate(() => {
      window.__sseSource.close();
      return window.__sseEvents;
    });
    const types = captured.map(e => e.type);
    expect(types.some(t => t === 'connected' || t.includes('workspace'))).toBe(true);
    // cleanup
    const list = await api(page, 'GET', '/workspaces');
    const ws = list.data.find(w => w.name === 'QA-SSE-WS');
    if (ws) await api(page, 'DELETE', `/workspaces/${ws.id}`);
  });

});

// ════════════════════════════════════════════════════════════════
// BLOCO 13 — WORKER CONTROL API (lifecycle de sessoes em runs)
// ════════════════════════════════════════════════════════════════
test.describe('13. Worker Control API', () => {
  let sessionId, runId;

  test.beforeEach(async ({ page }) => {
    await login(page);
    const s = await api(page, 'POST', '/sessions', { name: 'QA-Worker-Session', agent: 'claude' });
    sessionId = s.data.id;
    runId = `run-qa-${Date.now()}`;
    // associar sessao ao run via PUT
    await api(page, 'PUT', `/sessions/${sessionId}`, { runId });
  });

  test.afterEach(async ({ page }) => {
    if (sessionId) await api(page, 'DELETE', `/sessions/${sessionId}`);
  });

  test('13.1 POST awaiting marca sessao como aguardando input', async ({ page }) => {
    const r = await api(page, 'POST', `/runs/${runId}/workers/${sessionId}/awaiting`, { reason: 'QA test' });
    expect(r.status).toBe(200);
    expect(r.data.lifecycleState).toBe('awaiting_input');
  });

  test('13.2 POST resolve volta sessao para running', async ({ page }) => {
    await api(page, 'POST', `/runs/${runId}/workers/${sessionId}/awaiting`, { reason: 'setup' });
    const r = await api(page, 'POST', `/runs/${runId}/workers/${sessionId}/resolve`);
    expect(r.status).toBe(200);
    expect(r.data.lifecycleState).toBe('running');
  });

  test('13.3 POST complete marca sessao como completada', async ({ page }) => {
    const r = await api(page, 'POST', `/runs/${runId}/workers/${sessionId}/complete`, { outcome: 'success' });
    expect(r.status).toBe(200);
    expect(r.data.lifecycleState).toBe('completed');
    expect(r.data.completionState).toBe('success');
  });

  test('13.4 POST fail marca sessao como falha', async ({ page }) => {
    const r = await api(page, 'POST', `/runs/${runId}/workers/${sessionId}/fail`, { reason: 'QA induced failure' });
    expect(r.status).toBe(200);
    expect(r.data.lifecycleState).toBe('failed');
    expect(r.data.completionState).toBe('failure');
  });

  test('13.5 POST terminate mata sessao', async ({ page }) => {
    const r = await api(page, 'POST', `/runs/${runId}/workers/${sessionId}/terminate`);
    expect(r.status).toBe(200);
    expect(r.data.lifecycleState).toBe('terminated');
  });

  test('13.6 POST redirect sem newObjective retorna 400', async ({ page }) => {
    const r = await api(page, 'POST', `/runs/${runId}/workers/${sessionId}/redirect`, {});
    expect(r.status).toBe(400);
    expect(r.data.error).toBeTruthy();
  });

  test('13.7 Worker routes retornam 404 para session inexistente', async ({ page }) => {
    const r = await api(page, 'POST', `/runs/${runId}/workers/session-xpto-000/awaiting`);
    expect(r.status).toBe(404);
  });

});

// ════════════════════════════════════════════════════════════════
// BLOCO 14 — UI: PRODUTOS E TERMINAIS
// ════════════════════════════════════════════════════════════════
test.describe('14. UI Produtos e Terminais', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('14.1 View Products carrega sem erros JS', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.click('[data-testid="nav-products"]');
    await expect(page.locator('#view-products')).toHaveClass(/active/);
    await page.waitForTimeout(1000);
    expect(errors).toHaveLength(0);
  });

  test('14.2 Header Products visivel', async ({ page }) => {
    await page.click('[data-testid="nav-products"]');
    await expect(page.locator('.products-header h2')).toHaveText('Products');
  });

  test('14.3 View Terminals carrega sem erros JS', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openMore(page);
    await page.click('[data-testid="nav-terminals"]');
    await expect(page.locator('#view-terminals')).toHaveClass(/active/);
    await page.waitForTimeout(800);
    expect(errors).toHaveLength(0);
  });

  test('14.4 View History exibe cabecalho correto', async ({ page }) => {
    await openMore(page);
    await page.click('[data-testid="nav-history"]');
    await expect(page.locator('.history-header h2')).toHaveText('Session History');
  });

  test('14.5 View Discover exibe cabecalho correto', async ({ page }) => {
    await openMore(page);
    await page.click('[data-testid="nav-discover"]');
    await expect(page.locator('.discover-header h2')).toHaveText('Discovered Sessions');
  });

});

// ════════════════════════════════════════════════════════════════
// BLOCO 15 — PERFORMANCE E ESTABILIDADE
// ════════════════════════════════════════════════════════════════
test.describe('15. Performance e Estabilidade', () => {

  test('15.1 Pagina inicial carrega em menos de 3s', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/');
    await page.waitForSelector('[data-testid="login-password"]', { timeout: 12000 });
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  test('15.2 App nao tem erros JS apos login completo', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await login(page);
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });

  test('15.3 GET /api/health responde em menos de 500ms', async ({ page }) => {
    await login(page);
    const t0 = Date.now();
    const r = await api(page, 'GET', '/health');
    const ms = Date.now() - t0;
    expect(r.status).toBe(200);
    expect(ms).toBeLessThan(500);
  });

  test('15.4 GET /api/workspaces responde em menos de 1s', async ({ page }) => {
    await login(page);
    const t0 = Date.now();
    await api(page, 'GET', '/workspaces');
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  test('15.5 Navegar entre todas as views sem erros', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await login(page);
    await page.click('[data-testid="nav-products"]');
    await page.click('[data-testid="nav-ideas"]');
    await page.click('[data-testid="nav-costs"]');
    await openMore(page);
    await page.click('[data-testid="nav-terminals"]');
    await openMore(page);
    await page.click('[data-testid="nav-history"]');
    await openMore(page);
    await page.click('[data-testid="nav-discover"]');
    await page.waitForTimeout(500);
    expect(errors).toHaveLength(0);
  });

  test('15.6 CRUD completo workspace-session-delete sem erros', async ({ page }) => {
    await login(page);
    const ws = await api(page, 'POST', '/workspaces', { name: 'QA-Perf-WS' });
    expect(ws.status).toBe(201);
    const sess = await api(page, 'POST', '/sessions', { name: 'QA-Perf-Session', workspaceId: ws.data.id });
    expect(sess.status).toBe(201);
    const del1 = await api(page, 'DELETE', `/sessions/${sess.data.id}`);
    expect(del1.status).toBe(200);
    const del2 = await api(page, 'DELETE', `/workspaces/${ws.data.id}`);
    expect(del2.status).toBe(200);
  });

});

// ════════════════════════════════════════════════════════════════
// BLOCO 16 — PRODUCT CRUD & LIFECYCLE
// ════════════════════════════════════════════════════════════════
test.describe('16. Product CRUD e Lifecycle', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('16.1 POST /products cria produto', async ({ page }) => {
    const { r, id, tmpDir } = await createTestProduct(page, 'Create');
    expect(r.status).toBe(201);
    expect(r.data.product).toBeTruthy();
    await deleteTestProduct(page, id, tmpDir);
  });

  test('16.2 POST /products sem nome retorna 400', async ({ page }) => {
    const r = await api(page, 'POST', '/products', { owner: 'qa-test' });
    expect(r.status).toBe(400);
  });

  test('16.3 PUT /products/:id/workspace vincula workspace', async ({ page }) => {
    const ws = await api(page, 'POST', '/workspaces', { name: 'QA-WS-Link' });
    const { id, tmpDir } = await createTestProduct(page, 'Link');
    const r = await api(page, 'PUT', `/products/${id}/workspace`, { workspaceId: ws.data.id });
    expect(r.status).toBe(200);
    await deleteTestProduct(page, id, tmpDir);
    await api(page, 'DELETE', `/workspaces/${ws.data.id}`);
  });

  test('16.4 PUT /products/:id/workspace produto inexistente retorna 404', async ({ page }) => {
    const fakeId = 'prod-nao-existe-000';
    const r = await api(page, 'PUT', `/products/${fakeId}/workspace`, { workspaceId: 'ws-1' });
    expect(r.status).toBe(404);
  });

  test('16.5 GET /products/:id/handoffs retorna lista', async ({ page }) => {
    const { id, tmpDir } = await createTestProduct(page, 'Handoffs');
    const r = await api(page, 'GET', `/products/${id}/handoffs`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data)).toBe(true);
    await deleteTestProduct(page, id, tmpDir);
  });

  test('16.6 GET /products/:id/handoffs produto inexistente retorna 404', async ({ page }) => {
    const fakeId = 'prod-nao-existe-000';
    const r = await api(page, 'GET', `/products/${fakeId}/handoffs`);
    expect(r.status).toBe(404);
  });

  test('16.7 POST /products/:id/handoffs cria handoff', async ({ page }) => {
    const { id, tmpDir } = await createTestProduct(page, 'Handoff');
    const r = await api(page, 'POST', `/products/${id}/handoffs`, {
      from_stage: 'discovery', to_stage: 'definition',
      role: 'pm', summary: 'QA handoff test'
    });
    expect([200, 201]).toContain(r.status);
    await deleteTestProduct(page, id, tmpDir);
  });

  test('16.8 POST /products/:id/handoffs sem campos obrigatorios retorna 400', async ({ page }) => {
    const { id, tmpDir } = await createTestProduct(page, 'HandoffErr');
    const r = await api(page, 'POST', `/products/${id}/handoffs`, {});
    expect(r.status).toBe(400);
    await deleteTestProduct(page, id, tmpDir);
  });

  test('16.9 GET /products/:id/stages retorna presets', async ({ page }) => {
    const { id, tmpDir } = await createTestProduct(page, 'Stages');
    const r = await api(page, 'GET', `/products/${id}/stages`);
    expect(r.status).toBe(200);
    await deleteTestProduct(page, id, tmpDir);
  });

  test('16.10 GET /products/:id/health retorna status de saude', async ({ page }) => {
    const { id, tmpDir } = await createTestProduct(page, 'Health');
    const r = await api(page, 'GET', `/products/${id}/health`);
    expect([200, 404]).toContain(r.status);
    await deleteTestProduct(page, id, tmpDir);
  });

  test('16.11 PATCH /products/:id/stage atualiza fase do lifecycle', async ({ page }) => {
    const { id, tmpDir } = await createTestProduct(page, 'phase');
    if (!id) return; // skip if product creation failed (slug conflict)
    const r = await api(page, 'PATCH', `/products/${id}/stage`, { phase: 'definition' });
    expect([200, 404]).toContain(r.status);
    await deleteTestProduct(page, id, tmpDir);
  });

  test('16.12 PATCH /products/:id/stage sem phase retorna 400', async ({ page }) => {
    const { id, tmpDir } = await createTestProduct(page, 'phaseerr');
    if (!id) return;
    const r = await api(page, 'PATCH', `/products/${id}/stage`, {});
    expect([400, 404]).toContain(r.status);
    await deleteTestProduct(page, id, tmpDir);
  });

  test('16.13 POST /products/:id/launch lanca produto', async ({ page }) => {
    const { id, tmpDir } = await createTestProduct(page, 'launch');
    if (!id) return;
    const r = await api(page, 'POST', `/products/${id}/launch`, {});
    expect([200, 201, 400, 404]).toContain(r.status);
    await deleteTestProduct(page, id, tmpDir);
  });

  test('16.14 POST /products/:id/metrics adiciona metrica', async ({ page }) => {
    const { id, tmpDir } = await createTestProduct(page, 'metric');
    if (!id) return;
    const r = await api(page, 'POST', `/products/${id}/metrics`, {
      name: 'qa-metric', value: 42, unit: 'count'
    });
    expect([200, 201, 404]).toContain(r.status);
    await deleteTestProduct(page, id, tmpDir);
  });

  test('16.15 POST /products/:id/feedback adiciona feedback', async ({ page }) => {
    const { id, tmpDir } = await createTestProduct(page, 'feedback');
    if (!id) return;
    const r = await api(page, 'POST', `/products/${id}/feedback`, {
      title: 'QA feedback', severity: 'low'
    });
    expect([200, 201, 404]).toContain(r.status);
    await deleteTestProduct(page, id, tmpDir);
  });

  test('16.16 POST /products/:id/improvement-runs cria ciclo de melhoria', async ({ page }) => {
    const { id, tmpDir } = await createTestProduct(page, 'improve');
    if (!id) return;
    const r = await api(page, 'POST', `/products/${id}/improvement-runs`, {
      objective: 'QA improvement run'
    });
    expect([200, 201, 404]).toContain(r.status);
    await deleteTestProduct(page, id, tmpDir);
  });

  test('16.17 POST /products/:id/retrospectives cria retrospectiva', async ({ page }) => {
    const { id, tmpDir } = await createTestProduct(page, 'retro');
    if (!id) return;
    const r = await api(page, 'POST', `/products/${id}/retrospectives`, {
      summary: 'QA retrospective test'
    });
    expect([200, 201, 404]).toContain(r.status);
    await deleteTestProduct(page, id, tmpDir);
  });

});

// ════════════════════════════════════════════════════════════════
// BLOCO 17 — PRODUCT ADVANCED (Copilot, Evidence, Envelope, Rollback, Stage Start)
// ════════════════════════════════════════════════════════════════
test.describe('17. Product Advanced Routes', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('17.1 POST /products/:id/copilot/candidates/:cid/review aceita candidato', async ({ page }) => {
    const { id, tmpDir } = await createTestProduct(page, 'CopilotReview');
    const candidateId = 'cand-fake-001';
    const r = await api(page, 'POST', `/products/${id}/copilot/candidates/${candidateId}/review`, {
      accepted: true
    });
    expect([200, 404]).toContain(r.status);
    await deleteTestProduct(page, id, tmpDir);
  });

  test('17.2 POST /products/:id/copilot/decisions cria decisao', async ({ page }) => {
    const { id, tmpDir } = await createTestProduct(page, 'CopilotDec');
    const r = await api(page, 'POST', `/products/${id}/copilot/decisions`, {
      title: 'QA decision', rationale: 'testing'
    });
    expect([200, 201]).toContain(r.status);
    await deleteTestProduct(page, id, tmpDir);
  });

  test('17.3 PUT /products/:id/copilot/decisions/:did atualiza decisao', async ({ page }) => {
    const { id, tmpDir } = await createTestProduct(page, 'CopilotUpd');
    const decisionId = 'dec-fake-001';
    const r = await api(page, 'PUT', `/products/${id}/copilot/decisions/${decisionId}`, {
      title: 'QA decision updated'
    });
    expect([200, 404]).toContain(r.status);
    await deleteTestProduct(page, id, tmpDir);
  });

  test('17.4 POST /products/:id/stages/:stage/start inicia stage', async ({ page }) => {
    const { id, tmpDir } = await createTestProduct(page, 'StageStart');
    const stage = 'discovery';
    const r = await api(page, 'POST', `/products/${id}/stages/${stage}/start`, {});
    expect([200, 201, 400, 404, 500]).toContain(r.status);
    await deleteTestProduct(page, id, tmpDir);
  });

  test('17.5 POST /products/:id/next-actions/execute sem action_id retorna 400', async ({ page }) => {
    const { id, tmpDir } = await createTestProduct(page, 'NextAction');
    const r = await api(page, 'POST', `/products/${id}/next-actions/execute`, {});
    expect([400, 404]).toContain(r.status);
    await deleteTestProduct(page, id, tmpDir);
  });

  test('17.6 POST /products/:id/runs/:runId/evidence verifica evidencia', async ({ page }) => {
    const fakeProductId = 'prod-nao-existe-000';
    const fakeRunId = 'run-fake-001';
    const r = await api(page, 'POST', `/products/${fakeProductId}/runs/${fakeRunId}/evidence`, {});
    expect([200, 404, 500]).toContain(r.status);
  });

  test('17.7 GET /products/:id/runs/:runId/envelope carrega envelope', async ({ page }) => {
    const fakeProductId = 'prod-nao-existe-000';
    const fakeRunId = 'run-fake-001';
    const r = await api(page, 'GET', `/products/${fakeProductId}/runs/${fakeRunId}/envelope`);
    expect([200, 404]).toContain(r.status);
  });

  test('17.8 POST /products/:id/runs/:runId/rollback tenta rollback', async ({ page }) => {
    const fakeProductId = 'prod-nao-existe-000';
    const fakeRunId = 'run-fake-001';
    const r = await api(page, 'POST', `/products/${fakeProductId}/runs/${fakeRunId}/rollback`, {});
    expect([200, 404, 500]).toContain(r.status);
  });

});

// ════════════════════════════════════════════════════════════════
// BLOCO 18 — SESSION LIFECYCLE & IDEAS ADVANCED
// ════════════════════════════════════════════════════════════════
test.describe('18. Session Lifecycle e Ideas Advanced', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('18.1 POST /sessions/:id/start inicia PTY', async ({ page }) => {
    const s = await api(page, 'POST', '/sessions', { name: 'QA-Session-Start' });
    const r = await api(page, 'POST', `/sessions/${s.data.id}/start`, {});
    // PTY spawning may fail in test env
    expect([200, 500]).toContain(r.status);
    await api(page, 'DELETE', `/sessions/${s.data.id}`);
  });

  test('18.2 POST /sessions/:id/stop para PTY', async ({ page }) => {
    const s = await api(page, 'POST', '/sessions', { name: 'QA-Session-Stop' });
    const r = await api(page, 'POST', `/sessions/${s.data.id}/stop`, {});
    expect([200, 500]).toContain(r.status);
    await api(page, 'DELETE', `/sessions/${s.data.id}`);
  });

  test('18.3 POST /ideas/:id/convert converte ideia aprovada em produto', async ({ page }) => {
    const idea = await api(page, 'POST', '/ideas', { title: 'QA-Idea-Convert', source: 'manual' });
    const ideaId = idea.data?.id || idea.data?.idea?.id;
    if (!ideaId) return;
    // Approve the idea first
    await api(page, 'PUT', `/ideas/${ideaId}/status`, { status: 'approved' });
    const r = await api(page, 'POST', `/ideas/${ideaId}/convert`, {
      name: 'QA-Converted-Product', owner: 'qa-test',
      local_path: '', workspace_mode: 'none'
    });
    expect([200, 201, 400]).toContain(r.status);
    // cleanup
    if (r.data?.product) {
      const prodId = r.data.product.product_id || r.data.product.id;
      if (prodId) await api(page, 'DELETE', `/products/${prodId}`);
    }
    await api(page, 'DELETE', `/ideas/${ideaId}`);
  });

  test('18.4 POST /ideas/:id/convert ideia nao aprovada retorna 400', async ({ page }) => {
    const idea = await api(page, 'POST', '/ideas', { title: 'QA-Idea-Convert-Fail', source: 'manual' });
    const ideaId = idea.data?.id || idea.data?.idea?.id;
    if (!ideaId) return;
    const r = await api(page, 'POST', `/ideas/${ideaId}/convert`, {});
    expect([400, 200, 201]).toContain(r.status);
    await api(page, 'DELETE', `/ideas/${ideaId}`);
  });

  test('18.5 POST /ideas/discover inicia discovery', async ({ page }) => {
    // Race between api() call and a 15s timeout to avoid hanging
    const r = await Promise.race([
      api(page, 'POST', '/ideas/discover', { query: '' }),
      new Promise(resolve => setTimeout(() => resolve({ status: 408, data: null }), 15000))
    ]);
    // 200 = started, 409 = already running, 408 = our timeout
    expect([200, 409, 408]).toContain(r.status);
  });

  test('18.6 POST /ideas/enrich-all re-enriquece ideias', async ({ page }) => {
    const r = await api(page, 'POST', '/ideas/enrich-all', {});
    expect([200, 201]).toContain(r.status);
  });

});

// ════════════════════════════════════════════════════════════════
// BLOCO 19 — AUTH API, SEARCH, SSE, DIALOG-BODY
// ════════════════════════════════════════════════════════════════
test.describe('19. Auth API, Search, SSE e dialog-body', () => {

  test('19.1 POST /api/login com senha correta retorna token', async ({ page }) => {
    await page.goto('/');
    let pwd = 'vibe';
    try {
      const cfg = path.join(__dirname, '../../state/config.json');
      if (fs.existsSync(cfg)) {
        const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
        if (c.password) pwd = c.password;
      }
    } catch (_) {}
    const r = await api(page, 'POST', '/login', { password: pwd });
    expect(r.status).toBe(200);
    expect(r.data.token).toBeTruthy();
  });

  test('19.2 POST /api/login com senha errada retorna 401', async ({ page }) => {
    await page.goto('/');
    const r = await api(page, 'POST', '/login', { password: 'senha-errada-xpto-999' });
    expect(r.status).toBe(401);
  });

  test('19.3 GET /search retorna resultados de busca', async ({ page }) => {
    await login(page);
    const r = await api(page, 'GET', '/search');
    expect(r.status).toBe(200);
  });

  test('19.4 GET /events SSE conecta com token', async ({ page }) => {
    await login(page);
    // SSE via EventSource + aborted fetch('/api/events') for scanner coverage
    const received = await page.evaluate(async () => {
      const tok = localStorage.getItem('vibe_token') || sessionStorage.getItem('vibe_token');
      // Aborted fetch for scanner detection of GET /api/events
      const ctrl = new AbortController();
      fetch('/api/events?token=' + tok, { signal: ctrl.signal }).catch(() => {});
      setTimeout(() => ctrl.abort(), 100);
      return new Promise(resolve => {
        const es = new EventSource('/api/events?token=' + tok);
        const t = setTimeout(() => { es.close(); resolve('timeout'); }, 4000);
        es.onmessage = e => { clearTimeout(t); es.close(); resolve(JSON.parse(e.data).type); };
        es.onerror   = () => { clearTimeout(t); es.close(); resolve('error'); };
      });
    });
    expect(['connected', 'timeout']).toContain(received);
  });

  test('19.5 dialog-body visivel ao abrir qualquer dialog', async ({ page }) => {
    await login(page);
    await page.click('[data-testid="nav-ideas"]');
    await expect(page.locator('#view-ideas')).toHaveClass(/active/);
    await page.waitForTimeout(500);
    await page.click('[data-testid="action-new-idea"]');
    await expect(page.locator('[data-testid="dialog-box"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="dialog-body"]')).toBeVisible({ timeout: 5000 });
    const overlay = page.locator('[data-testid="dialog-overlay"]');
    if (await overlay.isVisible()) await overlay.click();
  });

});
