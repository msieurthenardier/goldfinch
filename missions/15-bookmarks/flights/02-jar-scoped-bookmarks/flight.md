# Flight: Jar-Scoped Bookmarks

**Status**: completed
**Mission**: [Bookmarks](../../mission.md)

## Contributing to Criteria

- [x] Bookmarks are scoped to the cookie jar that owns them: the bar, the star, and address-bar suggestions reflect only the active tab's jar, switching contents when the active tab's jar changes; no bookmark data or indicator crosses a jar boundary. *(behavior-test-backed)*
- [x] Bookmarking is inert in burner jars (no star, no bar), and deleting a jar removes its bookmarks with it. *(behavior-test-backed)*
- [x] *(re-verified, not re-earned)* Bookmarks — including their names, order, and site icons — survive an app restart; corrupt stored bookmark data repairs to an empty list without blocking startup, and individually invalid entries are dropped while valid ones are kept.
  - Met in Flight 1 against the JSON-document store. This flight **changes the mechanism** that satisfies it, and degenerates one of its two clauses (see DD4), so the criterion must be re-verified rather than assumed to carry over.

---

## Pre-Flight

### Objective

Move bookmark ownership from the application to the cookie jar. The store leaves the `documents` blob for a real `bookmarks` table keyed by `jar_id`, every IPC channel becomes jar-addressed, `bookmarks-changed` gains a jar dimension, and the chrome consumers (star, bar, overflow, omnibox, and the favicon back-fill writer) re-derive against the active tab's jar — adding tab activation as a new re-derive trigger alongside navigation and broadcast. Burner and internal tabs become inert for bookmarking and suppress the bar; deleting a jar takes its bookmarks with it, and a new Bookmarks data class makes bulk clearing explicit. Existing app-scoped bookmarks are dropped (clean slate). The flight opens with a `renderer.js` extraction — the line budget has one line of headroom and the Flight 1 debrief asked for extraction rather than a fourth consecutive raise — and closes by folding in the two carry-forward bookmark defects, since both live in files it already opens.

### Open Questions

- [x] **Storage shape with jar export in mind** → RESOLVED as DD1 (operator decision): a real `bookmarks` table in `app.db`, `jar_id` + `position` columns, following the `history-store.js` / `cookie_seen` precedent.
- [x] **Burner bar treatment** → RESOLVED as DD8 (operator decision): the bar is **hidden entirely** in burner tabs, accepting a guest reflow on switches into and out of a burner.
- [x] **Internal-page bar treatment** → RESOLVED as DD8 (operator decision, after design review surfaced that DD7 left it undesigned): internal tabs suppress the bar exactly like burner tabs. Consistent with Flight 1's already-shipped rule that bookmarking affordances are hidden on internal pages; accepts a second class of guest reflow.
- [x] **Do clear-data controls touch bookmarks?** → RESOLVED as DD9 (operator decision): deleting a jar always drops its bookmarks; clearing cookies/storage/cache/history does not; a new explicit **Bookmarks** data class provides bulk clearing.
- [x] **Can a tab's jar change after creation?** → RESOLVED by code interrogation, confirmed by design review: **no live tab is ever re-homed.** The single `.container =` assignment in `src/` (`jars-client.js:24`) is gated on `entry.id === tab.container.id` — a reference refresh, not a re-home. Rename is id/partition-immutable (`jars.js:388-395`). Jar deletion *closes* orphan tabs (`jars-client.js:29-37`) rather than re-homing them. This bounds the new re-derive trigger to activation-class events (DD7) and is load-bearing for the cache design (DD6).
- [x] **Does the full identity wipe drop bookmarks?** → RESOLVED as DD9: **no.** `wipeJarData` is shared by delete-jar and wipe-identity; bookmark deletion is therefore attached to the *delete* call site, never to the shared helper.
- [x] **Where is `jarId` captured for the popover-submit round trip?** → RESOLVED as DD13: at **open**, never at submit. The sheet is a separate renderer and the operator can switch jars while it is open.
- [x] **`RENDERER_LINE_BUDGET` headroom** → RESOLVED (operator decision): extract from `renderer.js` as leg 1, satisfying the Flight 1 debrief's recommendation 5 rather than taking a fourth one-off raise.
- [ ] **Does `position` normalization need to be transactional?** — a reorder rewrites every row's position; a partial write would leave duplicate positions and a nondeterministic order. Settle at leg 2 design (candidate: a single `BEGIN`/`COMMIT` around the reorder loop). Not flight-blocking. Design review notes `bookmarkReorder` has **no renderer call site anywhere** until Flight 3 — build it correctly, but do not spend review budget on a currently-dead path.
- [ ] **Reopen-closed-tab re-homes to the default jar when its jar is gone** (`register-tab-ipc.js:279-287`, `shortcut-controller.js:78-87`), while session restore *drops* the tab (`restore-container.js:21`). **Explicitly deferred** — it is a pre-existing tab-lifecycle inconsistency, not a bookmarks question, and DD7's trigger set is correct either way (both paths are new `createTab` calls). Recorded so a future flight can rule on it.

### Design Decisions

