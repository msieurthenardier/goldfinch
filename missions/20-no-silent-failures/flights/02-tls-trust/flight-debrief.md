# Flight Debrief: TLS Trust — Interstitial, Override, Indicator, Viewer

**Date**: 2026-09-16
**Flight**: [TLS Trust — Interstitial, Override, Indicator, Viewer](flight.md)
**Status**: landed → completed (2026-09-16)
**Duration**: 2026-09-15 (planning) – 2026-09-16 (landed; PR #217 ready for review)
**Legs Completed**: 5 of 5 (4 autonomous + the operator-elected HAT)

## Outcome Assessment

### Objectives Achieved

A certificate failure is now an informed decision instead of a generic
"didn't load". Main answers every `certificate-error` at once (refuse, or
allow when the origin is remembered — per jar, host:port, and certificate
fingerprint, in memory only), records the failing certificate on the tab
entry, and Flight 1's panel specialises into an interstitial that names the
origin and the exact error — restyled at the HAT to the operator's Chrome
reference with the Goldfinch mark. Proceeding is a human-only card on the
menu-overlay sheet behind a dedicated four-guard invoke that is the one
caller of the override memory and is refused to every automation op at
every tier (confirmed live by byte-identical refusals). Every page carries a
`security` state — secure / insecure / overridden / none / internal — spoken
with one "not secure" vocabulary by the address chip, the site-info popup,
and the census; any page's certificate opens in a read-only viewer whose
fingerprints matched `openssl` byte for byte on both fixtures. `site-info`
and `cert-viewer` joined the read-only automation allowlist; `cert-override`
never will.

Verified by the Witnessed run `tls-trust-surface` (13/16; run
`2026-09-16-04-59-20`; the three fails all dispositioned), `npm run a11y`
exit 0 with the new `cert-blocked` state, 4783 unit tests, the four gates,
and a 12-step operator HAT (all pass after two inline fixes).

### Mission Criteria Advanced

- **Met**: criterion 3 (interstitial with gated, remembered, non-automatable
  proceed), criterion 4 (one "not secure" vocabulary for `http:` and
  overridden pages; trusted pages unlabelled), criterion 5 (read-only
  certificate viewer) — all checked off in `mission.md`.
- **Advanced, still partial**: criterion 10 — `cert-blocked` and `security`
  in the census, the interstitial and card keyboard-operable once focus is
  in the panel; **#216 remains open** (a typed failed navigation still
  strands focus; the click-first workaround is the operator's accepted
  state for now).

## What Went Well

- **Diagnose before build, again.** Leg 1's nine-premise spike settled every
  Electron and rig fact the later DDs leaned on (the event refires per
  request; `callback(false)` matches the default path; the verify proc is
  cached by the network service; NSS user anchors are honoured; the SAN
  mismatch reports the authority error) and corrected the draft spec's
  step 14 before any run time was spent on a wrong expectation.
- **The four design reviews each earned their keep.** Leg 1: six drifted
  citations and the fake-DOM divergence. Leg 2: a bare `try/finally` that
  would have re-thrown into Electron's event dispatch from a trust handler
  (high), the Burner-skipping observer placement, the stale channel name in
  DD7/DD16. Leg 3 (adversarial): the proceed handler was about to DISARM
  the #216 reassert at the one moment the sheet close had just focused the
  chrome (high). Leg 4: the observer's wrapper shape, the raw-code error
  text, and the never-pushed "failed tab → `none`" invariant (three highs).
- **The Witnessed run was worth every relaunch.** Four product findings
  (F1–F4), each fixed in a spawned Developer pass with a unit pin and
  re-verified in the same run; the rendered-state-over-DOM rule did real
  work (three of the four were invisible to census/DOM reads and surfaced
  only when the Validator zoomed pixels). The operator's cadence ruling —
  fix-and-continue — was confirmed as the right call in the human interview.
- **Squawk 0076 fired for the first time and did its job.** The keyboard
  rows' a11y/activeElement agreement was a false positive; the escalation
  rule sent them to the operator's eye, which found #216 still live.
- **The HAT caught what the run could not.** F5 (a same-host trusted visit
  outranking a fresh override) needed a navigation ORDER the run's fixture
  sequence never produced — strong evidence for keeping a human walk after
  a green run.
- **Security posture held from source, not comments.** One `callback(`
  site, one `allow(` caller behind four named guards, `-3` only, no PEM over
  IPC, no storage imports, snapshot literals unchanged, key material never
  in the tree (one Developer key echo into its own transcript in leg 1,
  rotated immediately).
