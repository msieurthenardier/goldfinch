# Leg: cutover

**Status**: completed
**Flight**: [Floating Overlay Find Bar](../flight.md)

## Objective

Make the overlay the sole find UI: re-point the renderer's find surface (`openFind`/`closeFind`,
per-tab restore, navigation close) at the overlay via new chrome-preload bridge methods, retire the
chrome `#find-bar` (markup + CSS + listeners + count subscription), remove the find inset so the guest
stays full-size (DD8), delete the dev gate so Ctrl+F drives the overlay unconditionally, and update
the affected docs, specs, and the a11y audit.

## Context

- **DD6**: the Ctrl+F branch keeps `send('open-find')` but drops `getChromeContents()?.focus()` —
  main focuses the overlay in `openFindOverlaySession` (Leg 2); the chrome-focus line now actively
  fights that. Post-Leg-2 the branch is dev-gated (`main.js:774-786` region); this leg deletes the
  gate AND the focus line, leaving `event.preventDefault(); getChromeContents()?.send('open-find');`.
- **DD8**: find was the only inset contributor (confirmed at flight review). Delete
  `computeTopInsetDIP` (`renderer.js:992-1005`) and `measureWebviewsSlotWithInsetDIP`
  (`renderer.js:1013-1022`); the four call sites (`renderer.js:789`, `:856`, `:1039`, `:1085`) call
  `measureWebviewsSlotDIP()` directly. Update the stale comments at each site (`:841-842`,
  `:853-855`, `:1033-1037`, and `openFind`'s `:2106-2108`).
- **DD9 + two sync channels the flight design implies but never named** (recorded as a design
  addition): per-tab `findText`/`findOpen` stay renderer-owned, but after cutover the *typing* happens
  in the overlay and *Esc/✕* happen overlay-side — without a feedback path the renderer's per-tab
  state goes stale (switch-back would restore the WRONG text, and an overlay-Esc'd tab would ghost-
  reopen on switch-back). Two main→chrome messages close the loop:
  - `find-overlay-text` `{ wcId, text }` — sent from the `find-overlay:query` handler; renderer
    updates `tab.findText`.
  - `find-overlay-closed` `{ wcId }` — sent when the close **originated overlay-side** (user Esc/✕
    in the bar); renderer clears `tab.findOpen`. Implicit closes must NOT send it: tab-switch keeps
    `findOpen` true so switch-back restores (the whole point of per-tab state). Chrome-initiated
    closes (nav-close) don't need it either — the renderer already knows (no echo).
- **Close refocus is decided by SENDER, not payload** (design decision, review-driven): the
  `find-overlay:close` handler passes `refocusGuest: true` when `event.sender` is the overlay (the
  user explicitly closed the bar → focus returns to the page) and `refocusGuest: false` when the
  sender is the chrome (the only chrome-side caller is the programmatic navigation-close — a
  page-initiated redirect with find open must NOT yank OS focus into the guest, e.g. mid-typing in
  the address bar). No payload flag → nothing to spoof; today's nav-close moves no focus and that is
  preserved.
- **DD11**: retire `#find-bar` — markup `index.html:132-148` (including the 132-134 comment block),
  CSS `styles.css:552-608` (**starting at the `/* ---------- Find bar ---------- */` header at
  `:552`, not the `#find-bar {` selector at `:556` — the head boundary is the blank line `:551`
  after the preceding rule's `}` at `:550`), the `els.find*` declarations (`renderer.js:72-77`),
  **`runFind` + its doc comment + the `find in page` section banner (`renderer.js:2075-2093`,
  orphaned once all three callers go)**, the find-bar listener block (`renderer.js:2141-2185`), the
  chrome count subscription (`renderer.js:2793-2800`), and **`closeFind` itself
  (`renderer.js:2121-2138`) — zero callers post-cutover** (its Esc/✕/audit invokers are all removed;
  the nav-close path inlines its two lines instead). `openFind` STAYS (two live callers: keydown
  `'find'`, `onOpenFind`).
- **`tab-found-in-page` retirement**: its ONLY consumer was the chrome count display (grep-verified:
  `chrome-preload.js:140` + `renderer.js:2793`; the MCP find ops were re-homed to main-process
  `requestId` correlation in Flight 4). Remove the `sendToChrome('tab-found-in-page', …)` line
  (`main.js:882`), the preload method, the d.ts entry (`renderer-globals.d.ts:152`), and the renderer
  subscription. The `found-in-page` listener itself STAYS (overlay count branch + the F4 automation
  path). Update the stale route comment at `src/main/automation/find.js:13`.
- **`tabFind` channel survives** with exactly one renderer use: the navigation-close path stops a
  navigated tab's stale highlight (`renderer.js:2711`) — works for background tabs the overlay
  session never targeted.
- **a11y audit (DD12 wrinkle, decided here):** `scripts/a11y-audit.mjs` state 5 opens the chrome
  find bar and axe-scans it (`:288-295`), and state 6 closes it (`:306-307`). After cutover the find
  UI lives in the overlay webContents, which is **not MCP-addressable by construction** (never in
  `tabViews`; `getChromeTarget` returns only the chrome) — axe cannot be injected into it through
  this apparatus. Decision: REMOVE the find-bar state from the audit (and state 6's `closeFind`
  cleanup) with a rationale comment; overlay a11y conformance rests on the DD12 verbatim attribute
  carry-over (Leg 1) + the HAT keyboard/focus pass (Leg 4). This honors DD12's intent (the gate
  stays green and meaningful on the chrome) while recording that its letter ("a11y runs on the new
  surface") is not apparatus-reachable for the overlay document itself.
- **Doc/spec strays the retirement touches** (review-surfaced): `docs/mcp-automation.md:351` — the
  `stopFindInPage` row's "Does not affect the renderer-side find bar UI" ("renderer-side" is false
  post-cutover); `tests/behavior/find-in-page.md:59-62` — Out-of-Scope claims the visual bar is
  "verified by … the `npm run a11y` gate", false once the audit drops the find state (new answer:
  HAT + DD12 attribute carry-over). `tests/behavior/spellcheck.md:108` mentions "The find-bar"
  generically — optional touch, at implementer discretion.
- **Specs (DD10)**: `tests/behavior/tab-surface-geometry.md` steps 7-8 assert the inset contract and
  step 7 additionally asserts the find input via `readAxTree(chromeWcId)` — the input is no longer in
  the chrome AX tree. Flip both steps to float-not-inset with the guest-bounds tell as the primary
  observable; re-scope the AX sub-assert. `tests/behavior/find-in-page.md` needs only its
  Out-of-Scope wording refreshed (the visual bar is now an overlay view, not renderer-rendered).
  `tests/behavior/find-overlay-geometry.md` (authored at flight planning) gets a consistency pass
  against as-built behavior — update only if it contradicts reality; note anything changed.
- Leg-2 seams consumed: `openFindOverlaySession`/`closeFindOverlaySession` (`main.js:290/326`), the
  three `find-overlay:*` handlers (`main.js:1785-1810` region), the explicit-close refocus contract.

## Inputs

- Legs 1-2 landed (uncommitted): overlay + session + routing all live behind the dev gate.
- `src/main/main.js` — Ctrl+F branch (`:774-786`, dev-gated), `FIND_OVERLAY_DEV` (`:168`),
  `found-in-page` chrome fan-out (`:882`), query handler (`:1804-1810`), close session (`:326-336`).
- `src/renderer/renderer.js` — `els.find*` (`:72-77`), activateTab restore (`:838-856` + the
  `.then()` site `:789`), inset helpers (`:992-1022`), `sendActiveBounds` (`:1039`), `unfreezeGuest`
  (`:1085`), `openFind`/`closeFind` (`:2099-2138`), listener block (`:2141-2185`), keydown `'find'`
  (`:2571-2577`), navigation close (`:2709-2718`), count subscription (`:2793-2800`).
- `src/preload/chrome-preload.js:140` `onTabFoundInPage`; `src/renderer/renderer-globals.d.ts`
  (`:111` `onOpenFind`, `:136` `tabFind`, `:152` `onTabFoundInPage`).
- `src/renderer/index.html:132-148`; `src/renderer/styles.css:556-608`.
- `scripts/a11y-audit.mjs:288-307` (find-bar state + state-6 closeFind).
- `tests/behavior/tab-surface-geometry.md` (title, intent, `:47`, steps 7-8 `:72-73`, `:83`);
  `tests/behavior/find-in-page.md:57-67` Out of Scope; `tests/behavior/find-overlay-geometry.md`.
- `CLAUDE.md` — find-bar architecture references (at minimum the a11y state list in the `npm run
  a11y` bullet and any find-bar-as-chrome-DOM description; locate by grep, update by intent).

## Outputs

- Modified: `src/main/main.js`, `src/renderer/renderer.js`, `src/preload/chrome-preload.js`,
  `src/renderer/renderer-globals.d.ts`, `src/renderer/index.html`, `src/renderer/styles.css`,
  `scripts/a11y-audit.mjs`, `CLAUDE.md`, `tests/behavior/tab-surface-geometry.md`,
  `tests/behavior/find-in-page.md` (+ `find-overlay-geometry.md` only if drifted).
- Behavior: Ctrl+F (guest- or chrome-focused) opens the floating overlay find bar — no env var, no
  inset, no chrome bar. Per-tab find restore works across tab switches with live-typed text. Esc/✕
  close returns focus to the page. Internal tabs never show find. Guest bounds never shrink for find.

## Acceptance Criteria

- [x] **AC1 — Renderer re-point complete.** `openFind` keeps its guards (internal / no-wcId /
  lightbox) then sets `findOpen` + calls `findOverlayOpen({ wcId, findText })`; the keydown `'find'`
  case and `onOpenFind` path work unchanged through the re-pointed `openFind`. `closeFind` and
  `runFind` are DELETED (zero callers post-cutover; nav-close inlines). Zero `els.findBar/findInput/
  findCount/findPrev/findNext/findClose` references remain in `renderer.js` (grep zero), and
  `tabFind` has exactly one renderer use (the nav-close background-tab stop).
- [x] **AC2 — Per-tab restore + state sync.** `activateTab` restore is re-pointed AND re-ordered:
  `tabSetActive` is sent FIRST, then (web tab with `findOpen`) `findOverlayOpen({ wcId, findText })`
  — the restore must land AFTER main's switch-close or the fresh open is killed (IPC order per
  sender is guaranteed; same-channel-object ordering is the invariant). Typing in the overlay
  round-trips: main forwards `find-overlay-text` on every query; renderer updates `tab.findText`;
  switch A→B→A restores A's live-typed text. Overlay-side Esc/✕ sends `find-overlay-closed`
  (explicit path ONLY); renderer clears `tab.findOpen`; switch-back does NOT ghost-reopen.
