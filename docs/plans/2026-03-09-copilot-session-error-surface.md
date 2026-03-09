# Copilot Session Error Surface — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Surface API errors (especially 400 dirty-tree) to the user in the Start Stage dialog instead of silently closing.

**Architecture:** Two changes — (1) modify `showDialog` to support keeping the dialog open on async button handlers that throw, and (2) add try/catch in the `startGuidedStage` onClick to display the error message inside the dialog.

**Tech Stack:** Vanilla JS (no build step), Express backend (unchanged).

---

## Root Cause

`App.showDialog()` (line 3227) calls `App.hideDialog()` **before** the handler runs. So even if the async `onClick` throws, the dialog is already closed. The error from `App.api()` (line 63: `throw new Error(data.error || ...)`) is never caught or displayed.

Two independent fixes needed:
1. `showDialog` must not auto-close when handler is async and fails.
2. `startGuidedStage` onClick must catch errors and render them.

---

### Task 1: Make showDialog support error-aware buttons

**Files:**
- Modify: `src/web/public/app-core.js:3222-3231`

**Step 1: Read the current showDialog code to confirm exact state**

Confirm lines 3217-3234 match the code we inspected.

**Step 2: Modify the button click handler in showDialog**

Change the click handler so that:
- It calls the handler first (awaiting if async)
- Only hides the dialog if the handler doesn't throw
- If it throws, does NOT hide the dialog (lets the handler decide what to show)

Replace lines 3227-3229:
```javascript
// BEFORE:
btn.addEventListener('click', function() {
  App.hideDialog();
  handler();
});

// AFTER:
btn.addEventListener('click', async function() {
  try {
    await handler();
    App.hideDialog();
  } catch (e) {
    // Dialog stays open — handler is responsible for showing error
    console.warn('Dialog action error:', e.message);
  }
});
```

**Important:** The Cancel button's handler is `function() {}` which returns undefined — `await undefined` resolves fine, so Cancel still closes the dialog normally.

**Step 3: Verify Cancel still works**

Run the app, open any dialog, click Cancel. It should close normally.

**Step 4: Commit**

```bash
git add src/web/public/app-core.js
git commit -m "fix(dialog): await handler before closing, keep open on error"
```

---

### Task 2: Add error handling to startGuidedStage onClick

**Files:**
- Modify: `src/web/public/app-core.js:1625-1656`

**Step 1: Add error container to the dialog body**

In the `App.showDialog(...)` call at line 1623, prepend an error container div to the dialog body HTML:

```javascript
// At the START of the bodyHTML string (inside the showDialog call), add:
'<div id="dlg-stage-error" class="dialog-error-msg" style="display:none"></div>' +
```

This goes right after the opening of the showDialog call's second argument (the body HTML string).

**Step 2: Wrap the onClick body in try/catch**

Replace the onClick function body (lines 1625-1656) with:

```javascript
{ label: 'Create Session', primary: true, onClick: async function() {
  var errorEl = document.getElementById('dlg-stage-error');
  if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
  const presetSelect = document.getElementById('dlg-stage-preset');
  let selectedPreset = defaultPreset;
  if (presetSelect && presetSelect.value) {
    try {
      selectedPreset = JSON.parse(presetSelect.value);
    } catch (_error) {
      selectedPreset = defaultPreset;
    }
  }
  try {
    await App.api('/products/' + encodeURIComponent(productId) + '/stages/' + encodeURIComponent(stageId) + '/start', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('dlg-stage-name').value.trim() || defaultName,
        runtimeAgent: document.getElementById('dlg-stage-agent').value,
        model: document.getElementById('dlg-stage-model').value,
        effort: document.getElementById('dlg-stage-effort').value,
        workingDir: document.getElementById('dlg-stage-dir').value,
        knowledge_pack_id: selectedPreset ? selectedPreset.knowledge_pack_id : '',
        knowledge_pack_name: selectedPreset ? selectedPreset.knowledge_pack_name : '',
        preset_type: selectedPreset ? selectedPreset.preset_type : '',
        preset_id: selectedPreset ? selectedPreset.preset_id : '',
        preset_label: selectedPreset ? selectedPreset.preset_label : '',
        previous_handoff_id: latestIncomingHandoff ? latestIncomingHandoff.handoff_id : '',
        previous_handoff_summary: latestIncomingHandoff ? latestIncomingHandoff.summary : ''
      })
    });
    await App.loadAllSessions();
    await App.loadProducts(true);
    App.renderWorkspaceList();
    App.renderCurrentView();
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = err.message || 'Failed to create session';
      errorEl.style.display = 'block';
    }
    throw err; // Re-throw so showDialog keeps the dialog open (Task 1)
  }
}}
```

**Step 3: Commit**

```bash
git add src/web/public/app-core.js
git commit -m "fix(copilot): surface API errors in start-stage dialog"
```

---

### Task 3: Add minimal CSS for the error message

**Files:**
- Modify: `src/web/public/styles.css`

**Step 1: Find dialog styles section**

Search for `.dialog` or `#dialog` in styles.css to find where to add.

**Step 2: Add error message style**

```css
.dialog-error-msg {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #fca5a5;
  padding: 10px 14px;
  border-radius: var(--radius, 12px);
  font-size: 0.85rem;
  margin-bottom: 12px;
  line-height: 1.4;
}
```

**Step 3: Commit**

```bash
git add src/web/public/styles.css
git commit -m "style: add dialog error message styling"
```

---

### Task 4: Verify executeNextAction fallback path

**Files:**
- Review: `src/web/public/app-core.js:1696-1715`

**Step 1: Confirm executeNextAction already has try/catch**

The `executeNextAction` function (line 1696-1713) already wraps the API call in try/catch and falls back to `startGuidedStage`. This means:
- If the next-actions/execute endpoint fails (e.g. dirty tree), it catches the error and calls `startGuidedStage`.
- `startGuidedStage` will show the dialog, user clicks Create Session, and NOW (after our fix) the 400 error will be shown.

**No code change needed here.** Just verify this flow works during testing.

---

### Task 5: Manual validation

**Step 1: Test dirty tree scenario**

1. Make an uncommitted change in a product's working directory
2. Open the product in Copilot
3. Click the CTA to start a stage
4. Click "Create Session"
5. **Expected:** Dialog stays open, red error message appears with "Working directory has uncommitted changes..."

**Step 2: Test clean tree scenario**

1. Commit all changes in the product's working directory
2. Repeat the same flow
3. **Expected:** Session is created, dialog closes, UI updates normally

**Step 3: Test manual workspace path**

1. Go to Runtime Workspace
2. Click "+ New Session"
3. Create a session
4. **Expected:** Works exactly as before (unchanged code path)

**Step 4: Test Cancel button**

1. Open any dialog (start stage, new session, etc.)
2. Click Cancel
3. **Expected:** Dialog closes normally

**Step 5: Final commit (squash or tag)**

```bash
git log --oneline -5
```

Verify 3 commits from this branch.

---

## Summary of Changes

| File | Change |
|---|---|
| `src/web/public/app-core.js:3227-3229` | `showDialog` awaits handler, only closes on success |
| `src/web/public/app-core.js:1623` | Error container div added to dialog body |
| `src/web/public/app-core.js:1625-1656` | try/catch around API call, error displayed + re-thrown |
| `src/web/public/styles.css` | `.dialog-error-msg` styling |

## Risks

- **Low:** Other dialogs that throw from onClick will now keep the dialog open instead of closing. This is actually better behavior (fail-safe).
- **None:** Backend logic unchanged. No business rule changes.
