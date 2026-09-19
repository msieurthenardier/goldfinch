'use strict';

// The tier manifest for the save-moment fixture corpus (Mission 21, Flight 1,
// Leg 4 — fixture-corpus, DD6). THIS IS THE ONLY SOURCE OF TIER — directory
// layout under this folder (negative-detection/, negative-gesture/,
// known-unsolved/) is COSMETIC ONLY and must never be read as a second,
// driftable source of truth. test/unit/save-moment-corpus.test.js reads only
// this file to decide what runs, how (ordinary test vs. `{ todo: true }`), and
// against which assertion.
//
// Shapes are PROMOTED when solved (tier: 'known-unsolved' -> 'gated', or
// 'negative-gesture' -> 'negative-detection' if it ever becomes cheaply
// detectable) and NEVER DELETED to make the suite pass. Demotion needs the same
// deliberate ruling as any other criterion change — see flight.md's own framing.
//
// Leg 5 (broadened-capture) promotion note: promoting a shape updates BOTH
// `tier` AND `assert` together — 'detects' is pure detection (this flight never
// touched it, DD7) and promoting a shape while leaving that assertion in place
// would pass regardless of whether the gesture/settle/DD3c mechanism works at
// all (the same defect class Leg 4's own review caught for the negative set).
// 'offers'/'no-offer' are the real, non-vacuous replacements — see
// test/helpers/save-moment-assertions.js's own header for exactly what they
// exercise headlessly (the gesture-policy layer) versus what stays a required
// LIVE verification step (settle itself — DD3f/DD4 fire main-process-side).
//
// Entry shape:
//   id               string, unique, matches the fixture's own file-header title.
//   tier             'gated' | 'known-unsolved' | 'negative-detection' |
//                     'negative-gesture'
//   assert           'detects' | 'no-detect' | 'offers' | 'no-offer' — which
//                     assertion function in
//                     test/helpers/save-moment-assertions.js runs.
//   family           'login' | 'card' | null — required when assert is
//                     'detects' or 'offers'.
//   file             path to the fixture HTML, relative to this manifest's own
//                     directory. Omitted only for a fixture that is built
//                     entirely by `simulate` (none currently need this).
//   simulate(doc)    optional (doc) => void hook, run AFTER extraction and
//                     BEFORE assertion, for shapes that are inherently dynamic
//                     and cannot be expressed as static markup alone (e.g. a
//                     framework re-render that swaps one node for another).
//   expectedOrdinal  optional integer (never a node reference) — which detected
//                     entry, among all entries of `family`, is the one this
//                     fixture is about. Defaults to 0.
//   gestureSelector  optional selector string for `assert: 'offers'|'no-offer'`
//                     — which element `assertOffersEntry`/`assertNoOffer`
//                     synthesize the trusted click on. A leading `#` resolves
//                     by id; otherwise it is handed to the extractor's own
//                     (deliberately narrow) `querySelectorAll`. Defaults to the
//                     first button-like element in document order.

const { createFragment } = require('../../helpers/fixture-extractor');

