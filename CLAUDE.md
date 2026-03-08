# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start the app (opens browser automatically)
node src/gui.js

# Start with demo data
node src/gui.js --demo

# Run tests
node --test

# Suppress browser auto-open
VIBE_NO_OPEN=1 node src/gui.js

# Use a custom port (default: 3457)
PORT=3000 node src/gui.js
```

## Architecture Overview

Vibe Workbook is a **local web app** (Express + WebSocket) that serves as a multi-agent workspace manager. It launches AI coding agents (Claude Code, Codex CLI, Gemini CLI, Antigravity) in real PTY terminals accessible via a browser UI.

### Two Parallel Layers

There is an intentional separation between the **runtime** (legacy operational layer) and the **platform** (governance layer). Do not merge them.

**Runtime layer** (`src/`, `state/`):
- All operational state lives in `state/workspaces.json` (JSON, atomic writes, auto-backup)
- `src/state/store.js` — singleton Store (EventEmitter), all CRUD for workspaces and sessions
- `src/web/server.js` — Express server, REST API + SSE events, WebSocket terminal upgrade
- `src/web/pty-manager.js` — singleton PtyManager, one PTY process per session via `node-pty`
- `src/core/agent-adapter.js` — abstract AgentAdapter base class + agent registry
- `src/core/agents/` — concrete adapters: `claude-adapter.js`, `codex-adapter.js`, `gemini-adapter.js`, `antigravity-adapter.js`
- `src/core/cost-tracker.js` — singleton CostTracker, delegates to adapters, 60s cache
- `src/core/product-service.js` — product CRUD, pipeline stages, next actions, handoffs
- `src/core/run-coordinator-service.js` — run lifecycle (create/reuse/complete), output tracking, hydration
- `src/core/knowledge-pack-service.js` — knowledge pack catalog, bindings, stage recommendations

**Platform layer** (`platform/`, `products/`):
- `products/registry/products.json` — product catalog (source of truth for products)
- `platform/catalog/knowledge-packs/` — knowledge pack manifests and index
- `platform/integrations/knowledge-packs/` — product bindings and stage recommendations
- `platform/templates/product-template/` — scaffold template for new products
- `platform/docs/` — architecture docs (`PLATFORM_ARCHITECTURE.md` is essential reading)

### Execution Hierarchy

`Product` → `Run` (per stage) → `Session` (PTY process) → `Handoff` (stage completion marker)

- A **Product** maps to one or more legacy Workspaces
- A **Run** is created/reused when a stage is started via `POST /api/products/:id/stages/:stage/start`
- A **Session** is a store entity + live PTY process; spawned via `ptyManager.spawn(sessionId)`
- A **Handoff** records what was produced at end of a stage, used as context for the next

### Agent Adapter Pattern

Each agent implements `AgentAdapter` from `src/core/agent-adapter.js`:
- `buildCommand(opts)` — constructs the CLI command string
- `getShell()` / `getShellArgs(cmd)` — platform-aware shell invocation (PowerShell on Windows)
- `getEnv()` — env vars to inject
- `getCostData()` — reads cost from agent-specific sources (Claude reads `~/.claude/projects/**/*.jsonl`)
- `detectActivity(output)` / `detectIdle(output)` — parse terminal output for UI status
- `static discoverSessions()` — find existing sessions on disk (only Claude implements this)

Adapters self-register via `registerAgent(type, Class)` at module load. Server imports all four adapters explicitly in `src/web/server.js`.

### Real-time Communication

- Store emits events (`workspace:created`, `session:updated`, etc.) → server broadcasts via SSE (`GET /api/events`)
- Terminal I/O: WebSocket at `ws://localhost:PORT/ws/terminal?sessionId=X&token=Y&cols=120&rows=30`
- Auth: password stored in `state/config.json`, login returns a bearer token

### State Files

| File | Purpose |
|---|---|
| `state/workspaces.json` | All workspaces and sessions (operational state) |
| `state/config.json` | Password, API keys, agent paths |
| `state/product-runs.json` | Run coordinator data |
| `state/product-handoffs.json` | Handoff records |
| `state/backups/` | Timestamped backups (last 10 kept) |
| `products/registry/products.json` | Product catalog |

### Singletons

All core services are singletons accessed via factory functions:
- `getStore()` from `src/state/store.js`
- `getPtyManager()` from `src/web/pty-manager.js`
- `getCostTracker()` from `src/core/cost-tracker.js`
- `getProductService()` from `src/core/product-service.js`
- `getRunCoordinatorService()` from `src/core/run-coordinator-service.js`
- `getKnowledgePackService()` from `src/core/knowledge-pack-service.js`

### Frontend

Single-page app in `src/web/public/` (vanilla JS, no build step): `index.html`, `app.js`, `styles.css`. Communicates with the backend via REST + SSE.
