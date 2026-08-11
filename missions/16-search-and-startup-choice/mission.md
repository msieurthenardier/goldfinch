# Mission: Search and Startup Choice

**Status**: active

## Outcome

Goldfinch stops sending users to Google without asking. Where a search goes and where a new tab starts become two separate, user-owned choices — related enough to sit side by side in Settings, independent enough that setting one never sets the other.

A user who already has Goldfinch installed sees nothing change: their searches keep going to Google and their home page stays exactly as they set it. What changes for them is that the Google default stops being invisible — it becomes an explicit, visible choice they can see and change.

A user installing Goldfinch for the first time has neither preference set, and Goldfinch never guesses. The first time each choice actually matters — opening a new tab with no home page, running a search with no engine, or both at once on first launch — a branded Goldfinch page appears offering to set exactly the preference that is missing. The page is not a gate: the address bar and bookmarks work normally on it, so a user can simply browse away and choose later. A search typed before an engine was chosen is not thrown away; picking an engine runs it.

Broadens GitHub issue [#37](https://github.com/msieurthenardier/goldfinch/issues/37) (configurable search engine) into the full de-defaulting outcome, per planning conversation 2026-08-09.

## Context

Goldfinch positions itself on privacy — Shields, cookie-jar identities, fingerprint farbling — while hardcoding Google in three places:

| Location | What it sets |
|---|---|
| `src/renderer/chrome/navigation-controller.js:98` | The address-bar search URL (hardcoded, no preference at all) |
| `src/main/settings-store.js:52` | `homePage` default |
| `src/renderer/renderer.js:46` | `HOMEPAGE` fallback const behind `currentHomePage()` |

Issue #37 addressed only the first. Closing just that would leave a user who picks DuckDuckGo still landing on Google on every new tab, every burner tab, and every new-jar tab (`renderer.js:777`, `renderer.js:783`) — the preference would be real but the experience would still be Google's. The outcome above closes all three.

**Two findings from planning research shape the work:**

**The page context menu comes along for free.** The "Search for *selection*" item (`src/shared/page-context-model.js:103`) dispatches through the same `toUrl` as the address bar (`renderer.js:877`). One fix changes both entry points — no extra implementation, but a second surface to verify.

**Network search suggestions do not exist, so excluding them is genuinely free.** `omnibox-suggest-model.js` merges local history and bookmarks only. There is no suggest endpoint anywhere in the codebase; excluding suggestions costs nothing and breaks nothing.

**The home page is the new-tab page.** Goldfinch has no Home button; `createTab(url = currentHomePage(), …)` (`tab-controller.js:256`) makes the home page the default target of *every* tab creation — Ctrl+T, burner, new-jar. So "home page" is a startup preference in name and a new-tab preference in effect, and unsetting it changes what every new tab does.

**A concrete trap in that same default.** `createTab` validates `trusted ? isInternalPageUrl(url) : isSafeTabUrl(url)` (`tab-controller.js:263`), and `isSafeTabUrl` rejects `goldfinch://` by design. An unset home page that resolves to a `goldfinch://welcome` URL through the **default argument** therefore takes the untrusted branch, fails validation, and returns `null` — no tab opens at all. Resolving unset → welcome must also select the trusted branch, and it must do so without letting web content reach the same path (provenance is the call site, never the URL — that rule stays).

**Google is coalesced back in at three more places than the hardcoded defaults.** Beyond the three defaults above, the idiom `value || HOMEPAGE` re-substitutes Google whenever a stored home page is empty: `currentHomePage()` (`renderer.js:48`), the broadcast handler `setHomePage` (`renderer.js:478`), and the boot path `createTab(url || HOMEPAGE)` (`renderer.js:1534`). Any one of them left alone silently defeats an unset home page. This is why "clearing the home page" is not a Settings-only change — found by architect review, 2026-08-09.

**The architectural obstacle.** `isInternalTab` (`tab-controller.js:779-786`) is a single boolean, consulted at roughly thirty sites, that conflates two different ideas: *this content is trusted* and *this tab has no browsing affordances*. Architect review established that the internal-tab treatment spans **at least seven independently-flippable behaviors**, not the two the mission originally named — six gated by `isInternalTab`, one gated by the URL:

1. `navigate()` reroutes a typed URL into a **second** tab (`navigation-controller.js:79-86`)
2. read-only address bar — gated by `isInternalPageUrl(url)` on the **URL**, not by `isInternalTab` (`navigation-controller.js:26-32`)
3. bookmarks bar and star suppressed (`renderer.js:194`, `bookmarks-client.js:158`)
4. find-overlay restore suppressed (`tab-controller.js:721`)
5. media / privacy / devtools toolbar buttons disabled (`tab-controller.js:756-771`)
6. omnibox suggestions gated off (`navigation-controller.js:141`)
7. tear-off and cross-window move refused (`tab-controller.js:884`, live-asserted in `tests/behavior/cross-window-drag.md` row 5b)

The welcome page is the first surface in the app that must be **trusted and browsable at once** — it writes preferences through the privileged bridge, yet both of the user's stated escape hatches (type an address, click a bookmark) are exactly what internal tabs disable. It needs a bespoke combination: (1) and (2) must flip — and because (2) keys off `isInternalPageUrl(url)` rather than the tab, no split of `isInternalTab` alone can free the address bar; the surface-class ruling must cover **both predicates** (precedent for a hybrid consumer already exists: `overlay-menus.js:114` checks `isInternalTab(tab) || isInternalPageUrl(tab.url)`). The privileged bridge must stay, and the remaining four are open rulings. Resolving that split is the mission's principal design risk and the reason this is not a one-flight change.

**A new internal page is a three-allowlist change, not one.** `internal-page-map.js` calls this "the three-point internal-module onboarding seam": `INTERNAL_HOSTS` (`url-safety.js:84`) gates the `createTab` trusted branch; `INTERNAL_ORIGINS` (`internal-ipc.js:25`) separately gates the privileged IPC bridge — a page can clear the first and still get `forbidden: non-internal sender` from every bridge call; and `internal-page-map.js` maps the per-host asset routes. `test/unit/internal-page-map.test.js` covers the third; nothing currently exercises the second for a newly added host.

## Success Criteria

- [ ] Address-bar searches go to a search engine the user chose from a curated list; the choice survives restart and takes effect immediately in every open window without a restart. *(behavior-test-backed)*
- [ ] The page right-click "Search for …" item uses the same chosen engine as the address bar — one choice governs both search entry points. *(behavior-test-backed)*
- [ ] Home page and search engine are independent preferences, each settable and clearable on its own, presented adjacent to one another in Settings; setting or clearing either never changes the other. *(behavior-test-backed)*
- [ ] Upgrading an existing profile changes nothing the user can observe: searches still reach Google, the home page stays as it was. The previously implicit Google default is now visible in Settings as an explicit selection the user can change. *(behavior-test-backed)*
- [ ] A newly created profile has neither preference set, and Goldfinch never sends a query to a search provider the user did not choose.
- [ ] When a preference is needed but unset, the user arrives at a branded Goldfinch page offering to set exactly the missing one — new tab with no home page set, search with no engine set, or both together on first launch. *(behavior-test-backed)*
- [ ] A search typed before an engine was chosen is not lost: after choosing an engine, that search runs. *(behavior-test-backed)*
- [ ] The welcome page is not a trap — on it, typing an address navigates that same tab (not a second one) and bookmarks remain reachable, so a user can leave without choosing anything. *(behavior-test-backed)*
- [ ] Adding the welcome surface does not weaken existing internal-page protections: it stays out of browsing history and out of web sessions, web content cannot reach its privileged bridge or forge navigation into it, and every existing internal page keeps its current behavior. *(behavior-test-backed)*
- [ ] Only engines from the curated list can ever be stored; unknown or corrupt stored values repair without blocking startup and without silently selecting a provider on the user's behalf.

## Stakeholders

- **Privacy-motivated users** — the reason they chose Goldfinch is undercut by a silent Google default; this is the gap most visible against the project's own positioning.
- **Existing users** — must be able to upgrade without a working setup being rearranged underneath them.
- **First-time users** — need to reach a usable browser without a detour into Settings.
- **Project maintainer** — the new surface must land inside the established settings, broadcast, internal-page, and menu patterns without eroding the trusted/untrusted boundary; closes issue #37 and more.

## Constraints

- **Home page and search engine stay two preferences.** They sit adjacent in Settings because they are related, but neither is derived from the other and choosing one never implicitly sets the other.
- **Existing profiles are held harmless.** The migration materializes today's implicit Google search default as an explicit stored choice; it does not clear, move, or reinterpret an existing home page.
- **Curated allowlist only.** No user-supplied search URL templates — an attacker-controlled template is an injection vector, and admitting one needs its own security review. Out of scope.
- **No per-jar or per-container search engine** — the choice is app-wide.
- **No network search suggestions or autocomplete.** The omnibox stays entirely local (history + bookmarks).
- **The welcome page is a setup surface, not an onboarding tour** — it offers these two preferences and nothing else. No tips, no feature tour, no account.
- **The welcome page must never gate the browser.** There is no forced choice: the address bar and bookmarks work on it, and a user may browse away and decide later.
- Search URLs are built by substituting an `encodeURIComponent`-escaped query into a curated template; the result remains subject to the existing `isSafeTabUrl` boundary on navigation.
- The pending search query is **untrusted user text** reaching a trusted page. It must be length-capped and escaped, must never be evaluated, and must not weaken the internal-page URL contract.
- Main remains the single writer for settings; every mutation broadcasts `settings-changed` and each surface re-reads through its own path. No snapshots.
- No new storage mechanism — the preferences live in the existing settings document row.
- Existing internal pages (`settings`, `downloads`, `jars`, `vault`) keep their current behavior unchanged; any relaxation is scoped to the new surface, never applied globally.
- `npm test`, `npm run typecheck`, and `npm run lint` stay green.

## Environment Requirements

- Linux desktop with GUI (Electron app; WSL2 host with WSLg or equivalent display).
- Node.js toolchain per repo.
- Running app with the MCP automation surface (`npm run dev:automation`) for behavior tests and accessibility audit.
- A **fresh profile** (separate `userData` path) is required to exercise the unset/first-run criteria, and a **pre-upgrade profile** to exercise the migration criterion. Both need a repeatable setup procedure before the relevant behavior tests can run.

## Open Questions

- [x] **Which engines are on the list?** → **RESOLVED 2026-08-09** (operator, after market research). Ship the eight-engine table below. Rationale: a privacy browser's credibility depends on the *privacy-first* options being present and plausible, not on a token pair; and Google/Bing stay on the list because removing them would substitute the project's preference for the user's, which is the exact failure this mission exists to fix.

  | Engine | Query template |
  |---|---|
  | DuckDuckGo | `https://duckduckgo.com/?q=%s` |
  | Brave Search | `https://search.brave.com/search?q=%s` |
  | Startpage | `https://www.startpage.com/sp/search?query=%s` |
  | Mojeek | `https://www.mojeek.com/search?q=%s` |
  | Qwant | `https://www.qwant.com/?q=%s` |
  | Ecosia | `https://www.ecosia.org/search?q=%s` |
  | Google | `https://www.google.com/search?q=%s` |
  | Bing | `https://www.bing.com/search?q=%s` |

  Notes carried into Flight 1: **Startpage's parameter is `query`, not `q`** — concrete proof the stored shape must be a full template with a substitution point, not a base URL the code appends `?q=` to. Brave, Mojeek, and Qwant/Ecosia (now jointly building a European index) run independent crawlers; DuckDuckGo and Startpage are privacy layers over Bing and Google respectively — worth a one-line description per engine in the UI so the choice is informed rather than a bare list of brands. **Kagi is deliberately excluded**: it requires a paid, logged-in account, so offering it to a signed-out user produces a broken search. **SearXNG is deliberately excluded**: it is instance-specific, so supporting it means accepting a user-supplied URL — which the custom-template constraint rules out of this mission. Both are the obvious first candidates if custom engines are ever revisited. *(Original framing: proposed starting set of Google, DuckDuckGo, Brave Search, Startpage.)*
- [ ] **How does the welcome page get a working address bar and bookmarks bar while staying trusted?** The mission's main architectural decision. Candidate directions: split `isInternalTab` into per-page capability flags; give the welcome page its own surface class; or a narrow carve-out relaxing exactly the two gates. Each has a different blast radius across the ~30 `isInternalTab` sites — and whichever wins must also rule on the URL-keyed `isInternalPageUrl` gate that locks the address bar (Context). **Flight 2 opens with this decision**; it should be taken with an architect review, not inline.
- [ ] **How does the pending query travel to the welcome page?** Chrome-side held state versus riding the URL. Note that `isInternalPageUrl` today checks `pathname` but not search params, so `goldfinch://welcome?q=…` would pass the existing predicate — that contract needs deliberate examination rather than accidental reliance. **Architect review adds a decisive consideration**: session restore persists `tab.url` across a real quit and relaunch (`session-store.js` / `session-snapshot.js`, asserted in `tests/behavior/session-restore.md`), so a query riding the URL would resurrect a never-committed search after a restart unless explicitly excluded. Chrome-held in-memory state, cleared on read, avoids that by construction. Leaning strongly toward chrome-held; Flight 2 confirms.
- [ ] **Should the welcome tab be tearable into a new window, or refused like every other internal page?** (`tab-controller.js:884`). Interacts with pending-query state, which is per-window if held chrome-side. Raised by architect review; belongs to Flight 2's opening decision set.
- [x] **What happens in a burner jar?** → **RESOLVED 2026-08-09** (operator): the **same welcome page**, with no burner-specific variation. Burner and new-jar tabs open `currentHomePage()` (`renderer.js:777`, `renderer.js:783`) like every other tab, and an unset home page sends them to welcome as it does anywhere else. Consequence Flight 2 must handle deliberately: a preference set from inside a burner tab is written **app-wide and persists**, unlike everything else in that session. This is correct — the preference is app-scoped, not jar data (the bookmarks-bar toggle precedent) — but it runs against the burner mental model, so the surface should not imply the choice is disposable. Note also that burner tabs suppress the bookmarks bar independently of this mission, so on a burner welcome tab the address bar is the only escape hatch.
- [x] **What does the Home button do when the home page is unset?** → **RESOLVED 2026-08-09** (operator): **not applicable — Goldfinch has no Home button**, and if one were added it would behave exactly like opening a new tab. Confirmed in code: no home control exists in the chrome, and `currentHomePage()` is consumed only as `createTab`'s default argument. The question collapses into new-tab routing and needs no separate ruling.
- [ ] **Does clearing a preference in Settings need a confirmation or explanation?** Clearing the home page silently changes what every new tab does; the user may not connect the two.
- [ ] **Branding.** What the branded page actually looks like. The only existing asset is `build/icon.png`; a first-run surface likely needs more, and that is design work with no precedent in this codebase. Routed to Flight 3 (alignment) — Flight 2 ships the surface with functional, unstyled-but-presentable chrome.
- [x] **Should the welcome page offer home-page presets?** → **RESOLVED 2026-08-09** (operator): **no — out of scope**, revisit later only if a need appears. Keeps the two preferences cleanly independent and the welcome surface minimal.
- [x] **Does the migration apply to a profile whose home page was never touched?** → **RESOLVED 2026-08-09** (operator): **yes — such profiles keep Google**, accepted knowingly. The user base is currently near zero, so the population this under-serves is negligible, and the alternative (deciding an untouched default was not a real choice and clearing it) would rearrange working installs to fix a mostly hypothetical harm. The trade-off is recorded rather than hidden: a small number of early users will retain a Google default they never actively chose, reachable and changeable in Settings.

## Known Issues

- [ ] **Adding a settings key exercises a test net with a known hole.** [Squawk 0003](../../squawks/0003-mutates-settings-detection-substring.md) (open) records that the broadcast-invariant net's *detection* half matches `settings.set(` by raw substring, so a handler mutating settings via a module-scope helper is never classified as mutating and never checked for a broadcast. Latent today. This mission adds a new settings key and new mutation paths — if any of them wrap the mutation in a helper, the net goes quiet without failing. **Architect guidance**: `searchEngine`'s write paths should reuse the existing `broadcastSettings()` call sites in `register-settings-ipc.js` rather than introduce a new module-scope wrapper, which is precisely the shape the squawk says the detection half would miss. Worth resolving or explicitly noting before Flight 1's write paths land.

- [ ] **`openSiteSettingsTab()` will hijack a welcome tab once welcome tabs are common** — `overlay-menus.js:118` finds a tab to reuse with `[...tabs.values()].find(isInternalTab)`, i.e. *any* internal tab, then navigates it to `goldfinch://settings/#privacy`. Harmless today because internal tabs are rare and deliberate. After Flight 2 routes unset new tabs to welcome, a user with a welcome tab open who clicks the site-info "Privacy settings" link would have that tab silently navigated away — discarding any pending search riding with it. **Pre-existing latent defect that this mission activates**; found by architect review 2026-08-09. The predicate should match `goldfinch://settings` specifically rather than "any internal tab."

- [ ] **`homePageCache` is never boot-seeded — a live defect today, found by Flight 1 design review (2026-08-11).** Its only writer is the `settings-changed` broadcast handler (`renderer.js:478` via `window-controller.js:131`); the boot-time `settingsGet('homePage')` feeds only the first `createTab`. So in any window opened after launch, Ctrl+T/burner/new-jar tabs use the hardcoded Google fallback instead of the user's configured home page until some unrelated settings broadcast lands. (`CLAUDE.md`'s caching description claims otherwise and misled Flight 1's first DD4 draft — correction scheduled in Flight 1 leg 1.) Squawk candidate; Flight 2's coalescing-site rewrite must fix or subsume the seeding, not inherit it.

- [ ] **`settings.js:150` guards the home-page field with a truthy check, not a nullish one** — a future `homePage: null` broadcast (Flight 2's clear affordance) would leave the field showing a stale prior value instead of clearing. Found by Flight 1 design review (2026-08-11); harmless in Flight 1 (nothing broadcasts null yet). Flight 2 must flip this guard when the clear affordance lands.

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are planned and created one at a time as work progresses. This list will evolve based on discoveries during implementation.

- [ ] **Flight 1: Search engine as a preference** — `searchEngine` joins the settings schema with the curated engine → query-template table, an explicit validator restricting it to that table, and the unset state made representable (`homePage`'s validator today rejects the empty string, so "unset" is a schema change for both keys). Search-URL construction moves into shared code; `toUrl` reads a cached engine kept live by `settings-changed`, on the established `homePageCache` pattern, and stays synchronous. Settings gains the engine control adjacent to the home page control. Ships with the engine defaulting to Google so that **nothing in this flight can regress an existing install** — the flip to unset-by-default belongs to Flight 2, alongside the surface that handles unset. Every mechanism here is precedented; this flight carries no unproven work, and it makes the preference real and useful on its own even if Flight 2 were deferred.

  **Two corrections from architect review (2026-08-09), to settle before leg design:**
  - **The home-page "clear" affordance does not ship in this flight.** Criterion 3's *clearable* half is a Flight 2 deliverable. Shipping a clear button here would produce a visibly inert control: the three `|| HOMEPAGE` coalescing sites (Context) re-substitute Google before `createTab` ever sees an empty string, so the field would clear in Settings while every new tab still opened Google. Either those sites move to Flight 1 alongside the validator change, or the affordance waits — the flight must not ship the button without the routing.
  - **The version bump force-writes *both* keys, and this is a novel use of the ladder.** The store's own convention (`settings-store.js:57-58`) is that the ladder exists only for *changed* defaults on *existing* keys; every prior additive key deliberately skipped it. Here the bump exists to force a **write to disk** of values that already equal their defaults, pinning them before Flight 2 changes what "default" means. `homePage` needs this as much as `searchEngine`: an existing profile that never touched its home page is, on disk, indistinguishable from a fresh one — and the resolved ruling above says those profiles keep Google.

- [ ] **Flight 2: The welcome surface** — the branded Goldfinch page, the trusted-and-browsable surface-class decision that lets it host a working address bar and bookmarks bar, the routing that sends an unset new tab or an unset search to it (including burner and new-jar tabs, and including the `createTab` trusted-branch trap noted in Context), the pending-query handoff and auto-run, the home-page clear affordance and its three coalescing sites, and the flip of fresh-profile defaults to unset. Separate flight because it holds the mission's entire risk: it is the first surface to challenge the `isInternalTab` conflation, and getting that wrong can regress internal-page invariants far outside this mission.

  **Opens with the surface-class decision under architect review, before any page is built** — ruling explicitly on all seven `isInternalTab`-gated behaviors listed in Context, not only the address bar and bookmarks bar, plus the tear-off question. Onboarding the page touches all three internal-page allowlists (Context). Existing specs to claim by name rather than leave implicit: `internal-tab-menus` (has an explicit variants extension point), `tab-scheme-guard` (steps 8-13, the internal-scheme reachability boundary), `internal-session-exclusion`, `cross-window-drag` (row 5b), `session-restore`, and `new-tab-default-routing` (asserts the `createTab(currentHomePage(), …)` routing paths this flight rewrites, including the burner fallback — the most directly threatened existing spec). Favourable finding to reuse rather than re-derive: history exclusion is structural (`history-recorder.js:12-19` — scheme allowlist plus a partition that must resolve to a registered jar), so welcome is excluded from history for free as long as it keeps the internal partition.

  **Expect this to be the mission's large flight.** Architect review sizes it at roughly 4-6 legs — surface-class decision, the page itself, three allowlists plus asset routes, routing across ~10 call sites, pending-query handoff, and the two-key default flip. Coherent as one risk cluster, but it should not be assumed to decompose cleanly.

- [ ] **Flight 3** *(optional)*: Alignment — vibe coding session for the branded page's visual design and first-run feel, where human judgment and real-time iteration beat a written spec.

**Execution cadence**: one flight at a time — each is planned, executed, and reviewed with the human before the next flight's planning begins.
