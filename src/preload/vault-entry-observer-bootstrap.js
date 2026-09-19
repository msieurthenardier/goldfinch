'use strict';

// Isolated-world INSTALL entry point (Mission 21, Flight 1, Leg 3 — entry-tracker,
// DD3h). Bundled by scripts/build-preload.mjs's observer esbuild target into a
// self-contained script string, embedded as a generated constant
// (vault-entry-observer-bundle.generated.js), and injected via
// webFrame.executeJavaScriptInIsolatedWorld — NEVER required directly by
// production code (webview-preload.js consumes the GENERATED text, not this
// file) and NEVER required under `node --test` either: it has real `window` /
// `document` side effects at module-evaluation time, by design (this is exactly
// what must run inside the isolated world). vault-entry-tracker.js and
// vault-entry-observer.js carry this leg's TESTABLE logic; this file is
// deliberately tiny glue.
//
// Idempotent: re-running this script against a world that already has the
// handle installed is a safe no-op (guards `install-timing race` shapes; the
// flight spec names this as an accepted, fails-closed edge case, never a
// forged-provenance one).
//
// Fill-and-grant happen HERE, in one call, in this world (DD3h) — the write
// moves into the isolated world rather than trying to correlate a main-world
// write back to this world's provenance map, which DD3g proved cannot be done
// without crossing a node identity. The RETURN VALUE crossing back out to main
// is deliberately SANITIZED to `{ filled: boolean }` — no node reference, no
// per-field detail — because nothing outside this world may ever receive one
// (DD3g: "It emits a snapshot of plain, serializable values — never a handle.").

const { createEntryObserver } = require('./vault-entry-observer');
const { findAllLoginFields, fillLoginForm } = require('./vault-fill-fields');
const { findAllCardFields, fillCardForm } = require('./vault-card-fields');
const { VAULT_ENTRY_OBSERVER_HANDLE } = require('./vault-entry-observer-handle');

if (!window[VAULT_ENTRY_OBSERVER_HANDLE]) {
  let lastReportedSnapshot = null;

  const observer = createEntryObserver({
    document,
    findAllLoginFields,
    findAllCardFields,
    report: (snap) => {
      lastReportedSnapshot = snap;
    }
  });
  observer.install();

  window[VAULT_ENTRY_OBSERVER_HANDLE] = {
    fillLogin(cred) {
      const result = fillLoginForm(document, cred);
      observer.grantForFill(result);
      return { filled: !!result.filled };
    },
    fillCard(card) {
      const result = fillCardForm(document, card);
      observer.grantForFill(result);
      return { filled: !!result.filled };
    },
    // The GESTURE-TIME read (Leg 5, DD3f corrected — a same-process call, never
    // a cross-process `webContents.executeJavaScriptInIsolatedWorld`): the
    // main-world tracker calls this via `execInWorld` in direct response to a
    // qualifying capture gesture, and holds the plain-data result main-side
    // until settle. Kept as its own named method (rather than repurposing
    // `getSnapshot` below) so a future diagnostic caller and the real
    // production trigger can never be confused for one another.
    snapshot() {
      return observer.snapshot();
    },
    // Diagnostic-only alias, kept for the dev-console introspection this leg's
    // own Leg 3 predecessor already documented.
    getSnapshot() {
      return observer.snapshot();
    },
    getLastReportedSnapshot() {
      return lastReportedSnapshot;
    }
  };
}
