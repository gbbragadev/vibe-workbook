# Frontend & Backend Modularization Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Modularizar o monolítico `app.js` (2979 linhas + ~277 da branch ideas) em módulos JS separados por responsabilidade, e desacoplar rotas do `server.js` em route files dedicados — tudo sem introduzir frameworks de build (Vanilla JS, `<script>` tags).

**Architecture:** O frontend continua Vanilla JS com scripts carregados via `<script>` no `index.html`. Cada módulo exporta para o namespace global `window.VW` (Vibe Workbook). O `app.js` vira um orquestrador fino que importa os módulos e conecta tudo. No backend, as rotas são extraídas para arquivos em `src/web/routes/` usando Express Router.

**Tech Stack:** Node.js/Express, Vanilla JS (no build step), Express Router, node:test

**Pre-requisito:** A branch `feature/ideas-pipeline` já foi mergeada no main.

---

### Task 0: Merge da branch Ideas e baseline verde

**Files:**
- N/A (git operation)

**Step 1: Merge da branch ideas no main**

```bash
git merge feature/ideas-pipeline --no-edit
```

**Step 2: Resolver conflitos se houver**

Inspecionar conflitos em `app.js`, `index.html`, `styles.css`, `server.js` e resolver mantendo ambas as mudanças.

**Step 3: Rodar testes para confirmar baseline verde**

Run: `node --test`
Expected: Todos os testes passam (existentes + 27 novos da branch ideas)

**Step 4: Commit do merge**

```bash
git add -A
git commit -m "merge: integrate feature/ideas-pipeline into main"
```

---

### Task 1: Criar módulo `api-client.js` — extrair função `api()` e helpers de fetch

**Files:**
- Create: `src/web/public/api-client.js`
- Modify: `src/web/public/app.js` (linhas ~46-54)
- Modify: `src/web/public/index.html` (adicionar `<script>`)

**Step 1: Criar o módulo api-client.js**

```javascript
/**
 * Vibe Workbook - API Client
 * Centralized HTTP client for backend communication
 */
(function() {
  'use strict';

  function getToken() {
    return window.VW_TOKEN || localStorage.getItem('vibe_token') || '';
  }

  function setToken(t) {
    window.VW_TOKEN = t;
    if (t) localStorage.setItem('vibe_token', t);
    else localStorage.removeItem('vibe_token');
  }

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const tk = getToken();
    if (tk) headers['Authorization'] = `Bearer ${tk}`;
    const res = await fetch(`/api${path}`, { ...opts, headers });
    if (res.status === 401) {
      document.dispatchEvent(new CustomEvent('vw:unauthorized'));
      throw new Error('Unauthorized');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('Request failed: ' + res.status));
    return data;
  }

  window.VW = window.VW || {};
  window.VW.api = api;
  window.VW.getToken = getToken;
  window.VW.setToken = setToken;
})();
```

**Step 2: Adicionar o script no index.html ANTES do app.js**

Em `index.html`, antes de `<script src="/app.js"></script>`, adicionar:

```html
  <script src="/api-client.js"></script>
```

**Step 3: Modificar app.js para usar VW.api**

Remover a função `api()` local (linhas ~46-54) e substituir todas as chamadas internas por `VW.api()`. Substituir a gestão do token (`token` local) por `VW.getToken()` / `VW.setToken()`. Adicionar listener para o evento `vw:unauthorized`:

```javascript
document.addEventListener('vw:unauthorized', showLogin);
```

**Step 4: Testar no navegador**

Run: `VIBE_NO_OPEN=1 node src/gui.js`
- Abrir no browser, fazer login, navegar entre views
- Verificar que chamadas API funcionam (products carregam, sessions listam)
- Verificar console sem erros

**Step 5: Commit**

```bash
git add src/web/public/api-client.js src/web/public/app.js src/web/public/index.html
git commit -m "refactor(frontend): extract api-client.js module"
```

---

