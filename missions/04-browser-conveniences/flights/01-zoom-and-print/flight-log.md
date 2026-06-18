# Flight Log: Core Conveniences — Zoom & Print

**Flight**: [Core Conveniences — Zoom & Print](flight.md)

## Summary

Flight in execution via `/agentic-workflow`. Log entries appended during execution.

---

## Flight Director Notes

- **2026-06-18 — Kickoff.** Flight flipped `ready` → `in-flight`. Branch `flight/01-zoom-and-print`
  cut from `main` (head `f0ad115`). Phase file `leg-execution.md` loaded and validated (Crew /
  Interaction Protocol / Prompts present; Developer=Sonnet, Reviewer=Sonnet). Planning artifacts
  (mission 04, flight 01, `page-zoom`/`print-to-pdf` specs, BACKLOG seed) committed as a planning
  baseline before any implementation. Execution model: per-leg design review (Developer), batch
  implement (4 autonomous legs), single Reviewer pass + commit at flight end; `hat-and-alignment`
  is the operator-driven optional close.

- **2026-06-18 — Live verification (leg 04 Part B) + apparatus deviation.** The formal `/behavior-test`
  apparatus expects the goldfinch MCP surface to be a **registered session MCP**; it is not registered
  in this Claude Code session and can't be added mid-session (no reload). Per operator decision ("drive
  it now autonomously"), the Flight Director drove the live gate via goldfinch's **own example MCP
  client over Bash** (`scripts/lib/mcp-client.mjs`) — a script-driven **Executor** agent reported raw
  observations and the **Flight Director rendered Validator verdicts** (Witnessed act/judge split
  preserved within the infra constraint). Env note: the WSLg loopback default port **49707 is held by
  an external Windows service** (NVDisplay.Container) → the env-pinned strict bind fails; ran on **49801**
  instead (the example client + `npm run a11y` honor `GOLDFINCH_MCP_PORT`/`GOLDFINCH_MCP_URL`).
  - **Live verdicts (admin key):** `listTools` = 24 (getZoom/setZoom/printToPDF/evaluate present). page-zoom
    S2–S6 **PASS** (baseline 1.0 → `Ctrl+=`×2 → 1.25 dpr 1.25, confirming the `before-input-event` guest
    capture works live → `Ctrl+0` → 1.0 → `setZoom(1.5)` → 1.5; second tab in jar "work" stayed 1.0 while
    tab1 held 1.5 = **no cross-jar leak**). print-to-pdf S2 **PASS** (14674-byte payload, `%PDF-1.4` …
    `%%EOF`, base64 plain text). **a11y exit 0, 0 new violations**, nothing on `#zoom-chip`/`#kebab-print`
    (satisfies the gate deferred from legs 1 & 3).
  - **Internal-refusal steps not live-reachable** (page-zoom S7, print-to-pdf S3): the automation surface
    structurally cannot obtain a `goldfinch://settings` wcId (`openTab` → null, `enumerateTabs` filters
    internal) — which is itself the boundary working. The op-local internal guards are unit-proven (legs
    2/3); live confirmation deferred to HAT (where a human opens settings out-of-band). Spec-quality note
    recorded for those steps.

- **2026-06-18 — SC8 fix re-confirmed live (post leg-05).** Under a **default-jar key**, `getZoom` →
  `{factor:1.5}`, `setZoom(1.5)` → applied `1.5`, `printToPDF` → valid `%PDF-1.4` (14674 bytes) on the
  jar's **own** tab (no more `not a function`); an **out-of-jar** wcId returns the clean
  `automation: out-of-jar — wcId 4 does not belong to jar default` refusal. **SC8 jar-scoped parity is
  restored and verified live.** Committed run logs: `tests/behavior/page-zoom/runs/2026-06-18-16-49-55.md`,
  `tests/behavior/print-to-pdf/runs/2026-06-18-16-49-55.md`; both specs flipped `draft → active`.

- **2026-06-18 — Verdict before flight-end review.** SC1 **met** (live page-zoom S2–S6). SC2 **met for the
  automation path** (valid PDF via `printToPDF`); the **OS-native print dialog → Save-as-PDF is operator
  manual** (WSLg may have no CUPS printer — the `print()` callback logs `print failed:` rather than
  swallowing; `printToPDF` stands as the printer-independent proof) — **pending operator confirmation**.
  SC8 **met** (zoom/print tools jar-scoped + admin, live-confirmed). A11y gate **met** (0 new violations).
  Internal-refusal steps (page-zoom S7, print-to-pdf S3) are HAT checkpoints (not automation-reachable;
  unit-proven). Added mid-flight leg `05-jar-scope-parity` (adaptive planning — scope grew when live
  verification caught the façade gap; rationale in Anomalies).

