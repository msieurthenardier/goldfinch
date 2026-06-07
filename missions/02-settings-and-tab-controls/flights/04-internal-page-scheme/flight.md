# Flight: Internal Page Scheme (`goldfinch://`)

**Status**: landed
**Mission**: [Settings Area & Tab-Bar Controls](../../mission.md)

## Contributing to Criteria
- [x] **SC5** — Choosing **Settings** opens the settings surface in its own tab via an internal
  address, reloadable like any other tab, while web-page content **cannot navigate to, open, embed,
  or spoof** the internal scheme — page-originated attempts (`window.open('goldfinch://…')`,
  `location = 'goldfinch://…'`, `<iframe src="goldfinch://…">`, cross-origin `fetch`) are all
  rejected (*behavior-test-backed — extends the `tab-scheme-guard` spec*). **Verified: `tab-scheme-guard`
  13/13 live (run 2026-06-07-19-40-28); all four `goldfinch://` spoof vectors rejected; trusted
  kebab→Settings opens + reloads the stub.** *(Note: the settings surface is a "coming soon" **stub** this
  flight — SC6/SC7 enrich/wire it in Flights 5/6; SC5's plumbing + boundary is what's satisfied here.)*
- [x] **SC8** — The new internal-page surface is keyboard-operable and introduces no new WCAG A/AA
  violations under the project's accessibility gate. This flight also **pins the a11y baseline** the
  gate has lacked since Flight 1 (thrice-flagged), so "no new violations" becomes a real,
  CI-able assertion rather than a manual node-by-node judgment. **Verified: `npm run a11y` "No NEW
  violations" vs the pinned `ACCEPTED`; settings stub a11y-clean via the guest-target mode.**

> **What this flight does and does NOT advance.** Flight 4 builds the *plumbing* — the privileged
> `goldfinch://` scheme, its dedicated session + serving, the trusted embedder path, the boundary
> hardening, and the internal-page preload bridge — and proves it end to end by opening a **minimal
> `goldfinch://settings` stub** ("Settings — coming soon"). **SC6** (the modern settings-page chrome)
> lands in Flight 5 by enriching that same document; **SC7** (wiring real Shields/home-page controls)
> lands in Flight 6 by populating the internal-page bridge. This flight serves the real destination
> URL so those flights only enrich, never re-plumb.

---

## Pre-Flight

### Objective

Introduce Goldfinch's internal-page mechanism: register `goldfinch://` as a privileged scheme
(`{ standard: true, secure: true }`) at module load, serve bundled assets through `protocol.handle`
on a **dedicated internal session** with its own strict CSP, and open internal pages **only through a
trusted embedder path** that web content cannot reach — **without** widening the shared `isSafeTabUrl`
predicate. Prove the path end to end by wiring the kebab's inert **Settings** item to open a minimal
`goldfinch://settings` stub in its own tab, reloadable like any other tab. Keep `will-navigate`
rejecting the scheme from web origins, add a dedicated internal-page preload bridge (minimal surface
this flight; Flight 6 populates it), and extend the `tab-scheme-guard` behavior test to prove web
content cannot navigate to, open, embed, or spoof the scheme. Alongside, **pin the long-missing a11y
baseline** so the accessibility gate becomes a real "no new violations" check before the large
settings surface arrives in Flight 5.

### Open Questions
- [x] Should the internal scheme be admitted by widening `isSafeTabUrl`? → **No — security
  paramount (operator).** `isSafeTabUrl` is reachable by hostile pages through *both* gates
  (`window.open`→`createTab` and `will-navigate`); widening it would expose the scheme. Internal
  pages open only through a trusted embedder path. See DD1.
- [x] What shape is the trusted embedder path? → **`createTab` gains an explicit `trusted` option**
  validated against a new, separate `isInternalPageUrl` allowlist; the page-reachable `onOpenTab`
  route never sets it. See DD1 (Option A, operator-selected).
- [x] What does Flight 4 serve? → **A minimal `goldfinch://settings` stub** (the real destination
  URL), enriched into the settings shell by Flight 5. See DD6.
- [x] How is the a11y baseline pinned, given the user-global snapshot-not-committed rule? → **A small,
  hand-curated committed `ACCEPTED` allowlist** in `scripts/a11y-audit.mjs` (no auto-dump). Operator
  clarified the rule targets binary clutter/PII, not small text config. See DD7.
- [ ] **Does `will-navigate` fire on the internal webview's *own* initial load and on reload — and
  would the current guard block it?** Empirical premise; the boundary guard's shape depends on it.
  **Resolve by spike before locking the boundary leg** (Flight-3 "spike before the dependent build"
  lesson). See DD4.