- [x] **AC3 — Chrome bar retired (DD11).** `#find-bar` markup gone from `index.html`; its CSS gone
  from `styles.css` — the full `552-608` section INCLUDING the `/* ---------- Find bar ---------- */`
  header (no orphaned header, no dangling tail; the Media panel header at the section's end stays
  intact); the `els.find*` declarations, `runFind`, `closeFind`, and the find-bar listener block gone
  from `renderer.js`.
- [x] **AC4 — Inset removed (DD8).** `computeTopInsetDIP` and `measureWebviewsSlotWithInsetDIP`
  deleted; all four call sites use `measureWebviewsSlotDIP()`; stale comments updated; with find open
  the guest keeps FULL `#webviews` bounds (the float tell).
- [x] **AC5 — Main cleanup.** `FIND_OVERLAY_DEV` and the dev-gated reroute deleted; the Ctrl+F branch
  is `event.preventDefault()` + `send('open-find')` with NO chrome-focus call (DD6); the
  `tab-found-in-page` fan-out line, preload method, d.ts entry, and renderer subscription are all
  gone (repo-wide grep for `tab-found-in-page` hits only historical artifact/docs text, no code);
  the `automation/find.js:13` route comment no longer references the removed fan-out.
- [x] **AC6 — Sync channels + sender-based refocus.** `find-overlay-text` sent from the query
  handler (before/with the `findInPage` call — exact placement free) with the session's `wcId`;
  `find-overlay-closed` sent ONLY when the close originated overlay-side (user Esc/✕); the
  `find-overlay:close` handler resolves `refocusGuest` from `event.sender` (overlay → true, chrome →
  false; no payload flag). Both notifications exposed on chrome-preload (`onFindOverlayText`,
  `onFindOverlayClosed`) + typed in `renderer-globals.d.ts`, subscribed in `renderer.js` updating
  `tab.findText` / `tab.findOpen` by `findTabByWcId`. Nav-close (chrome-sent) moves NO focus —
  today's behavior preserved.
