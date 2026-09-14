# Flight: Chromium Family Breadth

**Status**: in-flight
**Mission**: [Browser Credential Import](../../mission.md)

## Contributing to Criteria
- [ ] The Chromium family comes in on the same path (Edge verified; source generalized)
- [ ] Docs tell the new truth (the Chromium-family half)

---

## Pre-Flight

### Objective

Bring Edge — and, by generalization, any format-compatible Chromium browser —
onto Flight 1's landed Chrome-CSV import pipeline, and stop telling the operator
"Chrome" when the export came from another browser. A real Edge export was
verified at planning to be **byte-identical** to Chrome's, so the parser,
adapter, content-identity dedupe, and commit already handle it unchanged; the
flight's substance is (a) paying down the thrice-named `vault.js` restore-modal
extraction for durable headroom, and (b) generalizing every Chrome-specific
user-facing string and the export detector's contract to the Chromium family
(generalized guidance, no source picker — operator ruling), then verifying a
live Edge import in a guided HAT.

### Open Questions

- [x] Does Edge's export format diverge from Chrome's? → **DD1** — no. A real
      Edge export's header is byte-identical (`name,url,username,password,note`)
      and its rows exercise the same taxonomy Flight 1 built. The mission's
      divert trigger does NOT fire.
- [x] Source identification / per-browser guidance? → **DD2** — Chrome and Edge
      exports are indistinguishable by content, so source is undetectable;
      operator ruling: **generalized Chromium-family guidance, no source
      picker, no source tag**.
- [x] Does Edge activate the dormant `blocklist` reason code? → **DD3** — no.
- [x] `vault.js` headroom for the flight? → **DD4** — leg 1 extracts the
      restore modals (operator ruling: bundle it here), buying headroom and
      paying the M18 F3 debt, even though the (now-small) Edge work does not
      itself touch `vault.js`.
- [x] Guided HAT? → **DD5** — yes (leg 3, optional).

### Design Decisions

**DD1 — Edge is format-compatible with Chrome; the pipeline is unchanged.**
A real Edge password export, inspected at planning (header + structure only, no
credential values read), has the header `name,url,username,password,note` —
byte-identical to `browser-import.js`'s `CHROME_HEADER`. Its 8 data rows
exercise exactly the cases Flight 1 already handles: 2 empty-password rows
(federated logins → `no-password` skip), 3 empty-username rows (imported), 1
`android://` row (`non-web-origin` skip). So `parseCsv` / `adaptChromeRows` /
`planLogins` / `importLogins` accept an Edge export **as-is** — `detectChromeExport`
already passes it because the header matches.
- Rationale: verify the empirical premise before designing (Flight 1 debrief) —
  done, against a real file. The mission's "a browser whose export format
  diverges enough to need its own adapter path" divert trigger does not fire.
- Trade-off: none — the format identity is a gift, not a risk. (The HAT is the
  live re-confirmation on a full real export.)

**DD2 — Generalized Chromium-family guidance; NO source picker, NO source tag.**
Because Chrome and Edge exports are byte-identical, the source cannot be
detected from file content; the operator ruled against a source picker. So leg 2
generalizes every Chrome-specific USER-FACING surface to the Chromium family
without introducing a source concept: the pick-modal guidance lede
(`vault-browser-import-controller.js:91-92`, "In Chrome … chrome://password-manager
…") becomes browser-generic Chromium guidance; the refusal copy
(`:54`, "That file isn't a Chrome password export.") becomes browser-generic;
`detectChromeExport` / `CHROME_HEADER` / the error code semantics generalize in
name and contract to "a recognized browser export" (an internal rename is an
acceptable variation). No per-browser instructions, no source label in the
outcome report, no source field in `summary`, no change to the resume slot.
- Rationale: operator ruling; honest — we cannot name a source we cannot detect.
- Trade-off: the operator gets Chromium-family guidance rather than
  step-by-step per-browser instructions (accepted).

**DD3 — The `blocklist` reason stays dormant.**
The real Edge sample's empty-password rows are federated logins (already
`no-password`), not a distinct never-saved/blocklist marker shape — exports
contain only saved credentials. No `blocklist`-emitting code path is added; the
reserved reason stays reserved.
- Rationale: confirmed against the real export, not assumed.

