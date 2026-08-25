# Flight: The Welcome Surface

**Status**: completed
**Mission**: [Search and Startup Choice](../../mission.md)

## Contributing to Criteria

- [x] Home page and search engine are independent preferences, each settable and clearable on its own, presented adjacent to one another in Settings; setting or clearing either never changes the other. *(this flight: the clearable half — Flight 1 delivered the settable half)*
- [x] A newly created profile has neither preference set, and Goldfinch never sends a query to a search provider the user did not choose.
- [x] When a preference is needed but unset, the user arrives at a branded Goldfinch page offering to set exactly the missing one — new tab with no home page set, search with no engine set, or both together on first launch. *(this flight: the surface, functional and presentable; visual branding is Flight 3)*
- [x] A search typed before an engine was chosen is not lost: after choosing an engine, that search runs.
- [x] The welcome page is not a trap — on it, typing an address navigates that same tab (not a second one) and bookmarks remain reachable, so a user can leave without choosing anything.
- [x] Adding the welcome surface does not weaken existing internal-page protections: it stays out of browsing history and out of web sessions, web content cannot reach its privileged bridge or forge navigation into it, and every existing internal page keeps its current behavior.
- [x] Only engines from the curated list can ever be stored; unknown or corrupt stored values repair without blocking startup and without silently selecting a provider on the user's behalf. *(this flight: the "without silently selecting a provider" half — repair-to-default now repairs to unset)*

