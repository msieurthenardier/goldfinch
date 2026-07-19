# Behavior Test: Page Zoom

**Slug**: `page-zoom`
**Status**: active
**Created**: 2026-06-18
**Last Run**: 2026-06-18-16-49-55 (partial — steps 2–6 pass; step 7 internal-refusal not reachable via the automation surface, deferred to HAT; see `page-zoom/runs/`)

## Intent

Verify that page zoom applies to the active tab's **web content** — driven by keyboard (`Ctrl +`/
`-`/`0`) and by the automation `setZoom` tool — is observable through `getZoom` and the page's own
scale, is **per-origin-per-jar** (zooming one jar's tab does not change another jar's tab), and
**no-ops on `goldfinch://` internal pages**. This needs real-environment observation: zoom is a
Chromium-engine effect on a live guest WebContentsView that unit tests cannot exercise, and the per-jar
isolation + internal-exclusion properties are only true against the running app's session model.

## Preconditions

- App running via `npm run dev:automation` (the M03 loopback automation surface), operator-checkable.
- The run uses the **admin** key (env-gated): step 7 exercises the zoom op's *op-local* internal
  guard, which only fires under admin (a jar key is refused generically by the façade and leaves the
  guard untested).
- The `setZoom`/`getZoom`/`evaluate` tools are present in the tool list (the run skill confirms tool
  discovery before spawning agents). *Note: `setZoom`/`getZoom` are deliverables of this flight's
  `zoom-mcp-tool` leg — this spec runs at `verify-integration`, after they land.*
- `pressKey` can emit `=`/`-`/`+` chords (the `zoom-capture-and-apply` leg extends the key map; the
  stock builder covers only a named-key map + `[a-z0-9]`, so steps 3 and the zoom-out variant depend
  on that extension having landed).

## Observables Required

- **automation surface** (tool results — measured via the goldfinch MCP surface): `getZoom` factor,
  `setZoom` acknowledgement, `enumerateTabs` for wcIds.
- **browser** (independent visual witness): an unlocked, rendered-page capture before/after zoom,
  inspected for a clear increase in text/content scale while the guest bounds remain unchanged.
  `devicePixelRatio` is deliberately not used: on native macOS Chromium page zoom may leave the
  backing-display DPR constant even when `webContents.getZoomFactor()` changes correctly.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open a web tab in the **Default** jar to a stable page (e.g. `https://example.com`); record its `wcId` via `enumerateTabs`. | (setup — no judgment) |
| 2 | Read baseline `getZoom(wcId)` and capture the unlocked rendered page at factor 1.0. | `getZoom` factor ≈ `1.0`; the capture records the baseline text/content scale and guest bounds. |
| 3 | Send `Ctrl+=` to **the tab (guest)** twice via `pressKey` (name `=`, modifiers `["control"]`) — captured by the main-side `before-input-event` handler. Read `getZoom` and capture again. | `getZoom(wcId)` factor `> 1.0`, and the rendered content is visibly larger than baseline without changing the guest slot — keyboard zoom-in reaches the page. |
| 4 | Send `Ctrl+0` (name `0`, modifiers `["control"]`) to the guest; read and capture again. | `getZoom(wcId)` returns to ≈ `1.0`, and the rendered content returns to its baseline scale — reset works. |
| 5 | `setZoom(wcId, 1.5)`; read and capture again. | `getZoom(wcId)` ≈ `1.5`, and the rendered content is visibly larger than baseline — independent visual confirmation that the MCP tool applies page zoom. |
| 6 | Open a second web tab in a **different jar** (e.g. **Work**) to a **different origin**; record its `wcId2`. With tab 1 still at `1.5`, read `getZoom(wcId2)`. | `getZoom(wcId2)` ≈ `1.0` — zoom did not leak across jars (separate jar sessions). |
| 7 | Open `goldfinch://settings` through the trusted chrome path, identify its wcId from the **admin** `enumerateTabs` result, and attempt `setZoom(internalWcId, 1.5)`. | The attempt is refused by the op-local internal guard with `automation: setZoom — internal-session excluded`; no zoom is applied to the internal page. |

**Row conventions:** Row 1 is pure setup (no judgment). Rows 2–7 each assert one observable
checkpoint.

## Out of Scope

- Print / Save-as-PDF (see `print-to-pdf`).
- Cross-restart zoom persistence (v1 is session-lifetime — DD1).
- The **same-jar, same-origin** sharing model (per-tab vs per-origin) — confirmed by a live check at
  the `zoom-controls` leg + HAT, not asserted here (DD1); this spec only asserts the **no cross-jar
  leak** invariant (step 6).
- The address-bar zoom **chip** UI rendering — covered by the a11y gate + HAT, not this spec (this
  spec asserts the *effect* on web content, not the chip's pixels).

## Variants (optional)

- `Ctrl+-` zoom-out symmetric to step 3.
