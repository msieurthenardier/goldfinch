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
  const form = password.form
    || (typeof password.closest === 'function' ? password.closest('form') : null);

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
  const pwList = doc && typeof doc.querySelectorAll === 'function'
    ? doc.querySelectorAll('input[type=password]')
    : null;
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
  const pwList = doc && typeof doc.querySelectorAll === 'function'
    ? doc.querySelectorAll('input[type=password]')
    : null;
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
 * `targetPassword` (PR#112 finding 9): when the fill was initiated by a lock-icon
 * gesture, the guest binds the CLICKED field to the round-trip and passes it here.
 * If it is still a live password field in `doc`, that specific form's fields are
 * filled — NOT the document's first password field (the pre-fix behavior that
 * mis-filled the wrong form on a multi-login page). A null / stale / foreign target
 * falls back to the first-password-field heuristic, which is exactly the MCP
 * automation path's behavior (origin-matched top-frame login, no gesture).
 * @param {any} doc
 * @param {{ username?: string|null, password?: string|null } | null | undefined} cred
 * @param {any} [targetPassword]  the gesture-bound password field, validated live here.
 * @returns {{ filled: boolean }}
 */
function fillLoginForm(doc, cred, targetPassword) {
  // `typeof window` is 'undefined' under the headless unit test (which drives
  // this pure helper directly); in the guest main world it is the page window.
  if (typeof window !== 'undefined' && window.top !== window) return { filled: false };
  const fields = isLivePasswordField(doc, targetPassword)
    ? resolveLoginEntry(targetPassword) // the clicked form's { username, password, form }
    : findLoginFields(doc);             // first-password-field fallback (MCP / no-gesture)
  if (!fields || !fields.password) return { filled: false };
  if (fields.username && cred && cred.username != null) {
    setFieldValue(fields.username, String(cred.username));
  }
  if (cred && cred.password != null) {
    setFieldValue(fields.password, String(cred.password));
  }
  return { filled: true };
}

module.exports = { findLoginFields, findAllLoginFields, fillLoginForm, isLivePasswordField };
