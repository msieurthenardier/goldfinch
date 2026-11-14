# Leg: downloads

**Status**: completed
**Flight**: [Page Containment](../flight.md)

## Objective

Fix the three real download defects and nothing more: a page-suggested file name can no longer carry control or bidirectional characters that disguise it; a re-download goes through the jar the download came from; and the downloads page cannot open a download that has not finished.

## Context

- **Scope ruling (operator, 2026-11-14)**: this leg is deliberately slim. DD9 as written also called for a closed list of executable-class file types, an in-app confirmation before opening one, and forcing Chromium's extension over a page-suggested name. Those are **not built**:
  - **Confirmation before running a download is left to the operating system** (SmartScreen and the open-file warning on Windows, Gatekeeper on macOS), which act on the internet-origin mark Chromium writes on downloaded files. Whether this build's downloads carry that mark could not be checked from the Linux development host; checking it on Windows and macOS is an item for the HAT leg, and writing the mark becomes the fix if it is missing. On Linux a downloaded file is not executable.
  - **Forcing the extension buys nothing**: the server already controls the name Chromium derives, so overriding the page's suggestion takes nothing away from a hostile site.
  - **An ellipsis hiding a long name's extension** in the popup is a display matter the OS prompt covers at open time; it becomes a squawk.
  - Mission success criteria are reworded to match (see Outputs).
