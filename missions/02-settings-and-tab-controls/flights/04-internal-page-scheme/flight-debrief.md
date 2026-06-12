# Flight Debrief: Internal Page Scheme (`goldfinch://`)

**Date**: 2026-06-11
**Flight**: [Internal Page Scheme (`goldfinch://`)](flight.md)
**Status**: landed
**Duration**: 2026-06-07 (planning baseline → landed, single day)
**Legs Completed**: 7 of 7 (5 code + verify-integration + HAT)

> **Debrief timing note**: this debrief ran four days after landing — after Flights 5, 6, and 7
> had already built on this flight's seams — due to a process oversight (the debrief step was
> skipped when Flight 5 planning began). The delay had a compensating benefit: the analysis below
> includes a **durability assessment** of how Flight 4's architecture held up under three flights
> of subsequent growth, which a same-day debrief could not have offered. The carry-forwards still
> flowed correctly to Flights 5/6 via the mission Known Issues and the flight log, which is why
> the gap caused no execution damage — but the skipped step is a process finding (see
> Recommendations).

## Outcome Assessment

### Objectives Achieved

The flight built Goldfinch's complete internal-page mechanism and proved it end to end:

- **The privileged `goldfinch://` scheme** — registered `{ standard, secure }` at module load,
  served via session-scoped `protocol.handle` on a dedicated `goldfinch-internal` session, strict
  CSP (`frame-ancestors 'none'` + tight `default-src`) set in the `Response` headers and
  **confirmed shipped by CDP read-back** (not assumed).
- **The trusted embedder path** — `createTab(..., { trusted: true })` validated by the new
  `isInternalPageUrl` allowlist; trust is call-site provenance, never inferred from the URL;
  `isSafeTabUrl` byte-unchanged. All ten `createTab` callers enumerated at review — only the kebab
  Settings handler passes the flag.
- **The four-gate security model verified live** — `tab-scheme-guard` 13/13 (Witnessed: independent
  Executor + Validator); all four page-spoof vectors (`window.open`, `location=`, `<iframe>`,
  cross-origin `fetch`) rejected; spec promoted `draft → active`.
- **The a11y baseline pinned** (thrice-flagged debt discharged) — `npm run a11y` now diffs against
  a curated `ACCEPTED` allowlist, with a `--target` guest mode that audited the settings stub and
  was reused by Flights 5–7.
- **The `will-navigate` spike** resolved the flight's chief empirical premise: programmatic
  loads/reloads bypass `will-navigate`, so the session-aware allow-branch is belt-and-suspenders,
  as the Architect predicted.

### Mission Criteria Advanced

- **SC5** — verified in full (trusted open + reload positive; all spoof vectors rejected).
- **SC8** — the internal surface is a11y-clean AND the gate itself became a real, CI-able
  "no new violations" assertion for both the chrome and internal guests.

## What Went Well

