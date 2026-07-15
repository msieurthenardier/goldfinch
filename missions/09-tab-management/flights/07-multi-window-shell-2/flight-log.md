# Flight Log: Multi-Window Shell, Part 2

**Flight**: [Multi-Window Shell, Part 2](flight.md)

## Summary

_(Flight in planning — recon complete, design under review.)_

---

## Reconnaissance Report (Phase 1b + code interrogation, 2026-07-15)

Repo at `2800abb` (branch `flight/6-multi-window-1`, clean). Method: Phase 1b
verification of every actionable item the audit's "F7 consumption note" and the
F6 debrief's Action Items enumerate, against current code; then exhaustive code
interrogation. No code, artifact, or git state changed.

### Part A — cited-item verification

| # | Item (source) | Classification | Evidence | Disposition |
|---|---|---|---|---|
| 1a | `captureWindow` binds win/chrome/active-tab to ONE accessor-resolved record | **confirmed-live** | `main.js:806` `registry.getLastFocused()`; `:808`, `:851`, `:852` all from `grabRec`; engine `:114` → `observe.js:215-220` | DD3/DD4 |
| 1b | desktopCapturer best-size-match can mis-pick between two similar windows | **partially-satisfied / narrower** | Heuristic real (`main.js:826-834`, no identity check) — **but `:814-815` skips the whole branch under Wayland**, and `dev:automation` selects Wayland (WSLg). Dead code on the dev rig; the `:849-938` composite runs instead, correctly bound to `grabRec` | DD4 + **S2** (fix, but never claim live proof) |
| 2 | Find overlay + sheet are roaming singletons with attachment tracking | **confirmed-live** | Find: `main.js:299-329` (8 module vars), attachment `:307`. Sheet: `menu-overlay-manager.js:104-117`, attachment `:117`/`:83` | DD5 + **S8** (asymmetric) |
| 3 | `enumerateTabs` is window-scoped, not an all-windows census | **confirmed-live** | `tabs.js:62-65` → `engine.js:72-75` → `main.js:237-240` `getLastFocused()`; census in `renderer.js:3568-3576` | DD1 + **S4** |
| 4 | `getChromeTarget` returns one accessor-resolved chrome | **confirmed-live** | `engine.js:124-128` (no arity/param); tool def `mcp-tools.js:536-540` (empty inputSchema) | DD3 |
| 5 | `capturePage`-on-DETACHED never resolves — any timeout guard today? | **confirmed-live — NO guard anywhere** | `mcp-server.js`: **zero** hits for `timeout`/`Promise.race`/`abort`. Five unguarded awaits: `observe.js:132`; `main.js:857,858,889,895`. Anomaly source: F6 `flight-log.md:274-278` | DD7 + **S3** (upgraded to standalone defect) |
| 6 | `kebab-menu.md` stale enumeration needs full-body refresh | **confirmed-live** | `kebab-menu.md:15-21` header pins six items; title/Intent/steps 3+5 still pin "exactly four". Last Run `2026-06-07` (pre-F6) | Leg 3 — the ONE genuinely owed row |
| 7 | `ERR_ABORTED` count not codified in `multi-window-shell.md` step 8 | **confirmed-live** | `:122` (step 2) has a commit-settle gate; step 8 (`:128`) has no count | Leg 3 (cheap) |
| 8 | Destroyed-window rule is prose-only — no wrapper, no lint | **confirmed-live, scope = 1 site** | `CLAUDE.md:21`. `grep onWindowClosed` → 0. `grep no-restricted-syntax eslint.config.mjs` → 0. Census: 7 registrations, all `main.js:1141-1261`; the only `closed`-class one **already uses captured `winId`** (`:1209`) | DD8 + **S5/S6** — prospective insurance, folded into leg 1, no leg of its own |
| 9 | `tab-context-menu` step 3 stale-by-one (`Move to new window`) | **already-satisfied** | `tab-context-menu.md:120` already pins the row (FD ruling, F6 leg 5); Last Run `2026-07-15-06-05-04` **pass 10/10** | **Retired** — carried as `[x]` in the flight spec. Audit `:117`/`:199` overstate: 1 row due, not 2 |
| 10 | Keep DD8's membership-validated last-focused accessor | **confirmed-live (intact, correct)** | `window-registry.js:107-121`; seeded `:73`; `main.js:1141` | DD3 — a *don't-break-it* item, no work |
| 11 | main.js split assessment | **confirmed-live, out of F7 scope** | 3461 lines | The debrief's own Rec 4 assigns it to the post-mission maintenance flight. F7 sets a numeric target instead |
| 12 | Mission's "enumerate spans all windows" default vs the F6 interim | **needs-human-recheck** | `mission.md:211-213` vs `CLAUDE.md:404` + `docs/mcp-automation.md:369-371` — the mission's default **directly contradicts** what F6 shipped | **FD ruling → DD1** (honor the mission default) |

