# Leg: verify-integration

**Status**: completed
**Flight**: [Drive Engine (input / nav / tabs)](../flight.md)

## Objective

Prove the wired engine works end to end against the **live** app — drive a foregrounded guest and the
chrome (nav + input + tab ops) through the dev seam + `cdp-driver.mjs`, **resolve the two deferred
input spikes** (guest click recipe + coordinate space), and confirm the DD5 internal-session
exclusion holds on **both** paths (absent from enumerate AND rejected when the internal `wcId` is
supplied directly) — with the full unit suite + typecheck + lint green.

## Context

- This is the flight's integration gate (flight Verification section). The engine modules are
  unit-tested; this leg confirms the **Electron-bound glue + dev seam** actually drive the live app,
  which unit tests cannot.
- **Interim verification standard** (mission decision): SC1/SC2/SC5 are *behavior-test-backed* only
  once the Flight 3 transport exists; this flight is verified by **unit tests + a dev-seam/cdp-driver
  live smoke**. No behavior-test spec is authored. The accepted standard is **FD-driven runs with
  cited machine-read evidence** (mission M02-debrief carry-in) — `cdp-driver.mjs` supplies machine
  reads (DOM read-back via `eval`, screenshots via `shot`).
- **Two open questions resolved HERE, live** (flight Open Questions, deferred from Leg 4):
  1. the exact `sendInputEvent` recipe for a reliable synthetic **click** on a guest;
  2. the **coordinate space** for input on a guest (guest-viewport-relative origin).
  The Leg 4 builders carry the known-good starting recipe; if the live smoke shows it needs
  adjustment, **fix `input.js` and its unit tests, then re-verify** — input is not "done" until it
  drives a live guest.
- **DD5 bypass-path check** is the load-bearing security assertion while the flight is ungated: the
  internal `goldfinch://settings` guest must be (a) absent from `enumerateTabs` AND (b) **rejected**
  when its `wcId` is passed directly to a nav/input op (`resolveContents` `internal-session` throw).
- **DD8 / single CDP client** — `cdp-driver.mjs` is the one CDP client during the smoke; the engine is
  debugger-free, so there is no contention.

## Inputs

What exists before this leg runs:
- Legs 1–5 landed: `src/main/automation/{resolve,tabs,nav,input,engine}.js`, the `renderer.js`
  `__goldfinchAutomation` hook, the dev seam in `main.js` + `chrome-preload.js`, `src/shared/automation-dev.js`.
- `scripts/cdp-driver.mjs` — `eval` / `click` / `move` / `key` / `shot` / `reload` over the chrome
  renderer CDP target at `http://127.0.0.1:9222`.
- `npm run dev:debug` — launches the app with `--remote-debugging-port=9222 --remote-allow-origins=* --no-sandbox`
  (the dev seam is active under this command, per Leg 5's gate).
- Pre-flight spike learnings (flight log): this WSL2 env runs headed Electron with
  `--no-sandbox --disable-dev-shm-usage`; `sandbox:false` web webviews (`main.js:138`).

## Acceptance Criteria

- [x] **AC1 (static)** — `npm test` (full unit suite) green, `npm run typecheck` clean, `npm run lint`
  clean. Includes all automation module tests from Legs 1–5.
- [x] **AC2 (live — drive a guest)** — under `npm run dev:debug`, via
  `cdp-driver.mjs eval "window.goldfinch.automationDevInvoke(<op>, <args>)"`:
  enumerate tabs (`enumerateTabs`), open/navigate a foregrounded guest (`openTab` / `navigate`), and
  confirm the **live UI updated** by a machine read (a follow-up `eval` reading the guest's
  `location.href`/`document.title`, or a `cdp-driver shot` screenshot). Evidence captured.
- [x] **AC3 (live — trusted input fires real handlers)** — deliver a `click` and `typeText` to the
  foregrounded guest and confirm the page's **real handlers fired** via DOM read-back (e.g. type into
  an input and read its `value`; click a control and read the resulting DOM/state change). This is the
  trusted-input proof for SC2. Evidence captured.