### Task 2: Criar módulo `sse-client.js` — extrair SSE connection e event dispatch

**Files:**
- Create: `src/web/public/sse-client.js`
- Modify: `src/web/public/app.js` (linhas ~134-165)
- Modify: `src/web/public/index.html`

**Step 1: Criar o módulo sse-client.js**

```javascript
/**
 * Vibe Workbook - SSE Client
 * Manages Server-Sent Events connection and dispatches as DOM events
 */
(function() {
  'use strict';

  let eventSource = null;
  let reconnectTimer = null;

  function connect() {
    if (eventSource) eventSource.close();
    const tk = window.VW.getToken();
    eventSource = new EventSource(`/api/events${tk ? '?token=' + tk : ''}`);
    eventSource.onmessage = function(e) {
      try {
        const msg = JSON.parse(e.data);
        document.dispatchEvent(new CustomEvent('vw:sse', { detail: msg }));
      } catch (_) {}
    };
    eventSource.onerror = function() {
      eventSource.close();
      eventSource = null;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 5000);
    };
  }

  function disconnect() {
    if (eventSource) eventSource.close();
    eventSource = null;
    clearTimeout(reconnectTimer);
  }

  window.VW = window.VW || {};
  window.VW.sse = { connect, disconnect };
})();
```

**Step 2: Adicionar script no index.html (depois de api-client.js, antes de app.js)**

```html
  <script src="/sse-client.js"></script>
```

**Step 3: Modificar app.js**

Remover `connectSSE()` e `handleSSE()` locais. Substituir por:

```javascript
document.addEventListener('vw:sse', function(e) { handleSSE(e.detail); });
```

Onde `handleSSE` continua existindo no `app.js` mas agora recebe o `msg` do CustomEvent. Substituir chamadas a `connectSSE()` por `VW.sse.connect()`.

**Step 4: Testar no navegador**

- Verificar que SSE reconecta (fechar/reabrir aba)
- Criar sessão e verificar que evento aparece em real-time
- Console sem erros

**Step 5: Commit**

```bash
git add src/web/public/sse-client.js src/web/public/app.js src/web/public/index.html
git commit -m "refactor(frontend): extract sse-client.js module"
```

---

### Task 3: Criar módulo `utils.js` — extrair utilitários compartilhados

**Files:**
- Create: `src/web/public/utils.js`
- Modify: `src/web/public/app.js` (linhas ~2843-2870)
- Modify: `src/web/public/index.html`

**Step 1: Criar utils.js**

Extrair de `app.js` as funções utilitárias puras (sem dependência de state):

```javascript
/**
 * Vibe Workbook - Shared Utilities
 */
(function() {
  'use strict';

  function esc(str) {
    if (!str) return '';
    const el = document.createElement('span');
    el.textContent = String(str);
    return el.innerHTML;
  }

  function formatTokens(n) {
    if (!n) return '0';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const d = Date.now() - new Date(ts).getTime();
    if (d < 60000) return 'just now';
    if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
    if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
    return Math.floor(d / 86400000) + 'd ago';
  }

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  function formatDateTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString();
  }

  function slugify(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  }

  window.VW = window.VW || {};
  window.VW.utils = { esc, formatTokens, timeAgo, wait, formatDateTime, slugify };
})();
```

**Step 2: Adicionar script no index.html (depois de sse-client.js, antes de app.js)**

```html
  <script src="/utils.js"></script>
```

**Step 3: Modificar app.js**

Remover as funções `esc()`, `formatTokens()`, `timeAgo()`, `wait()`, `formatDateTime()`, `slugifyClient()` do `app.js`. Substituir todas as chamadas por `VW.utils.esc()`, `VW.utils.timeAgo()`, etc. Isso pode ser feito com find-and-replace cuidadoso.

**Step 4: Testar no navegador**

- Navegar todas as views, verificar que timestamps, nomes escapados, e tokens aparecem corretamente
- Console sem erros

