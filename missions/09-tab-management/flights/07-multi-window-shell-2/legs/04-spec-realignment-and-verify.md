# Leg: spec-realignment-and-verify

**Status**: completed
**Flight**: [Multi-Window Shell, Part 2](../flight.md)

## Objective

Realign the behavior-spec corpus to the surface legs 1–3 landed — author the headline `multi-window-automation` spec, fully rewrite the planned-red `multi-window-shell`, re-point the 10 probe-walk specs onto `enumerateWindows`, restate the count-precondition specs that actually read `enumerateTabs`, refresh `kebab-menu`'s stale enumeration, discharge the queued leg-1/leg-2 errata, pin the tool **descriptions** DD9 leaves unguarded, and verify the docs — then hand the flight to the FD for the Witnessed runs and the flight-end review.

## Context

### READ THE WORKING TREE, NOT `HEAD`

Legs 1, 2, and 3 are **landed and UNCOMMITTED**. `HEAD` (`b607411`) is the flight spec only. `git stash`, `git checkout -- .`, or diffing `b607411` for *content* silently reverts all three legs. This flight commits **once**, after the flight-end review.

**Every `file:line` in the flight spec, the audit, and this leg's brief is pre-leg-1/2/3 and was re-derived here** — see the **Citation Audit**. Legs 1–3 moved main.js 3461 → 3392 → 3469 → **3517** and rewrote the automation ops, the docs, and three spec files.

### The flight's central, nine-times-paid lesson — this leg's operating rule

> **A boundary or count quoted from memory, from prose, or from another artifact's range is wrong at a measured rate. Print it and read it.**

Nine instances, every one the same shape: *a total asserted in prose instead of an enumeration read off the tool.* Two were the FD's; one was inside the landing entry of the leg written to stop it. **This leg's design already claimed the tenth and eleventh** (see "What this leg's design found", below). Corollaries, all earned in this flight:

- **ENUMERATE; never state a total in prose.** The one artifact in this flight that never erred is the one that enumerated (DD6's table).
- **Grep-ACs must be line-anchored, comment-masked, and ship a control that is RUN** — four failed before leg 3 fixed the shape; leg 3's were the first to survive contact. Copy leg 3's shape exactly.
- **Absence assertions need a same-run positive control** — an instrument shown able to report presence. Two of this flight's three false readings were absence claims resting on an instrument never shown capable of reporting presence.

### The decisions this leg realigns the corpus to

- **DD1** — `enumerateTabs` is an **all-windows** census; every row carries `windowId`; the return stays a plain array. A mid-boot window contributes zero rows.
- **DD2** — `enumerateWindows()` is the single discovery primitive; it **retires the probe walk** and carries `booted`, `sheetWcId`/`sheetVisible`, `findWcId`/`findVisible`.
- **DD5** — per-window overlay instances; the roaming singleton is **deleted**.
- **DD6** — cross-window acts raise the owning window; `readDom`/`evaluate` do **not**.
- **DD9** — the schema pin. **Its named gap is this leg's: `description` is unguarded.**

### What this leg's design found (recorded, not silently corrected)

The brief instructed *"do not trust this list as complete"* and *"every line number in THIS BRIEF is suspect"*. Both instructions paid.

1. **Item G's premise is FALSE against the working tree.** The brief says *"Both DD3 tool descriptions **currently assert the OLD contract** in prose. Fix both."* **They do not.** Leg 3's implementer already fixed both by hand (its landing entry says so: *"Updated by hand"*). Read verbatim at this leg's design, `mcp-tools.js:121` (`enumerateTabs`) states *"across ALL windows … { …, windowId }"* and `:413` (`captureWindow`) states *"windowId is OPTIONAL … Returns image content … this op returns pixels, not topology."* Both are **correct and current**. **Leg 4 owes only the PIN**, not the fix. Writing the "fix" would have been a no-op edit justified by a stale claim.
2. **Item G's "nothing pins a tool DESCRIPTION" is over-broad.** Enumerated off `automation-mcp-tools.test.js`, **seven** tools already have description assertions: `pressKey` (`:147`), `readAxTree` (`:577`), `evaluate` (`:753-755`), `injectScript` (`:765-767`), `openDevTools` (`:831`), `closeDevTools` (`:838`), `getHistory` (`:1092-1095`). The gap is real but **narrower and sharper than stated**: the pins are ad-hoc per-tool, and the **four topology-bearing tools have none** — `enumerateTabs`, `captureWindow`, `getChromeTarget`, `enumerateWindows`. That is exactly the set DD3/DD2 changed. The honest framing is *"the tools whose contract this flight changed are the ones with no description pin"*, not *"nothing pins a description."*
3. **Item H's five prose op-count pins are ALREADY 30.** All five verified reading `30` at this leg's design. **Leg 4 owes verification (the grep-AC), not edits.** Two of the brief's five line numbers had drifted (below).
4. **Item D's "5 count-precondition specs" is 3 for DD1's purposes.** `grep -c enumerateTabs` per spec: `closed-tab-reopen` **11**, `kebab-menu` **6**, `popup-jar-inheritance` **1**, `tab-keyboard-operability` **0**, `unified-tab-controls` **0**. The last two count tabs **exclusively via `readAxTree(chromeWcId)`'s `tablist`** — their own Observables sections say so (`unified-tab-controls:71` *"tab count (number of `tab` nodes in the `tablist` via `readAxTree(wcId)`)"*). A chrome document's tablist is **per-window by construction**; DD1 cannot touch it. **They need no restatement.** The audit's class-5 is a valid *exposure* label, but its class definition assumed the instrument was `enumerateTabs` — for 2 of the 5 it isn't. *(The tenth instance of the flight's pattern: a total carried forward from a classification table instead of read off the specs.)*
5. **Item E's `kebab-menu` site list is 4 of 5.** The brief names *"title/Intent/steps 3+5"*. Enumerated: title `:1`, Intent `:27`, **Observables `:116`** (*"count = **exactly 4**"*), step 3 `:134`, step 5 `:136`. **The Observables line is missed by the brief and by the spec's own header annotation.** *(The eleventh instance.)*
6. **NEW — two live doc defects leg 3 missed, and they are this flight's signature error one more time.** `docs/mcp-automation.md:533` reads **`### Admin chrome / app-level (2)`** while the table beneath it lists **three** tools (`getChromeTarget`, `enumerateWindows`, `downloadsList`) and the overview at `:20-21` says *"3 admin chrome/app-level tools"*. `:535` reads *"**Both tools** are admin-only"* and *"A jar key calling **either**"*. **Read off the tool: the six section headings sum to 18+4+2+2+2+1 = 29, while `mcp-tools.js` declares 30** (`grep -c "^    name: '"` → 30). Leg 3's AC8 enumerated seven *total*-count sites and landed all seven; a **category** count in a subsection heading was not among them and slipped through. This is a fresh, real find — and it is why AC17 below asserts the **sum**, not the sites.

### `multi-window-shell` — the planned red comes due

Red since leg 1, by three independent falsifications, all verified verbatim against the spec at this leg's design (not taken on the flight's word):

| Falsified by | Spec text | Line |
|---|---|---|
| **DD5** | *"ONE sheet serves every window, attaching to the requesting window at show time"* | `:80-86` |
| **DD5** | *"A second window has fully working menus with **zero per-window overlay instances**"* | `:124` |
| **DD1** | *"`enumerateTabs` is **window-scoped** (the accessor window's tabs), **not an app census**"* | `:74-75` |
| **DD1** | step 3 — *"`enumerateTabs()` (now window-2-scoped) lists **exactly one** tab"* | `:123` |
| **DD1** | step 5 — *"`enumerateTabs()` (window-3-scoped) lists **EXACTLY ONE** tab"* | `:125` |
| **DD1** | step 6 — *"**T3** appears in **window 3's census** (T2 + T3, T3 active)"* | **`:126`** |
| **DD1** | step 7 — *"`enumerateTabs()` still lists T2 + T3"* | `:127` |
| **DD2** | step 2 — *"Known-wcId skip set recorded (feeds the Step-4 probe walk)"* | `:122` |

**Two corrections to the brief's census list, both from reading the steps rather than the flight spec's range:**

- The flight spec's list (`:123`, `:125`, `:127`) — which the brief inherits — **omits `:126` (step 6)**. Step 6 asserts *"window 3's census"* through `enumerateTabs()`; DD1 makes that call all-windows. A rewrite driven off the flight's list would leave step 6 asserting a window-scoped census against an all-windows op.
- The brief widens it to *"steps 2/3/5/6/7"*. **Step 2 (`:122`) is NOT DD1-falsified** — only one window exists at step 2, so the all-windows census and the window census are the same set. Step 2 **is** DD2-falsified, by its skip-set clause. The distinction matters: it is the difference between restating an assertion and deleting a mechanism.

Its **pre-registered two-menus variant** (`:153-157`) — *"add a two-menus-open-at-once variant — impossible under the F6 roaming interim by design"* — **now has its evidence**: leg 3's smoke measured both windows reporting `sheetVisible: true` with distinct `sheetWcId`s (**4** and **6**). The variant becomes a real step.

Its **step-8 `ERR_ABORTED` count** (recon item 7): step 2 (`:122`) carries the COMMIT-SETTLE GATE naming `ERR_ABORTED`; **step 8 (`:128`) asserts `goBack(R2)` lands on page 2 but pins no history-entry count** — so an `ERR_ABORTED`-shortened history fails as a confusing page mismatch instead of a named count. Codify the count.

### The queued errata — now is the time

All were annotated in spec headers and **deliberately unfolded** so leg 1's "the set passes UNMODIFIED" premise held. That premise has been discharged (`menu-overlay` 6/6, `find-overlay-geometry` 8/8, `menu-dismissal` 9/9). **Fold them now.**

**The errata headers' own internal citations are stale — every one.** The annotations were added *to the files*, shifting the content they cite. Measured at this leg's design, `menu-dismissal`'s header annotation is a uniform **+27** off:

| Header cites | Real location | Content |
|---|---|---|
| `:76-79` | **`:103`** | *"**Re-locate before each click — do NOT cache.**"* |
| `:97-100` | **`:124-126`** | *"Scripted focus can't fake OS blur … **HAT-scoped**"* |
| `:106-109` | **`:133-136`** | the `focused`-property guidance (*"scan it for the node whose `focused` property is set; there is no top-level `focused` field"*) |
| `:144-145` | **`:171-172`** | Out of Scope — *"**OS/app-switch blur dismissal** … **HAT-scoped**"* |

**Fix these citations as part of folding the errata** — an erratum that points at the wrong line is the citation-drift class one layer in, sitting inside the artifact that documents it.

### The DD7 blur-conditioning hole — this leg owns it, honestly

The FD ruled it *"must become an explicit AC at the first F7 leg that has two windows live — leg 4's `multi-window-automation`"*. The ruling's own reasoning bounds what the AC can claim:

- Leg 1 deleted `if (menuOverlay.getAttachedWindow() === win)` in favour of an unconditional per-window `sheet.closeMenuOverlay('blur')`. The Validator proved the two are **behaviorally identical in a single-window rig** — *"there is no third case with one window."*
- The deleted guard's own comment names the only scenario that exercises it: *"opening a menu in window B is killed by A's in-flight blur (the two-window open handoff)."*
- **WSLg delivers no OS blur to a scripted stimulus** (F6 spike verdict 4). Leg 2's HONESTY NOTE and leg 3's AC15 both establish the house discipline: fix it, prove what the rig can read, **never claim live proof the rig cannot give**, and **never leave an unqualified HAT ticket that silently cannot run.**

**So the AC splits, and AC7 says so rather than letting it be inferred:**
- **Rig-reachable half — asserted live**: two sheets open simultaneously, dismiss window A's → **window B's stays open**. That is per-window dismissal scoping, and it is exactly the property the roaming singleton could not have. Drivable via `pressKey(sheetA, 'Escape')`, read via `enumerateWindows().sheetVisible`.
- **OS-blur half — NOT claimed live.** Pin to a non-WSLg desktop **or** record as an accepted permanent gap. **FD rules which; the leg must not leave it ambiguous.** Precedent: leg 3's DD4 HAT item, pinned verbatim with its precondition stated.

### Who runs what

**The Developer CANNOT run behavior tests** — the Witnessed two-agent protocol is the FD's. The leg-1 log records an Executor falsely blocking after zero tool calls because it looked for a registered MCP; **this project's apparatus is a hand-rolled SDK client over Bash** (`scripts/mcp-example-client.mjs` is the template), never a registered MCP.

| Developer | FD (after) |
|---|---|
| All spec edits (author, rewrite, re-point, restate, errata) | Runs `/behavior-test multi-window-automation` (draft → the FD's first run) |
| The description pin + its control | Runs `/behavior-test multi-window-shell` + its variant |
| Docs + the audit annotation | Re-runs the 5 remaining AC13 invariant specs, now re-pointed |
| `npm test` / `lint` / `typecheck` / `a11y` | The flight-end review + the single commit |
| The grep-ACs and their controls | |

## Inputs

- Branch `flight/7-multi-window-2`. Legs 1–3 **landed, UNCOMMITTED**. `HEAD` = `b607411` (flight spec only).
- **`wc -l src/main/main.js` → 3517** (read off the tool at this leg's design). Leg-3 landing baseline. **This leg is expected to add ZERO** — it edits no main-process source.
- **`npm test` → 1831 tests, 13 suites, 1831 pass, 0 fail** (run at this leg's design). `npm run lint` exit 0. `npm run typecheck` exit 0. `npm run a11y` green.
- **`grep -c "^    name: '" src/main/automation/mcp-tools.js` → 30** — the tool tally, read off the tool.
- `test/unit/automation-mcp-server.test.js:27` — **`const EXPECTED_TOOL_COUNT = 30;`**. *(The flight spec and leg 3 both cite `:26`; it is at `:27`.)*
- `test/unit/automation-mcp-tools.test.js` — the DD9 pin. Key-shape pin `:82-90` (`assert.deepEqual(Object.keys(t).sort(), ['description','inputSchema','name'])`); observe schemas `:543` (renamed at DD3); existing description pins at `:147`, `:577`, `:753-755`, `:765-767`, `:831`, `:838`, `:1092-1095`.
- `src/main/automation/mcp-tools.js` — **638+ lines**. Tool defs: `enumerateTabs` `:120`, `captureWindow` `:412`, `getChromeTarget` `:542`, `enumerateWindows` `:548`. `listTools` `:620`; its projection `:609`. The `= 30` tally comment `:591`.
- `docs/mcp-automation.md` — `:19` (30 tools), `:20-21` (3 admin tools), **`:441`** ("All 30 tools below match … exactly"), `## Multi-window semantics` `:360`, `## Tool reference` `:439`, `### Admin chrome / app-level (2)` **`:533`** (wrong — see AC17), `:535` ("Both tools").
- `CLAUDE.md:452` — "The server advertises **30 tools**".
- `docs/behavior-specs-single-window-audit.md` — **199 lines**, DATED (S7). F7 consumption note `:163-199`; the sequencing order `:196-199`; class totals `:126-138`.
- **The probe-walk set — RE-VERIFIED at this leg's design, 10 confirmed** (11th is `multi-window-shell`, rewritten separately):

  | Spec | Probe-walk lines (**re-derived**) | Brief said | Re-points onto |
  |---|---|---|---|
  | `internal-tab-menus` | `:42-47` | `:42-47` ✓ | `sheetWcId` |
  | `kebab-menu` | `:67-72` | `:67-72` ✓ | `sheetWcId` |
  | `menu-dismissal` | **`:82-86`** | `:55-58` ✗ | `sheetWcId` |
  | `menu-overlay` | **`:58-62`** | `:48-50` ✗ | `sheetWcId` |
  | `page-context-menu` | `:59-61` | `:59-61` ✓ | `sheetWcId` |
  | `tab-context-menu` | `:61-65` | `:61-62` (short) | `sheetWcId` |
  | `omnibox-suggestions` | `:43-44`, `:59` | ✓ | `sheetWcId` |
  | `tab-cycling` | `:39-42` | `:39-42` ✓ | `sheetWcId` |
  | `closed-tab-reopen` | `:99` | `:99` ✓ | `sheetWcId` |
  | `find-overlay-geometry` | **`:82-88`** | `:62-67` ✗ | **`findWcId`** |

  **The three that drifted are exactly the three specs the leg-1 exposure triple annotated** (`git status` → `M tests/behavior/{find-overlay-geometry,menu-dismissal,menu-overlay}.md`). The header annotations pushed their Preconditions down. **Diagnosable, not random** — and the reason the brief's numbers, taken from the pre-leg-1 flight spec, are wrong for exactly those three.
- **`tab-surface-geometry:60` — glanced, and it is a near-miss, not an 11th.** Verbatim: *"**mcp — corroborating**: the menu-overlay sheet's rendered menu via `readDom(sheetWcId)` **if probed**"*. Conditional and corroboration-only; it names no walk and builds no skip set. **Leave it** — re-pointing it would be scope creep. Optionally note `enumerateWindows` as the now-preferred resolve; do not restructure.
- **`find-overlay-geometry` probes the FIND overlay only** — verified: it uses `overlayWcId` (`:130`) and identifies by *"the find-bar markup"* (`:85`). Step 6 opens a kebab but brackets it via the chrome's `aria-expanded`, **never a probed sheet wcId**. So it is the single `findWcId` caller, exactly as DD2's find half predicts.
- **Leg-2's inherited dispositions (carry, do NOT re-derive):**
  - `foreground-to-act.md` — **draft / `Last Run: never`; not a gate, not a planned red.** Its **steps survive** (verified at this leg's design: step 3 `captureScreenshot`, step 5 `click`/`typeText` all still raise; its `readDom(A)` at step 5 is a read-back **after** `click(A)` already raised A). Its **Intent** (`:13`) and **Out of Scope** (`:44`) are falsified — the Out of Scope says *"Invisible/background driving … explicitly NOT a v1 capability … If a future 'drive without stealing focus' mode is added, cover it separately"* — **DD6 IS that mode**, for `readDom`/`evaluate`.
  - `observe-refusal-contract.md` — **not falsified**; draft/never-run; scoped to `readAxTree`'s tri-state; does not enumerate refusals exhaustively. **Optional**: fold in `capture-timeout` and `activate-refused`. Not an AC.
  - `tab-reorder.md` step-7 confound — **CHECKED AND REJECTED; do not re-raise.**
  - The in-repo consumer sweep for DD6 is **COMPLETE**; carried forward, not redone.
- **`tab-context-menu` step 3 — already-satisfied, retired.** `:120` already pins **Move to new window**; re-ran green 10/10 (`2026-07-15-06-05-04`). The audit's *"2 stale-enumeration rows"* (`:198`) is **1**: `kebab-menu` only. **Do not re-fix it.**
- **`kebab-menu` — the ONE genuinely owed stale row.** Header `:15-21` annotates STALE-ENUMERATION; the live model is **six items, order pinned**: New window, Settings, Downloads, Cookie jars, Print…, Exit. Its `Last Run` is `2026-06-07-10-42-52` (pre-F6).

## Outputs

- **New**: `tests/behavior/multi-window-automation.md` — the flight's headline spec, `Status: draft`.
- **Rewritten**: `tests/behavior/multi-window-shell.md` — full rewrite + the two-menus variant + the step-8 count.
- **Modified (re-point)**: `internal-tab-menus`, `kebab-menu`, `menu-dismissal`, `menu-overlay`, `page-context-menu`, `tab-context-menu`, `omnibox-suggestions`, `tab-cycling`, `closed-tab-reopen`, `find-overlay-geometry` — all under `tests/behavior/`.
- **Modified (restate)**: `closed-tab-reopen`, `kebab-menu`, `popup-jar-inheritance` — **3**, not 5 (see AC5).
- **Modified (errata)**: `find-overlay-geometry`, `menu-dismissal`, `menu-overlay`, `foreground-to-act`.
- **Modified (full-body)**: `kebab-menu` — the six-item refresh.
- **Modified**: `test/unit/automation-mcp-tools.test.js` — the description pin (AC13) + its control.
- **Modified**: `docs/mcp-automation.md` (AC17), `docs/behavior-specs-single-window-audit.md` (AC16).
- **Unchanged (PINNED)**: **every file under `src/`**, `scripts/`, `CLAUDE.md`, `eslint.config.mjs`, and every `test/unit/*.test.js` except `automation-mcp-tools.test.js`. **This leg touches no main-process source.** `tests/behavior/tab-surface-geometry.md` — pinned unless the optional note is taken.

## Acceptance Criteria

### A — the headline spec

- [x] **AC1** — **`tests/behavior/multi-window-automation.md` exists, `Status: draft`, `Last Run: never`**, and its Steps table covers **each** of the flight's Verification bullets. **Enumerated, not counted** — one row minimum per line:

  | # | Property | Read via |
  |---|---|---|
  | 1 | `enumerateWindows` discovery — **no probe walk** | `enumerateWindows()` resolves `chromeWcId`/`sheetWcId` exactly; **no id-space walk appears anywhere in the spec** |
  | 2 | all-windows `enumerateTabs` with `windowId` | rows from both windows in one array, each stamped |
  | 3 | `booted` as the completeness signal | a mid-boot window: `booted: false` ⇒ zero `enumerateTabs` rows |
  | 4 | `captureWindow({windowId})` | image content per window; wire shape unchanged |
  | 5 | **two sheets open simultaneously in two windows** | **`sheetVisible: true` on BOTH rows, two distinct `sheetWcId`s** |
  | 6 | DD6 — activating window B's background tab from window A **raises** B | `getChromeTarget().wcId` flips to B's chrome |
  | 7 | DD6 — `readDom` on one does **NOT** raise | `getChromeTarget().wcId` **unchanged** — with row 6 as the same-run **positive control** |
  | 8 | DD7 blur — per-window sheet dismissal scoping | dismiss A's sheet ⇒ **B's stays open** (`sheetVisible` A:false / B:true) |

- [x] **AC2** — **Row 7's no-raise assertion ships its positive control IN THE SPEC, not in the run log.** Row 7 is an **absence** claim. The spec text must require that row 6 (a raise the same instrument demonstrably reported, in the same run) is judged **before** it, and must say so. *This is the flight's root rule; leg 2's smoke did exactly this and it is why step 6 was a measurement rather than an instrument failure.* Same for row 3's mid-boot absence: it carries the leg-3 escape verbatim — **if the mid-boot window is never caught, record a sampling limit and DO NOT claim the observable.**

- [x] **AC3** — **The spec's apparatus premises are audited before its first run** (AUTHORING.md's "Unaudited apparatus premises"). Every concrete claim — tool names, auth tier, return shapes, refusal strings — is traced against working-tree code, **not** against the flight spec or this leg. Named premises to trace: `enumerateWindows` is **admin-only** (`scope.js`); its row shape; `enumerateTabs` returns a **plain array**; `captureWindow`'s image wire shape; `automation: no-such-window`. **Corrections to a draft spec before its first pass are authoring, not drift.**
  **Preconditions must state the apparatus is a hand-rolled SDK client over Bash — NOT a registered MCP** (the leg-1 false-block).

- [x] **AC4** — **The DD7 blur AC is EXPLICIT and its two halves are separated.** The rig-reachable half (AC1 row 8) is a real step. The **OS-blur half is NOT claimed live** and the spec's Out of Scope says so with its reason (WSLg delivers no blur — F6 spike verdict 4) **and its disposition**: pinned to a **non-WSLg desktop** with that precondition stated, **or** recorded as an **accepted permanent gap**. **The FD rules which; the leg records the ruling in the flight log.** An unqualified HAT ticket that silently cannot run is the named failure mode.

### B — `multi-window-shell`

- [x] **AC5** — **`multi-window-shell.md` is FULLY REWRITTEN**, and each falsification is discharged at the line it lives on. **Enumerated** (re-derived at this leg's design — do not take from the flight spec, whose list omits `:126`):

  | Line | Falsified by | Disposition |
  |---|---|---|
  | `:74-75` | DD1 | *"window-scoped … not an app census"* → **all-windows census; rows carry `windowId`** |
  | `:80-86` | DD5 + DD2 | *"ONE sheet … probe its wcId"* → **per-window sheets, resolved by `enumerateWindows().sheetWcId`; the walk is DELETED** |
  | `:122` (step 2) | **DD2 only** | census is DD1-**safe** (one window). Delete the *"Known-wcId skip set recorded"* clause |
  | `:123` (step 3) | DD1 | *"(now window-2-scoped) lists exactly one"* → **all-windows; filter by `windowId`** |
  | `:124` (step 4) | DD5 | *"**zero per-window overlay instances**"* → **inverted**: window 2 has its OWN sheet instance |
  | `:125` (step 5) | DD1 | *"(window-3-scoped) lists EXACTLY ONE"* → **filter by `windowId`** |
  | **`:126`** (step 6) | DD1 | *"window 3's census"* → **filter by `windowId`**. *(Omitted by the flight spec's list.)* |
  | `:127` (step 7) | DD1 | *"still lists T2 + T3"* → **filter by `windowId`** |
  | `:128` (step 8) | recon item 7 | **add the `ERR_ABORTED` history-entry count** (below) |
  | `:141-142` | DD3/DD4 | Out of Scope *"`captureWindow` multi-window semantics — F7 owns"* → **F7 landed it**; either assert it or re-scope to `multi-window-automation` |
  | `:153-157` | leg 3 | the pre-registered variant → **a real step/variant** (below) |

  **The `:59-67` DD9 authoring constraint** (*"NEVER `captureWindow`"*, *"its desktopCapturer best-size-match heuristic can capture the WRONG of two similar windows"*) — **DD4 deleted that heuristic.** Restate: `captureWindow({windowId})` binds by identity. **But S2 still holds** — the rig is Wayland, the branch is dead, so **the spec must not claim the mis-pick fix**. Per-wcId `captureScreenshot` stays the safe default; do not manufacture a `captureWindow` claim the rig can't back.

- [x] **AC6** — **The two-menus variant is a REAL step with a REAL observable, and it is no longer speculative.** `:153-157` pre-registered it *"impossible under the F6 roaming interim by design"*; leg 3's smoke **measured it**: both rows `sheetVisible: true`, distinct `sheetWcId`s **4** and **6**. The step reads **`enumerateWindows().sheetVisible`** (DD2's field exists precisely so this variant has an observable — flight DD2's shape ruling says so verbatim).

- [x] **AC7** — **Step 8 pins the `ERR_ABORTED` count.** Step 2 (`:122`) carries the COMMIT-SETTLE GATE naming `ERR_ABORTED`; step 8 (`:128`) asserts `goBack(R2)` → page 2 but **pins no entry count**. Add the expected **history-entry count** so a short history fails as a **named count mismatch**, not a confusing page mismatch. *(Recon item 7, "cheap" — and it is, but only because step 2's gate already established what the count should be. Read it off step 2's gate; do not invent it.)*

### C — the probe-walk re-point

- [x] **AC8** — **All 10 probe-walk specs re-point onto `enumerateWindows`; nine onto `sheetWcId`, `find-overlay-geometry` onto `findWcId`.** Use the **re-derived** table in Inputs — **three of the brief's ranges are stale**. Each spec's Preconditions replace the walk with an exact resolve. `enumerateWindows` is **admin-only** and every one of these specs is already admin — verify per spec, do not assume.

  **Kill the whole idiom, not just the walk.** Each of these carries a *"skip every `enumerateTabs` wcId and the chrome wcId — probing a background tab **activates** it"* rationale. **Leg 2's AC5 already killed that hazard** (`readDom`/`evaluate` no longer activate; `CLAUDE.md:388` records it). The skip set, the foreground-first warning, and *"discover once per run"* all go with the walk. **Do not leave a rationale for a mechanism that no longer exists** — that is the "green tests over now-unreachable code" class in prose form, which this flight has paid for three times.

  Verify (**line-anchored; control FIRST**):
  ```bash
  # CONTROL — the idiom is present BEFORE the edit (proves the grep can report presence)
  grep -lE 'probe|probed wcId' tests/behavior/*.md | wc -l          # BEFORE → record the number
  # ASSERTION — no walk survives in the 10
  grep -cE 'background-tab-safe|id-space|skipping every .enumerateTabs. wcId' \
    tests/behavior/{internal-tab-menus,kebab-menu,menu-dismissal,menu-overlay,page-context-menu,tab-context-menu,omnibox-suggestions,tab-cycling,closed-tab-reopen,find-overlay-geometry}.md   # AFTER → 0 each
  ```
  > `tab-surface-geometry.md` is **excluded by name** — its `:60` probe is conditional and corroboration-only.

- [x] **AC9** — **`tab-surface-geometry.md` is NOT re-pointed.** Its `:60` (*"via `readDom(sheetWcId)` **if probed**"*) is a near-miss: conditional, corroboration-only, no walk, no skip set. **Pinned unchanged** unless a one-line note naming `enumerateWindows` as the preferred resolve is taken — which must not restructure the spec. Recorded so a future sweep does not "discover" it as an 11th.

### D — the count-precondition restatement

- [x] **AC10** — **Exactly THREE specs are restated against the all-windows census: `closed-tab-reopen`, `kebab-menu`, `popup-jar-inheritance`.** Read off the tool — `grep -c enumerateTabs`: **11 / 6 / 1**. Their assertions (`closed-tab-reopen:95` byte-identical equality + `:100`/`:101` full-URL "NOWHERE"; `kebab-menu:121`/`:132`/`:139` tab count; `popup-jar-inheritance:47` *"total tab count equals boot tab + 4 opened"*) now mean **"all tabs in the app"** — which is what they always **meant** and now what they **measure**. DD1 *fixes* them rather than breaking them; state the single-window premise explicitly so a future two-window run does not silently under- or over-count.

- [x] **AC11** — **`tab-keyboard-operability` and `unified-tab-controls` are PINNED UNCHANGED — they have nothing to restate.** `grep -c enumerateTabs` → **0** for both. They count tabs **exclusively via `readAxTree(chromeWcId)`'s `tablist`** (`unified-tab-controls:71`; `tab-keyboard-operability`'s Observables), a **per-window instrument DD1 does not touch**. The audit's class-5 label marks *exposure*; its class definition assumed the instrument was `enumerateTabs`. **Verify with the grep before accepting this AC** — if either grows an `enumerateTabs` call, this AC is wrong and AC10 becomes 4 or 5. *(Record the numbers, not "verified".)*

### E — `kebab-menu`

- [x] **AC12** — **`kebab-menu.md`'s full body is refreshed to the SIX-item model, order pinned: New window, Settings, Downloads, Cookie jars, Print…, Exit.** **Five sites, enumerated** — the brief and the spec's own header annotation both name four:

  | Site | Line | Current |
  |---|---|---|
  | Title | `:1` | *"presence, **four items**, APG keyboard operation"* |
  | Intent | `:27` | *"exposing **exactly four items**, "Settings", …"* |
  | **Observables** | **`:116`** | *"the menu items (**count = exactly 4**, each `role="menuitem"`)"* — **missed by the brief AND by the header annotation** |
  | Step 3 | `:134` | *"**exactly four** `role="menuitem"` items … **No fifth item.**"* |
  | Step 5 | `:136` | *"`ArrowDown` moves focus Settings → Downloads → Print… → Exit"* — **arrow-nav order**, six-wide now |

  The header annotation (`:15-21`) is **retired** once folded — it says *"NOT yet folded into the steps"*. Step 5's wrap arithmetic changes (wrap from **Exit**, `Home`→**New window**, `End`→**Exit**). The stale *"four items since M04"* note at `:11-12` goes too.

### F — the queued errata

- [x] **AC13** — **`find-overlay-geometry.md`**, three errata, all from its header (`:12-23`):
  1. **The "may not composite the overlay view" caveat is DELETED — it is STALE AND ACTIVELY HARMFUL.** Verified twice against `main.js:681-709`: the WSLg composite **does** layer the window's own overlays bottom-up (guest → find → sheet). Left in place it *instructs a future Executor to defer a fully-assertable step to the HAT*. **The harm is the instruction, not the staleness** — delete the caveat *and* the "defer to the HAT if the fallback is active" clause it feeds (`:128`, step 6).
  2. **Step 8's accidental strengthening → a DELIBERATE assertion.** Currently `:130` is an *"(Optional) Reopen-check"*. Promote: **hide find → resize the window → reopen → assert the bar lands at the NEW guest's top-right.** This exercises `show()`'s live `getActiveGuestBounds()` fetch, where the **per-instance** `lastGuestBounds` fallback would strand it — **precisely leg 1's state-ownership change (S9), and currently reachable only by luck via the WSLg lag.** Drop "(Optional)".
  3. **`:123` — "Default jar" → "the default jar".** This build's fresh-profile default is named **`personal`**; no jar named "Default" exists.

- [x] **AC14** — **`menu-dismissal.md`**, five errata (four from its header `:19-33` + the citation repair), **and the four internal citations are corrected** (`:76-79`→**`:103`**, `:97-100`→**`:124-126`**, `:106-109`→**`:133-136`**, `:144-145`→**`:171-172`**):
  1. **Demote the AX `focused` node GLOBALLY.** It *"tracks the chrome document's `activeElement` and **persists even when that webContents holds no OS focus**"* — it cannot decide focus-vs-no-focus, reading identically whether focus was restored or not. It is currently **primary** at **`:133-136`** and in **step 6's row (`:158`)**. Invert the hierarchy: **`document.hasFocus()` is primary**; AX/`activeElement` is **context only**. *(Step 6 already carries a `hasFocus()` corroboration — promote it from corroboration to primary rather than adding a new one.)*
  2. **Name step 2's focus conjunct as a CONJUNCTION**: `document.hasFocus() === true` **AND** `activeElement === X`. Neither alone decides — `hasFocus()` can't say *which* element; `activeElement` can't say whether anyone holds focus. **An Expected Result with no named observable is how a broken parser came to confirm the expectation by malfunction.**
  3. **Document the `RootWebArea focused=true` false-positive** in the `focused`-property guidance at **`:133-136`** (which is otherwise correct).
  4. **Generalize `:103`'s "re-locate before each click — do NOT cache" into a coordinate-MEASUREMENT rule** covering **pixel probes**, not just clicks. A hardcoded pixel region broke step 9 for exactly this reason (the `▾` trigger shifts right as tabs are added) — the spec warned for clicks and the Executor honored it for clicks.
  5. **THE ROOT FIX — add the general rule: any absence assertion needs a same-run demonstration that the instrument can read presence.** The spec **already mandates this for pixels** (the sheet-compositing litmus) and **nothing equivalent for focus** — *"that asymmetry is where a broken instrument survived a full pass."* State it once, at spec scope, covering **every** instrument.
  > The blur-scoping warning (`:9-17`) **stays** — it is correct and hard-won (*"A spec's name is not its contract"*).

- [x] **AC15** — **`menu-overlay.md`'s three header errata (`:8-15`) are folded**, and the header's "unfolded pending the F7 leg-4 spec pass" note retired: (1) the find overlay needs the sheet's **multi-view typing rule** stated symmetrically — `typeText(guestWcId)` **silently misses** the find input and was caught only on pixels; (2) trigger `:hover` becomes a **declared mutable region** (or the driver is pinned to `evaluate`-clicks) — any injected-click run tints the last trigger and reproduces an undeclared step-6 band; (3) **step 6's Intent ("the guest region") and Expected Result ("Frame") disagree** — reconcile; that disagreement is what made the band ambiguous.

- [x] **AC16** — **`foreground-to-act.md`'s Intent (`:13`) and Out of Scope (`:44`) are corrected; its STEPS ARE NOT TOUCHED.** Verified at this leg's design: every step survives (step 3 `captureScreenshot`, step 5 `click`/`typeText` all raise; step 5's `readDom(A)` is a read-back **after** `click(A)` raised A). The Out of Scope's *"Invisible/background driving … explicitly NOT a v1 capability … If a future 'drive without stealing focus' mode is added, cover it separately"* is **falsified — DD6 IS that mode**, for `readDom`/`evaluate`. **Name the read/act asymmetry as a contract line** (DD6's predicate: *an op that needs rendered output raises; an op that reads live JS/DOM state does not*). It stays **`draft` / `Last Run: never` — not a gate, not a planned red.** Do not promote it; do not run it.

### G — the description pin

- [x] **AC17** — **The DD9 pin is extended to cover `description` for the four topology-bearing tools**, in `test/unit/automation-mcp-tools.test.js`. **The descriptions themselves need NO fix — leg 3 already corrected both DD3 ones** (verified verbatim at this leg's design; see Context). **This AC is the PIN only.** `listTools` projects `description` (`mcp-tools.js:609`, pinned `:82-90`), so **a description can lie to every consumer while all 30 tools, every schema, and every count stay green** — the S10 class in the one field DD9 doesn't cover, and *a description is what an agentic consumer actually reads to decide how to call a tool.*

  Pin **contract-bearing substance**, not prose (a pin on exact wording is a rename-tripwire, not a contract). Enumerated:

  | Tool | Must assert |
  |---|---|
  | `enumerateTabs` | `/all windows/i` **AND** `/windowId/` **AND** `/booted/` |
  | `captureWindow` | `/windowId/` **AND** `/optional/i` **AND** `/no-such-window/` **AND** that it returns **pixels, not topology** |
  | `getChromeTarget` | `/admin only/i` **AND** `/windowId/` **AND** `/no-such-window/` |
  | `enumerateWindows` | `/admin only/i` **AND** `/booted/` **AND** `/sheetVisible/` **AND** `/lastFocused/` **AND** that `lastFocused` is **not an OS-focus claim** |

  **The pin must be proven capable of failing** — a same-run synthetic fixture (an in-test tool object whose `description` omits the token) is **rejected by the same assertion helper**. Without it the pin is an absence confirmed by an instrument never shown able to report presence. *Follow AC16's precedent from leg 3 verbatim.*

  Record, as numbers: the seven **pre-existing** description pins (`:147`, `:577`, `:753-755`, `:765-767`, `:831`, `:838`, `:1092-1095`) are **untouched** — this AC **adds four**, it does not rewrite the file's approach.

### H — docs and the audit

- [x] **AC18** — **The five prose op-count pins are VERIFIED at 30 — they are already correct; this AC does not edit them.** Re-derived at this leg's design; **two of the brief's five line numbers had drifted**:

  | Site | Brief said | **Actual** | Reads |
  |---|---|---|---|
  | `src/main/automation/mcp-tools.js` | `:577` | **`:591`** | `= 30 (Leg 3 + Flight 6 + …` |
  | `src/main/automation/mcp-server.js` | `:358` | `:358` ✓ | *"the 30 tools wired over a per-session"* |
  | `docs/mcp-automation.md` | `:19` | `:19` ✓ | *"advertises **30 tools**"* |
  | `docs/mcp-automation.md` | `:394` | **`:441`** | *"All 30 tools below match … exactly"* |
  | `CLAUDE.md` | `:452` | `:452` ✓ | *"The server advertises **30 tools**"* |

  Verify (**controls FIRST; `; true` after each — `grep -c` exits 1 on 0, which silently broke a leg-3 control chained with `&&`**):
  ```bash
  # CONTROL (positive): the count guard's own value — the pin every site must match
  grep -cE '^const EXPECTED_TOOL_COUNT = 30;$' test/unit/automation-mcp-server.test.js ; true   # → 1
  # CONTROL (negative): the guard can report the OLD value's absence
  grep -rn 'EXPECTED_TOOL_COUNT = 29' test/unit/ ; true                                          # → 0 hits
  # ASSERTION: no site still says 29
  grep -n '29 tools\|All 29 tools' docs/mcp-automation.md src/main/automation/mcp-server.js CLAUDE.md ; true   # → 0
  grep -cE '= 29 \(' src/main/automation/mcp-tools.js ; true                                     # → 0
  # ASSERTION: each of the five reads 30 (enumerated — run each, record each)
  grep -c '30 tools' docs/mcp-automation.md ; true          # → ≥1  (:19)
  grep -c 'All 30 tools below' docs/mcp-automation.md ; true # → 1   (:441)
  grep -c 'the 30 tools' src/main/automation/mcp-server.js ; true  # → 1 (:358)
  grep -cE '= 30 \(' src/main/automation/mcp-tools.js ; true # → 1   (:591)
  grep -c 'advertises \*\*30 tools\*\*' CLAUDE.md ; true     # → 1   (:452)
  ```

- [x] **AC19** — **NEW: `docs/mcp-automation.md`'s section-heading counts SUM to the declared tool count.** They do **not** today. **Read off the tool:**
  ```
  Drive (18) + Observe (4) + Eval (2) + DevTools (2) + Admin chrome/app-level (2) + History (1) = 29
  grep -c "^    name: '" src/main/automation/mcp-tools.js                                        = 30
  ```
  **`:533` must read `### Admin chrome / app-level (3)`** — its own table lists three rows (`getChromeTarget`, `enumerateWindows`, `downloadsList`) and the overview at `:20-21` already says *"3 admin chrome/app-level tools"*. **`:535`'s "Both tools are admin-only" → "All three"**, and *"A jar key calling **either**"* → *"any of the three"*.

  **This is the flight's signature error one more time**, and it is worth stating plainly: leg 3's AC8 enumerated seven **total**-count sites and landed all seven — a **category** count in a subsection heading was not among them. **The AC is therefore written as the SUM, not as a site list**, because a site list is exactly what missed it:
  ```bash
  # CONTROL: the tally the sum must equal
  grep -c "^    name: '" src/main/automation/mcp-tools.js ; true       # → 30
  # ASSERTION: the six headings, enumerated and summed BY READING THEM
  grep -nE '^### (Drive|Observe|Eval|DevTools|Admin chrome / app-level|History) tools?.*\([0-9]+\)|^### Admin chrome / app-level \([0-9]+\)' docs/mcp-automation.md ; true
  #   → six lines; sum the parenthesized numbers; MUST equal 30
  ```

- [x] **AC20** — **`docs/behavior-specs-single-window-audit.md` is annotated as DISCHARGED**, in place (not deleted — it is an inspection record, and its per-spec table is the corpus's only classification). The annotation must record, **enumerated**, what F7 actually did to each open item in its F7 consumption note (`:163-199`):
  - **`enumerateTabs` scope** → DD1: all-windows + `windowId`.
  - **`getChromeTarget` arity** → DD3: optional `windowId`; omitted = last-focused.
  - **`captureWindow` signature** → DD3/DD4: optional `windowId`, identity-bound; **wire shape unchanged**; the mis-pick caveat retired **but NOT claimed live (S2)**.
  - **Overlay discovery** → DD2: `enumerateWindows`; the walk is retired for all 10 + `multi-window-shell`.
  - **Foreground-to-act under N windows** → DD6: acts raise, reads don't.
  - **Capture-vs-re-parent race** → DD7: five guards, named refusal.
  - **The sequencing order (`:196-199`) was FOLLOWED** — and its own arithmetic **corrected**: *"the **2** stale-enumeration rows"* is **1** (`tab-context-menu` was already satisfied — S7, retired at recon); *"the **5** count-precondition specs"* is **3** for restatement purposes (AC10/AC11).
  - **S7 stands**: the audit drifted within hours of authorship. **Annotate that the per-spec table is dated as of F7 leg 4**, so F8 does not sequence off it blind.

### Records and hygiene

- [x] **AC21** — `npm test` green with **≥ 1831** (the leg-3 baseline, verified by running it at this leg's design). `npm run lint` exit 0. `npm run typecheck` exit 0. **`npm run a11y` GREEN (exit 0), all six `sheet:*` states reached** — mandatory. *(It resolves the sheet via `enumerateWindows` since leg 3; the per-state control is real — `a11y-audit.mjs:419-421` **throws with the state label** on anything but `'escaped'`, so exit 0 means all six opened, were audited, and closed.)*
- [x] **AC22** — **`wc -l src/main/main.js` is RECORDED at landing, and this leg's delta is recorded SEPARATELY.** Baseline **3517**. **This leg is expected to add ZERO** — it edits no main-process source. **Total overage vs the flight's net ≤3461 target is 56 (8 from leg 2, 48 from leg 3) — a RECORDED MISS, NOT A GATE**, per the FD's standing ruling. If this leg's delta is not 0, that is a scope escape: say so.
- [ ] **AC23** — **Every file under `src/`, `scripts/`, plus `CLAUDE.md` and `eslint.config.mjs`, is byte-unchanged by this leg.** Verify by tool, do not assert. *(`test/unit/automation-mcp-tools.test.js` is the ONE test file this leg touches — AC17.)*
- [x] **AC24** — The flight log carries a leg-4 landing entry (see Post-Completion Checklist), including the AC4 FD ruling on the blur HAT.

### The live proof — the FD's, not the Developer's

- [x] **AC25** — **`/behavior-test multi-window-automation` passes** (FD-orchestrated, Witnessed). Its first run is also its premise audit's proof (AC3).
- [ ] **AC26** — **`/behavior-test multi-window-shell` passes, with its two-menus variant** (FD-orchestrated). It has been a **planned red since leg 1**; this is its first green since the rewrite. **A failure here is a spec problem until proven otherwise** — the underlying behavior was proven at leg 1's smoke (two sheets, per-window destroy) and leg 3's smoke (32/32).
- [ ] **AC27** — **The five remaining AC13 invariant specs re-run green after the re-point** (FD-orchestrated): `kebab-menu`, `internal-tab-menus`, `page-context-menu`, `tab-context-menu`, `tab-surface-geometry`. *(The FD's leg-1 scoping ruling ran the exposure triple — `menu-overlay`, `find-overlay-geometry`, `menu-dismissal` — and deferred these five to leg 4 "when they are re-pointed onto `enumerateWindows`". **That is now.** The triple also re-runs, since AC13/AC14/AC15 modify all three.)*

## Verification Steps

### Offline (the Developer)

```bash
# AC21
npm test && npm run typecheck && npm run lint
npm run a11y                      # → exit 0, all six sheet:* states

# AC22 — record the number AND the delta separately. Baseline 3517; expected delta 0.
wc -l src/main/main.js

# AC23 — this leg touches NO main-process source. Enumerate what changed; do not assert.
git status --short src/ scripts/ CLAUDE.md eslint.config.mjs      # → empty beyond legs 1-3's files
git diff --stat src/ scripts/ CLAUDE.md eslint.config.mjs         # → identical to the pre-leg-4 diff

# AC18 / AC19 — see the AC bodies. RUN EVERY CONTROL, terminate each with `; true`.
#   `grep -c` EXITS 1 WHEN THE COUNT IS 0 — a leg-3 control chained with && never ran because
#   a CORRECT 0 broke the chain and nothing failed. Report NUMBERS, not "passed".

# AC8 — the walk is gone from the 10 (control first)
grep -lE 'probe|probed wcId' tests/behavior/*.md | wc -l          # BEFORE → record
grep -cE 'background-tab-safe|id-space|skipping every .enumerateTabs. wcId' \
  tests/behavior/{internal-tab-menus,kebab-menu,menu-dismissal,menu-overlay,page-context-menu,tab-context-menu,omnibox-suggestions,tab-cycling,closed-tab-reopen,find-overlay-geometry}.md ; true   # AFTER → 0 each

# AC10 / AC11 — the count instrument, read off the tool. RECORD THE NUMBERS.
for f in closed-tab-reopen kebab-menu popup-jar-inheritance tab-keyboard-operability unified-tab-controls; do
  echo -n "$f "; grep -c enumerateTabs tests/behavior/$f.md ; true
done
#   → 11 / 6 / 1 / 0 / 0.  The two ZEROS are AC11: nothing to restate.
#     If either zero is now non-zero, AC11 is WRONG and AC10 grows. Say so.

# AC12 — the six-item refresh, all five sites
grep -nE 'four|exactly 4' tests/behavior/kebab-menu.md ; true      # AFTER → 0 substantive hits
```

> **Grep-AC discipline — ROOT-CAUSED in this flight as a design fault, not four unlucky mistakes.** Four failed before leg 3, **all** passing on wrong code or failing on correct code, because the legs demand *"keep every earned comment"* while the greps count the tokens those comments must cite. The decisive control: `observe.js`, the repo's canonical Electron-free exemplar, **FAILS** `grep -c "require('electron')" → 0`. Every grep above is **line-anchored / syntax-agnostic**, and **ships a CONTROL that is RUN**. Leg 3's were the first to survive contact — these copy their shape. **If you need a new grep-AC, run it against a candidate correct diff before it ships.** For real rigor, `broadcast-invariant.test.js`'s `maskComments`/`findMatchingBracket` toolkit is the house solution.

### Live (the FD, after the Developer lands)

`/behavior-test multi-window-automation` → `/behavior-test multi-window-shell` (+ variant) → the five re-pointed AC13 specs (AC27) → flight-end review → **the single commit**.

## Implementation Guidance

> **Order matters.** It follows the audit's own sequencing (`:196-199`), corrected: the stale-enumeration row first, then the probe-walk re-point, then the count restatements, then the capture-dependent work. Each step's edits are independent of the next's — a stop between any two leaves the tree coherent.

### 1. Re-verify before editing anything (the audit is DATED — S7)

Print every range you are about to touch and read it. **The three specs whose ranges drifted are `find-overlay-geometry`, `menu-dismissal`, `menu-overlay`** — exactly the three the leg-1 triple annotated. Use the re-derived table in Inputs; **do not** use the flight spec's or the brief's numbers. *(This is not defensive boilerplate: 6 of ~30 citations in the brief were wrong, and the flight has measured this rate nine times.)*

### 2. `kebab-menu.md` — the full-body refresh (AC12)

Five sites (`:1`, `:27`, **`:116`**, `:134`, `:136`). Model: **New window, Settings, Downloads, Cookie jars, Print…, Exit**. Step 5's arrow-nav arithmetic changes throughout — wrap from **Exit** → New window; `Home` → **New window**; `End` → **Exit**. Retire the header annotation (`:15-21`) and the stale *"four items since M04"* note (`:11-12`). **Read the live model off `multi-window-shell.md:124`'s F6 list and the audit's leg-4 note — then confirm against the renderer, not against either.**

### 3. The probe-walk re-point (AC8, AC9)

Per spec: replace the walk block with an `enumerateWindows()` resolve. Sketch (adapt to each spec's voice — these specs are written for a human reader, so **do not** paste an identical block ten times):

> **Sheet wcId discovery — `enumerateWindows` (M09 F7 DD2).** The sheet is a per-window `WebContentsView`, never in `enumerateTabs`. Resolve it **exactly**: `enumerateWindows()` returns one row per window carrying `sheetWcId` (**absent** until the sheet is first created — it is lazy) and `sheetVisible`. Take the row for the window under test. Admin-only, like `getChromeTarget`. *No id-space walk, no skip set, no "discover once per run" — DD2 retired all three.*

**Delete the whole rationale, not just the loop**: the skip set, the *"probing a background tab activates it"* warning (leg 2's AC5 killed that hazard — `CLAUDE.md:388` records it), and *"discover once per run"* (per-window instances make it wrong anyway). `find-overlay-geometry` takes the same shape with **`findWcId`/`findVisible`**.

Watch for: `omnibox-suggestions:59`'s *"or identified lazily after step 2's first open"* — **that nuance survives and is now first-class** (`sheetWcId` absent ⇒ never created). `closed-tab-reopen:99` is a single inline clause, not a Preconditions block.

### 4. The count restatements (AC10, AC11)

Three specs. Make the single-window premise **explicit** rather than implicit — the assertion now measures what it always meant. `popup-jar-inheritance:47` is the sharpest (*"total tab count equals boot tab + 4 opened"* — the audit flagged it *"OUTRIGHT FAILS if any tab lives in another window"*; under DD1 it is now **correct by construction**, and the premise to state is that the run keeps one window).

**Do not touch `tab-keyboard-operability` or `unified-tab-controls`.** Run the grep first and record the zeros.

### 5. The errata (AC13, AC14, AC15, AC16)

Fold from each spec's header, then **retire the annotation** — a folded erratum that leaves its "not yet folded" banner up is a false signal to the next reader. **Fix the four stale internal citations in `menu-dismissal`'s header as you go** (+27 each).

`menu-dismissal`'s root fix (AC14.5) is the load-bearing one and belongs at **spec scope**, not in a step:

> **Presence before absence — every instrument, not just pixels.** Any Expected Result asserting an **absence** requires a same-run measurement of a **known-present** case with the **same instrument**. This spec has always required it for pixels (the sheet-compositing litmus); it applies identically to focus, AX, and DOM reads. An instrument that reported nothing has not shown it can report something.

### 6. `multi-window-shell.md` — the full rewrite (AC5, AC6, AC7)

Rewrite once, now that DD1+DD2+DD5 are all landed. Work the table in AC5 line by line. Load-bearing:

- **Preconditions**: the DD9 authoring constraint (`:59-67`) — DD4 deleted the mis-pick heuristic, so restate it; but **S2 still holds** (Wayland ⇒ the branch is dead code on this rig), so **keep per-wcId `captureScreenshot` as the default and claim nothing about the mis-pick fix.**
- **`:80-86`** → per-window sheets via `enumerateWindows().sheetWcId`. This is the spec that *named* the roaming singleton; its rewrite is the corpus's clearest statement that DD5 landed.
- **Steps 3/5/6/7** → filter the all-windows census by `windowId`. **Step 6 (`:126`) is in this set and the flight spec's list omits it.**
- **Step 2 (`:122`)** → the census assertion **stands**; delete only the skip-set clause.
- **Step 4 (`:124`)** → *"zero per-window overlay instances"* **inverts**.
- **Step 8 (`:128`)** → add the `ERR_ABORTED` history-entry count, read off step 2's gate.
- **`:141-142`** Out of Scope (*"`captureWindow` multi-window semantics — F7 owns"*) → F7 landed it; re-scope to `multi-window-automation` or assert it.
- **`:153-157`** → the variant becomes real (AC6).

### 7. `multi-window-automation.md` — author it (AC1–AC4)

`Status: draft`, `Last Run: never`. **Do not run it** — authoring produces the spec; the FD runs it.

**Preconditions** (each operator-checkable; the apparatus premise is the one that has bitten):
- App via `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`; admin key **via env var only, never a command literal**.
- **The apparatus is a hand-rolled SDK client over Bash** (`scripts/mcp-example-client.mjs` is the template), the SDK imported by **absolute `dist/esm` path** (the runner sits outside the tree; ESM ignores `NODE_PATH`). **It is NOT a registered MCP** — an Executor scanning for one will falsely block (leg 1).
- Fresh scratch profile; fixture pages with distinct titles.
- **Boot bracket**: snapshot `enumerateTabs()`/`enumerateWindows()` **immediately on connect**, before any setup lull.

**Observables Required**: mcp (admin client) — `enumerateWindows` (topology, `booted`, `sheetVisible`), `enumerateTabs` (`windowId`), `getChromeTarget` (the raise observable), `captureWindow`, `readDom`, `activateTab`; browser (rendered pixels via `captureScreenshot`).

**Steps** — one row per logical checkpoint, imperative Actions, observable Expected Results. Sketch (the FD/operator may reorder; the **eight AC1 properties are the contract**):

| # | Actions | Expected Results |
|---|---|---|
| 1 | Connect admin client. `enumerateWindows()`. | **One** row: `booted: true`, `lastFocused: true`, numeric `chromeWcId`; **`sheetWcId` and `findWcId` ABSENT**; `sheetVisible`/`findVisible` false. ⇒ *absent ⇒ never created* (lazy) holds live. |
| 2 | `enumerateTabs()`. Open a second tab **T**. | Every row carries `windowId`. The result **is a plain array** — no own properties beyond indices. |
| 3 | Tab-context-menu on **T** → **Move to new window** (the **REAL** menu, reached via the `enumerateWindows`-resolved sheet wcId — never a synthesized IPC). Poll `enumerateWindows()`+`enumerateTabs()` tightly from the moment the click returns. | A poll catches window 2 `booted: false` **and** `enumerateTabs()` returning **zero rows for window 2** — *even though T is already in its `tabViews`*. Then `booted` flips true and T appears with `windowId` = 2. **If never caught: record a SAMPLING LIMIT and DO NOT claim the observable.** |
| 4 | `enumerateTabs()` with T settled. | Rows from **BOTH** windows in **one** array, each with its own `windowId`, window 1's first (registry insertion order). |
| 5 | Open the kebab in window 1 **and** window 2, leaving both open. `enumerateWindows()`. | **BOTH** rows `sheetVisible: true`, **two distinct `sheetWcId`s**. ⇒ the roaming singleton is retired — impossible under F6 **by construction**. |
| 6 | **DD7 blur — per-window dismissal scoping.** With both sheets open: `pressKey(<window 1 sheetWcId>, 'Escape')`. `enumerateWindows()`. | Window 1 `sheetVisible: false`; **window 2 `sheetVisible: true` — UNAFFECTED.** ⇒ per-window sheet scoping. *(The OS-blur half is Out of Scope — see AC4.)* |
| 7 | **DD6 raise (the POSITIVE CONTROL for step 8).** Re-baseline to window 1. `getChromeTarget().wcId` → record. `activateTab(<window-2 background tab>)`. `getChromeTarget().wcId`. | `activateTab` returns **`true`** (not a discarded `false`, not a throw) and `getChromeTarget().wcId` **FLIPS to window 2's chrome**. ⇒ the raise happened **and the instrument demonstrably reports a raise**. |
| 8 | **DD6 no-raise.** Re-baseline to window 1. `readDom(<window-2 background tab>)`. `getChromeTarget().wcId`. | `readDom` returns the tab's **live DOM** (the read works on a background-window guest — the substance of the change) **and `getChromeTarget().wcId` is UNCHANGED**. ⇒ **no raise — a MEASUREMENT, not an instrument failure**, because step 7 showed this same instrument reporting a raise in this same run. |
| 9 | `captureWindow()`; `captureWindow({windowId: <window 2>})`; `captureWindow({windowId: 999999})`. | The first two return **normal image content** (wire shape unchanged). The third refuses **`automation: no-such-window`**. **NOTE: this proves the `windowId` param ROUTES; it proves NOTHING about DD4's mis-pick fix** (S2 — the rig is Wayland; `desktopCapturer` is skipped and the identity bind never executes). Do not record it as DD4 evidence. |

**Out of Scope** (name it, or the spec drifts to "the test that checks everything"):
- **OS-level blur delivery across windows** — WSLg delivers no blur to a scripted stimulus (F6 spike verdict 4). **AC4's disposition applies: pinned to a non-WSLg desktop, or an accepted permanent gap. Record the FD's ruling.**
- **The `captureWindow` mis-pick fix (DD4)** — S2: dead code on this rig; unit-scoped (`capture-source-picker.test.js` 9/9) + HAT-scoped. **Never claimed live.**
- **The OS compositor actually raising window B** — `getChromeTarget` reads `getLastFocused()`, which **the raise itself seeds**. Steps 7/8 prove the **main-side raise contract**, never the compositor. *(Leg 2's HONESTY NOTE, carried verbatim — do not let a reader infer more than the rig gave.)*
- Tear-off / cross-window drag — **F8**.
- `multi-window-shell`'s lifecycle/re-parent surface — that spec owns it.

### 8. The description pin (AC17)

`test/unit/automation-mcp-tools.test.js`. **The descriptions are already correct — pin them, do not rewrite them.** Extend the existing per-tool description idiom (`:147`, `:577`, `:753-755` are the house shape) with the four-tool table from AC17. **Ship the synthetic-fixture control and RUN it.**

### 9. Docs + the audit (AC18, AC19, AC20)

`:533`/`:535` (AC19) is a real, live defect — fix it and **record it as a find**, since it is the flight's signature pattern surviving into leg 3's own count sweep. Run the AC18 greps as **verification**; if any site is wrong, that is a leg-3 escape — record it rather than quietly fixing it. Then annotate the audit (AC20), correcting its 2→1 and 5→3 arithmetic in place.

## Edge Cases

- **`enumerateWindows` is admin-only; some specs may connect as a jar key.** Every probe-walk spec is admin today (the walk needed admin), **but verify per spec** — a jar-key spec re-pointed onto an admin op fails at the resolve with `automation: admin-only`. If one is found, that is a real finding: the walk let a non-admin reach the sheet by id, and DD2 closes it deliberately.
- **`sheetWcId` is ABSENT before the first menu open.** A spec that resolves the sheet in its Preconditions (before opening a menu) gets `undefined`, not an error. The resolve must sit **after** the first open — `omnibox-suggestions:59` already says so; the others must not regress into resolving too early. **This is the failure mode the re-point most plausibly introduces.**
- **`sheetVisible: false` with `sheetWcId` present** = instantiated-but-hidden. A spec asserting "no menu open" must read **`sheetVisible`**, never id absence. DD2 separated the fields for exactly this.
- **The two-menus variant needs both sheets to STAY open.** Any action that dismisses one (a stray click, a `tab-switch`, an Escape to the wrong wcId) collapses the observable. Open window 2's menu **last** and read `enumerateWindows()` immediately.
- **Step 3's mid-boot window is a narrow timing window.** Leg 3 caught it on poll 1 — but that is not a guarantee. **The escape hatch is mandatory**: record a sampling limit; do not claim the observable; fall back to the unit pin (`booted: false` ⇒ zero rows, positive-controlled).
- **`grep -c` exits 1 when the count is 0.** A leg-3 control chained with `&&` **never ran** because a *correct* `0` broke the chain — and nothing failed. Terminate every grep with `; true` and run controls **isolated**.
- **A grep-AC over spec prose is the comment-blind class inverted**: here the prose **is** the artifact. Line-anchor and scope by filename; do not grep the whole corpus for a token that legitimately appears in a spec's *history* note.
- **`foreground-to-act` must not be promoted.** It is `draft`/never-run. Fixing its prose does not make it a gate. Do not run it; do not set `active`.
- **`multi-window-shell`'s rewrite could fail its first run for spec reasons.** The underlying behavior is proven (leg 1 smoke: two sheets, per-window destroy, clean quit; leg 3 smoke: 32/32). **Treat a first-run failure as a spec defect until the evidence says otherwise** — and re-read the run log before touching source.
- **Do not re-fix `tab-context-menu` step 3.** Already satisfied (`:120`), green 10/10. The audit's `:198` overstates.

## Files Affected

- `tests/behavior/multi-window-automation.md` — **NEW** (draft).
- `tests/behavior/multi-window-shell.md` — **full rewrite** + variant + step-8 count.
- `tests/behavior/kebab-menu.md` — re-point + **six-item full-body refresh** (5 sites) + restatement.
- `tests/behavior/find-overlay-geometry.md` — re-point (**`findWcId`**) + 3 errata.
- `tests/behavior/menu-dismissal.md` — re-point + 5 errata + **4 stale internal citations**.
- `tests/behavior/menu-overlay.md` — re-point + 3 errata.
- `tests/behavior/internal-tab-menus.md`, `page-context-menu.md`, `tab-context-menu.md`, `omnibox-suggestions.md`, `tab-cycling.md` — re-point.
- `tests/behavior/closed-tab-reopen.md` — re-point + restatement.
- `tests/behavior/popup-jar-inheritance.md` — restatement.
- `tests/behavior/foreground-to-act.md` — Intent + Out of Scope **only** (stays draft).
- `test/unit/automation-mcp-tools.test.js` — the description pin + control.
- `docs/mcp-automation.md` — AC19's `:533`/`:535`.
- `docs/behavior-specs-single-window-audit.md` — discharged annotation.
- `missions/09-tab-management/flights/07-multi-window-shell-2/flight-log.md`, `flight.md`, this leg.
- **PINNED UNCHANGED**: all of `src/`, all of `scripts/`, `CLAUDE.md`, `eslint.config.mjs`, every `test/unit/*.test.js` except `automation-mcp-tools.test.js`, `tests/behavior/tab-surface-geometry.md`, `tests/behavior/observe-refusal-contract.md`.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified — **each grep-AC's control RUN and reported as a NUMBER, not as "passed"**
- [ ] `npm test` ≥ 1831 green; `lint` 0; `typecheck` clean; **`npm run a11y` green, six sheet states**
- [ ] `wc -l src/main/main.js` recorded **and this leg's delta recorded separately** (baseline 3517; expected 0)
- [ ] Update `flight-log.md` with the leg-4 landing entry, recording:
  - [ ] **The FD's AC4 ruling on the DD7 blur HAT** — non-WSLg pin **or** accepted permanent gap. **Not left ambiguous.**
  - [ ] **Item G's premise was FALSE** — leg 3 had already fixed both DD3 descriptions; this leg landed the **pin only**. And the "nothing pins a description" claim was over-broad: **7 tools already had pins**; the gap was the topology-bearing **4**.
  - [ ] **Item D's 5 → 3** — `tab-keyboard-operability` and `unified-tab-controls` count via `readAxTree`'s tablist (`grep -c enumerateTabs` → **0**/**0**), untouched by DD1. *(The tenth instance of the count/enumeration pattern.)*
  - [ ] **Item E's 4 → 5 sites** — `kebab-menu:116` missed by the brief **and** by the spec's own header annotation. *(The eleventh.)*
  - [ ] **AC19's NEW find** — `docs/mcp-automation.md:533` `(2)` vs a 3-row table; the six headings summed to **29** against a declared **30**. **Leg 3's AC8 enumerated seven *total*-count sites and missed a *category* count** — the same shape, one level down. The AC is written as the **sum** because a site list is what missed it.
  - [ ] **Six brief citations corrected**: `mcp-tools.js:577`→**`:591`**; `docs/mcp-automation.md:394`→**`:441`**; `menu-dismissal:55-58`→**`:82-86`**; `menu-overlay:48-50`→**`:58-62`**; `find-overlay-geometry:62-67`→**`:82-88`**; `automation-mcp-server.test.js:26`→**`:27`**. **The three drifted spec ranges are exactly the three the leg-1 triple annotated** — diagnosable, not random.
  - [ ] **`multi-window-shell`'s census list omitted `:126` (step 6)**, and the brief's "steps 2/3/5/6/7" over-included step 2 (DD2-falsified, not DD1).
  - [ ] **`menu-dismissal`'s errata header cited four stale internal lines** (uniform **+27**) — citation drift *inside* the artifact documenting it.
  - [ ] `multi-window-shell` **out of planned-red**; the AC13 five re-run (AC27)
  - [ ] Every number **read off the tool at the moment of writing** — the flight's ninth scalp was a landing entry that wrote a count from memory under a heading saying it had not
- [ ] Set this leg's status to `completed`
- [ ] Check off `spec-realignment-and-verify` in `flight.md`
- [ ] **Final leg of flight:**
  - [ ] `flight.md` status → `landed`
  - [ ] Check off the flight in `mission.md`
  - [ ] **Flight-end review**, then **the single commit** (code + artifacts together — this flight commits once)
  - [ ] PR opened, stacking on `flight/6-multi-window-1` (operator merges)

---

## Citation Audit

**37 citations verified against the working tree at leg design.** Every `file:line` below was **printed and read**, never carried from the flight spec, the audit, the brief, or another leg.

**Verified OK (24)**: `main.js` 3517 (`wc -l`); `npm test` 1831/13; `mcp-tools.js` tool defs `:120`/`:412`/`:542`/`:548`, `listTools` `:620`, projection `:609`, tally `:591`; `grep -c "^    name: '"` → 30; `mcp-server.js:358`; `docs/mcp-automation.md:19`, `:20-21`, `:441`, `:360`, `:439`, `:533`, `:535`; `CLAUDE.md:452`; `multi-window-shell` `:74-75`, `:80-86`, `:122`-`:128`, `:141-142`, `:153-157`; `kebab-menu` `:1`/`:11-12`/`:15-21`/`:27`/`:116`/`:134`/`:136`; `tab-surface-geometry:60`; `foreground-to-act` `:13`/`:44`; audit `:126-138`/`:163-199`/`:196-199`; probe-walk ranges for `internal-tab-menus`, `page-context-menu`, `omnibox-suggestions`, `tab-cycling`, `closed-tab-reopen`, `kebab-menu`.

**Drift REPAIRED (6)** — all six inherited from the brief; each repaired inline above:

| Citation | Brief/source said | **Actual** | Cause |
|---|---|---|---|
| `mcp-tools.js` tally | `:577` | **`:591`** | leg 3 added the `enumerateWindows` def above it |
| `docs/mcp-automation.md` "All N tools" | `:394` | **`:441`** | leg 3 rewrote `## Multi-window semantics` |
| `menu-dismissal` probe walk | `:55-58` | **`:82-86`** | leg-1 triple's errata header (+27) |
| `menu-overlay` probe walk | `:48-50` | **`:58-62`** | leg-1 triple's errata header |
| `find-overlay-geometry` probe walk | `:62-67` | **`:82-88`** | leg-1 triple's errata header |
| `EXPECTED_TOOL_COUNT` | `:26` (flight spec **and** leg 3) | **`:27`** | pre-existing; carried twice |

**Drift found INSIDE an artifact (4)** — `menu-dismissal`'s own errata header cites `:76-79`, `:97-100`, `:106-109`, `:144-145`; all are **+27** stale (`:103`, `:124-126`, `:133-136`, `:171-172`). Repaired by **AC14**, not here — they are content this leg edits.

**Enumeration errors found in the brief (3)** — not citations, but the same class; each corrected above and carried to the log: item D's 5→**3**; item E's 4→**5**; `multi-window-shell`'s census list omitting **`:126`**.

**Premises found FALSE (2)** — item G's *"both descriptions currently assert the OLD contract"* (leg 3 already fixed them) and *"nothing pins a tool DESCRIPTION"* (7 pins exist). Item H's five prose pins are **already 30**; the leg owes verification, not edits.

> **The audit's own lesson, applied to itself.** Leg 3's Citation Audit carried **four drifted rows inside its "verified OK" list**, and a fifth inside the correction of one — *"the leg written to stop citation drift carried drift in the very claim it sells."* Every row above was re-printed at the final verification pass. **6 of ~30 brief citations were wrong (20%)** — consistent with the rate this flight has now measured nine times, and the reason the brief's instruction *"every line number in THIS BRIEF is suspect"* was correct.
