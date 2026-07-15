# Leg: live-defect-fixes

**Status**: completed
**Flight**: [Multi-Window Shell, Part 2](../flight.md)

## Objective

Fix the two live defects recon found in shipped F6 code — **S1** (cross-window activate silently no-ops, so acts on a window-B tab proceed against an unraised background guest and report success) and **S3** (five unguarded `capturePage` awaits hang forever on a detached-but-live view, wedging the request with no server-side recovery) — by routing activate to the tab's **owning** window's chrome at event time, raising that window per DD6's stated predicate, converting the discarded `false` into a **named refusal**, and bounding every `capturePage` await with a race that returns a **named error**, with **no tool-schema change**.

## Context

### The decisions this leg executes

- **DD6** — Cross-window acts route to the OWNING window's chrome; the raise is governed by a stated predicate; `activateTab`'s `false` becomes a named refusal.
- **DD7** — Every `capturePage` await is timeout-guarded, with the layer-degradation rule and the post-await attachment re-check.

Nothing else. **Do not** touch `enumerateTabs` / `getChromeTarget` / `captureWindow` **semantics or arity** (DD1/DD2/DD3/DD4 → leg 3), **do not** add `enumerateWindows` (DD2 → leg 3), **do not** add the schema-shape pin (DD9 → leg 3), **do not** rewrite behavior specs (leg 4).

### Why this leg is separate from leg 3 (flight Technical Approach)

Leg 2 fixes **shipped-code bugs** with **no tool-schema change** — independently verifiable, and they "must not wait behind an API redesign." Verified at leg design and still true against the working tree: `getChromeForTab` exists today (`src/main/window-registry.js:170-173`), and all five capture sites are independent of DD2/DD3.

### This leg is HIGH risk, and the flight says why

*"No API change" is the wrong frame.* There is no **tool-schema** change, but this leg changes the shared automation surface's **observable contract**:

- `activateTab` starts **refusing** where it silently succeeded;
- `readDom` and `evaluate` **stop activating** their target.

An external consumer relying on `readDom`'s activate side-effect breaks **with no schema change to warn it**. Schema-stable and contract-breaking is precisely the S10 failure mode DD9 exists to catch — and DD9 lands one leg *later*, so this leg is **uncovered by it**. See Acceptance Criteria → **AC12** (the named risk) and Edge Cases → "The contract break is real and uncovered."

### What leg 1 changed underneath this leg

Leg 1 landed (uncommitted, working tree). It removed the find cluster from `main.js` (3461 → **3392**), extracted `src/main/find-overlay-manager.js` (365 lines), instantiated both overlay managers per window into the registry record's `findOverlay`/`sheet` slots, and **deleted the nine `getAttachedWindow()` sites — including the two `=== grabWin` capture gates DD7's post-await re-check was originally written against.**

**Every `file:line` in the flight spec and the flight log is from the PRE-leg-1 tree. All of them were re-derived here.** See the **Citation Audit** — six citations drifted, three of DD6's site labels were wrong, and the flight's site **count is wrong** (see below).

### The activate-site count is NINE, not eight — the flight's own table already had nine rows

The flight says "ruled for **ALL EIGHT** activate sites" three times (DD6's heading, its Open Question, its rationale), but **DD6's table has nine rows**, and the working tree has **nine** real sites. The prose count is wrong; the table's row count is right.

This is the **sixth** instance of this flight's standing count/enumeration-error pattern (recon probe-walk 7-vs-10 · audit's "2 stale rows" vs 1 · "nine conditioning checks" = 7 compares + 2 resolves · "8 DD7 tests" vs 9 · "two stale comments" vs three · **and now "eight activate sites" vs nine**). Consistent with the leg-1 lesson: **a number worth writing down is worth reading off the tool at the moment of writing.** Every count in this leg is enumerated, never stated as a range-plus-total.

**The FD has folded this into the flight spec** — DD6 now reads *nine* sites, the three site labels are corrected (`actOn` serving click/typeText/pressKey; `actOnPaced` serving `dragPointer`; `scroll` — **not** `activateTab`, which is the primitive at `engine.js:90`), and `getChromeForTab` is re-cited to `window-registry.js:170-173` with the reason that citation was **dangerous rather than merely stale** (`:156-162` is now `getWindowForGuest` — a different function that would **type-check at the call site**). **Leg and spec agree; no reconciliation is owed at landing.**

**And the pattern claimed a seventh scalp inside this leg, at design review** — AC1's own verify line asserted "9 hits" for a grep that prints **10**. The leg written to stop the pattern reproduced it in the AC that documents it. Both are recorded at their ACs rather than quietly corrected, because together they are the strongest available evidence for the debrief that this is a **property of the method, not of any one author**: all seven are a total asserted in prose instead of read off the tool, and the one artifact that never erred — DD6's table — is the one that enumerated.

## Inputs

What must be true before this leg runs:

- Branch `flight/7-multi-window-2`. **Leg 1 is landed but UNCOMMITTED** — read the **working tree**, never `HEAD`/`b607411`. (`git stash` would silently revert leg 1 and re-introduce the roaming singleton.)
- `src/main/main.js` — **3392** lines. `grabWindow` at `:611-749`; the composite fallback at `:658-748`; `createWindow` at `:~940-1200`.
- `src/main/window-registry.js` — **210** lines; `getChromeForTab` at `:170-173`; `noteFocus` at `:121-123`; `getWindowForGuest` at `:156-162`.
- `src/main/automation/tabs.js` — 128 lines; `activateTab` at `:123-126`.
- `src/main/automation/observe.js` — 480 lines; unchanged by leg 1.
- `src/main/automation/engine.js` — 162 lines; `deps()` at `:71-92`; the shared `activate` at `:90`; the public `activateTab` op at `:98`.
- `src/main/automation/find.js` — the **timeout-budget precedent only**: `:106` (`|| 3000`), `:122` (`last`), `:155` (`setTimeout(() => finish(last), timeoutMs)`).
- Test baseline: **1768/1768 passing, 13 suites** (`npm test` = `node --test test/unit/*.test.js`), verified by running it at leg design. `npm run typecheck` clean; `npm run lint` exit 0.
- `npm run a11y` is a **flight checkpoint** and its probe walk (`scripts/a11y-audit.mjs:212-235`) drives `evaluate` against non-tab overlay wcIds. **It must still pass after this leg** — see the AC2 ruling.

## Outputs

