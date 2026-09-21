'use strict';

// Isolated-world entry OBSERVER core (Mission 21, Flight 1, Leg 3 — entry-tracker,
// DD3f/DD3g/DD3h). Deployed into a dedicated isolated world (see
// webview-preload.js's install site) so every read it performs is immune BY
// CONSTRUCTION to a page-authored spoof of Event.prototype.isTrusted / .target /
// HTMLInputElement.prototype.value — Leg 2's live spike (Q2) proved a main-world
// `Object.defineProperty` on either an instance or a prototype is invisible from
// a SEPARATE isolated world. That ends the enumerated-captured-accessor category
// (DD3d/DD3e) for everything that lives here: this module reads `.value` /
// `.isTrusted` / `.target` directly, with no captured-native-getter dance — the
// isolated world's own prototypes are already un-spoofed, by construction, no
// matter when this script runs relative to page script.
//
// This file is a plain, Electron-free, injected-deps CJS module — its LOGIC is
// `require()`-able and unit-tests under `node --test` against a fake document
// (test/unit/vault-entry-observer.test.js). Only the property "this genuinely
// executes inside a spoof-immune isolated world" needs the live probe (DD3f) —
// everything else here is ordinary, testable JS. Deployment as isolated-world
// TEXT is a build-time concern (scripts/build-preload.mjs, via
// vault-entry-observer-bootstrap.js) — this file itself is never eval'd as a
// bare string and never contains `window`/`document` as bare globals.
//
// OWNS (DD3g — "no node identity ever crosses the world boundary. The isolated
// world owns detection AND provenance; only plain data crosses."):
//   - detection, via the injected findAllLoginFields / findAllCardFields;
//   - the provenance Map, keyed by ITS OWN node references;
//   - its own MutationObserver, for detachment eviction;
//   - the DD3 value-equality check (a snapshot admits a field's value only while
//     the field's LIVE value still equals what was recorded at the granting
//     instant — never a sticky "this field was typed into" flag, which review
//     round 2 of Leg 2 rejected as a TOCTOU hole one layer down).
// Emits ONLY plain, serializable data via `report` — never a node handle.
//
// CARRIES NO POLICY (pinned by test/unit/vault-entry-observer.test.js's source
// scan + line-ceiling check, the house RENDERER_LINE_BUDGET idiom): the words this
// scan forbids are spelled out only in that test file, never here — this module
// itself never names the persistence disposition vocabulary Leg 5 owns (new
// record vs. overwrite an existing one), and carries no IPC symbol anywhere.
// Gesture gating, snapshot timing, DD3c's disposition rule, and the hop to main
// all live in vault-entry-tracker.js instead (DD3g: "The main-world module does
// policy... The isolated world does observation, detection, provenance
// bookkeeping and the equality check.").
//
// `.isConnected`-style DOM read is fine here. DD3e's prohibition on `.isConnected`
// is SUPERSEDED inside this module (Leg 3 edge-case note): it existed because
// `.isConnected` is a spoofable MAIN-WORLD accessor, and a page cannot reach
// anything inside a separate isolated world at all. The recursive removed-node
// subtree search below is unrelated to that prohibition — it stays regardless,
// because a framework unmount removes a WRAPPER element, not each input
// (Leg 2 review round 2).

/** Login entry roles this module ever reads/snapshots. */
const LOGIN_ROLES = ['username', 'password'];
/** Card entry roles this module ever reads/snapshots. */
const CARD_ROLES = ['number', 'cardholder', 'expiry', 'expMonth', 'expYear', 'csc'];
// Identity roles (M21 F3 Leg 3): imported, never hand-typed a third time
// (AC3b) — the single source is vault-identity-fields.js's own derived union.
const { IDENTITY_ROLES } = require('./vault-identity-fields');

