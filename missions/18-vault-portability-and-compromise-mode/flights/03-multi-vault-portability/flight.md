# Flight: Multi-Vault Portability

**Status**: in-flight
**Mission**: [Vault Portability & Compromise Mode](../../mission.md)

## Contributing to Criteria

- [ ] **Whole-profile export** (criterion 4) — bundle v2 carrying every
      vault + encrypted jar identity metadata
- [ ] **One restore workflow, explicit mapping, unified with import**
      (criterion 5) — file pick → secret → decrypted-labels mapping →
      commit; Replace-or-Merge; v1 bundles as the one-row case
- [ ] **Fresh-adopt guarantees extend to multi-vault bundles**
      (criterion 6) — forced recovery rotation, NO admin mint, single
      dismiss-locked sheet, hybrid witnessed behavior test
- [ ] **Selective jar transplant** (criterion 7) — subset restore,
      re-keyed under destination MRK, explicit Replace/Merge per vault
- [ ] **Master severing offered, never forced** (criterion 8) — post-adopt
      session offer card
- [ ] **Docs tell the new truth** (criterion 9, portability half) —
      threat-model donor-password bullet answered; portability docs
      describe the bundle + mapping workflow

Retired-by-recon items carried for traceability (Phase 1b, operator-
confirmed 2026-09-02):

- [x] Bundle `managerVersion` field / v2-source AAD importability —
      shipped in Flight 2 leg 1 (DD7): `vault-store.js:1486` (export),
      `:1568-1573` (validate), `:1625`/`:1630` (threaded unwraps)
