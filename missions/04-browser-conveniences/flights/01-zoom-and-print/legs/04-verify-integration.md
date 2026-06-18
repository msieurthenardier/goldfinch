# Leg: verify-integration

**Status**: completed (Part A docs+regression; Part B behavior tests + a11y live-verified; Part C native-print operator-confirmed + internal-tab steps HAT-confirmed — see flight-log + `hat-and-alignment`)
**Flight**: [Core Conveniences — Zoom & Print](../flight.md)

## Objective

Close the flight: update the user/agent docs for the new zoom & print surface, sweep for regressions, then run the acceptance gate — the `page-zoom` and `print-to-pdf` behavior tests on the live automation surface under the **admin** key, the a11y gate, and the **manual** native-print → Save-as-PDF check.

## Context

- This leg **owns the docs updates** for the whole flight (per the flight plan): README keyboard-shortcuts table and `docs/mcp-automation.md` (legs 1–3 deliberately did NOT touch docs).
- The acceptance gate is two behavior tests already drafted during flight planning: `tests/behavior/page-zoom.md` and `tests/behavior/print-to-pdf.md`. The Flight Director runs them via `/behavior-test {slug}` (not a Developer agent) — the run skill orchestrates its own Executor + Validator crew (Witnessed pattern).
- **Admin key requirement**: `page-zoom` step 7 exercises the DD3 op-local internal guard, which only fires under the **admin** key (a jar key is refused generically by the façade and leaves the guard untested). The run must use the env-gated admin key.
- **DD1 finding carried from leg 1**: zoom is **per-origin-per-session**, not per-tab. The asserted invariant is **no cross-JAR leak** (`page-zoom` step 6) — same-origin tabs in the *same* jar are *expected* to share a level. The `page-zoom` spec already frames it this way (it defers the same-jar model); confirm the spec text matches the finding before running.
- **SC2 is manual** (OS-native dialog, outside the apparatus). On WSLg with no CUPS printer the dialog may not open and a `print failed:` warning is logged instead (leg 3) — in that case the **automation `printToPDF` path is the printer-independent proof** that PDF generation works (decode base64 → `%PDF-`).

## Inputs
- Legs 1–3 landed (uncommitted) on `flight/01-zoom-and-print`: zoom keyboard+chip, `getZoom`/`setZoom`, native print + `printToPDF`. `npm test` green at 802 (post-leg-3).
- `tests/behavior/page-zoom.md` and `tests/behavior/print-to-pdf.md` (draft specs from planning).
- `README.md:141-150` — the `## Keyboard shortcuts` table (currently `Ctrl+T/W/L/M`, `Ctrl+Shift+P`, `Ctrl+R`).
- `docs/mcp-automation.md` — the docs were last updated at **21 tools**; the new total is **24** (15 drive + 6 observe + 2 devtools + 1 chrome, per `mcp-tools.js:475-476`). Stale count/enumeration spots to bump:
  - `:19` (Overview) — `**21 tools** — 12 drive tools, …` → **24** / **15 drive**.
  - `:322` (Tool reference intro) — `All 21 tools below …` → **24**.
  - `:326` — `### Drive tools (12)` heading → **(15)**; the drive-tool table starts `~:334` (`navigate` row).
  - `:289-291` — the jar-scoped tab-targeting op list (ops a jar key refuses out-of-jar); add `getZoom`/`setZoom`/`printToPDF` (they resolve via the same `resolveContents`/façade path).
  - `:421-425` — refusal-semantics split (void `{"ok":true}` vs real return value); the three new ops are **real-return-value** (`getZoom`/`setZoom` → `{factor}`, `printToPDF` → base64 string) — add them to the real-return list, NOT the void list.
- Automation apparatus: `npm run dev:automation` + loopback MCP; admin key via the `AUTOMATION_DEV_MINT` mechanism (`docs/mcp-automation.md:111`). `npm run a11y` for the accessibility gate.

## Outputs
- Updated `README.md` (zoom + print shortcuts) and `docs/mcp-automation.md` (3 new tools + bumped counts).
- `tests/behavior/page-zoom/runs/{ts}.md` and `tests/behavior/print-to-pdf/runs/{ts}.md` run logs (committed).
- Flight-log entries: behavior-test verdicts (with run-log paths), a11y result, manual-print disposition.
- `page-zoom.md` / `print-to-pdf.md` specs flipped `draft → active` once green.

## Acceptance Criteria

### Part A — Docs + regression (autonomous; a Developer agent does this)
- [ ] `README.md` `## Keyboard shortcuts` table gains rows for **`Ctrl +` / `Ctrl -` / `Ctrl 0`** (zoom in / out / reset — page content) and **`Ctrl+P`** (print / save as PDF). Keep the existing table style; a brief note that zoom shows a chip when ≠ 100% and that these apply to web content (not `goldfinch://` pages) is welcome but optional.
- [ ] `docs/mcp-automation.md` drive-tool table gains rows for **`getZoom`** (`{ wcId }` → `{"factor":n}`), **`setZoom`** (`{ wcId, factor }` → applied `{"factor":n}`, clamped `[0.25,5.0]`), and **`printToPDF`** (`{ wcId }` → base64 PDF as JSON text). All the count/enumeration spots above are corrected: total **21→24**, `### Drive tools (12)`→**(15)**, the three ops added to the jar-scoped op list (`:289`) and the **real-return-value** refusal list (`:422`). No stale "21"/"12" left. The **internal-refusal** note for the three ops follows the doc's house style — a short per-section security callout (matching the eval/devtools internal-exclusion blockquotes at `~:366`/`~:393`), **not** crammed into a table cell. **Stay strictly scoped to the zoom/print ops** — do NOT backfill the pre-existing Flight-9 eval/devtools omissions in those lists (separate cleanup; avoid scope creep).
- [ ] Regression sweep: `npm test` (full) green; `npm run lint` and `npm run typecheck` clean. Identify the unit specs touching the keydown / before-input-event / toolbar / automation-input surface and confirm none regressed (they were updated in-leg; this is a final cross-check).

