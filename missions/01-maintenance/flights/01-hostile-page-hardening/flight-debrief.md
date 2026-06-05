# Flight Debrief: Harden the Hostile-Page Security Boundary

**Date**: 2026-06-05
**Flight**: [Harden the Hostile-Page Security Boundary](flight.md)
**Status**: landed
**Duration**: 2026-06-05 (single session)
**Legs Completed**: 5 of 5

## Outcome Assessment

### Objectives Achieved
The flight closed the one directly hostile-page-reachable security gap (F1) and the five surrounding defense-in-depth surfaces (F3–F7), under the threat model of a hostile web page loaded in a `<webview>`. All five legs landed without diversion; an independent Reviewer confirmed every leg's acceptance criteria with no blocking issues. The flight also delivered an unplanned-but-scoped asset: a `node --test` unit harness (96 tests) that didn't exist before and which Flight 2 will extend.

Concretely shipped (PR #8):
- **F1**: `isSafeTabUrl()` (`src/shared/url-safety.js`) enforced at **two** choke points — renderer `createTab` (`renderer.js:107`) and a new main `will-navigate` guard on webview guests (`main.js:64-66`).
- **F4/F5**: session approved-dir Set + `uniquePath` traversal/reserved-name/containment hardening (`main.js`, `src/main/download-path.js`).
- **F6**: `isSafePosterUrl()` gates the `backgroundImage: url("…")` sink (`renderer.js:356`).
- **F3**: unused `shell.openExternal` IPC capability removed.
- **F7**: per-entry `validateContainers()` with id **and** partition de-dup (`jars.js`).

### Mission Criteria Advanced
Six mission success criteria checked off: **F1, F3, F4, F5, F6, F7**. Flight 1 of 5 complete; 4 flights and 15 criteria remain. The mission's stated outcome ("close the hostile-page-reachable security gap … backed by a regression net") is materially advanced — the gap is closed and the regression net (unit harness) is seeded.

All Pre-Flight, Checkpoint, and Post-Flight checklist items were met except "Code merged" (PR open, not yet merged — expected).

## What Went Well

- **Reconnaissance-before-legs paid off twice.** The recon pass confirmed all six findings live with accurate citations AND expanded F1 to a second injection vector (media-open `createTab(item.url)`, `renderer.js:428`) the source finding never enumerated. Because the fix targeted the `createTab` choke point, the expansion required no re-scoping.
- **Layered review caught three real security gaps before code was written.** Flight-level design review caught the `will-navigate` in-page-navigation gap (F1) and the partition-collision gap (F7); leg-level design review caught the `data:` CSS-breakout (F6). None reached implementation.
- **Pure-helper extraction made security logic deterministically testable.** Splitting `isSafeTabUrl`/`isSafePosterUrl`, `sanitizeFilename`/`isWithinDir`, and `validateContainers` into pure modules yielded 96 fast unit tests with no Electron mocking required for the URL/path helpers.
- **Parallel leg execution.** Legs 3–5 ran concurrently on disjoint file sets; legs 1–2 sequentially where they shared `main.js`/`url-safety.js`. Flight-log/flight.md writes were reserved to the Flight Director to avoid a write race.
- **One predicate, two processes.** The dual-export `src/shared/` module is consumed by `main.js` (`require`), the renderer (`<script>` global), and the test runner — a single source of truth for the security predicate.

## What Could Be Improved

### Process
- **Two of the three caught gaps were architectural and arguably catchable at flight-design time, not review.** The `will-navigate` surface and the partition-uniqueness constraint are both knowable from the Electron docs and the existing `web-contents-created` handler. The two-cycle design review did its job, but a flight author performing design solo is less likely to enumerate their own blind spots. **Recommendation:** for security/trust-boundary flights, add an explicit flight-design checklist step — "enumerate every surface through which an attacker can reach this code path" — and lean on the author/reviewer split rather than letting review backfill design.
- **The flight DD stated `data:` as an allowed poster scheme authoritatively**, then the leg review reversed it. Flight artifacts read as the source of truth; a confident-but-wrong allowlist in a DD can mislead a later reader. **Recommendation:** when a design value depends on implementation-level behavior (here, `new URL()`'s treatment of opaque `data:` paths), flag it as TBD-pending-analysis in the DD rather than asserting it. (The stale `data:` reference in `flight.md` was corrected during this debrief.)

### Technical
- **Test metrics (baseline — seeds future comparisons).** `npm test` (`node --test`): **96 pass, 0 fail, 0 skipped, 0 flakes, ~92 ms** total wall-clock across three files — `url-safety.test.js` (49), `download-path.test.js` (29), `jars.test.js` (18 top-level). No prior debriefs exist; these numbers are the project's first baseline. (Note: the leg-5 flight-log entry's "31 cases" counted subtest assertions; the runner reports 18 top-level `test()` blocks for jars — 96 total is consistent.)
- **New residual finding — container `color` is an unescaped HTML-attribute injection sink.** `validateContainers` coerces `color` to a string but does not validate its format; the renderer interpolates it unescaped into `style="background:${c.color}"` at `renderer.js:76, 127, 883` (while `name` is `escapeHtml`'d). A tampered `containers.json` color could break out of the attribute into HTML in the privileged chrome renderer. Same threat tier as F7 (local file tamper, second-order) but an incomplete fix — **logged as a mission Known Issue with a fast-follow.**
- **Three `img.src = item.url` sinks deferred** (`renderer.js:197, 351, 469`). These are `<img src>` (not CSS sinks), so no code-execution risk, but page-derived image URLs are a tracker/SSRF concern in Electron (local-file image loads). Explicitly out of F6 scope; needs a documented decision in a future flight.
- **Behavior-test verification deferred.** `tests/behavior/tab-scheme-guard.md` is authored (`draft`) but never run — no `npm run dev:debug` during this flight. The unit tests prove the predicates in isolation; the wiring into a live `<webview>` is confirmed only by code review + grep, not by real-environment observation. The critical enforcement is **unproven in the running app** until the spec is run.
- **`globalThis` assignment side-effect.** `url-safety.js` assigns the predicates to `globalThis` unconditionally, so `require()`-ing it in main/tests writes Node globals too. Harmless (pure functions, distinctive names) but untidy; guard with `if (typeof window !== 'undefined')` and/or consolidate to one `Object.assign` if a third predicate is added.
- **`approvedDownloadDirs` session-scope assumption is implicit.** Correct for today's flow (renderer always dialogs before a bulk run), but a future "download to last folder" feature would hit a confusing false-reject. Documented at the code, but a feature author may not read it.

### Documentation
- `CLAUDE.md` was updated this flight (the stale "no test suite" note now describes `npm test` and `tests/behavior/`). **Still missing:** `CLAUDE.md` does not yet document the two architectural patterns this flight established — the `src/shared/` dual-export predicate module and the two-enforcement-point security boundary (`createTab` + `will-navigate`). Worth adding before Flight 2 builds on them.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| F1 scope expanded to a 2nd vector (media-open) + 2nd enforcement point (`will-navigate`) | Recon + design review found `createTab`-only was insufficient | Yes — recon-before-legs as a phase gate; "enumerate attacker-reachable surfaces" in security flight design |
| F6 dropped `data:` from the poster allowlist | Leg review found `data:` opaque paths break out of `url("…")` | Yes — leg-level design review on any trust-boundary leg |
| F7 added partition-dedup (not just id-dedup) | Design review found id-dedup alone doesn't prevent the isolation break | Yes — for session-isolation findings, state both id and partition as independent uniqueness constraints in the source finding |
| Test runner pulled forward into Flight 1 | F1 needed deterministic unit coverage before Flight 2's harness | Situational — pulling a minimal forward-compatible floor forward is fine when a security leg needs coverage now |
| Flight-log/flight.md writes reserved to FD during parallel legs | Avoid concurrent-write race across 3 implementers | Yes — when parallelizing legs, the FD owns shared-artifact writes |

## Key Learnings

1. **Recon-before-legs is load-bearing for findings-sourced flights.** It caught stale line numbers, confirmed liveness, and expanded scope — without it, leg specs would have targeted stale/incomplete code. This should be an explicit phase gate, not a recommended practice.
2. **Layered design review (flight-level + leg-level) is the right shape for security work,** but it is partly compensating for solo flight-design blind spots. The catches were real and well-timed; the meta-lesson is to push surface-enumeration earlier and keep the author/reviewer split strict.
3. **"Validated" ≠ "isolated."** F7's first cut validated fields but missed that uniqueness must hold on the *partition* (the actual isolation primitive), and missed `color` entirely. Field-by-field validation needs to be driven by "what invariant am I protecting," not "what fields exist."
4. **Unit tests prove the predicate; only the behavior test proves the wiring.** The security value is unrealized until `tab-scheme-guard` runs against the live app.

## Recommendations

1. **Run `tab-scheme-guard` (behavior test) as soon as the app is drivable** — promote it `draft → active` after the first green run. This is the only proof the F1 enforcement actually works in a live `<webview>`. (Flight 2 brings up `dev:debug`; run it there before that flight lands.)
2. **Fast-follow the container-`color` injection finding** (mission Known Issue) — small fix in `validateContainers` (allow only `#[0-9a-fA-F]{3,8}` or a known CSS color keyword). Fold into Flight 2 or a micro-leg.
3. **Document the two new patterns in `CLAUDE.md`** — the `src/shared/` dual-export predicate module and the `createTab` + `will-navigate` security boundary — before Flight 2/5 build on or near them.
4. **Add an "attacker-reachable surface enumeration" step to security flight design**, and decide the `img.src` sinks (`renderer.js:197/351/469`) explicitly in a future flight rather than leaving them as an open thread.
5. **Consolidate the Electron test stub.** `jars.test.js` hand-stubs `Module._cache['electron']`; Flight 2's harness work should lift this into a shared fixture before more suites copy it.

## Action Items

- [ ] Run `/behavior-test tab-scheme-guard` once `dev:debug` is available; promote spec to `active` on green. (Flight 2 / on demand)
- [ ] Fix container-`color` validation in `validateContainers` (mission Known Issue). (Flight 2 / micro-leg)
- [ ] Add `src/shared/` dual-export pattern + two-enforcement-point security boundary to `CLAUDE.md`. (Flight 2)
- [ ] Decide disposition of the three `img.src = item.url` sinks (`renderer.js:197/351/469`). (future flight)
- [ ] Guard the `globalThis` assignment in `url-safety.js` with `if (typeof window !== 'undefined')` and consolidate if a third predicate is added. (low priority)
- [ ] Lift the Electron `Module._cache` stub in `jars.test.js` into a shared test fixture. (Flight 2 harness work)

## Skill Effectiveness Notes

- **Mission**: success criteria were measurable and mapped cleanly one-per-finding; the maintenance-report linkage gave the flight strong context. The F7 criterion ("shape-validated … partition prefix, id dedupe") under-specified the partition *uniqueness* constraint — source findings for isolation bugs should name both id and partition as independent invariants.
- **Flight**: structure supported execution well; the recon + two-cycle design review surfaced the gaps. Improvement: a security-flight design checklist (surface enumeration) and flagging implementation-dependent DD values (e.g. the `data:` allowlist) as TBD.
- **Leg**: specs were precise and verifiable; line-number drift across uncommitted legs was handled correctly via "locate by content, not line number" — worth codifying as a standing convention for multi-leg flights.
