# Squawk 0079: Verify the retention-sweep cookie bookkeeping after the partition-path decode fix

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-15
**Completed**: —

## Report

Mission 20 Flight 2 leg 4 found that `jar-data-helpers.js`'s
`partitionFromStoragePath` never percent-decoded the recovered directory
segment: Electron writes a jar's partition directory as
`Partitions/container%3Apersonal`, so the reconstructed string
`persist:container%3Apersonal` never equalled any jar's literal
`partition`. The leg fixed the helper (decode + two unit pins) because
`tab-certificate-get` depended on it. The SAME helper feeds the Mission 10
retention-sweep cookie-bookkeeping attach in `session-runtime.js`'s
`onSessionCreated` (`jars.list().find((jar) => jar.partition ===
partition)`) — which therefore never matched for container jars before the
fix, i.e. the `cookies.on('changed')` listener was never attached for them
and `cookie_seen` rows were never written. The fix is in the flight branch;
its EFFECT on the sweep has not been live-verified.

## Evidence

- `src/main/jar-data-helpers.js` `partitionFromStoragePath` (decode added,
  M20 F2 leg 4; `test/unit/jar-data-helpers.test.js` +2).
- `src/main/session-runtime.js` `onSessionCreated` — the jar lookup keyed on
  the helper's output; the M10 `cookie_seen` bookkeeping behind it.
- Flight log: `missions/20-no-silent-failures/flights/02-tls-trust/flight-log.md`
  (Leg 4 Anomalies).

## Corrective Action

_(written at completion)_ Live-verify on a container jar: set a cookie on a
fixture page, confirm a `cookie_seen` row appears (`app.db`), and that the
sweep's cookie class runs at a 1-day retention; add a unit pin that
`onSessionCreated` attaches the listener for a percent-encoded storage path.
If the bookkeeping was indeed dead for container jars, note the cold-start
"stamp at next sweep" fallback already covers pre-existing cookies.

## Verification

The live check above plus the new unit pin; `npm test` green.

## Sign-Off

_(written at completion)_
