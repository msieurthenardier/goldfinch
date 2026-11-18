# Leg: check-now-main-side

**Status**: completed
**Flight**: [Update awareness](../flight.md)

## Objective

Main can run an on-demand update check through the existing request code, answer the caller with a short outcome, refuse presses that come too soon, and publish when the last check happened and whether checking is possible — reachable from internal pages through one no-argument channel.

## Context

- Sortie DD1, DD2, DD5 and DD6's main half (see `../flight.md`, as amended by the Architect review). Leg 02 builds the Settings page and the kebab dot on what this leg exposes; nothing visible changes here.
- **The checker today** (`src/main/update-check.js`, `createUpdateChecker`): `runCheck()` returns nothing and opens with `if (stopped || inert || !checkEnabled || run) return;`; it sets `run = mine` (an in-flight record `{ controller, abortedBy }`) before its first `await`; outcomes are traced (`newer`, `current`, `http-<n>`, `too-large`, `bad-json`, `bad-tag`, `redirect`, `network`, `timeout`, `aborted`); `apply(nextAvailable, nextUrl)` emits only when `available` / `releaseUrl` change; `getState()` → `{ current, available, releaseUrl, checkEnabled, downloadName }`; `arm(ms)` re-arms the daily timer and calls `runCheck()`; `start(enabled)` waits the initial delay; `setEnabled(on)` — off: clear timer, `abortRun('disabled')`, clear `available` / `releaseUrl`, trace `disabled`, emit; on: emit, then (unless inert) `arm(intervalMs)` and `runCheck()`; `stop()` aborts. Injected: `fetch`, `getVersion`, `url`, `platform`, `arch`, `appImage`, `onChange`, `trace`, `setTimeout`, `clearTimeout`, `initialDelayMs`, `intervalMs`, `timeoutMs`, `logger`.
- **Wiring**: `src/main/main.js` constructs the checker (`createUpdateChecker({ fetch: (url, init) => net.fetch(url, init), getVersion, url, initialDelayMs, onChange: (state) => broadcastToChromeAndInternal('update-state-changed', state), trace })`) and passes `getState: () => updateChecker.getState()` to `registerUpdateIpc`; `src/main/register-update-ipc.js` registers `update:get-state` (`chromeOrInternal`), `update:open-release-page` (`chrome`), `internal-update-open-release-page` and `internal-update-download` (`internal`, through `registerInternalHandler`). Bridges: `src/preload/internal-preload.js` (`updateGetState`, `onUpdateStateChanged`, `offUpdateStateChanged`, `updateOpenReleasePage`, `updateDownload`), typings in `src/renderer/renderer-globals.d.ts` (`interface UpdateState`, both bridge interfaces).
- **Pinned counts**: `test/unit/ipc-gate-invariant.test.js` `EXPECTED_CHANNELS = 210`, `EXPECTED_CLASS_COUNTS.internal = 76`; CLAUDE.md states the channel-table row count (210).

## Design review amendments — these override the text below wherever they differ

Developer design review 2026-11-17: **approve with changes**; every Context citation verified. Incorporated:

- **The join mechanism.** An `async` function cannot hold its own promise, so `runCheck()` becomes: guard → `const mine = { controller, abortedBy: null }` → `run = mine` → `mine.promise = execute(mine)` → `return mine.promise`, where `execute` is the existing body as an inner async function (it runs synchronously up to its first `await`). A call while `run` is set returns `run.promise`. The timer's `void runCheck()` goes through the same record, so a check-now joins a timer-started check. The timer callback also returns early if `!checkEnabled` (defensive; real timers cannot fire after `clearTimeout`).
- **Aborted is always aborted.** Whenever `mine.abortedBy !== null` the outcome is `aborted` — including the path where a late `200` arrives after `setEnabled(false)` and the body is parsed (today that reaches the `current` branch with `run !== mine` and only the trace corrects it). Unit case: a late `200` after `setEnabled(false)` → the joiner gets `failed`; `lastCheck` unchanged.
- **After an abort, `run` is already null**, so a check-now arriving before the aborted fetch settles starts a fresh request — as today; stated, and fine.
- **`lastCheck.at` is the completion time**, and `retryAt = lastCheck.at + MIN_CHECK_GAP_MS`; too soon means `now - at < MIN_CHECK_GAP_MS` (exactly 30 000 ms elapsed is allowed — a unit case). The gap applies after a scheduled check too. The gap binds `checkNow` only: `setEnabled(true)` still checks at once.
- **One emit per completion.** `lastCheck` is set before `apply()`; if `apply()` emitted, nothing more; otherwise `emit()` once. Unit cases: a `newer` that changes `available` emits exactly once and carries `lastCheck`; a repeat answer emits once with `available` / `releaseUrl` unchanged. Consumers were read and tolerate a push with `available` unchanged (the About controller patches in place; its hint override clears only when `available` / `downloadName` change; the kebab setter reassigns). **For leg 02: a push no longer implies that `available` changed.**
- **Existing tests that must change** (named, not "every case passes"): `update-check.test.js` — "newer … a second identical answer changes nothing" is renamed and re-asserted (a repeat answer now emits once, for `lastCheck`, with `available` / `releaseUrl` unchanged — the intent changes); the three `getState()` deep-equal assertions (the newer case, the state test, the inert test) gain `lastCheck` and `canCheck` (mechanical). `register-update-ipc.test.js` — "registers exactly the four channels" becomes five and is renamed; `setup()` gains an injectable `checkNow` spy.
- **The registrar** wraps `checkNow()`: a throw or rejection answers `{ outcome: 'unavailable' }`; the result is copied. The argument test asserts the spy was called with **zero** arguments.
- **Unit table additions**: joining a **timer-started** check is driven by firing the fake timer with a pending fetch, then `checkNow()`, then resolving — never by calling `runCheck` directly; `stop()` during a check-now → `failed`; the 30 000 ms boundary.
- **AC8 sequencing** (the dev build's first scheduled check runs one second after boot and counts toward the gap): boot → wait more than 31 s → press (one request, `newer`) → press again at once (`too-soon`, request log unchanged) → wait more than 31 s → press (one request). Each call is an admin `evaluate` with `expression` set to an async IIFE that returns a JSON-serialisable object (`{ r: await window.goldfinchInternal.updateCheckNow(), s: await window.goldfinchInternal.updateGetState() }`) — never `undefined`. **Unit-only, stated**: the daily timer's due time being unchanged, and two Settings pages pressing at once (the "two presses without awaiting" case). This leg drives the bridge; the real button is leg 02's.

## Inputs

- Branch `sortie/09-update-awareness` at `567a2a5` plus the sortie's planning artifacts (uncommitted).

## Outputs

- `update-check.js`, `register-update-ipc.js`, `ipc-channel-table.js`, `main.js` (one dependency), `internal-preload.js`, `renderer-globals.d.ts`, tests, `docs/updates.md`, `docs/mcp-automation.md`, CLAUDE.md.

## Acceptance Criteria

- [ ] **AC1 — One request path, returning its outcome.** `runCheck()` returns a promise of its outcome code (the same codes it traces), stored on the in-flight record synchronously before the first `await`. The "automatic checks are on" test moves out of `runCheck` into its two callers (the timer callback in `arm` and `setEnabled(true)`); `runCheck` keeps `stopped || inert || run` as its own guard (a call while one is in flight returns the in-flight record's promise). The outcome is derived from the record's own `abortedBy` / timeout state, never from `run === mine`. `apply()` and its guard are unchanged. Nothing is awaited between deciding to start and `run = mine`. The fetch call — URL, method, `credentials`, `redirect`, `referrerPolicy`, `cache`, headers, signal, size cap, timeout, validation — is byte-for-byte the existing code; a unit test asserts the options object on both the scheduled and the on-demand path.
- [ ] **AC2 — `checkNow()`.** In this order: stopped or inert → `{ outcome: 'unavailable' }`; a check in flight → join it and answer its outcome (even inside the gap); within `MIN_CHECK_GAP_MS` (30 000) of the last completed check → `{ outcome: 'too-soon', retryAt }` (wall clock); otherwise start `runCheck()` and answer its outcome. Page outcomes: `newer`, `current`, `failed` (every failure code **and** `aborted` / `timeout` map to `failed`). Works with automatic checks on or off. Never arms, re-arms or clears the daily timer. The gap: "completed" means a check that ended with any outcome but `aborted`; if the injected clock reads earlier than the last completed check, the gap counts as elapsed. `MIN_CHECK_GAP_MS` is exported.
- [ ] **AC3 — State.** `getState()` gains `lastCheck: { at, outcome: 'newer' | 'current' | 'failed' } | null` and `canCheck: boolean` (`!inert && !stopped`). `lastCheck` is set when any check (scheduled or on demand) ends with an outcome other than `aborted`, and **`emit()` is then called unconditionally** — a `current` after a `current` reaches the pages. `lastCheck` is not cleared by `setEnabled(false)`; it is in memory only. A new injected `now = () => Date.now()` supplies the times. Existing fields and their meanings are unchanged.
- [ ] **AC4 — Unit table** (`test/unit/update-check.test.js`, fake `fetch` with the real `Response` shape and injected timers and clock, as the existing tests do): check-now with automatic checks off → one request, outcome, `lastCheck`, no timer armed; with them on → one request, the daily timer's due time unchanged; inert → `unavailable`, zero requests; after `stop()` → `unavailable`; a press while a scheduled check is in flight → zero extra requests, the same outcome; two presses back-to-back without awaiting → one request, both get the outcome; inside the gap → `too-soon` with `retryAt = last.at + 30 000`; the gap after a `failed` check (counts) and after an `aborted` one (does not); the clock stepped backward → not `too-soon`; each failure code → `failed`; `setEnabled(false)` during a check-now → the caller gets `failed`, the notice cleared, `lastCheck` unchanged; `setEnabled(true)` during a check-now → still one request in total; a check-now with automatic checks off that finds a newer version → `available` set and emitted; `lastCheck` emitted on `current` after `current`; `lastCheck` survives `setEnabled(false)` then `setEnabled(true)`; `canCheck` true / false. Every existing case still passes, renamed only if its intent changed.
- [ ] **AC5 — The channel.** `internal-update-check-now` in `CHANNEL_CLASS` as `internal` (210 → 211; `EXPECTED_CLASS_COUNTS.internal` 76 → 77; CLAUDE.md's count), registered with `registerInternalHandler`, ignoring every argument, answering `checkNow()`'s result. `registerUpdateIpc` gains a `checkNow` dependency (wired in `main.js` to `updateChecker.checkNow()`), defaulting to `() => ({ outcome: 'unavailable' })` so existing tests and callers need nothing. A comment states why no reveal-gate call is needed (no secret, no key, no caller-chosen value; at most one request per 30 s). Registrar tests on a **real** gate (`test/helpers/ipc-gate-fixture.js`): a web tab's frame is refused; a page-supplied argument (string, object, array, number) changes nothing about what is called; the result is passed through.
- [ ] **AC6 — Bridge and typings.** `window.goldfinchInternal.updateCheckNow()` (literal channel, no argument) in `internal-preload.js`; `UpdateState` gains `lastCheck` and `canCheck`, and the internal bridge interface gains `updateCheckNow(): Promise<{ outcome: 'newer' | 'current' | 'failed' | 'too-soon' | 'unavailable'; retryAt?: number }>`. Not added to the chrome bridge. `preload-channel-literals.test.js` green.
- [ ] **AC7 — Docs.** `docs/updates.md`: Check now (works with automatic checks off; one request at a time; the 30-second gap; what each answer means; that turning the setting on still checks at once); the state's new fields. `docs/mcp-automation.md`: one line — an admin key that evaluates script in the Settings page can press Check now, at most one request per 30 seconds, revealing nothing `update:get-state` does not. CLAUDE.md's *Update check* entry: `checkNow`, `lastCheck`, `canCheck`, the channel, the gap, and the count.
- [ ] **AC8 — Live smoke** (dev mode with the update fixture, behind the dead proxy, scratch `HOME` / `XDG_CONFIG_HOME`, as `tests/behavior/update-notice.md`'s Preconditions describe): through `window.goldfinchInternal.updateCheckNow()` evaluated in a `goldfinch://settings` tab — with the setting on (one fixture request, `newer`, `lastCheck` in `updateGetState()`), immediately again (`too-soon`, no request), after 30 s (one request); with the setting off (one request, nothing further for 60 s); a fixture mode that fails (`failed`, `lastCheck.outcome` `failed`). Every existing apparatus primitive answers once against that tab. No outside host contacted.
- [ ] **AC9 — Gates.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`. `src/renderer/renderer.js` byte-identical; no file under `src/renderer/` changes except `renderer-globals.d.ts`.

## Verification Steps

- AC1–AC6: the unit suites named. AC7: read by the Flight Director. AC8: the smoke table in the flight log. AC9: the gates and `git diff --stat`.

## Implementation Guidance

1. Refactor `runCheck` to return its outcome and move the on/off test to its callers — existing tests first, green, before anything is added.
2. `lastCheck`, `canCheck`, `now`, the unconditional emit.
3. `checkNow` and its table.
4. Channel, table row, counts, bridge, typings.
5. Docs, smoke, gates. Leg `landed`, flight-log entry, `[LAND:leg]`. Do not commit.

## Edge Cases

- **A scheduled timer fires during a check-now**: `runCheck` returns the in-flight promise; the timer has already re-armed; no second request.
- **`stop()` during a check-now** (quit): the caller's promise resolves `failed`; nothing is emitted after stop.
- **A request that never completes**: the existing 15-second limit ends it as `timeout` → `failed`, and it counts toward the gap.
- **A check-now result while automatic checks are off** stays in `available` until the next check, a restart, or the setting going on then off — by sortie decision.
- **Anything needing a design call**: `[BLOCKED:<reason>]`.

## Files Affected

- `src/main/update-check.js`, `src/main/register-update-ipc.js`, `src/main/ipc-channel-table.js`, `src/main/main.js`
- `src/preload/internal-preload.js`, `src/renderer/renderer-globals.d.ts`
- `test/unit/update-check.test.js`, `test/unit/register-update-ipc.test.js`, `test/unit/ipc-gate-invariant.test.js`
- `docs/updates.md`, `docs/mcp-automation.md`, `CLAUDE.md`

## Citation Audit

Checked by the Flight Director on 2026-11-17 against `567a2a5`: `update-check.js` — `createUpdateChecker`'s dependency list, `getState`, `arm`, `runCheck`'s guard line and its `run = mine` before the first `await`, `apply`, `setEnabled`, `start`, `stop`, the exports; `main.js` — the `createUpdateChecker({ … })` construction and `getState: () => updateChecker.getState()`; `register-update-ipc.js` — the dependency typedef and the four registrations; `internal-preload.js` — the `update*` bridge methods; `renderer-globals.d.ts` — `interface UpdateState`; `ipc-gate-invariant.test.js` — `EXPECTED_CHANNELS = 210`, `internal: 76`. Tier: **high** — the checker's state machine and a new privileged channel. Developer design review done (one cycle; amendments above).

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