---

## Leg Progress

### Leg 01 — `zoom-capture-and-apply` (landed, 2026-06-18)

**What changed:**
- `src/main/main.js` — added a discrete zoom ladder (`ZOOM_LADDER`, Chrome's familiar steps),
  `nextZoomFactor(current, action)` (nearest-rung step + `reset → 1.0`), and `applyZoom(wc, action)`
  (clamp `[0.25, 5.0]` → `setZoomFactor` → broadcast `zoom-changed {wcId, factor}`). Attached a
  `before-input-event` listener to each **non-internal** guest webContents inside the existing
  `web-contents-created` webview block: matches `keyDown` + `control|meta`, `'='`/`'+'` → `in`
  (regardless of shift, so US-layout `Ctrl+Shift+=` works), `'-'` → `out`, `'0'` → `reset`, calls
  `applyZoom` + `event.preventDefault()`. The internal session (`__goldfinchInternal`) gets **no**
  listener. Added `ipcMain.on('zoom-apply', …)` (renderer fallback) resolving via
  `webContents.fromId` with a defense-in-depth internal-session refusal (DD3).
- `src/preload/chrome-preload.js` — `zoomApply({webContentsId, action})` send + `onZoomChanged(cb)`
  listener (mirrors `onDownloadProgress`). `renderer-globals.d.ts` typedefs added.
- `src/renderer/renderer.js` — chrome-focused fallback branch in the `Ctrl+…` keydown handler
  (early-returns when the lightbox is open; no-ops on internal tabs / `wcId == null`); a
  `Map<wcId, factor>` (`zoomFactors`); `renderZoomChip(factor)` (hide at 1.0, else rounded `%`);
  `onZoomChanged` handler updating the map + chip when the changed tab is active; chip `click` →
  reset; chip refresh wired into `activateTab` alongside `updateAddressChip`.
- `src/renderer/index.html` — `#zoom-chip` button (`icon-btn hidden`, `aria-label`) after
  `#toggle-privacy`. `styles.css` — `#zoom-chip` rule (`width:auto; padding:0 6px; tabular-nums`);
  focus ring inherited from the existing `.icon-btn:focus-visible` rule.
- `src/main/automation/input.js` — widened the printable branch regex to `/^[a-z0-9=+-]$/i`;
  symbols keep their literal character as keyCode (no uppercase) so `Ctrl+=`/`Ctrl+-` build.
  `test/unit/automation-input.test.js` — added `=`/`-`/`+` assertions.

**Test results:**
- `npm test` — **776 pass / 0 fail** (incl. the new `=`/`-`/`+` `keyEvents` assertions).
- `npm run lint` — clean. `npm run typecheck` — clean.
- `npm run a11y` (default full rule set, the leg's baseline gate) — **no new violations**; all 12
  findings are pre-accepted baseline nodes; the zoom chip introduced none. (A narrower
  `--tags=wcag2a,wcag2aa,wcag21a,wcag21aa` invocation surfaces one `scrollable-region-focusable`
  on `.ps-list` — the player-sources list, **pre-existing and unrelated** to this leg, not in this
  diff; a baseline-allowlist gap to roll up separately, not a regression introduced here.)

**DD1 same-jar live check — HYPOTHESIS REFUTED (live result, run over the MCP automation surface):**
Two tabs opened to the **same origin in the same (default) jar**. Baseline `window.devicePixelRatio`
1.5 on both (OS display scale). Drove `Ctrl+=` ×3 into **only** tab 1 (page-focused → exercises the
new main-side `before-input-event` capture). After: **both** tab 1 (zoomed) **and** the untouched
tab 2 jumped to DPR 2.5.

> **Observed model: PER-ORIGIN-PER-SESSION, not per-tab.** Chromium's host-zoom map shares the zoom
> level across all same-origin tabs within one session/jar — `setZoomFactor` on one webContents
> propagates to its same-origin siblings in the same jar. The leg's stated hypothesis (per-tab,
> because `setZoomFactor` "persists per-webContents") is **wrong** for same-origin same-jar tabs.

**Implication for `verify-integration` (SC1 / no-cross-jar-leak):** the asserted invariant must be
framed as **no cross-JAR leak** (different session partitions stay independent — the host-zoom map is
per-session), NOT "no cross-tab leak." Two same-origin tabs in the *same* jar are *expected* to share
a zoom level; two same-origin tabs in *different* jars must not. The chip reflects per-`wcId` factor
from `zoom-changed` broadcasts, so each active tab shows its (origin-shared) level correctly.

**Internal-tab no-op (AC):** both guard paths implemented (renderer `isInternalTab` + main
`__goldfinchInternal` on each of the capture listener and the `zoom-apply` handler). The internal
session is excluded from the automation eval tool even for admin, so the formal `goldfinch://settings`
no-op assertion is **deferred to the `page-zoom` behavior test step 7 (admin key) / HAT** per the leg;
no error path is reachable since the listener is simply never attached to that session.

### Leg 02 — `zoom-mcp-tool` (landed, 2026-06-18)

**What changed:**
- `src/main/automation/zoom.js` (NEW) — `getZoom(wcId, deps)` and `setZoom(wcId, factor, deps)`
  ops, mirroring the `nav.js` template. Both resolve via `resolveContents`, then carry an
  **op-local `isInternalContents` guard placed AFTER resolve** (DD3) so they refuse the internal
  `goldfinch://settings` session **even under admin's `allowInternal:true`** — mirroring
  `observe.js`'s `evaluate`/`injectScript`/`openDevTools`. `getZoom` returns `{ factor:
  wc.getZoomFactor() }`. `setZoom` validates `factor` is a finite number `> 0` (throws
  `automation: setZoom — factor must be a positive number` first, before any resolve/side-effect),
  clamps to `[0.25, 5.0]` via local `ZOOM_MIN`/`ZOOM_MAX` (kept local — the module must not import
  the Electron entry `main.js`), calls `wc.setZoomFactor(clamped)`, and returns `{ factor: clamped }`.
  Electron-free / debugger-free.
- `src/main/automation/engine.js` — `require('./zoom')` + two dispatch entries (`getZoom: (wcId) =>
  zoom.getZoom(wcId, deps())`, `setZoom: (wcId, factor) => zoom.setZoom(wcId, factor, deps())`),
  placed next to the other drive ops; `deps()` threads `allowInternal` as before.
- `src/main/automation/mcp-tools.js` — two **flat object-schema** ToolDefs (`getZoom`,
  `required: ['wcId']`; `setZoom`, `required: ['wcId','factor']`), thin-adapter `call` mapping
  named→positional, riding the default `okResult` serialize (no `shape`). **No top-level
  `anyOf`/`oneOf`/`allOf`** (DD4/SC8). Bumped the self-documenting drive-count comments "12 drive"→
  "14 drive" and the total "21"→"23" (`:91`, `:440-442`).
- `test/unit/automation-zoom.test.js` (NEW) — fake-wc style copied from `automation-nav.test.js`,
  with `getZoomFactor()`/`setZoomFactor()` spies. Covers: getZoom returns factor; setZoom applies +
  clamps both bounds + exact bounds + returns applied factor; factor validation (zero / negative /
  NaN / Infinity / non-number); `bad-handle` (non-number wcId); `no-such-contents` (destroyed wc);
  and the **op-local internal refusal with `allowInternal:true`** (proving the guard, not
  `resolveContents`, fires) plus the without-`allowInternal` resolveContents path.
- `test/unit/automation-mcp-tools.test.js` — added `getZoom`/`setZoom` to `DRIVE_NAMES` (which
  `makeFakeEngine` iterates, so the stubs come along); bumped the tool-count assertion 21→23 and the
  doc comment; added required-field assertions for both new tools; added a **flat-schema invariant
  test** (zoom tools declare no top-level `anyOf`/`oneOf`/`allOf`; `pressKey` stays the only
  sanctioned `anyOf`); added named→positional dispatch tests for both.

**Test results:**
- `npm test` — **797 pass / 0 fail** (incl. the new `automation-zoom.test.js` and the updated
  `automation-mcp-tools.test.js`).
- `npm run lint` — clean. `npm run typecheck` — clean.

**Deviation (rationale):** the leg's Files-Affected list named only `automation-mcp-tools.test.js`
for the tool-count bump, but `test/unit/automation-mcp-server.test.js` carries an independent
end-to-end `EXPECTED_TOOL_COUNT = 21` constant (the live tools/list assertion over the SDK
transport). Adding two tools genuinely raises that count to 23, so the constant (and its test title)
were bumped to 23 — a direct, mechanical consequence of the new tools, required for `npm test` to
pass. No behavior change; no new top-level `anyOf` introduced (`pressKey` stays the sole one).

### Leg 03 — `print-and-pdf` (landed, 2026-06-18)

**What changed:**
- `src/main/main.js` — extended the leg-1 `before-input-event` handler (inside the
  `!__goldfinchInternal` block) with a `Ctrl/Cmd+P` branch: `contents.print({}, (ok, reason) => …)`
  + `event.preventDefault()` + `return`. Web-content-only by construction (the listener is never
  attached to the internal session). Added `ipcMain.on('print', …)` right after `zoom-apply`,
  mirroring it exactly (resolve `webContents.fromId` → `!wc || isDestroyed` guard → internal-session
  defense-in-depth guard → `wc.print({}, (ok, reason) => …)`). **Both native print() call sites
  attach the `(ok, reason)` callback and `console.warn` on failure** — bare `print()` swallows WSLg
  no-printer failures.
- `src/preload/chrome-preload.js` — `print({ webContentsId })` send next to `zoomApply`.
  `renderer-globals.d.ts` — `print(payload: { webContentsId: number }): void` typedef added.
- `src/renderer/index.html` — `#kebab-print` item (`class="cm-item" role="menuitem" tabindex="-1"`,
  "Print…") between Settings and Exit in `#kebab-menu`.
