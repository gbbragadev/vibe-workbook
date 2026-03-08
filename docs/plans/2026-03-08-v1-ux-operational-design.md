# Vibe Workbook v1 — UX Operational Design

> Date: 2026-03-08
> Status: Approved
> Author: guibr + Claude (brainstorming session)

## Vision

Turn Vibe Workbook from a capable but confusing 60-70% usable platform into a **clearly usable product cockpit**. No new features — give shape, orientation, and perceived utility to what already exists.

The user opens the app and immediately knows: **what to do, on which product, at which stage, and what evidence is missing.**

---

## Core Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Screen hierarchy | Dashboard shows Copilot summary per product | Multi-product manager needs overview without clicking |
| D2 | Copilot role | Center of the experience, not a secondary panel | Backend is rich (715 lines), UI underexposes it |
| D3 | Readiness model | Traffic light (green/yellow/red) from `delivery_readiness` | Logic already exists in 3 tiers |
| D4 | Knowledge Packs | Show active preset in stage header, not as separate section | Influences execution, not content to browse |
| D5 | Sidebar | Products first, legacy workspaces secondary | Core concept is product, not workspace |
| D6 | Secondary views | Terminals, History, Costs stay as tabs | Operation is the focus, not navigation |
| D7 | Copilot is not a chat | It's a product GPS — position, direction, obstacles | No conversational UI needed |

---

## Scope

### In Scope

1. Promote Copilot summary + readiness badge + CTA to product cards on the dashboard
2. Implement traffic light readiness (green/yellow/red) with visual badge
3. Refactor sidebar to list products as primary items
4. Improve pipeline visualization in cockpit with colored status per stage
5. Reorganize cockpit: Copilot recommendation on top, artifacts as checklist
6. Show knowledge pack preset in Start Stage dialog
7. Map `action_type` → consistent CTA label/action
8. Show `blocking_reasons` as compact list in cockpit
9. Warning for products with invalid repo path
10. Collapse secondary sections (decisions, candidates) by default
11. Artifacts counter on card (e.g., "3/7")
12. Hover on traffic light shows what's missing

### Out of Scope

- No new backend services or API endpoints (use existing Copilot snapshot)
- No architectural refactoring (modularization is a separate plan)
- No new features (ideas view, cost alerts, agent auto-selection)
- No build tooling or framework changes (stays vanilla JS)
- No database/persistence changes
- No auth/security improvements
- No mobile responsiveness work

---

## Main Flow (Happy Path)

```
1. Open app → Product Dashboard (overview)
   - Each card: name, current stage, readiness (traffic light), next action (CTA)

2. Click product → Product Cockpit
   - Header: name + readiness badge + current stage
   - Copilot Panel (center): summary, recommended next move (primary CTA)
   - Visual pipeline: 7 stages with colored status
   - Artifacts: what exists vs what's missing (compact)
   - Blockers/Decisions: only if present

3. Click "Start Stage" or Copilot CTA → Execution
   - Opens terminal with recommended agent
   - Knowledge pack preset injected as context
   - Run coordinator tracks session + outputs

4. Finish stage → Handoff
   - Finish Stage dialog (already simplified by PR #9)
   - Readiness recalculated automatically
   - Dashboard updates traffic light
```

---

## Dashboard Structure (Products View)

Each product card shows:

1. **Readiness badge** (traffic light) — color derived from state
2. **Name + current stage** — from `pipeline`
3. **Copilot summary** — 1 line from `copilot.summary` or `recommended_next_move.reason`
4. **Primary CTA** — button for recommended next action
5. **Artifacts counter** — `X/7 artifacts` as compact progress

```
┌─ Product Card ─────────────────────────────────────┐
│ 🔴 Zapcam          Stage: Implementation           │
│ "Implementation has not produced enough             │
│  evidence yet."                                     │
│ [▸ Continue Implementation]         3/7 artifacts   │
└────────────────────────────────────────────────────┘
```

