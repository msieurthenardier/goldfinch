# Flight: Chrome Password Import

**Status**: completed
**Mission**: [Browser Credential Import](../../mission.md)

## Contributing to Criteria
- [ ] Logins arrive from a browser export
- [ ] Nothing lands without a destination choice
- [ ] Re-importing the same export does not duplicate
- [ ] Unmappable and degenerate rows are handled, not dropped silently
- [ ] The import reports its outcome per entry
- [ ] The import path is never machine-driven
- [ ] goldfinch writes no plaintext credential to disk
- [ ] Docs tell the new truth *(the import half; the Chromium-family half lands in Flight 2)*

---

## Pre-Flight

### Objective

Bring the operator's saved logins out of a Chrome password export (the
`name,url,username,password,note` CSV Chrome's password manager produces) into
the goldfinch vault as `login` items, in a destination the operator explicitly
picks (global / existing jar / new jar / skip), deduplicated by content so a
re-import does not duplicate, with a per-entry outcome report — and without
goldfinch authoring any plaintext credential to disk. This flight proves the
whole pipeline on Chrome; Flight 2 generalizes it across the Chromium family.

### Open Questions
- [x] Content-identity rule for dedupe → **DD3** (canonical origin + username)
- [x] `matchMode` default for imported logins → **DD4** (registrable-domain)
- [x] Where the import UI lives + which guard enforces automation-refusal →
      **DD5** (vault page modal + main-side dialog; internal-session guard)
- [x] Commit path — reuse restore, loop `saveItem`, or new batch op → **DD2**
      (new batch op)
- [x] Replace vs. Merge semantics for a non-empty destination → **DD9**
- [x] Guided HAT? → yes (Leg 3, optional)

### Design Decisions

**DD1 — Mechanism: browser-mediated export, parsed as CSV.**
The operator produces the export from Chrome's own password manager
(`chrome://password-manager` → Settings → Export), which decrypts through
Chrome's key and one OS auth prompt. goldfinch never reads Chrome's encrypted
store — settled at the mission level by the Windows-first ABE gate. This flight
consumes the resulting file only.
- Rationale: the only mechanism that works on every platform incl. the
  operator's Windows Chrome; no native addon, no ABE bypass.
- Trade-off: the operator handles a plaintext file outside goldfinch (see DD6).

**DD2 — Commit is a NEW batch op on `vault-store.js`, not `restoreProfile` and
not a `saveItem` loop.**
Add a single main-side method (working name `importLogins(target, logins,
{ mode })`) that reads the destination vault once, applies the DD3 dedupe over
the whole incoming set, and writes once.
- Rationale: `restoreProfile`/`mergeVaultItems`/`validateImportedItems`
  (`vault-store.js:2372`, impl `_restoreProfile` at `:2398`; `:775`; `:531`)
  hard-assume a ciphertext, id-bearing
  `.gfvault` bundle — `mergeVaultItems` keys purely on `item.id`, so id-less
  rows would import with zero dedupe. And `saveItem` (`:2859`) does a full
  decrypt→encrypt→atomic-write *per item*, so looping it over N logins is N
  full-vault rewrites. A batch op mirrors restore's single decrypt→merge→encrypt
  shape while using content-identity instead of id. `_normalizeItem` (`:2824`)
  is reused to mint ids for the accepted rows.
- **Must replicate the full `_saveItem` contract, not just gating:** the batch
  op runs under `_enterGatedOp()` (the gated-op counter, `:2862`), calls
  `_requireMrk()` (manager-unlocked), and handles the **lazy-vault-creation**
  null-doc branch (`:2884`) — a never-used global or a freshly created jar has
  no `.gfvault` yet, so the op must `newVaultKey()` + `_writeVaultForKey`
  rather than assume an existing doc. `listItems` returns `[]` for an uncreated
  vault, so the read side is fine; the *write* side must create. These are
  explicit Leg 1 acceptance criteria.
