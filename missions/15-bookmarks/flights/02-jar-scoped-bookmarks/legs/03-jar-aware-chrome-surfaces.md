# Leg: jar-aware-chrome-surfaces

**Status**: completed
**Flight**: [Jar-Scoped Bookmarks](../flight.md)

## Objective

Make every chrome bookmark surface jar-aware against leg 2's jar-addressed main side: per-jar cache with eviction, star/bar/overflow/omnibox/favicon-writer/open-in-new-tab all jar-resolved, tab activation as a new bar-render trigger, burner and internal suppression, popover jar capture at open, the preload/d.ts signature updates, the two DD12 carry-forward fixes, and the behavior-spec amendments.

## Context

- Implements flight DD6 (cache), DD7 (activation-class triggers), DD7b (write paths), DD8's chrome side (suppression; the main-side guard shipped in leg 2), DD12 (carry-forward fixes), DD13 (jar capture at open).
- Leg 2 ground truth: all six IPC channels now require/carry `jarId`; `bookmarks-changed` carries `{ jarId }`; mutations against unknown jars return `{ ok:false, reason:'unknown-jar' }`. The chrome currently calls the old shapes — this leg closes that gap and restores a runnable app.
- Leg 1 ground truth: `renderer.js` measures 1527 against budget 1650 — ~123 lines of headroom for this leg's wiring.
- **Leg 3 must re-confirm the five sync paths by grep before implementing** (flight DD7 instruction). As of this design: `renderer.js` navigation paths in `onTabDidNavigate`/`onTabDidNavigateInPage` (star only); `tab-controller.js:332` (wcId arrival) and `:699` (`activateTab` body) — the two activation paths that gain bar work; `renderer.js:112-115` (post-refresh `onChanged` closure — star + bar). Boot render at `renderer.js:519`.

### Leg design decisions

**L3-DD-A — Cache shape**: `bookmarks-client.js` holds `Map<jarId, list>`. `findByUrl(jarId, url)` and `listFor(jarId)` are synchronous over the map (empty array/null on a miss — the DD6 first-sight flash, accepted). `ensureJar(jarId)` triggers an async `bookmarksGet({ jarId })` refresh **once per unseen jar** (in-flight de-dup) and is called from the read paths (star refresh, bar render); its completion fires the same `onChanged(jarId)` signal a broadcast refresh fires, so the repaint is uniform. `onBookmarksChanged({ jarId })` re-queries **only if that jar is in the map** (nothing cached → nothing stale). `onJarsChanged(payload)` evicts map keys absent from the new containers list (the recyclable-id defense, DD6) — an independent subscription beside `jars-client.js`'s, reading the payload's containers directly. Burner/internal ids never enter the map (no read path ever queries them — suppression comes first).

**L3-DD-B — Boot barrier semantics shift, documented not removed**: `bookmarksClient.boot` stays joined in the renderer boot `Promise.all` for contract stability, but becomes a warm-start prefetch of the **default jar's** list (the most likely first-active jar) rather than an everything-fetch. **Sequencing, made explicit (design-review finding, HIGH)**: the default jar id is unknowable at `bookmarksClient` construction — `jarsClient.state.defaultId` is `undefined` until `jarsClient.boot` resolves and can legitimately be `null` (Burner holds the flag). So `bookmarksClient` gains a `jarsBoot`/`getDefaultJarId` dependency pair (late-bound closures, the established injection idiom) and its boot is `jarsBoot.then(() => { const id = getDefaultJarId(); return id != null ? ensureJar(id) : undefined; })` — an explicit no-op for both `null` (burner default) and `undefined` (unresolved). The Flight 1 "first tab's star renders only after the cache is populated" guarantee narrows to first-sight-of-each-jar (DD6's honest bound) — restated in the code comment at the barrier.

