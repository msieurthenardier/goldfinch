# Squawk 0196: WebGPU exposes the real graphics adapter while farbling is on

**Status**: deferred
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-16
**Completed**: —

## Report
With Shields farbling on, a page reads `Google Inc.` / `ANGLE (Generic GPU)` from WebGL but can still read the real adapter through WebGPU: `navigator.gpu.requestAdapter()` → `adapter.info` returns the machine's real `vendor` and `architecture`. Farbling's promise for the graphics card is therefore not kept, and the two answers disagree, which is a cross-check a fingerprinter or bot filter can use.

Found during the squawk 0195 triage. It is **not** the cause of that failure: nulling the adapter neither fixed nor broke the site.

Repro: any web tab with farbling on, in the page console —
`(await navigator.gpu.requestAdapter()).info` shows the real vendor/architecture, while
`gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)` shows `ANGLE (Generic GPU)`.

## Evidence
- `src/preload/webview-preload.js` `installFingerprintHooks`: hooks cover `CanvasRenderingContext2D`, `HTMLCanvasElement`, `WebGLRenderingContext` / `WebGL2RenderingContext`, `AnalyserNode` and two `navigator` values. Nothing touches `GPU`, `GPUAdapter` or `GPUAdapterInfo`.
- Measured in the 0195 control (plain Electron 45.3.2, Windows, real preload bundle, farbling on): the page read the generic WebGL string and, in the same document, a real vendor and architecture from `adapter.info`.
- The bot-filter script instrumented in 0195 calls `navigator.gpu.requestAdapter` on its first document.
- The preload runs in the top frame only (`nodeIntegrationInSubFrames` is not set), and not in workers, where `navigator.gpu` is also available.

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*

## Disposition
**Deferred**: logged as a holding record at the operator's request (2026-11-16); it does not pass the squawk gate as written. It fails criterion 2 (no design decisions): what a farbled page should get — a null adapter, or an adapter with generic `info` — is a design call, and so are `GPUAdapter.features` / `limits`, the worker and subframe copies of `navigator.gpu`, and keeping the answer consistent with the WebGL strings. Revisit when a farbling-hardening sortie is planned (`/mission-control:sortie`); the hook-disguise weak point noted in squawk 0195's triage (the sensor calls `Function.prototype.toString` on hooked functions) belongs in the same sortie.
