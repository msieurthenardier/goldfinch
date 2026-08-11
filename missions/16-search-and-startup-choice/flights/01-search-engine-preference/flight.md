# Flight: Search Engine as a Preference

**Status**: ready
**Mission**: [Search and Startup Choice](../../mission.md)

## Contributing to Criteria

- [ ] Address-bar searches go to a search engine the user chose from a curated list; the choice survives restart and takes effect immediately in every open window without a restart. *(behavior-test-backed)*
- [ ] The page right-click "Search for …" item uses the same chosen engine as the address bar — one choice governs both search entry points. *(behavior-test-backed)*
- [ ] Home page and search engine are independent preferences, presented adjacent in Settings; setting either never changes the other. *(this flight: the settable half + adjacency + independence; the clearable half is Flight 2 — see DD6)*
- [ ] Upgrading an existing profile changes nothing the user can observe: searches still reach Google, the home page stays as it was. The previously implicit Google default is now visible in Settings as an explicit selection the user can change. *(behavior-test-backed)*
- [ ] Only engines from the curated list can ever be stored; unknown or corrupt stored values repair without blocking startup. *(this flight: validator + repair-to-Google; "without silently selecting a provider" completes in Flight 2 when the fresh-profile default flips to unset)*

---

## Pre-Flight

### Objective

Make the search engine a real, user-owned preference: a `searchEngine` key joins the settings schema restricted to a curated eight-engine table, the hardcoded Google search URL in `toUrl` is replaced by a live-updating lookup through that preference, and Settings gains an engine control adjacent to the home-page control. The engine defaults to Google and the flight force-persists both `searchEngine` and `homePage` to disk for every profile that runs it, so nothing in this flight can regress an existing install — and so Flight 2's flip to unset-by-default reaches only genuinely new profiles. Every mechanism is precedented; this flight carries no unproven work.

### Open Questions

- [x] Stored shape: engine id or full URL template? → DD1 (id)
- [x] How is "unset" represented, given persistence is a JSON document row in SQLite? → DD2 (null)
- [x] Does the home-page clear affordance ship here? → DD6 (no — Flight 2, with the coalescing-site rewrites)
- [x] How do untouched/row-less profiles keep Google across Flight 2's default flip? → DD5 (pin-on-load)
- [x] Behavior-test apparatus, act + observe paths? → DD7

### Design Decisions

**DD1 — Store the engine id; the curated table is a shared module.**
`searchEngine` stores an id (`'duckduckgo'`, `'google'`, …). A new electron-free module `src/shared/search-engines.js` holds the ordered table — `{ id, label, template, description }` per engine, the mission's eight (Open Question 1's resolved ruling, including per-engine one-line descriptions and the Startpage `query`-not-`q` template) — and is imported by both the main-process validator and the renderer's URL construction (precedent: `settings-store.js` already imports `shared/url-safety`).
- Rationale: allowlist-by-construction — a stored value can never smuggle a URL template; upstream engine-URL changes are table edits, not migrations.
- Trade-off: a removed engine id needs repair handling (covered by the existing repair-to-default semantics).

**DD2 — Unset is `null`, for both keys.**
Persistence is a JSON document row in SQLite (`settings-store.js:9-10`) — no columns, so "nullable" lives at the JSON level, where `null` round-trips cleanly. Both keys carry explicit validators (`«null or valid value»`), so the store's documented `typeof null === 'object'` fallback hazard never applies; the `@typedef` widens to `string | null`.
- In this flight `null` is *representable but never default*: `DEFAULTS.searchEngine = 'google'`, `DEFAULTS.homePage` unchanged. The flip to null-by-default is Flight 2's.
- The UI edge is safe (`input.value` has `LegacyNullToEmptyString` semantics) and every `|| HOMEPAGE` coalescing site treats `null` as it treats `''`.
- **The type system is not the safety net** *(design review)*: `jsconfig.json` runs with `strict: false`, so `strictNullChecks` is off and `npm run typecheck` will NOT flag a consumer that skips a null check on the widened `string | null` keys. The real nets are the coalescing-site discipline and the unit tests — leg reviewers must not lean on typecheck for this.
- Trade-off: `homePage`'s validator loosens from "valid URL" to "null or valid URL" one flight before null is reachable from any UI. Accepted — it is exactly the schema change the mission assigns this flight.

