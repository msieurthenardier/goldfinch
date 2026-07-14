# Flight Log: Tab Context Menu

**Flight**: [Tab Context Menu](flight.md)

## Summary

Leg 1 (`menu-model-and-wiring`) landed: the pure `tab-context-model.js` +
unit net, both trigger paths (pointer `contextmenu` + the extended
Context-Menu-key/Shift+F10 catch-all gate), sheet registration
(`MENU_LABELS`/`overlayMenus`/`tabCtx` capture), channel-6 dispatch for all
five `tab:*` actions (ordered-sweep batch closes, duplicate via the new
history-snapshot invoke, reopen-closed via dispatch reuse), the two new
chrome-trust-domain invokes (`tab-history-snapshot`, `closed-tab-stack-size`),
the a11y audit hook (`openTabContextMenuForAudit` + `sheet:tab-context`), and
the doc grep-ACs (README + CLAUDE.md). Live-verified end-to-end via
`dev:automation`; the right-click premise (this leg's designated STOP
condition) held.

Leg 2 (`verify-integration`) landed: the `tab-context-menu` behavior spec
authored and **passed 10/10 on its first Witnessed run** (spec now `active`);
a11y sweep green including the new `sheet:tab-context` state; suites
1646/1646 + lint + typecheck green. Scratch-profile launch convention applied
for the first time.

---

## Leg Progress

### Leg 1 — `menu-model-and-wiring` — landed 2026-07-14

**Right-click premise (leg-start check, per Prerequisites/flight DD4).**
Verified FIRST, before the rest of the live-check: a trusted right-click
(`click` tool, `button:'right'`) at a tab's DOM coordinate fires the chrome's
native `contextmenu` handler — confirmed via the admin probe-walk finding the
menu-overlay sheet's wcId and reading its rendered `#sheet-menu` DOM
(`dataset.menuType === 'tab-context'`, correct item set for an empty stack).
PREMISE HOLDS — no `[BLOCKED:rightclick-premise]` needed; proceeded with the
rest of the leg as planned.

