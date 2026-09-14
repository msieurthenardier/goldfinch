# Leg: chromium-generalization

**Status**: completed
**Flight**: [Chromium Family Breadth](../flight.md)

## Objective

Stop telling the operator "Chrome" when the export could be from any Chromium
browser: generalize the browser-import UI's user-facing copy and the docs to the
Chromium family (generalized guidance, no source picker — DD2), and pin that the
existing pipeline accepts the Edge-shaped (identical) header. No logic change —
the detector already passes an Edge export because its header equals Chrome's
(DD1).

## Context

- **Charter: DD1, DD2, DD3** (flight.md). A real Edge export is byte-identical to
  Chrome's (verified at planning), so the parser/adapter/dedupe/commit are
  unchanged; this leg is copy + docs + a header-acceptance test. No source
  picker, no `summary` source field, no per-browser instructions (DD2). The
  `blocklist` reason stays dormant (DD3).
- Leg 1 (restore-modal-extraction) is landed; it did NOT touch
  `vault-browser-import-controller.js`, `browser-import.js`,
  `browser-import-flow.js`, or `docs/vault.md`, so those citations are current.
- **The internal detector name `detectChromeExport` / `CHROME_HEADER` is NOT
  renamed** (DD2 makes the rename an "acceptable variation"; it is internal,
  never user-facing, and renaming is churn across consumers + tests with zero
  operator benefit). This leg generalizes only what the OPERATOR sees + docs.
  Verified 2026-09-14.

## Leg-Level Design Rulings