- `src/renderer/renderer.js` — `#kebab-print` click handler: `closeKebabMenu()` then, for the active
  tab, `window.goldfinch.print({ webContentsId: tab.wcId })` guarded by `!isInternalTab(t)` and
  `t.wcId != null`. Picked up automatically by the existing `menuController` roving-tabindex (no
  controller change). Updated the now-stale "two static role=menuitem items" comment → "three
  (Settings, Print…, Exit)".
- `src/main/automation/print.js` (NEW) — `printToPDF(wcId, deps, _opts = {})` mirroring
  `captureScreenshot`'s foreground-first discipline (resolve → guest-only `activate` + re-resolve +
  fixed ~80ms `waitForPaint` → render). **Op-local `isInternalContents` guard placed BEFORE
  `activate`** (refuse internal *before* foregrounding — deliberately stricter than `evaluate`;
  single guard sufficient since the internal-session identity is invariant across re-resolve).
  Renders via `wc.printToPDF({})` (Electron ^42 requires the options arg) and returns
  `buf.toString('base64')` — a **plain JSON-text string** through the default `okResult` path (DD4),
  NOT an image block. Local `waitForPaint` is necessary (observe.js exports no shared helper).
- `src/main/automation/engine.js` — `require('./print')` + `printToPDF: (wcId) => print.printToPDF(wcId, deps())`
  after `closeDevTools` (no opts threaded — v1 exposes none).