- Trade-off: one new store method + its gated-op wiring; not a parametrization
  of existing code. (This corrects the mission's earlier "reuse the spine"
  framing — the transaction shell and report shape are reused; the commit core
  is new.)

**DD3 — Dedupe identity = canonical origin + username; the identical / changed /
new trichotomy.**
Identity key is `(canonicalOrigin, username)`, where `canonicalOrigin` is the
export row's `url` run through the vault's existing origin idiom
(`new URL(url).origin`, the `originOf` form at `vault-human.js:59`). Against the
destination's existing items: byte-identical (same identity + same secret
fields) → **skipped-duplicate**; same identity, differing password/notes →
**changed**, surfaced as a marked conflict copy (never a silent overwrite —
SC "re-import does not duplicate" requires the changed entry be *surfaced*), the
`mergeVaultItems` divergence idiom (`:794`) but keyed on content; new identity →
**imported**.
- Rationale: mirrors Chrome's own notion of a credential; a double-import of the
  same file is idempotent.
- Trade-off / boundary: dedupe uses the *canonical* origin, **not** the
  registrable-domain widen — so `login.example.com` and `mail.example.com`
  remain distinct identities. This is deliberately orthogonal to DD4: matchMode
  governs *fill-time* widening, dedupe governs *import-time* sameness. Conflating
  them would collapse distinct subdomain credentials on import.

**DD4 — Imported logins default to `matchMode: 'registrable-domain'`.**
Every imported `login` carries `matchMode: 'registrable-domain'` (operator
ruling), so a credential fills at the eTLD+1 level behind the existing
fail-closed matcher (`originMatches`, `src/shared/origin-match.js`), mirroring
how Chrome offered it.
- Rationale: best preserves the operator's expected fill behavior post-import.
- Trade-off: inherits the PSL-snapshot residual already documented for widening
  (`origin-match.js` "KNOWN RESIDUAL"); this flight introduces no new PSL risk
  and adds no new matcher — it only sets an existing per-item flag. The value is
  editable per item in the vault afterward.

