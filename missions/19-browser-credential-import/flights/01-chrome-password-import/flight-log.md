# Flight Log: Chrome Password Import

**Flight**: [Chrome Password Import](flight.md)
**Mission**: [Browser Credential Import](../../mission.md)

Runtime decisions, deviations, and anomalies recorded here during execution.

---

## 2026-09-08 — Planning: design review

- Spec drafted and iterated during planning; the session was interrupted by a
  host restart before the pre-flight checklist was confirmed. Resumed from the
  on-disk spec (complete, 13 DDs).
- Architect design review (Phase 5b): **approve with changes**. Incorporated:
  - `failed` outcome had no producing code path → DD11 now pins it to a
    per-row commit-stage rejection; vault-level write failure is an
    import-level error, not a per-row outcome.
  - DD13 confirm's destination counts had no freshness contract → fresh
    `listItems(target)` read immediately before the native confirm renders;
    the mapping modal's presence snapshot is display-only.
  - DD8 tightened: string `"null"` origin (non-web, e.g. `android://`) vs. JS
    `null` (malformed) are distinct outcomes; outcome line never shows the raw
    `"null"` string.
  - DD12 adds a per-field length cap (single-row exhaustion vector).
  - Citation drift fixed: `restoreProfile` `:2372` (impl `:2398`),
    `_enterGatedOp` `:2862`, restore `finally { fill(0) }` `main.js:1218-1222`.
  - Two stale lines from before DD5/DD13 were revised (Leg 1 approach naming
    the internal-session guard; CP4 "(if any)") corrected.
  - Squawk 0064 orthogonality stated; squawk 0063 closure added to the
    completion checklist; `showMessageBox` has no precedent, test double note
    added to Leg 2.
- Green bar confirmed by the Architect at review time (4294/4294 tests).
- No second review cycle: changes are clarifications and pins, not
  structural.


## 2026-09-09 — Flight start

### Flight Director Notes

- Phase file loaded: `.flightops/agent-crews/leg-execution.md` (Developer /
  Reviewer, Sonnet; structure validated — Crew, Interaction Protocol, Prompts
  present).
- Pre-flight checklist closed (the host-restart interruption from 2026-09-08
  left it unconfirmed): open questions all ruled, 13 DDs recorded,
  prerequisites verified — green bar re-run on this branch at `4265d27`:
  4294/4294 tests, typecheck, lint, format:check all clean. The real Chrome
  export prerequisite is satisfied by its own wording (produced at HAT time);
  the `vault.js` headroom prerequisite is scheduled into Leg 2 per DD10.
- Flight status `planning` → `in-flight`; branch
  `flight/01-chrome-password-import` created from `main`.
- **Leg 1 `ingest-and-commit-core` designed** (artifact at
  `legs/01-ingest-and-commit-core.md`, 23 ACs). Risk-tier call: **HIGH** —
  a new gated op on the vault store (security-sensitive surface; the
  gated-op enumeration test is a shared-interface consumer), a
  security-adjacent hand-rolled parser, and a new zeroizing held-payload
  store. Design review runs before implementation.
- Leg-level rulings the flight left open (recorded in the leg, summarized
  here for the debrief): (1) three sibling CJS modules under
  `src/main/vault/` — the held store is a **sibling module**, not a second
  instance of `createPendingImportStore` (its `['bundle','handle']` shape and
  stash-time timer are pinned; the unchanged factory cannot hold a payload
  or arm at hold); (2) parser resync-at-next-raw-LF on a structural error;
  (3) DD8 refinement — the `blocklist` reason has **no producer** in a Chrome
  export (Chrome exports saved credentials only), so Leg 1 does not emit it;
  reserved for Flight 2; (4) `changed` detection considers every existing
  item sharing an identity, so a re-import after a `changed` landing is a
  `duplicate` against the copy — no unbounded copies; (5) Replace keeps the
  destination's existing vault key; (6) the row cap refuses the whole file
  (`too-many-rows`), matching the byte cap's shape; (7) the gated-op count
  in `vault-rekey-gate.test.js` goes eleven → twelve in this leg.
- CP4's automation-boundary pins are split: the Leg 1 half is structural
  (no import-named MCP tool, zero automation-module references, payload
  read-site scan); Leg 2 carries the IPC-layer half and the DD13 native
  confirm.