- `src/main/automation/mcp-tools.js` — flat-schema `printToPDF` ToolDef after `setZoom`
  (`required: ['wcId']`, no top-level `anyOf`/`oneOf`/`allOf`, **no `shape`** so base64 rides the
  default `okResult` JSON-text path). Bumped the in-file count comments: "14 drive"→"15 drive" and
  the table-total block "= 23"→"= 24" (note printToPDF).
- `test/unit/automation-print.test.js` (NEW) — observe base64-op style: base64 return decodes to the
  fake buffer (and is a string; `printToPDF` called with `{}`); `activate` ordered BEFORE
  `printToPDF` with the post-activate re-resolved handle used (distinct pre/post wc proves it);
  op-local internal refusal **with `allowInternal:true`** (activate never attempted, printToPDF never
  called); `bad-handle` / `no-such-contents` via `resolveContents`.
- `test/unit/automation-mcp-tools.test.js` — `DRIVE_NAMES` +`printToPDF`; count 23→24; test-title
  string "23 tools (14 drive…)"→"24…(15 drive…)".
- `test/unit/automation-mcp-server.test.js` — `EXPECTED_TOOL_COUNT` 23→24; title "returns 23 tools"
  →"returns 24 tools".

**Test results:**
- `npm test` — **802 pass / 0 fail** (incl. the new `automation-print.test.js` and the bumped
  tool-count tests).