### Part B — Live acceptance gate (Flight Director runs; needs the running app + admin key)
- [ ] `/behavior-test page-zoom` run under the **admin** key → **pass** (baseline `getZoom`+`devicePixelRatio`; `Ctrl+=`×2 to the guest via `before-input-event`; `Ctrl+0` reset; `setZoom(1.5)`; second jar no cross-jar leak; internal tab refused by the op-local guard under admin). Run log committed; verdict + path in the flight log. A fail is an unmet criterion — fix in a new commit and re-run, OR record an operator-accepted disposition.
- [ ] `/behavior-test print-to-pdf` → **pass** (`printToPDF` base64 decodes to `%PDF-`; internal tab refused by the jar façade). Run log committed; verdict + path in the flight log.
- [ ] `npm run a11y` clean — no new WCAG A/AA violations from the zoom chip or the kebab Print… item (the leg-1/leg-3 deferred a11y check is satisfied here, on a host with a display).

### Part C — Manual (operator)
- [ ] Manual native-print check: `Ctrl+P` / kebab **Print…** on a web page opens the OS print dialog, and **Save as PDF** produces a file — OR, on a no-printer WSLg host, the `print failed:` warning is logged (no crash) and the **`printToPDF` automation path** (Part B) stands as the printer-independent PDF proof. Disposition recorded in the flight log.

## Verification Steps
- `git diff README.md docs/mcp-automation.md` — new shortcut rows + 3 tool rows + bumped counts present; no stale counts.
- `npm test` / `npm run lint` / `npm run typecheck` — all green.
- `/behavior-test page-zoom` (admin key) and `/behavior-test print-to-pdf` — both pass; run logs exist under `tests/behavior/*/runs/`.
- `npm run a11y` — clean.
- Operator confirms the manual print disposition.

## Implementation Guidance

1. **Docs (Developer)** — edit the README shortcuts table and `docs/mcp-automation.md`: the drive-tool table (+3 rows, match the `| tool | args | result |` style at `:334`), the `### Drive tools (12)`→**(15)** heading, the `:19` Overview count (`21 tools — 12 drive`→`24 … 15 drive`), the `:322` intro (`All 21 tools`→`24`), the jar-scoped op list (`:289`), and the real-return-value refusal list (`:422`). `grep -n '\b21\b\|\b12\b\|getZoom\|setZoom\|printToPDF' docs/mcp-automation.md` to confirm no stale count remains. Internal-refusal note as a short callout (eval/devtools blockquote style), not a table cell. Do not touch the Flight-9 gaps.
2. **Regression sweep (Developer)** — run the full suite; `git grep -l "before-input-event\|keydown\|zoom\|pressKey" test/` to list the touched specs and eyeball that they pass and assert the intended new behavior.
3. **Behavior tests (Flight Director, after Part A lands)** — before running, confirm preconditions per each spec's Preconditions block: app up via `npm run dev:automation`, admin key minted (`AUTOMATION_DEV_MINT`), `setZoom`/`getZoom`/`printToPDF`/`evaluate` present in the tool list, `pressKey` can emit `=`/`-`/`+` (leg 1). Then `/behavior-test page-zoom` and `/behavior-test print-to-pdf`. Record verdicts + run-log paths in the flight log; flip the specs `draft → active` on green.
4. **a11y + manual print** — run `npm run a11y` on a host with a display; perform (or have the operator perform) the manual print check; record dispositions.

## Edge Cases
- **Spec ↔ finding mismatch**: if `page-zoom`'s step text still implies per-tab isolation anywhere, fix the spec to the per-origin-per-session / no-cross-jar framing before running (DD1 leg-1 finding).
- **a11y can't run headlessly**: it needs a display; if unavailable in the autonomous environment, Part B/C run where a display exists. Do not mark the gate passed on an un-run a11y.
- **Behavior test fails on WSLg drive flakiness**: per the flight's Adaptation Criteria, if `before-input-event` can't be driven reliably on WSLg, fall back to asserting keyboard manually in HAT and drive the engine path via `setZoom` only — record the deviation.
- **Admin key absent**: without it, `page-zoom` step 7 can't exercise the op-local guard. Do not silently skip — either obtain the key or record the step as operator-deferred with rationale.

## Files Affected
- `README.md` — keyboard-shortcuts table (zoom + print).
- `docs/mcp-automation.md` — drive-tool table (+3 rows), `(12)`→`(15)`, op-list consistency.
- `tests/behavior/page-zoom.md`, `tests/behavior/print-to-pdf.md` — `draft → active` on green (and any spec-text fix for the DD1 framing).
- `tests/behavior/page-zoom/runs/{ts}.md`, `tests/behavior/print-to-pdf/runs/{ts}.md` — NEW run logs (committed).
- `flight-log.md` — verdicts, a11y, manual-print disposition.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified (Parts A–C; live parts may be operator/HAT-gated)
- [ ] Tests passing (unit + behavior + a11y)
- [ ] Update flight-log.md with leg progress entry (behavior-test verdicts + run-log paths, a11y, manual disposition)
- [ ] Set this leg's status to `landed`
- [ ] Check off this leg in flight.md (deferred to flight-end commit)
- [ ] This is the last **autonomous** leg — the flight-end Reviewer pass + single commit follow (Flight Director); `hat-and-alignment` is the optional operator-driven close.
