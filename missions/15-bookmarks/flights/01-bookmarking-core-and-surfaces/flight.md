# Flight: Bookmarking Core and Surfaces

**Status**: landed
**Mission**: [Bookmarks](../../mission.md)

## Contributing to Criteria

- [x] Star/context-menu/shortcut bookmarking with quick-edit popover and full state sync (nav, SPA, tab switch, cross-window)
- [x] Internal-page gating: bookmarking affordances hidden/inert; bookmarks can never reach an internal page
- [x] Combined startup-and-appearance Settings section with bookmarks-bar toggle (+ shortcut), instant non-animated reflow in every window
- [x] Bookmarks bar: stored order, names + site icons + tooltips, click-to-navigate, middle/Ctrl+click background-tab open, overflow menu, keyboard-operable
- [x] Right-click edit (rename / change URL / remove) on bar and overflow, effective everywhere immediately
- [x] Bookmarks in address-bar suggestions: source-distinguishable, deduped against history, cross-jar
- [x] Persistence: bookmarks (names, order, icons) survive restart; corrupt data repairs to empty; invalid entries dropped individually

*(The drag criterion belongs to Flight 2; this flight retires its riskiest unknown via the cross-surface drag spike.)*

---

## Pre-Flight

### Objective

Deliver the complete non-drag bookmarks feature: a persisted, broadcast-synced bookmark store; the address-bar star with quick-edit popover, page-context item, and keyboard shortcuts; the merged startup-and-appearance Settings section with the bar toggle; the bookmarks bar with icons, overflow, background-tab open, and in-place editing; and bookmarks as an omnibox suggestion source. Along the way, retire the mission's three cross-cutting risks early: the cross-surface drag spike (feeds Flight 2 and the overflow surface decision), the activate-on-create audit (gates background-tab open), and the shortcut-classifier lockstep (gates Ctrl+D / Ctrl+Shift+B).

### Open Questions

- [x] URL-match semantics → DD2
- [x] Icon staleness policy → DD6
- [x] Overflow surface choice → DD9 (provisional, spike-informed; adaptation criteria cover reversal)
- [x] Popover vs. per-field edit dialogs → DD4 (single combined popover, shared with bar edit)
- [x] Background-tab semantics → DD10
- [x] Omnibox merge/rank → DD11

### Design Decisions

**DD1 — Store shape**: New `bookmarks` document store in `app.db` via `createDocumentStore`, Electron-free injected-deps module (`src/main/bookmarks-store.js`). Envelope `{version: 1, bookmarks: [...]}`; entry `{id, url, title, icon, addedAt}`; array order IS display order. Exemplar is `jars.js` (collection with per-entry validation — drop invalid entries, keep valid ones), not `settings-store.js` (whole-config shape).
- Rationale: bookmarks are low-cardinality config-class collection data; the jars store is the proven collection template, including corrupt-envelope → fresh-empty repair.
- Trade-off: whole-document rewrite per mutation is O(n) — accepted at personal-browser scale (architect-reviewed).

**DD2 — URL identity is exact committed-URL string match**: one bookmark per exact URL as the tab record reports it; no fragment stripping, no trailing-slash normalization beyond what the URL stack already does. Star fill, re-star toggling, and omnibox dedup all use this single predicate (shared pure helper in `src/shared/`).
- Rationale: Chrome parity (bookmarking `…#section` and visiting `…` shows an unfilled star in Chrome too); a single exact-match predicate is trivially testable and shared by all three consumers.
- Trade-off: near-duplicate URLs can coexist as separate bookmarks — same as every major browser.

**DD3 — Broadcast + read path**: every mutation broadcasts `bookmarks-changed` (empty payload — invalidation-not-snapshot; no jarId, bookmarks are app-scoped) via `broadcastToChromeAndInternal`. Reads and mutations (`bookmarks-get`, `bookmark-add`, `bookmark-update`, `bookmark-remove`, `bookmark-reorder`) are **sender-resolved chrome IPC** — every consumer in this flight (star, bar, overflow model, omnibox merge) lives in the chrome; no internal page reads bookmarks. If a future bookmark-reading internal page appears (manager page, settings listing), the read channel gets re-homed then, choosing deliberately between the bare-handle pattern and the history-style IPC-twins pattern.
- Rationale: same broadcast contract as `jars-changed`/`history-changed`; subscribers re-query through their own read path. Scoping reads to chrome-only avoids claiming a bare-handle carve-out for a consumer that doesn't exist (design-review correction — the original draft over-claimed a settings-page read).
- Trade-off: a future internal-page consumer costs a small IPC re-home; accepted over widening exposure speculatively.

