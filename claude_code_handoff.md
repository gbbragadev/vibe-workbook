# Engineering Handoff: Vibe Workbook & Ideas Feature

Este documento contém o diagnóstico técnico atualizado do projeto Vibe Workbook e um plano de ação (Handoff) direto e acionável para o Claude Code, focado nas implementações recentes da branch `feature/ideas-pipeline`.

---

## 1. Visão Geral do Repositório

- **Stack Principal:** 
  - **Backend:** Node.js (v18+) com Express.
  - **Frontend:** Single Page Application (SPA) em Vanilla JS (`app.js`), HTML estático e CSS puro. Não utiliza frameworks reativos.
  - **Persistência:** Baseada em sistema de arquivos locais (arquivos JSON na pasta `state/` e configurações em `products/`).
- **Padrão Arquitetural Observado:**
  - Aplicação monolítica com forte divisão de responsabilidades no backend (camadas de Serviços em `src/core/`), mas alto acoplamento na camada HTTP (`server.js`) e Frontend (`app.js`).
  - O estado do frontend é sincronizado com o backend utilizando **SSE (Server-Sent Events)**.
- **Estrutura de Pastas e Entrypoints:**
  - `src/gui.js`: Entrypoint que inicia o servidor Express e abre o navegador.
  - `src/web/server.js`: Controlador da API REST, gerenciador de WebSockets (PTY) e emissor de SSE.
  - `src/web/public/`: Contém todo o frontend (`index.html`, `styles.css`, `app.js`).
  - `src/core/`: Camada de domínio contendo adapters de LLMs, gerenciamento de execuções (`execution-orchestrator-service.js`), gerencia de produtos (`product-service.js`) e agora ideias (`idea-service.js`).
  - `state/`: Armazenamento de dados transacionais via JSON atômicos.
  - `tests/`: Testes em Node.js nativo (`node:test`).

---

## 2. Estado Atual da Feature Ideias (Branch `feature/ideas-pipeline`)

A funcionalidade ponta a ponta (Discovery -> Score -> Conversão) está implementada e testada, entregue em 7 commits com 12 arquivos novos e 27 testes.

- **Arquivos Envolvidos:**
  - **Core (Novos):** `src/core/idea-service.js`, `src/core/idea-discovery-service.js`.
  - **Discovery Providers (Novos):** `src/core/discovery-providers/` (`base`, `mock`, `reddit`, `web`, `x`).
  - **Testes (Novos):** `tests/idea-service.test.js`, `tests/idea-discovery-service.test.js`, `tests/discovery-providers.test.js`, `tests/idea-integration.test.js`.
  - **Modificados:** `src/web/server.js` (novas rotas) e frontend (`app.js`, `index.html`, `styles.css`).
- **Fluxo Real Concretizado:**
  - A UI chama `POST /api/ideas/discover`.
  - O backend aciona `IdeaDiscoveryService.startDiscovery()`, que executa sequencialmente a extração nos providers registrados usando `fetch` e `cheerio`.
  - Sinais (Signals) são coletados, parseados via Regex simples, pontuados (score) baseados no engajamento e match de palavras (stop-words eliminadas).
  - Ideias similares são agrupadas em *Ideas* e salvas no `IdeaService` (`state/ideas.json`).
- **Conversão Idea -> Product:**
  - Rota `POST /api/ideas/:id/convert` no `server.js` pega a Ideia no status `approved` e injeta um novo produto chamando `productService.createProduct()`.
- **Partes Reais vs Mockadas:**
  - **Real:** O App em execução faz scraping de verdade (Reddit via API JSON; DuckDuckGo HTML para a Web e X).
  - **Mockado:** A suíte de testes (27 asserts passando) usa exclusivamente o `MockDiscoveryProvider` focado nas lógicas matemáticas, Regex parser e no transacional de status (`new -> reviewing -> approved -> converted`). Evitou-se chamadas web nos testes para prevenir falhas de rede/rate-limit.

---

## 3. Débitos e Riscos Atuais

### Frontend (Risco Alto)
- O arquivo `src/web/public/app.js` extrapolou os limites (3.200+ linhas). Toda a lógica de UI da nova feature Ideas (Discovery panel, Idea cards, modals, renderers de signals) foi jogada dentro dele com `innerHTML` massivo e addEventListeners contextuais. O risco de quebrar outras views (Products, Terminals) alterando o state local é gigante.

