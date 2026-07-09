# Leg: verify-integration

**Status**: completed
**Flight**: [Jar Lifecycle Model](../flight.md)

## Objective

Prove the flight against the real app (flight CP4): run the migration matrix on
scratch and real profiles through actual boots, verify dev auto-mint on both sides
of the interim gap, bring the docs and stale comments in line with the v2 model, and
leave the full gates green — the flight's last autonomous leg before review+commit.

## Context

- Legs 1–3 landed: v2 store + three-shape migration + IPC surface, 1131/1131 green,
  all uncommitted on `flight/01-jar-lifecycle-model`.
- **Scratch-profile mechanics**: on Linux, Electron resolves `userData` under
  `$XDG_CONFIG_HOME` (default `~/.config`); unpackaged runs then redirect to
  `<userData>-dev` (`src/shared/dev-profile.js:devUserDataPath` — appends `-dev` to
  the final segment). So `XDG_CONFIG_HOME=<scratch> npm start` gives a fully
  isolated profile at `<scratch>/goldfinch-dev/` — fresh, legacy-shaped, or
  pre-seeded at will. The real dev profile lives at `~/.config/goldfinch-dev/`
  (currently a 12-jar v1 bare-array `containers.json`).
- **Auto-mint gates** (main.js:2503-2516 region): the dev auto-mint fires only under
  `--automation-dev` (`npm run dev:automation`) AND `GOLDFINCH_AUTOMATION_DEV_MINT=1`,
  and mints for the literal jar id `default`. Its comment block still claims
  `'default'` is "always present in jars.list()" — **now false on fresh installs**
  (fresh seed is Personal+Work). The flight accepts this interim gap (Adaptation
  Criteria: Flight 2 retires the hardcode); this leg VERIFIES the failure is the
  graceful documented path and corrects the stale comment.
- **Stale docs**: README.md:88-94 says "Four built-in isolated containers —
  Default, Personal, Work, and Banking" — wrong for fresh installs post-flight.
  README.md:213 describes jars.js as "CRUD for user-created jars" — now a full
  lifecycle model. CLAUDE.md:31 lists `containers.json` among persisted state
  (worth a v2-envelope mention). CLAUDE.md's architecture line for jars.js
  ("container definitions") stays accurate.
- **Carried cleanup** (Leg 1 flight-log note): `test/unit/safe-color.test.js:10`
  still requires the now-inert electron-stub before requiring jars — drop it.
- **Operational care**: running the migrated build against the REAL dev profile
  rewrites its `containers.json` to v2. That is the shipping behavior and is
  correct — but until this flight merges, a `main`-branch launch would see a v2
  envelope, fail its v1 validation, and fall back to the old four DEFAULTS in the
  picker (data dirs untouched, registry only). Back up the v1 file first and note
  the restoration path in the flight log.

## Inputs

- Legs 1–3 landed (uncommitted); gates green at 1131/1131.
- WSLg GUI available (mission Environment Requirements); real dev profile present
  at `~/.config/goldfinch-dev/` with a v1 12-jar `containers.json` (verified at
  flight design).

## Outputs

- Verification evidence appended to `../flight-log.md` (a "Leg 4 verification
  matrix" subsection: per-scenario outcome + sanitized file excerpts — use `~` or
  `<scratch>` placeholders, NEVER absolute home paths).
- `README.md` + `CLAUDE.md` updated for the v2 jar model.
- main.js auto-mint comment block corrected.
- `test/unit/safe-color.test.js` stub require dropped.
- `~/.config/goldfinch-dev/containers.json.v1.bak` (local only — gitignored
  territory, it lives outside the repo).

## Acceptance Criteria

- [x] **Step 0 — backup + isolation probe FIRST**: before ANY boot,
      `cp ~/.config/goldfinch-dev/containers.json{,.v1.bak}`. After scenario A's
      first scratch boot, assert BOTH that `<scratchA>/goldfinch-dev/
      containers.json` exists AND that the real `~/.config/goldfinch-dev/
      containers.json` is unchanged (`cmp` against the backup) — this empirically
      confirms the XDG_CONFIG_HOME isolation premise (it has no repo precedent;
      if it fails, the scratch boots would silently hit the real profile) before
      any further scenario relies on it. If the isolation probe fails, STOP the
      matrix: restore from the backup and report `[BLOCKED:xdg-isolation]`.
- [x] **Fresh-profile boot**: with a brand-new `XDG_CONFIG_HOME` scratch, one real
      `npm start` boot (timeout-bounded) produces
      `<scratch>/goldfinch-dev/containers.json` as a v2 envelope with exactly
      `personal` + `work`, `defaultId: 'personal'`; `Partitions/goldfinch` exists
      after the run (proving the pre-warm fired); a SECOND boot leaves the file
      byte-identical (the launch-#2 pin exercised against the real pre-warm, not a
      simulated dir).
- [x] **Legacy-shaped boot** (no file, partition dir): scratch with
      `<scratch>/goldfinch-dev/Partitions/goldfinch` pre-created and no
      `containers.json` → one boot → v2 envelope with exactly the four legacy ids
      (`default`/`personal`/`work`/`banking`), `defaultId: 'default'`.