Carried from reconnaissance (see the flight log's Reconnaissance Report):
- [x] Squawk 0005 — `homePageCache` never boot-seeded → claimed by DD4 (fix, not inherit)
- [x] Squawk 0006 — `search-engine-upgrade` step 2 premise → claimed by DD5 (the row is true once 0005 is fixed; re-run closes it)
- [x] Mission Known Issue — `openSiteSettingsTab()` reuses any internal tab → claimed by DD10
- [x] Mission Known Issue — `settings.js` truthy home-page guards (two sites) → claimed by DD6

---

## Pre-Flight

### Objective

Finish the mission's outcome: fresh profiles start with neither preference set, Goldfinch never guesses, and the first time a choice actually matters — a new tab with no home page, a search with no engine, or both at once on first launch — a Goldfinch-owned welcome surface appears in that tab offering to set exactly the missing preference. The surface is not a gate: its address bar and bookmarks work, typing an address navigates that same tab, and a search typed before an engine was chosen runs once one is picked. Both preferences become clearable in Settings, the three Google coalescing sites and the one engine coalescing site are removed, and the `homePageCache` boot-seed defect (squawk 0005) is fixed rather than inherited. Existing installs — pinned explicit by Flight 1 — see nothing change.

### Open Questions

- [x] How does the welcome page get a working address bar and bookmarks bar while staying trusted? → **DD1**: it is not an internal page at all — it is a chrome-owned surface shown in a normal tab record that has no web contents yet. Nothing to split.
- [x] How does the pending query travel to the welcome page? → **DD3**: chrome-held on the tab record, never in a URL, never persisted.
- [x] Should the welcome tab be tearable into a new window? → **DD8**: no — not until it has a view. Every cross-window move path is keyed on a live `wcId` (design review), so the existing guards already refuse it; the flight makes the refusal visible (menu items omitted) instead of building viewless-record transfer.
- [x] Does clearing a preference in Settings need a confirmation or explanation? → **DD6**: no confirmation; a one-line inline explanation of what changes.
- [x] What does a welcome tab show in the address bar and tab strip? → **DD7**: empty address bar with the normal placeholder (writable), tab title "Welcome to Goldfinch", no URL.
- [x] What happens to open welcome tabs across quit/relaunch? → **DD9**: not restored (structurally — they have no view); the boot path opens a fresh one if the home page is still unset and there is nothing to restore.
- [ ] Branding — what the page looks like. **Flight 3** (alignment); this flight ships functional, presentable, unstyled chrome. Not blocking.

### Design Decisions

**DD1 — The welcome surface is a chrome-owned tab, not an internal page.**
A welcome tab is a normal strip record (`buildStripRecord`, `src/renderer/chrome/tab-controller.js`) in whatever jar the call site resolved (personal, burner, or a new jar), with `wcId === null` and a `tab.welcome = { reasons: Set<'home'|'search'>, pendingQuery: string | null }` marker, and **no `tabCreate` IPC call**. While the record has no view, the guest slot shows a chrome-rendered welcome panel (`#welcome-surface` in `src/renderer/index.html`, controller `src/renderer/chrome/welcome-controller.js`, styles in the chrome stylesheet). Preference writes go through a new chrome-bridge method `welcomeSetPreference({ key, value })` → `ipcMain.handle('chrome-welcome-set', …)` in `src/main/register-settings-ipc.js`, restricted to `homePage` / `searchEngine`, calling `settings.set(` directly and `broadcastSettings()` — the `toggle-bookmarks-bar` / `unpin-toolbar-item` shape, which the broadcast-invariant net's detection half sees (no helper wrapper — squawk 0003's hole stays un-engaged).
- Rationale: the mission's principal risk — `isInternalTab` / `isInternalPageUrl` conflating "trusted" with "no browsing affordances" across 34 gates (67 counting `isInternalContents` and the session marker) — does not need to be split; it disappears. A welcome tab is a web tab to every one of those gates: the address bar is writable (`navigation-controller.js:27` never fires — the URL is empty), the bookmarks bar and star follow the jar (`renderer.js:207`), `navigate()` never takes the internal early-return (`navigation-controller.js:80`), tear-off is allowed, and the wcId-dependent affordances (media, devtools, find, zoom, print) already tolerate `wcId == null` because every tab is born that way until dom-ready. "Typing an address navigates that same tab" becomes literally true — the record acquires a view (DD2) instead of being replaced. The three internal-page allowlists (`INTERNAL_HOSTS`, both `INTERNAL_ORIGINS`, the route map) are untouched, so the `tab-scheme-guard` and `internal-session-exclusion` boundaries are not engaged at all, and history / session-restore / closed-tab exclusion is structural (no view → nothing to record). The surface is fully automatable through the chrome wcId — internal pages are not (`evaluate` refused there). Flight 3 styles chrome DOM, which is where the app's visual language already lives.
- Rejected: (a) an internal `goldfinch://welcome` page — the internal partition may never load web content (`guest-wiring.js:207` `guardNav`, `register-tab-ipc.js:834` gate), so "navigate that same tab" would mean destroying the internal view and creating a web view under the same record — the DD2 attach primitive *plus* a destroy, plus three allowlists, plus a capability discriminator threaded through the address-bar, star, bookmarks-bar, suggestions, and reroute gates; (b) per-capability flags on `isInternalTab` — a 34-site audit whose regression surface is the whole app.
- Trade-offs: the welcome UI lives in the chrome bundle (`index.html` / `styles.css` grow by one panel); there is no `goldfinch://welcome` URL — nothing in the mission needs one (the surface appears when a preference is missing; it is not a destination), and the mission's "three-allowlist change" framing and its named-spec list are superseded by this ruling — preserved in the mission as commentary, not rewritten. A welcome tab's "Bookmark this page" star stays hidden while `wcId == null` (existing `refreshStar` rule) — correct, there is nothing to bookmark.

**DD2 — The attach primitive: a viewless record acquires its view on first navigation.**
`navigate(input)` on a welcome tab (`tab.wcId == null && tab.welcome`) calls `attachView(tab, url)`: `window.goldfinch.tabCreate({ url, partition: tab.container.partition, trusted: false })`, with the wcId-arrival continuation extracted from `createTab` into one shared `onViewCreated(tab, wcId)` so the two paths cannot drift; it clears `tab.welcome` and hides the panel. Every navigation entry point on a welcome tab routes through it: address bar, bookmarks-bar click, omnibox suggestion pick, the welcome panel's own "run this search" (DD3), and `sel:search`/link opens that target the active tab (leg design enumerates them — `tabNavigate` calls guarded by `tab.wcId != null` are the grep). Provenance rule intact: attach is chrome-initiated on the untrusted branch and validates with `isSafeTabUrl`.
- Rationale: the record, its strip position, its jar, and its pending query persist; only the view is new. This is the smallest primitive that makes criterion 8 true.
- Trade-off: `tab-controller.js` is the app's most intricate module; the change is contained to one extracted continuation and one new function, and unit tests pin that a welcome record navigates in place (tab count and strip index unchanged).

