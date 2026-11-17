# Squawk 0195: WebGL farble hook answers when the native call would not — bot filters flag Goldfinch (suncountry.com does not load)

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-16
**Completed**: 2026-11-17

## Report
With Shields farbling on (the default), `https://www.suncountry.com/` never finishes loading in Goldfinch — the installed Windows build and the branch build alike. The page stays blank or shows the site's own "We're sorry, something went wrong". Google Chrome on the same machine loads it. Operator report, 2026-11-16.

The site's `POST https://syprod-api.suncountry.com/api/nsk/v1/token` is sent in full and never answered: a server-side tarpit by the site's bot filter (Imperva), not a client stall.

Cause: the WebGL `getParameter` hook returns the fake vendor/renderer string **without calling the native function**. Natively, `getParameter(37445 | 37446)` returns `null` (and raises `INVALID_ENUM`) until the page has called `getExtension('WEBGL_debug_renderer_info')`, and throws on an illegal receiver. The filter's sensor reads the two values once after `getExtension` and once more on a context without it; a hook that answers the second read is a spoof tell.

Operator ruling (2026-11-16): **loosening farbling is off the table.** The fix must not change what a page can learn.

Fix wanted: for `p === 37445 || p === 37446`, call the native first, and substitute the fake value only when the native returned a string. Illegal-receiver throws, the no-extension `null` and the GL error state then match a real browser. `bumpFp('webgl')` is unchanged.

Repro (Windows only — see Verification): clean profile, Shields default, open `https://www.suncountry.com/`. The booking page never appears.

## Evidence
- `src/preload/webview-preload.js` `installFingerprintHooks`, the `GL.prototype.getParameter` replacement: `if (FARBLE) return p === 37445 ? 'Google Inc.' : 'ANGLE (Generic GPU)'; // generic vendor/renderer` — returns before `gp.apply(this, arguments)`.
- Network log of the branch build: the token request's headers and 28-byte body go out on an h2 stream; no response headers arrive before the tab closes ~25 s later.
- Instrumented load (plain Electron 45.3.2, Windows): on the site's first (challenge) document a script under `/fight-/…` calls `getExtension('WEBGL_debug_renderer_info')` once, reads `37445`/`37446` twice from two different call sites, calls `Function.prototype.toString` on `getParameter`, and calls `navigator.gpu.requestAdapter`.
- Bisect in a plain Electron 45.3.2 control on Windows, loading the real generated preload bundle with a per-group switch added (interleaved runs):

  | Farbling applied | Result |
  |---|---|
  | none (hooks installed, real values) | loads |
  | canvas only / audio only / `hardwareConcurrency`+`deviceMemory` only | loads |
  | canvas + audio + nav, no WebGL | loads |
  | WebGL only — current string, a realistic Intel string, a realistic NVIDIA string | hangs (each) |
  | WebGL only, WebGPU adapter also nulled | hangs |
  | WebGL only, native-first hook | loads |
  | all four groups, native-first hook | loads |
  | all four groups, current hook | hangs |

- Branch build on Windows, clean profile, Shields fully on: current hook → hangs; the one-line native-first change applied to a throwaway copy of the generated bundle → token request `201`, booking page renders, and the page still reads `Google Inc.` / `ANGLE (Generic GPU)`, `hardwareConcurrency` 8, and `null` for `getParameter(37446)` before the extension is enabled.
- Ruled out on the way (all measured): the User-Agent string, the client-hint brand list, Shields block/strip/isolate, the permission handlers, the rest of the preload with farbling off.
- The verdict is sticky per profile: a jar whose first visit was flagged keeps failing after the cause is removed (pause + reload did not recover it), and a jar whose first visit passed keeps loading with farbling turned back on.

## Corrective Action
`src/preload/webview-preload.js`, the `GL.prototype.getParameter` replacement: for `37445`/`37446` it now calls the native function first (`gp.apply(this, arguments)`) and substitutes the generic value only when the native returned a string; otherwise it returns exactly what the native returned, and a native throw propagates. `bumpFp('webgl')` fires as before. The fake strings are unchanged, and with farbling off the result is the native result as before. Nothing a page can learn is loosened: the no-extension `null`, illegal-receiver throw and GL error state now match a real browser. New test `test/unit/webgl-farble-hook.test.js` executes the extracted hook function.

## Verification
- `npm test`: 7118 tests, 7114 pass, 0 fail, 4 todo, including the new `webgl-farble-hook.test.js`.
- `npm run typecheck`: clean. `npm run lint`: clean. `npm run format` then `npm run format:check`: clean.
- Neuter-verify: restoring the early `if (FARBLE) return ...` before the native call turned the new test red (1 fail); fix restored, green.
- **Real-site before/after on Windows: PASSED** (2026-11-17, Flight Director). The branch build ran under Electron 45.3.2 for Windows on a fresh dev profile each time, Shields at their defaults (enabled, block, strip, isolate and farble all on), driven over the MCP surface with a per-launch minted key.
  - After (this fix): `https://www.suncountry.com/` renders its booking page; the token request answers `201` and its follow-up `200`. In the same tab the page reads `Google Inc.` / `ANGLE (Generic GPU)` once the extension is enabled, `null` for `getParameter(37446)` before it, a `TypeError` from `getParameter.call({}, 37446)`, and `hardwareConcurrency` 8.
  - Before (the old early return restored in a throwaway copy of the generated bundle, same build, fresh profile): the page stays at "Skip to main content" and the token request never completes; `getParameter(37446)` answers `ANGLE (Generic GPU)` before the extension is enabled and for an illegal receiver.
  - Not checked: the installed build, and recovery of a jar that was flagged before the fix (expected to need its `suncountry.com` cookies cleared once).

Required:
- One new unit test. The farbling hooks have no unit coverage today (they run in the page main world; `tests/behavior/farbling-correctness.md` is a never-run draft).
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`.
- **Real-site before/after on Windows** (`docs/dev-testing.md` → *Web-compat triage* rule). Under WSL the site fails in every browser tried, including real Google Chrome 145, so WSL cannot show the fix. Use a clean profile: an already-flagged jar stays flagged.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped)
**Verdict**: confirmed — no blocking or non-blocking issues. The reviewer re-ran the gates (7118 tests, 7114 pass, 0 fail, 4 todo; typecheck, lint and format:check clean) and its own neuter-verify (old early return restored → the new test fails; restored → passes). One residual noted: the test's extraction regex ends on an indent-sensitive anchor, which fails loudly rather than vacuously if the layout shifts. Out of scope, noted for follow-up: WebGPU exposure (squawk 0196), hooked functions not reading as native code under `Function.prototype.toString`, and other farble hooks that may skip the native call.
**Commit**: the `squawk/0195: WebGL farble hook calls the native first` commit on `squawk/0195-webgl-farble-hook-answers-when-native-would-not`
