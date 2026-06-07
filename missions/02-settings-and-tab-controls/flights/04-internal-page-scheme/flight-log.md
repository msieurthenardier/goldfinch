# Flight Log: Internal Page Scheme (`goldfinch://`)

**Flight**: [Internal Page Scheme (`goldfinch://`)](flight.md)

## Summary
Flight `in-flight` (started 2026-06-07). Executing via `/agentic-workflow`. Branch
`flight/4-internal-page-scheme`. Execution notes, decisions, deviations, and anomalies appended below.

---

## Flight Director Notes

- **Phase file**: loaded project `leg-execution.md` — valid (Crew / Interaction Protocol / Prompts
  present; Developer + Reviewer both Sonnet; Accessibility Reviewer present but `Enabled: false`).
  Developer/Reviewer crew is Sonnet per phase file; FD planning on Opus.
- **Branch**: `git checkout -b flight/4-internal-page-scheme` off `main` (@ `ee8174d` v0.4.6),
  carrying the uncommitted planning artifacts (flight.md, flight-log.md, extended
  `tab-scheme-guard.md`) onto the branch.
- **Design review**: flight spec went through **2 Architect cycles → approve** at planning. Highest-
  leverage catches incorporated: CSP must ship in the `protocol.handle` `Response` headers (not
  `onHeadersReceived`, which custom-protocol responses bypass) with a CDP read-back; a11y harness
  extended with a guest-target axe mode (it only audited the `index.html` chrome target).
