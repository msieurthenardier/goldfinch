# Leg: ingest-and-commit-core

**Status**: ready
**Flight**: [Chrome Password Import](../flight.md)

## Objective

Land the whole main-side, headless-testable import pipeline — RFC-4180
parser, Chrome-row→`login` adapter with the row taxonomy and caps, the
content-identity dedupe plan, the new batch commit op on `vault-store.js`
with Replace/Merge and lazy-vault creation, the separate zeroizing
held-payload store, and the automation-boundary pins — with no IPC, no
dialog, and no page code (all of that is Leg 2).

## Context

- **Charter DDs** (flight.md): DD2 (batch op), DD3 (identity + trichotomy),
  DD4 (`matchMode`), DD6 (separate zeroizing hold store), DD7 (parser +
  header detection), DD8 (row taxonomy), DD9 (Replace/Merge), DD11 (outcome
  shape + the `failed` producer), DD12 (caps). Read them in full first.
  DD5/DD10/DD13 are Leg 2 — do not touch `main.js`, `register-vault-ipc.js`,
  or `src/renderer/pages/vault.js` here.
- The mission's commit-core ruling: `restoreProfile` / `mergeVaultItems` /
  `validateImportedItems` are NOT reused for the commit (they key on
  `item.id`; a CSV row has none). The **shell** ideas are reused: a
  per-owning-window held record with a safety-drop timer, and a per-entry
  outcome list. Do not synthesize a fake `.gfvault` bundle to ride restore.
- Prior-leg learnings (M18 F3 debrief, standing conventions): byte-scan
  fixtures use `name==slug` jars and realistic field values; suites run
  under `FAST_SCRYPT`; a security-adjacent parser gets a corpus, not a
  handful of happy-path rows.
- **All citations verified 2026-09-09 on branch
  `flight/01-chrome-password-import` at `4265d27`** (see Citation Audit).

## Leg-Level Design Rulings

The flight DDs leave these open; they are recorded here so the design
review can strike at them.

1. **Three new modules under `src/main/vault/`, plain CJS, Electron-free,
   `// @ts-check`:**
   - `csv-parse.js` — the RFC-4180 parser. `parseCsv(text)` returns
     `{ records }` where each record is `{ line, fields: string[] }` or
     `{ line, malformed: true, reason }`. Never throws on content.
   - `browser-import.js` — the Chrome adapter + dedupe plan + caps:
     `detectChromeExport(records)` (header gate, DD7),
     `adaptChromeRows(records)` (DD8 taxonomy, DD12 field cap),
     `planLogins(candidates, existingItems)` (DD3 trichotomy),
     `summarizeOutcomes(skipped, results)` (DD11 counts), constants
     `MAX_FIELD_CHARS`, `MAX_PAYLOAD_BYTES`, and a
     `BrowserImportFormatError` class for whole-file refusals.
   - `pending-browser-imports.js` — the DD6 held-payload store,
     `createPendingBrowserImportStore(deps)`. A **sibling module**, not a
     second instance of `createPendingImportStore`: DD6 says "the factory
     already supports this", but the existing factory's record shape is
     pinned to exactly `['bundle','handle']`
     (`test/unit/vault-pending-imports.test.js:75`), its timer arms only at
     `stashSecret` (`:108`), and its `zeroize` wipes only `rec.secret`
     (`pending-imports.js:zeroize`). A separate instance of the unchanged
     factory cannot hold a payload or arm at hold. A sibling module keeps
     restore's pinned lifecycle byte-untouched. It must also stay clear of
     the words matched by the structural pin at
     `vault-pending-imports.test.js:302-305` (`/suppress|holder|autolock/i`)
     only if it lives in `pending-imports.js` — it does not, so the pin is
     unaffected; still, do not add an autolock-suppression holder to the new
     store either (the same DD5 reasoning applies: a held plaintext must
     never keep the vault unlocked).
2. **Parser contract (DD7 detail).** UTF-8 input, optional leading BOM
   stripped; CRLF and LF both terminate records; a trailing final newline
   emits no empty record; a zero-length line between records is skipped
   (not malformed). Quoted fields may contain `,`, `"` (escaped as `""`),
   CR, and LF. **Structural error handling**: a quote appearing where the
   grammar forbids it (an unescaped `"` inside an unquoted field, or a
   closing `"` followed by anything other than `,` / CR / LF / EOF) marks
   the current record `malformed` and the parser **resynchronizes at the
   next raw LF regardless of quote state**; an unterminated quoted field at
   EOF marks the final record `malformed`. Resync can mis-split a following
   quoted-newline note into further malformed records — those are each
   accounted for (never silently lost), which DD8 accepts. `line` is the
   1-based physical line the record started on (for the outcome report).
