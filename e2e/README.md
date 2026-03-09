# Playwright E2E Tests

This folder contains the Playwright End-to-End (E2E) test suite for the Vibe Workbook frontend.
The test suite validates core navigation flows and the full lifecycle of the **Ideas** feature.

## Requirements

Ensure that you have installed the test dependencies:
```bash
npm install -D @playwright/test
npx playwright install chromium
```

## Running the Tests

To run the full suite using the local server:
```bash
npx playwright test
```

To run a specific test file:
```bash
npx playwright test e2e/ideas.spec.js
```

To see the test run output as a list (useful for debugging):
```bash
npx playwright test --reporter=list
```

## Authentication Handling
The tests automatically bypass manual authentication by dynamically reading the generated `VIBE_PASSWORD` from your local `state/config.json` via the `performLogin` helper in `e2e/helpers/auth.js`.

## Robustness (`data-testid`)
If you modify the UI structure, please maintain the `data-testid` attributes assigned to critical elements in both `index.html` and `app-core.js` to prevent fragile selectors from breaking the test suite.