**Step 5: Commit**

```bash
git add src/web/public/utils.js src/web/public/app.js src/web/public/index.html
git commit -m "refactor(frontend): extract utils.js module"
```

---

### Task 4: Criar módulo `ideas-view.js` — extrair toda a UI de Ideas

**Files:**
- Create: `src/web/public/ideas-view.js`
- Modify: `src/web/public/app.js` (funções Ideas adicionadas pela branch)
- Modify: `src/web/public/index.html`

**Step 1: Identificar funções de Ideas no app.js**

Após o merge da branch ideas, as seguintes funções foram adicionadas ao app.js (~277 linhas):
- State: `ideas`, `activeIdeaId`, `discoveryStatus`
- `loadIdeas()`, `renderIdeasView()`, `renderIdeaDetail()`, `renderIdeaCard()`
- `startDiscoveryRun()`, `renderDiscoveryBar()`
- `updateIdeaStatus()`, `convertIdeaToProduct()`
- SSE handler para `idea:*` events
- Event bindings para `btn-ideas`, `btn-start-discovery`, `btn-new-idea`

**Step 2: Criar ideas-view.js com toda essa lógica**

```javascript
/**
 * Vibe Workbook - Ideas View
 * Handles idea discovery pipeline UI: discovery, curation, scoring, conversion
 */
(function() {
  'use strict';

  const { api } = window.VW;
  const { esc, timeAgo } = window.VW.utils;

  let ideas = [];
  let activeIdeaId = null;
  let discoveryStatus = null;

  // ... (mover todas as funções de ideas do app.js para cá,
  //      adaptando referências de api() para VW.api(),
  //      esc() para VW.utils.esc(), etc.)

  // Expor o que o app.js precisa chamar
  window.VW = window.VW || {};
  window.VW.ideas = {
    render: renderIdeasView,
    handleSSE: handleIdeaSSE,
    init: initIdeasBindings
  };
})();
```

O módulo deve:
- Conter todo o state de ideas (não mais no app.js)
- Gerenciar seus próprios event listeners (botões de Ideas)
- Expor apenas `render()`, `handleSSE(msg)`, e `init()` no namespace `VW.ideas`

**Step 3: Adicionar script no index.html (depois de utils.js, antes de app.js)**

```html
  <script src="/ideas-view.js"></script>
```

**Step 4: Modificar app.js**

- Remover state de ideas (`ideas`, `activeIdeaId`, `discoveryStatus`)
- Remover todas as funções de ideas
- No `renderCurrentView()`, o case `'ideas'` chama `VW.ideas.render()`
- No `handleSSE()`, delegar eventos `idea:*` para `VW.ideas.handleSSE(msg)`
- No `init()`, chamar `VW.ideas.init()` e remover bindings de ideas

**Step 5: Testar no navegador**

- Navegar para view Ideas
- Executar discovery
- Aprovar/rejeitar idea
- Converter idea em product
- Verificar que SSE atualiza a view em tempo real
- Console sem erros

**Step 6: Commit**

```bash
git add src/web/public/ideas-view.js src/web/public/app.js src/web/public/index.html
git commit -m "refactor(frontend): extract ideas-view.js module"
```

---

### Task 5: Extrair rotas Ideas do server.js para `src/web/routes/ideas.js`

**Files:**
- Create: `src/web/routes/ideas.js`
- Modify: `src/web/server.js` (remover ~80 linhas de rotas de ideas)

**Step 1: Escrever teste para as rotas de ideas (verificar que já existem)**

Run: `node --test tests/idea-integration.test.js`
Expected: PASS (baseline)

**Step 2: Criar src/web/routes/ideas.js usando Express Router**

