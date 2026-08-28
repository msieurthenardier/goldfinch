# Squawk 0047: A `node_modules` symlink leaking an absolute home path was committed to `main`

**Status**: completed
**Type**: defect
**Severity**: grounding
**Reported**: 2026-08-28
**Completed**: 2026-08-28

## Report

`main` at `46b5be6` tracks a symbolic link named `node_modules` whose target is an absolute operator home path (`/home/<user>/projects/goldfinch/node_modules`), leaking the operator's machine layout into a public repository and violating the "never leak operator identity / absolute home paths" rule.

Cause: during squawk 0045, a scratch git worktree symlinked its `node_modules` to the primary checkout to reuse installed deps; `.gitignore` listed `node_modules/` (a **directory** glob) which does not match a **symlink** named `node_modules`, so a `git add -A` staged and committed the link. It rode squawk 0045's PR (#187) onto `main`. The Flight 1 branch inherited it and later removed it from its own tree, but `main`'s live tree still carried it.

## Evidence

- `git ls-tree origin/main node_modules` → `120000 blob 8e5a8e4c…  node_modules`; `git cat-file -p 8e5a8e4c…` → the absolute home path.
- `.gitignore:1` was `node_modules/` (directory-only glob).

## Corrective Action

Remove the tracked symlink from `main` (`git rm node_modules`) and change `.gitignore:1` from `node_modules/` to `node_modules` so a file/symlink of that name can never be staged again. No source or dependency change; the real `node_modules` directory stays gitignored as before. Fixed on branch `squawk/0047-node-modules-symlink-leak` off `origin/main`.

**Residual (operator decision):** the leaking blob remains reachable in history at `46b5be6`. This forward fix removes it from every tree going forward but does not purge history; a full purge needs a `main` history rewrite (force-push), which the operator has previously declined for similar cases. Flagged for an explicit call.

## Verification

`git ls-tree HEAD node_modules` empty after the fix; `git check-ignore node_modules` matches the new pattern; `git status` clean of any node_modules entry after re-creating the real directory. Independent Reviewer sign-off recorded below.

## Sign-off

Independent Reviewer (leg-execution crew), 2026-08-28: `[HANDOFF:confirmed]` — staged change is exactly `D node_modules` (mode 120000 symlink) + `.gitignore:1` `node_modules/` → `node_modules`; `git check-ignore` still matches the real directory (330 entries, untouched on disk); nothing else staged; the leaking blob confirmed on `origin/main` and the history residual at `46b5be6` correctly out of this forward-fix's scope.
