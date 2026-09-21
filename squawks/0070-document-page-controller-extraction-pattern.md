# Squawk 0070: Document the injected-deps page-controller extraction pattern in CLAUDE.md

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-14
**Completed**: 2026-09-21

## Report

The vault page has now been decomposed into three injected-deps controllers with
near-identical shape — `vault-nav-controller.js`, `vault-browser-import-controller.js`
(M19 F1), `vault-restore-controller.js` (M19 F2) — but the PATTERN is written
down nowhere: a `create*Controller(deps)` factory owning its own modal cluster,
closure-owned state exposed via getter/loader methods, live mutable page state
read via injected getters, and a single-purpose injected callback for a
secondary state coupling (the `setNotice` handoff). This is the same
"demonstrated repeatedly, documented never" gap the M19 F1 debrief flagged for
the `vault-page-model.js` pure-extraction pattern (squawk 0065). It also has an
active DRIFT to fix in the write-up: the two controllers read the same page
state through DIFFERENT getter shapes — `vault-browser-import-controller.js` takes
one `getPresence()`, `vault-restore-controller.js` takes two
`getJarRows()`/`getJarVaultPresence()`. Name ONE canonical shape so a fourth
consumer copies a contract, not whichever sibling it reads first.

Surfaced by the M19 F2 flight debrief (Architect + Developer, both).

## Evidence

- `src/renderer/pages/vault-{nav,browser-import,restore}-controller.js` — the
  three instances of the pattern.
- The getter drift: `vault-browser-import-controller.js`'s `getPresence` vs.
  `vault-restore-controller.js`'s `getJarRows`/`getJarVaultPresence`.
- CLAUDE.md — the Password vault "Module layout" section, where the note belongs.
- M19 F2 debrief, recommendation 3.

## Corrective Action

Added one bullet, "Vault page — controller decomposition," to CLAUDE.md's
Password vault section, immediately after the existing "Vault page — pure
display models" bullet (the precedent this squawk's report pointed at).

Before writing it, re-verified the report's claims against the current code,
since the squawk is a week old:

- `create*Controller(deps)` factory + closure-owned state exposed via
  getter/loader methods: confirmed in all three
  (`vault-restore-controller.js`'s `heldRecord()`/`loadHeld()` is the cleanest
  example, per its own extraction-rationale docstring).
- **Correction to the report**: `vault-nav-controller.js` does NOT share the
  "modal cluster + injected-getter live page-state read + `setNotice`"
  sub-shape the report attributed to all three. It owns a sidebar/scroll-spy,
  not a modal cluster; `vault.js` passes it rendered data as call-time
  arguments to `render(entries)`/`observe(sectionEls)`, never an injected
  getter; it has no `setNotice`-equivalent callback. It predates the other two
  (M12 F5 vs. M19 F1/F2) and is the simpler, more basic instance of the
  general factory+closure-state idiom — the note says so explicitly rather
  than overclaiming a third identical instance.
- The getter drift is real and confirmed exactly as reported:
  `vault-browser-import-controller.js`'s `getPresence()` returns
  `{ jarRows, jarVaultPresence }` in one call (used at its one call site,
  line 180, destructured together); `vault-restore-controller.js` takes two
  separate `getJarRows()`/`getJarVaultPresence()`, also always called
  together at its one call site (lines 481–482). Since every existing
  consumer of either shape reads both values together, every time, the
  two-getter shape buys no independent-read flexibility over the combined
  one — so the note names the single combined getter
  (`getPresence()`/`getState()`-shaped) as the canonical shape a fourth
  controller should copy, states the two existing shapes explicitly differ,
  and does NOT touch either controller's actual code (doc-only, per scope).
- The `setNotice` single-purpose-callback coupling (`pendingNotice`, written
  in `vault-restore-controller.js`, read only by `vault.js`'s `render()`) is
  confirmed and is unique to `vault-restore-controller.js` — noted as such,
  not generalized to the other two.

No source file was changed; CLAUDE.md is the only edit.

## Verification

- The note reads at CLAUDE.md's Password vault section, directly below "Vault
  page — pure display models," names all three controllers
  (`vault-nav-controller.js`, `vault-browser-import-controller.js`,
  `vault-restore-controller.js`), states the getter-shape drift plainly, and
  names the single combined getter as the canonical shape for new code with a
  one-line reason.
- `npm run format` — no changes (CLAUDE.md is not a Prettier-formatted
  target in this repo; verified via `format:check`, below).
- `npm run format:check` — "All matched files use Prettier code style!"
  (green).
- `npm test` — 5455 pass, 0 fail, 3 todo (pre-existing todos, unrelated to
  this change).
- This squawk's own edit touches exactly one source file, `CLAUDE.md` (plus
  this squawk record); other files showing as modified in `git status` belong
  to the other squawks completed earlier in this same batch turnaround and
  were left untouched, per instruction.

## Sign-Off

**Reviewer**: independent Reviewer agent (leg-execution crew), batch review of the
2026-09-21 turnaround
**Verdict**: confirmed — corrective action correct, complete, and confined to the reported surface; gates green (`npm test` 5455 pass / 0 fail / 3 todo, lint, typecheck, format:check, build:preload), leak scan clean
**Commit**: see `squawk: turnaround 2026-09-21`
