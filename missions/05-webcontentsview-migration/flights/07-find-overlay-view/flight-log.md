# Flight Log: Floating Overlay Find Bar

**Flight**: [Floating Overlay Find Bar](flight.md)

## Summary

In-flight (2026-07-02). Flight 7 builds the floating overlay find bar surfaced + spike-proven during the
Flight-4 HAT. The design is carried from the Flight-4 flight log "Flight-7 seed" (which incorporated a
design review), re-confirmed against current post-Flight-4 code by the recon below. Execution: 3
autonomous legs (batch review + single commit at flight end) + guided HAT.

---

## Reconnaissance Report

Source: the Flight-4 flight-log "Flight-7 seed" + debrief (which cite specific integration points). Each
walked against current code on `mission/05-webcontentsview-migration` (2026-07-01, post-Flight-4-landing).

| Item | Classification | Evidence | Recommendation |
|------|----------------|----------|----------------|
| Overlay z-orders above guest via addChildView-after-guest | `confirmed-live` (primitive proven) | in-goldfinch spike GREEN (F4 log); `mainWindow.contentView.addChildView` at `main.js:429,1408,1486` | DD1/DD2 |
| Guest re-added on tab switch (overlay must re-assert) | `confirmed-live` | `tab-set-active` `main.js:1473` → `addChildView(entry.view)` `:1486`; `activeTabWcId` `:1497` | DD2 invariant |
| Bounds handlers for position-sync | `confirmed-live` | `tab-set-active` `:1473`, `tab-set-bounds` `:1500` | DD2 |
| Count path B source | `confirmed-live` | `wireTabViewEvents` `main.js:640`; `found-in-page`→`tab-found-in-page` `:677-678` | DD3 |
| Ctrl+F focus fix to retarget | `confirmed-live` | `main.js:585` `getChromeContents()?.focus()` → `:586` `send('open-find')` | DD6 |
| Freeze early-return in sendActiveBounds | `confirmed-live` | `sendActiveBounds` `if (guestFrozen) return` (renderer); restore must be in `unfreezeGuest` | DD5 |
| Chrome view + preload pattern to mirror | `confirmed-live` | `new WebContentsView({preload: chrome-preload.js})` `main.js:411-413` | DD1 |
| `#find-bar` markup/CSS to retire | `confirmed-live` | `index.html:135-148`; `styles.css:556-606` | DD11 |
| Find inset to remove | `confirmed-live` | `computeTopInsetDIP`/`measureWebviewsSlotWithInsetDIP` (renderer) | DD8 |
| `isInternalTab` for the visibility gate | `already-exists` | `renderer.js` `isInternalTab` (chrome); guest-side internal exclusion via `isInternalContents` (main) | DD7 |

**All items `confirmed-live` / `already-exists`** — the overlay doesn't exist yet; every integration point
is present exactly as the seed described. No drift of substance; line numbers locked above.

**Operator decisions (2026-07-01):** proceed with F7 now (fold find verification in; rest of F4 corpus
later); verify via HAT + a new `find-overlay-geometry` spec (apparatus-wiring litmus first); 3 staged
build legs + HAT.

---

## Leg Progress

### Leg 1 — `scaffold-overlay` (2026-07-02) — landed

**Changes made:**
- New `src/main/find-overlay-geometry.js` — pure `computeFindOverlayBounds(guest)` (top-right strip,
  width clamp, x clamp, rounded ints) + the four `FIND_OVERLAY_*` constants; Electron-free, `@ts-check`.
- New `test/unit/find-overlay-geometry.test.js` — 6 `node --test` cases: normal anchor, offset guest,
  narrow-guest clamp (width + x), margin-honored near-width guest, integer output on fractional input,
  and the documented vertical-overhang non-goal (asserts current no-clamp behavior).
- New overlay surface: `src/renderer/find-overlay.html` (same control set/IDs as `#find-bar`;
  `role="search"`, `role="status"` + `aria-live="polite"` + `aria-atomic="true"`, button `aria-label`s
  carried verbatim — DD12), `find-overlay.css` (adapted from the `styles.css` find-bar blocks; literal
  token values; transparent body + `setBackgroundColor('#00000000')` attempted per guidance),
  `find-overlay.js` (placeholder; controls inert — Leg 2 wires DD4).
- New `src/preload/find-overlay-preload.js` — minimal `contextBridge.exposeInMainWorld('findOverlay',
  { platform })` stub (chrome-class trust domain, mirrors chrome-preload).
- `eslint.config.mjs` — `find-overlay-preload.js` added to the node-globals block alongside
  `chrome-preload.js` (design-review medium; DD1 chrome-class contract note left inline for Leg 2).
- `src/main/main.js` — module state (`overlayView`/`overlayVisible`/`lastGuestBounds`,
  `FIND_OVERLAY_DEV` env trigger + `isFindOverlayActive()` Leg-2 seam), `ensureFindOverlayView()` (lazy
  singleton, chrome-class webPreferences, `loadFile` with `.catch` warn), `showFindOverlay()` (bounds
  guard → addChildView re-add-raises → setVisible(true)), `hideFindOverlay()` (presence-gated
  `removeChildView`, never `setVisible(false)`-only — DD7); handler touches: `tab-set-active` (rounded
  bounds hoisted; trusted → hide, DD7; web + overlay-active → re-add strictly AFTER the guest add, DD2
  invariant + DD5 unfreeze restore), `tab-set-bounds` (active-tab bounds tracked; visible overlay
  repositioned), `tab-hide` (active-tab hide → overlay out — freeze path), `tab-close` (`wasActive`
  captured BEFORE the `activeTabWcId` null-out per design review; hide on wasActive or no web tab
  remaining — DD1 teardown), window `closed` (destroy + null-out, any-cast for the untyped
  `webContents.destroy()`).