**L3-DD-A2 — Late-resolving `ensureJar` fetches validate before storing** *(design-review question, ruled)*: a fetch for a jar that was evicted while the fetch was in flight must **drop** its result, not store it — a stale list stored under a dead id is exactly the recycled-id hazard DD6's eviction exists to prevent (recreate the jar, cache serves the dead jar's rows). On resolve, the client re-checks the jar against the same injected jar-list closure the eviction path uses; absent → drop, and clear the in-flight marker so a *future* legitimate `ensureJar` (recycled id) refetches fresh.

**L3-DD-C — Suppression is derived in one place**: `window-controller.js` owns the bar's `.hidden` class and the explicit `sendActiveBounds()` (`:92-108`). It gains a second input: `setBarSuppressed(bool)`; visibility = `bookmarksBarEnabled && !suppressed`, with the DOM toggle + bounds send firing **only on a net visibility change** (no spurious guest reflows on same-class tab switches). The activation paths call a single renderer.js closure `refreshBookmarksSurfaces(tab)` — computes `suppressed = !!(tab.container.burner || tab.container.id === 'internal')`, forwards to `setBarSuppressed`, and (when visible) renders the bar for `tab.container.id`. Star suppression for burner rides `refreshStar`'s existing hide branch (`navigation-controller.js:360-364` gains the burner condition beside `isInternalTab`).

**L3-DD-D — All three bookmarking entry points stay funneled**: `activateStar` (`bookmarks-client.js`) gains the burner guard beside its internal guard — covering star click, `Ctrl+D`, and page-context in one line (DD8). Additionally the page-context **item itself** is suppressed: `pageContextModel` (`page-context-model.js:130`) gains a `canBookmark` opt (computed chrome-side from the captured tab: exists ∧ ¬internal ∧ ¬burner); when false the item is omitted, not inert.

**L3-DD-E — DD13 jar capture**: `openBookmarkEditOverlay(bookmark, anchorEl, jarId)` captures the owning jar at open (star path: active tab's jar; bar/overflow right-click: the bar's rendered jar — same value by construction, passed explicitly anyway) into module state read at submit; `handleEditSubmit(payload)` threads it into `bookmarkUpdate`/`bookmarkRemove` as `{ jarId, ... }`. A stale captured jar surfaces as `not-found`/`unknown-jar` — loud via L3-DD-F, never a wrong-jar write. **Vector correction (design-review finding)**: a tab *switch* already closes the sheet (`closeMenuOverlay('tab-switch')`, `register-tab-ipc.js:538/:859`), so the live TOCTOU vector is narrower than the flight's DD13 rationale states — **jar deletion from another window or the jars page while the popover stays open**. Capture-at-open remains the discipline regardless (it is cheap and robust to any future non-closing path), but leg 4's HAT step for this scenario must target jar deletion, not a tab switch.

**L3-DD-F — DD12(a), rejection feedback**: `handleEditSubmit` stops fire-and-forgetting. A resolved `{ ok:false }` surfaces operator feedback via `toast(title, body)` — which is a `renderer.js`-local wrapper around `mediaController.toast`, **not** currently reachable from `bookmarks-client.js`: the client's constructor gains a late-bound `toast` dependency threaded from `renderer.js`, the same pattern as `onChanged` (design-review finding). Distinct copy for `duplicate-url` (now rarer and more surprising — per-jar) vs `not-found`/`unknown-jar` (stale reference). Exact wording is implementer's discretion (flight "Acceptable variations"). The `.catch(() => {})` stays for genuine IPC failures.

**L3-DD-G — DD12(b)**: `bookmark-star-icon.js` drops its hardcoded `width="11" height="11"` presentation attributes so CSS sizes the suggestions-row star; verify the suggestions sheet renders it at row height (offline template test if one exists, else visual check deferred to HAT).

**L3-DD-H — DD7b write paths**: the favicon back-fill in `renderer.js`'s `onTabFavicon` resolves the **delivering tab's** jar: `findByUrl(tab.container.id, tab.url)`; on a cache miss for that jar it **skips** (no `ensureJar` — a passive icon refresh must not populate a cache for an unwatched jar); the mutation carries `{ jarId: tab.container.id, id, icon }`. The bar's two open-in-new-tab paths (`bookmarks-bar.js:154` Ctrl/Cmd+click, `:167` auxclick) pass the active tab's container instead of `null` — the bar gains an `activeContainer()` dep; the three-arg `createTab` form remains non-negotiable.