**DD4 — Leg 1 extracts the restore/export modals from `vault.js` into a new
injected-deps controller (the M18 F3 debt, paid here) — a behavior-preserving
move WITH an explicit state-ownership handoff, not a verbatim copy.**
`vault.js` is at its 2820 line-budget ceiling. Leg 1 moves the restore/export
modals — `openImportPickModal` (`:715`), `buildColorSwatchGrid` (`:813`),
`openMappingModal` (`:931`), `openCompletionModal` (`:1213`), **and
`openExportModal` (`:568`)** — plus their local-only helpers (`appendOption`
`:786`, `NEW_JAR_FALLBACK_COLOR` `:792`) into a new
`src/renderer/pages/vault-restore-controller.js` following the
`vault-browser-import-controller.js` / `vault-nav-controller.js` injected-deps
precedent (`createVaultRestoreController(deps)`). The behavior is preserved
verbatim (every DOM hook, the HAT-tuned copy, the DD5/DD8 restore semantics),
but three couplings must be handled deliberately — this is NOT a blind cut:
- **`pendingImportRecord` becomes controller-owned closure state (Architect
  high-finding).** It is read/written at SIX sites, only three of which are
  inside the moved functions; the rest stay in `vault.js` (the "Resume restore…"
  banners `:1281-1282` and `:1687-1690`, `refresh()`'s write `:2747`, the
  `onVaultImportLabelsReady` handler `:2786-2787`, the `pagehide` drop `:2800`).
  A literal move would leave two out-of-sync copies. Instead `pendingImportRecord`
  moves into the controller as closure state exposed via a getter + loader —
  mirroring `browserImport.heldRecord()` / `loadHeld()` exactly
  (`vault-browser-import-controller.js`, consumed at `vault.js:1696`) — and
  `vault.js`'s five external sites are rewritten to call the controller's
  accessor/loader, never the bare variable.
- **`openExportModal` is extracted alongside the restore modals (default, not
  optional).** It shares `buildVaultSelect` (`:538`) with `openMappingModal`;
  extracting both keeps that helper's consumers in one file rather than
  threading `buildVaultSelect` into the deps bag (Architect medium — option a).
- **New internal-page route + convention.** `vault-restore-controller.js` gets
  a `/vault-restore-controller.js` entry in `internal-page-map.js`'s vault route
  and is imported flat with the `// @ts-ignore` convention (`vault.js:31-32`);
  `internal-page-map.test.js`'s exact-allowlist `deepEqual` and the
  `internal-page-route-closure.test.js` guard both enforce this (they go red on
  a missed route — the New-shared-module checklist).
- **Frozen-contract note**: the restore flow is HAT-tuned (M18 F3) and pinned by
  `test/unit/vault-restore-workflow-invariants.test.js`, which SOURCE-SCANS
  `openMappingModal` / `buildColorSwatchGrid` / **`openExportModal` (`:321`,
  `:344`)** by name in `vault.js`. The extraction RETARGETS every one of those
  scans to the new controller file (a mechanical move of the pins, not a
  deletion) — the same discipline Flight 1's HAT-fix-3 used. `render(state)`'s
  scan (`:109`) and the generic `openModal` scan (`:405`) stay — neither is
  extracted.
- Rationale: operator ruling to bundle it; pays a debt named at the end of two
  consecutive flights; buys headroom for any future vault-page work.
- Trade-off: a substantial behavior-preserving refactor rides a small feature
  flight. Mitigated by the state-ownership + frozen-contract discipline + the
  full green bar + the leg-1 checkpoint (no behavior change permitted).

**DD5 — Guided HAT on a real Edge export (leg 3, optional).**
A live import of a real Edge export closes the flight: items land, dedupe/outcome
report read true, the android/federated/empty-username rows are reported, and the
generalized guidance reads correctly for a non-Chrome source.

### Prerequisites
- [x] Standing green bar at flight start: `npm test`, `npm run typecheck`,
      `npm run lint`, `npm run format:check` all clean (main at v0.16.0 + the
      2026-09-11 turnaround, c98bed3).
- [ ] A real Edge password export for the Leg 3 HAT (operator produces it at HAT
      time; the planning sample already confirmed the format — the HAT re-checks
      on a full real export). Contains real credentials; never committed.
- [x] No environment conflicts: this flight adds no network service, port, or
      DB — a page-side refactor + copy/doc generalization + existing pipeline.

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

**Leg 1 — restore-modal extraction (page-side, behavior-preserving).** Move the
restore-flow modals out of `vault.js` into a new
`vault-restore-controller.js` (injected-deps, the `vault-browser-import-controller.js`
precedent), retarget the `vault-restore-workflow-invariants.test.js` source
scans to the new file, and confirm `vault.js` drops under budget with headroom.
No behavior change; the M18-tuned restore contract is frozen and moved verbatim.

**Leg 2 — Chromium-family generalization (small).** Generalize every
Chrome-specific user-facing string (guidance lede, refusal copy) and the export
detector's naming/contract to the Chromium family (DD2); confirm the existing
pipeline accepts the Edge-shaped (identical) header with a unit test; update
`docs/vault.md`'s "Browser import (Chrome)" subsection and CLAUDE.md's
Browser-import bullet to "Chromium browsers". No source picker, no `summary`
source field.

