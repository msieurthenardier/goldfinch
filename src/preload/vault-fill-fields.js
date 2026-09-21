// @ts-check
'use strict';

// Pure login-form field-selection + fill helpers for the guest main-world
// preload (Mission 12, Flight 1, Leg 4). Factored OUT of webview-preload.js so
// they unit-test headlessly against a hand-rolled fake `document`: the preload
// itself cannot be required under `node --test` — its top-level `window` /
// MutationObserver / ipcRenderer side-effects throw in plain Node — so the
// testable core lives here (the same electron-free-core discipline vault-context
// / vault-store follow), and the preload requires it.
//
// DOM SURFACE (pinned by the leg so the fake document models it exactly):
//   - the target password field is the FIRST `input[type=password]` in the doc;
//   - its form is `pw.form` (fallback `pw.closest('form')`);
//   - the username field is the LAST text/email/tel/no-type input PRECEDING the
//     password field within that form (document order);
//   - filling sets `.value` and dispatches bubbling `input` + `change` events;
//   - no password field → nothing is filled.

// A real <input> with no `type` reports `.type === 'text'`, so the no-type case
// collapses into 'text' here (the fake document models the same).
const USERNAME_TYPES = new Set(['', 'text', 'email', 'tel']);

/**
 * Resolve one login entry for a given password field: its form (`pw.form`,
 * fallback `pw.closest('form')`) and the LAST text/email/tel/no-type input that
 * PRECEDES the password within that form (document order; null for a
 * password-only / form-less field). Shared by `findLoginFields` (first field)
 * and `findAllLoginFields` (per field) so the username heuristic is single-sourced.
 * @param {any} password
 * @returns {{ username: any, password: any, form: any }}
 */
function resolveLoginEntry(password) {
  const form = password.form || (typeof password.closest === 'function' ? password.closest('form') : null);

  let username = null;
  if (form && typeof form.querySelectorAll === 'function') {
    const inputs = Array.from(form.querySelectorAll('input'));
    const pwIndex = inputs.indexOf(password);
    const preceding = pwIndex >= 0 ? inputs.slice(0, pwIndex) : inputs;
    for (const input of preceding) {
      const type = String(input.type == null ? '' : input.type).toLowerCase();
      // Last qualifying field before the password wins (closest-preceding).
      if (USERNAME_TYPES.has(type)) username = input;
    }
  }
  return { username, password, form };
}

/**
 * Locate the login fields on a document-like object. Returns null when there is
 * no password field (nothing to fill); otherwise `{ username, password }` where
 * `username` may be null (a password-only form). CONTRACT UNCHANGED (fill path):
 * still the FIRST `input[type=password]`, shape `{ username, password }`.
 * @param {any} doc  a `document`-like object exposing querySelectorAll.
 * @returns {{ username: any, password: any } | null}
 */
function findLoginFields(doc) {
  const pwList =
    doc && typeof doc.querySelectorAll === 'function' ? doc.querySelectorAll('input[type=password]') : null;
  const password = pwList && pwList.length ? pwList[0] : null;
  if (!password) return null;

  const { username } = resolveLoginEntry(password);
  return { username, password };
}

/**
 * Enumerate EVERY `input[type=password]` in the document (document order),
 * returning one `{ username, password, form }` entry per field — the per-form
 * lock-icon path needs all password fields, not just the first (M12 F2 Leg 1,
 * DD2). `username` may be null (password-only / form-less); `form` may be null
 * (a password field outside any `<form>`). Returns `[]` when there is no
 * password field. Pure: reads only the passed `doc` (no `window`/DOM globals),
 * so it stays `node --test`-importable alongside `findLoginFields`.
 * @param {any} doc  a `document`-like object exposing querySelectorAll.
 * @returns {Array<{ username: any, password: any, form: any }>}
 */
function findAllLoginFields(doc) {
  const pwList =
    doc && typeof doc.querySelectorAll === 'function' ? doc.querySelectorAll('input[type=password]') : null;
  if (!pwList || !pwList.length) return [];
  return Array.from(pwList).map((pw) => resolveLoginEntry(pw));
}

