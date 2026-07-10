# Leg: verify-integration

**Status**: completed
**Flight**: [Default-Jar Semantics](../flight.md)

## Objective

Prove Legs 1-2 against real app boots: the boot-tab/default-routing matrix on fresh,
migrated, and emptied-registry scratch profiles; the resolved-default auto-mint on all
three; the rewritten privacy-handler contract; then the flight-level grep ACs and full
suite. The `new-tab-default-routing` behavior test is run by the Flight Director after
this leg's matrix passes (it is part of this leg's acceptance).

## Context

- CP3 gate. F1's equivalent leg caught the only real defect of that flight (D1) — real
  boots are the only place lazy-directory/first-boot behavior is visible.
- Isolation technique (proven F1 Leg 4 Step-0): launch with `XDG_CONFIG_HOME` pointed
  at a scratch dir; the dev profile lands at `<scratch>/goldfinch-dev/`. Probe
  isolation BEFORE relying on it (create scratch, boot once, confirm
  `<scratch>/goldfinch-dev/containers.json` exists and the operator's real
  `~/.config/goldfinch-dev` mtime is untouched).
- MCP attach (F1 D2): the configured port is 49707 but the server free-port-falls-back;
  discover the live port (the settings page surfaces it; or probe the configured port
  then scan nearby) rather than assuming.
- Launch recipe: `XDG_CONFIG_HOME=<scratch> GOLDFINCH_AUTOMATION_DEV_MINT=1
  GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation` (admin key needed for
  cross-jar enumeration and the chrome-target apparatus). GUI required (WSLg).
- The AUTOMATION_DEV_MINT stdout line is the mint observable; `[mcp] dev auto-mint
  skipped: default is Burner (no persistent jars)` on stderr is the skip observable.

## Inputs

- Legs 1-2 landed (uncommitted) on `flight/02-default-jar-semantics`; suite 1146.
- Behavior spec `tests/behavior/new-tab-default-routing.md` (draft).
- GUI-capable environment (confirm `$DISPLAY`/WSLg before starting — this is the
  flight prerequisite deferred to Leg 3 start).

## Outputs

- Flight-log Leg Progress entry with the full scenario matrix table (scenario →
  observable → result), plus any deviations/anomalies.
- Behavior-test run log at `tests/behavior/new-tab-default-routing/runs/{ts}.md`
  (written by the /behavior-test skill, FD-invoked; spec flips `draft` → `active`
  on first pass).
- No production-code changes expected; any defect found is fixed in-leg (flight-log
  deviation entry) and re-verified.

## Acceptance Criteria

- [x] **S0 isolation probe**: scratch boot creates `<scratch>/goldfinch-dev/`;
      operator's real profile untouched (mtime compare).
- [x] **S1 fresh profile**: first boot seeds Personal(default)+Work; the boot tab's
      `jarId` is `personal` (via admin `enumerateTabs`); `AUTOMATION_DEV_MINT` prints
      a non-null `key`; `settings.json` `automationKeyHashes` gains `personal` (not
      `default`); byte-identical `containers.json` after a second boot (no re-seed).
- [x] **S2 migrated legacy profile**: scratch profile pre-seeded with a v1 bare-array
      `containers.json` (including a `default` entry) + `Partitions/goldfinch/`
      directory → boot migrates to v2 with `defaultId: "default"`; boot tab `jarId`
      is `default`; auto-mint mints for `default` (resolved default — hash key
      `default` in settings.json).
- [x] **S3 emptied registry**: scratch profile with
      `{"version":2,"defaultId":null,"containers":[]}` → boot tab `jarId` matches
      `^burner-`; stderr carries the exact skip notice; `AUTOMATION_DEV_MINT` prints
      `"key":null` with a non-null `adminKey`; registry file NOT re-seeded.
- [x] **S4 privacy-handler contract** (chrome-target evaluation, any running
      scenario): `privacyClearStorage({ url, webContentsId: <live web tab> })` →
      `{ ok: true, ... }`; with `webContentsId` of the internal `goldfinch://settings`
      tab → failure shape (internal guard); with `webContentsId: 999999` →
      `{ ok: false, error: 'no-tab' }`.
