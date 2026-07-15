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

### Leg 1: overlay-per-window — designed (2026-07-15)

**Risk tier: HIGH** — structural conversion of a unit-test-exempt surface
(~224 lines out of main.js, ~30 call sites) **plus a lifecycle relocation**
(overlay destruction moves into the window close path). Per-leg design review
ran per the risk-tiering rule.

**Design review: approve-with-changes → folded.** The review independently
verified and confirmed nearly everything — every code citation, the exact
`.on('closed'` census (1 hit), the sender-identity sweep, the ordering pin,
AC13's achievability (it grepped all 8 invariant-set specs: none depend on
roaming attachment, so the invariant AC holds), and AC4's registry-shape
reachability. Findings:

- **[MEDIUM — real] The `close`→`closed` gap leaks the exact class DD5 exists
  to fix.** The `close` handler tears down via closure refs but never nulls
  `rec.findOverlay`/`rec.sheet`; those slots stay reachable via
  `registry.get()` until `registry.remove(winId)` at `closed` (`main.js:1209`),
  and the chrome wc isn't destroyed until `closed`'s deferred `setImmediate`
  (`:1217-1220`). In the gap, an owner-resolved IPC handler
  (`menu-overlay:open`, `:695-703`) still resolves `rec`, and `openMenu` on a
  torn-down manager calls `ensureView()` → `view === null` → **reconstructs a
  view and attaches it to the dying window**. `close` fires once, so nothing
  ever tears it down. Fix folded: null both slots immediately after teardown so
  the record path **fails safe** (the codebase's existing "owner resolve
  returns null → early-return" discipline). This is why the two access paths
  don't diverge — the closure path tears down, the record path is nulled in the
  same breath.
- **[LOW]** count fix (9 DD7 tests, not 8) and a second stale comment
  (`main.js:1150-1153`, sitting directly above `win.on('close')`, describing
  the scheme this leg inverts).

**Three leg-design findings the flight spec's own census missed** — recorded
because the pattern matters (this is the third time a count/enumeration in this
flight was wrong):

1. **"Nine `getAttachedWindow() === X` conditioning checks" is a mislabel.**
   Seven are `=== X` compares; **two** (`:558`, `:735`) are bare attachment
   *resolves* that must be **converted, not deleted**. The AC is written as
   `grep -c 'getAttachedWindow'` → 0, which covers both classes honestly.
2. **Three sender-identity checks were unbudgeted**: `isSheetSender`
   (`main.js:685`), `find-overlay:close` (`:2904`), `find-overlay:query`
   (`:2931`) each compare `event.sender` against a single **global** view and
   are registered at module scope, so they cannot close over a record — each
   needs a reverse lookup over `registry.records()`, mirroring
   `getWindowForChrome`/`getWindowForGuest` (`window-registry.js:129-148`). The
   review swept independently and confirmed these are the **only** three.
3. **`menu-overlay-manager.js` stays byte-unchanged** (grep-AC): under
   per-window its attachment/crossWindow machinery goes inert but stays.
   Gutting it would force deleting the **9** DD7 tests at
   `menu-overlay-manager.test.js:680-773`, contradicting the invariant premise.
   `getAttachedWindow()` survives unread; retirement inherits to leg 3.

**DD8's open question RESOLVED — better than the flight expected.** The leg
proposed a three-tier ladder and settled on **Tier 1: registration-site
exclusivity** ("zero raw `.on('closed')` outside `onWindowClosed`"), and the
review endorsed it after checking: `broadcast-invariant.test.js`'s
`maskComments`/`findMatchingBracket` toolkit directly supports bracket-balancing
the wrapper's body out and regex-scanning the rest; `grep -rn "\.on('closed'"
src/` is **exactly 1 hit**, so post-conversion source passes with a zero-entry
allowlist; and there is **no false-positive risk** — `mcp-server.js` uses Node's
`'close'` throughout, never `'closed'` (the Node and Electron conventions differ
by exactly one character). Tier 1 is **stronger than both** forms the flight
contemplated: the positive form needs scope resolution (likely infeasible), the
negative form is aliasing-defeated — but banning the registration *shape* cannot
be evaded by aliasing, and it **forces** the wrapper DD8 calls the primary net.
The flight's Open Question closes in Tier 1's favour; the positive/negative
ladder is retired.

**`multi-window-shell` planned red** encoded in three places (Context, AC13, the
checklist), with both falsification citations verified verbatim against the spec
rather than taken on the flight's word.

### Leg 1: overlay-per-window — landed (2026-07-15)

Landed as designed. No decision re-litigated, no AC relaxed, no divert
condition hit (`menu-overlay-manager.js` **was** a usable template — the
Adaptation Criteria's DD5 divert never came close to firing).

**(a) main.js line count: 3392** (baseline 3461, **−69**). A checkpoint, not a
gate — the flight's net ≤ 3461 is judged at flight end and leg 1 alone is not
judged against it. Leg 3 adds op wiring against 69 lines of headroom. The
extraction moved ~224 lines out and the nine conditioning checks collapsed;
per-window wiring, the two reverse lookups, and `onWindowClosed` bought some
back. `find-overlay-manager.js` is **365** lines against its template sibling
`menu-overlay-manager.js`'s 347 — the line-for-line mirror held, the +18 being
the find-specific `query()`/`openSession()` half that has no sheet analogue.

**(b) AC18 smoke — PASS**, on a fresh app, reproduced twice. The observable is
the **overlay** wcId count (see the deviation below):

| # | Step | Overlays | Detail |
|---|------|----------|--------|
| 1 | baseline | **0** | chrome=[1]. Lazy confirmed — no window ever paid for an unopened overlay |
| 2 | w1 kebab + find | **2** | sheet=[3] find=[4] |
| 3 | + w2 kebab + find | **4** | sheet=[3,7] find=[4,8] — **two sheets alive simultaneously; the roaming singleton is falsified at leg 1, exactly as DD5 predicts** |
| 4 | close w2 (its own `window-close` IPC → `win.close()`) | **2** | sheet=[3] find=[4] — w2's ids 7/8 **no longer addressable: destroyed, not leaked**. w1's 3/4 still addressable |
| 5 | w1 kebab + find again | **2** | still works — closing w2 destroyed only w2's instances |

Step 4 is the headline: the relocation destroys (no leak) **and** the
per-window scoping holds (w1 unaffected), in one real close through the app's
own path — not a targeted kill (the F6 standing lesson). **Step 5 succeeding
after the close is also the anti-wedge proof** — the F6 leg-4 failure mode was
a wedged main-process event loop with zero error output, and the loop is
demonstrably alive. Zero `Object has been destroyed` / `Uncaught` / `TypeError`
in the app log across every run.

**Quit path additionally exercised** (not required by the leg, but `before-quit`
losing its overlay role is exactly the kind of thing that breaks quietly): two
windows up with a constructed sheet → `app.quit()` → clean exit, zero throws.
DD5's "every window gets `close`, so `before-quit` needs no overlay role" is
confirmed live rather than by argument.

**(c) AC13 invariant set — READY TO RUN, NOT YET RUN.** The implementer cannot
run behavior tests (they need the Witnessed two-agent protocol the FD
orchestrates). All 8 spec files are **byte-unchanged** (`git diff --stat
b607411` → empty, verified): `menu-overlay` · `menu-dismissal` · `kebab-menu` ·
`internal-tab-menus` · `page-context-menu` · `tab-context-menu` ·
`find-overlay-geometry` · `tab-surface-geometry`. **No spec needed an edit to
pass** — nothing about the conversion falsified any of them, so the leg's
byte-identical premise stands and the set is handed to the FD unmodified.
`multi-window-shell` **not run and not touched** (planned red, per the design
entry above) — confirmed by `git diff --stat` → empty.

**(d) DD8 Tier 1 — landed exactly as designed.** All three layers in:
`onWindowClosed(win, handler)`; the ESLint `no-restricted-syntax` rule with the
recon's selector transcribed **verbatim**; `test/unit/window-closed-invariant.test.js`
(registration-site exclusivity, zero-entry allowlist, house
`maskComments`/`findMatchingBracket` toolkit). Both manual sanity checks ran
and are recorded rather than asserted:

- **Tripwire trips.** Injected `win.on('closed', () => console.log(win.id))`
  into `createWindow` → the suite **failed** with `raw closed registration(s)
  outside onWindowClosed: src/main/main.js:974`. Reverted; green.
- **Lint fires, and the `>` combinator survived transcription.** Same
  injection → **exactly 1 error, at `974:38`** — the `win.id` **inside the
  callback**, *not* the `win.on` callee, and the correct wrapper at `:898` did
  **not** fire. That is precisely S5's failure mode (a bare descendant match
  fires on every registration including correct ones) proven absent. Reverted;
  lint exit 0.
- Vacuity guard: the test asserts `onWindowClosed`'s definition was found and
  excised **exactly once** across `src/main/**` — a rename or refactor that
  breaks the excision fails loudly instead of passing vacuously on "zero
  violations".

**(e) What the conversion surfaced that the design missed.** Five things, all
minor, none decision-bearing:

1. **A third stale comment** the design's two-comment list missed:
   `main.js:2780` (pre-F7 `:2780`) read *"Hoisted rounded bounds so the guest
   setBounds and lastGuestBounds share one object"* — `lastGuestBounds` no
   longer exists in main.js at all. Rewritten. The design named `:1150-1153`
   and `:3422-3428`; this one sat in `tab-set-active`. **This flight's standing
   count/enumeration-error pattern claims a fifth scalp** (recon probe-walk
   7-vs-10, audit's 2-vs-1 stale rows, "nine conditioning checks" 7+2, the
   "8 DD7 tests" vs 9 — and now "two stale comments" vs three). **And once more
   in this very entry**: its first draft stated the new module's line count from
   memory (349) instead of `wc -l` (365), and caught it only on the final sweep.
   The lesson is not "count more carefully" — it is that a number worth writing
   down is worth *reading off the tool* at the moment of writing.
2. **AC3/AC6's greps are comment-blind.** Both are written as bare `grep -c`
   expecting 0, but `lastGuestBounds` / `getAttachedWindow` legitimately appear
   in *explanatory prose* about what the leg deleted. Resolved by wording the
   new comments around the tokens (zero cost, and the greps now pass literally
   as written). Worth knowing for future grep-ACs: a token that names a deleted
   concept is exactly the token its replacement's comments want to cite.
   Consider `grep -v '^\s*//'`-style framing next time.
3. **The typecheck needed an explicit cast the design didn't anticipate.**
   `getContentView: () => win.contentView` fails `tsc` — Electron's `View` is
   not structurally assignable to either manager's `ContentViewLike`
   (`addChildView`'s parameter is contravariant). The pre-F7 code never hit
   this because it reached `contentView` through the registry's `WinLike`
   (`{id: number, [k: string]: any}`), which **erases the type to `any`**. Both
   injections now carry an explicit `/** @type {any} */` cast with a comment.
   The erasure was load-bearing and invisible.
4. **One dep-surface deviation** from the leg's *suggested* (explicitly
   non-binding) list: `isTabInThisWindow(wcId)` → **`isFindableTab(wcId)`**.
   Membership alone cannot express `:468`'s refusal, which is
   present **+ `!trusted` + live**; a boolean that only answered "is it mine"
   would have forced the trusted/destroyed checks back into main.js and split
   the contract across the seam. Everything else matches the suggested surface.
5. **`query()` took the whole `find-overlay:query` body**, not just its
   session-state half — the chrome notify rides `notifyChrome` (class 1b: the
   session tab is always this window's, so `chromeForTab(session)` *is*
   `sendToOwnChrome`). The handler is 3 lines. `find-overlay-closed` stayed in
   main.js: it is sender-resolved (only an overlay sender notifies), which is
   the handler's semantics, not the manager's.

**Files Affected — one addition beyond the leg's list**, no omissions:
`test/unit/find-overlay-manager.test.js` and `test/unit/window-closed-invariant.test.js`
landed as specified; `src/main/main.js`, `src/main/window-registry.js`,
`eslint.config.mjs`, `src/main/find-overlay-manager.js` as specified. The one
addition is item (e)(1)'s third stale comment, inside an
already-in-scope file. Every PINNED-UNCHANGED file verified byte-unchanged by
`git diff --stat b607411` → empty.

**Suites: 1768/1768 green, 13 suites** (baseline 1715 + 53: 45 find-manager +
8 tripwire). `npm run lint` exit 0. `npm run typecheck` clean.
`test/unit/window-registry.test.js` passed **unmodified** as AC4 predicted (its
shape test asserts field-by-field, so the two new slots broke nothing).

### Leg 2: live-defect-fixes — landed (2026-07-15)

**Both live defects are fixed and PROVEN live.** S1's cross-window activate now
routes to the owning window's chrome, raises it, and refuses by name; S3's five
unguarded `capturePage` awaits are bounded by a race that always rejects. No
tool-schema change (`EXPECTED_TOOL_COUNT` still 29). Nothing from legs 3–4 pulled
forward.

**`wc -l src/main/main.js` = 3469** (read off the tool; leg-1 baseline **3392**,
so **+77**). **This EXCEEDS the flight's net target of ≤3461 by 8 — with leg 3's
op wiring still to come.** AC15 makes this a checkpoint, not a gate, and the
target is judged at flight end — but the honest read is that the **headroom is
already gone and is now negative**, so leg 3 cannot land its op wiring inside the
flight's number. The +77 breaks down as: ~15 the raise helper, ~12 the two dep
injections (6 × 2, parity-required), ~9 the `Promise.all` wrap, ~30 the two
overlay layers gaining `try`/`catch` + post-await re-checks, ~8 the
cause-preserving re-throw, 3 the require. **Flagged for the FD**: either the
target moves, or leg 3 buys the space back (its `enumerateWindows` +
`getMediaSourceId` picker are both extraction candidates), or the maintenance
flight inherits it. F6's failure was having *no* number, not missing one — so it
is recorded, not quietly absorbed.

**Test results.** `npm test` **1786/1786 green, 13 suites** (leg-1 baseline 1768
+ 18: 10 `capture-timeout` + 2 `observe` + 6 `tabs`; the +18 reconciles exactly,
and all 10 new-suite tests were confirmed present in the full run rather than
silently skipped — "13 suites" is a `node --test` reporting artifact over 76 test
*files*, unchanged from baseline). `npm run lint` exit 0. `npm run typecheck`
clean. **`npm run a11y` GREEN (exit 0)** — "No NEW violations — every violation
node is in the ACCEPTED baseline", with all four `sheet:*` states reached, which
means the probe walk **found the sheet**: the AC2 null branch and AC5 both hold
live. This was the checkpoint the refusal-scoping protects; it was run as
mandatory, not skipped.

**The AC17 live smoke — all three checkpoints PASS.** Apparatus: hand-rolled SDK
MCP client over `npm run dev:automation` (dev-mint + admin), SDK imported by
absolute `dist/esm` path; admin key referenced via env var only, never a command
literal. Per-step observables:

- **Step 0 (the S3 premise check / POSITIVE CONTROL, run BEFORE DD7 landed —
  unrecoverable afterwards).** Find overlay opened in window 1, wcId probed (4).
  `captureScreenshot(find, ATTACHED)` → **OK, 106ms** — the instrument
  demonstrably reports a *present* capture. `pressKey Escape` → `hide()` →
  `removeChildView`. `readDom(find, DETACHED)` → **OK in 10ms**, proving the view
  is **LIVE but detached** (it passes every `isDestroyed()` guard — exactly S3's
  premise). Then `captureScreenshot(find, DETACHED)` → **HUNG: no response in
  20 000ms**, recovered only by the client-side bound. **S3 REPRODUCED.** This is
  what makes step 8 a measurement rather than an absence claim — the leg-1 false
  PASS came from precisely this missing control.
- **Step 2.** Moved via the REAL tab-context menu (`openTabContextMenuForAudit()`
  → probe sheet → click the `Move to new window` menuitem), not a synthesized
  IPC. Menu items read back as the expected six.
- **Step 3 (baseline).** `activateTab(<window-1 tab>)` → `true`;
  `getChromeTarget().wcId` = **1** (window 1). *Unplanned extra S1 evidence:* at
  this point window 2 was last-focused (the move raises it), so this was **itself
  a cross-window activate** — pre-fix it would have dispatched to window 2's
  chrome, missed, and returned a discarded `false`.
- **Step 4 — AC17(a) PASS.** `activateTab(M)` on a **window-2** tab, driven while
  window 1 was foreground → returned **`true`** (not a discarded `false`, not a
  throw), and `getChromeTarget().wcId` **flipped 1 → 5** (window 2's chrome).
  ⇒ the raise happened, and the instrument demonstrably reports a raise.
- **Step 5.** Re-baselined to window 1 (chrome wcId back to 1).
- **Step 6 — AC17(b) PASS.** `readDom(M)` on the background-window guest →
  **returned its live DOM** (`url=https://example.com/`, `title="Example
  Domain"`) — the read works on a background-window guest, which is the substance
  of the change — and `getChromeTarget().wcId` was **STILL 1**. ⇒ **no raise.** A
  **measurement**, not an instrument failure: step 4 showed this same instrument
  reporting a raise in this same run.
- **Step 6b.** `evaluate(<window-2 chrome>, …)` reached window 2's strip and left
  `getChromeTarget()` at 1 — a chrome target classifies `'chrome'` and never
  activates, so the instrument does not perturb what it measures.
- **Step 7 — probe-walk regression PASS.** With a menu open, the walk **found the
  sheet (wcId 4)** exactly as today. `activateTab(sheetWcId)` directly →
  **`false`, not a throw** — AC2's null branch, exercised live.
- **Step 8 — AC17(c) PASS.** Same action and same instrument as step 0, on the
  fixed build: `captureScreenshot(find, ATTACHED)` → OK 89ms; Esc; `readDom` → OK
  5ms (still live-but-detached); then `captureScreenshot(find, DETACHED)` →
  **responded in 3086ms with `automation: capture-timeout — wcId 6 did not settle
  within 3000ms (the view may be detached)`**. **Not a hang; not a benign empty
  image.** Step 0 vs step 8: same action, same instrument, opposite outcomes.
- **Step 9 — healthy-path regression PASS.** `captureScreenshot(live foreground
  tab)` → OK **118ms**; `captureWindow()` **with a menu open** (exercising both
  overlay layers) → OK **103ms**. Both are ~30× inside the 3000ms bound, so the
  guard did not turn slow successes into failures and the bound needs no
  revisiting (the leg asked for the number to be recorded if it came near 3s — it
  did not).

**HONESTY NOTE — what the rig CANNOT prove, stated rather than inferred.**
`getChromeTarget` reads `registry.getLastFocused()`, which **the raise itself
seeds via `noteFocus`**. So steps 4/6 prove the **main-side raise contract**
(`win.focus()` called and the accessor re-seeded) — they do **NOT** prove the **OS
compositor** actually brought window 2 forward. Under WSLg that is unprovable by
any scripted stimulus (F6 spike verdict 4: focus APIs inert; the leg-1 FD
correction: *"a HAT performed on WSLg would prove nothing"*). Mirrors DD4/S2's
discipline: fix it, unit/smoke what the rig can read, never claim live proof the
rig cannot give. **The OS-level raise is HAT-scoped and must be pinned to a
NON-WSLg desktop or recorded as an accepted permanent gap** — it must NOT be left
as an unqualified HAT ticket that silently cannot run. **FD ruling owed.**

**AC12 — the named risk (schema-stable and CONTRACT-BREAKING, uncovered until
leg 3).** `activateTab` now **throws** `automation: activate-refused` where it
previously returned a silent `false` — for registry-owned tabs whose chrome
disagrees. `readDom` and `evaluate` **no longer activate** their target, a real
behavior change for any consumer relying on the side-effect. **No tool-schema
changes**: `EXPECTED_TOOL_COUNT = 29` is untouched and every `inputSchema` is
unchanged, so **the suite cannot catch this** — DD9's schema pin lands one leg
later, so this leg is **uncovered by it**, carried knowingly per the flight's
re-tiering to HIGH. **The in-repo consumer sweep is COMPLETE and is carried
forward, not redone**: `scripts/` + all of `tests/behavior/*.md` swept; **no
in-repo consumer relies on a read op's own activate side-effect**; ~16 further
background-tab + `readDom`/`evaluate` specs individually cleared. The two probe
consumers (`scripts/a11y-audit.mjs:212-235` via `evaluate`,
`find-overlay-geometry.md:82-85` via `readDom`) are protected by **AC5**, not by
AC2's null branch; **AC2's null branch is load-bearing for a DISJOINT set** —
`captureScreenshot`/`readAxTree` on overlay wcIds, which still activate. Both were
confirmed live (a11y green; smoke step 7). **Leg 4 inherits this disposition.**

**AC1 — the count correction, landed as designed.** **NINE** activate sites, not
the flight's thrice-stated "eight"; the three corrected labels hold
(`input.js:235` = `actOn` serving click/typeText/pressKey; `:265` = `actOnPaced`
serving `dragPointer`; `:368` = `scroll`); **`activateTab` is the primitive
(`engine.js:90`), not a site.** Every ruling survived re-derivation — the ninth
row was mis-labeled, never missing. **The sixth instance of this flight's
count/enumeration-error pattern**, and the shape is now unambiguous: *every one is
a total asserted in prose instead of an enumeration read off the tool.* DD6's
table was right precisely because it enumerated. **Post-AC5 the same grep now
enumerates 9 lines = 7 surviving sites + 2 doc comments** — the seven are exactly
AC1's seven "raises: yes" rows, and the predicate became **structural** as the leg
predicted: the only remaining callers of `activate` are the ops that raise, so no
per-op raise flag was needed.

**AC2 — the ruling, forced by the code (NOT a re-litigation of DD6).** The named
refusal is **scoped to registry-owned tabs**. `getChromeForTab` returns null for a
non-tab wcId, so the null branch falls out of the mechanism naturally and returns
today's `false` — no raise, no throw. Verified live twice over (a11y green with
all four sheet states; smoke step 7's direct `activateTab(sheetWcId)` → `false`).
A blanket throw would have broken `npm run a11y`, all 10 probe-walk specs,
`find-overlay-geometry`'s `readDom` probe, and overlay `captureScreenshot`.

**`automation-observe.test.js` accounting — the leg enumerated 7; there were 8.**
The 4 predicted failures failed **exactly** as predicted (`:297`, `:322`, `:776`,
`:808`) and no others. Dispositions applied: `:297`/`:776` **renamed with
inverted assertions** (the leg-skill's preferred form over delete-and-readd, so
`git blame` carries the intent shift); `:322`/`:808` were **also** inverted rather
than deleted — they turned out to invert cleanly into "resolves ONCE (no activate
⇒ no async hop ⇒ no stale-handle re-resolve)", a **stronger** pin than deletion
(it stops the re-resolve being "helpfully" restored). The 3 vacuous ones (`:346`,
`:364`, `:826`) were re-pointed/re-worded per the leg. **The eighth, which the
leg's accounting missed:** `:893` (`[HIGH] evaluate: internal-session REFUSED even
with allowInternal:true`) **stays green and its assertion stays valid, but its
trailing comment was falsified** — it read *"activate fires before the FINAL guard
(the guest activate branch runs first)"*, now false. It was re-pointed into the
**AC5 guard-survival pin** (group 4 wanted exactly this: prove the DD2-HIGH
refusal did not go out with the branch) and given a real
`activateCalls.length === 0` assertion, so the comment no longer lies. **This is
the leg-1 "green tests over now-unreachable code" class recurring one leg later in
a different file — and the recurrence now includes a case the leg's own sweep
missed, which is the sharper finding: a comment can go stale inside a green test
without any enumeration catching it.**

**NEW FINDING — the grep-AC pattern claimed its EIGHTH and NINTH scalps, and the
root cause is now diagnosable: comment discipline and grep-ACs are in direct,
unreconciled tension.** This flight's grep-ACs had already failed twice (leg 1's
comment-blind; leg 2's syntax-blind). Two more fired during implementation, both
against **correct** code:

1. **AC7's `grep -c "require('electron')" → 0` is COMMENT-BLIND and fails a
   correct module.** `capture-timeout.js` has **no `require` statements at all**,
   yet the AC returns **1** — matching its own header comment *"ELECTRON-FREE by
   construction (no `require('electron')`)"*. **The decisive control:
   `observe.js` — the repo's OWN established Electron-free exemplar, whose header
   says the same thing — ALSO returns 1.** So AC7 as written reports the house's
   canonical Electron-free module as Electron-bound. Corrected, validated form
   (line-anchored, comment-blind-proof), both controls run:
   `grep -cE "^\s*[^/]*require\('electron'\)"` → capture-timeout.js **0**,
   observe.js **0**, engine.js (a real require) **1**.
2. **AC1's grep total drifted again for the same reason** — the new `tabs.js`
   comment quotes `` `await activate(wcId)` `` while explaining the refusal, so
   the grep prints 9 (7 sites + 2 comments) where a prose reader expects 8.

**The synthesis worth the debrief:** the leg explicitly instructs *"Keep every
earned comment"* and asks the implementer to cite the mechanism being changed —
while its grep-ACs count bare tokens that those very comments must name. **The two
disciplines are in direct conflict, and all four grep-AC failures sit on that
fault line.** Writing a grep-AC from *intent* is not the root cause; the root
cause is that **the token being grepped is also the token good comments cite.**
The fix is structural, not vigilance: grep-ACs must be **line-anchored to code
syntax** (as AC6 already was, after review) and must **ship with a control that is
run** — a positive control proving the grep can go red, and, where the AC asserts
an absence, a known-present case proving it can report presence. AC6 was the only
grep-AC in this leg that survived contact, and it is the only one validated
against a candidate correct diff **and** given a control:
`grep -cE '^\s*grabWindow(,|:)' → 2` ran green before the assertion greps, exactly
as instructed.

**AC10's re-throw makes `grabWindow` reject where it previously only ever
resolved-or-null'd.** Caller audit run rather than assumed:
`grep -n 'grabWindow' src/main/main.js src/main/automation/*.js` → the two
injections (`main.js:831`, `:3335`) plus `observe.captureWindow`'s use
(`observe.js:236-238`), which **awaits** it — so the rejection propagates to the
adapter as `isError`, the intended DD7 outcome. **No caller assumes never-throws.**
Proven live at smoke step 8 (the named cause reached the client instead of the
generic `'chrome window unavailable'`).

**Files Affected: NO DEVIATION.** Exactly the leg's list. Verified rather than
asserted: all seven PINNED-UNCHANGED source files (`find.js`, `print.js`,
`input.js`, `resolve.js`, `mcp-tools.js`, `scope.js`, `menu-overlay-manager.js`)
are byte-unchanged vs `b607411`, and the leg-1-owned files still dirty in the tree
(`window-registry.js`, `eslint.config.mjs`, `tests/behavior/*`) contain **zero**
leg-2 tokens (`git diff` of those paths grepped for
`capture-timeout|activate-refused|raiseWindowForTab|chromeForTab|withCaptureTimeout`
→ 0). `mcp-tools.js` needed no edit, as the leg predicted: `activateTab` still
returns `true`/`false` and only the desync third outcome throws, so the `:34`
boolean pin and the `:154` description both stay true. **`docs/mcp-automation.md`
`:356-384` left untouched — it is leg 3's.** `docs/mcp-automation.md:300` was
re-read and **not** edited: it scopes jar refusals and asserts nothing about
read-op activation, so AC13's "update only if" did not trigger.

**Deviation from the leg's suggested design: one, minor.** `tabs.js:activateTab`
guards on **both** `chromeForTab` and `executeInChrome` being functions before
taking the routed path (the leg's sketch guards `chromeForTab` alone). Without it,
an injection supplying only `chromeForTab` would `TypeError` at the dispatch
rather than fall back cleanly, and the house "Absent → no behavior change" idiom
wants the fallback. Both are injected together at both live sites, so the case is
unreachable today — it is defensive, and it costs one `&&`.

**Queued for leg 4 (recorded, not acted on — this leg edits no spec files):**
`tests/behavior/foreground-to-act.md` is a **prose erratum this leg creates**, and
the flight never mentions it: its **steps survive** (they drive only
`captureScreenshot`/`click`/`typeText`, all of which keep raising; its `readDom`
at step 5 is a read-back on an already-activated tab), but its **Intent** and its
**Out of Scope** (*"Invisible/background driving … explicitly NOT a v1
capability … If a future 'drive without stealing focus' mode is added, cover it
separately"*) are **falsified — DD6 IS that mode**, for `readDom`/`evaluate`. It
is `draft`/`Last Run: never`, so it is **not a gate and not a planned red**. Fix
the prose in leg 4 and name the read/act asymmetry.
`tests/behavior/observe-refusal-contract.md` is **not** falsified (draft/never-run;
scoped to `readAxTree`'s tri-state; does not enumerate refusals exhaustively) —
leg 4 may fold in `capture-timeout` and `activate-refused`.

**`tab-reorder.md` step-7 confound: CHECKED AND REJECTED — do not re-raise.** Its
`evaluate` targets the **CHROME** (pinned at `:62` and `:106`), and a chrome
target classifies `'chrome'` and never activates — before or after DD6. There was
no confound; step 7's claim was always sound. Re-confirmed live at smoke step 6b
(`evaluate` on window 2's chrome left `getChromeTarget()` untouched) and pinned by
the re-worded `automation-observe.test.js` chrome-target tests. Recorded because
the reasoning that produced the suggestion is the failure mode this flight already
paid for once: composing "`evaluate` is foreground-first" + "a background tab"
into a confound **without checking which wcId the `evaluate` targets**.

### Leg 3: automation-window-semantics — landed (2026-07-15)

DD1/DD2/DD3/DD4/DD9 + the docs replacement + the `a11y-audit.mjs` re-point. All 25
ACs met. **Not committed** — the flight commits once after the flight-end review.

**main.js line count and leg 3's delta, RECORDED SEPARATELY** (both read off `wc -l`):
**3469 → 3517 = leg 3 delta +48.** Leg 2's −8 overage is **not** absorbed here:
against the flight's net ≤3461 target the file is now **56 over**, of which **8 is
leg 2's and 48 is leg 3's**. The FD's ruling stands — a recorded miss, not a gate.
What the extractions actually bought back, read off `wc -l`: `window-census.js`
(**120 lines**) and `capture-source-picker.js` (**50 lines**) live outside main.js; in
it, the census accessor is 1 line and the picker call is 1 line replacing a 9-line
scoring loop. The +48 is op wiring with nowhere else to live:
`getChromeContents`/`grabWindow` params, the `listWindows` seam (7 lines), three deps
× 2 engine sites, and the earned comments.

> **A ninth instance of the count/enumeration pattern — MINE, in this very entry.**
> The line above first read *"`window-census.js` (**125 lines**)"* under the heading
> "read off the tool rather than estimated". It was **120**. I wrote it from memory
> while claiming to have read it, in the landing entry of the leg whose central lesson
> is *print the range and read it* — the same shape as leg 2's AC1 verify line
> reproducing the count error inside the AC documenting the count error, and as this
> leg's own Citation Audit carrying drift inside its "verified OK" list. Caught only
> by re-running `wc -l` at the final verification pass. **Recorded, not silently
> fixed: the pattern's persistence through an artifact explicitly written to stop it
> is the finding.** Every other number in this entry was re-read at the final pass;
> this was the only one wrong.

**Verbatim results:**
- `npm test` — **1831 tests, 13 suites, 1831 pass, 0 fail.** Baseline **1786**; leg 3
  adds **45** (window-census 15, capture-source-picker 9, tabs +10, mcp-tools +8,
  scope +3). **No existing test was modified to make it pass.**
- `npm run lint` — **exit 0**.
- `npm run typecheck` — **exit 0**.
- `npm run a11y` — **exit 0. "No NEW violations — every violation node is in the
  ACCEPTED baseline. ✅"** 22 accepted baseline nodes, informational.

**AC18's "all six sheet states reached" — PROVEN, not inferred.** Only four `sheet:*`
labels appear in the accepted-violations list (kebab, container, page-context,
tab-context); site-info and new-container have zero violations, so their absence from
that list is **not** evidence they ran. The real control is per-state and it is real:
`SHEET_DISMISS_EXPR` returns `'none-open'` when no template node is open, and
`a11y-audit.mjs:419-421` **throws with the state label** on anything but `'escaped'`
(a second throw at `:424-426` if it fails to close). Exit 0 therefore means all six
states opened a node, were axe-audited against the `enumerateWindows`-resolved sheet
wcId, and closed. **The leg's own doctrine applied to its own checkpoint: an absence
is evidence only when the instrument is shown able to report presence.**

**The grep-AC controls, RUN, as NUMBERS — not as "passed":**
| Grep | Role | Before | After |
|---|---|---|---|
| `require('electron')` masked, `observe.js` | CONTROL (house Electron-free exemplar) | 0 | 0 |
| `require('electron')` masked, `engine.js` | CONTROL (the POSITIVE case) | 1 | 1 |
| `require('electron')` masked, `window-census.js` | assertion | n/a | **0** |
| `require('electron')` masked, `capture-source-picker.js` | assertion | n/a | **0** |
| `^\s*grabWindow(,\|:)` | CONTROL (precedent in the same literals) | 2 | 2 |
| `^\s*listWindows(,\|:)` | assertion | 0 | **2** |
| `^\s*enumerateWindows(,\|:)` | assertion | 0 | **2** |
| `bestScore` | its own before-control | **2** | **0** |
| `^\s*for \(let id = 1; id <= 64` | its own before-control | **1** | **0** |

**The naive-grep fault class reproduced LIVE on this tree, before any edit:**
`grep -c "require('electron')" src/main/automation/observe.js` → **1**, on
`observe.js:16` — a header comment naming the token. The repo's canonical
Electron-free module fails its own naive check. The masked form returns **0**.
Recorded because the leg predicted it and the prediction was **verified, not trusted**.

**A control that nearly didn't run — the harness bit back.** Chaining the controls
with `&&` silently swallowed the `engine.js` → 1 control: **`grep -c` exits 1 when
the count is 0**, so `observe.js`'s *correct* `0` broke the chain and the positive
control never executed. Caught only because expected output was missing from the
terminal — nothing failed. **The flight's ruling is that a grep-AC without a run
control is a design fault; this is the sub-case where the control is written, is
correct, and still does not run.** All controls were re-run isolated with `; true`.

**AC25 live smoke — 32/32 checks passed.** Apparatus: hand-rolled SDK client
(`scripts/mcp-example-client.mjs` as template), SDK imported by absolute
`dist/esm/...` path (the runner sits outside the tree; ESM ignores NODE_PATH), admin
key via `GOLDFINCH_MCP_ADMIN_KEY` env var extracted from the mint line, **never** a
command literal. `enumerateTabs`/`enumerateWindows` snapshotted immediately on
connect as the boot bracket, before any setup lull.

| Step | Assertion | Outcome |
|---|---|---|
| — | boot bracket on connect | 1 window booted, 1 tab; **0 mid-boot windows** at bracket |
| — | `listTools` advertises **30** | **PASS** |
| 1 | one row; `booted`/`lastFocused` true; `sheetWcId`+`findWcId` **ABSENT**; both `*Visible` false | **PASS** (7/7) — "absent ⇒ never created" holds live |
| 2 | every row `windowId`=1; `Array.isArray` true; no own props beyond indices | **PASS** (3/3) |
| 3 | **mid-boot `booted` observable** | **CAUGHT on poll 1** — see below |
| 4 | census spans BOTH windows, one array, insertion order | **PASS** (4/4) |
| 5 | **two sheets `sheetVisible: true` at once, distinct ids** | **PASS** (2/2) |
| 6 | `getChromeTarget` omitted → last-focused + `windowId`; each id → that chrome; 999999 → refusal | **PASS** (7/7) |
| 7 | `captureWindow` image shape unchanged; `windowId` routes; 999999 → refusal | **PASS** (4/4) |
| 8 | close window 2 → one row, booted, no stale row, no throw | **PASS** (2/2) |

**AC25(c) — the flight's headline observable, MEASURED:**
```
[{"windowId":1,…,"sheetVisible":true,"sheetWcId":4},
 {"windowId":2,…,"sheetVisible":true,"sheetWcId":6}]
```
Two windows, **both** `sheetVisible: true`, **two distinct** `sheetWcId`s (4 and 6),
read through DD2's own field. Impossible under F6's roaming interim by construction.

**AC25(a) — the mid-boot observable was CAUGHT, with better evidence than the AC
asked for.** Poll 1 after the real *Move to new window* click (the REAL menu, reached
via the `enumerateWindows`-resolved sheet wcId — the re-point driving its own proof):
```
{"windowId":2,"chromeWcId":5,"booted":false,"activeTabWcId":2,…}
enumerateTabs rows for window 2: []
```
The mid-boot row reports **`activeTabWcId: 2`** — the adopted tab is **already in the
record** — while `enumerateTabs` returns **zero rows** for that window. That is DD1's
mid-boot adopted-tab disclosure measured directly, with the registry state and the
census disagreeing exactly as designed. **The escape hatch was not needed and no
sampling limit is claimed.** The unit pin (`booted:false` ⇒ zero rows **and zero
round-trips**, positive-controlled in the same test) stands alongside it.

**AC15 / S2 — DD4's fix is NOT claimed live, and the rig confirmed why.** The app
launched `--ozone-platform=wayland` (verified in the live process command line), so
main.js's Wayland guard skips the whole `desktopCapturer` branch: **the identity bind
never executed once during this leg.** Smoke step 7 proves the `windowId` **param
routes** and the image wire shape is unchanged — **nothing more**. DD4's only
rig-provable half is `test/unit/capture-source-picker.test.js` (9/9), which pins the
decisive case as a named contract test: a decoy source that is the **better size
match** loses to the identity match, so the deleted heuristic's own failure mode is
covered.
**HAT item — PINNED, not an unqualified ticket that silently cannot run:** *"On a
NON-Wayland desktop (X11, or native Windows/macOS), open two similarly-sized
Goldfinch windows, `captureWindow({windowId})` each, and confirm each image is its
own window."* **Precondition: a non-Wayland session. This CANNOT run on the current
dev rig (WSLg → Wayland) and must not be scheduled against it.** If no non-Wayland
desktop is available to the operator, this is an **accepted permanent gap** and the
unit net is the whole assurance — recorded as such rather than left to look pending.

**PREMISE AUDIT — six finds: the brief's three, the guidance's one, and TWO the
implementation surfaced.**

1. **(brief) "`a11y-audit.mjs`'s fallback activates background tabs" — FALSE.**
   Retired by leg 2's AC5; already recorded at `CLAUDE.md:388`. The re-point landed
   on the honest ground: O(1)-exact vs. O(64)-guess, and the unfiltered failure branch.
2. **(brief) "the inert `attachment`/`crossWindow` machinery" — FALSE for
   `attachment`.** It is live (`main.js:527`). Only `crossWindow` is dead.
3. **(brief) DD3's "both return shapes gain `windowId`" — NOT IMPLEMENTABLE for
   `captureWindow`.** Ruled, ratified, implemented as ruled (below).
4. **(guidance) The AC1 `executeInChrome` guard is DEAD, and leg 2's precedent does
   not model a reachable failure.** `engine.js:107` builds `executeInChrome`
   unconditionally; only `listWindows` gates the fallback. **Kept** for symmetry with
   `tabs.js:166`; the comment names the deadness rather than implying a live failure.
5. **(NEW — implementation) AC10's "`automation-mcp-tools.test.js:591-599` passes
   UNMODIFIED" is over-claimed by ONE LINE, and the line matters.** The test **failed
   on correct code**. Verbatim:
   ```
   captureWindow takes no positional args
   + [ { windowId: undefined } ]   - []
   ```
   `:597-598` — the **image-content** assertions, which are what AC10 actually calls
   "the control proving the image contract did not move" — pass **verbatim**. `:599`
   is not an image-contract assertion at all: it pins the **engine-dispatch
   signature**, which DD3 changes *by design* (`engine.captureWindow()` →
   `engine.captureWindow({windowId})`). **The control is sound; its stated scope was
   wrong.** Resolved by leaving `:597-598` untouched, correcting `:599` to
   `[{ windowId: undefined }]` with a comment separating *wire shape* from *dispatch
   signature*, and adding a sibling test asserting the content is **byte-identical**
   with and without a `windowId` — which is AC10's actual claim, now pinned directly
   rather than by proxy. **Same shape as the flight's standing pattern: a property
   asserted about a line range read from prose instead of from the range.** The
   tempting wrong fix — `windowId == null ? engine.captureWindow() : …` — would have
   preserved the literal green by contorting production code to satisfy a test's
   stale scope. Rejected.
6. **(NEW — implementation) `captureWindow`'s `no-such-window` had no home in the
   guidance's shape.** Guidance step 4 threads `windowId` into `observe.captureWindow`
   → `grabWindow(windowId)`, and AC10 requires `/^automation: no-such-window — /` on
   an unknown id. But `grabWindow` returns **`null`** both for an unknown record
   **and** for a genuine capture failure on a valid window — so inferring the refusal
   downstream would answer *"no-such-window"* for a window that plainly exists. **A
   named refusal that names the wrong cause is the silent-success class wearing a
   label.** Resolved by validating in the engine (`requireWindow`, shared with
   `getChromeTarget`) **before** delegating — which also keeps DD2 the single topology
   source. `observe.js` still threads `windowId`; its `null` keeps its original
   meaning and its verbatim message.

**DD3-vs-the-image-contract — the FD's ratified correction, implemented as ruled.**
`captureWindow` **accepts** `{windowId}`; its **wire shape is UNCHANGED** (bare image
content; `shape: imageResult` untouched). `enumerateWindows` is the topology read.
Live proof the contract did not move: smoke step 7 returned normal `image/png`
content for both the omitted and the supplied case, and the new unit sibling pins the
content byte-identical across them. **Adding a field to a return type is now 0-for-2
in this flight** (DD1's `incomplete` marker; DD3's `captureWindow` return) — recorded
as a **shape, not two incidents**: *"add a field to a return type without checking how
the consumer parses it."* Both consumers parse positionally; both failures would have
been **silent**. The `structuredContent` sidecar stays **rejected on its merits**
(circular with DD9; widens the `listTools` contract pinned at
`automation-mcp-tools.test.js:81-90`; heaviest on the one binary op; contradicts DD1's
own admin-tier doctrine) — **not** on "it might not survive": the SDK does have the
affordance (`types.js:1289-1303`).

**The `getAttachedWindow` retirement — DEFERRED to the M09 post-mission maintenance
flight, per the leg's ruling. NOT retired here.** The FD's premise was wrong and
**enumeration, not prose, shows it**: of the nine DD7 tests
(`:680,689,699,709,720,744,753,763,773`), **exactly ONE (`:720`) is over unreachable
code** and **a second (`:744`) went vacuous**; `attachment` is **LIVE** —
`main.js:527` passes it on every menu open and `menu-overlay-manager.js:121-123` /
`:304` / `:310` / `:268` read it. Only `crossWindow` (`:248`) is dead. **The eighth
instance of this flight's count/enumeration-error pattern — and the first inside the
FD's own ruling.** The sized ticket:
- Delete `getAttachedWindow` (`menu-overlay-manager.js:343`) — **0 production
  readers**, 5 test-only reads. DD2 *does* discharge its stated blocker (it settles
  the sheet's read surface as `getView()` + `isVisible()`), but the record it accesses
  **stays** (live), so deleting only the accessor is cosmetic and costs re-opening
  leg 1's byte-unchanged pin.
- Delete the `crossWindow` branch (`:248`, `:262-265`, `|| crossWindow` at `:275`) —
  **first verify `win.contentView` identity-stability against LIVE Electron**, not a
  fake. `electron.d.ts:3638` declares `contentView: View` as a *property*, which
  supports but does not prove it. **If it is false, the branch fires on every
  same-window model-replace today, and deleting it removes a real
  `removeChildView`/`visible=false` — observable only as a flicker.** An unverified
  premise with a silent failure mode is the exact shape this flight has paid for.
- Delete test `:720`; re-word `:744` (it is now the general case).
- **KEEP `attachment`.**
- **F8 checkpoint**: F8 lands cross-window drag — confirm it does not resurrect a
  legitimate cross-window model-replace before deleting `crossWindow`.

**`lastFocused` — option (a) taken** (guidance step 2): `buildWindowCensus(records,
lastFocusedRecord)` compares by **record identity**, so `window-registry.js` stays on
the pinned-unchanged list (leg 3 made **zero** edits to it — its working-tree diff is
leg 1's) and the census inherits the registry's membership-validated first-record
fallback for free. The census **never invents a fallback**: a `lastFocusedRecord`
matching no record yields **zero** true rows (pinned), plus an identity test proving a
same-id-different-object record does not read as focused.

**Citation drift — the flight's central lesson, applied and self-checked.** Every
`file:line` in the leg's Inputs was re-printed and read before editing. **All held**:
main.js 3469, window-registry 210, engine 184, tabs 193, observe 502, scope 215,
mcp-tools 638, a11y-audit 475, menu-overlay-manager 347, find-overlay-manager 365 —
`wc -l` verbatim. `imageResult :87-89`, `captureWindow def :411-417` (`shape:` at
`:416`), `CHROME_TOOLS :534-548`, `scope.js:181-184` and `:152-155`, `a11y
findSheetWcId :212-234`, `registry.get` exported at `:95-97` — all exact. **The leg's
own Citation-Audit disclosure (four drifted rows sitting inside its "verified OK"
list, plus a fifth inside the correction of one) is the finding the debrief wants as
ONE item**: the leg written to stop citation drift carried drift in the very claim it
sells — and premise-audit find #5 above is the same shape recurring at the **AC**
level in this leg's own landing. **The generalization is now unavoidable: print the
range and read it. A boundary quoted from memory, from prose, or from another
artifact's range is wrong at a rate this flight has measured many times over.**

**`multi-window-shell` — NOT run, NOT touched.** Planned red (DD5 falsified its
preconditions at leg 1; DD1 falsifies its censuses now). Latest run on disk remains
`2026-07-15-05-54-21` (F6-era, pre-leg-1). Leg 4 rewrites it once. **No file under
`tests/behavior/` was edited by this leg** — the three modified specs in the working
tree are legs 1–2's.

**Deviations from the leg's Files Affected (each AC-mandated or forced):**
1. **`src/main/automation/mcp-server.js`** — modified (`:358`, "the 29 tools" → 30).
   **Named by AC8 as one of the seven count sites but omitted from Files Affected.**
   The AC wins.
2. **`test/unit/automation-scope.test.js`** — modified: 3 tests added for AC7's
   admin-only refusal (jar → `admin-only` with **zero accessor invocations**; admin →
   reaches engine; unknown jar → `no-such-jar` first). Not in Files Affected, and AC3
   says this file "passes **unmodified**" — **true in the sense AC3 means it**, and
   verified by tool: `git diff` shows **zero deleted or altered lines**, additions
   only. AC7 cannot be proven without them.
3. **`CLAUDE.md:15` and `:388`** — swept beyond AC20/AC21's named lines (`:452`,
   `:404`, `:29`, `:169`). Both describe **the probe walk this leg just deleted**:
   `:15` documented the a11y "background-tab-safe probe walk" (the code AC17 removes),
   and `:388`'s enumerable-vs-addressable rule asserted overlay views are "addressable
   but never listable" — **which DD2 falsifies**, since `enumerateWindows` lists them.
   Leaving them would be actively-false docs describing deleted code. Recorded as
   leg-3 residuals, not a scope grab.
4. **A stale test NAME** at `automation-mcp-server.test.js:252` read "returns 29
   tools" while asserting `EXPECTED_TOOL_COUNT`. Renamed to reference the constant —
   a name/assertion drift the count guard **cannot** catch, because only the name lied.

**What the implementation surfaced that the design missed** — beyond finds #5 and #6:
the leg's Outputs list `test/unit/automation-scope.test.js` **nowhere**, yet AC7 is a
scope-façade AC. And more consequentially: **`enumerateTabs`'s and `captureWindow`'s
tool DESCRIPTIONS** — not their schemas — asserted the old contract in prose ("Takes
no input"; "**of the last-focused window**"). DD9 pins `inputSchema` field-by-field
and the count guard pins the tally, but **nothing pins a description string** —
and `listTools` projects `description` into the discovery contract
(`mcp-tools.js:608`), so **a description can lie to every consumer while all 30 tools,
every schema, and every count stay green**. Updated by hand. **Leg 4's doc grep-ACs
over the five prose "29" pins should consider this class one layer in: the tool
descriptions are prose living inside the code, unguarded by DD9.**

---

### Leg 4: spec-realignment-and-verify — landed (2026-07-15)

**Status: landed. NOT committed** (this flight commits once, after the flight-end review).
**The FD still owns all three Witnessed runs (AC25/AC26/AC27) — nothing live was run here.**

#### Records

- **`wc -l src/main/main.js` → 3517. THIS LEG'S DELTA: 0** — as designed; this leg edits no
  main-process source. Total overage vs the flight's net ≤3461 target stands at **56** (8 from leg 2,
  48 from leg 3) — a **recorded miss, not a gate**, per the FD's standing ruling. Unchanged by leg 4.
- **`npm test` → 1832 tests, 13 suites, 1832 pass, 0 fail** (baseline 1831 + the AC17 description pin).
- **`npm run lint` exit 0. `npm run typecheck` exit 0.**
- **`npm run a11y` exit 0 — GREEN, no new violations**, 22 accepted-baseline nodes, all informational.
  *(Required launching the live GUI — the audit drives a running app. Only **4** `sheet:*` states appear
  in the output; **all six ran**. Enumerated off the tool at `a11y-audit.mjs:400-410`: `kebab`,
  `container`, `site-info`, `new-container`, `page-context`, `tab-context`. The other two raise **zero**
  violations, so they have no accepted-baseline entries (`:137-140` lists only the 4 that do). The
  per-state control at `:419-421` throws with the state label unless dismissal returns `'escaped'` —
  so exit 0 **is** the six-state proof. Verified by reading the tool, not by trusting exit 0.)*
- **AC23 — the pinned paths are byte-unchanged by this leg, verified by tool.** Every file under
  `src/`/`scripts/`/`CLAUDE.md` carries an mtime of 14:42–14:59 (legs 1–3, before this leg began). The
  one exception is `src/main/automation/mcp-tools.js` (mtime 15:52): the AC17 mutation test rewrote and
  restored it, so its **mtime moved but its bytes did not** — `diff -q` against the leg-4-start backup
  reports identical. `tests/behavior/tab-surface-geometry.md` pinned (AC9): 0 diff lines.

#### What only landing knows

**1. AC17's synthetic-fixture control is NOT sufficient — the pin it certified was DEFEATED, and a
mutation test is what caught it.** This is the leg's most important finding and it corrects the AC.

AC17 requires the pin be "proven capable of failing" via *"a same-run synthetic fixture (an in-test
tool object whose `description` omits the token) rejected by the same assertion helper."* That control
was written, and it **passed**. The pin was still broken:

- The first pin used `/all windows/i` for `enumerateTabs`. **Deleting the real contract claim
  (`across ALL windows`) from the real description left the suite at 85/85 GREEN.**
- Cause: `all windows` occurs **TWICE** in that description — once as the contract claim (*"tabs
  across ALL windows"*) and once in an unrelated **jar-key aside** (*"a jar key sees all windows' tabs
  for its own jar"*). The aside alone satisfied the token.
- **The synthetic control could never have caught this**: it proves the **helper** works against a
  fabricated string. It says nothing about whether a **token discriminates against THIS tool's real
  prose.** Only mutating the real source did.
- Fixed to `/across ALL windows/i`; **re-mutated: 84/85, 1 fail**, message
  `enumerateTabs's description is missing contract tokens: /across ALL windows/i`; restored: 85/85.
  The pin is now proven against **real** drift, not synthetic drift.
- The test now carries a **token-discrimination control** that asserts the loose token's defeat
  explicitly, so nobody loosens it back, plus the maintenance rule: **mutation-test every new token
  against the real description.** A token audit is recorded there distinguishing **identifier** tokens
  (`windowId`, `booted`, `sheetVisible`, `lastFocused` — multi-occurrence but every occurrence is
  contract-bearing; low risk) from **natural-language phrases** (the hazard: they recur in unrelated
  senses).
- **This is the flight's signature error one level deeper than anyone had it**: not a count stated in
  prose, but *a control that certified an instrument it never actually tested.* It is the same shape as
  the flight's absence-assertion lesson — an instrument shown able to report presence **against a
  fixture** was never shown able to report it **against the artifact under test**. **Carry to the
  debrief.**

**2. NEW LIVE DEFECT — the same false caveat lives in `menu-overlay.md`, which AC13 does not cover.**
AC13.1 identifies the *"may not composite the overlay view"* caveat in `find-overlay-geometry` as stale
and **actively harmful** (it instructs an Executor to defer a fully-assertable step to the HAT) and
scopes the erratum to that spec. **The identical claim and the identical HAT-deferral instruction were
live in `menu-overlay.md`** (*"overlay-presence checks are best-effort — … defer to the HAT if the
fallback is in force"*). Verified independently against source before acting: the WSLg composite builds
an explicit bottom-up layer list (guest → find bar → sheet), and **its own comment names the failure the
layers prevent**: *"without the overlay layers a Wayland-path captureWindow would silently omit an OPEN
MENU / find bar that IS on the real screen."* Folded out of both specs.

**3. The leg's own citation for that claim is imprecise — the claim survives, the pointer is wrong.**
The leg cites `main.js:681-709` as where the overlay layering was *"verified twice"*. That range is the
**`desktopCapturer` branch and the start of the fallback comment**. The actual layering evidence is at
**`:746-800`** (layer-list comment `:746`, guest push `:757`, the DD5 overlay-layer comment `:759`,
overlay pushes `:777` and `:799`). Same shape as DD6's *"every ruling survives; only labels were wrong."*

**4. TWO MORE drifted citations — inside the leg's own "Verified OK" list.** The leg's Citation Audit
lists `foreground-to-act` `:13`/`:44` as **verified OK**. Read at implementation:
- Intent is at **`:12`** — **`:13` is a blank line**.
- Out of Scope is at **`:38`** — **`:44` is the Variants bullet** (*"N/A. Could parametrize Step 3…"*).

Both **claims** are correct (Intent and Out of Scope really are falsified; DD6 really is the "future
mode"). Only the pointers are wrong. **This is precisely what the leg says leg 3 did** — *"Leg 3's
Citation Audit carried four drifted rows inside its 'verified OK' list … the leg written to stop
citation drift carried drift in the very claim it sells."* **Leg 4's audit did the same thing, in the
same section, while quoting that lesson.** The rate holds: this leg re-derived ~40 citations and found
2 bad inside the "verified OK" list (~5%), against the brief's measured 20%.

**5. My own verification one-liner reproduced the flight's signature error, live.** Summing AC19's six
headings with `grep -oE '^### [A-Za-z /]+ \(([0-9]+)\)'` printed **27** against headings that visibly
read 18+4+2+2+3+1 = **30**. Cause: the char class omits the **hyphen**, so `Admin chrome / app-level (3)`
never matched and was **silently dropped** (30−3=27). A computed total, wrong, with no error — from the
very command written to check a computed total. **This is why AC19 is worded "enumerated and summed BY
READING THEM."** Re-run with each addend printed individually: 18, 4, 2, 2, 3, 1 → **30 = the tally.**
*Generalization for the debrief: a clever expression in the verification path is itself an unverified
instrument. The AC's insistence on reading the enumeration is not ceremony — it caught this.*

**6. NEW — a stale enumeration in SOURCE, not in a spec (`src/renderer/renderer.js`).** `:250-251`
reads *"APG menu-button: role="menu" popup with **four** static role="menuitem" items (Settings,
Downloads, Print…, Exit)"* — while **`:385-392`'s live `kebabModel` lists SIX** (New window, Settings,
Downloads, Cookie jars, Print…, Exit). **The two are 134 lines apart in the same file.** The flight's
signature error, in source, in a comment. **NOT FIXED — `src/` is pinned byte-unchanged by AC23.**
Recorded for the FD: it is a comment (no behavioral effect) and belongs to the next flight or the
maintenance backlog. *(The six-item model landed in the specs was read off `kebabModel` itself, per the
leg's instruction to confirm against the renderer rather than another artifact — which is how the stale
comment surfaced.)*

**7. The grep-AC / erratum-annotation collision is REAL and required a design choice.** An annotation
documenting the walk's removal necessarily *names* the walk — and the AC8 grep counts those tokens. In
`kebab-menu` (in the grep's scope) my first annotation drafts made AC8 and AC12 report **1** each,
purely from prose describing the deletion. **Resolved by rewording the annotations, not by weakening
the grep** — an annotation's job is to say *what changed*, not to restate the retired mechanism; that
keeps the grep's 0 load-bearing. `multi-window-shell` keeps descriptive tokens because AC8 **scopes by
filename and deliberately excludes it**, and the leg explicitly permits history notes to carry the
token. The split is intentional: **in-scope files avoid the tokens; the out-of-scope rewrite may
describe its own history.**

**8. `menu-dismissal`'s stale citations: repaired by DELETING line numbers, not by refreshing them.**
The four internal citations were confirmed uniformly **+27** (`:76-79`→`:103`, `:97-100`→`:124-126`,
`:106-109`→`:133-136`, `:144-145`→`:171-172` — each printed and read). Two of the four lived in the
annotation this leg **retired**, so they went with it. The surviving two (in the blur-scoping warning,
which the leg correctly says **stays**) now cite **by section name**. Rationale, recorded because it
departs from a literal reading of AC14: **these citations drifted because adding annotations to the file
pushed down the content they pointed at.** Writing fresh line numbers into a file this leg is actively
editing — and that every future flight will edit — **restarts the same clock**; my own edits moved these
lines again *during* this leg. Section names cannot drift when the file is edited above them. The spec
now carries the rule inline so the next maintainer doesn't reintroduce the pattern.

**9. `multi-window-shell`'s Out of Scope carried a DD5-deleted mechanism, and it is not in AC5's
table.** The blur bullet read *"The **attachment conditioning** is unit-pinned"* — but DD5 **deleted**
the `getAttachedWindow() === win` checks outright; a per-window instance *is* its own scope, so there is
nothing left to condition or to unit-pin. Rewritten under AC5's full-rewrite mandate (*"a rationale for
a mechanism that no longer exists"* — the class the leg names three times). It is also where the DD7
blur ruling now lands.

#### The AC4 FD ruling on the DD7 blur HAT — RECORDED, NOT AMBIGUOUS

**RULING: an ACCEPTED PERMANENT GAP for this mission. NOT a HAT ticket.** Written into
`multi-window-automation.md`'s Out of Scope with its full mechanism, and cross-referenced from
`multi-window-shell.md`. Recorded verbatim so a future maintainer on a real desktop can discharge it
deliberately:

- **The gap:** leg 1 deleted `if (menuOverlay.getAttachedWindow() === win)` in favour of an
  unconditional per-window `sheet.closeMenuOverlay('blur')`. The deleted guard's own comment names the
  **only** scenario that exercises it: **opening a menu in window B is killed by window A's in-flight
  blur — the two-window open handoff.** The guarded and unguarded forms are **behaviorally identical in
  a single-window rig** (*there is no third case with one window*), so no single-window run can
  distinguish them **even on a platform that delivered a real blur**.
- **Why not claimed live:** WSLg delivers no OS blur to a scripted stimulus (F6 spike verdict 4).
- **Why NOT a non-WSLg HAT pin:** the operator's only desktop **is** WSLg (the mission's Environment
  Requirements name it). A non-WSLg ticket would have **no venue to run in** — precisely the
  *"unqualified HAT item that silently cannot run"* failure this flight named. An honest permanent gap
  beats a ticket that can never be discharged.
- **What IS asserted instead, live:** per-window dismissal scoping — two sheets open, dismiss A's, B's
  **stays open** (`multi-window-automation` step 6; `multi-window-shell` variant V2). A real, distinct
  property the roaming singleton could not have had.

#### The leg's own corrections, confirmed at implementation

- **Item G's premise was FALSE — confirmed by reading all four descriptions verbatim.** Leg 3 had
  already fixed both DD3 descriptions. `mcp-tools.js:121` states *"across ALL windows … { …,
  windowId }"*; `:413` states *"windowId is OPTIONAL … this op returns pixels, not topology."* Both
  correct and current. **Leg 4 landed the PIN ONLY** — no description was edited. And *"nothing pins a
  tool DESCRIPTION"* was over-broad: **7 tools already had pins** (`pressKey` `:147`, `readAxTree`
  `:577`, `evaluate` `:753-755`, `injectScript` `:765-767`, `openDevTools` `:831`, `closeDevTools`
  `:838`, `getHistory` `:1092-1095`) — all **untouched**. The real gap was the **4 topology-bearing
  tools**, exactly the set F7 changed. This AC **added 4**; it did not rewrite the file's approach.
- **Item D's 5 → 3 — confirmed, read off the tool.** `grep -c enumerateTabs` pre-edit:
  `closed-tab-reopen` **11**, `kebab-menu` **6**, `popup-jar-inheritance` **1**,
  `tab-keyboard-operability` **0**, `unified-tab-controls` **0** — matching the leg exactly. The two
  zeros count tabs **exclusively** via `readAxTree(chromeWcId)`'s `tablist`, a per-window instrument
  DD1 cannot touch: **pinned unchanged**. *(Post-edit the three read 12/6/2 — the restatement notes
  legitimately add mentions; AC11's 0/0 is unchanged, which is the load-bearing half.)* *(The tenth
  instance of the count/enumeration pattern.)*
- **Item E's 4 → 5 sites — confirmed.** `kebab-menu`'s **Observables `:116`** (*"count = exactly 4"*)
  was missed by the brief **and** by the spec's own header annotation. All five sites (`:1`, `:27`,
  `:116`, `:134`, `:136`) refreshed; both header annotations retired; the stale *"four items since M04"*
  note gone. Post-edit `grep -cE 'four|exactly 4'` → **0**. *(The eleventh.)*
- **AC19's NEW find — confirmed live and fixed.** `docs/mcp-automation.md:533` read
  `### Admin chrome / app-level (2)` over a **3-row** table (`getChromeTarget`, `enumerateWindows`,
  `downloadsList`) while the overview at `:20-21` already said *"3 admin chrome/app-level tools"*. The
  six headings summed **18+4+2+2+2+1 = 29** against a declared **30**. Fixed to `(3)`; `:535`'s *"Both
  tools"* → *"All three"*, *"calling either"* → *"calling any of the three"*. **Leg 3's AC8 enumerated
  seven *total*-count sites and landed all seven — a *category* count in a subsection heading was not
  among them.** The AC is written as the **SUM** because a site list is exactly what missed it.
- **Six brief citations — all confirmed at the leg's corrected values:** `mcp-tools.js` tally at
  **`:591`** (not `:577`); `docs/mcp-automation.md` "All 30 tools" at **`:441`** (not `:394`);
  `menu-dismissal` walk at **`:82-86`** (not `:55-58`); `menu-overlay` at **`:58-62`** (not `:48-50`);
  `find-overlay-geometry` at **`:82-88`** (not `:62-67`); `EXPECTED_TOOL_COUNT` at **`:27`** (not
  `:26`). **The three drifted spec ranges are exactly the three the leg-1 triple annotated** —
  diagnosable, not random.
- **`multi-window-shell`'s census list omitting `:126` — confirmed.** Step 6 asserts *"window 3's
  census"* through `enumerateTabs()`; the flight spec's list (`:123`, `:125`, `:127`) omits it. A
  rewrite driven off that list would have left step 6 asserting a window-scoped census against an
  all-windows op. Filtered by `windowId` like the rest. And the brief's *"steps 2/3/5/6/7"*
  **over-included step 2**: at step 2 only one window exists, so the all-windows census and the window
  census are the same set — step 2 is **DD2**-falsified (its skip-set clause), not DD1. Only the clause
  was deleted; the census assertion stands.
- **`menu-dismissal`'s four internal citations at a uniform +27 — confirmed by printing each.**
  Citation drift *inside* the artifact documenting citation drift. See item 8 above for the repair.

#### The work

- **NEW `tests/behavior/multi-window-automation.md`** — `Status: draft`, `Last Run: never`, **9 step
  rows** covering all 8 AC1 properties (row 1 lazy-absence; row 2 census shape; row 3 mid-boot
  `booted`; row 4 all-windows array; row 5 two sheets; row 6 DD7 dismissal scoping; row 7 DD6 raise;
  row 8 DD6 no-raise; row 9 `captureWindow` routing + refusal) + a `findVisible`/`findWcId` symmetry
  variant. **AC2 honored in the spec text, not the run log**: row 7 is named the same-run positive
  control for row 8 and **must be judged before it**; row 3 carries the mandatory sampling-limit escape
  hatch verbatim. **AC3 premise audit done against working-tree code** — `enumerateWindows` admin-only
  (`scope.js:193-195`); row shape (`window-census.js:20`, `:102-113`, with `sheetWcId` set only when
  defined — "absent ⇒ never created" confirmed structurally); `enumerateTabs` plain array
  (`scope.js:150`); `captureWindow` `shape: imageResult` unchanged (`mcp-tools.js:409`, `:420`);
  `automation: no-such-window` (`engine.js:154`). Preconditions state the apparatus is a **hand-rolled
  SDK client over Bash, NOT a registered MCP** (the leg-1 false-block), with `.mcp.json`'s empty map
  named as the contract rather than a fault. **Not run — the FD owns it.**
- **`multi-window-shell.md` FULLY REWRITTEN** (157 → 242 lines) — every AC5 row discharged at the line
  it lived on: `:74-75` census premise → an all-windows section with `windowId` filtering + `booted`;
  `:80-86` → per-window sheets via `enumerateWindows().sheetWcId` (the walk **deleted**, not
  re-pointed); step 2 skip-set clause deleted (census stands); steps 3/5/6/7 filter by `windowId`; step
  4 **inverted** to "window 2 has its OWN sheet instance" with the lazy-absence reading before the
  open; step 8 pins the `ERR_ABORTED` **history-entry count = 2**, read off step 2's own commit-settle
  gate, asserted **before** the page so a short history fails as a **named count mismatch**; `:141-142`
  re-scoped to `multi-window-automation` (F7 landed it) + DD4 mis-pick explicitly never claimed live;
  the DD9 authoring constraint restated — **DD4 deleted the mis-pick heuristic, but S2 still holds**
  (Wayland ⇒ dead branch ⇒ a live assertion passes vacuously), so per-wcId `captureScreenshot` stays
  the default and the spec claims nothing about the fix. **Two-menus variant is now a real step
  (V1/V2)** reading `sheetVisible` + distinct `sheetWcId`s — asserting **distinctness**, never leg 3's
  incidental wcIds (4 and 6), which are not a contract.
- **10 probe-walk specs re-pointed** — 9 onto `sheetWcId`, `find-overlay-geometry` onto **`findWcId`**
  (DD2's find half, single caller, confirmed). The whole idiom killed, not just the loop: skip sets,
  the *"probing a background tab activates it"* rationale (leg 2's AC5 retired the hazard), and
  *"discover once per run"* (wrong under per-window instances). Adapted to each spec's voice, not
  pasted. The lazy-resolve hazard the leg flags as most likely — resolving `sheetWcId` **before** the
  first open — is stated in every one. `omnibox-suggestions`'s *"identified lazily"* nuance survives and
  is now first-class. **AC8 caught a real miss**: `internal-tab-menus:89` kept the walk in a **step
  body** after its Preconditions were re-pointed.
- **3 count-precondition specs restated** (AC10) with the single-window premise made **explicit**;
  `tab-keyboard-operability` + `unified-tab-controls` **pinned** (AC11).
- **Errata folded**: `find-overlay-geometry` (3 + the harmful caveat + step 8 promoted from
  "(Optional)" to the deliberate reopen-after-resize assertion, which is what actually exercises
  `show()`'s live `getActiveGuestBounds()` fetch); `menu-dismissal` (5 — AX `focused` demoted
  **globally** to context with `document.hasFocus()` primary; step 2's unnamed conjunct named as a
  **conjunction** *and given its own same-run presence control*; the `RootWebArea focused=true`
  false-positive documented; the click rule generalized to a **coordinate-MEASUREMENT** rule covering
  pixel probes — the step-9 break; and the **root fix at spec scope**: presence-before-absence for
  **every** instrument); `menu-overlay` (3 + the item-2 find); `foreground-to-act` (Intent + Out of
  Scope only — **steps untouched**, stays `draft`/never-run, not promoted, not run).
- **`docs/behavior-specs-single-window-audit.md`** annotated **DISCHARGED in place** (AC20) — a
  six-row table of what F7 did to each open item, the 2→1 and 5→3 arithmetic corrected inline, and an
  explicit **"THIS TABLE IS DATED as of F7 leg 4"** banner so F8 does not sequence off it blind
  (`multi-window-automation` is not in the per-spec table at all).

#### Deviations from Files Affected

- **`tests/behavior/menu-overlay.md`** — took a **fourth** erratum beyond AC15's three: the stale
  *"may not composite … defer to the HAT"* caveat (item 2 above). Rationale: AC13.1 rules that exact
  claim stale and **actively harmful** and orders it deleted; the identical instruction was live in this
  file, and AC13's scoping to `find-overlay-geometry` reflects the leg not knowing it was duplicated.
  Leaving it would have left the harmful instruction in force in the spec **`find-overlay-geometry`
  defers its overlay-presence semantics to**.
- **`tests/behavior/multi-window-shell.md`** — rewrote the **Out of Scope blur bullet**, which AC5's
  table does not list (item 9 above). Within AC5's *"FULLY REWRITTEN"* mandate; it cited DD5-deleted
  machinery.
- **No other deviation.** `src/`, `scripts/`, `CLAUDE.md`, `eslint.config.mjs` byte-unchanged;
  `test/unit/automation-mcp-tools.test.js` is the only test file touched;
  `tests/behavior/tab-surface-geometry.md` and `observe-refusal-contract.md` pinned. The
  `observe-refusal-contract` optional fold was **not** taken (explicitly optional, not an AC).

#### Handoff to the FD

- **`multi-window-shell` is OUT OF PLANNED RED** — rewritten against landed DD1+DD2+DD5. **A first-run
  failure is a spec defect until proven otherwise**: the underlying behavior was proven at leg 1's smoke
  (two sheets, per-window destroy) and leg 3's (32/32). Re-read the run log before touching source.
- **`multi-window-automation` is `draft`** — the FD runs it and promotes it. Its first run is also its
  premise audit's proof (AC3).
- **AC27's five re-pointed AC13 specs** (`kebab-menu`, `internal-tab-menus`, `page-context-menu`,
  `tab-context-menu`, `tab-surface-geometry`) plus the leg-1 exposure triple (`menu-overlay`,
  `find-overlay-geometry`, `menu-dismissal` — all three modified by AC13/14/15) need re-runs.
- **`kebab-menu`'s `Last Run` is `2026-06-07-10-42-52` (pre-F6)** — its refresh is unproven by a run.
- **For the debrief:** items 1 (the control that certified an untested instrument), 5 (the verification
  one-liner reproducing the signature error), and 6 (stale enumeration in source) are the fresh classes.

### Leg 4: spec-realignment-and-verify — FIRST-RUN ERRATA FOLD (2026-07-15)

`multi-window-automation`'s first run (`2026-07-15-21-15-43`) returned **9/9 product-green with four
errata**. Per the F6 first-run precedent, the fold + a full fresh re-run precede `draft` → `active`.
The spec is **left at `Status: draft` / `Last Run: never`** — the FD promotes it after the re-run.
**No commit** (the flight still commits once, after the flight-end review).

**FOLD 1 — the `fixtures-tabstrip` set is now COMMITTED at `tests/behavior/fixtures/tabstrip/`.**
The set was referenced as a shared artifact by multiple specs and **had never existed** — no add in
`git log --all --diff-filter=A`, nothing in `git check-ignore`. Each run silently regenerated it from
prose; nothing pinned page count, content, or markers. Created **six pages** (`page1.html`..`page6.html`,
titled `Fixture Page N — tabstrip`) plus a README pinning content + serve, following the convention of
the sets already committed.
- **Count = 6, ENUMERATED off the specs, not chosen**: `tab-cycling` 1–6 (it **sets the size**),
  `tab-context-menu` 1–5, `closed-tab-reopen` 1–5, `multi-window-shell` 1–4, `multi-window-automation`
  1–2 (2 after FOLD 3's provision). Max = 6.
- **Markers are contract**: every page carries `<h1 id="marker">` + `<p id="body-marker">`. The first
  run's step 8 depended on them and **nothing specified them** — a regenerating Executor would not have
  produced them. Now pinned in the README and named in step 8.
- **`<meta charset="utf-8">` is load-bearing** — the titles carry an em-dash; `responsive-tab-strip`
  records a prior mojibake incident from a charset-less fixture. Verified served: 6/6 pairwise-distinct
  titles, em-dash intact, both markers on all six.

**FOLD 2 — step 2's own-properties assertion was UNFALSIFIABLE; replaced with what the wire CAN read.**
`serialize()` (`mcp-tools.js:57-59`) is `JSON.stringify`, which **silently drops an array's non-index
own properties** — verified independently: an array with `.incomplete` set stringifies **byte-identically**
to the plain array. No MCP client could ever fail that row; the Executor's `wire_isPlainArray_postParse:
true` was true **by construction** and would report green against a fully broken product. Step 2 now
asserts **array-ness** (a `{tabs, incomplete}` wrapper parses as an object — measurable), `windowId`
stamping, and `jarId`, and **cites `test/unit/automation-tabs.test.js:721`** for the own-properties half
— verified before citing: that test carries a genuine positive control (`marked.incomplete = [2]` ⇒
`isPlainArray` false, plus an explicit assert that `Array.isArray` alone cannot catch it). **The reason
is recorded in the row** so a future author does not helpfully re-add the assertion.

**FOLD 3 — "background" defined; the tab it names now exists; rows 7–8 made a controlled pair.**
Steps 1–4 placed exactly one tab in window 2 and it was **active** there, so row 7's "a background tab
in window 2" named a tab the spec never created — and the term carried two readings.
- **Defined in Preconditions**: background = **owning window is not last-focused** (DD6/S1's substance —
  the owning window not being last-focused is what made the dispatch bug observable), explicitly *not*
  the within-window `active: false` sense.
- **Provisioned in SETUP**: step 4 now opens **U** (page 2) into window 2 — confirm-don't-assume, with a
  retry path if it lands in W1 — so **T** is background in **both** senses.
- **Rows 7 and 8 act on the SAME tab (T)**: row 8 first restores row 7's precondition via
  `activateTab(U)`, then re-baselines to window 1. In run 1, row 7's `activateTab` left its target active
  and forced row 8 onto a **different** tab — the pair varied **tab and op** where it must vary **only op**.
- **Variant added** for the case nothing asked for: `activateTab` on a tab **already active** in a
  non-focused window, where the within-window activation is a no-op and **the raise is the only work left**
  — an "already active" early return would skip it and still return `true`, which is the S1 signature
  surviving in the one sub-case the main table cannot see.

**FOLD 4 — A REAL PRODUCT DEFECT, introduced by this flight, FIXED.** `mcp-tools.js:424` described
`readDom` as "(foreground-first)" and **`:452` made the identical false claim for `evaluate`** (the
Validator's catch; the Executor missed the second). Both ops **do not activate** — DD6 deleted the branch
(`observe.js`: readDom's "THIS OP NO LONGER ACTIVATES ITS TARGET"; evaluate's "ONE resolve, no async hop").
**All four verified against the tree before touching anything**: `captureScreenshot` (`:397`) and
`readAxTree` (`:435`) say "foreground-first" **correctly** — both still `await activate(wcId)`. The
operator docs were **already right** (`docs/mcp-automation.md:481` "Does NOT foreground its target";
`:346` names both ops) — so DD6 updated the human docs and left the **machine-readable** descriptions
stale, for the one consumer that matters most: an agentic MCP client that could pick `readDom` **as a
raise primitive** and silently get no raise — the exact hazard DD6 retired. Both fixed, wording aligned
to the already-correct docs. `foreground-first` now appears **exactly twice** in `mcp-tools.js`, on
precisely the two ops that activate.

**The description pin is extended** (`automation-mcp-tools.test.js`), shaped as a **pair**:
`/foreground-first/i` must be **PRESENT** on `captureScreenshot`/`readAxTree` and **ABSENT** on
`readDom`/`evaluate` — **the raise half IS the no-raise half's same-run positive control**, so an
absence pin is never resting on a token unshown able to report presence. Both no-raise ops must also
**state** the contract (`/Does NOT foreground/i`), so a rewrite cannot satisfy the pin by saying nothing.

**MUTATION CONTROLS — AC17's lesson applied (a synthetic fixture proves the HELPER, never that the TOKEN
DISCRIMINATES). Mutated the REAL artifact, both times:**

| Mutation of the real description | Result |
|---|---|
| baseline, unmutated | **86 tests, 86 pass, 0 fail** |
| `readDom:424` reverted to the shipped pre-fold `(foreground-first)` text | **85 pass, 1 fail** — `not ok 72`, the new DD6 pin |
| restored | **86 pass, 0 fail** |
| `evaluate:452` reverted to the shipped pre-fold `(foreground-first)` text | **85 pass, 1 fail** — `not ok 72` |
| restored (`diff` vs pre-mutation backup: **identical**) | **86 pass, 0 fail** |

Four further mutation controls ship **inside** the test (permanent, run every time): deleting each op's
real no-raise claim breaks the `(b)` pin; the verbatim pre-fold `readDom` text is replayed as a
regression fixture; and stripping `foreground-first` from `captureScreenshot`'s real description breaks
the raise-half control — so the raise half cannot pass on incidental prose.

**Found already-done / wrong / missing (recorded, not silently corrected):**
1. **The brief's "five committed fixture sets … each with a README" is wrong on both counts.** There are
   **six** tracked sets — `downloads` was missed — and **4 of 6** have READMEs (`downloads` and
   `menu-overlay` have none). The flight's signature error, in the brief describing the fix for it.
2. **The brief's "four specs depend on the set" is five.** `tab-cycling:52-54` names the set by its exact
   title pattern and needs **six** pages — it **sets the set's size**. Had the count been taken from the
   brief's four, the set would have been built with five pages and `tab-cycling` would break. Re-pointed
   it too; leaving it on prose while its siblings point at a committed path would recreate the defect.
3. **`tab-cycling:54`'s cross-reference was false** — it called this "the same fixture set `tab-reorder.md`
   uses". `tab-reorder` names no shared set and titles its pages `Tab1..Tab5`. Corrected.
4. **`closed-tab-reopen:47` said "Only 3 pages are needed"** — false; it addresses **five** (page 4 at the
   burner-exclusion step, page 5 at the jar-deleted-fallback step). True of its Step-3 setup alone. The
   signature error again. Corrected, with the enumeration stated.
5. **`closed-tab-reopen:46-47` claimed `downloads-surface`/`omnibox-suggestions` "use the same fixture
   set"** — they share the **port**, not the set (`downloads-surface` serves `fixtures/downloads/`;
   `omnibox-suggestions` serves its own ad-hoc pages). Corrected to name the port convention only.
6. **A THIRD stale DD6 claim, in source, outside the brief's scope — `observe.js:407`.** Its `injectScript`
   doc block read *"evaluate keeps foreground-to-act for parity with reads"* — false since DD6, and it
   **contradicts the module's own header** (`:38-40`). Fixed: the DD2 asymmetry it documented is gone;
   both ops now agree on no-activate. A comment, not a machine-readable description — reported as an
   out-of-brief find; one line to revert if the FD disagrees.
7. **`multi-window-shell:72-74`'s read-order erratum was over-broad post-DD6** — *"the eval/read ops are
   foreground-first"*. Restated to name the split: the hazard is now specific to
   `readAxTree`/`captureScreenshot`; a `readDom`/`evaluate` read is order-safe.
8. **The first run's log is NOT in the tree.** No `tests/behavior/multi-window-automation/runs/` exists and
   `body-marker` appears in no artifact — so the step-8 marker evidence could **not** be verified here. The
   markers were taken on the FD's report and are now pinned in the committed fixture, which makes the
   question moot going forward. **Flagged for the FD**: every other spec has a `runs/` directory.

**Gates** — `npm test` **1833 pass / 0 fail / 13 suites** (baseline 1832; **+1** = the new DD6 pin).
`npm run lint` **exit 0**. `npm run typecheck` **exit 0**. `npm run a11y` **exit 0 — "No NEW violations —
every violation node is in the ACCEPTED baseline"**, all **six** sheet states enumerated off the script
(`sheet:kebab`, `sheet:container`, `sheet:page-context`, `sheet:tab-context`, `sheet:site-info`,
`sheet:new-container`); the per-state control at `a11y-audit.mjs:419-421` throws with the state label, so
exit 0 means all six opened, were audited, and closed. **`wc -l src/main/main.js` = 3517, delta 0** — this
fold touched descriptions, a comment, specs, and one test file; **no main-process logic**.

**AC23 deviation, stated plainly**: AC23 pinned every file under `src/` byte-unchanged by leg 4. This fold
**breaks that pin deliberately**, on the FD's fold instruction, for `mcp-tools.js` (FOLD 4's two
descriptions) and — my call — `observe.js` (the stale comment, find 6). AC23 was written when leg 4 owed
"the PIN only"; FOLD 4 is a product-defect fix the FD scoped into the fold. Recorded as a deviation, not
a scope escape.

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

- 2026-07-15 — **FD ruling: leg 1's invariant proof runs the EXPOSURE TRIPLE,
  not all eight.** AC13 enumerates eight specs; the FD orchestrates Witnessed
  runs and is scoping the live proof to the three with actual exposure to the
  overlay conversion — **`menu-overlay`** (the sheet's own compositing spec;
  the audit calls its "the ONE sheet" premise load-bearing and it is "first in
  line when F7 goes per-window"), **`find-overlay-geometry`** (authoritative
  window pixels for the overlay this leg extracted; the audit's "F7's
  per-window find instances hit this spec first"), and **`menu-dismissal`**
  (the blur/attachment conditioning this leg deleted). This follows F6 leg 2's
  precedent exactly — that leg proved a conversion of comparable size with a
  **regression triple**, not the corpus.
  Rationale for the other five: `kebab-menu`, `internal-tab-menus`,
  `page-context-menu`, `tab-context-menu`, and `tab-surface-geometry` consume
  the sheet but assert *menu content and dispatch*, not overlay
  identity/attachment/geometry — the surface this leg touched. They are
  re-run at leg 4 anyway, when they are re-pointed onto `enumerateWindows`,
  so running them twice buys one extra day of confidence at triple the cost.
  **Recorded as a deviation from AC13's literal text.** If any triple member
  fails, the scope re-expands.
  Corroborating evidence already in hand, which is why the triple is
  sufficient rather than thin: all eight specs are **byte-unchanged**
  (`git diff --stat` empty), the Developer reported **no spec needed an edit
  to pass** (the byte-identical premise stands on its own terms), and the live
  smoke already proved the conversion's real behavior — two sheets alive at
  once, per-window destroy on a real close, no leak, no wedge, clean quit.
- 2026-07-15 — **FD CORRECTION: the ruling above named a wrong rationale for
  `menu-dismissal`, and the triple has a hole.** The ruling justified including
  it as "the blur/attachment conditioning this leg deleted." **That is wrong**,
  caught by the run's Executor and confirmed by its Validator against the spec
  text: `menu-dismissal` scopes blur **out**, twice and explicitly
  (`:97-100` "scripted focus can't fake OS blur … HAT-scoped"; `:144-145`
  Out of Scope "OS/app-switch blur dismissal … HAT-scoped"). Zero blurs were
  driven; `win.on('blur')` never fired. **The spec was selected on its topic
  name; its text disclaims the mechanism the ruling wanted covered.**
  The Validator then went further, and this is the part that matters: comparing
  HEAD (`b607411:main.js:1234`, the guarded
  `if (menuOverlay.getAttachedWindow() === win)`) against the working tree
  (`main.js:1171`, unconditional `sheet.closeMenuOverlay('blur')`), **the two
  are behaviorally identical in a single-window rig** — menu open ⇒ the old
  guard is true ⇒ both close; no menu open ⇒ the old guard fails and the new
  call is idempotent ⇒ same observable. There is no third case with one window.
  So **no single-window test can distinguish the pre- and post-deletion code —
  even one that drove a real blur on a platform that delivered it.** The
  deleted guard's own comment names the only scenario that exercises it:
  *"opening a menu in window B is killed by A's in-flight blur (the two-window
  open handoff)."*
  **Disposition**: `menu-dismissal` KEEPS its place in the triple on the honest
  ground — **single-window invariant coverage** (it drives the per-window
  `sheet` slot, the `closeMenuOverlay` family, model-replace, and the DD5
  Escape→refocus through the converted wiring). The triple proves what it was
  built to prove. But **the DD7 blur-conditioning deletion is genuinely
  unverified**, and is unreachable by ANY single-window test on structural
  grounds — not merely unreached by this one. Carries:
  1. It must become an **explicit AC at the first F7 leg that has two windows
     live** (leg 4's `multi-window-automation`), not a standing HAT item.
  2. **The HAT may be unexecutable on this platform.** F6 spike verdict 4
     ("WSLg delivered no blur — focus APIs inert") is about *scripted* stimuli;
     a real human alt-tab on a real desktop should still deliver OS blur — but
     a HAT performed **on WSLg would prove nothing**. Either pin that HAT item
     to a non-WSLg desktop or record it as an accepted permanent gap. Do not
     leave it as an unqualified HAT ticket that silently cannot run.
  3. **Green tests over now-unreachable code**: the nine DD7 tests at
     `menu-overlay-manager.test.js:680-773` still pass while exercising
     machinery `main.js` no longer drives (AC14 pinned the module
     byte-unchanged by design — a correct, recorded disposition). That converges
     with the blur hole: the cross-window blur class has **no live coverage
     anywhere** — the behavior test can't reach it, and the unit tests that look
     like they cover it test a path main.js no longer calls. Retire them
     alongside `getAttachedWindow` at leg 3.
  Lesson for the debrief, and it is the same shape as this flight's count
  errors: **the ruling was made from the audit's one-line topic classification
  rather than from the spec's own scoping text.** A spec's name is not its
  contract. Read the Out of Scope section before selecting a spec as evidence.
- 2026-07-15 — **A three-instrument false-reading chain in one checkpoint —
  the sharpest methodology find of the flight, and it nearly shipped twice in
  opposite directions.** `menu-dismissal` step 2's Expected Result is a
  three-way conjunction whose third conjunct is "no focus is stolen to the
  trigger". The spec **names no observable for it**. What happened:
  1. **Instrument 1 — a broken AX parser gave a false PASS.** The Executor's
     parser looked for a top-level `focused` field; it actually lives inside
     each node's `properties` array (and `RootWebArea` reports `focused=true`,
     a second trap). It returned `found:false`, which *looks exactly like*
     "focus was not stolen". The conjunct was **confirmed by malfunction, not
     by measurement**. The Executor later root-caused this parser bug on a
     different step (where it produced a false FAIL) and re-ran that step — but
     step 2 was never revisited, so the false pass survived.
  2. **Instrument 2 — pixels cannot discriminate.** The Validator caught the
     tainted conjunct, tried to settle it independently, and could not: it
     cropped the kebab rect from the step-2 capture and compared it against a
     frame where focus was *proven* on the kebab — **indistinguishable, no
     focus ring in either**. It returned INCONCLUSIVE rather than a charitable
     pass. This is the evidence-for-pass rule doing exactly its job.
  3. **Instrument 3 — the AX tree cannot discriminate EITHER, and the fix
     instruction was itself wrong.** The FD told the Executor to re-measure
     "with the fixed parser". Following that literally would have produced a
     **false FAIL — the mirror image of the original false pass** — because AX
     `focused` tracks the chrome document's `activeElement` and **persists even
     when that webContents holds no OS focus**. It reads *identically*
     (`More`/#kebab) for the Escape control (focus genuinely restored) and for
     the outside-click case (focus not restored). The Executor added an
     **Escape positive control** on its own initiative, which is the only
     reason the third reading is a measurement of absence rather than a third
     artifact.
  **Only `document.hasFocus()` discriminates.** Final measurement: T1 (menu
  open) chrome `hasFocus() === false`, sheet `true`; T2 (after outside-click)
  chrome `false`, sheet `false` — no webContents holds focus at all; the
  `#kebab` `activeElement` at T2 is **residual from T1's opening trigger
  click**, not acquired at dismissal (the T0 omnibox anchor establishes the
  baseline). Matches `closeMenuOverlay`'s
  `if (reason === 'escape' || reason === 'activated') focusChrome(...)` —
  `'outside-click'` is deliberately excluded — **measured, not inferred**.
  **Carries:**
  - Spec erratum (leg 4): step 2 must **name `document.hasFocus()`** as the
    primary discriminator for the focus conjunct, with AX/`activeElement` as
    context only. An Expected Result with no named observable is how this
    started.
  - Spec erratum (leg 4): generalize the spec's "re-locate before each click —
    do NOT cache" rule (`:76-79`) to a coordinate-**measurement** rule covering
    pixel probes, not just clicks — a hardcoded pixel region broke on step 9
    for exactly this reason (the ▾ trigger shifts right as tabs are added; the
    spec warned about it *for clicks* and the Executor honored it for clicks).
  - Spec erratum (leg 4): document the `RootWebArea focused=true`
    false-positive in the `focused`-property guidance (`:106-109`), which is
    otherwise correct.
  - **Methodology (mission debrief):** a positive control is what converts
    "the instrument reported nothing" into "the property is absent". Two of the
    three false readings here were *absence claims resting on an instrument
    never shown capable of reporting presence*. Cheap rule: when an Expected
    Result asserts an absence, measure a known-present case with the same
    instrument in the same run.
- 2026-07-15 — **Leg 1 invariant AC SATISFIED. Exposure triple: ALL THREE PASS**
  (specs unmodified; regression mode — fresh batched Executor + fresh
  single-pass Validator per spec, the F6 leg-2 pattern):
  **`menu-overlay` 6/6** (runs/2026-07-15-16-32-06) — the guest viewport is
  **byte-identical** to the pre-conversion baseline, maxdelta **0**, not
  "under threshold"; and not vacuously so, since the same frame advanced the
  fixture clock 4 minutes and 260 ticks. **`find-overlay-geometry` 8/8**
  (runs/2026-07-15-17-05-00) — the flight's riskiest extraction is clean:
  geometry lands on `computeFindOverlayBounds`'s prediction **to the pixel
  across three guest widths** (1398→1007, 1038→647, 2558→2167) with exact
  round-trip identity. **`menu-dismissal` 9/9**
  (runs/2026-07-15-17-45-00) — dismissal, swallow, mutual exclusion, roving,
  and DD5 focus-restore all hold through the converted wiring.
  **The single-window invariant is proven.** Leg 1 → ready for the flight-end
  review. Three of the eight AC13 specs were run per the scoping ruling above;
  the remaining five are re-run at leg 4 when they re-point onto
  `enumerateWindows`.
  **A framing correction the `find-overlay-geometry` Validator insisted on
  recording**: that run **cannot and does not** perform a pre- vs
  post-extraction pixel diff — no pre-extraction capture exists on its fixture,
  and the prior run used a different page. What it proves is *better*:
  `find-overlay-geometry.js` (the pure bounds formula) is **untouched by leg
  1**, so the real invariant is "does the extracted plumbing still feed the
  unchanged formula correct live guest bounds and apply the result to the real
  view?" — answered yes in three widths. A cross-run pixel diff would have been
  confounded by fixture differences.
  **Two spec errata queued for leg 4 beyond the menu-dismissal set**:
  `find-overlay-geometry`'s "may not composite the overlay view" caveat is
  **stale AND actively harmful** — it would instruct a future Executor to defer
  a fully-assertable step to the HAT (the WSLg composite **does** layer the
  window's own overlays, verified twice at `main.js:681-709`); and step 8's
  **accidental** strengthening should be promoted to a deliberate assertion
  (hide find → resize → reopen → assert the bar lands at the NEW guest's
  top-right — it exercises `show()`'s live `getActiveGuestBounds()` fetch where
  the **per-instance** `lastGuestBounds` fallback would strand it, which is
  *precisely* leg 1's state-ownership change, and is currently reachable only by
  luck via the WSLg lag). Both annotated in the spec headers, unfolded — folding
  now would break the "unmodified" premise the proof rests on.
  **A crew-file gap worth the debrief**: one Executor spawn **blocked falsely**
  (`[BLOCKED:no-apparatus-*]`, "the project isn't here") **after zero tool
  calls**, reasoning from its default cwd and from `captureWindow` not being in
  its tool list. Root cause is methodology, not laziness: the crew file's
  apparatus-discovery step says *"scan registered MCPs by name pattern"*, but
  this project's apparatus is **not a registered MCP** — it is a hand-rolled SDK
  client the Executor writes over Bash (`scripts/mcp-example-client.mjs` is the
  template). One Executor inferred that; another followed the crew file
  literally and stopped. Credit: its reasoning about *why* a bogus PASS is the
  worst outcome was exactly right — the instinct was sound, the premise-check
  was missing. **Fix the crew file's apparatus-discovery instruction.**
- 2026-07-15 — **FD ruling: main.js is 3469 — the numeric target is BLOWN, and
  leg 3 hasn't run.** Leg 1 took it 3461 → 3392 (−69); leg 2 put back +77.
  Against the flight's stated net target of **≤3461**, headroom is not merely
  consumed but **negative (−8)**, with leg 3's op wiring still to land.
  **Ruling: the target stands as a recorded miss, not a gate** — the flight
  defined it as a checkpoint precisely so this call would not be forced
  mid-flight, and the number is recorded at each landing as designed. **This is
  the F6 debrief's main.js item coming due, not a leg-2 defect**: leg 2 added a
  genuinely new capability surface (the raise idiom + the `executeInChrome`
  seam) to a file already past the size that triggered the *renderer's* own
  scheduled split. Carry to the debrief and the maintenance flight with a real
  number, and do **not** let leg 3 silently absorb it — record leg 3's delta
  separately. Worth stating plainly for the debrief: F6's failure was having no
  number; F7 had one and **missed it**. A number you miss is still worth far
  more than no number — it converts a vague "main.js is getting big" into a
  scheduled decision with evidence.
- 2026-07-15 — **The grep-AC pattern is ROOT-CAUSED: a design fault, not four
  unlucky mistakes.** Four grep-ACs have now failed in this flight, all in the
  same direction — **passing on wrong code or failing on correct code**:
  leg 1's were comment-blind; leg 2's AC6 was **syntax-blind** (it expected
  `chromeForTab:` while the adjacent code at `main.js:767` uses ES6 shorthand
  `grabWindow,` — so it would have returned **0 on a correct injection**, exactly
  inverting its stated purpose); AC1's grep miscounted its own doc comment; and
  **AC7's `grep -c "require('electron')" → 0` fails correct code outright** —
  `capture-timeout.js` has *no requires at all* yet returns 1, because its own
  header comment names the token. The decisive control the implementer ran:
  **`observe.js`, the repo's own canonical Electron-free exemplar, also returns
  1** — the AC reports the house's reference module as Electron-bound.
  **The synthesis**: the legs demand *"keep every earned comment"* while their
  grep-ACs count the very tokens those comments must cite. **Every failure sits
  on that fault line.** AC6 — line-anchored and shipped with a control grep —
  was the only one to survive contact, and the implementer ran its control
  (`grabWindow` → 2) before the assertions.
  **Debrief carries**: (1) a grep-AC must be **run against a candidate correct
  diff before it ships**, not written from intent; (2) it must **mask comments**
  — `broadcast-invariant.test.js` already has `maskComments`, so the house
  solved this and the ACs simply don't use it; (3) it must **ship a control**
  proving it can report the positive case — the same presence-before-absence
  discipline the leg-1 triple established for behavior tests, which turns out to
  generalize to static checks. Note the shape: **the one artifact in this flight
  that never erred is the one that enumerated.**
- 2026-07-15 — **"Green tests over now-unreachable code" recurred one leg later
  — treat it as a flight-level finding, not three incidents.** Leg 1 flagged the
  class (9 DD7 tests green over machinery main.js no longer drives). At leg 2 the
  review named 4 observe tests AC5 would break; the designer swept and found **3
  more that stay green but go vacuous**; the implementer found an **8th**
  (`automation-observe.test.js:893` — valid assertion, **falsified trailing
  comment**). All 8 now carry dispositions. A comment can go stale **inside a
  green test** with no enumeration catching it. This converges with the DD7 blur
  hole: in both cases the suite's greenness is actively misleading about what is
  covered.
- 2026-07-15 — **FD CORRECTION: the entry above overstated the DD7-test half of
  that finding, and leg-3 design caught it by enumerating.** The FD asserted the
  nine DD7 tests (`menu-overlay-manager.test.js:680-773`) are green "while
  exercising machinery main.js no longer drives", and instructed leg 3 to rule
  on retiring `getAttachedWindow()` and the "inert" `attachment`/`crossWindow`
  machinery. **The premise is wrong for 8 of the 9.** `attachment` is **live,
  not inert**: `main.js:527` still passes an attachment, and
  `attachedContentView()`, `attachment.win`, and `nextAtt.bounds` are read on
  **every menu open**. Enumerated test-by-test, **exactly one** (`:720`,
  cross-window model-replace) sits over unreachable code, and a second (`:744`)
  went vacuous.
  **This is the FD making the flight's own signature error** — a
  total asserted in prose ("nine tests") where an enumeration was owed, and the
  eighth instance overall. It is also the *second* time the FD reasoned from a
  label rather than the artifact (after the `menu-dismissal` topic-name ruling).
  **The finding survives but shrinks honestly**: "green tests over unreachable
  code" is real at 8 observe tests (leg 2, enumerated and disposed) + 1 DD7 test
  — not 8 + 9.
  **Ruling on the retirement: DEFER to the M09 maintenance flight** with a named
  owner and a sized ticket, per leg 3's argument, which the FD accepts in full:
  the urgency evaporates at 1-of-9; `getAttachedWindow()` alone (1 definition, 5
  test-only reads, **0 production readers**) is cosmetic while the record it
  reads stays live; retiring it re-opens leg 1's AC14 byte-unchanged pin **that
  the just-landed invariant triple rests on**; deleting `crossWindow` rests on an
  **unverified `win.contentView` identity-stability premise whose failure would
  be silent** — the exact shape this flight has now paid for eight times; and it
  is off leg 3's risk axis (external interface), with its live coverage landing
  at leg 4 anyway.
- 2026-07-15 — **Two more FD brief premises were false, both caught by leg-3
  design re-deriving instead of trusting.** (1) The FD justified the
  `a11y-audit.mjs` re-point on the ground that its walk "activates background
  tabs" — **leg 2's own AC5 killed that hazard** (`evaluate` no longer
  activates), and `CLAUDE.md:388` already says so. The re-point still stands, on
  the honest grounds: the **unfiltered** `enumerateTabs`-failure fallback, and
  O(64)→O(1). (2) The FD's DD2 shape assumed `window-registry.js` exports
  `lastFocusedId`; **it does not** — `lastFocused` needs an identity compare
  (preferred: keeps the registry's pin intact) or a new accessor.
  Also swept at leg 3 because **no leg owned them**: `CLAUDE.md:29` and `:169`
  are **actively-false leg-1 residuals** (the find bar and sheet are still
  documented as roaming singletons), and `automation-mcp-tools.test.js:541-553`
  pins `captureWindow` as no-input, which DD3 falsifies — unnamed by the flight,
  now rewritten with an inverted assertion rather than deleted.
  **Citation drift at leg 3 was severe and is worth recording as evidence for
  the debrief**: ~20 citations required correction after legs 1-2 (3461 → 3392 →
  3469), including DD1's load-bearing synchronous delete/set pair, which has now
  **moved twice** (`:2699-2700` → `:2639-2640` → `:2712-2713`) — and **that pair
  is exactly where DD1 records F8's constraint.** A constraint pinned to a line
  number that moves twice inside one flight is a constraint that will be lost.
  **Debrief carry: pin constraints to code identity (a named function, a grep-able
  invariant, or a test), never to a line number.**
- 2026-07-15 — **Leg 3 (`automation-window-semantics`) designed. Risk tier:
  HIGH** (shared automation interface with external consumers). Per-leg design
  review ran and returned **approve-with-changes with NO functional or
  correctness defect in any AC or guidance step** — the cleanest review in the
  flight. It independently re-derived every substantive claim and confirmed all
  of them: the DD3 correction end-to-end, the `getAttachedWindow` DEFER
  enumeration test-by-test, DD1's `rec.tabViews.has(wcId)` filter and the
  unchanged jar facade, DD2's zero-new-state (incl. the `lastFocusedId`
  identity-compare, since the registry exports no such accessor), and DD4's pure
  picker. Two LOW findings folded: AC1's `executeInChrome` guard is **dead code
  with an inapplicable rationale** (`engine.js:91-94` builds it
  *unconditionally*, not via the conditional-spread idiom leg 2's `chromeForTab`
  used — so leg 2's precedent doesn't transfer); and **four Citation-Audit
  entries marked "confirmed, no drift" were themselves drifted** (`tabs.js:41-53`
  → `:40-51`; `mcp-tools.js:110-117` → `:108-115`; `menu-overlay-manager.js:300`
  → the real `.win` reads are `:304`/`:310`; `:343` cited for `getView()` →
  it is at `:334`, and `:343` is `getAttachedWindow`). None dangerous, but they
  are four more data points for the citation-drift class — and pointed, since the
  audit's completeness claim is what the leg sells.
  **The leg buys back lines against a blown target the honest way**: two new
  pure modules — `window-census.js` (which makes DD2's "zero new state"
  *provable* rather than asserted) and `capture-source-picker.js` (DD4's **only**
  rig-provable half, since S2 means the `desktopCapturer` branch is dead code on
  WSLg) — carry the leg's substance **out of unit-test-exempt main.js**. That is
  the F6 debrief's "the debt lives exactly where the tests can't go" lesson being
  acted on rather than restated.
  **Two firsts worth recording.** (1) **Every grep-AC in this leg was run against
  the working tree WITH ITS CONTROL before shipping** (`observe.js`→0,
  `engine.js`→1, `grabWindow`→2, `bestScore`→2, walk→1), and the reviewer re-ran
  them independently and matched — **the first grep-ACs in this flight to survive
  contact**, and direct evidence that the root-cause fix (line-anchor,
  comment-mask, ship a control) works. (2) The mid-boot absence claim ships with
  a same-run positive control **and** an explicit *"record the sampling limit,
  don't claim the observable"* escape — the leg-1 false-PASS lesson applied
  without being told to, on a genuinely narrow timing window where the honest
  answer may be "the smoke could not catch one."
- 2026-07-15 — **Leg 3 landed. The flight's headline observable is PROVEN.**
  1831/1831 (+45, reconciling exactly: 15+9+10+8+3), lint clean, typecheck
  clean, **`npm run a11y` green** after the `findSheetWcId` re-point. Smoke
  **32/32**:
  - **Two sheets visible at once — `sheetVisible: true` on BOTH windows with
    distinct `sheetWcId`s (4 and 6).** Impossible under F6's roaming interim *by
    construction*; the definitive proof DD5's per-window conversion is real.
    `multi-window-shell.md:153-157` pre-registered this variant a flight ago; it
    now has its evidence.
  - **Mid-boot caught on poll 1, with better evidence than the AC asked for**:
    the mid-boot row reports `activeTabWcId: 2` — **the adopted tab is already in
    the record** — while `enumerateTabs` returns **zero rows** for that window.
    That is DD1's disclosure gap made directly observable, and exactly why
    `booted` exists. **No sampling limit claimed; the escape hatch was not
    needed.**
  - All grep-AC controls run and reported **as numbers**, not as "passed".
- 2026-07-15 — **FD note: main.js 3469 → 3517; leg-3 delta +48, recorded
  SEPARATELY as instructed.** Total overage vs the ≤3461 net target is **56**
  (8 from leg 2, 48 from leg 3) — leg 3 did **not** absorb leg 2's miss. The
  target stands as a recorded miss, not a gate. Note what the number bought: leg
  3 moved its substance into two **pure, unit-tested** modules
  (`window-census.js` 120, `capture-source-picker.js` 50) rather than into
  main.js, so the +48 is wiring, not logic. **The maintenance flight inherits a
  real number and a real diagnosis** — which is the whole point of having had a
  number at all.
- 2026-07-15 — **NEW GAP, leg 4 owns it: nothing pins a tool DESCRIPTION.**
  Found by the leg-3 implementer; it is the **S10 class one level up**. DD9 pins
  `inputSchema` field-by-field and `EXPECTED_TOOL_COUNT` pins the tally — but
  `listTools` also projects **`description`**, and **nothing guards it**. So a
  description can **lie to every external consumer** while all 30 tools, every
  schema, and every count stay green. Concretely: **both DD3 tool descriptions
  asserted the OLD contract in prose** after this leg changed it. This is the
  exact failure DD9 exists to prevent, in the one field DD9 doesn't cover — and
  a description is what an agentic consumer actually reads to decide how to call
  a tool. **Leg 4: fix both descriptions and extend the pin to cover them.**
- 2026-07-15 — **Two leg-3 judgment calls worth recording — both the right call
  under pressure to do the easy thing:**
  1. **AC10's "passes unmodified" was over-claimed by one line, and the test
     failed on CORRECT code.** `automation-mcp-tools.test.js:597-598` (the real
     image-contract control) pass verbatim; **`:599` pins the engine-dispatch
     signature, which DD3 changes by design**. The control was sound; its stated
     scope wasn't. The implementer kept `:597-598` untouched, corrected `:599`,
     and **added a sibling pinning the content byte-identical with and without
     `windowId`** — AC10's real claim, now pinned directly. It **explicitly
     rejected the tempting fix**: branching production code on `windowId == null`
     to preserve the literal green. That would have bent the product to satisfy a
     mis-scoped assertion — the inverse of what an AC is for.
  2. **`captureWindow`'s `no-such-window` refusal had no home in the guidance's
     shape**: `grabWindow` returns `null` for *both* an unknown record and a real
     capture failure, so inferring the refusal downstream would answer
     "no-such-window" for a window that exists. Resolved by validating in the
     engine (`requireWindow`, shared with `getChromeTarget`) before delegating —
     which also keeps DD2 the single topology source.
- 2026-07-15 — **The count pattern claimed a NINTH scalp, in the landing entry
  of the leg written to stop it.** The implementer wrote "125 lines" for
  `window-census.js` under a heading that says *"read off the tool"*; it is
  **120**, caught only by re-running `wc -l` at final verification. Recorded
  rather than quietly fixed, because **the pattern's survival through that
  artifact is the finding.** Nine instances now, every one the same shape: a
  number produced from memory or from another artifact rather than from the tool.
  The generalization is no longer arguable and is this flight's real lesson —
  **a boundary or count quoted from memory, from prose, or from another
  artifact's range is wrong at a measured rate; the only reliable move is to
  print it and read it.**
- 2026-07-15 — **Leg 4 (`spec-realignment-and-verify`) designed. Risk tier:
  MEDIUM — no per-leg design review, ruled out loud.** It hits **no** HIGH
  trigger: it touches **no main-process source** (expected main.js delta **0**),
  changes no schema, no lifecycle, no cache, no security surface, and reverses
  no prior leg. It is spec prose, docs, a test pin, and the offline gates. The
  flight-end Reviewer covers the code it does touch. This mirrors leg 3's own
  LOW-risk precedent from F6.
  **The leg design corrected the FD's work list on six counts — and the brief's
  citation error rate was 6 of ~30 (20%), matching this flight's measured rate
  exactly:**
  - **Item G was FALSE.** The FD wrote "both DD3 tool descriptions currently
    assert the OLD contract — fix both." **They don't** — leg 3's implementer
    already fixed both by hand (`mcp-tools.js:121`, `:413`, read verbatim).
    Writing the "fix" would have been a **no-op edit justified by a stale
    claim** — the FD propagating leg 3's *finding* without re-reading whether
    leg 3 had already acted on it.
  - **Item G was also over-broad**: "nothing pins a tool DESCRIPTION" — **seven
    tools already have description pins** (`pressKey`, `readAxTree`, `evaluate`,
    `injectScript`, `openDevTools`, `closeDevTools`, `getHistory`). The real gap
    is sharper and smaller: the **four topology-bearing tools** DD2/DD3 changed
    have none.
  - **Item H is verification, not work** — all five prose op-count pins
    **already read 30**.
  - **Item D's "5 count-precondition specs" is 3.** `tab-keyboard-operability`
    and `unified-tab-controls` have **zero** `enumerateTabs` calls — they count
    tabs exclusively via `readAxTree(chromeWcId)`'s tablist, which is per-window
    **by construction** and untouched by DD1. **The audit's class-5 assumed the
    instrument was `enumerateTabs`; for 2 of 5 it isn't.** Nothing to restate.
  - **Item E's "4 sites" is 5** — `kebab-menu:116` ("count = exactly 4") is
    missed by the FD's brief **and by the spec's own header annotation**.
  - **`multi-window-shell`'s census list**: the brief omits `:126` (step 6,
    which asserts window 3's census via `enumerateTabs()`) and **over-includes
    step 2**, which is DD2-falsified (skip-set clause), not DD1-falsified (only
    one window exists there).
  **A NEW find no leg owned, and it is the signature error one level down:**
  `docs/mcp-automation.md:533` reads `### Admin chrome / app-level (2)` above a
  **3-row** table, and `:535` says "Both tools". **The six section headings sum
  to 29 against a declared 30.** Leg 3's AC8 enumerated seven *total*-count
  sites and landed all seven — but a **category** count inside a subsection
  heading was not among them. AC19 asserts the **sum**, because a site list is
  exactly what missed it.
  **And the finding that names the whole pattern:** `menu-dismissal`'s own
  errata header — the annotation the FD wrote *documenting* citation drift —
  carries citations that are uniformly **+27 stale** (`:76-79`, `:97-100`,
  `:106-109`, `:144-145` → really `:103`, `:124-126`, `:133-136`, `:171-172`).
  **Citation drift inside the annotation documenting citation drift.** Note also
  that the three drifted spec ranges in the FD's brief are **exactly the three
  specs the leg-1 exposure triple annotated** — diagnosable, not random: writing
  the annotation is what moved the lines the FD then quoted from memory.
- 2026-07-15 — **FD ruling on the DD7 blur AC (leg 4 forced the question, and
  refused to paper over it — correctly).** The FD ruled the blur hole must
  become an explicit AC at the first leg with two windows live. But the deleted
  guard is exercised **only** by cross-window blur, and WSLg delivers no OS blur
  to scripted stimuli. Leg 4 split it, which is the honest shape: the
  **rig-reachable half** is a real step (two sheets open → dismiss A's → B's
  stays open ⇒ per-window scoping); the **OS-blur half is Out of Scope with a
  FORCED disposition** — pin to a non-WSLg desktop **or** record as an accepted
  permanent gap. **FD ruling: record it as an ACCEPTED PERMANENT GAP for this
  mission.** Grounds: the operator's only desktop is WSLg (`mission.md`
  Environment Requirements names it as the development host), so a non-WSLg pin
  would be a ticket with no venue — which is precisely the "unqualified HAT item
  that silently cannot run" failure this flight named. The residual is narrow
  and now documented with its exact mechanism (window A's blur killing window
  B's open menu during the two-window open handoff), so a future maintainer on a
  real desktop can discharge it deliberately. **The mission debrief carries it.**
- 2026-07-15 — **Leg 4 landed (developer half). All 24 developer-owned ACs
  discharged; AC25/26/27 — the Witnessed runs — remain the FD's.** 1832/1832
  (baseline 1831 + the AC17 pin), lint clean, typecheck clean, **`npm run a11y`
  green**. **main.js delta: 0** — this leg touched no main-process source,
  exactly as designed; overage vs ≤3461 stays **56**, a recorded miss.
  - **`multi-window-shell` rewritten 157 → 249 lines, out of planned red.** Every
    falsified row discharged — including **`:126`, which the FD's own list
    omitted**. Step 4 **inverted** (it had asserted "zero per-window overlay
    instances"); the probe walk **deleted, not re-pointed**; step 8 pins the
    `ERR_ABORTED` history count **= 2**, read off step 2's gate; the two-menus
    variant is real (V1/V2) and asserts **distinctness** rather than leg 3's
    incidental wcIds — the right call, since hard-coding 4 and 6 would pin an
    accident.
  - **`multi-window-automation` authored `draft`, 9 step rows**, covering all 8
    of the flight's Verification properties. **Row 7 is named as row 8's same-run
    positive control and is judged first** — the leg-1 presence-before-absence
    lesson built into the spec's structure rather than left to an Executor's
    initiative.
  - a11y needed the live GUI. Only **4** `sheet:*` states appear in output but
    **all six ran** — enumerated off `a11y-audit.mjs`; the other two raise zero
    violations so they have no baseline entries, and the audit's own control
    throws with the state label unless dismissal returns `'escaped'`, so **exit 0
    IS the six-state proof**. Verified by reading the tool rather than counting
    the output — the exact discipline this flight had to learn nine times.
- 2026-07-15 — **THE SHARPEST FINDING OF THE FLIGHT: a control that certified an
  instrument it never tested.** AC17's tool-description pin shipped with a
  **synthetic-fixture control** — and that control **passed while the pin was
  defeated**. Deleting the real contract claim from the description left the
  suite **85/85 green**, because the token `/all windows/i` recurs in an
  unrelated jar-key aside elsewhere in the same description. **Only mutating real
  source caught it.** Tightened to `/across ALL windows/i` → re-mutated: **84/85,
  1 fail** → restored: **85/85**.
  **The generalization, which supersedes this flight's earlier grep-AC rule:** a
  synthetic fixture proves *the helper works*; it **never** proves *the token
  discriminates*. The flight already learned "ship a control" — but **a control
  over a fixture you authored tests your fixture, not your instrument.** The only
  control that counts is a **mutation of the real artifact**: break the thing the
  assertion exists to catch, and watch it fail. This is presence-before-absence
  pushed one level deeper than anyone in the flight had it, and it is the **third
  distinct layer of the same lesson** (behavior tests → static greps → now the
  controls themselves). **This is the flight's real methodology output.**
- 2026-07-15 — **Two more leg-4 finds, both needing an owner:**
  1. **A live defect the leg's own scope missed**: the false *"defer to the HAT"*
     caveat AC13.1 condemns in `find-overlay-geometry` was **also live in
     `menu-overlay.md`**, which AC13 does not scope. Verified against source
     before acting; folded out of both; recorded as a Files-Affected deviation.
     Same shape as the original: **the harm is the instruction, not the
     staleness** — it would park a fully-assertable step.
  2. **NEW stale enumeration in SOURCE, unowned:** `renderer.js:250-251` says the
     kebab has *"four items (Settings, Downloads, Print…, Exit)"* while
     `:385-392`'s live `kebabModel` has **six** — 134 lines apart in the same
     file. Comment-only, no behavior. **Not fixed — `src/` is pinned by AC23**
     and this leg touches no main-process source by design. **Needs an owner: the
     maintenance flight, or F8.** It is the count pattern's **tenth** instance and
     the **first found in product source** rather than in an artifact.
- 2026-07-15 — **A leg-4 judgment call worth adopting as a house rule:
  `menu-dismissal`'s drifted citations were repaired by REMOVING the line
  numbers, not refreshing them.** A departure from a literal AC14 reading, and
  the right one: those citations drifted *because* adding annotations pushed the
  content down — so **fresh numbers merely restart the clock**, and the leg's own
  edits moved them again mid-leg, proving the point in real time. They now cite
  by **section name**, which does not drift when the file is edited above it.
  This generalizes the earlier carry ("pin constraints to code identity, never a
  line number") **from code to prose**. Two drifted citations inside the leg's
  own "Verified OK" list (`foreground-to-act:13`/`:44` → really `:12`/`:38`; its
  `main.js:681-709` layering cite → `:746-800`) were **recorded rather than
  quietly fixed** — the same self-reporting discipline the leg-3 implementer
  showed.
- 2026-07-15 — **Session boundary. Leg 1 is landed but UNCOMMITTED; its
  invariant proof (AC13) has NOT run.** The FD session reached its working
  limit at the point of orchestrating the exposure triple. State is clean and
  resumable: the leg's code + unit net + tripwire are in the working tree on
  `flight/7-multi-window-2` (spec committed at `b607411`; nothing else
  committed — this flight commits once after the flight-end review, per the F6
  pattern). **Resume at**: run `menu-overlay`, `find-overlay-geometry`, and
  `menu-dismissal` via `/behavior-test` in regression mode, specs unmodified.
  A FAIL in any of the three is a real conversion regression, not a spec
  problem, and re-expands the scope per the ruling above. `multi-window-shell`
  stays a planned red — do not run it, do not fix it, it is rewritten at leg 4.
  Deliberately did NOT start the Witnessed orchestration on a budget that
  couldn't finish it: a half-run test with a lost checkpoint cursor and no run
  log is worse than a clean stop, and the leg's own evidence (byte-unchanged
  specs, no spec needed an edit, the five-step live smoke) is recorded and
  stands on its own until the triple confirms it.

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