**DD3 — No new IPC or mutation path.**
The Settings page writes through the existing `internal-settings-set` handler (`src/main/register-settings-ipc.js:47-49`), which validates via `settings.set()` and already calls `broadcastSettings()`. Zero new handlers, zero new module-scope mutation wrappers.
- Rationale: this is the mission's architect guidance for [squawk 0003](../../../../squawks/0003-mutates-settings-detection-substring.md) — the broadcast-invariant net's substring-detection hole is never engaged because no new mutation shape is introduced. The squawk stays open (its fix is out of scope) but this flight cannot widen its exposure.

**DD4 — Renderer consumption: live cache fed by `settings-changed`, boot-seeded by an explicit read** *(corrected by design review)*.
A module-scope `searchEngineCache` in `renderer.js` beside `homePageCache` (`renderer.js:47-48`), updated live by the same `settings-changed` handler that calls `setHomePage` (`window-controller.js:131`), and **boot-seeded by an explicit `settingsGet('searchEngine').then(setSearchEngine)`** following the `toolbarPins` / `bookmarksBarEnabled` seeding idiom (`window-controller.js:89`, `window-controller.js:120`) — **not** `homePageCache`'s pattern. Design review established that `homePageCache` has *no* boot seeding: its only writer is the live broadcast handler, and the boot-time `settingsGet('homePage')` (`renderer.js:~1500-1512`) feeds only the first `createTab` — so a window opened after a preference change would boot with a stale hardcoded fallback and stay there until some unrelated broadcast landed. Copying that shape would have failed the "every open window" criterion (and behavior spec step 5) outright. `toUrl()` replaces its hardcoded Google line (`navigation-controller.js:98`) with a template lookup from the cached id and stays synchronous. Both search entry points are covered by this one change — the address bar and `sel:search` (`renderer.js:877`) both dispatch through `toUrl`.
- The uncovered `homePageCache` boot-seeding gap is a **pre-existing live defect** (a new window's Ctrl+T/burner/new-jar tabs use the hardcoded Google fallback instead of the user's configured home page until a broadcast happens to land) — logged outside this flight as a squawk, not fixed here. `CLAUDE.md`'s home-page-caching description (which misled the original DD4 draft) gets corrected in leg 1's documentation pass.
- Trade-off: one more module-scope cache in `renderer.js`; the established cost of the pattern.

**DD5 — Schema version 2 → 3; the bump exists to force-persist, and row-less profiles are pinned at load.**
The v2→v3 ladder step stamps the new version and nothing else; `migrated: true` then triggers `load()`'s existing save-on-migrate path, and since `save()` has always serialized the whole config, both keys land on disk explicitly. Additionally — the novel half — a profile with **no settings row at all** gets its resolved defaults persisted at the end of `load()` (best-effort, inside the never-throw contract, same as the existing migration save at `settings-store.js:344-353`).
- Rationale: the mission's resolved ruling — untouched profiles keep Google — plus its architect correction: an existing profile that never touched settings is on-disk indistinguishable from a fresh install, so the only way to distinguish them *at Flight 2* is to pin everyone *now*, when everyone is legitimately Google-by-default. After this flight, "no row" once again means exactly "never ran with the preference system" — which is what Flight 2's unset default should target.
- This is a deliberate departure from the store's documented ladder convention ("only for changed defaults on existing keys" — `settings-store.js:56-58`); the departure and its reason must be documented at the DEFAULTS comment when implemented.
- **Implementation trap** *(design review)*: `migrateStored()` (`settings-store.js:279-296`) is today a single-shot check, not a per-version ladder — its `restoreSession` discard runs whenever `from < DEFAULTS.version`. Naively bumping the version constant to 3 would re-discard `restoreSession` for v2 rows. The v1→v2 transform must be re-guarded on `from < 2` specifically when the v3 rung is added, so a genuine v1-origin row still gets both transforms and a v2 row gets only the stamp.
- Trade-off: every F1-era launch writes a row where previously a read-only profile never did. Accepted: one small write at boot, and the write is the feature.

