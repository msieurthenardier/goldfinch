# Mission: Codebase Health — 2026-08-27 Maintenance

**Status**: active

## Outcome

Resolve the codebase health issues identified in maintenance report
[2026-08-27](../../maintenance/2026-08-27.md): a keyboard-only user can reach
and traverse page content; the automation surface enforces the
internal-session invariant it documents; the sheet layer has executable
verification; and the vault stops trusting its own file's parameters and a
donor bundle's key material.

## Context

Third maintenance cycle and the first full-category sweep since 2026-06-05.
Nine missions landed in between. The sweep found the codebase structurally
healthy (suite, lint, typecheck, audit, resource discipline, security core
all verified) and four accumulated gaps that need design rather than a
squawk: one Critical accessibility failure (#174), guard drift on the MCP
admin tier reaching vault plaintext, 17 of 19 sheet lifecycles with no
executable verification, and two read-path trust gaps in the vault store.
Twenty-four squawk-sized items were logged separately as squawks 0016–0039
and are not part of this mission.

## Success Criteria

- [ ] A keyboard-only user can move focus from the chrome into the active
      guest page, Tab forward through the page's focusable elements, and
      return to the chrome — pinned by a rewritten `chrome-guest-keyboard-nav`
      spec whose guest entry is by keyboard, plus a keyboard-only
      navigate→activate-link→fill-field spec (F48 / #174)
- [ ] Omnibox suggestion highlighting is exposed to assistive technology
      across the view boundary (a chrome-owned announcement or equivalent
      ruled in design), with the mechanism shared with criterion 1's focus
      handoff rather than a second cross-view scheme (F49)
- [ ] Under an admin automation key, `click`/`typeText`/`scroll`/`pressKey`
      and `readDom`/`readAxTree`/`captureScreenshot` refuse internal
      `goldfinch://` targets exactly as `evaluate` and `nav` already do, and
      `docs/mcp-automation.md` states only what the code enforces (F1, F10k)
- [ ] `vaultFill`/`vaultAnswerAuth` resolve targets through the same
      sheet/popup/tab-view predicate set as every other tool (F9), and
      `download-media` validates a renderer-supplied `webContentsId`
      against tab contents (F10c)
- [ ] The vault/auth/cert-picker/downloads sheet lifecycles have executable
      verification — behavior-drivable under a test-scoped allowlist and/or
      isolated unit tests of an extracted `createSheetEntry` — such that no
      sheet in `menu-overlay.js` is verified by source-text presence alone
      (F14, F23)
- [ ] `manager.json` KDF parameters are validated on read with a ruled
      legacy-compat policy, and a fresh-profile bundle adopt forces recovery
      and admin key rotation before the profile is usable (F2, F8)
- [x] Prettier is enforced: `prettier --check .` is clean on `main` and runs in
      both CI definitions; the `renderer.js` line budget is re-based on the
      formatted size and both budgets still guard growth *(Flight 5, 2026-08-27)* (escalated from squawk 0039; Flight 5)
- [ ] All existing gates stay green throughout (suite, typecheck, lint;
      `npm run a11y` where UI pages are touched)

## Stakeholders

Maintenance mission — the stakeholders are keyboard-only users (criterion 1)
and the next mission's crew. N/A beyond that.

## Constraints

- Read the maintenance report's finding details before designing each
  flight's legs; the reviewers' `file:line` evidence and the Architect's
  roundtable rulings are load-bearing inputs.
- Flight 3's allowlist widening is **test-scoped, never default-on** — it
  touches the same secret-sheet gate Flight 2 hardens, so Flight 3 lands
  after Flight 2.
- No scope growth: F4 (MCP rate limiting) and the DOM harness (F13/F18/F16)
  are deliberately deferred; take the harness as a fifth flight only if
  the four scaffolded flights land early.
- Squawks 0016–0039 are completed on turnarounds, not folded into flights.

## Environment Requirements

- Local dev toolchain (Node 22+, Electron 43). Flights 1 and 3 need a live
  app boot for behavior-test runs (the two-agent Witnessed apparatus with an
  admin automation key); Flight 1 additionally needs an operator keyboard
  walk at its acceptance gate since OS-level focus transfer is only partly
  observable through the automation surface.

## Open Questions

- Flight 1: which gesture triggers chrome→guest focus entry (a dedicated
  key, Enter-in-address-bar after load, F6-style cycling), and how is
  "guest tab sequence exhausted" detected when Electron offers no native
  signal? Shift+Tab symmetry?
- Flight 3: allowlist widening vs `createSheetEntry` extraction — either,
  both, or extraction first?
- Flight 4: reject or repair out-of-bounds KDF params on read for legacy
  managers?

## Known Issues

- [ ] **Prettier enforcement needs a flight, not a squawk** — escalated from [squawk 0039](../../squawks/0039-prettier-drift-not-enforced.md) on 2026-08-27. `npm run format` reformats 318 files cleanly but pushes `renderer.js` from 1650 to 1829 lines (by the budget pin's metric) (repealing the line budget by accident) and breaks 13 mutation-testing pins in 9 test files. Decision owed: tune `.prettierrc` toward house style (likely a larger `printWidth`; measure first) vs. accept defaults and re-base the budgets + re-pin the matchers. The CI `format:check` wiring rides along either way. Operator ruling to enforce stands. **Planned 2026-08-27 as [Flight 5: Prettier Adoption](flights/05-prettier-adoption/flight.md)** — the spike showed option (a) is not achievable (Prettier has no setting that preserves one-line function bodies), so the operator chose (b): accept defaults, re-base the budgets.

## Flights

> **Note:** Ordered by the maintenance report's ruling: Critical first; the
> automation invariant before the sheet work it shares a gate with.

- [ ] Flight 1: **Keyboard reachability and omnibox semantics** — chrome↔guest
      focus handoff (F48 / #174; absorbs BACKLOG "Internal-page keyboard
      focus" + M08 H8) and cross-view omnibox suggestion semantics (F49)
- [ ] Flight 2: **Automation-surface internal-session invariant** — op-local
      internal refusals on `input.js` / three `observe.js` ops (F1), the
      vault-tool resolver predicates (F9), `download-media` `webContentsId`
      validation (F10c), and truing `docs/mcp-automation.md` (F10k)
- [ ] Flight 3: **Sheet lifecycle verification** — make the 17 unverified
      sheets in `menu-overlay.js` verifiable (F14) via a test-scoped
      `AUTOMATABLE_MENU_TYPES` widening and/or a `createSheetEntry`
      extraction with isolated unit tests (F23); closes with the
      menu-overlay / chrome-indicator CLAUDE.md subsection (F34, partial)
- [ ] Flight 4: **Vault trust-boundary hardening** — `validateImportedKdf`
      from `_readManager` with a legacy-compat ruling (F2); forced
      `rotateRecovery` + `rotateAdminKey` after a fresh adopt (F8)
- [x] Flight 5: **Prettier adoption** *(landed 2026-08-27 — PRs #182 + Leg 2)* — one-time reformat under the existing
      `.prettierrc`, `renderer.js` budget re-based 1650 → 1829 (measured by the
      pin's metric), the 12 broken source-text pins re-targeted without weakening, `format:check`
      wired into both CI definitions (escalated from squawk 0039; no
      dependency on Flights 1–4. Ordering is a rebase-cost question, not a
      conflict risk: land it while no other branch is open, and any branch
      opened before it merges re-runs `npm run format` after merging `main`
      instead of resolving 318 files of hunks. Two PRs, one per leg — DD4)
- [ ] Flight 6 *(optional, only if the others land early)*: **DOM harness for chrome
      controllers** — extend `tab-controller.test.js`'s factory-deps harness
      to `welcome-controller.js` (F13), extract `test/unit/helpers/fake-dom.js`
      (F18), pin `internal-preload.js` (F16)