**DD3 — The pending query is chrome-held on the tab record, consumed once.**
`toUrl` returns `null` when the input is a search and `currentSearchEngine()` is `null`; `navigate()` then turns the active tab into a welcome tab with `reasons = {'search'}` and `pendingQuery = input` — if the active tab already has a view, a **new** welcome tab is opened beside it (never discard a page the user is on); if it is already a welcome tab (home reason), the search reason and query are added. The context-menu `sel:search` path does the same in a new tab in the source jar. Picking an engine on a welcome tab with a pending query writes the preference and immediately attaches `buildSearchUrl(engine, pendingQuery)` (DD2). Typing a URL on such a tab discards the query (the panel shows the pending text, so the user sees what they are leaving). The query never rides a URL, is never persisted (no view → excluded from snapshot and closed-tab capture), and dies with its tab (a welcome tab cannot be torn off — DD8). **Length-capped and never evaluated** (mission constraint): the query is truncated at capture to `PENDING_QUERY_MAX = 2048` characters (a named constant in `src/shared/search-engines.js` beside `buildSearchUrl`, which also applies it), rendered only via `textContent`, and reaches `buildSearchUrl` as data — unit-tested with a positive control (an over-length input is truncated; a `<script>`-shaped input renders as text). The cap is pre-encode: nothing downstream (`isSafeTabUrl`, the `tab-navigate` gate) checks URL length, and `encodeURIComponent` can expand a non-ASCII query several-fold — acceptable (Chromium and every engine in the table tolerate long URLs), recorded so nobody mistakes the cap for a URL-length guarantee.
- **One viewless constructor.** All three ways a welcome tab comes into being — the `openNewTab` resolver (DD4), `navigate()` on a search with no engine, and the context-menu `sel:search` path (which calls `createTab` directly today, `renderer.js:892`) — go through a single `openWelcomeTab({ container, reasons, pendingQuery })` in `tab-controller.js`. `createTab` is never special-cased for a null URL; it keeps validating a real URL on every call. So the app has exactly two strip-record constructors (`createTab` with a view, `openWelcomeTab` without) plus the DD2 attach, and `sel:search` switches from `createTab(toUrl(...), srcContainer)` to `toUrl` → `openWelcomeTab` when the engine is unset.
- Rationale: the mission's own lean (session restore persists `tab.url`; a URL-borne query would resurrect an uncommitted search after a restart). Chrome-held state on the record avoids it by construction and needs no `isInternalPageUrl` search-param ruling. A single constructor keeps the viewless record's shape in one place (design review: a `createTab(null)` special case would have been a silent third construction path).

**DD4 — Cache unification and coalescing removal (claims squawk 0005).**
`homePageCache` gets the `searchEngineCache` shape: an explicit boot seed (`settingsGet('homePage').then(setHomePage)` beside `window-controller.js:127`), a raw setter (`renderer.js:492` drops `|| HOMEPAGE`), the `!== undefined` broadcast guard (already present at `window-controller.js:139`). The `HOMEPAGE` constant is deleted with its three sites (`renderer.js:49`, `:492`, `:1549`); `currentHomePage()` returns `string | null`. `createTab`'s default argument (`= currentHomePage()`) is replaced by an explicit `openNewTab(container?)` resolver used by every "new tab" call site — `+` pill (`navigation-controller.js:310`), Ctrl+T (`shortcut-controller.js:54`), last-tab backfill (`tab-controller.js:674`), burner (`renderer.js:792`), existing jar (`:798`), new jar (`overlay-menus.js:145`), and the boot path (`renderer.js:1549`, which keeps its own `settingsGet` for the first tab) — resolving `homePage ?? welcome`. `toUrl`'s `|| 'google'` (`navigation-controller.js:105`) becomes the DD3 null return. **Cache contract** (both caches): source of truth = main's settings config; rebuild triggers = boot seed + every `settings-changed` broadcast; maximum staleness = one IPC round-trip; every settings mutation invalidates (all paths funnel through `broadcastSettings`).
- Rationale: one sanctioned cache shape; `homePageCache`'s defective shape stops existing rather than being documented as a known-bad exemplar. Tests: the `window-controller` harness gains a `homePage` key and asserts the boot seed; a positive-control test asserts no `google.com` / `HOMEPAGE` literal remains in `src/renderer/` outside the shared table.

