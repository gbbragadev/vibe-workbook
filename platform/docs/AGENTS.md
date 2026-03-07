# Agents

## Agent Taxonomy

Nesta fase existem dois grupos:

- `runtime agents`: agentes executados pelo app atual
- `delivery agents`: papeis de processo e governanca

## Runtime Agents

| Agent | Papel atual | Entrada principal | Saida principal |
|---|---|---|---|
| `claude` | sessao de coding assistido | workspace legado + prompt | mudancas e contexto operacional |
| `codex` | sessao de coding assistido | workspace legado + prompt | mudancas e contexto operacional |
| `gemini` | sessao de coding assistido | workspace legado + prompt | mudancas e contexto operacional |

Esses agentes continuam sendo operados pelo runtime legado em `src/`.

## Delivery Agents

| Agent | Responsabilidade | Entradas | Saidas |
|---|---|---|---|
| `principal-architect` | definir arquitetura e limites | brief, contexto, restricoes | arquitetura, decisoes, riscos |
| `delivery-planner` | transformar objetivo em plano executavel | arquitetura, objetivo, estado atual | plano, backlog, handoffs |
| `implementation-agent` | executar trabalho tecnico | plano, repo, contexto | codigo, notas, evidencias |
| `review-agent` | revisar regressao e risco | diff, plano, testes | findings, aprovacao, ajustes |

## Handoff Rules

- todo handoff deve citar `product_id`
- todo handoff deve citar objetivo da etapa
- agente sem artefato de saida nao conclui etapa
- output importante deve virar arquivo, nao apenas conversa

## Required Output Artifacts

| Etapa | Artefato minimo |
|---|---|
| arquitetura | `ARCHITECTURE.md` ou ADR |
| planejamento | plano documentado |
| implementacao | diff + observacoes |
| revisao | findings ou aprovacao |

## Current Constraint

O app atual conhece apenas `runtime agents`. Os `delivery agents` existem por contrato operacional e documental nesta fase, nao como modulo automatizado do runtime.
