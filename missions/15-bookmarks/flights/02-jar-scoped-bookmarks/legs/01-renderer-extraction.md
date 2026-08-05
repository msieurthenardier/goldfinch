# Leg: renderer-extraction

**Status**: completed
**Flight**: [Jar-Scoped Bookmarks](../flight.md)

## Objective

Extract the vault flow out of `renderer.js` into a new `src/renderer/chrome/vault-controller.js`, restoring real `RENDERER_LINE_BUDGET` headroom (Flight 1 debrief recommendation 5) with zero behavior change and zero bookmark work.

## Context

- `renderer.js` measures **1933** by the seam test's own metric (`source.split(/\r?\n/).length`, `test/unit/seam-contract.test.js:162`), exactly at `RENDERER_LINE_BUDGET = 1933` (`:124`). **Zero headroom** — any addition fails the suite. Legs 2 and 3 of this flight add call sites to this file.
- The flight planned this leg after design review found the headroom problem; the operator chose extraction over a fourth consecutive budget raise. The budget's own comment block narrates three prior bumps and calls extraction "banked architecture debt" — this leg pays it.
- **Extraction precedent to follow**: `downloads-controller.js` — a chrome module that owns its own overlay-state entry (merged into the `overlayMenus` table as `downloads: downloadsController.overlayState`, `renderer.js:407`), handles its own sheet activation via a boolean-return `handleActivation(payload)` chained *before* the generic `dispatchOverlayActivation` (`renderer.js:414`), and receives late-bound overlay-menu closures at construction (`renderer.js:252-257`) to break the construction-order cycle with `overlayMenuClient`.
- **Why the vault slice**: it is the largest coherent, self-contained region — its five module-scoped state variables (`pendingVaultFlow`, `lastPickerModel`, `pendingCaptureId`, `pendingCaptureUnlock`, `lockState`/`vaultStatePushed`) are read *only* by vault code, and nothing in this flight's later legs touches it. Bookmark-adjacent slices are deliberately avoided: legs 2–3 rework those, and extracting them now would churn the same lines twice.

## Inputs

- `src/renderer/renderer.js` at 1933 (seam-test metric), on branch `flight/02-jar-scoped-bookmarks`
- `test/unit/seam-contract.test.js` pinning `RENDERER_LINE_BUDGET = 1933` and `SEAM_COUNT` = 33
- Suite green at `main` (`2883331`)

## Outputs

- New `src/renderer/chrome/vault-controller.js` owning the vault flow
- `renderer.js` reduced to construction + wiring for that flow, measuring ≤ 1560
- `RENDERER_LINE_BUDGET` **rebased downward** with the change narrated in its comment block
- Suite, typecheck, lint green; no behavior change

## Acceptance Criteria

