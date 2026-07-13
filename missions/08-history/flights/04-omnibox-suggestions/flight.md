# Flight: Address-Bar Suggestions

**Status**: landed
**Mission**: [Per-Jar Browsing History](../../mission.md)

## Contributing to Criteria

- [x] Typing in the address bar surfaces matching suggestions drawn
      exclusively from the active tab's jar history; a suggestion can be
      chosen by keyboard or pointer and navigates the tab.
      *(behavior-test-backed — spec authored this flight; pass 7/7)*
- [x] Suggestions stay felt-instant at scale: prefix lookups remain
      responsive against a history of tens of thousands of entries.
      *(store-level scale probe at 50k rows, all median ≤ ~5ms; live
      114ms keystroke-to-rows in the behavior test, 100ms of it debounce)*
- [x] History adds no network egress *(suggestion half — no
      search-engine blending, all queries local; closes the criterion
      with F3's search half)*.

---

## Pre-Flight

### Objective

Give the address bar history suggestions: as the operator types in a
web/blank tab, a dropdown of frecency-ranked, prefix-matched entries from
the ACTIVE TAB'S JAR renders on the menu-overlay sheet (the only surface
that can composite below the toolbar — chrome DOM is occluded by the guest
view), selectable by keyboard (chrome keeps OS focus; arrows move a
model-driven highlight) or pointer (index-dispatch activation), navigating
via the existing `navigate` path. Burner and internal tabs structurally
never query. The sheet gains its first NON-FOCUSING open path; the store
gains a frecency `suggest` query (~2 ms at 51k rows, measured).

### Open Questions

- [x] Suggestion ranking (mission open question) → frecency: age-bucketed
      visit weights summed per URL. See DD4.
- [x] Where the dropdown renders → the sheet, new non-focusing template.
      See DD1/DD2.
- [x] Debounce & min-query → 100 ms debounce (IPC churn, not latency),
      any non-empty trimmed input. See DD5.
- [x] Burner suggestions → structurally skipped (no query issued). See DD5.

### Design Decisions

**DD1 — Surface: a `suggestions` sheet template, stateless, model-driven.**
New `menuType: 'suggestions'` template in `menu-overlay.js`, registered
WITHOUT an `items` getter (the info-popup precedent — roving no-ops) and
with an `onOpen` that focuses NOTHING. It renders the model's rows
(`role="listbox"`/`option` semantics, `aria-selected` on the model's
`selectedIndex`, primary = title-or-URL, secondary = URL host; all
`textContent`) plus an optional "No matches" note. Clicking a row emits
Ch4 `{ id: 'sug:<i>' }` — INDEX dispatch (the `spell:<i>` idiom;
`sanitizeActivatedValue`'s 24-char cap forbids URLs in `value`). The sheet
holds zero suggestion state: every keystroke and every arrow-selection
change is a fresh chrome-side `openOverlayMenu` model-replace (superseded
semantics are flicker-free and drop stale Ch7s by token — recon-verified).
Anchor: `alignLeft` at the address input's left edge, `y: 0` (flush at the
sheet top, directly under the toolbar — the site-info geometry).

**DD2 — The sheet gains a non-focusing open path (the flight's one
machinery change).** `deliverInit`'s unconditional
`view.webContents.focus()` is the sheet's SOLE focus site
(recon-verified); Ch1 gains a `noFocus: true` payload flag that gates it.
With the suggestions template also focusing nothing, **keyboard-driven
and programmatic updates never move OS focus off the chrome's `#address`
input** (scoped claim — a POINTER click landing on the sheet still moves
native focus per Chromium click-to-focus; DD5's grace timer exists for
exactly that) — keystrokes keep flowing to the chrome's own listeners
(DD13 forwarding never engages). `openMenu`'s unconditional
`hideFindOverlay()` becomes first-open-only (nice-to-have — the call is
already idempotent; this just avoids redundant per-keystroke calls). Both
changes land in `menu-overlay-manager.js` (Electron-free, unit-tested —
pins added; existing pins verified unaffected by a `if (!payload.noFocus)`
gate). All EXISTING templates keep today's focusing behavior exactly (no
flag → focus as before). **The template registration is LOAD-BEARING, not
cosmetic**: an unregistered menuType falls back to the `menu` template,
which focuses — the no-focus guarantee silently breaks without it
*(Architect review)*.

