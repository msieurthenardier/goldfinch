# Leg: launch-url-intake

**Status**: completed
**Flight**: [Default Browser](../flight.md)

## Objective

Make Goldfinch a single-instance browser whose OS-handed URLs — cold-launch argv, `second-instance` argv, macOS `open-url` — each open as an ordinary untrusted, activated tab in the default jar of the right window, after any session restore, with no stray boot tab.

## Context

- Flight DD1 (lock + loser exit), DD2 (URL filter), DD3 (one delivery channel + chrome boot barrier), DD4 (default jar), DD8 (behavior-test apparatus), DD9 (global-hook premise re-runs). Read them in `../flight.md` — they are authoritative; this leg implements them.
- No prior legs. Leg 2 (registration + settings) does not change anything built here.
- `renderer.js` is at its zero-headroom budget: 1550/1550 (`test/helpers/renderer-line-budget.js`, `RENDERER_LINE_BUDGET`, measured with `split(/\r?\n/).length` after `npm run format`). This leg pays for its renderer lines with an extraction (step 6).
- Project rule (CLAUDE.md, Flight Operations): a leg's live smoke exercises every existing apparatus primitive against the new state; a global hook re-runs the spike premises it could change (DD9).

## Inputs

- `src/main/main.js` — module-scope pre-ready block: `registerSchemesAsPrivileged` (~:242), `setAppUserModelId` (~:262), dev redirect `if (!app.isPackaged) { app.setPath('userData', …) }` (~:282-284), `crashReporter.start(` (~:299), `registerAppLifecycle({` (~:2678, already passed `argv: process.argv`).
- `src/main/app-lifecycle.js` — `registerAppLifecycle` (top-level `app.on('login'…)` ~:113); `window-boot-config` handler (~:189-251); `whenReady` window-creation block `const restoreSnapshot = … ? sessionStore.read() : null; if (restoreSnapshot) { … createWindow({ noBootTab: true }) … } else { createWindow(); }` (~:300-308).
- `src/main/register-tab-ipc.js` — `queueChromeSend(record, buildMessage)` (exported; drops for `record.chromeRecoveryPaused`, queues until `bootConfigServed`).
- `src/main/window-registry.js` — `getLastFocused()`, `noteFocus(winId)`, `records()`.
- `src/shared/url-safety.js` — `isSafeTabUrl` (required from main as `require('../shared/url-safety')`).
- `src/preload/chrome-preload.js` — `onOpenTab` (~:216) pattern.
- `src/renderer/renderer.js` — `window.goldfinch.onOpenTab(…)` (~:1207); boot `Promise.all([...]).then(([url, engine, , , bootConfig]) => { … })` (~:1397-1441); `showCrashPanelForAudit` / `showHangNoticeForAudit` (~:1443-1462) republished at the seam tail.
- `src/renderer/chrome/tab-controller.js` — `createTab(url, container, { trusted, background, … })`: untrusted branch gates on `isSafeTabUrl`; `container || resolveNewTabContainer(jarsClient.containers, jarsClient.defaultId) || jarsClient.makeBurner()`; activates unless `background`.

## Outputs

- `src/shared/launch-urls.js` (new) + `test/unit/launch-urls.test.js` (new)
- `src/main/main.js` — lock block
- `src/main/app-lifecycle.js` — intake, buffer, `noBootTab` peek, flush, raise; new deps threaded from `main.js`
- `src/preload/chrome-preload.js` — `onOpenExternalUrls`; `renderer-globals.d.ts` entry
- `src/renderer/chrome/external-urls-controller.js` (new) + `test/unit/external-urls-controller.test.js` (new)
- `src/renderer/chrome/audit-states.js` (new, extraction) — or equivalent name
- `src/renderer/renderer.js` — controller wiring, boot-chain `.finally`, extraction
- Tests: new single-instance order pin; `app-lifecycle.test.js` extended; budget retarget in `test/helpers/renderer-line-budget.js` + accounting comment in `seam-contract.test.js`'s `RENDERER_LINE_BUDGET` block
- Docs: `CLAUDE.md`, `docs/dev-testing.md`

## Acceptance Criteria

