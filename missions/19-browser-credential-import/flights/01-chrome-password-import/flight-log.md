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

