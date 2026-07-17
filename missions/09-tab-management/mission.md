# Mission: First-Class Tab Management

**Status**: active

> Source feature request: [goldfinch#82](https://github.com/msieurthenardier/goldfinch/issues/82).
> Operator pre-authorized autonomous execution at mission design (2026-07-14): the Flight
> Director makes judgment calls through flights and debriefs without pausing, and the
> mission closes with a HAT flight where the operator walks through all tests and aligns.

## Outcome

Working with many tabs in Goldfinch feels like working in a mainstream browser.
The strip absorbs any number of tabs without ever growing a scrollbar; tabs go
where the operator puts them — dragged into a new order, torn off into their own
window, or dragged between windows — and every one of those pointer gestures has
a keyboard-reachable equivalent, so the strip's accessibility contract deepens
rather than erodes. A closed tab is no longer gone: the operator reopens it
where it left off (same address, same jar), and — when they opt in — Goldfinch
reopens the whole previous session at startup. Through all of it the privacy
posture holds: burner tabs stay truly ephemeral (never resurrected, never
restored), and a tab carries its cookie-jar identity wherever it moves,
including across windows.

## Context

Goldfinch migrated to the `BaseWindow` + `WebContentsView` shell in Mission 05
and has since built jars, history, and suggestions on top of it — but tab
management itself has stalled at "create, activate, close." Issue #82 collects
the parity gaps: the strip scrolls instead of shrinking (BACKLOG "Tab strip:
Chrome-style shrink, no scrollbar" has specified the fix since M05), tabs
cannot be reordered at all, a closed tab is unrecoverable, there is no
tab-scoped context menu, and tab keyboard navigation stops at the ARIA
tablist's arrow keys — no `Ctrl+Tab` cycling anywhere. `Ctrl+Shift+T` has been
deliberately reserved-and-unassigned in the keydown classifier since M05
(pinned by unit tests) waiting for a closed-tab stack that doesn't exist yet.

The deep lift is multi-window. Today the shell is single-window end to end:
`main.js` holds one module-scoped `mainWindow`, one `chromeView` +
`getChromeContents()` accessor, one `tabViews` registry, one find-overlay
singleton, one menu-overlay-sheet manager, and a `closed → window-all-closed →
app.quit()` chain — every one of them assumes exactly one window. Tear-off and
cross-window drag require re-shaping that singleton set into a per-window
structure, and re-parenting a live `WebContentsView` across `BaseWindow`s is
unproven in this codebase — the issue itself mandates a spike before committing
to the drag-between-windows UX.

Planning inputs adopted from prior artifacts:

- **BACKLOG shrink-to-fit entry** (`BACKLOG.md` "Tab strip: Chrome-style
  shrink, no scrollbar") — exact CSS targets (`styles.css` `#tabs`
  overflow / `.tab` width floor), Chrome-reference behavior (title truncates
  first, close collapses on inactive tabs, active tab keeps its close button),
  and the warning that `responsive-tab-strip` is the HAT gate for this surface.
- **Tab order is implicit today** (renderer `tabs` Map insertion order = DOM
  append order; no order array). Reorder features need an explicit,
  unit-testable order model before any gesture work.
- **No durable tab state exists** (BACKLOG sleep/resume incident: "the tab
  strip is built purely in `renderer.js` memory"). Closed-tab stack and
  session restore are greenfield; `downloads-store.js` (bounded array-of-records
  JSON store, atomic rename) is the persistence exemplar. `webContents.navigationHistory`
  is currently unused — it is the candidate mechanism for restoring a reopened
  tab's back/forward state.
- **Pinned contracts to evolve, not break**: `tab-keyboard-operability`
  (ARIA tablist roving tabindex, no-hijack guard) and `responsive-tab-strip`
  (shrink/defer-reflow-on-pointer-close) behavior tests; the a11y audit
  (`npm run a11y`) across chrome states; the `-webkit-app-region: drag`
  tab-strip window-move zone that tab-drag gestures must not fight.
- **Guest-view native-surface invariant** (CLAUDE.md, M05 F9): never animate
  chrome layout that resizes/repositions the guest slot. Tab-strip
  shrink/reorder animation touches chrome DOM only (safe); tear-off/re-parent
  bounds changes must be instant, never animated.
- **Architect viability check** (mission design, verdict: feasible with
  caveats): `View.removeChildView`/`addChildView` are generic `View` methods
  with no same-window restriction in the Electron 42 type surface — cross-window
  re-parenting is a legal call sequence, but "legal call" and "correct
  composited surface across two native top-level widgets" are different claims,
  and this codebase's own history (#27, find-overlay cold-start) is exactly
  that failure class; the spike's acceptance bar must include **mid-drag/mid-
  motion visual observation, not just settled-frame captures** (the F9
  lesson). `webContents.navigationHistory.restore()` and `getAllEntries()`
  (plain serializable entries) are confirmed present and stable in Electron
  42 — closed-tab reopen with history and the destroy-and-recreate fallback
  are both de-risked. The multi-window singleton conversion is comparable in
  size to the M05 view migration and is split across two flights accordingly.
  The automation blast radius is wider than the tab ops: `getChromeTarget` /
  `captureWindow` are hard singulars and most behavior tests implicitly
  assume one chrome — the multi-window flight opens with an explicit audit of
  which existing specs assume a singular window. Tab drag does not fight the
  window-move zone today (tabs are already `no-drag`); the real cross-window
  drag risk is transport engineering (no first-class Electron drag-session
  API — pointer tracking + IPC handshake is the expected shape).

## Success Criteria

- [ ] The tab strip never shows a scrollbar at any tab count: tabs shrink
      progressively (title truncates, then inactive tabs lose their close
      affordance, down to a compact floor) while the active tab keeps its
      close affordance. *(behavior-test-backed — `responsive-tab-strip`
      evolves to pin the new contract)*
- [ ] The operator can reorder tabs within the strip by pointer drag, with a
      live visual indication of the pending drop position — and dragging a tab
      never fights the strip's window-move drag zone.
      *(behavior-test-backed)*
- [ ] Every tab-management pointer gesture has a keyboard-reachable
      equivalent: reorder from the keyboard, and the existing tablist
      keyboard contract (arrows/Home/End/Delete, roving tabindex, no-hijack
      guard) still holds. *(behavior-test-backed — `tab-keyboard-operability`
      extended)*
- [ ] The operator can cycle and jump between tabs from the keyboard
      (next/previous cycling and direct jump-to-position, including
      jump-to-last), and it works whether focus is in the chrome or in web
      page content. *(behavior-test-backed)*
- [ ] A recently closed tab can be reopened (keyboard and menu), restoring its
      address, its cookie-jar assignment, and — where the platform supports
      it — its back/forward history; the reopen stack is bounded and survives
      nothing it shouldn't (burner tabs are never captured, so a burner can
      never be resurrected). *(behavior-test-backed)*
- [ ] Right-click (and the keyboard context-menu path) on a tab opens a
      tab-scoped menu — close, close others, close to the right, duplicate,
      move to new window, reopen closed tab — rendered from the same
      menu-overlay sheet as every other chrome menu, with its keyboard
      contract intact; middle-click on a tab closes it.
      *(behavior-test-backed)*
- [ ] A tab can be moved into its own new window — by drag (tear-off beyond
      the strip) and by explicit command — and the new window is a complete
      Goldfinch window: its own strip, find, menus, shortcuts, and window
      controls all function there. *(behavior-test-backed)*
- [ ] A tab dragged from one window's strip into another window's strip moves
      there, keeping its cookie-jar identity and its page state.
      *(behavior-test-backed)* — **ATTEMPTED AT F8, TRANSPORT MEASURED DEAD, DEFERRED.
      NOT "not yet reached".** The tab **does** move A→B keeping jar identity and page
      state **by keyboard** (F8 leg 4 — measured live: same `wcId`, jar intact,
      `history.length` held, `goBack` landed). But **the DRAG is this criterion's
      subject**, and the drag does **not** ship: F8's chosen transport was refuted by a
      **second instrument** mid-flight. **UNSATISFIED, and a spike is owed before this is
      planned again — see Known Issues ("Cross-window drag transport").** Do not schedule
      this as ordinary pending work.
- [ ] With several windows open, closing one leaves the others fully
      functional; closing the last window still quits the app on
      Windows/Linux; per-window surfaces (find, menus, active-tab state)
      never cross-talk between windows. *(behavior-test-backed)*
- [ ] When the operator enables session restore in Settings, quitting and
      relaunching brings back the previous session's windows and tabs
      (addresses + jar assignments); burner tabs are excluded by
      construction; with the setting off (the default), startup behavior is
      unchanged. *(behavior-test-backed)* — **IMPLEMENTED at F9 (landed 2026-07-16).
      Structural proof green (session-store/snapshot both-directions unit tests, burner
      excluded by the single-sourced positive allowlist, default-off byte-identity pinned).
      The LIVE quit→relaunch→restore verification is HAT-scoped to F10** — the DD9
      relaunch-harness probe returned NO-GO (no automation MCP/key/instance this session);
      the `session-restore` behavior spec is authored and ready to run.**
- [ ] Privacy and isolation hold everywhere tabs now move: a tab keeps its
      jar identity through reorder, reopen, tear-off, cross-window drag, and
      restore; nothing about a burner tab is ever persisted; jar isolation on
      the automation surface is unchanged.

## Stakeholders

- **The operator** — lives in this browser daily; wants mainstream-browser tab
  ergonomics without giving up the jar/burner privacy model. Walks the HAT
  flight personally.
- **Keyboard and AT users** — the strip is one of the few genuinely accessible
  tab strips in a desktop browser; this mission must extend that contract
  (keyboard reorder, menu keyboard path), not regress it.
- **Agentic platforms driving Goldfinch** — the automation surface
  (`enumerateTabs`, foreground-to-act, capture) must keep working as windows
  multiply; multi-window semantics for automation are decided deliberately,
  not by accident.
- **The project itself** — multi-window is the largest structural change since
  the M05 view migration; the per-window shell shape chosen here is what every
  future window-touching feature inherits.

## Constraints

- **The guest-view native-surface invariant is absolute** (CLAUDE.md):
  tab-strip shrink/reorder animation touches chrome DOM only; any bounds
  change on a guest `WebContentsView` (tear-off, re-parent, window resize)
  is an instant `setBounds` step, never animated.
- **Burner ephemerality is structural, not filtered**: burner tabs must never
  enter the closed-tab stack or the session-restore snapshot — exclusion by
  positive persist-jar allowlist (the history-recorder precedent), never an
  "is not a burner" negative check.
- **Jar identity travels with the tab.** Reorder, duplicate, reopen, tear-off,
  cross-window drag, and restore all preserve the tab's container/partition;
  no operation may silently re-home a tab into a different jar.
- **Pinned accessibility contracts may only be extended.**
  `tab-keyboard-operability` and the `npm run a11y` gate stay green; every
  drag operation ships with a keyboard equivalent in the same flight — a
  pointer-only capability is not done.
- **Menus render from the menu-overlay sheet** (chrome owns model/dispatch,
  sheet owns presentation) — no native `Menu.popup`, no chrome-DOM menus.
- **No new runtime dependencies.** The tab-drag/tear-off implementation uses
  Electron/Chromium primitives already in the stack.
- **Re-parenting is spike-gated** (from the issue): before any
  drag-between-windows UX is committed, a spike proves whether a live
  `WebContentsView` can re-parent across `BaseWindow`s. The committed
  fallback if it can't: destroy-and-recreate in the target window with
  navigation history restored — the success criteria are written to be
  satisfiable by either mechanism.
- **Single-window behavior is the regression baseline.** An operator who
  never opens a second window must notice nothing but the new features: same
  startup, same quit chain, same overlays, same automation behavior.
- **Planning artifacts only from planning skills**; implementation happens in
  `/agentic-workflow`-spawned agents on flight branches.

## Environment Requirements

- Linux (WSL2) development host; GUI Electron app via existing
  `npm run dev:automation` launch (Wayland path).
- Electron 42.6.1 baseline (current `package.json`); no Electron bump planned
  within the mission — if the re-parenting spike reveals a hard need for a
  newer Electron API, that becomes a mission-level decision first.
- Unit tests via the repo's `node --test` runner; behavior tests via the
  goldfinch MCP apparatus (Witnessed pattern), including window capture for
  strip-geometry checks. Cross-window drag verification may need
  admin-tier apparatus additions (decided at flight design).
- `npm run a11y` sweep available for chrome-state regression gating.

## Open Questions

- **Automation surface across windows**: does `enumerateTabs` span all
  windows? What do `getChromeTarget` (singular today) and `captureWindow`
  mean with N windows? Default assumption: enumerate spans all windows and
  window-scoped ops act on the window owning the target tab; pin at the
  multi-window flight design.
- **Re-parenting spike outcome** decides tear-off/cross-window mechanics:
  live `contentView.removeChildView` → other window `addChildView`, vs
  destroy-and-recreate with `webContents.navigationHistory` restore. Spike
  opens the multi-window flight.
- **Cross-window drag transport**: Chromium tab-drag is not exposed to
  Electron directly — candidate mechanisms (pointer tracking across window
  bounds + IPC handshake, HTML5 drag with a custom MIME, or
  screen-coordinate hit-testing on drop) chosen at flight design after the
  spike.
- ~~Reopen fidelity~~ **Resolved at mission design** (Architect probe):
  `navigationHistory.restore()` + `getAllEntries()` are present and stable in
  Electron 42's API surface; entries are plain serializable objects
  (`pageState` already a base64 string), so persisting nav history in the
  closed-tab stack is viable. Verify live at Flight 4 implementation; the
  criterion's "where the platform supports it" clause stays as written.
- **`Ctrl+Tab` binding availability**: premise-check at the keyboard-parity
  flight design that `Ctrl+Tab`/`Ctrl+Shift+Tab`/`Ctrl+PgDn`/`Ctrl+PgUp`
  collide with nothing in `keydown-action.js` / `sheet-accelerator.js` /
  guest-forward behavior, and that Chromium doesn't consume them before
  `before-input-event` sees them in a guest.
- **Session-restore scope on crash**: the setting promises restore of the
  *previous session*; whether an unclean exit restores (crash recovery) or
  only clean quits do is pinned at the session-restore flight design.
- **Closed-tab stack depth** (bounded — exact N) and whether the stack
  persists across app restarts or is in-memory only; decided with the
  persistence design (session-restore flight shares the layer).
- **`window-all-closed` on macOS**: dock-activate currently recreates a
  window; with session restore and multi-window, what does activate restore?
  (macOS is not the dev platform — decide conservatively, verify at HAT.)
- **Duplicate-tab semantics**: duplicate copies address + jar; does it copy
  navigation history too? Default: address + jar only, history if the reopen
  mechanism makes it free.

## Known Issues

- [ ] **Cross-window drag transport: two of the mission's three candidates are MEASURED
      DEAD; the third was never measured** *(surfaced and measured at F8 leg 2's transport
      spike; the criterion above is UNSATISFIED, not pending)*. **A spike is owed before
      cross-window drag is planned again — planning it as ordinary work will re-derive a
      dead transport.**
      - **What was measured, and with WHAT.** F8 adopted candidate 1 (*pointer tracking
        across window bounds + IPC handshake*) and candidate 3 (*screen-coordinate
        hit-testing on drop*), then brought a **second instrument** — Win32 `GetWindowRect`
        over WSLg's RAIL surface — and refuted their shared premise: **Electron's window
        coordinates on this rig are a cached fiction.** `setPosition` is a **no-op**; a
        **real** OS move fires **no event** and leaves `getBounds` unchanged; a virgin
        window is born **363px wrong**; and `screenX ≡ getBounds.x − 16` — **two proxies of
        one value**, which is why the first flight's own cross-check "passed".
      - **Both readings, and the second one is the point:** Electron reporting on Electron
        → self-consistent and **plausible** (`564`); Win32/RAIL on the same window → a
        **different** number. **An instrument cannot discriminate against itself.** *(The
        transferable rule, and F8's most portable product: **a read-back is not a second
        reading unless it is a second instrument.** Every coordinate reading in F8's recon
        and its DD1 was Electron reporting on Electron; the premise survived **two** design
        reviews and died to one `powershell.exe` call.)*
      - **Candidates 1 and 3 are dead for ONE shared reason, so their deaths are not
        independent evidence.** Both need **app-level global coordinates**. There is no such
        thing on this rig, so **neither can be fixed by more care** and neither is a
        fallback for the other.
      - **Candidate 2 — HTML5 drag with a custom MIME — was FORECLOSED BY OMISSION and has
        NEVER BEEN MEASURED.** F8's spec ruled it out in a single clause without probing it.
        **It is the only candidate that needs no app-level coordinate at all, because the
        BROWSER owns the transport** — the drop lands in the target window's own DOM and no
        global point is ever computed. It is therefore **structurally immune to the exact
        failure that killed the other two**, and it is the one candidate whose viability is
        genuinely unknown rather than refuted.
      - **Owner**: a future flight, **gated on an HTML5-drag spike** (candidate 2) that must
        (a) use a **second instrument** for any coordinate it reads, and (b) report a **GO /
        NO-GO verdict** before any leg builds on it. **A NO-GO is a real outcome** and
        retires the criterion honestly; what is not acceptable is planning the drag again on
        an unmeasured transport.
      - **Also unmeasured → HAT** (V1, F8 leg 2): whether a **real OS pointer** delivers
        `pointermove`/`pointerup` to the source window's renderer while it is **over another
        window**. Candidate 1 needs this too; candidate 2 does not.
- [ ] **`npm run a11y` has exit-code discrimination ZERO between "not configured" and
      "a11y is broken"** *(surfaced F7-era, measured and confirmed at F8 leg 5 / AC7;
      → maintenance, not a fix for this flight)*. `scripts/a11y-audit.mjs` routes every
      error through `fail()` (`:99-102`) → `process.exit(1)`, and a genuine NEW violation
      also exits **1** (`:476`). **Both readings taken on the live rig at F8 leg 5:**
      - **without** the admin key → **exit 1**, `a11y-audit: no automation key — set
        GOLDFINCH_MCP_ADMIN_KEY …`
      - **with** the admin key → **exit 0**, *"No NEW violations — every violation node is
        in the ACCEPTED baseline"* (22 accepted baseline nodes, informational)

      So the red an unwary reader meets means *"no instrument"* far more often than
      *"a11y regressed"* — and the two are **indistinguishable by exit code**, which is
      the only thing a CI step or an `&&` chain reads. **Fix**: reserve a distinct
      non-1 exit (e.g. `2` = apparatus/not-configured, `1` = real violation) so
      "not run" can never be misread as "green" or as "broken". *(Same family as
      DD10: an instrument that cannot discriminate between two states is not
      measuring them. **Not run ≠ green**, and a gate that cannot say which is
      not a gate.)*
- [ ] **F9's live verification is carried to F10 (DD9 relaunch-harness NO-GO)** *(surfaced F9 leg 4:
      no automation MCP/key/instance in the execution session)*. Session restore is **implemented and
      structurally proven** (unit + source-scan layer green), but the observable-across-a-restart
      behavior needs the live rig. **F10 must run, with the operator's rig:**
      - `session-restore` (authored at F9) — enable → open tabs across ≥2 jars + a burner → clean quit
        → **relaunch (out-of-band)** → assert the exact restored set with correct jarIds, the **burner
        POSITIVELY ABSENT**, the 2-window menu-Exit guard (both windows back), default-off (nothing
        restored), and the deleted-jar-drop variant.
      - `tab-tearoff` **row 8a** + the displaced-menu residual (the unrun HIGH-1 net; F9 added the
        move-core fix's unit-layer pin but not its live reading) — plus the clean re-run `tab-tearoff`
        already owes.
      - The **real `npm run a11y` verdict** (F9's settings toggle is a labeled checkbox, statically
        reviewed a11y-clean, but the gate never ran for lack of the key).
      - `tab-reorder` **Step 4** no-window-move check against a **second instrument** (retired to HAT
        at F9; the arm-threshold half of its debt is discharged by the `shouldArm` unit pin).

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are
> planned and created one at a time as work progresses. This list will evolve
> based on discoveries during implementation.

- [x] Flight 1: Shrink-to-fit tab strip — progressive shrink to a compact
      floor, no scrollbar at any count, active tab keeps close, middle-click
      close; evolve `responsive-tab-strip` spec. (BACKLOG entry executes here.)
- [x] Flight 2: Tab order model + reorder — explicit order model
      (pure `src/shared/` module), pointer drag with live drop indicator,
      keyboard reorder, drag-region coexistence; extend
      `tab-keyboard-operability`.
- [x] Flight 3: Keyboard tab navigation parity — next/previous cycling and
      jump-to-position from all three capture points (chrome keydown, guest
      `before-input-event`, sheet accelerators).
- [x] Flight 4: Closed-tab stack + reopen — bounded stack, `Ctrl+Shift+T`
      (the reserved binding goes live), jar re-assignment, nav-history
      restore where feasible, burner exclusion by positive allowlist.
- [x] Flight 5: Tab context menu — sheet-rendered tab-scoped menu (close,
      close others, close to the right, duplicate, reopen closed; move-to-new-
      window lands with the multi-window flight), Context-Menu key path.
      *(Landed 2026-07-14; `tab-context-menu` spec PASS 10/10 first run; the
      literal Context-Menu/F10 keypress is HAT-scoped — KEY_MAP apparatus
      gap; wiring structurally verified.)*
- [x] Flight 6: Multi-window shell, part 1 — re-parenting spike (gate; mid-
      motion visual acceptance bar), singular-window behavior-test audit,
      window registry + per-window chrome/tabViews structure, lifecycle
      (close-one vs quit-on-last), "Move to new window" (menu + command) as
      the first cross-window operation.
      *(Landed 2026-07-15; `multi-window-shell` spec PASS 9/9. Overlay
      multi-instance conversion and automation multi-window semantics carry
      to Flight 7.)*
- [x] Flight 7: Multi-window shell, part 2 — per-window find overlay and
      menu-overlay sheet, `grabWindow`/capture semantics, automation surface
      multi-window semantics (`enumerateTabs` span, `getChromeTarget`,
      `captureWindow`), docs.
      *(Landed 2026-07-15; per-window overlays retire F6's roaming interim;
      two live F6 defects fixed; `multi-window-automation` spec PASS 9/9. The
      DD7 blur-conditioning gap is an accepted permanent gap — unreachable by
      any single-window test, and WSLg delivers no OS blur.)*
- [x] Flight 8: Tear-off and cross-window drag — drag beyond the strip
      detaches into a new window; drag into another window's strip re-parents
      there; keyboard equivalents; jar identity preserved.
      *(Landed 2026-07-16, PR #91. RE-SCOPED at leg 2: ships tear-off by drag +
      cross-window move by keyboard. The cross-window DRAG criterion is UNSATISFIED —
      a second-instrument spike measured Electron's cross-window coordinates a cached
      fiction on this rig; deferred to an HTML5-drag spike (candidate 2, never measured).
      DD2 proven live for the first time. The DD7 blur gap is reachable and F7's
      accepted-gap ruling was refuted.)*
- [x] Flight 9: Session restore — setting-gated startup restore of windows +
      tabs (addresses + jars), burner exclusion, unchanged default-off behavior.
      *(Landed 2026-07-16, PR stacked on F8. A NEW Electron-free `session-store` (not the
      closed-tab stack's own hooks — that reopen-stack persistence is explicitly deferred,
      DD-Scope); tabs restored by fresh-create in the saved jar (never adopt); two-writer
      close/before-quit capture; history + geometry scoped out. Burner boundary single-sourced
      (`persist-jar-gate`). Folded in the F8 debts on touched paths: move-core structural fix,
      `shouldArm` unit pin, `tab-reorder` Step 4 retired. Suite 1948. The LIVE E2E cycle +
      `tab-tearoff` row 8a + the real a11y verdict are HAT-scoped to F10 — DD9 probe NO-GO.)*
- [ ] Flight 10: HAT & alignment — operator-guided walkthrough of all mission
      behavior tests with iterative fix legs until aligned.
