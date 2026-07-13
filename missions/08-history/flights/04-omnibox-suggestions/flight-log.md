# Flight Log: Address-Bar Suggestions

**Flight**: [Address-Bar Suggestions](flight.md)

## Summary

Leg 1 (`suggest-store-and-ipc`) landed: the frecency `suggest` store query,
the `history-suggest`/`internal-history-suggest` IPC twins, and the chrome
bridge (`historySuggest` + d.ts) are in place, unit-pinned per flight
DD3/DD4.

Leg 2 (`sheet-nofocus-and-template`) landed: the menu-overlay manager's
non-focusing open path (DD2 — `noFocus` gate + first-open-only find-hide),
the widened Ch2 close-reason allowlist (DD5 amendment), and the `suggestions`
sheet template (DD1, four-part registration + CSS) are in place, unit-pinned.
No renderer/omnibox wiring yet — that's leg 3.

Leg 3 (`omnibox-wiring`) landed: the omnibox is wired end-to-end — the pure
`src/shared/omnibox-suggest-model.js` decision module (gate, model mapping,
selection clamping, response-time revalidation), the `renderer.js`
suggestions controller (debounced query, keyboard/pointer selection, the full
close-trigger matrix, the grace-timer pointer-activation race, the Ch7/Ch6
ordering fix for suggestion-click navigation), and the `menu-overlay.js`
`onInit` model-shape guard widened to accept the omnibox's object model.
Flight's contributing-criteria behavior is now code-complete; end-to-end
verification (behavior test, 50k-row scale probe) is leg 4.

Leg 4 (`verify-integration`, Developer half) landed: the store-level scale
probe (50k rows, `suggest` timed at 1/2/3/6-char query lengths — all median
≤ ~5ms, well inside the informal ≤10ms bound, with the 1-char uncovered-prefix
path measured explicitly), the CLAUDE.md "Address-bar suggestions" section,
and a README feature line. The behavior test (`/behavior-test
omnibox-suggestions`) and leg landing are reserved for the Flight Director.

**Flight complete.** All four legs landed and closed out: the frecency
`suggest` store query + IPC twins + chrome bridge (leg 1), the sheet's
non-focusing open path + `suggestions` template (leg 2), the omnibox wiring —
pure decision module, renderer controller, close-trigger matrix (leg 3), and
end-to-end verification (leg 4) — 1473 unit tests green throughout, plus the
live two-agent behavior test `omnibox-suggestions` at **7/7**, with two
spec-premise defects found and permanently fixed mid-run (a retention-unsafe
seed window; unresolvable selection-target fixtures). Review passed clean
(`[HANDOFF:confirmed]`). All three flight-contributing criteria close this
flight: the omnibox suggestion criterion (behavior-test-backed, 7/7), the
felt-instant-at-scale criterion (store probe + live 114ms keystroke-to-rows),
and the no-network-egress criterion's suggestion half (closing it fully
alongside F3's search half — recording/search/retention/suggestions are all
local). Flight → `landed`.

---

## Leg Progress