- [x] Busy-error reason-forwarding on sibling delegates — shipped in
      squawk 0058 (PR #200); pinned by
      `test/unit/vault-sheet-error-copy.test.js`
- [x] Re-verify vault-store citations by symbol — done by this flight's
      reconnaissance report (flight-log.md)

---

## Pre-Flight

### Objective

Deliver vault portability whole and in parts: one export produces a
single all-ciphertext bundle carrying every vault in the profile plus
encrypted jar identity; one restore workflow — the same workflow for a
fresh profile and an existing one, and the same workflow that "import"
has always been — walks file pick → bundle secret → a mapping step with
decrypted labels, where the operator explicitly directs each vault to an
existing jar, a new jar, or nowhere, with Replace-or-Merge on collision;
fresh adopt stops minting an admin key and surfaces exactly one
dismiss-locked recovery sheet; and after any fresh adopt the operator is
offered — never forced into — a master-password change that severs the
donor's envelope. The flight also clears its runway first: the main.js
vault-glue extraction the Flight 2 debrief ordered, and the operator-ruled
sheet blur-behavior change.

### Open Questions

- [x] Item-merge identity → ruled: item id (see DD4)
- [x] Item-collision resolution → ruled: keep both, mark incoming (DD4)
- [x] Held-bundle lifetime → ruled: drop on lock/close, no suppression
      (DD5)
- [x] Sever offer transient vs persistent → ruled: session card (DD7)
- [x] Blur dismissal → ruled: credential sheets survive blur (DD8)
- [x] HAT shape → ruled: separate guided HAT leg before the witnessed
      runs

### Design Decisions

**DD1 — Bundle v2: multi-vault, all-ciphertext, jar identity included.**
`version: 2` bundles carry `{ format, version: 2, managerVersion, kdf,
mrk, adminPublicKeyB64?, vaults: [...] }` where each vault entry carries
the vault document (same shape as today's single `vault` field), its
source vault id, and **encrypted jar identity metadata** (`{ name,
color }` — the portable subset of the jar record; the stored record
(`jars.js:8`) also carries `id`/`partition`/`retentionDays`, all
destination-local and deliberately NOT carried; the global vault
carries none). Jar metadata is ciphertext keyed under the bundle's MRK
(exact wrapping shape is leg design; requirement: nothing human-readable
before the bundle secret is entered — mission constraint), AAD-bound to
the bundle context. **v1 bundles remain accepted on import** as the
one-vault case of the same flow — the single hard gate at
`vault-store.js:1559-1561` widens to `{1, 2}`. Export requires the
unlock window as today (`vault-store.js:1472` policy) and enumerates
GLOBAL + every jar vault that exists on disk (lazy vaults absent by
design). The admin pair rides only when provisioned (DD7 semantics from
Flight 2, unchanged).
- Rationale: one bundle, one secret, everything ciphertext — the
  operator ruling from mission planning. Jar identity is name + color
  because that is all a jar has.
- Trade-off: a v2 bundle from a partially-lazy profile silently carries
  fewer vaults than the profile has jars; the export result and docs
  state which vaults were carried.

**DD2 — One restore workflow: commit-time destination binding with a
decrypted-labels mapping step (O2 reshape).** The current pick-time
`destinationTarget` hold (`main.js:1049-1052`) is replaced by: (1) file
pick holds `{ bundle, handle }` only; (2) the bundle-secret sheet
verifies the secret and returns **decrypted mapping labels** (per-vault:
source jar name/color, item count) to the page — no key material crosses
to the renderer; (3) the page's mapping modal (Flight 1 O4 approved
baseline: calmed merge-default layout) collects one explicit directive
per vault — existing jar / new jar (name + color, prefilled from bundle
metadata) / skip — plus Replace-or-Merge where the destination already
holds a vault; (4) commit sends the full mapping to main, which runs the
restore and returns per-vault outcomes (DD3). Fresh profile and existing
profile run the same flow; fresh simply has no existing-jar destinations
besides "new jar" and Global, and ends in the adopt surfacing (DD6). The
existing single-modal `fresh` split (`vault.js:644-661`) converges into
this one flow; the two current entry buttons remain, both opening the
same workflow.
- Rationale: F1 ruling O1/O2 (operator-emphatic: one button, one
  workflow); fresh mode already has the destination-less shape, so
  unification deletes modal complexity.
- Trade-off: two round-trips to main (secret, then commit) with held
  state between them — governed by DD5.
- **Pinned-shape casualties (design review)**: the reshape breaks
  `test/unit/vault-pending-imports.test.js` (whole file pins the
  `{ bundle, destinationTarget }` hold shape) and
  `test/unit/vault-request-triggers.test.js:207-208` (fakes the
  `vaultImportBegin(destinationTarget, chromeId)` signature) —
  rename/re-model per the pinned-test rule.

**DD3 — Per-vault atomicity, per-vault outcomes; rerun is the recovery
path.** The restore commits vault-by-vault: for each directed vault,
(a) create the destination jar if directed (`jars.add(name, color)` —
directly callable from main, `jars.js:400-419`; the resolver requires
the jar to exist before the vault write), **(b) verify the registry
entry actually persisted before writing the vault** — `jars.js`'s
`save()` is deliberately fail-soft (`jars.js:374-379`, swallowing
try/catch) and `add()` pushes in-memory before saving and returns the
container regardless, so an unverified create could land a vault file
under a jar that evaporates on restart. **This verify step is NEW
jars.js surface** (cycle-2 review: today's API cannot distinguish
"added" from "added but the write silently failed" — the backing
`docStore` is module-private): the leg adds either a success return on
`save()` or a `verifyPersisted(id)` read-back; the underlying write is
synchronous and cheap. A failed persist yields outcome `failed` for
that vault with no vault write —
(c) write the re-keyed vault file. Each vault's write uses the atomic
single-file path (`writeFileAtomic`). **Structural fact (design
review): the jar registry lives outside `vaultsDir` and
`vault-txn.beginTransaction(dir, members)` is single-directory — jar
creation can NEVER join a vault-txn transaction alongside
manager/vault writes.** Fresh adopt's manager write therefore relies
on the existing vault-before-manager ordering
(`vault-store.js:1512-1515`) — a failure never flips `isSetUp()` true
without a vault — with `vault-txn` reserved for a genuine same-dir
multi-file commit set if the leg finds one. A mid-list failure leaves
earlier vaults landed and later ones untouched; **rerun recovers**
(the mission's ruling — full transactionality is reserved for
compromise mode). **Concurrency (named, pre-existing exposure
multiplied)**: the restore joins the gated ops (DD10) but the gate
does not serialize two concurrent restores against each other; the leg
adds a single-flight guard on the restore path (or rides
`_withManagerLock` for its manager-touching phase) — decided at leg
design, but not silently. The restore returns an ordered result: per
vault `{ sourceId, outcome: landed | skipped | collision-refused |
failed, destination, mergeReport? }`, where `mergeReport` carries
DD4's counts; the result also carries a **generation-identity field**
(timestamp + nonce — the Flight 2 debrief's evidence-cheapening item,
added to the compromise revocation report surface in the same touch).
- **Jar-id reconciliation (recon finding):** the created jar's id may
  differ from the bundle's source id (`jars.add` uniquifies slugs with
  `-N`); the vault lands under the **destination** jar's id — source
  ids never survive into the destination profile, and the result maps
  source → destination explicitly.
