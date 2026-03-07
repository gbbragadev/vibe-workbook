# Vibe Workbook

Platform Hub local para governanca de produtos assistidos por IA, documentacao-base, catalogo de produtos e operacao do runtime legado.

O repositorio passa a assumir oficialmente dois papeis separados:

- `runtime legado`: o app atual em `src/` e `state/`
- `camada de governanca`: `platform/`, `products/` e `archive/`

## Current Scope

- gerenciamento local de sessoes multi-agente
- governanca inicial de produtos e workspaces
- templates minimos de produto
- registry manual de produtos conhecidos
- product cockpit com pipeline, next actions, current run e handoffs
- knowledge packs curados com `pm-skills` como primeiro pack operacional
- onboarding nativo de produto pela UI com cadastro no registry, runtime workspace opcional e scaffold minimo opcional
- temas visuais com persistencia simples (`Midnight Indigo`, `Teal Signal`, `Ember Ops`)

## Runtime Features

- **Multi-Agent Support** - Claude Code, Codex CLI, Gemini CLI and Antigravity stub
- **Terminal Grid** - Up to 4 terminal panes side by side
- **Project Organization** - Group sessions into workspaces with color coding
- **Cost Tracking** - Per-session and per-project cost breakdown across agents
- **Session Discovery** - Auto-discovers Claude Code sessions from `~/.claude/projects/`
- **Session History** - Search and filter all sessions by agent, project, or keyword
- **Real-time Updates** - SSE for state changes, WebSocket for terminal I/O
- **Local-first** - Everything runs on your machine, no cloud, no telemetry

## Product Flow Features

- **Products Overview** - lista produtos, stage, knowledge packs, current run e next action
- **Product Detail** - mostra pipeline, current run, handoff history, knowledge e sessoes relacionadas
- **Run Coordinator** - cada execucao guiada cria ou reutiliza um run ligado a produto, etapa, agente e sessoes
- **Executable Next Actions** - acoes sugeridas podem iniciar uma execucao real com runtime recomendado
- **Manual Assisted Handoff** - handoffs podem registrar summary, outputs, artifacts e continuidade entre etapas
- **Knowledge-driven Execution** - presets do `pm-skills` entram no prompt guiado e no rastreamento do run
- **Native Product Onboarding** - `New Product` cria o produto no hub, opcionalmente prepara o diretório/runtime workspace e leva direto ao `Product Detail`

## Governance Layer

- Platform architecture docs in `platform/docs/`
- Product registry in `products/registry/products.json`
- Governance policies in `platform/catalog/policies/`
- Minimum product template in `platform/templates/product-template/`
- Legacy mapping notes in `archive/legacy-project-maps/`

## Current Consolidated Catalog

- `zapcam` -> `product` -> repo consolidado em `C:\Users\guibr\ZapCam`
- `rondax` -> `product` -> repo consolidado em `C:\Users\guibr\Documents\_Organizados\Projetos\ronda-x-veiculos`
- `lsp-agent-v3` -> `internal-tool` -> repo consolidado em `C:\Users\guibr\Documents\_Organizados\Projetos\Guilherme_Projetos\lsp-agent-v3\lsp-agent`

## Quick Start

```bash
cd vibe-workbook
npm install
npm run gui
```

No Windows, voce tambem pode usar:

- `Iniciar-Vibe-Workbook.bat`
- `Iniciar-Vibe-Workbook-Sem-Browser.bat`
- `Vibe Workbook.bat`

## Runtime Requirements

- Node.js 18+
- `claude` in PATH for Claude sessions
- `codex` or `npx @openai/codex` for Codex sessions
- `gemini` for Gemini sessions when used

## Runtime Architecture

```text
Express.js (port 3457) <- REST API + SSE events
     ^
node-pty <- WebSocket <- xterm.js (browser)
     ^
Agent Adapters (Claude / Codex / Gemini / Antigravity)
     ^
JSON State (./state/workspaces.json)
```

## Product Execution Model

```text
Product
  -> Pipeline Stage
  -> Run Coordinator
       -> linked Sessions
       -> produced / expected outputs
       -> handoffs
       -> knowledge driver
  -> Runtime Workspace (operational context)
```

`Product` e a unidade principal da experiencia.
`Runtime Workspace` e o contexto operacional legado.
`Session` e o executor.
`Run Coordinator` e a unidade de orquestracao da execucao guiada.

## Governance Structure

```text
platform/docs/                  -> contracts and base documentation
platform/catalog/policies/      -> governance rules
platform/templates/             -> minimum product template
products/registry/products.json -> manual product catalog
archive/                        -> preserved legacy context
```

## Current Phase Constraints

- do not move runtime code
- do not change endpoints
- do not change launchers
- do not alter `state/workspaces.json`
- keep governance manual and parallel in this stage

## Key References

- `platform/docs/PLATFORM_ARCHITECTURE.md`
- `platform/docs/WORKSPACE_STRUCTURE.md`
- `platform/docs/AGENTS.md`
- `platform/docs/PRODUCT_TEMPLATE.md`
- `products/registry/products.json`

## License

MIT
