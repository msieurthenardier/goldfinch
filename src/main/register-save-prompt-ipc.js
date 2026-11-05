'use strict';
// @ts-check

// Electron-free registrar for the corner save-prompt channels (Sortie 06 Leg 1; flight
// DD1/DD5/DD6/DD8/DD9). Two families:
//
//   chrome -> main   `save-prompt:open` (invoke) / `save-prompt:anchor` (send). Sender = a
//                    registered CHROME (`registry.getWindowForChrome`).
//   page   -> main   `:pointer` / `:focus` / `:height` / `:dismiss` (send) and `:save`
//                    (invoke). Sender = THIS window's prompt view, resolved by webContents
//                    IDENTITY through `registry.recordForOverlaySender(sender, 'savePrompt')`.
//
// The state-CHANGING page channel (`:save`) carries FOUR guards in order (CLAUDE.md sheet
// rule): (1) sender identity, (2) token freshness, (3) kind - the prompt is in its OFFER state,
// not a result/saving state, and the model is not `locked`, (4) a business gate - the captureId
// is the SHOWN capture, the capture's tab is still this window's ACTIVE tab, and main's own
// `captureTabOf` agrees. Only then `vaultHuman.captureSave` runs (inside the manager).
//
// The model that crosses `:open` is METADATA ONLY: shape-checked against an explicit allowlist,
// unknown keys stripped, and any key that is a SECRET field name (vault-item-schema.js) REFUSES
// the open.

const { SCHEMA } = require('../shared/vault-item-schema');

// Every secret field name across all item types (single-sourced; never re-typed here).
const SECRET_KEYS = new Set(Object.values(SCHEMA).flatMap((t) => t.secret));
const RESULT_KINDS = new Set(['unchanged', 'expired', 'tab-changed', 'locked', 'error', 'saved']);
const OFFER_KINDS = new Set(['login', 'card', 'identity']);
const MAX_STR = 512;

/** @param {any} v @returns {string | null} */
function str(v) {
  return typeof v === 'string' ? v.slice(0, MAX_STR) : null;
}

/** @param {any} v @returns {string[]} */
function strList(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => x.slice(0, MAX_STR)) : [];
}

/**
 * Shape-check a prompt model against the explicit allowlist.
 * @param {any} model
 * @returns {{ ok: true, model: any, resultOnly: boolean } | { ok: false, reason: string }}
 */
function sanitizeSavePromptModel(model) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return { ok: false, reason: 'invalid-model' };
  for (const key of Object.keys(model)) {
    if (SECRET_KEYS.has(key)) return { ok: false, reason: 'invalid-model' };
  }
  // Result-only model: { result } and nothing else is kept (except `saved`'s display fields).
  if (typeof model.result === 'string') {
    if (!RESULT_KINDS.has(model.result)) return { ok: false, reason: 'invalid-model' };
    if (model.result === 'saved') {
      // Leg 2 (AC8): the one result that carries display data - { vaultLabel, kind }, both
      // sanitized (a bounded string / the OFFER_KINDS enum). Display-only.
      /** @type {any} */
      const saved = { result: 'saved' };
      const vaultLabel = str(model.vaultLabel);
      if (vaultLabel != null) saved.vaultLabel = vaultLabel;
      if (typeof model.kind === 'string' && OFFER_KINDS.has(model.kind)) saved.kind = model.kind;
      return { ok: true, model: saved, resultOnly: true };
    }
    return { ok: true, model: { result: model.result }, resultOnly: true };
  }
  const mode = model.mode;
  // `locked` (Leg 2): admitted with the same allowlist (incl. `choices` / `defaultVaultId`).
  if (mode !== 'save' && mode !== 'update' && mode !== 'locked') return { ok: false, reason: 'invalid-model' };
  /** @type {any} */
  const out = { mode };
  const origin = str(model.origin);
  out.origin = origin == null ? '' : origin;
  if (model.username === null || typeof model.username === 'string')
    out.username = model.username && str(model.username);
  if (typeof model.kind === 'string' && OFFER_KINDS.has(model.kind)) out.kind = model.kind;
  const def = str(model.defaultVaultId);
  if (def != null) out.defaultVaultId = def;
  const vaultLabel = str(model.vaultLabel);
  if (vaultLabel != null) out.vaultLabel = vaultLabel;
  const brand = str(model.brand);
  if (brand != null) out.brand = brand;
  const last4 = str(model.last4);
  if (last4 != null) out.last4 = last4;
  if (Array.isArray(model.addedFields)) out.addedFields = strList(model.addedFields);
  if (Array.isArray(model.changedFields)) out.changedFields = strList(model.changedFields);
  if (Array.isArray(model.choices)) {
    out.choices = model.choices
      .map((/** @type {any} */ c) => {
        if (typeof c === 'string') return c.slice(0, MAX_STR);
        if (!c || typeof c !== 'object' || typeof c.vaultId !== 'string') return null;
        /** @type {any} */
        const choice = { vaultId: c.vaultId.slice(0, MAX_STR) };
        const label = str(c.label);
        if (label != null) choice.label = label;
        if (c.disabled === true) choice.disabled = true;
        return choice;
      })
      .filter((/** @type {any} */ c) => c != null);
  }
  return { ok: true, model: out, resultOnly: false };
}