### Part B — fact base

**Overlay census.** Find (module-scope, `main.js`): `overlayView` `:299`,
`overlayVisible` `:301`, `findOverlayAttachedWin` `:307` (DD7 attachment — a
bare `BaseWindow` ref), `lastGuestBounds` `:309`, `findOverlayTabWcId` `:313`,
`findOverlayLastQueryText` `:322`, `overlayReady` `:325`, `pendingOverlayInit`
`:329`. Functions `:314`, `:334-352`, `:355-401` (create), `:407-439` (attach+
show), `:443-451` (hide), `:456-460`, `:464-495`, `:502-514`. **Cluster span
`:291-514` (~224 lines)**; IPC block `:2882-~2960`; ~30 call sites.
Sheet: `createMenuOverlayManager(deps)` `:96-345` — **module-scope state: NONE**;
every var is per-instance closure state (`view` `:105` … `attachment` `:117`).
22 `menuOverlay.` sites in main.js, of which **9 are pure DD7 conditioning**
(`getAttachedWindow() === X`): `:558, :735, :893, :1187, :1235, :2574, :2743,
:2821, :2868`. F6 designed record slots `{…, findOverlay?, sheet?}`
(F6 `flight.md:142-144`) — **not landed** (`window-registry.js:63-71`).

**Capture.** `grabWindow` `main.js:798-939`; record bind `:806`; heuristic
`:821-837` (Wayland-skipped `:814`); composite fallback `:849-938`; layer order
guest `:882-884` → find `:888-892` → sheet `:893-898`, composited via chrome
canvas `:906-932`. Five `capturePage` awaits, three racing detach:
`main.js:858` (active guest — the F6 hang verbatim), `:889`/`:895` (TOCTOU:
sync gate in front of an unbounded await), `observe.js:132`.
`resolveContents` (`resolve.js:98-140`) proves *live*, never *attached*.

**Automation ops.** `enumerateTabs` `tabs.js:62-65`; `getChromeTarget`
`engine.js:124-128` (admin-only, refusal `scope.js:181-184`); `captureWindow`
`engine.js:114`→`observe.js:215-220` (admin-only, refusal `scope.js:162-165`);
foreground-to-act `input.js:228-241`,`:261-267`, `observe.js:121-131`,`:191-200`.
Pinned refusal distinction to preserve: `admin-only` vs `out-of-jar`
(`resolve.js:195`,`:198-201`). Four declaration surfaces must stay in sync:
`mcp-tools.js` (TOOLS `:582`), `docs/mcp-automation.md` (`:19`, `:391`, rows
`:400`/`:430`/`:491`), `automation-mcp-tools.test.js:72`,
`automation-mcp-server.test.js:26` (`EXPECTED_TOOL_COUNT = 29`).