- **Leg 1 design review (Developer, Sonnet): approve with changes.** All
  leg-owned citations verified exact by the reviewer. Incorporated: (high)
  AC10's `writeFileAtomic` spy could never observe anything — it is a
  destructured CJS import at `vault-store.js:40`; AC10 now mandates an
  instance-method monkeypatch plus an on-disk bytes-changed second signal;
  (high) `MAX_IMPORT_ITEMS` re-exported FROM the store into the adapter was
  a circular-require hazard binding `undefined` silently — ownership flipped
  to the leaf `browser-import.js`, the store's `:521` definition deleted and
  the constant re-exported, pinned by a require-order test (AC15b);
  (medium) `totp` is deliberately excluded from the DD3 secret comparison
  (a Chrome row never carries one; comparing it would copy every
  since-2FA'd login on each re-import) — stated in ruling 6, pinned in AC7;
  (medium) ruling 7's "parity with restore's Replace" was wrong — restore
  swaps to the bundle's fresh key and evicts the cache (`:2508-2521`); the
  CSV import keeps the destination key by necessity, now stated as a
  divergence; (medium) the rekey-gate count pin has FOUR sites, not three
  (`:6` header history added); (low) `MAX_PAYLOAD_BYTES` single-sourced from
  `browser-import.js`; (low) `failed` is documented as defense-in-depth
  scaffolding (no real row reaches it under this design); (low) the
  candidates shape check runs before `_requireMrk`. Reviewer questions
  answered: AC10 keeps both signals; the DD8 `blocklist` refinement lives in
  this log (flight.md is a frozen charter once in-flight — methodology's
  "preserve the original framing, record the pivot in the log"); the store's
  `MAX_IMPORT_ITEMS` definition is deleted, not duplicated.
- No second review cycle: every change is a clarification or a pin, not
  structural (the M19 planning-review precedent). Leg 1 → `ready`.
  Committing the planning artifacts as the branch baseline, then spawning
  the implementing Developer.

## Leg Progress

### ingest-and-commit-core

**Status**: landed
**Started**: 2026-09-09
**Completed**: 2026-09-09

#### Changes Made

- **New** `src/main/vault/csv-parse.js` — the RFC-4180 parser (`parseCsv`),
  a single-pass character state machine (`start` / `unquoted` / `quoted` /
  `quote-seen`). BOM-stripped, CRLF/LF (and, as a documented lenient
  superset, a bare CR) all terminate a record; structural errors
  (unescaped quote in an unquoted field, a closing quote followed by a
  non-delimiter, an unterminated quote at EOF) mark the record `malformed`
  and resync at the next raw `\n` regardless of quote state, per ruling 2.
- **New** `src/main/vault/browser-import.js` — `detectChromeExport`,
  `originOfDiscriminated`, `adaptChromeRows`, `canonicalOrigin`,
  `planLogins`, `summarizeOutcomes`, `BrowserImportFormatError`, and the
  three constants `MAX_FIELD_CHARS` (16384), `MAX_IMPORT_ITEMS` (10000,
  the SOLE definition per ruling 5), `MAX_PAYLOAD_BYTES` (16 MiB, the SOLE
  definition). Never requires `vault-store.js` (the cycle-free direction).
- **New** `src/main/vault/pending-browser-imports.js` — the DD6 held-payload
  store, `createPendingBrowserImportStore(deps)`, a sibling module to
  `pending-imports.js` per ruling 1: `hold`/`peekSummary`/`take` (handle-
  guarded)/`clear`/`chromeIds`/`dropAll`, `HOLD_DROP_MS` (5 min). The timer
  arms AT `hold` (not at a later secret step — there is none for a browser
  import). `drop` zeroizes the payload inline (no separate `zeroize`
  helper — see Deviations) so `payload` is read back only inside `take`
  and `drop`, per ruling 9(c).
- **Modified** `src/main/vault/vault-store.js`: added the top-of-file
  `require('./browser-import')` for `{ MAX_IMPORT_ITEMS, planLogins }`;
  deleted the local `MAX_IMPORT_ITEMS = 10000` definition (`validateImportedItems`
  now uses the imported name); added `importLogins`/`_importLogins`
  (the twelfth gated op) between `saveItem`/`_saveItem` and `listItems`,
  following ruling 7's body order (shape check → `_requireMrk` →
  `_resolveTarget` → `_touch` → read → lazy-or-decrypt → mode check →
  per-candidate plan/commit → single write); re-exported `MAX_IMPORT_ITEMS`
  from `module.exports`.
- **Modified** `test/unit/vault-rekey-gate.test.js`: eleven → twelve gated
  ops at all four sites (header history `:3-14`, the entry-wall section
  comment, the test name, and the by-name enumeration — added an
  `importLogins` throw assertion plus a `loginCandidate()` fixture helper).
- **New tests**: `test/unit/csv-parse.test.js` (18 tests),
  `test/unit/browser-import-adapter.test.js` (16 tests),
  `test/unit/vault-import-logins.test.js` (20 tests),
  `test/unit/pending-browser-imports.test.js` (19 tests),
  `test/unit/browser-import-boundary.test.js` (5 tests). 78 new tests total.

#### Verification

- **AC1–AC3** (parser + header gate): `node --test --test-timeout=20000
  test/unit/csv-parse.test.js test/unit/browser-import-adapter.test.js` —
  18 + 16 pass.
- **AC4–AC8, AC16** (adapter taxonomy, dedupe trichotomy + intra-file
  duplicates, outcome summary): `node --test
  test/unit/browser-import-adapter.test.js` — 16/16 pass (pure, no temp
  dirs).
- **AC9–AC15, AC15b, AC17** (store op: lazy creation, exactly-one-write,
  double-import idempotence, `changed` copy, Replace/Merge, per-row
  `failed` + write-sink-throw propagation, gating/lock refusals, the
  `MAX_IMPORT_ITEMS`/`MAX_PAYLOAD_BYTES` single-literal ownership +
  require-order pin, the no-plaintext byte-scan): `node --test
  --test-timeout=60000 test/unit/vault-import-logins.test.js
  test/unit/vault-rekey-gate.test.js` — 20 + 6 pass.
- **AC18–AC20** (held store: refusal/timer-at-hold/re-hold/window
  isolation, zeroize-on-every-exit-except-take, handle-guarded take,
  payload-free `peekSummary`): `node --test
  test/unit/pending-browser-imports.test.js` — 19/19 pass (MockTimers-style
  fake timer pair per test body, per the CLAUDE.md recipe).
- **AC21** (automation boundary — no tool name, zero automation-module
  references, payload read-site source-scan): `node --test
  test/unit/browser-import-boundary.test.js
  test/unit/automation-mcp-server.test.js` — 5 + 87 pass (92 total, no
  regression in the existing MCP-server suite).
- **AC22** (whole-leg green bar): `npm test` → 4372/4372 pass (4294 baseline
  + 78 new); `npm run typecheck` clean; `npm run lint` clean; `npm run
  format` (Prettier reformatted `vault-store.js` and four of the new test
  files — no logic change) then `npm run format:check` clean. Every
  pre-existing suite stayed green; the only pre-existing test file touched
  is `vault-rekey-gate.test.js`, per charter.
- **AC23**: this entry.

#### Decisions

- **DD8 `blocklist` refinement carried through unchanged**: as recorded at
  design time, a Chrome export never emits a never-save/blocklist row, so
  `adaptChromeRows` has no `blocklist` reason producer this leg — pinned
  implicitly by AC4's fixture (every row class it enumerates is accounted
  for; `blocklist` is not one of them).
- **`pending-browser-imports.js`'s `drop` inlines its zeroize step** rather
  than factoring it into a separate `zeroize(rec)` helper (the
  `pending-imports.js` shape). Ruling 9(c) requires `payload` to be "read
  back only inside `take` and `drop` (never in `peekSummary`)" — a separate
  helper called only from `drop` would still satisfy the *security* intent
  but not the *literal* grep-AC, so `drop` does the `rec.payload.fill(0)`
  itself. `browser-import-boundary.test.js`'s AC21(c) test pins this by
  extracting each function's body text and asserting every `.payload`
  occurrence in the file falls inside `take`'s or `drop`'s extracted range.

