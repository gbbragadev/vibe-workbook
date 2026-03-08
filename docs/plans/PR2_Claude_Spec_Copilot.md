# PR2 — Project Copilot como GPS Operacional

> Date: 2026-03-08
> Status: Approved
> Author: guibr + Claude (brainstorming session)
> Source: PR2_Gemini_Analise_Copilot.md (análise do Gemini)

---

## Resumo da Análise Herdada (Gemini)

A análise do Gemini (`PR2_Gemini_Analise_Copilot.md`) identificou que o Copilot é um **auditor passivo competente** (detecta artefatos, calcula readiness) mas **falha como guia proativo**:

- **Posição**: está na posição 8 de 12 painéis, enterrado na UI
- **Concorrência**: Executive Summary, Next Actions e Blockers repetem informação do Copilot
- **Linguagem**: técnica e robótica ("semantic evidence", "confidence: 0.6")
- **CTAs**: fracos, descritivos demais, sem convite à ação imediata
- **Stage-awareness**: genérico nos estágios iniciais (Idea/Briefing), melhor nos finais (Test/Release)

**Recomendações-chave do Gemini adotadas nesta spec:**
1. Promover Copilot a título/herói da interface (Gemini §Melhorias #1)
2. Modo "Uma Ação por Vez" com CTA único (Gemini §Melhorias #2)
3. Humanização semântica — ocultar PIDs, hints, scores (Gemini §Melhorias #3)
4. Botões para resolver bloqueios (Gemini §Melhorias #4)
5. Copywriting humanizado por situação (Gemini §Exemplos de Mensagens)

---

## Visão do PR2

Transformar o Copilot de painel enterrado em **bloco hero do cockpit**, respondendo 8 perguntas operacionais:

1. **Onde estou** — estágio atual + progresso
2. **O que já foi feito** — assets criados
3. **O que falta** — gaps de evidência
4. **O que bloqueia** — blockers acionáveis
5. **Qual a próxima ação** — CTA único primário
6. **Por que essa ação importa** — reason humanizado
7. **Qual evidência é esperada** — formato/caminho do artefato
8. **Qual o risco atual** — tradução de confidence → risco

---

## Escopo

### In Scope

1. Promover Copilot panel para posição #1 no cockpit (acima de tudo)
2. Fundir/ocultar Executive Summary e Next Actions (informação já existe no Copilot)
3. Aplicar copywriting humanizado nas mensagens do Copilot
4. Single CTA primário (botão verde/amarelo/vermelho único)
5. Blockers como itens acionáveis (não apenas chips estáticos)
6. Stage-aware messaging (texto muda conforme estágio)
7. Traduzir confidence → nível de risco legível
8. Ocultar hints técnicos (plan-mode, PIDs, scores) do painel principal

### Fora de Escopo

- Novas APIs ou endpoints backend
- Refatoração do `buildSnapshot()` ou lógica de readiness
- Modularização do app.js (plano separado existe)
- Features novas (chat, auto-selection de agente)
- Mudanças no dashboard/cards (escopo do PR1)
- Sidebar ou pipeline visual (escopo do PR1)
- Mudanças de persistência ou banco de dados

---

## Comportamento Esperado do Copilot

### Formato Visual da Resposta

```
┌─ Project Copilot ──────────────────────────────────────────┐
│ 📍 Estágio: Specification  •  🔴 Não Pronto               │
│                                                            │
│ "A especificação está em andamento, mas falta o            │
│  documento de arquitetura para avançar com segurança."      │
│                                                            │
│ ⚠ Risco: Avançar sem arquitetura causa retrabalho          │
│                                                            │
│ Evidência esperada: docs/architecture.md                    │
│                                                            │
│         [ ▸ Continuar Specification (Claude) ]              │
│                                                            │
│ Pendências:                                                │
│  ✗ architecture.md — Criar documento  [Iniciar]            │
│  ⏳ spec.md — Em revisão              [Revisar]            │
│  ✓ brief.md — Aceito                                       │
└────────────────────────────────────────────────────────────┘
```

### Estrutura do Painel

1. **Header**: Estágio atual + badge de readiness (semáforo)
2. **Summary**: 1-2 frases humanizadas sobre o estado
3. **Risco**: Tradução de confidence em linguagem de risco
4. **Evidência**: Caminho do artefato que o Copilot espera ver
5. **CTA Primário**: Botão único com cor de semáforo e agente sugerido
6. **Pendências**: Lista de artefatos com status (✓/✗/⏳) e ação rápida

---

## Regras Stage-Aware por Estágio

| Estágio | Agente Sugerido | Tom da Mensagem | Exemplo de Copy |
|---------|-----------------|-----------------|-----------------|
| **Idea/Briefing** | Gemini | Exploratório | "O projeto está em branco. Defina a visão do produto iniciando o Briefing com o Gemini." |
| **Specification** | Claude | Estruturante | "A especificação precisa cobrir escopo e requisitos. Continue com o Claude." |
| **Architecture** | Claude | Técnico | "Defina a estrutura técnica antes de implementar. Use o Claude para gerar o ADR." |
| **Implementation** | Codex | Executivo | "O terreno está limpo. Inicie a implementação com o Codex." |
| **Test** | Claude/Codex | Verificação | "Gere a estratégia de testes antes de executar. Falta test-strategy.md." |
| **Release** | Claude | Preparação | "Prepare o runbook e release-plan para validar a entrega." |
| **Done** | — | Celebração | "Produto entregue. Todos os artefatos foram validados." |

### Tabela de Copywriting (derivada do Gemini §Exemplos)

| Situação | Texto Atual (Robótico) | Texto Humanizado |
|----------|------------------------|------------------|
| Início sem evidência | "The platform lacks enough semantic evidence to move confidently." | "O projeto está em branco. Vamos definir a visão do produto? Inicie o Briefing usando o Gemini." |
| Avanço de estágio | "The next governed action is ready to execute." | "A Especificação foi aprovada. O terreno está limpo para iniciarmos a Implementação (Codex)." |
| Revisão de artefato | "There are plausible artifact candidates outside the canonical path." | "A IA gerou novos documentos. Valide se o conteúdo está correto antes de avançar." |
| Bloqueio | "Core product documentation is still too thin for reliable testing." | "Não podemos gerar os testes ainda. Falta o guia de Arquitetura (architecture.md)." |
| Motivo de parada | "Resolve open project decisions before pushing the workflow forward." | "Você precisa decidir como lidar com [decisão aberta]. Registre a resposta para liberar a Implementação." |
| Risco | (confidence: low) | "Risco Elevado: Avançar sem Spec consolidado resultará em muito retrabalho." |

### Tradução de Confidence → Risco

| Confidence | Nível de Risco | Label | Cor |
|------------|---------------|-------|-----|
| ≥ 0.8 | Baixo | "Caminho seguro" | Verde |
| 0.6 – 0.79 | Médio | "Atenção recomendada" | Amarelo |
| < 0.6 | Alto | "Risco elevado de retrabalho" | Vermelho |

---

## Blockers e Lacunas que o Copilot Deve Identificar

O Copilot já detecta blockers via `_buildCurrentState()`. O PR2 deve:

1. **Renderizar cada blocker como item acionável** (não apenas chip estático)
2. **Mapear tipo de blocker → ação:**
   - Artefato faltante → botão "Criar" (abre terminal com agente sugerido)
   - Candidato pendente → botão "Revisar" (abre diálogo de accept/reject)
   - Decisão aberta → botão "Resolver" (abre formulário de decisão)
   - Stage incompleto → botão "Continuar" (abre sessão ativa)

---

## Critérios de Aceite

### AC1: Copilot é herói do cockpit
- [ ] Copilot panel renderiza na posição #1 (acima de todos os outros painéis)
- [ ] Executive Summary panel oculto ou fundido no Copilot
- [ ] Next Actions panel oculto ou fundido no Copilot

### AC2: Mensagens humanizadas
- [ ] Summary usa linguagem direta sem jargão técnico
- [ ] Confidence score não aparece como número — traduzido para "Risco Alto/Médio/Baixo"
- [ ] Hints técnicos (plan-mode, PIDs, skills) ocultos do painel principal

### AC3: CTA único primário
- [ ] 1 botão primário com cor de semáforo (verde/amarelo/vermelho)
- [ ] Botão mostra ação + agente sugerido (ex: "Continuar Specification (Claude)")
- [ ] Cor derivada do estado de readiness

### AC4: Blockers acionáveis
- [ ] Cada blocker tem botão de resolução (Criar/Revisar/Resolver/Continuar)
- [ ] Blocker mostra caminho do artefato esperado quando aplicável
- [ ] Lista de pendências com status visual (✓/✗/⏳)

### AC5: Stage-awareness
- [ ] Mensagem do Copilot muda conforme estágio atual
- [ ] Agente sugerido reflete o estágio (Gemini → Claude → Codex)
- [ ] Evidência esperada específica por estágio

### AC6: Risco traduzido
- [ ] Confidence ≥ 0.8 → "Caminho seguro" (verde)
- [ ] Confidence 0.6-0.79 → "Atenção recomendada" (amarelo)
- [ ] Confidence < 0.6 → "Risco elevado de retrabalho" (vermelho)

---

## Backlog Priorizado para Implementação

### P0 — Estrutural (faça primeiro)

1. **Mover Copilot panel para posição #1** no cockpit (reordenar em `app.js` na renderização do product detail)
2. **Ocultar/colapsar Executive Summary e Next Actions panels** (remover da renderização principal ou mover para seção colapsável)
3. **Redesenhar layout do Copilot** com novo formato visual (header com stage + readiness, corpo com mensagem + CTA + pendências)

### P1 — Conteúdo e Interação (faça segundo)

4. **Implementar copywriting humanizado** (criar mapa de situação → mensagem, usar tabela de copy acima)
5. **Implementar CTA único primário com cor de semáforo** (verde/amarelo/vermelho baseado em readiness)
6. **Transformar blockers em itens acionáveis** com botão de resolução por tipo
7. **Traduzir confidence → risco legível** ("Risco Alto/Médio/Baixo" com cor)

### P2 — Contexto (faça por último)

8. **Mostrar evidência esperada** (caminho do artefato faltante no corpo do Copilot)
9. **Mostrar agente sugerido por estágio** no texto do CTA
10. **Ocultar hints técnicos** (plan-mode, PIDs, skills hint) do painel principal

---

## Riscos e Observações

| # | Risco | Mitigação |
|---|-------|-----------|
| R1 | app.js tem ~3000 linhas, mudança no ordering dos painéis pode quebrar estado | Mudança cirúrgica na ordem de renderização, testar com dados reais |
| R2 | Fundir Executive Summary pode esconder info útil | Manter como seção colapsável "Detalhes técnicos" no rodapé do Copilot |
| R3 | Copywriting hardcoded pode não cobrir todos os edge cases | Fallback para mensagem genérica humanizada se nenhuma regra casar |
| R4 | Blocker "acionável" precisa saber qual ação abrir | Mapear tipo de blocker → ação (abrir terminal, criar arquivo, navegar) |
| R5 | Mudanças apenas no frontend — backend continua com textos em inglês | Tradução acontece na camada de renderização, não no serviço |

### Observações de Implementação

- **Não criar novos arquivos JS** — todas as mudanças são em `app.js` e `styles.css`
- **Não alterar backend** — toda humanização e reorganização é frontend-only
- **Dados já existem** — `buildSnapshot()` retorna tudo que o PR2 precisa, apenas a apresentação muda
- **Manter backwards-compatible** — painéis ocultos podem ser restaurados via toggle se necessário

---

## Arquivos que Devem Mudar

| Arquivo | Mudanças |
|---------|----------|
| `src/web/public/app.js` | Reordenar painéis (Copilot → #1), novo layout do Copilot, ocultar Executive Summary e Next Actions, copywriting humanizado, CTA com semáforo, blockers acionáveis, tradução de confidence |
| `src/web/public/styles.css` | Estilos do novo layout do Copilot (header, CTA primário, lista de pendências, cores de semáforo, badge de risco) |

---

## Próximo prompt deve referenciar estes arquivos

O próximo passo (Codex) deve usar os arquivos `PR2_Gemini_Analise_Copilot.md` e `PR2_Claude_Spec_Copilot.md` como fontes principais desta implementação.

- **Análise do Gemini:** `C:\Users\guibr\.gemini\antigravity\brain\82ddd996-1ace-4667-9cd1-b9635b420479\PR2_Gemini_Analise_Copilot.md.resolved`
- **Spec do Claude:** `C:\Users\guibr\vibe-workbook\docs\plans\PR2_Claude_Spec_Copilot.md`