**DD3 — Data path: `suggest` store method + twin IPC + chrome bridge.**
`history-store.js` gains `suggest(jarId, query, { limit = 6 })`;
`history-ipc.js` gains `history-suggest` / `internal-history-suggest`
twins (uniform with the five existing ops; the internal twin is unused
this flight — noted); `chrome-preload.js` gains its FIRST history bridge
method `historySuggest` (bare-handle chrome trust domain — the
settings-get precedent) + the `GoldfinchBridge` d.ts declare. Fail-closed
static strings (`history: suggest — <code>`). The unused internal twin
carries a one-line registered-but-unused comment.

**DD4 — Ranking: age-bucketed frecency over the FTS-narrowed subset.**
Reusing `sanitizeSearchQuery` + the unaliased FTS join + distinct
placeholders (the pinned gotchas), grouped by URL:
`score = SUM(CASE age_days ≤4→100, ≤14→70, ≤31→50, ≤90→30, else 10)`,
title = the most-recent visit's title, `ORDER BY score DESC,
MAX(visited_at) DESC, url LIMIT ?` (limit clamped 1–10, default 6).
`now` injected for determinism. The GROUP-BY-with-bare-title-after-MAX
construction is probe-verified (SQLite's bare-column-follows-MAX rule
applies under the FTS join). Exact SQL pinned at leg design; unit-pinned
with a ranking truth table (frequent-old vs recent-rare, tie-break
stability, per-jar isolation, prefix semantics unchanged incl. a
token-prefix row — `"example"*` also matches `examplezzz.com`, visible on
every keystroke; and the suggest-specific limit clamp gets its OWN named
constant + truth row, distinct from the store's 1–500). The scale probe
MUST include 1–2 char queries (the FTS `prefix='2 3 4'` index does not
cover 1-char terms — measure the uncovered path explicitly).
*(all Architect review)*

**DD5 — Omnibox contract (chrome-owned state, combobox-like).**
`renderer.js` gains a suggestions controller backed by a NEW pure ESM
module `src/shared/omnibox-suggest-model.js` (unit-tested: input
gatekeeping, model building, selection movement) — renderer.js only wires
events (growth discipline).
- **Query gate**: suggestions engage only when `#address` has focus, the
  active tab is a WEB or blank tab in a PERSISTENT jar
  (`!isInternalTab && !tab.container.burner` — burner/internal never
  query, structurally), and the trimmed input is non-empty. 100 ms
  debounce + a token guard (stale responses never paint).
- **Keyboard** (address-bar keydown, extending its lone Enter handler):
  ArrowDown/ArrowUp move the selection (clamped, no wrap; re-opens with
  the new `selectedIndex` — model-replace), Enter with a selection
  navigates the SELECTED url (passed through `navigate` via a
  full-URL-safe path — suggestions are stored URLs, `toUrl` passthrough
  applies since they carry explicit schemes), Enter without a selection
  keeps today's behavior byte-identical, Escape closes the dropdown
  (input keeps focus and text).
- **Close triggers are ALL chrome-owned** (recon: the non-focusing regime
  fires NO blur/outside-click dismissal while focus stays in the chrome):
  Enter/navigate, Escape, input emptied, `els.address` blur (via a
  ~150 ms grace timer — a pointer click on a sheet row moves OS focus to
  the sheet BEFORE the activation lands; the grace window lets Ch6 win
  the race — **the pointer-activation race, named**), tab
  switch/activation (already closes any menu main-side — no new code),
  and navigation events (NEW wiring at the address-sync sites).