```javascript
const { Router } = require('express');

function createIdeasRouter({ ideaService, ideaDiscoveryService, productService, store, broadcastSSE }) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(ideaService.getIdeas(req.query));
  });

  router.post('/', (req, res) => {
    const result = ideaService.createIdea(req.body || {});
    if (result.error) return res.status(400).json(result);
    broadcastSSE('idea:created', result);
    res.status(201).json(result);
  });

  router.get('/discover/status', (req, res) => {
    res.json(ideaDiscoveryService.getDiscoveryStatus());
  });

  router.post('/discover', async (req, res) => {
    const run = await ideaDiscoveryService.startDiscovery((req.body || {}).query || '');
    if (run.error) return res.status(409).json(run);
    broadcastSSE('idea:discovery:completed', run);
    res.json(run);
  });

  router.get('/:id', (req, res) => {
    const idea = ideaService.getIdeaById(req.params.id);
    if (!idea) return res.status(404).json({ error: 'Not found' });
    res.json(idea);
  });

  router.put('/:id', (req, res) => {
    const result = ideaService.updateIdea(req.params.id, req.body || {});
    if (result.error) return res.status(400).json(result);
    broadcastSSE('idea:updated', result);
    res.json(result);
  });

  router.delete('/:id', (req, res) => {
    ideaService.deleteIdea(req.params.id);
    broadcastSSE('idea:deleted', { id: req.params.id });
    res.json({ ok: true });
  });

  router.put('/:id/status', (req, res) => {
    const result = ideaService.updateIdeaStatus(req.params.id, (req.body || {}).status);
    if (result.error) return res.status(400).json(result);
    broadcastSSE('idea:updated', result);
    res.json(result);
  });

  router.post('/:id/convert', (req, res) => {
    const idea = ideaService.getIdeaById(req.params.id);
    if (!idea) return res.status(404).json({ error: 'Not found' });
    if (idea.status !== 'approved') return res.status(400).json({ error: 'Only approved ideas can be converted' });

    const payload = req.body || {};
    const productPayload = {
      name: payload.name || idea.title,
      owner: payload.owner || 'idea-discovery',
      summary: idea.problem || idea.summary,
      category: payload.category || 'product',
      stage: 'idea',
      slug: payload.slug || idea.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40),
      local_path: payload.local_path || '',
      workspace_mode: payload.workspace_mode || 'none'
    };

    const product = productService.createProduct(productPayload, store);
    if (product.error) return res.status(product.status || 400).json(product);

    ideaService.updateIdeaStatus(idea.id, 'converted');
    ideaService.updateIdea(idea.id, { convertedProductId: product.product.product_id });
    broadcastSSE('idea:updated', ideaService.getIdeaById(idea.id));
    res.json({ idea: ideaService.getIdeaById(idea.id), product: product.product });
  });

  return router;
}

module.exports = { createIdeasRouter };
```

**Step 3: Modificar server.js para usar o router**

No `server.js`:
- Adicionar `const { createIdeasRouter } = require('./routes/ideas');`
- Substituir todo o bloco `// --- Idea Routes ---` por:

```javascript
  app.use('/api/ideas', createIdeasRouter({
    ideaService, ideaDiscoveryService, productService, store, broadcastSSE
  }));
```

**Step 4: Rodar testes**

Run: `node --test`
Expected: Todos os testes passam

**Step 5: Testar manualmente**

- Abrir app, navegar para Ideas, executar discovery, converter idea
- Verificar que todas as rotas respondem corretamente

**Step 6: Commit**

```bash
git add src/web/routes/ideas.js src/web/server.js
git commit -m "refactor(backend): extract ideas routes to dedicated router"
```

---

### Task 6: Extrair lógica de conversão Idea→Product para `src/core/idea-converter.js`

**Files:**
- Create: `src/core/idea-converter.js`
- Create: `tests/idea-converter.test.js`
- Modify: `src/web/routes/ideas.js`

**Step 1: Escrever teste para o converter**

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { convertIdeaToProduct } = require('../src/core/idea-converter');