- [ ] Exact `protocol.handle` resolution (map `goldfinch://settings` → `src/renderer/pages/settings.html`;
  reject any other path/host with 404, no traversal) — confirmed at leg design. See DD2.
- [ ] Whether the internal session must be **excluded** from the `session-created` Shields/tracker
  hooks (which fire for *every* session, `main.js:519`) or whether they are harmless on it —
  confirmed at leg design. See DD3.
- [ ] macOS confirmation of the frameless + scheme behavior — deferred to the standing mac HAT
  (dev/verify platform is Linux/WSL). Inherited mission deferral.

### Design Decisions

**DD1 — Trusted embedder path via a `createTab` `trusted` flag + a separate `isInternalPageUrl`
allowlist; NEVER widen `isSafeTabUrl` (Option A, operator-selected)**:
`createTab` (`renderer.js:378`) gains an explicit options arg: `createTab(url, container, { trusted = false })`.
When `trusted`, it validates against a **new** predicate `isInternalPageUrl(url)` (exact allowlist —
only `goldfinch://settings` for now) **instead of** `isSafeTabUrl`, and selects the **internal
partition + internal preload**; otherwise it behaves exactly as today (`isSafeTabUrl`, jar partition,
media preload). `isInternalPageUrl` lives in `src/shared/url-safety.js` **parallel to `isSafeTabUrl`**
— dual-exported (CommonJS `module.exports` for main + `globalThis` for the renderer), **mirrored as
`declare function isInternalPageUrl(url: any): boolean;` in `renderer-globals.d.ts`** (or `checkJs`
typecheck fails on the renderer reference — the Flight-1 lesson), and covered by a unit test beside
`test/unit/url-safety.test.js` (asserts it accepts exactly `goldfinch://settings` and rejects
`goldfinch://anything-else`, web schemes, and `file:`/`data:`/`javascript:`). The page-reachable route `onOpenTab(url => createTab(url))` (`renderer.js:1686`)
passes **no flag**, so web content can never select the internal branch. The kebab Settings handler
(`renderer.js:327`) calls `createTab('goldfinch://settings', null, { trusted: true })`.
- Rationale: the trust boundary in this codebase is **provenance** — untrusted web content never runs
  in the chrome renderer; it can only deliver a *string URL* across the `open-tab` IPC. A flag set by
  the **call site** is therefore unspoofable from page content. Two independent gates (provenance flag
  + `isInternalPageUrl` allowlist) plus the two main-process gates (DD2/DD4) give layered defense.
  `isSafeTabUrl`'s reject set is **never** widened — it keeps rejecting `goldfinch://` on every
  page-reachable call.
- **Critical subtlety**: the flag MUST be an explicit caller argument — **never inferred from the URL
  scheme**. Inferring "`goldfinch://` ⇒ internal" inside `createTab` would let a page URL of
  `goldfinch://settings` arriving via `onOpenTab` be treated as trusted. Provenance comes from *who
  called*, not *what the string says*. (Even then `isSafeTabUrl` would reject it on the untrusted
  branch — but we never lean on a single gate.)
- Trade-off vs a fully separate `openInternalPage()` function: Option A keeps one tab-bookkeeping
  codepath (the settings tab is a first-class tab — in the strip, closeable, reloadable), avoiding the
  "parallel-but-separate implementation drift" the Flight 2/3 debriefs repeatedly flagged as the
  project's recurring debt. The cost — confirming no page-reachable caller passes `trusted:true` — is
  a trivial grep (only the Settings handler does).
- Supersedes the stale Flight 2/3 debrief action item ("wire Settings through `isSafeTabUrl`"), which
  predates the firmed mission constraint and is rejected on security grounds.

**DD2 — Privileged scheme registered at module load; served via `protocol.handle` on the internal
session only**: Call `protocol.registerSchemesAsPrivileged([{ scheme: 'goldfinch', privileges: { standard: true, secure: true } }])`
at **module top level in `main.js`, before `app.whenReady`** (`main.js:524`) — privileged
registration must precede app ready. Register the handler on the **dedicated internal session** via
the **session-scoped** protocol object — `session.fromPartition('goldfinch-internal').protocol.handle('goldfinch', …)`,
NOT the global `protocol.handle` (which binds the default session) — inside `whenReady`, resolving
`goldfinch://settings` → `src/renderer/pages/settings.html` (new dir) and returning **404 for any
other host/path** with no path traversal. Use Electron's recommended `net.fetch(pathToFileURL(...))`
inside the handler rather than manual `fs` reads. There is **no existing `protocol.*` usage** in the
codebase — this is all net-new.
- **The internal partition string must match byte-for-byte on both sides** — the
  `session.fromPartition('goldfinch-internal')` that registers the handler and the
  `webview.setAttribute('partition', 'goldfinch-internal')` the trusted branch sets (DD1). It is
  intentionally **in-memory (no `persist:` prefix)** — the stub is static and has no state to persist
  this flight.