- [x] A new `src/renderer/chrome/vault-controller.js` exists and owns the vault flow end to end: the 11 vault overlay-state entries (`vault-unlock`, `vault-picker`, `vault-capture`, `vault-set`, `vault-recovery-show`, `vault-stepup`, `vault-accesskey-show`, `vault-import-unlock`, `vault-change-master`, `vault-recover`, `vault-adminkey-show`); the flow state machine and its five state variables; `openVaultPicker`, `openCaptureSheet`, `renderVaultIndicator`; every `window.goldfinch.onVault*` subscription; the `vault-picker` activation dispatch (including `MANAGE_ID` / `parsePickIndex` handling) and the vault no-op dispatch cases; the vault branches of overlay-close handling; and the vault `*ForAudit` hooks. **Deviation**: the spec says "nine" `*ForAudit` hooks — the live codebase (verified by grep against both `renderer.js` and `scripts/a11y-audit.mjs`) has exactly **eight** vault-prefixed `*ForAudit` functions (`openVaultSetOverlayForAudit`, `openVaultRecoveryShowOverlayForAudit`, `openVaultStepupOverlayForAudit`, `openVaultAccessKeyShowOverlayForAudit`, `openVaultImportUnlockOverlayForAudit`, `openVaultChangeMasterOverlayForAudit`, `openVaultRecoverOverlayForAudit`, `openVaultAdminKeyShowOverlayForAudit`); all eight moved, none left behind.
- [x] `renderer.js` measures **≤ 1560** by the seam test's metric — measures **1527**.
- [x] `RENDERER_LINE_BUDGET` is **lowered** to the new measured size plus headroom for legs 2–3 — final value ≤ 1700 — with the comment block extended to narrate the extraction (module name, what moved) in the same style as the three bump entries it follows. The stale test name (`"…within its 1,200-line budget"`) is corrected to describe the budget by constant, not by a hardcoded stale number. New budget: **1650** (measured 1527 + ~123 headroom).
- [x] The evaluate seam is byte-stable in *membership*: the same 33 identifiers, `SEAM_COUNT` unchanged, seam anchor unique, all seam-contract tests green **without weakening any assertion**. The eight vault audit hooks are re-published at the seam by importing them from the new module — names unchanged (they are consumed by name from `scripts/a11y-audit.mjs`).
- [x] Behavior-neutral: no bookmark code touched, no behavior-spec prose touched, no IPC/preload change, no changes outside `renderer.js`, the new module, `test/unit/seam-contract.test.js`, and (if it enumerates chrome modules) `CLAUDE.md` (updated: the Password vault pattern's Module layout bullet now names the new chrome-side controller; the unrelated top-level chrome-module list was left alone, consistent with it never having been updated for `bookmarks-client.js`/`bookmarks-bar.js` either).
- [x] `npm test`, `npm run typecheck`, `npm run lint` all green.

## Verification Steps

- `node --test test/unit/seam-contract.test.js` — budget and seam pins green at the new values.
- `npm test && npm run typecheck && npm run lint` — full suite green with **no test edited except** `seam-contract.test.js`.
- `grep -c "onVault" src/renderer/renderer.js` → 0; `grep -n "pendingVaultFlow\|pendingCaptureId\|lastPickerModel\|lockState" src/renderer/renderer.js` → no hits (state fully moved, not duplicated).
- `awk 'END{print NR}' src/renderer/renderer.js` cross-checked against the new budget for the claimed headroom.

## Implementation Guidance

1. **Create `vault-controller.js` on the `createDownloadsController` shape.** Constructor deps (all injected, no new imports in the module beyond what its own code needs): `window`, `els`, bridge (`window.goldfinch`), `jarsClient`, `isSafeColor`, `buildVaultIndicatorModel`, `parsePickIndex`, `MANAGE_ID`, `openVaultPage`, and late-bound overlay closures (`openOverlayMenu`, exactly as `downloads-controller.js` receives them — `renderer.js:252-257`). Move the module-scoped imports it strands (`buildVaultIndicatorModel`, `parsePickIndex`/`MANAGE_ID` if nothing else uses them) out of `renderer.js`.
2. **Expose from the controller**: `overlayStates` (an object of the 11 entries, spread into the `overlayMenus` table where the individual entries sit today — the `downloads:` precedent generalized), `handleActivation(payload)` returning `true` when `menuType` is vault-owned (real dispatch for `vault-picker`; validated no-op `true` for the show/ack sheets), `handleClosed({ menuType, reason })` called from `handleOverlayClosed` (moves the two `vault-unlock` guards and the `vault-capture` dismiss-drop branch), and the nine audit hooks by their exact current names.
3. **Chain activation** at `renderer.js:413-415`: `if (!downloadsController.handleActivation(payload) && !vaultController.handleActivation(payload)) dispatchOverlayActivation(payload)`. Delete the moved `case` blocks from `dispatchOverlayActivation`.
4. **Preserve two ordering contracts verbatim** (move wholesale, do not restructure): subscribe-to-`onVaultLockState`-*then*-fetch (`renderer.js:1759-1785` — the DD10 freshness contract is in the comment); and the phase-guarded continuation logic in that subscription (unlock→pick, unlock-to-save finalize).
5. **Construction order**: the controller must be constructed before the `overlayMenus` table literal is built (its `overlayStates` spread into it), which is before `createOverlayMenus` — hence every overlay call the controller makes must be late-bound closures, never a direct `overlayMenuClient` reference. `downloads-controller.js` already models this exactly.
6. **Rebase the budget.** Measure the final file with the test's own metric, set `RENDERER_LINE_BUDGET` to measured + ~100 (round to a clean number, ≤ 1700), extend the comment narration, fix the stale test name.
7. **Check `CLAUDE.md`** for any enumeration of `src/renderer/chrome/` modules or the vault flow's location; update if present. Do not add new sections.

## Edge Cases

- **`onAuthChallengePresent` / `onCertChallengePresent` stay in `renderer.js`** — they are the challenge flow (M14), not the vault flow, despite adjacency. Their overlay states, no-op dispatch cases, and audit hooks stay too. Scope discipline: vault only.
- **`auth-basic`, `cert-picker`, `bookmark-edit`, `bookmarks-overflow` dispatch cases stay** in `dispatchOverlayActivation` untouched.
- **The seam block's `});` terminator**: `extractSeamIdentifiers` takes text up to the *first* `});` after the anchor — the moved audit hooks must remain plain identifiers (with optional trailing `//` comment) inside that block; do not convert them to `name: vaultController.name` property pairs (that would break `IDENTIFIER_RE` extraction and fail `SEAM_COUNT`). Import them as named bindings (or destructure from the controller into consts) so bare identifiers still work.
- **A stale `vault-unlock` close racing a successful unlock**: the two close guards are `lockState`-gated; because `lockState` and the guards move together into one module, the gating is unchanged — verify by reading, not by restructuring.
- **`getVaultLockState` boot fetch failure** is swallowed (`.catch(() => {})`) — preserve.

## Files Affected

- `src/renderer/renderer.js` — vault flow removed; controller constructed and wired
- `src/renderer/chrome/vault-controller.js` — new
- `test/unit/seam-contract.test.js` — budget rebased + narration + stale test name
- `CLAUDE.md` — only if it enumerates chrome modules / vault-flow location

## Citation Audit (2026-07-31)

All citations verified against the working tree this session: budget pin `seam-contract.test.js:124`, metric `:162-163`, stale name `:161`; seam anchor + `SEAM_COUNT` mechanics `:126-215`; `downloads-controller` precedent `renderer.js:252-257`, `:407`, `:414`; vault overlay states `renderer.js:322-406`; vault flow region `renderer.js:1534-1785`; vault audit hooks `renderer.js:609-636`; `vault-picker` dispatch `renderer.js:816-847`; vault close branches `renderer.js:1139-1167`. File measured 1933 by the test's metric (the flight spec's "1932" was `wc -l`, which undercounts by the final unterminated line — the test's metric is the binding one).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header) — flight-end review will advance it to `completed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit — flight-end review and commit happen after the last autonomous leg (not committed; left for flight-end review)