**Model**: `src/shared/tab-context-model.js`'s `tabContextModel({tabId,
isLastTab, tabsToRight, stackSize})` — namespaced `tab:{close,close-others,
close-right,duplicate,reopen-closed}` ids, omitted-only (no disabled-item
shape): `close-others` omitted at `isLastTab` (the only tab in the strip);
`close-right` omitted at `tabsToRight === 0`; `reopen-closed` omitted at
`stackSize === 0`; `duplicate` always present. `test/unit/tab-context-model.test.js`
— 6 tests covering the full model, each omission independently, the
always-present duplicate across four combinations, and the minimal
(only-tab, empty-stack) shape byte-for-byte.

**Triggers**: a single `contextmenu` listener wired per tab button at
creation (alongside its existing click/auxclick/pointerdown siblings) covers
BOTH the pointer right-click AND the Context-Menu-key/Shift+F10 path on a
focused tab — Chromium dispatches the same native `contextmenu` DOM event for
both (the toolbar-pin-button precedent already in the codebase). The
document-level keydown catch-all's exclusion gate (used by the toolbar pins
to avoid double-firing the generic Inspect-only menu) is extended with
`target.closest('.tab')` — no parallel keydown listener added, per DD2's
integration-point ruling. Menu-open never calls `activateTab` — verified live
that right-clicking a background tab opens its menu without switching to it.

**Dispatch** (channel-6 `'tab-context'` case): `tab:close` reuses the
existing `closeTab` path; `tab:close-others`/`tab:close-right` are ordered
sweeps — snapshot the target ids, activate the ANCHOR (the invoking tab)
FIRST when the active tab is among the targets (Chrome parity), then close
each target, so `closeTab`'s own next-tab fallback never fires mid-sweep;
`tab:duplicate` reads the source tab's live `url`/`title`/`container`
renderer-side (no round-trip) and calls the new `tab-history-snapshot` invoke
for `{entries, index}`, then `createTab(url, sourceContainer, {restoreHistory,
insertAt: sourceIndex + 1})` — the F4 restore seam, reused verbatim;
`tab:reopen-closed` dispatches through the EXISTING
`dispatchChromeAction('reopen-closed-tab')` case (dispatch reuse — the F4
jar-fallback/positional-reopen logic rides along free), fed by the new
`closed-tab-stack-size` invoke for the model's omission rule. Every body is
TOCTOU-safe: the tab id is captured at open (`tabCtx.tabId`), never
re-resolved via `activeTab()`, and every action re-validates via `tabs.get`
before acting.

**Two new invokes** (`src/main/main.js`, bare chrome-trust `ipcMain.handle`,
same domain as `tab-reopen`/`get-zoom`): `tab-history-snapshot` (web tabs
only — `isInternalContents` guard, dead/missing → `null`) and
`closed-tab-stack-size` (a thin wrapper over the existing
`closedTabStack.size()`). Preload bridges (`chrome-preload.js`) +
`renderer-globals.d.ts` entries added.

**a11y hook**: `openTabContextMenuForAudit()` builds a representative
synthetic model (`isLastTab: false, tabsToRight: 1, stackSize: 1` — all five
items render) independent of live tab-strip/stack state, added to the
renderer's evaluate-reachable closed-set seam (FD ruling per the flight's
Checkpoints — seam grew 18 → 19; `test/unit/seam-contract.test.js`'s
`SEAM_COUNT` pin updated in lockstep) and to `scripts/a11y-audit.mjs`'s
`SHEET_STATES` (+ a matching `ACCEPTED` region-advisory entry for
`sheet:tab-context`, same accepted-chrome-exception class as the other
menu-template sheet states).

**Doc grep-ACs**: README gained a "Tab context menu" bullet (features list)
+ a Shift+F10/Context-Menu-key row in the keyboard-shortcuts table; CLAUDE.md
gained a "Tab context menu (M09 F5 Leg 1)" paragraph under the Tab-strip
section (heading range extended `M09 Flights 1–4` → `1–5`) plus a
hosted-surfaces mention in the Menu-overlay-sheet architecture bullet. Both
`grep -n "context menu" README.md` and `grep -n "tab-context" CLAUDE.md` hit
as required.

**Live-check** (fresh `dev:automation` launch, mint envs, no port pin — server
free-fell to 49709; `fixtures-tabstrip` served on 8000; admin SDK client per
the `mcp-admin-client.mjs` helper) — every AC exercised:
- Pointer trigger on background AND anchor/active tabs; menu-open ≠
  activation confirmed (right-clicking/closing a background tab left the
  active tab untouched).
- All five actions: `close` (background tab, active tab unaffected);
  `close-others` and `close-right` (both ordered-sweep — anchor activated
  first when the active tab was among the targets, no cascade/flicker
  observed); `duplicate` (new tab beside the source, same jar/URL, `goBack`
  on the duplicate landed on the source's prior history entry — full
  navigation-history fidelity, not just current-URL parity); `reopen-closed`
  (LIFO pop, restored a MID-STRIP closed tab at its ORIGINAL position between
  two others — the F4-debrief spec-polish rider, killed live here).
- Omission rules: only-tab strip → `close-others`/`close-right` both absent;
  empty stack → `reopen-closed` absent; non-empty stack + tabs-to-right → all
  five present in order with separators only where a preceding section
  produced items (no leading/trailing separator).
- Escape refocus: closed the sheet and returned DOM focus to the invoking
  (background) tab element, not the sheet or address bar.
- `openTabContextMenuForAudit()` verified directly: all five items render via
  the synthetic model.

Evidence (raw automation call/response logs would have been excessive to
retain individually; a summary of every check + apparatus notes) saved under
`/tmp/behavior-tests/goldfinch/flight5-leg1/live-check-summary.md` — never in
the repo. App and fixture server killed after the run.

**Apparatus gap (documented, not a blocker)**: the automation surface's
`pressKey` op has a fixed key-name allowlist (Tab, Enter, Escape, Space,
arrows, Home, End, Delete, Backspace, ShiftTab, or a single letter/digit) with
no `ContextMenu` or `F10` entry — confirmed by trying both (rejected as
"unknown key"). The literal Context-Menu-key/Shift+F10 keyboard trigger could
therefore not be independently live-exercised through the current MCP tool
surface (a synthetic `KeyboardEvent` dispatch would not exercise the real
path either, since Chromium only auto-synthesizes `contextmenu` from
TRUSTED input). This path reuses the exact wiring already shipped and
verified for the toolbar pin buttons — no new mechanism — so it is verified
structurally (code, unit tests, lint, typecheck) but left as a HAT-testable
item / future `pressKey` enhancement.

**Suites**: `npm test -- --test-timeout=30000` → 1646/1646 pass (0 fail, +6
vs. the pre-leg baseline: the 6 new `tab-context-model.test.js` tests; the
pre-existing `seam-contract.test.js` pin was updated 18 → 19 in the same
change, not a net-new failure). `npm run lint` clean. `npm run typecheck`
clean.

### Leg 2 — `verify-integration` — landed 2026-07-14

**Spec authored**: `tests/behavior/tab-context-menu.md` (status `draft`, Last
Run `never`), per flight DD4 and the `closed-tab-reopen.md` house style:
admin-MCP apparatus preconditions (pin-if-free port with free-fallback,
fresh scratch profile — load-bearing for the Step-3 empty-stack omission
check, since the in-memory stack must provably start empty), the
background-tab-safe sheet probe walk, the async-model-build polling note
(this menu's opener awaits `closedTabStackSize()` before channel-1 — unique
among the sheet openers), the sheet lazy-singleton DOM-persistence fact, and
the coordinate-click item-activation nuance. Ten steps: precondition probe;
multi-tab persist-jar fixture setup; right-click open on a BACKGROUND tab
(items per model rules incl. the empty-stack reopen omission, menu-open ≠
activation, axtree on the probed sheet wcId); `tab:close` acting on the
CAPTURED tab; ordered-sweep `close-others` (anchor active, exact single-tab
end state pinning the no-cascade contract); `close-right` (survivors exact);
`duplicate` (same jar, same URL, inserted BESIDE the source, `goBack`
proving carried history); the MID-STRIP menu-reopen row (close a mid-strip
tab with neighbors both sides, reopen via the MENU, position among neighbors
verified — the F4 spec-polish rider); single-tab omission states (with the
non-empty-stack reopen item as the positive control that Step 3's absence
was rule-driven); Escape refocus to the invoking tab. The keyboard trigger
(Context-Menu key / Shift+F10) is documented as an APPARATUS GAP per the
`tab-cycling.md` PageDown/PageUp precedent — `KEY_MAP` recognizes neither
key (confirmed at Leg 1), a synthetic KeyboardEvent would not substitute
(trusted-input-only `contextmenu` synthesis), the product path structurally
reuses the shipped toolbar-pin mechanism + a unit-covered gate extension, so
the literal key press is HAT-scoped and a keyboard variant is sketched for
when `KEY_MAP` grows the keys.

**Witnessed run — PASS 10/10 first run**
(`tests/behavior/tab-context-menu/runs/2026-07-14-23-13-46.md`; spec `draft`
→ `active`). Live-continuation mode (one Executor + one Validator across all
ten checkpoints). **Scratch-profile convention applied for the first time**
(the F4 debrief carry): `XDG_CONFIG_HOME` pointed at an empty per-run
directory gave a deterministic Personal+Work jar seed and a provably empty
closed-tab stack — the Step-3 empty-stack omission precondition held with no
mid-run ruling (contrast F4's non-fresh-profile ruling). Highlights: menu
open ≠ activation held at the open moment; `tab:close` acted on the CAPTURED
background tab; both ordered sweeps left the exact single-tab end state
(anchor active — the no-cascade contract pinned both via `enumerateTabs` and
DOM cardinality); duplicate carried real history (`goBack` → the source's
prior entry, `goForward` back); the mid-strip menu-reopen landed BETWEEN its
original neighbors (the F4 positional discriminator finally exercised);
single-tab omissions exact with the non-empty-stack reopen item as positive
control (omitted-never-disabled confirmed structurally in the AX tree);
Escape returned DOM focus to the invoking tab with no activation
side-effect. The Validator independently recomputed every click coordinate
against recorded rects (all ten steps). Live KEY_MAP gap probes
(`ContextMenu`/`F10` rejected with the full known-key list) captured as the
documented substitution evidence. No product defects; evidence at the
ephemeral run dir only.

**a11y sweep**: `npm run a11y` green — the new `sheet:tab-context` state
swept; no NEW violations (its `region` advisory node matches the existing
accepted-baseline class, reviewed in Leg 1's `ACCEPTED` entry).

**Suites**: `npm test` 1646/1646 (~1.1 s, zero flakes), `npm run lint`
clean, `npm run typecheck` clean.

---

## Decisions

- **Duplicate reuses the source tab's `container` object directly** (not
  `inheritContainerFrom`, which has a different, page-opened-link-specific
  jar-inheritance ruling) — Chrome parity: a duplicated tab stays in the
  exact jar it duplicated from, burner included, matching DD1's resolved
  "address + jar + nav history" open question literally.
- **Tab-context menu anchor uses the tab's element rect** (chrome→sheet
  translated via the existing `chromePointToSheet`), the same pattern as the
  toolbar Unpin menu — not the raw pointer click coordinate. Acceptable per
  the flight's "item order/copy" variation allowance; keeps one anchor idiom
  for every element-triggered menu.
- **`openTabContextMenu`'s model build is async** (awaits the new
  `closedTabStackSize()` invoke before opening) — the only sheet-menu opener
  with this shape. `tabCtx.tabId` is re-checked when the invoke resolves so a
  superseding open (a second right-click before the first's invoke returns)
  safely wins; the stale resolve becomes a no-op instead of opening the wrong
  tab's menu after a newer one already took over.

---

## Deviations

- None. All ACs implemented and live-verified as designed; the one open
  Prerequisite (the right-click delivery premise) resolved POSITIVE at leg
  start, so no divert to a keyboard-only-coverage fallback was needed.

---

## Anomalies

- The automation surface's `pressKey` op cannot send `ContextMenu`/`F10` —
  see the apparatus-gap note above. Not a product anomaly.

---

## Session Notes

### Flight Director Notes

- 2026-07-14 — Flight `ready` → `in-flight`; branch
  `flight/5-tab-context-menu` stacked on flight/4.
- **Risk tier: LOW.** DD1–DD4 embed every design-review ruling verbatim
  (ordered-sweep batch closes with anchor-first activation; the
  activeElement-based keyboard-target idiom; the catch-all gate's exact
  integration point; omitted-only item rendering; the closed-set seam FD
  ruling for `openTabContextMenuForAudit`) — this leg followed them without
  divergence. Flight-end Reviewer covers the code; no additional review gate
  needed mid-flight.
- 2026-07-14 — Leg 2 Witnessed run: live-continuation mode; Executor and
  Validator each held context across all ten checkpoints (batched 1 / 2–4 /
  5–7 / 8–10). 10/10 PASS first run; run log at
  `tests/behavior/tab-context-menu/runs/2026-07-14-23-13-46.md`.
- 2026-07-14 — Flight-end Reviewer: implementation **fully DD-conformant**,
  suites re-verified independently. One fix cycle: the standing doc audit
  caught CLAUDE.md drift the flight's own changes created — the seam-count
  paragraph ("18-entry" → 19) and the a11y sheet-state enumeration (five →
  six, `sheet:tab-context`) — plus two low doc nits (Close-family
  escape-only phrasing now shared by tab-context; `docs/renderer-menu.md`
  menu-template consumer list). Doc-fix Developer spawned; artifact
  checkbox reconciliation (flight.md checkpoints/legs) done by FD. Third
  consecutive flight where the flight-end doc audit caught drift — but
  NOTE: the leg-1 grep-ACs did their job (README/CLAUDE.md gained the new
  content); what drifted was EXISTING enumerations/counts in paragraphs the
  grep-ACs didn't cover. Debrief carry: count/enumeration references are a
  distinct drift class from missing-content — grep-ACs catch absence, not
  staleness.
- **Known edge (Reviewer issue 6, informational — accepted, no code
  change)**: `openTabContextMenu`'s stale-resolve guard checks
  `tabCtx.tabId !== id` only, so a DIFFERENT menu type (e.g. kebab) opened
  during the `closedTabStackSize()` round-trip could be model-replaced by
  the stale tab-context resolve. Window is one local IPC round-trip;
  dispatch TOCTOU re-validation makes any consequence harmless. Recorded
  here rather than patched — fold into the F6 module-split touch if that
  refactor reshapes the opener.