- **Test suite health**: 4783/4783, 0 skipped, no flakes; wall-clock
  ~5.4–5.6 s, inside the M18/M19 band (5.2–5.8 s) despite +218 tests since
  Flight 1's 4565/4.97 s; the same crypto-heavy vault suites and
  `navigation-controller` remain the slowest; no new slow suite.

## What Could Be Improved

### Process

- **Push ordering is the unit layer's blind spot, and it bit three times.**
  F1, F3, F4 share one shape — a correctly computed backend state whose
  chrome consumer refreshed on the wrong push, on a guarded path, or before
  any push. Every affected controller had a clean isolated test. No spec
  row or test stated the cross-push invariant ("the chip reflects the LATER
  of `tab-did-navigate`/`tab-security`; never a state main has not
  pushed"). Flight 3 should write that invariant down before it adds its
  own per-tab pushes.
- **Composition of locally sound DDs was never reviewed as a whole.** DD6
  (hostname-keyed observer), spike (f) (no refire on repeat visits), and
  DD7 (observation-first) were each defensible and together were the exact
  recipe for F5; the leg-scoped design reviews could not see it because
  the observer shipped in leg 2 and the override in leg 3.
- **A focus-lifecycle fix was unit-pinned without a live gate.** Leg 1's
  AC3 allowed "dispositioned via trace + unit pin" because the rig cannot
  measure OS focus; the flight therefore shipped a #216 fix that passes
  every test and does not work. Any future focus fix on a hidden-guest
  surface needs a live by-eye gate as a hard AC, not a HAT footnote.
- **Leg 4 was too large.** Vocabulary, viewer, fixtures, the a11y state,
  docs, and the acceptance gate in one leg; its design review found three
  highs and the run found four more defects in the same code. Three
  separable concerns shared one review and one landing.
- **Evidence hygiene**: the Executor overwrote a census file with the
  settled read instead of saving the transient separately (ruled mid-run);
  a `pressKey Enter` on a `<button>` does not activate it (apparatus gap);
  `navigate` returns `isError` for a blocked TLS load. All crew-file items.

### Technical

- **The renderer budget was re-pinned five times** (1858 → 1792 → 1794 →
  1799 → 1804 → 1806), each named and justified, the last by a defect fix
  after the legs had landed. The forcing function produced two extractions
  (`audit-hooks.js`, `site-security-controller.js`) but `renderer.js` still
  owns the generic dispatch switch; Flight 3's glue has no headroom.
- **`updateAddressChip` is refreshed from three independent call sites**
  (the failure push, the security push, activation/navigation) — the exact
  shape that produced F1 and F3. A single "tab state changed → recompute
  derived chrome state" fan-out would remove the class.
- **The verify-proc observer is hostname-keyed** (Electron's verify request
  carries no port). The overridden path is fully decoupled from it now; the
  trusted-page viewer on a host with two https ports may still show the
  most recently verified certificate. Accepted and documented; a port-aware
  key composed at the `did-navigate` read site (which knows the committed
  port) was available and not taken.
- **`chromeNavPending` is a small distributed state machine** (armed in
  two places, disarmed in two) that does not resolve #216: it disarms at
  `did-fail-load`, before the error document's own commit can re-steal
  focus — leg 1's recorded residual gap is the live symptom.
- **Two viewer data sources on the tab entry** (`entry.certificate` for
  trusted, `entry.certOverride.summary` for overridden) instead of one
  normalised shape — deliberate, but a smell.

### Documentation

- CLAUDE.md gained the two named patterns ("Chrome panel in the guest
  slot", "TLS trust") and the in-place allowlist/unobservable-surfaces
  edits; the seam note is at 39. Missing: a named rule for "the chip never
  claims a state main has not pushed / a state-owner refreshes its own
  consumer", the four-guard shape for any state-changing sheet→main
  channel, and "new per-tab state gets its own push channel".
- The crew file needs the three apparatus findings above and the
  settle-before-read rule; the hostname-only observer key deserves a line
  in the "TLS trust" section.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| `security` rides its own `tab-security` push, not `tab-did-navigate` | The adopt re-push must not replay a push whose handler resets media/privacy/suggestions | Yes — new per-tab state gets its own channel |
| DD7 order reversed: the navigation's own override stamp wins over the observer | The observer is hostname-keyed and never refires on repeat visits (F5) | Yes — a cached observation never outranks an in-band decision for the same commit |
| `chromeForTab` dropped from `createCertTrust` | The module pushes nothing | Yes (simplification) |
| #216 fixed in the H2/H3 shape; live symptom persists | The trace could only observe the guest side under the rig | No — a live by-eye gate becomes mandatory for focus fixes |
| Squawk turnaround and flight on ONE branch | Operator ruling | Case by case |
| Steps 1–5 re-run as a batched Executor turn after each relaunch | Already-passed rows on unchanged code | Yes — after a relaunch, batch the replay |
| F1 spec's Witnessed re-run replaced by an operator smoke (H10) | Its keyboard row would fail on #216 by construction | Case by case |
| Renderer budget re-pinned five times | Prettier-measured, named lines each time | No — extract before Flight 3 |

## Key Learnings

- **Name the cross-push invariant, then test it.** A chrome element that
  derives from more than one push needs one recompute path and a test that
  interleaves the pushes; isolated controller tests cannot see ordering.
- **Compose the DDs on paper.** When two legs each ship half of a cache or
  a decision path, a review that reads only one leg's code cannot see the
  interaction; the flight spec should carry a short "how DD6, DD7 and the
  spike facts compose" paragraph for any cache-plus-decision pair.
- **Rendered pixels are the observable for indicators.** Three of five
  findings were DOM-correct and render-wrong; zoom the glyph.
- **A refusal can be an observable.** The proceed card's non-automatability
  was asserted by three byte-identical refusals — a cheap, exact pin.
- **The HAT walks a different path than the run.** Keep both.
- **Focus fixes need eyes.** The rig cannot measure OS focus; a green unit
  pin is not a fix.

## Recommendations

1. **Before Flight 3 builds its crash/hang panel on the same surface,
   write the per-tab-state rules into CLAUDE.md** — each new state gets its
   own push channel; the chip (and any indicator) never claims a state main
   has not pushed; the state-owner refreshes its own consumer; a cached
   observation never outranks an in-band decision for the same commit —
   and give Flight 3's spec a settle-before-read clause from day one.
2. **Unify the chip refresh into one "tab derived-state changed" fan-out**
   before a fourth push source exists (design work — Flight 3's substrate
   leg or a maintenance leg), and **extract the generic dispatch switch out
   of `renderer.js`** so the budget stops being negotiated per leg.
3. **Treat #216 as a live-gated item wherever it is next touched.**
   Operator ruling: it stays in the backlog. When it is picked up, the AC
   is a by-eye check after a typed failure, and the leading hypothesis is
   the re-steal between `did-fail-load` and the error document's commit
   (move the `chromeNavPending` disarm to that document's `did-finish-load`
   or the next real `did-start-navigation`).
4. **Split acceptance-gate legs from build legs when a leg carries fixtures
   + apparatus + product surface** — Flight 3 should keep its behavior run
   in a leg that ships nothing else.
5. **Close the apparatus gaps in the crew file** (button activation under
   `pressKey`, `navigate`'s `isError` shape for blocked loads,
   settle-before-read, transient evidence never overwritten) and live-verify
   squawk 0079 before Flight 3 touches session plumbing.

## Action Items

- [ ] Crew-file servicing: `pressKey Enter` does not activate a `<button>`;
      `navigate` returns `isError` for a blocked TLS load; settle-before-read
      for census `security`; transient reads saved separately — **squawk 0080**
- [ ] CLAUDE.md: the per-tab-state rules (own push channel; never claim an
      unpushed state; state-owner refreshes its consumer; decision outranks
      cached observation) + the four-guard sheet-channel shape + the
      hostname-only observer note — **squawk 0081**
- [ ] Squawk 0079 — live-verify the M10 cookie bookkeeping after the
      partition decode fix (open)
- [ ] Squawk 0078 — duplicate `## Prompts` heading in the crew file (open)
- [ ] Unify the chip/indicator refresh path; extract the dispatch switch
      from `renderer.js` — design work, Flight 3 substrate leg or maintenance
- [ ] #216 — backlog by operator ruling; live-gated when picked up
- [ ] Hostname-keyed observer: port-aware key composed at the `did-navigate`
      read site — design work if a multi-port-same-host case ever matters
- [ ] Flight 3 spec: settle-before-read clause, "no preliminary click" on
      keyboard rows, a dedicated acceptance-gate leg
