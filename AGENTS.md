# Agent Memory / Guidelines

## Architecture changes → GitHub check decision
Whenever we make an architecture change (new framework/runtime, new Worker binding, new API surface,
new data store, build/deploy change, etc.), **explicitly decide whether a new GitHub check/validator
is needed for it**, and either add it under `.github/workflows/` or note in the PR why not.

## Existing checks
- `ci.yml`: ESLint, typecheck + build, validators (lockfile sync, npm audit, config parse, gitleaks).
- `ai-review.yml` + `.github/scripts/ai_pr_reviewer.py`: Full-repo + diff AI PR reviewer (runs on non-draft PRs; uses `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` and posts summary + inline PR review comments + context scale meter).

Run locally before pushing: `npm run lint && npm run build`.
