# Leg: isolated-world-spike

**Status**: completed
**Flight**: [The Save Moment](../flight.md)

## Objective

Determine, by live experiment rather than reasoning, whether the entry tracker's
DOM reads can run in an **isolated world** — where page-world overrides of
`value`, `target` and friends structurally do not exist — and report a
recommendation. **This leg ships no production code.**

## Context

Operator ruling after four successive design reviews each found a distinct defeat
of per-field provenance: no provenance → sticky flag → spoofed `value` accessor →
spoofed `target` accessor (DD3, DD3d, DD3e). Every fix so far has been "capture one
more native accessor at document-start", which makes *forgetting an accessor* the
standing failure mode. DD3e converts that into a test-enforced closed read surface,
which is a real improvement — but it is still enumeration.

An isolated world would end the category instead of enumerating it: each world
holds its **own wrapper objects and prototypes** for the same underlying DOM nodes,
so a main-world `Object.defineProperty` — on the instance or the prototype — is
simply not visible there. If that holds in this app's configuration, provenance
becomes immune by construction.

The catch is that `contextIsolation:false` is deliberate (farbling needs the
preload in the page's main world), guests run `sandbox:true`, and cross-world reads
are asynchronous where the observation path wants synchrony. Whether those are
fatal is exactly what this spike must find out.

## Acceptance Criteria

This leg's deliverable is **findings**, not behaviour. It is complete when every
question below is answered with evidence (a transcript, a screenshot, or a
captured return value), and a recommendation is written to the flight log.

- [x] **Q1 — Availability.** Is `webFrame.executeJavaScriptInIsolatedWorld` (or the
      equivalent world-scoped API in Electron 44.3.0) actually reachable from the
      guest's main-world preload given `sandbox: true` and
      `contextIsolation: false`? Answer with a live call, not with documentation.
- [x] **Q2 — The decisive question: wrapper isolation.** In the guest, from the
      page/main world, override a field's value accessor **both** ways —
      `Object.defineProperty(field, 'value', {get})` (instance) and
      `Object.defineProperty(HTMLInputElement.prototype, 'value', {get})`
      (prototype). Then read that same field's value from the isolated world.
      Does the isolated world see the REAL value or the override? Do the same for
      `Event.prototype.target` with a listener registered in the isolated world.
- [x] **Q3 — Observation.** Can an isolated-world script register DOM event
      listeners that fire for real user input, and does `isTrusted` report
      correctly there? If the whole tracker could live in the isolated world, the
      async-read problem disappears — establish whether that is possible.
- [x] **Q4 — Synchrony and the TOCTOU risk.** If reads must be async
      (main world asks, isolated world answers), can a value change between the
      trusted event and the read? If so, the async shape reintroduces the very
      TOCTOU hole DD3 closed — say so plainly.
- [x] **Q5 — Interactions.** Does using an isolated world disturb fingerprint
      farbling (the reason `contextIsolation:false` exists), page CSP, or the
      existing main-world preload wiring in any observable way?
- [x] **Q6 — Cost.** A rough but honest shape of what adopting this would mean for
      Leg 3 and Leg 4 — is it a contained change to the tracker's read calls, or
      does it restructure the observation path?
- [x] A written recommendation: **adopt**, **adopt partially**, or **stay with
      DD3e**, with the reasoning and the evidence that supports it.

## Verification Steps

- Launch the dev app per CLAUDE.md: `npm run dev:automation` (profile-isolated,
  WSL/headless friendly), adding `GOLDFINCH_AUTOMATION_DEV_MINT=1` to capture a
  fresh key, and `GOLDFINCH_AUTOMATION_ADMIN=1` if an admin-tier op is needed.
  Attach via `scripts/lib/mcp-client.mjs`. Recipes: `docs/dev-testing.md`.
- Probe against a scratch HTML page you create under the scratchpad directory (NOT
  in the repo) containing a login form plus the accessor overrides described above.
- **Environment caveat**: the MCP `evaluate` op is a silent no-op in the installed
  0.16.5 build (pending squawk). This spike runs against the DEV build from this
  source tree, where it may well work — verify `evaluate` returns a real value
  before relying on it, and fall back to `readDom` / `captureScreenshot` / a
  temporary in-page DOM marker if it does not. Report which you used.

## Implementation Guidance

1. **Answer Q2 first.** If wrapper isolation does not hold, everything else is
   moot and the spike ends early with "stay with DD3e".
2. Prefer the smallest possible probe — a temporary scratch page and throwaway
   evaluation, not edits to `src/`.
3. If you must touch `src/` to answer a question, revert it before finishing.
   `git status` must show no source changes attributable to this leg. Leg 1's
   uncommitted changes are expected and must be left untouched.
4. Report negative results as clearly as positive ones. "This does not work
   because X" is a successful spike.

## Out of Scope

- Implementing the tracker in either design. That is Leg 3.
- Changing `contextIsolation` or any window/session setting.
- Any production code change at all.

## Files Affected

- None in `src/`. Findings land in the flight log; scratch probes live in the
  scratchpad directory and are not committed.

---

## Post-Completion Checklist

- [x] All six questions answered with evidence
- [x] Recommendation written to flight-log.md
- [x] `git status` shows no `src/` changes from this leg
- [x] Set this leg's status to `completed`
- [x] Do NOT commit (not committed)
