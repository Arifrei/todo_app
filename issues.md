# Codebase Improvement Tracker

Status rule: complete all **Findings** tasks before starting **Implementation Balance** tasks.

## Findings (Fix First)

- [x] F1 - Reduce backend monolith pressure: extract shared pure helpers from `app.py` into dedicated modules (no behavior changes).
- [x] F2 - Reduce frontend monolith pressure: extract Vault feature logic from `static/app.js` into `static/vault.js` and keep behavior unchanged.
- [x] F3 - Remove duplicated phase + AI parsing utility logic by using shared helper modules.
- [x] F4 - Replace broad `except Exception` usage in core utility paths with narrower exceptions where behavior is predictable.
- [x] F5 - Centralize background-thread startup helpers so async job spawning is consistent across modules.
- [x] F6 - Deduplicate migration helper functions shared by `migrate.py` and `global_migrations.py`.
- [x] F7 - Standardize recall processor logging (`logging`) instead of `print`.
- [x] F8 - Validate refactor safety with project-wide syntax checks for touched Python and JavaScript files.

## Implementation Balance (Do After Findings)

- [x] B1 - Reassess heavy similarity/grouping helpers and isolate algorithmic utilities from route modules.
- [x] B2 - Consolidate input normalization patterns into shared validation helpers to reduce scattered handling.
- [x] B3 - Consolidate OpenAI call flows to one consistent adapter style across app components.
