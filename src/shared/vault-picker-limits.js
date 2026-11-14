// The ONE time limit of a vault picker open (Mission 23 Flight 1, leg `vault-fill-trust`).
//
// Two lifetimes are bound to the same operator interaction and must not drift apart:
//   - main's per-open picker context (`src/main/vault/picker-context.js`): how long a raised picker can
//     still reach the fill channels; and
//   - the guest's fill target (`src/preload/vault-fill-icon.js`): how long the clicked form's field stays
//     bound for the round trip to the chrome-owned picker and back.
// An unlock (which can take a minute) sits between the gesture and the pick, so the first draft's 60 s
// guest lifetime against a longer context would end in a silent no-fill. One constant, both sides.
//
// Real ES module: required by the sandboxed guest preload through its bundle and by main-side code via
// require(esm), like every other pure module here.

// Wall-clock time is deliberate here: a clock step can only lengthen or shorten one open by its own size.
/** 120 seconds, in milliseconds. */
export const PICKER_TTL_MS = 120 * 1000;
