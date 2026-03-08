# Gemini Audit Prompt — Vibe Workbook Milestone Review

Use este prompt para pedir ao Gemini uma revisão crítica de qualquer milestone implementada no projeto.
Substitua os campos entre colchetes antes de colar.

---

## PROMPT PRONTO PARA COLAR

```
## Contexto do projeto

Vibe Workbook é uma aplicação web local (Express + WebSocket, Node.js, vanilla JS no frontend) que funciona como workspace manager para agentes de IA (Claude Code, Codex CLI, Gemini CLI). Ela possui duas camadas separadas intencionalmente:

- Runtime (legado): gerencia workspaces, sessões PTY, cost tracking.
- Platform (governança): produtos, pipeline de estágios, runs, handoffs, readiness, release packet, operate lite.

Stack: Node.js, sem framework de build no frontend, estado em JSON com escrita atômica, testes com node --test nativo.

Repositório: github.com/gbbragadev/vibe-workbook
Branch de trabalho: codex/phase-2h-release-readiness

---

## Objetivo da plataforma

Ajudar equipes a gerenciar o ciclo de vida de produtos de software — da ideação ao operate — com rastreabilidade de evidências por estágio, readiness baseado em sinais concretos, e contexto carregado entre etapas via handoffs.

---

## Milestone revisada

[COLE AQUI O SPEC COMPLETO DA MILESTONE — seções A até I do plano, incluindo escopo, mudanças de backend, frontend, testes e critério de pronto]

---

## Resumo da implementação entregue

[COLE AQUI O RESUMO DO QUE FOI IMPLEMENTADO — arquivos modificados, funções alteradas, testes adicionados, resultados de node --test, observações de comportamento]

---

## Sua tarefa

Revise criticamente a implementação acima em relação ao plano da milestone. Não implemente nada. Apenas analise e responda nas seções abaixo.

**Responda exatamente nessas seções, nessa ordem, em português:**

### 1. Conformidade com o plano
Liste o que foi pedido no spec e marque cada item como: [entregue] / [parcial] / [ausente] / [desviou]. Para os parciais e desvios, explique brevemente o que está diferente.

### 2. Qualidade da implementação
Avalie objetivamente: a lógica está correta? Há casos de borda não tratados? A abordagem escolhida é a mais simples possível para o problema? Aponte problemas concretos, não sugestões de melhoria genéricas.

### 3. Valor real entregue
O que mudou de fato para o usuário final? A milestone resolve o problema descrito no diagnóstico? Seja direto: sim, parcialmente ou não — e por quê.

### 4. Riscos e fragilidades
O que pode quebrar? Há regressões introduzidas? A backward compatibility foi mantida? Liste riscos concretos, ordenados por severidade (alta/média/baixa).

### 5. O que corrigir agora
Liste apenas os itens que precisam ser corrigidos antes de considerar a milestone pronta. Ignore melhorias que não sejam bloqueantes. Para cada item: problema → impacto → correção mínima sugerida.

### 6. Veredito final
Uma linha: [aprovado] / [aprovado com ressalvas] / [reprovado] + motivo principal.

---

**Regras para sua resposta:**
- Linguagem objetiva, sem elogios, sem fluff.
- Se algo está correto, não mencione. Foque no que está errado ou ausente.
- Não sugira refatorações fora do escopo da milestone.
- Máximo de 800 tokens na resposta total.
```