- **Adopt-rerun residue:** a failed fresh adopt may leave created jars
  with no manager; the rerun's mapping step lists existing jars as
  destinations, so the operator maps onto the residue instead of
  duplicating it. The degenerate "skip everything except one jar vault"
  adopt is legal (lazy global — a known representable state).
- Rationale: per-vault outcomes were pre-named by the mission open
  question — a single ok/error shape would force an IPC reshape later.

**DD4 — Merge semantics: id identity, keep-both on divergence, no
picker (operator rulings).** Two items are "the same" iff their ids are
equal (bundles from a forked profile share ids; content is never used
for identity). Merge of a bundle vault into an existing vault:
same id + identical content → skip (already present); same id +
differing content → the incoming item lands **as a copy under a fresh
id, visibly marked as imported** (exact marking is leg design — e.g. a
name suffix); different ids always coexist. Merge is therefore
**non-interactive** — no conflict picker, no blocking step — and the
per-vault `mergeReport` states `{ imported, skippedIdentical,
conflictCopies }`. Replace remains whole-vault destruction behind the
existing explicit confirm (`VaultCollisionError` machinery,
`vault-store.js:1696-1707`).
- Rationale: zero data loss without a heavy mid-restore UI; the
  operator cleans up marked copies at leisure.
- Trade-off: diverged items accumulate as duplicates until manually
  reconciled; the report makes them findable.

**DD5 — Held-bundle lifetime: drop on lock/close, no suppression
(operator ruling).** The held bundle (and any derived key material)
is dropped on: vault lock (including autolock — **autolock is NOT
suppressed during mapping**), owning-window close, explicit
cancel/dismiss, successful commit, and app quit. Re-entering the bundle
secret fully resumes — unlike a one-time reveal, nothing is
unrecoverable, so the F4 suppression machinery is deliberately not
extended here. Implementation: `_pendingVaultImports` gains a
lock-event hook and joins the `releaseVaultHoldsForWindow` teardown
(`main.js:1488`) — **closing the existing window-destroy leak found at
recon**. Decrypted label material handed to the page is non-secret
(jar names/colors, counts) and needs no teardown beyond modal close.

