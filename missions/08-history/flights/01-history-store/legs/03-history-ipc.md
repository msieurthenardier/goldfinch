# Leg: history-ipc

**Status**: completed
**Flight**: [Per-Jar History Store](../flight.md)

## Objective

Create `src/main/history-ipc.js` — the twin-registered (chrome +
`internal-history-*`) IPC surface over the history store per flight DD9 —
extend `internal-preload.js` with the invokers and the
`onHistoryChanged`/`offHistoryChanged` subscription pair, declare them on
`GoldfinchInternalBridge`, and wire registration in `main.js`.

## Context

- Legs 1–2 landed (uncommitted): `history-store.js` (full jar-keyed API) and
  the live recording pipeline. This leg adds the read/mutate IPC that
  Flight 3's history panel will consume — no UI yet, no consumers yet.
- Flight DD9 pins channels, payloads, and the fail-closed
  `history: <op> — <code>` error contract (M07 F1 pattern; STATIC strings —
  the two dynamic interpolations in jar-ipc are the precedent history must
  NOT repeat).
- Template: `src/main/jar-ipc.js:60 — "function registerJarIpc({ ipcMain,
  jars, … broadcast })"`, twin registration at `jar-ipc.js:223-241`
  (bare `ipcMain.handle('jars-*')` + `registerInternalHandler(ipcMain,
  'internal-jars-*', sameHandler)`).
- Preload template: `src/preload/internal-preload.js:44-62` (handle-map
  `on`/`off`), `:280 — "jarsList: () => ipcRenderer.invoke('internal-jars-list')"`,
  `:356 — "onJarsChanged: (cb) => on('jars-changed', cb)"`.

## Inputs

- `src/main/history-store.js` API: `listRecent(jarId, { limit, before })`,
  `search(jarId, query, { limit })`, `deleteVisit(jarId, visitId) → boolean`,
  `clearJar(jarId) → number`, `countByJar(jarId)` (listed for context;
  `countByJar` is deliberately unused this leg — Flight 2/3 panel counts
  consume it).
- `src/main/internal-ipc.js:registerInternalHandler` (origin + session
  gate — the authoritative boundary; nothing to re-implement).
- `src/main/main.js:2463` neighborhood — `registerJarIpc({...})` call site;
  the history registration lands adjacent, after the store is open.
- `test/unit/jar-ipc.test.js` — the fake-`ipcMain` handler-capture
  apparatus to copy.

## Outputs

- `src/main/history-ipc.js` (new) + `test/unit/history-ipc.test.js` (new).
- `src/preload/internal-preload.js` — 4 invokers + on/off pair.
- `src/renderer/renderer-globals.d.ts` — `GoldfinchInternalBridge` entries.
- `src/main/main.js` — one registration call.

## IPC Contract (implement exactly — flight DD9)

`registerHistoryIpc({ ipcMain, historyStore, jars, broadcast })` — CJS,
`// @ts-check`, Electron-free (deps injected), handler bodies defined once,
each registered twice: `ipcMain.handle('<channel>', handler)` AND
`registerInternalHandler(ipcMain, 'internal-<channel>', handler)`. Returns
nothing (no broadcaster needed by main.js — mutation broadcasts fire inside
the handlers via the injected `broadcast`).

Handlers take `(event, payload)`; validation is fail-closed, in order —
first failure returns immediately. ALL error strings are STATIC literals:

- `history-list` / `internal-history-list` — payload `{ jarId, limit?,
  before? }`:
  - payload not a non-null object → `{ ok: false, error: 'history: list — malformed-payload' }`
  - `jarId` not resolving via `jars.list().some(j => j.id === jarId)` →
    `{ ok: false, error: 'history: list — unknown-jar' }`
  - `limit` present but not a finite number, or `before` present but not a
    finite number → `{ ok: false, error: 'history: list — bad-args' }`
  - ok → `{ ok: true, visits: historyStore.listRecent(jarId, { limit, before }) }`
    (omit undefined options; store clamps limit)
- `history-search` / `internal-history-search` — payload `{ jarId, query,
  limit? }`:
  - malformed payload → `'history: search — malformed-payload'`
  - unknown jar → `'history: search — unknown-jar'`
  - `query` not a string, or bad `limit` → `'history: search — bad-args'`
  - ok → `{ ok: true, visits: historyStore.search(jarId, query, { limit }) }`
- `history-delete` / `internal-history-delete` — payload `{ jarId, visitId }`:
  - malformed payload → `'history: delete — malformed-payload'`
  - unknown jar → `'history: delete — unknown-jar'`
  - `visitId` not a finite number → `'history: delete — bad-args'`
  - `deleteVisit(jarId, visitId)` false → `{ ok: false, error: 'history: delete — not-found' }`
  - true → broadcast `history-changed { jarId }`, return `{ ok: true }`
- `history-clear` / `internal-history-clear` — payload `{ jarId }`:
  - malformed payload → `'history: clear — malformed-payload'`
  - unknown jar → `'history: clear — unknown-jar'`
  - ok → `n = clearJar(jarId)`; broadcast `history-changed { jarId }` ONLY
    when `n > 0`; return `{ ok: true, cleared: n }` (clearing an empty jar
    is ok:true, cleared:0, no broadcast — idempotent, no spurious
    invalidation).
- Store throws (any handler) → catch, return
  `{ ok: false, error: 'history: <op> — store-failure' }` (STATIC — do not
  interpolate the exception; log it via `console.error('[history]', err)`).

## Preload + types

