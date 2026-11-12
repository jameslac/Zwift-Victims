# Agent Memory / Guidelines

## Architecture changes → GitHub check decision
Whenever we make an architecture change (new framework/runtime, new Worker binding, new API surface,
new data store, build/deploy change, etc.), **explicitly decide whether a new GitHub check/validator
is needed for it**, and either add it under `.github/workflows/` or note in the PR why not.

## Existing checks
- `ci.yml`: ESLint, typecheck + build, validators (lockfile sync, npm audit, config parse, gitleaks).
- `holistic-pr-review.yml`: Gemini-powered advisory PR review (needs `GEMINI_API_KEY` repo secret).

Run locally before pushing: `npm run lint && npm run build`.