- **2026-07-12 — Leg 4 `verify-integration` (Developer half) landed.**
  **Scale probe**: an uncommitted scratch script
  (`/tmp/.../history-suggest-scale-probe.js`, never part of the repo) opened
  `history-store.js` on a `mkdtempSync` temp dir via the store's own
  `open()`/`recordVisit()`/`close()` API (no hand-rolled schema SQL, no
  explicit transaction — the store's public API is single-connection direct
  writes, matching the flight-1 leg-4 precedent), seeding 50,000 rows across
  90 varied domains/titles and `visitedAt` values spread across ~120 days
  (seed took ~6.7s at ~7,400 rows/s). Then timed `suggest(jarId, query,
  { limit: 6, now })` for 1/2/3/6-char queries, 10 runs each, fixed `now`:
  - `"e"` (1-char — **rides the uncovered-prefix path**: the FTS `prefix='2 3
    4'` index only covers 2/3/4-char terms, so this is a full-token scan, not
    an indexed prefix lookup): median **4.3ms**, max **5.3ms**
  - `"ex"` (2-char, covered): median **4.0–4.3ms**, max **4.2–5.0ms**
  - `"exa"` (3-char, covered): median **3.9–4.7ms**, max **4.3–4.9ms**
  - `"exampl"` (6-char, covered): median **3.9–5.1ms**, max **4.5–5.4ms**

  (two consecutive runs shown as ranges; both comfortably inside the leg's
  informal ≤ ~10ms median bound, including the uncovered 1-char path). An
  earlier domain-pool draft skewed ~20/30 hosts and ~5/20 title words toward
  an `'ex'`-prefix cluster, producing an unrealistic 16–26ms result for the
  short queries (a matched-row fan-out artifact of the seed data, not the
  query); rebalanced to a 90-host pool with only a small deliberate `'ex'`
  cluster (5 hosts) before re-measuring — noted here so the corrected
  methodology is legible, not just the final numbers. Temp dir removed after
  the run (`fs.rmSync`, confirmed no leftover directory).

  **CLAUDE.md**: added a new "Address-bar suggestions
  (`src/shared/omnibox-suggest-model.js`)" section, placed as the sibling
  `###` section immediately after "History store" (before "Internal-bridge
  security model"). Covers: the `suggestions` sheet template (registration
  shape, row markup, index-dispatch click); the `noFocus` regime
  (`deliverInit`'s sole-focus-site status, the Ch1 `opts` flag, the
  pointer-click race the grace timer covers); the full chrome-owned
  close-trigger matrix (activated/escape/input-empty/blur-grace/tab-switch
  incl. the brand-new-tab explicit close/navigation, and the Ch2
  `MENU_CLOSE_REASONS` allowlist); the Ch7-before-Ch6 activated-reset nuance
  (timers always cancelled, items/selectedIndex preserved only on
  `'activated'` for Ch6 to consume); the `suggest` store query as a pointer
  into the existing "History store" section (age-bucketed frecency, its own
  1–10 limit clamp, the 1-char uncovered-prefix note); and the jar/burner/
  internal gates (`shouldQuery`'s focused/!internal/!burner/non-empty
  contract, jar exclusivity via the store's existing per-jar scoping, the
  response-time revalidation gate). Every claim cross-checked against the
  current `renderer.js`, `menu-overlay-manager.js`, `main.js`,
  `history-store.js`, and `omnibox-suggest-model.js` before writing.

  **README**: added one feature line under "Containers / cookie jars"
  (per-jar browsing history + address-bar suggestions, retention/History
  panel pointer, burner/internal exclusion, no-egress note) — the flight's
  first user-visible README change (F1/F3 left README untouched).

  `npm test` (1473 tests, ~1.08s), `npm run typecheck`, and `npm run lint`
  all green post-docs. No commit made (leg convention). **Leg status stays
  `in-flight`** — the behavior test (`/behavior-test omnibox-suggestions`)
  and landing the leg are reserved for the Flight Director (this entry
  covers the Developer half only: scale probe + docs + gates).

