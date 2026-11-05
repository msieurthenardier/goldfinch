// @ts-check

// Corner save-prompt page controller (Sortie 06, Leg 1). Renders the card from the shared
// vault-capture-template builders (non-modal), reports its content height, reports pointer /
// focus presence (the 10 s timer's pause inputs live MAIN-side), animates the countdown bar from
// the main-pushed { remainingMs, paused }, and drives Save / Not now / X over the narrow
// `window.savePrompt` bridge. `textContent` only; METADATA ONLY - no secret ever reaches here.
//
// This page NEVER moves OS focus on appearance (DD2): the element focus method has exactly ONE
// call site, inside `focusPrimary()`, reached only from the main-pushed `focus-first` (an
// explicit F6) and from restoring focus the card already held across a model-replace repaint
// (source-scan pinned in test/unit/save-prompt-page.test.js). The operator's page keeps focus.

import {
  buildVaultCaptureCard,
  renderVaultCaptureCard,
  savePromptAnnouncement,
  selectedVaultId
} from '../shared/vault-capture-template.js';

const bridge = window.savePrompt;
const root = /** @type {HTMLElement} */ (document.getElementById('save-prompt-root'));
const announceNode = document.getElementById('save-prompt-announce');
const TIMER_TOTAL_MS = 10000;

/** @type {{ token: number, captureId: string, refs: ReturnType<typeof buildVaultCaptureCard>, choiceInputs: HTMLInputElement[], model: any, observer: ResizeObserver | null } | null} */
let state = null;
let lastHeight = -1;

function reportHeight() {
  if (!state) return;
  const rect = state.refs.card.getBoundingClientRect();
  // 8 px of shadow room above and below (save-prompt.css `#save-prompt-root` padding).
  const h = Math.ceil(rect.height) + 16;
  if (h === lastHeight) return;
  lastHeight = h;
  bridge.height(state.token, h);
}

/** @param {number} remainingMs @param {boolean} paused */
function renderTimer(remainingMs, paused) {
  if (!state) return;
  const fill = state.refs.timerFill;
  state.refs.card.classList.toggle('paused', paused);
  const ratio = Math.max(0, Math.min(1, remainingMs / TIMER_TOTAL_MS));
  fill.style.transition = 'none';
  fill.style.transform = `scaleX(${ratio})`;
  if (!paused && remainingMs > 0) {
    // force a style flush so the transition starts from the scale set above
    void fill.offsetWidth;
    fill.style.transition = `transform ${Math.round(remainingMs)}ms linear`;
    fill.style.transform = 'scaleX(0)';
  }
}

/** @param {{ kind: string, text: string }} result */
function renderResult(result) {
  if (!state) return;
  const { refs } = state;
  // Hide every offer-state region (head row, fields, choices, error, actions row); only the
  // role=status node remains.
  for (const el of [refs.dismissX.parentElement, refs.fields, refs.choices, refs.error, refs.save.parentElement]) {
    if (el) el.classList.add('hidden');
  }
  refs.timerFill.style.transition = 'none';
  refs.timerFill.style.transform = 'scaleX(0)';
  refs.status.classList.remove('hidden');
  refs.status.classList.toggle('failure', result.kind === 'failure');
  refs.status.textContent = result.text;
  reportHeight();
}

// The ONE allowed element-focus site: the primary action (Save / Update / Unlock & save /
// Unlock & review). A no-op when there is no enabled, visible primary button.
function focusPrimary() {
  if (!state) return;
  const primary = state.refs.save;
  if (primary.disabled || primary.closest('.hidden')) return;
  primary.focus();
}

function clearAll() {
  if (announceNode) announceNode.textContent = '';
  if (state && state.observer) state.observer.disconnect();
  state = null;
  lastHeight = -1;
  root.textContent = '';
}

bridge.onClear(() => clearAll());

bridge.onFocusFirst((d) => {
  if (state && state.token === d.token) focusPrimary();
});

bridge.onInit((d) => {
  // A model-replace repaint (convert in place / re-ask) destroys the focused node: remember
  // whether the card held focus so it is restored to the new primary button afterwards.
  const hadFocus = !!state && state.refs.card.contains(document.activeElement);
  clearAll();
  const refs = buildVaultCaptureCard(document);
  root.appendChild(refs.node);
  /** @type {HTMLInputElement[]} */
  let choiceInputs = [];
  const token = d.token;
  const captureId = d.captureId;
  state = { token, captureId, refs, choiceInputs, model: d.model, observer: null };
  if (d.result) {
    // result-only prompt: no offer content at all
    renderResult(d.result);
  } else {
    choiceInputs = renderVaultCaptureCard(document, refs, d.model).choiceInputs;
    state.choiceInputs = choiceInputs;
    const q = d.queue;
    refs.counter.textContent = q && q.total > 1 ? `${q.index} of ${q.total}` : '';
    renderTimer(d.remainingMs, d.paused);
  }
  refs.save.addEventListener('click', () => {
    if (!state || state.token !== token) return;
    const vaultId = selectedVaultId(state.choiceInputs) || state.model.defaultVaultId;
    refs.save.disabled = true;
    // A LOCKED offer's primary is "Unlock & save": it records consent (main raises nothing
    // itself - the chrome opens the unlock sheet once this prompt closes). Identity has no vault
    // choice, so it sends null.
    if (state.model && state.model.mode === 'locked') {
      void Promise.resolve(bridge.consent({ token, captureId, vaultId: vaultId == null ? null : vaultId })).then(
        (res) => {
          // A refusal that leaves the prompt up (e.g. already unlocked) re-enables the button.
          if (res && res.ok === false && state && state.token === token) refs.save.disabled = false;
        },
        () => {
          if (state && state.token === token) refs.save.disabled = false;
        }
      );
      return;
    }
    void bridge.save({ token, captureId, vaultId });
  });
  const dismiss = () => {
    if (state && state.token === token) bridge.dismiss(token);
  };
  refs.cancel.addEventListener('click', dismiss);
  refs.dismissX.addEventListener('click', dismiss);
  if (typeof ResizeObserver === 'function') {
    state.observer = new ResizeObserver(() => reportHeight());
    state.observer.observe(refs.card);
  }
  reportHeight();
  // DD3: the prompt's own polite status node (no "Press F6": the prompt is already in reach).
  const note = d.result ? null : savePromptAnnouncement(d.model);
  if (announceNode) announceNode.textContent = note || '';
  if (hadFocus && !d.result) focusPrimary();
});

bridge.onTimer((d) => {
  if (state && state.token === d.token) renderTimer(d.remainingMs, d.paused);
});

bridge.onResult((d) => {
  if (state && state.token === d.token) renderResult({ kind: d.kind, text: d.text });
});

bridge.onSaving((d) => {
  if (state && state.token === d.token) {
    state.refs.save.disabled = true;
    state.refs.card.classList.add('paused');
  }
});

// Pointer presence (AC9: the page's pointerenter/pointerleave is the single source).
document.documentElement.addEventListener('pointerenter', () => {
  if (state) bridge.pointer(state.token, true);
});
document.documentElement.addEventListener('pointerleave', () => {
  if (state) bridge.pointer(state.token, false);
});

// Focus presence: set only when the operator clicks / tabs INTO the card (never by this page).
document.addEventListener('focusin', () => {
  if (state) bridge.focusInside(state.token, true);
});
document.addEventListener('focusout', (e) => {
  if (!state) return;
  const next = /** @type {Node | null} */ (/** @type {FocusEvent} */ (e).relatedTarget);
  if (!next || !state.refs.card.contains(next)) bridge.focusInside(state.token, false);
});
