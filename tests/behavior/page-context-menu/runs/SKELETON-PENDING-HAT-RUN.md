# Behavior Test Run: page-context-menu — SKELETON (PENDING HAT RUN)

> **SKELETON — DO NOT TREAT AS A RESULT.** Pre-written by the Leg-6 deterministic pass (PART D setup) to
> reduce friction for the operator-driven `hat-and-alignment` (HAT) leg. **It records no verdicts.** The
> live HAT run must: rename this file to the real `{ts}` timestamp (`YYYY-MM-DD-HH-MM-SS.md`), fill every
> `<TODO>`, set the per-row dispositions, and — on a green run of all 12 runnable rows — flip the spec
> header `**Status**: draft → active` (AC9 / DD5). Delete this skeleton once the real run log lands.

**Spec**: [tests/behavior/page-context-menu.md](../../page-context-menu.md)
**Status**: <TODO: pass | fail>
**Started**: <TODO ISO timestamp>
**Completed**: <TODO>
**Duration**: <TODO>
**Mode**: scripted live integration smoke (leg-permitted) OR Witnessed `/behavior-test page-context-menu`.
**Apparatus**: Goldfinch MCP automation surface (loopback), **admin** key (the custom `#page-context-menu`
is read on the chrome `getChromeTarget()` `wcId`). The `chrome-devtools` MCP does NOT qualify.
**Driver**: <TODO — not committed>

## Summary

<TODO: N / 12 judged checkpoints. Per the Leg-6 DD5 disposition plan, ALL 12 steps are RUN-GREEN-HERE on
the WSLg admin apparatus — the chrome DOM (`#page-context-menu`) is readable via `readDom(chromeWcId)` /
`readAxTree` / `captureWindow` on the chrome `wcId`. Pixel-feel, macOS native-suppression, and
Inspect→DevTools materialization are the spec's existing Out-of-Scope — not run here, NOT per-row
INCONCLUSIVE.>

## Environment

- App: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` (WSLg, X11/`:0`).
- MCP server **bound port <TODO>** (capture live; do NOT hardcode 49707).
- Target page: <TODO `https://example.com/` (link+selection) and/or an all-targets fixture / `data:` doc
  for image+editable>.

## Step Results (per-row disposition — DD5)

### Step 1 (active-precondition probe) — <TODO>
- **Disposition**: RUN. tools/list presence + numeric chrome `wcId`. <TODO raw + verdict + evidence>

### Step 2 (open page + locate targets) — SETUP
- **Disposition**: RUN (setup). captureWindow coordinates. <TODO>

### Step 3 (right-click link → menu render) — <TODO>
- **Disposition**: RUN. `#page-context-menu` visible (`.hidden` absent) with Open-link / Copy-link +
  Inspect; native menu absent (negative observable); `role="menu"`/`menuitem`. <TODO raw + verdict + evidence>

### Step 4 (right-click image → image section) — <TODO>
- **Disposition**: RUN. Open-image / Copy-image-address / Save-image + Inspect. <TODO>

### Step 5 (select text → selection section) — <TODO>
- **Disposition**: RUN. Copy + Search-for-"…" + Inspect (programmatic selection via `evaluate` if needed). <TODO>

### Step 6 (right-click editable → editable section, editFlags-gated omit) — <TODO>
- **Disposition**: RUN. editFlags-gated actions present; falsy-flag items **omitted**, not disabled. <TODO>

### Step 7 (cursor position mapping) — <TODO>
- **Disposition**: RUN. menu top-left ≈ click point mapped through webview rect + viewport clamp. <TODO>

### Step 8 (keyboard nav + focus return) — <TODO>
- **Disposition**: RUN. Arrow/Home/End rove `menuitem` focus; Escape closes (`.hidden` back) + focus not
  stranded on `<body>`. `[a11y]` <TODO>

### Step 9 (Shift+F10 / ContextMenu chrome-focused → Inspect-only) — <TODO>
- **Disposition**: RUN. Inspect-only menu anchored at the focused chrome element. `[a11y]` <TODO>

### Step 10 (no-op on internal `goldfinch://settings`) — <TODO>
- **Disposition**: RUN (negative observable). Menu stays `.hidden` (behind the `!__goldfinchInternal`
  guard). <TODO>

### Step 11 (toolbar Unpin opens custom menu) — <TODO>
- **Disposition**: RUN. Single "Unpin {Media|Shields|DevTools}" `cm-item role="menuitem"`; in-DOM custom
  menu, NOT native Electron. `[a11y]` <TODO>

### Step 12 (Unpin activate + persist) — <TODO>
- **Disposition**: RUN. Button gets `.hidden` live; `settings.json` `toolbarPins.{item} === false`
  (filesystem); settings pin toggle `aria-pressed="false"` live; focus lands on `#address`. <TODO>

## Orchestrator Notes

- <TODO: mode + bound port; confirm the menu reads came off the chrome `getChromeTarget()` `wcId`, not a
  separate browser; the jar-key `getChromeTarget` admin-only refusal if exercised.>

## Evidence

Ephemeral (NOT committed): `/tmp/behavior-tests/goldfinch/page-context-menu/<TODO ts>/` — <TODO>.

## Disposition

<TODO: on a green run of all 12 rows, flip `page-context-menu.md` `**Status**: draft → active` and set its
`**Last Run**`. Out-of-Scope items (pixel feel, macOS native-suppression, Inspect→DevTools
materialization) are HAT/macOS-authoritative — not run here, not per-row INCONCLUSIVE.>