**DD6 — No home-page clear affordance in this flight.**
Criterion 3's *clearable* half ships in Flight 2 together with the three `|| HOMEPAGE` coalescing-site rewrites (`renderer.js:48`, `renderer.js:478`, `renderer.js:1534`). Shipping the button here would produce a visibly inert control — the coalescing sites re-substitute Google before `createTab` ever sees the cleared value.
- Rationale: keeps this flight at zero regression risk, its whole design premise; settles the mission's first architect correction as the mission text leans.

**DD7 — Behavior-test apparatus: the goldfinch MCP automation surface, both act and observe.**
- **Act path**: drive the Settings page controls and the address bar through the admin MCP (precedent: `settings-controls`, `omnibox-suggestions` specs; multi-window via admin key as in `multi-window-automation`).
- **Quit/relaunch is an out-of-band step, and its precedent is designed-for, not proven** *(design review)*: the MCP transport dies with the process, and `GOLDFINCH_AUTOMATION_DEV_MINT` mints a **fresh admin key every boot** (`app-lifecycle.js:267`) — so spec step 8 requires an Orchestrator-driven relaunch + reconnect + re-mint, exactly as `session-restore` frames it, and `session-restore` itself is authored-but-unrun. The spec carries the explicit procedure and stays honest about first-run risk rather than citing the pattern as settled.
- **Widget commitment** *(design review — was an open variation)*: the engine control is a **radio-group** in the same native-control, ARIA-state philosophy the existing controls use (`toolbarPins`' `aria-pressed` toggles, `bookmarksBarEnabled`'s checkbox), extended to a multi-option exclusive choice — `settings.html` has no existing radio-group to mirror, so this is a new widget shape in that file, kept to plain `<input type="radio">` elements. NOT a native `<select>` — the automation surface has no precedent for driving a `<select>` (`jar-data-surfaces` explicitly routes around one via `evaluate()`), and a radio group's checked state is cleanly observable in the a11y snapshot, which is what the observe path asserts on.
- **Observe path**: rendered chrome state — the address bar's displayed URL after a search commits (network-independent: the assertion is the engine URL + encoded query in the address bar, not the result page's content), the Settings page's rendered selection state, screenshots + a11y snapshots as primary evidence per the authoring guide.
- **Upgrade fixture**: an authentic pre-upgrade profile produced by procedure, not hand-crafted bytes — run the current pre-flight build against a scratch profile, flip one setting to force a v2 row write, quit. Documented as an operator-runnable precheck in the spec's preconditions.
- Two draft specs authored with this flight: [`search-engine-preference`](../../../../tests/behavior/search-engine-preference.md) (fresh-profile flow, criteria 1–3) and [`search-engine-upgrade`](../../../../tests/behavior/search-engine-upgrade.md) (pre-upgrade profile, criterion 4).

**DD8 — Refusal claims are executable (M15 debrief house rule).**
The curated-allowlist acceptance criterion is backed by a unit test that goes red if the membership predicate is neutered: it asserts every curated id is accepted AND a non-curated id (plus structurally hostile values: a URL-shaped string, `''`, an object) is rejected and repairs to default. A validator relaxed to accept arbitrary strings fails the test immediately. Any absence-asserting scan added by this flight carries a positive control.

### Prerequisites

