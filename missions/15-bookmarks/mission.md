# Mission: Bookmarks

**Status**: active

## Outcome

Users can keep a personal list of web pages and return to them without retyping addresses, at parity with what modern browsers offer for flat (folderless) bookmarks. Starring a page — from the address bar, the page's right-click menu, or a keyboard shortcut — saves it and offers quick editing; an optional bookmarks bar under the toolbar surfaces the list in every window with names and site icons, click/middle-click-to-open, drag-to-reorder, drag-onto-page-to-load, an overflow menu for bookmarks that don't fit, and in-place editing; bookmarked pages surface in address-bar suggestions. The list persists across restarts and stays consistent across windows.

Tracks GitHub issue [#122](https://github.com/msieurthenardier/goldfinch/issues/122), with scope amendments agreed during planning (see Constraints).

## Context

Goldfinch has the standard browsing essentials — history, downloads, password vault, cookie-jar containers — but no way to save a page for later. Bookmarks are the last conspicuous gap in daily-driver usability. The feature is greenfield (no bookmark code exists) but every pattern it needs is established: the document-store persistence shape, the invalidation-not-snapshot broadcast contract, the pure-model context menus, the overlay-sheet menu system, and the instant-reflow layout invariant for anything that resizes the page area.

Planning amendments to the original issue:
- The pinnable bookmarks toolbar icon is **dropped**. It would have been the first app-scoped pin in a documented tab-scoped-only toolbar area (the unresolved #113 tension); removing it dissolves that tension and the associated multi-site pin fan-out. The bookmarks bar is the sole browsing surface.
- Consequence, accepted: with the bar off by default and no toolbar icon, bookmarks are not discoverable until the bar is enabled in Settings.
- The Settings page's startup and appearance sections merge into one combined section, which hosts the bookmarks-bar toggle.
- Drag interactions are promoted to first-class criteria (reorder, bar ↔ overflow, drag-onto-page).

A second planning round reviewed the draft against modern-browser parity (Chrome/Firefox/Edge/Brave) and added: keyboard shortcuts (bookmark page, toggle bar), bookmark names defaulting to page title with hover tooltips, a quick-edit popover on star click (which also makes editing reachable while the bar is hidden), persistent site icons on bar items (new icon storage — the existing favicon pipeline is live-tab-only), bookmarks as an address-bar suggestion source (with an explicit ruling that the global bookmark list may surface across cookie-jar boundaries in suggestions), and middle-click/Ctrl+click opening in a background tab (new capability — tab creation currently always activates). Dragging a link from a page onto the bar to create a bookmark was considered and excluded: it doubles the riskiest mechanism (reverse cross-surface drag) for marginal value.

## Success Criteria

- [x] Any normal web page can be bookmarked and un-bookmarked from the address-bar star, the page's right-click menu, and a keyboard shortcut; a new bookmark's name defaults to the page title; clicking the star opens a quick-edit popover (rename, remove) so bookmarks remain editable even while the bar is hidden; the star's filled/outline state always matches whether the current page is bookmarked — including after navigation (also in-page/single-page-app address changes), tab switches, and edits made from another window. *(behavior-test-backed)*
- [x] Bookmarking affordances are hidden or inert on internal pages; only web pages can ever enter the bookmark list, and activating a bookmark can never reach an internal page. *(behavior-test-backed)*
- [x] Settings presents a single combined startup-and-appearance section containing a bookmarks-bar toggle, off by default; the bar can also be toggled by keyboard shortcut; toggling shows or hides the bar in every open window immediately, and the page area resizes instantly with no animation. *(behavior-test-backed)*
- [x] The bookmarks bar shows bookmarks in stored order, each with its name and site icon (icons appear even for pages not currently open) and a hover tooltip with name and address; activating one loads it in the current tab; middle-click or Ctrl+click opens it in a new tab without leaving the current page; bookmarks that don't fit the window width collapse into an overflow menu offering the same activation; bar and overflow are keyboard-operable per the app's existing menu conventions. *(behavior-test-backed)*
- [x] Right-clicking a bookmark — on the bar or inside the overflow menu — offers rename, change URL, and remove; edits take effect immediately in every window and surface (bar, overflow, star state). *(behavior-test-backed)*
- [ ] Bookmarks can be dragged to reorder within the bar, dragged between the bar and the overflow menu in both directions, and dragged onto the page area to load that bookmark in the current tab (in addition to click). *(behavior-test-backed)*
- [x] Typing in the address bar surfaces matching bookmarked pages among suggestions, visually distinguishable from history entries and deduplicated against them; bookmark suggestions appear regardless of which cookie jar the active tab belongs to. *(behavior-test-backed)*
- [x] Bookmarks — including their names, order, and site icons — survive an app restart; corrupt stored bookmark data repairs to an empty list without blocking startup, and individually invalid entries are dropped while valid ones are kept.

## Stakeholders

- **Browser users** — daily-driver usability; save-and-return is table stakes.
- **Project maintainer** — feature must land inside the established persistence, broadcast, menu, and layout patterns without eroding them; closes issue #122.

## Constraints

- No bookmark folders, no import/export, no bookmark manager page — flat list only, out of scope for this mission.
- No drag-from-page-to-bar bookmark creation (dragging a link out of a page onto the bar) — reverse cross-surface drag is out of scope.
- No pinnable bookmarks toolbar icon — the toolbar pin area and its documented tab-scoped-only rule are untouched (issue #113's ruling stays open, unaffected).
- **Jar-boundary ruling (made this mission)**: the bookmark list is app-scoped (global across cookie jars). It may surface in address-bar suggestions in any jar — a deliberate, presentation-only crossing of the jar boundary; activating a bookmark always opens it in the active tab's jar, and bookmark data never enters jar-scoped stores.
- Site-icon acquisition must respect jar/session isolation — no icon fetch may leak a bookmark's existence into another jar's network session.
- Only web pages (`http`/`https`) may be captured; internal pages are never bookmarkable, and bookmark activation rides the existing untrusted navigation gates — never a web-reachable path into internal pages.
- Showing/hiding the bookmarks bar resizes the page area: the layout change must be instant, never animated (native-surface layout invariant).
- Overlay-menu activation must follow the established index-dispatch idiom; values riding the activation channel are length-capped.
- Persistence joins the existing application database as a validated, versioned document store; no new storage mechanism.
- All mutations broadcast an invalidation signal (no snapshots); every surface re-queries through its own read path.

## Environment Requirements

- Linux desktop with GUI (Electron app, WSL2 host with WSLg or equivalent display).
- Node.js toolchain per repo (`npm test`, `npm run typecheck`, `npm run lint` must stay green).
- Running app with the MCP automation surface (`npm run dev:automation`) for behavior tests and accessibility audit.

## Open Questions

- [x] **Drag-onto-page mechanics** → RESOLVED (Flight 1 HAT, operator-run spike under X11): **VIABLE**. A native drag started on a chrome-DOM element delivers both `dragover` and `drop` into the guest surface, with the app's own custom drag-payload MIME type intact and readable. Flight 2 can build drag-onto-page on real native DnD. (Original framing:)
- [ ] ~~**Drag-onto-page mechanics**~~: the page area is a separate native surface layered over the chrome. No existing code performs a drag that crosses from chrome into the guest surface (tab drag/tear-off deliberately stays inside the chrome's own document). Does a drag started in the chrome (bar) deliver drop events to the guest surface reliably? Needs a spike, run **before** any drag UI is built.
- [ ] **Drop semantics on pages that handle drops themselves**: a dragged bookmark landing on a page with its own drop zone (e.g., a mail composer) could be swallowed by the page. Decide whether navigation is classified chrome-side independent of the page's handling, or the page's handler wins. Must be settled before the drag flight's acceptance criteria are testable.
- [x] **Overflow-menu surface choice vs. drag** → SETTLED for click/keyboard (Flight 1 DD9: sheet-hosted overflow, index dispatch, snapshot-frozen-at-open with close-on-`bookmarks-changed`; shipped and behavior-tested). The drag half remains open for Flight 2: axis-(b) transport was never measured because the sheet refuses all automation at any tier — use the in-source instrumentation method recorded in the Flight 1 log. Flight 2 should also re-examine whether frozen-snapshot INDEX dispatch survives live reordering, or whether id-based addressing is needed. (Original framing:)
- [ ] ~~**Overflow-menu surface choice vs. drag**~~: chrome DOM cannot paint over the page area, so a dropdown from the bar normally means the overlay sheet (a separate surface) — but dragging bookmarks between overflow and bar then crosses surface boundaries. The cross-surface drag spike runs **early enough to inform Flight 1's overflow implementation choice**; regardless of outcome, click-activation is the overflow contract and drag is layered on, so a drag-hostile result degrades gracefully rather than invalidating Flight 1 work.
- [ ] **Drag fallback if the spike fails**: if native drag delivery across surfaces proves unreliable on at least one target platform, do the bar↔overflow and drag-onto-page criteria renegotiate to click-only, or is a synthetic pointer-injection mechanism an acceptable substitute? Human decision, deferred until the spike reports.
- [x] **Spike environment validity** → partly settled: the axis-(a) verdict was obtained under X11/WSLg (Wayland excluded — it cancels drags leaving the source surface). Native-platform confirmation still advisable before Flight 2 ships drag. (Original framing:)
- [ ] ~~**Spike environment validity**~~: the dev rig (WSLg) has a documented history of misreporting window geometry. A drag spike verdict gathered on WSLg should be confirmed on a native platform before being treated as go/no-go.
- [ ] **Bar item context menu surface**: right-click on a bar bookmark needs a context menu anchored in chrome — reuse of the overlay sheet with a bookmark menu type vs. extending the existing page-context toolbar mode. First flight decides.
- [ ] **Edit dialog shape**: rename and change-URL likely reuse the existing input-dialog sheet template (as new-container does); confirm one dialog per field vs. a combined form, and how much it shares with the star quick-edit popover.
- [x] **Site-icon acquisition** → resolved by architect review: capture-at-star is structurally forced, not a choice. Tab icons already reach the chrome only as size-capped inline data (fetched through the owning tab's own jar session), so reading the active tab's icon at star time is a plain read of an already-resolved, already-jar-correct value — no new fetch path, no leak surface. Only **staleness policy** (when/whether to refresh a bookmark's icon on revisit) remains, a UX decision for Flight 1.
- [x] **URL-match semantics** → RESOLVED as Flight 1 DD2: exact committed-URL string match, one shared predicate (`bookmarkUrlsMatch`) used by star state, re-star, and omnibox dedup alike; fragments and trailing-slash variants are distinct pages (Chrome parity). Behavior-tested end to end. (Original framing:)
- [ ] ~~**URL-match semantics for the star and deduplication**~~: does a fragment change (`#section`) or trailing slash count as the same page? One bookmark per what, exactly? **Resolve as a Flight 1 pre-leg decision** — it simultaneously gates star state, omnibox dedupe, and re-star behavior, and the dedup behavior test can't be authored without it.
- [ ] **Omnibox merge/rank**: suggestions are currently a single jar-scoped history source with no source tags; adding bookmarks needs a merge/rank/dedupe design and a way to mark bookmark rows. Flight decides ranking policy (the jar/burner/internal query gates are untouched).
- [ ] **Background-tab open**: tab creation currently always activates the new tab, and existing comments show create/activate ordering is already race-sensitive; a background-open option needs an audit of every activate-on-create call site (session restore, cross-window adopt, scripted opens, automation). Architect recommends this audit run as **its own early leg**, parallel to the drag spike, rather than folded into the bar-click leg.

## Known Issues

- [ ] The live a11y audit cannot reach ANY overlay-sheet state: the automation guard refuses the shared sheet WebContentsView by identity (pre-existing, predates this mission; initially misdiagnosed as kebab-specific). Sheet surfaces added by this mission are covered by offline template unit tests instead — discovered in Flight 1 (leg 3), affects a11y verification of all sheet surfaces mission-wide.

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are planned and created one at a time as work progresses. This list will evolve based on discoveries during implementation.

- [x] Flight 1: **Bookmarking core and surfaces** — persistent store (names, order, icons) + change broadcasts; address-bar star, quick-edit popover, page-context menu item, and keyboard shortcuts with full state-sync (navigation incl. in-page, tab switch, cross-window); Settings section merge + bookmarks-bar toggle (+ shortcut); the bar itself with names/icons/tooltips, click-to-navigate, middle-click background-tab open, overflow menu, right-click edit (rename / change URL / remove), instant reflow; bookmarks as an omnibox suggestion source. One flight because the design decisions are entangled: store shape drives broadcast payloads drives star/bar/omnibox re-query paths; overflow, popover, and edit surfaces share the menu-system decisions. Wide but shallow — nearly every piece reuses an established pattern (new capabilities: icon persistence, background-tab open, suggestion merge). Early-leg sequencing per architect review: the **cross-surface drag spike** (informs the overflow surface choice), the **activate-on-create audit** (gates background-tab open, the addition most likely to surface a cross-cutting regression), and the **keyboard-shortcut classifier work** (cross-cutting four-file lockstep edit that popover and bar-toggle paths depend on; the flight should weigh adding the missing classifier-parity contract test while touching it) all run before the surfaces that consume them. The URL-match-semantics decision is made pre-leg. If breadth proves unwieldy during flight planning, the omnibox suggestion source is the natural slice to split into its own flight.
- [ ] Flight 2: **Drag interactions** — reorder within the bar, move between bar and overflow in both directions, drag onto the page to load. Separate flight because it carries the mission's distinct risk cluster (drag across native-surface boundaries, unproven — no precedent in the codebase) and consumes the spike verdict and real bar from Flight 1. Opens with the drop-semantics decision and, if the spike failed, the fallback renegotiation.

**Execution cadence**: one flight at a time — each flight is planned, executed, and reviewed with the human before the next flight's planning begins. No alignment flight (dropped at sign-off; polish concerns route through the flights' HAT legs instead).

## Flight 1 Landing Note (2026-07-30)

Flight 1 landed with 7 of 8 success criteria met (the drag criterion belongs to Flight 2). Verification: unit/typecheck/lint green at 3278 tests (from a 3095 baseline); three new behavior specs authored, run, and graduated to `active` (`bookmarks-star-sync` 11/11, `bookmarks-bar` 12/12, `bookmarks-omnibox` 6/6); flight-end code review returned 0 blocking issues; operator HAT sign-off recorded.

**Deferred by operator decision** (open item for a follow-up verification session): re-running the six existing behavior specs whose prose leg 3 edited — `page-context-menu`, `settings-shell`, `settings-controls`, `toolbar-pins`, `omnibox-suggestions`, `menu-overlay`. Their text was updated; no code contradiction is known.

**Carried into Flight 2**: drag-onto-page is measured viable (see Open Questions); bar↔overflow drag needs the corrected in-source probe method (the original procedure is obsolete because the overlay sheet refuses all automation at every tier); the accepted cosmetic item — the suggestions-sheet bookmark star does not scale to row height — is a candidate cleanup.