- [ ] **AC1 — URL filter.** `src/shared/launch-urls.js` exports pure, never-throwing `filterLaunchUrls(candidates)` and `extractLaunchUrls(argv)`. `extractLaunchUrls` ignores `argv[0]`, every `-`-prefixed token, and every token that is not an `http:`/`https:` URL (case-insensitive scheme); each kept token must also pass `isSafeTabUrl`; each kept URL is returned in its normalized `new URL(token).href` form (that is the form sent and asserted); result is de-duplicated on that form (first occurrence order) and capped at 20. `about:blank`, `file:`, `goldfinch:`, `javascript:`, `data:`, `chrome:`, `.`, relative paths, empty/non-string input → dropped. Unit matrix covers: dev argv `[electron, '.', '--automation-dev', U]`, packaged `[exe, U]`, Chromium-injected switches (`--original-process-start-time=…`, `--allow-file-access-from-files`), `HTTPS://` mixed case, duplicates, 25 URLs → 20, non-array input → `[]`.
- [ ] **AC2 — Lock placement and loser exit.** In `main.js`, `app.requestSingleInstanceLock()` is called exactly once at module scope, textually after the dev-redirect `setPath('userData'` call and before `crashReporter.start(` and `registerAppLifecycle(`; the failure branch is `app.exit(0)` followed by `process.exit(0)`, contains no `app.quit(`, and there is no top-level `return`. A new source-order test pins redirect < lock < `crashReporter.start(` < `registerAppLifecycle(`, and the exit shape; every mutation it relies on is guarded by `assertMutated` (regex targets per CLAUDE.md's "Regex-target mutation pins"), and it is neuter-verified (moving the lock above the redirect, or swapping `app.exit` for `app.quit`, turns it red). Existing `dev-profile-redirect-order.test.js`, `crash-reporter-pins.test.js`, `app-user-model-id.test.js` stay green unmodified.
- [ ] **AC3 — Main-side intake.** In `registerAppLifecycle`:
  - one pending-URL buffer, seeded at registration with `extractLaunchUrls(argv)`;
  - `app.on('second-instance', (_e, argv2) => …)` and `app.on('open-url', (e, url) => { e.preventDefault(); … })` registered at top level (beside `login`), both routed through one intake function using `extractLaunchUrls` / `filterLaunchUrls` (main re-validates — never trusts the raw arg);
  - intake before the `whenReady` callback's creation block has run (pre-ready — realistic: the lock is taken at module load and a fast second launch lands before ready) → buffer, with NO registry access. The buffer is capped at 20 in total and de-duplicated across arrivals (not just per call);
  - the creation block creates the no-restore window, and the restore-on-but-`sessionStore.read()`-null window, with `{ noBootTab: <buffer non-empty> }`; restored windows unchanged;
  - the creation block captures the FIRST record it creates (`firstRec`); right after the block, a non-empty buffer is flushed to `firstRec` — NOT `getLastFocused()`, because `window-registry.js` `create()` sets `lastFocusedId` on every create (:132), so after restoring N windows it would name the LAST one — through `queueChromeSend(rec, () => ['open-external-urls', { urls }])` and cleared (consumed once). With no URLs, the calls stay byte-identical to today: `createWindow()` with NO argument in the no-restore branch (existing tests pin `'create-window:false'` in the event sequence and `created[0].options` deepEqual `{ noBootTab: true }` for restore);
  - post-ready intakes (`second-instance`, `open-url`): target = `registry.getLastFocused()`; if that record is `chromeRecoveryPaused`, the first non-paused record from `registry.records()`; none → drop and log;
  - on `second-instance` with windows present, the target window is raised: `if (win.isMinimized()) win.restore(); win.show(); win.focus(); registry.noteFocus(win.id)` — BEFORE the send;
  - post-ready intake with zero windows (`registry.records().length === 0`): on darwin (resident app), for BOTH `open-url` and `second-instance`, `createWindow({ noBootTab: true })` then flush to it; on other platforms (only reachable mid-quit via `window-all-closed`) drop and log. The `activate` handler must not then create a second window (it keys on the same zero-records test);
  - `open-url` with windows present raises the target the same way `second-instance` does;
  - logging names only the URL COUNT, never a URL (query strings can carry secrets).
  `test/unit/app-lifecycle.test.js`'s `makeHarness` is extended: an `argv` parameter (hard-coded `[]` today, ~:248); a recording `queueChromeSend` dep; a registry fake whose `records()` tracks created records, whose create path seeds last-focused like the real `create()` (else the restore case passes vacuously), and which gains `getLastFocused`/`noteFocus`; created-record fakes with `chromeRecoveryPaused` and `win` minimize/restore/show/focus recorders. (`app.on` capture and `isPackaged` already exist; events emitted synchronously after `makeHarness` are genuinely pre-ready, events after `await lifecycle.ready` are post-ready.) Cases: cold argv → first record gets one `open-external-urls` send and `noBootTab: true`; cold argv + restore on with TWO saved windows → the FIRST restored record receives it (not the last-created) and restored windows keep `{ noBootTab: true }`; pre-ready `second-instance` → merged into the cold flush (dedupe across argv + second-instance); restore on + null snapshot + URLs → `noBootTab: true`; no URLs → `createWindow()` called exactly as before; second-instance hostile-only argv → no send, window NOT raised; second-instance with URL → raise then send to last-focused; paused last-focused → falls back; all paused → no send; buffer consumed once (a second flush sends nothing); darwin zero-window post-ready intake → exactly one `createWindow({ noBootTab: true })` + send; pre-ready buffer cap (25 URLs across three arrivals → 20).
- [ ] **AC4 — Preload + types.** `chrome-preload.js` exposes `onOpenExternalUrls(cb)` on `'open-external-urls'`, forwarding `payload.urls`; `renderer-globals.d.ts` types it. `onOpenTab` is untouched.
- [ ] **AC5 — Chrome controller and barrier.** `src/renderer/chrome/external-urls-controller.js` exports a factory taking injected deps (`onOpenExternalUrls`, a `createTab` getter or function, a logger) and returning `{ releaseBoot }` (or equivalent). It subscribes at construction; each arrival awaits the boot barrier, then — for `urls` of length N — calls `createTab(url, null, { background: true })` for the first N−1 and `createTab(last, null)` for the last (one activation, strip order preserved). It never passes `trusted`, never passes a container, and ignores a non-array/empty payload. `releaseBoot()` is idempotent. Unit tests (mock DOM-free deps): arrivals before `releaseBoot` are held, then drained in arrival order after it; arrivals after are immediate; N=1/N=3 call shapes; no call ever includes `trusted`; two separate arrivals both open (no collapse).
- [ ] **AC6 — Renderer wiring within budget.** `renderer.js` constructs the controller at module top level (above the boot `Promise.all`, so the listener is live before queued sends flush) and chains `.finally(() => externalUrls.releaseBoot())` on the WHOLE boot chain `Promise.all([...]).then(...)` — not inside the `.then`. `showCrashPanelForAudit` / `showHangNoticeForAudit` move verbatim into a new `src/renderer/chrome/` factory taking getters for `activeTab`, `loadFailureController`, `hangNoticeController` (TDZ checklist), and are still republished by the same names at the seam tail (`SEAM_COUNT` stays 41; `seam-contract.test.js` green). After `npm run format`, `renderer.js`'s `split(/\r?\n/).length` ≤ 1550; `test/helpers/renderer-line-budget.js` is set to the new measured value (zero headroom) and `seam-contract.test.js`'s `RENDERER_LINE_BUDGET` comment gains an accounting paragraph for this leg. Because `renderer.js` is a DOM-bound module, the wiring is proven by a **source-scan pin** (house style: comment-masked source, wrap-insensitive regex, `assertMutated`, neuter-verified): (i) `.finally(` chains the boot `Promise.all([...]).then(...)` closing — i.e. `}).finally(() => externalUrls.releaseBoot());` replaces the chain's `});` (0 net lines); (ii) the controller construction precedes `Promise.all(`; mutations moving `releaseBoot` inside the `.then` and deleting the `.finally` each turn it red. That the barrier really orders URL tabs after restored tabs is carried by this pin plus behavior-test rows 7–8 — no unit test claims it.
- [ ] **AC7 — Untrusted-only grep-AC.** `grep -n "open-external-urls\|onOpenExternalUrls\|external-urls-controller" -r src` — every hit is judged; none passes `trusted: true` or a container, and no external-URL path reaches `createTab` other than through the controller. Result recorded in the flight log.
- [ ] **AC8 — Suite gates.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` all green.
- [ ] **AC9 — Live acceptance.** `/mission-control:behavior-test default-browser-handoff` passes (run by the Flight Director, not the Developer). The Developer's own live smoke (before signalling land), against a dev instance, confirms: a second `node scripts/dev-launch.mjs <https URL>` exits 0 and the URL tab appears in the running instance (census via `enumerateTabs`); and re-runs DD9 premises 1–5, recording each outcome in the flight log. Every existing apparatus primitive (`enumerateTabs`, `enumerateWindows`, `captureWindow`, `captureScreenshot`, `evaluate`, `readDom`) is exercised once against the new state.
- [ ] **AC10 — Docs.** `CLAUDE.md` gains a concise entry (Non-obvious gotchas or App lifecycle context): single-instance lock placement after the dev redirect, loser `app.exit(0); process.exit(0)` before any side effect, external URLs are untrusted default-jar tabs via `open-external-urls` behind the chrome boot barrier. `docs/dev-testing.md` notes that a second dev launch on the same profile now hands its URL args to the running instance and exits, and that relaunch recipes must wait for the old PID to exit.

## Verification Steps

- AC1: `node --test test/unit/launch-urls.test.js`
- AC2: `node --test test/unit/<new-order-pin>.test.js test/unit/dev-profile-redirect-order.test.js test/unit/crash-reporter-pins.test.js test/unit/app-user-model-id.test.js`; neuter both mutations by hand once and record red→green in the flight log
- AC3: `node --test test/unit/app-lifecycle.test.js`
- AC4/AC5: `node --test test/unit/external-urls-controller.test.js`; `npm run typecheck`
- AC6: `npm run format && node -e 'console.log(require("fs").readFileSync("src/renderer/renderer.js","utf8").split(/\r?\n/).length)'`; `node --test test/unit/seam-contract.test.js test/unit/vault-restore-workflow-invariants.test.js`
- AC7: the grep above, hits judged in the flight log
- AC8: `npm test && npm run typecheck && npm run lint && npm run format:check`
- AC9: Developer smoke per AC9; FD runs the behavior test
- AC10: read the diffs

## Implementation Guidance

1. **`src/shared/launch-urls.js`** — ESM like `url-safety.js` (`export function`, `import { isSafeTabUrl } from './url-safety.js'` with the explicit `.js` specifier); main loads it with `require('../shared/launch-urls')` exactly as `main.js:44` loads `url-safety` (Node ≥22 `require(esm)`), and threads the functions into `registerAppLifecycle` as deps (`app-lifecycle.js` stays require-free of it). Not renderer/internal-page reachable — no map/script-tag/seam work. Scheme check via `new URL(token)` in try/catch, `protocol` compared lowercase. Keep it pure.
2. **`main.js` lock** — directly after the dev-redirect `if` block, before the crash-reporter comment/call. A short comment citing DD1 (why after the redirect; why `app.exit` + `process.exit`, not `app.quit`, not `return`). Keep the existing crash-reporter comment's "PLACED IMMEDIATELY AFTER the dev-profile redirect" wording truthful (adjust to "after the redirect and the single-instance lock").
3. **`app-lifecycle.js`** — add `extractLaunchUrls`, `filterLaunchUrls`, `queueChromeSend` to the destructured deps and thread them from `main.js`'s `registerAppLifecycle({…})` call (both are already importable there; `queueChromeSend` from `./register-tab-ipc`). Register `second-instance` and `open-url` beside `login`. Keep a module-local `pendingLaunchUrls` array and a `ready`-reached flag set right after the creation block. Write the target-resolution + raise as a small named helper. Don't touch `window-boot-config`.
4. **Preload + types** — one line mirroring `onOpenTab`; typed in `renderer-globals.d.ts` beside it.
5. **Controller** — factory in the style of the other `chrome/*-controller.js` (injected deps, no DOM). A simple deferred: `let release; const barrier = new Promise((r) => (release = r));` plus an idempotence guard.
6. **`renderer.js`** — MEASURE FIRST: the extraction frees ~21 lines and the additions are ~18-21, so do the extraction and wiring before anything else in the renderer and measure after `npm run format`; if it doesn't fit, stop and report `[BLOCKED:renderer-budget]` (flight Adaptation Criteria). (a) import + construct the controller next to the `onOpenTab` block; (b) append `.finally(() => externalUrls.releaseBoot())` to the boot chain; (c) extract the two audit helpers into a factory in `src/renderer/chrome/`, destructure them back under the same names for the seam tail. Run `npm run format`, then measure; set the budget helper to the measured value and write the accounting paragraph (see the existing M20/M21 paragraphs for the house style).
7. **Tests** — follow `test/unit/automation-dev.test.js` / `dev-profile.test.js` style for the pure module; `dev-profile-redirect-order.test.js` for the order pin (comment-masked source, sanity markers, `assertMutated`); extend `app-lifecycle.test.js`'s `makeHarness`.
8. **Live smoke** — `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` is ALREADY RUNNING from the Flight Director's session on the dev profile (its key line is in `/tmp/claude-1000/-home-cprch-projects-goldfinch/709fd4f6-02a5-45cf-a7db-5b465593f1a0/scratchpad/dev-automation.log` — read the key into an env var, never echo it). That instance runs PRE-leg code: to test your changes, cleanly stop it (find its PID; SIGTERM; wait for exit), relaunch with the same command in the background redirecting to the same log path, and re-read the fresh key. Attach only via `scripts/lib/mcp-client.mjs`; never use session-registered `mcp__goldfinch*` tools. Leave a running instance of the NEW code up when you finish, and report its log path.

## Edge Cases

- **URL arrives while the target window is still booting** → queued by `queueChromeSend`, delivered before the boot-config reply, held by the chrome barrier until restore finishes.
- **Jars IPC failed at boot** (`defaultId` undefined) → `createTab(url, null)` falls back to a burner; the controller logs once. Acceptable (flight DD3).
- **Second instance with only hostile/flag args** → no send, no raise.
- **Same URL via cold argv and a pre-ready `second-instance`** → one tab (buffer dedupe).
- **Burst of pre-ready hand-offs** → buffer capped at 20 total.
- **Chrome crash-recovery reload** → nothing re-sent; buffer already consumed.
- **Welcome tab**: `noBootTab` suppresses it only for windows created while the buffer is non-empty; a `second-instance` landing after `createWindow` but before chrome boot still gets the boot tab (accepted residual, flight DD3).
- **Windows argv**: packaged `[exe, "--…", "https://…"]`; Electron may append Chromium switches — all `-`-prefixed, dropped.

## Files Affected

- `src/shared/launch-urls.js` — new
- `src/main/main.js` — lock block; new deps into `registerAppLifecycle`
- `src/main/app-lifecycle.js` — intake/buffer/flush/raise
- `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts` — `onOpenExternalUrls`
- `src/renderer/chrome/external-urls-controller.js` — new
- `src/renderer/chrome/audit-states.js` (or similar) — new, extraction
- `src/renderer/renderer.js` — wiring + extraction
- `test/unit/launch-urls.test.js`, `test/unit/external-urls-controller.test.js`, `test/unit/single-instance-lock-order.test.js` — new
- `test/unit/app-lifecycle.test.js`, `test/unit/seam-contract.test.js`, `test/helpers/renderer-line-budget.js` — updated
- `CLAUDE.md`, `docs/dev-testing.md`

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.

## Citation Audit

2026-09-29 (FD): verified against the working tree at `main` 96ead04+ — `main.js` pre-ready block (:242/:262/:282-284/:299), `registerAppLifecycle(` (:2678), `app-lifecycle.js` `window-boot-config` (:189-251) and creation block (:300-308), `queueChromeSend` export (`register-tab-ipc.js:1376`), `getLastFocused`/`noteFocus` (`window-registry.js` ~:166-181), `onOpenTab` (`chrome-preload.js:216`, `renderer.js:1207`), boot chain (`renderer.js:1397-1441`), audit helpers (`:1443-1462`), `createTab` gate/jar resolution/activation (`tab-controller.js` ~:342-352, ~:401). Budget measured 1550 = `RENDERER_LINE_BUDGET`. `session-restore-wiring.test.js` pins the restore branch INSIDE `renderer.js` — the extraction deliberately avoids that block.