/** @param {any} q @returns {{ index: number, total: number } | null} */
function sanitizeQueue(q) {
  if (!q || typeof q !== 'object') return null;
  const { index, total } = q;
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 1 || index > total) return null;
  return { index, total };
}

/**
 * @param {{
 *   ipcMain: any,
 *   registry: any,
 *   getVaultHuman?: () => any,
 *   vaultTrace?: (step: string, fields: any) => void
 * }} deps
 */
function registerSavePromptIpc({
  ipcMain,
  registry,
  getVaultHuman = () => null,
  // Opt-in trace (GOLDFINCH_VAULT_TRACE=1): opaque ids and reason strings ONLY - never an
  // origin, username or vault label. Injected so a test can capture the calls.
  vaultTrace = process.env.GOLDFINCH_VAULT_TRACE === '1'
    ? (/** @type {string} */ step, /** @type {any} */ fields) =>
        console.info('[vault-capture]', step, JSON.stringify(fields))
    : () => {}
}) {
  /** @param {any} sender */
  const recordForPromptSender = (sender) => registry.recordForOverlaySender(sender, 'savePrompt');

  // ---- chrome -> main ----------------------------------------------------------------------

  /** @param {any} event @param {any} payload @returns {{ presented: boolean, reason?: string }} */
  function openPrompt(event, payload) {
    // Gate 1: sender is a registered chrome, with a live prompt manager.
    const rec = registry.getWindowForChrome(event.sender);
    if (!rec) return { presented: false, reason: 'gone' };
    if (!rec.savePrompt) return { presented: false, reason: 'gone' };
    const { token, captureId, wcId, model, anchor, queue } = payload || {};
    if (typeof token !== 'number' || typeof captureId !== 'string' || !Number.isInteger(wcId)) {
      return { presented: false, reason: 'not-active' };
    }
    // Gate 2: the tab is THIS window's active tab.
    if (rec.activeTabWcId !== wcId) return { presented: false, reason: 'not-active' };
    // Gate 4 first (pure shape check) so gate 3 knows whether the model is result-only.
    const checked = sanitizeSavePromptModel(model);
    if (checked.ok === false) return { presented: false, reason: checked.reason };
    // Gate 3: OFFER models only - the capture must belong to the claimed tab. A result-only
    // model is shown after the record is already gone (finalize dropped it): it carries no
    // secret and grants no write, so it needs only gate 2.
    if (!checked.resultOnly) {
      const vh = getVaultHuman();
      if (!vh || vh.captureTabOf(captureId) !== wcId) return { presented: false, reason: 'not-active' };
    }
    return rec.savePrompt.present({
      token,
      captureId,
      wcId,
      model: checked.model,
      anchor: typeof anchor === 'number' ? anchor : null,
      queue: sanitizeQueue(queue)
    });
  }

  ipcMain.handle('save-prompt:open', (event, payload) => {
    const res = openPrompt(event, payload);
    const id = payload && typeof payload.captureId === 'string' ? payload.captureId : null;
    vaultTrace('save-prompt-open', {
      captureId: id,
      presented: res.presented === true,
      reason: res.presented ? null : res.reason || null
    });
    return res;
  });

  ipcMain.on('save-prompt:anchor', (event, payload) => {
    const rec = registry.getWindowForChrome(event.sender);
    if (!rec || !rec.savePrompt) return;
    const { token, right } = payload || {};
    if (typeof token !== 'number' || !rec.savePrompt.isCurrentToken(token)) return;
    rec.savePrompt.setAnchor(typeof right === 'number' ? right : null);
  });

  // ---- page -> main ------------------------------------------------------------------------

  /**
   * Shared prelude for the one-way page channels: gate 1 (identity) + gate 2 (token).
   * @param {any} event @param {any} payload
   */
  function resolvePage(event, payload) {
    const rec = recordForPromptSender(event.sender);
    if (!rec || !rec.savePrompt) return null;
    const token = payload && payload.token;
    if (typeof token !== 'number' || !rec.savePrompt.isCurrentToken(token)) return null;
    return rec;
  }

  ipcMain.on('save-prompt:pointer', (event, payload) => {
    const rec = resolvePage(event, payload);
    if (rec) rec.savePrompt.setPointerInside(payload.inside === true);
  });

  ipcMain.on('save-prompt:focus', (event, payload) => {
    const rec = resolvePage(event, payload);
    if (rec) rec.savePrompt.setFocusInside(payload.inside === true);
  });

  ipcMain.on('save-prompt:height', (event, payload) => {
    const rec = resolvePage(event, payload);
    if (!rec || typeof payload.height !== 'number') return;
    rec.savePrompt.reportHeight(payload.token, payload.height);
  });

  ipcMain.on('save-prompt:dismiss', (event, payload) => {
    const rec = resolvePage(event, payload);
    if (rec) rec.savePrompt.dismiss();
  });

  ipcMain.handle('save-prompt:save', (event, payload) => {
    // 1. sender identity
    const rec = recordForPromptSender(event.sender);
    if (!rec || !rec.savePrompt) return { saved: false, reason: 'refused' };
    const { token, captureId, vaultId } = payload || {};
    // 2. token freshness
    if (typeof token !== 'number' || !rec.savePrompt.isCurrentToken(token)) return { saved: false, reason: 'refused' };
    // 3. kind: OFFER state (not a result / saving state), model not `locked`
    if (!rec.savePrompt.canSave()) return { saved: false, reason: 'refused' };
    // 4. business gate: the SHOWN capture, whose tab is still this window's ACTIVE tab, and
    //    main's own capture<->tab binding agrees.
    if (typeof captureId !== 'string' || captureId !== rec.savePrompt.currentCaptureId()) {
      return { saved: false, reason: 'refused' };
    }
    const shownWcId = rec.savePrompt.currentWcId();
    if (shownWcId == null || rec.activeTabWcId !== shownWcId) return { saved: false, reason: 'refused' };
    const vh = getVaultHuman();
    if (!vh || vh.captureTabOf(captureId) !== shownWcId) return { saved: false, reason: 'refused' };
    return rec.savePrompt.save(typeof vaultId === 'string' ? vaultId : undefined);
  });

  // Locked offer consent (Leg 2; flight DD7). FOUR guards in order, mirroring `:save`:
  // sender identity, token freshness, kind (offer state + `locked` model + the dedicated
  // `consenting` in-flight flag), business gate (shown capture, active tab, main's own
  // capture<->tab binding, then `captureConsent` itself). On success the prompt closes
  // `unlock-requested` - the CHROME then raises the unlock sheet; this handler writes nothing.
  ipcMain.handle('save-prompt:consent', (event, payload) => {
    /** @param {string} outcome @param {any} res */
    const done = (outcome, res) => {
      const id = payload && typeof payload.captureId === 'string' ? payload.captureId : null;
      vaultTrace('save-prompt-consent', { captureId: id, outcome });
      return res;
    };
    // 1. sender identity
    const rec = recordForPromptSender(event.sender);
    if (!rec || !rec.savePrompt) return done('refused-sender', { ok: false, reason: 'refused' });
    const { token, captureId, vaultId } = payload || {};
    // 2. token freshness
    if (typeof token !== 'number' || !rec.savePrompt.isCurrentToken(token)) {
      return done('refused-token', { ok: false, reason: 'refused' });
    }
    // 3. kind (sets the consenting flag synchronously; every refusal below rolls it back)
    if (!rec.savePrompt.beginConsent()) return done('refused-kind', { ok: false, reason: 'refused' });
    // 4. business gate
    const refuse = () => {
      rec.savePrompt.endConsent();
      return done('refused-gate', { ok: false, reason: 'refused' });
    };
    if (typeof captureId !== 'string' || captureId !== rec.savePrompt.currentCaptureId()) return refuse();
    const shownWcId = rec.savePrompt.currentWcId();
    if (shownWcId == null || rec.activeTabWcId !== shownWcId) return refuse();
    const vh = getVaultHuman();
    if (!vh || vh.captureTabOf(captureId) !== shownWcId) return refuse();
    /** @type {any} */
    let res;
    try {
      res = vh.captureConsent({ captureId, vaultId: typeof vaultId === 'string' ? vaultId : null });
    } catch {
      return refuse();
    }
    if (res && res.ok === true) {
      rec.savePrompt.consentGranted();
      return done('granted', { ok: true });
    }
    const reason = res && typeof res.reason === 'string' ? res.reason : 'refused';
    if (reason === 'unlocked') {
      // The vault unlocked first: the prompt stays; the chrome converts it (AC9).
      rec.savePrompt.endConsent();
      return done('unlocked', { ok: false, reason: 'unlocked' });
    }
    if (reason === 'expired') {
      rec.savePrompt.showResult('failure', 'This save request expired', 4000, 'expired');
      return done('expired', { ok: false, reason: 'expired' });
    }
    // bad vault (or any other refusal): say so, then dismiss (drops the record).
    rec.savePrompt.showResult('failure', "Couldn't save to that vault", 4000, 'dismissed');
    return done('bad-vault', { ok: false, reason: 'bad-vault' });
  });
}

module.exports = { registerSavePromptIpc, sanitizeSavePromptModel, sanitizeQueue };
