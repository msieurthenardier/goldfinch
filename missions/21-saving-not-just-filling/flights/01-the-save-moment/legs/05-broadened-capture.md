# Leg: broadened-capture

**Status**: completed
**Flight**: [The Save Moment](../flight.md)

## Objective

Replace the native-`submit` capture trigger with the broadened gesture, wire
offer-on-settle, apply DD3c's disposition rule, and promote every corpus shape the
result solves. This is the leg the whole flight exists to reach.

## Context

Charter: DD1, DD3, DD3b, DD3c, DD3f, DD3g, DD3h, DD4. Legs 1–4 built everything
this consumes: held-capture drop safety, the isolated-world observer with
value-bound provenance and a three-state snapshot, and the corpus that defines
coverage.

**Where each decision lives — CORRECTED at design review.** An earlier draft said
gesture observation "belongs in the isolated world … the observer is already
there". That is not buildable with the landed primitives: `execInWorld`
(`vault-entry-tracker.js`) is **call/response only** — main asks, the world
answers. An isolated-world script has no `ipcRenderer` and no push channel, so it
cannot spontaneously tell the main world "a gesture just fired". The real split:
- **Main world owns the TRIGGER**: its own `isTrusted`-gated click/Enter listener
  (the DD1 pattern already used in `webview-preload.js` and `vault-fill-icon.js`)
  fires the `webFrame` call.
- **The isolated world owns the AUTHORITATIVE answer**: when asked, it returns the
  provenanced three-state snapshot.
- **Why a spoofed trigger is safe**: a forged gesture can only cause a read at the
  **wrong moment**, never a wrong value, because every value still comes from the
  provenanced snapshot the page cannot reach. Wrong-moment is budgeted (DD4);
  wrong-value is hard-zero. This is the reasoning that makes a main-world trigger
  acceptable — it is not an oversight.
- **Gesture POLICY** (does this gesture warrant a read) is main-world, per DD3g.

## Acceptance Criteria

- [x] A trusted click on a button-like element, or trusted Enter in a tracked
      field, snapshots the entry — including when the control sits **outside every
      form** and carries no `type` attribute (the motivating shape).
      `src/preload/vault-gesture-policy.js` (`isCaptureGesture`), wired in
      `webview-preload.js`'s gesture handlers. Headless-verified: corpus
      `checkout-submit-outside-form` (now `gated`/`offers`), `vault-gesture-policy.test.js`.
      Real-Electron end-to-end verification NOT completed — see the flight log.
- [x] The snapshot contains only provenanced values (DD3/DD3h three-state shape);
      an unprovenanced field's value is never sent. Unmodified from Leg 3's
      three-state shape; `snapshotHasProvenancedSecret` gates the send in
      `webview-preload.js`. `vault-entry-observer.test.js`.
- [x] **Read at GESTURE, release at SETTLE.** Implemented: `entryTracker.readSnapshot()`
      (same-process `webFrame` call) runs synchronously off the gesture handler in
      `webview-preload.js`; the result is held as a NEW `mode: 'pending-settle'`
      record in `vault-human.js` and released only by `captureRelease(wcId)`,
      called from `guest-wiring.js`'s `did-navigate` handler and from the new
      `guest-vault-gesture-settle` IPC (detachment case). TTL drop verified to
      never offer. `vault-gesture-capture.test.js`, `guest-wiring.test.js`.
- [x] A source scan finds no direct
      `webContents.executeJavaScriptInIsolatedWorld` (DD3f).
      `vault-entry-tracker.test.js`'s new source-scan test.
- [x] **A new held state exists in `vault-human.js`** — captured but not yet
      disposed/offered — distinct from `mode: 'locked'`, and **Leg 1's drop rules
      (lock / window close / tab close / TTL) cover it**, not just the locked one.
      `mode: 'pending-settle'`, same `captures` Map + `dropCapture` choke point —
      no new drop-rule wiring needed. `vault-gesture-capture.test.js`'s drop-rule
      section.
- [x] **DD3i**: provenance entries carry a bounded lifetime and are evicted on
      expiry as well as on detachment, value change and unload.
      `PROVENANCE_TTL_MS` (15 min) in `vault-entry-observer.js`; active timer
      eviction + passive read-time check + pagehide clear, all unit-tested.
- [x] Nothing depends on an isolated-world read resolving synchronously (DD3f).
      `readSnapshot`'s own deferred-promise test in `vault-entry-tracker.test.js`.
- [x] **DD3c, with a named wire field.** Implemented exactly as specified:
      `usernameDetected` threaded through `guest-vault-capture` → `holdGestureLogin`
      → the held record → `applyUsernameDowngrade`, applied AFTER `disposeCapture`
      (unmodified) in both the direct-release and `captureFinalize` paths. Both
      named cases covered in `vault-gesture-capture.test.js`.
- [x] **Secrets cross the IPC boundary as `Uint8Array`** exactly as today — the
      wire discipline is preserved. **But the exposure profile is NOT parity, and
      the leg says so** (DD3i) — documented in `docs/vault.md`'s new "save moment"
      section and in `vault-entry-observer.js`'s own header comment.
- [x] The existing exclusions hold unchanged: top-frame only, persistent jar only,
      no burner, no internal, no secret in a page DOM. All four gates untouched
      (`IS_TOP_FRAME`, `vaultEligible`/`resolvePersistJar`, no page-DOM writes).