- **2026-07-12 — Leg 3 `omnibox-wiring` landed.** The omnibox is wired
  end-to-end. New pure ESM module `src/shared/omnibox-suggest-model.js`
  (zero imports, zero Electron/DOM/clock reads): `shouldQuery` (the flight
  DD5 gate — focused AND !internal AND !burner AND non-empty trimmed value),
  `buildSuggestionModel` (raw `{url,title}` rows → the sheet's
  `{primary, secondary}` shape, `secondary` = defensive-try/catch URL host,
  empty-list → `emptyNote: 'No matches'`, `selectedIndex` clamped to
  `-1..items.length-1`), `moveSelection` (clamped, no wrap), and
  `acceptSuggestResponse` (the response-time revalidation gate — seq match
  AND the gate still holds at arrival). 28 new unit tests: the gate truth
  table, model mapping incl. malformed/non-string URLs and fields, clamps at
  both ends, and the accept/reject matrix incl. a named
  response-after-tab-switch row (an in-flight request invalidated by
  `activateTab`'s seq bump even though the gate would otherwise still read
  true for the new tab).

  `renderer.js` gained the suggestions controller: `overlayMenus.suggestions`
  (registered alongside the other four entries — `ariaTarget: () =>
  els.address`, `refocus` a deliberate no-op per the flight's "no refocus on
  close, ever" pin, `blurClosedAt` written-but-unread — no trigger-click path
  exists for this surface) is the SINGLE SOURCE OF TRUTH for open/closed (no
  local `open` flag, design review Q3 ruling). `openOverlayMenu` gained an
  optional 5th `opts` param merged into the Ch1 payload (today only
  `{ noFocus }`); every existing caller is a 4-arg call and is unaffected.
  The `input` listener on `#address` debounces 100 ms, gates via
  `shouldQuery`, calls `historySuggest({ jarId, query })`, and re-validates
  the FULL gate (`acceptSuggestResponse`) before painting — the
  kebab-while-typing race. The existing lone Enter `keydown` handler grew in
  place: ArrowDown/ArrowUp move the selection and repaint (still `noFocus`)
  when open; Enter with a selection navigates it and closes reason
  `'activated'`; Enter with no selection is the pre-existing code path,
  byte-identical; Escape closes reason `'escape'` without moving focus or
  clearing text. The address `blur` listener arms a 150 ms grace timer whose
  callback re-checks BOTH the captured open-token (a newer session within the
  window must survive) AND `document.activeElement !== els.address` (the
  operator came back) before closing — this is what lets a pointer click on a
  sheet row win the race against the blur it itself causes.

  The Ch7 close-state sink gained a `suggestions` branch with a load-bearing
  nuance surfaced during implementation and not spelled out verbatim in the
  leg contract: main emits channel 7 (close) strictly BEFORE channel 6
  (activated) for the same activation, so a naive "reset items on every
  reason including activated" would empty `suggest.items` before the
  immediately-following Ch6 `sug:<i>` dispatch could read the clicked row's
  URL — silently breaking pointer-click navigation on every click. The
  landed behavior: timers are cancelled unconditionally (incl. `'activated'`
  — required so the grace timer dies the instant a real activation wins its
  race, not 150 ms later); `items`/`selectedIndex` are cleared for every
  OTHER reason, and left intact on `'activated'` for the Ch6 handler to
  consume, which then finishes the reset itself once it has read the target.
  `activateTab` bumps `suggest.seq` unconditionally on every activation
  (invalidating any in-flight response for the previous tab's jar) and
  resets local state; the ordinary case relies on main's existing
  tab-switch sheet-close (no double-send), except the brand-new-tab path —
  `createTab`'s synchronous `activateTab()` call runs before any
  `tab-set-active` IPC reaches main (wcId still `null`), so that branch calls
  `closeSuggestions('navigation')` explicitly. `onTabDidNavigate` and its
  in-page variant both close suggestions (`'navigation'`) when the navigated
  tab is active.

  `menu-overlay.js`'s `onInit` guard (flagged as blocking by leg 2) is
  widened exactly as prescribed: `template = TEMPLATES[menuType] || 'menu'`
  is computed BEFORE the model-shape check, which then branches
  `template === 'suggestions' ? (object, non-array) : Array.isArray(model)`
  — the sheet now renders the omnibox's object model instead of silently
  never rendering it. `index.html` gained the `aria-autocomplete="list"`
  attribute on `#address` and the `<script type="module">` tag for the new
  shared module. `renderer-globals.d.ts`'s `menuOverlayOpen` payload type
  widened to accept either model shape plus the new `noFocus?: boolean`
  field (typecheck fails otherwise — the object model doesn't satisfy the
  old flat-array type). No new chrome CSS (contract item 3 — the dropdown is
  sheet-side, already styled in leg 2).

  One authoring correction applied to the pure module itself: its own header
  comment originally documented "zero ... `Date.now()`" for context, but
  that literal substring would have tripped the leg's own grep-AC
  (`grep -n "Date.now()" src/shared/omnibox-suggest-model.js` expected zero
  hits) — reworded to avoid the literal substring, the same discipline leg 2
  used for the `.focus(` grep-AC in `menu-overlay.js`.

  `npm test` (1473 tests, ~1.1s), `npm run typecheck`, and `npm run lint` all
  green. Grep-ACs verified: `historySuggest` appears only inside the
  controller (one call site, one comment); zero `Date.now()` hits in the
  pure module. No commit made (leg convention).

- **2026-07-12 — Leg 2 `sheet-nofocus-and-template` landed.**
  `menu-overlay-manager.js` gained the DD2 non-focusing machinery: `deliverInit`
  now gates its `view.webContents.focus?.()` call on `!payload.noFocus` (the
  `MenuOpenPayload` typedef widened with `noFocus?: boolean`), and `openMenu`
  now calls `hideFindOverlay()` only on the first open of a session (`wasOpen`
  computed from `currentMenu`'s truthiness at the top, before the
  superseded-close/reassignment) — a model-replace sequence hides the find
  overlay once, a close+re-open hides it again. Five new manager unit pins:
  `noFocus:true` delivers without focusing on both the ready and
  queued-init/pendingInit paths, the no-flag path still focuses exactly as
  before, find-hide fires once across a same-menuType model-replace run and
  again after a close+re-open; all pre-existing manager pins stayed green
  unmodified. `main.js`'s Ch2 (`menu-overlay:close`) handler replaced its
  `toggle|superseded` coercion with an explicit `MENU_CLOSE_REASONS` allowlist
  (`toggle`, `superseded`, `escape`, `blur`, `navigation`, `input-empty`,
  `activated` — mirroring Ch5's `SHEET_DISMISS_REASONS` style; any
  unrecognized reason still falls back to `'superseded'`), with the matching
  `menuOverlayClose` reason-type widening in `chrome-preload.js` and
  `renderer-globals.d.ts`. `menu-overlay.js` registered the FOUR-PART
  `suggestions` template per the leg contract: a new `#sheet-suggestions`
  listbox node + `menuController.register(...)` entry (info-popup shape — no
  `items` getter, `onOpen` focuses nothing), a `NODE_OF_ENTRY` entry, a new
  `else if (template === 'suggestions')` `onInit` dispatch branch, and the
  `TEMPLATES` JSDoc `@type` union widened with `'suggestions'` — plus a
  load-bearing comment at the `TEMPLATES` registry entry (an unregistered
  menuType falls back to the focusing `menu` template). The template renders
  `role="listbox"`/`option` rows from `model.items[i]` (`{primary, secondary}`,
  both via `textContent`), `aria-selected` + `.selected` on
  `model.selectedIndex`, an optional `model.emptyNote` note when empty; row
  click uses the exact `sendActivatedOnce({id: 'sug:'+i})` +
  `menuController.close(suggestionsEntry)` idiom (never raw
  `sendActivated`); own keydown is deliberately NONE (a pointer-focused sheet
  makes Escape a true no-op there, accepted per design review); positioning
  uses only the standard anchor mechanics (no template-specific code).
  `menu-overlay.css` gained the listbox panel chrome (matching `#sheet-menu`'s
  tokens/box), option rows with a primary/secondary type scale, a `.selected`
  highlight, and ellipsis overflow. The file-header comment was refreshed
  (three templates → four). `npm test` (1445 tests, ~1s), `npm run typecheck`,
  and `npm run lint` all green. Grep-AC verified: `grep -n "\.focus(" src/
  renderer/menu-overlay.js` hits are exactly the pre-existing info-popup and
  input-dialog focus calls — zero suggestions-template lines (the template's
  own explanatory comment was worded to avoid the literal `.focus(` substring
  so the grep stays unambiguous). No commit made (leg convention). Note: the
  omnibox payload shape for `suggestions` (`model.items`/`selectedIndex`/
  `emptyNote`) is a nested-object shape, distinct from the other templates'
  flat item arrays — `onInit`'s top-level `Array.isArray(model)` guard was
  left untouched per this leg's explicit no-wiring scope; leg 3 (the actual
  chrome-side sender) must either shape its payload to satisfy that guard or
  widen it — flagged here so it isn't rediscovered as a surprise.

