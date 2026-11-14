# Leg: probe-and-audit

**Status**: completed
**Flight**: [Page Containment](../flight.md)

## Objective

Answer the flight's open questions Q1–Q8 with recorded evidence, finish the web-content boundary guard audit, and re-verify every `[A]` claim in the mission, so that the later legs are designed on facts and the operator can rule on the DD4 premise.

## Context

- This leg is **evidence, not fixes**. No file under `src/` changes. Its outputs are fixtures, a probe rig, and three evidence documents in the flight directory.
- **DD4 / DD5 rest on Q2 and Q3.** The operator ruled no fallback: if either fails, the flight diverts. This leg reports the result; it does not design around a failure.
- **DD12 (operator ruling)**: the audit is a _guard audit_ — for each guard, record that it exists, what it refuses, what it does not cover. No proof-of-concept payloads, no attack chains. The probes in Track A are isolation _measurements_ on our own application: each one asks "does this boundary hold", records yes/no and stops. If any agent's run is interrupted by model safeguards, stop the track, record how far it got, and signal `[BLOCKED:safeguard-interrupt]` — do not retry with altered wording.
- The leg runs as **two independent tracks** that touch no common file. The Flight Director folds both tracks' results into the flight log; neither track edits `flight-log.md`, `flight.md` or `mission.md`.
- Web guests are created with `preload`, `contextIsolation: false`, `sandbox: true`, `nodeIntegration: false`, `plugins: true`, `autoplayPolicy: 'document-user-activation-required'` (`src/main/register-tab-ipc.js` — the `webPreferencesObj` web branch; popup twin in `src/main/guest-wiring.js` `setWindowOpenHandler`). The vault isolated world id is `VAULT_ENTRY_OBSERVER_WORLD_ID = 745821` (`src/preload/webview-preload.js`). Today the world is only ever entered same-process (`webFrame.executeJavaScriptInIsolatedWorld` in `webview-preload.js`'s `execInWorld`); **no main-side call into it exists in `src/main/`**, which is why Q2 cannot be answered by driving the product over MCP and needs a rig.
- Standing operator preference: live work against the product uses `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1`, the key captured per launch, and `connectAutomation()` env-key scripts (`scripts/lib/mcp-client.mjs`). **Never the registered `goldfinch-dev` MCP server.**

## Inputs

- Branch `flight/01-page-containment`, clean tree apart from flight artifacts.
- `missions/23-security-review-remediation/mission.md` — Context findings 1–22 with `[V]` / `[A]` labels.
- `flight-log.md` — the Reconnaissance Report (items 1a–22c), the handler census, "Facts for designers".
- Electron `44.10.0` installed in `node_modules` (the rig runs under the project's own binary).
- Existing fixture server pattern: `tests/behavior/fixtures/cross-jar-fetch/` (port `8231`).

## Outputs

All paths relative to the repository root.

- `tests/behavior/fixtures/page-containment-probe/` — the standalone rig (Track A): a minimal Electron main script, a rig preload, hostile and benign probe pages, a README stating how to run it and what each probe prints. Runs with its own temporary `userData`; never touches the dev profile.
- `missions/23-security-review-remediation/flights/01-page-containment/probe-results.md` — Q1–Q4 answers (Track A).
- `missions/23-security-review-remediation/flights/01-page-containment/guard-audit.md` — Q5, Q6, Q7 and the `[A]` re-verification table (Track B).
- `missions/23-security-review-remediation/flights/01-page-containment/ipc-census.md` — Q8, the authoritative channel list (Track B).
- No change under `src/`, `test/unit/`, `docs/`, `CLAUDE.md` or `package.json`.

## Acceptance Criteria

### Prerequisites (Track A records them at the top of `probe-results.md`)

- [ ] `npm test` result recorded (count, duration, pass/fail) as the flight baseline; a pre-existing failure is recorded, not fixed.
- [ ] `wc -l src/renderer/renderer.js` recorded (expected 1504; budget 1505).
- [ ] `npm run dev:automation` with dev-mint launches on this host and an env-key script attaches; port `8231` confirmed free before use.

### Track A — live probes

Every answer below is recorded in `probe-results.md` as: the question, the method (rig or product, exact command), the raw observation (printed output, trimmed), and a one-line verdict.

- [ ] **Rig fidelity.** The rig's guest is a `WebContentsView` whose `webPreferences` match the product's web-guest branch key for key (cited from `src/main/register-tab-ipc.js`), running on the project's Electron binary; `probe-results.md` states each way the rig still differs from the product (no shields, no registry, rig preload vs. product bundle) and which answers that could affect.
- [ ] **Q1 — guest reach to the preload's IPC object.** Run twice: (a) in the rig with the **product** preload bundle (`src/preload/webview-preload.bundle.js`, rebuilt for this run, with rig-side stubs for its two synchronous channels that return **live** values — `vault-eligible` answers eligible so the icon, vault listeners and gesture code are actually installed, and `shields-farble` answers with farbling on for one run and off for another — a stub that leaves those paths dormant makes the answer vacuous), and (b) in the product over MCP on a fixture page. In both, a page script installed in `<head>` instruments the page-patchable built-ins the preload could later call through (function call/apply/bind, array iteration and mutation methods, object property definition, promise resolution, the event-listener registry) and records whether any `this` or argument it ever sees exposes IPC send/invoke capability, and whether `require`, `process` or any Electron object is reachable from the page's global scope. Verdict is one of: **object not reachable** / **object reachable** (name the built-in through which it was seen — no further use of it) / **channel name influenceable only** (the recon's `for…of plan` loop). The (a) and (b) results are compared; a disagreement is reported, not reconciled.
- [ ] **Q2 — main into the isolated world, free of page code.** In the rig, main calls `webContents.executeJavaScriptInIsolatedWorld(745821, …)` on the guest and reads a structured result back, with the page having first replaced `Promise`, `JSON` members, `Array.prototype` members, `Object.prototype` accessors and `EventTarget.prototype` members in its own world with counting wrappers. Recorded: the result main received equals what the isolated-world script returned; the page's wrappers saw **zero** calls attributable to the round trip (counter snapshot before/after); the isolated world's built-ins are not the page's (identity check inside the world). Also recorded: what main receives when the isolated-world script throws (CLAUDE.md says it resolves `undefined` — confirm for the main-initiated call), and what happens when the guest navigates cross-document between the call and its reply — the reply is compared against the frame identity read before the call and the old frame's `detached` flag.
- [ ] **Q2 — frame identity.** Recorded: which identity main can read for the guest's current main frame before a call and compare after (candidates on `webContents.mainFrame`: `processId`, `routingId`, `frameToken`, `frameTreeNodeId`, `osProcessId`, `origin`, `detached`), whether it changes on a cross-document navigation (same-site and cross-site) and stays stable on `pushState` / hash navigation, and whether a state value set in the isolated world survives each of those navigations.
- [ ] **Q3 — isolated-world listener trust.** In the rig, a listener registered in the isolated world on a page-DOM node (a stand-in for the fill icon) receives (i) a real click delivered by `webContents.sendInputEvent` and (ii) a page-script synthetic click, with the page having replaced `addEventListener` and the `isTrusted` accessor on `Event.prototype` in its own world. Recorded: `isTrusted` as read **in the isolated world** for (i) and (ii). **Pass** = (i) true and (ii) false regardless of page tampering.
- [ ] **Q3 — input control.** Before any Q3 measurement, a real click on a plain button on the benign page fires a page `click` handler reporting `isTrusted: true`. Without this control a false reading for (i) cannot be told from "input not delivered"; if the control fails, Q3 is **cannot answer here**.
- [ ] **Q3 — against the product's own icon.** The (i)/(ii) measurement is repeated with the product bundle loaded and the isolated-world listener attached to the fill icon node the product's own code renders on a login field. If the icon cannot be made to render in the rig, the Q3 verdict is labelled "mechanism holds in rig; product icon not exercised" and the reason is recorded.
- [ ] **Q3 — suppression is recorded separately from forgery.** Recorded: whether the isolated-world listener still fires for a real click when the page calls `stopImmediatePropagation` in the capture phase on `window` and on `document`; whether an isolated-world capture listener on `window` registered **before** any page script runs (document start) is called ahead of the page's; and whether the page can remove or observe an isolated-world listener. A page that can only _suppress_ the listener produces "no picker" — that is fail-closed and does not fail Q3; it is reported as a design input for `vault-fill-trust`.
- [ ] **Q3 — hit-testing from the isolated world.** Recorded: `document.elementFromPoint` at the click coordinates, the node's `getBoundingClientRect`, and `getComputedStyle` opacity / visibility / pointer-events, all read in the isolated world while the page has replaced those functions in its own world; and whether the isolated world detects each of: a transparent page element stacked above the icon, the icon scaled to cover the viewport, the icon at opacity 0.
- [ ] **Q4 — committed URL userinfo.** In the product (admin key — the chrome target needs it), a tab is navigated to a loopback fixture URL carrying userinfo, once directly and once as the target of a server redirect. Recorded: whether each navigation is admitted, the tab URL as `enumerateTabs` reports it, and the address bar's displayed value read by `evaluate` on the chrome target.
- [ ] **Q4 — chrome CSP `'self'` and `file://host/…`.** Recorded from the chrome CSP source and Chromium's documented origin rule for `file:`; state plainly that this host (Linux) cannot exercise a `file://host/` UNC path and the answer is therefore static.
- [ ] **Apparatus smoke.** While the product is up for Q1/Q4, each existing apparatus primitive is exercised once against it and its result recorded in one line each: `enumerateWindows`, `enumerateTabs`, `openTab`, `navigate`, `readDom`, `evaluate`, `click`, `typeText`, `pressKey`, `captureScreenshot`, `captureWindow` (`enumerateWindows` and the chrome target are admin-only). This is the flight's "before" reading for the same sweep after the gate migration.
- [ ] The product is quit and the fixture server stopped when Track A ends; no dev instance is left running.

### Track B — guard audit, static probes, census

- [ ] **Q5 — guard audit complete.** `guard-audit.md` has one table row per guard, across five surfaces: navigation (`will-navigate` / `will-redirect` / `will-frame-navigate`, the PDF carve-out, the non-guest view guard in `src/main/app-lifecycle.js`, `automation/nav.js`), permissions (`setPermissionRequestHandler` / `setPermissionCheckHandler` in `src/main/session-runtime.js`, plus any device/display-media handler found or its absence), popups and new windows (`setWindowOpenHandler` in `src/main/guest-wiring.js`, the popup registry, `open-tab` forwarding), TLS trust (`cert-trust.js`, `cert-observer.js`, the `certificate-error` handler), and the 13 guest-preload channels. Columns: guard (`file:symbol`), what it refuses, what it does not cover, verdict (**sound** / **gap** / **cannot tell statically**), and for a gap the owning leg of this flight, a later flight, or "squawk".
- [ ] Every row's citation was opened and read in this run; a row that could not be verified says so rather than repeating the recon.
- [ ] Any **critical** gap outside this flight's surfaces (the flight's divert criterion names a navigation-guard path to `goldfinch://` as the example) is listed first, under its own heading, with nothing else in the leg changed because of it.
- [ ] **`[A]` re-verification.** A table with one row per `[A]`-labelled claim in `mission.md` Context (findings 1–22, each sub-claim its own row). Columns: finding, claim, current evidence (`file:symbol` or `file:line — "snippet"`, or the command run for non-code claims such as advisories and Electron versions), classification (**confirmed** / **partly true** — say which part / **not reproduced** / **cannot verify from the repo**), and owning flight. Claims answered by Track A (the guest-reach claim under finding 1) are marked "see probe-results.md", not guessed.
- [ ] **Q6 — `confirmedOrigins` without a format bump.** A static trace of every path that carries a vault item: the schema and its `metadataOf` whitelist (`src/shared/vault-item-schema.js`), `ITEM_TYPES` and the load validator in `src/main/vault/vault-store.js`, `vault-editor-model.js`, the vault page's `ITEM_SUBSECTIONS`, export bundle, restore, cross-vault copy (`VaultStore.copyItem`), CSV import. For each: does an unknown non-secret field on a stored item survive, get dropped, or make the load throw (CLAUDE.md: vault stores load loudly). Verdict: **no version bump needed** / **version bump needed**, with the deciding citation. If the answer turns on behaviour that reading cannot settle, write a throwaway check in the session scratch directory (not the rig directory), run it, and record command and output — the check is not committed.
- [ ] **Q7 — popups as guest senders.** For each guest channel in the census (recon counted 13; the census's own enumeration, with its method stated, is authoritative): can a popup-registry guest send it today, is that legitimate, and what main does with it. Plus: what "the window's active tab" resolves to for a popup sender (`registry.getWindowForGuest`, the popup registry). Verdict on the flight's default (a popup is not eligible to raise the vault picker): **holds** / **breaks a legitimate flow** (name it).
- [ ] **Q8 — census.** `ipc-census.md` lists every IPC registration in `src/main/**`, one row per channel: channel name, registration form (`ipcMain.handle` / `ipcMain.on` / `registerInternalHandler` or its alias / other wrapper), `file:symbol`, state-changing or read-only, the sender check it has today (helper name, or "none"), and the caller class it will take under DD1 (chrome / owning-chrome-of-wcId / tab guest / internal / overlay sender / open-with-reason — or "undecided" with the reason). The document states the method (the exact search commands) so the count is reproducible, gives totals per form and per class, and reconciles them against both earlier counts (recon: 214 including `registerInternalHandler` sites; design review: 90 `handle` + 51 `on` raw) — every difference explained by named channels.
- [ ] The census flags separately: channels registered more than once, channels registered by a computed (non-literal) name, handlers passed by reference rather than inline, and any channel the chrome preload or a guest preload sends that has **no** main-side registration.

### Whole leg

- [ ] `git status --short` shows changes only under `tests/behavior/fixtures/page-containment-probe/` and the flight directory.
- [ ] `npm run format:check` and `npm run lint` pass with the new files in the tree (run by the Flight Director once both tracks are in; each track formats its own files with `npx prettier --write <its paths>`).

## Verification Steps

- Prerequisites: read the top block of `probe-results.md`; re-run `wc -l src/renderer/renderer.js`.
- Rig: follow the rig README's one command; its printed lines match what `probe-results.md` quotes for Q1(a), Q2, Q3.
- Q1(b), Q4, apparatus smoke: `probe-results.md` names the harness script and fixture page; each quoted observation carries the tool name that produced it.
- Track B: spot-check five audit rows, five `[A]` rows and ten census rows against the cited code; re-run the census search commands and compare totals.
- Scope: `git status --short`; `git diff --stat -- src test docs CLAUDE.md package.json` is empty.
- `npm run format:check && npm run lint`.

## Implementation Guidance

### Track A

1. **Prerequisites first.** Run `npm test` with a timeout (`timeout 300 npm test`), record. Record the renderer line count. Check port `8231`.
2. **Build the rig** under `tests/behavior/fixtures/page-containment-probe/`: an Electron main script launched with the project binary (`npx electron <rig-dir>`; choose the ozone platform the way `scripts/dev-launch.mjs` does, by requiring `src/main/ozone-platform.js`'s `decideOzonePlatform` — a bare launch on WSL can pick a broken platform). Never set `nodeIntegration`. Print the Electron and Chromium versions in the first `PROBE` line, `app.setPath('userData', <fresh temp dir>)` before `ready`, one `BaseWindow` + one `WebContentsView` with the product's web-guest `webPreferences`, pages served from a loopback HTTP server on an ephemeral port the rig picks itself (two hostnames, `127.0.0.1` and `localhost`, give a cross-site pair). The rig prints one `PROBE {json}` line per observation and exits non-zero only on a rig failure, never on a "boundary does not hold" answer — that is a result.
3. **Rig preload.** For Q2/Q3 a small rig preload is enough (the isolated world is entered from main). For Q1(a) load the product bundle; run `node scripts/build-preload.mjs` unconditionally first (the bundle is a gitignored build product) and record its SHA-256; give the rig `ipcMain.on` stubs that set `event.returnValue` for `shields-farble` and `vault-eligible` — read the product handlers for the exact reply shapes and return an eligible / farble-on reply — and accept the bundle's other sends silently. `scripts` for `executeJavaScriptInIsolatedWorld` is an array of `{ code }` objects, not a string.
4. **Hostile page.** One page whose `<head>` script installs counting wrappers before anything else; it never tries to _use_ anything it observes. The benign page is the same DOM without the script, as the control.
5. **Q3 input.** `sendInputEvent` needs the view focused and the coordinates in view DIPs; show the window and `webContents.focus()` first, then send `mouseDown` + `mouseUp` at the stand-in node's centre (read its rect from the isolated world). If a real click cannot be delivered on this host, say so and mark Q3 **cannot answer here** — do not substitute a synthetic click.
6. **Product run.** `GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` (add `GOLDFINCH_AUTOMATION_ADMIN=1` — the chrome target and `evaluate` need admin), capture the `AUTOMATION_DEV_MINT` line, attach with a script in the rig directory that imports `scripts/lib/mcp-client.mjs`. The Q1(b) and Q4 fixture pages are served by a loopback server the harness starts on port `8231` (the rig itself uses its own ephemeral port). Recipes: `docs/dev-testing.md`. `evaluate` takes `expression` — a wrong key silently evaluates `undefined`.
7. **Write `probe-results.md`**, verdict table first (Q1–Q4, one line each), then the detail.

### Track B

1. Read `flight-log.md`'s Reconnaissance Report and census, and `mission.md` Context. They are the starting index, not the answer: open every cited location.
2. **Census first** (it feeds the audit's guest-channel rows). Search `src/main/**` for `ipcMain.handle(`, `ipcMain.on(`, `ipcMain.once(`, `registerInternalHandler(`, any local alias of it, and any helper that registers on a caller's behalf; search `src/preload/**` and `src/renderer/**` for `ipcRenderer.send(` / `.invoke(` / `.sendSync(` channel literals to find the unregistered-channel set.
3. **Guard audit**, surface by surface, in the table shape above. Describe guards; do not write inputs that would defeat them.
4. **`[A]` table.** Code claims: read the code. Non-code claims: `npm audit --json` for advisories, `npm view electron@44 version` or the release notes for the Electron line, `.github/workflows/*.yml` and `ci/` for workflow claims, `package.json` `build` block for packaging claims. A claim that needs a tag-protection setting or anything else only visible in the hosting service's settings is **cannot verify from the repo** — do not query the hosting service.
5. **Q6, Q7** as static traces.

## Edge Cases

- **The product bundle blocks in the rig** (an unstubbed `sendSync`): add the stub, record which channel; if it still cannot run, Q1(a) is answered with the rig preload plus Q1(b) on the product, and the fidelity note says so.
- **Rig and product disagree on Q1**: report both; the product result stands for severity, the disagreement is a finding about the rig.
- **`executeJavaScriptInIsolatedWorld` is absent or behaves differently on `webContents`** than the typings say: record exactly what exists (`webContents`, `webFrameMain`) and what was tried. That is a Q2 answer, not a rig bug to work around.
- **A dev instance is already running** on the dev profile: stop and report; do not kill a process this leg did not start.
- **Userinfo URL**: `isSafeTabUrl` checks scheme only, so admission is expected; the open part is what the committed URL, `enumerateTabs` and the address bar show. If it is refused anywhere, record where.
- **Track B finds something that looks critical**: record it under the critical heading with its evidence and continue the table; the Flight Director decides the divert.
- **Safeguard interruption**: stop that track, keep what is written, signal `[BLOCKED:safeguard-interrupt]`.

## Files Affected

- `tests/behavior/fixtures/page-containment-probe/**` — new (rig, pages, harness script, README).
- `missions/23-security-review-remediation/flights/01-page-containment/probe-results.md` — new.
- `missions/23-security-review-remediation/flights/01-page-containment/guard-audit.md` — new.
- `missions/23-security-review-remediation/flights/01-page-containment/ipc-census.md` — new.

## Citation Audit

Design review (Developer, 2026-11-13): approve with changes; all changes incorporated — live stub values, product-icon Q3 run, input control, ozone launch, frame-identity candidates, Q4 wording. Reviewer confirmed against `electron.d.ts`: `webContents.executeJavaScriptInIsolatedWorld(worldId, WebSource[], userGesture?)` and the same method on `WebFrameMain`.

Checked against the tree at `7e2d8c4` (2026-11-13): `register-tab-ipc.js` web-branch `webPreferencesObj` (`contextIsolation: false` at line 236); `guest-wiring.js` popup `webPreferences` (line 244) and `setWindowOpenHandler` (line 219); `VAULT_ENTRY_OBSERVER_WORLD_ID = 745821` (`webview-preload.js:34`); `execInWorld` (`webview-preload.js:359`); no `executeJavaScriptInIsolatedWorld` call in `src/main/` (one comment mention, `vault/vault-human.js:857`); synchronous guest channels `vault-eligible` (`webview-preload.js:306`) and `shields-farble` (`:700`); permission handlers `session-runtime.js:260,267`; non-guest view guard `app-lifecycle.js:180-190`; `scripts/lib/mcp-client.mjs` exports `connectAutomation`, `callTool`, `unwrap`, `parseDevMintLine`; fixtures directory has no `page-containment-probe`; `renderer.js` is 1504 lines. All present.

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