- [x] Mission 16 active; flight branch `flight/01-search-engine-preference` exists
- [x] Engine table content resolved (mission Open Question 1: eight engines, templates, descriptions, exclusion rationale)
- [ ] Automation surface verified live before behavior-test runs: `npm run dev:automation` boots, MCP attaches, admin key mints (probe at run time — decay-prone, per authoring guide)
- [ ] Pre-upgrade profile fixture procedure validated once end-to-end (produce a v2 row from a pre-flight build; see DD7)

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [ ] Prerequisites verified (two remaining are run-time probes)
- [x] Validation approach defined
- [x] Legs defined (tentative)

---

## In-Flight

### Technical Approach

Two legs along the flight's one risk seam: **what is stored** (schema, table, migration, pinning — the hard-to-reverse disk-write half) and **what consumes it** (URL construction, live cache, Settings UI — the reversible half).

Leg 1 lands `src/shared/search-engines.js` and the `settings-store.js` changes: `searchEngine` in DEFAULTS (`'google'`), explicit validators for both keys accepting `null` (DD2), the v3 ladder step and row-less pin-on-load (DD5), with unit tests covering the red-when-neutered allowlist (DD8), migration/pinning matrix (v2 row → v3 pinned; corrupt row → defaults + pinned; no row → defaults + pinned; valid v3 row → untouched), and repair semantics for removed/unknown ids.

Leg 2 wires consumption: `searchEngineCache` + `setSearchEngine` through `window-controller.js`'s existing broadcast handler, the `toUrl` template lookup via `encodeURIComponent` substitution (mission constraint: result stays subject to `isSafeTabUrl` on navigation), and the Settings engine control in `#appearance` adjacent to the home-page input (`settings.html:35-40`) — a radio group (DD7) rendered *from the shared table* (single source: ids, labels, and the one-line descriptions ship from `search-engines.js`, never duplicated in markup). Writes go through the existing `settingsSet` bridge (DD3). Leg 2 also validates the upgrade-fixture procedure and promotes/runs both behavior specs.

### Checkpoints

- [ ] Leg 1 green: schema + migration + pinning land; `npm test`, `npm run typecheck`, `npm run lint` pass; no renderer changes yet — app behavior byte-identical for users
- [ ] Leg 2 green: engine choice takes effect live in every window; both behavior specs pass; suite still green

### Adaptation Criteria

**Divert if**:
- Pin-on-load (DD5) can't be implemented inside `load()`'s never-throw contract without touching `app-db.js` — the persistence seam is outside this flight's blast radius
- The MCP apparatus cannot drive or observe the Settings engine control (act or observe premise fails at the audit in leg 2) — re-plan verification before building more UI

**Acceptable variations**:
- Copy tweaks to the engine descriptions and radio-group layout details (the widget *form* is committed — DD7)
- Splitting leg 2's behavior-test execution into the leg's tail vs a flight-end verification pass

### Legs

> **Note:** Tentative; legs are planned and created one at a time as the flight progresses.

- [ ] `preference-core` — shared engine table, settings schema + validators (null-accepting, curated allowlist), v3 ladder (with the `from < 2` re-guard, DD5) + pin-on-load, unit tests (red-when-neutered, migration matrix), CLAUDE.md settings documentation including correcting its inaccurate home-page-caching description (DD4)
- [ ] `consumers-and-settings-ui` — toUrl lookup + live cache **with explicit boot seed** (DD4), Settings engine radio-group from the shared table (DD7), upgrade fixture procedure, behavior specs promoted and run

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing
- [ ] Documentation updated

### Verification

- `npm test`, `npm run typecheck`, `npm run lint` green
- `/behavior-test search-engine-preference` passes (fresh profile: explicit Google default visible; engine switch live in both entry points and a second window; survives restart; home-page independence)
- `/behavior-test search-engine-upgrade` passes (authentic v2 profile: nothing user-observable changes; Google now explicit in Settings; row pinned at v3 with both keys explicit)
- Unit suite demonstrates the allowlist test reddens when the membership predicate is neutered (DD8 — verified once by hand during leg 1 review, recorded in the flight log)