#### Deviations

- **AC21(a)'s literal regex `/import|csv|chrome|browser/i` matches a
  pre-existing, unrelated tool name**: `getChromeTarget` (an admin
  chrome/app-level tool, `CLAUDE.md`'s Automation engine section) trips
  `/chrome/i` on its own name, independent of this leg. The boundary test
  excludes it BY NAME (not by loosening the pattern), so a future tool
  actually named e.g. `chromeImport` or `browserImport` still fails the
  check. Recorded here since the leg text's regex, taken completely
  literally against current tool names, would have produced a false
  failure — verifying leg accuracy against existing code (per
  FLIGHT_OPERATIONS.md's pre-implementation step) surfaced this before
  writing the test.
- **AC9's "uncreated global vault" scenario is not reachable through the
  app's own API**: `setup()` unconditionally writes an (empty) global
  `.gfvault` as part of first-run setup, and `deleteVault`/`_deleteVault`
  explicitly refuses `GLOBAL_ID`. The test therefore `fs.unlinkSync`s the
  global vault file directly (a white-box exercise of the lazy-branch code
  path importLogins shares with saveItem's lazy branch) rather than
  claiming this state is otherwise reachable in production. The genuinely
  reachable lazy-branch case (a freshly created persistent jar that has
  never held an item) is covered by the same test's `work` jar half without
  this caveat.
- **AC10's "second signal" implemented as byte-content comparison only,
  not mtime**: the leg text offers "mtime/bytes" as alternatives for the
  second one-write signal. An mtime-based assertion
  (`fs.statSync(...).mtimeNs` before vs. after) proved flaky in this
  environment — a fast single write can land within the same filesystem
  mtime tick, making `notEqual(afterMtimeNs, beforeMtimeNs)` fail even
  though exactly one write occurred (confirmed by both the instance-method
  call counter and the changed file bytes). The test uses the byte-content
  comparison alone as the second signal; the instance-method call-count
  assertion remains the primary, authoritative signal per AC10's own
  wording ("the sole valid technique").

#### Anomalies

- None blocking. One authoring slip caught and fixed during development: an
  early draft of `browser-import.js` was written with a literal NUL byte
  (`\x00`) embedded in `identityKey`'s template-literal separator instead
  of the intended two-character escape sequence — a Write-tool transcription
  artifact, not a design decision. Caught immediately via `file`/`grep`
  reporting the module as binary; fixed by replacing the byte with a plain
  space separator (safe: neither an origin string nor a username can
  contain the space-joined ambiguity that would matter here, since origins
  never contain spaces). Confirmed clean (`file` reports UTF-8 text,
  `node --check` passes) before any test ran against it.

#### Flight-end review fixes

- **Blocking #1 (intra-file dedupe bypass) fixed.** `_importLogins`
  (`src/main/vault/vault-store.js`) had a `skipDedupe` shortcut that
  stamped every candidate `'new'` for a lazy/empty/`replace` destination,
  bypassing `planLogins` entirely — a same-identity pair in ONE candidate
  batch both landed instead of the second being classified
  `duplicate`/`changed` against the first, breaking Leg 1 ruling 6's
  unconditional intra-file dedupe. Fixed by always routing through
  `planLogins(candidates, mode === 'replace' ? [] : destItems)` and
  deleting the `skipDedupe` bypass — `planLogins(candidates, [])` already
  handled the empty-destination case correctly (it dedupes purely against
  candidates joining its own identity map), so `replace` now plans against
  `[]` and lazy/empty destinations plan against their already-empty
  `destItems` with no special-casing.
- **New tests** in `test/unit/vault-import-logins.test.js` (+3, one per
  scenario in the Reviewer's finding): `Blocking #1a` (first import into an
  UNCREATED jar vault, an intra-file duplicate pair with identical
  secrets → one item lands, `imported` + `duplicate`, one write);
  `Blocking #1b` (same, differing password → `imported` + `changed`, two
  items, the second titled `… (imported)`); `Blocking #1c` (`mode:
  'replace'` into a populated destination with an intra-file duplicate
  pair → the destination's old item is gone, exactly one new item for the
  duplicated identity, `imported` + `duplicate`, one write). The existing
  AC10 "exactly one write" pins and `written: false` semantics were
  re-verified unaffected by the same run.
- **Non-blocking #2 (literal NUL byte in this flight log) fixed.** The
  Anomalies note above, around the earlier authoring-slip description, had
  a raw `0x00` byte embedded in the prose (the very artifact the note
  describes, re-introduced by the same class of transcription slip) —
  `file` reported the log as `data` instead of text. Replaced the raw byte
  with the four printable characters `\x00`. Verified `grep -c -P '\x00'
  missions/19-browser-credential-import/flights/01-chrome-password-import/flight-log.md`
  → 0 and `file` on the same path → `Unicode text, UTF-8 text`.
- **Non-blocking #3 accepted as-is** per the Reviewer's own note — squawk
  0063's pre-filled sign-off stays hedged pending Reviewer sign-off; the
  Flight Director finalizes it at commit.
- **Verification**: `node --test --test-timeout=60000
  test/unit/vault-import-logins.test.js` → 23/23 pass (20 prior + 3 new).
  Full green bar: `npm test` → 4424/4424 pass (4421 prior + 3 new);
  `npm run typecheck` clean; `npm run lint` clean; `npm run format` (no
  changes beyond the two files edited for this fix pass) then `npm run
  format:check` clean.

## 2026-09-09 — Leg 2 design

### Flight Director Notes

- Leg 1 landed (Developer report + independent re-run: 4372/4372 tests,
  typecheck/lint/format clean). `legs_completed = 1`. Developer deviations
  accepted as logged in its entry (inlined zeroize in `drop`; the
  `getChromeTarget` exclusion in the tool-name scan; unlinking the global
  `.gfvault` to reach the lazy-create branch; byte-content rather than
  mtime as AC10's second signal).
- **Leg 2 `import-ui-and-vault-page-decomposition` designed** (artifact at
  `legs/02-import-ui-and-vault-page-decomposition.md`, 18 ACs). Risk-tier
  call: **HIGH** — four new `registerInternalHandler` channels on the vault
  trust boundary, a one-entry widening of the internal-page module
  allowlist (`internal-page-map.js`, squawk 0063's own Note demands a
  review), and the DD13 native-confirm gate that carries the SC's
  "never machine-driven at any tier" guarantee. Design review runs first.
- Leg-level rulings the flight left open: (1) the main-side flow is a NEW
  Electron-free module (`browser-import-flow.js`, injected `dialog`/`fs`)
  so the DD13 confirm ordering and the lock-during-confirm drop are proven
  under `node --test`, not asserted by grep — `main.js` stays composition
  only; (2) `VaultLockedError` is absent from the error mapper's class
  ladder, so the flow pre-checks `isUnlocked()` and returns `'locked'`
  rather than widening the ladder; (3) a declined native confirm keeps the
  record held (retry with another destination; the DD6 timer still bounds
  it); (4) the page ALWAYS sends `mode` (default `'merge'`) so a destination
  populated after the display snapshot merges safely; (5) the NEW page UI
  is its own controller module (`vault-browser-import-controller.js`, the
  `vault-nav-controller.js` precedent) — the restore modals are NOT moved
  (their source-scan pins read `vault.js` by name, and moving HAT-tuned
  code to satisfy a budget is the divert criterion's "open-ended
  re-architecture"); DD10 is satisfied by building the new surface outside
  `vault.js` from day one plus pure display helpers in
  `vault-page-model.js`; (6) squawk 0063 lands as this leg's first step,
  closed at the flight commit with the flight-end Reviewer as sign-off;
  (7) no resume-after-lock: lock drops the record (unlike restore's
  secret-less resume), but a forced modal close from any other broadcast
  keeps the restore-style "Resume browser import…" affordance.
- This is the last autonomous leg; the flight-end Reviewer + single commit
  follow it. Leg 3 (guided HAT) is operator-driven.

- **Leg 2 design review (Developer, Sonnet): approve with changes.**
  Incorporated: (high) the landed `BrowserImportFormatError` exposes
  `.reason`, not `.code` — ruling 1 corrected; (high) squawk 0063's rename
  breaks `vault-restore-workflow-invariants.test.js`'s swatch-prefill regex
  (three literal `JAR_COLOR_PALETTE` matches) and leaves the identifier in
  `buildColorSwatchGrid`'s docstring — both collateral edits added to ruling
  7 / AC13 / Outputs; (medium) `vault.js` is AT the 2820 budget under the
  seam metric (`split` count, not `wc -l`) — ruling 8 recomputed to a hard
  ≤ 18-line wiring allowance with a measure-after-each-step command and a
  soft ≤ 2815 target so 0063's headroom intent partly survives; (medium)
  `windowForChrome` had no accessor to cite — pinned as
  `registry.getWindowForChrome(webContents.fromId(chromeId))?.win`; (low)
  the commit reply is aggregate counts only, `results` stays internal
  (AC6 pins the key set); (low) four range drifts + the seam constant line
  repaired. Reviewer questions answered in the leg: one try/catch spans
  steps 3–7 with the zeroize `finally` nested from `take` (a deliberate
  departure from `vaultImportCommit`'s flat shape); the Global destination
  row is special-cased outside `restoreDestinationOptions` from a third
  `globalPresence` argument. Suggestions taken: `loadHeld()` joins
  `refresh()`'s `Promise.all`; the preload bundle is generated by
  `npm run build:preload` (`pretest`/`prestart`), never hand-edited;
  `listJars` injected as its own dep per the main.js idiom.
- No second review cycle (clarifications and pins only). Leg 2 → `ready`;
  spawning the implementing Developer.


## Leg Progress

### import-ui-and-vault-page-decomposition

**Status**: landed
**Started**: 2026-09-09
**Completed**: 2026-09-09

#### Changes Made

- **Squawk 0063 landed first** (headroom prep): `src/main/internal-page-map.js`'s
  vault route gained `'/jar-page-model.js': shared('jar-page-model.js')`;
  `vault.js` now imports `PALETTE` from it (flat specifier + `// @ts-ignore`),
  the local `JAR_COLOR_PALETTE` constant (comment + const, 20 lines) is
  deleted, its one use site (the mapping modal's `buildColorSwatchGrid` call)
  points at `PALETTE`, and `buildColorSwatchGrid`'s docstring no longer names
  the deleted identifier. Squawk file `squawks/0063-jar-color-palette-dedup.md`
  set `completed` with corrective action + verification filled in (landed
  `vault.js` measured 2803 lines — the `seam-contract.test.js` `split`
  metric — after this step alone) and sign-off "flight-end Reviewer; commit:
  flight/01 commit".
- **New** `src/main/vault/browser-import-flow.js` — `createBrowserImportFlow(deps)`
  (Electron-free, injected `{ getStore, pending, dialog, fs, windowForChrome,
  listJars }`) → `{ begin, summary, cancel, commit }`. `begin` runs the native
  open dialog, size-caps + reads the export as a **Buffer** (never `'utf8'`),
  parses once (`parseCsv` → `detectChromeExport` → `adaptChromeRows`) to build
  the non-secret summary, and holds the payload via `pending.hold`. `commit`
  implements the DD13 ordering exactly: validate shape → peek the held record
  (handle match) → `isUnlocked()` pre-check (`'locked'`, no dialog) →
  `resolveTarget` (`'state'`, no dialog) → a FRESH `listItems(target).length`
  read → `await dialog.showMessageBox(...)` (the record still held across the
  await) → re-peek (a lock/close during the await drops it → `'state'`) →
  `pending.take` → re-parse + `store.importLogins(target, candidates, { mode })`
  inside `try { … } finally { taken.payload.fill(0) }` → aggregate-counts-only
  reply `{ ok: true, target, counts }`. One `try/catch` spans the store
  pre-checks through the commit, routed through a NEW
  `VAULT_BROWSER_IMPORT_COMMIT_CONFIG` (`src/main/vault/vault-sheet-errors.js`,
  `{ VaultBusyError: 'busy', VaultStateError: 'state' }`, the
  `VAULT_RESTORE_COMMIT_CONFIG` shape).
- **Modified** `src/main/main.js`: `require('./vault/pending-browser-imports')`
  + `require('./vault/browser-import-flow')`; one
  `createPendingBrowserImportStore({ mintHandle: () => crypto.randomUUID() })`
  instance (`_pendingBrowserImports`), dropped in the `onLock` hook
  (alongside `_pendingVaultImports.dropAll()`) and in
  `releaseVaultHoldsForWindow` (alongside `_pendingVaultImports.clear`); a
  `getBrowserImportFlow()` memo (the `getVaultHuman` idiom) constructing the
  flow with `windowForChrome: (chromeId) =>
  registry.getWindowForChrome(webContents.fromId(chromeId))?.win ?? null`;
  the four flow methods (`browserImportBegin/Summary/Cancel/Commit`) threaded
  into `registerBrowserIpc`'s deps object.
- **Modified** `src/main/register-browser-ipc.js`: four new
  `registerInternalHandler` channels
  (`internal-vault-browser-import-pick/summary/cancel/commit`), each gated on
  its injected delegate and resolving the window via
  `chromeForTab(event.sender.id)?.id`; `commit` shape-validates the payload
  (`{ ok:false, reason:'state' }` on a malformed one) before delegating.
- **Modified** `src/preload/internal-preload.js`: four `browserImport*`
  bridge methods (bare `ipcRenderer.invoke` calls) added beside the restore
  group; the generated `.bundle.js` twin regenerated via `npm run
  build:preload` (never hand-edited — it is gitignored and rebuilt at every
  `pretest`/`prestart`).
- **Modified** `src/renderer/renderer-globals.d.ts`: the four
  `browserImport*` methods declared on `GoldfinchInternalBridge` (the
  new-shared-module checklist's "a new contextBridge method needs a
  renderer-globals.d.ts entry" rule) — required to clear `npm run typecheck`.
- **Modified** `src/shared/vault-page-model.js`: three new pure helpers —
  `browserImportDestinationOptions(jars, presenceById, globalPresence)`
  (Global special-cased from a third `{ hasVault, count }` argument; jar rows
  come verbatim from `restoreDestinationOptions(jars, presenceById).options`),
  `browserImportSkipLines(skipped)` (a fixed label per DD8 reason code,
  `non-web-origin` naming the captured scheme, unknown codes echoed raw),
  `browserImportOutcomeLines(counts)` (ordered outcome strings from
  `summarizeOutcomes`'s shape, `imported` always shown, every other line
  omitted at zero, every field coerced).
- **New** `src/renderer/pages/vault-browser-import-controller.js` —
  `createVaultBrowserImport(deps)` (the `vault-nav-controller.js`
  injected-deps shape: `{ bridge, dom: { el, button, iconButton, openModal,
  appendOption }, getPresence, refresh }`) → `{ openPickModal,
  openDestinationModal, heldRecord, loadHeld, dropHeldOnPagehide }`. Owns the
  pick modal (Chrome-export guidance lede, folder-picker, found/skip
  summary), the destination modal (destination select from
  `browserImportDestinationOptions`, a Replace/Merge select shown only when
  the selected destination's presence reports ≥ 1 item, `mode` always sent —
  a `'merge'` literal default precedes every commit call), and the
  completion modal (`browserImportOutcomeLines` + the "Delete the exported
  CSV file now" guidance). `openDestinationModal` calls `bridge.vaultState()`
  directly for the Global row's fresh presence (a deliberate simplification
  over the leg text's `getVaults` dep — see Deviations).
- **Modified** `src/main/internal-page-map.js`: the vault route gained
  `'/vault-browser-import-controller.js':
  rendererPage('vault-browser-import-controller.js')` (the squawk 0063 entry
  above is the OTHER of the two entries this leg adds).
- **Modified** `eslint.config.mjs`: `vault-browser-import-controller.js`
  added to the real-ES-module `sourceType: 'module'` file list (the
  `vault-nav-controller.js` precedent) — required for `npm run lint` to
  parse its `import`/`export` statements.
- **Modified** `src/renderer/pages/vault.js` — the five wiring sites: (1)
  import (`createVaultBrowserImport` from the new controller, `PALETTE` from
  squawk 0063); (2) one `createVaultBrowserImport({ bridge, dom: { el,
  button, iconButton, openModal, appendOption }, getPresence: () => ({
  jarRows, jarVaultPresence }), refresh })` construction call; (3) the
  Import/Export row's second button toggles between "Import from a
  browser…" and, when a record is held, "Resume browser import…" (folded
  into the SAME row slot rather than a separate resume row — a deliberate
  compaction, see Deviations); (4) `browserImport.loadHeld()` joined into
  `refresh()`'s existing `Promise.all`; (5) a `pagehide` listener calling
  `browserImport.dropHeldOnPagehide()`.
- **New tests**: `test/unit/browser-import-flow.test.js` (18 tests, AC1–AC6),
  `test/unit/vault-browser-import-invariants.test.js` (17 tests, AC8/AC9/AC10/
  AC12/AC13/AC15(d) grep-ACs). **Modified tests**:
  `test/unit/register-browser-ipc.test.js` (+3 tests, AC7),
  `test/unit/vault-page-model.test.js` (+10 tests, AC11),
  `test/unit/vault-restore-workflow-invariants.test.js` (swatch-prefill regex
  retargeted `JAR_COLOR_PALETTE` → `PALETTE`),
  `test/unit/browser-import-boundary.test.js` (+1 test extending the Leg 1
  automation-refusal grep-AC explicitly to `browser-import-flow` and the
  four channel names, ruling 9(d)),
  `test/unit/internal-page-map.test.js` (the exact-allowlist fixture test
  updated for the vault route's two new entries — this one was NOT in the
  leg's own "Outputs" list; caught by the full `npm test` run, see
  Deviations).
- **Docs**: `docs/vault.md` gained a "Browser import (Chrome)" subsection
  under Portability (mechanism, held-payload lifetime, the native-confirm
  commit gate and why it's load-bearing, the plaintext-file bounded
  exception, automation refusal) and a Threat-model bullet naming the
  exported-CSV-file residual exposure. `CLAUDE.md`'s Password-vault pattern's
  "Module layout" bullet lists the four new main modules + the page
  controller; a new "Browser import (Chrome CSV, M19 F1)" bullet states the
  DD5/DD13 admin-tier boundary in the pattern's voice.

#### Verification

- **AC1–AC6** (flow module): `node --test --test-timeout=60000
  test/unit/browser-import-flow.test.js` — 18/18 pass. A real temp-dir
  `VaultStore` (FAST_SCRYPT), the REAL `pending-browser-imports` store
  (its `HOLD_DROP_MS` timer injected `.unref()`'d so a held-and-never-taken
  test record can't hang the process), and injected `dialog`/`fs` doubles —
  `showMessageBox` deferred so AC3(a)/(c) can interleave a `take`-order log
  and a `dropAll()` between the call and its resolve.
- **AC7** (IPC gating): `node --test test/unit/register-browser-ipc.test.js`
  — 20/20 pass (17 pre-existing + 3 new: gated-on-injection, window
  resolution via `chromeForTab(sender.id)` with a forged-payload-id proof,
  and the malformed-commit-payload refusal before delegating).
- **AC8, AC10, AC12, AC13 (scan half), AC15(d)**: `node --test
  test/unit/vault-browser-import-invariants.test.js
  test/unit/vault-restore-workflow-invariants.test.js
  test/unit/browser-import-boundary.test.js` — 17 + 21 + 93 pass (the
  browser-import-boundary count includes Leg 1's 92 plus this leg's 1 new
  ruling-9(d) pin).
- **AC9**: source-scan pin in `vault-browser-import-invariants.test.js`
  (no dedicated `internal-preload*.test.js` suite exists to extend); `git
  diff --stat` confirms `internal-preload.js` and the gitignored
  `internal-preload.bundle.js` both changed after `npm run build:preload`.
- **AC11**: `node --test test/unit/vault-page-model.test.js` — 46/46 pass
  (36 pre-existing + 10 new).
- **AC14**: `node --test test/unit/seam-contract.test.js` — 10/10 pass;
  `grep -n 'VAULT_PAGE_LINE_BUDGET = 2820' test/unit/seam-contract.test.js`
  confirms the pin is UNCHANGED. Measured `vault.js` line count
  (`split(/\r?\n/).length`, the exact seam metric): **2819** — 1 line under
  the hard 2820 cap (short of the leg's own soft ≤2815 target; see
  Deviations for why).
- **AC15**: `node --test test/unit/browser-import-boundary.test.js
  test/unit/automation-mcp-server.test.js` — 93 + 87 pass;
  `EXPECTED_TOOL_COUNT` (`automation-mcp-server.test.js:39`) confirmed
  unchanged at 35.
- **AC16**: read both doc sections directly.
- **AC17**: `npm test` → **4421/4421 pass** (4372 Leg-1 baseline + 49 new:
  18 + 3 + 10 + 17 + 1); `npm run typecheck` clean (after fixing three real
  type errors this leg's code introduced — see Deviations);
  `npm run lint` clean (after adding the controller to
  `eslint.config.mjs`'s ES-module file list); `npm run format` then
  `npm run format:check` clean. Every pre-existing suite stayed green.
- **AC18**: this entry.

#### Decisions

- **`getVaults` collapsed into a direct `bridge.vaultState()` call inside
  the controller, rather than a separate injected dep** (ruling 4 named
  `getVaults` as its own dep alongside `getJarRows`/`getJarVaultPresence`).
  The controller already receives `bridge` (needed for the four
  `browserImport*` IPC calls); routing the Global row's fresh presence
  through `bridge.vaultState()` directly needed no new vault.js-level cache
  variable and gave equally-fresh (arguably fresher) data than a cached
  accessor would have. `getJarRows`/`getJarVaultPresence` collapsed into one
  `getPresence: () => ({ jarRows, jarVaultPresence })` dep for the same
  reason. Both `dom`-grouping (`{ el, button, iconButton, openModal,
  appendOption }` under one `dom` property instead of five flat ones) and
  this collapse were driven by the line-budget's hard constraint (see
  Deviations) — the resulting deps shape stays fully injected/testable, just
  with fewer, more grouped seams than the leg text's literal list.
- **The "Resume browser import…" affordance folds into the SAME row slot
  as "Import from a browser…"** (toggled by `browserImport.heldRecord()`)
  rather than a separate resume row mirroring restore's `pendingImportRecord`
  precedent. Ruling 6 only specifies that a held record "renders a 'Resume
  browser import…' button in the section" — not a dedicated row — and the
  fold saved 5 lines against the hard budget while keeping the same operator
  affordance.
- **`setPendingNotice` (named in ruling 4's dep list) is NOT part of the
  controller's constructor.** Every refusal branch ruling 6 actually
  specifies (declined / busy / locked / state) renders an INLINE modal
  status message and keeps the modal open (or, on success, closes straight
  into the completion modal) — never the "close the modal, show a page-level
  notice, refresh()" shape `pendingNotice` exists for (that shape belongs to
  the EXPORT modal's genuinely long-async-gap race, not this flow's
  synchronous-isUnlocked-check-then-short-await shape). No ruling-6 branch
  had a genuine call site for it; wiring an unused capability would have
  cost budget for no behavior and risked an unused-var lint finding.

#### Deviations

- **Three real TypeScript errors surfaced by `npm run typecheck` and
  fixed** (not anticipated in the leg text): (1) `browser-import-flow.js`'s
  `commit` returns `mapVaultSheetError`'s general result type (which
  includes the bare-boolean/plain-`{ok:false}` shapes the OTHER delegates'
  configs can produce), narrower than the declared `commit` return type —
  fixed with a cast-to-local (`commitRefusal`, CLAUDE.md's "Cast-to-local
  before a chain" rule) since `VAULT_BROWSER_IMPORT_COMMIT_CONFIG` only ever
  produces the `{ok:false, reason:string}` shape in practice; (2) the
  controller's `modeSelect.value` is a generic `string`, narrower than
  `browserImportCommit`'s `'merge' | 'replace'` payload type — fixed with an
  explicit narrow-and-cast (`modeValue === 'replace' ? 'replace' : 'merge'`)
  that is also strictly SAFER at runtime (the select only ever holds those
  two values, but the cast no longer trusts that silently); (3) `vault.js`'s
  `bridge` (typed `GoldfinchInternalBridge`) was missing the four
  `browserImport*` methods on that interface — `renderer-globals.d.ts`
  updated (an Outputs-list omission in the leg text; the new-shared-module
  checklist in CLAUDE.md names this rule, but the leg's own Files
  Affected/Outputs lists never mention `renderer-globals.d.ts`).
- **`test/unit/internal-page-map.test.js` needed an update the leg's
  Outputs list didn't name.** That file pins the FULL vault-route key list
  exactly (`Object.keys(map.vault).sort()`); it went red on the first full
  `npm test` run after this leg's two new route entries landed. Fixed by
  adding the two new keys + two new equality assertions (mirroring the
  file's existing per-entry-path assertions) — a one-line-of-reasoning fix,
  not a design question, so implemented directly rather than treated as a
  divert trigger.
- **`vault.js`'s line-budget arithmetic needed real restructuring beyond
  the leg's five-site wiring estimate to fit under the HARD 2820 cap.**
  ruling 8 estimated ≤18 total wiring lines (import +2, construction ≤8,
  button ≤3, Promise.all +1, pagehide ≤3) landing at ≤2820 with the squawk's
  -18 baseline. The FIRST straightforward implementation (a flat 10-property
  `createVaultBrowserImport({...})` call plus a separate "Resume…" row)
  measured **2830** — 10 over the hard cap. Trimmed via the two Decisions
  above (the `dom`-grouping + `getPresence` collapse, and folding the resume
  affordance into the existing button slot) to land at **2819** — 1 line
  under budget, 4 lines short of the leg's own soft ≤2815 target. Recorded
  honestly per the leg's own instruction ("the squawk closure states the
  landed number honestly"); no further extraction (splitting more of
  `vault.js` into another controller) was attempted since the hard cap was
  already met and the flight's divert criterion warns against an
  open-ended decomposition beyond what this leg's addition actually needs.
- **`showMessageBox`'s `detail` string folds the "delete the exported CSV"
  reminder into the SAME string as the destination/Replace-Merge
  explanation** (ruling 1 step 5 lists them as two clauses of one `detail`
  — "plus the export-file reminder line" — read as concatenated within the
  single native-dialog `detail` field, since `dialog.showMessageBox` takes
  one `detail` string, not a line array).

#### Anomalies

- None blocking. The `browser-import-flow.js` module initially called
  `parseCsv(...)` and passed its return value directly to
  `detectChromeExport`/`adaptChromeRows` as if it were the records array —
  `parseCsv` actually returns `{ records }` (an object), not the array
  itself. Caught immediately by the first `browser-import-flow.test.js` run
  (every `begin()` call returned `{ error: 'unrecognized-format' }` instead
  of a successful pick) before any other test depended on the broken
  behavior; fixed by destructuring `{ records } = parseCsv(...)` at both of
  the flow's two parse call sites (`begin` and `commit`).
## 2026-09-09 — Flight-end review

### Flight Director Notes

- Leg 2 landed (Developer report + independent re-run: 4421/4421 tests,
  typecheck/lint/format clean; `vault.js` = 2819 under the seam metric,
  pin unchanged at 2820). `legs_completed = 2` — the last autonomous leg.
  Developer deviations accepted as logged in its entry (deps collapsed to
  fit the line cap; resume affordance folded into the button slot;
  `setPendingNotice` dropped; `internal-page-map.test.js`'s exact-allowlist
  fixture updated — an Outputs omission the full suite caught;
  `eslint.config.mjs` gained the new controller in the ES-module list, the
  `vault-nav-controller.js` precedent).
- **Debrief item, not a squawk** (fails the squawk gate's no-design rule):
  `vault.js` sits at 2819/2820 after this flight — squawk 0063's reclaimed
  headroom was consumed by the ≤18-line wiring. The durable lever remains
  the M18 F3 debrief's recommendation 2 (extract the restore mapping /
  completion modals into their own controller, retargeting the invariants
  suite's source scans), deliberately NOT taken here per the flight's
  divert criterion. Carry to the flight debrief.
- Spawning the flight-end Reviewer (Sonnet) over ALL uncommitted changes
  (both legs + squawk 0063 + docs). The optional Accessibility Reviewer is
  disabled in the crew file; the vault page is internal-session and not
  axe-auditable (the accepted settings-class gap) — the Leg 3 HAT covers
  live keyboard/label checks.

- **Flight-end review outcome.** Cycle 1 (Reviewer, Sonnet, six scoped
  forks): one BLOCKING finding — `_importLogins` bypassed `planLogins` for
  a lazy/empty/`replace` destination, so an export listing the same login
  twice landed both on a first import (Leg 1 ruling 6 documented the
  intra-file rule but no AC exercised it against an empty destination — a
  test-design gap for the debrief: pure-level dedupe coverage did not
  reach the store's own branch); two non-blocking (a raw NUL byte in this
  log's prose; the squawk's pre-filled sign-off). Fix Developer removed the
  bypass (always `planLogins(candidates, mode === 'replace' ? [] :
  destItems)`), added three regression tests, replaced the NUL. Cycle 2
  re-review: `[HANDOFF:confirmed]`; independently re-run: 4424/4424 tests,
  typecheck/lint/format clean.
- Both legs → `completed`; both checked off in flight.md; squawk 0063
  sign-off finalized. Flight stays `in-flight` — Leg 3 (guided HAT on a
  real Chrome export) is operator-driven and still ahead; the flight lands
  after it (or on the operator's decision to skip it).

- **Flight commit**: `4d1303d` on `flight/01-chrome-password-import` (both
  legs + squawk 0063 + docs, one commit after the confirmed review). Draft
  PR opened with the leg checklist; marked ready-for-review when the flight
  lands after Leg 3.

## 2026-09-09 — Leg 3 design (guided HAT)

### Flight Director Notes

- Draft PR **#208** opened (`flight/01-chrome-password-import` → `main`)
  with both autonomous legs checked off; marked ready-for-review when the
  flight lands.
- **Leg 3 `hat-and-alignment` designed** (`legs/03-hat-and-alignment.md`,
  12 verification steps S1–S12), status `ready`. Interactive leg: no
  autonomous cycle; the Flight Director guides the operator one step at a
  time and fixes inline (fix-vs-feature gate + multi-surface trigger per
  the methodology). Risk tier: n/a (no code is designed here; any fix rides
  the inline protocol with its own review call, logged as HAT fix N).
- Operator prerequisites before S1: the app on this branch (dev profile
  recommended — the real vault stays untouched), a set-up + unlocked vault
  with ≥ 1 persistent jar, and a fresh Chrome export (row count noted).
  The export file is never committed or pasted into artifacts.

## 2026-09-10 — Leg 3 guided HAT (in progress)

### HAT fix 1 (grounding) — vault page renders blank

- **Symptom (S1):** `goldfinch://vault` shows only the static "Secrets"
  heading; the entire JS-rendered body (`#vault-root`, `#vault-nav`) is
  empty — the signature of the page's ES-module graph failing to load.
- **Root cause:** squawk 0063 (landed in Leg 2) added the
  `/jar-page-model.js` route to the vault entry of `internal-page-map.js`
  but omitted `/burner.js`. `jar-page-model.js` imports `BURNER` from
  `./burner.js`; with no route, that flat specifier 404s, which fails the
  whole vault module graph and blanks the page. The sibling `jars` route
  has always carried BOTH entries together — the dedup copied only one.
- **Why nothing caught it:** `npm test` never boots the real internal page,
  and every Leg 2 / squawk-0063 review was a source scan. This is the
  documented internal-page real-boot hazard (a transitive import needs an
  exact route), and exactly the risk squawk 0063's own Note flagged
  ("if it needs any other allowlist/route change … escalate rather than
  expand"). Recorded as a Leg 2 test-coverage gap for the debrief.
- **Fix:** add `'/burner.js': shared('burner.js')` to the vault route +
  a pure regression test asserting the transitive import closure of every
  internal page's routed modules is fully routed. FIX not FEATURE; touches
  the internal-page allowlist (main wiring) so implemented with the
  multi-surface review discipline. Committed as a grounding fix mid-HAT.

### HAT step results + operator feedback

- S1 pass (after HAT fix 1); S2 pass; S3 pass (after HAT fix 2); S4 pass;
  S5 pass (matchMode renders "match any subdomain"); S6 pass; S7 pass;
  S8 pass (Replace count fresh + Cancel safe).
- **Operator feedback — S9/S10 are low-value as LIVE steps.** The
  held-payload drop-on-lock (S9) and drop-on-window-close (S10) security
  substance is already unit-covered (pending-browser-imports zeroize
  matrix + browser-import-flow AC3's lock-during-confirm). The live steps
  add only the page-side modal-close observation. S9 ran (pass); S10
  skipped by FD recommendation + operator assent — redundant with unit
  coverage. **Debrief note:** future import-flow HAT specs should not spend
  live steps re-observing unit-covered cross-process drops; reserve the
  live budget for the un-unit-testable (real keyboard traversal, on-disk
  plaintext absence in the real profile).
- HAT enhancements landed mid-run (operator asks, committed): enhancement 1
  (delete-export reminder → info panel, c4f7a9c); enhancement 2 (Replace
  wording made explicit it wipes ALL items, d8513fb). HAT fixes: 1 (blank
  vault page / burner.js route, a6a0b21); 2 (Replace/Merge hidden for empty
  destination, fadd782).

- S11 (keyboard) pass: after HAT fix 3 (openModal focus-on-open), Escape
  dismisses the import modals and Tab traps within them correctly. Fix 3's
  effect on the Escape symptom is now confirmed positive (my static
  analysis had doubted it — the focus-on-open move was the fix).
- HAT enhancement 2 follow-up (operator): the "Wipe and replace — delete
  everything here first, then import" option label overflowed the select
  (scrollbar, clipped). Shortened to "Replace — delete everything, then
  import" (keeps the wipes-everything clarity, fits the control). The
  native confirm's fuller destructive wording is unchanged (a dialog, room
  to spare). One-string edit, no test pinned it.

- **S12 (no plaintext on disk) pass.** FD-checked structural half: the dev
  profile's `vaults/` holds only `.gfvault` ciphertext + `manager.json`,
  no `.csv` anywhere under the profile, no plaintext sidecar. Operator-run
  half (their own terminal, secret kept out of session): a recursive grep
  of the profile for a real imported password returned zero hits. Export
  file deleted by the operator.

## 2026-09-11 — Leg 3 complete; flight landed

Guided HAT complete on a real Chrome export: S1–S9, S11, S12 pass; S10
skipped by FD recommendation + operator assent (unit-covered). Six changes
committed mid-HAT, each with a regression pin and a green bar:
- HAT fix 1 (grounding) — vault page blank: missing `/burner.js` route
  (squawk 0063 omission); + a transitive-import-closure regression test
  for every internal page. `a6a0b21`.
- HAT fix 2 — Replace/Merge shown for an empty destination: `.vault-field`
  author `display` beat `[hidden]`; added `.vault-field[hidden]` override.
  `fadd782`.
- HAT enhancement 1 — delete-export reminder raised to an info panel.
  `c4f7a9c`.
- HAT enhancement 2 — Replace wording made explicit it wipes ALL items.
  `d8513fb`; option label later shortened to fit the select. `42ef650`.
- HAT fix 3 — `openModal` now moves focus into the dialog on open (APG);
  fixed Escape + Tab-trap on the import modals. `672d9e7`.

Debrief carry-forwards: (a) Leg 2 test-coverage gap — no test boots a real
internal page, so the burner.js route omission and the `[hidden]` cascade
defect both passed source-scan-only reviews; the new closure test closes
the route class, the `[hidden]` pin the CSS class. (b) `vault.js` is back
at its 2820 budget ceiling — the restore-modal controller extraction (M18
F3 debrief rec 2) remains the durable lever. (c) S9/S10 live steps were
low-value vs unit coverage.