**DD6 — Adopt simplification: no admin mint, single sheet, chain
machinery removed (Flight 2 DD8, implemented here).** Fresh adopt stops
minting an admin pair (`vault-store.js:1668-1669` — the comment
pre-names this flight); the adopted manager carries no admin provision
(v2 optional-admin, DD1/F2 — `_readManager`'s no-admin validation
verified already-shipped at design review **for v2 only**; leg-2
design review found v1 managers still REQUIRE the admin pair, and v1
is the default never-rotated state — leg 2 ruling 10 relaxes the v1
branch to the same optional-but-paired rule, the only shape compatible
with retaining the version-AAD-bound donor master envelope on a
recovery-kind adopt), and the adopt result loses
`adminPrivateKeyB64`. The surfacing chain collapses to the single
dismiss-locked `vault-recovery-show` sheet riding the refcounted
suppression holder, **and the adopt reveal joins the stash-then-
resurface machinery** (design-review finding: today's adopt reveal is
a bare un-stashed `chrome.send` — `register-overlay-ipc.js:397-411` —
that a dying window loses forever, and this flight removes the
two-sheet chain's incidental second chance; `pending-compromise-
reveals.js`, whose header currently *discriminates against* the adopt
flow, generalizes or gains an adopt-parallel store so the one-time key
survives window death, per the mission's no-ad-hoc-sequencing
constraint. **Two concrete reuse obstacles, cycle-2 review — the leg
addresses both whichever option it picks**: `COMPROMISE_REASON =
'compromise'` is baked into stash/ack/rekey
(`pending-compromise-reveals.js:31`) and would mislabel adopt's
suppression hold; and `ack(chromeId)` returns a bare boolean that
`main.js:914-919` currently interprets as specifically-compromise —
folding adopt in needs a parameterized reason plus a flow
discriminator on the ack). F4's stash-then-chain machinery is deleted:
`_pendingAdoptAdminKeys` + stash/take (`main.js:850-868`), the
ack-chained admin send (`register-overlay-ipc.js:180-185`), and the
`'adopt'` suppression reason's stash-site acquire. **Pinned-test
inversions (rename/invert, never silent-edit; list expanded at design
review)**: the six admin-mint assertion sites in
`test/unit/vault-export-import.test.js` (`:247-248`, `:268-269`,
`:284-289`, `:346-347`, `:353-354`, `:369-373`); **two
admin-mint-on-adopt tests in `vault-manager-v2.test.js`
(`:509-569`, `:601-646`) that need structural REWORK, not a
rename/invert** — their AAD-homogeneity admin-slot verification has no
direct post-DD6 replacement target, so the leg budgets a redesign of
that coverage; squawk 0051's adopt-caller pins
(`window-factory.test.js:301-366` + the `clearPendingAdoptAdminKey`
injectable in `test/unit/helpers/window-factory-harness.js`); and the
ack-discrimination expectations in `vault-import-handler.test.js` /
`vault-compromise-handlers.test.js` that model the two-sheet chain.
The one-window reveal argument re-derives trivially: one secret, one
sheet, one suppression hold.

**DD7 — Sever offer: post-adopt session card routing to the EXISTING
step-up-carrying ops (operator ruling on persistence; mechanism
re-ruled at design review).** After any fresh adopt, a dismissible
offer card ("The previous owner's master password still opens this
profile — set your own?") sits on the vault page, held main-side as
plain in-memory session state — the `_compromiseReport` idiom
(`main.js:893-900`: survives page reloads, clears on dismissal or
relaunch; `manager.json` stays crypto-only). The offer states what it
severs. **No new store op and no new sheet**: the card's action opens
one of the two existing master-envelope flows, both of which carry a
real step-up and sever by construction —
- master-kind adopt → the existing change-master sheet
  (`changeMasterPassword`, `vault-store.js:999-1030` — the operator
  knows the donor password; its step-up is satisfiable and stays
  load-bearing);
- recovery-kind adopt (or post-lock, any kind) → the existing recover
  flow (`recoverMasterPassword`, `vault-store.js:1124-1155` — the NEW
  recovery key, which the operator recorded moments earlier at the
  adopt reveal, IS the step-up).
Main picks the route from the adopt's known `secretKind` (the literal
third parameter of `vaultImportFromSheet`, `main.js:1081`) **and the
current lock state** — post-lock always routes to recover, since
`changeMasterPassword` requires the unlocked window
(`vault-store.js:1010`) while `recoverMasterPassword` works from
locked. The card trigger reuses the existing bare-trigger IPC
(`internal-vault-request-change-master` / `-recover`,
`register-browser-ipc.js:333-339`) — no new channel. The original
draft's new "re-wrap under the live MRK without step-up" op is
**rejected**: design review showed it would be the only
master-envelope mutation with zero step-up proof, guarded only by a
durable session flag on a trust boundary that cannot distinguish the
vault page from other internal pages (`internal-ipc.js:20-24`) — the
flight's own divert trigger, fired at review rather than mid-leg. The
offer state is non-secret display state only; it gates nothing
cryptographic. Cost accepted: accepting the sever means re-entering a
credential the operator verifiably holds. Declining leaves the profile
fully usable (criterion 8).

**DD8 — Sheet blur behavior: vault credential sheets survive window
blur (operator ruling, reverses the shipped default).** Vault sheets
retain their half-entered state through window blur/refocus — the
operator's scenario is copy-paste from another secrets manager. The
dismiss-locked reveals already survive; this ruling removes the
asymmetry in the *survive* direction. Sheets still close on: submit,
explicit dismiss (where permitted), vault lock, and owning-window
close. **Mechanism (design-review corrected — this is NOT a discrete
flag flip):** blur-dismissal is dual-sited and app-wide. Main process:
`window-factory.js:333` (`win.on('blur', …)`) →
`menu-overlay-manager.js:372-410`, where ONE `dismissible` flag gates
`escape`/`outside-click`/`blur` together for EVERY sheet type in the
app; renderer process: an independent second copy of the guard at
`menu-controller.js:115-132`. The leg therefore introduces a **new
blur-survival axis on the sheet-open payload** (parallel to
`dismissible` — reusing `dismissible` would leak blur-survival to
bookmark-edit/auth-basic/cert-picker/downloads, out of scope), scoped
by an explicit vault-credential menuType allowlist, threaded through
**both** sites in the same leg (a one-sided change desyncs main vs
renderer). Evaluate extending the existing narrow `keepFocus` per-open
precedent (`menu-overlay-manager.test.js:1032-1060`) before inventing
a separate mechanism. **This is a behavior change to a
security-critical surface**: the leg pins the new contract
(survive-blur for allowlisted vault menuTypes, close-on-lock,
close-on-window-close; non-vault sheets keep blur-dismissal),
documents the trade-off (half-typed secret material persists in a
blurred window), and sweeps for blur-dismissal assumptions — known
pins: `vault-controller-capture.test.js:163` (credentials dropped on
reason `'blur'`), plus the harness expectations around
`closeMenuOverlay('blur')`. **Allowlist membership: `vault-unlock` IS
in scope** — it is the master-password entry point, the operator's
literal stated scenario; consequence: that pin's `'blur'` case becomes
a production-unreachable path and is dropped/annotated under the
rename-not-silent-edit rule (operator may veto at the spec walk). Consequence for the apparatus: the
behavior-test focus-hold / memorize-then-relay protocol is retired for
future specs (existing spec preconditions updated when next touched).

**DD9 — Main.js glue extraction lands before the new delegates
(Flight 2 debrief rec 1, remainder).** The error-class→reason ladder
(eight inline sites — count corrected at leg-1 design review, which
grepped all of `src/main/` and confirmed no others: `main.js:1119`,
`:1757`, `:1798`, `:1834`, `:1865`, `:1883`, `:1900`, `:1926`) is
extracted into a mapper module beside
`pending-compromise-reveals.js`, and `resurfaceCompromiseReveal`'s
composition (`main.js:934`) into a testable unit; the transcribed
copies in `vault-compromise-report-surface.test.js:90-92`,
`vault-stepup-mint-handler.test.js:284-286`, and
`vault-unlock-handler.test.js:86` are deleted in favor of importing the
real module. Flight 3's restore/sever delegates are then written **on**
the extracted mapper — never as a ninth transcription site.

**DD10 — Restore joins the gated ops.** The multi-vault restore entry
point takes `_enterGatedOp()` exactly as `importVault` does
(`vault-store.js:1536-1541`) and relies on the sinks' second wall for
its awaits. `test/unit/vault-rekey-gate.test.js` hard-codes "eight"
(`:6`, `:81`, `:84`) — the suite's wording and enumeration update with
the ninth op (rename/extend, not silent-edit).

**DD11 — Renderer surface budgets and lockstep registries accounted up
front (design-review finding).** `renderer.js` sits exactly at its
pinned line budget (`RENDERER_LINE_BUDGET = 1836`,
`test/unit/seam-contract.test.js:168`) with zero headroom — any
renderer wiring in legs 1 or 3 carries an explicit budget bump (the F2
accepted-deviation precedent), named in the leg spec, not discovered at
CI. If a leg introduces any new vault menuType (none is currently
planned — DD7 reuses existing sheets, the mapping modal is page DOM),
it performs the full lockstep registration: `TEMPLATES`/`NODE_OF_ENTRY`
(`menu-overlay.js:2716-2769`), the a11y skip list
(`scripts/a11y-audit.mjs:432` + `a11y-audit-sheet-skip.test.js`), and
`SEAM_COUNT` in `seam-contract.test.js` — the F2 leg-4 precedent.
`vault.js` (~2252 lines, gaining the mapping modal and completion
surface) gets a line-budget pin evaluated at leg design. Also noted
from review: the vault page's access-key list refreshes on window
`focus` (`vault.js:2239-2244`), not on mutation broadcasts — the
restore completion flow must land focus back on the page (or the leg
adds a broadcast-driven refresh) so the completion surface isn't stale.

**DD12 — Behavior-test apparatus for the adopt spec (act/observe
audited at planning).** Spec `multi-vault-adopt` (drafted at planning,
`tests/behavior/multi-vault-adopt.md`). **Act path**: page surfaces
(mapping modal is page DOM — drivable at admin tier); sheet steps
operator-performed (never-widen constraint); profile wipe + relaunch
via shell. **Observe path** (cited, both axes): mapping modal DOM /
screenshots via internal-page capture (admin tier); sheet presence via
`enumerateWindows.sheetVisible`; on-disk `manager.json` / `*.gfvault` /
jar registry via filesystem apparatus (flat `userData/vaults/`,
`vault-store.js:379-380`); negative replay probes via the Electron-free
store harness (`vault-key-rotation.test.js:21-51` idiom); per-vault
outcomes read from the completion surface DOM. The spec IS the
Flight-1-owed calibration walk: export → wipe → re-adopt, on script.
The compromise spec's **recovery-branch variant** runs on-script in the
same session (`tests/behavior/compromise-mode-rotation.md` Variants).

### Prerequisites

- [x] Flight 2 completed and merged (PR #199); squawk turnaround merged
      (PR #200) — `main` at 5eaec48
- [x] Recon report produced and retirements operator-confirmed
      (flight-log.md, 2026-09-02)
- [ ] Dev profile fixture for the HAT/behavior legs: multi-jar profile
      (≥2 jar vaults with items + global), admin + access keys minted
      per docs/dev-testing.md (DEV_MINT once, update MCP config, `/mcp`
      reconnect, relaunch without)
- [ ] Behavior-test apparatus probe (MCP admin attach + internal-page
      capture) before the witnessed-runs leg
- [ ] Operator availability: guided HAT session + two witnessed runs
      (adopt spec; compromise recovery-branch variant)

### Pre-Flight Checklist

- [x] All open questions resolved (ruled at planning interview +
      design-review cycle 2)
- [x] Design decisions documented (DD1–DD12; two Architect review
      cycles, both "approve with changes", all issues incorporated)
- [x] Prerequisites verified (fixture + apparatus probe deliberately
      deferred to the HAT/behavior legs, per the F2 precedent)
- [x] Validation approach defined (see Verification)
- [x] Legs defined

---

## In-Flight

### Technical Approach

Runway first, store second, workflow third, human verification last.
Leg 1 clears the substrate (glue extraction, blur rule) so later legs
build on testable modules and the ruled sheet behavior. Leg 2 does all
store-side work in the Electron-free harness (temp dirs, `FAST_SCRYPT`,
on-disk byte probes; adversarial replay per
`vault-key-rotation.test.js` idioms) — bundle v2 both directions,
multi-vault restore with per-vault outcomes and merge, adopt-no-admin
with the six pin inversions, the ninth gated op. Leg 3 rewires the
IPC/UI path (commit-time binding, decrypted labels, mapping modal on
the O4 baseline, held-bundle lifetime, sever card + op, chain-machinery
deletion) using the stubbed-sheet harness idioms. Legs 4–5 are the
operator's: a guided HAT walk of the whole workflow with inline fixes,
then the formal witnessed runs. Docs ride their owning legs
(`docs/vault.md` threat-model donor-password bullet + portability
section in legs 2–3).

**Wall-clock watch** (F2 debrief rec 5): leg 2's restore/adopt suites
are scrypt-heavy; if the battery nears ~10 s, drop `FAST_SCRYPT` N for
pure-machinery rows or introduce a tagged tier — decided at leg design,
not after the fact.

### Checkpoints

- [x] CP1: Substrate lands — mapper + resurface extraction with
      transcriptions deleted; blur contract flipped and pinned; suite
      green
- [x] CP2: Store lands — v2 export/import both directions (v1 still
      accepted), multi-vault restore with per-vault outcomes +
      mergeReport, adopt-no-admin (six inversions done), gated-op
      membership pinned (count landed at eleven — export/preview/
      restore all gated), adversarial replay green (donor recovery
      key dead post-adopt; donor master alive un-severed, dead
      post-sever)
- [x] CP3: Workflow lands — mapping flow wired end-to-end, held-bundle
      lifetime matrix pinned (lock/close/pagehide/timer/cancel/
      commit), sever card routing via the existing ops with the
      discrimination guard, chain machinery deleted with 0051 adopt
      pins retired
- [ ] CP4: Guided HAT satisfied — operator walked export → wipe →
      adopt-with-mapping → transplant → sever offer; fixes landed via
      the HAT protocol
- [ ] CP5: Witnessed runs pass — `multi-vault-adopt` (hybrid witnessed)
      and the compromise recovery-branch variant; docs verified telling
      the new truth

### Adaptation Criteria

**Divert if**:
- The restore-mapping UI grows into its own leg cluster or flight
  (pre-named in the mission's flight list)
- The sever offer turns out to need any mechanism beyond routing to
  the existing step-up-carrying ops (DD7's re-ruled shape) — stop and
  re-rule rather than shipping a step-up bypass *(the original
  new-op shape already fired this trigger at design review and was
  rejected there)*
- The blur-behavior sweep (DD8) reveals the dismissal is load-bearing
  for a surface this flight doesn't own — pause the leg, re-rule scope

**Acceptable variations**:
- Bundle-v2 field names, jar-metadata wrapping shape, marked-copy
  naming, card copy — leg-level
- Folding the generation-identity field (DD3) into whichever leg
  touches the report surface naturally

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are
> planned and created one at a time as work progresses.

- [x] `substrate-prep` — DD9 glue extraction (mapper module +
      resurface composition, transcriptions deleted) + DD8 blur
      contract (new blur-survival axis threaded through BOTH main and
      renderer guard sites, vault-menuType allowlist, pins + assumption
      sweep, close-on-lock added) + any renderer.js budget bump named
      per DD11; MED-HIGH risk — design review ran (2 cycles)
- [x] `bundle-v2-store` — DD1 bundle v2 export/import, DD3 multi-vault
      restore op with per-vault outcomes + jar creation/reconciliation
      + generation-identity field, DD4 merge, DD6 store half
      (adopt-no-admin + inversions + v1-manager relaxation), DD10
      gated-op membership; HIGH risk — design review ran (2 cycles)
- [x] `restore-workflow-wiring` — DD2 IPC reshape + mapping modal (O4
      baseline), DD5 held-bundle lifetime, DD6 wiring half (single
      sheet + adopt-reveal stash/resurface, chain deletion, 0051
      retirement), DD7 sever card routing to the existing flows, DD11
      budget/lockstep/focus-refresh accounting; HIGH risk — design
      review ran (2 cycles)
- [ ] `guided-hat-restore` *(interactive)* — operator-guided walk:
      whole-profile export, wipe, fresh adopt with mapping (existing
      jar + new jar + skip), selective transplant with Replace and
      Merge, sever offer both actions; inline fixes per HAT protocol
- [ ] `witnessed-runs` — finalize + run `multi-vault-adopt` (hybrid
      witnessed); run the compromise recovery-branch variant
      on-script; docs verification

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing (suite + typecheck + lint)
- [ ] Documentation updated (`docs/vault.md` portability + threat
      model; CLAUDE.md if commands/counts change)

### Verification

- **Criterion 4 (whole-profile export)**: unit tests — v2 bundle
  carries every on-disk vault + encrypted jar metadata; no plaintext
  anywhere in the bundle (byte-scan assertion, existing idiom from
  `vault-export-import.test.js:165`); lazy-vault omission stated in the
  result.
- **Criterion 5 (one workflow, mapping, merge)**: store-level tests for
  every directive (existing jar / new jar / skip / replace / merge with
  all three mergeReport classes); handler tests for commit-time binding
  and held-bundle lifetime; the guided HAT walks the real modal; the
  behavior test pins the fresh-adopt composition.
- **Criterion 6 (adopt guarantees)**: adversarial adopt tests (donor
  recovery key + donor admin key dead post-adopt; no admin provision
  present; forced rotation) + `/behavior-test multi-vault-adopt`.
- **Criterion 7 (selective transplant)**: store tests — subset restore
  re-keyed under destination MRK, source ids reconciled; HAT includes a
  transplant.
- **Criterion 8 (sever offered never forced)**: unit tests — offer
  state lifecycle (set on fresh adopt, cleared on dismissal/act, gone
  after relaunch), route selection by adopt `secretKind`, and the
  post-sever end state (donor password dead, all else untouched —
  exercised through the EXISTING ops' own pinned paths); decline
  leaves profile usable; HAT exercises offer + decline + accept.
- **Criterion 9 (docs)**: threat-model donor-password bullet updated;
  portability docs describe bundle v2 + mapping; verified at CP5.
- **DD8 blur contract**: unit pins on the sheet substrate for
  survive-blur + close-on-lock/close-on-window-close across vault
  menuTypes.