**Lifecycle handler census — complete: 7 registrations, all in
`createWindow` (`main.js:1069-1264`).** `focus` `:1141` (captured `winId`);
`close` `:1154-1204` (reads `win.id` `:1155`,`:1169`, `isDestroyed()` `:1194`,
`contentView` `:1194` — **safe: `close` is pre-teardown**, F6 spike verdict 3);
`closed` `:1206-1221` (**captured `winId` `:1209`** — already correct); `blur`
`:1234-1236` (identity compare only); `resize` `:1244-1249`; `maximize`
`:1254-1257`; `unmaximize` `:1258-1261`. Nothing else in `src/`.

**ESLint.** `eslint.config.mjs` (99 lines, flat, 8 blocks). Rules: `no-unused-vars`
only, plus `js.configs.recommended`. **No `no-restricted-syntax`.** Working
selector (recon verified empirically via `Linter.verify` on a 14-case fixture):
`CallExpression[callee.property.name=/^(on|once)$/][arguments.0.value='closed'] > :matches(ArrowFunctionExpression, FunctionExpression) MemberExpression[object.name='win']`
— fires on the 4 true violations, silent on both correct forms. **The `>` child
combinator is load-bearing** (see S5). Defeated by: aliasing (`const w = win`),
indirection (`helper(win)`), MemberExpression objects (`this.win`, **`rec.win`**).

**Probe walk.** Canonical: `scripts/a11y-audit.mjs:212-235` (`findSheetWcId`) —
skip set from `enumerateTabs` + chrome, then walk ids 1..64 matching
`menu-overlay.html`. **7 specs use it**: `internal-tab-menus`,
`page-context-menu`, `kebab-menu`, `menu-dismissal`, `menu-overlay`,
`tab-context-menu`, `multi-window-shell`. Canonical spec text
`menu-overlay.md:48-53`. Doctrine `CLAUDE.md:388`. **No existing op enumerates
non-tab contents** — the admin relaxation (`resolve.js:130-137`) makes them
*addressable*, never *listable*.

**Sizes.** `main.js` **3461** · `renderer.js` **3923** ·
`menu-overlay-manager.js` 347 · `window-registry.js` 196 ·
`automation/` total **4335** (`mcp-server.js` 1039, `mcp-tools.js` 638,
`observe.js` 480, `input.js` 413, `scope.js` 215, `resolve.js` 206,
`engine.js` 162, `tabs.js` 128). main.js clusters: find `:291-514`;
sheet construction+IPC `:516-757`; `grabWindow` `:798-939`; `createWindow`
`:1069-1264`.

**Tests.** Pure exemplar: `menu-overlay-manager.test.js` (**780 lines**) — the
line-by-line template for `createFindOverlayManager`'s net. **House pattern for
a convention tripwire over a unit-test-exempt file: `broadcast-invariant.test.js`
(285 lines)** — self-deriving source scan, fails on a new violating site
without anyone editing the test. F6 baseline: 1715/1715, 13 suites, ~1.11s.

**Docs to sync.** `docs/mcp-automation.md:356-384` — the whole "Multi-window
semantics (interim — M09 Flight 6; F7 redefines)" section is F7's to rewrite
(`:369-371` window-scoped enumerate; `:378-383` the captureWindow caveat);
rows `:400`/`:430`/`:491`; `:19`/`:391` op count. `CLAUDE.md:21` (registry +
destroyed-window rule), `:29` (find overlay "ROAMS … F7 replaces"), `:388`
(probe walk), `:404` (enumerate revisit), `:448` (29 tools).
**Count "29" appears in 7 places — 2 guarded by tests, 5 prose-unguarded.**

### Surprises

