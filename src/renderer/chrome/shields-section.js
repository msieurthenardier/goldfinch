// The privacy panel's Shields section (sortie 02 leg 2 / DD4). Extracted from
// privacy-controller.js so it can be a PERSISTENT node: renderPrivacy() rebuilds every other
// section on each network push, but this node is created once, kept as #privacy-body's first
// child, and PATCHED IN PLACE by key — so the focus/caret on a switch or Restart now survives
// a push. Notes/restart copy are plain text (never a live region). Pure render logic lives in
// ../../shared/shields-isolation-model.js; this file only owns DOM wiring.
import {
  effectiveAfterRestart,
  isolationModel,
  restartControl,
  createRestartConfirm,
  COPY
} from '../../shared/shields-isolation-model.js';

export const SHIELD_ROWS = [
  ['block', 'Block trackers'],
  ['strip', 'Strip tracking params'],
  ['isolate', 'Isolate 3rd-party cookies'],
  ['farble', 'Farble fingerprint']
];

/**
 * @param {{
 *   document: any,
 *   onSetShield: (key: string, value: boolean) => any,
 *   onTogglePause: () => any,
 *   onReload: () => any,
 *   onRestart: () => Promise<any>,
 *   onRestartFailed: (reason: string) => void,
 *   setTimer?: any,
 *   clearTimer?: any
 * }} deps
 */