- **Ch2 must be WIDENED** *(Architect review, HIGH — the existing
  `menu-overlay:close` handler coerces every reason to
  `toggle|superseded`; Escape/blur/navigate closes would lose reason
  fidelity)*: main's Ch2 handler gains an explicit reason allowlist
  (mirroring Ch5's `SHEET_DISMISS_REASONS`), and the two type pins
  (`chrome-preload.js`, `renderer-globals.d.ts`) widen to match.
- **Grace-timer token guard** *(Architect review, HIGH)*: the timer
  callback re-checks the captured suggestions token against the current
  one — a newer suggestions session opened within the window must NOT be
  closed by the stale timer.
- **Response-time gate revalidation** *(Architect review, HIGH)*: the
  `historySuggest` response handler re-validates the FULL query gate at
  arrival (address still focused, same tab, suggestions still the
  current/only intended surface) before calling `openOverlayMenu` — a
  stale response must never model-replace a menu the operator opened
  meanwhile (the kebab-while-typing race). This logic lives in the pure
  module's tested surface, not renderer glue.
- **No refocus on close, ever** (suggestions' "trigger" is `#address`
  itself, which already holds focus in every keyboard path; pointer
  activation moves focus per Chromium's native click-to-focus and the
  navigation takes over) — pinned so the fixed-trigger refocus map is
  not extended to this surface.
- **Pointer**: row click → Ch6 `sug:<i>` → chrome bounds-validates
  against the model it holds and navigates that URL (vanished model →
  no-op).
- **A11y (best-effort, cross-view honesty)**: `aria-expanded` +
  `aria-autocomplete="list"` on the input; TRUE combobox semantics
  (`aria-activedescendant`) are impossible across WebContentsView
  documents — same accepted gap as every sheet menu; screen-reader
  parity is a named HAT/Flight-6 item, not silently claimed.

**DD6 — No egress**: suggestions never blend engine results; the query
path is store-only. The existing search-fallback in `toUrl` is untouched
(typing free text + Enter still searches — that is navigation, not
suggestion).

**DD7 — Verification split.** Store ranking/isolation: unit truth table.
Sheet machinery: manager unit pins. End-to-end (type → rows render →
keyboard/pointer selection navigates → jar exclusivity): a NEW behavior
test `omnibox-suggestions` authored this flight — the chrome is
admin-drivable (getChromeTarget + click/typeText) and the sheet is
probe-addressable at the admin tier (background-tab-safe walk), so both
act and observe paths exist without new seams (apparatus premise
recon-verified). Felt-instant at scale: 50k-row seeded DB written BEFORE launch via the
store's OWN `open()`/`recordVisit()`/`close()` API inside ONE explicit
transaction (never hand-rolled schema SQL; 50k autocommit WAL syncs
could take minutes — *Architect review*) + live typing latency
spot-check + the store-level timing probe (incl. 1–2 char queries).

### Prerequisites

- [x] Flights 1–3 landed (store + FTS + measured ~2 ms prefix queries at
      51k rows; history-ipc conventions; jar identity on
      `tab.container`).
- [x] Sheet machinery recon-verified: `deliverInit` is the sole focus
      site; model-replace is flicker-free with stale-token drops; the
      300 ms suppress window is trigger-click-only (does not fight
      direct `openOverlayMenu` calls); `menu` template's note/index
      idioms reusable.
- [x] `history-search` is already chrome-trusted (bare handle) —
      precedent for the suggest channel's trust placement.

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Leg 1: store `suggest` + IPC twins + chrome bridge + d.ts + unit truth
table. Leg 2: manager `noFocus` gate + first-open-only find-hide +
`suggestions` template + manager/template pins. Leg 3: omnibox wiring
(pure model module + renderer controller + CSS) + close-trigger matrix.
Leg 4: behavior test authored + run, scale probe, docs (CLAUDE.md omnibox
section + README feature line), flight close.

### Checkpoints

- [x] `suggest` ranked correctly (truth table) at ~2 ms scale numbers.
- [x] Sheet opens WITHOUT stealing focus; typing continues fluidly;
      existing menus unaffected (manager pins + live probe).
- [x] Keyboard + pointer selection navigate; all close triggers fire;
      burner/internal tabs never query.
- [x] Behavior test passes; 50k-row live typing feels instant.

### Adaptation Criteria

**Divert if**: the non-focusing sheet path proves impossible without
breaking existing menus (manager pins fail or live menus regress) — stop;
fallback design (chrome-DOM dropdown clipped to toolbar height, or an
inset dropdown view) needs an operator ruling.
**Acceptable variations**: bucket weights/limits, debounce value, row
copy/format, grace-timer value, exact template markup.

### Legs

> Tentative; created one at a time.

- [x] `suggest-store-and-ipc`
- [x] `sheet-nofocus-and-template`
- [x] `omnibox-wiring`
- [x] `verify-integration`

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged *(stacked PR; merges after human review)*
- [x] Tests passing
- [x] Documentation updated

### Verification

Unit: suggest truth table; manager noFocus/find-hide pins; omnibox model
tests. Live: behavior test `omnibox-suggestions` (authored this flight;
act path = admin chrome drive; observe path = sheet DOM via probed wcId +
window pixels — both premises recon-verified); 50k-row scale seed +
typing latency. HAT (Flight 6) owns suggestion FEEL (ranking quality,
visual polish, SR parity review).
