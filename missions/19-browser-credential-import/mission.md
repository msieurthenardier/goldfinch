# Mission: Browser Credential Import

**Status**: active

## Outcome

The operator can bring their saved logins out of Chrome — and, on the same
import path, any other Chromium browser they use (Edge first) — into the
goldfinch vault, choosing where each import lands. Concretely: the operator
produces a credential export from the source browser, points goldfinch at it,
and the logins arrive as vault `login` items in a destination the operator
picks (the global vault, an existing jar, or a new jar), with a clear
per-import report of what landed, what was skipped as a duplicate, and what
could not be mapped — and no goldfinch-authored plaintext left on disk.

## Context

The operator has years of saved passwords in Chrome and Edge and no way to get
them into goldfinch's vault short of retyping. This mission builds the bridge.

**The mechanism was chosen by a Windows-first risk gate during planning
(operator ruling 2026-09-08), not assumed.** The obvious framing — read the
browser's credential database directly, unwrap its key, decrypt — was tested
against the operator's real profiles first, because if it failed on the
platform that matters the whole mission would change shape. It failed:

- **Linux / macOS** — a direct file+key read *is* tractable (Chrome's key
  lives in the Secret Service on Linux and the login Keychain on macOS).
- **Windows — the platform the operator actually uses** — Chrome's saved
  passwords are **App-Bound Encrypted** (verified on-disk: the stored password
  values carry the `v20` prefix, and `Local State` carries an `APPB` key
  alongside the legacy `DPAPI` one). ABE seals the key so that only Chrome's
  own binary, through a SYSTEM elevation service, can unwrap it. A third-party
  reader can reach it only by defeating ABE — process injection or
  path-validation tricks — which is adversarial, breaks on Google's release
  cadence, and turns goldfinch's read path into infostealer-shaped code. That
  route is refused.

The route that works on **every** platform, including the operator's Windows
Chrome and Edge, is **browser-mediated export**: the source browser itself
decrypts the credentials (through its own key and one OS auth prompt) and
writes them to a file the operator hands to goldfinch. This is how Edge and
1Password import Chrome data — they ask the source to export, they do not crack
its at-rest encryption. So the mission's outcome is framed as a **capability**
("Chrome/Edge credentials come into the vault"), and the mechanism is
browser-mediated export.

**This reuses Mission 18's transaction shell and report shape — but not its
commit core.** M18 (Vault Portability) built the *outer* ingest structure an
import needs: a main-side file pick, a per-owning-window held-record store with
a safety-drop timer and buffer zeroization (`src/main/vault/pending-imports.js`),
a destination-mapping step that directs a source to the global vault / an
existing jar / a new-jar-created-here / skip, a per-destination **Replace vs.
Merge** choice, and a per-entry outcome report (landed / skipped /
collision-refused / failed). That shell is reused. The **commit core is not**:
M18's `restoreProfile` / `mergeVaultItems` / `validateImportedItems` all
hard-assume a ciphertext, **id-bearing** `.gfvault` bundle unwrapped by a bundle
secret — a browser export has no envelopes and no ids, so `mergeVaultItems`
(which matches purely on `item.id`) would import every row with zero dedupe.
The genuinely new work, confirmed against the code at planning, is therefore:
(a) a small hand-rolled CSV parser (none in tree, none in Node); (b) an adapter
mapping foreign rows to the three-type taxonomy; (c) a **new content-identity
dedupe** built against `listItems(target)`; and (d) a commit path over
`saveItem` / `listItems` (which mint ids for id-less items and store ciphertext
through the normal save path) — not `restoreProfile`. The reuse is real but it
is the shell, not the merge.

**Architect validation (2026-09-08): feasible with caveats.** The outcome is
achievable on this stack; the caveats are folded into Context, Constraints, and
Open Questions above/below — the M18 commit-core is not reusable (new dedupe +
new commit path on `saveItem`/`listItems`), the plaintext-file zeroization
guarantee is not inherited from M18's string-based read and must be built
(Buffer read + payload zeroization, with an honest best-effort bound on parsed
JS strings — the same bound the threat model already states for in-process
secrets), the CSV parser is security-adjacent hand-rolled code, and the
automation-refusal test must target the guard that actually applies to the
import UI's placement rather than assuming the sheet allowlist. The
card-deferral rationale (no browser card export) was confirmed accurate.

## Success Criteria

- [ ] **Logins arrive from a browser export.** Given a credential export
      produced by Chrome, the operator can import it and afterward find each
      exported login in the vault as a `login` item carrying its origin,
      username, and password. Verified against a representative export
      (multiple origins, at least one entry with notes, at least one with no
      username).

- [ ] **Nothing lands without a destination choice.** The operator explicitly
      directs the import to the global vault, an existing jar, or a jar created
      during the import; skipping imports nothing. For a destination that
      already holds items, the operator chooses Replace or Merge, and a
      collision is never resolved silently — reusing the Mission 18 restore
      semantics, not a parallel mechanism.