**Leg 3 (optional) — guided HAT.** A live Edge import end-to-end on a real
export, per the Flight 1 HAT shape (the debrief's "spend HAT budget on the
un-unit-testable" guidance).

### Checkpoints
- [ ] CP1: Leg 1 — the restore/export modals live in
      `vault-restore-controller.js`; `pendingImportRecord` is controller-owned
      (getter/loader, no bare-variable access from `vault.js`); `vault.js` is
      under budget with real headroom and `VAULT_PAGE_LINE_BUDGET` lowered to
      lock it in; the retargeted restore invariants (incl. the `openExportModal`
      scans), the new-route tests, and the full green bar are green; a diff
      review confirms NO behavior/DOM-hook change. Belt-and-suspenders: a
      one-time manual open-the-app spot check of pick → mapping → completion (+
      export) modals (there is no DOM/jsdom harness for this page — Architect
      suggestion).
- [ ] CP2: Leg 2 — no Chrome-specific user-facing string remains (grep-AC); a
      unit test proves the Edge-shaped header is accepted and the generalized
      refusal copy renders; `docs/vault.md` + CLAUDE.md say "Chromium".
- [ ] CP3: Leg 3 (if taken) — a real Edge export imports end-to-end; dedupe,
      outcome report, and the android/federated/empty-username rows behave; the
      generalized guidance reads right for a non-Chrome source.

### Adaptation Criteria

**Divert if**:
- The leg-1 extraction balloons past "move the restore modals" into an
  open-ended `vault.js` re-architecture — land only the room needed, log the
  rest (the Flight 1 divert boundary, reused).
- The Leg 3 HAT reveals a real Edge export DOES diverge from Chrome after all
  (the planning sample did not) — then leg 2's generalization needs a
  source-specific adapter path (the mission's pre-named divert trigger), split
  into its own leg.

**Acceptable variations**:
- The exact new controller filename and the internal rename of
  `detectChromeExport`/`CHROME_HEADER`.
- The precise wording of the generalized Chromium guidance and refusal copy.
- **Leg order.** The two build legs are independent (leg 2 touches
  `vault-browser-import-controller.js` + `browser-import.js` + docs; leg 1
  touches `vault.js`). They may be resequenced at execution — running the small
  leg 2 first banks the mission-visible Edge value before the riskier
  extraction (Architect suggestion). The operator's "extraction as leg 1"
  ruling stands as the default; the flight log records the order actually run.

### Legs

> **Note:** Tentative; planned and created one at a time as the flight
> progresses.

- [x] `restore-modal-extraction` - move the restore + export modals (incl.
      `openExportModal`) from `vault.js` into a new injected-deps
      `vault-restore-controller.js`; `pendingImportRecord` becomes
      controller-owned (getter/loader); add the internal-page route; retarget
      the source-scan invariants; behavior-preserving; `vault.js` under budget,
      `VAULT_PAGE_LINE_BUDGET` lowered. (DD4)
- [x] `chromium-generalization` - generalize the Chrome-specific guidance,
      refusal copy, and detector naming/contract to the Chromium family
      (generalized guidance, no source picker); confirm the pipeline accepts the
      Edge header; update docs. (DD1–DD3)
- [ ] `hat-edge-import` *(optional)* - guided HAT: a live Edge import on a real
      export, per the Flight 1 HAT shape. (DD5)

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing (green bar: test / typecheck / lint / format:check)
- [ ] Documentation updated (`docs/vault.md` §"Browser import" incl. its several
      Chrome mentions at `:544-545,:556,:608` + CLAUDE.md's Browser-import
      bullet → "Chromium browsers")
- [ ] `vault.js` under budget with headroom, and `VAULT_PAGE_LINE_BUDGET`
      LOWERED to the post-extraction count + a small buffer (lock in the
      headroom rather than leave 2820 as a re-accretion ceiling — the explicit
      Architect-flagged call). The new `vault-restore-controller.js` gets NO
      line budget, matching its sibling `vault-browser-import-controller.js`.

### Verification

- **Unit** (Leg 1): the retargeted `vault-restore-workflow-invariants.test.js`
  scans pass against `vault-restore-controller.js`; the full existing restore
  suite stays green (behavior preserved); a `vault.js`-line-count assertion
  shows headroom.
- **Unit** (Leg 2): a `browser-import` / flow test asserting the Edge-shaped
  header (identical to Chrome) is accepted by the detector, and the generalized
  refusal copy renders. **Grep-AC — TARGETED, never a bare `grep -ri chrome`**
  (goldfinch's own window-"chrome" naming — `byChrome`, `chromeId`,
  `windowForChrome`, `getChromeTarget` — pervades `src/main/vault/` and is
  UNRELATED to Google Chrome; a broad grep drowns real hits in false
  positives). Scan only the Google-Chrome-specific user-facing phrases in the
  exact files that carry them:
  `grep -nE "Chrome password export|chrome://password-manager|In Chrome,|Chrome-export" src/renderer/pages/vault-browser-import-controller.js docs/vault.md CLAUDE.md`
  → zero hits after leg 2.
- **Guided HAT** (Leg 3): a live import of a real Edge export end-to-end.
- **No two-agent behavior test.** As in Flight 1, the import is deterministic
  and its observables are unit-checkable (parsed rows, on-disk ciphertext,
  generalized copy) or covered by the guided HAT; a witnessed spec would be
  over-investment. Recorded as a deliberate choice.