1. **User-facing string generalization** (the only two the operator reads,
   `vault-browser-import-controller.js`):
   - `:54` refusal — "That file isn't a Chrome password export." →
     browser-generic, e.g. "That file isn't a recognized browser password
     export."
   - `:91` guidance lede — "In Chrome, open the password manager
     (chrome://password-manager), open Settings, and choose Export passwords…" →
     browser-generic Chromium guidance WITHOUT per-browser steps, e.g. "In your
     browser's password manager (Chrome, Edge, and other Chromium browsers),
     open Settings and choose Export passwords, which saves a CSV file. Choose
     that file here." Keep it `textContent`-only; the completion modal's
     "Delete the exported CSV file now" line is already source-agnostic — leave
     it.
2. **Internal comments** at `browser-import-flow.js:60` ("Pick a Chrome
   password-export CSV…") and `vault-browser-import-controller.js:78`
   ("Chrome-export guidance lede") generalize to "browser"/"Chromium" for
   accuracy — not user-facing but keeps the code honest.
3. **Header-acceptance unit test** (`browser-import-adapter.test.js` or the flow
   test): assert `detectChromeExport` accepts the EXACT Edge header
   (`name,url,username,password,note`, identical to Chrome) without throwing —
   pinning DD1's "Edge comes in on the same detector" claim — and that the
   generalized refusal copy is what a bad header yields via the flow's error
   mapping (the `errorMessage('unrecognized-format')` path now returns the
   browser-generic string).
4. **Docs** (`docs/vault.md`): the "### Browser import (Chrome)" heading (`:541`)
   → "### Browser import (Chromium browsers)"; the Chrome-specific prose at
   `:544-545` (`chrome://password-manager`), `:556` ("Chrome-export detector"),
   `:608` ("Chrome already wrote"), and the threat-model line `:758` ("A Chrome
   …") generalize to the Chromium family — keeping the accurate mechanism (the
   detector still keys on the specific header; note it is the header the
   Chromium family shares). `CLAUDE.md`'s `**Browser import (Chrome CSV, M19
   F1).**` bullet → "Chromium CSV" / "Chromium browsers", noting Edge verified
   format-identical (M19 F2).
5. **Grep-AC (targeted, never bare `grep -ri chrome`)** — goldfinch's own
   window-"chrome" naming (`byChrome`, `chromeId`, `windowForChrome`,
   `getChromeTarget`) pervades `src/main/vault/` and is unrelated. After this
   leg:
   `grep -nE "Chrome password export|chrome://password-manager|In Chrome,|Chrome-export" src/renderer/pages/vault-browser-import-controller.js docs/vault.md`
   → zero hits. (CLAUDE.md:262's closed-tab "Chrome's per-window reopen" and
   docs `getChromeTarget` at `:615` are unrelated window-chrome references —
   NOT in scope.)

## Inputs

- `src/renderer/pages/vault-browser-import-controller.js` — `:54` refusal, `:91`
  guidance lede, `:78` comment (unchanged by leg 1).
- `src/main/vault/browser-import-flow.js` — `:60` comment.
- `src/main/vault/browser-import.js` — `detectChromeExport` / `CHROME_HEADER`
  (unchanged; the test asserts acceptance).
- `docs/vault.md` — the Browser-import section (`:541-615`, `:758`).
- `CLAUDE.md` — the M19 F1 Browser-import bullet.
- Green bar at leg start: 4433 tests, typecheck, lint, format clean (post-leg-1).

## Outputs

- Modified: `src/renderer/pages/vault-browser-import-controller.js` (2 strings +
  1 comment), `src/main/vault/browser-import-flow.js` (1 comment),
  `docs/vault.md` (heading + mentions), `CLAUDE.md` (bullet).
- Modified/new test: the header-acceptance + generalized-refusal assertions.
- `flight-log.md` leg entry; flight.md leg checkbox (at flight commit).

## Acceptance Criteria

- [x] AC1 The refusal and guidance-lede strings in
      `vault-browser-import-controller.js` are browser-generic (name Chrome,
      Edge, and Chromium browsers, not Chrome alone); no per-browser step-by-step
      guidance; `textContent`-only.
- [x] AC2 A unit test asserts `detectChromeExport` accepts the exact Edge header
      (identical to Chrome) without throwing, and that the flow's
      `unrecognized-format` maps to the new browser-generic refusal copy.
- [x] AC3 `docs/vault.md`'s Browser-import heading + mentions and CLAUDE.md's
      bullet read "Chromium browsers" (Edge noted format-identical, M19 F2);
      the accurate detector mechanism (header-keyed) is preserved in the prose.
- [x] AC4 The targeted grep-AC (ruling 5) returns zero hits; the unrelated
      window-"chrome" references are untouched.
- [x] AC5 Full green bar — `npm test`, `npm run typecheck`, `npm run lint`,
      `npm run format` then `format:check` — all clean; no pre-existing suite
      regressed.
- [x] AC6 `flight-log.md` leg entry; leg `landed`.

## Verification Steps

- AC1/AC4: the ruling-5 grep; read the two strings.
- AC2: `node --test --test-timeout=60000 test/unit/browser-import-adapter.test.js test/unit/browser-import-flow.test.js`.
- AC3: read the docs sections + the CLAUDE.md bullet.
- AC5: the four green-bar commands.

## Edge Cases

- **Do NOT touch the detector logic or `CHROME_HEADER`** — the header is
  genuinely the shared Chromium format; the test proves Edge passes. Renaming is
  out of scope (ruling context).
- **Do NOT introduce a source field/picker** (DD2) — the summary/flow/report
  stay source-blind.
- **Unrelated "chrome"** — leave every window-"chrome" reference
  (`byChrome`/`chromeId`/`windowForChrome`/`getChromeTarget`, CLAUDE.md:262)
  untouched.

## Files Affected

- `src/renderer/pages/vault-browser-import-controller.js`,
  `src/main/vault/browser-import-flow.js`, `docs/vault.md`, `CLAUDE.md`, the
  browser-import test file(s), `flight-log.md`.

## Citation Audit

The controller strings (`:54`, `:91`), the flow comment (`:60`), the docs
mentions (`:541,:544-545,:556,:608,:758`), and the CLAUDE.md bullet verified
2026-09-14 post-leg-1 (leg 1 did not touch these files). `detectChromeExport` /
`CHROME_HEADER` at `browser-import.js:65,:25`.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed` (in this file's header)
- [x] Check off this leg in flight.md
- [ ] If final leg of flight: update flight.md status to `landed`, check off flight in mission.md
- [ ] Commit all changes together (code + artifacts)