- **New**: `src/main/capture-timeout.js` — pure, Electron-free bounded-race helper.
- **New**: `test/unit/capture-timeout.test.js` — its unit net (MockTimers).
- **Modified**: `src/main/automation/tabs.js` — `activateTab` routes to the owning chrome, raises, and refuses by name.
- **Modified**: `src/main/automation/observe.js` — `readDom` / `evaluate` lose their activate branch; `captureScreenshot`'s `capturePage` is bounded.
- **Modified**: `src/main/automation/engine.js` — two new injected deps threaded into `deps()`.
- **Modified**: `src/main/main.js` — the two deps injected at **both** engine sites; a `raiseWindowForTab` helper; four bounded `capturePage` awaits; two post-await re-checks; the cause-preserving re-throw.
- **Modified**: `test/unit/automation-tabs.test.js`, `test/unit/automation-observe.test.js` — new contract tests.
- **Modified**: `docs/mcp-automation.md`, `CLAUDE.md` — only the lines **this leg** falsifies (see AC11; `docs/mcp-automation.md:356-384` stays leg 3's).
- **Unchanged (pinned)**: `src/main/automation/find.js`, `src/main/automation/print.js`, `src/main/automation/input.js`, `src/main/automation/resolve.js`, `src/main/automation/mcp-tools.js`, `src/main/find-overlay-manager.js`, `src/main/menu-overlay-manager.js`, every file under `tests/behavior/`.

## Acceptance Criteria

### DD6 — the nine-site raise table, enumerated

- [x] **AC1** — **The nine activate sites are ruled exactly as this table says.** Encoded here so the implementer cannot guess. Verify each line number against the working tree before editing; three of the flight's labels are corrected here (see Citation Audit).

  > **Predicate: an op that needs RENDERED OUTPUT raises the owning window; an op that reads live JS/DOM state does not.**

  | # | Site (verified working tree) | Enclosing fn | Ops served | Raises? | Why |
  |---|---|---|---|---|---|
  | 1 | `observe.js:126` — `"await activate(wcId);"` | `captureScreenshot` | `captureScreenshot` | **yes** | pixels |
  | 2 | `observe.js:282` — `"await activate(wcId);"` | `readAxTree` | `readAxTree` | **yes** | the AX tree is a rendered artifact — `observe.js:239-240` documents "a contents that has not rendered an AX tree yet" returning `[]`, so backgrounding plausibly changes the result; `npm run a11y` is a flight checkpoint |
  | 3 | `print.js:40` — `"await activate(wcId);"` | `printToPDF` | `printToPDF` | **yes** | awaits `waitForPaint` at `:42` after activate — same rendered-output logic as capture |
  | 4 | `find.js:102` — `"await deps.activate(wcId);"` | `findInPage` | `findInPage` | **yes** | keeps current behavior; match highlighting is UI-bearing and changing it is unmotivated here |
  | 5 | `input.js:235` — `"await activate(wcId);"` | `actOn` | **`click` (`:284`), `typeText` (`:294`), `pressKey` (`:396`)** | **yes** | explicit acts |
  | 6 | `input.js:265` — `"await activate(wcId);"` | `actOnPaced` | **`dragPointer` (`:316-322`)** | **yes** | explicit act |
  | 7 | `input.js:368` — `"await activate(wcId);"` | **`scroll`** | `scroll` | **yes** | explicit act |
  | 8 | `observe.js:195` — `"await activate(wcId);"` | `readDom` | `readDom` | **no** | `executeJavaScript` (`:200`) — works fine on a background guest |
  | 9 | `observe.js:342` — `"await activate(wcId);"` | `evaluate` | `evaluate` | **no** | `executeJavaScript` (`:353`) — same as `readDom` |

  **`activateTab` is NOT a site.** It is the *primitive* every site calls (`engine.js:90` builds `activate = (wcId) => tabs.activateTab(wcId, base)`), and it is separately a public op (`engine.js:98`). The flight's row-7 label ("`activateTab` and the explicit-act group") named neither the site (`scroll`) nor a real site.

  Verify: `grep -rnE 'await (deps\.)?activate\(wcId\)' src/main/automation/` → **10 lines printed: the 9 sites + 1 doc comment.** The nine sites are exactly `find.js:102`, `input.js:235`, `input.js:265`, `input.js:368`, `observe.js:126`, `observe.js:195`, `observe.js:282`, `observe.js:342`, `print.js:40`. **`input.js:334` is the tenth line and is a doc comment, not a site** — the grep prints it; do not count it.

  > *This AC's own verify line said "9 hits" for a grep that prints **10** — caught at design review. The leg written to stop this flight's count pattern reproduced it, in the AC that documents it. Recorded rather than quietly fixed: it is the same shape as the other six (**a total asserted in prose instead of read off the tool**), and it is evidence the pattern is a property of the method, not of any one author's carelessness. The fix is the same one the table already applies — print the enumeration, count the enumeration.*

- [x] **AC2** — **`activateTab` routes to the owning window's chrome, and the refusal is SCOPED.** `src/main/automation/tabs.js:activateTab` implements exactly this three-way rule:

  | Owning chrome (`deps.chromeForTab(wcId)`) | Dispatch result | Behavior |
  |---|---|---|
  | **null** (no registry record owns this wcId) | *(not dispatched)* | **return `false`. No raise, no throw.** |
  | a chrome | `true` | **raise** the owning window, return `true` |
  | a chrome | `false` | **throw the named refusal** (registry/renderer desync) |

  **The null branch is load-bearing and is a RULING, not an omission — read this before "simplifying" it.** `classifyContents` (`resolve.js:56-60`) returns `'guest'` for **anything that is not a registered chrome** — so the **menu-overlay sheet and the find overlay classify as `'guest'`**. Today `activate(overlayWcId)` → `activateTabByWcId` → `findTabByWcId` misses → `false` → **discarded**, and the op proceeds. That discarded `false` is **exactly why the probe walk works today**. A blanket "false ⇒ throw" would break, at minimum:
  - `npm run a11y` — **a flight checkpoint** — whose probe walk `evaluate`s ids 1..64 (`scripts/a11y-audit.mjs:212-235`) and whose own `catch` would swallow the throw and then `fail("sheet wcId not found")`;
  - all **10** probe-walk specs the flight enumerates, plus `find-overlay-geometry.md:82-85`, which probes via **`readDom`**;
  - per-wcId `captureScreenshot` against overlay ids — the apparatus the flight's own Prerequisites depend on ("per-wcId `captureScreenshot` reads overlay pixels **without** `captureWindow`").

  A `false` from the **null** branch is not a silent no-op: it is the honest, unchanged answer "this wcId is not a registry-owned tab." The refusal exists for the case the registry says *is* owned — where a `false` means a genuine desync.

- [x] **AC3** — **The named refusal is a THROW, not a returned object.** `activateTab` throws `Error` with a message matching `/^automation: activate-refused — /`, following the house convention (`resolve.js:100/:106/:119/:136`, `scope.js:164/:183`). It must **not** be a returned refusal object: `{automation: 'debugger-unavailable', …}` (`cdp.js:40`) is the shape for *expected operational conditions*, and — decisively — **a returned object would still be discarded at all seven raise sites**, re-creating the exact silent no-op S1 is. A throw propagates through every `await activate(wcId)` with zero call-site changes.

- [x] **AC4** — **The raise uses the established in-repo idiom, both halves.** The raise is `win.focus()` **followed by** `registry.noteFocus(win.id)` — the pair at `src/main/main.js:2646-2649`, whose own comment states the reason: *"Programmatic win.focus() fires NO focus event under WSLg (spike verdict 4) — noteFocus seeds the DD8 accessor deterministically."* **`noteFocus` is not optional**: without it the last-focused accessor never learns of the raise, `getChromeTarget`/`grabWindow` keep resolving the old window, and AC13's smoke has no observable. Verify: the new raise helper's body contains both calls; `grep -c 'noteFocus' src/main/main.js` → **≥ 3** (`:973` focus handler, `:2649` move handler, + the new helper).

- [x] **AC5** — **`readDom` and `evaluate` lose their activate branch entirely.** Not "keep the tab-activate, skip the window-raise" — the whole `if (classify… === 'guest' && typeof activate === 'function') { await activate(wcId); wc = resolveContents(wcId, deps); }` block is **deleted** from `observe.js:readDom` and `observe.js:evaluate`. Consequences, all intended:
  - `let wc` → `const wc` in both (no async hop ⇒ no stale handle ⇒ the post-activate re-resolve is dead code);
  - `evaluate`'s **final `isInternalContents` refusal stays** (`observe.js:348-350`) — it is the load-bearing DD2-HIGH guard, and with no activate branch it simply runs on the one resolved `wc`;
  - the flight's stated side-effect lands: *"with `evaluate` no longer raising, the probe walk's foreground-first hazard disappears."* That claim is **only true under this reading** — a kept tab-activate would leave the hazard intact. The flight's own risk text names the break as "`readDom`'s **activate side-effect**", which is tab activation. See Edge Cases → "Why the activate branch is deleted, not narrowed."

  Verify: `grep -c 'await activate(wcId)' src/main/automation/observe.js` → **2** (only `:126` `captureScreenshot` and `:282` `readAxTree` survive).

- [x] **AC6** — **Both live engine-injection sites carry the two new deps, in parity.** `chromeForTab` and `raiseWindowForTab` are injected at **both** `createEngine` opts literals in `main.js` — the MCP `getEngine` accessor (`:764`) **and** the dev-seam engine (`:3263`). The leg-1 log records that these two must stay in parity ("the SECOND injection site, kept in parity with the MCP engine accessor above").

  **Write both as ES6 shorthand** — `chromeForTab,` / `raiseWindowForTab,` — matching the `grabWindow,` already sitting in **both** literals (`main.js:767`, `:3265`). Both are plain function references in the same module scope, so shorthand is the style-consistent edit.

  Verify (**syntax-agnostic — accepts shorthand OR `name: value`**):

  ```bash
  grep -cE '^\s*chromeForTab(,|:)' src/main/main.js        # → 2
  grep -cE '^\s*raiseWindowForTab(,|:)' src/main/main.js   # → 2
  ```

  The line-anchor is what makes this safe: it matches only an object-literal **key** line, never the `function chromeForTab(wcId) {` definition (`:246`) and never any of the ~10 existing `chromeForTab(...)` call sites (a `(` follows the name, so `(,|:)` cannot match). Validated at leg design against the exact precedent in the same file: `grep -cE '^\s*grabWindow(,|:)' src/main/main.js` → **2** — the two injections, excluding `grabWindow`'s own definition at `:611`.

  > **The first draft's grep was `grep -c 'chromeForTab:'`, which would have returned 0 on a correct shorthand edit and inverted this AC's entire purpose** — passing when the injection was missing, failing when it was right. Caught at design review. An AC that is green on broken code is worse than no AC; a grep-AC must be validated against the tree **and** against the edit it is meant to accept, not just written.

  Absent deps → **fall back to today's `executeInRenderer` dispatch, no raise, no refusal** — the house "Absent → no behavior change" idiom (`engine.js:33-41` for `isTabViewWcId`/`isChromeContents`). This is what lets `test/unit/automation-tabs.test.js:339` pass **unmodified**. That silent fallback is precisely why the grep-pin on both live sites is mandatory: a forgotten injection restores S1 with **no test failure anywhere**.

### DD7 — the five bounded capture sites

- [x] **AC7** — **`src/main/capture-timeout.js` exists**, is **pure and Electron-free** (`grep -c "require('electron')" src/main/capture-timeout.js` → **0**), and exports a bounded race that **always rejects on timeout** with `/^automation: capture-timeout — /`. It borrows from `find.js` **the 3000ms budget** (`find.js:106`) and **a `done`-guarded settle** (`find.js:130-135`) — **and nothing else.**

  **find.js's semantics are the OPPOSITE of what this needs and are explicitly NOT carried.** On timeout `find.js:155` does `finish(last)` where `last = {activeMatchOrdinal: 0, matches: 0}` (`:122`) — it **resolves with a benign zero-match success**. Copying that into capture yields a silently-empty capture: the exact silent-success class S1/DD6 exists to kill. The mechanism differs too: find.js wraps an **event-listener** flow in a Promise constructor; `capturePage()` is an **unrejectable promise you must `Promise.race`**. **The race + named rejection is NEW.**

  The helper has exactly **one** semantic (reject on timeout). Layer degradation is the **call site's** policy (AC9), never the helper's — so no call site can accidentally inherit a benign settle.

- [x] **AC8** — **All five `capturePage` awaits are bounded.** Enumerated against the working tree (four of five drifted from the flight's pre-leg-1 citations):

  | # | Site (working tree) | Was (flight, pre-leg-1) | What it captures | On timeout |
  |---|---|---|---|---|
  | 1 | `observe.js:132` — `"const image = await wc.capturePage();"` | `observe.js:132` *(unchanged)* | the requested target | **hard-refuse** |
  | 2 | `main.js:666` — `"cc.capturePage(),"` | `main.js:857` | chrome | **hard-refuse** |
  | 3 | `main.js:667` — `"atc && !atc.isDestroyed() ? atc.capturePage() : …"` | `main.js:858` | active guest | **hard-refuse** |
  | 4 | `main.js:700` — `"const img = await … (findView.webContents).capturePage();"` | `main.js:889` | find overlay **layer** | **drop layer + log** |
  | 5 | `main.js:706` — `"const img = await … (sheetView.webContents).capturePage();"` | `main.js:895` | sheet **layer** | **drop layer + log** |

  Verify: `grep -rn 'capturePage()' src/main/main.js src/main/automation/observe.js` → **5** call sites, each wrapped. (`observe.js:7/:48/:96/:132` — only `:132` is a call; the rest are comments.)

  **Note on sites 2/3**: they are **not** individually awaited — they are two promises inside `await Promise.all([...])` at `main.js:665-668`. Each must be wrapped **individually** (a hang in *either* wedges the `Promise.all`).

- [x] **AC9** — **The layer-degradation rule is implemented as DD7 rules it.** A timeout on an **overlay layer** (`main.js:700`, `:706`) **drops that layer and logs it**, matching the composite's existing tolerance for a failed layer — `main.js:729`'s `.then(function(img) {…}, function() { return null; })` already drops one **silently** (this leg's version logs). A timeout on the **chrome or guest** capture (`:666`, `:667`) **hard-refuses** — those *are* the capture. This keeps a slow menu from failing an otherwise-good window capture while never returning a silently-empty one.

- [x] **AC10** — **The hard-refusal's cause survives `grabWindow`'s catch-all.** `grabWindow`'s composite fallback is wrapped in `try { … } catch { /* fallback failed */ }` (`main.js:658` / `:746-748`) and then `return null` (`:749`); `observe.captureWindow` turns that null into the generic `'automation: chrome window unavailable'` (`observe.js:218`). **Left alone, that catch swallows the capture-timeout error and the named cause is lost** — degrading AC9's hard-refuse into a generic failure, which is the very silence DD7 exists to remove. The catch must **re-throw** capture-timeout errors (or be narrowed) so `captureWindow` surfaces `automation: capture-timeout — …` to the caller. Verify by inspection **and** by the AC13 smoke step 8.

- [x] **AC11** — **The two post-await attachment re-checks, written against the per-window instance.** The gates at `main.js:698-699` (find) and `:704-705` (sheet) are **synchronous** `isVisible()` + `isDestroyed()` checks sitting in front of an **unbounded await** (`:700` / `:706`) — a TOCTOU: a `hideFindOverlay()` landing in between detaches the view mid-capture. **The TOCTOU survives leg 1** (hiding a per-window instance still detaches it), so the re-check is still required.

  **Write it against the per-window instance's own visibility — NOT `=== grabWin`.** The `=== grabWin` compares the flight described are **gone**: leg 1 deleted them (they were two of the nine `getAttachedWindow` sites) and replaced them with `grabRec.findOverlay.isVisible()` / `grabRec.sheet.isVisible()`. After each await, re-check that the same instance is **still visible and its view still alive** before pushing the layer; if not, **drop the layer** (same disposition as AC9's timeout).

  **The re-check must be null-tolerant.** Leg 1's AC8b nulls `rec.findOverlay` / `rec.sheet` in the window's `close` handler, so `grabRec.findOverlay` can become **null** during the await. Mirror the existing null-tolerant gate shape at `:698` / `:704` (`grabRec.findOverlay && grabRec.findOverlay.isVisible()`), not a bare `.isVisible()`.

### The named risk

- [x] **AC12** — **The observable-contract break is RECORDED as a named risk in the flight log**, not discovered at leg 4. The entry must state, in the leg's own words:
  - `activateTab` now **refuses** (throws `automation: activate-refused`) where it previously returned a silent `false` — for registry-owned tabs whose chrome disagrees;
  - `readDom` and `evaluate` **no longer activate** their target — a real behavior change for any consumer relying on the side-effect;
  - **no tool-schema changes**, so `EXPECTED_TOOL_COUNT = 29` (`automation-mcp-server.test.js:26`) and every `inputSchema` are untouched — **the suite cannot catch this**;
  - therefore this leg is **schema-stable and contract-breaking — the S10 failure mode DD9 exists to catch, landing one leg early and uncovered**, carried knowingly per the flight's re-tiering of this leg to HIGH.
  - **The in-repo consumer sweep is COMPLETE — carry its disposition forward, do not redo it.** Run at leg design and extended at design review across `scripts/` and all of `tests/behavior/*.md`: **no in-repo consumer relies on a read op's own activate side-effect.** ~16 further specs mentioning a background tab alongside `readDom`/`evaluate` were checked individually and cleared. The two probe consumers — **`scripts/a11y-audit.mjs:212-235`** (`evaluate`) and **`find-overlay-geometry.md:82-85`** (`readDom`) — are protected by **AC5**, which removes the `activate()` call from those two ops on **every** target (see the attribution note below). Leg 4 inherits this disposition; re-derive only if AC5 is overruled.

  > **Attribution, because a future partial revert would be misled by getting it backwards.** Once AC5 lands, `evaluate`/`readDom` never call `activate()` on **any** target, so the `evaluate`/`readDom` probe walks are protected by **AC5** — *not* by AC2's null branch. **AC2's null branch is load-bearing for a different set**: `captureScreenshot` and `readAxTree` on overlay wcIds (AC1 rows 1–2), which **still activate** and would therefore hit the refusal without it. The two protections are complementary and cover disjoint ops. They land together, so today the distinction is invisible — but reverting AC5 alone would break the probe walks with AC2 fully intact, and reverting AC2 alone would break overlay `captureScreenshot` with AC5 fully intact. *(First draft credited the null branch for both. Corrected at design review.)*

### Docs this leg falsifies

- [x] **AC13** — **Only the lines this leg falsifies are updated; `docs/mcp-automation.md:356-384` stays leg 3's.** The flight assigns leg 3 the *multi-window semantics* section (`:356-384`); these are **different lines**, and leaving them would ship docs that actively lie about behavior this leg changed. Each must be re-read and re-cited before editing:
  - `docs/mcp-automation.md:346` — "eval/read ops are foreground-first, so probing a background *tab* activates it" — **false for `evaluate`/`readDom` after AC5**;
  - `docs/mcp-automation.md:403` — the `activateTab` row: "boolean success signal (`true`/`false`)" — must name the refusal and the non-tab `false`;
  - `docs/mcp-automation.md:431` — the `readDom` row: "foreground-first" — **false**;
  - `docs/mcp-automation.md:445` — the `evaluate` row: "Foreground-first (the tab is brought to front before evaluation)" — **false**;
  - `CLAUDE.md:388` — the probe-walk paragraph's "the eval/read ops are foreground-first, so probing a background tab activates it" rationale — **the hazard is gone**; say so;
  - `CLAUDE.md:424` — "This sequence (resolve → activate → re-resolve → act) is **uniform** across `input.js`'s `actOn` and **every** `observe.js` op" — **no longer uniform**; state the read/act asymmetry as a contract line.
  - `docs/mcp-automation.md:300` — re-read; update only if it asserts activation for the read ops.

  Also document the new `automation: capture-timeout` refusal wherever the surface's refusal vocabulary is listed.

### Records and hygiene

- [x] **AC14** — `npm test` green with **≥ 1768** passing (the leg-1 baseline, verified at leg design; the new suites add to it, nothing regresses). `npm run typecheck` clean. `npm run lint` exit 0.
- [x] **AC15** — **`src/main/main.js`'s line count at landing is RECORDED** (`wc -l src/main/main.js`, read off the tool — not from memory; the leg-1 log records that exact error). Leg-1 landing baseline: **3392**. The flight's net target of **≤ 3461** is judged **at flight end**, not here (leg 3 still adds op wiring against the remaining headroom). A checkpoint, not a gate: if it moves, record the number.
- [x] **AC16** — The flight log carries a leg-2 landing entry (see Post-Completion Checklist).

### The live proofs

- [x] **AC17** — **The MCP live smoke passes all three flight checkpoints** (see Verification Steps → Live smoke): (a) `activateTab` on a window-B tab **raises window B**; (b) `readDom` on a window-B tab does **NOT** raise; (c) `capturePage` on a **detached** view **refuses within the bound** instead of hanging. Record every observable in the flight log.

  **The Developer cannot run behavior tests** — the Witnessed two-agent protocol is the FD's (leg-1 precedent, flight log). The Developer **can** run a live MCP smoke over `npm run dev:automation`, hand-rolling the client from `scripts/mcp-example-client.mjs` (**the apparatus is NOT a registered MCP** — this is the crew-file gap the leg-1 log flags as having falsely blocked one Executor; do not repeat it).

## Verification Steps

### Offline

```bash
# AC1 — the nine sites. PRINTS 10 LINES: the 9 sites + input.js:334's doc comment.
grep -rnE 'await (deps\.)?activate\(wcId\)' src/main/automation/     # → 10 lines = 9 sites + 1 comment

# AC5 — only captureScreenshot (:126) and readAxTree (:282) still activate in observe.js
grep -c 'await activate(wcId)' src/main/automation/observe.js        # → 2

# AC6 — both live injection sites, in parity. Line-anchored + syntax-agnostic:
# matches shorthand (`chromeForTab,` — the style-consistent edit, cf. `grabWindow,`
# at :767/:3265) AND `name: value`, while excluding the `function chromeForTab(wcId)`
# definition at :246 and every `chromeForTab(...)` call site. DO NOT "simplify" this to
# `grep -c 'chromeForTab:'` — that returns 0 on a CORRECT shorthand injection (design
# review). Sanity-check the form against its own precedent first:
grep -cE '^\s*grabWindow(,|:)' src/main/main.js                       # → 2  (control)
grep -cE '^\s*chromeForTab(,|:)' src/main/main.js                     # → 2
grep -cE '^\s*raiseWindowForTab(,|:)' src/main/main.js                # → 2

# AC4 — the raise idiom carries BOTH halves
grep -c 'noteFocus' src/main/main.js                                 # → >= 3

# AC7 — the helper is Electron-free
grep -c "require('electron')" src/main/capture-timeout.js            # → 0

# AC8 — five bounded capturePage call sites
grep -rn 'capturePage()' src/main/main.js src/main/automation/observe.js

# AC14
npm test && npm run typecheck && npm run lint

# AC15
wc -l src/main/main.js                                               # → RECORD the number
```

### The unit net (what CAN be unit-tested)

`main.js` is unit-test-exempt (Electron-bound). The pure parts are not:

**`test/unit/capture-timeout.test.js`** — MockTimers, **per-test, never file-global** (CLAUDE.md's recipe; exemplar `test/unit/automation-find.test.js`). Drain with a real `setImmediate` around single-step ticks; never one big tick.
- a promise that settles before the bound → resolves with its value; the timer is **cleared** (no dangling handle);
- a promise that **never settles** (the `capturePage`-on-detached model) → **rejects** at the bound with `/^automation: capture-timeout — /`;
- a promise that **rejects** before the bound → that rejection propagates verbatim (not masked by the timeout);
- **the `done` guard**: a promise settling *after* the timeout fired does **not** re-settle or throw;
- **the anti-find.js pin**: on timeout it **rejects** — assert it never resolves with any benign value. Name the test for the contract (`'capture-timeout: a timeout REJECTS — find.js\'s benign finish(last) semantics are deliberately not carried'`), so a future "harmonize with find.js" refactor fails loudly.

**`test/unit/automation-tabs.test.js`** — extend, don't rewrite (the five existing `activateTab` tests at `:339`/`:349`/`:359`/`:368`/`:378` pass **unmodified** via AC6's absent-deps fallback; verified at leg design):
- `chromeForTab` returns null → returns `false`, **no** raise, **no** throw, **no** dispatch (the AC2 overlay/probe-walk branch — pin it hard, it is what keeps `npm run a11y` alive);
- `chromeForTab` returns chrome X → dispatch goes to **X**, not to `executeInRenderer`'s last-focused chrome (the S1 fix: inject a `chromeForTab` returning a *different* fake than `executeInRenderer`'s and assert **which** one received the code);
- dispatch `true` → `raiseWindowForTab(wcId)` called **exactly once**, return `true`;
- dispatch `false` → **throws** `/^automation: activate-refused — /` **and** `raiseWindowForTab` is called **zero** times;
- resolve-time refusals (bad-handle / no-such-contents / internal-session) still throw **before** any dispatch or raise.

**`test/unit/automation-observe.test.js`** — **this file needs deletions and rewrites, not just extension.** Full accounting below; `npm test` catches the first group on its own, but the second and third groups **stay green while asserting a rationale that is no longer true**, and nothing will tell you. This is the same class the leg-1 FD correction flagged — *"green tests over now-unreachable code … the unit tests that look like they cover it test a path main.js no longer calls"* — arriving one leg later in a different file. Do not let it pass silently a second time.

**(1) Four tests WILL FAIL — delete or rewrite** (they assert exactly what AC5 removes: an activate call and a second resolve):

| Test | Asserts | Disposition |
|---|---|---|
| `:297` — `readDom: guest — activate called BEFORE executeJavaScript (ordering via callLog)` | activate ordering | **delete** — the ordering it pins no longer exists |
| `:322` — `readDom: RE-RESOLVE proof — the SECOND (post-activate) handle is the one read` | the post-activate re-resolve | **delete** — AC5 removes the second resolve |
| `:776` — `evaluate: guest — activate called BEFORE executeJavaScript, returns the serializable value` | activate ordering | **rewrite** — keep the "returns the serializable value" half, drop the ordering half |
| `:808` — `evaluate: RE-RESOLVE proof — the SECOND (post-activate) handle is the one evaluated` | the post-activate re-resolve | **delete** |

Prefer the leg skill's **rename-with-inverted-assertion** over delete-and-readd where a contract genuinely inverts (it documents the intent shift in `git blame`) — `:297`/`:776` invert cleanly into the AC5 pins below. `:322`/`:808` do not invert; they simply die with the branch.

**(2) Three tests STAY GREEN but go VACUOUS — their names now lie.** Each passes for a *different reason* than the one it claims, so each is a trap for the next reader:

| Test | Claims | After AC5 |
|---|---|---|
| `:346` — `readDom: chrome target — activate NOT called (chrome is always live)` | chrome is exempt from activate | passes because **nothing** activates — "chrome is always live" is no longer the operative reason |
| `:826` — `evaluate: chrome target — activate NOT called (chrome is always live)` | same | same |
| `:364` — `readDom: guest with no activate dep — reads WITHOUT foregrounding` | a special case (dep absent) | **is now the general case** — the "no activate dep" premise stops being a discriminator |

Repoint them: `:364` is one edit away from being the **primary AC5 pin** — change it to *"reads WITHOUT foregrounding even when an activate dep IS present"* and it becomes a real test of the new contract instead of a tautology. `:346`/`:826` should either be retired (subsumed) or re-worded so the rationale matches the mechanism.

**(3) Genuinely unaffected — leave alone**: `:379`, `:388`, `:398` (`readDom` resolve-time refusals — `:398` still holds: `resolveContents` throws before anything), `:421`, `:433`, `:798`, `:841`, `:855`.

**(4) NEW tests to add:**
- `readDom` on a guest **with an `activate` dep present** → `activate` called **zero** times, read still returns the snapshot (the AC5 contract — pin it so a future "restore symmetry" refactor fails loudly). *(This is `:364` repointed per group 2.)*
- `evaluate` likewise — **plus** that the final `isInternalContents` refusal still fires with the activate branch gone (AC5 keeps that guard; prove it did not go out with the branch).
- `captureScreenshot` still calls `activate` **exactly once** for a guest, and `readAxTree` likewise — **pin both sides of the asymmetry**, or a future refactor that "harmonizes" the observe ops silently re-breaks S1's other half.
- `captureScreenshot` whose fake `capturePage()` never settles → rejects at the bound with the named error.

### AC17 — Live smoke: the three checkpoints (MANDATORY)

Apparatus: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`, admin key exported, hand-rolled client per `scripts/mcp-example-client.mjs`.

**Instrument for "raise": `getChromeTarget()`** — it returns the **last-focused** chrome's wcId (`engine.js:124-128` → `getChromeContents()` → `registry.getLastFocused()`). It is **main-side and WSLg-immune**, which is exactly why it is the right instrument here (see the honesty note below). At leg 2 it takes no `windowId` — DD3 is leg 3 — which is precisely what makes it a *last-focused* read.

> **Step 0 is a PREMISE CHECK and a POSITIVE CONTROL — run it BEFORE landing DD7.** It is what makes step 8 a measurement rather than an artifact.

| # | Action | Expected |
|---|--------|----------|
| 0 | **BEFORE applying DD7**: in window 1 open find (Ctrl+F); probe its wcId (`readDom` probe, `find-overlay-geometry.md:82-85`'s technique); press **Esc** (`hide()` → `removeChildView` → the view is **detached but LIVE**, not destroyed); call `captureScreenshot(findWcId)`. | **The request HANGS** (no response; only a client-side timeout recovers). **This reproduces S3 on the rig and proves the instrument can detect the defect.** If it does **not** hang, **STOP and record it** — S3's premise is wrong and the FD must rule before the fix lands. |
| 1 | Launch fresh. `enumerateTabs` → note window 1's tabs. Open a second tab **T** with a distinctive page. | T's wcId recorded; T is in window 1. |
| 2 | Tab-context-menu on **T** → **Move to new window**. | T now lives in **window 2**. (`main.js:2639-2640` moves the `tabViews` entry; `:2646-2649` raises window 2.) |
| 3 | `getChromeTarget()` → record. Then `activateTab(<a window-1 tab>)` → `getChromeTarget()` again. | After activating a window-1 tab, `getChromeTarget().wcId` is **window 1's chrome**. Baseline established: window 1 is last-focused. |
| 4 | **AC17(a).** `activateTab(T)` — a **window-2** tab, driven while window 1 is foreground. | Returns `true` (**not** a throw, **not** a discarded `false`). `getChromeTarget().wcId` **flips to window 2's chrome**. ⇒ **the raise happened, and the instrument demonstrably reports a raise.** Record window 2's chrome wcId here. |
| 5 | Re-baseline: `activateTab(<a window-1 tab>)` → `getChromeTarget()`. | Back to **window 1's chrome**. |
| 6 | **AC17(b) — the absence claim.** `readDom(T)` (T is in background window 2). Then `getChromeTarget()`. | `readDom` **returns T's live DOM** (the read works on a background-window guest — the substance of the change). `getChromeTarget().wcId` is **STILL window 1's chrome** — unchanged. ⇒ **no raise.** This is a **measurement**, not an instrument failure, because **step 4 showed this same instrument reporting a raise in this same run**. |
| 6b | *(Secondary, strengthens 6.)* Using window 2's chrome wcId from step 4: `evaluate(<win2 chrome>, …)` to read window 2's active tab before and after a `readDom(T)`. | Window 2's active tab is **unchanged** by `readDom` ⇒ the **tab-level** activate is gone too, not merely the window raise (AC5). `evaluate` on a **chrome** target classifies `'chrome'` and never activates, so the instrument does not perturb what it measures. |
| 7 | **Probe-walk regression (AC2's null branch).** With a menu open in window 1, run the probe walk (`evaluate` over ids 1..64, skipping `enumerateTabs` ids + chrome). | The sheet's wcId is **found**, exactly as today. ⇒ the refusal did **not** leak onto non-tab wcIds. *(This is the cheap in-smoke stand-in; `npm run a11y` is the real gate — AC14/checkpoint.)* |
| 8 | **AC17(c).** Repeat **step 0** on the fixed build: open find, probe wcId, Esc, `captureScreenshot(findWcId)`. | **Refuses within the bound** (~3s) with `automation: capture-timeout — …`. **Not** a hang; **not** a benign empty image. Compare against step 0's hang — the same action, the same instrument, opposite outcomes. |
| 9 | Healthy-path regression: `captureScreenshot(<a live foreground tab>)` and `captureWindow()` (with a menu open, so the overlay layers are exercised). | Both return normal images **well within** the bound. ⇒ the guard did not turn slow successes into failures. |

**Honesty note — state this in the log, do not let it be inferred.** `getChromeTarget` reads `registry.getLastFocused()`, which the raise itself seeds via `noteFocus`. So steps 4/6 prove the **main-side raise contract** (`win.focus()` called and the accessor re-seeded) — they do **not** prove the **OS compositor** actually brought window 2 forward. Under WSLg that is unprovable by any scripted stimulus (F6 spike verdict 4: focus APIs inert; the leg-1 FD correction: *"a HAT performed on WSLg would prove nothing"*). This mirrors DD4/S2's discipline exactly — **fix it, unit/smoke what the rig can read, never claim live proof the rig cannot give.** The OS-level raise is **HAT-scoped and must be pinned to a non-WSLg desktop or recorded as an accepted permanent gap** — the leg-1 log's standing instruction for exactly this situation. Do **not** leave it as an unqualified HAT ticket that silently cannot run.

### What is left to leg 4's `multi-window-automation` spec

This smoke is a Developer-run, single-pass check. It is **not** a Witnessed run and **not** a regression net. Leg 4's spec owns:

- the same three checkpoints re-proven under the **Witnessed** protocol (independent Validator judging every step);
- the DD6 pair as a **pre-registered spec assertion** ("activating window B's background tab from window A **raises** window B, while `readDom` on one does **not**") — the flight's Verification names it;
- the **cross-window blur** deletion from leg 1, which the leg-1 FD correction ruled *"must become an explicit AC at the first F7 leg that has two windows live (leg 4's `multi-window-automation`)"* — **not this leg**: this leg has two windows but does not touch the blur path;
- **`tests/behavior/foreground-to-act.md` — a prose erratum this leg creates** (queue it; the flight never mentions this spec). Its **steps survive** (verified at leg design: they drive only `captureScreenshot`/`click`/`typeText`, all of which keep raising; its `readDom` at step 5 is a read-back on an already-activated tab). But its **Intent** ("the DD1/DD5 foreground-to-act discipline") and its **Out of Scope** (*"Invisible/background driving … explicitly NOT a v1 capability … If a future 'drive without stealing focus' mode is added, cover it separately"*) are falsified — **DD6 IS that mode**, for `readDom`/`evaluate`. It is `draft` / `Last Run: never`, so it is **not a gate and not a planned red** — a prose fix, in leg 4, with the read/act asymmetry named. *(Recorded rather than fixed here: this leg edits no spec files.)*
- `tests/behavior/observe-refusal-contract.md` — checked at leg design: `draft`/never-run, scoped to `readAxTree`'s `debugger-unavailable` tri-state, **does not enumerate refusals exhaustively** ⇒ **not falsified**. Leg 4 may fold in `capture-timeout` and `activate-refused`.

- **`tests/behavior/tab-reorder.md` step 7 — a suggested "latent confound AC5 incidentally fixes" that was CHECKED AND REJECTED. Do not re-raise it; the evidence is here.** The suggestion (design review, non-blocking) was that pre-AC5, `evaluate`'s own foreground-to-act activated step 7's background tab *before* its synthetic click script ran, undermining the step's claim that the click handler's own activate branch fired. **It does not hold: step 7's `evaluate` targets the CHROME, not the tab.** The spec pins this explicitly at `:62` and `:106` (*"Admin-tier `evaluate(chromeWcId, expression)`"*; *"`evaluate(chromeWcId, …)` numeric reads are the primary observable"*), and step 7's `.tab` DOM node is a **chrome-document tab-strip element** — the same `.tab` nodes step 3 reads `getBoundingClientRect()` from, and the handler under test is the chrome renderer's own. A chrome target classifies `'chrome'` (`resolve.js:56-60`) and **never** activates — today or after AC5 (`observe.js:341`'s guest condition; pinned by the existing test `automation-observe.test.js:826`, *"evaluate: chrome target — activate NOT called"*). **There is no confound, so AC5 fixes nothing here and step 7's claim was always sound.**

  Recorded rather than dropped because the reasoning that produced it is the failure mode this flight already paid for once: *"the ruling was made from the audit's one-line topic classification rather than from the spec's own scoping text"* (leg-1 FD correction on `menu-dismissal`). Same shape here — "`evaluate` is foreground-first" + "a background tab" composed into a confound **without checking which wcId the `evaluate` targets**. The premise-audit habit the flight keeps asking for is what makes this cheap to settle: one grep at `:62`.

## Implementation Guidance

> **Read the working tree, not `HEAD`.** Leg 1 is landed and **uncommitted**. `git stash`, `git checkout -- .`, or diffing against `b607411` for *content* will silently revert it. Every line number below was read off the working tree at leg design; re-verify before editing (leg 3 has not run, so they should hold).

### 1. Land the pure helper first (AC7)

`src/main/capture-timeout.js`. Electron-free, no injected timer seam — use global `setTimeout`/`clearTimeout` exactly as `find.js` does, and test with **MockTimers** (CLAUDE.md: *"MockTimers intercepts global timers in-process; no injection seam needed"*; exemplar `automation-find.test.js`).

```js
// Bounded race for capturePage() (F7 DD7). capturePage() on a DETACHED-but-live
// view NEVER settles — resolveContents (resolve.js:98-140) proves a view LIVE,
// never ATTACHED, so every isDestroyed() guard passes and the request hangs
// forever with no server-side recovery (recon S3; F6 flight-log:274-278).
//
// BORROWED FROM find.js: the 3000ms budget (find.js:106) and the done-guarded
// settle (find.js:130-135). NOTHING ELSE. find.js RESOLVES BENIGNLY on timeout
// (finish(last), last = {activeMatchOrdinal:0, matches:0} — find.js:122/:155);
// carrying that here would yield a silently-empty capture, the exact
// silent-success class S1/DD6 exists to kill. THIS HELPER ALWAYS REJECTS.
// Mechanism differs too: find.js wraps an event-listener flow in a Promise
// constructor; capturePage() is an unrejectable promise you must Promise.race.
//
// ONE semantic: reject. Layer degradation (DD7) is the CALL SITE's policy —
// never this module's, so no caller can inherit a benign settle by accident.
const CAPTURE_TIMEOUT_MS = 3000;
```

Suggested surface (non-binding — leg 1's log records one dep-surface deviation as a legitimate finding; deviate if the contract needs it, and say so in the log):

```js
/**
 * @param {Promise<any>} capture   an in-flight capturePage() promise
 * @param {string} label           names the target in the refusal ('chrome', 'active guest',
 *                                 'find overlay layer', 'sheet overlay layer', 'wcId 42')
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<any>} the capture's value; REJECTS at the bound with
 *   `automation: capture-timeout — {label} did not settle within {ms}ms (the view may be detached)`
 */
function withCaptureTimeout(capture, label, { timeoutMs = CAPTURE_TIMEOUT_MS } = {}) { … }
```

Take `capture` as an **already-started promise**, not a thunk: `main.js:665-668`'s `Promise.all` starts both captures in parallel, and a thunk would invite serializing them.

### 2. `tabs.js:activateTab` — the routing fix, the raise, the scoped refusal (AC2/AC3)

`tabs.js` is **Electron-free** — keep it that way. The registry is reached only through injected deps.

```js
async function activateTab(wcId, deps) {
  resolveContents(wcId, deps); // unchanged — throws bad/dead/internal before anything else

  // F7 DD6 (recon S1): dispatch to the tab's OWNING window's chrome, resolved AT
  // EVENT TIME. Pre-F7 this went through deps.executeInRenderer → the LAST-FOCUSED
  // chrome (engine.js:71-76), whose activateTabByWcId searches its OWN document's
  // tabs Map (renderer.js:3603-3608), missed a window-B tab, returned false — and
  // every caller DISCARDED that false, so acts proceeded against an unraised,
  // unrendered background guest and reported success.
  const owning = typeof deps.chromeForTab === 'function' ? deps.chromeForTab(wcId) : null;

  if (typeof deps.chromeForTab !== 'function') {
    // Absent dep → pre-F7 behavior (the house "Absent → no behavior change" idiom,
    // engine.js:33-41). Offline/unit callers only: BOTH live injection sites are
    // grep-pinned by the leg's AC6 precisely because this fallback is silent.
    return deps.executeInRenderer('window.__goldfinchAutomation.activateTabByWcId(' + wcId + ')');
  }

  if (!owning) {
    // NOT a registry-owned tab. classifyContents (resolve.js:56-60) calls anything
    // that isn't a registered chrome a 'guest', so the menu sheet and the find
    // overlay land here. Pre-F7 these dispatched, missed, and returned a DISCARDED
    // false — which is exactly why the probe walk works. Return that same false:
    // it is the honest answer ("not a tab I own"), not a silent no-op. DO NOT
    // throw here — it would break npm run a11y (a flight checkpoint), all 10
    // probe-walk specs, find-overlay-geometry's readDom probe, and per-wcId
    // captureScreenshot on overlay ids.
    return false;
  }

  const ok = await deps.executeInChrome(owning, 'window.__goldfinchAutomation.activateTabByWcId(' + wcId + ')');
  if (!ok) {
    // The registry says this window owns the tab, but its chrome's tabs Map
    // disagrees — a real desync. NEVER a silent no-op again (DD6).
    throw new Error('automation: activate-refused — wcId ' + wcId + ' is owned by a window whose chrome could not activate it');
  }
  if (typeof deps.raiseWindowForTab === 'function') deps.raiseWindowForTab(wcId);  // AFTER dispatch
  return true;
}
```

**Raise AFTER dispatch**, so the window comes forward already showing the right tab; and a refusal raises nothing (we threw first).

**Why the raise can live inside the shared primitive** — and this is the elegant part of AC1's table: once AC5 deletes `readDom`'s and `evaluate`'s activate branches, **the only remaining callers of `activate` are the seven sites that raise.** The predicate stops being a per-site conditional and becomes **structural**: *ops that call activate raise; ops that don't, don't.* `engine.js:90`'s shared `activate` and `engine.js:98`'s public `activateTab` op both route through `tabs.activateTab`, so both raise — which is what the flight wants ("the act *is* the raise"; "`activateTab` on a window-B tab raises window B"). **Do not** add a per-op raise flag; if you find yourself needing one, the AC5 deletion did not happen.

### 3. Thread the deps (`engine.js`, AC6)

Add `chromeForTab` and `raiseWindowForTab` to `createEngine`'s opts bag (`engine.js:61`), document them in the JSDoc alongside `isTabViewWcId`/`isChromeContents` (`:33-41`) with the same "Absent → no behavior change" wording, and put them on `base` in `deps()` (`:85`) so the shared `activate` (`:90`) and the public op (`:98`) both see them.

`executeInChrome(chrome, code)` is the new dispatch seam. Simplest shape that keeps `tabs.js` Electron-free: build it in `engine.js`'s `deps()` beside `executeInRenderer` (`:73-76`) — `(chrome, code) => chrome.executeJavaScript(code)`, with the same null guard. Do **not** pass raw `webContents` into `tabs.js` and call methods on it there beyond this seam.

### 4. Inject from main.js — BOTH sites (AC4/AC6)

`main.js` already has the routing primitive: **`chromeForTab(wcId)`** at `:246-249` — *"Class-3 owner routing (DD2): the chrome webContents of the window OWNING a tab, resolved AT EVENT TIME … Null when unowned or destroyed."* Pass it straight through. **No new registry primitive is needed** (the flight's prerequisite, re-verified: `window-registry.js:170-173`).

The raise helper — place it beside `chromeForTab`, and copy the **idiom**, both halves, from `main.js:2646-2649`:

```js
// F7 DD6: raise the window OWNING a tab (the foreground-to-act contract restated at
// WINDOW scope). Both halves are load-bearing — the idiom is main.js:2646-2649's:
// programmatic win.focus() fires NO focus event under WSLg (F6 spike verdict 4), so
// noteFocus must seed the DD8 accessor explicitly or nothing downstream
// (getChromeContents / getChromeTarget / grabWindow) ever learns of the raise.
function raiseWindowForTab(wcId) {
  const rec = registry.getWindowForGuest(wcId);
  if (!rec || rec.win.isDestroyed?.()) return;
  rec.win.focus();
  registry.noteFocus(rec.win.id);
}
```

Then add `chromeForTab` and `raiseWindowForTab` to **both** `createEngine` calls: the MCP `getEngine` accessor (`main.js:764`) **and** the dev-seam engine (`main.js:3263`). The leg-1 log flags parity between these two as a live concern; AC6 greps for `2` on each.

### 5. `observe.js` — delete two activate branches (AC5)

In `readDom` (`:191-201`) and `evaluate` (`:338-363`), delete the whole guest-activate block. Then:
- `let wc` → `const wc`;
- delete the now-false "Re-resolve AFTER the async activate" comments — **there is no async hop left**;
- `evaluate` **keeps** its final `isInternalContents` refusal (`:348-350`) — it is the DD2-HIGH guard. Its comment says it runs "on the FINAL wc, after the (optional) activate branch, so it covers the no-activate path too"; rewrite it, because there is now **only** the no-activate path;
- rewrite both JSDoc blocks. `readDom:149-151` and `:185-187`, and `evaluate:302-304`, all assert foreground-first. Replace with the DD6 predicate and **say why** (`executeJavaScript` works on a background guest; making a *read* steal the operator's foreground is a worse bug than the one being fixed).
- **Do not touch** `captureScreenshot` (`:121-134`) or `readAxTree` (`:277-298`) activate branches — AC1 rows 1 and 2 keep them, and `automation-observe.test.js` should pin **both** sides of the asymmetry.

**Keep every earned comment.** `observe.js:26-34` (the "resolve → activate → re-resolve skeleton" rationale, and the load-bearing DD2-HIGH guard note) needs a surgical edit, not deletion — it explains why the eval ops are co-located with `readDom`, which is still true; only the *shared activate skeleton* half is now false.

### 6. Bound the five captures (AC8/AC9/AC10/AC11)

**`observe.js:132`** — hard-refuse. `observe.js` stays **Electron-free**: `require('../capture-timeout')` — reaching up to `src/main/` is already the established shape here (`observe.js:5` does `require('../devtools')`).

```js
const image = await withCaptureTimeout(wc.capturePage(), 'wcId ' + wcId);
```

**`main.js:665-668`** — wrap each promise **individually** inside the `Promise.all`, hard-refuse both:

```js
const [chromeImg, tabImg] = await Promise.all([
  withCaptureTimeout(cc.capturePage(), 'chrome'),
  atc && !atc.isDestroyed()
    ? withCaptureTimeout(atc.capturePage(), 'active guest')
    : Promise.resolve(null),
]);
```

**`main.js:698-703` (find) and `:704-709` (sheet)** — bound **and** re-check (AC9 + AC11). Both take the same shape:

```js
const findView = grabRec.findOverlay && grabRec.findOverlay.isVisible() ? grabRec.findOverlay.getView() : null;
if (findView && !findView.webContents.isDestroyed()) {
  try {
    const img = await withCaptureTimeout(findView.webContents.capturePage(), 'find overlay layer');
    // DD7 post-await re-check (TOCTOU): the gate above is SYNCHRONOUS and the await is
    // not — a hideFindOverlay() landing in the gap detaches the view mid-capture. Written
    // against THIS window's instance (leg 1 deleted the `=== grabWin` compares), and
    // NULL-TOLERANT because leg 1's AC8b nulls rec.findOverlay in the window's `close`
    // handler, so the slot can go null during the await.
    if (!grabRec.findOverlay || !grabRec.findOverlay.isVisible()) {
      /* detached mid-capture — drop the layer (same disposition as a layer timeout) */
    } else {
      const b = /** @type {Electron.WebContentsView} */ (/** @type {unknown} */ (findView)).getBounds();
      if (img && b.width && b.height) layers.push({ … });
    }
  } catch (err) {
    // DD7 layer degradation: a slow menu must not fail an otherwise-good window
    // capture. Matches the composite's existing tolerance for a failed layer
    // (:729's `.then(…, function() { return null; })` already drops one SILENTLY —
    // this one LOGS). Contrast the chrome/guest captures above, which hard-refuse:
    // those ARE the capture.
    console.warn('[capture] dropping find overlay layer:', err && err.message);
  }
}
```

**AC10 — the cause-preserving re-throw.** `grabWindow`'s composite sits in `try { … } catch { /* fallback failed */ }` (`:658` / `:746-748`) → `return null` (`:749`) → `observe.captureWindow` throws the generic `'automation: chrome window unavailable'` (`observe.js:216-218`). That would **swallow** the chrome/guest hard-refusal and lose the named cause. Re-throw it:

```js
} catch (err) {
  // DD7: a capture-timeout is a NAMED refusal and must reach the caller. The generic
  // 'chrome window unavailable' this catch otherwise degrades to would hide the cause —
  // the silence DD7 exists to remove.
  if (err && /^automation: capture-timeout/.test(err.message || '')) throw err;
  /* fallback failed */
}
```

Note this makes `grabWindow` **reject** where it previously only ever resolved-or-null'd. `observe.captureWindow` (`:215-220`) awaits it, so the rejection propagates to the tool adapter as `isError` — the intended DD7 outcome. Check no other `grabWindow` caller assumes never-throws: `grep -n 'grabWindow' src/main/main.js src/main/automation/*.js` (at leg design: `main.js:767`, `:3265` — both *injections*, plus `observe.js:212-218`'s use).

### 7. Then the tests, then the docs, then the smoke

Order matters: the unit net proves the pure parts, the smoke proves the live parts, and the docs record what changed. **Run AC17's step 0 (the S3 premise check) BEFORE landing the DD7 half** — it is unrecoverable afterwards, and it is what makes step 8 a measurement instead of an assertion.

## Edge Cases

- **Why the activate branch is DELETED, not narrowed (AC5) — the interpretation, with its evidence, so the FD can overrule it cheaply.** DD6's table column is headed "Raises?", which alone could mean *"keep the tab-activate, skip the window-raise."* It does not. Three things settle it: (1) the flight's own risk text names the break as *"an external consumer relying on `readDom`'s **activate side-effect**"* — that is tab activation, not a window raise; (2) DD6's recorded side-effect (*"with `evaluate` no longer raising, the probe walk's foreground-first hazard **disappears**"*) is **only true** if the activate goes — a kept tab-activate leaves `CLAUDE.md:388`/`docs:346`'s hazard (*"probing a background tab would activate it, closing the menu under audit"*) fully intact; (3) DD6's stated reason — *"`executeJavaScript`… works fine on a background guest"* — is an argument about the **tab**, not the window. If the FD disagrees, this is the one thing in the leg to overrule, and AC5 + AC13 + the AC17(6b) step are where it lands.
- **The overlay wcId is the whole reason AC2 has three branches, not two.** Restated because it is the leg's sharpest trap: `classifyContents` (`resolve.js:56-60`) is *"not a registered chrome ⇒ `'guest'`"*, so the sheet and the find overlay are `'guest'`s that no window's `tabViews` contains. `getChromeForTab` returns **null** for them — which is exactly the signal AC2's null branch keys on. Today's discarded `false` is load-bearing infrastructure; the leg preserves it deliberately.
- **The contract break is real and uncovered.** `EXPECTED_TOOL_COUNT = 29` (`automation-mcp-server.test.js:26`) does not move; no `inputSchema` moves; DD9's schema pin lands in **leg 3**. So **no test in the repo will fail** if this leg's contract change is wrong in a way the smoke misses. That is not a reason to soften the ACs — it is the reason AC12 exists and the reason this leg is HIGH.
- **`mcp-tools.js:34` pins `activateTab`'s boolean.** *"closeTab / activateTab → their BOOLEAN return … serialized as true/false. They are NOT void — do NOT normalize them to `{"ok":true}`."* This survives: `activateTab` still returns `true` (owned+activated) or `false` (not a registry-owned tab). Only the *third* outcome — the desync — becomes a throw, which the adapter surfaces as `isError`. **`mcp-tools.js` needs no edit** (AC: it is on the pinned-unchanged list). Its `activateTab` **description** at `:154` ("Returns a boolean success signal") stays true; the *docs* row (`docs/mcp-automation.md:403`) is where the refusal gets named (AC13).
- **The `Promise.all` hides which capture hung.** `main.js:665-668` races chrome and guest together; a bare wrap would report whichever rejects first with no way to tell them apart. That is why `withCaptureTimeout` takes a **label** — `'chrome'` vs `'active guest'` — and why the refusal message carries it. Without labels the refusal names the symptom but not the target, which is the failure mode DD7's "the refusal names the cause" clause exists to prevent.
- **A slow capture vs. a hung one.** DD7 accepts this: *"a timeout can fire on a merely-slow capture, turning a slow success into a failure. Accepted with a generous bound; the refusal names the cause."* 3000ms is the find.js budget. AC17 step 9's healthy-path regression is what keeps the bound honest — if a normal `captureWindow` with overlays lands anywhere near 3s, **record it** rather than quietly raising the bound.
- **`raiseWindowForTab` on a tab whose window is mid-teardown.** `registry.getWindowForGuest` can return a record whose `win` is closing. Guard with `isDestroyed?.()` and return silently — a raise is a side-effect, never a reason to fail the op. Mirrors `chromeForTab`'s own `!cc.isDestroyed()` guard (`main.js:247-248`).
- **`activateTab` on a tab in the SAME window still raises.** The raise is unconditional once the owning window resolves — no "is it already focused" check. `win.focus()` on the already-focused window is a no-op, and `noteFocus` is idempotent (`window-registry.js:121-123`, latest-event-wins). Adding a conditional buys nothing and re-introduces a compare that leg 1 spent the whole leg deleting.
- **A tab that moves windows mid-activate.** `chromeForTab` resolves **at event time** (the class-3 discipline), so the dispatch goes to whichever window owns the tab at that instant. A move landing between the resolve and the dispatch sends the activate to the *old* window's chrome, which no longer has it ⇒ `false` ⇒ the named refusal. **That is correct**: loud, not silent, and the caller retries against a settled registry. DD1's note that `main.js:2639-2640`'s delete/set are adjacent synchronous statements means the window for this is vanishingly small.
- **`find.js` and `print.js` are PINNED UNCHANGED** even though they own two of AC1's nine sites. Both already raise (rows 3 and 4) and both get their raise for free through the shared `activate` primitive. **Do not "helpfully" refactor them.**
- **The smoke's step 0 is destructive of its own premise.** Once DD7 lands, the hang is unreproducible. Run step 0 first or lose the positive control — and with it, step 8's standing as a measurement. This is the leg-1 lesson applied in advance: *"when an Expected Result asserts an absence, measure a known-present case with the same instrument in the same run."*

## Files Affected

- `src/main/capture-timeout.js` — **NEW**. Pure/Electron-free bounded race; always rejects; borrows find.js's 3000ms budget + `done` guard and nothing else.
- `test/unit/capture-timeout.test.js` — **NEW**. MockTimers per-test; includes the anti-find.js benign-settle pin.
- `src/main/automation/tabs.js` — `activateTab` (`:123-126`): owning-chrome routing, the three-way rule, the raise, the named refusal.
- `src/main/automation/observe.js` — `readDom` (`:191-201`) and `evaluate` (`:338-363`) lose their activate branches + JSDoc/comment rewrites; `captureScreenshot`'s `capturePage` (`:132`) bounded; `:26-34`'s skeleton comment surgically corrected.
- `src/main/automation/engine.js` — `chromeForTab` / `raiseWindowForTab` in the opts bag (`:61`) + JSDoc (`:33-41`) + `base` (`:85`); the `executeInChrome` seam beside `executeInRenderer` (`:73-76`).
- `src/main/main.js` — `raiseWindowForTab` helper beside `chromeForTab` (`:246-249`); both deps injected at **both** engine sites (`:764`, `:3263`); four bounded captures (`:666`, `:667`, `:700`, `:706`); two post-await re-checks (`:698-703`, `:704-709`); the cause-preserving re-throw (`:746-748`).
- `test/unit/automation-tabs.test.js` — extended (the five existing `activateTab` tests pass unmodified).
- `test/unit/automation-observe.test.js` — extended (both sides of the activate asymmetry pinned).
- `docs/mcp-automation.md` — `:346`, `:403`, `:431`, `:445` (+ `:300` if it asserts read-op activation); the `capture-timeout` refusal added to the refusal vocabulary. **`:356-384` is NOT this leg's** (leg 3).
- `CLAUDE.md` — `:388` (probe-walk hazard retired), `:424` (foreground-to-act is no longer uniform — state the read/act asymmetry).
- **PINNED UNCHANGED**: `src/main/automation/find.js`, `print.js`, `input.js`, `resolve.js`, `mcp-tools.js`, `scope.js`; `src/main/find-overlay-manager.js`, `src/main/menu-overlay-manager.js`, `src/main/window-registry.js`; **every file under `tests/behavior/`** (leg 4 owns spec edits; this leg only *queues* the `foreground-to-act` erratum in the log).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test` ≥ 1768; `npm run typecheck`; `npm run lint`)
- [ ] `npm run a11y` green — **the AC2 null-branch regression gate**, and a flight checkpoint
- [ ] The AC17 live smoke run, **step 0 first**, with every observable recorded
- [ ] **APPEND** a leg-2 landing entry to `flight-log.md` — do **not** edit any existing entry (append-only). Record:
  - [ ] **main.js's line count at landing** (`wc -l`, read off the tool — baseline 3392; flight net ≤ 3461 judged at flight end, not here)
  - [ ] **AC12's named risk** — schema-stable + contract-breaking, uncovered by DD9 until leg 3, with the in-repo consumer sweep
  - [ ] **the AC17 smoke's three checkpoints**, including step 0's pre-fix hang and step 8's bounded refusal — and the **honesty note** on what `getChromeTarget` can and cannot prove under WSLg, plus the HAT item pinned to a **non-WSLg desktop or recorded as an accepted permanent gap**
  - [ ] **the AC1 count correction** — nine activate sites, not eight; the three corrected labels (`input.js:235` = `actOn` serving click/typeText/pressKey; `:265` = `actOnPaced` serving dragPointer; `:368` = `scroll`); `activateTab` is the primitive, not a site. **The sixth instance of this flight's count/enumeration-error pattern** — the debrief wants it.
  - [ ] **the AC2 ruling** — the refusal is scoped to registry-owned tabs; the null branch preserves overlay `captureScreenshot`/`readAxTree`, while **AC5** is what preserves the `evaluate`/`readDom` probe walks and `npm run a11y` (the two protections cover **disjoint** ops — see AC12's attribution note). Record it as a **leg-design ruling forced by the code**, not a re-litigation of DD6.
  - [ ] **the completed consumer sweep's disposition** — `scripts/` + all of `tests/behavior/*.md` swept; **no in-repo consumer relies on a read op's activate side-effect**; ~16 further background-tab + `readDom`/`evaluate` specs individually cleared. Leg 4 inherits this; record it so leg 4 does not redo it.
  - [ ] **the `foreground-to-act.md` prose erratum queued for leg 4** (steps survive; Intent + Out of Scope falsified) — a spec the flight never mentions
  - [ ] **the `tab-reorder.md` step-7 confound: CHECKED AND REJECTED** (its `evaluate` targets the chrome, `:62`/`:106`) — record the rejection so it is not re-raised at leg 4
  - [ ] **the `automation-observe.test.js` test accounting** — 4 deleted/rewritten, **3 that stayed green but went vacuous** (`:346`, `:364`, `:826`) and how they were repointed. The vacuous three are the leg-1 "green tests over now-unreachable code" class recurring one leg later; the debrief wants the recurrence, not just the instance.
  - [ ] anything the implementation surfaced that this design missed
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in `flight.md`
- [ ] **Do NOT commit** — this flight commits **once** after the flight-end review (the F6 pattern; leg 1 is landed-uncommitted in the same working tree)

---

## Citation Audit

**38 code-location citations verified against the working tree at leg design.** Because leg 1 is landed-but-uncommitted, every citation inherited from the flight spec, the flight log, and the leg brief was re-derived against the **working tree** rather than `HEAD`. **Six drifted, three carried wrong labels, and one count was wrong.**

### Drifted — repaired inline (all six caused by leg 1's ~224-line extraction from main.js, 3461 → 3392)

| Citation (flight / brief) | Working tree | Note |
|---|---|---|
| `main.js:857` — chrome `capturePage` | **`main.js:666`** | inside `Promise.all` at `:665-668`, not an individual await |
| `main.js:858` — guest `capturePage` | **`main.js:667`** | same `Promise.all` |
| `main.js:889` — find layer `capturePage` | **`main.js:700`** | |
| `main.js:895` — sheet layer `capturePage` | **`main.js:706`** | |
| `main.js:888` / `:893` — the two sync TOCTOU gates | **`main.js:698-699` / `:704-705`** | **reshaped, not merely moved**: leg 1 replaced `overlayVisible && overlayView && findOverlayAttachedWin === grabWin` with `grabRec.findOverlay && grabRec.findOverlay.isVisible()`. The TOCTOU survives; the `=== grabWin` compares do not. AC11 is written against the new shape. |
| `main.js:918` — `.then(…, function() { return null; })` layer drop | **`main.js:729`** | DD7's cited precedent for layer tolerance |

### Drifted — **DANGEROUS**, flagged rather than quietly fixed

| Citation | Working tree | Why it matters |
|---|---|---|
| `window-registry.js:156-159` — `getChromeForTab` | **`window-registry.js:170-173`** | Leg 1 added 14 header lines + 2 typedef fields (196 → 210). **`:156-162` is now `getWindowForGuest`** — a *different but adjacent and plausible* function. An implementer following the flight's citation lands on real, working, wrong code that even *type-checks* at the call site. Both the flight (`:156-159`) and the leg brief repeat the stale number. |

### Context-only drift (not load-bearing here, recorded for leg 3/F8)

- `main.js:2699-2700` — DD1's adjacent synchronous `tabViews.delete`/`set` → **`main.js:2639-2640`**. The **F8 constraint** DD1 records ("any await F8 introduces between those statements silently degrades DD1") points at these lines; F8 must re-derive them.
- `main.js:3421-3431` / `:3424-3428` — the `before-quit` overlay block and its ordering pin: **gone** (leg 1 deleted them; AC9 of leg 1).

### Verified OK — no drift

- `observe.js:126`, `:132`, `:195`, `:239-240`, `:282`, `:342` — all six confirmed by direct read. `observe.js` is untouched by leg 1.
- `input.js:235`, `:265`, `:368` — line numbers **correct**; **labels wrong** (below).
- `print.js:40` (+ `:42`'s `waitForPaint`, DD7's stated reason for row 3) — confirmed.
- `find.js:102` (activate), `:106` (`|| 3000`), `:122` (`last = {activeMatchOrdinal: 0, matches: 0}`), `:130-135` (the `done`-guarded `finish`), `:155` (`setTimeout(() => finish(last), timeoutMs)`) — all confirmed. DD7's "find.js resolves benignly on timeout" reading is **correct**: `:155` calls `finish(last)`, not a reject.
- `tabs.js:123-126` — `activateTab`, confirmed exactly.
- `engine.js:72-76` — confirmed (the arrow opens at `:71`; the null guard + `executeJavaScript` are `:73-76`). `engine.js:90` (the shared `activate`) and `:98` (the public op) confirmed.
- `renderer.js:3603-3608` — `activateTabByWcId`; the flight log's `:3603-3607` omits the closing brace. Body confirmed: `findTabByWcId` → `if (!tab) return false;`.
- `resolve.js:98-140` — `resolveContents`; confirmed it proves a view **live**, never **attached** (DD7's premise). `resolve.js:56-60` — `classifyContents`, confirmed as "not a registered chrome ⇒ `'guest'`" (AC2's basis).
- `scope.js:164`, `:183` — the `admin-only` refusal wording DD2/DD3 preserve; confirmed (the flight's `:181-184` brackets `:183`).
- `mcp-tools.js:34` (the boolean-return pin), `:153-161` (the `activateTab` tool def), `automation-mcp-server.test.js:26` (`EXPECTED_TOOL_COUNT`) — confirmed.
- `main.js:246-249` (`chromeForTab`), `:2646-2649` (the `win.focus()` + `noteFocus` raise idiom, with its WSLg comment), `:973` (`win.on('focus')` → `noteFocus`), `:764` / `:3263` (the two `createEngine` sites), `:611-749` (`grabWindow`), `:658`/`:746-748`/`:749` (the catch-all + `return null`) — all confirmed by direct read.
- `scripts/a11y-audit.mjs:212-235` (`findSheetWcId`) — confirmed; its `evaluate`-based walk and its swallowing `catch` are AC2's motivating evidence.
- Test baseline **1768/1768, 13 suites** and `wc -l src/main/main.js` = **3392** — both confirmed by running the tools, not from the leg-1 log.

### Corrected against the flight's own text (recorded, not silently fixed)

**1. The count: DD6 says "ALL EIGHT" three times; there are NINE sites — and DD6's own table already has nine rows.** The prose count is wrong; the table's row count is right. Verified by `grep -rnE 'await (deps\.)?activate\(wcId\)' src/main/automation/` → nine sites (`input.js:334` is a doc comment). Recorded as the **sixth** instance of this flight's count/enumeration-error pattern — after the recon's probe-walk 7-vs-10, the audit's "2 stale rows" vs 1, the "nine conditioning checks" mislabel (7 compares + 2 resolves), the "8 DD7 tests" vs 9, and leg 1's "two stale comments" vs three. The pattern is now well enough established to name its shape: **every one of the six is a total stated in prose instead of an enumeration read off the tool.** DD6's table was right precisely *because* it enumerated.

**Why the count error is benign here, which is worth recording too:** the ninth row was never *missing* — it was mis-labeled. Every one of the nine rulings survives re-derivation. No decision changes.

**2. Three of DD6's nine site labels are wrong.** The line numbers are all correct; the labels name the wrong function:

| DD6's label | Actually | Consequence |
|---|---|---|
| `input.js:235` → "`click`" | **`actOn`** — serves **`click` (`:284`), `typeText` (`:294`), and `pressKey` (`:396`)** | under-states the blast radius by two ops |
| `input.js:265` → "`typeText` (paced)" | **`actOnPaced`** — serves **`dragPointer` (`:316-322`)** only. **`typeText` is not paced**; it routes through `actOn` (`:294`) | names an op that isn't there and misses the one that is |
| `input.js:368` → "`activateTab` and the explicit-act group" | **`scroll`** | names neither the site nor a real site. **`activateTab` is not an activate site at all** — it is the *primitive* every site calls (`engine.js:90`) and separately a public op (`engine.js:98`). |

All three still **raise** under the predicate (all are explicit acts), so — as with the count — **no ruling changes**. AC1's table carries the corrected labels, the enclosing function, and the ops served, so the implementer cannot inherit the error.

### Flagged for the FD — a design gap in DD6 the leg had to rule on

**DD6's named refusal, taken literally, breaks `npm run a11y` — a flight checkpoint — plus all 10 probe-walk specs and the overlay-`captureScreenshot` apparatus the flight's own Prerequisites depend on.** The chain, verified end-to-end at leg design:

1. `classifyContents` (`resolve.js:56-60`) returns `'guest'` for anything that is not a registered chrome ⇒ the menu sheet and the find overlay classify as **`'guest'`**.
2. So `evaluate(sheetWcId)` today calls `activate(sheetWcId)` → `activateTabByWcId` → `findTabByWcId` misses → **`false`** → **discarded** at `observe.js:342` → the op proceeds and reads the sheet. **The probe walk works today *because* the false is discarded.**
3. A blanket "false ⇒ throw" would make every overlay probe throw. `scripts/a11y-audit.mjs:212-235`'s own `catch { /* keep walking */ }` would swallow it and then `fail('menu-overlay sheet wcId not found…')`.

**Ruled** (AC2): the refusal is **scoped** — it fires only when the registry *owns* the tab and the owning chrome disagrees (a real desync). No owning window ⇒ return the same `false` as today, no raise, no throw. This is the only reading that fixes S1 without breaking a flight checkpoint, and it falls out of the mechanism naturally, since `getChromeForTab` returns **null** for a non-tab wcId. **Recorded as a leg-design ruling forced by the code — not a re-litigation of DD6**, whose intent (kill the silent cross-window no-op) is served exactly.

**Secondary reading the FD may want to overrule** (Edge Cases → "Why the activate branch is DELETED, not narrowed"): DD6's "Raises?" column is read as *delete the activate call*, not *keep the tab-activate and skip the window-raise*. The evidence is the flight's own risk text ("`readDom`'s **activate side-effect**") and its recorded side-effect ("the probe walk's foreground-first hazard **disappears**" — true only under this reading). If the FD reads it the other way, AC5, AC13, and the AC17(6b) step are the blast radius.

### Post-review addenda (leg design review)

The review returned **approve-with-changes**, independently re-verifying **all ~45 citations above against the working tree — every one matched exactly** — and validating all three contested calls: reading (a) ("delete the activate branch"), the AC2 refusal-scoping ruling (traced end-to-end, **no hole**), and DD7's helper + layer-split + post-await re-checks. Four findings folded; **two were errors of mine, and both are recorded rather than quietly fixed**:

- **CORRECTED — AC6's grep would have inverted its own purpose.** I wrote `grep -c 'chromeForTab:'`, expecting colon-suffixed object-literal syntax. But `main.js:767` — **inside the exact opts literal AC6 targets** — already writes `grabWindow,` in ES6 shorthand, and both new deps are plain function references in the same module scope, so the style-consistent edit is `chromeForTab,`. The grep would have returned **0 at both sites on a correct injection** — green when broken, red when right, exactly backwards from the AC's stated reason for existing. Replaced with a line-anchored, syntax-agnostic form (`^\s*chromeForTab(,|:)`), **validated against the precedent in the same file** (`^\s*grabWindow(,|:)` → 2, excluding its definition at `:611`) and against the ~10 `chromeForTab(...)` call sites + the `:246` definition (all correctly excluded). **Lesson worth the debrief: a grep-AC must be validated against the tree AND against the edit it is meant to accept.** This flight's grep-ACs have now failed twice in related ways — leg 1's AC3/AC6 were comment-blind (a token naming a deleted concept is exactly the token its replacement's comments want to cite); this one was syntax-blind. Both were written from the *intent* rather than run against a *candidate correct diff*.
- **CORRECTED — a count error in AC1's own verify line** ("9 hits" for a grep printing 10; `input.js:334`'s doc comment is the tenth). Recorded at AC1. The seventh instance of the flight's pattern, and the sharpest one: it is in the AC that documents the pattern.
- **CORRECTED — AC12 misattributed the probe-walk protection** to AC2's null branch. Once AC5 lands, `evaluate`/`readDom` never call `activate()` on **any** target, so the probes are protected by **AC5**; AC2's null branch is load-bearing for `captureScreenshot`/`readAxTree` on overlay wcIds (AC1 rows 1–2), which still activate. Disjoint sets, invisible today because both land together, misleading to a future partial revert. Fixed at AC12 with the revert-asymmetry spelled out.
- **FOLDED — the `automation-observe.test.js` accounting.** The review named four failing tests (`:297`, `:322`, `:776`, `:808`); my sweep on folding found **three more** it did not flag — `:346`, `:364`, `:826` **stay green but go vacuous** (they pass for a reason other than the one they claim; `:364`'s "no activate dep" premise stops being a special case and becomes the general one). All seven are now enumerated with dispositions. This is the leg-1 FD correction's "green tests over now-unreachable code" class recurring one leg later in a different file — the recurrence is the finding.

**REJECTED — one non-blocking suggestion, with evidence** (the `tab-reorder.md` step-7 "latent confound"): checked against the spec's own text and it does not hold — that `evaluate` targets the **chrome** (`:62`, `:106`), which never activates. See "What is left to leg 4" for the full disposition and why the reasoning that produced it is worth recording.

### One spec the flight never mentions

`tests/behavior/foreground-to-act.md` — checked because DD6 changes the contract it is named after. **Not falsified as a gate**: its steps drive only `captureScreenshot` / `click` / `typeText`, all of which keep raising (its `readDom` at step 5 is a read-back on an already-activated tab), and it is `draft` / `Last Run: never` / AUTHORED-ONLY. But its **Intent** and its **Out of Scope** (*"Invisible/background driving … explicitly NOT a v1 capability … If a future 'drive without stealing focus' mode is added, cover it separately"*) **are** falsified — DD6 *is* that mode. Queued for leg 4 as a prose erratum (this leg edits no spec files). `tests/behavior/observe-refusal-contract.md` was checked the same way and is **not** falsified (draft/never-run; scoped to `readAxTree`'s tri-state; does not enumerate refusals exhaustively).
</content>
</invoke>
