# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

---

## 🔴 DEFINITION OF DONE — Applies to Every Task, Every Session

**A task is NOT complete until this runs and you report the result.**

This applies whether you are:
- Starting fresh
- In the middle of a multi-step plan
- Finishing the last step of a long session
- About to say "done", "finished", "implemented", or "complete"

**Before marking anything done, run:**

```bash
node scripts/sync-tests.js
```

Then, for every route or `data-testid` reported as missing coverage:
1. Read the implementation to understand the contract
2. Write the tests in `e2e/full-suite/complete.spec.js` (existing feature) or a new `e2e/full-suite/[feature].spec.js` (new feature)
3. Run the scanner again to confirm coverage went up

**End every response with this block:**

```
DONE
  Changed: [files]
  New routes/testids: [list or "none"]
  Tests added: [N tests in file X] or "no new routes detected"
  Coverage: XX% → YY%
```

If coverage stayed the same because nothing new was added, write:
```
DONE
  Coverage: XX% (no new routes or testids detected)
```

> This is not optional. Do not skip this step even if the task feels unrelated to tests.
> Do not skip this step mid-plan. Run it after every implemented unit.

---