- [x] **S5 live routing smoke** (same session as S1): `openTab` with omitted `jarId`
      → tab lands in `personal`; after chrome-driven `jarsSetDefault({id:'work'})` →
      next omitted-`jarId` tab lands in `work` (pre-verification of the behavior
      test's core rows; the full flow incl. delete-all belongs to the behavior test).
- [x] **Grep ACs** (flight Post-Flight set): `PAGE_PARTITION|DEFAULT_CONTAINER` in
      `src/ test/` → 0; `'default'` in main.js → 0 and in renderer.js → exactly 1
      pre-enumerated non-jar hit (`thumb.style.cursor = 'default'` — a CSS cursor
      value, exempt; design review cycle 1 caught the AC-as-worded false positive);
      `ff8c42` in `src/` → 1 (burner.js); tests/behavior sweep — no literal-default
      mint/fixture assertion (inspect-every-hit; record each hit's disposition in
      the flight log).
- [x] **Auto-mint spec preconditions audit**: `automation-key-gating.md`,
      `mcp-jar-scoping.md`, `mcp-auth-gating.md` (+ `farbling-correctness.md`)
      preconditions are satisfiable under the DD7 behavior as worded post-Leg-2
      (text audit against observed S1/S2 mint behavior; no full reruns).
- [x] **Suite**: `timeout 120 npm test` 1146/1146 (or higher), `npm run typecheck`,
      `npm run lint` — all green; run the suite twice for the flake check. (Landed
      at 1148/1148 twice — 1146 + 2 new regression tests from the D1 fix.)
- [x] **Behavior test**: `/behavior-test new-tab-default-routing` → pass (FD-run,
      after the matrix; leg does not land while it fails). **PASS 7/7**, run log
      `tests/behavior/new-tab-default-routing/runs/2026-07-10-04-43-55.md`; spec
      `draft` → `active`.

## Verification Steps

Each S-criterion above is its own verification procedure; record every observable
(stdout line, enumerateTabs excerpt, file content, grep output) in the flight-log
matrix table. Kill each app instance cleanly (SIGTERM, confirm exit) before the next
scenario; scratch dirs live under the session scratchpad or /tmp, never inside the
repo or the real profile.

## Implementation Guidance

1. **S0**: `mkdir` scratch; snapshot `stat -c %Y ~/.config/goldfinch-dev` (and its
   containers.json hash); boot+quit; assert scratch profile exists + real profile
   unchanged.
2. **S1**: fresh scratch; launch with the recipe; capture stdout/stderr to files;
   attach MCP admin client (discover live port); `enumerateTabs` → single boot tab,
   assert `jarId === 'personal'`; then S5 in the same session; SIGTERM; hash
   containers.json; boot #2; re-hash (byte-identical); inspect
   `<scratch>/goldfinch-dev/settings.json` for the `personal` hash key.
   NOTE (reworded, design review cycle 1 — MEDIUM): both hashes for the byte-compare
   are captured AFTER S5 has already run (hash #1 at SIGTERM after S5, hash #2 after
   boot #2) — never compare a pre-S5 snapshot against a post-S5 one; `setDefault`
   legitimately persists, and that difference is not a re-seed. No explicit wait is
   needed between the chrome-eval `await jarsSetDefault(...)` and the next `openTab`:
   the handler broadcasts `jars-changed` before its invoke resolves and the renderer
   listener applies state synchronously (jar-ipc.js:86-92; the same ordering the
   renderer's own newContainerCreate comment documents).
3. **S2**: fresh scratch; write the v1 fixture (reuse the four-jar shape from
   `test/unit/jars.test.js`'s migration matrix) + `mkdir -p
   <scratch>/goldfinch-dev/Partitions/goldfinch` (profile realism only — the v1
   array branch never consults the probe dir; it matters only for branch (c));
   boot; assert v2 rewrite + `defaultId":"default"`, boot tab `jarId === 'default'`,
   mint hash under `default`.
4. **S3**: fresh scratch; write the empty v2 registry; boot; assert burner boot tab,
   stderr notice (exact string), `"key":null`, file unchanged (no reseed — hash
   before/after).
5. **S4**: from a running scenario, `getChromeTarget` + evaluate in the chrome
   renderer: call `window.goldfinch.privacyClearStorage(...)` for the three cases
   (live web tab wcId from enumerateTabs; the settings tab's wcId; and 999999).
   **Sole documented route for opening the settings tab** (design review cycle 1 —
   HIGH: the automation `openTab` tool cannot create trusted tabs — the hook never
   forwards a `trusted` arg and `isSafeTabUrl` rejects `goldfinch://`): via the
   chrome-target evaluate, call the top-level `window.createTab('goldfinch://settings', null, { trusted: true })`
   directly (renderer.js loads as a classic script, so `createTab` is a `window`
   property), then get its wcId from admin `enumerateTabs` (the admin engine
   enumerates the internal tab). Note: the internal-guard case and the 999999 case
   return the SAME shape, `{ ok: false, error: 'no-tab' }` — the handler's single
   guard covers both; do not expect a distinguishing string.
6. **Greps + suite + spec-precondition audit** per the AC list; suite twice.
7. Append the matrix table + notes to the flight log (append-only), flip this leg to
   `landed`, and report — the FD then runs the behavior test and closes the leg's
   final AC.

## Edge Cases

- **Port collision**: another goldfinch (operator's real session) may hold 49707 —
  ALWAYS discover the live port from the scratch instance (F1 D2/D3 precedent);
  never drive a port you didn't confirm belongs to the scratch instance (the real
  profile must never receive test mutations).
- **Boot-tab timing**: the boot tab is created after the jars snapshot resolves —
  `enumerateTabs` immediately after attach may briefly show zero tabs; poll briefly.
- **S3 stderr buffering**: capture stderr to a file and grep after attach, not from
  a pty scrape.
- **WSLg flakiness**: if the window doesn't map, retry launch once before diagnosing
  (F1 saw none, but the rig note stands).

## Files Affected

- `missions/.../flight-log.md` (matrix entry), leg artifact status
- `tests/behavior/new-tab-default-routing.md` (`Status`/`Last Run` after the FD run)
- `tests/behavior/new-tab-default-routing/runs/` (run log, FD-created)
- No src/ changes expected

---

## Citation Audit

Referenced procedures re-verified this session: launch recipe + XDG isolation and
port-fallback behavior are F1 Leg 4 verified facts (F1 flight log/debrief D2-D3);
v1 fixture shape per `test/unit/jars.test.js` migration matrix (Leg F1-2);
`AUTOMATION_DEV_MINT` line + skip notice per Leg 2's implemented auto-mint block
(landed in working tree); privacy failure shapes per Leg 2's handlers (landed);
`enumerateTabs`/`getChromeTarget`/`openTab` apparatus per docs/mcp-automation.md.
Snippet-anchored (working tree uncommitted); 0 gone, 0 unverifiable.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified except the FD-run behavior test (deferred to
      the Flight Director per the leg spec — this leg's matrix is its precondition)
- [x] Tests passing (suite ×2 + typecheck + lint) — 1148/1148 twice
- [x] Flight log matrix entry appended (incl. D1 deviation)
- [x] Leg status `landed`; did NOT commit (deferred flight-level review/commit)