- [x] **AC4 (live — chrome target)** — deliver input to the **chrome** renderer (e.g. a `pressKey` or
  `click` at a chrome control) and confirm it lands (chrome targets need no foreground activation).
- [x] **AC5 (live — tab ops)** — exercise `openTab` / `closeTab` / `activateTab` (bring-to-front) /
  send-a-tab-to-back (activate a different tab) / `enumerateTabs`, confirming each reflects in the live
  UI / enumerate output.
- [x] **AC6 (live — resolve the two spikes)** — confirm the **guest click recipe** reliably actuates a
  control (real handler fires) and confirm the **coordinate space** (guest-viewport-relative). **Record
  the confirmed recipe + coordinate-origin finding in the flight-log entry.** If the starting recipe
  needed adjustment, the change was made in `input.js` (the single place — `mouseClickEvents`) and its
  unit tests updated, and the full suite re-run green.
- [x] **AC7 (live — DD5 bypass path)** — open the internal `goldfinch://settings` tab (via the app UI /
  the chrome), then confirm: (a) it is **absent** from the engine's `enumerateTabs`; AND (b) passing its
  `wcId` directly to `navigate` and to `click` is **rejected** with the `internal-session` error (not
  silently driven). **Obtaining the internal wcId** (it is absent from `enumerateTabs` by design — that
  is assertion (a)): use the **raw renderer hook**
  `cdp-driver.mjs eval "window.__goldfinchAutomation.listTabs()"` — the renderer hook does **not**
  filter the internal tab (Leg 2 AC2: filtering is main's job), so it returns the settings tab with its
  `wcId`; the engine's `enumerateTabs` is the layer that drops it. No temporary code is needed.
  **The `navigate` reject test MUST use a safe http URL** (e.g. `https://example.com`) as the url arg —
  a `goldfinch://` url would trip `bad-url` *before* `resolveContents`, masking the `internal-session`
  reject we are asserting. `click` has no URL gate, so it reaches `resolveContents` directly. Evidence
  captured (the engine enumerate sans-internal, the raw hook showing the internal wcId, and both
  rejection error texts).
- [x] **AC8** — A flight-log entry records: the smoke procedure, per-step machine-read results, the
  confirmed input recipe/coordinate finding (AC6), the DD5 bypass-path confirmation (AC7), and the
  evidence path. Evidence lives **outside the repo** (e.g. `/tmp/gf-smoke/drive-engine/…`, per the
  ARTIFACTS evidence convention) — **not committed**.

## Verification Steps

1. **Static first** — `npm test`, `npm run typecheck`, `npm run lint`. All green before touching the GUI.
2. **Pre-smoke checks** — confirm a display is available; confirm nothing else is bound to port 9222
   (`ss -ltnp | grep 9222` or equivalent); if occupied, stop the stale process or pick another port via
   `CDP_HTTP`.
3. **Launch** — `npm run dev:debug` (background); wait for the CDP endpoint at `http://127.0.0.1:9222/json`
   to list the `index.html` renderer target before driving (bounded wait; fail fast if it never appears).
4. **Drive** (each via `cdp-driver.mjs eval "window.goldfinch.automationDevInvoke('<op>', [<args>])"`):
   enumerate → openTab(https URL) → read back guest url/title (AC2) → click a known element + read its
   effect, typeText into a field + read value (AC3) → drive a chrome control (AC4) → tab ops (AC5) →
   resolve the click/coordinate spikes (AC6) → open settings, enumerate (assert absent), navigate &
   click its wcId directly (assert `internal-session` reject) (AC7).
5. **Capture evidence** to `/tmp/gf-smoke/drive-engine/<ts>/` (screenshots via `cdp-driver shot`, eval
   read-backs saved as text).
6. **Tear down** — kill the dev:debug app process (e.g. `pkill -f "electron \."` or kill the launched
   PID). Confirm port 9222 is freed.
7. **If a recipe fix was needed (AC6)** — edit `input.js` + tests, re-run static suite, re-drive the
   affected step.

## Implementation Guidance

- **Do not introduce `webContents.debugger`** anywhere (DD8) — `cdp-driver.mjs` holds the single CDP
  client. The engine drives via the dev seam (IPC → `executeJavaScript` / `sendInputEvent` / `loadURL`),
  not via a second debugger attach.
- **Driving shape**: `cdp-driver.mjs eval` runs an expression in the chrome renderer main world and
  prints the JSON result (with `awaitPromise`). So
  `node scripts/cdp-driver.mjs eval "window.goldfinch.automationDevInvoke('enumerateTabs', [])"`
  prints the enumerate array; `…('navigate', [<wcId>, 'https://example.com'])` navigates; a rejected
  invoke prints `EVAL_ERROR …` with the engine error text (use that to assert the `internal-session`
  reject in AC7).
- **Getting a guest wcId**: `enumerateTabs` returns `{ wcId, url, title, jarId, active }[]`; **pick the
  active guest's `wcId` from that array — it is the argument to all subsequent nav/input ops** (chain
  it through). For AC7 the internal settings tab's wcId is **not** in `enumerateTabs` (assertion a), but
  IS in the raw renderer hook `window.__goldfinchAutomation.listTabs()` (unfiltered) — read it from
  there and pass it to `navigate` (with an http url) / `click` to confirm the `internal-session` reject.