- **Design review yield was the highest of the mission.** Two Architect cycles at flight planning
  caught the CSP-in-`Response`-headers requirement (the `onHeadersReceived` silent-drop trap) and
  the a11y guest-target coverage gap before any code existed. Per-leg Developer design reviews then
  caught two [HIGH] defects pre-implementation: the **synchronous `session-created` exclusion bug**
  (the event fires inside `fromPartition`, so a marker-after-creation silently fails) and the
  **New-Identity data-loss trap** (a mismatched `tab.container.partition` would have wiped the
  user's real default jar). Neither would have been caught by offline gates.
- **The spike-before-the-dependent-build pattern** (Flight-3 lesson) worked as designed: the
  `will-navigate` spike ran at leg-2 exit via CDP `<webview>` injection — no throwaway app code —
  and shaped the boundary leg with evidence instead of assumption.
- **DD6 (serve the real destination URL now) was a high-ROI call**: Flights 5 and 6 enriched the
  same document and the same serving path with zero re-plumbing.
- **The seams held under three flights of growth** (durability assessment): `INTERNAL_PARTITION`
  stayed single-sourced; `handleInternal`'s allowlist grew into Flight 5's `createResolver` /
  `internal-assets.js` cleanly; the `trusted` flag gained one more legitimate chrome call site
  ("Site settings →") with no predicate change; the `__goldfinchInternal` session marker became
  load-bearing a second time (Flight 6's `broadcastToChromeAndInternal` fan-out).
- **The latent internal-tab web-navigability anomaly was handled as intended**: correctly assessed
  as inert for this flight, logged with severity and a layered fix plan, then discharged across
  Flight 5 (navigation lock + identity chip — UX half) and Flight 6 (`registerInternalHandler`
  origin check — the authoritative security boundary). The carry-forward chain (flight log →
  mission Known Issues → next-flight design inputs) worked.
- **Gate-evidence attribution in the boundary leg** (which of the four gates rejects which spoof
  vector) made the live verify leg precise — each rejection was attributed to its mechanism, not
  just observed.

## What Could Be Improved

### Process

- **The debrief itself was skipped at the flight boundary** (this document is four days late).
  Flight 5 planning compensated by reading the flight log + mission Known Issues directly, but the
  metrics-trend capture and skill-feedback loop run through debriefs — the gap was caught only by
  a registry sweep. The flight lifecycle should treat the debrief as part of landing, not an
  optional epilogue.
- **Caller-enumeration as review-only evidence.** "No page-reachable caller passes `trusted:true`"
  was verified by the batch Reviewer's read, not by an explicit acceptance criterion or a grep-able
  assertion. For a security invariant, the enumeration should be an explicit checklist item in the
  leg spec (it would survive reviewer variance).

### Technical

- **`handleInternal` has no offline unit coverage.** Flight 5's `createResolver`/`contentTypeFor`
  extraction made the routing logic pure and tested (21 cases), but the wrapper — non-GET → 405,
  unknown host/path → 404, `net.fetch` rejection → 500, header assembly — is still main.js-bound
  and untested offline. Finishing the extraction (the project's established `download-path.js` /
  `internal-ipc.js` pattern) would close it.
- **The synthetic internal jar is hardcoded** (`{ id: 'internal', name: 'Settings', ... }`) in
  `createTab`'s trusted branch. A second internal page will need jar metadata derived from a lookup
  (ideally keyed off the same allowlist as `INTERNAL_PAGES`), not a second hardcoded object.
- **`isInternalPageUrl` lacks a fragment test case.** Flight 7 now calls it with
  `goldfinch://settings/#privacy` (passes — the predicate checks `pathname` only), but no unit test
  pins that behavior. One test case closes it.

### Documentation

- **The allowlist-growth-in-sync rule is buried in a leg spec.** When a new internal page is added
  by full navigation (e.g. a future `goldfinch://history`), **three** surfaces must grow together:
  `INTERNAL_PAGES`, `isInternalPageUrl`, and the `will-navigate` internal-session branch — or the
  new page is silently `preventDefault`ed. This is documented only in the boundary leg's edge-cases
  section; it belongs in CLAUDE.md's internal-pages pattern before Mission 03 adds any page.
- **The Node-vs-Electron pathname duality** (`pathname: ''` vs `'/'` for a registered standard
  scheme) is documented in JSDoc but not in CLAUDE.md; any future `goldfinch://` path-matching
  author will hit it.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Second design-review cycle skipped after leg-1 "approve with changes" | All five fixes were verbatim adoptions of the reviewer's own recommendations; a fresh review would only echo | Yes — within the skill's existing "minor/cosmetic" discretion; faithful incorporation of a reviewer's own fixes doesn't need re-review |
| Docs leg (5) design-review spawn skipped | Docs-only leg; the batch Reviewer covered it | Yes — same proportionality call as Flights 5–7 made later |
| Debrief deferred past three subsequent flights | Process oversight at the Flight-5 planning transition | **No** — debrief at the flight boundary; see Recommendations |

## Key Learnings

1. **Provenance, not URL, is the trust discriminator** — the `trusted` flag as an explicit caller
   argument (never inferred from the string) survived three flights and a new call site without a
   single near-miss. This is now a codebase-defining convention.
2. **Electron ordering hazards need committed examples** — `session-created` firing synchronously
   inside `fromPartition` is non-obvious; the module-flag-before-`fromPartition` pattern is now a
   documented, working example in the codebase.
3. **Webview-attach immutability is a permanent architectural constraint** — `partition`/
   `preload`/`contextIsolation` freeze at attach, so per-navigation session isolation is foreclosed
   for `<webview>` tabs. The nav-lock + origin-check layering is the standing mitigation; any
   future design wanting Chrome-style process swaps must tear down and recreate the webview.
4. **Read the policy back.** The CSP read-back over CDP (rather than trusting the code) is the
   pattern that makes "the header shipped" a verified fact. A dropped policy must fail, not pass
   silently.
5. **A delayed debrief loses the feedback loop but the carry-forward chain is resilient** — the
   flight-log Anomalies + mission Known Issues carried everything Flights 5/6 needed. The debrief
   adds trend metrics and skill feedback, not execution-critical context — which is exactly why
   skipping it goes unnoticed.

## Recommendations

1. **[Important] Document the three-surface growth rule in CLAUDE.md** (INTERNAL_PAGES +
   `isInternalPageUrl` + the `will-navigate` internal branch grow together) before Mission 03 adds
   any internal page. Include the Node-vs-Electron pathname duality note.
2. **[Important — Mission 03 input] Automation must exclude internal-session webContents.** Any
   `webContents.debugger` attach / enumeration in the automation surface must skip
   `wc.session?.__goldfinchInternal === true` — a debugger on the settings guest is a privilege
   escalation into the internal bridge. Gate on the session marker (main-process state), not
   partition-string matching. Relatedly: the `creatingInternalSession` one-shot flag and the
   informal marker convention won't scale to dynamically-created automation sessions — consider a
   session-type registry (e.g. a `WeakMap<Session, type>` in a shared module) when a third session
   category appears.
3. **[Important] Extract `handleInternal` into a unit-testable module** (finish what
   `internal-assets.js` started) so the 405/404/500 error paths get offline coverage.
4. **[Minor] Add the `goldfinch://settings/#privacy` fragment case to the `isInternalPageUrl`
   unit tests**; derive internal-jar metadata from a lookup before a second internal page lands.
5. **[Process] Make the debrief part of the landing checklist** — the flight isn't done until the
   debrief exists; the post-flight Completion Checklist in flight.md should carry a debrief line so
   a skipped debrief is visible in the artifact, not just in the registry.

## Action Items

- [ ] CLAUDE.md: add the three-surface internal-page growth rule + pathname-duality note (next
  docs-touching leg, before Mission 03)
- [ ] Mission 03 flight design: internal-session exclusion for any debugger/automation attach;
  session-type registry consideration (carried to Mission 03 planning inputs)
- [ ] Extract `handleInternal` error/header paths into `internal-assets.js` (or a sibling) with
  unit tests (next maintenance or internal-pages flight)
- [ ] `test/unit/url-safety.test.js`: add the fragment-URL case for `isInternalPageUrl` (trivial;
  next flight touching that file)
- [ ] Flight-control process: append a "flight-debrief exists" line to the flight.md Post-Flight
  Completion Checklist template (mission-control methodology change)

---

## Test Metrics

Captured 2026-06-11 on current `main` (v0.4.9 — includes Flights 5–7; a same-day Flight-4 run was
not recorded, which is itself a consequence of the skipped debrief). Single shared run with the
Flight-7 debrief (same codebase state):

- **`npm test`: 221/221 pass, 0 fail, 0 skipped, no flakes, ~92 ms wall-clock.**
- `npm run typecheck`: 0 errors. `npm run lint`: 0 problems.
- Trend across debriefs: 96 → 147 → 147 (renderer-only flights, correctly flat) → **161 (this
  flight, +14 `isInternalPageUrl` cases)** → 182 → 211 → 221; wall-clock has stayed in the
  ~68–102 ms band throughout — no slowdown signal.
- This flight's +14 were the `url-safety` suite's `isInternalPageUrl` cases; at landing the flight
  recorded 161/161 offline, consistent with the trend line.
