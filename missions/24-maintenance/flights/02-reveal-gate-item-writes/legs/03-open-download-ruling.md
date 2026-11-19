# Leg: open-download-ruling

**Status**: completed
**Flight**: [Reveal Gate Covers Vault Item Writes](../flight.md)

## Objective

While the reveal gate applies, opening a downloaded file asks the operator first through the gate's native confirmation. That covers both entry points: the chrome's downloads popup (`open-downloaded-file`) and the downloads page's `open` action. An ordinary open with no automation around is unchanged.

## Context

- **Flight Design Decision (operator, 2026-11-18, option B):** "Opening a downloaded file asks first while the gate applies".
  - This widens the gate's stated definition (secret-returning, key-minting, bundle-destination) by one case, "runs a program". Record that in CLAUDE.md and `docs/mcp-automation.md`.
  - **DD9 still holds** for a plain open: the operating system's confirmation is the only one when no automation is around.
- **Maintenance finding #3:** an admin script in the chrome (admin `evaluate` reaches the chrome) or in `goldfinch://downloads` can download a program and open it. On Windows `shell.openPath` runs it, with no in-app step.
- **THE ONE open function:** `src/main/register-download-ipc.js` `openDownload(id)`. It is the only `shell.openPath` caller in `src/main/**` (source-scan pinned), and it checks for a known record, state `completed` and a recorded `savePath`. Callers:
  - `gate.chrome.handle('open-downloaded-file', (_event, id) => openDownload(id), 'throw')`
  - `registerInternalHandler(ipcMain, 'internal-downloads-action', …)`, branch `action === 'open'`
- **The gate's sender resolution today is guest-only.** `main.js` `createRevealGate({ windowFor: (sender) => registry.getWindowForGuest(sender.id)?.win ?? null, isActive: (sender) => registry.getWindowForGuest(sender.id)?.activeTabWcId === sender.id, … })`. A CHROME sender therefore gets `windowFor = null`, which means `'gone'` and a refusal. Every channel gated so far is internal-page only, so this never mattered. It matters now: without a change, the operator's own popup click would be refused while an admin session is attached.

## Inputs

- Leg 2 landed: the gate gains `itemWritten` / `itemCopied` / `itemDeleted` / `dropAllGrants`, `buildOptions` appends a note sentence, and `main.js`'s `createRevealGate({` block has new deps. **Re-read `reveal-gate.js` and that block before editing.**
- **Design review cycle 1** (flight log): approve with changes. Folded in below:
  - the chrome sender resolution moves into a small testable module;
  - the scenario ACs drive the real registered handlers with a chrome-shaped event;
  - the existing callers pin is re-targeted;
  - the re-check after confirmation is promoted to an AC;
  - the downloads page shows a notice on a refusal.
- **No new IPC channel**, so `ipc-channel-table.js` is unchanged.

## Outputs

- `src/main/reveal-gate.js`: a new `ACTIONS['open-download']` entry with its own detail text; `buildOptions` uses an action's own detail when it has one.
- `src/main/register-download-ipc.js`: `openDownload(event, id)` asks the gate after the early returns. `registerDownloadIpc` requires `revealGate` and throws at registration without it.
- New `src/main/reveal-gate-senders.js` (Electron-free): `createGateSenderResolvers(registry)` returns `{ windowFor, isActive }` and resolves guest AND chrome senders.
- `src/main/main.js` (wiring only): `createRevealGate({ …createGateSenderResolvers(registry), … })` replaces the two inline lambdas, and `revealGate` is passed to `registerDownloadIpc`.
- `src/renderer/pages/downloads.js` `runAction`: a refusal shows a notice.
- Tests: `test/unit/register-download-ipc.test.js`, `test/unit/reveal-gate.test.js`, `test/unit/reveal-gate-wiring-invariant.test.js` (`GATED`, plus the registrar-throws list), and a `main.js` wiring pin for the chrome-sender resolution.
- Docs: CLAUDE.md (reveal-gate paragraph: the gated list, the definition sentence, the chrome-mark residual, and the *Downloads* DD9 bullet), and `docs/mcp-automation.md` *What each tier can reach*. `docs/dev-testing.md` only documents the trace switch (checked 2026-11-18), so it needs no change.

## Acceptance Criteria