// DD3i (Leg 5 design review): provenance retention is BOUNDED, not indefinite.
// Before this flight a plaintext password existed only transiently inside one
// synchronous `submit` handler. `grant()` below now stores a plain JS string
// in this world's own provenance map on every trusted keystroke, persisting
// for the field's lifetime with no TTL otherwise — an honestly WORSE exposure
// profile than before (more un-zeroable hops, a longer window), stated rather
// than claimed as parity. Fifteen minutes comfortably covers a realistic
// fill-then-submit (including a step-up 2FA prompt in between) without
// approaching a browsing-session-length window.
const PROVENANCE_TTL_MS = 15 * 60 * 1000;

/**
 * @param {object} deps
 * @param {any} deps.document
 * @param {(doc: any) => Array<{username: any, password: any, form: any}>} deps.findAllLoginFields
 * @param {(doc: any) => Array<{number: any, cardholder: any, expiry: any, expMonth: any, expYear: any, csc: any, form: any}>} [deps.findAllCardFields]
 * @param {(doc: any) => any[]} [deps.findAllIdentityFields]  identity entries (M21 F3 Leg 3).
 * @param {(snapshot: { logins: any[], cards: any[], identities: any[] }) => void} [deps.report]
 *   called with the CURRENT full snapshot after every provenance-affecting event
 *   (a grant, a fill-grant, or a detachment eviction) — plain data only, per DD3g.
 * @param {() => number} [deps.now]  clock (default Date.now) — injected so the DD3i TTL is
 *   unit-testable with no wall-clock wait (the vault-human.js `now` idiom).
 * @param {(fn: () => void, ms: number) => any} [deps.setTimeout]  DD3i's per-grant expiry
 *   timer arm (default global `setTimeout`).
 * @param {(handle: any) => void} [deps.clearTimeout]  DD3i's per-grant expiry timer clear
 *   (default global `clearTimeout`).
 */
