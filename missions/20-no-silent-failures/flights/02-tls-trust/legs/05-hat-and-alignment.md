# Leg: hat-and-alignment

**Status**: completed
**Flight**: [TLS Trust — Interstitial, Override, Indicator, Viewer](../flight.md)

## Objective

The operator walks the TLS trust surfaces on the live app — interstitial,
viewer, override card, chip and popup states, remembered origin, second
window and second jar — verifies fix F4 by eye, brings look-and-feel
opinions, and every fix found is landed inline before the flight lands.

## Context

- Interactive leg (operator-elected at planning). The Flight Director
  presents one step, the operator performs and reports, the FD fixes
  inline — spawning a Developer for any code change. **Fix-vs-feature
  gate**: new behaviour is promoted to a scoped design review; look-and-feel
  fixes ride the inline protocol. **Multi-surface trigger**: a fix touching
  more than the surface under test gets a lightweight Developer design pass.
- **Frozen contracts (flight DD16)**: the panel ids (`#load-failure-*` incl.
  `-view-cert`, `-advanced`), chip `data-security` values and label
  vocabulary, `cert-override`/`cert-viewer` menuTypes and row roles, census
  `loadState`/`security` values, the `tab-security` payload,
  `tab-certificate-get`'s summary shape. A HAT change to any of them is a
  spec re-author (`tls-trust-surface.md`), handled deliberately.
- Known Issue **#216** (operator ruling 2026-09-16): a typed failed
  navigation strands keyboard focus; the workaround during this HAT is a
  click into the panel first. Not re-fixed here.
- **F4 verification** (operator ruling at the acceptance run): the chip
  must be NEUTRAL (dim closed lock, "Site information, host") while a new
  tab to an https origin is loading, never green before the state arrives.
- Rig facts: leg 1's Context verbatim (key hygiene absolute; `127.0.0.2`
  refuses; kill by port pid; ozone wayland). Fixtures: `serve-tls.mjs --port
  {T}` (untrusted), `--port {T2} --cert-set trusted` with the trusted CA
  imported (`import-trust-anchor.mjs --import` before launch, `--remove`
  after), `python3 -u -m http.server {P} --bind 127.0.0.2 --directory
  tests/behavior/fixtures/keyboard-nav`.
- Deviation ruling: the flight Verification section's `navigation-failure-
  surface` Witnessed re-run is replaced by an operator smoke of the Flight 1
  surface inside this HAT (H10), because its keyboard row would now fail on
  #216 by construction and the remaining rows are exercised here by hand.

## Inputs

- Branch `flight/02-tls-trust` at `3010513` (legs 1–4 committed, PR #217
  draft); rig up on that build; operator at the window.

## Outputs

- Flight log HAT table (H1–H12 verdicts; every fix with its classification;
  deferred items as squawk ids); inline fixes committed with the flight;
  `tls-trust-surface.md` re-authored (keyboard rows gain "no preliminary
  click"; Status → `active` once the operator confirms the surfaces);
  fixtures README stale sentence fixed (docs pass).

## Acceptance Criteria

- [x] **H1 — Interstitial (untrusted).** Type `https://127.0.0.1:{T}/` and
      Enter. Verdict on: copy, address and code lines, the three buttons'
      order and labels, palette against the chrome; the strip glyph/title;
      the chip NEUTRAL (not green) during and after the load.
- [x] **H2 — F4 by eye.** Open a NEW tab and type `https://127.0.0.1:{T2}/`
      (trusted). Watch the chip while it loads: neutral until commit, then
      green. Then a new tab to `https://127.0.0.1:{T}/`: neutral throughout
      (interstitial). Verdict: no green lock before the state arrives.
- [x] **H3 — View certificate.** On the interstitial click View certificate.
      Verdict on the card: status line, Issued to/by, validity, SANs,
      fingerprints, chain rows (leaf → CA, CA → CA), scrolling, Close and
      Escape.
- [x] **H4 — Advanced → Back to safety.** Click Advanced; focus lands on
      Back to safety; Escape closes; Advanced again → Back closes; backdrop
      click closes. Verdict on copy and the two buttons' visual weight.
- [x] **H5 — Proceed.** Advanced → Proceed. Verdict on: the page loads, the
      strip clears, the chip shows the red open lock with "not secure —
      certificate error overridden", the popup's Connection row, the
      Certificate action → viewer with status "Overridden this session".
- [x] **H6 — Remembered origin.** New tab to the same origin loads directly
      (no interstitial), chip overridden. Then a new tab to
      `https://localhost:{T}/` → a fresh interstitial (different host).
- [x] **H7 — Second window, second jar.** Move the overridden tab to a new
      window (context menu): chip/popup state travel. Open the same origin in
      a DIFFERENT jar (container picker): the interstitial shows (override
      memory is per jar).
- [x] **H8 — Plain http and trusted https.** `http://127.0.0.2:{P}/links.html`
      → chip red open lock "not secure", popup "Not secure (HTTP)", no
      Certificate action. `https://127.0.0.1:{T2}/` → green, "Secure
      (HTTPS)", Certificate → viewer "Trusted".
- [x] **H9 — Keyboard (with the #216 workaround).** On an interstitial, click
      the panel once, then F6 → heading; Tab → Retry → View certificate →
      Advanced; Enter opens the card; Tab cycles Back ↔ Proceed; Escape.
      Verdict on rings and order. (The click-first is #216, not judged here.)
- [x] **H10 — Flight 1 smoke.** `http://127.0.0.2:{Q}/` (refused) →
      generic panel, Retry after starting a server on `{Q}` recovers; a DNS
      failure; Ctrl+Shift+T reopens a closed failed tab at its address.
- [x] **H11 — Look and feel, window-wide.** Resize, media panel, bookmarks
      bar, kebab over the interstitial and the viewer card; nothing animates
      the guest slot. The operator's own look-and-feel opinions are walked
      here (or where they belong above).
- [x] **H12 — Docs and spec.** The fixtures README's stale "no
      `certificate-error` handler" sentence fixed; `tls-trust-surface.md`
      keyboard rows carry "no preliminary click"; spec Status → `active`.

## Verification Steps

Operator verdicts, one step at a time, in the flight log's HAT table. A
failed step is diagnosed and fixed inline, then re-verified.

## Implementation Guidance

1. Present H1; wait; fix or proceed. Repeat through H12.
2. Each fix: classify out loud (fix / feature / contract); four gates; a
   contract change re-authors the spec row.
3. After H12: HAT entry, leg `completed`, flight completion checklist.

## Edge Cases

- **Operator asks for auto-proceed memory across restarts or a "always
  trust this site" option**: feature → out of scope (the #144 follow-on).
- **Operator cannot reproduce a run-passing step**: record both; the run
  log is the acceptance record, the HAT the alignment record.

## Files Affected

- `missions/20-no-silent-failures/flights/02-tls-trust/flight-log.md`
- `tests/behavior/tls-trust-surface.md`,
  `tests/behavior/fixtures/web-compat/README.md`
- Whatever an inline fix touches.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed`
- [x] Check off this leg in flight.md
- [x] If final leg of flight:
  - [x] Update flight.md status to `landed`
  - [x] Check off flight in mission.md
- [x] Commit all changes together (code + artifacts)
