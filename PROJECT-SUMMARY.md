# Vibe Workbook - Project Summary

> Status on 2026-03-07: this document describes primarily the current runtime application. The official governance layer created in Phase 0/1 now lives in `platform/`, `products/` and `archive/`.

## What It Is

Vibe Workbook is a local web application for managing multiple AI coding agent sessions side by side. It currently serves as the runtime layer of the repository while the broader platform governance layer is documented separately.

Runtime URL: `http://localhost:3457`

## Governance Note

At this stage:

- `src/` and `state/` remain the runtime boundary
- `products/registry/products.json` is the initial product governance catalog
- `platform/docs/` contains the current architecture and workspace contracts
- this file is historical runtime context, not the sole future architecture contract

## Runtime Technical Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express.js |
| Terminals | node-pty + xterm.js |
| Real-time | WebSocket + SSE |
| Persistence | JSON on disk in `state/` |
| Frontend | Vanilla JS SPA |
| Auth | Password + Bearer token |

## Runtime Features Implemented

### Workspaces / Projects

- CRUD for workspaces with name, color and description
- Working directory per workspace
- Directory browser from the UI
- Multiple agents per workspace

### Sessions

- Session creation with agent and model selection
- Sessions listed under each workspace
- Start and stop directly from the sidebar
- Claude resume support via `claude --resume <id>`
- Working directory fallback: session -> workspace -> HOME

### Supported Runtime Agents

| Agent | Command | Discovery |
|---|---|---|
| Claude Code | `claude --resume <id>` | automatic via `~/.claude/projects/` |
| OpenAI Codex CLI | `codex` or `npx @openai/codex` | manual |
| Google Gemini CLI | `gemini` | manual |
| Antigravity | stub | not active |

### Terminal UI

- Grid layouts up to 4 panes
- Agent badge, session name and status per pane
- ANSI color, scroll and resize support

### Cost Tracking

- Claude JSONL parsing from `~/.claude/projects/`
- Model price table
- Session cache
- Aggregated dashboard
- Manual estimate fallback for Codex and Gemini

## Runtime File Structure

```text
vibe-workbook/
├── src/
│   ├── core/
│   │   ├── agent-adapter.js
│   │   ├── cost-tracker.js
│   │   └── agents/
│   ├── state/
│   │   └── store.js
│   └── web/
│       ├── server.js
│       ├── pty-manager.js
│       └── public/
├── state/
│   ├── workspaces.json
│   └── config.json
├── platform/
├── products/
├── archive/
├── package.json
└── Vibe Workbook.bat
```

## Current Known Governance Gaps

- `Projeto ZapCam` points to `C:\Users\guibr\myrlin-workbook`, now classified as a `mismatched` workspace path
- `CamZap` was consolidated as an operational duplicate of `zapcam`
- `state/config.json` stores a password in plain text
- `state/config.json` contains a Unix-style `claudeProjects` path on a Windows environment
- legacy workspace paths are not yet aligned with the target platform taxonomy

## How To Run

```bash
npm install
npm run gui
```

Or use `Vibe Workbook.bat` on Windows.

## Related Governance Files

- `platform/docs/PLATFORM_ARCHITECTURE.md`
- `platform/docs/WORKSPACE_STRUCTURE.md`
- `platform/docs/AGENTS.md`
- `platform/docs/PRODUCT_TEMPLATE.md`
- `products/registry/products.json`
- `archive/legacy-project-maps/current-workspace-inventory.md`