- [x] **Corpus promotion is NOT vacuous.** `assertOffersEntry`/`assertNoOffer`
      (`test/helpers/save-moment-assertions.js`) exercise the REAL
      `vault-gesture-policy.js` + `vault-entry-observer.js` modules headlessly —
      never a reimplementation. `checkout-submit-outside-form`,
      `two-login-forms-second-target`, `plain-login-form` promoted to
      `gated`/`offers`. `spa-submit-no-navigation` and
      `framework-rerender-field-replacement` deliberately NOT promoted — both stay
      `known-unsolved` with an updated note explaining why (settle/provenance
      gaps this leg does not, and per DD4/DD3g-h should not, close).
- [x] `assertNoOffer` becomes real, and the deferred gesture-negative fixtures are
      asserted with it — **zero offers across the whole negative set**.
      `decoy-cancel-beside-password` promoted from `{todo:true}` to an ordinary
      gated test. Its manifest entry documents the honest limit of what this
      HEADLESS assertion proves (no provenance ⇒ no offer, regardless of which
      button is clicked) versus the stronger click-vs-settle claim, which needed
      live verification that could not be completed — see the flight log.
- [x] **DD6's live extractor cross-check runs here.** PARTIALLY completed: a
      live Chromium tab confirmed BOTH pinned form-association rules (a nested
      `<form>` is ignored per the parsing algorithm; a `form=` IDREF associates a
      field with no containing form) via `evaluate` against a purpose-built page
      exercising the same shapes, matching the extractor's own unit-tested
      behaviour. This is NOT the letter of the AC — a committed corpus fixture
      file was not loaded end-to-end through a real gesture — because synthetic
      input (`click`/`typeText`/`pressKey`) was not being delivered into guest
      pages in the available dev-automation session (see the flight log for the
      diagnostic and the likely rig cause). Recorded honestly, not claimed done.
- [x] **Multi-form gesture precision restored via entry ORDINAL** (an integer,
      never a node reference), recovering the PR#112 finding-9 behaviour Leg 3
      accepted losing. `resolveOrdinalInFamily`/`resolveGestureTarget` in
      `vault-gesture-policy.js`; corpus `two-login-forms-second-target`
      (`expectedOrdinal: 1`, its own `#submit2` gesture selector) plus dedicated
      unit tests.

## Verification Steps

- The corpus: gated tier 100% green, negative set zero offers, known-unsolved
  shapes still named and documented.
- Unit coverage for the gesture policy, the settle routing, DD3c's two paths, and
  the buffer discipline at the hop.
- **Live, on `npm run dev:automation`**: (a) the motivating submit-outside-the-form
  shape actually raises a save offer end to end; (b) a gesture that leads nowhere
  raises none; (c) **DD6's extractor cross-check** — load at least one committed
  fixture in the real browser and compare its detection result against the
  headless extractor's, validating the parser rather than trusting it.
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run format`.

## Implementation Guidance

1. **Gesture classification is new logic, not a rewire.** Nothing in
   `src/preload` or `src/shared` has a button-like/`type=submit`/role helper today,
   and the observer currently grants provenance on *every* keydown, not Enter
   specifically. Build the classifier fresh and unit-test it.
1b. **The ordinal needs its own main-world detection pass**, reusing
   `findAllLoginFields`/`findAllCardFields` — the `resolveTargetForAnchor` split-
   context precedent in `vault-entry-tracker.js`. Do NOT reach for a document-order
   index; DD3g rejected that.
2. **Settle**: main's existing per-tab `did-navigate` wiring is the strong signal;
   the observer reports detachment for the SPA case. Route the read per DD3f.
3. **Promote corpus shapes as they go green** — one manifest line each. Resist the
   pull to delete a stubborn shape; demotion needs the same deliberate ruling as
   any other criterion change.
4. **Do not reintroduce the old submit listener.** It is superseded; leaving both
   would double-fire and reintroduce the `e.target`/bare-`.value` reads the flight
   log flagged as carrying both spoof classes.

## Edge Cases

- **A gesture on a page with several detected entries** — see the ordinal criterion.
- **Navigation to a different origin before settle** — the capture's origin is
  main-derived at capture time, never re-derived at settle.
- **Vault locked at settle** — the existing `mode: 'locked'` hold-and-prompt path
  applies unchanged; Leg 1's drop rules bound its lifetime.

## Out of Scope

- Identity items, the password generator, the icon redesign — Flights 2 and 3.

## Files Affected

- `src/preload/vault-entry-observer.js`, `vault-entry-tracker.js`,
  `webview-preload.js` — gesture, settle reporting, the hop.
- `src/main/guest-wiring.js` / `register-browser-ipc.js` — settle release gate and
  the capture hop (`usernameDetected` threaded through).
- `src/main/vault/vault-human.js` — the new held-pending-settle state, the DD3c
  post-dispose downgrade, and drop-rule coverage for the new state.
- `test/fixtures/save-moment/manifest.js` — promotions.
- Corresponding unit tests.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified — all HEADLESSLY (unit + corpus); the live
      end-to-end save-offer flow ((a)/(b) of Verification Steps) and the letter of
      DD6's live extractor cross-check ((c)) were NOT completed live — a
      synthetic-input-delivery rig issue blocked them (see the flight log). Every
      other criterion is genuinely, not vacuously, verified.
- [x] Tests passing (`npm test`, `npm run lint`, `npm run typecheck`)
- [x] `npm run format` run
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [ ] Check off this leg in flight.md — left to the flight-end review, since the
      live-verification gap above is a real, unresolved item the Reviewer should
      see before the flight itself is called done.
- [x] Do NOT commit — the flight-end Reviewer sees the whole diff