3. **Header gate.** `detectChromeExport` accepts a first record whose
   fields, trimmed and lower-cased, are exactly
   `['name','url','username','password','note']`; anything else throws
   `BrowserImportFormatError('unrecognized-format')` — the whole file is
   refused (DD7). Data rows with a field count other than 5 are
   `malformed` (a per-row skip, DD8), never a whole-file refusal.
4. **Adapter taxonomy, evaluated in this order per data row** (first hit
   wins; every skip carries `{ line, reason }` with a fixed reason code,
   and a human label is derived from the code — never from row content):
   1. parser-malformed or field count ≠ 5 → `malformed`;
   2. any field longer than `MAX_FIELD_CHARS` (**16384** chars, generous
      vs. real notes of a few KB) → `field-too-long` (DD12);
   3. `url` empty or `new URL(url)` throws → `malformed-url`
      (`originOf` returns JS `null`, DD8);
   4. `new URL(url).origin === 'null'` (the string — WHATWG opaque origin,
      e.g. `android://…`) → `non-web-origin`, with the scheme captured
      (`url.split(':')[0]`, lower-cased, max 32 chars) so the outcome line
      can read "non-web origin (android://)" — never the raw `"null"`;
   5. `password` empty → `no-password` (covers federated / "sign in
      with…" entries).
   Everything else is a **candidate**: `{ line, title, origin, username,
   password, notes }` with `title = name || new URL(url).host`, `notes`
   omitted (not `''`) when `note` is empty, `username` kept even when empty
   (a login permits an empty username, DD8). The **`blocklist` reason has
   no producer in a Chrome export** (Chrome exports saved credentials only;
   never-save entries are not written), so this leg does not emit it — the
   code is reserved for Flight 2 if a Chromium sibling's export carries
   such rows. Recorded as a DD8 refinement in the flight log.
5. **Row cap.** `adaptChromeRows` throws
   `BrowserImportFormatError('too-many-rows')` when the number of data
   records (candidates + skips) exceeds `MAX_IMPORT_ITEMS` (10000).
   Refused whole, not truncated (DD12). **Literal ownership moves to the
   leaf module (design review, high):** `MAX_IMPORT_ITEMS` is DEFINED in
   `browser-import.js` and the definition at `vault-store.js:521` is
   DELETED — `vault-store.js` does a plain top-level
   `const { MAX_IMPORT_ITEMS, planLogins } = require('./browser-import')`
   and re-exports the constant from its `module.exports`. The reverse
   direction (store defines, adapter requires) is a circular require:
   `vault-store.js` would `require('./browser-import')` near its top,
   whose body would then read `vault-store.js`'s still-empty
   `module.exports` and bind `undefined` silently. `browser-import.js`
   must never require `vault-store.js`. `MAX_PAYLOAD_BYTES` follows the
   same rule: defined once in `browser-import.js`, required by
   `pending-browser-imports.js` (no cycle in that direction either).
6. **Dedupe plan (DD3).** `planLogins(candidates, existingItems)` builds the
   identity map from `existingItems.filter(type === 'login')` keyed on
   `(canonicalOrigin(existing.origin), existing.username ?? '')` — the
   existing `origin` is re-canonicalized through the same
   `new URL(x).origin` idiom (an unparseable stored origin can never match).
   Each candidate resolves to `new` / `duplicate` / `changed`:
   `duplicate` ⇔ same identity AND `password` equal AND `(notes ?? '')`
   equal; `changed` ⇔ same identity, secrets differ (title differences are
   ignored — DD3 says "same secret fields"). **`totp` is deliberately NOT
   compared** (design review, medium): the login schema's secret set is
   `password/totp/notes`, but a Chrome row can never carry a TOTP secret,
   so comparing it would make every login the operator has since added
   2FA to classify `changed` on every re-import and spawn a copy each
   time — the exact opposite of the "re-import does not duplicate"
   criterion. Recorded as a DD3 refinement. The map holds EVERY existing
   item per identity (a prior `changed` copy included): `duplicate` if ANY
   matches on secrets, `changed` only if NONE does — so re-importing an
   already-landed changed row never mints a further copy. **Intra-file
   duplicates** use
   the same rule: after a candidate is classified `new`, its identity joins
   the map, so a later same-identity row is `duplicate` or `changed`
   against it. A `changed` candidate lands as a NEW item titled
   `${title} (imported)` (the `mergeVaultItems` marking idiom,
   `vault-store.js:775-810`); the existing item is never touched.
7. **Store op `importLogins(target, candidates, { mode })`** on
   `VaultStore`, public wrapper + `_importLogins` body, mirroring the
   `saveItem`/`_saveItem` split (`:2859-2875`):
   - wrapper: `_enterGatedOp()` + `finally { releaseOp() }` (`:1217`) —
     this is the **twelfth** gated op; the rekey-gate suite enumerates them
     by name and hard-codes the count at FOUR sites
     (`test/unit/vault-rekey-gate.test.js:6` — the header's op-count
     history, extend it with "then to TWELVE by M19 F1 Leg 1, which added
     `importLogins`: a CSV import must not begin mid-rotation" — plus
     `:10`, `:89`, `:94`) — update all four and add `importLogins` to the
     by-name enumeration in the `:94` test body (a store with an uncreated
     `work` jar suffices as its fixture; the op refuses at entry before
     touching anything).
   - body, in this order: (1) pure input-shape check first — refuse a
     non-array or > `MAX_IMPORT_ITEMS` `candidates` with `VaultStateError`
     (it has no reason to depend on unlock state); (2) `_requireMrk()`
     (`:1147`); (3) `_resolveTarget(target)` (`:2695` — burner/unknown
     refused, no file created); (4) `_touch()`.
   - read: `_readVault(vaultId)` (`:1027`). `doc === null` → lazy-create
     branch: `vc.newVaultKey()` + `_writeVaultForKey(vaultId, key, mrk,
     items)` + `this.vaultKeys.set(vaultId, key)` (the `_saveItem` null-doc
     branch, `:2884-2891`). Otherwise decrypt with `_vaultKeyFromDoc`
     (`:2800`).
   - `mode`: `'merge'` | `'replace'`. When the destination doc exists AND
     has ≥ 1 item AND `mode` is neither value → throw
     `VaultStateError('vault-store: importLogins requires mode merge|replace
     for a non-empty destination')` — "nothing lands without a choice"
     (DD9). For an uncreated or empty destination `mode` is ignored.
     `replace` keeps the destination's **existing vault key** and replaces
     the item array wholesale (all types, as restore's Replace also
     discards every existing item). **Key handling deliberately DIVERGES
     from restore's Replace** (design review, medium): `restoreProfile`'s
     replace branch (`:2508-2521`) swaps to the bundle's own fresh
     `vaultKey` and evicts the cached destination key because a bundle
     carries a key; a CSV import carries none, so `importLogins` keeps the
     destination key by necessity and performs no cache eviction. `merge`
     runs `planLogins` against the decrypted items.
   - per-candidate commit: build `{ type: 'login', title, origin,
     username, password, notes?, matchMode: 'registrable-domain' }` (DD4)
     and pass it through `_normalizeItem(item, undefined)` (`:2824`) inside
     a per-row `try/catch` — a throw → `{ line, outcome: 'failed', reason:
     err.message }` and the batch continues (DD11). **State plainly in the
     store JSDoc that `failed` is defense-in-depth scaffolding under this
     design** (design review, low): `_normalizeItem` throws only on a
     non-object or an unknown `type`, and the candidate built here always
     satisfies both, so no real row reaches `failed` today; the path is
     pinned by monkeypatch (AC14) so a future validator that CAN throw
     per-row inherits the contract. `duplicate` →
     `{ line, outcome: 'duplicate' }`; `changed` → landed copy, `{ line,
     outcome: 'changed' }`; `new` → `{ line, outcome: 'imported' }`.
   - **exactly one write** per call: `_writeVault` (`:1038`) with the
     destination's `kdf`/`envelopes` and the re-encrypted array — or
     `_writeVaultForKey` on the lazy branch. A throw from the write
     propagates (atomic write → nothing landed; the caller reports an
     import-level error, DD11). If every candidate resolved `duplicate` /
     `failed` (nothing to add) the op still returns results but performs
     **no write** (`written: false`).
   - returns `{ results: Array<{ line, outcome, reason? }>, written:
     boolean }`. `summarizeOutcomes(skipped, results)` (pure, in
     `browser-import.js`) folds the adapter's skips and the store's results
     into `{ imported, duplicate, changed, failed, unmappable: { total,
     byReason: Record<reason, number> } }` — the DD11 report data the Leg 2
     page renders.
8. **Held-payload store contract (DD6).**
   `createPendingBrowserImportStore({ mintHandle, setTimeout?,
   clearTimeout? })` → `{ hold, peekSummary, take, clear, chromeIds,
   dropAll }` plus exported `HOLD_DROP_MS = 5 * 60 * 1000` (the restore
   store's `SAFETY_DROP_MS` value; a separate constant so the two can
   diverge deliberately).
   - `hold(chromeId, { payload: Buffer, summary })` — refuses (throws
     `TypeError`) a non-Buffer payload or one over `MAX_PAYLOAD_BYTES`
     (16 MiB, the `MAX_BUNDLE_BYTES` precedent `main.js:1110`); drops any
     prior record for this window (zeroize + cancel); stores
     `{ handle, payload, summary, timer }` and **arms the timer at hold**.
     `summary` is the caller's NON-SECRET projection `{ candidateCount,
     skipped: [{ line, reason, scheme? }] }` — Leg 2 computes it by
     parsing + adapting once at pick time and then retaining only the
     Buffer (the parsed strings are discarded — best-effort, DD6).
   - `peekSummary(chromeId)` → `{ handle, summary } | null` — **never the
     payload**; the only page-facing projection.
   - `take(chromeId, handle)` → the record (timer cancelled, record removed,
     payload NOT zeroized — the consumer owns it, the restore `take` race
     rule `pending-imports.js:take`) or `null` on a missing record or a
     mismatched handle. Handle-guarded, unlike restore's `take`, so a stale
     commit can never consume a superseded record.
   - `clear(chromeId, handle?)`, `chromeIds()`, `dropAll()` — as in the
     restore store; every drop path funnels through one `drop` that cancels
     the timer, `payload.fill(0)`s, and deletes the record.
   - Leg 2 wires `dropAll` into the same `onLock` hook (`main.js:814`) and
     the window-close/pagehide paths; this leg only proves the store.
9. **Automation-boundary pins landed here (CP4's Leg 1 half).** A new
   `test/unit/browser-import-boundary.test.js`: (a) `registry.listTools()`
   names (the `mcp-server.js:567` list) contain none matching
   `/import|csv|chrome|browser/i`, and `EXPECTED_TOOL_COUNT`
   (`automation-mcp-server.test.js:39`, currently 35) is untouched by this
   leg — the "no tier can initiate" half; (b) a grep-AC over
   `src/main/automation/**` asserting zero references to `importLogins`,
   `pending-browser-imports`, `browser-import`, or `csv-parse`; (c) a
   source-scan of `pending-browser-imports.js` that the `payload` field is
   read back only inside `take` and `drop` (never in `peekSummary`), plus
   the unit assertion that `peekSummary`'s return carries no `payload` key
   and no candidate field content. Leg 2 adds the IPC-layer half (the
   handler never sends the payload to the page; the native confirm gate).

## Inputs

What exists before this leg runs (verified 2026-09-09):

- `src/main/vault/vault-store.js` — `MAX_IMPORT_ITEMS` `:521`;
  `deepValueEqual` `:753`; `mergeVaultItems` `:775` (the `(imported)`
  marking `:800-806`); `_readVault` `:1027`; `_writeVault` `:1038`;
  `_touch` `:1068`; `_requireMrk` `:1147`; `_enterGatedOp` `:1217`
  (eleven call sites: `:1919 :1997 :2155 :2384 :2592 :2750 :2862 :2973
  :3027 :3243 :3442`); `_writeVaultForKey` `:1353`; `restoreProfile`
  `:2372` / `_restoreProfile` `:2398` (NOT reused — reference only for the
  merge/write shape `:2494-2528`); `_resolveTarget` `:2695`;
  `_vaultKeyFromDoc` `:2800`; `_normalizeItem` `:2824`; `saveItem`
  `:2859` / `_saveItem` `:2875` (null-doc lazy branch `:2884-2891`);
  `listItems` `:2913`; `module.exports` `:3485`.
- `src/main/vault/pending-imports.js` — the restore hold store; the
  `cancelTimer`/`zeroize`/`drop`/`hold`/`take` shape to mirror. Untouched
  by this leg.
- `src/main/vault/vault-human.js:59-64` — `originOf` (the `new
  URL(url).origin` idiom; returns JS `null` on throw). Not exported; the
  adapter re-implements the 3-line idiom locally with the DD8
  string-`"null"` discrimination.
- `src/shared/vault-item-schema.js:37` — `login: { nonSecret:
  ['title','username','origin'], secret: ['password','totp','notes'] }`;
  `metadataOf` coerces `matchMode` to `'registrable-domain'` | `'exact'`.
- `test/unit/vault-rekey-gate.test.js:10, :89, :94` — "ELEVEN gated ops"
  pins + the by-name enumeration in the `:94` test body.
- `test/unit/vault-pending-imports.test.js:75` (`['bundle','handle']`
  shape pin), `:149` (bare hold is untimed), `:302-305` (holder-free
  regex) — must all stay green untouched.
- `test/unit/automation-mcp-server.test.js:39` — `EXPECTED_TOOL_COUNT =
  35`.
- `src/main/automation/mcp-server.js:567` — `registry.listTools()`.
- Test harness idioms: `test/unit/vault-restore-merge.test.js:19-35`
  (`FAST_SCRYPT`, `tmpDir`, `makeStore` with injected `listJars` and a
  fixed `now`); `test/unit/vault-export-import.test.js:195-198` (byte-scan
  assertion idiom); `test/unit/vault-restore-fault-injection.test.js:242`
  (monkeypatch-a-sink fault injection).
- Green bar at leg start: 4294/4294 tests, typecheck, lint, format all
  clean (2026-09-09, this branch).

## Outputs

- New: `src/main/vault/csv-parse.js`, `src/main/vault/browser-import.js`,
  `src/main/vault/pending-browser-imports.js`.
- Modified: `src/main/vault/vault-store.js` (`importLogins` +
  `_importLogins`; local `MAX_IMPORT_ITEMS` definition deleted in favor
  of the `./browser-import` import, re-exported from `module.exports`);
  `test/unit/vault-rekey-gate.test.js` (eleven → twelve at four sites,
  enumeration).
- New tests: `test/unit/csv-parse.test.js`,
  `test/unit/browser-import-adapter.test.js`,
  `test/unit/vault-import-logins.test.js`,
  `test/unit/pending-browser-imports.test.js`,
  `test/unit/browser-import-boundary.test.js`.
- `flight-log.md` leg entry; flight.md leg checkbox (at commit time).
- No `main.js`, IPC, page, `docs/`, or `CLAUDE.md` changes — Leg 2 owns
  the docs half (CLAUDE.md's Password-vault module-layout bullet and
  `docs/vault.md` get the three new modules there).

## Acceptance Criteria

Parser (DD7):
- [ ] AC1 `parseCsv` round-trips a corpus in which the `note` field carries
      an embedded comma, an embedded escaped quote (`""`), an embedded LF,
      an embedded CRLF, and a leading BOM on the file — every field
      byte-exact.
- [ ] AC2 A structurally bad record (unescaped quote in an unquoted field;
      closing quote followed by a non-delimiter) is returned `malformed`
      with the parse continuing at the next raw LF; an unterminated quote
      at EOF yields a final `malformed` record; a trailing newline emits no
      empty record; a blank line is skipped. Each malformed record carries
      its 1-based `line`.
- [ ] AC3 `detectChromeExport` accepts the exact Chrome header
      (case-insensitive, trimmed) and throws
      `BrowserImportFormatError('unrecognized-format')` on any other first
      record (a random CSV, an empty file, a `.gfvaultbundle` JSON blob).

Adapter (DD8, DD12):
- [ ] AC4 One fixture export containing each row class produces exactly
      the expected `{ line, reason }` skip per class — `malformed`
      (wrong field count), `field-too-long`, `malformed-url`,
      `non-web-origin` (an `android://` row, `scheme: 'android'`),
      `no-password` — plus candidates for: a normal row, a row with an
      empty username and a real password, a row with an empty `name`
      (title falls back to the URL host), a row with an empty `note`
      (`notes` key absent). No row is ever dropped without an entry, and
      the run never throws on row content.
- [ ] AC5 An `android://` row's `origin` never enters the identity map: two
      such rows with different packages do not dedupe against each other
      (they are both `non-web-origin` skips), and no `"null"` string
      appears in any reason/scheme field.
- [ ] AC6 `MAX_IMPORT_ITEMS + 1` data records → `BrowserImportFormatError
      ('too-many-rows')`; `MAX_IMPORT_ITEMS` exactly → accepted. Exported
      `MAX_IMPORT_ITEMS` from `vault-store.js` equals the adapter's cap
      (one literal, cross-module assert).

Dedupe plan (DD3):
- [ ] AC7 The trichotomy is pinned in one scenario: against a destination
      holding login A, the incoming set `[A identical, A with a changed
      password, A with only a changed title, B new]` resolves to
      `duplicate`, `changed`, `duplicate`, `new`; `login.example.com`
      and `mail.example.com` with the same username are distinct
      identities; a destination `card`/`note` item never participates;
      and an existing login carrying a `totp` secret with an incoming row
      matching its identity/password/notes is `duplicate` (no totp-less
      copy is ever minted).
- [ ] AC8 Intra-file duplicates: an export with the same `(origin,
      username)` twice — identical → the second is `duplicate`; differing
      password → the second is `changed`.

Store op (DD2, DD4, DD9, DD11):
- [ ] AC9 `importLogins` into an **uncreated** global vault and into an
      uncreated persistent jar each create the `.gfvault` via the lazy
      branch, cache the key, and `listItems(target)` afterward returns the
      imported logins, every one carrying `matchMode: 'registrable-domain'`,
      a minted `id`, `createdAt`/`updatedAt`, and `notes` only where the
      row had one.
- [ ] AC10 Exactly ONE vault write per call: an INSTANCE-method
      monkeypatch (`store._writeVault = spy` / `store._writeVaultForKey =
      spy`, wrapping the original) records one call for a 50-row import
      — the sole valid technique; `writeFileAtomic` is a destructured CJS
      import at `vault-store.js:40` and cannot be spied through its module
      (design review, high) — AND the on-disk `.gfvault` bytes change
      exactly once (a second signal: mtime/bytes before vs. after); zero
      calls and byte-identical file when every candidate is
      `duplicate`/`failed` (`written: false`).
- [ ] AC11 Double-import idempotence: importing the same 10-row candidate
      set twice with `mode: 'merge'` leaves `listItems` at 10 items and the
      second call's results are 10 × `duplicate`, `written: false`.
- [ ] AC12 `changed` lands as a new item titled `<title> (imported)` with
      a fresh id; the pre-existing item is byte-identical to before.
- [ ] AC13 `mode`: a non-empty destination with no/invalid `mode` throws
      `VaultStateError` and writes nothing; `replace` on a destination
      holding 3 items (a login, a card, a note) leaves ONLY the imported
      logins, under the SAME vault key (the `.gfvault` `envelopes` are
      byte-identical before/after); `merge` keeps all 3 plus the new
      logins. An empty/uncreated destination accepts a missing `mode`.
- [ ] AC14 Per-row `failed` (DD11): a monkeypatched `_normalizeItem` that
      throws for one candidate yields exactly one `{ outcome: 'failed',
      reason }`, the other N-1 `imported`, ONE write. A write-sink throw
      (monkeypatched `_writeVault`) propagates, and `listItems` afterward
      equals the pre-call contents (zero landed).
- [ ] AC15 Gating + lock: `importLogins` throws `VaultLockedError` when the
      manager is locked (no file created for an uncreated destination);
      throws `VaultBusyError` at entry while the re-key gate is up; refuses
      a burner/unknown target with `VaultStateError` and no file; a
      non-array `candidates` on a LOCKED store throws `VaultStateError`
      (the shape check precedes `_requireMrk`); `vault-rekey-gate.test.js`
      enumerates twelve gated ops including `importLogins`, all four
      count sites updated, and stays green.
- [ ] AC15b One literal each: `MAX_IMPORT_ITEMS` and `MAX_PAYLOAD_BYTES` are
      defined only in `browser-import.js` (grep: exactly one `= 10000` /
      one `16 * 1024 * 1024` definition across `src/main/vault/`);
      `vault-store.js` re-exports `MAX_IMPORT_ITEMS` and
      `require('./browser-import')` resolves it to `10000` at load
      (the cycle-free direction, pinned by a require-order test that
      loads `vault-store.js` FIRST in a fresh process/module cache).
- [ ] AC16 `summarizeOutcomes(skipped, results)` folds a mixed fixture into
      `{ imported, duplicate, changed, failed, unmappable: { total,
      byReason } }` with every count correct and every unknown/malformed
      entry coerced (never `NaN`, never a throw).
- [ ] AC17 No-plaintext byte-scan: after an import into a `name==slug`
      jar (`work`/`work`) and into global, every file under the temp
      `userData` (recursively) is read as bytes and none contains the
      fixture's password, note, username, or title strings.

Held store (DD6):
- [ ] AC18 `hold` refuses a non-Buffer and an over-`MAX_PAYLOAD_BYTES`
      payload (throws, nothing held); arms the timer at `HOLD_DROP_MS` on
      hold (injected `setTimeout` observed); a same-window re-hold
      zeroizes + replaces; a second window's record is independent.
- [ ] AC19 Every exit zeroizes: `clear` (explicit cancel), `dropAll` (lock),
      timer expiry (fake timers), and `drop`-via-re-hold each leave the
      prior payload Buffer all-zero and the window unheld. `take` with the
      correct handle cancels the timer WITHOUT zeroizing and removes the
      record; `take` with a wrong handle returns `null` and leaves the
      record (and its timer) intact.
- [ ] AC20 `peekSummary` returns `{ handle, summary }` only — assert the
      returned object has no `payload` key, and a deep `JSON.stringify`
      of it contains none of the fixture's field values.

Boundary (CP4, Leg 1 half):
- [ ] AC21 `browser-import-boundary.test.js` passes the three pins in
      ruling 9 (tool-name negative match + unchanged count; grep-AC over
      `src/main/automation/**`; payload read-site source-scan).

Whole-leg:
- [ ] AC22 Green bar: `npm test` (with `--test-timeout`), `npm run
      typecheck`, `npm run lint`, `npm run format:check` all clean; every
      pre-existing vault suite untouched except `vault-rekey-gate.test.js`.
- [ ] AC23 `flight-log.md` carries this leg's entry (changes, verification,
      the DD8 `blocklist` refinement, any deviation) and the leg is `landed`.

## Verification Steps

- AC1–AC3: `node --test --test-timeout=20000 test/unit/csv-parse.test.js
  test/unit/browser-import-adapter.test.js`.
- AC4–AC8, AC16: `node --test test/unit/browser-import-adapter.test.js`
  (pure — no temp dirs, no scrypt).
- AC9–AC15, AC17: `node --test --test-timeout=60000
  test/unit/vault-import-logins.test.js test/unit/vault-rekey-gate.test.js`
  (FAST_SCRYPT temp-dir stores; the byte-scan walks the temp dir).
- AC18–AC20: `node --test test/unit/pending-browser-imports.test.js`
  (MockTimers per test body, per the CLAUDE.md recipe).
- AC21: `node --test test/unit/browser-import-boundary.test.js
  test/unit/automation-mcp-server.test.js`.
- AC22: the four green-bar commands from the project root.
- AC23: read the flight log; `grep -n 'Status' legs/01-*.md`.

## Implementation Guidance

1. **Parser first** (`csv-parse.js`): a single-pass state machine over the
   string (states: field-start / unquoted / quoted / quote-seen); emit
   records with `line`; implement the resync rule from ruling 2. Write the
   corpus test alongside — include the exact Chrome-shaped fixture with
   embedded `,` `""` LF CRLF in `note`, plus the malformed set.
2. **Adapter** (`browser-import.js`): `originOfDiscriminated(url)` →
   `{ kind: 'web', origin } | { kind: 'non-web', scheme } | { kind:
   'invalid' }`; then `adaptChromeRows` in ruling-4 order; then
   `planLogins`; then `summarizeOutcomes`. Keep every function pure and
   exported. Re-export `MAX_IMPORT_ITEMS` from `vault-store.js` and
   `require` it here (the adapter must not carry its own literal).
3. **Store op**: add `importLogins`/`_importLogins` next to `saveItem`,
   following ruling 7's body order (shape check → `_requireMrk` →
   `_resolveTarget` → `_touch` → `_readVault` → null-doc lazy branch →
   decrypt → mutate → single write). `vault-store.js` requires
   `{ MAX_IMPORT_ITEMS, planLogins }` from `./browser-import` at its top
   alongside the other requires and DELETES its own `MAX_IMPORT_ITEMS`
   definition (`:521`; `validateImportedItems` keeps using the imported
   name). `browser-import.js` must never require `vault-store.js` — the
   only cycle-free direction (ruling 5). Update
   `vault-rekey-gate.test.js` (four sites) in the same change.
   Monkeypatch note for AC14/AC10: `_normalizeItem`/`_writeVault` are
   called as `this.<method>(…)`, so an INSTANCE-level override
   (`store._normalizeItem = fn`) shadows the prototype for that one store
   with no cross-test leakage and no restore-in-`finally` — a simpler
   shape than the cited `vc.decryptItems` module-singleton precedent,
   which does need restoring.
4. **Held store**: copy `pending-imports.js`'s skeleton, rename, replace
   the record shape and timer-arm site per ruling 8, add the payload
   checks, add `peekSummary`, make `take` handle-guarded.
5. **Boundary suite**: follow `vault-restore-workflow-invariants.test.js`'s
   grep-AC style for the source scans; reuse `automation-mcp-server.test.js`'s
   harness for the `listTools()` read (or import its registry builder).
6. **Byte-scan test**: walk the temp dir with `fs.readdirSync(…,
   { recursive: true })`, `Buffer.includes` each fixture value; jars fixture
   `[{ id: 'work', name: 'work', … }]`.
7. Run the full green bar; write the flight-log entry; set the leg `landed`.

## Edge Cases

- **Empty file / header only**: header-only → zero data records → the
  adapter returns no candidates and no skips; `importLogins([])` performs
  no write and returns `written: false` (the page will say "nothing to
  import" in Leg 2). An empty file has no header → `unrecognized-format`.
- **Username absent vs. empty**: Chrome writes `""` for no username; the
  adapter keeps `username: ''` (not `undefined`) so the identity key is
  stable and `listItems` metadata renders consistently.
- **Title fallback**: an empty `name` → `new URL(url).host`; if the URL
  somehow has no host (opaque origins are already skipped) fall back to
  the origin string.
- **Whitespace**: fields are NOT trimmed (a password may legitimately
  start/end with a space); only the header comparison trims.
- **`changed` against a `changed` copy (no unbounded copies)**: after a
  `changed` landing the destination holds BOTH the original and the
  `(imported)` copy under one identity. The identity map therefore holds a
  LIST of existing items per identity, and `planLogins` classifies a
  candidate `duplicate` if ANY of them has equal secrets, `changed` only
  if NONE does. Consequence to pin: import a changed row (→ `changed`,
  copy lands), then import the same file again → that row is `duplicate`
  (matches the copy), no third item. Ruling 6 carries the same rule.
- **Replace on an uncreated destination**: no doc → lazy-create path,
  `mode` ignored.
- **Locked mid-op**: the op is synchronous end-to-end (no await), so a
  lock cannot interleave; the entry `_requireMrk` is sufficient.
- **Payload string conversion**: Leg 2 will `payload.toString('utf8')`
  to parse; that string is unzeroizable — the DD6 best-effort bound. This
  leg's parser takes a string; do not add a Buffer-walking parser variant.

## Files Affected

- `src/main/vault/csv-parse.js` — new, RFC-4180 parser.
- `src/main/vault/browser-import.js` — new, header gate, adapter, dedupe
  plan, outcome summary, caps, error class.
- `src/main/vault/pending-browser-imports.js` — new, zeroizing
  held-payload store.
- `src/main/vault/vault-store.js` — `importLogins`/`_importLogins`;
  export `MAX_IMPORT_ITEMS`.
- `test/unit/vault-rekey-gate.test.js` — eleven → twelve; enumeration.
- `test/unit/csv-parse.test.js`, `test/unit/browser-import-adapter.test.js`,
  `test/unit/vault-import-logins.test.js`,
  `test/unit/pending-browser-imports.test.js`,
  `test/unit/browser-import-boundary.test.js` — new.
- `missions/19-browser-credential-import/flights/01-chrome-password-import/flight-log.md`
  — leg entry.

## Citation Audit

All `vault-store.js`, `pending-imports.js`, `vault-human.js`,
`vault-item-schema.js`, `main.js`, `mcp-server.js`, and test-file line
citations above were re-read on 2026-09-09 against
`flight/01-chrome-password-import` at `4265d27` (identical to `main`),
then independently re-checked by the design-review Developer (44 tool
reads): every leg-owned citation exact. Two flight-spec context citations
(not leg-owned) are off by one — `vaultImportCommit` is `main.js:1186`
(spec says `:1187`) and its `finally { fill(0) }` is `:1219-1223` (spec
says `:1218-1222`); noted for Leg 2, which owns that code. The gated-op
count in `vault-rekey-gate.test.js` is ELEVEN today at four sites
(`:6 :10 :89 :94`); this leg raises it to twelve. Design-review
corrections applied to this artifact: `writeFileAtomic` is a destructured
import (`vault-store.js:40`) — AC10 now mandates instance-method spying;
`MAX_IMPORT_ITEMS` ownership flipped to `browser-import.js` (cycle-free);
ruling 7's "parity with restore's Replace" claim was wrong (restore swaps
keys, `:2508-2521`) and now reads as a deliberate divergence.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight:
  - [ ] Update flight.md status to `landed`
  - [ ] Check off flight in mission.md
- [ ] Commit all changes together (code + artifacts)