- [x] **AC7 — a11y audit updated.** The find-bar axe state and the state-6 `closeFind` cleanup are
  removed from `scripts/a11y-audit.mjs` with a rationale comment (overlay not MCP-addressable;
  attributes carried verbatim per DD12; HAT covers keyboard/focus). The audit's state list comment
  and CLAUDE.md's `npm run a11y` state enumeration agree with the new sweep.
- [x] **AC8 — Specs updated (DD10).** `tab-surface-geometry.md`: title/intent/step names say
  float-not-inset; step 7 expects the bar composited over a FULL-bounds guest (guest-bounds tell +
  pixels; AX sub-assert re-scoped to what the chrome AX tree can still show); step 8 expects bar
  gone, guest bounds UNCHANGED (never inset). `find-in-page.md`: Out-of-Scope reflects the overlay
  architecture. `find-overlay-geometry.md`: consistency-checked; drift (if any) fixed and noted.
- [x] **AC9 — Docs.** CLAUDE.md find-bar references describe the overlay architecture (dedicated
  chrome-class `WebContentsView`, main-owned session, not in the chrome DOM); no doc still claims
  the find bar insets the guest or lives in `index.html`.
- [x] **AC10 — Live E2E on the default path (no env var).** Ctrl+F over a web page opens the overlay
  focused; type → count; step (keys + buttons); Esc → closed, highlight cleared, page focused;
  Ctrl+F with chrome focused (address bar) also opens it; per-tab restore + live-text round-trip
  (AC2 scenario); internal tab: Ctrl+F no-ops, switch hides overlay; kebab freeze/unfreeze with find
  open: overlay hides/restores with text+count; guest bounds identical before/during/after find
  (AC4 tell).