- [ ] **Order of checks.** `openDownload` resolves the record and returns today's `{ ok: false }` for an unknown, incomplete or path-less record BEFORE any gate call: no dialog for an open that would fail.
  - It then awaits `revealGate.confirm(event, { channel, action: 'open-download', subject: record.filename })`.
  - **Proceed** on `'not-applicable'` or `'confirmed'`.
  - **`'busy'`, or `'gone'` with `info.interrupted`:** return `{ ok: false, refused: 'not-confirmed', busy: true }`.
  - **Anything else:** return `{ ok: false, refused: 'not-confirmed' }`. `shell.openPath` is NOT called.
  - `channel` is the literal of the calling channel: `'open-downloaded-file'` or `'internal-downloads-action'`.
- [ ] **Re-check after confirmation.** After `'confirmed'`, the record is resolved AGAIN and must still be `completed` with a `savePath`; otherwise the reply is `{ ok: false }` and `shell.openPath` is not called. Unit-tested by removing the record while the fake dialog is up.
- [ ] **No grant.** The request carries no `grant`, so each open asks.
- [ ] **Not applicable is today's behaviour.** With the gate not applying, both channels return exactly today's reply (`{ ok, error? }` from `shell.openPath`), with no dialog. Unit-tested.
- [ ] **Dialog text.** `ACTIONS['open-download']`:
  - question: `` (s) => `Open the downloaded file "${s}"?` ``
  - affirm: `Open`
  - an action-specific detail: admin → `An automation connection has been active in this browser recently and may have asked for this. Opening a downloaded program runs it on this computer. Choose Cancel unless you started this yourself.`; touched → `Automation ran script in this page and may have asked for this. Opening a downloaded program runs it on this computer. Choose Cancel unless you started this yourself.`
  - The other actions' detail text is byte-for-byte unchanged (unit-tested).
  - The subject is `record.filename`: main's own record, already sanitized by `sanitizeFilename`, and cleaned again by `cleanDisplayText`.
- [ ] **Chrome sender** (`reveal-gate-senders.js`, unit-tested with a fake registry):
  - `windowFor(sender)` = `registry.getWindowForGuest(sender.id)?.win ?? registry.getWindowForChrome(sender)?.win ?? null`.
  - `isActive(sender)`:
    ```js
    const g = registry.getWindowForGuest(sender.id);
    if (g) return g.activeTabWcId === sender.id;
    return registry.getWindowForChrome(sender) != null;
    ```
    That is an explicit chrome branch, never a fallthrough.
  - Tests cover: a guest in front, a guest behind, a chrome, an unknown sender (null / false), and a throwing registry (null / false).
  - **Every existing gated channel is unaffected.** They are internal-page channels, and `registerInternalHandler` refuses a chrome sender before the gate runs. List them in the flight log, per the CLAUDE.md shared-mechanism rule.
  - **Pinned:** a source-scan pin asserts `main.js`'s `createRevealGate({` block spreads `createGateSenderResolvers(registry)` and no longer defines `windowFor` / `isActive` inline.
- [ ] **Scenario, driven from the real entry points.** With `registerDownloadIpc` registered through a real gate fixture (`test/helpers/ipc-gate-fixture.js` `makeTestGate` / `eventFrom`, per its existing tests), a real `createRevealGate` with an admin session attached, a fake `shell.openPath` spy and a completed record:
  - (a) invoking the REAL `open-downloaded-file` handler with a chrome-shaped event raises one dialog; answering Cancel means `openPath` was never called and the reply is the refusal; answering Open calls it once;
  - (b) the same through the REAL `internal-downloads-action` handler with `action: 'open'` and an internal-page event;
  - (c) with no admin session and no mark, both handlers raise no dialog and return today's reply.
- [ ] **Callers handle the refusal.**
  - The chrome's downloads-controller ignores the reply and must not throw on the new shape.
  - The downloads page's `runAction`, when `res.refused`, shows the notice `Not opened.` in the row's notice element and never the "Could not open file" text. Today's `ok === false` re-fetch still happens. Unit-tested if `downloads.js` has a controller test; otherwise grep-asserted and recorded in the flight log.