module.exports = [
  // --- negative-detection: gated NOW ----------------------------------------
  {
    id: 'search-box',
    tier: 'negative-detection',
    assert: 'no-detect',
    family: null,
    file: 'negative-detection/search-box.html'
  },
  {
    id: 'newsletter-signup',
    tier: 'negative-detection',
    assert: 'no-detect',
    family: null,
    file: 'negative-detection/newsletter-signup.html'
  },
  {
    id: 'unhinted-billing-fields',
    tier: 'negative-detection',
    assert: 'no-detect',
    family: null,
    file: 'negative-detection/unhinted-billing-fields.html'
  },

  // --- negative-gesture: REAL as of Leg 5 (assertNoOffer is no longer a stub) --
  {
    id: 'decoy-cancel-beside-password',
    tier: 'negative-gesture',
    assert: 'no-offer',
    family: null,
    file: 'negative-gesture/decoy-cancel-beside-password.html',
    // WHICH control the assertion clicks — the fixture's whole point. Note the
    // honest limit of what this headless assertion actually proves (see
    // save-moment-assertions.js's header): the fixture's fields carry NO
    // value, so no provenance is ever granted regardless of which button is
    // clicked — clicking #submit here would ALSO produce "no offer", because
    // DD1's gesture stays deliberately broad (button-like, not
    // submit-specific) and DD3's provenance gate is what actually admits a
    // value, not which button fired the click. What this entry proves is that
    // an untyped field's gesture never creates a holdable capture. The
    // stronger claim the fixture's own comment makes — that a REAL typed
    // password followed by Cancel produces no offer because the click never
    // SETTLES (no navigation, no detachment) — is a main-process property
    // this headless corpus cannot simulate; it is covered by this leg's
    // required LIVE verification step (b): "a gesture leading nowhere raises
    // none."
    gestureSelector: '#cancel'
  },

  // --- gated: positive shapes, promoted by Leg 5 (tier AND assert both moved) --
  {
    id: 'checkout-submit-outside-form',
    tier: 'gated',
    assert: 'offers',
    family: 'card',
    file: 'known-unsolved/checkout-submit-outside-form.html',
    // THE MOTIVATING SHAPE (see the fixture's own header): a plain <button>,
    // no `type` attribute, sitting OUTSIDE every form.
    gestureSelector: '#place-order'
  },
  {
    // STAYS known-unsolved / 'detects' — DD4's own named trade-off, not a
    // gesture-policy gap: this fixture's submit handler neither navigates NOR
    // removes its fields (see its own file header), so NEITHER of DD4's two
    // settle signals ever fires, regardless of how well the gesture/ordinal/
    // provenance layer works. `assertOffersEntry` would pass here today (the
    // gesture-policy layer has nothing wrong with this shape) — it is
    // deliberately NOT promoted, because a headless "offers" pass would
    // misrepresent a shape whose real-world outcome depends entirely on
    // settle, which this corpus does not simulate.
    id: 'spa-submit-no-navigation',
    tier: 'known-unsolved',
    assert: 'detects',
    family: 'login',
    file: 'known-unsolved/spa-submit-no-navigation.html'
  },
  {
    // STAYS known-unsolved / 'detects' — an honest, PERMANENT documented gap
    // (see the fixture's own header and DD3g/DD3h's provenance-keyed-by-
    // node-reference design), not something Leg 5's trigger touches. Never
    // expected to promote.
    id: 'framework-rerender-field-replacement',
    tier: 'known-unsolved',
    assert: 'detects',
    family: 'login',
    file: 'known-unsolved/framework-rerender-field-replacement.html',
    // AFTER mutation: unmount the original #pw node and mount a fresh,
    // equivalent-looking one in its place — the framework-re-render shape
    // cannot be expressed as static markup, so this hook builds it.
    simulate(doc) {
      const oldField = doc.getElementById('pw');
      const parent = oldField.parentNode;
      const idx = parent.children.indexOf(oldField);
      parent.children.splice(idx, 1);
      const [freshField] = createFragment(
        doc,
        '<input type="password" id="pw" name="password" autocomplete="current-password">'
      );
      freshField.parentNode = parent;
      parent.children.splice(idx, 0, freshField);
      // The new node now wins id lookups — matches a real re-render, where the
      // new element occupies the same id at the same document position.
      doc._idIndex.set('pw', freshField);
    }
  },
  {
    id: 'two-login-forms-second-target',
    tier: 'gated',
    assert: 'offers',
    family: 'login',
    file: 'known-unsolved/two-login-forms-second-target.html',
    expectedOrdinal: 1,
    // The SECOND form's own submit control — proves ORDINAL disambiguation,
    // not just document-order luck.
    gestureSelector: '#submit2'
  },
  {
    id: 'plain-login-form',
    tier: 'gated',
    assert: 'offers',
    family: 'login',
    file: 'known-unsolved/plain-login-form.html'
  }
];