**DD1 — Storage: a real `bookmarks` table in `app.db` (schema v3)**: Choice — bookmarks leave `createDocumentStore('bookmarks')` for a dedicated table with `jar_id` and an explicit `position` column, added via `app-db.js`'s existing `user_version` ladder.
- Rationale: operator decision, taken with jar export as the driving goal. It also matches the only other jar-scoped store in the codebase (`history-store.js`'s `visits` table) and reuses the `cookie_seen` precedent for a jar-keyed table inside `app.db` (`app-db.js:64-73`, factory at `:326-388`) — including its `deleteByJar` shape (`:370`), which is exactly the jar-teardown primitive this flight needs.
- Trade-off: this abandons the document-store pattern Flight 1 deliberately built against, for a list that is realistically a few dozen rows per jar. The compensation is that order and jar become queryable columns rather than array position and blob membership — which Flight 3's drag reordering will exercise directly.
- **Referential integrity is unavailable and its absence is deliberate**: jars live in a `documents` row, not a table, so there is no foreign key to cascade from. Deletion must be explicit (DD9). Recorded so a reader does not assume it was overlooked.
- `app.db` over `history.db` follows M10 F1 DD2's deliberate two-file separation — a corrupt `app.db` must not touch `history.db`. `history-store.js` remains at its own schema v1.
- Schema shape (leg 2 refines):
  ```sql
  CREATE TABLE bookmarks (
    id       TEXT PRIMARY KEY,
    jar_id   TEXT    NOT NULL,
    url      TEXT    NOT NULL,
    title    TEXT,
    icon     TEXT,
    position INTEGER NOT NULL,
    added_at INTEGER NOT NULL
  );
  CREATE INDEX bookmarks_jar_pos ON bookmarks (jar_id, position);
  CREATE UNIQUE INDEX bookmarks_jar_url ON bookmarks (jar_id, url);
  ```
- The `(jar_id, url)` unique index makes DD2's one-bookmark-per-exact-URL invariant a **database constraint scoped to the jar**, rather than a JS-side scan. The same URL in two jars is now legal and expected — that is the feature.

**DD2 — Ordering by explicit `position`, normalized on every mutation**: Choice — display order is `ORDER BY position ASC`; `reorder(jarId, ids)` rewrites positions to a gap-free `0..n-1` sequence.
- Rationale: array index cannot survive the move to rows. Gap-free normalization keeps the sequence canonical, so no reader ever needs to reason about gaps or ties.
- Trade-off: a reorder is O(n) UPDATEs rather than one array rewrite. At personal-browser scale this is the same trade-off Flight 1's DD1 already accepted.
- Flight 1's reorder edge cases carry over verbatim and must be re-expressed against positions: unknown/duplicate ids in the payload are ignored; entries **omitted** from the id list are preserved and appended in their prior relative order. A malformed reorder never drops data.

**DD3 — Store API takes `jarId` as its first parameter**: Choice — `list(jarId)`, `add(jarId, {…})`, `update(jarId, id, patch)`, `remove(jarId, id)`, `reorder(jarId, ids)`, `clearJar(jarId)`, mirroring `history-store.js` exactly.
- Rationale: the id alone must never authorize a mutation — the `deleteVisit(jarId, visitId)` precedent (`history-store.js:484`, "the id alone never authorizes deletion (DD8 jar-scoping)"). Threading `jarId` through every method makes a cross-jar mutation unrepresentable rather than merely unlikely, and makes a *stale* jar reference fail loudly as `not-found` rather than silently mutating the wrong jar's row.
- Trade-off: every call site changes. That is the point of doing this while there are five consumers rather than more.
- Consequence: `bookmarks-store.js` loses its module-scoped in-memory array and becomes a stateless validate-and-query layer. `load(userDataPath)` is retained for shape parity with `init-profile.js:72`'s sibling calls but no longer reads anything into memory.

**DD4 — Corruption and validation split into two distinct mechanisms**: Choice — file-level corruption is handled by `app-db.js`'s existing quarantine-and-recreate; row-level invalidity is handled by validation at read time.
- Rationale: this is the one place where DD1 genuinely changes user-visible behavior, so it is recorded rather than assumed. Under the document store, a corrupt bookmarks payload repaired *only bookmarks* to empty (`bookmarks-store.js:179-187`) and left every other store intact — verified in Flight 1's `bookmarks-bar` checkpoint 12 with real byte corruption. Under a table there is no per-store payload to corrupt independently: a corrupt `app.db` quarantines and recreates the **whole file** (`app-db.js:107-120`, `:235-240`), taking settings, jars, shields, downloads, session, and cookie bookkeeping with it. That is a pre-existing, accepted property of `app.db` (M10 F1 DD2), not a regression this flight introduces — but bookmarks are now inside that blast radius and were not before.
- **The mission criterion stays satisfiable, but one of its clauses degenerates.** "Corrupt stored bookmark data repairs to an empty list without blocking startup" becomes true only in the trivial sense that *everything* repairs to empty. Only the second clause — individually invalid entries dropped, valid ones kept — retains independent meaning after this flight. Stated plainly because the criterion is checked, and a future reader should not mistake the weaker guarantee for the original one.
- What survives unchanged: Flight 1's per-field discipline moves from `validateEntries` to a per-row validator on SELECT — `url` remains DROP-worthy (`isSafeTabUrl` and not `about:blank`), `title` remains REPAIRED (falls back to the row's own url), `icon` remains REPAIRED (must match `/^data:image\//i`, else `null`).
- Trade-off, stated plainly: bookmarks lose independent corruption isolation in exchange for jar-queryable storage. Accepted as part of DD1.
- **Verification consequence**: `bookmarks-bar` checkpoint 12 asserts the *old* mechanism and stops being a valid test the moment leg 2 lands. It retargets to row-level validation. See Verification.

