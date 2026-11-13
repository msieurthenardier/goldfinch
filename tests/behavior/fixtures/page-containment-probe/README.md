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