## Inputs

- Legs 1–2 landed (uncommitted); suite at 3322 green; main side fully jar-addressed
- `bookmarks-client.js` (single-list cache, `findByUrl(url)`, `activateStar`, `handleEditSubmit`), `bookmarks-bar.js` (renders `bookmarksClient.list`, `null`-container opens), `navigation-controller.js` (`refreshStar` `:360-370`, suggest gate `:137-145`, `Promise.allSettled` pair `:206-209`), `tab-controller.js` (`:332`, `:699`), `window-controller.js` (`:92-108`), `renderer.js` at 1527, `page-context-model.js:130`, preload `:63-80`, `renderer-globals.d.ts:102-128`

## Outputs

- Chrome fully jar-aware; app runnable end-to-end against the leg 2 main side
- Preload + `renderer-globals.d.ts` jar-addressed
- `tests/behavior/bookmarks-jar-scoping.md` finalized against the implementation (status stays `draft` until first run); `bookmarks-omnibox` checkpoint 4 inverted; `bookmarks-star-sync` checkpoint 9 gains the same-jar clause
- CLAUDE.md bookmarks section completed for the chrome half; `docs/renderer-menu.md` bookmark-sheet drift closed

## Acceptance Criteria

- [x] **Cache** (L3-DD-A/A2/B): per-jar `Map`, synchronous `findByUrl(jarId, url)`/`listFor(jarId)`, once-per-jar `ensureJar` with in-flight de-dup and drop-on-evicted-resolve (L3-DD-A2), jar-filtered broadcast re-query, `jars-changed` eviction of vanished ids, boot chained behind `jarsBoot` as a default-jar prefetch with explicit null/undefined no-op (L3-DD-B), still joined in the boot barrier. Unit-tested: eviction on jar removal, no re-query for uncached jars, in-flight de-dup, the late-resolve-after-eviction drop, and the recycled-id case (delete jar, recreate id, cache serves the fresh empty list — the flight's checkpoint in miniature, live in-session variant). **Annotation**: A2's cold-start case (before the first-ever `jars-changed` broadcast, there is nothing to evict against) fails OPEN by design — a resolve is never dropped before eviction info exists; unit-tested explicitly.
- [x] **Star**: `refreshStar` resolves through the tab's jar and hides on burner tabs (in addition to internal/no-wcId); all five sync paths re-confirmed by grep and annotated where they changed.
- [x] **Bar**: renders the active tab's jar via `listFor`; re-renders on the two activation paths (`tab-controller.js:332`, `:703` — shifted by 4 lines from the design's `:699` citation, pre-implementation drift, confirmed by symbol not line number) through the single `refreshBookmarksSurfaces` closure; broadcast path re-renders only when the changed jar is the active tab's; boot render intact (now a default-jar render, per L3-DD-B). Overflow snapshot/dispatch operate on the rendered jar's list.
- [x] **Suppression** (L3-DD-C/D): burner and internal tabs render no bar (guest reflows instantly — no animation, the layout invariant) and no star; `Ctrl+D` and page-context are inert via the `activateStar` guard; the page-context bookmark item is **absent** (not inert) on burner/internal via `canBookmark`; the settings toggle stays app-wide and composes with suppression (toggle ON + burner active → still hidden; switch to web tab → bar appears). DOM toggle + bounds send fire only on net visibility change.
- [x] **Write paths** (L3-DD-H): favicon back-fill jar-resolved with skip-on-miss; both bar open-in-new-tab paths open in the active tab's jar via `activeContainer()`. Unit coverage where the pure seams allow; the cross-jar favicon isolation and middle-click jar landing behavior-spec steps (8c/8d) were already drafted in `bookmarks-jar-scoping.md` — no drift found against the as-built implementation.
- [x] **Popover** (L3-DD-E/F): jar captured at open (`openBookmarkEditOverlay`'s third arg, threaded from the star/Ctrl+D/page-context path's own tab and from the bar's own rendered jar), threaded to submit via `captureEditJar`/module state; `{ ok:false }` resolutions surface a toast with reason-distinct copy; no fire-and-forget on resolved rejections (`.catch` remains for genuine IPC failures only).
- [x] **Omnibox**: `bookmarksSuggest({ jarId: tab.container.id, query })` beside the existing `historySuggest` jarId (`navigation-controller.js`, the `Promise.allSettled` pair); burner gating unchanged (already structural, `shouldQuery`).
- [x] **DD12(b)** (L3-DD-G): presentation attributes removed from `bookmark-star-icon.js`; no existing unit test asserted `width`/`height` attributes so none needed adjustment (`.sg-badge-star`'s CSS is the icon's only size source now — its stale comment claiming to "override" the attributes was corrected too).
- [x] **Bridge**: `chrome-preload.js` and `renderer-globals.d.ts` carry `jarId` on all six calls and on the `onBookmarksChanged` payload (plus `BookmarkEntry.jarId`, and `unknown-jar` added to every mutation's reason union); typecheck green.
- [x] **Behavior specs**: `bookmarks-jar-scoping.md` reviewed against the as-built implementation — no drift found, status stays `draft`; `bookmarks-omnibox.md` checkpoint 4 inverted (per-jar assertion, superseded-ruling citation removed) — **deviation noted**: steps 5–6 of that spec were written against the old app-scoped suggestion and now target a row jar 2 no longer has; flagged inline in checkpoint 4's own cell for leg 4/HAT to re-target live, per the "checkpoint 4 inversion only" scope limit (touching steps 5/6's own prose was out of bounds here); `bookmarks-star-sync.md` checkpoint 9 states both windows are on the same jar. No other spec prose touched.
- [x] **Docs**: CLAUDE.md bookmarks section fully reflects jar scoping (cache shape, sync paths incl. the activation-class bar triggers, bar, duplicate-url presentation change); Address-bar suggestions section mentions the bookmarks source; `docs/renderer-menu.md` (`menu` template consumer list + the `!entry.items` roving no-op list) gains the two bookmark sheet families (pre-existing drift, flight Completion Checklist).
- [x] `renderer.js` stays ≤ 1650 (seam metric) — lands at **1579**; `npm test`, `npm run typecheck`, `npm run lint` green; suite count recorded (3322 → 3335).
- [x] **Non-blocking flight suggestion adopted here**: a regression test pinning `jars-client.js:24`'s `entry.id === tab.container.id` reference-refresh predicate (DD7's single-line premise).