- **2026-07-12 — Leg 1 `suggest-store-and-ipc` landed.** `history-store.js`
  gained `suggest(jarId, query, { limit = 6, now } = {})` with the
  review-probe-verified age-bucketed frecency SQL implemented verbatim
  (unaliased `visits_fts` JOIN, four distinct placeholders `?1`–`?4`, `?1`
  reused for `now` across all four CASE branches), its own
  `SUGGEST_MIN_LIMIT`/`SUGGEST_MAX_LIMIT` (1–10, default 6) distinct from
  the store's general 1–500 clamp, and `now` REQUIRED in the options bag
  (no default, `pruneOneJar`-style TypeError) so the store never calls
  `Date.now()` itself. `history-ipc.js` gained the 6th op —
  `history-suggest` / `internal-history-suggest` — sharing one handler body
  per the twin-registration pattern, injecting `now: Date.now()`, with the
  internal twin registered-but-unused this flight (no consumer yet — the
  omnibox is chrome-only). `chrome-preload.js` gained its first history
  bridge method, `historySuggest` (bare-handle, chrome-trusted, the
  `settingsGet` precedent), and `renderer-globals.d.ts`'s `GoldfinchBridge`
  gained the matching declare. New unit coverage: a ranking truth table in
  `history-store.test.js` (age-bucket boundaries at exactly 4/14/31/90 days
  vs. +1ms falling to the next lower bucket, frequent-old-outranks-recent-
  rare via summed scores, tie-break stability by `url ASC`, per-jar
  isolation, dedupe-by-url keeping the most-recent title, the
  `"exampl"`→`examplezzz.com` token-prefix row, the suggest-specific limit
  clamp, and operator-injection safety) plus registration-surface/
  untrusted-sender/verbatim-string/success-shape/store-failure/twin-parity
  coverage in `history-ipc.test.js`. `npm test` (1440 tests, ~1.15s),
  `npm run typecheck`, and `npm run lint` all green; both grep-ACs
  (zero `${` in `history-ipc.js`; unaliased `visits_fts` + distinct
  placeholders in the suggest SQL) verified by inspection. No commit made
  (leg convention — review/commit is a separate step).