**S1 — cross-window `activateTab` and the whole foreground-to-act contract
silently no-op. LIVE BUG on shipped F6 code; in no source artifact.**
`tabs.js:123-126` resolves (all-windows, passes) then dispatches via
`executeInRenderer` → `engine.js:73-75` → the **last-focused** chrome, whose
`activateTabByWcId` (`renderer.js:3603-3607`) searches its own document's tabs
Map → not found → `false` → **discarded** (`engine.js:88-90`). Propagates to
`actOn` (`input.js:234-236`), `actOnPaced` (`:264-266`), `captureScreenshot`
(`observe.js:125-131`), `readDom` (`:194-199`) — all do
`classify → await activate → re-resolve → act`, so a window-B tab is acted on
**unraised and unrendered**, reported as success. `multi-window-shell` never
caught it: it drives windows 2/3 exclusively via `evaluate` on the **chrome**,
which classifies as chrome and **skips activate** (`observe.js:125`).
→ DD6.

**S2 — F7 cannot behavior-test the captureWindow mis-pick on the dev rig.**
Wayland skips `desktopCapturer` (`main.js:814-815`); `dev:automation` selects
Wayland (CLAUDE.md:10). Any spec step asserting the mis-pick passes vacuously.
Mirror of CLAUDE.md's rig-attribution warning — here the rig **hides** the
defect. → DD4 (unit + HAT scope; never claim live proof).

**S3 — no timeouts anywhere in the MCP server.** A hung `capturePage` wedges
the request forever; only a client-side timeout recovers. With S1, a
`captureWindow` racing a `tab:move-new-window` is a plausible **live hang on
shipped F6 code**. → DD7 (standalone defect + own AC).

**S4 — an all-windows census cannot be built from main's registry alone.**
`tabViews` entry shape (`main.js:2481`) is `{view, partition, trusted, active}`
— no `url`/`title`/`jarId`. `jarId` is reachable only by reverse-mapping
`partition` against `jars.list()` (`jars.js:62-71`), which **cannot resolve
burners** (synthesized containers; cf. F6 `flight.md:245-247`). Three designs:
(a) N round-trips (fidelity, costs latency + partial-failure semantics);
(b) census in main (needs `tabViews` to carry `jarId`; **loses burners**);
(c) window-scoped + `windowId` param (cheapest; contradicts the mission).
→ DD1 chose (a).

**S5 — the F6 debrief's ESLint selector is wrong as written.** Implemented
literally as a descendant match it matches the `win.on` callee too, firing on
**every** registration including the correct form; on a 14-case fixture: 7
findings, 4 false positives, and `main.js:1206-1221` (correct code) would fail
lint. → DD8 (source-scan test instead).

**S6 — the wrapper's retrofit surface is one already-correct site.** Value is
prospective only. → folded into leg 1, no leg budgeted.

**S7 — the audit is already stale on one of its own two "already due" items**
(`tab-context-menu.md:120`, updated and re-run green the same day the audit was
written). Treat the per-spec table as **dated**; the debrief's "start from the
audit, don't re-derive" is right in spirit but is not "trust it unverified."
→ leg 3 re-verifies the probe-walk + count-precondition rows.

**S8 — the two roaming singletons are wildly asymmetric.** Sheet: already a
factory, 100% per-instance state → wiring change that **deletes** 9
conditioning checks. Find: 8 raw module vars + 8 functions + ~30 call sites,
**no module** → must be extracted first. A leg split pairing them as equals
mis-sizes. → DD5.

**S9 — `lastGuestBounds` (`main.js:309`) is any-window-polluted at the write**
(`:2812`, `:2861`, unconditional). DD7 fixed the read (`:419-422`) but not the
write. Harmless today (last-resort fallback) but a shared mutable slot
per-window instances must **delete**, not carry. → DD5.

