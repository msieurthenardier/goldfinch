# Flight: External-consumer enablement + README reframe

**Status**: completed
**Mission**: [First-Class Browser Automation Surface](../../mission.md)

## Contributing to Criteria
- [x] **SC6** — The capabilities are exposed over an **MCP-compatible interface** an external client can
  discover, invoke, and drive end to end. The drive capability is **already demonstrated** (operator
  has driven Goldfinch from the-one, a native external install, over the loopback surface). This flight
  **closes SC6 by finalizing it as a documented, stable consumer contract** and confirming the
  documented getting-started path works — it does **not** build or re-prove drive capability.

> **Use cases served:** (2) external Claude Code sessions attaching Goldfinch as an MCP browser, and
> (3) agentic platforms (the-one). Both are **already wired and demonstrated**; this flight turns the
> existing surface into a first-class, documented contract and reframes the project's front door
> (README) to describe the automatability pillar that now exists.

> **Source artifacts**: the mission roadmap (Flight 10), and the **F9 debrief** carried items
> (Rec 3 — promote the inject-then-run + internal-session-exclusion notes to stated boundaries, add
> `runSerialized` to dev-patterns; Rec 5 — `createJar`, **deferred** here, see Out of Scope). See the
> flight-log Reconnaissance Report for the per-item classification against current code.

---

## Pre-Flight

### Objective
Turn the existing, already-demonstrated automation surface into a **finalized external-consumer
contract** and reframe the project's front door. Concretely: (a) **reframe the README** from a
media-panel-only description to the control / privacy / **automatability** triad now that the
automation surface exists to describe, with a pointer into the consumer reference; (b) **consolidate
the scattered security/behavior notes** in `docs/mcp-automation.md` into a single stated **Consumer
Contract** (the stable guarantees an external consumer can rely on) plus one consolidated
**getting-started** narrative for the production (Settings-key) path; (c) carry the **F9 Rec-3
dev-pattern** items into `CLAUDE.md`; (d) **confirm the documented getting-started actually works** by
running the example client against an enabled surface, reconcile any doc drift, and **mark SC6 met**.
No new MCP tools, no new transport, no new capability — documentation + verification only.

### Open Questions
- [x] **OQ1 — Is the cross-boundary "reach" (host-networking / shim) in scope?** → **RESOLVED: NO.**
  The surface binds `127.0.0.1` by design (SC7). How a consumer's process routes packets to that
  loopback is the **consumer's environment concern**, not Goldfinch's problem domain. the-one is now a
  **native install** (no container boundary), so even the original shim motivation is gone. The
  contract Goldfinch owns is exactly: *binds loopback, gated by a key.* Documented as a stated boundary;
  nothing is built or proven for reach.
- [x] **OQ2 — What closes SC6?** → **RESOLVED (operator): the existing the-one demonstration is the
  SC6 demonstration.** This flight documents the contract + confirms the documented getting-started
  path works via the example client; it does **not** author a new standalone-external-client behavior
  test. (The `mcp-drive-end-to-end` behavior test already exists as recorded backing.)
