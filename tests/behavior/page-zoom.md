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
- **browser** (in-page scale — measured via the `evaluate` tool): **`window.devicePixelRatio`** to
  corroborate engine zoom independent of `getZoom`. *(Not `visualViewport.scale` — that tracks
  pinch-zoom and stays ≈1 under `setZoomFactor`.)*

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open a web tab in the **Default** jar to a stable page (e.g. `https://example.com`); record its `wcId` via `enumerateTabs`. | (setup — no judgment) |
| 2 | Read baseline: `getZoom(wcId)` and `evaluate(wcId, "devicePixelRatio")`. | `getZoom` factor ≈ `1.0`; `devicePixelRatio` at its baseline. |
| 3 | Send `Ctrl+=` to **the tab (guest)** twice via `pressKey` (name `=`, modifiers `["control"]`) — captured by the main-side `before-input-event` handler. | `getZoom(wcId)` factor `> 1.0` AND `devicePixelRatio` increased correspondingly — keyboard zoom-in (page-focused) reaches the page. |
| 4 | Send `Ctrl+0` (name `0`, modifiers `["control"]`) to the guest. | `getZoom(wcId)` factor back to ≈ `1.0`; `devicePixelRatio` back to baseline — reset works. |
| 5 | `setZoom(wcId, 1.5)`. | `getZoom(wcId)` ≈ `1.5` AND `devicePixelRatio` increased — the MCP tool applies zoom to web content. |
| 6 | Open a second web tab in a **different jar** (e.g. **Work**) to a **different origin**; record its `wcId2`. With tab 1 still at `1.5`, read `getZoom(wcId2)`. | `getZoom(wcId2)` ≈ `1.0` — zoom did not leak across jars (separate jar sessions). |
| 7 | Identify the `goldfinch://settings` internal tab's wcId (open it via the trusted path — **out-of-band / HAT**: the automation surface itself cannot open or enumerate internal tabs, so a human opens Settings and the wcId is read out-of-band). Attempt `setZoom(internalWcId, 1.5)` under the **admin** key. | The attempt is **refused / no-op** via the op's *op-local* internal guard — `getZoom` on the internal tab does not report `1.5`; the refusal is clean, not an opaque error. *(Not reachable in an autonomous automation-only run — the op-local guard is unit-proven in `automation-zoom.test.js`; this row is a HAT checkpoint.)* |

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