**DD4 — Star + quick-edit popover**: star button inside `#address-wrap` beside `#address-chip`, hidden on internal tabs (the `#zoom-control` precedent). Click on an unbookmarked page adds the bookmark (name defaults to the tab title, falling back to URL — never the literal "New tab" seed) **and** opens the quick-edit popover; click on a bookmarked page opens the popover directly. The popover is a new sheet menuType `bookmark-edit` — an anchored variant of the `input-dialog` template (name field, URL field, Remove and Done actions), positioned at the star via `chromePointToSheet`. The same menuType serves bar/overflow right-click editing (anchored at the invoked item).
- Rationale: one edit surface for every entry point satisfies the rename/change-URL/remove criterion and keeps editing reachable while the bar is hidden; anchoring composes two proven primitives (sheet anchoring + input-dialog layout).
- Trade-off: `input-dialog` is centered-only today AND hardcoded to one field with Create/Cancel and a 3-way focus cycle — `bookmark-edit` needs two fields, Remove/Done, and a 4-way cycle. That template authoring is leg-2 work in its own right, required even under the centered fallback; anchoring is the separate, smaller delta (design-review correction: the two costs are independent).

**DD5 — Shortcuts**: `Ctrl+D` → new action `bookmark-page` (behaves exactly like a star click); `Ctrl+Shift+B` → new action `toggle-bookmarks-bar`. Four-file lockstep edit (`keydown-action.js`, `sheet-accelerator.js` hand-mirror, `dispatchChromeAction`, `guest-forward-allowlist.js`), with `Ctrl+Shift+B` placed in the shifted chain before the unshifted-letter branch (the Ctrl+Shift+T/P/I precedent; Ctrl+N is the copyable prior addition). `bookmark-page` forwards from web guests only; `toggle-bookmarks-bar` forwards from web and internal guests. **This leg also adds the missing classifier-parity contract test** (keydown-action vs sheet-accelerator agreeing on the same inputs), retiring the documented lockstep debt while we're the first to exercise it.
- Rationale: parity shortcuts every browser ships; the contract test converts a documented hand-mirror risk into a pinned invariant.
- Trade-off: slightly wider leg 1; accepted — architect recommended sequencing this early because popover and bar-toggle paths depend on the action names.

**DD6 — Icons: capture-at-star, passive refresh, monogram fallback**: at star time, copy the active tab's already-resolved favicon (a size-capped inline `data:` URL fetched through the owning tab's own jar session) into the bookmark entry. When any tab whose committed URL exactly matches a bookmark (DD2 predicate) later delivers a favicon update, refresh the stored icon through the normal mutation path. Entries with no icon render a letter-monogram tile.
- Rationale: architect-confirmed structurally forced — no new fetch path exists chrome-side (CSP forbids remote images in chrome), so capture-at-star is a plain read of an already-jar-correct value; zero new leak surface, satisfying the mission's jar-isolation constraint by construction.
- Trade-off: a bookmark never visited again keeps its original icon; a bookmark starred before the favicon arrived shows a monogram until the next visit. Accepted staleness.

**DD7 — Settings merge + toggle**: the settings page's startup and appearance sections merge into one "Startup & appearance" section (nav entry updated to match); a `bookmarksBarEnabled` boolean joins `settings-store.js` DEFAULTS (`false`) with a boolean validator — the normalizer auto-fills the new key, no migration. The toggle follows the existing pin-toggle idiom (checkbox → internal bridge settings-set → `settings-changed` broadcast keeps every window live).
- Rationale: mission-directed restructure; the setting rides the proven whole-config store since it is genuinely whole-config data (unlike the bookmark list).
- Trade-off: the section merge touches markup the existing `settings-shell`/`settings-controls`/`toolbar-pins` behavior specs observe — those specs re-run (and get updated if their expectations reference the old section split).