- [x] **AC11 — Gates green.** `npm test`, `npm run typecheck`, `npm run lint` all pass.

## Verification Steps

- AC1/AC3/AC5: greps — `els.find` zero in renderer.js; `runFind`/`closeFind` zero in renderer.js;
  case/format-tolerant `grep -iE 'find[- ]bar'` zero in index.html/styles.css (catches the
  `/* Find bar */` header, which a literal `find-bar` grep would miss); `FIND_OVERLAY_DEV` zero
  repo-wide; `tab-found-in-page` zero in `src/` + `scripts/`.
- AC2/AC10 (live): dev:automation apparatus (wiring litmus first, pinned free port) — the Leg-2
  technique of driving the overlay webContents directly is available for keystrokes; `captureWindow`
  for pixels; `enumerateTabs`/bounds probes for the full-bounds tell. Scenario: open two web tabs +
  one internal; find "foo" on A (type via overlay), switch A→B, find "bar" on B, switch B→A (overlay
  restores "foo" — the live-typed text, not a stale seed), Esc on A, switch A→B→A (no ghost reopen).
  Deferred-to-HAT for anything the apparatus can't drive — record exactly which.
- AC4: with find open, compare guest bounds probe vs `#webviews` rect — equal; and diff-check that
  `measureWebviewsSlotWithInsetDIP`/`computeTopInsetDIP` are gone (typecheck catches dangling refs).