- `npm run lint` — clean. `npm run typecheck` — clean.
- `npm run a11y` — **could not run in this environment** (the audit needs a live GUI app with the
  automation surface + a minted admin/guest key; no display/key available headlessly). **Deferred
  to a manual check at `verify-integration`/HAT.** Low risk: the `#kebab-print` item is a static
  `role="menuitem"` button structurally identical to the existing Settings/Exit items and is operated
  by the same `menuController` roving-tabindex — no new a11y surface beyond mirroring the established
  pattern.

**Deviations (rationale):**
- The leg's Files-Affected named `automation-mcp-server.test.js` for the `EXPECTED_TOOL_COUNT` bump
  (23→24) — applied as specified; mechanical consequence of the new tool, required for `npm test` to
  pass. (Same independent end-to-end constant noted in Leg 02.)
- `a11y` was deferred (not failed) per the leg's explicit allowance for environments lacking a
  display — see test results above.

### Leg 04 — `verify-integration` (Part A only — docs + regression; 2026-06-18)

**Scope:** This is the autonomous Part A slice. Parts B (live behavior tests) and C (manual native
print) are Flight-Director / operator-gated and were **not** attempted here — see OUTSTANDING below.

**Docs changed:**
- `README.md` — `## Keyboard shortcuts` table gained four rows: `Ctrl +` (zoom in — page content),
  `Ctrl -` (zoom out), `Ctrl 0` (reset to 100%), `Ctrl+P` (print / save as PDF), matching the
  existing table style. Added a short note below the table that zoom shows a chip when ≠ 100% and
  applies to web content only (not `goldfinch://` pages).
- `docs/mcp-automation.md` — documented the three new drive tools and corrected every stale count:
  - Drive-tool table gained `getZoom` (`{ wcId }` → `{"factor":n}`), `setZoom` (`{ wcId, factor }`
    → applied `{"factor":n}`, clamped `[0.25, 5.0]`), `printToPDF` (`{ wcId }` → base64 PDF string;
    decode → `%PDF-`), matching the `| tool | args | result |` format.
  - `### Drive tools (12)` → **(15)**; Overview `21 tools — 12 drive` → **24 / 15 drive**; tool-ref
    intro `All 21 tools` → **24**.
  - Added the three ops to the jar-scoped tab-targeting refusal list and to the
    **real-return-value** side of the refusal-semantics split (NOT the void `{"ok":true}` list —
    `getZoom`/`setZoom` return `{factor}`, `printToPDF` returns a base64 string).
  - Added a short per-section internal-refusal security callout below the drive-tool table (eval /
    devtools blockquote house style), NOT crammed into a table cell.
  - `grep -n '\b21\b\|\b12\b' docs/mcp-automation.md` → **no matches** (no stale tool-count remains).
  - Stayed strictly scoped to the zoom/print ops; did NOT backfill the pre-existing Flight-9
    eval/devtools omissions in those lists.
  - (Out-of-scope note: `CLAUDE.md` still says "21 tools" in the automation-engine architecture
    prose — outside this leg's named doc targets; left untouched, flagged for a separate cleanup.)

**Regression results:**
- `npm test` (full) — **802 pass / 0 fail / 0 skipped**.
- `npm run lint` — clean. `npm run typecheck` — clean.
- Cross-check of the touched specs (`git grep -l "before-input-event\|keydown\|zoom\|pressKey\|printToPDF" test/`):
  `automation-input.test.js` (Ctrl `=`/`-`/`+` printable-branch assertions), `automation-mcp-tools.test.js`
  (tool list + flat schemas + factor return + named→positional dispatch for getZoom/setZoom/printToPDF),
  `automation-mcp-server.test.js` (`EXPECTED_TOOL_COUNT = 24`). All pass and assert the intended new
  behavior; the doc rows match these assertions (factor shape, base64 PDF, clamp bounds).

**OUTSTANDING (Flight-Director / operator-gated — NOT done here):**
- **Part B** — `/behavior-test page-zoom` (admin key) + `/behavior-test print-to-pdf` + `npm run a11y`.
  None run (no live app / admin key / display in this autonomous slice). The page-zoom step-7
  op-local internal guard requires the **admin** key. Specs not yet flipped `draft → active`; no run
  logs written. Part B acceptance criteria are **unmet**.
- **Part C** — manual native `Ctrl+P` / kebab **Print…** → OS dialog → Save as PDF (or, on a
  no-printer WSLg host, the `print failed:` warning + `printToPDF` as the printer-independent proof).
  Not performed; operator-gated. Disposition pending.

### Leg 05 — `jar-scope-parity` (landed, 2026-06-18)

**Scope:** Remediation leg closing the SC8 jar-scope parity defect (see Anomalies). Live verification
found `getZoom`/`setZoom`/`printToPDF` wired into the full engine + MCP tool list (legs 2–3) but NOT
into the jar-scope façade, so a jar key threw `engine.getZoom is not a function`.

**What changed:**
- `src/main/automation/scope.js` — appended `'getZoom', 'setZoom', 'printToPDF'` to `WCID_FIRST_OPS`
  (one-line addition + a short explanatory comment): they are wcId-first ops, jar-membership-checked
  exactly like `navigate`/`evaluate`/`openDevTools`. The generic wrapper runs `resolveContentsForJar`
  first (refuses out-of-jar/internal/chrome), then delegates to the engine op. The op-local internal
  guard in `zoom.js`/`print.js` still covers the admin path. **No change** to engine.js / mcp-tools.js /
  zoom.js / print.js — the ops were correctly defined there; the only gap was the façade op-list.
- `test/unit/automation-scope.test.js` — added a **positive** in-jar test mirroring the existing
  "in-jar op reaches the engine" case: under jar key `personal`, `getZoom(1)` / `setZoom(1, 1.5)` /
  `await printToPDF(1)` on an in-jar tab all reach the fake engine (calls recorded, no throw). The
  existing generic "every wcId-first op is membership-gated" test auto-iterates the expanded
  `WCID_FIRST_OPS`, so it now also covers the three ops' out-of-jar refusal (no edit needed). `makeEngine`
  auto-stubs the three (it loops `WCID_FIRST_OPS`); the synchronous stub works for the `await`ed
  `printToPDF` (the wrapper forwards the engine return untouched).

**Admin path unchanged:** admin still bypasses scoping at `scope.js:64` (engine returned as-is); the
op-local internal guard in `zoom.js`/`print.js` still fires for the admin path. No new capability — these
ops were already admin-callable; this leg only restores the intended jar-scoped path (SC8 parity).

**Test results:**
- `npm test` — **803 pass / 0 fail / 0 skipped** (incl. the new positive jar-scope test; the generic
  membership test now exercises the three ops).
- `npm run lint` — clean. `npm run typecheck` — clean.
- Zero new runtime dependencies.

---

## Decisions

- **2026-06-18 (Leg 01, DD1) — Zoom sharing is PER-ORIGIN-PER-SESSION, not per-tab.** Live check
  refuted the leg hypothesis: Chromium's host-zoom map shares the level across same-origin tabs in the
  same jar. `verify-integration`'s SC1 invariant must therefore assert **no cross-JAR leak** (across
  session partitions), not no-cross-tab leak. See the Leg 01 progress entry for the measured evidence.