**DD8 — Bar layout and interaction**: the bar is a chrome-DOM row between the toolbar and `#main`, visibility driven by `bookmarksBarEnabled` (class toggle, **zero CSS transitions** — carry the media/privacy-panel `INSTANT — no transition` comment convention). Toggling calls `sendActiveBounds()` so the active tab's guest re-bounds immediately; background tabs re-bound at their next activation (existing accepted behavior — note in flight log if HAT observes it). Bar items are buttons: icon (or monogram) + label, native `title` tooltip "Name\nURL", left-click navigates the current tab, `auxclick`(middle)/Ctrl+click opens a background tab (DD10), `contextmenu` opens the `bookmark-edit` popover for that item (bookmark id captured at right-click — TOCTOU rule).
- Rationale: panel instant-reflow, pin-button visibility classes, and the title-tooltip convention are direct precedents. The history-panel auxclick idiom is precedent for *capturing* middle/Ctrl+click only — it opens foreground today; the background-open semantics themselves are wholly new and gated by DD10.
- Trade-off: two-line tooltip is only approximable with `\n` in a native `title` — accepted.

**DD9 — Overflow surface (provisional, spike-informed)**: bookmarks that don't fit collapse (rightmost-first) into a chevron button opening sheet menuType `bookmarks-overflow` — model-render-only rows, activation dispatched by index (`bookmark:<i>` resolved against the chrome-side model snapshot). Index dispatch follows the `sug:<i>`/`pick:<i>` house idiom — a deliberate choice to keep URLs out of the activation channel (note: the 24-char cap applies to the `value` field, not `id`; index dispatch is convention here, not cap-enforced). Per-row right-click dispatches `bookmark-edit:<i>` on the same sender-validated channel — the sheet's first per-row contextmenu, a small new capability. **Cache freshness**: the overflow sheet renders a snapshot frozen at open; if `bookmarks-changed` fires while it is open, the chrome closes the sheet (re-query on next open) — source of truth is the store, rebuild trigger is the broadcast, max staleness is zero-while-visible. The **cross-surface drag spike runs in leg 1, before this surface is built**; if the spike proves sheet-crossing drag viable, this design stands for Flight 2 to extend; if not, Flight 2 may re-house overflow, and this flight's click/keyboard contract is the stable interface either way.
- Rationale: the sheet is the only surface that can paint over the guest area; index dispatch is the house idiom; sequencing the spike first prevents building overflow on a surface drag can't reach.
- Trade-off: possible Flight 2 rework of overflow housing — bounded by keeping business logic in the chrome-side model, sheet as dumb renderer. Close-on-change is blunter than live re-render but honors the frozen-index dispatch contract (a live re-render could invalidate in-flight indices).

**DD10 — Background-tab open**: `createTab` gains an explicit `background: true` option that skips its currently-unconditional synchronous self-activation; middle/Ctrl+click on bar and overflow items uses it. **Leg-1 scope (design-review corrected)**: cross-window adopt does NOT go through `createTab` (the webContents already lives) and is out of the audit; **session restore is a rewrite, not a verification** — its loop currently depends on each create self-activating serially with a trailing activate correction, and its activation ordering must be restructured to tolerate a non-activating create path existing. Remaining call sites (scripted opens, automation `openTab`, new-tab paths) are audited for implicit activation assumptions; default behavior everywhere is unchanged (`background` is opt-in).
- Rationale: Chrome-parity middle-click; audit/rewrite-first sequencing is the architect's named mitigation for the addition most likely to regress (create/activate ordering is documented race-sensitive).
- Trade-off: leg 1 absorbs a session-restore refactor before any visible feature — accepted as risk retirement; the alternative (foreground-open middle-click) was rejected at mission planning.