- **Spike resolution (AC6)**: drive a click at a control with an observable handler (e.g. a button that
  mutates the DOM, or focus an input then read `document.activeElement`/`:focus`), and verify the
  coordinate origin by clicking a known on-screen position in the guest. If clicks don't actuate,
  iterate on `mouseClickEvents` (extra `mouseMove`, settle delay, `clickCount`/`button`/`buttons`,
  coordinate offset) — the flight's Adaptation Criteria note that an unreliable guest click could force
  a CDP `Input.dispatch*` path (a divert); record any such finding.
- **Honesty in the log**: if the live smoke cannot run in this session (no display / port unavailable /
  app won't start), record that plainly in the flight-log entry and mark the live ACs as **blocked**
  with the reason — do NOT claim a pass that wasn't observed. Static ACs (AC1) can still pass.

## Edge Cases

- **App won't start headed in this env** — the spike proved it can with `--no-sandbox --disable-dev-shm-usage`
  (dev:debug already passes `--no-sandbox`); if shm errors recur, add `--disable-dev-shm-usage`. If it
  still won't run, this is a `[BLOCKED:no-display]` to escalate, not a silent skip.
- **Guest click lands on the wrong element** — likely a coordinate-space mismatch (AC6); the spike’s
  job is to nail the origin. Record the resolved convention.
- **Port 9222 already bound** — a stale `dev:debug` from a prior run; kill it or use `CDP_HTTP` on
  another port.
- **A recipe fix changes `input.js`** — that module is immutable-once-`in-flight` only at the *leg*
  granularity; here the fix is part of *this* leg's scope (the spike resolution), so editing `input.js`
  + its tests + re-running is correct, and is recorded as a deviation/decision in the flight log.

## Files Affected
- (Verification leg — primarily runs + records.) Possible: `src/main/automation/input.js` +
  `test/unit/automation-input.test.js` **iff** the live spike requires a recipe adjustment (AC6).
- Flight log: the smoke run entry (AC8). Evidence to `/tmp/gf-smoke/drive-engine/<ts>/` (uncommitted).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified (or live ACs explicitly marked blocked with reason, per the honesty note)
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with the live-smoke entry (procedure, machine reads, recipe finding, DD5 confirmation, evidence path)
- [x] Set this leg's status to `landed` (batch commit at flight end — do NOT commit, do NOT `[COMPLETE:leg]`)
- [x] This is the last autonomous leg → flight proceeds to review + commit (Phase 2d) after this lands
