# Leg: automation-gate

**Status**: landed
**Flight**: [Drag Interactions](../flight.md)

## Objective

Replace the overlay sheet's unconditional automation refusal with a two-allowlist gate — admitted menuType **and** admitted op — make the sheet's DOM stop retaining closed menus' content so that gate rests on a true premise, and close the same surface's pre-existing pixel-read path in `captureWindow`.

## Context

Flight DD1/DD1a/DD1b/DD1c/DD1d/DD1e/DD1f.

The sheet-automation disposition has been deferred three times (Flight 1 debrief Rec 1, Flight 2 leg 4's resumption note, Flight 2 debrief Rec 4 — *"resolve before Flight 3 designs drag"*). This leg resolves it, because Flight 3's `bar-overflow-drag` target surface **is** the overflow sheet and its verification is otherwise blind.

Two design-review cycles ran; the third finding was escalated to the operator per the skill's 2-cycle cap and ruled on 2026-08-05. Four things a reviewer must hold onto:

**1. The rule is an op ALLOWLIST, not a denylist, and not a "leaves nothing resident" test.** An earlier draft named three admits and three refusals over a funnel of 23 ops (`scope.js:49-70`), leaving `navigate`, `printToPDF`, `findInPage`, `typeText` silently admitted. `navigate(sheetWcId, url)` would replace the shared persistent document with attacker-chosen content that then hosts `vault-unlock`. Residency is *why* `evaluate` can never be admitted; it is a bad *test*, since `printToPDF` leaves nothing resident and must still be refused.

**2. `readDom` executes script, and that is fine — but nobody should discover it mid-review.** `readDom` runs `READ_DOM_SNIPPET` through `wc.executeJavaScript` (`observe.js:160-164`, consumed `:220-221`). The distinction the allowlist encodes is **fixed app-authored snippet vs caller-supplied code**: `readDom` runs one closed IIFE returning `{url, title, html}`, registering nothing and uninfluenceable by the caller; `evaluate`/`injectScript` run caller-controlled code into a realm that outlives the menu it was injected under (`menu-overlay-manager.js:161-179` — `teardown()` is the only destroy; `:244-249` — `hide()` is `removeChildView` alone; header `:61-63`: *"the hidden sheet keeps its rendered menu DOM"*).

**3. Which guard refuses jar keys — corrected at cycle 1, and the correction is the point.** An earlier draft claimed guard 5 (`non-tab-contents`) refuses jar keys and **instructed the implementer to write that into the security comment**. False. `memberDeps()` (`scope.js:138-145`) threads `fromId`/`chromeContents`/`fromPartition`/optional `isChromeContents` — **neither `isSheetContents` nor `isTabViewWcId`** — so inside `resolveContentsForJar` guards 3 and 5 are *both* no-ops (each `typeof … === 'function'`-gated, `resolve.js:125`, `:155`). The real refusal is `out-of-jar` from the session-identity compare (`resolve.js:223-226`), exactly as `docs/mcp-automation.md:335` already says. Guard 5 backstops only at the **engine** level (`main.js:934`/`:953`), a path `scopeEngine`'s façade never reaches because `facade[op]` calls `resolveContentsForJar` first (`scope.js:154-158`). The **conclusion survives** — this leg widens the admin tier only — but a wrong mechanism in a security comment is what the HIGH tier exists to catch.

**4. The gate reads main's *intent*; the secret lives in the renderer's *state* — and DD1f reconciles them.** `deliverInit` is the **only** message main sends the sheet (`menu-overlay-manager.js:151`, called `:203`/`:310`); there is no close message. After a main-initiated close (`tab-switch`/`tab-hide`/`tab-close`/`superseded`/`teardown`, all of which close even a `dismissible:false` card, `:334-338`), the secret's `textContent` stays live in the sheet DOM — the renderer's own comment names the case (`menu-overlay.js:2312-2315`, *"re-open of a persisted DOM after a main-initiated close"*). Then `openMenu` sets `currentMenu` and `show()` **synchronously** (`:298-302`) and only then `deliverInit` (`:310`); the scrub `menuController.closeAll()` runs after that IPC hop (`menu-overlay.js:2317`). In between, `sheetMenuFor(wc)` reports an admitted menuType while the DOM holds the prior secret. **This window is unobservable by any verification this flight has** — orders of magnitude narrower than human timing, so both AC8's Grep-AC and the operator's live check would pass while the premise was false. DD1f makes the premise true by construction instead of true by timing.

### Guard order in `resolveContents` (`resolve.js:108-165`)

| # | Guard | Line | Lifted by `allowInternal`? |
|---|---|---|---|
| 1 | `bad-handle` | `:109-111` | no |
| 2 | `no-such-contents` | `:115-117` | no |
| 3 | **`secret-sheet`** | `:125-127` | **no — absolute today; this leg makes it conditional** |
| 4 | `internal-session` | `:138-140` | yes |
| 5 | `non-tab-contents` | `:154-162` | yes |

## Inputs

- Flight `in-flight`; branch `flight/03-drag-interactions` from `main` at `5aa4932`. Working tree clean apart from untracked flight-3 artifacts. Suite baseline **3356 pass / 0 fail**.
- `resolveContents` refuses the sheet unconditionally (`resolve.js:125-127`); its destructure is at `:108`.
- `deps()` (`engine.js:110-151`) takes **no arguments and no wcId**; `base` at `:144`; `activate` on `base` at `:149`; admitted dispatch entries at `:195` (`captureScreenshot`), `:221` (`readDom`), `:222` (`readAxTree`).
- `menu-overlay-manager.js`: `deliverInit` `:151`, `openMenu` ordering `:298-310`, `closeMenuOverlay` `:334-338`, `getCurrentMenu()` `:383`, `isVisible()` `:380`, `show()` `:235`.
- `window-registry.js`'s `isSheetContents(wc)` walks `records()` with `typeof rec.sheet.getView === 'function'` guards (`:219-227`), exported `:242`, wired `main.js:958`.
- **Two** `createEngine` sites: `main.js:934` (MCP) and `app-lifecycle.js:208` (the `automation:dev-invoke` seam). The dev seam threads `isTabViewWcId`/`isChromeContents`/`chromeForTab` but **not** `isSheetContents`. Dual-site grep-pin precedent: `engine.js:55-68`, echoed `main.js:938-942`.
- `main.js:598-615` composites the visible sheet into `captureWindow`'s layers (`:598` computes `sheetView` from `grabRec`), post-await detach re-check `:603-607`. `grabWindow` is `main.js:455`. **No test in the repo loads `src/main/main.js`** — `test/helpers/source-scan.js:53,60` acknowledges it is reachable only by source scan.
- `scope.js` exports `WCID_FIRST_OPS` (`:49-70`, 23 entries; `module.exports` `:244`); `automation-scope.test.js:211` already cross-checks it against `mcp-tools.js`'s registry.
- Pre-resolve arg validators: `nav.navigate:53-55`, `zoom.setZoom:68-70`, `input.pressKey:396` (via `keyEvents` throwing at `:95`, `normalizeModifier` `:55`), `input.dragPointer:317-321` (via `dragEvents:172-190` dereferencing `from.x`/`to.x`).
- Throw shape is **mixed**: `goBack`/`goForward`/`reload` (`nav.js:77,97,115`), `getZoom`/`setZoom`, `sendInput` throw **synchronously**; `closeTab`, `activateTab`, the `input` and `observe` ops reject.
- `test/helpers/source-scan.js` exports `maskComments` and `findMatchingBracket`; `test/unit/latch-ordering-invariant.test.js:23` is the precedent for "assert X sits inside Y's body". `automation-engine.test.js:16-32` is the `Module._cache` electron-double pattern (note `const Module = require('module')` at `:16`).
- `menu-overlay.js`: `onInit` `:2302-2320`, `downloads` early return `:2306-2309`, `report.silence()` `:2316`, `closeAll()` `:2317`, scrubs `:1224`/`:1423`/`:1484`, `vaultInput.value = ''` at **both** `:618` and `:668`.
- Pins to re-target: `automation-resolve.test.js:110-130`, `:546-555`.

## Outputs

- `resolve.js` gates the sheet on `(menuType ∈ allowlist) AND (op ∈ {readDom, readAxTree, captureScreenshot})`, fail-closed.
- `window-registry.js` exposes `sheetMenuFor(wc)`; wired into **both** engine construction sites.
- `engine.js` threads `sheetMenuFor` as a live reader; three dispatch entries opt into `allowSheet`.
- All three admitted ops snapshot after their first resolve and re-check after their async work.
- `closeMenuOverlay` eagerly scrubs the sheet's DOM (DD1f).
- `captureWindow`'s sheet layer gated on the same predicate, its post-await check extended to menuType.
- `CLAUDE.md`, `docs/vault.md`, `docs/mcp-automation.md` updated.

## Acceptance Criteria

- [x] **AC1** — `resolveContents` admits the sheet **only** when `allowSheet === true` **and** the sheet's current menuType is in `AUTOMATABLE_MENU_TYPES` (seeded `bookmarks-overflow`, `bookmark-edit`). The predicate is fail-closed in shape: `allowSheet === true && typeof sheetMenuFor === 'function' && AUTOMATABLE_MENU_TYPES.has(sheetMenuFor(wc)?.menuType)` — an absent injection refuses rather than throwing a `TypeError` from inside a live guard. `sheetMenuFor` is added to the `:108` destructure; `AUTOMATABLE_MENU_TYPES` is **exported** so tests import it rather than retyping strings.
- [x] **AC2** — A `null` current menu refuses at every tier regardless of `allowSheet`. `sheetMenuFor` returns `null` when the record's sheet is not `isVisible()`, and guards `typeof rec.sheet.isVisible === 'function'` / `typeof rec.sheet.getCurrentMenu === 'function'` the same way `isSheetContents` guards `getView` (`:222-224`) — a record shape lacking them must refuse, never throw.
- [x] **AC3** — Exactly three dispatch entries pass `allowSheet`. A sweep drives **every** member of `WCID_FIRST_OPS` (imported from `scope.js`, not retyped) against a sheet wcId and asserts each non-admitted op throws `secret-sheet`. It uses a per-op valid-args table and **fails loudly when an op is absent from that table**, so an op added after this leg is caught — the criterion's whole purpose. Ops validating args before resolving must get valid args: `navigate`, `setZoom`, **`pressKey`**, **`dragPointer`**. Mixed throw shapes are normalized — `await assert.rejects(Promise.resolve().then(() => engine[op](...)))` — so synchronous throwers are not silently passed over.
- [x] **AC4** — Jar-tier refusal asserted **at the layer it occurs**: through `scopeEngine`'s façade a sheet wcId throws `out-of-jar`; against the jar-tier **engine** directly, **`readDom`** (an *admitted* op — a non-admitted op would throw `secret-sheet` at guard 3 and pass for the wrong reason) throws `non-tab-contents`. Neither described as the other.
- [x] **AC5** — **All three** admitted ops snapshot `sheetMenuFor(wc)` immediately after their **first** `resolveContents` and re-check after their async work, discarding and throwing on mismatch. This includes **`readDom`**: its `wc.executeJavaScript` is a full main→renderer round trip, and what returns is whatever the renderer had rendered when the snippet ran — not what main believed at `:220`. The snapshot is `sheetMenuFor(wc)`, **not** "the window's current menu": a `null → null` comparison must not throw, or every ordinary-tab `captureScreenshot` would fail whenever a menu opened during the paint wait. Comparing `token` as well as `menuType` means a close-and-reopen of the *same* allowlisted menu also throws — deliberate, the safe direction, stated in the comment so it is not later "fixed". The re-check applies unconditionally, including on `readAxTree`'s `{ automation: 'debugger-unavailable' }` early return (`cdp.js:65`/`:71` return without attaching, so nothing was read; re-checking is harmless and simpler than a special case).
- [x] **AC6 (DD1f)** — `closeMenuOverlay` sends the sheet a close/reset message that runs `report.silence()` then `menuController.closeAll()`. After any close — including every main-initiated one — the sheet's DOM retains no prior menu's content. A test pins that the close path emits the message. `<body>` data attributes are **not** cleared (DD8's probe readback depends on them surviving). **Extended beyond the letter of the AC** (see flight log): `openMenu`'s model-replace branch also emits the scrub when the menuType **changes**, because that branch is a close (it emits channel 7 + `onClosed` with `reason:'superseded'`) that never routes through `closeMenuOverlay` — leaving it out would make "after any close, including every main-initiated one" false for the `superseded` case the AC's own Context enumerates. Gated on a menuType change so the same-menuType repaint path (downloads in-place update, suggestions) is byte-unchanged.
- [x] **AC7** — `captureWindow` omits the sheet layer when the current menuType is not admitted, and its **post-await check re-evaluates `sheetMenuFor(sheetView.webContents)?.menuType` alongside `isVisible()`** — a capture that starts under `bookmarks-overflow` and is model-replaced by `vault-unlock` mid-capture must not composite the vault pixels. The gate sits **after** `:598` (where `sheetView` is computed), not in place of it. Verified by **source scan**, not a unit test — no test in this repo loads `main.js` — plus the operator session's live `vault-unlock` check.
- [x] **AC8 (DD1e)** — The co-residency premise is pinned by a source-scan test using `maskComments` + `findMatchingBracket` from `test/helpers/source-scan.js` (precedent `latch-ordering-invariant.test.js:23`): (a) each of `recovery.keyValue.textContent = ''` (`:1224`), `accessKey.secretValue.textContent = ''` (`:1423`), `adminKey.keyValue.textContent = ''` (`:1484`) falls inside an `onClose() {` body; (b) `onInit`'s early-return set is **enumerated and pinned**, so a *new* pre-`closeAll` return fails the test. Note the existing `downloads` fast path already returns before the scrub (`:2306-2309`) — benign today (downloads→downloads, same template), which is exactly why an ordinal "closeAll precedes render" scan would codify an invariant the file already sidesteps. The pin is menuType-independent by construction; the live check in the operator session covers **both** admitted menuTypes.
- [x] **AC9** — `sheetMenuFor` is wired at **both** engine construction sites, grep-pinned per the house dual-site convention (`engine.js:55-68` precedent). A comment at `app-lifecycle.js:208` records that adding `isSheetContents` there *without* `sheetMenuFor` would be the fail-open edit. **Deviation — the comment states the corrected direction** (see flight log): `isSheetContents`-without-`sheetMenuFor` is fail-**closed** (guard 3 would refuse the sheet absolutely there, since the predicate requires the reader), not fail-open. The real fail-open edit at that seam is adding `allowInternal: true` (or dropping `isTabViewWcId`) while `isSheetContents` is still absent, which lifts guard 5 with nothing for guard 3 to fire on. The comment records both, and the leg's own rule — never write a false claim into a security comment — is why it was not transcribed verbatim.
- [x] **AC10** — Documentation updated in three files:
  - `CLAUDE.md` — the standing unobservable-surfaces list (sheet now *readable but not scriptable*, toast layer still wholly unobservable); the automation section stating the gate as (menuType × op), the allowlist, default-refuse, `null` refusal, the post-await re-check, and DD1f's eager scrub.
  - `docs/vault.md:347-355` — currently asserts the sheet *"is refused by the automation resolver at **every tier, admin included**"* and lists `readDom`/`readAxTree` among ops that can never resolve it. Both clauses become false. Its parenthetical accepting whole-window pixel capture as *"the accepted limit … not a covert channel"* is **reversed by DD1c** and must be rewritten as closed, not accepted.
  - `docs/mcp-automation.md:325-345` — repeats the absolute in the admin-relaxations list and the overlay-views bullet.
- [x] **AC11** — `npm test`, `npm run typecheck`, `npm run lint` green. Suite count recorded in the flight log against the **3356** baseline.
- [x] **AC12** — Pins asserting the old absoluteness (`automation-resolve.test.js:110-130`, `:546-555`) are **re-targeted and renamed, not deleted**, per the standing rename-not-delete rule.

## Verification Steps

- AC1–AC6, AC12 — `node --test test/unit/automation-resolve.test.js` and the new `WCID_FIRST_OPS` sweep
- AC7, AC8, AC9 — the source-scan tests; AC7's behavioural half in the operator session
- AC10 — read the diffs
- AC11 — `npm test`, `npm run typecheck`, `npm run lint`

## Implementation Guidance

1. **`sheetMenuFor(wc)` in `window-registry.js`** — beside `isSheetContents` (`:219-227`), same `records()` walk, same defensive `typeof` guards. Return `rec.sheet.getCurrentMenu()` for the matching record **only when `rec.sheet.isVisible()`**, else `null`. Export at `:242`. Returning `null` when hidden also disposes structurally of the never-settles `capturePage()` hazard (`observe.js:145-150`) and makes the resolver gate and `main.js:598`'s check literally the same predicate.

2. **Wire at BOTH engine sites** — `main.js:934` and `app-lifecycle.js:208`. Add `sheetMenuFor` to `createEngine`'s options bag (`engine.js:100`) and conditional-spread onto `base` (`:144`), the idiom `isSheetContents` uses. Grep-pin both (AC9).

3. **`allowSheet` opt-in** — give `deps()` an optional options argument, spread `allowSheet` onto `base`, and change exactly three entries to `deps({ allowSheet: true })` (`:195`, `:221`, `:222`). **Chosen over `deps(opName)` deliberately** — that is fail-open (a forgotten argument yields `undefined`) and ~28 edits. Do not substitute. `activate` inherits `allowSheet` from `base` (`:149`); verified benign at both live engine sites, since both thread `chromeForTab` and `tabs.js:253-262` returns `false` with no raise.

4. **Gate guard 3** (`resolve.js:125-127`) per AC1. Keep the thrown message `automation: secret-sheet`. Add the two comments this leg's Context specifies (fixed-snippet-vs-caller-code; the **corrected** jar-tier note).

5. **Snapshot inside the ops, not in `deps()`** — `deps()` has no wcId and `sheetMenuFor` is per-record; a deps-time snapshot would compare window A's menu against window B's sheet. Snapshot after each op's first resolve, where `wc` is in hand: `observe.js:137` (captureScreenshot), `:220` (readDom), `:312` (readAxTree).

6. **Post-await re-check** — `captureScreenshot` after `withCaptureTimeout` resolves; `readDom` after its `executeJavaScript` resolves; `readAxTree` **after `withDebuggerSession` returns** (do not re-resolve between its entry and internal detach — `:323-324` guards that; `wc` is still in scope).

7. **DD1f eager scrub** — add a main→sheet close/reset channel; `closeMenuOverlay` sends it; the sheet's handler runs `report.silence()` then `menuController.closeAll()`. Do not touch `<body>` attributes.

8. **`captureWindow`'s layer** (`main.js:598-615`) per AC7 — extend the existing `:603-607` check, do not replace it.

9. **AC3's sweep** — import `WCID_FIRST_OPS`; install the `Module._cache` electron double as `automation-engine.test.js:16-32` does; per-op valid-args table asserted to cover `WCID_FIRST_OPS` exactly.

10. **Docs** — AC10.

## Edge Cases

- **`getCurrentMenu()` null, or sheet hidden** — refuse; a property of the predicate, not a call-ordering obligation.
- **Sheet destroyed between snapshot and re-check** — `isSheetContents` skips destroyed wcs (`:224`); guard 2 throws `no-such-contents`.
- **Two windows, sheets in different states** — each judged on its own menu; `sheetMenuFor(wc)` resolves per-record against the resolved `wc`. This is the case a deps-time snapshot could not satisfy.
- **Transient `currentMenu != null && !visible`** — only the cross-window replace at `menu-overlay-manager.js:288-290`, closed synchronously by `show()`. No false refusals.
- **A future menuType added without touching the allowlist** — refused (AC1). **A future op added without touching the dispatch entries** — refused (AC3).
- **`sheetMenuFor` not threaded** (offline tests, legacy callers) — predicate fails closed; guard 3 refuses exactly as today.

## Files Affected

- `src/main/window-registry.js`, `src/main/main.js`, `src/main/app-lifecycle.js`
- `src/main/automation/engine.js`, `resolve.js`, `observe.js`
- `src/main/menu-overlay-manager.js`, `src/renderer/menu-overlay.js`, `src/preload/menu-overlay-preload.js` (DD1f channel)
- `test/unit/automation-resolve.test.js`; new: `WCID_FIRST_OPS` sweep, `menu-overlay` scrub Grep-AC, `captureWindow` layer scan, DD1f channel pin
- `CLAUDE.md`, `docs/vault.md`, `docs/mcp-automation.md`

## Deferred to an operator session (NOT an acceptance criterion)

The **DD8 axis-(b) probe** requires a physical operator gesture. The Flight Director runs it after this leg's code lands, using in-source instrumentation writing counters to `<body>` data attributes, read back with `readDom`. Probe code removed before the flight commits. **Its verdict gates `bar-overflow-drag`, not this leg.**

⚠ **The readback is self-gating.** `readDom` on the sheet is admitted only while `sheetMenuFor` is non-null and allowlisted — and a drag ending over the sheet will very likely close the menu (`outside-click`/`blur`/`activated` all route through `closeMenuOverlay`, nulling `currentMenu` at `:337`). The counters survive on `<body>` (DD1f explicitly does not clear them), so **the operator must re-open the overflow menu before the read.**

Same session: DD1e's live co-residency check across **both** admitted menuTypes; the `vaultInput.value` residue checks at **both** `menu-overlay.js:618` and `:668`; AC7's live `vault-unlock` confirmation.

## Notes for the implementer

`readAxTree` calls `Accessibility.enable` with no matching `disable` (`observe.js:326-328`), so accessibility mode persists on the shared, never-reloaded document across menu boundaries. Not a leak, and outside DD1a's retired residency rule — but it *is* residual state left by an admitted op on the surface DD1a is about. Name it in the code comment so a future reviewer does not have to rediscover it.

## Citation Audit

Verified against `5aa4932`. The first audit claimed zero drift and was wrong (six drifted line numbers, one wrong directory); cycle 2 found one further regression, corrected here.

| Citation | Status |
|---|---|
| `resolve.js:108`, `:109-165`, `:125-127`, `:56-60`, `:223-226` | verified |
| `engine.js:100`, `:110-151`, `:144`, `:149`, `:195`/`:221`/`:222`, `:55-68` | verified |
| `observe.js:137`, `:145-150`, `:160-164`, `:220-221`, `:309-330`, `:312`, `:323-324`, `:326-328` | verified |
| `window-registry.js:219-227`, `:222-224`, `:242` | verified |
| `menu-overlay-manager.js:151`, `:161-179`, `:203`, `:235`, `:244-249`, `:288-290`, `:298-310`, `:334-338`, `:337`, `:380`, `:383`, `:61-63` | verified |
| **`main.js:598-615`** *(cycle-2 correction: previous audit said `:598-616`; `:616` is blank)*, `:455`, `:603-607`, `:934`, `:938-942`, `:953`, `:958` | corrected |
| `app-lifecycle.js:208` | verified |
| `scope.js:49-70`, `:138-145`, `:154-158`, `:244` | verified |
| `menu-overlay.js:618`, **`:668`** *(second vault-input clear, added)*, `:1224`, `:1423`, `:1484`, `:2302-2320`, `:2306-2309`, `:2312-2317` | corrected |
| `nav.js:53-55`, `:77`, `:97`, `:115`; `zoom.js:68-70`; **`input.js:396`, `:317-321`, `:172-190`, `:95`, `:55`** *(added — pressKey/dragPointer pre-resolve validators)*; `tabs.js:253-262`; `cdp.js:65`, `:71` | corrected |
| `test/helpers/source-scan.js:53`, `:60`, `maskComments`/`findMatchingBracket`; `latch-ordering-invariant.test.js:23`; `automation-engine.test.js:16-32`; `automation-scope.test.js:211`; `automation-resolve.test.js:110-130`, `:546-555` | verified |
| `docs/vault.md:347-355`; `docs/mcp-automation.md:325-345`, `:335` | verified |

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] **Do NOT commit** — this flight batches review and commit after the last autonomous leg