function createEntryObserver({
  document: doc,
  findAllLoginFields,
  findAllCardFields,
  findAllIdentityFields,
  report,
  now,
  setTimeout: injectedSetTimeout,
  clearTimeout: injectedClearTimeout
}) {
  const loginEntries = typeof findAllLoginFields === 'function' ? findAllLoginFields : () => [];
  const cardEntries = typeof findAllCardFields === 'function' ? findAllCardFields : () => [];
  const identityEntries = typeof findAllIdentityFields === 'function' ? findAllIdentityFields : () => [];
  const _now = typeof now === 'function' ? now : Date.now;
  // `setTimeout`/`clearTimeout` are HOST-provided, not a standard-JS built-in
  // (unlike `Date` above) — a bare reference to either, evaluated where no
  // global of that name exists at all (a raw `vm` context, or a genuinely
  // exotic isolated-world realm), is a ReferenceError, not merely `undefined`.
  // `typeof` is the only safe way to probe for one before touching it — the
  // SAME discipline `armMutationObserver` below already uses for
  // `MutationObserver`. A missing timer fails closed: provenance is granted
  // with no TTL bound rather than throwing install() itself.
  const _setTimeout =
    typeof injectedSetTimeout === 'function'
      ? injectedSetTimeout
      : typeof setTimeout !== 'undefined'
        ? setTimeout
        : null;
  const _clearTimeout =
    typeof injectedClearTimeout === 'function'
      ? injectedClearTimeout
      : typeof clearTimeout !== 'undefined'
        ? clearTimeout
        : null;

  // field node -> { value: string, expiresAt: number, timer: any } — the value
  // observed AT THE GRANTING INSTANT (DD3: a trusted input/keydown on the field,
  // or a Goldfinch-originated fill, DD3h). Deliberately NOT a sticky boolean: a
  // snapshot admits the field only while its LIVE value still equals this
  // recorded string — the equality check in fieldState() below is what makes
  // this value-bound rather than sticky. DD3i: also bounded in TIME — expiresAt
  // is checked at read time AND an armed timer actively evicts the entry (never
  // merely lazy), so a granted-then-forgotten field does not hold plaintext for
  // the rest of the page's life.
  const provenance = new Map();

  function detect() {
    return { logins: loginEntries(doc), cards: cardEntries(doc), identities: identityEntries(doc) };
  }

  function isDetectedField(field, entries) {
    for (const entry of entries.logins) {
      if (entry.username === field || entry.password === field) return true;
    }
    for (const entry of entries.cards) {
      for (const role of CARD_ROLES) {
        if (entry[role] === field) return true;
      }
    }
    for (const entry of entries.identities) {
      for (const role of IDENTITY_ROLES) {
        if (entry[role] === field) return true;
      }
    }
    return false;
  }

  /** Clear `field`'s armed expiry timer, if any — never leaves a dangling handle behind. */
  function clearExpiryTimer(field) {
    const rec = provenance.get(field);
    if (rec && rec.timer != null && _clearTimeout) _clearTimeout(rec.timer);
  }

  /**
   * Evict `field`'s provenance on expiry (DD3i) — the active half of the bound,
   * alongside the passive read-time check in `fieldState`. A stale/superseded
   * timer firing after the entry was already re-granted or evicted some other
   * way is a safe no-op (re-checked by identity before deleting).
   */
  function expireField(field) {
    const rec = provenance.get(field);
    if (!rec) return;
    provenance.delete(field);
    emit();
  }

  /**
   * Grant provenance for `field` at `value`, with a bounded lifetime (DD3i) —
   * re-arms (never stacks) the expiry timer on a re-grant of an already-granted
   * field. Shared by `grant` (reads the field's own current value) and
   * `grantForFill` (the value a Goldfinch fill just WROTE, per DD3d's
   * never-read-back corollary).
   */
  function grantValue(field, value) {
    clearExpiryTimer(field);
    // A missing timer function (fails closed, per the header note above) still
    // grants — with no ACTIVE eviction, only the passive read-time check in
    // `fieldState` bounds it. Never throws install() itself over this.
    const timer = _setTimeout ? _setTimeout(() => expireField(field), PROVENANCE_TTL_MS) : null;
    // Never keep the isolated world's event loop alive for this alone (mirrors
    // the vault-human.js CAPTURE_DROP_MS timer idiom) — Node's Timeout exposes
    // `unref`; a real browser/isolated-world timer handle does not, so this is
    // a no-op there, exactly as intended.
    if (timer && typeof timer.unref === 'function') timer.unref();
    provenance.set(field, { value, expiresAt: _now() + PROVENANCE_TTL_MS, timer });
  }

  /** Grant provenance for `field` at the value it holds RIGHT NOW. */
  function grant(field) {
    grantValue(field, field.value);
  }

  /**
   * Three-state per-field read (DD3h). Detected AND provenanced-and-matching-
   * and-unexpired → `{ detected: true, value }`. Detected but unprovenanced, the
   * live value no longer equals the grant, OR the grant has expired (DD3i) →
   * `{ detected: true, value: null }` — the SAME wire shape for every cause
   * (DD3c reads them identically: this field may never be relied on to identify
   * an existing record). The caller (snapshotEntry) omits the key entirely for
   * a field that was never detected at all — that third state is a key ABSENT,
   * not produced here.
   */
  function fieldState(field) {
    const rec = provenance.get(field);
    const matches = !!rec && field.value === rec.value && _now() < rec.expiresAt;
    return { detected: true, value: matches ? rec.value : null };
  }

  function snapshotEntry(entry, roles) {
    const out = {};
    for (const role of roles) {
      const field = entry[role];
      if (field) out[role] = fieldState(field);
    }
    return out;
  }

  /**
   * The full plain-data snapshot: every currently-detected entry, three-state
   * per field. Never a node handle — every value here is a boolean or a string.
   * Identity entries additionally carry `anchorRole` (LD3, M21 F3 Leg 4) — a
   * plain role-name string the main-world detector already stamped on the
   * entry (`entry.anchorRole`), read here rather than re-derived, so the
   * value-layer gate can read anchor role AND values from ONE enumeration.
   */
  function snapshot() {
    const entries = detect();
    return {
      logins: entries.logins.map((entry) => snapshotEntry(entry, LOGIN_ROLES)),
      cards: entries.cards.map((entry) => snapshotEntry(entry, CARD_ROLES)),
      identities: entries.identities.map((entry) => ({
        ...snapshotEntry(entry, IDENTITY_ROLES),
        anchorRole: typeof entry.anchorRole === 'string' ? entry.anchorRole : null
      }))
    };
  }

  function emit() {
    if (typeof report === 'function') report(snapshot());
  }

  /**
   * Grant provenance for exactly the fields a Goldfinch fill just wrote (DD3h) —
   * fill and grant happen in ONE realm, so there is no cross-world correlation
   * problem to solve. `fillResult` is the `{ filled, fields: [{ field, value }] }`
   * shape fillLoginForm / fillCardForm return; `field` there is already a node
   * reference FROM THIS SAME WORLD (the fill ran here) — never a crossed
   * identity, and never returned back out of this module.
   */
  function grantForFill(fillResult) {
    if (!fillResult || !Array.isArray(fillResult.fields)) return;
    for (const { field, value } of fillResult.fields) {
      if (!field) continue;
      grantValue(field, value);
    }
    emit();
  }

  /**
   * Short-circuit BEFORE the (comparatively expensive) detection walk: an
   * untrusted / script-dispatched event is refused on `isTrusted` alone, with no
   * further work performed — DD1/DD3's forgery-resistance argument depends on
   * this running first, not merely on this eventually returning early.
   */
  function handleFieldEvent(e) {
    if (!e || e.isTrusted !== true) return;
    const field = e.target;
    if (!field) return;
    const entries = detect();
    if (!isDetectedField(field, entries)) return;
    grant(field);
    emit();
  }

  // Detachment eviction (Leg 2 review round 1 finding): a removed node keeps its
  // stale `.value` forever, so the provenance entry must be cleared explicitly —
  // a lazy value/liveness check never fires. Recursive subtree search because a
  // framework unmount removes a WRAPPER element, not each input (Leg 2 review
  // round 2) — evicting only `node` itself would leave every descendant input's
  // entry stranded.
  function evictSubtree(node) {
    if (!node) return;
    clearExpiryTimer(node);
    provenance.delete(node);
    if (typeof node.querySelectorAll === 'function') {
      for (const child of Array.from(node.querySelectorAll('*'))) {
        clearExpiryTimer(child);
        provenance.delete(child);
      }
    }
  }

  /**
   * DD3i: clear every armed expiry timer and drop the whole map on unload — a
   * belt-and-suspenders defense alongside the fact that a real navigation tears
   * down this isolated world's whole JS realm anyway (the world does not
   * survive a full navigation regardless). Cheap, and closes the "world persists
   * across an in-page transition that still fires unload" edge case explicitly
   * rather than relying on realm teardown alone.
   */
  function clearAllProvenance() {
    for (const rec of provenance.values()) {
      if (rec.timer != null && _clearTimeout) _clearTimeout(rec.timer);
    }
    provenance.clear();
  }

  /**
   * Wire the document-level capturing listeners and the detachment observer.
   * Capturing phase mirrors the pre-existing submit-listener discipline
   * elsewhere in this preload: a page's bubble-phase stopPropagation() must not
   * be able to hide typing from this observer.
   */

  // Held at the OUTER closure scope (not a bare `install()`-local `const`) so a
  // GC pass can never collect it out from under an active `observe()` — belt
  // and suspenders atop the WHATWG spec's own guarantee that an observed
  // node's registered-observer list keeps its MutationObserver alive.
  let mutationObserver = null;

  /**
   * Attempt to construct and arm the detachment MutationObserver. Returns
   * whether it succeeded. `typeof MutationObserver` (never a bare reference)
   * so this stays require()-able under plain Node, which has no such global —
   * tests stub it via `global.MutationObserver` before calling install(), the
   * same pattern this codebase already documents for capturing native browser
   * globals.
   */
  function armMutationObserver() {
    const MO = typeof MutationObserver !== 'undefined' ? MutationObserver : undefined;
    if (typeof MO !== 'function' || !doc.documentElement) return false;
    mutationObserver = new MO((mutations) => {
      let changed = false;
      for (const m of mutations) {
        if (m.type !== 'childList') continue;
        for (const n of Array.from(m.removedNodes)) {
          evictSubtree(n);
          changed = true;
        }
      }
      if (changed) emit();
    });
    mutationObserver.observe(doc.documentElement, { childList: true, subtree: true });
    return true;
  }

  /**
   * DD3i belt-and-suspenders: `window` (never a bare top-level reference — this
   * module stays `require()`-able under plain Node, which has no such global;
   * tests that care stub it, mirroring `armMutationObserver`'s own discipline).
   * Best-effort only — a real navigation tears this whole isolated-world realm
   * down regardless, so a missing `window`/`addEventListener` here is never a
   * forged-provenance path, only a redundant safeguard that didn't arm.
   */
  function armUnloadClear() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    window.addEventListener('pagehide', clearAllProvenance);
  }

  function install() {
    doc.addEventListener('keydown', handleFieldEvent, true);
    doc.addEventListener('input', handleFieldEvent, true);
    armUnloadClear();

    if (armMutationObserver()) return;
    // Live-verified (Leg 3 probe): a freshly-created isolated world's VERY
    // FIRST script execution can run before the platform's Web IDL globals are
    // fully attached there — MutationObserver specifically was observed
    // `undefined` at this exact instant while a SECOND, separately-scheduled
    // isolated-world call (occurring naturally later on) saw it defined and
    // working. Retry is bounded, never infinite — a genuinely, permanently
    // unavailable MutationObserver fails closed (detachment eviction simply
    // never runs for that document; provenance is never forged, only a memory
    // bound goes unmaintained — the DD4 wrong-moment budget, not a
    // wrong-value one).
    // Same `_setTimeout` guard as `grantValue` above — a bare `setTimeout`
    // reference here would throw in a realm with no such global, taking the
    // whole retry (and, uncaught, the whole install()) down with it. Fails
    // closed instead: no timer function means no retry gets armed, and
    // `install()` still returns normally — detachment eviction simply never
    // recovers for this document (the same bound-goes-unmaintained outcome
    // as a permanently-missing MutationObserver, never a forged-provenance
    // one).
    if (!_setTimeout) return;
    let attempts = 0;
    const MAX_ATTEMPTS = 20; // bounded retry window — comfortably covers the observed lag
    const RETRY_DELAY_MS = 100;
    const retry = () => {
      attempts++;
      if (armMutationObserver() || attempts >= MAX_ATTEMPTS) return;
      _setTimeout(retry, RETRY_DELAY_MS);
    };
    _setTimeout(retry, RETRY_DELAY_MS);
  }

  return {
    install,
    snapshot,
    grantForFill,
    // Test-only introspection. Never crosses the isolated-world boundary and
    // never called from vault-entry-observer-bootstrap.js's exposed handle.
    _provenanceSize: () => provenance.size,
    _grant: grant,
    _handleFieldEvent: handleFieldEvent,
    _mutationObserverArmed: () => mutationObserver !== null,
    // DD3i test-only introspection: whether `field` currently carries a LIVE
    // (unexpired) provenance timer — lets a unit test drive the injected clock
    // past PROVENANCE_TTL_MS and assert the entry is actually gone, not merely
    // that the map still has a stale record nobody will ever read as valid.
    _hasLiveProvenance: (field) => provenance.has(field),
    _expireField: expireField
  };
}

module.exports = { createEntryObserver, LOGIN_ROLES, CARD_ROLES, PROVENANCE_TTL_MS };