**DD5 — UI on the `goldfinch://vault` page + a main-side native file dialog; no
chrome secret sheet. The admin-tier guarantee rests on initiation + exfiltration
boundaries, NOT on the internal-session guard.**
The import affordance and the destination-mapping/outcome modals live on the
vault page (the M18 restore precedent); the file is picked by a main-side
`dialog.showOpenDialog` (the `vaultImportBeginFromFile` idiom, `main.js:1093`).
There is **no** chrome-owned secret sheet — a plaintext CSV has no secret to
unwrap.
- **What actually holds at every tier, admin included** (the SC "never
  machine-driven … at any tier including admin" guarantee): (a) the native file
  dialog has **no automation surface**, so no tier — admin included — can
  *initiate* an import; and (b) the plaintext payload is held **main-side and
  never sent to the page**, so a tier that can drive the page cannot *read* the
  credentials. These two facts are the load-bearing boundary and CP4 verifies
  them directly (including a positive test that an admin-driven page read cannot
  reach the held payload).
- **The internal-session guard is NOT that boundary.** `resolve.js:233`
  (`!allowInternal && isInternalContents(wc)`) refuses the vault page for
  jar/tab-tier automation, but the admin engine sets `allowInternal:true`
  (`mcp-server.js:337`) and the interaction ops (`input.js` click/type/scroll/
  pressKey/drag) carry no op-local internal guard — so **admin CAN drive the
  vault page**. Do not rest any admin-tier claim on the internal-session guard;
  it holds for non-admin tiers only. (The `AUTOMATABLE_MENU_TYPES` allowlist,
  `resolve.js:53`, governs the chrome sheet and is irrelevant here.)
- Trade-off: the commit surface itself is admin-drivable — see **DD13** for the
  mid-flight commit-tampering question that follows from removing M18's
  sheet-as-commit-gate.

**DD6 — Plaintext-payload handling: a SEPARATE store instance, Buffer read, size
cap, payload zeroization on every exit, honest best-effort bound.**
The export is read as a `Buffer` (not M18's `utf8` string, `main.js:1113`) and
size-capped before parse (the 16 MiB `MAX_BUNDLE_BYTES` precedent, `main.js:1110`).
Because the parsed rows *are* the plaintext credentials, the held record must
zeroize the **payload**, not just the secret Buffer — `zeroize()` today wipes
only `rec.secret` (`pending-imports.js:92`).
- **Do NOT mutate the shared restore hold path.** Stand up a **separate**
  `createPendingImportStore` instance (the factory already supports this) for
  browser imports. Reason: `vault-pending-imports.test.js:75` pins restore's
  hold-record shape to exactly `['bundle','handle']`, and `:149` pins that a
  bare restore hold is *untimed*; adding a payload field or arming a timer at
  hold on the shared path would break restore's pinned contract and silently
  give restore's ciphertext hold an expiry it never had. The import store gets
  its own record shape, its own hold-time timer, and its own extended zeroize.
- **Timer arms at hold** (not at a secret step — there is none), since the
  record is sensitive from the moment it is held; all drop paths funnel through
  `drop` (cancel timer + zeroize + delete), which is reachable from
  cancel/lock/window-close/expiry. **The commit (`take`) path must also zeroize
  the payload after use** — `take()` deliberately does not zeroize (the
  take/timer race fix, `:161`), so the consumer owns the buffer's lifetime;
  mirror the restore commit's `finally { …fill(0) }` (`main.js:1218-1222`) for
  the payload.
- In-memory zeroization of values that transit parsed JS strings is
  **best-effort** — stated plainly (the same bound the threat model already
  records for in-process secrets, `docs/vault.md`), not implied away.
- Rationale: the mission's "goldfinch writes no plaintext" guarantee is not
  inherited from M18's ciphertext-bundle read path; it is built here, without
  disturbing restore.
- Trade-off: a second store instance instead of reusing one — cheap, and it
  keeps restore's pinned lifecycle untouched.

**DD7 — Hand-rolled RFC-4180 parser; header-based source detection.**
No CSV parser exists in tree and Node has none built in, so a small RFC-4180
parser is written and treated as security-adjacent code: its test corpus
exercises embedded commas, embedded quotes, and embedded newlines in the `note`
field. The importer detects a Chrome password export by its header row
(`name,url,username,password,note`) and refuses an unrecognized/unrelated file
loudly rather than mis-parsing it.
- Rationale: `split(',')` corrupts quoted `note` fields; a wrong file must be
  refused, not silently half-imported.
- Trade-off: cross-browser header variance (Edge etc.) is **Flight 2**'s
  concern; this flight recognizes the Chrome shape.

**DD8 — Row-mapping taxonomy; a bad row never fails the import; non-web origins
are accounted for, not collapsed.**
Per accepted row: `name`→`title`, `url`→`origin` (canonical, DD3),
`username`→`username`, `password`→`password` (secret), `note`→`notes` (secret,
per `vault-item-schema.js`). Degenerate rows are each *accounted for*, never
silently dropped, and never abort the run:
- a federated/"sign in with…" entry (empty password + federation origin) →
  **skipped-unmappable** (reason: no stored password);
- a never-save blocklist marker → **skipped** (reason: blocklist);
- an empty *username* with a real password → **imported** (`login` permits empty
  username);
- a malformed/short/again-unparseable CSV row → **skipped-unmappable** (reason:
  malformed);
- a **non-web origin** — notably `android://<hash>@<package>/` app credentials,
  which are common in a real Chrome export and carry a real password — where
  `new URL(url).origin` returns the opaque `"null"`: **skipped-unmappable**
  (reason: non-web origin). These must NOT flow into the DD3 identity, or every
  `android://` row would collapse to one `(canonicalOrigin="null", username)`
  identity and dedupe against each other; they also cannot fill a web page.
  **Discriminate the two `originOf` results precisely:** `new URL(url)` on an
  `android://` URL does NOT throw — it yields the *string* `"null"` (WHATWG
  opaque-origin serialization) — whereas a genuinely unparseable `url` throws
  and `originOf` (`vault-human.js:59-64`) returns JS `null`. `origin === 'null'`
  (string) → **non-web origin**; `origin === null` (JS null) → **malformed**.
  Getting this backwards either crashes on `android://` rows or reclassifies
  real parse failures as "non-web". The outcome line for a non-web row names
  the scheme (e.g. "non-web origin (android://)"), never the raw `"null"`
  string, which would read to the operator as a bug.
- Rationale: matches SC "unmappable and degenerate rows are handled, not dropped
  silently"; closes a real dedupe-collision hole for app credentials.
- Trade-off / divert link: if handling non-web origins turns out to demand a
  real identity/normalization model (rather than a clean skip), that is exactly
  the mission's pre-named trigger to split dedupe into its own leg.

**DD9 — Non-empty destination: Replace or Merge, reusing M18 semantics.**
Into a destination that already holds items the operator chooses **Merge**
(the DD3 dedupe-and-add — existing items kept, new imported, changed surfaced)
or **Replace** (existing vault items destroyed, explicit confirm, then import),
reusing `restoreDestinationOptions` (`vault-page-model.js:219`) for the choice
surface. Nothing lands without a choice.
- Rationale: parity with restore; no parallel mechanism (mission constraint).
- Trade-off: Replace is destructive — gated behind an explicit confirm, as in
  M18.

**DD10 — `vault.js` decomposition is an in-flight deliverable (debrief-named).**
`src/renderer/pages/vault.js` is at **2819/2820 lines — zero headroom** (M18 F3
debrief). The page-side leg extracts before it adds: the import mapping/outcome
*display* logic goes into `src/shared/vault-page-model.js` (pure, unit-tested,
the established pattern alongside `restoreDestinationOptions`/`restoreOutcomeLines`),
and squawk **0063** (JAR_COLOR_PALETTE dedup — one `internal-page-map.js`
allowlist line + delete ~14 dup lines) is done as headroom prep. If more room is
needed, the mapping-modal / completion-surface code is split into its own
controller (the debrief's recommendation 2).
- Rationale: the debrief explicitly named a proactive `vault.js` decomposition
  as a deliverable in "whatever flight next touches the vault page" — this is it.
- Note: the 2820 budget is pinned but explicitly *bumpable* (a named leg may
  raise it, `seam-contract.test.js:186`); we choose decomposition over a bump
  per the debrief. Squawk 0063 reclaims only ~14 lines, so if the page-side
  additions are substantial the real headroom lever is the mapping-modal /
  completion-surface controller split (the debrief's recommendation 2), not 0063
  alone.
- Trade-off: some extraction churn on the page; buys durable headroom.

**DD11 — Per-entry outcome report, re-run-distinguishable.**
The import reports counts by outcome — imported / skipped-duplicate /
skipped-unmappable (with reason) / changed / failed — using the
`restoreOutcomeLines` pattern (`vault-page-model.js:287`), so a re-run can tell
its own residue from a pre-existing collision.
- **`failed` has a concrete producer.** DD8's row taxonomy assigns every
  *parsed* row to imported / duplicate / unmappable / changed, so `failed` is
  reserved for the commit stage: a row that passed the adapter but is rejected
  inside the batch op — `_normalizeItem` / schema validation throwing on that
  one row — is reported `failed` (with the validator's reason) and the batch
  continues; it does not abort the import. A *vault-level* write failure
  (encrypt / atomic-write throwing) is not a per-row outcome: the whole import
  fails, nothing lands, and the completion surface reports the import-level
  error. Leg 1's tests cover both: a single bad row → one `failed`, N-1 landed;
  a write failure → zero landed, import-level error.
- Rationale: SC "the import reports its outcome per entry"; the M18 outcome
  shape. A report state with no producing code path is a design hole
  (Architect review), so the producer is pinned here.
- Trade-off: none.

**DD12 — Imported-row count AND per-field length are bounded.**
The accepted-row count is capped (the `MAX_IMPORT_ITEMS` precedent,
`vault-store.js:521`) to bound resource use on a hostile or absurd file,
alongside the DD6 byte cap. Neither cap bounds a *single* absurd field (one
row with a multi-megabyte `note`), and `vault-item-schema.js` carries no field
length limits today, so the adapter also caps each field's length; a row
exceeding it is **skipped-unmappable** (reason: field too long), not truncated
silently and not fatal to the import. The exact limit is an acceptable
variation (generous — real notes run to a few KB).
- Rationale: resource-exhaustion hygiene, matching the existing import path;
  closes the single-row vector the row/byte caps miss (Architect review).
- Trade-off: an implausibly large export or field is refused, not truncated
  silently.

**DD13 — The commit is gated by a main-side NATIVE confirm dialog, admin-proof
at every tier.**
The commit handler (the `internal-vault-import-commit` path, paralleling
`vaultImportCommit`, `main.js:1187`) `await`s a native `dialog.showMessageBox`
BEFORE performing any write — stating the destination and, for **Replace**, its
destructive consequence explicitly — and proceeds only on the operator's
affirmative click.
- Rationale: removing M18's secret sheet removed the sheet's *de-facto commit
  gate* (M18's commit refuses without a sheet-stashed secret, and the sheet is
  admin-refused at all tiers). Without a replacement, an admin key could
  `evaluate` in the vault-page realm mid-import, read the handle from page state,
  and drive `commitImport({handle, mapping})` to redirect the destination or
  force a destructive Replace during an operator-initiated import (credentials
  still cannot leak — DD5(b) — but the destination/Replace could be tampered
  with). A **native** dialog has no automation surface (the same property that
  makes `showOpenDialog` admin-proof for initiation, DD5(a)), so the write does
  not proceed for ANY tier — admin included — without the operator's own click,
  even if `commitImport` is called from an admin-driven `evaluate`. This holds
  the SC "never machine-driven … at any tier including admin" literally, with no
  chrome-sheet machinery.
- **Await the confirm while the record is still HELD, before `take()`.**
  `showMessageBox` is async and does not block the main event loop, so an
  idle-lock or window-close can fire `onLock → dropAll` while the dialog is
  open. If `take()` already removed the record, its plaintext payload would sit
  in the handler's local scope — un-timed and unreachable by the drop fan-out —
  until the operator dismisses. Await the confirm first, then `take()`, so a
  concurrent lock/close still drops the payload.
- **Freshness contract for what the confirm says.** The mapping modal renders
  destination presence ("no secrets yet" / "N secrets") from a `presenceById`
  snapshot via `restoreDestinationOptions` (`vault-page-model.js:219`); the
  operator can sit on that modal for minutes (the DD6 hold timer is the bound),
  so that snapshot is display-only and may be stale by confirm time. The DD13
  confirm's numbers — and, for Replace, the "this will destroy N existing
  items" count — come from a fresh `listItems(target)` read performed
  main-side immediately before `showMessageBox` renders. Source of truth: the
  on-disk vault. Rebuild trigger: every confirm render. Max staleness at
  confirm: zero (bounded by the await itself). The commit then re-reads the
  destination inside the gated op regardless, so the write is safe even if the
  operator idles on the confirm; the contract here is that the confirm never
  *understates* what Replace destroys.
- Trade-off: one extra native confirm step in the flow (acceptable; it doubles
  as the "you're about to import N logins into X" summary). CP4 asserts an
  admin-driven `commitImport` call does not write without the **native**
  (main-side) confirmation — a page-side DOM confirm would be admin-defeatable
  and is explicitly not acceptable.

### Prerequisites
- [x] Standing green bar: `npm test`, `npm run typecheck`, `npm run lint`,
      `npm run format:check` all clean at flight start.
- [x] A real Chrome password export (`chrome://password-manager` → export)
      available for the Leg 3 guided HAT — the operator produces it at HAT time
      (contains real credentials; never committed, deleted after).
- [x] `vault.js` headroom: squawk 0063 done (or done as the first step of
      Leg 2) so the page-side additions fit; extraction planned into Leg 2 (DD10).
      Squawk 0064 (not-set-up-with-jars regression test) is deliberately NOT in
      this flight: import requires `_requireMrk()` to succeed, and not-set-up is
      a state where it cannot, so 0064's gap is orthogonal to every state this
      flight reaches.
- [x] No environment conflicts: this flight adds no network service, port, or
      DB — file read + in-memory parse + existing vault writes only.

### Pre-Flight Checklist
- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Two build legs plus an optional guided HAT.

**Leg 1 — ingest & commit core (main-side, headless-testable).** The RFC-4180
parser (DD7), the Chrome-row→`login` adapter (DD8) with the DD3 dedupe and the
DD4 matchMode default, the new batch commit op on `vault-store.js` (DD2) with
Replace/Merge (DD9), the `pending-imports` plaintext-payload rework (DD6), the
per-entry outcome shape (DD11), the row/byte/field caps (DD12), and the
automation-boundary tests against the boundary that actually holds — no
initiation surface, payload never leaves main (DD5), native confirm gate
(DD13) — explicitly NOT the internal-session guard. Everything here is
pure/main-side and unit-tested with no live UI.

**Leg 2 — import UI + vault-page decomposition (page-side).** The import
affordance on `goldfinch://vault`, the main-side file dialog + window-scoped IPC
(paralleling `vaultImportBeginFromFile`/commit), reuse of the mapping-modal and
outcome-report surfaces, the DD13 native confirm, and the "delete your export
file now" completion guidance. Gated by the DD10 decomposition: squawk 0063
headroom prep + pure display logic extracted into `vault-page-model.js` before
the page grows. Note: `dialog.showMessageBox` has no precedent in `src/main/`
(only `showOpenDialog` is used and stubbed, e.g.
`test/unit/register-download-ipc.test.js:64`), so the dialog test double gains a
`showMessageBox` stub alongside the existing one.

**Leg 3 (optional) — guided HAT.** A live import of a real Chrome export:
items land, re-import dedupes, the outcome report reads true, degenerate rows
are reported, Replace/Merge behave, and the export-file guidance shows — fixing
issues inline. Cross-process/held-record seams (page ↔ main, lock/window-close
drop) get a live exercise, per the debrief's "pin cross-webContents seams"
learning.

### Checkpoints
- [ ] CP1: Parser + adapter + dedupe pass unit tests, incl. the double-import
      idempotence case and the RFC-4180 embedded-delimiter corpus.
- [ ] CP2: Batch commit writes once, dedupes correctly, and Replace/Merge both
      verified; `_normalizeItem` mints ids for accepted rows.
- [ ] CP3: import-store payload zeroize proven on every drop path
      (cancel / lock / window-close / expiry), **including a lock/close that
      fires while the DD13 native confirm is open** (record still held → dropped);
      no-plaintext byte-scan passes with a name==slug fixture.
- [ ] CP4: Automation-boundary tests green — no tier can initiate (native
      dialog), admin-driven page read cannot reach the payload, and the DD13
      native commit gate holds at all tiers.
- [ ] CP5: Import completes end-to-end on the vault page; `vault.js` remains
      within budget after the additions (decomposition landed).
- [ ] CP6: Guided HAT satisfied (if Leg 3 taken).

### Adaptation Criteria

**Divert if**:
- The content-identity dedupe grows into its own design cluster (e.g. needs a
  normalization/collision model beyond `(canonicalOrigin, username)`) — the
  mission's pre-named divert trigger; split it into its own leg.
- The `vault.js` decomposition balloons past "make room for this import UI"
  into a general page re-architecture — stop, land the room actually needed,
  and log the rest as a follow-up (do not absorb an open-ended refactor here).

**Acceptable variations**:
- Exact method/IPC-channel names, the parser's internal structure, and the
  precise wording of the export-file guidance and outcome lines.
- Doing squawk 0063 as the first commit of Leg 2 vs. a separate prep step.

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned
> and created one at a time as the flight progresses.

- [x] `ingest-and-commit-core` - main-side parser (RFC-4180), Chrome-row→login
      adapter + row taxonomy, content-identity dedupe, batch commit op with
      Replace/Merge, pending-imports plaintext-payload rework, per-entry outcome
      shape, row/byte caps, automation-refusal test. (DD2–DD4, DD6–DD9,
      DD11–DD12)
- [x] `import-ui-and-vault-page-decomposition` - vault-page import affordance,
      file dialog + window-scoped IPC, native-confirm commit gate (DD13),
      mapping-modal + outcome-report reuse, export-file guidance, and the DD10
      vault.js decomposition (squawk 0063 + pure-logic extraction). Import-half
      docs in `docs/vault.md`. **Acceptance: any per-row preview or confirmation
      added to the mapping/outcome UI excludes `password`/`notes`** (keep row
      content main-side) — so a later UX addition cannot silently erode the
      DD5(b) "no secret crosses to the page" boundary CP4 rests on. (DD5, DD10,
      DD13)
- [x] `hat-and-alignment` *(optional)* - guided HAT on a real Chrome export with
      iterative fixes.

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing (green bar: test / typecheck / lint / format:check)
- [ ] Documentation updated (`docs/vault.md` import half)
- [ ] `vault.js` within line budget after additions
- [ ] Squawk 0063 closed per the `/squawk` completion protocol (status,
      corrective action, verification, sign-off) if Leg 2 landed its fix

### Verification

- **Unit** (Leg 1): RFC-4180 corpus (embedded comma/quote/newline in `note`);
  adapter taxonomy (federated / blocklist / empty-username / malformed /
  non-web-origin `android://`); dedupe trichotomy + double-import idempotence;
  batch commit single-write + Replace/Merge + lazy-vault-creation into an
  uncreated destination + `_requireMrk` refusal when locked; import-store
  payload zeroize on every exit incl. the commit (`take`) path; no-plaintext
  byte-scan of all goldfinch-written files after an import (name==slug fixture,
  per the debrief convention).
- **Automation boundary** (Leg 1/2, SC "never machine-driven … at any tier
  including admin"): assert the *real* boundary, not the internal-session guard
  — (a) no automation tier can *initiate* an import (the native dialog has no
  surface), and (b) a positive test that an **admin**-driven page read cannot
  reach the held plaintext payload (it lives main-side, never sent to the page).
  Plus whatever DD13 rules for the commit gate.
- **Integration** (Leg 2): the page↔main held-record round-trip (hold →
  mapping → commit), and a drop-on-lock / drop-on-window-close case (the
  cross-process seam the debrief flagged).
- **Guided HAT** (Leg 3): live import of a real Chrome export end-to-end.
- **No two-agent behavior test.** Unlike M18 there is no one-time-secret
  surfacing chain or timing-sensitive sheet sequence to witness — the import is
  deterministic and its observables are unit-checkable (parsed rows, on-disk
  ciphertext, absence of plaintext) or covered by the guided HAT. A witnessed
  spec would be over-investment; recorded here as a deliberate choice, not an
  omission.
