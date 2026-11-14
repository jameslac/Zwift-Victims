# Agent Memory / Guidelines

## Git branching workflow
Always `git fetch origin` first and create new feature branches directly off `origin/main`
(e.g. `git checkout -f -B <branch-name> origin/main`). Never stall on leftover working-tree
changes from a previously checked-out branch—reset/force-checkout cleanly onto `origin/main`
(unless continuing an existing remote branch for the same ticket).

## Architecture changes → GitHub check decision
Whenever we make an architecture change (new framework/runtime, new Worker binding, new API surface,
new data store, build/deploy change, etc.), **explicitly decide whether a new GitHub check/validator
is needed for it**, and either add it under `.github/workflows/` or note in the PR why not.

## Existing checks
- `ci.yml`: ESLint, typecheck + build, validators (lockfile sync, npm audit, config parse, gitleaks).
- `ai-review.yml`: Centralized AI PR reviewer (`jameslac/github-workflows/.github/workflows/ai-review.yml@main`).

Run locally before pushing: `npm run lint && npm run build`.
