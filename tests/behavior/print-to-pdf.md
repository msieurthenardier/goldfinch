# Behavior Test: Print to PDF (automation tool)

**Slug**: `print-to-pdf`
**Status**: active
**Created**: 2026-06-18
**Last Run**: 2026-06-18-16-49-55 (partial — step 2 pass under admin + jar key; step 3 internal-refusal not reachable via the automation surface, deferred to HAT; see `print-to-pdf/runs/`)

## Intent

Verify that the automation `printToPDF` tool renders the active tab's **web content** to a valid PDF
document and returns its bytes to the caller. This is the testable, non-interactive counterpart to
the native print dialog (SC2's human path, which is verified manually). Real-environment observation
is required: PDF generation is a Chromium-engine render of a live page that no unit test reproduces.

## Preconditions

- App running via `npm run dev:automation`, operator-checkable.
- A valid **jar key** for the web surface.
- The `printToPDF` tool is present in the tool list (run skill confirms discovery).

## Observables Required

- **automation surface** (tool result — measured via the goldfinch MCP surface): the `printToPDF`
  return payload — a **base64 string** the Validator base64-decodes and inspects (the engine op
  `buf.toString('base64')`-encodes the `printToPDF` Buffer).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open a web tab in the **Default** jar to a stable page (e.g. `https://example.com`); record its `wcId`. | (setup — no judgment) |
| 2 | Call `printToPDF(wcId)`. | A non-empty base64 payload is returned; **decoded** bytes begin with the `%PDF-` signature and end near the `%%EOF` trailer — a structurally valid PDF was produced from live web content. |
| 3 | Call `printToPDF` against the `goldfinch://settings` internal tab's wcId with a **jar** key (internal wcId obtained **out-of-band / HAT** — the automation surface cannot open or enumerate internal tabs). | Refused / no-op — the jar façade (`resolveContentsForJar`) cannot reach internal pages, returned as a clean refusal, not an opaque error. *(Not reachable in an automation-only run; the jar-façade + op-local guards are unit-proven in `automation-scope.test.js` / `automation-print.test.js`. The nearest reachable case — a jar key on an **out-of-jar** wcId — was confirmed live to return `automation: out-of-jar`. HAT checkpoint for the internal case.)* |

## Out of Scope

- The **native print dialog** (`Ctrl+P` / kebab **Print…**) and the **Save as PDF** destination
  within it — OS-native, verified manually, outside this apparatus.
- Page-range / header-footer / paper-size options — v1 asserts a valid default render only.

## Variants (optional)

- `printToPDF(wcId, { landscape: true })` once options are wired (future).