- **Address-bar typing is ungated but moot for this scheme** (Architect): `navigate()`
  (`renderer.js:595`) calls `webview.loadURL(toUrl(input))` with no `isSafeTabUrl` check and `loadURL`
  is programmatic (skips `will-navigate`), so typing `goldfinch://settings` in a *web* tab attempts a
  load on the **web** partition session — which has **no `goldfinch://` handler**, so it fails
  harmlessly. The only thing protecting here is the handler-on-internal-session-only gate; that is
  exactly DD2's intended fourth gate, so no extra work — but the behavior test correctly scopes
  address-bar typing out (the existing Out of Scope note stands).
- Rationale: `standard: true` gives the scheme proper origin semantics (needed for a secure context
  and a sane CSP); `secure: true` makes it a trusted origin. Registering `handle` only on the internal
  session means a web-content webview, even if it somehow carried a `goldfinch://` src, has **no
  handler** in its session and the load fails — a fourth gate beyond DD1/DD4.
- Trade-off: a hardcoded one-entry route map; expanded deliberately (per added internal page) rather
  than a directory passthrough, to keep the served surface an explicit allowlist.

**DD3 — Dedicated internal session/partition; CSP set in the `protocol.handle` response headers (NOT
`onHeadersReceived`)**: Serve internal pages from a session distinct from `persist:goldfinch` (web)
and the default session — `session.fromPartition('goldfinch-internal')`. Set the strict CSP
(`frame-ancestors 'none'` to forbid embedding, plus a tight `default-src` appropriate to a bundled
local page) **directly in the headers of the `Response` the `protocol.handle` handler returns**
(`new Response(body, { headers: { 'Content-Type': …, 'Content-Security-Policy': … } })`).
- **Architect HIGH finding — `onHeadersReceived` is the wrong mechanism here.** `onHeadersReceived` is
  a `webRequest` hook (the real one lives in `applyShields`, `main.js:369`); responses produced by
  `protocol.handle` come from a custom URLLoaderFactory and do **not** reliably traverse the session's
  `webRequest` pipeline — so a CSP injected via `onHeadersReceived` on the internal session may **never
  reach the page**, silently. And the behavior test would not catch it: Step 10's web-page
  `<iframe src="goldfinch://settings">` is blocked because the *web* session has no `goldfinch://`
  handler (DD2's fourth gate), not because of `frame-ancestors`. So the CSP must be set in the
  `Response` headers, and verify must **read the served CSP back** over CDP from the internal webview
  (a verify step, see leg 6) so a dropped policy is caught rather than assumed.
- The `session-created` hook (`main.js:519`) applies Shields + tracker/`webRequest` hooks to **every**
  session including this one; the leg must decide whether to **exclude** the internal session from
  those hooks (they are built for web content and could interfere) or confirm them harmless — see open
  question. (This is a separate concern from the CSP, which no longer depends on `webRequest` at all.)
- Rationale: isolates internal pages from web-content state and protection logic; the CSP's
  `frame-ancestors 'none'` is the in-page half of the anti-embed guarantee (SC5), complementing the
  navigation/serving gates — but only if it actually ships on the response, hence the read-back.
- Trade-off: a third session alongside default + `persist:goldfinch`; documented so the three are not
  conflated.

**DD4 — `will-navigate` stays rejecting `goldfinch://` from web origins; becomes session-aware**: The
per-webview `will-navigate` guard (`main.js:75-77`, attached in `web-contents-created` for type
`webview`) currently rejects anything failing `isSafeTabUrl` — which includes `goldfinch://`. Keep
that for web-content webviews; **allow `goldfinch://` only for the internal session's webContents**
(distinguished by session, not by URL string). The settings doc is a **single document with
client-side section switching** (DD6), so no real `goldfinch://` sub-navigation ever fires
`will-navigate` in normal use — but the internal page's **own initial load and reload** must not be
blocked.
- **EMPIRICAL PREMISE → SPIKE BEFORE LOCKING THIS LEG**: it is not statically certain whether
  `will-navigate` fires for the internal webview's *initial* `src` load and for **reload** (SC5
  requires "reloadable like any other tab"). If it does fire and the guard blocks it, the settings tab
  would fail to load/reload. **Run the spike by injecting a `<webview partition="goldfinch-internal"
  src="goldfinch://settings">` directly into the DOM over CDP** (once serving works at leg-2 exit) and
  observing `will-navigate` on initial load + `reload()` — **no throwaway trusted-open / app code**,
  which also avoids any leg-2↔leg-3 ordering coupling (the trusted `createTab` branch doesn't exist
  until leg 3). This is the Flight-3 lesson: a divert-gating empirical premise gets a spike before the
  dependent build.