**DD5 — `bookmarks-changed { jarId }`**: Choice — the broadcast payload gains a `jarId`, following `history-changed { jarId }` exactly; it stays invalidation-not-snapshot.
- Rationale: with per-jar data, an unqualified invalidation forces every chrome to re-query a jar it may not be showing. The `jarId` lets a subscriber decide whether the change concerns it.
- Trade-off: `test/unit/broadcast-invariant.test.js` pins `payload: {}` by `deepEqual` in four tests, with the emptiness stated in the test *names*. Those pins must be re-targeted, not deleted — the debrief's "rename-not-delete for pins whose premise shifts" lesson.
- Cross-window correctness this buys: window A on the work jar and window B on the personal jar each ignore the other's mutations, while two windows on the *same* jar still both refresh — which is what Flight 1's `bookmarks-star-sync` checkpoint 9 verifies and must continue to verify.

**DD6 — Chrome cache: a lazily-populated `Map<jarId, list>` with an explicit jar-lifecycle eviction**: Choice — `bookmarks-client.js` holds one entry per jar seen so far; `findByUrl(jarId, url)` stays **synchronous**; a `bookmarks-changed { jarId }` invalidates and re-queries only that jar's entry; a `jars-changed` broadcast **evicts entries for jar ids no longer in the list**.
- Rationale for synchronicity: forced by an existing constraint, not a preference. `refreshStar` (`navigation-controller.js:360-370`) reads `findByUrl` synchronously, and one of its five call sites *is* tab activation (`tab-controller.js:699`). An async lookup would gate the star on an in-flight promise at the exact moment of a tab switch — the most common operation in the app.
- Honest bound on what this buys: the per-jar map does not *eliminate* the wrong-state flash, it bounds it to **first sight of each jar**. A cache miss paints the outline star and an empty bar, then repaints when the query resolves. Subsequent switches to that jar are synchronous.
- Rationale for eviction (design-review finding, HIGH): jar ids are **recyclable**. `jars.js:364-368`'s collision loop checks only live containers, `remove()` (`:402-409`) leaves no tombstone, and `jar-registry-ipc.js:68-72` states outright that "ids/partitions are DETERMINISTIC and REUSABLE once the registry entry is gone." Delete "Work", recreate "Work", and the id is `work` again — a cache without eviction would serve the deleted jar's list to the new jar. That is cross-jar bookmark display, precisely what this flight exists to prevent. `jars-client.js` already fans out on `jars-changed`; this subscribes alongside it.
- **Cache freshness contract**, stated explicitly: source of truth is the main-side `bookmarks` table; rebuild triggers are (a) first read of a jar, (b) `bookmarks-changed { jarId }` for that jar, (c) `jars-changed` eviction for vanished ids; maximum staleness is one broadcast round-trip; invalidating user actions are every bookmark mutation in that jar, jar deletion, and the Bookmarks clear-data class.
- Trade-off: memory grows with jars visited in a session. At a few dozen entries per jar this is negligible.