- [x] **Real dev profile (v1 file) migrates in place**: with the step-0 backup
      already taken, one boot migrates the file to a
      v2 envelope preserving ALL twelve ids (default, personal, work, banking,
      shopping, seed1–seed6, hat-test) with their partitions unchanged and
      `defaultId: 'default'`; the backup and its purpose (pre-merge `main`-branch
      launches would ignore a v2 file) are noted in the flight log.
- [x] **Auto-mint, legacy side**: `GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run
      dev:automation` on the real dev profile prints the minted jar key to stdout
      (the `default` jar survived migration, so the hardcode still resolves).
- [x] **Picker data-path smoke (CP4 "in the real picker" + flight Post-Flight
      "create from picker end-to-end")**: on the real-dev-profile automation run,
      attach via the admin apparatus (launch with `GOLDFINCH_AUTOMATION_ADMIN=1
      GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`, capture the admin
      key, connect over the loopback MCP — the `scripts/a11y-audit.mjs` /
      `scripts/mcp-example-client.mjs` attach pattern) and drive the chrome
      renderer (`getChromeTarget` + `evaluate`):
      - `goldfinch.jarsList()` returns the twelve migrated jars (the exact data
        the picker model is built from — `buildContainerModel` itself is
        unit-pinned);
      - `goldfinch.newContainerCreate('cp4-smoke')` returns the new container, a
        follow-up `jarsList()` includes it, and `containers.json` on disk gains it
        (the picker's own create path, end-to-end through the Leg 3 broadcast
        wiring);
      - `goldfinch.jarsRemove({ id: 'cp4-smoke' })` returns `{ ok: true, … }`, the
        jar disappears from `jarsList()` and from the file (first real-app
        exercise of the new delete composition);
      - if the apparatus cannot attach after two attempts, do NOT silently drop
        the smoke: mark this AC unverified in the flight log with the failure
        detail and say so in the final handoff summary (the Flight Director
        decides the fallback).
- [x] **Auto-mint, fresh side (the interim gap)**: same launch on a fresh scratch
      profile does NOT crash the app — the mint failure takes the documented
      graceful path (`mintJarKey('default', …)` throws the known-jar guard error,
      caught at the auto-mint try/catch, logged as `[mcp] dev auto-mint failed:
      …` on stderr), and the boot demonstrably continues: the MCP bind line still
      appears AFTER the failure line (the surface binds independently of the
      mint). Quote the observed (sanitized) log lines in the flight log.
- [x] **Stale comment corrected**: the main.js auto-mint comment no longer claims
      `'default'` is always present; it now states the fresh-install gap and names
      Flight 2 as the owner of the fix (comment-only change — no behavior change to
      the mint path this flight).
