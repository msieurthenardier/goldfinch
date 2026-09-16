# Squawk 0079: Verify the retention-sweep cookie bookkeeping after the partition-path decode fix

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-15
**Completed**: 2026-09-16

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

Added a unit pin (`test/unit/session-runtime.test.js`, "squawk 0079: a
percent-encoded partition directory still resolves its jar, attaching the
cookie listener") that wires the REAL `partitionFromStoragePath`
(`jar-data-helpers.js`) into `createSessionRuntime` instead of the suite's
ad-hoc partition fake, feeds it a `storagePath` ending in
`Partitions/container%3Apersonal`, and a jar list containing
`{ id: 'jar-container', partition: 'persist:container:personal' }`. It
asserts `onSessionCreated` attaches exactly one `cookies.on('changed')`
listener and that an `inserted` cookie event reaches
`cookieSeenStore.insertIfAbsent` keyed on `'jar-container'`. Confirmed the
pin is load-bearing: temporarily reverting the decode step in
`partitionFromStoragePath` (dropping the `decodeURIComponent` call) turns
this new test red (`0 !== 1` on the listener-attach assertion); restored,
it's green again.

Fix verified live: `cookie_seen` row written for jar `personal` (the dev
profile's own container jar, partition `persist:container:personal` — the
exact percent-encoded case in the Report) after loading a fixture page that
sets a cookie in that jar's tab.

## Verification

Live check (2026-09-16, dev profile `~/.config/goldfinch-dev`):

1. Confirmed nothing was bound to `:49707` (`ss -ltn`), then launched
   `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run
   dev:automation` in the background, capturing the printed
   `AUTOMATION_DEV_MINT` line's `adminKey` into a chmod-600 scratch file via
   a script (never echoed to a terminal/transcript).
2. Read the dev profile's `jars` document from `app.db`: the `personal` jar
   (`defaultId`) has `partition: "persist:container:personal"` — a
   container jar, on-disk directory `Partitions/container%3Apersonal`
   (percent-encoded, per the Report).
3. Served a tiny Node HTTP fixture on `127.0.0.2:<port>` (mirrored
   networking) responding `Set-Cookie: sq79=1; Path=/`.
4. Via `scripts/lib/mcp-client.mjs`'s `connectAutomation`/`callTool` (admin
   key from the scratch file, never a session-registered `mcp__goldfinch*`
   tool): `openTab({ url: 'http://127.0.0.2:<port>/', jarId: 'personal' })`
   — `enumerateTabs` confirmed the new tab loaded (`loadState: "ok"`) in
   `jarId: "personal"`.
5. Queried `app.db`'s `cookie_seen` table read-only (`node:sqlite`
   `DatabaseSync`) for `name = 'sq79'`:

   ```json
   [
     {
       "jar_id": "personal",
       "name": "sq79",
       "domain": "127.0.0.2",
       "path": "/",
       "first_seen_ms": 1789587147010
     }
   ]
   ```

   `first_seen_ms` landed ~11s before the query (`Date.now()` at query time
   was `1789587158351`) — a fresh insert, not a cold-start "stamp at next
   sweep" backfill (there was no pre-existing row to backfill; the
   bookkeeping attach itself is what's under test here).
6. `app.log` contained zero occurrences of
   `[retention-sweep] cookies-listener attach failed` for the whole run.
7. Teardown: killed the app by the pid holding `:49707`
   (`ss -ltnp` → `electron`, confirmed the port closed and the process
   gone), killed the fixture server by its pid (confirmed `127.0.0.2`'s
   port closed), deleted the admin-key scratch file.

The sweep's cookie-class run at a shortened retention window was NOT
separately live-verified in this pass (out of this squawk's scope as
scoped by the assigning ticket) — `retention-sweep.js`'s cookie-aging logic
is unit-covered independently and is unaffected by this fix; this pass's
scope was the bookkeeping ATTACH + row-write path only.

`npm test -- --test-timeout=60000`: 4784/4784 pass. `npm run lint`: clean.
`npm run typecheck`: clean. `npm run format` + `format:check`: clean (no
drift).

## Sign-Off

**Reviewer**: Reviewer agent (Sonnet), batch review of squawks 0078–0081, 2026-09-16
**Verdict**: confirmed — corrective action correct, complete, confined to the reported surface; 4784/4784, lint/typecheck/format clean
**Commit**: `squawk: turnaround 2026-09-16` on `squawk/turnaround-2026-09-16`