- [ ] **Re-importing the same export does not duplicate.** Because foreign
      entries carry no vault id, sameness is decided by content identity (the
      identity rule is ruled in the owning flight's design). Importing the same
      export twice into the same destination leaves one copy of each login, not
      two; a genuinely changed entry is surfaced, not silently overwritten.
      Verified by a double-import test.

- [ ] **Unmappable and degenerate rows are handled, not dropped silently.**
      Entries the taxonomy cannot represent as a `login` (e.g. a
      federated/"sign in with…" entry that has no stored password, a
      never-save blocklist marker, a malformed or truncated row) are each
      accounted for in the import report — imported where sensible, skipped
      with a stated reason otherwise — and never cause the whole import to
      fail. Verified against an export containing at least one of each.

- [ ] **The import reports its outcome per entry.** After an import the
      operator sees how many logins landed, how many were skipped as
      duplicates, how many were skipped as unmappable (with reason), and how
      many failed — the same per-entry outcome shape Mission 18's restore
      reports, so a re-run can distinguish its own residue from a pre-existing
      collision.

- [ ] **The import path is never machine-driven.** The file pick, parse, and
      commit are operator-initiated only — no automation surface can trigger an
      import or read the credentials in flight, at any tier including admin, the
      same exfiltration boundary the secret sheet holds. Verified by a test
      asserting refusal *through the guard that actually governs where the
      import UI lives* — the sheet menuType allowlist
      (`AUTOMATABLE_MENU_TYPES`), the internal-page session guard for a
      `goldfinch://vault` modal, or the absence of any automation surface for a
      main-side dialog, whichever applies once UI placement is ruled. The test
      must assert against the applicable guard, not assume the allowlist.

- [ ] **goldfinch writes no plaintext credential to disk.** The
      operator-supplied export file is plaintext by nature (the browser
      decrypted it), but goldfinch never copies it, never writes any credential
      value to a log or crash artifact, and stores imported items only as
      ciphertext through the existing save path. The held import record is read
      as a `Buffer` (not a `utf8` string — this does NOT come free from M18's
      read, which materializes an un-zeroizable string) and the held-record
      store is extended to zeroize the plaintext payload on drop / expiry /
      lock / window-close, not just the secret Buffer it wipes today.
      In-memory zeroization of values that transit parsed JS strings is
      **best-effort** — the same honest bound the threat model already states
      for in-process secrets, stated here rather than implied away. The
      plaintext file remains the operator's, created and deleted outside
      goldfinch; the completion surface tells the operator to delete it.
      Verified by asserting no credential value appears in any
      goldfinch-written file after an import, and that a dropped held record
      no longer exposes the payload.

- [ ] **The Chromium family comes in on the same path.** Once Chrome works,
      importing from Edge (and any other Chromium browser whose export is
      format-compatible) uses the same pipeline, with the source identified so
      the operator knows what they are importing and how to produce its export.
      Verified against an Edge export.

- [ ] **Docs tell the new truth.** The vault docs describe the browser-import
      capability, why it is browser-mediated rather than a direct database read
      (the ABE finding), the plaintext-file handling and its bounded exception
      to the "no plaintext on disk" headline, and the automation-refusal of the
      import surface.

## Stakeholders

- **The operator** — sole human user; gains a real migration path off Chrome
  and Edge without retyping.
- **Methodology / security posture** — the import surface is a
  credential-ingest path, mechanically kin to what an infostealer does;
  keeping it operator-only and off the automation allowlist protects the same
  boundary the secret sheet defends.

## Constraints

- **No ABE bypass.** goldfinch never defeats, injects into, or elevates around
  another browser's at-rest encryption. On any platform where the source's
  credentials are not readable without such a bypass, the answer is
  browser-mediated export, not a workaround. (Operator ruling 2026-09-08.)

- **The import surface is never automatable.** No import or `vault-*` menuType
  is admitted to `AUTOMATABLE_MENU_TYPES`, and the parse/commit path is
  main-side and operator-initiated. The exfiltration boundary is not traded for
  testability — the same refusal Mission 18 held for the secret sheet.

- **goldfinch authors no plaintext secret on disk.** The operator's export
  file is a ruled, bounded exception: it is created *outside* goldfinch, read
  once, held only in zeroizable memory, and never copied or logged by
  goldfinch. goldfinch's own writes remain all-ciphertext.

- **Reuse Mission 18's transaction shell and report shape; build a new commit
  path — do not force a foreign export through the restore core.** The
  held-record store, destination mapping, Replace/Merge semantics, and
  per-entry outcome report are reused/extended. But `restoreProfile`,
  `mergeVaultItems`, and `validateImportedItems` assume a ciphertext, id-bearing
  bundle and are the wrong tools for an id-less plaintext source; the item
  commit is built new on `saveItem` / `listItems`, and the dedupe is new logic
  against `listItems(target)`. Do not synthesize a fake encrypted bundle to
  ride the restore path.

- **No new item type in this mission.** Imports map onto the existing
  `login` / `card` / `note` taxonomy (`src/shared/vault-item-schema.js`).
  Anything with no home in that taxonomy is reported as skipped-unmappable,
  not accommodated by widening the schema here.

- **No new runtime dependency for parsing** (operator ruling 2026-09-08). There
  is no CSV parser in tree and Node has none built in, so the export parser is
  **hand-rolled RFC-4180** — small but security-adjacent code (the export's
  `note` column can carry embedded commas, quotes, and newlines; a naive
  `split(',')` corrupts rows), covered by a test corpus of those cases.
  `node:sqlite` is already in-tree for the direct read a later Linux/macOS
  flight might add.

- **Planning produces documentation only**; implementation happens in flights
  via the orchestrated workflow.

## Environment Requirements

- Local Electron dev environment (`npm test`, `npm run typecheck`,
  `npm run lint`, `npm run format:check` — the standing green bar).
- A source browser (Chrome; later Edge) able to produce a credential export —
  available on both the operator's Windows profiles and the WSL Linux Chrome.
- Operator availability to produce real exports for the import tests and for
  any HAT/alignment session on the import flow.

## Open Questions

*Ruled during planning:*

- [x] **Mechanism is browser-mediated export, all platforms** (operator
      ruling 2026-09-08, on the Windows-first ABE gate). A direct
      database+keyring read on Linux/macOS is a *possible later enhancement*
      for those platforms only — a no-file convenience — never the mission's
      spine and never attempted on Windows.
- [x] **Destination reuses Mission 18's mapping as the one-row case** — a
      single export is one source directed to one destination, with M18's
      Replace/Merge and per-entry outcome report.

*Open for flight design:*

- [ ] **Payment-card scope.** The operator selected cards during planning
      *under the direct-read assumption*. Browser-mediated export does not
      reach them: Chrome and Edge expose a **passwords** CSV but no
      user-facing export for saved payment cards. Under the chosen mechanism
      cards are therefore **not reachable**. Resolve in flight design between:
      (a) drop cards from this mission and record them as a candidate for a
      future Linux/macOS *direct-read* flight (where `Web Data`'s card table
      is reachable), or (b) some other operator-provided card source. **Draft
      assumption: (a) — passwords only this mission, cards deferred.** Flagged
      for the operator to overrule at iterate.
- [ ] **Content-identity rule for dedupe.** What makes two logins "the same"
      across an import and a destination that carry no shared id — origin +
      username (normalized how)? How is a same-identity-but-changed entry
      surfaced versus a byte-identical one? This is the mission's central new
      design cluster (Mission 18 deferred exactly this question for foreign
      items) and likely its own leg.
- [ ] **`matchMode` for imported origins.** Every imported login needs a
      `matchMode` (`exact` vs `registrable-domain`, per
      `vault-item-schema.js`). Chrome stores a single URL per credential;
      what value is assigned on import, and is it operator-selectable or a
      fixed default?
- [ ] **Export-format specifics across the Chromium family.** The exact column
      set/labels of each browser's export (Chrome vs Edge vs others), how a
      wrong/unrelated file is detected and refused, and how the source is
      identified to the operator. Owned by the family-breadth flight.
- [ ] **Held-record lifetime for a user-paced mapping step.** The parsed
      export is held main-side across an operator-paced destination choice;
      the cancellation / idle-autolock / window-close semantics for that held
      plaintext (kin to M18's safety-drop timer and the F4
      autolock-suppression guard) re-derived for this source.
- [ ] **Where the export-guidance and mapping UI live.** M18 routed
      non-secret import configuration through `goldfinch://vault` page modals
      with the chrome sheet reserved for secrets alone; confirm the browser
      import follows the same placement, including the per-browser "how to
      produce your export" guidance.

## Known Issues

*(none yet)*

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are
> planned and created one at a time as work progresses. This list will evolve
> based on discoveries during implementation.

- [ ] Flight 1: Chrome password import, end to end — a hand-rolled RFC-4180
      parser → map rows to `login` items (`matchMode`,
      federated/blocklist/empty-password/malformed-row handling) → a **new**
      content-identity dedupe against `listItems(destination)` → a **new**
      commit path over `saveItem`/`listItems` → the reused Mission 18
      destination mapping (one-row case) with Replace/Merge and per-entry
      outcome report; the plaintext-file handling (Buffer read + held-payload
      zeroization, extending `pending-imports.js`); the automation-refusal of
      the import surface (test targeting the guard for the chosen UI
      placement). Heavier than a pure adapter — it carries the parser, the new
      dedupe, the new commit path, and the plaintext-hold rework. The dedupe
      identity is the linchpin, a likely leg. Pre-named divert trigger: the
      dedupe/identity work growing into its own leg cluster.
- [ ] Flight 2: Chromium family breadth — Edge and other format-compatible
      Chromium browsers on the same pipeline, source identification, and the
      per-browser export-guidance UX ("how to produce your export"). Depends
      on Flight 1's pipeline; the seam is a genuine "see Chrome working before
      generalizing" gate. Pre-named divert trigger: a browser whose export
      format diverges enough to need its own adapter path.
- [ ] Flight 3 *(optional)*: Alignment — vibe-coding session on the import
      flow feel, the export-guidance wording, and the outcome-report
      presentation.
