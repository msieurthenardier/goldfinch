# Behavior Test: Find in Page (automation tool)

**Slug**: `find-in-page`
**Status**: active
**Created**: 2026-06-18
**Last Run**: 2026-06-19-03-05-57 (partial — stepping/warm finds verified; cold-first-find
WSLg-blocked; see `find-in-page/runs/2026-06-19-03-05-57.md`)

> **Resolved contract inversion (2026-07-19).** The MCP surface defines `findNext:false`/omitted as
> a NEW search and `findNext:true` as a STEP. Electron's `FindInPageOptions.findNext` uses the inverse
> meaning (`true` begins a new session; `false` continues it). The former direct pass-through made
> every MCP new search act like a step, producing the repeated false-zero symptom previously
> attributed to WSLg. The adapter now translates the public intent at the Electron boundary and
> preserves that translated option across cold-start retries. Steps 2–5 are ordinary cross-platform
> assertions; no venue-specific false-zero allowance remains.

## Intent

Verify that the automation `findInPage` tool searches the active tab's **web content** and returns a
live **match count and active-match position**, that stepping forward/backward moves the active match,
and that `stopFindInPage` clears the find session — all against a running page. Real-environment
observation is required: `findInPage` drives Chromium's engine-level find over a live document and
reports through the asynchronous `found-in-page` event, which no unit test reproduces. This is the
agent-parity (SC8) counterpart to the human find bar (SC4, HAT-verified).

## Preconditions

- App running via `npm run dev:automation`, operator-checkable.
- A valid **jar key** for the web surface (the parity assertion); the env-gated **admin** key available.
- The `findInPage` / `stopFindInPage` / `evaluate` tools present in the tool list (the run skill
  confirms discovery — total tool count **26**).

## Observables Required

- **automation surface** (tool results — measured via the goldfinch MCP surface): the `findInPage`
  return payload `{ activeMatchOrdinal, matches }`, and `stopFindInPage` → `{ ok: true }`.
- **browser** (in-page corroboration — measured via the `evaluate` tool): an independent occurrence
  count of the search term in the live DOM (e.g. counting matches of the term in `document.body`'s text),
  so `matches` is checked against a second source rather than asserted in isolation.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open a web tab in the **Default** jar to a stable page with a term that occurs **at least twice** (e.g. `https://example.com`, term `"example"` — appears in the `<title>` and body, so `matches ≥ 2`); record its `wcId` via `enumerateTabs`. Pick a term whose count `evaluate` confirms is ≥ 2 so the stepping assertions are unambiguous. | (setup — no judgment) |
| 2 | Call `findInPage(wcId, "<term>")`. | `matches ≥ 2` and equals the term's occurrence count corroborated by `evaluate`; `activeMatchOrdinal` is `1` (first match active) — a live search reached the page. |
| 3 | Call `findInPage(wcId, "<term>", { findNext: true, forward: true })`. | `activeMatchOrdinal` becomes `(prevOrdinal mod matches) + 1` — i.e. advances to `2` from `1` (and would wrap `matches → 1`); `matches` unchanged — forward stepping moves the active match without re-counting. (With `matches ≥ 2` guaranteed in step 1, this is a clean +1, not a wrap.) |
| 4 | Call `findInPage(wcId, "<term>", { findNext: true, forward: false })`. | `activeMatchOrdinal` moves back to the prior position (`2 → 1`) — backward stepping works. |
| 5 | Call `findInPage(wcId, "zzz-no-such-term-zzz")`. | `matches` is `0` and `activeMatchOrdinal` is `0` — a no-match query reports zero cleanly (not an error). |
| 6 | Call `stopFindInPage(wcId)`. | Returns `{ ok: true }`; no error — the find session is cleared (`clearSelection`). |
| 7 | Open a second web tab in a **different jar** (e.g. **Work**); with the same jar key, attempt `findInPage` against the **other jar's** `wcId`. | Refused as `automation: out-of-jar` — find is jar-scoped (SC8 parity), not a cross-jar reach. **(Apparatus gap: a single jar-scoped key cannot enumerate/obtain a foreign jar's `wcId`, so this step is not executable through the surface as written — feed a foreign `wcId` out-of-band, or rely on the unit-proven jar-scoping. Run `2026-06-19-03-05-57` recorded this INCONCLUSIVE.)** |

**Row conventions:** Row 1 is pure setup (no judgment). Rows 2–7 each assert one observable checkpoint.

## Out of Scope

- The **visual find bar** (`Ctrl+F` open, the floating `[ input ] n/m [↑] [↓] [✕]` overlay, match
  highlighting, `Esc`/`Enter`/`Shift+Enter`, per-tab restore) — since M05 Flight 7 this is a main-owned
  overlay `WebContentsView` (`find-overlay.html`), not chrome-rendered DOM. Verified by the **HAT**
  keyboard/focus pass + the DD12 verbatim a11y-attribute carry-over and the `find-overlay-geometry` /
  `tab-surface-geometry` specs (the `npm run a11y` chrome sweep no longer includes a find state — the
  overlay webContents is not MCP-addressable). This spec asserts the find *engine result*, not the
  bar's pixels.
- **Internal-tab refusal** (`findInPage` on a `goldfinch://` tab under the admin key) — **not reachable
  via the automation surface** (it cannot open or enumerate internal tabs to obtain an internal `wcId`).
  The op-local `isInternalContents` guard is **unit-proven** in `automation-find.test.js`; the live
  internal no-op is a **HAT** checkpoint. *(Carry-forward from the Flight-1 debrief: internal-refusal and
  OS-native steps are HAT/unit, never automation-surface steps.)*

## Variants (optional)

- `findInPage(wcId, "<Term>", { matchCase: true })` — case-sensitive count differs from the
  case-insensitive default.