- **Architect prediction (to confirm, not assume)**: `will-navigate` likely does **not** fire for a
  `<webview>` `src`-set or `reload()` — both are programmatic, like `loadURL`, which Electron excludes
  from `will-navigate`. If the spike confirms this, the session-aware allow-branch is **belt-and-
  suspenders** (kept as documented defense-in-depth) rather than load-bearing — but it is still written
  so a *future* in-page `goldfinch://` navigation can't be blanket-rejected for the internal session.
- Rationale: web origins must keep being rejected (the mission constraint); the internal session is the
  one principal allowed to be on the scheme. Session identity (not URL) is the unspoofable
  discriminator — a web webview cannot become the internal session.
- Trade-off: the guard grows a session check; documented next to the DD, referenced by symbol not line
  number (Flight-2 lesson — no line numbers in committed comments).

**DD5 — Dedicated internal-page preload bridge; `contextIsolation: true` for the internal webview**:
Add a **new** preload (e.g. `src/preload/internal-preload.js`) exposing a **minimal** `contextBridge`
surface — this flight needs essentially nothing (a version/handshake ping at most, or nothing at all
since the stub is static); **Flight 6 populates it** with the home-page + Shields IPC. It can reuse
**neither** the media `webview-preload.js` (main-world, farbling/media-scanner — wrong for an internal
page) **nor** the chrome `window.goldfinch` bridge. Because `will-attach-webview` (`main.js:46`)
currently forces `contextIsolation = false` on **all** webviews (so the farbling preload can patch the
main world), the internal webview needs the **opposite** — `contextIsolation = true` with the bridge
over `contextBridge`.
- **The handler must grow its third arg** (Architect): it is `(_e, webPreferences) => {…}` today
  (`main.js:46`) and never reads `params`. Add `params` and **branch on `params.partition ===
  'goldfinch-internal'`** as the reliable discriminator (preload-path matching is weaker), keeping
  `contextIsolation = true` for the internal webview and `false` for web webviews.