**S10 — the count guard guards the wrong thing for F7.**
`EXPECTED_TOOL_COUNT = 29` fails the suite on a count change (good, catches
DD2's +1). But DD3's likely change is a **schema shape** at constant count —
suite stays green while `docs/mcp-automation.md:391` ("match exactly") lies.
The F5-debrief count-drift lesson needs a **schema pin**, not another count
pin. → DD9.

---

## Leg Progress

_(none yet)_

---

## Decisions

_(none yet — flight DDs are in the spec)_

---

## Deviations

_(none yet)_

---

## Anomalies

_(none yet)_

---

## Session Notes

### Flight Director Notes

- 2026-07-15 — Flight designed autonomously (operator pre-authorization, and
  an explicit instruction to plan and implement the rest of the mission).
  Recon agent ran Phase 1b verification + code interrogation (fact base
  above). **Two FD rulings against source artifacts, both evidence-backed:**
  (1) **DD1 honors the mission's "enumerate spans all windows" default**
  (`mission.md:211-212`) over F6's shipped window-scoped interim — the recon
  classed this `needs-human-recheck` because the mission text predates the
  spike, but the mission default is a stakeholder commitment and S4 showed the
  only cheaper option (c) buys nothing but contradiction; the fidelity-losing
  option (b) was rejected because burner `jarId` is privacy-model-bearing.
  (2) **DD8 overrides the F6 debrief's own ESLint recommendation** — recon S5
  proved the selector wrong as written AND defeated by `rec.win`, the exact
  idiom F7's per-window code will use; a rule that silently misses the new
  surface manufactures confidence. Substituted the house source-scan pattern
  (`broadcast-invariant.test.js`).
- 2026-07-15 — **Recon retired one audit item** (`tab-context-menu` step 3,
  `already-satisfied`) — carried as `[x]` in the spec with evidence, not
  silently dropped. The audit drifted within hours of authorship (S7), so leg
  3 re-verifies its dated rows rather than sequencing off them blind.
- 2026-07-15 — **Two live defects found in shipped F6 code** (S1 cross-window
  activate no-op; S3 no MCP timeouts). Neither is in the audit or either
  debrief. Both folded into leg 2 with their own ACs rather than deferred —
  S1 in particular means the automation surface has been silently acting on
  unraised background guests since F6 landed. Notable: `multi-window-shell`
  9/9 could not have caught S1 (it drives non-first windows via chrome
  targets exclusively, and chrome classification skips activate) — a
  green spec over a real bug, worth the debrief's attention.
- 2026-07-15 — Leg count: 3 (overlay conversion / automation semantics /
  spec realignment + verify). Rejected a separate "leg 0" for the
  wrapper+lint per the debrief's framing: recon S6 showed the retrofit
  surface is one already-correct site, so it folds into leg 1 as prospective
  insurance. Proceeding to design review.
- **2026-07-15 — RECONCILIATION (post-review): this recon report predates the
  design review and routes work to a 3-leg plan. The flight is now 4 legs.**
  Part A's "Leg 3" dispositions for `kebab-menu.md` (row 6) and the
  `ERR_ABORTED` count (row 7) mean **leg 4** (`spec-realignment-and-verify`);
  the old leg 2 split into `live-defect-fixes` + `automation-window-semantics`.
  The recon is annotated, not rewritten — it is an inspection record, and its
  fact base stands except where the review corrected it (below).
- 2026-07-15 — **Design review pass 1: approve-with-changes** (five HIGH). The
  decision set survived; the review confirmed S1/S2/S3/S4/S6/S8/S9/S10 against
  the code and **corrected three things**:
  - **H1 — DD5 leaked.** F6 destroys the roaming singletons at `before-quit`
    (`main.js:3421-3431`) because per-window close only DETACHES; per-window
    instances would leak two `WebContentsView`s per closed window forever, and
    a registry-iterating quit hook can't reach them (`registry.remove` already
    ran at `closed`). Destruction relocated to per-window `close`.
  - **H2 — the probe-walk set is 10, not 7.** The recon counted only
    `menu-overlay.html`-URL matchers and missed four specs identifying the
    sheet by markup. **The audit was right and the recon was wrong** — a useful
    inversion of S7's lesson: the dated artifact beat the fresh sweep here.
  - **H3/H4/H5 — DD1 was unsafe in three ways**: `multi-window-shell`'s blast
    radius was unbudgeted; the census was non-atomic (a moving tab could
    double-count); and fail-closed contradicted itself on mid-boot and would
    have made that spec's own boot-bracket poll unsatisfiable *and* refused
    throughout F9's multi-window restore.
  - **MEDIUM — DD1's privacy rationale was factually WRONG.** `scope.js:145-157`
    filters by **resolved session, never the renderer-reported `jarId`**; burners
    are already dropped at the jar tier by session identity. Option (b)'s cost is
    admin-tier **observability**, not privacy. The choice stood; the recorded
    reason was corrected. Worth noting for the debrief: the FD wrote a
    privacy-flavored rationale into the DD that the code contradicts in its own
    comment — exactly the class of error a codebase-grounded review exists to
    catch, and it was the stated basis for contradicting a mission default.
  Also folded: leg 2 split; DD2 gained `booted` + `sheetVisible`/`findVisible`;
  DD8 stopped "overriding" the debrief and lands all three layers; DD6's raise
  scoped off `readDom`; the a11y re-point moved into leg 3. **The DD4 premise
  check RESOLVED at review** — `BaseWindow.getMediaSourceId()` exists
  (`electron.d.ts:2809`), so the title+bounds fallback was deleted from the
  design rather than carried.
