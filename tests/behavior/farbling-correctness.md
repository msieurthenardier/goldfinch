# Behavior Test: Fingerprint farbling noises canvas and spoofs navigator

**Slug**: `farbling-correctness`
**Status**: draft
**Created**: 2026-06-05
**Last Run**: never

> **Draft — authored during Flight 4 (CI/CD hardening) planning as a Flight-3 carry-forward; not yet run.** Run and promote to `active` **before the next Electron major upgrade** — farbling is the largest privacy-unique feature with no unit or behavior coverage, and it rides on canvas/`navigator` prototype hooks installed at document-start that a Chromium bump could silently break. Refine the cross-seed step against the real "New Identity" UX before promotion.

## Intent

Verify that Goldfinch's anti-fingerprinting **farbling** actually fires on the live app: with Shields' `farble` active (the default), a page's `canvas` reads are perturbed with deterministic per-seed noise, and `navigator` fingerprint surfaces are spoofed to constant values that mask the real machine. This needs a behavior test rather than a unit test because the farbling is installed as **prototype patches inside the webview guest at document-start** via a synchronous `ipcRenderer.sendSync('shields-farble', …)` round-trip (`src/preload/webview-preload.js`) — only the running Electron app proves the hooks are installed, wired to the per-jar seed, and observed by real page JS. The behavior also proves three properties a static check can't: noise is **applied** (not pass-through), **stable within a session** (a site re-reading the same canvas gets the same fake), and **seed-dependent** (a new identity changes the persona).

## Preconditions

- Goldfinch is running via `npm run dev:debug` (exposes `--remote-debugging-port=9222 --remote-allow-origins=*`) so the apparatus can attach to the webview guest target.
- Shields' `farble` capability is **active** for the test site. It defaults to `true` (`src/main/shields.js:16`, `shields.active('farble', site)`); confirm Shields is not toggled off for the test origin before judging.
- A local HTTP page is served at a known `http://127.0.0.1:PORT/` URL (e.g. `python3 -m http.server` in a fixture dir). The page need only load over a legitimate scheme; the canvas/navigator reads are performed by the apparatus via `evaluate_script` in the guest context (the prototype hooks patch all later-created canvases, so no special fixture markup is required). **Why HTTP, not file://**: the page must load over a normal scheme so farble activates for a real site origin.
- **Active precondition probe** (Step 1): confirm port 9222 answers and the fixture page is reachable before exercising farbling.

## Observables Required

- browser (JS return values evaluated in the webview guest frame — `navigator.hardwareConcurrency`, `navigator.deviceMemory`, and `canvas.toDataURL()` / `getImageData` samples — measured via chrome-devtools MCP `evaluate_script` attached to port 9222). **The apparatus must select the `<webview>` GUEST target, not the top-level Goldfinch chrome window** — the farbling hooks are installed only in the guest's page context; evaluating in the chrome shell would read the unmodified real values. The read path is CDP `Runtime.evaluate` in the guest; values are returned directly, no test-only seam.
- browser (chrome UI — the "New Identity" control for the active jar, used to reroll the seed — measured via the same MCP, a11y tree / click).
- shell (precondition probes: port reachability, fixture HTTP 200 — measured via Bash/curl).

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Probe the environment: `curl` `http://127.0.0.1:9222/json` and the fixture page URL. | Both respond (devtools lists targets including a Goldfinch window; fixture page returns HTTP 200). If either fails, halt — preconditions not met. |
| 2 | In the running app, open a tab and navigate it to the HTTP fixture page; confirm Shields is active (farble on) for this origin. Wait for load. | The fixture page renders in the active tab; Shields indicates `farble` is active (default). |
| 3 | **navigator spoof.** In the guest frame, evaluate `navigator.hardwareConcurrency` and `navigator.deviceMemory`. | Both return exactly `8` — the spoofed constants (`webview-preload.js:325,330`), masking the real machine's core count / memory. (A real, un-farbled value would typically differ from 8 and vary by machine.) |
| 4 | **Canvas noise is applied + stable within session.** In the guest, draw a fixed canvas (e.g. text + a gradient rect), read `toDataURL()` and capture it as `A`. Without reloading or changing identity, draw the identical canvas again and read `toDataURL()` as `A2`. | `A === A2` — the farbled output is **stable within the session** (a site re-reading the same canvas gets the same fake, per the deterministic per-`(seed,index)` hash, `webview-preload.js:241-246`). Record `A` for Step 6. |
| 5 | **Noise is non-trivial (sanity).** Compare `A` against the canvas's logically-expected un-noised bytes for the same draw (e.g. read the same `getImageData` region and confirm at least some sampled pixels deviate from the flat/expected values a no-noise render would produce). | The sampled pixels are perturbed — farbling is **applied**, not pass-through. (If a clean reference is impractical, treat the Step 6 cross-seed difference as the authoritative proof and mark this step a soft check.) |
| 6 | **Seed-dependence (cross-identity).** Trigger **New Identity** for the active jar (rerolls the per-session seed via `rerollSeed`, `main.js:433`; def at `main.js:407-409`). New Identity **already reloads the webview** (`renderer.js:1088`) — and the reload is required, because the guest captures `SEED` once at document-start (`webview-preload.js:233`), so a rerolled seed only takes effect on the next load. Wait for the reload to settle, then draw the identical canvas and read `toDataURL()` as `B`. | `B !== A` — a new fingerprint persona produces **different** canvas noise for the identical draw, proving the noise is keyed to the per-jar seed (not a fixed transform). `navigator.hardwareConcurrency`/`deviceMemory` remain `8` (the spoof is constant, not seed-derived). |
| 7 | **Control / farble-off (optional, if cheaply togglable).** Toggle Shields' `farble` off for the origin, reload, and re-read `navigator.hardwareConcurrency` and a fresh `toDataURL()`. | With farble off, `navigator.hardwareConcurrency` returns the **real** machine value (not forced to 8) and the canvas read matches the un-noised reference — confirming farbling is what produced the Steps 3–6 differences, not some unrelated effect. (Skip if Shields-off-per-origin isn't readily drivable; note as untested.) |

## Out of Scope

- WebGL fingerprint farbling (`readPixels`, `webview-preload.js:303`) and AudioContext farbling — extend with dedicated steps once the canvas/navigator core is promoted.
- The exact noise *distribution* / cryptographic quality of the per-seed hash — this spec proves applied + stable + seed-dependent, not statistical soundness.
- Tracker blocking and tracking-param stripping — covered by `core-browsing-shields`.
- Scheme-guard / hostile-URL behavior — covered by `tab-scheme-guard`.

## Variants (optional)

- **Two-container cross-seed** (alternative to Step 6's New Identity): open the fixture in two different containers (distinct sessions → distinct seeds) and assert the identical draw yields different `toDataURL()` across them. Use whichever of New-Identity vs. two-container is more reliably drivable at run time.