**DD11 — Omnibox bookmarks source**: main-side `bookmarks-suggest` query using **the same whole-token-prefix match semantics history search uses** (history is FTS5 token-prefix; the bookmark matcher mirrors those semantics in plain JS over name and URL tokens, so two rows in one list never feel inconsistently matched — design-review correction from the original substring proposal). The navigation controller issues it alongside `historySuggest` and merges: bookmark matches ranked first but **capped at 3 pre-merge** so history retains a floor, deduped against history rows by exact URL (bookmark row wins), total capped at the existing limit (6). Suggestion model rows gain an optional `kind` field; the sheet's suggestions template renders bookmark rows with a star indicator (class-driven styling — labels stay `textContent`-only). `shouldQuery`'s jar/burner/internal gates are untouched; bookmark rows appear in any jar per the mission's jar-boundary ruling. The existing `omnibox-suggestions` behavior spec's absolute cross-jar zero-rows step is deliberately narrowed by this DD — leg 4 updates that spec's wording, not just re-runs it.
- Rationale: additive second source on a stable pipeline; matching parity between sources beats a looser bookmark matcher; ranking bookmarks first matches major-browser treatment of user-curated entries.
- Trade-off: no frecency blending in v1 (bookmarks are a flat first-ranked block, max 3) — simple, predictable, revisitable.
- Mirror-drift note (second-pass review): the JS token-prefix matcher is a hand-mirror of FTS5 `unicode61` semantics — the same drift shape DD5's classifier pair has. Leg 4 adds a small parity test asserting the JS matcher agrees with FTS5 tokenization on a fixed edge-case corpus (unicode, punctuation, digits).

**DD12 — Behavior-test apparatus** (act + observe axes audited):
- *Act path*: goldfinch MCP automation surface (`npm run dev:automation`) — `openTab`/`navigate`/`click`/`pressKey`/`typeText` for guest-side actions; chrome-UI actions (star click, bar click, settings toggle) via `getChromeTarget` + `evaluate` on the chrome target (**admin-tier key required** — jar-scoped keys cannot reach chrome).
- *Observe path*: `captureScreenshot`/`captureWindow` for rendered state (primary evidence per the authoring guide), `readAxTree`/`readDom` on the chrome target for star fill state, bar contents, sheet rows; `goldfinch://settings` observed as an ordinary tab. Persistence steps require an operator-assisted app relaunch.
- *M14 F1 lesson applied*: the pre-flight probe must verify **key tier** (admin, not just liveness) and **instance identity** (the MCP binding reaches the instance under test, re-verified after any relaunch), not merely that `enumerateTabs` responds.
- *Known apparatus gaps (design-review confirmed)*: the MCP surface has **no window-create and no window-resize tool**. Multi-window steps and any window-narrowing are **operator-assisted** in the specs (marked as such); the pre-flight probe additionally tests whether a synthetic `Ctrl+N` via `pressKey` reliably opens a window — if it does, the Executor may use it, but it is not assumed.

### Prerequisites

- [ ] Working tree clean on `main` apart from the expected untracked planning artifacts (`missions/15-bookmarks/`, `tests/behavior/bookmarks-*.md`); flight branch `flight/01-bookmarking-core-and-surfaces` created at flight start
- [ ] Baseline green at branch start: `npm test`, `npm run typecheck`, `npm run lint`, **and `npm run a11y`** (M14 debrief: a11y belongs in the branch-start gate)
- [ ] `npm run dev:automation` launches; MCP probe confirms **admin-tier** key and **instance identity** (DD12)
- [ ] Behavior specs authored (draft): `bookmarks-star-sync`, `bookmarks-bar`, `bookmarks-omnibox`

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [ ] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined (tentative)

---

## In-Flight

### Technical Approach

Foundations land first (leg 1): the store + broadcast + IPC spine, the shortcut classifier entries with the new parity contract test, the activate-on-create audit with the `background` option, and the throwaway cross-surface drag spike whose verdict is written to the flight log (consumed by DD9 and Flight 2). Surfaces then build outward from the spine: star/popover/context-menu (leg 2), settings + bar + overflow (leg 3), omnibox (leg 4) — each leg carries its own unit tests, behavior-spec updates, and doc touches (CLAUDE.md pattern notes for the new store, menuTypes, and shortcut actions; `docs/renderer-menu.md` for the new sheet types). Existing behavior specs whose observed surfaces this flight moves (`page-context-menu`, `settings-shell`, `settings-controls`, `toolbar-pins`, `omnibox-suggestions`, `menu-overlay`) are updated in the leg that moves them and re-run in verification — including narrowing `omnibox-suggestions`' absolute cross-jar zero-rows step per DD11; `page-context-menu` and `toolbar-pins` are still `draft` status and graduate to `active` on their first passing re-run. The seam-contract closed set is not grown — no new evaluate-seam entries are anticipated; if one becomes necessary it needs an explicit FD ruling per CLAUDE.md.