**Verification (per AC):**
- **AC1** ✅ — markup/attribute grep + file review (`role="search"`, `aria-live`, all five control IDs).
- **AC2** ✅ — `new WebContentsView` for the overlay exists only inside `ensureFindOverlayView()`;
  webPreferences/`loadFile` shape confirmed; hide = `removeChildView` only.
- **AC3–AC6** ✅ **live, pixel-verified** — `GOLDFINCH_FIND_OVERLAY_DEV=1` + `dev:automation` on port
  49717, driven over the loopback MCP (admin key; wiring litmus: `getChromeTarget` wcId 1 +
  `enumerateTabs` returned this instance's tabs). **The WSLg fallback caveat did NOT bite**: the
  primary `desktopCapturer` path was taken and `captureWindow` composited the overlay, so the pixel
  checks ran for real (captures on file in the session scratchpad, t1–t9): overlay floats top-right
  over a live web guest (t1); absent on internal `goldfinch://settings` (t2); restored on switch-back
  (t3); gone during kebab freeze with no artifact (t4); restored after menu close (t5); re-anchored to
  the narrowed guest with the media panel open (t6); re-anchored below the inset push-down with both
  bars visible — the documented expected co-existence this leg (t7); no overlay after last web tab
  closed, internal remaining (t8). Window `closed` teardown: app quit via `app-quit` exited code 0, no
  crash/errors in the log. Window resize/maximize repositioning verified structurally (same
  `tab-set-bounds` funnel as the panel/inset cases exercised); on-screen maximize/DPR≠1 confirmation
  stays a HAT item as planned.
- **AC7** ✅ — env var unset relaunch: no overlay anywhere; `openFind` opens the inset `#find-bar`,
  guest pushed down, search text accepted (t9). See Anomalies for the pre-existing find-count note.
- **AC8** ✅ — 6/6 geometry unit tests pass.
- **AC9** ✅ — `npm test` 953/953, `npm run typecheck` clean, `npm run lint` clean (all run with
  timeouts; nothing hung).

**Deferred-to-HAT:** on-screen maximize + DPR≠1 position confirmation; transparent-corner rendering
(WSLg may composite the overlay body opaque — capture shows the themed rect; acceptable variation,
theming refined at HAT).

**Anomalies:** see Anomalies section (pre-existing inset find-count emptiness under automation drive;
typecheck any-cast for `webContents.destroy()`).

### Leg 2 — `find-routing-and-count` (2026-07-02) — landed

**Changes made:**
- `src/main/main.js` — session state (`findOverlayTabWcId`, single source of "overlay find open,
  targeting tab X"; `isFindOverlayActive(wcId)` real body, callers updated); `FIND_OVERLAY_DEV`
  narrowed to the Ctrl+F stimulus gate only (comment block updated; Leg 3 deletes it); shared
  `openFindOverlaySession(wcId, findText)` (refuses absent/trusted/destroyed; AC6e re-focus-no-reseed;
  defensive close-on-retarget) / `closeFindOverlaySession({ refocusGuest })` (stopFind clearSelection,
  destroyed-tolerant; **refocus ONLY on explicit close** — the review's HIGH); AC7 init-race handling
  (`overlayReady` flag + one-pending-init queue delivered by a construction-time `did-finish-load`)
  and crash recovery (`render-process-gone` → `teardownFindOverlayView()`, also reused by window
  `closed`; destroyed-recreate guard in `ensureFindOverlayView`); DD4 handlers `find-overlay:open`
  (chrome sender only) / `find-overlay:close` (chrome or overlay; the sole refocusing path) /
  `find-overlay:query` (overlay sender only; empty text no-op; chrome-bar default options); count
  path B second branch inside the `wireTabViewEvents` `found-in-page` handler (event-time
  `overlayView`, `isFindOverlayActive(wcId)` drops stale non-target results); handler retargets —
  `tab-set-active` (different tab → session CLOSE no-refocus, AC6a incl. internal; same tab →
  re-show, AC6b/DD5), `tab-close` (target → session close no-refocus after `tabViews.delete`;
  Leg-1 hides kept as belt-and-suspenders), `tab-hide` unchanged (AC6c), Ctrl+F branch reroute
  (env set → `openFindOverlaySession(contents.id, '')`; unset → today's path byte-for-byte).
- `src/preload/find-overlay-preload.js` — DD4 bridge: exactly `query`/`close`/`onInit`/`onCount`
  (+ Leg-1 `platform`).
- `src/renderer/find-overlay.js` — full UI wiring, chrome-bar parity: incremental input
  (`findNext:false`; empty → blank count, NO query), Enter/Shift+Enter/↑/↓ stepping, prev/next
  buttons with `mousedown` preventDefault, ✕/Esc → `close()`, `onInit` open-parity (empty seed →
  clear input AND count; non-empty seed → seed + initial query; focus+select both cases —
  reset-on-next-open is the contract), `onCount` → `n/m` / `0/0`, overlay-local Ctrl/Cmd+F
  re-select. `// @ts-check`ed.
- New `src/renderer/find-overlay-globals.d.ts` — `window.findOverlay` shim so typecheck covers the
  page module against its real bridge (the leg's noted `window.goldfinch` trap documented inline).
- `src/renderer/find-overlay.html` — comment-only touch (the Leg-1 "controls inert" note is no
  longer true); not in the leg's Outputs list, recorded here for completeness.

**Verification (per AC):** live run = `GOLDFINCH_FIND_OVERLAY_DEV=1` + `dev:automation`, dev mint,
admin key, pinned free port 37833 (bind-exact); wiring litmus first (`getChromeTarget` → chrome
wcId 1; `enumerateTabs` → this instance's tabs). Local fixture page (3 × "wombat") served on
loopback. **Apparatus note:** Ctrl+F WAS deliverable to the guest (MCP `pressKey` with `control` —
`before-input-event` fired; no IPC-seam substitution needed), and the overlay webContents proved
directly drivable/readable by wcId (the resolver is `fromId`-based and `activateTabByWcId` returns
false harmlessly for a non-tab wcId), so keystrokes/clicks/DOM reads ran against the real overlay —
much stronger than pixel-only.

- **AC1** ✅ — grep: one `findOverlayTabWcId` definition; `isFindOverlayActive(wcId)` identity check;
  `FIND_OVERLAY_DEV` referenced only at the stimulus branch + its comment.
- **AC2** ✅ — grep: 3 × `ipcMain.on('find-overlay:` each with sender validation; shared open/close
  used by stimulus + handlers. Sender spoofing from a guest not drivable (guests have no
  `ipcRenderer`) — validation code-reviewed.
- **AC3** ✅ live — typed queries reached `findInPage` (counts/highlights on the guest, t2/t9);
  empty text → blank count, no query, highlight persists; stale-target query after tab-close →
  no-op, no crash (t8).
- **AC4** ✅ live — count path B: counts rendered in the overlay from typing, stepping, AND from
  independent `findInPage` tool calls on the target tab (live-tracking `2/3`); `n/m` format
  pixel-confirmed (t4/t9); `0/0` branch is code-parity (no-match term not driven live).
- **AC5** ✅ live — open: overlay `document.hasFocus()` true, `#find-input` active + selected, guest
  `hasFocus` false; explicit Esc close → guest `hasFocus` TRUE + overlay gone + highlight cleared
  (t7); implicit closes never touch focus (code path; `refocusGuest:false` at all three sites).
- **AC6** ✅ live — (a) tab-switch closed the session (t5; switch-back shows NO overlay, t6);
  (b) kebab-close re-showed the overlay with text + count intact (t4); (c) kebab freeze removed it,
  zero artifact (t3); (d) tab-close of the target cleared the session, fresh session on the other
  tab worked (t8/t9); (e) double Ctrl+F kept typed text, no re-seed, overlay refocused; (f) quit via
  `app-quit` exited cleanly, no errors logged.
- **AC7** ✅ live (cold-start half) — relaunch, very first action Ctrl+F → overlay created lazily,
  init+focus arrived post-`did-finish-load` (input focused/selected, empty seed, blank count).
  Crash recovery (`render-process-gone`) is not apparatus-drivable (no node in the overlay page) —
  code-reviewed only.
- **AC8** ✅ live — full matrix: incremental (`wom` → `1/3`, `wombat` → `1/3`), Enter `1/3→2/3`,
  Shift+Enter back, ArrowDown/ArrowUp step, next/prev buttons step with focus REMAINING on
  `find-input` (mousedown suppression), Esc closes. Preload exposes exactly the DD4 four + platform.
- **AC9** ✅ — `git diff --stat`: only `eslint.config.mjs` (Leg 1) + `src/main/main.js`; renderer.js /
  chrome-preload.js / index.html / styles.css untouched. Env-unset relaunch: Ctrl+F → chrome focused,
  inset `#find-bar` visible, guest pushed down exactly as today (t10), and NO overlay webContents
  exists anywhere (full wcId probe).
- **AC10** ✅ — `npm test` 953/953, `npm run typecheck` clean, `npm run lint` clean (timeout-wrapped;
  nothing hung; re-run after all changes).

**Deferred-to-HAT:** physical-keyboard interactive pass (all live keystrokes were synthetic
`sendInputEvent` into the overlay webContents — real DOM/IPC path, but OS-level input routing to the
focused overlay view needs the on-screen check); ✕-button close via a real pointer (Esc close
verified live; ✕ rides the identical `bridge.close()` path); `0/0` no-match count on screen; plus
Leg 1's carried items (maximize/DPR≠1, transparent corners).

**Known/HAT-observation items (flagged by the leg, confirmed live):** (1) dev-gate seed gap — the
Ctrl+F stimulus always seeds `''`, so close-then-reopen loses prior text (renderer-owned `findText`
arrives with Leg 3; NOT a bug against this leg); (2) unfreeze focus — after kebab-close re-show, the
overlay input does NOT regain OS focus (`hasFocus:false`, focus stays in the chrome) — roughly
inset-bar parity; needs a deliberate HAT judgment.

**Anomalies:** WSLg find cold-start re-manifested (see Anomalies section — pre-existing, reproduced
at the raw Electron level, warm behavior fully correct).

### Leg 3 — `cutover` (2026-07-02) — landed

**Changes made:**
- `src/main/main.js` — `FIND_OVERLAY_DEV` + the dev-gated Ctrl+F reroute DELETED; the Ctrl+F branch
  is now `event.preventDefault(); getChromeContents()?.send('open-find');` with NO chrome-focus call
  (DD6; both stale comments rewritten — branch header + the old focus-then-act block). `find-overlay:close`
  resolves `refocusGuest` from the SENDER (overlay wc → `true` + `find-overlay-closed` notification to
  the chrome, sent BEFORE the session close nulls `findOverlayTabWcId`; chrome sender → `false`, no
  echo — nav-close moves no OS focus). `find-overlay:query` forwards `find-overlay-text`
  `{ wcId, text }` to the chrome on EVERY query — empty included (deletion sync) — then skips
  `findInPage` on empty as before. The `sendToChrome('tab-found-in-page', …)` fan-out line removed
  (listener + overlay count branch kept); `wireTabViewEvents` header comment updated.
- `src/preload/chrome-preload.js` / `src/renderer/renderer-globals.d.ts` — `onTabFoundInPage` removed
  from both; new find-overlay group added: `findOverlayOpen`, `findOverlayClose`, `onFindOverlayClosed`,
  `onFindOverlayText` (+ typed d.ts entries alongside `onOpenFind`).
- `src/renderer/renderer.js` — `els.find*` (6 refs) deleted; `activateTab` restore RE-POINTED AND
  RE-ORDERED: `tabSetActive` first, then (web + `findOpen`) `findOverlayOpen({ wcId, findText })` —
  inline, NOT deferred (same-sender IPC ordering is the double-switch safety); the tabCreate `.then()`
  site re-pointed to `measureWebviewsSlotDIP()`. `computeTopInsetDIP` + `measureWebviewsSlotWithInsetDIP`
  DELETED (DD8) with a pointer comment; `sendActiveBounds` + `unfreezeGuest` call sites re-pointed;
  stale comments fixed. `openFind` keeps its three guards, body = `findOpen = true` + `findOverlayOpen`.
  `runFind` + `closeFind` + the find-bar listener block + the count subscription DELETED (zero callers);
  the section banner replaced with a "find in page → overlay" landmark. Navigation close keeps
  `findOpen = false` + the `tabFind` stop (background tabs — tabFind's one surviving renderer use) and
  calls `findOverlayClose()` for the active tab (chrome-sent → no focus move). Two new subscriptions
  (`onFindOverlayText` → `tab.findText`; `onFindOverlayClosed` → clear `tab.findOpen`), both
  `findTabByWcId`-tolerant of closed tabs.
- `src/renderer/index.html` / `src/renderer/styles.css` — `#find-bar` markup (`:132-148` incl. comment)
  and CSS (`:552-608` INCLUDING the `/* Find bar */` section header) removed; Media-panel header intact;
  the stale `/* anchors #find-bar overlay */` comment on `#main` also scrubbed.
- `src/renderer/find-overlay.js` — empty-text queries are now SENT (deletion sync; local blank-count
  behavior kept); header comments updated (sole find UI post-cutover).
- `scripts/a11y-audit.mjs` — find-bar state + state-6 `closeFind` cleanup removed with the rationale
  comment (overlay not MCP-addressable by construction; DD12 attribute carry-over + HAT cover it);
  states renumbered (6-state sweep); `closeLightbox` moved into the DevTools-button state; all three
  "7-state" wordings updated.
- Specs/docs (DD10/AC8/AC9): `tab-surface-geometry.md` title/intent/steps 7-8 → float-not-inset
  (guest-bounds-unchanged as the primary tell; AX sub-assert re-scoped to "input NOT in the chrome AX
  tree"); `find-in-page.md` Out-of-Scope → overlay architecture + corrected a11y-gate claim;
  `find-overlay-geometry.md` consistency-checked — NO drift, unchanged; `docs/mcp-automation.md`
  `stopFindInPage` row re-worded; `spellcheck.md` "find-bar" → "find overlay" (optional touch, taken);
  CLAUDE.md — a11y state list updated + a new find-overlay architecture bullet under Key cross-cutting
  facts; `src/main/automation/find.js` route comment no longer references the retired fan-out.

**Verification (per AC):** live run = default path (NO env var), `dev:automation`, dev mint, admin key,
pinned free port 37027 (bind-exact); wiring litmus first (`getChromeTarget` → chrome wcId 1;
`enumerateTabs` → this instance's tabs). Two loopback fixture pages (foo×3 / bar×2). The overlay
webContents was driven directly by wcId (Leg-2 technique) — 23/25 scripted checks passed; the 2
"failures" were a probe unit-mismatch, not app behavior (guest `innerWidth` is zoom-scaled; WSLg zoom
factor 2.5 → 559×2.5 = 1397.5 ≈ slot 1398, 324×2.5 = 810 = slot height exactly — zoom-normalized, the
guest EQUALS the full slot; re-probed and confirmed).

- **AC1** ✅ — greps zero: `els.find`/`runFind`/`closeFind` in renderer.js; tolerant
  `grep -iE 'find[- ]bar'` zero in index.html/styles.css; `tabFind` exactly one renderer use
  (nav-close stop). Live: guest Ctrl+F AND chrome-focused Ctrl+F (address bar) both open the overlay
  through the re-pointed `openFind` (checks S1/S5).
- **AC2** ✅ live — typing in the overlay round-trips (`tab.findText === 'foo'` after typeText);
  A→B→A restored A's LIVE-TYPED text (input `'foo'`, overlay refocused, t3); overlay Esc synced
  `findOpen=false` while `findText` kept; A→B→A after Esc: NO ghost reopen (overlay unfocused,
  `findOpen` false, t4).
- **AC3** ✅ — markup/CSS/listeners/`runFind`/`closeFind` all gone (greps above); chrome renders
  correctly in all captures (Media-panel CSS boundary intact).
- **AC4** ✅ live — guest bounds byte-identical before/during/after find (559×324 CSS px at zoom 2.5
  = the full 1398×810 slot at every probe point); t1 shows content NOT pushed down under the floating
  bar; typecheck confirms no dangling inset refs.
- **AC5** ✅ — `FIND_OVERLAY_DEV` zero repo-wide; `tab-found-in-page` zero in src/ + scripts/ (code
  AND comments); preload/d.ts/subscription gone; find.js route comment updated. Default-path Ctrl+F
  live-verified with no env var set.
- **AC6** ✅ live — `find-overlay-text` arrives on every query incl. EMPTY (delete-to-empty:
  `tab.findText === ''`, count blank, and switch-back restored a BLANK bar, not resurrected text);
  `find-overlay-closed` only on overlay-side Esc (explicit close → guest `document.hasFocus()` true);
  nav-close path is chrome-sent → `refocusGuest:false` (code-path per design; the sender resolution
  has no payload flag to spoof).
- **AC7** ✅ live — `npm run a11y` RUN against the wired dev instance (fixture on :8123 via `--url=`;
  :8000 was squatted by an unrelated process): 6-state sweep, 23 accepted baseline nodes, **no NEW
  violations** — the find state's removal leaves the gate green and meaningful.
- **AC8/AC9** ✅ — all three specs re-read end-to-end post-edit: no step references an inset, a
  chrome-DOM find input, or `tab-found-in-page`; `find-overlay-geometry.md` had NO drift (its
  hidden-on-internal / restored-on-switch-back observables match as-built session semantics).
  CLAUDE.md/docs updated per Changes.
- **AC10** ✅ live — full scenario: Ctrl+F opens overlay focused (input active, guest unfocused);
  type → count `1/3`; stepping Enter/ArrowUp/next-button (`2/3→1/3→2/3`, focus stays on the input);
  Esc → closed + highlight cleared (t2) + page focused; chrome-focused Ctrl+F opens seeded with saved
  text; per-tab restore + live-text round-trip + no-ghost (t3/t4); internal tab: chrome-focused Ctrl+F
  no-ops, switch hides overlay (t5, zero artifact over Settings); kebab freeze removed the overlay
  (t6) and unfreeze re-showed it with text intact (t7); guest bounds identical throughout. App quit
  via `app-quit` exited code 0 both sessions; all processes killed after.
- **AC11** ✅ — `npm test` 953/953, `npm run typecheck` clean, `npm run lint` clean (timeout-wrapped,
  nothing hung; re-run as the final state after all edits).

**Deferred-to-HAT:** guest-side Ctrl+F on an INTERNAL tab (the internal session is excluded from the
MCP surface, so the keystroke isn't deliverable — the chrome-focused internal no-op WAS live-verified;
the guest-side half is guard-verified in code only); physical-keyboard/OS-level input routing,
✕-button close via a real pointer, `0/0` on-screen — Leg-2 carries; maximize/DPR≠1 + transparent
corners — Leg-1 carries; unfreeze non-refocus judgment (Leg-2 known item, unchanged by this leg).

**Anomalies:** WSLg find cold-start re-manifested once (pre-existing, same family as the Leg-1/Leg-2
entries): after the internal-tab detour, re-activating B restored the overlay with seed `'bar'` but
the initial query produced no `found-in-page` (count blank, no highlights — t7 shows the restored bar
with text but no count). Warm behavior in the same session was exact (counts `1/3→2/3`, stepping,
live highlights in t1). Not a Leg-3 regression; interactive confirmation stays a HAT item. Also noted:
port 8000 (the audit fixture default) was squatted by an unrelated local process — the audit's `--url=`
override on :8123 handled it; no goldfinch change needed.

---

## Decisions

### Flight Director Notes

- **2026-07-01 — Flight planned via `/flight`.** Design carried from the Flight-4 "Flight-7 seed"
  (spike-proven primitive + design-review rework points) and re-confirmed by the recon above. Three
  operator decisions locked (sequencing / verification / staging). A new `find-overlay-geometry` behavior
  spec authored inline at planning so its apparatus (captureWindow + the guest-full-height float tell,
  apparatus-wiring litmus) shapes the leg breakdown; `tab-surface-geometry`'s find-bar step to be updated
  at cutover (Leg 3) from inset to float.
- **2026-07-01 — Design review (Architect, codebase-grounded) → approve with changes; all incorporated.**
  Code-grounded refinements: (1) **DD3** is a *modification* to the existing `found-in-page` fan-out in
  `wireTabViewEvents` (`main.js:677`), adding a second branch to `overlayView.webContents.send`, resolved
  via a module-level `overlayView` at event time. (2) **DD2 "single choke point" corrected** — keyboard
  panel toggles (Ctrl+M/Ctrl+Shift+P) don't call `sendActiveBounds`; they ride the `#webviews`
  ResizeObserver → `tab-set-bounds` (mid-transition drift, pre-existing, acceptable). (3) **DD5** — unfreeze
  restore must re-add AND re-show the overlay via the `tab-set-active` re-add (since that handler re-adds
  the guest above it). (4) **DD7** — use `removeChildView` on internal tabs (not `setVisible(false)`) to
  avoid z-order artifacts; Leg-1 confirms. (5) **DD6** — cutover must strip `getChromeContents()?.focus()`
  at `main.js:585`. (6) **Teardown** added (last-web-tab-close/all-internal → remove; window `closed` →
  `destroy()`). (7) **DD8** — find is the only inset contributor; simplify `computeTopInsetDIP` to
  `measureWebviewsSlotDIP()` at cutover. Apparatus caveats in `find-overlay-geometry` (WSLg fallback
  doesn't composite the overlay; overlay not MCP-enumerable; float tell reliable on both paths) all
  **confirmed accurate** by the review. A second pass was skipped — edits directly implement the review.
- **2026-07-02 — Flight execution started (`/agentic-workflow`).** Crew file validated
  (`.flightops/agent-crews/leg-execution.md` — Crew / Interaction Protocol / Prompts all present).
  Branch `flight/07-find-overlay-view` created off `mission/05-webcontentsview-migration`; flight
  status → `in-flight`. Batch mode: legs 1–3 implement without per-leg review/commit; single Reviewer
  pass + commit at flight end; Leg 4 is the guided HAT.
- **2026-07-02 — Leg 1 (`scaffold-overlay`) designed.** Fresh code recon at design time confirmed all
  15 flight-recon citations (no drift); two new grounding facts recorded in the leg: internal tabs also
  ride `tab-set-active` (`renderer.js:856`, gate DD7 by `entry.trusted`), and the overlay is not
  MCP-enumerable by construction (`enumerateTabs` reads `tabViews` only). Design choice: a temporary
  `GOLDFINCH_FIND_OVERLAY_DEV=1` env trigger stands in for find-open state so Leg 1's lifecycle is
  exercisable without find routing (removed by Leg 2 — logged in the leg's Workaround Log). A pure
  `find-overlay-geometry.js` helper is split out for unit-testability. Developer design review spawned.
- **2026-07-02 — Leg 1 design review → approve with changes; all incorporated; leg `ready`.** One
  medium (new preload not covered by any ESLint glob — `eslint.config.mjs` has per-file preload
  entries, no catch-all; fix = add `find-overlay-preload.js` to the node-globals block, recorded as
  part of the DD1 chrome-class contract so Leg 2 doesn't misfile it) + four low (tab-close insertion
  point must precede the `activeTabWcId` null-out at `main.js:1442`; null-guard `lastGuestBounds` in
  `showFindOverlay()`; AC2 tightened to hide-=-removeChildView-only per DD7; `styles.css` find-bar
  range is `556-608` not `556-606` — DD11's Leg-3 removal range corrected in the leg). Suggestions
  adopted: double-bar co-existence documented as expected this leg; geometry vertical-overhang pinned
  as a documented non-goal test case. Second review pass skipped — edits directly implement the
  review. `[HANDOFF:review-needed]` → design finalized; proceeding to implementation.
- **2026-07-02 — Leg 1 implemented and landed (Developer agent).** All 9 ACs verified; AC3–AC6
  pixel-verified live (the WSLg fallback caveat did NOT bite — `captureWindow` composited the overlay
  on the primary desktopCapturer path). Gates green (953/953 / typecheck / lint). Two anomalies logged
  (pre-existing inset find-count emptiness under automation drive, A/B-isolated against a pristine
  baseline; `webContents.destroy()` any-cast). Deferred-to-HAT: maximize + DPR≠1 on-screen, transparent
  corners. Not committed (batch flight). Legs completed: 1/3 autonomous.
- **2026-07-02 — Leg 2 (`find-routing-and-count`) designed.** 17 citations verified against the
  post-Leg-1 working tree. Two design refinements vs the flight text, both under the flight's
  "acceptable variations" (minor cutover reordering), recorded here: (1) the Leg-1 env var is
  **narrowed, not deleted** — `GOLDFINCH_FIND_OVERLAY_DEV=1` now gates only a Ctrl+F stimulus reroute
  in main so the routing is end-to-end verifiable pre-cutover (Leg 3 deletes it); (2) the
  chrome-preload bridge methods (`findOverlayOpen`/`findOverlayClose`) move to Leg 3 with their
  consumers — Leg 2 registers the main-side `ipcMain` handlers (the full DD4 contract) without dead
  preload surface. Session semantics pinned: tab-switch closes the session; freeze (tab-hide) keeps
  it (DD5 restore rides tab-set-active); re-open on the same tab re-focuses without re-seeding.
  Developer design review spawned.
- **2026-07-02 — Leg 2 design review → approve with changes; all incorporated; leg `ready`.** One
  HIGH caught: the shared session-close called `wc.focus()` unconditionally — on the tab-switch path
  that fires AFTER the new guest is raised, landing OS focus on a hidden view and stealing focus from
  tab-strip keyboard nav (a pinned contract), and it would have carried into the Leg-3 cutover. Fix:
  refocus-flagged close (`refocusGuest: true` only on explicit Esc/✕ close). Two mediums: `onInit`
  open-parity (blank stale count on empty seed; issue the initial query on non-empty seed — a latent
  Leg-3 half-parity otherwise) and crash recovery (`render-process-gone` leaves the WebContents
  un-destroyed, so the planned `isDestroyed()` guard was insufficient — construction-time listener
  tears down + resets). Designer answers recorded in the leg: implicit close never refocuses;
  reset-on-next-open is the contract (no reset channel). Reviewer suggestions adopted: defensive
  close-on-retarget in open; overlay-local Ctrl+F re-select; dev-gate seed gap + unfreeze-focus
  flagged as known/HAT-observation items. Second pass skipped — edits directly implement the
  reviewer's own prescriptions (same rationale as the flight-planning review). Proceeding to
  implementation.
- **2026-07-02 — Leg 2 implemented and landed (Developer agent).** All 10 ACs verified; the apparatus
  drove the overlay webContents directly (real keystrokes/clicks/DOM reads), so routing, stepping,
  freeze-survival, session semantics, and focus were all live-verified with pixel evidence. Gates
  green (953/953 / typecheck / lint). Env-unset relaunch byte-exact. Known items logged (dev-gate
  empty seed; unfreeze non-refocus → HAT judgment). Legs completed: 2/3 autonomous.
- **2026-07-02 — Leg 3 (`cutover`) designed.** Full recon against the post-Leg-2 tree (citation audit
  clean). Two design additions beyond the flight text, recorded here: (1) **two new main→chrome sync
  channels** — `find-overlay-text` (query-text forward → renderer `tab.findText`) and
  `find-overlay-closed` (explicit-close-only → renderer clears `tab.findOpen`) — without them the
  renderer's DD9 per-tab state goes stale once typing/Esc live in the overlay (switch-back would
  restore wrong text or ghost-reopen); (2) **a11y-audit find-bar state removed** with rationale — the
  overlay webContents is not MCP-addressable by construction, so axe cannot reach it through the
  apparatus; DD12's intent is honored via verbatim attribute carry-over + the HAT keyboard pass
  (deviation from DD12's letter, recorded). Also pinned: activateTab restore re-ordering
  (tabSetActive first, then findOverlayOpen — IPC ordering per sender), `tab-found-in-page` full
  retirement (chrome count was its only consumer), empty-text deletion sync (overlay now sends empty
  queries so `tab.findText` tracks deletions), and `tab-surface-geometry` step-7 AX re-scope (find
  input no longer in the chrome AX tree). Developer design review spawned.
- **2026-07-02 — Leg 3 design review → approve with changes; all incorporated; leg `ready`.** Four
  mediums: `runFind` + `closeFind` orphaned by the cutover but not slated for deletion (dead code +
  a second `tabFind` use falsifying an AC claim); CSS removal range missed the `/* Find bar */`
  section header (`:552-555` — and a literal `find-bar` grep would never catch it; range now
  `552-608` + tolerant grep); nav-close focus semantics — routing it through the explicit-close
  channel would have `wc.focus()`'d the guest on page-initiated navigations (e.g. mid-typing in the
  address bar). Designer decision: **close refocus is resolved by sender, not payload** — overlay
  sender (user Esc/✕) → refocus + `find-overlay-closed` notification; chrome sender (programmatic
  nav-close) → no refocus, no echo. `closeFind` deleted outright (nav path inlines). Three lows
  (stale Ctrl+F header comment, `docs/mcp-automation.md:351`, `find-in-page.md` a11y-gate claim) +
  suggestions (allowlist preamble, accepted-theoretical ghost-reopen race) folded in. Second pass
  skipped — edits directly implement the reviewer's prescriptions. Proceeding to implementation.
- **2026-07-02 — Batch flight review (Reviewer agent, fresh context, Sonnet) → `[HANDOFF:confirmed]`.**
  All uncommitted changes across legs 1–3 reviewed against the three leg ACs + DD1–DD12. Gates re-run
  independently: 953/953 / typecheck / lint. Security properties verified clean: sender validation on
  all three `find-overlay:*` channels; internal-tab exclusion at every entry point (defense in
  depth); no automation-surface widening (overlay invisible to MCP by construction); sender-resolved
  refocus; z-order invariant; all teardown/leak paths covered. One non-blocking finding: Leg 3's
  AC/checklist checkboxes were unmarked (documentation gap only — evidence was in the flight log);
  fixed by the Flight Director. No fix cycle needed (0 of max 3).
- **2026-07-02 — Flight commit + PR decision.** Legs 1–3 statuses → `completed`; checked off in
  flight.md (checkpoints 1–3, prerequisites). Committing all code + artifacts as the single batch
  commit on `flight/07-find-overlay-view`. **PR decision:** the agentic-workflow's draft-PR step is
  superseded by this mission's recorded branch model (mission constraint "Long-running mission
  branch" + flight.md Post-Flight: flight branch → mission branch, LOCAL; `main` untouched; no
  GitHub PR — consistent with Flights 2–4). The leg-checklist PR body convention is preserved in the
  commit message body instead. Remaining before landing: Leg 4 `hat-and-alignment` (guided HAT +
  `/behavior-test find-overlay-geometry` + `npm run a11y`, apparatus litmus first).
- **2026-07-02 — Leg 3 implemented and landed (Developer agent).** All 11 ACs verified; the live E2E
  ran on the DEFAULT path (no env var) with the overlay webContents driven directly — restore
  round-trip, deletion sync, sender-based close refocus, no-ghost, internal no-op, freeze-survival,
  and the full-bounds float tell all live-verified with pixel evidence (t1–t7). `npm run a11y` run
  live against the wired instance: 6-state sweep green, no NEW violations. Gates green (953/953 /
  typecheck / lint). One pre-existing anomaly re-manifested (WSLg find cold-start — logged). Not
  committed (batch flight). Legs completed: 3/3 autonomous — flight ready for batch review + Leg 4 HAT.

---

## Deviations

_(none yet)_

---

## Anomalies

- **2026-07-02 (Leg 1) — Inset `#find-bar` count stays empty under automation drive (PRE-EXISTING,
  not a Leg-1 regression).** During the AC7 check, driving the inset bar programmatically (openFind +
  input event → `runFind` → `tab-find` → `wc.findInPage`) produced no `found-in-page` count ("" instead
  of "n/m") and no visible highlights on the WSLg dev platform. **Isolated by A/B**: with the Leg-1
  `main.js`/eslint changes stashed (pristine baseline), the identical drive produced the identical
  empty count — behavior is byte-identical with and without the leg's changes, so AC7's "exactly as
  before" holds. Likely the known M04 find-in-page cold-start / WSLg native-surface sensitivity, or an
  artifact of synthetic-event driving; interactive Ctrl+F find remains a HAT check (Leg 4) and Leg 2
  re-verifies the count path when it wires find routing through the overlay.
- **2026-07-02 (Leg 2) — WSLg find cold-start reconfirmed (PRE-EXISTING; warm behavior fully
  correct).** Immediately after a page load or a fresh find session, incremental `findInPage`
  calls (findNext:false) produced NO `found-in-page` events (overlay count stayed blank) until a
  findNext was issued or the find state warmed; **isolated at the raw Electron level** via the MCP
  `findInPage` tool (bypassing all Leg-2 code except count path B) — same stall pattern. Once warm,
  everything was live and exact: incremental `wom` → `1/3`, stepping `1/3→2/3→1/3`, count path B
  tracking every event. Same family as the Leg-1 inset-bar anomaly and the M04 find-in-page
  cold-start Known Issue; not a Leg-2 regression. Interactive confirmation stays a HAT item.
- **2026-07-02 (Leg 1) — `webContents.destroy()` is absent from the public Electron type defs.** The
  existing `tab-close` destroy reaches it through an untyped Map entry, so `npm run typecheck` never
  saw it; the overlay's typed `overlayView` needed a `/** @type {any} */` cast (repo-precedented
  pattern) at the window-`closed` teardown. Cosmetic; no behavior impact.
- **2026-07-02 (Leg 4 / HAT-1) — Overlay find advanced the OLD term on input edits instead of
  re-searching (PRE-EXISTING; FIXED).** **Root cause:** inverted `findNext` semantics. Electron's
  `FindInPageOptions.findNext` means "begin a NEW find session" (`true`) vs "follow-up in the current
  session" (`false`) — the inverse of the legacy `<webview>`-era reading the find path has used since
  the inset bar. Every input edit went out as a follow-up (`findNext:false`), which Chromium services
  by advancing the existing session *without re-reading the text*; Enter's `findNext:true` was
  actually starting a new session anchored after the current selection — which masqueraded as
  stepping and is why the edited term only applied on Enter. **Classification: PRE-EXISTING, not an
  F7 regression** — A/B on a worktree at `fc75517` (pre-F7 inset `#find-bar`), identical drive
  (type `foobar` → Enter → backspace edits), byte-identical behavior at every step (typing → no
  count; Enter → `1/2`; backspace → `2/2` advance of the old term; Enter → new term applies). The
  overlay carried the old bar's defect faithfully as "parity". **Fix:** main-side, the
  `find-overlay:query` handler now tracks the last-issued session text (`findOverlayLastQueryText`,
  reset on session open/close/teardown/delete-to-empty) and maps the payload's chrome-bar-shaped
  `findNext` ("this is a step request") onto Electron semantics: a step continues the engine session
  (`findNext:false`) only when the text is unchanged; any text change — and the first query of a
  session — begins a new session (`findNext:true`), so edits re-search immediately. Page-side
  companion (`find-overlay.js`): `onCount` drops events while the input text is empty — with every
  edit now genuinely re-searching, delete-to-empty could race a late `found-in-page` from the last
  pre-empty query and resurrect a stale count. **Side observation:** with the first query issued as
  a genuine new session, the count populated immediately on a cold fresh page in verification —
  the "issue a follow-up with no session" call pattern is plausibly the root of (or a contributor
  to) the WSLg cold-start anomaly family; the automation op (`src/main/automation/find.js`,
  own requestId+retry path) is deliberately untouched, so its documented cold-start caveat stands
  until separately re-verified. **Verified live** (isolated instance :45911, overlay driven via the
  probed-wcId technique): type `foobar` → `1/2` immediately; Enter → `2/2`; backspace → `fooba`
  re-searched (`2/2` — 2 genuine matches); → `foo` → `2/5`; Enter/Shift+Enter step `3/5→4/5→3/5`;
  delete-to-empty → count blank and stays blank; retype `alpha` → `1/1`. Leg 2/3 contracts preserved
  (sender validation, deletion sync via find-overlay-text, count path B, focus semantics).
  `npm test` 953/0, typecheck + lint clean. Commit: see the HAT-fix commit on
  `flight/07-find-overlay-view` (`flight/07: HAT fix — find re-searches on input edits`).

---

## Session Notes

_(none yet)_
