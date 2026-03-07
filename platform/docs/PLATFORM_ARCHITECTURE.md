# Platform Architecture

## Purpose

`vibe-workbook` passa a ser o `Platform Hub` local para governanca, documentacao, catalogo e operacao assistida por agentes. Nesta etapa, ele ainda contem o runtime legado do app atual, mas o papel oficial do repositorio deixa de ser "casa dos produtos".

## What The Hub Is

- Hub local de governanca de produtos e workspaces.
- Catalogo inicial de produtos, agentes e politicas.
- Fonte de documentacao-base da plataforma.
- Lugar de templates minimos para novos produtos.

## What The Hub Is Not

- Nao e o repositorio principal dos produtos.
- Nao e a fonte de verdade do codigo de cada produto.
- Nao substitui o runtime atual nesta fase.
- Nao faz automacao avancada de entrega nesta fase.

## Current Runtime Boundary

O runtime atual permanece intacto:

- estado operacional legado em `state/workspaces.json`
- config operacional legado em `state/config.json`
- backend em `src/web/`
- store em `src/state/store.js`
- adapters em `src/core/`

Nesta fase, nenhuma rota, import, launcher ou fluxo do app atual muda.

## Governance Boundary

A nova camada paralela de governanca vive em:

- `platform/docs/`
- `platform/catalog/`
- `platform/templates/`
- `products/registry/`
- `archive/`

Essa camada documenta, registra e classifica produtos sem interferir no runtime.

## Source Of Truth Rules

| Entidade | Fonte de verdade nesta fase | Observacao |
|---|---|---|
| Sessao de agente | `state/workspaces.json` | operacional legado |
| Workspace do app atual | `state/workspaces.json` | operacional legado |
| Catalogo de produtos | `products/registry/products.json` | governanca inicial |
| Contrato de produto | `.platform/product.json` em cada produto | quando existir |
| Politicas da plataforma | `platform/catalog/policies/` | governanca |

## Product vs Workspace

- `Product` e a unidade de governanca e entrega.
- `Workspace` e a unidade operacional do app atual.
- Um produto pode mapear para um workspace legado.
- Um produto pode ter mais de um workspace legado associado.
- Nem todo workspace legado esta governado corretamente hoje.

## Execution Hierarchy

A hierarquia conceitual atual do app passa a ser:

- `Product` -> unidade principal da experiencia e do delivery
- `Run Coordinator` -> unidade de execucao coordenada por etapa
- `Session` -> executor operado por um runtime especifico
- `Runtime Workspace` -> contexto operacional legado usado pelas sessoes
- `Handoff` -> continuidade rastreavel entre uma etapa e a seguinte

O runtime legado continua centrado em `workspace + session`, mas a UX do produto agora se organiza por `product + run + handoff`.

## Current Guided Execution Model

O Product Detail atual ja oferece um fluxo operacional minimo:

- pipeline por etapa
- `next actions` executaveis
- `current run` com objetivo, runtime, outputs e knowledge driver
- `handoff history` por produto
- continuidade simples baseada no `handoff mais recente` da etapa de entrada

Regras atuais:

- um `run` pode ser criado ou reutilizado para uma etapa do produto
- uma `session` nasce vinculada a `product_id`, `stage_id`, `run_id` e `role`
- um `handoff` snapshota outputs esperados, outputs produzidos e knowledge driver do run
- a etapa seguinte pode usar esse handoff como contexto do prompt guiado

Isso ainda nao e uma engine formal de workflow. E uma camada operacional leve sobre o runtime legado.

## Knowledge In Execution

`Knowledge Packs` continuam em modo `reference-first`, mas ja influenciam a execucao guiada:

- `pm-skills` e o primeiro pack operacional oficial
- presets recomendados por stage entram em `next actions`
- o preset selecionado fica registrado no `run`
- o prompt guiado recebe o contexto do preset

O pack nao e instalado automaticamente, nao faz sync profundo e nao executa workflows externos de forma automatica nesta fase.

## Current Consolidated Catalog

| Product ID | Category | Stage | Repo local consolidado | Observacao de workspace legado |
|---|---|---|---|---|
| `zapcam` | `product` | `build` | `C:\Users\guibr\ZapCam` | workspace principal aponta para o repo do Myrlin Workbook |
| `rondax` | `product` | `build` | `C:\Users\guibr\Documents\_Organizados\Projetos\ronda-x-veiculos` | workspace principal aponta para path inexistente |
| `lsp-agent-v3` | `internal-tool` | `build` | `C:\Users\guibr\Documents\_Organizados\Projetos\Guilherme_Projetos\lsp-agent-v3\lsp-agent` | workspace principal aponta para path inexistente |

## Phase 0 And Phase 1 Principle

- criar camada paralela
- nao quebrar funcionamento atual
- nao mover runtime
- nao alterar schema interno do app
- marcar inconsistencias em vez de mascarar

## Known Governance Gaps At Start

- `Projeto ZapCam` aponta para `C:\Users\guibr\myrlin-workbook`, path agora classificado como `mismatched`.
- `CamZap` foi consolidado como duplicidade operacional de `zapcam`.
- `state/config.json` contem senha fraca em texto puro.
- `state/config.json` aponta `claudeProjects` para path Unix em ambiente Windows.
- `README.md` e `PROJECT-SUMMARY.md` divergem do runtime em alguns pontos de nomenclatura e maturidade.
