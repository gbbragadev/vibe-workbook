# Vibe Workbook v1 — Launch Checkpoint

Practical guide for running, using, and understanding the v1 state of Vibe Workbook.

---

## 1. What is Vibe Workbook (v1)

Vibe Workbook is a local web app (Express + WebSocket) that acts as a multi-agent workspace manager. You launch AI coding agents — Claude Code, Codex CLI, Gemini CLI, Antigravity — in real PTY terminals, all accessible from a single browser UI.

v1 ships with:

- Product pipeline with six stages (idea through launch)
- Copilot panel with risk level, blockers, and next-action guidance
- Real terminal sessions in the browser via WebSocket
- Agent adapter system supporting four CLI agents
- Knowledge pack catalog (one pack: `pm-skills`)
- Cost tracking per agent
- Three visual themes (Midnight Indigo, Teal Signal, Ember Ops)
- 122 passing unit tests

---

## 2. Starting the App

```bash
# Default — opens browser at http://localhost:3457
node src/gui.js

# Load demo data (useful for first look)
node src/gui.js --demo

# Suppress auto-open browser
VIBE_NO_OPEN=1 node src/gui.js

# Custom port
PORT=3000 node src/gui.js
```

The server binds to `localhost` only. No external network access.

---

## 3. Logging In

On first run the app generates a random password and stores it in `state/config.json`. For the current dev environment the password is `1233`.

1. Open the app in the browser.
2. Enter the password on the login screen.
3. The server returns a bearer token, stored in `localStorage` as `vibe_token`.

To change the password, edit `state/config.json` directly (the file is gitignored).

---

## 4. The ZapCam Instalar Product

v1 ships with one product already registered:

| Field | Value |
|---|---|
| Name | Zapcan Instalar (zapcam) |
| Stage | idea (declared) |
| Path | `C:\Users\guibr\ZapCam` |

This is the sole product in the registry. It lives at `products/registry/products.json`.

> **Note:** The computed stage signal may show "brief" instead of "idea" because a brief artifact already exists in the ZapCam repo. See Known Limitations below.

---

## 5. Understanding the Main Screen

The UI has three columns:

- **Sidebar (left)** — workspace list, search box, theme switcher. Glassmorphism styling with `backdrop-filter: blur(20px)`.
- **Main area (center)** — Products view by default, showing the product pipeline cards. Click a product to open its detail.
- **Detail panel (right)** — appears when a product is selected, showing stage info, sessions, and the Copilot panel.

Navigation tabs at the top switch between Products, Workspaces, and Settings views.

---

## 6. Using the Copilot

When you select a product, the Copilot panel appears in the detail view. It provides:

- **Risk level** — a quick health indicator for the current stage.
- **Blockers** — anything preventing progress.
- **Next actions** — concrete steps the Copilot recommends.
- **CTA button** — the primary action for the current stage (e.g., "Start Brief", "Start Build").

The Copilot reads the product's current stage, bound knowledge packs, and handoff history to generate its guidance.

---

## 7. Starting a Session

1. Click the CTA button on the product detail (or use the "New Session" action).
2. A dialog appears asking you to choose:
   - **Agent** — Claude Code, Codex CLI, Gemini CLI, or Antigravity.
   - **Model** — agent-specific model options.
3. Confirm. The server spawns a real PTY process via `node-pty`.
4. A terminal opens in the browser, connected over WebSocket (`ws://localhost:PORT/ws/terminal?sessionId=X&token=Y`).

You interact with the agent directly in this terminal. The session is tracked in `state/workspaces.json`.

---

## 8. Advancing Through Stages

Products follow a six-stage pipeline:

```
idea → brief → design → build → test → launch
```

Each stage has its own CTA button. When you finish work in a stage, you record a handoff (see next section) and the product advances to the next stage. The Copilot updates its guidance accordingly.

Stages are stored in the product registry. Runs are tracked per stage in `state/product-runs.json`.

---

## 9. Recording a Handoff

When you are done with a stage:

1. Click "Finish Stage" (or the equivalent CTA for stage completion).
2. The app records a **handoff** — a summary of what was produced during this stage.
3. Handoff data is saved to `state/product-handoffs.json`.
4. The next stage picks up the handoff as context, so the Copilot and agents know what was already accomplished.

This is how institutional memory flows across stages.

---

## 10. Known v1 Limitations

These are real issues, not aspirational backlog items:

- **Search not filtering** — the sidebar search box accepts input but does not actually filter the workspace list.
- **Responsive layout** — header tabs overflow below 768px viewport width. There is no hamburger menu or mobile layout.
- **Glass effect invisible** — glassmorphism relies on `backdrop-filter: blur()`, but the background is solid black with no texture or image behind the glass panels, making the effect invisible.
- **Computed vs declared stage mismatch** — `products.json` may say "idea" while the computed stage signal says "brief" because it detects artifacts that already exist in the repo. The UI can show conflicting stage information.

---

## 11. Post-v1 Backlog

Small items to address after launch:

- [ ] Fix sidebar search to actually filter workspaces/products
- [ ] Add hamburger menu or responsive tab layout for viewports < 768px
- [ ] Add a subtle background texture or gradient behind glass panels so the blur effect is visible
- [ ] Reconcile computed stage with declared stage (either auto-advance or surface both clearly in the UI)
- [ ] Add session history/log viewer (currently sessions disappear from UI when PTY exits)
- [ ] Improve error feedback when agent CLI is not installed or not found in PATH
- [ ] Add keyboard shortcuts for common actions (new session, switch tabs)
- [ ] Cost tracking UI — surface per-session and per-product cost totals in the detail panel