export function createShieldsSection(deps) {
  const { document, onSetShield, onTogglePause, onReload, onRestart, onRestartFailed } = deps;

  /** Latest patched inputs; click handlers read this LIVE (never a closed-over value). */
  let live = /** @type {any} */ ({ cfg: {} });

  /**
   * @param {string} label
   * @param {string} key
   */
  function makeSwitch(label, key) {
    const el = document.createElement('button');
    el.className = 'switch';
    el.setAttribute('role', 'switch');
    el.setAttribute('aria-checked', 'false');
    el.setAttribute('aria-label', label);
    el.addEventListener('click', () => onSetShield(key, !(live.cfg && live.cfg[key])));
    return {
      el,
      /** @param {boolean} on */
      set(on) {
        el.classList.toggle('on', on);
        el.setAttribute('aria-checked', String(on));
      }
    };
  }

  /** @param {string} tag @param {string} cls */
  function make(tag, cls) {
    const e = document.createElement(tag);
    e.className = cls;
    return e;
  }

  /** @param {any} el @param {boolean} hide */
  function setHidden(el, hide) {
    el.classList.toggle('hidden', hide);
  }

  const node = make('div', 'privacy-section shields');

  const head = make('div', 'shields-head');
  head.dataset.shield = 'enabled';
  const title = make('div', 'ps-title');
  title.textContent = 'Shields';
  head.appendChild(title);
  const masterSwitch = makeSwitch('Shields', 'enabled');
  head.appendChild(masterSwitch.el);
  node.appendChild(head);

  const masterNote = make('div', 'shield-note hidden');
  masterNote.dataset.shieldNote = 'enabled';
  node.appendChild(masterNote);

  /** @type {Record<string, { row: any, count: any, sw: any }>} */
  const rows = {};
  /** @type {Record<string, any>} */
  const notes = {};
  for (const [key, label] of SHIELD_ROWS) {
    const row = make('div', 'shield-row');
    row.dataset.shield = key;
    const lbl = make('span', 'shield-lbl');
    lbl.textContent = label;
    row.appendChild(lbl);
    const count = make('span', 'shield-count hidden');
    row.appendChild(count);
    const sw = makeSwitch(label, key);
    row.appendChild(sw.el);
    node.appendChild(row);
    rows[key] = { row, count, sw };
    if (key === 'isolate') {
      const note = make('div', 'shield-note hidden');
      note.dataset.shieldNote = 'isolate';
      node.appendChild(note);
      notes[key] = note;
    }
  }

  // The ONE Restart now control (the master note points at it, not one per row).
  const restartWrap = make('div', 'shield-restart hidden');
  restartWrap.dataset.shield = 'restart';
  const restartBtn = make('button', 'text-btn small');
  restartBtn.id = 'shields-restart';
  restartBtn.setAttribute('type', 'button');
  restartBtn.textContent = COPY.restartIdle;
  const restartNote = make('div', 'shield-note hidden');
  restartNote.id = 'shields-restart-note';
  restartWrap.appendChild(restartBtn);
  restartWrap.appendChild(restartNote);
  node.appendChild(restartWrap);

  const pauseRow = make('div', 'shield-row pause hidden');
  pauseRow.dataset.shield = 'pause';
  const pauseLabel = document.createElement('span');
  const pauseBtn = make('button', 'text-btn small');
  pauseBtn.addEventListener('click', () => onTogglePause());
  pauseRow.appendChild(pauseLabel);
  pauseRow.appendChild(pauseBtn);
  node.appendChild(pauseRow);

  // "Reload to apply" applies block/strip/farble; the restart line beside it appears only
  // while a restart is pending so the two are never confused.
  const foot = make('div', 'shield-foot');
  foot.dataset.shield = 'foot';
  const footNote = make('span', 'shield-foot-note hidden');
  footNote.textContent = COPY.footer;
  const reloadBtn = make('button', 'text-btn small');
  reloadBtn.textContent = 'Reload to apply';
  reloadBtn.addEventListener('click', () => onReload());
  foot.appendChild(footNote);
  foot.appendChild(reloadBtn);
  node.appendChild(foot);

  const confirm = createRestartConfirm({
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
    onChange: () => paintRestart(),
    onInvoke: () => {
      Promise.resolve()
        .then(() => onRestart())
        .then((res) => {
          if (res && res.ok) return;
          confirm.reset();
          onRestartFailed((res && res.reason) || 'failed');
        })
        .catch(() => {
          confirm.reset();
          onRestartFailed('failed');
        });
    }
  });
  restartBtn.addEventListener('click', () => confirm.activate());
  // First Escape in the confirm state only reverts it; the panel's own close-on-Escape must not fire.
  node.addEventListener('keydown', (/** @type {any} */ e) => {
    if (e.key === 'Escape' && confirm.escape()) {
      e.stopPropagation();
      e.preventDefault();
    }
  });
  node.addEventListener('focusout', (/** @type {any} */ e) => {
    if (!confirm.isConfirming()) return;
    const to = e && e.relatedTarget;
    if (!to || !node.contains(to)) confirm.focusOut();
  });

  let lastRestartPending = false;
  function paintRestart() {
    const ctl = restartControl({
      restartPending: lastRestartPending,
      confirming: confirm.isConfirming(),
      restoreSession: live.restoreSession
    });
    setHidden(restartWrap, ctl.hidden);
    restartBtn.textContent = ctl.label;
    restartNote.textContent = ctl.note;
    setHidden(restartNote, ctl.note === '');
    if (ctl.note !== '') restartBtn.setAttribute('aria-describedby', 'shields-restart-note');
    else restartBtn.removeAttribute('aria-describedby');
  }

  /**
   * Patch the node in place from the latest inputs. Never creates or removes children.
   * @param {{ cfg?: any, site?: string, paused?: boolean, effects?: Record<string, [number, string]>,
   *   isolation?: { isolateEffective: boolean, operatorOverride: any } | null, restoreSession?: boolean }} state
   */
  function patch(state) {
    const cfg = (state && state.cfg) || {};
    const site = (state && state.site) || '';
    const paused = !!(state && state.paused);
    const effects = (state && state.effects) || {};
    live = { cfg, restoreSession: state ? state.restoreSession : undefined };
    const iso = state && state.isolation;
    const model = isolationModel({
      cfg,
      isolateEffective: iso ? iso.isolateEffective : effectiveAfterRestart(cfg, null),
      operatorOverride: iso ? iso.operatorOverride : null,
      paused
    });

    masterSwitch.set(!!cfg.enabled);
    masterNote.textContent = model.masterNote ? COPY[model.masterNote] : '';
    setHidden(masterNote, !model.masterNote);

    const dim = !cfg.enabled || paused;
    for (const [key] of SHIELD_ROWS) {
      const r = rows[key];
      const isIsolate = key === 'isolate';
      const rowDim = isIsolate ? model.isolateRow.dim : dim;
      r.row.classList.toggle('dim', rowDim);
      r.sw.set(!!cfg[key]);
      const eff = effects[key];
      const show = isIsolate ? model.isolateRow.showCount : !!cfg[key] && !dim;
      const has = !!(show && eff && eff[0]);
      r.count.textContent = has ? `${eff[0]} ${eff[1]}` : '';
      setHidden(r.count, !has);
    }
    const noteKey = model.isolateRow.note;
    notes.isolate.textContent = noteKey ? COPY[noteKey] : '';
    setHidden(notes.isolate, !noteKey);

    setHidden(pauseRow, !site);
    pauseLabel.textContent = `${paused ? 'Shields paused on' : 'Active on'} ${site}`;
    pauseBtn.textContent = paused ? 'Resume here' : 'Pause on this site';

    lastRestartPending = model.restartPending;
    if (!lastRestartPending) confirm.reset();
    setHidden(footNote, !lastRestartPending);
    paintRestart();
  }

  return { node, patch, resetConfirm: () => confirm.reset() };
}