---

### Leg 4 — `verify-integration` (Flight Director half)

- **Status**: landed — **behavior test `omnibox-suggestions` PASS 7/7**
  (run log `tests/behavior/omnibox-suggestions/runs/2026-07-13-00-39-35.md`;
  spec → active). Presence + 114 ms keystroke-to-rows at 50k rows (100 ms
  of it the by-design debounce), jar exclusivity, keyboard AND pointer
  selection arriving at exact URLs, burner gate upstream-of-query, Escape/
  keystream regime — all pixel-verified with independent Validator DB
  cross-checks. Two SPEC-premise defects surfaced and permanently fixed
  mid-run: (1) seed spread must fit the retention window (the startup
  prune ate a 120-day seed — the retention feature working as designed);
  (2) selection targets must be resolvable (live-recorded local fixtures,
  which also re-verified the recording pipeline).

**HAT/debrief carry-forwards from the run** (raw observations, unjudged):
- Click-into-populated address bar does NOT select-all (diverges from
  omnibox convention) — needs a product ruling at HAT.
- Enter-with-no-selection falls through to a search navigation which the
  recorder then writes into history — intended? Should derived
  search/redirect navigations be recorded? (debrief question)
- The sheet has TWO closed states (hidden-class vs view-detached-with-
  stale-DOM) — future sheet specs must judge visibility from pixels.
- Frecency re-scoring from live visits observed working (order shifts
  after visits) — supports the HAT ranking-feel review.

---

## Decisions

*(none yet)*

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Session Notes

- **2026-07-12 (flight design)**: Recon (read-only, flight/03 HEAD)
  established the load-bearing facts: the chrome is a FULL-WINDOW view with
  guests composited on top — a chrome-DOM dropdown would be occluded, so
  the sheet is the only viable surface; `deliverInit`'s unconditional
  `view.webContents.focus()` is the sheet's sole focus site (a `noFocus`
  flag makes a non-focusing template possible); model-replace is
  flicker-free with stale-token drops and the 300 ms suppress window is
  trigger-click-only; in the non-focusing regime NO existing blur/
  outside-click dismissal fires while the operator types (all close
  triggers must be chrome-owned) and a pointer click on a sheet row races
  the address-blur close (grace timer pinned); `sanitizeActivatedValue`
  caps Ch4 values at 24 chars (index dispatch mandatory);
  `history-search` is already chrome-trusted but chrome-preload has NO
  history bridge yet; `openMenu` unconditionally hides the find overlay
  on every call (first-open-only gate pinned). Ranking pinned as
  age-bucketed frecency (mission open question closed).
- **2026-07-12 (design review)**: Architect verdict **approve with
  changes** (single cycle; DD4 SQL probe-verified live incl. the
  bare-title-after-MAX GROUP BY rule; apparatus premises for the behavior
  test verified — chrome typeText works, the sheet is NOT
  internal-session-excluded for admin evaluate). THREE HIGHs applied:
  Ch2 reason allowlist must widen (existing handler coerces everything to
  toggle|superseded); grace-timer needs a token guard (stale timer must
  not close a newer session); historySuggest responses must re-validate
  the full query gate at arrival (the kebab-while-typing race — a stale
  response must never supersede an operator-opened menu). Suggestions
  applied: template registration named load-bearing (unregistered
  menuType falls back to the FOCUSING menu template); DD2 focus claim
  scoped to keyboard/programmatic; seed script uses the store API in one
  transaction; 1–2 char queries added to the scale probe (prefix index
  doesn't cover 1-char terms); suggest limit constant + truth rows;
  no-refocus-on-close pinned; internal twin comment. Flight → in-flight.
