# Gemini Audit — Milestone 2I (Evidence-Driven Readiness + Output Strengthening)

Pronto para colar no Gemini. Nenhum campo precisa ser preenchido.

---

## Contexto do projeto

Vibe Workbook é uma aplicação web local (Express + WebSocket, Node.js, vanilla JS no frontend) que funciona como workspace manager para agentes de IA (Claude Code, Codex CLI, Gemini CLI). Ela possui duas camadas separadas intencionalmente:

- Runtime (legado): gerencia workspaces, sessões PTY, cost tracking.
- Platform (governança): produtos, pipeline de estágios, runs, handoffs, readiness, release packet, operate lite.

Stack: Node.js, sem framework de build no frontend, estado em JSON com escrita atômica, testes com `node --test` nativo.

---

## Objetivo da plataforma

Ajudar equipes a gerenciar o ciclo de vida de produtos de software — da ideação ao operate — com rastreabilidade de evidências por estágio, readiness baseado em sinais concretos, e contexto carregado entre etapas via handoffs.

---

## Milestone 2I — Evidence-Driven Readiness + Output Strengthening

### Diagnóstico (problemas pré-milestone)

1. Sinais de readiness binários e frágeis: `implementation-done` era `true` se pipeline dizia `done`, sem verificar handoff com outputs reais.
2. Sem gradação de força: stage "done" com 3 outputs tratado igual a "done" com zero outputs.
3. `latest_completion` errado: `deriveReleasePacket()` filtrava `handoffs` por `from_stage === 'test' || 'release'`, deveria pegar o mais recente por timestamp.
4. `last_readiness_check` retornava string `'on-demand'`; deveria ser `null`.
5. `produced_outputs` no run misturava sessões, actions, handoffs, artifacts e knowledge-drivers sem categorização.
6. `pickCarryForwardOutputs()` filtrava por exclusão sem categorizar o que sobrava.
7. Operate Lite era placeholder (`operational_notes: ''`, `next_post_release_action` genérico).

### Escopo obrigatório

| Item | Prioridade |
|---|---|
| Categorização de outputs (`evidence` / `context` / `metadata`) | Obrigatório |
| Signal strength no readiness (`strong` / `sufficient` / `weak` / `none`) | Obrigatório |
| Readiness usa `evidence_output_count` dos handoffs para graduar força | Obrigatório |
| Cap readiness em `needs-evidence` quando sinais core são `weak` | Obrigatório |
| Fix `latest_completion` — handoff mais recente por timestamp | Obrigatório |
| Fix `last_readiness_check` — `null` | Obrigatório |
| `evidence_output_count` salvo no handoff | Obrigatório |
| Frontend: strength badges nos sinais | Obrigatório |
| Frontend: outputs categorizados no Current Run | Obrigatório |
| Frontend: warning de low-evidence no Complete Stage | Obrigatório |
| Operate Lite: evidence summary ao invés de placeholder | Opcional |
| Gap-driven next actions: usar strength para priorizar | Opcional |

### Modelo de categorização de outputs

```
artifact     → 'evidence'
handoff      → 'evidence'
session      → 'context'
knowledge-driver → 'metadata'
action       → 'metadata'
```

Não muda o schema de `produced_outputs`. Categoria derivada on-the-fly na hydration.

### Regras de signal strength

- Stage tem handoff com `evidence_output_count >= 2` → `strong`
- Stage tem handoff com `evidence_output_count >= 1` → `sufficient`
- Stage tem pipeline status `done` mas sem handoff com evidence → `weak`
- Stage não tem status done → `none`
- Status final é capped em `needs-evidence` se qualquer sinal required tem `strength === 'weak'`
- Handoffs sem `evidence_output_count` → fallback para 0

### Contratos esperados

**Handoff record:**
```js
{ ...existing, evidence_output_count: number }
```

**Readiness signal shape:**
```js
{ id: string, label: string, strength: 'strong'|'sufficient'|'weak'|'none', met: boolean }
```