**DD7 — The new re-derive trigger is activation-class only**: Choice — the bar re-renders on the same choke points as star-sync paths 3/5 and 4/5, plus boot and a jar-matched broadcast. Navigation never re-renders the bar.
- Rationale: verified by code interrogation and confirmed by design review — no live tab is ever re-homed to another jar (see Open Questions). Navigation changes the URL, which affects the star but can never affect which jar's list the bar shows.
- Grep-verified call sites (per the Flight 1 debrief's "carry a grep-verified count in the draft" lesson — leg 3 must re-confirm these before implementing):
  | Path | Location | Class | Star | Bar |
  |---|---|---|---|---|
  | 1/5 | `renderer.js:1418` (`onTabDidNavigate`) | navigation | yes | no |
  | 2/5 | `renderer.js:1449` (`onTabDidNavigateInPage`) | navigation | yes | no |
  | 3/5 | `tab-controller.js:332` (wcId arrival) | activation | yes | **yes (new)** |
  | 4/5 | `tab-controller.js:699` (`activateTab` body — covers switch *and* adopt) | activation | yes | **yes (new)** |
  | 5/5 | `renderer.js:102`→`113` (`onChanged` after broadcast re-query) | broadcast | yes | yes (exists) |
  - Boot render at `renderer.js:575` also stays.

**DD7b — Every bookmark *write* path resolves its own jar, not the active tab's** *(design-review finding, HIGH)*: Choice — the two write paths that do not run from the active tab are enumerated and fixed explicitly.
- **The favicon back-fill writer** (`renderer.js:1491-1492`) issues `bookmarkUpdate` from inside `onTabFavicon` with **no active-tab guard** — unlike `onTabLoading` immediately below it (`:1497`), which returns early for non-active tabs. It therefore fires for background tabs in other jars. Under jar scoping it must resolve `tab.container.id` from the tab that delivered the favicon, never from the active tab.
  - Cache-miss policy for this path: if that jar is not in the cache, **skip the refresh** — do not trigger a fetch. A passive icon refresh is not worth populating a cache for a jar the operator is not looking at, and the next activation of that jar will re-derive anyway.
- **The bar's open-in-new-tab paths** (`bookmarks-bar.js:154` Ctrl+click, `:167` middle-click) both call `createTab(b.url, null, { background: true })`. A `null` container resolves the **current default jar** — or a fresh burner if the burner flag is held (`tab-controller.js:273`). Middle-clicking a work-jar bookmark would open it in the personal jar. Both must pass the active tab's container. The three-arg `createTab` form stays non-negotiable (Flight 1's design-review catch — the two-arg form lands the options bag in the container parameter).
- Rationale: "no bookmark data crosses a jar boundary" is violated by a write as surely as by a read, and both of these are writes that a reader scanning for read paths would miss.

**DD8 — Burner and internal tabs suppress the bar and the star**: Choice — in a burner tab *or* an internal tab, the bookmarks bar is not rendered at all (even when the app-wide toggle is on), the star is hidden, and `Ctrl+D` and the page-context bookmark item are inert.
- Rationale: operator decisions. Burner suppression is the mission's inertness constraint — a bookmark can never be written into a session designed to discard it. Internal suppression was surfaced by design review as an undesigned case: internal tabs carry `container.id === 'internal'` (`tab-controller.js:271-272`), a pseudo-jar that can never own bookmarks, so DD7 as originally written would have silently rendered an empty bar there. The operator chose suppression for consistency with Flight 1's already-shipped rule that bookmarking affordances are hidden on internal pages.
- Trade-off, accepted explicitly: **two** classes of guest reflow — into/out of burner tabs, and into/out of internal pages (which includes every trip to Settings). Both must obey the existing never-animate-guest-layout invariant: instant, but visible movement during ordinary tab switching. This is the flight's most likely source of "is that a bug?" feedback at HAT.
- **All three bookmarking entry points funnel through one guard.** `activateStar` (`bookmarks-client.js:60-67`) already carries the single-choke-point internal-tab check that covers the star, `Ctrl+D`, and the page-context item; adding `tab.container.burner` there covers all three at once. The page-context menu item itself must also be **suppressed** (`page-context-model.js:130` emits `action:bookmark-page` unconditionally) — otherwise it renders "Bookmark this page" and silently does nothing.
- **Defense in depth, main-side** *(design-review finding)*: `register-bookmarks-ipc.js` rejects writes for any `jarId` not present in `jars.list()`. This covers burner ids (minted client-side at `jars-client.js:73-82`, never entering the registry) and `internal` with one rule. It matters because burner jars have **no delete path at all** — a burner row that ever got written would be permanently unreachable garbage.
- Already free: the omnibox is **already** gated on burner (`navigation-controller.js:142`), so suggestions need no new burner work.
- The app-wide bar toggle is unchanged and stays a global display preference, per the mission's revised ruling.

**DD9 — Jar lifecycle: delete drops bookmarks; wipe and clear do not**: Choice — `bookmarksStore.clearJar(jarId)` is called from `jar-registry-ipc.js`'s `handleRemove` (delete jar) and from a new **Bookmarks** entry in `JAR_DATA_CLASSES`. It is **not** added to `wipeJarData`.
- Rationale: `wipeJarData` (`jar-data-lifecycle.js:20`) is shared by two callers with different meanings — `jar-registry-ipc.js:105` (the jar is being destroyed) and `jar-data-ipc.js:137` (`handleWipe`, the full identity wipe where **the jar persists**). Putting bookmarks in the shared helper would silently make the identity wipe destroy them, contradicting the operator's clear-data ruling. Attaching deletion to the delete call site keeps the two meanings separate.
- **Placement inside `handleRemove` matters** *(design-review finding)*: at `jar-registry-ipc.js:97-108`, `jars.remove()` runs first, then `wipeJarData` inside a `try` whose `catch` only sets `wiped = false` and still returns `ok: true`. The bookmark clear must sit in its **own** try/catch keyed on `removed.id`, not inside that block — otherwise a session-wipe failure silently skips it, and orphaned rows plus recyclable jar ids is exactly the resurrection hazard DD6's eviction guards against on the cache side.
- Trade-off: one destructive path is no longer expressible as "call the shared helper" — a future destructive path must remember bookmarks explicitly. Mitigated by a test pinning that `handleWipe` preserves bookmarks while `handleRemove` drops them; both assertions belong in the same test file so the distinction is visible in one place.
- The new Bookmarks class follows the `history` precedent in `src/shared/jar-data-classes.js` (a real ES module in **shared**, consumed by `pages/jars.js` as well as required from CJS): `{ id: 'bookmarks', label: 'Bookmarks', storages: null, custom: 'bookmarks' }` — the null-storages + `custom` discriminator shape, dispatched in `jar-data-ipc.js`'s `handleClearData` (`:60-70`) **before** the storages-null cache fallthrough. The `goldfinch://jars` page renders its data-control buttons *from* this list, so the page side is near-free.
- Broadcast on clear: a `bookmarks` clear emits `bookmarks-changed { jarId }` under the same n>0 gate the history class uses (`jar-data-ipc.js:103`).

**DD10 — Clean-slate migration removes the legacy row**: Choice — the schema v3 step also executes `DELETE FROM documents WHERE store = 'bookmarks'`.
- Rationale: the operator's migration policy is a clean slate, not a translation. Leaving the old blob in place would keep an app-scoped bookmark list on disk after the user believes it is gone — a poor outcome in a product whose jars exist specifically to separate browsing context.
- Trade-off: irreversible. Acceptable per the mission's stated rationale (the feature is days old, with no accumulated user data), and the operator has confirmed it.
- The v3 step must be additive-and-ordered like v1→v2, so a profile at any prior version lands on v3 in one open.
- **A migration bug is currently indistinguishable from file corruption** *(design-review finding, MEDIUM)*: `app-db.js:235-240` wraps `attemptOpen` in `try { … } catch { quarantineCorruptFile(); attemptOpen(); }`. Any throw inside the v3 ladder step — a table-name collision, a failed unique index, a DELETE error — quarantines settings, jars, shields, downloads, session and cookie_seen, and the operator lands in a fresh profile with no signal. Leg 2 must either distinguish a migration-step failure from an open failure, or add a checkpoint that deliberately fails the v3 step and records what is lost. The "Divert if" clause about the unique index assumes the failure is *observable*; today it would be swallowed.

**DD11 — Behavior-test apparatus, both axes audited**: Choice — the new jar-scoping behavior test drives and observes through the existing goldfinch MCP surface, the chrome bridge, and direct database/file inspection via shell; no new test-only seam is added.
- **Act axis** (can the apparatus produce the state under test?): `openTab(url, jarId)` already accepts an explicit jar and **refuses an unknown one rather than silently defaulting** (`tab-controller.js:972-977`) — so a test can place tabs in named jars deterministically, and a typo fails loudly. `activateTab` drives the jar switch. Jar creation/deletion is reachable from the `goldfinch://jars` page. Row injection for DD4's retargeted checkpoint is performed with the app **down**, by direct `sqlite3` write against `app.db` — the procedure `sqlite-store-migration.md` already establishes and `bookmarks-bar.md`'s corruption step already used.
- **Observe axis** (can the apparatus read everything the criteria assert?): per-tab jar ground truth comes from the automation tab enumeration, which already carries `jarId` (`tab-controller.js:968`). Per-jar bookmark truth comes from `window.goldfinch.bookmarksGet({ jarId })` evaluated on the chrome target — the same read path the three Flight 1 specs already use, gaining one argument. Bar and star are read as rendered pixels via `captureWindow` plus the chrome accessibility tree. **Orphaned-row and post-delete assertions are not reachable from the chrome target at all** — they require direct table inspection with the app down, which is why filesystem/shell is an explicitly declared observable rather than an implicit one.
- **Known apparatus limits, inherited and unchanged**: the overlay sheet refuses all automation operations at every tier by design (`automation: secret-sheet`, `src/main/automation/resolve.js`), keyed on the shared sheet `WebContentsView`'s wcId identity. Every step that types into, clicks inside, or dismisses a sheet is **operator-performed**; the agent triggers and observes. There is no window-create and no hover primitive. Budget operator time from the start — the debrief's explicit instruction for this flight.
- Trade-off: the bar-suppression clauses (DD8) are *layout* assertions best carried by before/after capture pairs, and the no-animation clause is structurally uncapturable by stills — it needs live operator observation, per the Flight 1 evidentiary precedent.

**DD12 — Carry-forward defects folded into leg 3**: Choice — the two open bookmark defects from the Flight 1 debrief ship in this flight rather than decaying.
- Rationale: shared-surface bundling per the leg-identification guidance. Both live in files leg 3 already opens.
  - The silent duplicate-URL edit rejection: `handleEditSubmit` (`bookmarks-client.js:79-86`) fires `bookmarkUpdate(...).catch(() => {})`, but `{ok:false, reason:'duplicate-url'}` is a *resolved* value, so the `.catch` never runs and the edit reverts with no feedback. **Newly load-bearing** in this flight: duplicate-URL is now scoped per jar, so the same URL in two jars is legal — making the remaining rejection case narrower, more surprising, and more deserving of a message. It also now shares a code path with DD3's `not-found`, which is how a stale jar reference surfaces.
  - The suggestions-sheet star sizing: the builder emits hardcoded `width="11" height="11"` presentation attributes that defeat CSS sizing (`bookmark-star-icon.js`). Operator-accepted as cosmetic in Flight 1; cheap to fix while the file is open.
- Trade-off: two unrelated-to-jar-scoping changes inside a refactor leg. Kept small and called out in the leg spec so review can separate them from the refactor.

**DD13 — The popover captures its `jarId` at open, never at submit** *(design-review finding, MEDIUM)*: Choice — `openBookmarkEditOverlay` (`renderer.js:659-662`) captures the active tab's `jarId` alongside the bookmark, and that captured value is carried through the sheet round trip to the mutation.
- Rationale: the bookmark-edit sheet is a separate renderer (`menu-overlay.js`), and main forwards the submit payload back to the chrome (`register-overlay-ipc.js:509-527`) which issues the mutation (`bookmarks-client.js:79-86`). The operator can switch to a different jar's tab while the popover is open. Resolving the jar at *submit* time would apply the edit to whichever jar happens to be active then — a TOCTOU with a silent wrong-jar write as its failure mode.
- This is the same TOCTOU discipline `bookmarks-bar.js` already applies to the bookmark object itself (captured in the row closure at build time).
- DD3 makes the residual failure loud rather than silent: a captured jar that has since been deleted yields `not-found`, not a mutation against a different jar.

### Prerequisites

- [ ] Flight 1 merged to `main` and its flight marked `completed` — **verified**: squash commit `d9e764e` (PR #145), flight status `completed`.
- [ ] Mission amended to the jar-scoping ruling — **verified**: commit `2883331` (PR #146).
- [ ] `app.db` schema currently at `user_version = 2` with the ladder mechanism proven — **verified**: `app-db.js:75`, ladder at `:142-169`; the `if (version !== versionRow.user_version)` guard handles 0→3, 1→3, 2→3 and no-ops at 3.
- [ ] No live tab is ever re-homed between jars — **verified**: `jars-client.js:24` is a reference refresh gated on id equality; `jars.js:388-395` rename is id-immutable; `jars-client.js:29-37` closes orphans.
- [ ] The omnibox already refuses burner tabs — **verified**: `navigation-controller.js:142`.
- [ ] `RENDERER_LINE_BUDGET` headroom — **verified as a blocker**: `test/unit/seam-contract.test.js:124` pins 1933; `renderer.js` is at 1932. Addressed by leg 1.
- [ ] Behavior-test environment: app running via the canonical admin dev launch (`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`), admin-tier key confirmed by a successful `getChromeTarget` (not merely tab enumeration), agents attached via `scripts/lib/mcp-client.mjs`'s `connectAutomation()` reading `GOLDFINCH_MCP_ADMIN_KEY` — **never** a static `.mcp.json` entry, which goes stale at the next mint. Probe before the flight lands.
- [ ] `sqlite3` available on the dev host for the row-injection and orphan-check steps.
- [ ] At least two persistent jars, one disposable jar, and a burner reachable for fixtures.
- [ ] **Operator availability** for the HAT leg — all sheet interaction and every animation/layout-absence clause is operator-performed by construction.

### Pre-Flight Checklist

- [ ] All open questions resolved *(one mechanism detail deferred into leg 2 by design; one pre-existing inconsistency explicitly deferred out of scope)*
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

The flight clears headroom first, then moves truth, then consumers, then verifies — because every chrome surface reads through the store's API, and changing that API in the same pass as the surfaces would leave no green state in between.

**Headroom.** `renderer.js` sits one line under a pinned budget. Leg 1 extracts a coherent slice into its own module — no behavior change, no bookmark work — satisfying the Flight 1 debrief's recommendation 5 and giving leg 3 room to work.

**Main side.** `app-db.js` gains schema v3: the `bookmarks` table, its indexes, its prepared statements, a `createBookmarksStore()` factory alongside the existing `createCookieSeenStore()`, and the legacy-row delete (DD10). `bookmarks-store.js` keeps ownership of validation and business rules but is rewritten against that factory — jarId-first API, position-based ordering, per-row validation on read. `register-bookmarks-ipc.js` threads `jarId` through all six channels, rejects ids absent from `jars.list()` (DD8), and broadcasts `bookmarks-changed { jarId }`. Jar teardown attaches to `handleRemove` in its own try/catch; the new Bookmarks data class lands in `src/shared/jar-data-classes.js` and dispatches in `handleClearData`.

**Chrome side.** `bookmarks-client.js` becomes a per-jar map with synchronous `findByUrl(jarId, url)` and a `jars-changed` eviction; `bookmarks-bar.js` renders the active tab's jar, gains burner/internal suppression, and stops passing `null` as its container on the open-in-new-tab paths; `refreshStar` resolves the jar from the tab it is already given; the favicon back-fill writer resolves the *delivering* tab's jar; the popover captures its jar at open; the omnibox adds `jarId` to its `bookmarksSuggest` call, next to the `jarId` it already passes `historySuggest`. The preload bridge signatures and `renderer-globals.d.ts` change in step.

**Verification.** One new behavior spec covers the jar dimension end to end. Existing specs are amended — one of them (`bookmarks-bar` checkpoint 12) because leg 2 invalidates its premise, not because its prose drifted. The six specs deferred at Flight 1 landing are re-run in the HAT leg, closing that open item.

### Checkpoints

- [ ] `renderer.js` extraction lands with the suite green and real budget headroom restored
- [ ] `app.db` steps 0→3, 1→3, 2→3 in one open, no-ops at 3; a v2 profile lands on v3 with the legacy bookmarks row gone
- [ ] Two jars hold the same URL simultaneously, each as its own bookmark, with independent titles and order
- [ ] A bookmark mutation in jar A leaves jar B's stored rows byte-identical
- [ ] Switching the active tab between jars swaps the rendered bar contents and the star state, with no stale frame
- [ ] Burner and internal tabs show no bar and no star; `Ctrl+D` and the page-context item create nothing in either
- [ ] Middle-click and Ctrl+click on a bar item open the new tab **in that bookmark's own jar**
- [ ] A background tab's favicon never writes onto another jar's bookmark
- [ ] Deleting a jar drops its bookmarks; wiping a jar's identity **keeps** them; the Bookmarks data class clears them on request
- [ ] A deleted-then-recreated jar with a recycled id shows an empty bar, not the old jar's bookmarks
- [ ] An invalid row is dropped while its valid siblings render (DD4's replacement for the old corruption checkpoint)
- [ ] Cross-window sync still holds *within* a jar and does not cross *between* jars
- [ ] `npm test`, `npm run typecheck`, `npm run lint` green; suite count and timing recorded for the debrief lineage

### Adaptation Criteria

**Divert if**:
- The `(jar_id, url)` unique index conflicts with real data during migration in a way the clean-slate delete does not resolve — implies an unmodeled duplicate case and needs re-planning rather than a workaround. **Note DD10's caveat**: verify the failure is actually observable before trusting this clause; today a migration throw is swallowed into a quarantine.
- Suppressing the bar on burner *or* internal activation produces visible jank or violates the never-animate-guest-layout invariant in a way that cannot be fixed within leg 3. Fall back to the empty-bar treatment, record the reversal in the flight log, and confirm with the operator — this reverses an operator decision, so it is a diversion, not an acceptable variation.
- Per-jar caching cannot keep `findByUrl` synchronous without a visible wrong-state flash beyond first sight of a jar, implying DD6's premise is wrong.
- The `renderer.js` extraction cannot find a clean seam without behavior risk — escalate rather than taking the fourth one-off budget raise silently.

**Acceptable variations**:
- Which slice leg 1 extracts, provided it is behavior-neutral and leaves genuine headroom.
- The exact transaction boundary for reorder normalization (deferred by design into leg 2).
- Column nullability and index naming, provided `(jar_id, position)` and `(jar_id, url)` are both indexed and the latter is unique.
- Whether the per-row validator lives in `bookmarks-store.js` or is shared with the factory, provided the drop/repair split from DD4 is preserved exactly.
- Wording and placement of any user-facing duplicate-URL message (DD12).

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned and created one at a time as the flight progresses.

- [x] `renderer-extraction` — extract a coherent, behavior-neutral slice out of `renderer.js` to restore real `RENDERER_LINE_BUDGET` headroom, satisfying the Flight 1 debrief's recommendation 5. No bookmark work. **Low-risk** (behavior-neutral, single-surface, established pattern — `bookmarks-client.js` and `bookmarks-bar.js` are both prior extractions from this same file) — proceeds without a design review; the flight-end review still covers it. **Landed 2026-07-31**: vault flow extracted to `src/renderer/chrome/vault-controller.js`; `renderer.js` 1933 → 1527, `RENDERER_LINE_BUDGET` 1933 → 1650; suite/typecheck/lint green.
- [x] `jar-owned-store-and-lifecycle` — app.db schema v3 + bookmarks table + factory; `bookmarks-store.js` rewritten to the jarId-first, position-ordered, row-validating API; all six IPC channels jar-addressed with the not-in-`jars.list()` rejection; `bookmarks-changed { jarId }`; clean-slate legacy-row delete; migration-failure distinguishability; jar-delete teardown wired to `handleRemove` **only**, in its own try/catch; the new Bookmarks data class. Re-targets the pinned tests whose premise shifts. Amends `bookmarks-bar` checkpoint 12, whose premise this leg invalidates. **High-risk** (schema migration + shared-interface break + destructive-path change) — takes a design review. **Landed 2026-07-31**: suite 3278 → 3322; errcode-11 pin resolved with a REAL fixture (header page-count inflation, no fallback needed); see flight-log.md for detail.
- [x] `jar-aware-chrome-surfaces` — per-jar cache map with synchronous lookup and `jars-changed` eviction; star, bar, overflow, omnibox, favicon back-fill writer, and both bar open-in-new-tab paths all jar-resolved; the two new activation-class bar-render triggers; burner and internal suppression of bar, star, and page-context item; popover jar captured at open; preload and `renderer-globals.d.ts` signature updates; plus the two folded carry-forward fixes (DD12). Authors the new `bookmarks-jar-scoping` behavior spec and inverts `bookmarks-omnibox` checkpoint 4. **High-risk** (cache/freshness behavior + it reverses a shipped, behavior-tested assertion) — takes a design review. **Landed 2026-07-31**: chrome fully jar-aware, app runnable end-to-end; `renderer.js` 1527 → 1579 (budget 1650); suite 3322 → 3335; see flight-log.md for detail.
- [x] `hat-and-verification` *(interactive)* — guided HAT over the jar-switch, burner, internal, and lifecycle behavior with inline fixes; run the new `bookmarks-jar-scoping` spec; re-run the three bookmark specs plus `sqlite-store-migration`, `jar-data-controls`, and `jar-data-surfaces`; re-run the six specs deferred at Flight 1 landing, closing that open item.
  - **Landed partially, by operator decision.** The four bookmark specs ran and passed (17/17, 6/6, 14/14, 11/11). The adjacent three and the six Flight-1 deferrals were **not** run — the operator scoped the leg to "mend the spec, run the three amended bookmark specs, and land the flight." **The Flight-1-landing open item this leg was written to close stays open, deferred a second consecutive time.**

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing (suite count and timing captured for the debrief lineage — Flight 1 closed at 3278)
- [ ] Documentation updated — larger than it looks. `CLAUDE.md`'s Bookmarks section states "App-scoped (no jarId)" (`:197`) and pins the empty broadcast payload (`:200`), the cache (`:201`), the five sync paths (`:202`), the duplicate-url minimal presentation that DD12 changes (`:203`), and the bar (`:206`). Its Address-bar suggestions section (`:184-193`) never mentions bookmarks at all, and `docs/renderer-menu.md:26-31,70-75` omits both bookmark sheet families — pre-existing drift, cheap to close while the files are open.

### Verification

**Behavior tests.**

| Spec | Disposition |
|---|---|
| `bookmarks-jar-scoping` | **New.** Jar switch swaps bar + star + suggestions; same URL bookmarked independently in two jars; burner and internal inertness; bar open-in-new-tab lands in the right jar; jar delete drops bookmarks; identity wipe keeps them; Bookmarks clear-data class; recycled jar id shows no stale bookmarks; cross-window sync within a jar and isolation between jars. |
| `bookmarks-omnibox` | **Amended — assertion inverted.** Checkpoint 4 currently *asserts* a personal-jar bookmark surfacing in a work-jar tab, and cites the superseded ruling by name. After leg 3 that behavior is a defect. Anyone re-running this spec between leg 2 and the amendment will see a legitimate-looking failure that is not a regression. |
| `bookmarks-bar` | **Amended — premise invalidated.** Checkpoint 12 corrupts the `bookmarks` **documents row**, which leg 2 deletes. Retargets to row-level validation: with the app down, inject an invalid row beside valid siblings via `sqlite3`, relaunch, confirm the bad row is dropped and the good ones render. Checkpoint 11's restart-persistence assertion also gains a jar dimension. Both axes of the retargeted checkpoint need the DD11 treatment — the act axis (row injection) is the harder half. |
| `bookmarks-star-sync` | **Amended — jar dimension added.** Its checkpoints are single-jar and mostly stand; the cross-window checkpoint 9 must state that both windows are on the *same* jar, and its negative counterpart lives in the new spec. |
| `sqlite-store-migration` | **Re-run, and check for amendment.** The most directly relevant existing spec to DD1/DD10 — step 2 pins JSON→app.db migration and step 7 pins corrupt-app.db → quarantine + fresh defaults, which is now also the bookmarks corruption path. |
| `jar-data-controls`, `jar-data-surfaces` | **Re-run, and check for amendment.** Both are affected by DD9's fifth `JAR_DATA_CLASSES` entry, since the `goldfinch://jars` page renders its buttons from that list. `jar-data-controls` also already pins that wipe/clear reject burner ids. |
| six deferred specs | **Re-run**, per operator decision — `page-context-menu`, `settings-shell`, `settings-controls`, `toolbar-pins`, `omnibox-suggestions`, `menu-overlay`. Closes the Flight 1 landing note's open item. |

**Unit tests.** Migration ladder (0→3, 1→3, 2→3, 3→3 no-op) and legacy-row removal; per-jar isolation on every store method; the `(jar_id, url)` uniqueness constraint permitting the same URL across jars; position normalization including the omitted-entries-preserved edge case; the DD4 drop/repair split per row; the not-in-`jars.list()` write rejection; the cache's `jars-changed` eviction; and — in one file, so the distinction is visible together — that `handleRemove` drops bookmarks while `handleWipe` preserves them.

**Pinned tests whose premise this flight shifts** (re-target, never delete — the debrief's rename-not-delete lesson): `test/unit/broadcast-invariant.test.js` (four tests `deepEqual`-pinning `payload: {}`, with the emptiness in their names), `test/unit/app-db.test.js` (`user_version === 2` at `:145`, `:202`, `:251`, `:276`), `test/unit/bookmarks-store.test.js` (30 tests written against the array/document model), and `test/unit/seam-contract.test.js`'s `RENDERER_LINE_BUDGET`.

**Suggested by design review, non-blocking**: `jars-client.js:24`'s `entry.id === tab.container.id` predicate is the single line that makes DD7 true, and nothing currently pins it. A one-line regression test would make DD7's premise durable rather than incidental.

**Manual.** The HAT leg carries what automation structurally cannot: the instantness of both reflow classes (an absence, uncapturable by stills), the absence of a stale frame on jar switch, and every overlay-sheet interaction.
