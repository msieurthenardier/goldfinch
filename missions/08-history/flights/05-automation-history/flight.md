# Flight: Automation History Surface

**Status**: completed
**Mission**: [Per-Jar Browsing History](../../mission.md)

## Contributing to Criteria

- [x] A jar-keyed automation client can read its own jar's history through
      the automation surface; requests targeting any other jar are
      refused. *(behavior-test-backed — spec authored this flight)*
- [x] Jar isolation holds for history on every surface: no web page, no
      address-bar session, and no jar-keyed automation client can observe
      history from a jar other than its own. *(closes formally here: the
      automation surface was the last unbuilt read surface; the
      address-bar half was behavior-tested in F4 step 3; the web-page half
      is structural — web content has no `ipcRenderer` and the internal
      twins are origin-gated, both unit-pinned since F1)*
- [x] Visits recorded / burner-internal exclusion *(criteria 1–2 —
      behavior-test-backed since F1's `history-recording` 8/8; checked off
      at this flight's close as the mission's test-backed book-keeping)*

---

## Pre-Flight

### Objective

Expose history on the automation surface as a **jar-confined read tool**
riding the existing identity façade: `getHistory` reads the calling jar
key's OWN jar (recent or prefix-search), and for the admin identity reads
any named jar (mission DD10 ruling, recorded at Flight 1) — the
"allowed-but-confined" shape (`enumerateTabs` precedent, NOT
`getDownloadsList`'s admin-only block). Docs land (mcp-automation.md tool
reference, README, CLAUDE.md), the F1-discovered `enumerateTabs`
description/behavior divergence is reconciled, and the mission-closing
isolation behavior test runs.

### Open Questions

- [x] Admin history posture → any jar, consistent with the identity model
      (mission open question; ruled at F1 design, DD10 there).
- [x] Tool shape → one `getHistory` tool covering recent + search (a
      `query` param switches), not two tools. See DD1.
- [x] The F1-run `enumerateTabs` doc divergence → fix the DESCRIPTION
      (behavior is correct and pinned by `mcp-jar-scoping` step 8: admin
      DOES see internal tabs). See DD3.

### Design Decisions

**DD1 — One `getHistory` tool, jar-confined via a custom façade op.**
- **Engine** (`engine.js`): a `getHistory(jarId, { query?, limit?,
  before? })` op backed by an injected accessor (the `getDownloads`
  injection precedent) — main.js threads
  `{ listRecent, search }`-capable closures over `historyStore` (reads
  only; no mutation ops on the automation surface this mission).
  `query` present → `search`; absent → `listRecent` (with `before`
  cursor). Engine-level, Electron-free, unit-tested with fakes.
- **Tool** (`mcp-tools.js`): `getHistory` ToolDef — input `{ jarId?,
  query?, limit?, before? }`, JSON-text result `{ jarId, visits }`.
  Registry count grows to 28; the tool-count assertions and docs update.
- **Façade** (`scope.js`): a CUSTOM op (NOT `WCID_FIRST_OPS` — no wcId):
  jar identity → `requireJar()`; a supplied `jarId` that is present AND
  ≠ the key's own jar → the discriminated refusal
  `automation: out-of-jar` (echoing the drive-op code — a jar key naming
  a foreign jar is the same trust violation); absent/own jarId → engine
  call with the key's jar id. Admin → engine unchanged (any jarId;
  MISSING jarId for admin → the engine validates and errors `bad-args`
  style, since admin has no implicit jar).
- **Admin + present-but-UNKNOWN jarId → explicit `automation:
  unknown-jar` refusal** *(Architect review, FD ruling — house
  convention over silent-empty)*: the engine gains a SECOND injected
  accessor `isKnownJar(jarId)` (threaded from `jars.list()` in main.js,
  already in scope there) and validates before reading. A JAR key
  supplying a foreign jarId stays `out-of-jar` (a trust violation, not a
  lookup miss — distinct audit-legible codes).
- **`query` + `before` together → `bad-args`** *(Architect review —
  search has no cursor; silent dropping is a trap)*.
- The wcId-first guard machinery is IRRELEVANT to this op *(Architect
  review — no `wcId` in the schema means the guard's filter never picks
  it up; `WCID_FIRST_EXEMPT` is empty today and stays empty; do NOT
  chase an exempt-list edit)*. `getHistory` lands in a NEW labeled
  `HISTORY_TOOLS` array in mcp-tools.js with its own
  "jar-confined (not admin-only)" comment — neither `DRIVE_TOOLS`
  (wcId-first) nor `CHROME_TOOLS` (admin-only) describes it, and
  CLAUDE.md's tool inventory gains a sixth category label to match.