### Checkpoints

- [x] Leg 1 landed: store round-trips with per-entry repair; `bookmarks-changed` invariant test green; classifier parity test green; activate-on-create audit documented in flight log; drag spike verdict recorded
- [x] Leg 2 landed: star reflects state through all five sync paths; popover edits propagate cross-window (via the chrome's own `bookmarkUpdate`/`bookmarkRemove` + the `bookmarks-changed` re-query — `bookmarks-star-sync` behavior-test run deferred to flight verification per the leg's own Verification Steps); internal tabs show no star. Note (design-review correction absorbed into the leg spec): five sync paths, not four — the `createTab` wcId-arrival site was added beyond the flight's original three-`updateAddressChip`-site sketch.
- [x] Leg 3 landed: settings section merged with live toggle; bar shows/hides instantly in every window; overflow + per-row edit works; `bookmarks-bar` passes; restart persistence witnessed
- [x] Leg 4 landed: bookmark suggestions ranked, deduped, star-marked, cross-jar; `bookmarks-omnibox` passes
- [x] Full verification sweep green (unit/typecheck/lint; 3 new behavior specs pass; 6 affected existing specs deferred by operator decision) (unit, typecheck, lint, a11y, new + affected behavior specs)

### Adaptation Criteria

**Divert if**:
- The drag spike shows the sheet cannot host overflow at all (not merely drag-hostile) — overflow surface needs redesign before leg 3
- The activate-on-create audit finds a call site that cannot tolerate a non-activating create without structural change — background-tab open scope returns to the human
- Anchored sheet positioning proves infeasible for the popover — DD4 falls back to the centered input-dialog (cosmetic-only deviation, log it)

**Acceptable variations**:
- Overflow trigger styling/placement; monogram tile design; tooltip composition
- Suggestion star-indicator presentation details (glyph vs. badge), provided rows stay `textContent`-rendered
- Splitting leg 4 (omnibox) out to its own flight if leg 3 lands with breadth pressure — pre-authorized by the mission

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned and created one at a time as the flight progresses. This list will evolve based on discoveries during implementation.

- [x] `foundations-and-risk-retirement` - Bookmarks store + broadcasts + IPC spine with unit tests; shortcut classifier lockstep + parity contract test; activate-on-create audit + `background` createTab option; cross-surface drag spike (verdict to flight log, no shipped UI)
- [x] `star-popover-and-context-menu` - Star control with four-path state sync + internal gating; `bookmark-edit` anchored sheet menuType; page-context "Bookmark this page"; Ctrl+D; icon capture + passive refresh
- [x] `bar-settings-and-overflow` - Settings section merge + bar toggle + Ctrl+Shift+B; the bar (icons/monograms, tooltips, click, middle/Ctrl+click background open, instant reflow); overflow sheet with index dispatch + per-row edit; restart persistence
- [x] `omnibox-bookmarks-source` - `bookmarks-suggest` provider; merge/rank/dedup with star-marked rows; spec updates
- [x] `hat-and-alignment` - Guided HAT session: operator visually validates star fill/popover feel, instant bar reflow, icons, overflow, middle-click, suggestions; iterative fixes until satisfied

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing (unit, typecheck, lint, a11y)
- [ ] Behavior specs: 3 new passing; affected existing specs updated and re-run
- [ ] Documentation updated (CLAUDE.md pattern notes, `docs/renderer-menu.md`)
- [ ] Drag spike verdict + activate-on-create audit recorded in flight log for Flight 2

### Verification

- `npm test` / `npm run typecheck` / `npm run lint` green; suite count grows from the 3095 baseline with no new slow-test class (M14 debrief convention: count is the comparable metric)
- `npm run a11y` green against the running app (bar, popover, overflow are new audit surfaces)
- `/behavior-test bookmarks-star-sync`, `/behavior-test bookmarks-bar`, `/behavior-test bookmarks-omnibox` all pass
- Re-run affected existing specs: `page-context-menu`, `settings-shell`, `settings-controls`, `toolbar-pins`, `omnibox-suggestions`, `menu-overlay`
- HAT leg: operator sign-off on visual/feel items