- **The existing comment at `main.js:62-66` is already stale** — it claims the media preload is
  "enforced here so pages can never opt out," but the handler does **not** set `webPreferences.preload`;
  enforcement rests entirely on the renderer's `webview.setAttribute('preload', …)` (`renderer.js:386`).
  Fine for the internal path (only trusted chrome reaches `createTab`'s internal branch), but the leg
  must not lean on that false premise — and may optionally have main enforce the internal preload too,
  closing the stale comment's gap. Reference the symbol/DD, not line numbers, in any committed comment.
- **No `renderer-globals.d.ts` change this flight** (Architect LOW): that d.ts types the *chrome*
  renderer's `window.goldfinch`. The internal preload's bridge lives in the *internal page's* document,
  not the chrome renderer, so mirroring it there would be wrong. The stub is static ("coming soon")
  with no script using the bridge, and `.html` inline scripts aren't typechecked anyway — so no bridge
  type is needed now. When the internal page gains a script (Flight 6) it needs its **own** d.ts.
- **`allowpopups` is inherited** (`renderer.js:387` sets it on every webview): harmless for the internal
  page — `setWindowOpenHandler` denies all and routes to `open-tab` → `createTab` *untrusted* →
  `isSafeTabUrl` rejects — but it means the internal page can't open another internal tab via
  `window.open` either. A conscious functional limitation, not a hole.
- Rationale: an internal privileged page must run isolated with an explicit, minimal bridge — not in
  the main world with web-content tooling. Keeping the bridge minimal now avoids speculative API
  surface; Flight 6 adds exactly what the wired controls need.
- Trade-off: a second webview-preference profile in `will-attach-webview` (web vs internal); a small,
  well-commented branch.

**DD6 — Serve a minimal `goldfinch://settings` stub at the real destination URL**: A new accessible
`src/renderer/pages/settings.html` with a heading and placeholder ("Settings — coming soon"), valid
landmark structure (`<main>`, an `<h1>`). The kebab Settings item opens **this** URL now; Flight 5
enriches the **same document** into the modern settings shell (persistent section nav + titled
sections). Single document, client-side section switching later — so no real `goldfinch://`
sub-navigation ever fires `will-navigate`.
- Rationale: serving the real destination now means Flights 5–6 only enrich, never re-plumb; no
  throwaway URL.
- Trade-off: a sliver of overlap with Flight 5's surface (the stub markup), accepted to keep the URL
  stable.

**DD7 — Pin the a11y baseline as a small, hand-curated committed `ACCEPTED` allowlist (no auto-dump)**:
`scripts/a11y-audit.mjs` today disables one rule (`nested-interactive`) and **exits 1 on any other
violation** — but the real full-page baseline already carries ~8 pre-existing moderate structural
findings (`region`, `landmark-one-main`, `page-has-heading-one`, …) that no recent flight introduced,
so the gate has only ever been usable via a human judging "is this *new*?". Add a small curated
`ACCEPTED` list (`{ id, selector, reason }` per entry, triaged once, reviewed in the PR); `npm run a11y`
fails on any violation **not** in the list. Reconcile the now-stale mission Known-Issue ("2
`scrollable-region-focusable`") into the triaged list. **No blind `--update` that dumps raw axe
output** — that text analogue of a golden snapshot would churn and get rubber-stamped.
- **The gate audits only the chrome renderer today — extend it to see the internal guest** (Architect
  MEDIUM-HIGH): `scripts/a11y-audit.mjs` selects the target whose URL ends `index.html` (`a11y-audit.mjs:81`)
  and runs axe only there. The `goldfinch://settings` stub renders inside a **`<webview>` guest** — a
  separate CDP target the harness never connects to — so without a change, "the stub introduces no new
  violations under the gate" is **not satisfiable**: it gets zero axe coverage. Add a harness mode that
  also attaches to the `goldfinch://settings` guest target and runs axe there (small lift — the stub is
  `<h1>` + `<main>` + text). This mode is **reused by Flight 5** for the real settings surface, so
  building it now is on-path, not throwaway. The chrome-baseline `ACCEPTED` pin and this guest-target
  mode together make the SC8 claim honest.
- Rationale: discharges the thrice-flagged (Flight 1 → 2 → 3) baseline debt and makes "no new
  violations" a real, CI-able assertion — for **both** the chrome and the internal guest — before the
  large settings surface arrives in Flight 5.
- **Snapshot-rule reconciliation (operator)**: the user-global "snapshot baselines are gitignored"
  rule targets **binary clutter / PII** (screenshots, images), not a small reviewed text config — the
  `ACCEPTED` list is the same category as the already-committed `nested-interactive` disable. The
  failure mode the rule guards against (noisy auto-generated golden files) is avoided by keeping the
  list hand-curated, not auto-dumped.
- Trade-off: the list must be maintained by hand when intentional structural a11y changes land — which
  is the point (each change is a reviewed decision).

**DD8 — Verification apparatus, premise-audited on BOTH axes (act + observe)**:
- *Act (can the apparatus drive the vectors like a real actor?)* — the extended `tab-scheme-guard`
  behavior test attaches to the already-running `:9222` renderer via the committed
  `scripts/cdp-driver.mjs` (trusted input; KEYS already includes the arrows from Flight 2) **or** the
  Playwright MCP with `--cdp-endpoint`. **Never the `chrome-devtools` MCP** (launches its own browser →
  false pass; the standing Goldfinch trap). Drivable: open the HTTP trigger fixture; click its
  `goldfinch://` spoof buttons (`window.open`, `location=`, `<iframe>`, cross-origin `fetch`); select
  the kebab Settings item to open the internal page; reload the internal tab. **NOT drivable → manual**:
  any check that tears down the harness or can't be driven over CDP (noted per step).
- *Observe (can every assertion be read through an existing surface? — cite the read path)* —
  **Positive** (Settings opens + renders + reloads): the internal `<webview>`'s `src` (`goldfinch://settings`)
  is readable in the **renderer DOM** (the chrome owns the `<webview>` elements), and that the stub
  actually **rendered** ("Settings — coming soon") is readable via **screenshot + a11y tree** (the same
  surface `tab-scheme-guard` already uses to assert "no tab renders local file contents"). **Negative**
  (spoof rejected): no new `<webview>` carries a `goldfinch://` src (renderer DOM), no tab renders the
  stub by a page-driven path (screenshot), and the cross-origin `fetch('goldfinch://…')` rejects
  (observable via the trigger page's console / a status readback). **No new read path needs building** —
  every assertion reads through existing DOM/a11y/console surfaces.
- Rationale: this is the both-axes premise audit the flight skill requires. The act axis is covered by
  the committed driver + fixture; the observe axis is satisfied entirely by existing surfaces (the
  internal webview's src + rendered content + fetch console) — no test-only seam.
- Trade-off: assertions about *rendering* (vs. just `src`) rely on screenshots/a11y tree, which the
  spec already treats as primary for this test.

### Prerequisites
- [ ] App runs via `npm run dev:debug` (CDP on `:9222`, `--remote-allow-origins=*`, `--no-sandbox`);
  `:9222` **answers** and a **renderer** target (the Goldfinch `index.html` window, not a `<webview>`
  guest) is present. *(Behavior-test execution prerequisite — apparatus-audited; assert operational
  availability, not mere config. Probe before the flight lands.)*
- [ ] Behavior-test apparatus operational: `scripts/cdp-driver.mjs` reaches `:9222`
  (`node scripts/cdp-driver.mjs eval '1+1'` → `2`), **or** the Playwright MCP connected with
  `--cdp-endpoint http://127.0.0.1:9222`. **The `chrome-devtools` MCP does NOT qualify.**
- [ ] The `tab-scheme-guard` HTTP trigger fixture is served (e.g. `python3 -m http.server` in
  `tests/behavior/fixtures/tab-scheme-guard/`) and returns HTTP 200, extended with the `goldfinch://`
  spoof vectors (built in the boundary leg).
- [ ] `npm run a11y` (axe-core over CDP) operational against the running app — the new pinned
  `ACCEPTED` allowlist is the baseline it diffs against, and the harness can target the
  `goldfinch://settings` guest (DD7).
- [ ] **`will-navigate`-on-internal-load spike resolved** (DD4) before the boundary leg is locked: the
  internal webview's initial load + reload are observed; whether `will-navigate` fires (and with what
  URL) is recorded in the flight log.
- [ ] GUI/desktop runtime available. Dev/verify platform is Linux/WSL; macOS deferred to a mac HAT.

### Pre-Flight Checklist
- [x] All open questions resolved (or explicitly deferred with rationale)
- [x] Design decisions documented (DD1–DD8; codebase-validated, 2 Architect cycles → approve)
- [ ] Prerequisites verified (esp. `:9222` renderer target + apparatus reachable + spike run) —
  live-environment items verified at execution start (GUI app the harness can't autonomously spin up)
- [x] Validation approach defined (`tab-scheme-guard` extended +6 steps; apparatus premise-audited, DD8)
- [x] Legs defined

---

## In-Flight

### Technical Approach

Pin the a11y gate first (so every later leg verifies against a real baseline), then build the scheme
bottom-up: register + serve on a dedicated internal session, construct the trusted embedder path
(renderer flag + allowlist + internal preload + isolation), harden the boundary (session-aware
`will-navigate`, CSP, spoof fixture), then document, verify, and HAT. The `will-navigate` spike runs
as soon as serving works (end of the serving leg) and gates the boundary leg's guard shape.

- **Pin a11y baseline** (leg 1): add the curated `ACCEPTED` allowlist to `scripts/a11y-audit.mjs`
  (`{ id, selector, reason }`), triaging the current ~8 full-page findings; `npm run a11y` now fails
  only on violations not in the list. Reconcile the mission Known-Issue ("2 `scrollable-region-focusable`").
  **Also extend the harness with a guest-target axe mode** (attach to a `<webview>` guest by URL and
  run axe there — `a11y-audit.mjs:81` currently only finds the `index.html` chrome target), so the
  `goldfinch://settings` stub can actually be audited in leg 6 and the real settings surface in Flight 5
  (DD7). No `goldfinch://` *app* work. (SC8 infra)
- **Scheme registration + serving** (leg 2): `registerSchemesAsPrivileged` at module load (DD2);
  create the dedicated internal session (DD3); set the strict CSP (`frame-ancestors 'none'` + tight
  `default-src`) **in the `Response` headers** the handler returns (NOT `onHeadersReceived` — DD3);
  `session.fromPartition('goldfinch-internal').protocol.handle('goldfinch', …)` resolving
  `goldfinch://settings` → the new `src/renderer/pages/settings.html` stub (DD6) via
  `net.fetch(pathToFileURL(...))`, 404 for anything else, no traversal; decide the
  internal-session-vs-Shields-hooks question (DD3). **Exit observation = the `will-navigate` spike
  (DD4)**: inject a `<webview partition="goldfinch-internal" src="goldfinch://settings">` over CDP
  (no app code) and record whether `will-navigate` fires on load + reload. (SC5 plumbing)
- **Trusted embedder path** (leg 3): renderer — add `isInternalPageUrl` to `src/shared/url-safety.js`
  (dual-export + `declare function` in `renderer-globals.d.ts` + unit test beside
  `test/unit/url-safety.test.js` — DD1), give `createTab` the `trusted` option (DD1) selecting the
  internal partition + internal preload, JSDoc-cast any new `els.*`/locals (typecheck-gated — Flight-1
  lesson); add the new `internal-preload.js` (DD5, minimal/empty surface — no chrome d.ts change); main
  — give `will-attach-webview` its `params` arg and keep `contextIsolation = true` for the internal
  webview (branch on `params.partition`, DD5); wire the kebab Settings item to
  `createTab('goldfinch://settings', null, { trusted: true })` and delete the TODO at `renderer.js:329`.
  *(Heaviest leg — the mission's split candidate if it balloons.)* (SC5)
- **Boundary hardening + spoof fixture** (leg 4, *spike-gated*): make `will-navigate` session-aware
  (reject `goldfinch://` from web webviews, allow only the internal session — shaped by the leg-2 spike,
  DD4); confirm `protocol.handle` is registered only on the internal session; extend the
  `tab-scheme-guard` fixture (`tests/behavior/fixtures/tab-scheme-guard/`) with the four `goldfinch://`
  spoof vectors (`window.open`, `location=`, `<iframe src>`, cross-origin `fetch`). This is the
  concentrated-risk leg the mission flagged. (SC5)
- **Docs** (leg 5): document the `goldfinch://` scheme, the internal session + CSP, the trusted
  embedder path + `isInternalPageUrl`, and the internal-page preload bridge in README/CLAUDE.md (new
  internal-page mechanism + new architectural seams warrant it); reference symbols/DD ids, **never line
  numbers** (Flight-2 lesson).
- **Verify** (leg 6): apparatus prep + prerequisite probe; run the extended `tab-scheme-guard`
  (positive Settings-opens + reload checkpoint AND the four spoof rejections), promote `draft → active`
  on pass; **read the served CSP back** from the internal webview over CDP to confirm
  `frame-ancestors 'none'` actually shipped (DD3 — a dropped policy must fail, not pass silently);
  regression the unchanged behavior tests (`core-browsing-shields` and the tab/menu cores — none should
  change); `npm run a11y` against the **pinned** baseline AND the new **guest-target** mode over
  `goldfinch://settings` (both clean — DD7); offline gates (`npm test`/`typecheck`/`lint`). Manual
  checks for anything CDP can't drive. (SC5, SC8)
- **HAT + alignment** (leg 7, optional): guided session — open Settings, feel the flow, reload the
  internal tab, fix issues live until satisfied, then land.

### Checkpoints
- [ ] `npm run a11y` gates against a curated `ACCEPTED` baseline AND can audit the `goldfinch://settings`
  guest target; mission Known-Issue reconciled.
- [ ] `goldfinch://settings` serves the stub on the internal session; the served `Response` carries
  `Content-Security-Policy: frame-ancestors 'none'` (**read back over CDP**, not assumed); any other
  `goldfinch://` host/path 404s.
- [ ] `will-navigate`-on-internal-load spike run and recorded; boundary guard shaped accordingly.
- [ ] Selecting **Settings** opens `goldfinch://settings` in its own tab (in the strip, closeable),
  the stub renders, and the tab **reloads** like any other.
- [ ] Web content cannot navigate to / open / embed / `fetch` the scheme — all four spoof vectors
  rejected; no `<webview>` ever carries a page-originated `goldfinch://` src.
- [ ] `isSafeTabUrl` unchanged (still rejects `goldfinch://`); the internal branch is reachable only
  via the call-site `trusted` flag.
- [ ] Extended `tab-scheme-guard` passes and is promoted to `active`; regressions intact; offline
  gates + a11y green.

### Adaptation Criteria

**Divert / split if**:
- The `will-navigate` spike (DD4) shows the internal load/reload is blocked in a way that needs a
  deeper rework (e.g. the webview cannot host the scheme cleanly, or serving needs a different
  mechanism) → **split** into "scheme registration + serving" (legs 1–2) and "trusted path + boundary
  hardening + spoof test" (legs 3–4+) as the mission anticipated; log the rationale.
- The dedicated internal session interacts badly with the `session-created` Shields/tracker hooks in a
  way that can't be resolved by excluding it → reassess DD3.

**Acceptable variations**:
- Internal partition name (`goldfinch-internal` vs another), exact CSP `default-src` contents, and the
  `protocol.handle` route-map shape — leg-design details.
- Whether the internal-page preload exposes a no-op handshake or nothing at all this flight (Flight 6
  populates it regardless).
- `pages/` directory location for the stub, as long as the electron-builder `files` glob
  (`src/**/*`) bundles it.

### Legs

> **Note:** Tentative; legs are created one at a time as the flight progresses.

- [x] `pin-a11y-baseline` - Add the curated `ACCEPTED` allowlist to `scripts/a11y-audit.mjs`; triage
  the current full-page findings; reconcile the mission Known-Issue; add the guest-target axe mode so
  the internal page can be audited (DD7). (SC8 infra)
- [x] `scheme-registration-and-serving` - `registerSchemesAsPrivileged` at module load; dedicated
  internal session; CSP in the `Response` headers (not `onHeadersReceived`); session-scoped
  `protocol.handle` serving the `goldfinch://settings` stub via `net.fetch` (404 otherwise); run the
  `will-navigate` spike via CDP `<webview>` injection at exit. (SC5)
- [x] `trusted-embedder-path` - `isInternalPageUrl` (shared dual-export + d.ts + unit test) + `createTab`
  `trusted` flag + internal partition/preload selection; new `internal-preload.js` (minimal);
  `will-attach-webview` `params`-branch keeping `contextIsolation:true` for the internal webview; wire
  Settings, delete the TODO. *(Heaviest leg / split candidate.)* (SC5)
- [x] `boundary-hardening` *(spike-gated)* - session-aware `will-navigate`; confirm handler-on-internal-
  session-only; extend the `tab-scheme-guard` fixture with the four `goldfinch://` spoof vectors. (SC5)
- [x] `docs` - Document the scheme, internal session/CSP, trusted path, and internal-page bridge in
  README/CLAUDE.md (symbols/DD ids, no line numbers).
- [x] `verify-integration` - Apparatus prep + probe; run extended `tab-scheme-guard` (positive + 4
  spoof), promote to `active`; regressions; `npm run a11y` vs pinned baseline; offline gates; manual
  checks. (SC5, SC8) *(2026-06-07 live: behavior test 13/13, spike resolved, CSP confirmed, a11y clean)*
- [x] `hat-and-alignment` *(optional)* - Guided HAT: operator opened Settings, confirmed render + reload,
  approved landing; Chrome-model hardening input captured for Flight 5/6.

---

## Post-Flight

### Completion Checklist
- [x] All legs completed (7/7: 5 code + verify-integration + HAT)
- [ ] Code merged *(PR #29 marked ready for review; merge is the operator's call)*
- [x] Tests passing — offline `npm test` 161/161, typecheck 0, lint 0; live `tab-scheme-guard` 13/13;
  `npm run a11y` no new violations
- [x] Documentation updated — README + CLAUDE.md document the scheme + four-gate model + a11y baseline

### Verification

How to confirm the flight achieved its objective:

- **Behavior test `tab-scheme-guard` (extended)** (SC5) — **positive**: selecting Settings opens
  `goldfinch://settings` in its own tab, the stub renders, and the tab reloads like any other;
  **negative**: each of `window.open('goldfinch://…')`, `location = 'goldfinch://…'`,
  `<iframe src="goldfinch://…">`, and a cross-origin `fetch('goldfinch://…')` is rejected — no
  `<webview>` carries a page-originated `goldfinch://` src and no tab renders the internal stub by a
  page-driven path. Promoted `draft → active` on pass.
- **Security invariants** — `isSafeTabUrl` is byte-unchanged (still rejects `goldfinch://`); the
  internal branch is reachable only through the call-site `trusted` flag; `protocol.handle` is
  registered only on the internal session; the served `Response` carries `Content-Security-Policy:
  frame-ancestors 'none'` (read back over CDP, not assumed).
- **Regression** — `core-browsing-shields` and the tab-strip / menu behavior cores still pass (this
  flight touches none of their surfaces).
- **`npm run a11y`** — clean against the newly pinned `ACCEPTED` baseline (chrome) AND clean when the
  harness's guest-target mode audits the `goldfinch://settings` stub directly (DD7); mission
  Known-Issue reconciled.
- **Offline gates** — `npm test` / `npm run typecheck` / `npm run lint` green.
- **Manual** (apparatus can't drive these) — anything that tears down the harness or isn't drivable
  over CDP; macOS behavior deferred to the mac HAT. Tune feel via the optional HAT leg.