- [x] **Docs updated**: README's container section describes the new-install set
      (Personal as default + Work, plus Burner; existing profiles keep their jars)
      and the jars.js table row reflects the lifecycle model; CLAUDE.md's persisted
      state line notes the v2 `containers.json` envelope;
      `docs/mcp-automation.md:124`'s claim that the `default`-jar key is "always
      present under the double gate" gains the same fresh-install-gap correction
      as the main.js comment (and :60's "the `default` jar is the usual starting
      point" is softened for fresh installs). No other doc claims about jars
      remain contradicted by this flight — grep pass over README/CLAUDE/docs for
      container-set claims AND auto-mint/`default`-jar claims. (The
      `tests/behavior/*.md` specs referencing the mint line run against the
      legacy-shaped dev profile and remain correct — note, don't edit.)
- [x] **Cleanup**: `test/unit/safe-color.test.js` no longer requires the
      electron-stub (and still passes — the identity re-export pin is
      stub-independent since Leg 1).
- [x] **Full gates green**: `npm test` (≥1131 — this leg adds no product code, test
      delta expected 0), `npm run typecheck`, `npm run lint`.
- [x] Flight log carries the complete verification matrix with per-scenario
      PASS/FAIL and evidence excerpts; any defect found during verification is
      fixed, gate-re-run, and logged as a deviation.

## Verification Steps

- Scenario commands (adapt paths; keep runs timeout-bounded with a hard kill
  backstop — `timeout --kill-after=5 25 …` — and run a between-scenario guard,
  `pgrep -f electron` → expect none, so a TERM-ignoring orphan can't pollute the
  next scenario, e.g. by holding the MCP port):
  - fresh: `mkdir -p <scratchA> && XDG_CONFIG_HOME=<scratchA> timeout 25 npm start`
    → inspect `<scratchA>/goldfinch-dev/containers.json`, `ls
    <scratchA>/goldfinch-dev/Partitions/`; repeat the boot; `cmp` the file.
  - legacy: `mkdir -p <scratchB>/goldfinch-dev/Partitions/goldfinch` → boot →
    inspect.
  - real dev: `cp ~/.config/goldfinch-dev/containers.json{,.v1.bak}` → boot →
    `node -e` JSON assertions (version, 12 ids, defaultId).
  - mint fresh: `mkdir -p <scratchC> && XDG_CONFIG_HOME=<scratchC>
    GOLDFINCH_AUTOMATION_DEV_MINT=1 timeout 25 npm run dev:automation 2>&1 | tee
    <scratch log>` → confirm graceful failure line + continued boot output.
- `npm test && npm run typecheck && npm run lint`.
- `grep -rn "electron-stub" test/unit/safe-color.test.js` → no match.

## Implementation Guidance

1. Run the four boot scenarios FIRST (before any doc edits) so a found defect
   doesn't invalidate doc wording. Capture stdout/stderr per run to scratch files;
   quote sanitized excerpts in the flight log (replace the home directory with `~`,
   scratch roots with `<scratch>`).
2. If a boot scenario FAILS its assertion: diagnose against the unit expectations
   (the same matrix passes at unit level — a divergence means an integration-only
   effect, e.g. ordering or a second writer); fix minimally, re-run the full gates
   AND all four scenarios, log the deviation. If the fix would change a flight
   design decision, STOP with `[BLOCKED:...]` instead.
3. The GUI boots open a real window under WSLg; `timeout` SIGTERM is a clean-enough
   exit (all containers.json writes happen synchronously during load, long before).
4. Doc edits: keep README's voice (user-facing, feature-first); mention that jar
   management UI arrives later in the mission (rename/delete/default exist at the
   IPC/model layer only this flight) — do NOT document IPC channels as user
   features. CLAUDE.md: one-line v2 envelope note at the persisted-state line.
5. main.js comment fix: minimal edit inside the auto-mint block (the "always
   present" clause + a pointer to the Flight-2 retirement); do not touch the code.
6. Keep the `.v1.bak` file OUT of the repo (it's under `~/.config`, naturally
   outside) and never echo absolute home paths into committed content.

## Edge Cases

- **WSLg boot flakiness** (window never appears): retry once; if the app logs a
  fatal error unrelated to jars, note it and evaluate whether the scenario's
  assertion is still provable from the written file (usually yes — the store loads
  before any window).
- **`timeout` kills before load completes** (slow first boot compiling caches):
  raise the bound rather than asserting on a half-written profile; the atomic save
  guarantees containers.json is never torn either way.
- **Auto-mint fresh-side produces NO failure line**: `shouldAutoMint` depends only
  on argv + env, so with the flags set the run deterministically enters the try
  and the mint throw is logged — the only realistic no-output cause is a mis-set
  env var. Re-check the launch env before concluding anything about the code
  path.
- **Real dev profile has drifted** since flight design (jar count ≠ 12): assert
  against its actual pre-run v1 content (captured in the backup), not the count
  written in this artifact.
- **Mint side-effect on the real profile**: the legacy-side mint run writes
  `automationKeyHashes` into the real profile's `settings.json` (normal dev
  behavior) — note it in the flight log next to the containers.json backup so the
  profile's full pre/post state is accounted for.
- **`cmp` byte-identity on the second fresh boot** is valid because load path (a)
  never rewrites the file; if a future `load()` change starts normalizing on
  load, this is the assertion that will catch it — a `cmp` failure here means
  investigate load(), not the test.

## Files Affected

- `README.md` — container section + jars.js table row
- `CLAUDE.md` — persisted-state line (v2 envelope)
- `docs/mcp-automation.md` — mint-line "always present" claim + starting-point note
- `src/main/main.js` — auto-mint comment block only
- `test/unit/safe-color.test.js` — drop stub require
- `../flight-log.md` — verification matrix + deviations

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]` (deferred-review
mode: no commit at leg end):**

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry + verification matrix
- [x] Set this leg's status to `landed` (in this file's header)
- [x] Check off this leg in flight.md
- [x] Do NOT set the flight to `landed` and do NOT commit — the Flight Director
      runs the deferred code review, commit, and flight landing after this leg

---

## Citation Audit

Verified at leg design time against the working tree (post-Leg-3, uncommitted):

- `src/shared/dev-profile.js:devUserDataPath` — appends `-dev` to the final
  userData segment — OK (file read this session).
- `src/main/main.js:2503-2516` region (auto-mint block; "always present in
  jars.list()" claim; double gate `--automation-dev` +
  `GOLDFINCH_AUTOMATION_DEV_MINT=1`) — OK (read this session post-Leg-2; Leg 3
  touched only the jar section ~:2316 and new-container-create ~:1878, so drift
  ≤ a few lines — re-locate by the `AUTO-MINT-TO-STDOUT` marker).
- `README.md:88-94` ("Four built-in isolated containers — Default, Personal,
  Work, and Banking"), `README.md:213` (jars.js table row), `CLAUDE.md:31`
  (persisted-state line) — OK (grep-verified this session).
- `test/unit/safe-color.test.js:10` (`require('../helpers/electron-stub')`) — OK
  (grep-verified this session).
- Real dev profile shape (`~/.config/goldfinch-dev/containers.json` = v1 bare
  array, 12 entries; prod profile has no containers.json) — OK (inspected on disk
  this session).