- [ ] **Registration.**
  - `registerDownloadIpc` throws at registration without a `revealGate` that has `confirm` (message style as `registerVaultIpc`'s).
  - `reveal-gate-wiring-invariant.test.js` lists `register-download-ipc.js` in `GATED` with a regex on `action: 'open-download'`, and adds `registerDownloadIpc` to the "registrar throws without the gate" list.
  - The existing source-scan pin that `shell.openPath` sits in exactly one function still passes.
  - `test/unit/register-download-ipc.test.js`'s callers pin (`/return openDownload\(id\);/` exactly twice) is RE-TARGETED to the new call form. It uses a wrap-insensitive regex that also asserts the channel literal at each call site, and it is neuter-verified.
  - The file's registrar fixture passes a `revealGate`.
- [ ] **Docs.**
  - CLAUDE.md's reveal-gate paragraph: add the two open paths to the *Gated* list, and one sentence on why ("runs a program", operator ruling 2026-11-18).
  - The *Downloads* "Confirmation before running a downloaded program is the operating system's" bullet gains "except while the reveal gate applies".
  - `docs/mcp-automation.md` tier table: the same change.
- [ ] **No regression.** `npm test`, `npm run lint`, `npm run typecheck` and `npm run format:check` are green.

## Verification Steps

- `node --test --test-timeout=60000 test/unit/register-download-ipc.test.js test/unit/reveal-gate.test.js test/unit/reveal-gate-wiring-invariant.test.js`
- `grep -n "openPath" src/main -r` shows one call site, unchanged.
- `timeout 300 npm test && npm run lint && npm run typecheck && npm run format:check`

## Implementation Guidance

1. **`reveal-gate.js`:**
   - Give `ACTIONS` entries an optional `detail: (reason) => string`.
   - In `buildOptions`, use `spec.detail(reason)` when present, else today's text. Leg 2's note sentence, if any, is still appended.
   - Add the `'open-download'` entry and extend the `GateRequest` action typedef.
2. **`register-download-ipc.js`:**
   - Add the `revealGate` dep and the registration check.
   - `openDownload` becomes `async function openDownload(event, id, channel)`, and both callers pass their event and channel literal.
   - Keep the `shell.openPath` call inside this one function, since the pin requires it.
3. **`main.js`:** change only the `windowFor` / `isActive` lines and add `revealGate` to the `registerDownloadIpc({` call.
4. **Tests, then docs.**

## Edge Cases

- **A record that completes while the dialog is up:** irrelevant, because the record is resolved before the gate (only completed records reach it).
- **A record removed while the dialog is up:** after `'confirmed'`, re-resolve the record and re-check `completed` and `savePath` before `shell.openPath`. If it is gone, return `{ ok: false }`.
- **The window closes while the dialog is up:** the gate's `watch` aborts on the window's `close`, giving a `'gone'` refusal.
- **A chrome sender with no resolvable window** (a mid-teardown chrome): `windowFor` is null, which means `'gone'` and a refusal only when the gate applies. Otherwise `'not-applicable'` and today's open.
- **The downloads popup's own click** lands on the menu-overlay sheet, which `windowInput` does not watch, so it cannot cancel its own dialog.
- **The chrome's scripted mark is never dropped.** An admin `evaluate` in the chrome marks the chrome's webContents, and nothing drops a chrome mark: `onCommit` / `forget` are wired for tabs and internal views only, in `guest-wiring.js`. So after one admin chrome `evaluate`, every open from that window asks until the window closes. This is fail-safe and accepted. Record it in CLAUDE.md's reveal-gate paragraph and in the flight log.

## Files Affected

- `src/main/reveal-gate.js`, `src/main/register-download-ipc.js`, new `src/main/reveal-gate-senders.js`, `src/main/main.js` (the resolver spread plus one dep), `src/renderer/pages/downloads.js` (the refusal notice).
- New `test/unit/reveal-gate-senders.test.js`.
- `test/unit/register-download-ipc.test.js`, `test/unit/reveal-gate.test.js`, `test/unit/reveal-gate-wiring-invariant.test.js`.
- `CLAUDE.md`, `docs/mcp-automation.md` (and `docs/dev-testing.md` if it lists gated channels).

## Citation Audit

Checked 2026-11-18 on the flight branch (before leg 2's edits land):
- `register-download-ipc.js`:
  - `resolveDownloadRecord`, `openDownload(id)` (the ONE `shell.openPath`);
  - `gate.chrome.handle('open-downloaded-file', …, 'throw')`;
  - the `internal-downloads-action` `open` branch.
- `main.js`:
  - `createRevealGate({ … windowFor: (sender) => registry.getWindowForGuest(sender.id)?.win ?? null, isActive: … })`;
  - `registerDownloadIpc({` (~:2210).
- `window-registry.js` `getWindowForChrome(sender)`: present (~:192).
- `src/renderer/pages/downloads.js` `runAction`: shows the open-failure notice only on `res.error`.
- `src/renderer/chrome/downloads-controller.js`: `goldfinch.openDownloadedFile(downloadId)`, result unused.
