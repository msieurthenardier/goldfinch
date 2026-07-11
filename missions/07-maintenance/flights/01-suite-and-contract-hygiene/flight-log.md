# Flight Log: Suite & Contract Hygiene

**Flight**: [Suite & Contract Hygiene](flight.md)

## Summary

Landed 2026-07-11, same-day, 2/2 legs, single review cycle each phase.
Leg 1 converted the six real-timer tests in `automation-find.test.js` to
`node:test` MockTimers — suite internal duration 5036ms → 958ms (measured),
zero production change. Leg 2 standardized `{ ok: false, error }` on all 8
failure branches of `handleClearData`/`handleWipe` with branch-discriminable
strings, truth-table-pinned, type surfaces updated. Gates: 1283/1283,
typecheck, lint. Flight review: `[HANDOFF:confirmed]` first pass.

---

## Leg Progress

### Leg 1 — timer-mocks (2026-07-11)

Converted the six real-timer tests in `test/unit/automation-find.test.js`
(cold-start re-issue `:177`, MAX-retry exhaustion `:343`, retry-opts reuse
`:376`, zero-matches `:121`, timeout-fallback ×2 `:213`/`:226`, listener
cleanup after timeout `:263`) to `node:test` MockTimers, per-test
`t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })`, ticking in
single 500ms steps with real-`setImmediate` microtask drains between steps
(per the leg's interleaving-hazard guidance). `src/main/automation/find.js`
untouched — zero production change, as designed.

- **Before**: 1283/1283 green, internal duration 5036.5ms (measured via
  `npm test`'s own duration line)
- **After**: 1283/1283 green, internal duration 958ms (measured twice:
  957.7ms, 958.2ms) — well under the CP1 gate of < 1.5s
- Isolated file run (`node --test test/unit/automation-find.test.js`): 23/23
  green, file duration 5.2s → 49ms
- `npm run typecheck && npm run lint`: both green
- `grep -n "setTimeout(r, 5" test/unit/automation-find.test.js`: no matches
  — no real sleeps ≥500ms remain in the file
- `git diff --stat -- src/ test/`: single file,
  `test/unit/automation-find.test.js` (66 insertions, 42 deletions)
- Every retry-semantics assertion preserved verbatim (re-issue counts, opts
  deep-equality across all issues, resolve-on-nonzero vs timeout-resolves-
  `last`, listener hygiene count 1 during / 0 after) — no coverage thinning
- Leg → `landed`

### Leg 2 — result-contract (2026-07-11)

Standardized `{ ok: false, error }` on every failure branch of
`handleClearData` (5 branches: malformed-payload, unknown-jar,
invalid-classes, unknown-class, session-failure) and `handleWipe` (3
branches: malformed-payload, unknown-jar, session-failure) in
`src/main/jar-ipc.js`, per the leg's error-string table verbatim.
`handleClearData`'s catch clause gained an `e` binding (`catch {` →
`catch (e) {`) to source the `session-failure:` suffix; its stale
"a thrown session call returns { ok: false }" comment updated to match.
`handleWipe`'s header comment already described an error-bearing catch —
verified, no change needed. Truth tables in `test/unit/jar-ipc.test.js`
converted to pin full `{ ok: false, error }` shapes per branch (clear-data
rejection matrix `:462`, partial-unknown `:480`, throwing-session `:487`,
wipe rejection matrix `:518`, wipe-throw `:528`). No renderer change, no
`handleRemove` change, no automation/MCP surface touched (none expose
these two channels).

- **Suite**: 1283/1283 green, internal duration 994.6ms (via `npm test`'s
  own duration line) — under the < 1.5s gate
- **Isolated file run** (`node --test test/unit/jar-ipc.test.js`): 40/40
  green
- `npm run typecheck && npm run lint`: both green, no findings
- `git diff --stat` (leg-2 files only): `src/main/jar-ipc.js` (22
  changed lines), `test/unit/jar-ipc.test.js` (38 changed lines),
  `src/renderer/renderer-globals.d.ts` (4 changed lines),
  `src/preload/internal-preload.js` (2 changed lines) — exactly the four
  files the leg spec named; `src/renderer/pages/jars.js` and
  `handleRemove` confirmed untouched (`git diff` empty / no match)
- **Per-branch error-string pins** (as implemented):
  | Handler | Branch | `error` value |
  |---|---|---|
  | clearData | non-object payload | `jars: clear-data — malformed-payload` |
  | clearData | unknown jar / burner | `jars: clear-data — unknown-jar` |
  | clearData | missing/empty/non-array classes | `jars: clear-data — invalid-classes` |
  | clearData | unknown class id | `jars: clear-data — unknown-class: <classId>` |
  | clearData | session-call catch | `jars: clear-data — session-failure: <e.message>` |
  | wipe | non-object payload | `jars: wipe — malformed-payload` |
  | wipe | unknown jar / burner | `jars: wipe — unknown-jar` |
  | wipe | session-call catch | `jars: wipe — session-failure: <e.message>` |
- Zero-side-effect assertions (no session touched on rejection; no
  broadcast/reroll on wipe throw; strict fail-closed on partial-unknown
  classes) preserved verbatim — no coverage thinning
- Leg → `landed`

---

## Decisions

*(none yet)*

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Session Notes

### Flight Director Notes

**2026-07-11 — flight start.** Phase file `.flightops/agent-crews/leg-execution.md`
validated (Crew / Interaction Protocol / Prompts present). Mission 07
`planning` → `active`; flight `ready` → `in-flight`; branch
`flight/01-suite-and-contract-hygiene` created off `main` at `2bba097`
(clean tree, 1283/1283 green at ~5.0s internal). Two autonomous legs, no
HAT — per skill, single review + commit deferred to end of flight.

**Leg 1 design (timer-mocks).** Key design finding: `find.js` retry logic
uses *global* timers, which `node:test` MockTimers intercepts in-process —
the flight's conditional clock seam is NOT needed; leg is test-only, zero
production change. Design review (Developer, Sonnet, 1 cycle): **approve**,
no blocking issues — reviewer empirically executed the leg's tick/drain
recipes against unmodified `find.js` and confirmed all six conversions
reproduce the assertions; also confirmed per-test mock scope auto-restores
(no cross-test leakage). One low note folded into the leg: MockTimers emits
a benign `ExperimentalWarning` on stderr. Leg → `ready`,
`[HANDOFF:review-needed]` signaled, implementation spawn next.

**Leg 2 design (result-contract).** FD derived the failure-branch inventory
and error-string table from `jar-ipc.js` directly (5 clearData + 3 wipe
branches), confirmed the consumer surface (renderer reads only `ok`; no
automation/MCP exposure of the two channels; internal twins share handler
functions), and identified the DD10(b) type surfaces
(`renderer-globals.d.ts:246-247`, internal-preload `@returns`). Design
review (Developer, Sonnet, 1 cycle): **approve with changes** — 1 medium
(make the `catch {` → `catch (e)` binding explicit in guidance, else the
session-failure suffix is unachievable) + 2 low (stale-premise comment
instruction; `jarsWipe` JSDoc already carries `error?`). All three applied
as guidance-wording fixes; no substantive design change → no second review
cycle (skill 2a.4). Leg → `ready`, `[HANDOFF:review-needed]` signaled.

**End-of-flight review + commit.** Reviewer (Sonnet, fresh context)
independently re-ran all gates (1283/1283 at 951.76ms, typecheck, lint,
both isolated files) and diff-compared every converted assertion against
the originals — none weakened or vacuous; error-string pins verified
against harness behavior (not fabricated). `[HANDOFF:confirmed]` first
pass, zero fix cycles. Phase 3 doc check: CLAUDE.md documents the two
channels' fail-closed semantics but not the failure return shape — no doc
change needed. Legs → `completed`, flight → `landed`, checked off in
mission.md; single flight commit + PR per the deferred-review workflow.
`[COMPLETE:flight]`.