- AC7: run the audit against the dev instance if the session is wired (jar-auth caveat from F4 —
  if the apparatus is foreign-bound, structural check only + defer the run to the wired session).
- AC8: read the three specs end-to-end after editing — no step references an inset, a chrome-DOM find
  input, or `tab-found-in-page`.
- AC11: `npm test && npm run typecheck && npm run lint` (timeout-wrapped).

## Implementation Guidance

Suggested order: main.js → chrome-preload + d.ts → renderer.js → index.html/styles.css → a11y audit
→ specs/docs → gates → live E2E.

1. **main.js.**
   - Delete `FIND_OVERLAY_DEV` (`:168` + comment block) and the dev-gated Ctrl+F reroute
     (`:774-786`): the branch becomes `event.preventDefault(); getChromeContents()?.send('open-find');`
     — NO `getChromeContents()?.focus()` (DD6). Update BOTH stale comments: the branch header at
     `:767-771` ("open the renderer-side floating find bar" / "where the bar lives" — now the
     overlay) AND the focus-then-act block at `:783-788` (the overlay is focused main-side on open).
   - `find-overlay:close` handler: replace the hardwired `refocusGuest: true` with sender-based
     resolution — `event.sender === overlayView?.webContents` → `{ refocusGuest: true }` +
     `getChromeContents()?.send('find-overlay-closed', { wcId: findOverlayTabWcId })` (send BEFORE
     clearing state); chrome sender → `{ refocusGuest: false }`, no notification (the chrome
     initiated it).
   - Query handler (`:1804-1810`): after resolving the session, forward
     `getChromeContents()?.send('find-overlay-text', { wcId: findOverlayTabWcId, text })` (send even
     for empty text — the renderer must track deletions too; empty still skips `findInPage` as
     today... note the overlay page currently skips `query` entirely on empty text — in that case
     the deletion never reaches the renderer. EITHER have the overlay send the empty query (main
     skips `findInPage`, forwards text) OR accept last-nonempty restore; pick the former — it keeps
     `tab.findText` exact and costs one message. Update `find-overlay.js` accordingly and keep its
     local blank-count behavior.)
   - `closeFindOverlaySession` (`:326-336`): unchanged — the notification lives in the
     `find-overlay:close` handler (previous bullet), keyed on sender, NOT inside the shared close
     (implicit closes from tab-switch/tab-close/teardown must stay silent).
   - Remove the `sendToChrome('tab-found-in-page', { wcId, result })` line (`:882`), keeping the
     overlay count branch and the listener itself.
2. **chrome-preload.js + renderer-globals.d.ts.** Remove `onTabFoundInPage` (`preload:140`,
   `d.ts:152`). Add `findOverlayOpen: ({ wcId, findText }) => ipcRenderer.send('find-overlay:open',
   { wcId, findText })`, `findOverlayClose: () => ipcRenderer.send('find-overlay:close')`,
   `onFindOverlayClosed: (cb) => ipcRenderer.on('find-overlay-closed', (_e, d) => cb(d))`,
   `onFindOverlayText: (cb) => ipcRenderer.on('find-overlay-text', (_e, d) => cb(d))` — grouped with
   a short comment mirroring the existing sections; d.ts entries alongside `onOpenFind`.
