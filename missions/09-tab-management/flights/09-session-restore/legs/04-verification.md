# Leg: 04-verification

**Status**: completed
**Flight**: [Session Restore](../flight.md)

## Objective

Discharge the flight's verification: author the `session-restore` behavior spec, run the
premise-gated relaunch-harness probe (DD9), run the rig-independent gates on the final tree, retire
`tab-reorder` Step 4 now that the arm threshold is unit-pinned — and honestly HAT-scope everything
that needs the live rig this session does not have, carrying it to F10.

## Context

**Risk: HIGH — this leg AUTHORS the flight's assertions (F8 DD14 / F7 leg-4 lesson).** The
`session-restore` spec must assert the **right observables** (F8 product #2): the exact restored tab
set with correct jarIds **and burners POSITIVELY ABSENT**, not a bare "windows came back"; and the
**2-window menu-Exit** regression guard that survives the DD3 two-writer bug (a single-window E2E
would pass over it).

**DD9 (premise-gated apparatus).** The E2E relaunch cycle needs an out-of-band harness (the MCP
surface cannot self-relaunch). Probe first; **NO-GO → the unit/integration layer carries the
structural proof and the E2E cycle is HAT-scoped (F10), recorded honestly** — never a green spec
over an unproven cycle (F8/F5's lesson).

## Inputs

- The uncommitted legs 1–3 tree (suite **1948 pass / 0 fail / 0 skipped** at leg 3's end).
- Live rig (if available): `npm run dev:automation` (Wayland), the goldfinch admin MCP, an admin key.
  **Admin keys via env-var reference ONLY, never a command literal** (standing carry).
- `tests/behavior/tab-tearoff.md` (row 8a + the displaced-menu residual — the unrun HIGH-1 net).
- `tests/behavior/tab-reorder.md` (Step 4 — the cached-fiction `screenX === 564` coordinate).

## Acceptance Criteria

- [x] **AC1 — the `session-restore` behavior spec is authored** (`tests/behavior/session-restore.md`,
      status `draft`). Zephyr Action | Expected Result, Witnessed pattern. It asserts: after
      enable → open tabs across ≥2 jars **plus a burner** → clean quit → relaunch, `enumerateWindows`
      shows the saved window count and `enumerateTabs` shows the **exact** saved tab set with **correct
      jarIds**, the **burner tab POSITIVELY ABSENT**, and the saved active tab active; a **2-window
      menu-Exit** case restores **both** windows; **default-off** quit→relaunch restores nothing (one
      default window). It documents the **out-of-band relaunch harness** (in-band clean quit via the
      `windowClose` bridge; Bash relaunch + admin-MCP reconnect) and scopes **history + geometry OUT**
      (DD5). *(Asserts the right observable — F8 product #2 — and the DD3-bug regression guard.)*
- [x] **AC2 — the DD9 relaunch-harness probe is run and its GO/NO-GO recorded with evidence.** Probe
      whether this session can drive quit + relaunch + admin-MCP reconnect. **GO → run the spec.
      NO-GO → the spec is authored and its RUN is HAT-scoped (F10), the structural layer (legs 1–3)
      carries the proof, recorded honestly with the specific missing apparatus.**
- [x] **AC3 — `tab-reorder` Step 4 is retired (F8 debt, F9-owned).** It PASSES on `screenX === 564`,
      the cached fiction F8 refuted, so it is a guaranteed false green. The arm threshold it half-covered
      is now a **unit pin** (`shouldArm`, leg 1). **Delete Step 4 / mark it HAT**, recording that the
      threshold moved to the unit test and the coordinate reading is retired (not silently dropped).
- [x] **AC4 — the unrun HIGH-1 net (`tab-tearoff` row 8a + displaced-menu residual) is dispositioned.**
      It cannot run without the live rig. Record: the move-core fix now carries a unit-layer structural
      pin (`move-core-fix.test.js`, leg 1), and row 8a's live reading is **carried to F10** (booked to
      the clean re-run `tab-tearoff` already owes). Do **not** claim it ran.
- [x] **AC5 — final-tree gates, honestly.** `npm test`, `npm run lint`, `npm run typecheck` — each
      **standalone**, on the full legs 1–3 tree; state the count. **`npm run a11y`:** run it and record
      the reading truthfully — if it yields no verdict for lack of the admin key/live GUI (the mission
      Known Issue: exit-code discrimination zero), **say so; do NOT claim a11y green** (F8 Rec 1). The
      settings.html change is a **labeled checkbox** (structurally a11y-safe); the authoritative a11y run
      is F10's. **The commit message may claim only what was measured on this tree.**

## Out of Scope

- The live E2E restore run, row 8a, and the real a11y verdict — HAT-scoped (F10) on the DD9 NO-GO.
- Any code change to `main.js`/`renderer.js` — legs 1–3 own the implementation; this leg verifies + docs.
- Crash recovery, navigation history, window geometry — DD5/DD6.

## Verification Steps

1. Behavior evidence is ephemeral and never committed; only the spec + (if run) the run log live in-repo.
2. State plainly in the flight log which readings were **measured** this session vs. **carried to F10**.
3. `git status --porcelain` — only the intended artifacts; no `session.json`; no stray files.

## Files Affected

- `tests/behavior/session-restore.md` (new) — the behavior spec (AC1).
- `tests/behavior/tab-reorder.md` (modified) — Step 4 retirement (AC3).
- Flight log — the DD9 probe result, gate readings, and the F10 carry (AC2/AC4/AC5).

---

## Post-Completion Checklist

- [ ] All acceptance criteria verified (measured vs. F10-carried stated honestly)
- [ ] Update flight-log.md with the Leg 4 entry
- [ ] Set this leg's status to `completed`
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit (flight-end review + single commit per `/agentic-workflow`)