---

## Deviations

_(departures from the planned approach — appended during execution)_

---

## Anomalies

### SC8 jar-scope parity defect — new tools missing from the jar facade (caught by live verification)
**Observed**: Under a **jar key**, `getZoom`/`setZoom`/`printToPDF` throw `engine.getZoom is not a
function`. The three ops were wired into the full engine (`engine.js`) and the MCP tool list
(`mcp-tools.js`) by legs 2–3, but **never added to the jar-scope façade** (`scope.js` `WCID_FIRST_OPS`),
which builds a per-op wrapper only for ops in that set. So a normal **jar-scoped** agent (the standard
web-surface auth) cannot invoke them at all — only the env-gated **admin** key works.
**Severity**: blocking for **SC8** (agent parity — "inheriting M03's gating and **jar-scoping**"). Also
made the leg-4 docs (which list the three as jar-scoped) over-claim vs. the code.
**Root cause**: the legs-2/3 recon covered `engine.js`/`mcp-tools.js`/`resolve.js` but missed the
separate jar-scoping axis in `scope.js`. The op-local internal guard (DD3, admin path) was handled; the
jar-façade path was not.
**Resolution**: remediation leg `05-jar-scope-parity` — add `getZoom`/`setZoom`/`printToPDF` to
`WCID_FIRST_OPS` (they are wcId-first, exactly like `navigate`/`evaluate`/`openDevTools`), so a jar key
reaches them on its **own** tabs and `resolveContentsForJar` gives the clean out-of-jar/internal refusal
the `print-to-pdf` spec expects. Re-verified live under the jar key after the fix. Nothing was committed
before the fix.

---

## Session Notes

_(chronological notes from work sessions)_