- [x] **OQ3 — Is `createJar` (jar-lifecycle MCP tool) in scope?** → **RESOLVED (operator): DEFERRED.**
  Kept out to keep this flight a focused closeout; becomes its own scoped item later (it adds a
  security-boundary design pass — admin-gated jar provisioning — that doesn't belong in a docs flight).

### Design Decisions

**DD1 — SC6 is closed by documentation, not new capability.**
- Choice: treat the operator's existing external drive (the-one → Goldfinch over loopback) as the SC6
  demonstration. The flight's deliverable is a **finalized, stable consumer contract** + a verified
  getting-started, not a new drive harness or behavior test.
- Rationale: the surface, the 21-tool reference, the example client, the auth/settings model, and the
  `mcp-drive-end-to-end` behavior test all already exist and are accurate (tool counts already say 21
  in both `CLAUDE.md` and `docs/mcp-automation.md`). The remaining gap is *framing and consolidation*,
  not function.
- Trade-off: SC6 is marked met on the strength of a demonstrated-but-not-freshly-witnessed drive plus a
  live getting-started confirmation, rather than a new Witnessed behavior test. Accepted per OQ2.

**DD2 — Reach is out of Goldfinch's domain; state it as a boundary.**
- Choice: the Consumer Contract states plainly that Goldfinch binds loopback-only and that **reaching
  the loopback endpoint from the consumer's process is the consumer's responsibility** (trivial when
  co-resident on the host; a networking concern of theirs otherwise). No shim, no host-networking
  affordance, no documentation of one.
- Rationale: OQ1. Binding beyond loopback would violate SC7. the-one being native removes the only
  real-world cross-boundary case.

**DD3 — "Finalize the contract" = consolidate existing notes into one stated section, not rewrite.**
- Choice: in `docs/mcp-automation.md`, gather the already-present but **scattered** guarantees into a
  single stated **Consumer Contract** section: (i) off-by-default / opt-in / key-gated / loopback-only
  (the reach boundary, DD2); (ii) the **`injectScript`-then-immediate-`evaluate` no-persistence
  pairing** (currently an inline note at the eval-tools reference); (iii) the **internal-session
  (`goldfinch://settings`) eval/devtools exclusion even for admin** as a hard boundary (currently inline
  at the eval/devtools notes); (iv) result/refusal semantics as the stable error contract (already a
  section — cross-reference, don't duplicate). Promote these from "notes" to "guarantees a consumer can
  build against." Add one consolidated **getting-started for the production path** (enable in Settings →
  generate a per-jar key → add the `.mcp.json` entry at the live port → run a client), distinct from the
  existing dev `AUTOMATION_DEV_MINT` dogfooding path.
- Rationale: F9 Rec 3. The facts exist and are correct; what's missing is a single authoritative place a
  consumer can read the contract instead of reconstructing it from inline asides.
- Trade-off: some controlled duplication (the contract section restates guarantees that also live at
  their tool reference). Mitigated by cross-referencing rather than copying prose.

**DD4 — README reframe keeps the auto-generated DOWNLOADS block untouched.**
- Choice: reframe the README intro + add an automation/automatability section, but **never hand-edit**
  the region between `<!-- DOWNLOADS:START -->` and `<!-- DOWNLOADS:END -->` (owned by
  `scripts/update-readme.mjs`). The reframe reorders/expands the human-authored prose around it and adds
  a pointer to `docs/mcp-automation.md`; it does not touch download tables or the release-automation seam.
- Rationale: the DOWNLOADS block is machine-generated; editing it by hand would be reverted on the next
  release and could break the marker regex.

**DD5 — `runSerialized` dev-pattern carryover (F9 Rec 3, bundled).**
- Choice: add the **`runSerialized` async-serialization mutex** shape (the rejection-isolation +
  identity-self-clear pattern surfaced in F9; lives at `src/main/automation/toggle.js:52`) to
  `CLAUDE.md`'s dev patterns, alongside a one-line pointer to the inject-then-run pairing now stated in
  the contract. Internal contributor guidance, not consumer-facing.
- Rationale: F9 explicitly carried this to F10; it's doc-only and rides the same documentation sweep.
- Trade-off: marginally off the "external-consumer" theme; kept because it's a tracked carryover with
  near-zero cost on the same surface, not new scope.

**DD6 — Reconcile the example client to the documented contract (Architect H1/M1 — the one source edit).**
- Choice: `scripts/mcp-example-client.mjs` — the script the getting-started tells consumers to run — is
  **stale and broken against the real auth gate**: it constructs a bare `StreamableHTTPClientTransport`
  with **no `Authorization` header** (so it `401`s on `initialize` — `mcp-server.js:490-491,533-537`),
  and its header comment claims "17 tools" (actual: 21). Fix it to attach `Authorization: Bearer <key>`
  from an env var, mirroring the working harness `scripts/lib/mcp-client.mjs:80`, and correct the count.
  This is the **single non-doc edit** in the flight — a consumer-facing example script, not automation
  engine source — and it is the prerequisite for an honest SC6 close (the verify-leg's live run can't
  pass otherwise).
- Rationale: the example client *is* the contract's worked example; a getting-started that points at a
  script that can't authenticate is not a finished contract. Architect H1/M1.
- Trade-off: turns a strictly docs-only flight into docs + one reconciliation edit. Accepted — without
  it, SC6 cannot be marked met, which is the flight's whole point.

### Prerequisites
- [x] **F9 landed + merged** to `main` (PR #54, 2026-06-17) — the surface and its 21-tool reference are final.
- [ ] **GUI display (WSLg) + an enabled surface** for the getting-started confirmation run
  (`npm run dev:automation` brings the surface up and mints a dev key; the example client drives it).
  The example client uses only HTTP-transport tools (open tab / navigate / screenshot / readDom) — it
  does **not** need coordinate-click or detached-DevTools, so it is **not** blocked by the WSLg
  apparatus ceiling noted in the F9 debrief.
- [ ] **No new transport / no new bind gate / no new tool** — this flight reuses the F3–F9 surface
  verbatim. If any leg finds itself adding a tool or endpoint, that is a divert signal (see Adaptation).

### Pre-Flight Checklist
- [x] All open questions resolved (OQ1–OQ3 settled above)
- [x] Design decisions documented (DD1–DD6) + **Architect-reviewed** (approve-with-changes, 2026-06-17 —
  H1 example-client-auth defect folded in as DD6 + its own leg; M2/M3/L1 wording tightenings applied;
  see flight-log Design Review)
- [ ] Prerequisites verified (F9 merged ✓; GUI display + enabled surface verified at execution)
- [ ] Validation approach defined (see Verification)
- [ ] Legs defined

---

## In-Flight

### Technical Approach
A documentation + verification flight with **one reconciliation edit** to a consumer-facing example
script (`scripts/mcp-example-client.mjs`, DD6) — no changes to the automation engine or behavior tests.
Work the README reframe and the `docs/mcp-automation.md` Consumer Contract consolidation as independent
doc edits, fix the example client so it actually authenticates, carry the `CLAUDE.md` dev-pattern, then
run a single live getting-started confirmation that
exercises the *documented* production-style path end to end (enable surface → key → `.mcp.json`-shaped
client config → example client drives) to catch any drift between the docs and the real handshake before
SC6 is marked met. Reconcile any drift found (port, refusal codes, tool count) in the same pass.

### Checkpoints
- [x] README reframed (control / privacy / automatability), logo kept, DOWNLOADS block untouched, links to consumer ref
- [x] `docs/mcp-automation.md` Consumer Contract section + consolidated production getting-started landed
- [x] `scripts/mcp-example-client.mjs` authenticates (Bearer key) + "21 tools" comment corrected (DD6)
- [x] `CLAUDE.md` dev-pattern carryover landed
- [x] Static verification green (test/typecheck/lint) + doc drift reconciled + independent review confirmed; live run operator-waived (SC6 demonstrated by the-one); SC6 marked met + Flight 10 ticked

### Adaptation Criteria

**Divert if**:
- The getting-started confirmation reveals the documented path **doesn't actually work** (a real
  handshake/auth/endpoint gap, not a doc typo) — that's a capability/contract defect, not a docs fix;
  re-plan rather than paper over it in prose.
- Any leg finds it needs a **new MCP tool, endpoint, or bind change** to make the contract usable — that
  is out of this flight's docs-only scope; surface it as a follow-on (e.g. the deferred `createJar`).

**Acceptable variations**:
- Reordering/merging the doc legs, or folding the `CLAUDE.md` carryover into another doc leg.
- Minor factual reconciliation (port numbers, refusal-code wording, a stale count) done inline during
  the verify leg rather than as its own leg.

### Legs

> **Note:** Tentative; legs are created one at a time as the flight progresses.

- [x] `readme-reframe` — reframe `README.md` from media-panel-only to the control / privacy /
  **automatability** triad in the **intro + Features** (the `### Development` block at `README.md:125`
  already mentions `dev:automation` + links the consumer ref — don't duplicate it; the reframe is the
  top-of-README thesis, Architect L1); **keep the header logo** (operator clarified there are no
  screenshots to remove); leave the `<!-- DOWNLOADS:START/END -->` auto-generated block byte-for-byte
  untouched (DD4).
- [x] `consumer-contract` — in `docs/mcp-automation.md`, add a brief stated **Consumer Contract**
  section that **indexes/links** the guarantees already documented across the file (it is mostly
  consolidation, not rewrite — the inject-then-run pairing, internal-session exclusion, auth model,
  result/refusal semantics, and `.mcp.json` story already exist as prominent sections; Architect M2):
  the off-by-default/key-gated/loopback-only boundary **incl. the reach disclaimer** (DD2), with
  cross-references rather than duplicated prose. Confirm/tighten the **production getting-started**
  (Settings-toggle → mint per-jar key → `.mcp.json` at live port → run client), explicitly fencing it
  from the dev `AUTOMATION_DEV_MINT` path and stating **where the per-jar key reaches the example
  client** (the env var from DD6) — Architect M3 (DD3).
- [x] `example-client-fix` — reconcile `scripts/mcp-example-client.mjs` to the contract: attach
  `Authorization: Bearer <key>` from an env var (mirror `scripts/lib/mcp-client.mjs:80`), correct the
  stale "17 tools" → 21 comment (DD6). *(The flight's one non-doc edit; gates the verify run.)*
- [x] `dev-patterns-carryover` — add the `runSerialized` mutex pattern + inject-then-run pointer to
  `CLAUDE.md` dev patterns (DD5). *(Small; may fold into `consumer-contract` if convenient.)*
- [x] `verify-and-close` — run the (now auth-correct) example client against an enabled surface to
  confirm the documented production getting-started works end to end; reconcile any remaining doc drift
  (port / refusal codes / tool count); mark **SC6 met** in the mission and tick the **Flight 10** box;
  FD verification (`npm test` + typecheck + lint stay green — engine source untouched, so this is a
  regression guard over the one example-client edit, not new coverage).

---

## Post-Flight

### Completion Checklist
- [x] All legs completed
- [x] Docs committed (README, `docs/mcp-automation.md`, `CLAUDE.md`) + the example-client fix
- [x] `npm test` (773/0) + typecheck + lint green (regression guard)
- [x] SC6 marked met in the mission; Flight 10 ticked
- [ ] PR marked ready for review (after merge/operator review)

### Verification
1. **Live getting-started confirmation (the SC6 close):** following only the *documented* production
   getting-started, bring the surface up, obtain a key, configure a client at the live port, and drive
   Goldfinch with the example client (open tab → navigate → screenshot → readDom). Green = the documented
   contract is accurate and an external consumer can follow it unaided. (Reuses the existing
   `scripts/mcp-example-client.mjs`; no new behavior test per OQ2/DD1.)
2. **Doc-accuracy reconciliation:** the 21-tool reference, the endpoint/port story, and the
   refusal-code list in the Consumer Contract match `src/main/automation/mcp-tools.js` and the live
   server (spot-checked during the confirmation run).
3. **README factual check:** the automation framing accurately describes the shipped surface
   (off-by-default, key-gated, loopback-only) and the DOWNLOADS block is unchanged from the
   `update-readme.mjs` output.
4. **Regression guard:** `npm test`, typecheck, and lint green (no engine source changed).
