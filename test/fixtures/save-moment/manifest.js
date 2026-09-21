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
// Leg 6 (hat-and-alignment) CORRECTION — 'offers' split into 'captures' and
// 'offers': a live HAT walk found that Leg 5's 'offers' assertion actually
// proved only CAPTURE-WORTHINESS (a gesture resolves a detected entry carrying
// a provenanced secret worth holding) and never exercised DD4's release/settle
// half at all. checkout-submit-outside-form was promoted to 'gated'/'offers'
// at Leg 5 despite having NO possible settle signal (no navigation, no form,
// no script) — the third instance in this flight of an assertion proving less
// than its name claimed. Fixed: 'captures' is the renamed, honestly-scoped
// Leg 5 behavior; 'offers' is now STRENGTHENED to additionally require a real,
// headlessly-provable settle signal (native HTML form submission — the one
// settle path this corpus can prove without executing page script). A shape
// earns 'offers' only when that holds for its own gesture; otherwise it earns,
// at most, 'captures'. See test/helpers/save-moment-assertions.js's own header
// for the full mechanism and flight-log.md for the live finding.
//
// Entry shape:
//   id               string, unique, matches the fixture's own file-header title.
//   tier             'gated' | 'known-unsolved' | 'negative-detection' |
//                     'negative-gesture'
//   assert           'detects' | 'no-detect' | 'captures' | 'offers' |
//                     'no-offer' — which assertion function in
//                     test/helpers/save-moment-assertions.js runs. 'captures'
//                     proves only capture-worthiness; 'offers' proves that PLUS
//                     a real, headlessly-provable settle signal (Leg 6 —
//                     hat-and-alignment — see that helper's own module header).
//   family           'login' | 'card' | 'identity' | null — required when
//                     assert is 'detects', 'captures', or 'offers'. Three-way
//                     as of Mission 21, Flight 2, Leg 2 (identity-boundary) —
//                     the identity family is DETECTION ONLY at this leg
//                     (no store, no capture/offer machinery yet — Flight 3),
//                     so every identity-family entry currently carries
//                     assert: 'detects' or lives in the negative-detection
//                     tier with family: null.
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
//   gestureSelector  optional selector string for `assert:
//                     'captures'|'offers'|'no-offer'` — which element
//                     assertCapturesEntry/assertOffersEntry/assertNoOffer
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
    // Also serves as this leg's (Mission 21, Flight 2, Leg 2 —
    // identity-boundary) required "existing anonymous field1/field2/field3
    // shape" adversarial fixture for the identity family — reused, not
    // paralleled, per flight.md's own Technical Approach. Now that
    // assertNoDetectableEntry covers identity too, this single fixture
    // proves the shape for all three families at once.
  },

  // --- identity family (Leg 2 — identity-boundary): adversarial REFUSED set --
  {
    id: 'job-application-bare-city',
    tier: 'negative-detection',
    assert: 'no-detect',
    family: null,
    file: 'identity/job-application-bare-city.html'
  },
  {
    id: 'flight-search-destination',
    tier: 'negative-detection',
    assert: 'no-detect',
    family: null,
    file: 'identity/flight-search-destination.html'
  },
  {
    id: 'newsletter-name-and-email',
    tier: 'negative-detection',
    assert: 'no-detect',
    family: null,
    file: 'identity/newsletter-name-and-email.html'
  },
  {
    id: 'shipping-cost-estimator',
    tier: 'negative-detection',
    assert: 'no-detect',
    family: null,
    file: 'identity/shipping-cost-estimator.html'
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
    // DEMOTED 'gated'/'offers' -> 'known-unsolved'/'captures' at Leg 6
    // (hat-and-alignment) — a live HAT finding. THE MOTIVATING SHAPE (see the
    // fixture's own header): a plain <button>, no `type` attribute, sitting
    // OUTSIDE every form, no script (this corpus's extractor never
    // parses/executes <script> — DD6). Detection and the gesture/ordinal/
    // provenance layer are all correct for it TODAY — assert: 'captures'
    // proves exactly that. What is NOT proven, and cannot be proven
    // headlessly for THIS unassociated-button sub-mechanism, is that an
    // offer is ever RELEASED: the real page's settle signal is a script-
    // driven fetch/XHR completion this static fixture has no script to model
    // (DD4's own settle gate — navigation commit or field detachment — never
    // fires for a page with no script at all). See the fixture's own header
    // for the full accounting and flight-log.md for the live finding that
    // caught this. checkout-submit-outside-form-formattr (below) gates the
    // same DOM shape via a sub-mechanism this corpus CAN prove settles.
    id: 'checkout-submit-outside-form',
    tier: 'known-unsolved',
    assert: 'captures',
    family: 'card',
    file: 'known-unsolved/checkout-submit-outside-form.html',
    gestureSelector: '#place-order'
  },
  {
    // Added at Leg 6 (hat-and-alignment) alongside the demotion above — see
    // the fixture's own header for the full rationale. Same "submit control
    // lives outside the fields' <form>" shape, wired via the HTML5 `form=`
    // IDREF so a real, script-free native form submission (and therefore a
    // real navigation — DD4's settle signal) fires on click, honestly
    // provable headlessly by `wouldNativelySubmit`.
    id: 'checkout-submit-outside-form-formattr',
    tier: 'gated',
    assert: 'offers',
    family: 'card',
    file: 'known-unsolved/checkout-submit-outside-form-formattr.html',
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
  },

  // --- identity family (Leg 2 — identity-boundary): DETECTION ONLY -----------
  // 'gated'/'detects', never 'captures'/'offers' at this leg — no store, no
  // capture/offer machinery for identity exists yet (Flight 3).
  {
    // THE MOTIVATING PAGE. See the fixture's own header for the full
    // accounting: every field carries autocomplete="on" (a useless hint), so
    // detection runs entirely off the LD1 alternatives-model fallback
    // vocabulary. PROMOTED to 'offers' at Mission 21, Flight 3, Leg 4
    // (identity-capture, AC19) — tier and assert together, per this leg's own
    // discipline: the submit button sits INSIDE `<form id="billing-address">`,
    // so a real, headlessly-provable native form submission earns `offers`
    // rather than only `captures` (decided by reading the fixture, per DD4).
    id: 'billing-jostens',
    tier: 'gated',
    assert: 'offers',
    family: 'identity',
    file: 'identity/billing-jostens.html'
  },
  {
    // ACCEPTED, NAMED false positive — see the fixture's own header and
    // flight.md DD1/LD4 decision 3. Stays 'gated'/'detects', pinned
    // admitted-with-reasoning, not a defect to chase.
    id: 'incident-report-third-party',
    tier: 'gated',
    assert: 'detects',
    family: 'identity',
    file: 'identity/incident-report-third-party.html'
  }
];