---

## Product Cockpit Structure (Detail View)

Visual hierarchy (top to bottom):

1. **Copilot Recommendation** — the most important thing, primary CTA
2. **Pipeline visual** — context of where the product is
3. **Artifacts + Blockers** — evidence side by side
4. **Active Run / Knowledge** — execution context
5. **Decisions** — collapsible, only if present

---

## Project Copilot Behavior

| Aspect | Behavior |
|--------|----------|
| **Visibility** | Always visible — on card (summarized) and in cockpit (complete) |
| **Summary** | 1 sentence from `buildSnapshot().summary` — current state |
| **Recommendation** | `recommended_next_move` — action with type, reason, confidence |
| **Primary CTA** | Mapped from `action_type` (see table below) |
| **Refresh** | Manual (button) — rescans repo, recalculates artifacts |
| **Candidates** | Shown as "pending items" in blockers, not as separate dashboard section |
| **Decisions** | Collapsible section in cockpit, counter on card |
| **Knowledge hint** | Show recommended preset alongside execution CTA |

### action_type → CTA Mapping

| action_type | Button Label | Action |
|-------------|-------------|--------|
| `review-artifact-candidates` | "Review Candidates" | Opens candidate list |
| `resolve-open-issues` | "Resolve Decisions" | Focuses on decisions section |
| `rework-current-stage` | "Continue {stage}" | Opens terminal for active session |
| `advance-stage` | "Start {stage}" | Starts new run/session |
| `prepare-test-deploy` | "Prepare Release" | Starts release stage |
| `review-for-production` | "Review for Release" | Shows final checklist |
| `clarify-project-state` | "Refresh Analysis" | Full re-scan |

---

## Readiness Model (Traffic Light)

Derived directly from existing `delivery_readiness`:

| Color | Condition | Label |
|-------|-----------|-------|
| 🟢 Green | `ready_for_production === true` | "Ready" |
| 🟡 Yellow | `ready_for_test === true` AND `ready_for_production === false` | "Almost Ready" |
| 🔴 Red | `ready_for_test === false` | "Not Ready" |

### Rules (already implemented in backend):

- **ready_for_test**: implementation in-progress/done + at least 1 core doc (spec/arch/brief)
- **ready_for_test_deploy**: ready_for_test + runbook exists
- **ready_for_production**: ready_for_release_candidate + test-strategy + release-plan + runbook

### UI Behavior:

- Colored badge on card and cockpit header
- `blocking_reasons` shown as list in blockers section
- Hover/click on badge shows what's missing

---

## Concept Hierarchy

| Primary (always visible) | Secondary (on demand) |
|--------------------------|----------------------|
| Product | Workspace (legacy) |
| Current stage | Individual sessions |
| Next action (CTA) | Decision log |
| Readiness (traffic light) | Candidate artifacts |
| Artifacts (exists/missing) | Cost tracking |
| Copilot summary | Knowledge pack config |
| Active run | Session discovery |
| Terminal (execution) | History |

---

## Acceptance Criteria

### AC1: Dashboard shows Copilot context per product
- [ ] Each product card displays readiness badge (colored dot or chip)
- [ ] Each card shows 1-line summary from Copilot snapshot
- [ ] Each card has a primary CTA button mapped from `recommended_next_move.action_type`
- [ ] Each card shows artifacts counter (e.g., "3/7")
- [ ] Cards with `path_status: invalid/mismatched` show a warning indicator

### AC2: Traffic light readiness is visual and correct
- [ ] Green/yellow/red badge renders from `delivery_readiness` state
- [ ] Badge appears on both dashboard card and cockpit header
- [ ] Hover or click on badge reveals `blocking_reasons` list
- [ ] Readiness updates after stage completion without manual refresh

### AC3: Sidebar prioritizes products
- [ ] Products listed as primary sidebar items
- [ ] Legacy workspaces moved to collapsible "Workspaces" section below products
- [ ] Clicking a product in sidebar opens its cockpit