- 2026-07-15 — **Design review pass 2: approve-with-changes → approved after
  fold-ins.** No decision reversed; all findings were spec-text. Per the house
  rule (max 2 cycles) and the F6 precedent, no third cycle. Pass 2 verified
  every pass-1 fold-in against the code and found three more real gaps:
  - **DD1's `incomplete` marker broke at the jar facade** — a `{tabs, incomplete}`
    wrapper makes `scope.js:150-152`'s `.filter()` throw (and
    `mcp-jar-scoping.md:60` pins an array return), while an
    array-with-own-property is **silently dropped** by `Array.prototype.filter`.
    It was also a cross-tenant leak (naming windows a jar identity holds no tabs
    in — against the `getDownloadsList` doctrine at `scope.js:186-193`).
    **Resolved by deletion**: DD2's `booted` already carries the signal at the
    admin tier, so `enumerateTabs` keeps its plain-array shape — no consumer
    breaks, no facade rewrite, no `mcp-jar-scoping` churn. A marker was invented
    to solve a problem the flight had already solved one DD over.
  - **DD6 ruled 2 of 8 activate sites**, leaving `evaluate` — the op every probe
    walk and cross-window drive runs on — unstated, plus `readAxTree`,
    `printToPDF`, `findInPage`. Now ruled for all eight via a stated predicate
    ("needs rendered output → raise").
  - **DD5 falsifies `multi-window-shell` at leg 1**, not leg 4 as the spec
    attributed ("ONE sheet serves every window" `:80-86`; "zero per-window
    overlay instances" `:124`). Now explicitly OUT of leg 1's invariant set and
    **knowingly red legs 1–4**, logged as planned.
  - Withdrew a **false claim**: DD5's relocation was cited as DD8's "real
    justification," but `close` is pre-teardown (the window is alive) and
    `onWindowClosed` wraps `closed` — the claim doesn't apply. DD8 stands on S6.
  - **DD7's precedent was half-wrong**: `find.js:106,155` resolves with a benign
    zero-match success on timeout (`finish(last)`) — the *opposite* of DD7's
    named refusal, and copying it would reintroduce the silent-success class S1
    exists to kill. Borrow the budget; the race + rejection is new.
  Pass 2 also **strengthened DD1**: the drop side is *currently unreachable*
  (`main.js:2699-2700` is an adjacent synchronous delete/set), so DD1 trades a
  double-count for nothing — and that guarantee is now recorded as an explicit
  **F8 constraint**, since any await F8 introduces between those statements
  silently degrades it to a reachable (and much quieter) missing-tab bug.
  Leg 1's invariant set is now enumerated by name. Flight `planning` → `ready`.
  Proceeding to leg 1.
