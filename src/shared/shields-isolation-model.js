// Pure, DOM-free model for the restart-to-apply third-party cookie isolation UI
// (sortie 02 leg 2 / DD4, DD5, DD6, DD11). Shared by the chrome privacy panel's Shields
// section and the goldfinch://settings #privacy fieldset. Never throws, never caches,
// projects its inputs to render state; all user-facing copy is single-sourced here.

export const COPY = Object.freeze({
  'browser-wide': 'Applies browser-wide',
  'stays-on-until-restart': 'Stays on until restart',
  'turns-on-after-restart': 'Turns on after restart',
  'isolation-stays-on-until-restart': 'Cookie isolation stays on until restart',
  footer: 'Cookie isolation changes need a restart',
  restartIdle: 'Restart now',
  restartConfirm: 'Restart Goldfinch',
  confirmLine: 'Goldfinch will close and reopen.',
  noRestoreLine: "Open tabs won't be reopened.",
  restartFailed: "Couldn't restart Goldfinch."
});

/**
 * What isolation WOULD be in force after a restart, from the persisted config and the
 * operator's command-line override. MUST agree with main's `decideStartup` over
 * `isolateConfigured(cfg)` (drift-guarded in shields-isolation-model.test.js).
 * @param {any} cfg
 * @param {'disabled' | 'enabled' | null | undefined} operatorOverride
 * @returns {boolean}
 */
export function effectiveAfterRestart(cfg, operatorOverride) {
  if (operatorOverride === 'disabled') return false;
  if (operatorOverride === 'enabled') return true;
  return !!(cfg && cfg.enabled) && !!(cfg && cfg.isolate);
}

/**
 * @param {{ cfg?: any, isolateEffective?: boolean, operatorOverride?: 'disabled'|'enabled'|null, paused?: boolean }} [input]
 */
export function isolationModel(input) {
  const { cfg, isolateEffective, operatorOverride, paused } = input || {};
  const inForce = isolateEffective === true;
  const after = effectiveAfterRestart(cfg, operatorOverride);
  const restartPending = after !== inForce;
  /** @type {'on' | 'off' | null} */
  const pendingDirection = restartPending ? (after ? 'on' : 'off') : null;
  /** @type {'browser-wide' | 'stays-on-until-restart' | 'turns-on-after-restart' | null} */
  let note = null;
  if (restartPending) note = after ? 'turns-on-after-restart' : 'stays-on-until-restart';
  else if (inForce && paused === true) note = 'browser-wide';
  return {
    inForce,
    restartPending,
    pendingDirection,
    isolateRow: { dim: !inForce, showCount: inForce, note },
    masterNote:
      !(cfg && cfg.enabled) && inForce
        ? /** @type {'isolation-stays-on-until-restart'} */ ('isolation-stays-on-until-restart')
        : null,
    copy: COPY
  };
}

/**
 * Render model for the ONE Restart now control per surface.
 * @param {{ restartPending?: boolean, confirming?: boolean, restoreSession?: boolean }} [input]
 */
export function restartControl(input) {
  const { restartPending, confirming, restoreSession } = input || {};
  const show = restartPending === true;
  const confirm = show && confirming === true;
  return {
    hidden: !show,
    confirming: confirm,
    label: confirm ? COPY.restartConfirm : COPY.restartIdle,
    note: confirm ? COPY.confirmLine + (restoreSession === false ? ' ' + COPY.noRestoreLine : '') : ''
  };
}

/**
 * Pure two-step confirm reducer. `state` is `{ confirming }`; events are 'activate',
 * 'timeout', 'escape', 'focus-out', 'reset'. Returns the next state plus `invoke` (the
 * second activation fires the channel) and `consumeEscape` (a first Escape in the confirm
 * state only reverts it and must not close the panel).
 * @param {{ confirming?: boolean } | null | undefined} state
 * @param {'activate'|'timeout'|'escape'|'focus-out'|'reset'} event
 * @returns {{ confirming: boolean, invoke: boolean, consumeEscape: boolean }}
 */
export function restartConfirmReducer(state, event) {
  const confirming = !!(state && state.confirming);
  switch (event) {
    case 'activate':
      return confirming
        ? { confirming: false, invoke: true, consumeEscape: false }
        : { confirming: true, invoke: false, consumeEscape: false };
    case 'escape':
      return { confirming: false, invoke: false, consumeEscape: confirming };
    case 'timeout':
    case 'focus-out':
    case 'reset':
      return { confirming: false, invoke: false, consumeEscape: false };
    default:
      return { confirming, invoke: false, consumeEscape: false };
  }
}

export const CONFIRM_TIMEOUT_MS = 6000;

/**
 * Small stateful driver around the reducer: owns the 6 s timer (injected timers, global
 * defaults) and reports changes. `onChange(confirming)` is called only on a net change.
 * @param {{ onInvoke: () => void, onChange: (confirming: boolean) => void, setTimer?: any, clearTimer?: any, timeoutMs?: number }} deps
 */
export function createRestartConfirm(deps) {
  const { onInvoke, onChange } = deps;
  const setTimer = deps.setTimer || ((/** @type {any} */ fn, /** @type {number} */ ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer || ((/** @type {any} */ h) => clearTimeout(h));
  const timeoutMs = deps.timeoutMs || CONFIRM_TIMEOUT_MS;
  let state = { confirming: false };
  /** @type {any} */
  let timer = null;

  function stopTimer() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }
  /** @param {'activate'|'timeout'|'escape'|'focus-out'|'reset'} event */
  function dispatch(event) {
    const next = restartConfirmReducer(state, event);
    const changed = next.confirming !== state.confirming;
    state = { confirming: next.confirming };
    stopTimer();
    if (state.confirming) timer = setTimer(() => dispatch('timeout'), timeoutMs);
    if (changed) onChange(state.confirming);
    if (next.invoke) onInvoke();
    return next;
  }
  return {
    activate: () => dispatch('activate'),
    escape: () => dispatch('escape').consumeEscape,
    focusOut: () => dispatch('focus-out'),
    reset: () => dispatch('reset'),
    isConfirming: () => state.confirming
  };
}