### AC4: Cockpit reorganized with Copilot on top
- [ ] Copilot recommendation panel is the first section in product detail
- [ ] Pipeline visualization shows colored status per stage (done/in-progress/not-started)
- [ ] Artifacts shown as checklist (✓/✗) not just text list
- [ ] Blocking reasons shown as compact list
- [ ] Decisions and candidates collapsed by default

### AC5: Knowledge Packs influence execution
- [ ] Start Stage dialog shows recommended preset from knowledge pack
- [ ] Active run displays knowledge driver label
- [ ] Skills hint from Copilot visible alongside CTA

### AC6: CTA mapping is consistent
- [ ] All 7 `action_type` values map to a labeled button
- [ ] CTA triggers the correct action (open terminal, start run, navigate to section)
- [ ] "Continue" vs "Start" correctly reflects whether a run is active

---

## Files Likely to Change

### Frontend (primary changes)
| File | Changes |
|------|---------|
| `src/web/public/app.js` | Product card rendering (add Copilot summary, readiness badge, CTA, artifacts counter), sidebar refactor (products first), cockpit reorg (Copilot on top, pipeline colors, artifact checklist), CTA mapping logic, readiness badge component |
| `src/web/public/styles.css` | Readiness badge styles (.readiness-green/yellow/red), pipeline stage colors, artifact checklist styles, sidebar product items, collapsible section styles |
| `src/web/public/index.html` | Possible sidebar structure changes (products section), minor layout tweaks |

### Backend (minor changes)
| File | Changes |
|------|---------|
| `src/web/server.js` | Possibly expose Copilot snapshot in product list endpoint (currently only in detail) |
| `src/core/product-service.js` | May need a lightweight Copilot summary for list view (avoid full snapshot per product) |
| `src/core/project-copilot-service.js` | Possibly add `buildLightSnapshot()` for dashboard cards (summary + readiness + recommendation only) |

### No changes expected
- `src/core/run-coordinator-service.js` — already complete
- `src/core/knowledge-pack-service.js` — already complete
- `src/state/store.js` — no persistence changes
- `platform/` — no governance changes
- `products/` — no catalog changes

---

## Risks

| # | Risk | Mitigation |
|---|------|------------|
| R1 | Full Copilot snapshot per product on dashboard may be slow (scans repo filesystem) | Create `buildLightSnapshot()` that returns only summary + readiness + recommendation without full artifact scan |
| R2 | app.js is already 2979 lines — adding more rendering logic increases fragility | Keep changes surgical; the modularization plan (separate doc) addresses this separately |
| R3 | Products with invalid repo paths will fail Copilot snapshot | Handle gracefully — show "Path not configured" instead of crashing |
| R4 | Sidebar refactor may break workspace drag-to-terminal flow | Preserve legacy workspace section as collapsible; don't remove, just demote |
| R5 | CTA mapping assumes `recommended_next_move` is always present | Fallback to generic "Open Product" CTA if Copilot snapshot returns null |
| R6 | Readiness badge depends on Copilot data being loaded | Show neutral/gray badge while loading; don't block card rendering |

---

## Priority Backlog

### P0 — Essential (not v1 without this)
1. Promote Copilot summary + readiness badge + CTA to dashboard product cards
2. Implement readiness traffic light (green/yellow/red) with visual badge
3. Refactor sidebar to list products as primary items
4. Improve pipeline visual in cockpit with colored status per stage

### P1 — Important (significantly improves experience)
5. Reorganize cockpit: Copilot recommendation on top, artifacts as checklist
6. Show knowledge pack preset in Start Stage dialog
7. Map action_type → consistent CTA label/action
8. Show blocking_reasons as list in cockpit

### P2 — Polish
9. Warning for products with invalid repo path
10. Collapse secondary sections (decisions, candidates) by default
11. Artifacts counter on card (e.g., "3/7")
12. Hover on readiness badge shows what's missing