**Operate Lite shape:**
```js
{ ...existing, last_readiness_check: null, evidence_summary: { total_handoffs, total_evidence_outputs } }
```

**Hydrated produced_output:**
```js
{ ...existing, category: 'evidence'|'context'|'metadata' }
```

### Arquivos a modificar

| Arquivo | Mudanças |
|---|---|
| `src/core/run-coordinator-service.js` | `classifyOutputCategory()` nova, enrich `hydrateRun()` |
| `src/core/product-service.js` | Rewrite `deriveReadiness()`, fix `deriveReleasePacket()`, fix `deriveOperateLite()`, enrich `createHandoff()`, update `deriveNextActions()` |
| `src/web/public/app.js` | Strength badges, categorized outputs, low-evidence warning, evidence summary |
| `src/web/public/styles.css` | Strength badge styles, output category groups, warning callout |
| `tests/product-service.test.js` | 12+ novos testes |

### Critério de pronto

1. Readiness explicável: painel mostra quais sinais são fortes, fracos ou ausentes
2. Evidência visível: Current Run agrupa outputs por categoria
3. Carry-forward intencional: Complete Stage avisa quando não há evidência
4. Sem falsos positivos: pipeline "done" sem handoff evidence não atinge `ready-for-release-candidate`
5. Backward compatible: handoffs antigos, runs sem category — tudo funciona sem erros
6. 32+ testes passando (32 existentes + 12+ novos)

---

## Resumo da implementação entregue

### Arquivos modificados

**`src/core/run-coordinator-service.js`**
- Adicionada função pura `classifyOutputCategory(type)`: artifact/handoff→evidence, session→context, knowledge-driver/action→metadata, outros→context
- `hydrateRun()`: loop enriquece cada `produced_output` com campo `category` derivado via `classifyOutputCategory()`
- `classifyOutputCategory` exportada em `module.exports`

**`src/core/product-service.js`**
- Import de `classifyOutputCategory` de run-coordinator-service
- `createHandoff()`: computa `evidenceOutputCount` contando produced_outputs do run com category `evidence`, salva como `evidence_output_count` no registro de handoff
- `deriveReadiness()`: completamente reescrita com helper `stageSignalStrength()`. Cada signal retorna `{ id, label, strength, met }` onde `met = strength !== 'none'`. Status capped em `needs-evidence` se qualquer required signal tem `strength === 'weak'`
- `deriveReleasePacket()`: `latest_completion` agora é `handoffs.sort((a,b) => b.created_at - a.created_at)[0]` sem filtro de `from_stage`
- `deriveOperateLite()`: recebe `handoffs` como 4o parâmetro, `last_readiness_check: null`, adiciona `evidence_summary: { total_handoffs, total_evidence_outputs }`
- `deriveNextActions()`: helper `signalMap/gapPriority()` usa strength para priorizar gap actions (weak signal → higher priority)

**`src/web/public/app.js`**
- `buildReadinessPanel()`: strength badges com dots (●●●/●●/●) por signal, com tooltip explicativo
- `buildCurrentRunPanel()`: chama `buildCategorizedOutputList()` para produced outputs
- `buildCategorizedOutputList()`: nova função que agrupa outputs por evidence/context/metadata com headers visuais
- `registerHandoff()`: computa evidence count, injeta `lowEvidenceHtml` warning no dialog quando count = 0
- `pickCarryForwardOutputs()`: ordena evidence primeiro
- `buildOperateLitePanel()`: exibe `evidence_summary` stats, remove texto 'on-demand' fake

**`src/web/public/styles.css`**
- `.signal-strength` com variantes `.strong` (3 dots, verde), `.sufficient` (2 dots, azul), `.weak` (1 dot, amarelo), `.none`
- `.output-category-group` e `.output-category-group-title` para agrupamento de outputs
- `.low-evidence-warning` para callout no Complete Stage dialog
- `.evidence-summary` e `.evidence-summary-stat` para Operate Lite