**DD2 — Read-only surface; store API already fits.** `listRecent` /
`search` are jar-keyed by construction (F1 DD8) — the façade passes a jar
id it has already authorized; no store changes. No history mutation tools
this mission (clear/delete stay operator-surface only — a deliberate
posture: agents get memory, not erasure; noted for the debrief).

**DD3 — Docs + the enumerateTabs description fix.**
`docs/mcp-automation.md`: `getHistory` reference (identity semantics,
payload, result shape, refusal codes) + the tool count; README: one line
extending the automation pitch (jar-scoped history memory); CLAUDE.md:
the automation-engine section's tool inventory + the new injected
accessor. The `enumerateTabs` ToolDef DESCRIPTION drops its stale
"non-internal" claim (admin listings include internal tabs — live-proven
in the F1 run and pinned by `mcp-jar-scoping`; jar listings never see
them — session filter) **in BOTH places** *(Architect review)*: the
mcp-tools.js ToolDef AND the independent copy in
`docs/mcp-automation.md`'s tool-reference table. Behavior unchanged.
Audit layer: covered automatically (one `callTool` choke point);
optionally add a `deriveAuditDetail` case logging `jarId=` presence —
never query text (the typeText privacy rule).

**DD4 — Verification: the mission-closing isolation behavior test.**
New spec `history-automation-isolation` (authored at leg design):
jar-key run — `getHistory` (no jarId) returns ONLY own-jar rows
(cross-checked against a readOnly DB read); `getHistory({ jarId:
<other> })` → `automation: out-of-jar` refusal with NO data; admin
run — `getHistory({ jarId })` reads any named jar; missing-jarId admin
error; admin + unknown jarId → `unknown-jar`. Apparatus: the proven
mint-env launch + scripted SDK client + readOnly DB cross-checks.
**Dev-profile state pins** *(Architect review, HIGH — live-probed: the
profile carries F4's leftovers: defaultId drifted to `rename-test` with
~50k synthetic rows, `work` holds 20 marker rows)*:
- Precondition mirrors `mcp-jar-scoping`: VERIFY/SET the default flag
  deliberately before launch; never hardcode a jar name — resolve live.
- **Deliberate decision: keep the large pre-existing population** — the
  test proves isolation DESPITE ~50k foreign-jar rows (stronger than a
  clean-room), with fresh DISTINCTIVE per-jar fixture rows staged for
  the assertions and every count asserted as a delta/marker query, never
  an absolute.
Unit layer covers the refusal matrix exhaustively (scope tests); the
behavior test covers the live session-identity binding end-to-end (the
mcp-jar-scoping split).

### Prerequisites

- [x] Flights 1–4 landed on the stacked chain (store reads; recording;
      keys/façade machinery from M03-M05 unchanged this mission).
- [x] Seams verified at F1 recon + the F1/F4 behavior runs: scope.js
      custom-op precedents, engine `getDownloads` injection shape,
      mcp-tools ToolDef arrays, the auto-mint apparatus, WAL concurrent
      reads.

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Leg 1 (`history-read-tool`): engine op + accessor injection + ToolDef +
scope façade + unit tests (engine fakes; scope refusal matrix; registry/
guard-test updates) + the enumerateTabs description fix.
Leg 2 (`verify-and-isolation-tests`): author + run
`history-automation-isolation`; docs (mcp-automation.md / README /
CLAUDE.md); mission criteria book-keeping; flight close.

### Checkpoints

- [x] Unit: jar-key confinement matrix (own/absent/foreign/unknown jarId),
      admin any-jar, missing-admin-jarId error, result shapes; suite ~1s.
      *(Leg 1: 1494/1494 pass, ~1s)*
- [x] Live: behavior test passes (jar read + foreign refusal + admin read).
      *(`history-automation-isolation` 7/7, two launches)*
- [x] Docs accurate (tool count, identity semantics, description fix).

### Adaptation Criteria

**Divert if**: the façade cannot express "allowed-but-confined without a
wcId" cleanly against the real key/identity plumbing (would contradict
the recon precedents — stop and re-plan).
**Acceptable variations**: exact param/result field names, refusal code
`out-of-jar` vs a new `history`-specific code (stay discriminated +
audit-legible), limit defaults.

### Legs

> Tentative; created one at a time.

- [x] `history-read-tool` *(landed 2026-07-12)*
- [x] `verify-and-isolation-tests` *(landed 2026-07-13)*

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged *(stacked PR; merges after human review)*
- [x] Tests passing
- [x] Documentation updated

### Verification

Unit refusal matrix + live behavior test + docs cross-check. This flight
closes the mission's remaining behavior-test-backed criteria.