- **Mission findings**: 6 (the sanitiser part) and 10 (Retry through the wrong session). [`guard-audit.md`](../guard-audit.md) 6b, 6c.
- **Measured at design review** (standalone probes on the project's Electron, 2026-11-14): Chromium replaces control and bidirectional characters with `_` in the name **it** derives, so the only way such characters reach a saved name is the page-suggested name from the media panel or save-image; `Session.downloadURL` exists, sends that session's cookies, and reports no webContents on the download event; a burner partition with nothing open resolves to a fresh empty session; a response cut short is retried by Chromium itself several times and then rests at `interrupted` without ever finishing.
- **What is true today**:
  - `sanitizeFilename` (`src/main/download-path.js`) does not remove control or format characters; it tests reserved device names after `path.extname`, so `CON.tar.gz` and `con .txt` pass; it cuts at 180 characters and can cut the extension off.
  - Download records (`downloads-payload.js` `buildRegisterRecord`, `downloads-manager.js`, `downloads-store.js` `validateRecord`) carry no session or jar. Retry (`internal-downloads-action` → `retry` in `src/main/register-download-ipc.js`) calls `downloadURL` on the last-focused window's chrome view — the browser's own session — and answers success even when it did nothing.
  - The downloads page's open action calls `shell.openPath` for any known record with a path, finished or not; the chrome's open channel requires completion.
- **Not in this leg**: file-type classification, any confirmation, extension forcing, name display changes, the media-download URL check and pending-record keying (done in leg `jar-isolation`).

## Inputs

- Branch `flight/01-page-containment` with legs 2–6 landed (uncommitted).
- `src/main/register-download-ipc.js` (`wireDownloadHandler`, `uniquePath`, `internal-downloads-action`, `internal-downloads-list`, the two `shell.openPath` sites), `src/main/download-path.js`, `src/main/downloads-payload.js`, `src/main/downloads-manager.js`, `src/main/downloads-store.js`, `src/main/session-runtime.js` (`partitionFromStoragePath`), `src/main/register-tab-ipc.js` (`tab-create`), the window registry's records and the popup registry, the jars list, `src/shared/burner.js`.
- `src/renderer/pages/downloads.js` (a classic script; `RETRY_STATES`, `runAction`).

## Outputs

- A hardened `sanitizeFilename`.
- Download records carrying their partition; Retry through the owning jar, refused with a reason when that is impossible.
- One completion-checked open path.
- `tests/behavior/download-true-type.md` (authored with this leg) and its fixture.
- Mission success criteria reworded; squawk candidates recorded.

## Acceptance Criteria

### Sanitiser

- [ ] `sanitizeFilename` replaces with `_` (as Chromium does for its own names) every control character, Unicode format character (the bidirectional overrides, isolates and marks, zero-width characters, the byte-order mark, soft hyphen), line and paragraph separator, and lone surrogate. This runs **first**, so a reserved name hidden behind a zero-width character is still caught. Losing zero-width joiners in a file name (some emoji sequences and some Persian and Indic spellings render differently) is accepted and stated.
- [ ] Reserved device names are tested against the **trimmed first dot-segment**, case-insensitively: `CON.tar.gz`, `con .txt` and `C` + zero-width space + `ON` are caught.
- [ ] Truncation keeps the final extension: an extension is a final dot followed by one to sixteen letters or digits; the stem is cut, the extension kept, and the limit is measured in bytes so a long non-Latin name cannot exceed the file system's limit. A surrogate pair is never split.
- [ ] Never returns an empty name, a name of only dots or spaces, or a name ending in a dot or space; existing behaviour for separators, leading dots and the `download` fallback is unchanged.
- [ ] Unit table: every existing case still passes, with the 180-character case renamed to the extension-preserving rule rather than deleted; each bidi and zero-width character; the three reserved-name forms; a 300-character name ending `.exe`; a long name of multi-byte characters; multi-dot names through `uniquePath`.

### Records carry their jar

- [ ] Every new download record carries `partition` (a string, or absent when unknown), taken from the session the download handler is wired to: a weak map from session to partition, written at tab creation (needed for burners, whose sessions have no storage path) and by Retry, with a fallback to the existing storage-path derivation for persistent jars. A download in the browser's own session records none.
- [ ] The field is threaded through the register record, the manager's record builders, the store's load validator (which copies an explicit field list) and the typedef together. A record saved before this change loads with no partition. The MCP `downloadsList` output gains this field and nothing else changes.
- [ ] Unit pins: a container jar, the default-flagged jar, a burner tab, a popup window (same session as its opener) each record the right partition; the browser's own session records none; a persisted old record loads.

### Retry

- [ ] Retry re-requests through `session.fromPartition(record.partition)` and never through a chrome view or a last-focused accessor. It is refused, doing nothing and answering a reason code, when: the record has no partition; the partition is a persistent jar that no longer exists; the partition is a burner with no live tab or popup left; or the record's URL is not http(s).
- [ ] The downloads page's list rows carry a main-derived `retryable` boolean and reason code. The page shows Retry only for a retryable row in a retry state, and one plain line saying why otherwise; a refused Retry shows its reason rather than the open-failure text. One pure function maps reason codes to text and is unit-tested. The popup is unchanged.
- [ ] A retried download records the same partition as the original. It takes Chromium's own name and the default folder — the original's suggested name and chosen folder are not carried over; stated in the docs.
- [ ] Unit pins on each refusal, on the session used, on the absence of any chrome-view download call (the now-unused chrome accessor dependency is removed), and on the row projection.

### Opening

- [ ] `shell.openPath` is called from exactly one function in `src/main/**` (source-scan pin with a neuter). It requires a known record, state completed and a recorded path. The chrome's open channel and the downloads page's open action both go through it, so the page gains the completion check. Unit-pinned: the page action on an in-progress and on an interrupted record opens nothing.

### Shared mechanisms (each sharer asserted unaffected)

- [ ] **The download record shape** — sharers: the manager, the store, the progress and done broadcasts, the indicator model, the popup model, the downloads page, `downloadsList`. Assertion: each suite green; the broadcasts, the indicator model and the popup are untouched.
- [ ] **Tab creation** — the weak-map write is one additive statement after the view is built; `register-tab-ipc` and `tab-create-validate` suites green.
- [ ] **The downloads page's bridge actions** keep their allowlist and payload shape apart from the row fields; listener handles are still removed on `pagehide`; the page stays a classic script (no new module or route).
- [ ] Leg `jar-isolation`'s download tests keep their meaning (this leg does not change which name wins).

### Behaviour and regression

- [ ] **Non-vacuity, before any source change**, recorded in the flight log: on the unmodified build (1) a media download with a suggested name containing a right-to-left override saves under a name that still contains it; (2) a Retry of an interrupted download made in a container jar reaches the fixture **without** that jar's cookie. If either does not reproduce, stop and report.
- [ ] `/mission-control:behavior-test download-true-type` passes (run by the Flight Director); `downloads-surface` is re-run by the Developer's scripted pass.
- [ ] Live smoke (dev mode, env-key scripts) exercises every apparatus primitive against the new state, plus an ordinary page-started download and a media-panel download. **The run never opens a downloaded file.** Files the run saves land in the operator's real Downloads folder (dev mode has no separate one): they carry a run-unique prefix and are deleted by name afterwards, and the flight log lists them.
- [ ] `[by-eye]` / HAT, listed by this leg: on Windows and on macOS, a downloaded file carries the internet-origin mark and the system warns before running a downloaded program; the downloads page's Retry and its not-retryable line; opening a finished download from the popup and from the page.
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` clean; `renderer.js` ≤ 1505 lines (no edit expected), evaluate seam 41.

### Docs and artifacts

- [ ] `CLAUDE.md` gains a short downloads paragraph: records carry their partition; Retry uses the owning jar; one completion-checked open function; confirmation before running a download is the operating system's, by decision.
- [ ] The mission's success criteria are reworded where they promised more than this leg builds — the executable-confirmation clause and the always-visible-extension clause — each with a dated note of the operator ruling; the original wording is kept as commentary. DD9 in the flight spec gets a revision note in the same style as DD4's.

## Verification Steps

1. Fixture with an explicit break / heal switch; the two non-vacuity runs.
2. Unit suites with the runner's timeout.
3. Neuters: the control-character replacement removed → table red; Retry pointed back at a chrome view → red; a second `shell.openPath` planted → scan red; the completion check removed → red.
4. Live smoke; Flight Director: `download-true-type`.

## Implementation Guidance

1. Fixture and non-vacuity.
2. Sanitiser and its table.
3. Session-to-partition lookup; the record field through builder, manager, store, typedef.
4. Retry and the row projection; the page's Retry line.
5. The single open function.
6. Smoke; docs; mission and flight wording.

## Edge Cases

- **A burner download after its last tab closed**, **a jar deleted after the download**, **a `blob:` or `data:` record**: not retryable, each with its own reason.
- **An interrupted download never becomes terminal** (Chromium keeps it resumable): the page already offers Retry for that state; after a Retry the original row stays `interrupted` beside the new one. Unchanged, and stated.
- **A retried download in a persistent jar with no open tab**: the session is created by the retry; the retry writes the map entry before requesting, and the storage-path fallback covers it regardless.
- **A name that is only an extension** (`.exe`) loses its leading dot, as today, and saves without an extension.
- **Records from before this change**: no partition, not retryable.
- **Two windows**: Retry no longer depends on which window was focused last.

## Files Affected

`src/main/download-path.js`, `src/main/register-download-ipc.js`, `src/main/downloads-payload.js`, `src/main/downloads-manager.js`, `src/main/downloads-store.js`, `src/main/register-tab-ipc.js` (one statement), `src/main/main.js` (dependency wiring: jars, the session accessor, the registries), a small pure module for retry reasons, `src/renderer/pages/downloads.js`, `src/renderer/renderer-globals.d.ts` if a type is declared there, their unit tests (`download-path`, `register-download-ipc`, `downloads-payload`, `downloads-manager`, `downloads-store`), `tests/behavior/fixtures/download-true-type/serve.mjs` (new; port 8261), `tests/behavior/download-true-type.md`, `CLAUDE.md`, `missions/23-security-review-remediation/mission.md`, the flight spec's DD9 note.

## Citation Audit

Cited by symbol from the 2026-11-14 survey and design review, against the tree with leg `jar-isolation` landed: `download-path.js` — `sanitizeFilename`; `register-download-ipc.js` — `wireDownloadHandler`, `uniquePath`, the `open-downloaded-file` registration, `internal-downloads-action` (its `retry` and `open` branches), `internal-downloads-list`; `downloads-payload.js` — `buildRegisterRecord`; `downloads-store.js` — `validateRecord`; `session-runtime.js` — `partitionFromStoragePath`; `pages/downloads.js` — `RETRY_STATES`, `runAction`. The design review's probe results are in the flight log. This slimmed leg is a strict subset of the reviewed draft with that review's remedies applied; no second review cycle was run.

## Post-Completion Checklist

- [ ] Leg status `landed`; flight log entry under `## Leg Progress` with the non-vacuity results, constants, neuter text, smoke observations, the files created and removed, the by-eye list and any deviation.
- [ ] No commit. Signal `[LAND:leg]`.