**DD5 — Fresh-profile defaults flip to unset; schema version stays 3.**
`DEFAULTS.homePage = null`, `DEFAULTS.searchEngine = null`. No version bump: Flight 1's pin-on-load already wrote both keys explicit into every existing profile, so there is no on-disk population a ladder transform would need to reach, and a stamp-only v4 would be a second departure from the ladder convention with nothing to force. Row-less profiles get their resolved defaults (now `null`) persisted at first load by the unchanged pin mechanism. Repair-to-default now repairs an unknown or corrupt engine to **unset** — criterion 10's "without silently selecting a provider". Flight 1's repair tests that assert `'google'` / `'https://www.google.com'` as the repair or default target are renamed (not deleted) to assert `null` — roughly a dozen assertions across `test/unit/settings-store.test.js` (design review located them around lines 88, 98, 228, 1190, 1300–1341, 1369–1611; a raw grep returns ~60 hits, most of them legitimate curated-id round-trips) — leg 2 counts them directly rather than budgeting off the estimate. The DD8 red-when-neutered set is unchanged.
- Consequence for `search-engine-upgrade`: with DD4 in place its step 2 is true as authored (the boot window's first Ctrl+T honors the home page); re-running it on this flight's build closes squawk 0006 without re-authoring.
- Trade-off: a corrupt-row profile that previously repaired to Google now lands on the welcome surface — the correct outcome by the mission's ruling.

**DD6 — Clear affordances in Settings: no confirmation, inline explanation.**
Home page: a "Clear" button beside Save (`settings.html` `#appearance`), writing `settingsSet('homePage', null)`; the field empties and the status line reads "Cleared — new tabs will open the welcome page until you set one." Search engine: a "Clear" button beneath the radio group; the group renders with no radio checked (Flight 1's accepted rendering) plus the hint "No search engine chosen — the welcome page will ask the first time you search." Both `settings.js` truthy guards (`:133` load, `:152` broadcast) become nullish-aware so a `null` broadcast clears the field instead of leaving stale text.
- Rationale: the mission's worry (the user may not connect clearing with new-tab behavior) is met by saying so where the click happens; a modal for a reversible one-click action costs more than the action. The controls stay adjacent and independent — each writes exactly one key.

**DD7 — Welcome panel content.**
A heading and one or two blocks driven by `reasons`: **Home page** (text input + "Set"; hint: "Or just type an address above.") and **Search engine** (the eight-engine radio list with descriptions from `src/shared/search-engines.js`, rendered with `createElement`/`textContent`; when a pending query exists the block's heading reads `Where should we search for "<query>"?` and choosing runs it). Both blocks on first launch. A burner-jar welcome adds one line: "This choice is saved for all of Goldfinch." Setting one preference never touches the other; a block disappears when its preference is set by any path (broadcast-driven), and the tab stays a welcome tab until it navigates or until nothing is missing — in which case it attaches to the home page if one is now set, or remains an empty new tab with the address bar focused. Presentable and unstyled; Flight 3 owns the look.
- **Layout**: the panel is a chrome DOM element positioned over the guest slot rect — the same rect `measureWebviewsSlotDIP()` reports for views — toggled in `activateTab` when the active tab is a welcome record. The only existing full-chrome overlay (`#lightbox`) covers the whole window, so this is new layout work, sized as such in leg 1 (design review).
- **Affordance hygiene on a viewless tab** (design review): `updateNavButtons` (`navigation-controller.js:57-67`) forces Back/Forward disabled when `tab.wcId == null` (today it relies on an `onTabNavState` push that never fires for a viewless tab); the Media/Shields/DevTools toolbar buttons (`tab-controller.js:756-759`) disable on `wcId == null` as well as on internal — **extracted into a named `applyToolbarAffordances(tab)` and called both from `activateTab` and from the wcId-arrival continuation beside `updateNavButtons()`** (design review cycle 2: the block lives only in `activateTab`, and `createTab` activates synchronously while `wcId` is still null, so gating it without re-running it on arrival would leave every ordinary tab's buttons disabled until the user switched away and back; a positive-control test pins "buttons re-enable once `wcId` arrives on an ordinary tab" — no existing test asserts `.disabled` on these three); the tab-context model (`src/shared/tab-context-model.js`) omits `duplicate` / `move-new-window` / `move-window:*` when `wcId == null` (their dispatches already no-op — the items must not render as live controls). A welcome tab shows no dead controls.

**DD8 — Welcome tabs are not tearable or movable until they have a view.** Every stage of a cross-window move is keyed on a live `wcId` naming a `tabViews` entry on the main side — `dragstart` refuses on `tab.wcId == null` (`tab-controller.js:158`), `requestTearOff` refuses (`:589`), `onAdoptTab` requires a numeric `wcId` (`:872-874`, "construction is not an option"), and `tab-tear-off` / `tab-adopt-by-drop` / `tab-move-to-window` resolve identity through the view registry (`register-tab-ipc.js`, `move-tab-payload.js:39`). A welcome record is never in `tabViews`, so these guards already refuse it with no new code; the flight only makes the refusal honest by omitting the three move items from the tab-context menu (DD7 hygiene) and pins it with a unit test. After DD2 attaches a view the tab is an ordinary web tab and moves normally. `cross-window-drag` row 5b (internal refused) is unaffected.
- Rationale: viewless-record transfer would be new main-process work (teaching the registry about a transferable non-view record) with no criterion behind it. A user who wants a welcome tab elsewhere presses Ctrl+T there. Note the `dragstart` guard is coarser than cross-window transfer: it refuses the whole native drag gesture, so same-window **mouse** reorder of a welcome tab is also refused (keyboard reorder, Ctrl+Shift+Arrow → `commitTabMove`, still works — no criterion is affected).
- Trade-off: an uncommitted pending query cannot be carried to another window — it was never run; the panel shows it, and the user can retype it.

**DD9 — Welcome tabs are never restored or captured.** No view → `session-snapshot.js:38` and `closed-tab-capture.js` never see them (positive jar-and-view allowlist). On relaunch: with `restoreTabs`, nothing is added; without, the boot resolver opens a welcome tab when the home page is unset. Closing a welcome tab discards an uncommitted pending query — acceptable, it was never run. A unit test pins snapshot exclusion with a viewless record.

**DD10 — `openSiteSettingsTab` finds `goldfinch://settings` specifically** (`overlay-menus.js:118`), not any internal tab. Under DD1 a welcome tab cannot be hijacked, but the predicate is wrong on its own terms (it would grab a Downloads, Jars, or Vault tab); it gains its first unit test.

**DD11 — Behavior-test apparatus, premise-audited per widget on both axes.**
- *Act*: the welcome panel and address bar are chrome DOM → `click` / `typeText` / `pressKey` on the chrome wcId (proven 2026-08-24 on the address bar; `evaluate` on the chrome is permitted for rects). Settings clear buttons and radios → `click` at guest coordinates on the Settings tab (proven), reached via the `kebabActionSettings` seam (`openTab`/`navigate` refuse `goldfinch://`). Fresh-profile fixture: empty `XDG_CONFIG_HOME` scratch + `dev:automation` with `DEV_MINT` + `ADMIN` (proven). Quit/relaunch: the Orchestrator-driven `session-restore` procedure (proven).
- *Observe*: `captureWindow` (whole window: strip title, address bar, panel) + chrome `readAxTree`; Settings state via guest `captureScreenshot` + `readAxTree`; the stored row via `sqlite3` on the scratch `app.db`; the committed URL via `evaluate` of `#address.value` on the chrome (a11y `value` is build-dependent — rendered pixels are the primary evidence). "Never sends a query to an unchosen provider" is observed as: no tab ever commits a provider URL and the address bar never shows one before a choice.
- *Unreachable*: the page-context "Search for …" item (sheet outside `AUTOMATABLE_MENU_TYPES`) — its no-engine path is an **operator-performed** row (the suite's convention — AUTHORING.md defines no bracket marker for it), named as such in the spec with the apparatus reason (Flight 1's lesson; squawk 0007 set the precedent).
- Specs authored with this flight (drafts): `welcome-home-routing`, `welcome-search-handoff`, `welcome-first-launch`. Existing specs claimed: `new-tab-default-routing` (re-run — its routing paths are rewritten; the most threatened), `search-engine-upgrade` (re-run — closes 0006), `search-engine-preference` (regression re-run). Not engaged, recorded rather than left implicit: `internal-tab-menus`, `tab-scheme-guard` steps 8–13, `internal-session-exclusion`, `cross-window-drag` 5b, `session-restore` — no internal origin is added and no internal-page gate changes; their surfaces are byte-identical.

**DD12 — Refusal claims are executable.** Every absence assertion carries a positive control: the no-`HOMEPAGE`-literal scan, the `toUrl`-returns-null-without-engine test, the viewless-record snapshot exclusion, the repair-to-null tests, DD2's "same tab, same index" test, DD3's pending-query cap and `textContent` rendering test, and DD8's "welcome tab refuses tear-off and omits the move items" test.

### Prerequisites

- [x] Mission 16 active; Flight 1 completed and merged to `main` (`ab349ea`, PR #165)
- [x] Flight branch `flight/02-welcome-surface` created at flight start
- [x] Automation surface live before behavior-test runs — decay-prone, probe at run time (`npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1`; port may fall back)
- [x] Fresh-profile scratch fixture procedure (empty `XDG_CONFIG_HOME`) and the out-of-band relaunch procedure — both proven 2026-08-24
- [x] Recommended, not blocking: complete squawks 0007 and 0008 as a turnaround before this flight's acceptance gate so the runs inherit the crew-file apparatus notes

### Pre-Flight Checklist

- [x] All open questions resolved (branding routed to Flight 3)
- [x] Design decisions documented
- [x] Prerequisites verified (two are run-time)
- [x] Validation approach defined
- [x] Legs defined (tentative)

---

## In-Flight

### Technical Approach

Two legs, each a coherent slice with its own tests, docs, and behavior run. Leg 1 builds the surface and the home-page half: the viewless welcome record via the single `openWelcomeTab` constructor, the attach primitive in `tab-controller.js` / `navigation-controller.js`, the viewless-tab affordance hygiene (nav buttons, toolbar buttons, tab-context move items — DD7/DD8), the welcome panel and controller in the chrome, the chrome-bridge write channel, cache unification with the `HOMEPAGE` constant and its three sites deleted, the `openNewTab` resolver across every new-tab call site, the Settings home-page Clear with both guard fixes, and the `openSiteSettingsTab` fix — verifiable end-to-end on an existing profile by clearing the home page. Leg 2 builds the search half and flips the defaults: `toUrl`'s null return and the pending-query handoff from both entry points, the engine block on the welcome panel with auto-run, the Settings engine Clear, `DEFAULTS` to `null` with repair-to-unset and the renamed tests, and first-launch both-unset. Every renderer change follows the factory-deps pattern; the panel renders from the shared table with no duplicated engine data (Flight 1's structural test extended to the chrome). CLAUDE.md's Settings-store and tab sections are updated in the leg that changes them.

### Checkpoints

- [x] Leg 1 green: on an existing profile, clearing the home page makes every new-tab path (Ctrl+T, `+`, burner, new jar, second window, boot) open the welcome surface in the same jar; typing an address on it navigates that same tab; setting the home page from the panel or Settings restores normal new tabs; `npm test` / typecheck / lint green; `welcome-home-routing` passes; `search-engine-upgrade` passes as authored (squawk 0006 closed)
- [x] Leg 2 green: a search with no engine lands on a welcome tab carrying the query and runs it once an engine is picked; a fresh profile boots to a both-unset welcome with an explicit `null`/`null` row; `welcome-search-handoff`, `welcome-first-launch`, `new-tab-default-routing`, and `search-engine-preference` pass; suite green

### Adaptation Criteria

**Divert if**:
- The attach primitive cannot share `createTab`'s wcId-arrival continuation without structural surgery to `tab-controller.js` (the record/view lifecycle turns out to assume a view from birth in more than the enumerated `wcId != null` guards)
- A new-tab call site cannot be routed through the resolver without changing a jar-resolution rule (burner / default-jar semantics are `new-tab-default-routing`'s contract and must not move)
- The chrome-bridge write cannot be confined to the two keys with `settings.set`'s own validation as the only gate

Leg design must re-check directly (design review could not complete this pass): the current `toUrl` fallback cases in `test/unit/navigation-controller.test.js` and `test/unit/tab-controller.test.js`'s `currentHomePage` dependency on `createTab`'s default argument — both are rewritten by DD4.

**Acceptable variations**:
- Panel copy, layout, and control shapes (button vs link for Clear; where the burner note sits)
- Whether the engine block on a home-only welcome is offered as a secondary "also choose a search engine" affordance (not required by any criterion)
- Whether `openNewTab` lives in `tab-controller.js` or `renderer.js`

### Legs

> **Note:** Tentative; legs are planned and created one at a time as the flight progresses.

- [x] `welcome-surface-and-home-routing` — viewless welcome record via `openWelcomeTab` + attach primitive (DD1/DD2/DD3-constructor), viewless-tab affordance hygiene and the tear-off refusal test (DD7/DD8), welcome panel with the home-page block (DD7), chrome-bridge write channel, cache unification and `HOMEPAGE` removal (DD4, squawk 0005), `openNewTab` resolver across all new-tab sites, Settings home-page Clear + guard fixes (DD6), `openSiteSettingsTab` fix (DD10), snapshot/closed-tab exclusion tests (DD9), **publish `openNewTab` in the chrome `evaluate` closed set (`renderer.js` `Object.assign(globalThis, …)`) with the FD-ruling comment CLAUDE.md requires** — `welcome-home-routing` step 5 depends on it; runs `welcome-home-routing` and re-runs `search-engine-upgrade` (closes 0006)
- [x] `search-handoff-and-fresh-defaults` — `toUrl` null return + pending query (length-capped) from the address bar and `sel:search` → `openWelcomeTab` (DD3), engine block with auto-run (DD7), Settings engine Clear (DD6), `DEFAULTS` flip + repair-to-unset + renamed tests (DD5), first-launch both-unset; runs `welcome-search-handoff` and `welcome-first-launch`, re-runs `new-tab-default-routing` and `search-engine-preference`

No HAT leg: Flight 3 is the mission's alignment flight for this surface's look and feel.

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged
- [x] Tests passing
- [x] Documentation updated

### Verification

- `npm test`, `npm run typecheck`, `npm run lint` green — with wall-clock recorded beside the count in every gate entry
- `/behavior-test welcome-home-routing`, `welcome-search-handoff`, `welcome-first-launch` pass
- Re-runs: `search-engine-upgrade` (as authored — closes 0006), `new-tab-default-routing`, `search-engine-preference`
- Positive-control scans: no `HOMEPAGE` / `google.com` literal in `src/renderer/` outside `src/shared/search-engines.js`; `settings-store` repairs an unknown engine to `null`
- Not engaged (recorded): `internal-tab-menus`, `tab-scheme-guard`, `internal-session-exclusion`, `cross-window-drag`, `session-restore` — no internal origin or gate changed
