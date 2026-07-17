# Leg: 05-verification

**Status**: landed
**Flight**: [Tear-off and Cross-Window Drag](../flight.md)

## Objective

Take the runtime readings legs 3 and 4 could not, discharge the flight's owed behavior
runs, and clear the F7 artifact debt — **without verifying cross-window drag, which is
deferred and whose synthetic test would pass over a broken feature.**

## Context

**Risk: HIGH (DD14) — a leg that authors the flight's assertions is HIGH-risk even
writing no product code.** F7's leg 4 authored the `getHistory` gate and shipped the
flight's worst defect.

**Legs 3 and 4 declined to tick eight ACs** because their readings are runtime and **this
repo has no DOM or main-process harness** (bare `node --test`, no jsdom; `main.js` is
never executed, only read). They pinned code shape and said so. **This leg owns those
readings** — it is the first leg with a live rig.

> **The observability half of the premise audit was skipped at flight design.** The
> `/flight` skill warns: *"can the apparatus OBSERVE, through an existing surface,
> everything the acceptance criteria must assert?"* — and that it surfaces as a
> mid-flight scramble. It did. Legs 3-4 handled it correctly by declining; this leg is
> the bill.

## Inputs

- Live rig: `npm run dev:automation` (Wayland). **Bind-probe for a free port** — `ss -ltn`
  cannot see WSL2 ports held by Windows-side listeners.
- A live sibling Goldfinch may hold the default profile's port. **Leave it untouched.**
- The committed `tests/behavior/fixtures/tabstrip/` set.
- **Admin keys via env-var reference ONLY, never a command literal** (standing carry).
- Suite: **1892 pass / 0 fail** at leg 4's end.

## Acceptance Criteria

- [x] **AC1 — the new `tab-tearoff` spec is authored, run, and GREEN.** Zephyr-style
      Action | Expected Result, Witnessed pattern (Executor + independent Validator), run
      via `/behavior-test`. It covers: drag a tab below the strip → release → **a new
      window exists**; the torn-off tab has the **same wcId** (no destroy/recreate), the
      **same jar pill**, and **live history** (`goBack` works); the source strip closes
      ranks; sole-tab and internal-tab drags are **refused and announced**.
      **This discharges leg 3's AC11 and leg 4's AC7 — DD2's claim and the mission's
      absolute constraint, which NOTHING in the flight currently proves.**
- [x] **AC2 — the spec does NOT verify cross-window drag, and SAYS WHY in its own text.**
      **This is the leg's most important negative.** V5 measured that synthetic
      coordinates are **never clipped** — so a synthetic cross-window test **runs and goes
      GREEN** while driving a handoff through **fiction-space** that a human misses by
      **1353px**. **A passing test over a broken feature is worse than no test**: it
      promotes an S1 silent success into the regression net. The spec states the gap and
      its reason; it does not verify a reachable subset and read as though it covered the
      feature. *(This is `multi-window-shell`'s lesson — a green spec over a real bug —
      caught **before** it ships rather than after.)*
- [x] **AC3 — the keyboard cross-window move is verified live.** "Move to window …" moves
      the tab A→B; **same wcId, jar intact, history intact**; a window closing between menu
      build and dispatch **refuses and announces**, tab unmoved. **This carries the mission
      criterion's surviving substance and is the only live proof of it.**
- [x] **AC4 — `multi-window-shell` clean re-run (OWED from F7).** Its two errata are
      confirmed folded; F7 filed the run `partial` and recorded the clean re-run as owed at
      this spec's next touch. **F8 is that touch.** Run it as written; **no repairs**.
- [x] **AC5 — `tab-reorder` green (the F2 regression net).** Leg 3 changed the arm
      threshold (`Math.abs(dx)` → `Math.hypot(dx, dy)`) and added a zone model. **This is
      the spec that proves in-strip reorder still works.**