/**
 * Set a field's value and dispatch the bubbling input + change events a live
 * page's framework listeners expect.
 * @param {any} field
 * @param {string} value
 */
function setFieldValue(field, value) {
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Is `field` one of the password inputs CURRENTLY present in `doc`? A gesture
 * target is validated against the live document immediately before filling
 * (PR#112 finding 9) so a stale / detached / spoofed node can never be filled —
 * only a real, still-present password field the icon was anchored to.
 * @param {any} doc
 * @param {any} field
 * @returns {boolean}
 */
function isLivePasswordField(doc, field) {
  if (!field || !doc || typeof doc.querySelectorAll !== 'function') return false;
  const pwList = doc.querySelectorAll('input[type=password]');
  if (!pwList || !pwList.length) return false;
  return Array.from(pwList).includes(field);
}

/**
 * Fill the TOP-FRAME login form on `doc` with `cred` ({ username, password }).
 * Top-frame only: never fills inside an iframe (defense in depth atop the
 * main-frame-only `webContents.send`). No password field → no-op. Returns a
 * small status object — NEVER the credential.
 *
 * `ordinal` (M21 F3 Leg 3, DD9 — PR#112 finding 9's precision, restored via an
 * INTEGER rather than a node): when the fill was initiated by a lock-icon
 * gesture, the caller resolves the clicked field's ordinal position among
 * `findAllLoginFields(doc)` (via `resolveOrdinalInFamily`) and passes that
 * INTEGER here — never a node reference (an integer crosses the isolated-world
 * boundary freely; DD3g forbids only node identity). A valid in-range ordinal
 * fills THAT specific entry — NOT the document's first password field (the
 * pre-fix behavior that mis-filled the wrong form on a multi-login page). A
 * `null` / non-integer / out-of-range ordinal falls back to the
 * first-password-field heuristic, which is exactly the MCP automation path's
 * behavior (origin-matched top-frame login, no gesture). **No overloading**:
 * this parameter is an integer or `null`, never a node — the isolated-world
 * fill is the only production caller, and it has no node to pass regardless.
 * @param {any} doc
 * @param {{ username?: string|null, password?: string|null } | null | undefined} cred
 * @param {number | null} [ordinal]  an index into `findAllLoginFields(doc)`.
 * @returns {{ filled: boolean, fields: Array<{ field: any, value: string }> }}
 *   `fields` carries the exact string WRITTEN to each field that was actually
 *   filled, keyed by the field's own node reference (M21 F1 Leg 3, DD3h) — this is
 *   what lets a caller in the SAME realm (the isolated-world observer) grant
 *   provenance for exactly what a Goldfinch fill wrote, with no read-back and no
 *   cross-world correlation. Empty when nothing was filled.
 */
function fillLoginForm(doc, cred, ordinal) {
  // `typeof window` is 'undefined' under the headless unit test (which drives
  // this pure helper directly); in the guest main world it is the page window.
  if (typeof window !== 'undefined' && window.top !== window) return { filled: false, fields: [] };
  const all = findAllLoginFields(doc);
  const fields =
    typeof ordinal === 'number' && Number.isInteger(ordinal) && ordinal >= 0 && ordinal < all.length
      ? all[ordinal] // the gesture-bound entry, by ordinal
      : findLoginFields(doc); // first-password-field fallback (MCP / no-gesture / stale ordinal)
  if (!fields || !fields.password) return { filled: false, fields: [] };
  const written = [];
  if (fields.username && cred && cred.username != null) {
    const value = String(cred.username);
    setFieldValue(fields.username, value);
    written.push({ field: fields.username, value });
  }
  if (cred && cred.password != null) {
    const value = String(cred.password);
    setFieldValue(fields.password, value);
    written.push({ field: fields.password, value });
  }
  return { filled: true, fields: written };
}

module.exports = { findLoginFields, findAllLoginFields, fillLoginForm, isLivePasswordField };