- **Autonomous vs live-environment split** (FD decision): legs 1–5 (`pin-a11y-baseline`,
  `scheme-registration-and-serving` code, `trusted-embedder-path`, `boundary-hardening`, `docs`) are
  agent-implementable and run through the crew now (design → design-review → implement), then ONE
  batched review + commit. The **live-environment** steps — leg-2 `will-navigate` spike, leg-6
  `verify-integration` (behavior tests + a11y-over-CDP + CSP read-back), leg-7 `hat-and-alignment` —
  need a running GUI Electron app the harness can't autonomously launch, so they run with the operator
  against the live app (this project's established deferred-commit / live-verify model, per Flight 1–3
  debriefs). Leg 4's session-aware `will-navigate` branch is written defensively regardless of the
  spike (Architect predicts it's belt-and-suspenders — programmatic load/reload skips `will-navigate`);
  the spike confirms whether it's load-bearing.

---

## Leg Progress

### pin-a11y-baseline

**Status**: landed (2026-06-07; batched-commit — not yet committed)

**Changes made** (only `scripts/a11y-audit.mjs`):
- **Per-node target capture** — `runAxe` now maps each violation's nodes to their target
  selectors (`nodes: v.nodes.map(n => n.target.flat(Infinity).join(' '))`, flattening axe's
  shadow-DOM arrays-of-arrays) plus a `count`, instead of just a node count, so allowlist
  matching is by `id` + selector.
- **Curated `ACCEPTED` allowlist + per-node partition (DD7)** — seeded with the debrief/Known-Issue
  findings: `region` ×{`#tabs`,`#brand`,`#address-wrap`}, `landmark-one-main` (`html`),
  `page-has-heading-one` (`html`), and 2× `scrollable-region-focusable` scoped by state
  (`#privacy-body`@privacy-panel, `#lightbox-stage`@lightbox). Region selectors confirmed against
  `src/renderer/index.html` ids; the rest are best-effort and every entry is marked `VERIFY-LEG6`
  pending live reconcile. The report explodes each violation into per-node `(id, selector, state)`
  pairs; a pair is accepted iff some entry matches `id` + `selector` (+ `state` when set). Accepted
  pairs print as informational; NEW pairs print with their selectors; exit 0 iff no NEW pairs.
- **Guest-target mode (`--target=<url-substring>`, DD7)** — new `findGuestTarget` selects a
  `page`/`webview` target by URL substring and `fail()`s clearly if none match; `main` branches to
  skip the chrome 4-state UI driving (guest has no `togglePanel`/`togglePrivacy`/`openLightbox`),
  injecting axe and running the diff once on the already-loaded guest DOM. A code comment flags that
  the flat `/json` list may not surface `<webview>` guests — leg 6 may need
  `Target.getTargets`/`setAutoAttach`.
- **Header comment** — kept the DD3 origin line (CDP injection bypasses page CSP) and added the DD7
  baseline-diff description (curated, reviewed-in-PR, NOT auto-dumped; the `--target` guest mode).
  `nested-interactive` stays disabled; `--rules`/`--tags`/`--url` unchanged.

**Notes**:
- **Offline gates run**: `npm run lint` → 0 problems (ESLint covers `scripts/**` as ESM);
  `npm test` → 147/147 pass (unchanged — no `src/**`/`test/**` touched); `npm run typecheck` → clean
  (does NOT cover this `.mjs` per `jsconfig.json include: src/**`, run only to confirm no regression
  elsewhere). Also verified the flatten + per-node partition logic with an isolated node harness: an
  accepted selector does not suppress a sibling unaccepted node of the same rule id; the `state`
  tiebreak rejects a matching selector seen in the wrong state; shadow targets flatten correctly;
  exit code is 1 iff any NEW pair exists.
- **Deferred to leg 6 (verify-integration, live)**: reconcile the seeded `ACCEPTED` (esp. the
  best-effort `scrollable-region-focusable` and `html`-scoped selectors) against a real
  `npm run dev:debug` + `npm run a11y` run, drop the `VERIFY-LEG6` markers, reconcile the mission
  Known-Issue text, and run the guest-target mode live against `goldfinch://settings` (the scheme
  isn't served until leg 2 / embeddable until leg 3). The live a11y gate was NOT run here (needs a
  GUI the autonomous harness can't launch).

### scheme-registration-and-serving

**Status**: landed (2026-06-07; batched-commit — not yet committed)

**Changes made**:
- **`src/main/main.js`**:
  - Requires: added `protocol`, `net` to the `electron` destructure; added `const { pathToFileURL } = require('url')`.
  - **Module-top-level (before `app.whenReady`)**: `protocol.registerSchemesAsPrivileged([{ scheme: 'goldfinch', privileges: { standard: true, secure: true } }])`. Added `INTERNAL_PARTITION = 'goldfinch-internal'` (in-memory, no `persist:`), a fixed `INTERNAL_PAGES` host→file allowlist (`settings` → `src/renderer/pages/settings.html`, a FIXED path — not URL-derived, traversal-proof), `INTERNAL_CSP` (`default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'`), the module-scoped `creatingInternalSession` flag, and the `handleInternal(request)` handler.
  - **`handleInternal`**: non-GET → 405; only `url.host === 'settings'` + root path → serve via `net.fetch(pathToFileURL(file).toString())` wrapped in try/catch, re-wrapped as `new Response(res.body, { headers })` with `Content-Type: text/html; charset=utf-8` + the strict CSP (set in the Response headers per DD3, NOT `onHeadersReceived`); every other host/path → 404; `net.fetch` rejection → 500; never throws. Comment notes `standard:true` is load-bearing for host routing.
  - **`session-created` hook**: now skips BOTH `applyShields` and `wireDownloadHandler` for the internal session, gated by the module flag read INSIDE the hook (set before `fromPartition`, which emits the event synchronously); marks `ses.__goldfinchInternal = true` and returns early.
  - **`whenReady`**: set `creatingInternalSession = true`, `session.fromPartition(INTERNAL_PARTITION)`, reset flag, post-creation `__goldfinchInternal` marker (belt-and-suspenders), then `internalSession.protocol.handle('goldfinch', handleInternal)` (session-scoped, not global `protocol`).
  - **`applyShields`**: added defensive `if (ses.__goldfinchInternal) return;` at the top (belt-and-suspenders; the hook-level flag skip is the PRIMARY mechanism).
  - Type-cleanliness: the two `__goldfinchInternal` writes onto typed `Session` objects use inline `/** @type {any} */ (...)` casts, matching the file's existing JSDoc-cast style; no `@ts-ignore`.
- **`src/renderer/pages/settings.html`** (NEW, new `pages/` dir): minimal accessible stub — `<!doctype html>`, `<html lang="en">`, `<title>Settings — Goldfinch</title>`, `<main><h1>Settings</h1><p>Coming soon.</p></main>`. No inline `<script>`, no inline style (satisfies `default-src 'self'`).

**Notes**:
- **Offline gates run**: `npm run typecheck` → 0 (main.js in tsc scope; no `net.fetch`/`protocol` type breakage), `npm run lint` → 0, `npm test` → 147/147 unchanged.
- **Scope held**: did NOT touch `renderer.js`, `isInternalPageUrl`, the internal preload, `will-attach-webview`, or `will-navigate` (legs 3/4).
- **Deferred to leg 6 / operator (live, GUI-gated — the harness can't launch the Electron GUI)**: live serving of `goldfinch://settings`; the **`will-navigate` spike** (DD4 — inject `<webview partition="goldfinch-internal" src="goldfinch://settings">` over CDP, observe whether `will-navigate` fires on load + reload, record here); the **CSP read-back** over CDP (DD3 — confirm `frame-ancestors 'none'` actually shipped on the served Response); 404 confirmation for `goldfinch://nope`.

### trusted-embedder-path

**Status**: landed (2026-06-07; batched-commit — not yet committed)

**Changes made**:
- **`src/shared/internal-page.js`** (NEW): single source of truth for the partition string — `module.exports = { INTERNAL_PARTITION: 'goldfinch-internal' }`. Both main and the chrome-preload bridge now require it; the literal is retyped nowhere.
- **`src/shared/url-safety.js`**: added `isInternalPageUrl(url)` mirroring `isSafeTabUrl`'s shape (string guard, `try { new URL } catch`, never throws). Accepts iff `protocol === 'goldfinch:'` AND `host === 'settings'` AND `pathname === '/' || pathname === ''` (root-path accepted with/without trailing slash so it holds in BOTH the Node runner — `pathname:''` — and Electron's registered-standard runtime — `pathname:'/'`). Added to BOTH export branches (`module.exports` + `globalThis`).
- **`src/main/main.js`**: replaced leg-2's local `const INTERNAL_PARTITION` with `const { INTERNAL_PARTITION } = require('../shared/internal-page')` (all uses unchanged). `will-attach-webview` grew its third `params` arg: when `params.partition === INTERNAL_PARTITION` it sets `contextIsolation:true, nodeIntegration:false, sandbox:true` and returns; web webviews keep the existing `contextIsolation:false` path.
- **`src/preload/internal-preload.js`** (NEW): minimal trusted preload — `contextBridge.exposeInMainWorld('goldfinchInternal', { version: 1 })`. Runs context-isolated; no node, no media/farbling. Flight 6 grows it.
- **`src/preload/chrome-preload.js`**: requires the shared module; added `internalPreloadPath` (`file://…internal-preload.js`) and `internalPartition: INTERNAL_PARTITION` to the `window.goldfinch` bridge alongside `webviewPreloadPath`.
- **`src/renderer/renderer-globals.d.ts`**: added `internalPreloadPath: string;`, `internalPartition: string;`, and `declare function isInternalPageUrl(url: any): boolean;`.
- **`src/renderer/renderer.js`**: `createTab(url = HOMEPAGE, container = null, { trusted = false } = {})`. Validation split: `const ok = trusted ? isInternalPageUrl(url) : isSafeTabUrl(url); if (!ok) return null;` — trusted is an explicit call-site arg, NEVER inferred from the URL. Preload selected by `trusted`. Dot logic skips `jar.id === 'internal'` (treated like default). Kebab Settings TODO replaced with `createTab('goldfinch://settings', null, { trusted: true })`. `onOpenTab` (`renderer.js:1686`) left untouched — still `createTab(url)`, no flag.
- **`test/unit/url-safety.test.js`**: +14 `isInternalPageUrl` cases (accepts `settings` + `settings/`; rejects `settings/x`, `other`, `https://settings`, `file:`, `data:`, `javascript:`, `''`, null, undefined, number, object, malformed). Host-casing intentionally NOT asserted (diverges Node-vs-Electron).
- **`eslint.config.mjs`**: added `src/preload/internal-preload.js` to the commonjs/node block and `isInternalPageUrl: 'readonly'` to the renderer globals (the two no-undef errors surfaced by lint).

**DATA-LOSS-TRAP mitigation (design-reviewed, not regressed)**: on the trusted branch the synthetic internal jar is set as the `jar` ITSELF — one object `{ id: 'internal', name: 'Settings', color: '#9aa0ac', partition: window.goldfinch.internalPartition }` — so the webview `partition` attribute, `tab.container`, AND the dot logic all derive from it. This prevents a New Identity click on the Settings tab from calling `identityNew({ partition: 'persist:goldfinch' })` and wiping the user's real default browsing jar.

**Notes**:
- **Offline gates run**: `npm run typecheck` → 0; `npm run lint` → 0; `npm test` → 161/161 (was 147; +14 new `isInternalPageUrl` cases).
- **Scope held**: did NOT touch `will-navigate` or the `tab-scheme-guard` fixture/spec (leg 4). Did NOT run the live GUI.
- **Deferred to leg 6 (live, GUI-gated)**: click kebab → Settings opens a tab to `goldfinch://settings`, the stub renders, and it reloads; confirm the internal bridge is present and context-isolated. This leg makes the page embeddable; leg 2 serves it.

### boundary-hardening

**Status**: landed (2026-06-07; batched-commit — not yet committed)

**Changes made**:
- **`src/main/main.js`**: the `will-navigate` guard (inside `app.on('web-contents-created')`, DD4) is now **session-aware**. The discriminator is the **session marker** `/** @type {any} */ (contents.session)?.__goldfinchInternal` (leg 2 sets it) — NOT the URL string, so a web webview can never present as the internal session. Internal session: navigation allowed **only** when `isInternalPageUrl(url)` (else `preventDefault`) — keeps `goldfinch://settings` load/reload working while blocking any other full navigation of the internal webview. Web session (and any falsy/missing session, via optional access): the existing `!isSafeTabUrl(url) → preventDefault` branch is **byte-equivalent** to before (still rejects `goldfinch://`, `file:`, `data:`, `javascript:`). Import widened: `const { isSafeTabUrl, isInternalPageUrl } = require('../shared/url-safety')`.
- **`tests/behavior/fixtures/tab-scheme-guard/index.html`** (lint-excluded fixture dir): added a new `<section>` "Internal scheme (goldfinch://) spoof vectors" with four stable-id buttons — `#open-goldfinch` (`window.open('goldfinch://settings')`, inline), `#nav-goldfinch` (`window.location = 'goldfinch://settings'`, inline), `#embed-goldfinch` (script-wired: injects an explicitly sized 320×120, `2px solid #f90`-bordered `<iframe src="goldfinch://settings">` and writes a positive "iframe injected" status to `#goldfinch-embed-result` + `console.log`, so a blank-but-present iframe pass-state is distinguishable from a never-fired button), and `#fetch-goldfinch` (script-wired: `fetch('goldfinch://settings')` → writes `resolved`/`rejected: <err>` to `#goldfinch-fetch-result` + `console.log`). Vectors 1–6 and the `trigger-page-loaded` marker left intact; new wiring follows the existing attach-by-id pattern.

**Static assertion (protocol-handle internal-session-only, read-confirmed — no code change)**: `protocol.handle('goldfinch', handleInternal)` is registered **only** on `internalSession` (`main.js:630`, inside `whenReady`), session-scoped after `creatingInternalSession`/`fromPartition(INTERNAL_PARTITION)`. It is never registered on `session.defaultSession`, the `PAGE_PARTITION` session, or the global `protocol`. Therefore a web-origin webview has **no `goldfinch://` handler** — the fourth gate. Confirmed by grep + read of the only `protocol.handle` call site.

**Gate-evidence attribution (for leg-6 live test design)**:
- `#open-goldfinch` (`window.open`) is rejected at the **renderer gate** — `setWindowOpenHandler` → `open-tab` IPC → `createTab` *untrusted* → `isSafeTabUrl` rejects `goldfinch://`. It does NOT reach this leg's `will-navigate`.
- `#nav-goldfinch` (`window.location`) is what exercises **this leg's new session-aware `will-navigate` web branch** (web session, `!isSafeTabUrl → preventDefault`).
- `#fetch-goldfinch` rejects on BOTH counts: the scheme isn't registered with `supportFetchAPI`, AND the web session has no handler at all.
- `#embed-goldfinch` iframe stays blank from a web origin: no handler on the web session AND (defense-in-depth) the internal CSP `frame-ancestors 'none'`.

**Notes**:
- **Offline gates run**: `npm run typecheck` → 0; `npm run lint` → 0 (main.js clean; fixture dir lint-excluded); `npm test` → 161/161 unchanged (no unit/test-suite change).
- **Scope held**: did NOT touch `createTab`, the preloads, `protocol.handle`, or `will-attach-webview` (legs 2/3). The `tab-scheme-guard.md` spec (steps 8–13) needed no edit — its plain-English steps reference button actions, not literal fixture ids, and the ids created concretely match. Did NOT run the live GUI.
- **Deferred to leg 6 (live, GUI-gated)**: drive the four new spoof vectors and confirm each rejection (no internal tab/stub via `window.open`/`location`; iframe renders blank, not the stub; `fetch` rejects); run the trusted-open + reload positives; run the **`will-navigate` spike** (does it fire on the internal webview's INITIAL load AND reload, incl. any `about:blank` interaction?); and the **CSP read-back** (`goldfinch://nope` 404).

---

### docs

**Status**: landed (2026-06-07; batched-commit — not yet committed)

**Changes made** (docs-only; no source/test/spec touched):
- **`README.md`**: rewrote the kebab **Settings** description (no longer an inert "not yet functional" placeholder — it now opens the internal settings page in a new tab, still a "coming soon" stub). Added the new internal-page files to the Architecture table (`internal-preload.js`, `src/shared/internal-page.js`, `src/renderer/pages/settings.html`) and a new **"Internal pages (`goldfinch://`)"** subsection: privileged `standard`+`secure` scheme, dedicated `goldfinch-internal` session via `protocol.handle`, strict CSP (`frame-ancestors 'none'`), single `goldfinch://settings` stub, trusted-chrome-only reachability (web content cannot navigate/open/embed/`fetch` it), pointing to CLAUDE.md for the model.
- **`CLAUDE.md`**: (1) Commands — updated the `npm run a11y` line to describe the curated `ACCEPTED` baseline-diff gate (fails only on NEW `(rule id, node-selector)` findings, not fail-on-any) and the `--target=<url-substring>` guest mode (DD7). (2) Architecture — added `internal-preload.js` (context-isolated, minimal `window.goldfinchInternal`, distinct from `webview-preload.js`/`window.goldfinch`; Flight 6 grows it) to the Preloads bullet, and noted the kebab **Settings** now opens `goldfinch://settings` via `createTab(..., { trusted: true })` (stub). (3) Patterns — new **"Internal `goldfinch://` pages — the trusted-embedder security model"** subsection after the two-point hostile-URL boundary: scheme+session, single-sourced `goldfinch-internal` partition (`src/shared/internal-page.js`), **CSP-in-Response not `onHeadersReceived`** (custom-protocol responses bypass `webRequest`), the **four gates** (provenance flag + `isInternalPageUrl` allowlist + session-aware `will-navigate` + internal-session-only handler), **"never widen `isSafeTabUrl`"**, and the context-isolated internal webview + session exclusion from Shields/download wirings.

**Doc-rule compliance**:
- **No line numbers** anywhere in the added text — every claim references symbols / scheme names / DD ids.
- **Stub reality honored** — described `goldfinch://settings` as a "coming soon" stub throughout; no claim of a working settings UI or wired controls (those are Flights 5/6).
- Extended **existing** homes (Architecture table, Preloads bullet, Patterns security section, Commands a11y line) rather than adding parallel sections; the internal-path exception sits alongside the existing `isSafeTabUrl` two-point boundary, not contradicting it.

**Notes**:
- **Offline gates run**: `npm run lint` → 0; `npm run typecheck` → 0; `npm test` → 161/161 — all unchanged-green (docs-only).
- **Markdown formatting**: ran `npx prettier --write README.md CLAUDE.md` (touched files only); `prettier --check` on both passes. Did NOT touch unrelated drift (the known `.github/dependabot.yml` carry-forward left alone).
- **Scope held**: no source, tests, or behavior specs modified. Did NOT run the live GUI.

---

## Decisions
Runtime decisions not in the original plan.

### Leg-1 design review: incorporated, second cycle skipped
**Context**: The Developer design-review of leg 1 returned "approve with changes" (5 precision fixes:
per-node-vs-per-violation partition contradiction, typecheck-doesn't-cover-`.mjs`, guest-mode
offline-verifiability scope, shadow-target flatten, page|webview predicate).
**Decision**: All fixes incorporated verbatim. A second design-review cycle was **skipped** — the
changes were direct, faithful adoptions of the reviewer's own recommendations introducing no new
design surface (`SendMessage` to re-confirm the same agent is unavailable in this environment; a fresh
full re-review would only echo). Within the skill's "skip if only minor/cosmetic" discretion, treating
these as faithful incorporations.
**Impact**: Leg 1 implemented cleanly first pass; offline gates green.

### Design-review yield across legs 2–4 (high-value catches)
The per-leg Developer design reviews caught real defects before implementation:
- **Leg 2 [HIGH]**: the internal-session exclusion would have silently failed — `session-created` fires
  **synchronously inside `fromPartition`**, before any post-creation marker. Fixed to a module flag set
  BEFORE `fromPartition`, excluding both `applyShields` and `wireDownloadHandler`.
- **Leg 3 [HIGH / data-loss]**: a trusted tab whose webview partition was `goldfinch-internal` while
  `tab.container` stayed `DEFAULT_CONTAINER` (`persist:goldfinch`) would, on a **New Identity** click,
  wipe the user's real default jar. Fixed by setting the synthetic internal jar as a single object that
  partition attribute + `tab.container` + dot logic all derive from. Also added a single-source partition
  constant (`src/shared/internal-page.js`).
- **Leg 4 [medium/low]**: iframe-embed vector observability hardened; optional-chaining on the session
  guard; spike scope widened to the internal tab's INITIAL load (about:blank interaction).

### Batch review + commit (Phase 2d)
**Reviewer** (independent, no implementer context) reviewed ALL uncommitted changes across legs 1–5 →
**`[HANDOFF:confirmed]`**. Verified: `isSafeTabUrl` byte-unchanged; no web path reaches the trusted
branch (all 10 `createTab` callers enumerated — only the kebab Settings handler passes `trusted:true`);
`trusted` never inferred from URL; data-loss trap avoided (`tab.container.partition` === webview
partition === `goldfinch-internal`); `protocol.handle` internal-session-only; CSP in Response headers;
session-aware `will-navigate`; `will-attach-webview` isolation; the module-flag exclusion. Offline gates:
typecheck 0, lint 0, **test 161/161**.
**FD lifecycle decision**: committing legs 1–5 as **`landed`** (code complete + reviewed), flight stays
**`in-flight`** — promotion to `completed`/flight-`landed` follows the operator's **live** legs 6–7
(behavior test steps 8–13, the `will-navigate` spike, CSP read-back, live a11y reconcile, HAT). This is
the project's deferred-commit / live-verify model (Flight 1–3 precedent). Draft PR opened with legs 1–5
checked (code-complete) and 6–7 flagged pending-live.
**Docs leg (5) design-review**: skipped the separate design-review spawn as a proportionality call
(docs-only; the implementing Developer reads real code/docs and the batch Reviewer covered it).

---

## Deviations
Departures from the planned approach.

_(none yet)_

---

## Anomalies
Unexpected issues encountered.

_(none yet)_

---

## Session Notes
Chronological notes from work sessions.

_(none yet)_