## Verification Steps

- `node --test` on the touched unit files; full `npm test && npm run typecheck && npm run lint`.
- Grep re-confirmation of the five sync paths recorded in the flight log entry.
- `grep -n "createTab(b.url, null" src/renderer/chrome/bookmarks-bar.js` → no hits.
- `grep -n "bookmarksGet()" src/renderer/ src/preload/ -r` → no hits (all calls jar-addressed).
- Manual dev-launch smoke (`npm run dev:automation` optional here): star + bar function against the new main side — full behavioral verification belongs to leg 4.

## Implementation Guidance

1. **bookmarks-client.js first** (cache + activateStar + handleEditSubmit); its unit tests next to it.
2. **Preload + d.ts** in the same pass (typecheck forces call-site consistency across the rest).
3. **navigation-controller** (star + suggest), **bookmarks-bar** (listFor + activeContainer + open paths), **window-controller** (suppression input), **tab-controller/renderer wiring** (`refreshBookmarksSurfaces`, activation calls, favicon writer, popover capture).
4. **page-context-model** `canBookmark` + its unit tests (pure module — cheap coverage).
5. **DD12 pair**, then **spec prose**, then **docs**.
6. The `onChanged` closure (`renderer.js:112-115`) becomes jar-filtered: re-derive star/bar only when the signal's jar matches the active tab's (or on eviction-driven signals). Keep the single-subscriber rule — `bookmarks-bar.js` must not self-subscribe.
7. Internal-tab detection: reuse the existing injected `isInternalTab` predicates rather than re-deriving `container.id === 'internal'` inline where a predicate is already in scope.