describe('convertIdeaToProduct', () => {
  it('should build product payload from approved idea', () => {
    const idea = {
      id: 'i1', title: 'Fix Login UX', problem: 'Login is confusing',
      summary: 'Users struggle', status: 'approved'
    };
    const result = convertIdeaToProduct(idea, {});
    assert.strictEqual(result.name, 'Fix Login UX');
    assert.strictEqual(result.summary, 'Login is confusing');
    assert.strictEqual(result.stage, 'idea');
    assert.ok(result.slug);
  });

  it('should allow overrides from payload', () => {
    const idea = {
      id: 'i2', title: 'Test', problem: 'p', status: 'approved'
    };
    const result = convertIdeaToProduct(idea, { name: 'Custom Name', owner: 'bob' });
    assert.strictEqual(result.name, 'Custom Name');
    assert.strictEqual(result.owner, 'bob');
  });

  it('should reject non-approved ideas', () => {
    const idea = { id: 'i3', title: 'X', status: 'new' };
    const result = convertIdeaToProduct(idea, {});
    assert.ok(result.error);
  });
});
```

**Step 2: Rodar teste para confirmar que falha**

Run: `node --test tests/idea-converter.test.js`
Expected: FAIL (module not found)

**Step 3: Implementar idea-converter.js**

```javascript
function convertIdeaToProduct(idea, payload = {}) {
  if (!idea || idea.status !== 'approved') {
    return { error: 'Only approved ideas can be converted' };
  }
  return {
    name: payload.name || idea.title,
    owner: payload.owner || 'idea-discovery',
    summary: idea.problem || idea.summary,
    category: payload.category || 'product',
    stage: 'idea',
    slug: payload.slug || idea.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40),
    local_path: payload.local_path || '',
    workspace_mode: payload.workspace_mode || 'none'
  };
}

module.exports = { convertIdeaToProduct };
```

**Step 4: Rodar teste para confirmar que passa**

Run: `node --test tests/idea-converter.test.js`
Expected: PASS

**Step 5: Atualizar src/web/routes/ideas.js para usar o converter**

Na rota `POST /:id/convert`:

```javascript
const { convertIdeaToProduct } = require('../../core/idea-converter');

// dentro do handler:
const productPayload = convertIdeaToProduct(idea, req.body || {});
if (productPayload.error) return res.status(400).json(productPayload);
```

**Step 6: Rodar todos os testes**

Run: `node --test`
Expected: PASS

**Step 7: Commit**

```bash
git add src/core/idea-converter.js tests/idea-converter.test.js src/web/routes/ideas.js
git commit -m "refactor(core): extract idea-to-product conversion logic"
```

---

### Task 7: Extrair rotas Products do server.js para `src/web/routes/products.js`

**Files:**
- Create: `src/web/routes/products.js`
- Modify: `src/web/server.js`

**Step 1: Identificar rotas de products no server.js**

Todas as rotas `/api/products/*` (inclui stages, runs, handoffs, copilot, knowledge-packs).

**Step 2: Criar src/web/routes/products.js usando Express Router**

Extrair todas as rotas de products seguindo o mesmo padrão da Task 5 — receber dependências via factory function, retornar Router.

```javascript
const { Router } = require('express');

function createProductsRouter({ productService, store, broadcastSSE, /* other deps */ }) {
  const router = Router();
  // ... todas as rotas de /api/products movidas para cá
  return router;
}

