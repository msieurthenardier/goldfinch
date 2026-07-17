# Behavior Test: Address-bar suggestions are jar-exclusive, selectable, and felt-instant

**Slug**: `omnibox-suggestions`
**Status**: active
**Created**: 2026-07-12
**Last Run**: 2026-07-13-00-39-35 (pass — 7/7 checkpoints; steps 1 & 4
passed on rerun after two spec-premise fixes, both folded in above)

## Intent

Verify Mission 08's omnibox criterion in the running app: typing in the
address bar surfaces prefix-matched suggestions drawn EXCLUSIVELY from the
active tab's jar history, selectable by keyboard and pointer (navigating
the tab), with burner tabs never suggesting — against a seeded history of
~50k rows (the felt-instant-at-scale condition). The suggestion surface is
the menu-overlay sheet in its non-focusing regime; the property under test
is end-to-end wiring (chrome keystrokes → store query → sheet render →
selection → navigation) that no unit layer can observe.

**Scope honesty**: ranking QUALITY (frecency feel) is HAT territory
(Flight 6); the store's ranking order is unit-pinned. This spec asserts
presence/exclusivity/selection/latency, not order.

## Preconditions

- **Seed BEFORE launch** (the store is exclusive while the app runs): a
  script using `src/main/history-store.js`'s own `open`/`recordVisit`/
  `close` against the dev profile (`~/.config/goldfinch-dev`): ~50k rows
  in the DEFAULT jar (varied hosts/paths/titles; **every visitedAt MUST
  fit inside the jar's retention window — ≤29 days on the default 30-day
  policy: the app prunes at startup and silently deletes older seed rows**
  — first-run finding; transaction unnecessary, WAL makes 50k API-path
  inserts ~6 s) PLUS a distinctive marker set in the `work` jar
  only — e.g. 20 visits to `https://zebrafinch-marker.test/...` titled
  "Zebrafinch Marker" (a prefix, `zebraf`, that matches NOTHING in the
  default jar).
- Launch with the mint envs (`GOLDFINCH_AUTOMATION_DEV_MINT=1
  GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT=49707
  npm run dev:automation`); admin key from stdout; scripted SDK client.
- Apparatus: admin `getChromeTarget` + `click`/`typeText`/`pressKey` on
  the CHROME wcId (drives the address bar); the suggestions render on the
  sheet — observe via `captureWindow` pixels AND the sheet's DOM (the
  sheet's wcId is resolved exactly from `enumerateWindows()`'s per-window
  `sheetWcId` — admin-only, M09 F7 DD2 — and is NOT
  internal-session-excluded from `evaluate` — recon-verified).
  `chrome-devtools` MCP disqualified as always.

## Observables Required

- browser (chrome drive: click/type/press on the address bar; sheet DOM
  reads via the `enumerateWindows`-resolved sheet wcId; rendered pixels via
  captureWindow — goldfinch MCP admin apparatus)
- shell (launch, seed script, key capture, timing — Bash)
- filesystem (seed verification counts via readOnly node:sqlite — Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Setup: run the seed script (app NOT running); verify counts via readOnly query (~50k default-jar rows, 20 `work` marker rows); launch; connect admin client; resolve the sheet's wcId from `enumerateWindows()` (this window's row → `sheetWcId`). | Seed counts confirmed; initialize ok. `sheetWcId` is **absent** on a fresh launch — the sheet is lazy and has never been created — so it resolves after step 2's first open, at which point the row carries it exactly. *(M09 F7 DD2 makes this nuance first-class: an absent id **means** "never created"; it is not a failed lookup.)* |
| 2 | **Suggestions appear, felt-instant.** Click into the address bar (chrome wcId; coordinates from a screenshot); type a 3+ char prefix known to match many seeded default-jar rows. Record wall-clock between last keystroke and the sheet's rows being observable (poll the sheet DOM at ~50 ms cadence, or successive screenshots). | Suggestion rows render on the sheet under the address bar, drawn from the default jar's seeded history; observed latency from keystroke to rendered rows is subjectively instant (≤ ~300 ms wall including apparatus overhead — the store query itself is ~2 ms; the Validator judges "no visible lag," not a hard SLA). |
| 3 | **Jar exclusivity.** Clear the input (Ctrl+A + Delete or select-all + type); type `zebraf` (the work-jar marker prefix). | ZERO suggestion rows for the marker (empty state / "No matches" note) — the work jar's history never leaks into a default-jar tab's suggestions. *(the mission's exclusivity clause at the omnibox surface)* |
| 4 | **Keyboard selection navigates.** First stage RESOLVABLE suggestions (first-run finding: fictional seed hosts can't DNS-resolve, so arrival is unmeetable on them): serve 3 titled static pages on `http://127.0.0.1:8000` and VISIT them in the default jar via admin navigate (the real recording pipeline adds them to history). Clear; type a prefix matching those local pages' titles; ArrowDown (selection highlight moves — observe aria-selected/.selected on the sheet); Enter. | The active tab navigates to the selected suggestion's URL — a resolvable local page (enumerateTabs shows the tab at that URL; the dropdown is gone). |
| 5 | **Pointer selection navigates.** Focus the address bar again; type the local-page prefix; click a visible suggestion row on the sheet (coordinates from screenshot). | The tab navigates to the clicked row's URL (resolvable local page); dropdown closed. |
| 6 | **Burner tabs never suggest.** Open a burner tab (chrome evaluate `createTab(url, makeBurner())` with any http page); focus the address bar; type the step-2 prefix; wait ~500 ms. | NO suggestion surface appears (no sheet rows — the query gate never fires for burner tabs); screenshot confirms no dropdown. |
| 7 | **Escape closes; typing continues.** Back on a default-jar tab: type the prefix (rows appear), press Escape, then type more characters. | Escape closes the dropdown with focus and text intact; continued typing re-opens with narrowed results (the non-focusing regime kept the chrome's keystream). |

## Out of Scope

- Ranking order/quality (unit-pinned; HAT judges feel).
- Automation-surface history reads and cross-jar READ isolation (Flight 5
  specs).
- Screen-reader combobox parity (named accepted gap; HAT/Flight 6).

## Variants (optional)

- Re-run step 2 with a 1–2 char prefix (the FTS prefix index doesn't
  cover 1-char terms — latency variant).