- [x] **AC6 — `tab-context-menu` green.** Leg 4 adds items to it.
- [x] **AC7 — `npm run a11y` GREEN, and its red is DISAMBIGUATED.** Owed since leg 3.
      **The script exits 1 on a MISSING ADMIN KEY, not on a violation** — so its red has
      **discrimination zero** between "not configured" and "a11y is broken". Run it with
      the key. **Record both readings**: with the key → the real verdict; without → the
      *same* exit code. → maintenance item: the script must exit distinguishably.
      Leg 4 seeded the audit hook so it renders the new menu item — **without that it would
      have reported clean on a menu missing the item type entirely** (a vacuous pass).
- [x] **AC8 — the leaked-wrapper scan is REPO-WIDE.** The F7 debrief scoped this to "delete
      2 lines" in `legs/02-live-defect-fixes.md`. Recon found **3 more** in mission 03
      (`flights/08-production-gating-and-isolation/flight.md` and its `flight-log.md`), and
      **the FD reproduced the defect while writing this flight's own log** — minutes after
      reading the item. **It is a failure mode of the writing apparatus, not a slip**, and
      a two-line delete would have left three instances live. Scan `missions/**`; scrub all.
- [x] **AC9 — the stale-header scrub is REPO-WIDE: 10 specs, not 3 (DD12).** Every spec
      carrying `Last Run: never` **over a genuine run log**: `internal-session-exclusion`,
      `chrome-guest-keyboard-nav`, `internal-tab-menus`, `mcp-loopback-origin-guard`,
      `observe-refusal-contract`, `page-context-menu`, `spellcheck`, `mcp-drive-end-to-end`,
      `foreground-to-act`, `tab-surface-geometry`. Plus `kebab-menu`'s stale **date**
      header. **Verify each before editing** — the count is DD12's, and DD12 exists because
      an earlier count was a proxy.
- [x] **AC10 — the AC27 record is corrected.** The F7 debrief asserts *"3 have never run at
      all"*; **all five specs have genuine run logs** — it read the `Last Run:` header (a
      proxy) instead of the `runs/` directory (the artifact). Its set of five was also a
      proxy (its own leg-1 deferral subset): `b2d3afc` touched **14** specs, **12** with no
      post-F7 run. Correct the record **in the F7 debrief**, annotated at the item — **do
      not rewrite its body** (an inspection record is a snapshot).
- [x] **AC11 — the `renderer.js` kebab comment: four → six.** `kebabModel` has **6** ids;
      the comment names **4**, missing `new-window` and `jars`. **The count pattern's only
      instance in product source.** Verify the current ids before writing the number.
- [x] **AC12 — gates green.** `npm test` (state the delta), `npm run lint`, `npm run
      typecheck`, `npm run a11y` — each **standalone** (`grep -c` exits 1 on zero and
      silently breaks `&&` chains).

## Out of Scope

- **Cross-window drag verification** — AC2 forbids it.
- The 11 re-pointed specs with no post-F7 run (`closed-tab-reopen`,
  `find-overlay-geometry`, `foreground-to-act`, `internal-tab-menus`, `kebab-menu`,
  `menu-dismissal`, `menu-overlay`, `omnibox-suggestions`, `page-context-menu`,
  `popup-jar-inheritance`, `tab-cycling`) — **owned by F10 by construction** (DD12); it
  walks every mission behavior test with the operator. **F8 must record in the mission
  that it added them to that walk.**
- `getAttachedWindow`/`crossWindow` retirement — DD13, maintenance.

## Verification Steps

1. Every behavior run files a run log at the project's configured location; **evidence is
   ephemeral and never committed**.
2. A spec that needs repairs mid-run is **filed `partial`**, and the clean re-run is
   **recorded as owed with an owner** — not waved through. *(That is exactly how F7's
   `multi-window-shell` debt reached this leg, and the discipline is why it was payable.)*
3. `git status --porcelain` — clean.