### Testes

- 12 novos testes adicionados em `tests/product-service.test.js`
- 2 testes Phase 2H adaptados para novo shape de strength
- Resultado: **45/45 testes passando** (`node --test`)

### Novos testes (Milestone 2I)

| Teste | Validação |
|---|---|
| `classifyOutputCategory returns correct categories` | Mapa type→category para todos os tipos |
| `createHandoff computes evidence_output_count` | Conta artifact + handoff types como evidence (2 de 4 outputs) |
| `createHandoff with zero evidence outputs` | evidence_output_count = 0 quando só há session/action |
| `deriveReadiness returns not-ready with none strength` | Produto sem nada: todos signals com strength 'none' |
| `deriveReadiness returns weak when impl done but no handoff evidence` | Pipeline done sem handoff → strength 'weak', met true |
| `deriveReadiness returns strong when impl done with evidence >= 2` | evidence_output_count = 3 → strength 'strong' |
| `deriveReadiness caps at needs-evidence when all 5 met but one weak` | test-stage-done weak → status capped em needs-evidence |
| `deriveReadiness returns ready-for-release-candidate when all strong/sufficient` | 5/5 met com evidence → ready-for-release-candidate |
| `deriveReadiness 3/5 met with mix of strengths` | needs-evidence |
| `deriveReleasePacket latest_completion is most recent by timestamp` | Sem handoffs → null |
| `deriveOperateLite has null last_readiness_check and evidence_summary` | last_readiness_check === null, evidence_summary com campos numéricos |
| `handoffs without evidence_output_count treated as 0` | Fallback gracioso → weak (não quebra) |
| `readiness signals include strength field in output` | Todos os signals têm strength válido |

### Regressões verificadas

- 32 testes existentes continuam passando
- Produtos sem handoffs: sem erro
- Handoffs sem `evidence_output_count`: fallback para 0 confirmado
- Frontend renderiza com dados antigos sem erros (não testado em UI, apenas por leitura do código)

### Commit e PR

- Commit: `16d155e feat: evidence-driven readiness + output strengthening (Milestone 2I)`
- PR: https://github.com/gbbragadev/vibe-workbook/pull/5
- Branch: `codex/phase-2h-release-readiness`

### O que NÃO foi verificado na entrega

- Validação visual nos 3 temas (Midnight Indigo, Teal Signal, Ember Ops) não foi feita manualmente
- Testes de UI (strength badges, output groups, evidence warning no dialog) não foram validados com Playwright
- `deriveNextActions()` com signal strength: implementado mas sem teste unitário dedicado

---

## Sua tarefa

Revise criticamente a implementação acima em relação ao plano da milestone. Não implemente nada. Apenas analise e responda nas seções abaixo.

Responda exatamente nessas seções, nessa ordem, em português:

### 1. Conformidade com o plano
Liste o que foi pedido e marque cada item: [entregue] / [parcial] / [ausente] / [desviou]. Para parciais e desvios, explique o que está diferente.

### 2. Qualidade da implementação
A lógica está correta? Há casos de borda não tratados? A abordagem é a mais simples possível? Aponte problemas concretos.

### 3. Valor real entregue
O que mudou de fato para o usuário final? A milestone resolve o problema do diagnóstico? Sim, parcialmente ou não — e por quê.

### 4. Riscos e fragilidades
O que pode quebrar? Regressões? Backward compatibility? Ordene por severidade (alta/média/baixa).

### 5. O que corrigir agora
Apenas itens bloqueantes. Para cada: problema → impacto → correção mínima sugerida.

### 6. Veredito final
Uma linha: [aprovado] / [aprovado com ressalvas] / [reprovado] + motivo principal.

Regras: linguagem objetiva, sem elogios. Se algo está correto, não mencione. Não sugira refatorações fora do escopo. Máximo 800 tokens.