### Backend Acoplado (Risco Médio)
- `src/web/server.js` possui ~750 linhas. O endpoint de `/api/ideas/:id/convert` instancia o objeto do produto lá dentro. Essa lógica de negócio deveria estar dentro de um serviço do domínio (ex: `IdeaToProductConverter`).

### Scraping Limitado (Risco Médio)
- As extrações de dores/desejos estão amarradas a RegEx (`/I hate (.{10,80})/i`). O scraping pela SERP do DuckDuckGo para recuperar X e Web é extremamente frágil à estrutura do HTML (`.result__title .result__a`). Rate-limits foram contornados com `setTimeout` (6500ms para o Reddit) paralisando o event-loop para processamento longo.

---

## 4. Melhor Próximo Passo Técnico

**Prioridade Máxima:** Refatoração Estrutural e Modularização do Frontend (`app.js`).

- **Justificativa:** Adicionar mais complexidade ou uma nova grande *feature* no cenário atual do `app.js` gerará regressões massivas. A manipulação de strings DOM está sem fronteiras. A próxima feature vai multiplicar as dificuldades de debug e manutenção.
- **Riscos de não fazer:** Efeito borboleta no DOM. Mudar uma variável global de paginação em "Ideias" pode quebrar a sessão do "Terminal". Vazamento de memória com listeners não descartados.
- O backend (`server.js`) deve ser refatorado logo em seguida, dividindo as rotas `/api/ideas`, `/api/products` e `/api/sessions` em arquivos de "Controllers" ou "Routers" específicos extraídos de `server.js`.

---

## HANDOFF PARA CLAUDE CODE

**Contexto:** Você assumirá o projeto "Vibe Workbook" logo após a entrega da feature de "Ideias" (`feature/ideas-pipeline`). A feature introduziu um pipeline completo de discovery (scraping de Ideias via Reddit, Web, X) até a promoção dessa ideia em um "Product". A base transacional (JSON) e os 27 testes bateram o verde.

**O Problema (Tech Debt Crítico):** O preço dessa entrega foi o inchaço de `src/web/public/app.js` para além de **3.200 linhas**, centralizando API Clients, WebSocket, State Management e Views Render. O `server.js` virou uma "God Class" de roteamento, acumulando até regras de mapeamento Idea -> Product.

**Objetivo Imediato (Primeiro Refactor Obrigatório):**
Sua meta **não é iniciar uma feature nova ainda**, mas sim preparar o terreno (Modularizar).

1. **Modularização do Frontend (`app.js`):**
   - Extraia a classe ou módulo responsável por comunicar com a API e o SSE para algo como `api-client.js` ou `state-manager.js`.
   - Crie componentes visuais separados para a feature recém-adicionada em `ideas-view.js` e isole a view de produtos em `products-view.js`. O `index.html` deve orquestrar esses scripts.
2. **Desacoplamento de Rotas no Backend (`server.js`):**
   - Remova o mapeamento hardcoded da rota `/api/ideas/:id/convert` de dentro do `server.js` e mova a lógica do contrato Idea->Product para dentro da camada `src/core/`.

**Ordem Sugerida de Trabalho e Respeito à Arquitetura Existente:**
1. Inspecione como o `index.html` carrega o `app.js` e garanta que qualquer separação preserve a arquitetura Vanilla (sem NPM packages no frontend, mantendo módulos JS ou scripts tradicionais).
2. Leia o `src/web/public/app.js` (linhas relacionadas a "Ideas" e "RenderView") para delimitar as fronteiras das views.
3. Garanta que o SSE continue triggando corretamente os updates no novo módulo View.
4. Rode os testes locais regularmente via `npm test` se alterar no backend.
5. Inspecione e limpe `server.js` na rota de Conversão.

**Onde você deve começar a inspecionar o repo:**
1. Leia `src/web/public/app.js`.
2. Leia `src/web/server.js` (Rotas de Ideas e Products).
3. Entenda o entrypoint `src/gui.js`.

> **ATENÇÃO | RISCO DE REGRESSÃO:** Preserve o modelo atual de persistência atômica e Event-loop single-thread do Express. O roteamento no frontend é "falso" (baseado em show/hide divs no `index.html` controlados por classes `.hidden`). Se você quebrar essa base ou injetar frameworks de build (Webpack/Vite), estará infringindo a diretriz de preservar a arquitetura atual.