3. **renderer.js.**
   - Delete `els.find*` (`:72-77`).
   - `activateTab` (`:838-856`): delete the bar DOM branch; send
     `tabSetActive(tab.wcId, measureWebviewsSlotDIP())` first; AFTER it, `if (tab.findOpen &&
     !isInternalTab(tab)) window.goldfinch.findOverlayOpen({ wcId: tab.wcId, findText: tab.findText
     || '' })`. No else-branch needed (main closes the session on any switch). Also `:789` (the
     `.then()` re-activation) → `measureWebviewsSlotDIP()`.
   - Delete `computeTopInsetDIP` + `measureWebviewsSlotWithInsetDIP` (`:992-1022`); re-point `:1039`
     and `:1085`; fix the comments at all touched sites.
   - `openFind` (`:2099-2119`): keep the three guards; body becomes `t.findOpen = true;
     window.goldfinch.findOverlayOpen({ wcId: t.wcId, findText: t.findText || '' });`.
   - DELETE `closeFind` (`:2121-2138` including its doc comment) and `runFind` (`:2075-2093`
     including its doc comment and the section banner at `:2074` — replace the banner with a short
     "find in page → overlay" pointer comment if the section needs a landmark). Zero callers of
     either remain after this leg.
   - Delete the listener block (`:2141-2185`) and the count subscription (`:2793-2800`).
   - Navigation close (`:2709-2718`): keep `tab.findOpen = false` + the `tabFind` stop (background
     tabs); replace the DOM/bounds lines with `if (tab.id === activeTabId)
     window.goldfinch.findOverlayClose();` (chrome-sent → main resolves `refocusGuest: false`; no
     focus moves — today's behavior).
   - Add the two subscriptions (near the other `onTab*` blocks): `onFindOverlayClosed` → clear
     `findOpen`; `onFindOverlayText` → set `findText` (both via `findTabByWcId`, tolerant of a
     closed tab).
4. **index.html / styles.css.** Remove `:132-148` / `:552-608` respectively (CSS range INCLUDES the
   section header at `:552-555`); verify surrounding rules/sections stay intact.
5. **a11y audit.** Remove state 5 and the state-6 `closeFind`/sleep lines; renumber/adjust the
   state-6 comment; add the rationale comment (per Context); also update the ACCEPTED-allowlist
   preamble's "chrome 7-state sweep" wording (`scripts/a11y-audit.mjs:137`) to the new state count.
   Keep everything else byte-identical.
6. **Specs + docs.** Per Context/AC8/AC9. For `tab-surface-geometry.md` step 7 the primary
   observable becomes: `captureWindow` shows the bar composited over the guest AND the guest-bounds
   probe equals the full `#webviews` rect (the tell that works on both capture paths); AX sub-assert:
   the chrome AX tree no longer contains the find input — do not assert it there (the overlay's own
   a11y is HAT-covered).
7. **Overlay page tweak** (from step 1's decision): `find-overlay.js` sends the empty-text query
   (main skips `findInPage`, forwards the deletion) while keeping its local blank-count.

## Edge Cases

- **Restore ordering (the one real race)**: `findOverlayOpen` must be sent after `tabSetActive` in
  `activateTab` — same sender, ordered delivery; do NOT move the restore into a `.then()`/rAF where
  it could interleave with a second fast switch. A fast A→B→A double-switch is safe by ordering
  alone (each switch's close precedes its reopen).
- **`openFind` while `wcId` is null** (tab still creating): existing guard returns — Ctrl+F before
  first paint simply no-ops, as today.
- **Overlay Esc while frozen**: session closes while the overlay is hidden — `find-overlay-closed`
  still syncs `findOpen`; unfreeze re-activates with no session → no overlay. Correct and verified
  by AC10's freeze scenario variant if reachable, else HAT.
- **`find-overlay-closed` for an already-closed tab**: `findTabByWcId` misses → drop silently.
- **Accepted-theoretical race**: main's `find-overlay-closed` (after overlay-Esc) racing a very fast
  A→B→A chrome switch could ghost-reopen once before the closed message lands; the state self-heals
  on the next switch (session closes; `findOpen` already false). Practically unreachable by a human;
  accepted, not defended.
- **Empty-text deletion sync**: covered by the step-1/7 decision — `tab.findText` must become `''`
  when the user deletes to empty, so switch-back restores an empty (blank) bar, not resurrected text.
- **a11y audit `openFind()` global**: the audit no longer calls it, but the function remains a
  window global — no other audit state depends on find.
- **CSS removal boundary**: `styles.css:556-608` ends at the `#find-bar .icon-btn:focus-visible`
  rule's closing brace (`:608`); the `/* ---------- Media panel ---------- */` header follows — keep
  it intact (the Leg-1 review already corrected the off-by-two the flight text carried).

## Files Affected

- `src/main/main.js` — dev-gate removal, Ctrl+F branch, text/closed sync sends, fan-out removal
- `src/preload/chrome-preload.js` / `src/renderer/renderer-globals.d.ts` — bridge surface swap
- `src/renderer/renderer.js` — re-points, retirements, inset removal, new subscriptions
- `src/renderer/index.html` / `src/renderer/styles.css` — `#find-bar` retirement
- `src/renderer/find-overlay.js` — empty-query send (deletion sync)
- `scripts/a11y-audit.mjs` — find-bar state removal + rationale + preamble state count
- `tests/behavior/tab-surface-geometry.md`, `tests/behavior/find-in-page.md`
  (+ `find-overlay-geometry.md` if drifted; `spellcheck.md:108` optional) — DD10 updates
- `docs/mcp-automation.md` — `stopFindInPage` row wording (`:351`)
- `CLAUDE.md` — overlay architecture notes

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`** (batch flight: review + commit are
deferred to flight end — do NOT commit, do NOT set `completed`):

- [x] All acceptance criteria verified (apparatus-unreachable checks recorded as deferred-to-HAT)
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header)

---

## Citation Audit

Verified against the working tree (post-Leg-2, uncommitted) at leg design time (2026-07-02):

- `src/main/main.js:168` `FIND_OVERLAY_DEV`; `:172-173` session state — **OK**
- `src/main/main.js:290/326` open/close session; `:326-336` close body — **OK**
- `src/main/main.js:774-786` dev-gated Ctrl+F branch — **OK**
- `src/main/main.js:882` `sendToChrome('tab-found-in-page', …)`; `:889` overlay count send — **OK**
- `src/main/main.js:1785-1810` the three `find-overlay:*` handlers — **OK**
- `src/main/automation/find.js:13` stale route comment — **OK**
- `src/preload/chrome-preload.js:140` `onTabFoundInPage` — **OK**
- `src/renderer/renderer-globals.d.ts:111/136/152` `onOpenFind`/`tabFind`/`onTabFoundInPage` — **OK**
- `src/renderer/renderer.js:72-77` `els.find*`; `:789` `.then()` site; `:838-856` activateTab
  restore; `:992-1005/1013-1022` inset helpers; `:1039/:1085` call sites; `:2099-2119/2125-2138`
  openFind/closeFind; `:2141-2185` listener block; `:2571-2577` keydown find; `:2709-2718`
  navigation close; `:2793-2800` count subscription — **OK** (all grep/read-confirmed)
- `src/renderer/index.html:132-148` bar markup + comment — **OK**
- `src/renderer/styles.css:556-608` bar CSS (boundary at `:608`) — **OK**
- `scripts/a11y-audit.mjs:288-295` find-bar state; `:306-307` state-6 closeFind — **OK**
- `tests/behavior/tab-surface-geometry.md:72-73` steps 7-8; `:47` observable note — **OK**
- `tests/behavior/find-in-page.md:57-67` Out of Scope — **OK**

All citations verified; no drift. Design review (2026-07-02, Developer agent, approve-with-changes)
re-verified all citations and corrected one boundary (CSS section starts at the `:552` header, not
`:556`). Review issues incorporated: `runFind` + `closeFind` deletion (orphaned post-cutover), CSS
head boundary + tolerant grep, sender-based close refocus (nav-close must not move focus — a real
semantics catch), Ctrl+F header comment, `docs/mcp-automation.md:351` + `find-in-page.md` a11y-gate
claim, allowlist preamble, accepted-theoretical ghost-reopen race.