- `internal-preload.js`, inside the existing bridge object:
  `historyList: (p) => ipcRenderer.invoke('internal-history-list', p)`,
  `historySearch`, `historyDelete`, `historyClear` (same shape), plus
  `onHistoryChanged: (cb) => on('history-changed', cb)` and
  `offHistoryChanged: (h) => off(h)` — the existing handle-map `on`/`off`.
- `renderer-globals.d.ts` `GoldfinchInternalBridge`: the four invokers
  typed `(payload: any): Promise<any>` — the loose style of the
  `downloadsList()`/`settingsGet()` entries, NOT the precise structural
  types of the jars block *(design review: precedent corrected)* —
  + `onHistoryChanged(cb: (p: any) => void): number` +
  `offHistoryChanged(h: number): void` (match the exact style of the
  neighboring `onJarsChanged`/`offJarsChanged` declares).
- NO chrome-preload additions (flight DD9; omnibox is Flight 4).

## main.js wiring

Call `registerHistoryIpc({ ipcMain, historyStore, jars, broadcast:
broadcastToChromeAndInternal })` at **module scope, immediately after the
`registerJarIpc({...})` block closes (~main.js:2489 on the current tree)** —
NOT inside `whenReady` next to the leg-2 boot block. Registration before
`historyStore.open()` is safe by the same lazy-closure property that lets
`registerJarIpc` run before `jars.load()`: handlers only touch the store at
invoke time, always after boot. *(design review: the two "adjacent"
locations in the draft were 140 lines apart; this is the pinned one.)*
Require line at the top with the other `./` requires.

## Acceptance Criteria

- [x] `src/main/history-ipc.js` exists (CJS, `@ts-check`, no
      `require('electron')`); handler bodies single-sourced. The
      extract-don't-fork property is pinned THREE ways *(design review —
      reference-equality via fake ipcMain is NOT achievable;
      `registerInternalHandler` wraps the handler in an origin-check
      closure)*: (a) a registration-surface test asserting exactly the 4
      chrome channels + 4 `internal-history-*` channels are registered and
      no others; (b) behavioral-parity tests — a mutation via
      `internal-history-clear` is observable via the chrome `history-list`
      twin, and vice versa for reads; (c) grep-AC: for each op, the
      identifier passed to `ipcMain.handle('history-X', …)` and to
      `registerInternalHandler(ipcMain, 'internal-history-X', …)` is the
      SAME identifier (source inspection, jar-ipc's own bar).
- [x] Untrusted-sender rejection pinned per `internal-history-*` channel
      via a `trustedHistoryEvent()`-style fake event (mirror
      `test/unit/jar-ipc.test.js`'s `trustedJarsEvent()` apparatus and its
      per-channel rejection test).
- [x] `test/unit/history-ipc.test.js` pins: every validation branch above
      (each error string asserted VERBATIM — the M07 branch-discriminable
      contract); success shapes for all 4 ops; `before: null` explicitly
      accepted by `history-list` (the documented no-cursor value — NOT
      malformed/bad-args); delete broadcasts only on true; clear broadcasts
      only when `n > 0`; store-failure catch branch returns the static
      string and never rejects the invoke — use ONE shared fake store with
      per-method throw toggles (the jar-ipc `storageThrows` convention),
      not four per-op fakes.
- [x] Grep-AC: `grep -n '\${' src/main/history-ipc.js` → zero hits (no
      template interpolation anywhere — all error strings static).
- [x] `internal-preload.js` has the 4 invokers + on/off pair; declares
      added to `GoldfinchInternalBridge`; `main.js` registers once at boot.
- [x] `npm test` / `npm run typecheck` / `npm run lint` green; suite ~1s.

## Verification Steps

- `npm test`, `npm run typecheck`, `npm run lint`.
- `node -e "require('./src/main/history-ipc')"` — side-effect-free.
- Grep-AC above (zero `${` in history-ipc.js).

## Edge Cases

- `before: null` explicitly passed → treat as absent (the store's default),
  not bad-args (`null` is the documented "no cursor" value).
- `limit: 0` → finite number, passes IPC validation; store clamps to 1
  (documented store behavior; IPC does not duplicate the clamp).
- Unknown extra payload keys → ignored (jar-ipc precedent; validation is
  allowlist-by-read, not shape-exhaustive).
- Handlers never read `event.sender` — sender trust is
  `registerInternalHandler`'s job on the internal family and the chrome
  trust domain on the bare family (jar-ipc precedent; do not invent a
  per-handler sender check).

## Files Affected

- `src/main/history-ipc.js` — new
- `test/unit/history-ipc.test.js` — new
- `src/preload/internal-preload.js` — invokers + subscription pair
- `src/renderer/renderer-globals.d.ts` — bridge declares
- `src/main/main.js` — require + registration call

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit (flight-level review + commit after the last leg)

## Citation Audit

Verified at leg design time against the working tree: `jar-ipc.js:60`
(`registerJarIpc({ ipcMain, jars, session, rerollSeed, revokeJarKey,
settings, broadcast })`), `jar-ipc.js:223-241` (twin registration, 8 ops ×
2 families), `jar-ipc.js:167-215` (fail-closed `jars: <op> — <code>` strings
— incl. the two dynamic-interpolation branches history must NOT copy),
`internal-preload.js:44-62 / :280 / :356` (handle map, `jarsList` invoker,
`onJarsChanged`), `main.js:2463` (`registerJarIpc({` call site),
`test/unit/jar-ipc.test.js` (fake-ipcMain apparatus). All verified OK
2026-07-12 (post-leg-2 tree).
