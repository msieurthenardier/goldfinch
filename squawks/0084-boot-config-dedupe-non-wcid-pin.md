# Squawk 0084: Unit-pin the boot-config gap-queue dedupe's non-`wcId` branch

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-17
**Completed**: —

## Report

`window-boot-config`'s recovery flush dedupes queued sends last-wins per
`(wcId, channel)` and keys any message WITHOUT a `wcId` under a unique
`__no-wcid-<n>` key so it is never collapsed — but every `recoverTabs` dedupe
test builds `wcId`-bearing payloads, so that branch is unexercised. Add one
test: two queued messages without a `wcId` both survive the flush in order,
interleaved correctly with deduped `wcId` messages.

## Evidence

- `src/main/app-lifecycle.js` — the `window-boot-config` handler's dedupe
  (`__no-wcid-` key); `test/unit/app-lifecycle.test.js` recoverTabs tests
  (~:622–722) — all payloads carry `wcId`.
- Flight 3 debrief, Testing Assessment (Developer interview).

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
