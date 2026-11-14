# page-containment-probe

Standalone measurement rig for flight 01 (page containment), leg 01, Track A. Each probe asks one
yes/no question about one of **our own** isolation boundaries, prints one line and stops. Nothing
observed is ever used; a "boundary does not hold" answer is a result, not a failure. The rig exits
non-zero only on a rig failure.

## Rig (Q1a, Q2, Q3)

```
node tests/behavior/fixtures/page-containment-probe/run-rig.mjs [--phases=q1,q2,q3]
```

`run-rig.mjs` rebuilds the gitignored product preload bundle (`scripts/build-preload.mjs`), picks the
ozone platform like `scripts/dev-launch.mjs`, and launches `rig-main.cjs` under the project's own
Electron binary with a fresh temporary `userData` (never the dev profile). Pages are served from a
loopback HTTP server on an ephemeral port (`127.0.0.1`; `localhost` is the cross-site twin).

The guest is a `WebContentsView` whose `webPreferences` mirror the web branch of
`src/main/register-tab-ipc.js` key for key (`contextIsolation:false`, `sandbox:true`,
`nodeIntegration:false`, `plugins:true`, `autoplayPolicy:'document-user-activation-required'`, a
`partition`, and `preload`). Rig-only differences: no shields, no window registry, software rendering,
stubbed `vault-eligible` / `shields-farble` replies, and (for Q2/Q3) a tiny rig preload instead of the
product bundle.

Output is `PROBE {json}` lines:

| id                                                                                                           | meaning                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `Q0.env`                                                                                                     | Electron/Chromium versions, bundle SHA-256, ozone platform                                                                                    |
| `Q1a` (twice: farble on, off)                                                                                | product bundle + live stubs; page-side built-in instrumentation report (`hits` = IPC-capable objects seen, `senderDetail`, `planShapes`, ...) |
| `Q2.roundtrip`, `Q2.throw`, `Q2.frameIdentity`, `Q2.navigateMidCall`, `Q2.wrapperLogTail`                    | main -> isolated world (id 745821) round trip, throw behaviour, frame identity across navigations, navigation between call and reply          |
| `Q3.inputControl`, `Q3.clean`, `Q3.suppress-*`, `Q3.hit-*`, `Q3.pageRemoveAttempt`, `Q3.productIcon`         | isolated-world listener trust (`isTrusted` as read in the world), suppression, hit-testing, and the product's own icon                        |
| `console`                                                                                                    | guest console errors (rig diagnostics)                                                                                                        |

## Gesture-transport probes (G1-G8)

```
node tests/behavior/fixtures/page-containment-probe/run-rig.mjs --phases=g          # all of G1-G8
node tests/behavior/fixtures/page-containment-probe/run-rig.mjs --phases=g3,g6      # a subset
```

Implemented in `gesture-phase.cjs` (loaded by `rig-main.cjs`; the q1/q2/q3 phases are untouched). Pages:
`g-page.html` (Q2 counting wrappers + `g-argscan.js`, an argument scanner that records only a label when
any argument/receiver contains the inert substring `INERT`/`inert`; icon stand-in `#icon`, plain control
`#plain`, field `#f`), `g-frame.html` + `g-inner.html` (stand-in in a same-site / cross-site iframe),
`g6.html` + `g6-hooks.js` (`?mode=A|B|C`: `Object.prototype.then` getter / `Promise.prototype.then`
wrapper / `Object.prototype.toJSON` getter that try to substitute an inert marker in a reply).

| id                                                            | meaning                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `G1.inputControl`, `G1.realClick`, `G1.syntheticClick`        | `input-event` / `before-mouse-event` for a `sendInputEvent` click vs page-script clicks; page counter deltas |
| `G2`                                                          | main-side x/y vs isolated-world `getBoundingClientRect` under zoom 1 / scroll / zoom 1.5 / device emulation  |
| `G3.idle`, `G3.pageMainThreadBlocked`                         | ordering and gap, main event vs DOM mousedown/click in the isolated world                                    |
| `G4.keyboard`, `G4.contextMenu`                               | `before-input-event` for Enter/Space on a focused stand-in; `context-menu` real vs synthetic                 |
| `G5.same-site iframe`, `G5.cross-site iframe` (+`.contextMenu`) | main-side events with the stand-in inside an iframe; what the inner page received                            |
| `G6.modeA/B/C`                                                | can page hooks alter the reply of a main-initiated isolated-world call                                       |
| `G7`, `G7.attribution`                                        | is the outbound code text / the reply visible to page wrappers                                               |
| `G8a`, `G8b`, `G8b.counterControl`                            | `webContents.debugger` Runtime.evaluate into world 745821; `webContents.insertText`                          |

The host can only deliver input via `webContents.sendInputEvent` (no physical pointer); timing is read from
`Date.now()` in both processes (the `performance.timeOrigin` clocks of the two processes are skewed by
~187 ms here, so only same-clock `Date.now()` gaps are meaningful).

## Product harness (Q1b, Q4, apparatus smoke)

Launch the product in dev mode with a minted key (port 8231 must be free; the harness serves
`pages/` there itself and stops it on exit):

```
GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation
# copy adminKey from the AUTOMATION_DEV_MINT line, then:
GOLDFINCH_MCP_ADMIN_KEY=<adminKey> node tests/behavior/fixtures/page-containment-probe/product-harness.mjs
```

Prints `PRODUCT {json}` lines: `Q1b`, `Q1b.iconLiveness`, `Q1b.afterMainToGuestMessage`, `Q4.direct`,
`Q4.redirect`, `Q4.openTab`, `Smoke`. Quit the app afterwards.

The page-side scripts (`pages/q1-instrument.js`, `q2-wrappers.js`, `q3-tamper.js`) only count and
record shapes; none of them uses anything it observes.