module.exports = { createProductsRouter };
```

**Step 3: Modificar server.js**

```javascript
const { createProductsRouter } = require('./routes/products');
app.use('/api/products', createProductsRouter({ productService, store, broadcastSSE, ... }));
```

**Step 4: Rodar testes**

Run: `node --test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/web/routes/products.js src/web/server.js
git commit -m "refactor(backend): extract products routes to dedicated router"
```

---

### Task 8: Extrair rotas restantes (workspaces, sessions, agents, config)

**Files:**
- Create: `src/web/routes/workspaces.js`
- Create: `src/web/routes/sessions.js`
- Modify: `src/web/server.js`

**Step 1: Criar routers para workspaces e sessions**

Seguir o mesmo padrão das Tasks 5 e 7. Rotas de agents, config, models e discover podem ficar no server.js por enquanto (são poucas e estáveis).

**Step 2: Montar no server.js**

```javascript
app.use('/api/workspaces', createWorkspacesRouter({ store, broadcastSSE }));
app.use('/api/sessions', createSessionsRouter({ store, ptyManager, broadcastSSE }));
```

**Step 3: Rodar testes**

Run: `node --test`
Expected: PASS

**Step 4: Verificar que server.js ficou significativamente menor**

O server.js deve ter agora ~150-200 linhas (setup, auth, SSE, WebSocket, middleware, mount routers).

**Step 5: Commit**

```bash
git add src/web/routes/workspaces.js src/web/routes/sessions.js src/web/server.js
git commit -m "refactor(backend): extract workspace and session routes to dedicated routers"
```

---

### Task 9: Verificação final e cleanup

**Files:**
- Modify: Various (cleanup only)

**Step 1: Rodar todos os testes**

Run: `node --test`
Expected: PASS

**Step 2: Testar manualmente todas as views**

Checklist:
- [ ] Login funciona
- [ ] Products view carrega e mostra lista
- [ ] Product detail renderiza com stages, runs, handoffs
- [ ] Iniciar stage cria session
- [ ] Terminal view mostra PTY funcional
- [ ] Ideas view (discovery, curate, convert)
- [ ] History view lista sessions
- [ ] Cost dashboard mostra dados
- [ ] Discover view scaneia sessions
- [ ] SSE atualiza todas as views em real-time
- [ ] Theme switching funciona
- [ ] Agent filter funciona

**Step 3: Verificar contagem de linhas**

```bash
wc -l src/web/public/*.js src/web/server.js src/web/routes/*.js
```

Esperado:
- `app.js`: ~2000-2200 linhas (redução de ~800)
- `api-client.js`: ~30 linhas
- `sse-client.js`: ~35 linhas
- `utils.js`: ~40 linhas
- `ideas-view.js`: ~280 linhas
- `server.js`: ~150-200 linhas (redução de ~450)
- `routes/ideas.js`: ~90 linhas
- `routes/products.js`: ~200 linhas
- `routes/workspaces.js`: ~80 linhas
- `routes/sessions.js`: ~80 linhas

**Step 4: Commit final se houver cleanup**

```bash
git add -A
git commit -m "chore: cleanup after frontend/backend modularization"
```

---

## Notas Importantes

### Restrições Arquiteturais
- **NÃO** introduzir Webpack, Vite, ou qualquer build tool no frontend
- **NÃO** usar ES modules (`import`/`export`) no frontend — manter IIFE com `window.VW` namespace
- **NÃO** alterar o modelo de persistência (JSON atômico em `state/`)
- **NÃO** alterar o padrão de SSE/WebSocket
- **NÃO** quebrar a navegação baseada em show/hide divs com `.hidden`

### Ordem de Dependência dos Scripts (index.html)
```html
<script src="/api-client.js"></script>    <!-- 1. API client (no deps) -->
<script src="/sse-client.js"></script>    <!-- 2. SSE (depends on VW.getToken) -->
<script src="/utils.js"></script>         <!-- 3. Utilities (no deps) -->
<script src="/ideas-view.js"></script>    <!-- 4. Ideas view (depends on VW.api, VW.utils) -->
<script src="/app.js"></script>           <!-- 5. Main orchestrator (depends on all above) -->
```

### Pontos de Integração Críticos
- `VW.sse.connect()` deve ser chamado após login bem-sucedido (em `app.js`)
- `handleSSE()` no `app.js` deve delegar para `VW.ideas.handleSSE()` quando `type.startsWith('idea:')`
- O dialog system (showDialog/hideDialog) permanece no `app.js` — views podem chamá-lo via `window.VW.dialog.show()`