## Edge Cases

- **Active tab closes while its jar's refresh is in flight**: `onChanged(jarId)` for a jar no longer active → skip the repaint (stale-jar filter), don't throw.
- **Jar deleted while its tabs are open**: `jars-client` closes orphan tabs (`jars-client.js:29-37`) and eviction removes the cache entry — the activation of the next tab re-derives cleanly. No ordering dependency between the two subscriptions may exist (eviction must not assume tabs are already closed or vice versa).
- **`bookmarksGet({ jarId })` for a just-deleted jar** returns `[]` (leg 2 reads pass through) — cache stores the empty list; eviction will drop it.
- **Popover open across a jar switch** (the DD13 scenario): mutation goes to the captured jar; if that jar died, toast per L3-DD-F.
- **Suggestions for a tab whose jar has no cache entry**: suggest queries main directly (no cache dependency) — unaffected by cache state.
- **`New tab` boot seed title** fallback in `activateStar` unchanged.
- **Burner flag location**: `tab.container.burner` (see `renderer.js` Tab typedef) — never infer from id prefix.

## Files Affected

- `src/renderer/chrome/bookmarks-client.js` — per-jar cache rewrite, guards, submit threading + feedback
- `src/renderer/chrome/bookmarks-bar.js` — `listFor`, `activeContainer()`, open-path jars
- `src/renderer/chrome/navigation-controller.js` — `refreshStar` jar + burner, `bookmarksSuggest` jarId
- `src/renderer/chrome/window-controller.js` — `setBarSuppressed` composition
- `src/renderer/chrome/tab-controller.js` — activation-path calls (two sites)
- `src/renderer/renderer.js` — `refreshBookmarksSurfaces`, favicon writer, popover capture, onChanged filter
- `src/shared/page-context-model.js` — `canBookmark`
- `src/shared/bookmark-star-icon.js` — attribute removal (locate by grep; cited from flight DD12)
- `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts` — jar-addressed signatures
- `tests/behavior/bookmarks-jar-scoping.md`, `tests/behavior/bookmarks-omnibox.md`, `tests/behavior/bookmarks-star-sync.md` — per AC
- `CLAUDE.md`, `docs/renderer-menu.md` — per AC
- Unit tests: new/updated across bookmarks-client, page-context-model, bookmark-star-icon, jars-client pin, bar tests

## Citation Audit (2026-07-31)

Verified this session against the working tree (post-leg-1/2): `bookmarks-client.js` full read (single-list cache `:26-45`, `activateStar` `:60-67`, `handleEditSubmit` `:79-86`); `bookmarks-bar.js:152-168` (`createTab(b.url, null, …)` twice), `:194` (snapshot from `bookmarksClient.list`); `navigation-controller.js:137-145` (burner/internal suggest gate), `:206-209` (allSettled pair, history jarId present / bookmarks absent), `:360-370` (`refreshStar`); `tab-controller.js:332` + `:699` (activation refreshStar calls), `:773-779` (internal detection), `:968` (enumeration jarId), `:972-977` (openTab refusal); `window-controller.js:92-108` (bar class + settings subscription); `renderer.js:112-115` (onChanged closure), `:504-519` (bar construction + boot render), `:568-571` (openBookmarkEditOverlay), `:580-582` (handleBookmarkStarActivate); `page-context-model.js:130` (unconditional item); preload `:63-80`; `renderer-globals.d.ts:102-128`; `jars-client.js:24` (reference refresh), `:29-37` (orphan close), `:53` (onJarsChanged). Note: renderer.js favicon-writer and boot-barrier line numbers shifted with leg 1's extraction — locate by symbol (`onTabFavicon`, the `Promise.all` boot gate), not by the flight spec's pre-extraction line numbers.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header) — flight-end review advances it to `completed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit — flight-end review and commit happen after the last autonomous leg
