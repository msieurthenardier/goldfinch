// Menu-overlay sheet page script (M05 Flight 8, Legs 2-3 / M08 Flight 4 Leg 2).
// Presentation-only: receives the serialized menu model over `menu-overlay:init`
// (channel 3), renders it under #menu-root via a TEMPLATE REGISTRY keyed by
// menuType (Leg 3, suggestions added M08 F4 Leg 2, downloads added M11 F1 Leg 3
// — FIVE templates now):
//
//   menu         (kebab, container)  — role="menu" item list, APG roving via the
//                                      SHARED menu-controller.js
//   info-popup   (site-info)         — note/row/action rows, NO items getter (the
//                                      controller's roving no-ops; local keydown
//                                      owns Escape/Tab — the chrome popup pattern)
//   input-dialog (new-container)     — fixed label+input+Create/Cancel layout,
//                                      centered via CSS (anchor ignored), dialog-
//                                      local Tab-cycle; model may be empty
//   suggestions  (address-bar)       — role="listbox" rows, NO items getter (like
//                                      info-popup) AND no local keydown at all —
//                                      the sheet never takes focus in this
//                                      template's regime (M08 F4 DD2); Escape/
//                                      arrows/typing all live in the chrome
//   downloads    (downloads popup)   — role="dialog" download-row list, NO items
//                                      getter (chrome-popup regime); local keydown
  //                                      owns Escape (close) + Tab/Shift+Tab (CYCLE
  //                                      through the scroll region + buttons);
//                                      live model-replace, one-shot activation
//
// EVERY template registers a menuController entry and opens via menuController.open,
// so the controller's global pointerdown/blur listeners deliver outside-click/blur
// dismissal uniformly for all four (an unregistered dialog would dangle on
// sheet-blur). Exactly ONE of `menu-overlay:activated` {id, value?, token} /
// `menu-overlay:dismissed` {reason, token} is reported per open token (first send
// wins). No business logic, no privileged APIs beyond window.menuOverlay.
//
// Reason attribution (design-review corrected — blur CANNOT be captured by
// listener order: `window` blur dispatches at-target, so registration order rules,
// and menu-controller's own blur→closeAll registered first): `lastStimulus`
// initializes to 'blur' and RESETS to 'blur' after every send — unattributed
// closes default to the blur flavor (which is what chrome's 300 ms re-click
// suppress window keys on). The state is MODULE-SCOPED, shared across the three
// template entries (Leg 3 hoist). Document-CAPTURE listeners attribute the flavors
// that CAN be reliably attributed (capture beats the controller's bubble/at-target
// listeners): keydown Escape → 'escape' (all templates); keydown Tab → 'escape'
// for MENU templates only (parity: Tab returns focus to the trigger today) — the
// info-popup attributes its own Tab in its local keydown, and the input-dialog's
// local keydown owns Tab-CYCLING (no dismissal); pointerdown outside the open
// template's node → 'outside-click'.

// menuController / focusItem are globals set by the sibling menu-controller.js
// classic <script> — the product's ONE remaining classic script (M07 Flight 2
// DD6 carve-out); its `defer` tag precedes this module in the shared
// after-parse queue, so the globals exist when this file executes.
// isSafeColor is imported (the SAME color domain the product accepts —
// jars.js re-exports it).
import { isSafeColor } from '../shared/safe-color.js';
import { buildVaultUnlockCard } from '../shared/vault-unlock-template.js';
import { buildVaultPickerCard, renderVaultPickerRows, pickId, MANAGE_ID } from '../shared/vault-picker-template.js';
import { buildVaultCaptureCard, renderVaultCaptureCard, selectedVaultId } from '../shared/vault-capture-template.js';
import { buildVaultSetCard } from '../shared/vault-set-template.js';
import { buildVaultRecoveryCard } from '../shared/vault-recovery-template.js';
import { buildVaultStepupCard } from '../shared/vault-stepup-template.js';
import { buildVaultAccessKeyCard } from '../shared/vault-accesskey-template.js';
import { buildVaultAdminKeyCard } from '../shared/vault-adminkey-template.js';
import { buildVaultImportCard } from '../shared/vault-import-template.js';
import { buildVaultChangeMasterCard } from '../shared/vault-change-master-template.js';
import { buildVaultRecoverCard } from '../shared/vault-recover-template.js';
import { createSheetReport, attachModalCard } from '../shared/modal-card-controller.js';

(() => {
  const root = document.getElementById('menu-root');
  if (!root || !window.menuOverlay || typeof window.menuOverlay.onInit !== 'function') return;

  /* ------------------------------------------------ shared per-open state (hoisted) */

  // The one-report-per-open-token discipline is the shared, importable createSheetReport
  // machine (M12 F3 Leg 4, DD5 template-registry / modal-card refactor — extracted so the
  // token/sent/lastStimulus state machine is unit-testable). A SINGLE instance preserves
  // the module-scoped sharing the header describes across every template entry.
  // `report.token` / `report.sent` / `report.lastStimulus` replace the former module-
  // scoped currentToken / sent / lastStimulus; the two wrappers keep every onClose /
  // click / submit call site unchanged.
  const report = createSheetReport(window.menuOverlay);
  const reportDismissed = () => report.reportDismissed();
  /** @param {{ id: string, value?: string }} payload @returns {boolean} */
  const sendActivatedOnce = (payload) => report.sendActivatedOnce(payload);

  /** Position an absolutely-positioned template node from the translated anchor
   * (DD2 nuance: toolbar anchors arrive pre-translated chrome→sheet; DD12: y
   * clamps to 0 — flush at the top edge). alignRight = the node's RIGHT edge in
   * sheet coords (kebab); alignLeft = LEFT edge (container ▾, site-info 🔒);
   * bare {x,y} = POINT anchor (page-context cursor / translated element point) —
   * clamped so a near-edge open keeps the menu fully inside the sheet (Leg 4,
   * parity with the chrome menu's viewport clamp: x floor 4 / right-bottom inset
   * 4; y floor 0 per DD12). Point clamping MEASURES the node (offsetWidth /
   * offsetHeight are 0 while display:none) — callers unhide before positioning
   * (renderMenu does; the align-anchor templates may still position while
   * hidden, their clamps don't measure).
   * @param {HTMLElement} node @param {any} anchor */
  function positionNode(node, anchor) {
    const alignRight = anchor && typeof anchor.alignRight === 'number' ? anchor.alignRight : null;
    const alignLeft = anchor && typeof anchor.alignLeft === 'number' ? anchor.alignLeft : null;
    const y = anchor && typeof anchor.y === 'number' ? anchor.y : 0;
    if (alignRight != null) {
      node.style.right = Math.max(0, Math.round(window.innerWidth - alignRight)) + 'px';
      node.style.left = 'auto';
    } else if (alignLeft != null) {
      node.style.left = Math.max(0, Math.round(alignLeft)) + 'px';
      node.style.right = 'auto';
    } else {
      // Point anchor — clamp x to [4, innerWidth - w - 4], y to [0, innerHeight - h - 4].
      const x = anchor && typeof anchor.x === 'number' ? anchor.x : 0;
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      node.style.left = Math.max(4, Math.min(Math.round(x), window.innerWidth - w - 4)) + 'px';
      node.style.right = 'auto';
      node.style.top = Math.max(0, Math.min(Math.round(y), window.innerHeight - h - 4)) + 'px';
      return;
    }
    node.style.top = Math.max(0, Math.round(y)) + 'px';
  }

  /* --------------------------------------------------------------- template: menu */
  // One persistent menu node, rebuilt per init (the container-menu rebuild
  // pattern) — registered with the shared controller exactly once, so the
  // controller's per-entry listeners never stack across opens.

  const menuNode = document.createElement('div');
  menuNode.id = 'sheet-menu';
  menuNode.setAttribute('role', 'menu');
  menuNode.tabIndex = -1;
  menuNode.classList.add('hidden');
  root.appendChild(menuNode);

  // Accessible menu names per menuType (the model carries item labels only).
  const MENU_LABELS = {
    kebab: 'More menu',
    container: 'Open new tab in a container', // parity with chrome #container-menu
    'page-context': 'Page actions', // parity with chrome #page-context-menu (index.html:54)
    'tab-context': 'Tab menu' // M09 Flight 5 Leg 1 — right-click / Context-Menu-key on a tab
  };
  // Non-item header row per menuType (role="presentation" — parity with the old
  // container menu's "Open new tab in…" .cm-title; excluded from the item set).
  const MENU_TITLES = { container: 'Open new tab in…' };

  const items = () => /** @type {HTMLElement[]} */ ([...menuNode.querySelectorAll('[role="menuitem"]')]);

  const menuEntry = menuController.register({
    // trigger === menu (like the chrome page-context-menu entry): the controller
    // skips its trigger-keydown opener; opens are programmatic (per init).
    trigger: menuNode,
    menu: menuNode,
    items,
    /** @param {number} [startIndex] */
    onOpen(startIndex = 0) {
      menuNode.classList.remove('hidden');
      const list = items();
      if (list.length) focusItem(list, startIndex === -1 ? list.length - 1 : startIndex);
    },
    onClose() {
      menuNode.classList.add('hidden');
      reportDismissed();
    },
    // No-op focusReturn: trigger === menu (a now-hidden node) — Escape/Tab must
    // not try to focus it. The real refocus is main-side (focusChrome) + chrome
    // trigger focus, resolved per reason.
    focusReturn: () => {}
  });

  /** Rebuild the menu item list from the model. Labels via textContent ONLY (DD8 —
   * the model carries guest-controlled / user-supplied strings; no markup path).
   * `color` is DATA: applied via style.background on a dedicated dot span AFTER
   * the shared isSafeColor check (the product's own color domain — jars.js);
   * invalid → the default grey dot. Property assignment cannot inject
   * sibling declarations regardless — the validation is defense-in-depth.
   * @param {string} menuType @param {any[]} model @param {any} anchor */
  function renderMenu(menuType, model, anchor) {
    menuNode.textContent = '';
    menuNode.dataset.menuType = menuType;
    menuNode.setAttribute('aria-label', MENU_LABELS[menuType] || menuType);
    if (MENU_TITLES[menuType]) {
      const title = document.createElement('div');
      title.className = 'cm-title';
      title.setAttribute('role', 'presentation');
      title.textContent = MENU_TITLES[menuType];
      menuNode.appendChild(title);
    }
    for (const item of model) {
      if (!item) continue;
      // Leg-4 item types — branch on `type` BEFORE the id-string guard (separators
      // and notes carry no id and would silently vanish below). Neither carries
      // role="menuitem", so the items() getter excludes them and the shared
      // controller's roving tabindex skips them for free.
      if (item.type === 'separator') {
        const s = document.createElement('div');
        s.className = 'cm-sep';
        s.setAttribute('role', 'separator');
        menuNode.appendChild(s);
        continue;
      }
      if (item.type === 'note') {
        // Informational placeholder ("No suggestions") — aria-disabled, non-focusable.
        const note = document.createElement('div');
        note.className = 'cm-item';
        note.setAttribute('aria-disabled', 'true');
        note.textContent = String(item.text != null ? item.text : '');
        menuNode.appendChild(note);
        continue;
      }
      if (typeof item.id !== 'string') continue;
      const btn = document.createElement('button');
      btn.className = 'cm-item';
      btn.setAttribute('role', 'menuitem');
      btn.tabIndex = -1;
      if (item.color !== undefined) {
        const dot = document.createElement('span');
        dot.className = 'cm-dot';
        dot.style.background = isSafeColor(item.color) ? item.color : '#9aa0ac';
        btn.appendChild(dot);
      }
      btn.appendChild(document.createTextNode(String(item.label != null ? item.label : item.id)));
      if (item.isDefault) {
        // Default-jar marker (Flight 5 Leg 1) — trails the label (dot leads, marker
        // trails). Visible descendant text inside the role="menuitem" button
        // contributes to the accessible name automatically, so this satisfies the
        // a11y requirement without a separate aria-label; textContent only, no markup.
        const badge = document.createElement('span');
        badge.className = 'cm-default';
        badge.textContent = 'Default';
        btn.appendChild(badge);
      }
      btn.addEventListener('click', () => {
        // Exactly one report per token: activation wins over the dismissal the
        // controller's onClose would otherwise send.
        if (sendActivatedOnce({ id: item.id })) menuController.close(menuEntry);
      });
      menuNode.appendChild(btn);
    }
    // Unhide BEFORE positioning (Leg 4): point-anchor clamping measures the node,
    // and offsetWidth/offsetHeight are 0 under display:none — mirroring the chrome
    // path (unhide → position). Same task, no intermediate paint; onOpen's own
    // classList.remove is then a no-op.
    menuNode.classList.remove('hidden');
    positionNode(menuNode, anchor);
  }

  /* --------------------------------------------------------- template: info-popup */
  // Site-info: note/row/action rows. Registered WITHOUT an items getter — the
  // controller's `!entry.items` guard no-ops the roving contract (exactly the
  // chrome site-info pattern); the local keydown below owns Escape/Tab (both close
  // with the 'escape' flavor — parity: today Tab closes AND refocuses the chip).

  const popupNode = document.createElement('div');
  popupNode.id = 'sheet-popup';
  popupNode.setAttribute('role', 'dialog');
  popupNode.tabIndex = -1;
  popupNode.classList.add('hidden');
  root.appendChild(popupNode);

  const POPUP_LABELS = { 'site-info': 'Site information' }; // parity with chrome #site-info-popup

  const popupEntry = menuController.register({
    trigger: popupNode,
    menu: popupNode,
    // no `items` — roving no-ops (controller guard)
    onOpen() {
      popupNode.classList.remove('hidden');
      // Focus the action button if present (web state), else the container
      // (internal note state) — parity with the chrome popup's (btn || popup).focus().
      const btn = /** @type {HTMLElement | null} */ (popupNode.querySelector('button'));
      (btn || popupNode).focus();
    },
    onClose() {
      popupNode.classList.add('hidden');
      reportDismissed();
    },
    focusReturn: () => {}
  });

  popupNode.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      report.lastStimulus = 'escape'; // Tab pinned to the escape flavor (chip refocus parity)
      menuController.close(popupEntry);
    }
  });

  /** Render the info-popup rows. All text via textContent (DD8).
   * @param {string} menuType @param {any[]} model @param {any} anchor */
  function renderPopup(menuType, model, anchor) {
    popupNode.textContent = '';
    popupNode.dataset.menuType = menuType;
    popupNode.setAttribute('aria-label', POPUP_LABELS[menuType] || menuType);
    const section = document.createElement('div');
    section.className = 'si-section';
    popupNode.appendChild(section);
    /** @type {HTMLElement | null} */
    let actions = null;
    for (const item of model) {
      if (!item || typeof item.type !== 'string') continue;
      if (item.type === 'note') {
        const row = document.createElement('div');
        row.className = 'si-row ' + (item.variant === 'host' ? 'si-host' : 'si-secure');
        row.textContent = String(item.text != null ? item.text : '');
        section.appendChild(row);
      } else if (item.type === 'row') {
        const row = document.createElement('div');
        row.className = 'si-row';
        const label = document.createElement('span');
        label.className = 'si-label';
        label.textContent = String(item.label != null ? item.label : '');
        const value = document.createElement('span');
        value.className = 'si-value';
        value.textContent = String(item.value != null ? item.value : '');
        row.append(label, value);
        section.appendChild(row);
      } else if (item.type === 'action' && typeof item.id === 'string') {
        if (!actions) {
          actions = document.createElement('div');
          actions.className = 'si-actions';
          popupNode.appendChild(actions);
        }
        const btn = document.createElement('button');
        btn.className = 'text-btn small';
        btn.type = 'button';
        btn.textContent = String(item.label != null ? item.label : item.id);
        btn.addEventListener('click', () => {
          if (sendActivatedOnce({ id: item.id })) menuController.close(popupEntry);
        });
        actions.appendChild(btn);
      }
    }
    positionNode(popupNode, anchor);
  }

  /* ------------------------------------------------------- template: input-dialog */
  // New-container: fixed layout (label + input + Create/Cancel), centered via CSS
  // — the anchor is ignored (parity with today's centered chrome card). The
  // backdrop dims the SHEET (guest region) only — the DD12-accepted variation:
  // toolbar clicks blur-dismiss AND perform their action. Registered with the
  // controller (trigger === menu === backdrop) so window-blur dismissal arrives
  // through the same global listeners; the backdrop swallows in-sheet pointerdowns
  // (contains() is true), and its own click handler implements backdrop-dismiss.

  const dialogNode = document.createElement('div');
  dialogNode.id = 'sheet-dialog';
  dialogNode.classList.add('hidden');
  root.appendChild(dialogNode);

  const dialogCard = document.createElement('div');
  dialogCard.className = 'new-container-inner';
  dialogCard.setAttribute('role', 'dialog');
  dialogCard.setAttribute('aria-modal', 'true');
  dialogCard.setAttribute('aria-label', 'New container');
  dialogNode.appendChild(dialogCard);

  const dialogLabel = document.createElement('label');
  dialogLabel.className = 'new-container-label';
  dialogLabel.htmlFor = 'sheet-nc-name';
  dialogLabel.textContent = 'New container name';
  const dialogInput = document.createElement('input');
  dialogInput.id = 'sheet-nc-name';
  dialogInput.className = 'new-container-input';
  dialogInput.type = 'text';
  dialogInput.maxLength = 24; // channel-4 `value` stays within main's cap (AC5)
  dialogInput.placeholder = 'e.g. Shopping';
  dialogInput.autocomplete = 'off';
  dialogInput.spellcheck = false;
  const dialogActions = document.createElement('div');
  dialogActions.className = 'new-container-actions';
  const dialogCreate = document.createElement('button');
  dialogCreate.className = 'text-btn small';
  dialogCreate.type = 'button';
  dialogCreate.textContent = 'Create';
  const dialogCancel = document.createElement('button');
  dialogCancel.className = 'text-btn small';
  dialogCancel.type = 'button';
  dialogCancel.textContent = 'Cancel';
  dialogActions.append(dialogCreate, dialogCancel);
  dialogCard.append(dialogLabel, dialogInput, dialogActions);

  const dialogEntry = menuController.register({
    trigger: dialogNode,
    menu: dialogNode,
    // no `items` — roving no-ops; Tab-cycling is dialog-local below
    onOpen() {
      dialogInput.value = '';
      dialogNode.classList.remove('hidden');
      dialogInput.focus();
    },
    onClose() {
      dialogNode.classList.add('hidden');
      reportDismissed();
    },
    focusReturn: () => {}
  });

  // Enter or Create → channel 4 {id:'create', value}. Empty-after-trim → PAGE-SIDE
  // no-op (dialog stays open): main closes on any activated send, so a whitespace
  // send would close-without-creating — the guard MUST live here. The raw value is
  // sent (≤24 by maxlength); the chrome trims (parity with the old dialog).
  function submitDialog() {
    if (report.sent || report.token == null) return;
    if (!dialogInput.value.trim()) return; // whitespace-only → dialog stays open
    report.sent = true;
    window.menuOverlay.sendActivated({ id: 'create', value: dialogInput.value, token: report.token });
    menuController.close(dialogEntry);
  }

  dialogCreate.addEventListener('click', submitDialog);
  // Cancel is user-explicit like Escape (design decision): dismissed{reason:'escape'}
  // → chrome returns focus to the ▾ trigger.
  dialogCancel.addEventListener('click', () => {
    report.lastStimulus = 'escape';
    menuController.close(dialogEntry);
  });
  dialogInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitDialog();
    }
  });
  // Dialog-local keydown: Escape → dismiss (escape flavor); Tab/Shift+Tab cycle the
  // three focusables (input → Create → Cancel → input) — a dialog-local trap; the
  // sheet page has nothing else focusable. The controller's menu-keydown no-ops
  // (!entry.items), so this listener OWNS both keys (no 'escape' Tab attribution —
  // template-conditional, menus only).
  dialogNode.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      report.lastStimulus = 'escape';
      menuController.close(dialogEntry);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const cycle = [dialogInput, dialogCreate, dialogCancel];
      const i = cycle.indexOf(/** @type {any} */ (document.activeElement));
      const n = (i + (e.shiftKey ? -1 : 1) + cycle.length) % cycle.length;
      cycle[n].focus();
    }
  });
  // Backdrop click (outside the card) dismisses — parity with the old chrome
  // dialog's outside-click. The controller's global pointerdown can't see it
  // (the backdrop contains every in-sheet target), so this handler owns it.
  dialogNode.addEventListener('click', (e) => {
    if (e.target === dialogNode) {
      report.lastStimulus = 'outside-click';
      menuController.close(dialogEntry);
    }
  });

  /* --------------------------------------------------------- template: suggestions */
  // Address-bar suggestions (M08 Flight 4 Leg 2, DD1/DD2): a listbox of frecency-
  // ranked history rows, fully model-replaced by the chrome on every keystroke/
  // selection change — the sheet holds ZERO suggestion state of its own. Registered
  // WITHOUT an items getter — like info-popup, the controller's roving contract
  // no-ops (`!entry.items` — see menu-controller.js's menu-keydown guard); `onOpen`
  // focuses NOTHING (DD2 — the sheet's non-focusing regime; deliverInit's noFocus
  // gate is the machinery, this template's onOpen must never move focus) so
  // keystrokes keep flowing to the chrome's own #address listeners. Own keydown:
  // NONE — a pointer click giving the sheet native focus makes Escape here a true
  // no-op; recovery is blur/outside-click/model-replace only (design review,
  // accepted, documented).

  const suggestionsNode = document.createElement('div');
  suggestionsNode.id = 'sheet-suggestions';
  suggestionsNode.setAttribute('role', 'listbox');
  suggestionsNode.setAttribute('aria-label', 'Address suggestions');
  suggestionsNode.tabIndex = -1;
  suggestionsNode.classList.add('hidden');
  root.appendChild(suggestionsNode);

  const suggestionsEntry = menuController.register({
    trigger: suggestionsNode,
    menu: suggestionsNode,
    // no `items` — roving no-ops (controller guard); NOTHING focused (DD2).
    onOpen() {
      suggestionsNode.classList.remove('hidden');
    },
    onClose() {
      suggestionsNode.classList.add('hidden');
      reportDismissed();
    },
    focusReturn: () => {}
  });

  /** Render the suggestions listbox. All text via textContent (DD8). `model` for
   * this template is the omnibox model shape `{ items: Array<{primary, secondary}>,
   * selectedIndex, emptyNote? }` — distinct from the other templates' flat item
   * arrays (DD1/leg contract). `selectedIndex` may be -1 (no selection).
   * @param {string} menuType @param {any} model @param {any} anchor */
  function renderSuggestions(menuType, model, anchor) {
    suggestionsNode.textContent = '';
    suggestionsNode.dataset.menuType = menuType;
    const list = model && Array.isArray(model.items) ? model.items : [];
    const selectedIndex = model && typeof model.selectedIndex === 'number' ? model.selectedIndex : -1;
    if (!list.length) {
      const note = document.createElement('div');
      note.className = 'sg-note';
      note.textContent = String((model && model.emptyNote) || '');
      suggestionsNode.appendChild(note);
    } else {
      list.forEach((item, i) => {
        const row = document.createElement('div');
        row.className = 'sg-option' + (i === selectedIndex ? ' selected' : '');
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(i === selectedIndex));
        const primary = document.createElement('span');
        primary.className = 'sg-primary';
        primary.textContent = String(item && item.primary != null ? item.primary : '');
        const secondary = document.createElement('span');
        secondary.className = 'sg-secondary';
        secondary.textContent = String(item && item.secondary != null ? item.secondary : '');
        row.append(primary, secondary);
        // Row click → sug:<i> index dispatch, the exact menu/info-popup idiom
        // (one-shot guard + token auto-injection via sendActivatedOnce) — NEVER
        // the raw preload sendActivated (design review).
        row.addEventListener('click', () => {
          if (sendActivatedOnce({ id: 'sug:' + i })) menuController.close(suggestionsEntry);
        });
        suggestionsNode.appendChild(row);
      });
    }
    // Standard anchor mechanics only (alignLeft + y clamp) — no template-specific
    // positioning code (leg contract).
    suggestionsNode.classList.remove('hidden');
    positionNode(suggestionsNode, anchor);
  }

  /* ------------------------------------------------------- template: vault-unlock */
  // Master-password UNLOCK prompt (M12 Flight 2 Leg 2 chrome-unlock, DD4/DD10) —
  // a FIFTH template kind, near-cloning input-dialog (a centered backdrop + card,
  // role="dialog" aria-modal="true", dialog-local Tab-cycle + Escape) but with a
  // type="password" input, an aria-live error line, and — critically — the secret
  // leaving via the DEDICATED request/response channel (menuOverlay.unlockVault),
  // NEVER channel-4 sendActivated (string-only / 24-char capped). The sheet awaits
  // { ok }: false re-prompts (stays open, shows the error), true closes. The card
  // DOM is built by the shared, unit-tested buildVaultUnlockCard.

  const vault = buildVaultUnlockCard(document);
  const vaultNode = vault.node;
  const vaultInput = vault.input;
  const vaultError = vault.error;
  const vaultUnlockBtn = vault.unlock;
  const vaultCancelBtn = vault.cancel;
  root.appendChild(vaultNode);

  // Guards a concurrent submit (double-Enter / Enter+click) from firing two
  // invokes; reset on every open.
  let vaultBusy = false;

  const vaultEntry = menuController.register({
    trigger: vaultNode,
    menu: vaultNode,
    // no `items` — roving no-ops; Tab-cycling + Escape are dialog-local below.
    onOpen() {
      vaultInput.value = '';
      vaultError.textContent = '';
      vaultBusy = false;
      vaultNode.classList.remove('hidden');
      vaultInput.focus();
    },
    onClose() {
      vaultNode.classList.add('hidden');
      reportDismissed();
    },
    focusReturn: () => {}
  });

  // Submit → the DEDICATED secret channel. Encode to a Uint8Array (never a JS
  // string on the wire), invoke, and act on { ok }. The sheet-side copy is
  // zeroized after the round-trip (main zeroizes its own copy + the transferred
  // array); the input's V8 string is unscrubbable — an accepted DD4 limitation.
  async function submitVault() {
    if (report.sent || report.token == null || vaultBusy) return;
    const value = vaultInput.value;
    if (!value) {
      // Empty → inline hint, stay open, no invoke (page-side no-op, like the
      // input-dialog's whitespace guard).
      vaultError.textContent = 'Enter your master password';
      vaultInput.focus();
      return;
    }
    const token = report.token;
    const secret = new TextEncoder().encode(value);
    vaultBusy = true;
    let res;
    try {
      res = await window.menuOverlay.unlockVault({ token, secret });
    } catch {
      // A rejected invoke (e.g. the store isn't set up) degrades to a re-prompt —
      // never an unhandled rejection / crash (edge case: raising this prompt when
      // not set up is prevented by the trigger, but the handler must be safe).
      res = { ok: false };
    } finally {
      vaultBusy = false;
      secret.fill(0);
    }
    // Stale-resolution guard: a supersede / model-replace during the await moves
    // the live token; a late result must not act on the new menu.
    if (report.token !== token || report.sent) return;
    if (res && res.ok) {
      report.sent = true; // suppress the trailing dismissed; main also closes the sheet.
      menuController.close(vaultEntry);
    } else {
      vaultError.textContent = 'Incorrect master password';
      vaultInput.value = '';
      vaultInput.focus();
    }
  }

  vaultUnlockBtn.addEventListener('click', () => { void submitVault(); });
  // Cancel is user-explicit like Escape: dismissed{reason:'escape'} → chrome
  // returns focus to the trigger (wired by the pick-and-fill leg).
  vaultCancelBtn.addEventListener('click', () => {
    report.lastStimulus = 'escape';
    menuController.close(vaultEntry);
  });
  vaultInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitVault();
    }
  });
  // Dialog-local Escape + Tab-cycle (input → Unlock → Cancel → input) + backdrop dismiss
  // via the SHARED, unit-tested modal-card helper (M12 F3 Leg 4, DD5 refactor — replaces
  // the former inline keydown/backdrop blocks byte-for-byte; the controller's menu-keydown
  // no-ops here, !entry.items). dismissible defaults true.
  attachModalCard({
    node: vaultNode,
    getCycle: () => [vaultInput, vaultUnlockBtn, vaultCancelBtn],
    close: (stimulus) => { report.lastStimulus = stimulus; menuController.close(vaultEntry); },
  });

  /* ------------------------------------------------------- template: vault-picker */
  // Human vault picker (M12 Flight 2 Leg 3 pick-and-fill, DD5/DD6) — the DEDICATED
  // SIXTH template kind (the 'menu' kind renders only a single label + dot + a
  // hardcoded "Default" badge and cannot express title+username+source-vault rows or
  // emit a selection value). A centered backdrop + card (role="menu") like
  // vault-unlock — the gesture carries no anchor. Rows are a roving list via the
  // shared menu-controller; a click reports the row INDEX as `pick:<i>` (the 'sug:'+i
  // idiom — non-secret; `id` is not length-capped). An empty model renders a single
  // non-focusable note "No saved logins for this site". Metadata only — no password.

  const picker = buildVaultPickerCard(document);
  const pickerNode = picker.node;
  const pickerCard = picker.card;
  root.appendChild(pickerNode);

  // The focusable rows for the current render (rebuilt per init) — the controller's
  // items getter. Empty for the note state, so roving/arrows no-op safely.
  /** @type {HTMLElement[]} */
  let pickerRows = [];
  const pickerItems = () => pickerRows;

  const pickerEntry = menuController.register({
    // trigger === menu === pickerNode (the backdrop): opens are programmatic (per
    // init), so the controller skips its trigger-keydown opener — CRITICAL, since an
    // opener on the same node would fire on the roving list's own Arrow/Enter keys and
    // closeAll() it mid-navigation. The roving `items` live inside pickerCard; their
    // keydowns bubble up to pickerNode's menu-keydown listener (the shared APG roving
    // contract), and pickerCard carries role="menu"/menuitem for a11y. Outside-click
    // is the local backdrop handler below (the controller's pointerdown sees
    // pickerNode.contains(target) === true for every in-sheet click — parity with the
    // input-dialog / vault-unlock backdrops).
    trigger: pickerNode,
    menu: pickerNode,
    items: pickerItems,
    /** @param {number} [startIndex] */
    onOpen(startIndex = 0) {
      pickerNode.classList.remove('hidden');
      const list = pickerItems();
      if (list.length) focusItem(list, startIndex === -1 ? list.length - 1 : startIndex);
      else pickerCard.focus(); // empty (note) state — focus the card so Escape/Tab work
    },
    onClose() {
      pickerNode.classList.add('hidden');
      reportDismissed();
    },
    focusReturn: () => {}
  });

  /** Render the picker rows from the metadata model + wire per-row selection.
   * @param {any[]} model */
  function renderPicker(model) {
    pickerRows = renderVaultPickerRows(document, pickerCard, model);
    pickerRows.forEach((btn) => {
      btn.addEventListener('click', () => {
        // A credential row reports its INDEX (`pick:<i>`, from data-pick-index); the
        // separated footer (no data-pick-index) reports MANAGE_ID → chrome routes it to
        // openVaultPage() (a navigation, no secret). Activation wins over the onClose
        // dismissal (one report per token). The password is NEVER on this path.
        const pi = btn.dataset.pickIndex;
        const id = pi != null && pi !== '' ? pickId(Number(pi)) : MANAGE_ID;
        if (sendActivatedOnce({ id })) menuController.close(pickerEntry);
      });
    });
  }

  // Backdrop click (outside the card) dismisses — parity with input-dialog /
  // vault-unlock (the controller's global pointerdown sees pickerNode.contains(target)
  // === true for the backdrop, so it can't own this; this local handler does).
  // Escape/Tab are handled by the shared controller's menu-keydown (items present →
  // its Escape/Tab branch closes + returns focus; the empty note state has an items
  // getter returning [], so arrows no-op safely).
  pickerNode.addEventListener('click', (e) => {
    if (e.target === pickerNode) {
      report.lastStimulus = 'outside-click';
      menuController.close(pickerEntry);
    }
  });

  /* ------------------------------------------------------ template: vault-capture */
  // Save / update prompt (M12 Flight 2 Leg 4 capture-save, DD7) — the DEDICATED
  // SEVENTH template kind, a centered backdrop like vault-unlock (the submit carries
  // no anchor). Shows the origin + username (read-only), a "Save password?" /
  // "Update password?" heading, and — for a `save` only — a vault radio choice
  // (default the active jar, "Global" selectable). Save reports the chosen vaultId +
  // the stashed captureId to main via a DEDICATED invoke (menuOverlay.captureSave);
  // the CAPTURED PASSWORD is never here — it lives only in the main-side held record.

  const capture = buildVaultCaptureCard(document);
  const captureNode = capture.node;
  root.appendChild(captureNode);

  // The captureId of the offer currently rendered (from the init model) + the render's
  // choice radios. Set on every vault-capture init; the Save invoke carries the id back.
  /** @type {string | null} */
  let captureCaptureId = null;
  /** @type {HTMLInputElement[]} */
  let captureChoiceInputs = [];
  // The fixed vaultId a save invoke falls back to (the update path's vault, which main
  // ignores). Set per-init from the model's defaultVaultId.
  /** @type {string | undefined} */
  let captureDefaultVaultId;
  let captureBusy = false; // guards a concurrent Save (double-Enter / Enter+click).

  const captureEntry = menuController.register({
    trigger: captureNode,
    menu: captureNode,
    // no `items` — roving no-ops; Tab-cycling + Escape are dialog-local below.
    onOpen() {
      captureBusy = false;
      captureNode.classList.remove('hidden');
      // Focus the first vault choice on a save, else the Save button (update has none).
      if (captureChoiceInputs.length) captureChoiceInputs[0].focus();
      else capture.save.focus();
    },
    onClose() {
      captureNode.classList.add('hidden');
      reportDismissed();
    },
    focusReturn: () => {}
  });

  // Save → the DEDICATED captureSave invoke ({ token, captureId, vaultId }). The
  // vaultId is the checked radio (save) or the fixed default (update — main ignores it,
  // using the record's fixed vault). NO password on this path. { saved:true } → main
  // closes the sheet (channel 7 'activated'); { saved:false } → re-prompt with an error
  // (the held record is dropped on the eventual dismiss / the 2-min timeout).
  async function submitCapture() {
    if (report.sent || report.token == null || captureBusy || captureCaptureId == null) return;
    const token = report.token;
    const captureId = captureCaptureId;
    const vaultId = selectedVaultId(captureChoiceInputs) || captureDefaultVaultId;
    captureBusy = true;
    let res;
    try {
      res = await window.menuOverlay.captureSave({ token, captureId, vaultId });
    } catch {
      res = { saved: false };
    } finally {
      captureBusy = false;
    }
    // Stale-resolution guard: a supersede / model-replace during the await moved the
    // live token; a late result must not act on the new menu.
    if (report.token !== token || report.sent) return;
    if (res && res.saved) {
      report.sent = true; // suppress the trailing dismissed; main also closes the sheet.
      menuController.close(captureEntry);
    } else {
      capture.error.textContent = res && res.reason === 'locked'
        ? 'The manager locked — unlock it and try again'
        : 'Couldn’t save the password';
    }
  }

  capture.save.addEventListener('click', () => { void submitCapture(); });
  capture.cancel.addEventListener('click', () => {
    report.lastStimulus = 'escape';
    menuController.close(captureEntry);
  });
  // Enter → Save stays a card-local keydown; Escape + Tab-cycle (choice radios → Save →
  // Cancel) + backdrop dismiss are the SHARED modal-card helper (M12 F3 Leg 4, DD5
  // refactor — replaces the former inline Escape/Tab/backdrop blocks byte-for-byte). The
  // cycle getter reads captureChoiceInputs LIVE (rebuilt per render).
  captureNode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitCapture();
    }
  });
  attachModalCard({
    node: captureNode,
    getCycle: () => [...captureChoiceInputs, capture.save, capture.cancel],
    close: (stimulus) => { report.lastStimulus = stimulus; menuController.close(captureEntry); },
  });

  /** Render the capture card from the offer model + stash the captureId + choices.
   * @param {any} model */
  function renderCapture(model) {
    captureCaptureId = model && typeof model.captureId === 'string' ? model.captureId : null;
    captureDefaultVaultId = model && model.defaultVaultId;
    const { choiceInputs } = renderVaultCaptureCard(document, capture, model);
    captureChoiceInputs = choiceInputs;
  }

  /* ---------------------------------------------------------- template: vault-set */
  // First-run master-password SETUP (M12 F3 Leg 4 first-run-setup, DD5) — the EIGHTH
  // template kind, a dialog-style card on the shared modal-card helper (like vault-unlock):
  // password + confirm fields, a CLIENT-SIDE match check, submitting the password as a
  // Uint8Array over the DEDICATED menu-overlay:vault-setup Buffer channel (NEVER channel-4
  // sendActivated). The sheet awaits { ok }: false → stay open + show the error; true →
  // close (main also closes it and drives chrome to open vault-recovery-show).

  const vaultSet = buildVaultSetCard(document);
  const vaultSetNode = vaultSet.node;
  root.appendChild(vaultSetNode);

  // Guards a concurrent submit (double-Enter / Enter+click); reset on every open.
  let vaultSetBusy = false;

  const vaultSetEntry = menuController.register({
    trigger: vaultSetNode,
    menu: vaultSetNode,
    // no `items` — roving no-ops; Tab-cycling + Escape are the modal-card helper below.
    onOpen() {
      vaultSet.input.value = '';
      vaultSet.confirm.value = '';
      vaultSet.error.textContent = '';
      vaultSetBusy = false;
      vaultSetNode.classList.remove('hidden');
      vaultSet.input.focus();
    },
    onClose() {
      vaultSetNode.classList.add('hidden');
      // Scrub the fields' DOM values on close (best-effort — the input V8 strings
      // themselves are unscrubbable, the accepted DD4 limitation).
      vaultSet.input.value = '';
      vaultSet.confirm.value = '';
      reportDismissed();
    },
    focusReturn: () => {}
  });

  // Submit → the DEDICATED setup channel. Client-side: empty guard + confirm-MATCH check
  // (NO setup invoke on a mismatch). Encode to a Uint8Array (never a JS string on the
  // wire), invoke, act on { ok }. The sheet-side copy is zeroized after the round-trip;
  // main zeroizes its own Buffer copy + the transferred array (dual-zeroize).
  async function submitVaultSet() {
    if (report.sent || report.token == null || vaultSetBusy) return;
    const value = vaultSet.input.value;
    if (!value) {
      vaultSet.error.textContent = 'Choose a master password';
      vaultSet.input.focus();
      return;
    }
    if (value !== vaultSet.confirm.value) {
      vaultSet.error.textContent = 'Passwords do not match';
      vaultSet.confirm.focus();
      return;
    }
    const token = report.token;
    const secret = new TextEncoder().encode(value);
    vaultSetBusy = true;
    let res;
    try {
      res = await window.menuOverlay.setupVault({ token, secret });
    } catch {
      // A rejected invoke (e.g. already set up) degrades to an inline error, not a crash.
      res = { ok: false };
    } finally {
      vaultSetBusy = false;
      secret.fill(0);
    }
    // Stale-resolution guard: a supersede / model-replace during the await moved the live
    // token; a late result must not act on the new menu.
    if (report.token !== token || report.sent) return;
    if (res && res.ok) {
      report.sent = true; // suppress the trailing dismissed; main closes + opens recovery-show.
      menuController.close(vaultSetEntry);
    } else {
      vaultSet.error.textContent = 'Couldn’t set up the manager. Please try again.';
    }
  }

  vaultSet.submit.addEventListener('click', () => { void submitVaultSet(); });
  vaultSet.cancel.addEventListener('click', () => {
    report.lastStimulus = 'escape';
    menuController.close(vaultSetEntry);
  });
  const vaultSetEnter = (/** @type {any} */ e) => {
    if (e.key === 'Enter') { e.preventDefault(); void submitVaultSet(); }
  };
  vaultSet.input.addEventListener('keydown', vaultSetEnter);
  vaultSet.confirm.addEventListener('keydown', vaultSetEnter);
  attachModalCard({
    node: vaultSetNode,
    getCycle: () => [vaultSet.input, vaultSet.confirm, vaultSet.submit, vaultSet.cancel],
    close: (stimulus) => { report.lastStimulus = stimulus; menuController.close(vaultSetEntry); },
  });

  /* ----------------------------------------------- template: vault-recovery-show */
  // ONE-TIME recovery-key display (M12 F3 Leg 4 first-run-setup, DD5) — the NINTH template
  // kind, read-only and DISMISS-DISABLED. The recovery key arrives in the channel-3 init
  // model ({ recoveryKey }); it is rendered via textContent only, copied via main's
  // OS-clipboard write, and its reference is DROPPED on close (never re-emitted on
  // model-replace). Escape / backdrop / window-blur must NOT close it — only the explicit
  // acknowledge (the key is unrecoverable): the entry carries dismissible:false (the
  // menu-controller's blur/outside-click guards skip it) and attachModalCard is wired
  // dismissible:false (Escape/backdrop inert; Tab still traps). Main honors the same opt-out.

  const recovery = buildVaultRecoveryCard(document);
  const recoveryNode = recovery.node;
  root.appendChild(recoveryNode);

  /** @type {string | null} the recovery key currently displayed — dropped on close. */
  let recoveryKey = null;

  const recoveryEntry = menuController.register({
    trigger: recoveryNode,
    menu: recoveryNode,
    dismissible: false, // DD5 — the menu-controller blur/outside-click guards skip it
    // no `items` — roving no-ops; Tab-cycling is the modal-card helper below.
    onOpen() {
      recoveryNode.classList.remove('hidden');
      recovery.keyValue.focus();
    },
    onClose() {
      recoveryNode.classList.add('hidden');
      // Drop the key reference + scrub the DOM text — never retained past the display.
      recovery.keyValue.textContent = '';
      recoveryKey = null;
      reportDismissed();
    },
    focusReturn: () => {}
  });

  recovery.copy.addEventListener('click', () => {
    if (recoveryKey) window.menuOverlay.copyText(recoveryKey);
  });
  recovery.acknowledge.addEventListener('click', () => {
    // The deliberate close — activation (id:'ack') suppresses the trailing dismissed and
    // drives main to close the sheet. This is the ONLY path that closes recovery-show.
    if (sendActivatedOnce({ id: 'ack' })) menuController.close(recoveryEntry);
  });
  attachModalCard({
    node: recoveryNode,
    getCycle: () => [recovery.keyValue, recovery.copy, recovery.acknowledge],
    dismissible: false,
    close: () => {}, // dismiss-disabled — Escape/backdrop never close (see above)
  });

  /** Render the recovery key into the read-only display (textContent only) + stash it for
   * Copy. Re-reads the model each init, so a model-replace never re-emits a stale key.
   * The `replacing` flag (rotate-recovery only; setup omits it) reveals the "this replaces
   * your previous recovery key" line — the rotation kills the old key (HAT I9). Re-read each
   * init so a subsequent setup-case open (no flag) hides it again.
   * @param {any} model */
  function renderRecovery(model) {
    recoveryKey = model && typeof model.recoveryKey === 'string' ? model.recoveryKey : '';
    recovery.keyValue.textContent = recoveryKey || '';
    recovery.replacingLede.hidden = !(model && model.replacing === true);
  }

  /* -------------------------------------------------------- template: vault-stepup */
  // Step-up master-password confirmation for access-key MINT (M12 F3 Leg 5 access-keys,
  // DD5) — a dialog-style card on the shared modal-card helper, MIRRORING vault-set but
  // with a SINGLE password field (a re-auth, no confirm). The password submits as a
  // Uint8Array over the DEDICATED menu-overlay:vault-stepup-mint Buffer channel — carrying
  // the NON-SECRET target vault id (stashed from the channel-3 init model) — NEVER channel-4
  // sendActivated. The sheet awaits { ok }: false → stay open + show the error (wrong step-up
  // password re-prompts); true → close (main also closes it and drives chrome to open
  // vault-accesskey-show).

  const vaultStepup = buildVaultStepupCard(document);
  const vaultStepupNode = vaultStepup.node;
  root.appendChild(vaultStepupNode);

  // Guards a concurrent submit (double-Enter / Enter+click); reset on every open.
  let vaultStepupBusy = false;
  /** @type {string | undefined} the target vault id for the mint — stashed per-init. */
  let vaultStepupTarget;
  /** @type {'mint' | 'rotate-recovery' | 'rotate-admin'} the step-up operation — stashed per-init
   * (M12 F4 Leg 2/3). The vault-stepup sheet is REUSED for recovery rotation's (DD3) and admin-key
   * rotation/provision's (DD4) master-password step-up: same single-master-password re-auth UI,
   * different store op + one-time display. */
  let vaultStepupMode = 'mint';

  const vaultStepupEntry = menuController.register({
    trigger: vaultStepupNode,
    menu: vaultStepupNode,
    // no `items` — roving no-ops; Tab-cycling + Escape are the modal-card helper below.
    onOpen() {
      vaultStepup.input.value = '';
      vaultStepup.error.textContent = '';
      vaultStepupBusy = false;
      vaultStepupNode.classList.remove('hidden');
      vaultStepup.input.focus();
    },
    onClose() {
      vaultStepupNode.classList.add('hidden');
      // Scrub the field's DOM value on close (best-effort — the input V8 strings
      // themselves are unscrubbable, the accepted DD4 limitation).
      vaultStepup.input.value = '';
      reportDismissed();
    },
    focusReturn: () => {}
  });

  // Submit → the DEDICATED stepup-mint channel. Client-side: empty guard only (no confirm —
  // this is a re-auth). Encode to a Uint8Array (never a JS string on the wire), invoke with
  // the stashed target, act on { ok }. The sheet-side copy is zeroized after the round-trip;
  // main zeroizes its own Buffer copy + the transferred array (dual-zeroize).
  async function submitVaultStepup() {
    if (report.sent || report.token == null || vaultStepupBusy) return;
    const value = vaultStepup.input.value;
    if (!value) {
      vaultStepup.error.textContent = 'Enter your master password';
      vaultStepup.input.focus();
      return;
    }
    const token = report.token;
    const target = vaultStepupTarget;
    const mode = vaultStepupMode;
    const secret = new TextEncoder().encode(value);
    vaultStepupBusy = true;
    let res;
    try {
      res = mode === 'rotate-recovery'
        // M12 F4 Leg 2: recovery rotation's master-password step-up. On success main mints the
        // new recovery key + drives vault-recovery-show (post-write). No target.
        ? await window.menuOverlay.rotateRecovery({ token, secret })
        : mode === 'rotate-admin'
        // M12 F4 Leg 3: admin-key rotation/provision's master-password step-up. On success main
        // mints the new admin keypair + drives vault-adminkey-show (post-write). No target.
        ? await window.menuOverlay.rotateAdminKey({ token, secret })
        : await window.menuOverlay.stepupMint({ token, secret, target });
    } catch {
      // A rejected invoke degrades to an inline error, not a crash.
      res = { ok: false };
    } finally {
      vaultStepupBusy = false;
      secret.fill(0);
    }
    // Stale-resolution guard: a supersede / model-replace during the await moved the live
    // token; a late result must not act on the new menu.
    if (report.token !== token || report.sent) return;
    if (res && res.ok) {
      report.sent = true; // suppress the trailing dismissed; main closes + opens the one-time display.
      menuController.close(vaultStepupEntry);
    } else {
      vaultStepup.error.textContent = mode === 'rotate-recovery'
        ? 'Wrong master password. The recovery key was not rotated.'
        : mode === 'rotate-admin'
        ? 'Wrong master password. The admin key was not rotated.'
        : 'Wrong master password. Nothing was minted.';
      vaultStepup.input.value = '';
      vaultStepup.input.focus();
    }
  }

  vaultStepup.submit.addEventListener('click', () => { void submitVaultStepup(); });
  vaultStepup.cancel.addEventListener('click', () => {
    report.lastStimulus = 'escape';
    menuController.close(vaultStepupEntry);
  });
  vaultStepup.input.addEventListener('keydown', (/** @type {any} */ e) => {
    if (e.key === 'Enter') { e.preventDefault(); void submitVaultStepup(); }
  });
  attachModalCard({
    node: vaultStepupNode,
    getCycle: () => [vaultStepup.input, vaultStepup.submit, vaultStepup.cancel],
    close: (stimulus) => { report.lastStimulus = stimulus; menuController.close(vaultStepupEntry); },
  });

  /** Stash the step-up mode + (for mint) the target vault id from the object model. Re-read each
   * init so a model-replace never acts on a stale target/mode. The vault-stepup sheet is reused
   * for recovery rotation's master-password step-up (M12 F4 Leg 2, DD3): mode 'rotate-recovery'
   * re-labels the lede + submit and routes submit to the rotateRecovery channel; 'mint' (default)
   * is the F3 access-key step-up.
   * @param {any} model */
  function renderStepup(model) {
    vaultStepupMode = model && (model.mode === 'rotate-recovery' || model.mode === 'rotate-admin')
      ? model.mode
      : 'mint';
    vaultStepupTarget = model && typeof model.target === 'string' ? model.target : undefined;
    if (vaultStepupMode === 'rotate-recovery') {
      vaultStepup.lede.textContent =
        'Rotating your recovery key needs a fresh master-password confirmation, even while the manager is unlocked.';
      vaultStepup.submit.textContent = 'Rotate recovery key';
    } else if (vaultStepupMode === 'rotate-admin') {
      vaultStepup.lede.textContent =
        'Provisioning or rotating your admin key needs a fresh master-password confirmation, even while the manager is unlocked.';
      vaultStepup.submit.textContent = 'Provision admin key';
    } else {
      vaultStepup.lede.textContent =
        'Minting an access key needs a fresh master-password confirmation, even while the manager is unlocked.';
      vaultStepup.submit.textContent = 'Mint access key';
    }
  }

  /* -------------------------------------------- template: vault-accesskey-show */
  // ONE-TIME minted-access-key display (M12 F3 Leg 5 access-keys, DD5) — read-only and
  // DISMISS-DISABLED, MIRRORING vault-recovery-show. The { secret, keyId } arrive in the
  // channel-3 init model; both are rendered via textContent only, the secret is copied via
  // main's OS-clipboard write, and their references are DROPPED on close (never re-emitted on
  // model-replace). Escape / backdrop / window-blur must NOT close it — only the explicit
  // acknowledge (the secret is unrecoverable): the entry carries dismissible:false and
  // attachModalCard is wired dismissible:false (Escape/backdrop inert; Tab still traps).

  const accessKey = buildVaultAccessKeyCard(document);
  const accessKeyNode = accessKey.node;
  root.appendChild(accessKeyNode);

  /** @type {string | null} the minted secret currently displayed — dropped on close. */
  let accessKeySecret = null;

  const accessKeyEntry = menuController.register({
    trigger: accessKeyNode,
    menu: accessKeyNode,
    dismissible: false, // DD5 — the menu-controller blur/outside-click guards skip it
    // no `items` — roving no-ops; Tab-cycling is the modal-card helper below.
    onOpen() {
      accessKeyNode.classList.remove('hidden');
      accessKey.secretValue.focus();
    },
    onClose() {
      accessKeyNode.classList.add('hidden');
      // Drop the secret reference + scrub the DOM text — never retained past the display.
      accessKey.secretValue.textContent = '';
      accessKey.keyIdValue.textContent = '';
      accessKeySecret = null;
      reportDismissed();
    },
    focusReturn: () => {}
  });

  accessKey.copy.addEventListener('click', () => {
    if (accessKeySecret) window.menuOverlay.copyText(accessKeySecret);
  });
  accessKey.acknowledge.addEventListener('click', () => {
    // The deliberate close — activation (id:'ack') suppresses the trailing dismissed and
    // drives main to close the sheet. This is the ONLY path that closes accesskey-show.
    if (sendActivatedOnce({ id: 'ack' })) menuController.close(accessKeyEntry);
  });
  attachModalCard({
    node: accessKeyNode,
    getCycle: () => [accessKey.keyIdValue, accessKey.secretValue, accessKey.copy, accessKey.acknowledge],
    dismissible: false,
    close: () => {}, // dismiss-disabled — Escape/backdrop never close (see above)
  });

  /** Render the minted secret + keyId into the read-only displays (textContent only) + stash
   * the secret for Copy. Re-reads the model each init, so a model-replace never re-emits a
   * stale secret.
   * @param {any} model */
  function renderAccessKey(model) {
    accessKeySecret = model && typeof model.secret === 'string' ? model.secret : '';
    accessKey.secretValue.textContent = accessKeySecret || '';
    accessKey.keyIdValue.textContent = model && typeof model.keyId === 'string' ? model.keyId : '';
  }

  /* -------------------------------------------- template: vault-adminkey-show */
  // ONE-TIME minted-admin-key display (M12 F4 Leg 3 admin-key-provision, DD4) — read-only and
  // DISMISS-DISABLED, MIRRORING vault-accesskey-show. The { adminPrivateKey } arrives in the
  // channel-3 init model; it is rendered via textContent only, copied via main's OS-clipboard
  // write, and its reference is DROPPED on close (never re-emitted on model-replace). Escape /
  // backdrop / window-blur must NOT close it — only the explicit acknowledge (the private key is
  // unrecoverable): the entry carries dismissible:false and attachModalCard is wired
  // dismissible:false (Escape/backdrop inert; Tab still traps).

  const adminKey = buildVaultAdminKeyCard(document);
  const adminKeyNode = adminKey.node;
  root.appendChild(adminKeyNode);

  /** @type {string | null} the minted admin private key currently displayed — dropped on close. */
  let adminKeySecret = null;

  const adminKeyEntry = menuController.register({
    trigger: adminKeyNode,
    menu: adminKeyNode,
    dismissible: false, // DD4 — the menu-controller blur/outside-click guards skip it
    // no `items` — roving no-ops; Tab-cycling is the modal-card helper below.
    onOpen() {
      adminKeyNode.classList.remove('hidden');
      adminKey.keyValue.focus();
    },
    onClose() {
      adminKeyNode.classList.add('hidden');
      // Drop the key reference + scrub the DOM text — never retained past the display.
      adminKey.keyValue.textContent = '';
      adminKeySecret = null;
      reportDismissed();
    },
    focusReturn: () => {}
  });

  adminKey.copy.addEventListener('click', () => {
    if (adminKeySecret) window.menuOverlay.copyText(adminKeySecret);
  });
  adminKey.acknowledge.addEventListener('click', () => {
    // The deliberate close — activation (id:'ack') suppresses the trailing dismissed and
    // drives main to close the sheet. This is the ONLY path that closes adminkey-show.
    if (sendActivatedOnce({ id: 'ack' })) menuController.close(adminKeyEntry);
  });
  attachModalCard({
    node: adminKeyNode,
    getCycle: () => [adminKey.keyValue, adminKey.copy, adminKey.acknowledge],
    dismissible: false,
    close: () => {}, // dismiss-disabled — Escape/backdrop never close (see above)
  });

  /** Render the minted admin private key into the read-only display (textContent only) + stash
   * it for Copy. Re-reads the model each init, so a model-replace never re-emits a stale key.
   * @param {any} model */
  function renderAdminKey(model) {
    adminKeySecret = model && typeof model.adminPrivateKey === 'string' ? model.adminPrivateKey : '';
    adminKey.keyValue.textContent = adminKeySecret || '';
  }

  /* -------------------------------------------------------- template: vault-import */
  // Import-bundle secret entry (M12 F4 Leg 1 export-import, DD1/DD2) — a dialog-style card
  // on the shared modal-card helper, MIRRORING vault-stepup but adding a `secretKind` radio
  // toggle (master password | recovery key). The single secret submits as a Uint8Array over
  // the DEDICATED menu-overlay:vault-import Buffer channel, carrying the chosen secretKind —
  // NEVER channel-4 sendActivated. The destination target + the bundle are held MAIN-SIDE
  // (never on this sheet). The sheet awaits { ok }: false → stay open + show the error (wrong
  // secret re-prompts); true → close (main runs the re-key / fresh-profile adopt).

  const vaultImport = buildVaultImportCard(document);
  const vaultImportNode = vaultImport.node;
  root.appendChild(vaultImportNode);

  // Guards a concurrent submit (double-Enter / Enter+click); reset on every open.
  let vaultImportBusy = false;

  const vaultImportEntry = menuController.register({
    trigger: vaultImportNode,
    menu: vaultImportNode,
    // no `items` — roving no-ops; Tab-cycling + Escape are the modal-card helper below.
    onOpen() {
      vaultImport.input.value = '';
      vaultImport.error.textContent = '';
      vaultImport.masterRadio.checked = true; // default to master password each open.
      vaultImport.recoveryRadio.checked = false;
      vaultImportBusy = false;
      vaultImportNode.classList.remove('hidden');
      vaultImport.input.focus();
    },
    onClose() {
      vaultImportNode.classList.add('hidden');
      // Scrub the field's DOM value on close (best-effort — the input V8 strings themselves
      // are unscrubbable, the accepted DD4 limitation).
      vaultImport.input.value = '';
      reportDismissed();
    },
    focusReturn: () => {}
  });

  // Submit → the DEDICATED vault-import channel. Client-side: empty guard only. Read the
  // secretKind from the checked radio, encode the secret to a Uint8Array (never a JS string
  // on the wire), invoke, act on { ok }. The sheet-side copy is zeroized after the round-trip;
  // main zeroizes its own Buffer copy + the transferred array (dual-zeroize).
  async function submitVaultImport() {
    if (report.sent || report.token == null || vaultImportBusy) return;
    const value = vaultImport.input.value;
    if (!value) {
      vaultImport.error.textContent = 'Enter the master password or recovery key';
      vaultImport.input.focus();
      return;
    }
    const token = report.token;
    const secretKind = vaultImport.recoveryRadio.checked ? 'recovery' : 'master';
    const secret = new TextEncoder().encode(value);
    vaultImportBusy = true;
    let res;
    try {
      res = await window.menuOverlay.importVault({ token, secret, secretKind });
    } catch {
      // A rejected invoke degrades to an inline error, not a crash.
      res = { ok: false };
    } finally {
      vaultImportBusy = false;
      secret.fill(0);
    }
    // Stale-resolution guard: a supersede / model-replace during the await moved the live
    // token; a late result must not act on the new menu.
    if (report.token !== token || report.sent) return;
    if (res && res.ok) {
      report.sent = true; // suppress the trailing dismissed; main closes the sheet.
      menuController.close(vaultImportEntry);
    } else if (res && res.reason === 'collision') {
      // M12 F5 HAT tail (review HIGH-1 / MEDIUM-4): a destination COLLISION is not a secret
      // failure — surface a truthful, FIXED string (never echo the store message, which embeds the
      // destination/jar id). Defense-in-depth: the page's upfront Replace-existing checkbox makes a
      // sheet-level collision normally unreachable, but a rare race can still land here.
      vaultImport.error.textContent = 'A vault already exists at the destination.';
      vaultImport.input.value = '';
      vaultImport.input.focus();
    } else {
      vaultImport.error.textContent = 'Could not open the bundle. Check the secret and type.';
      vaultImport.input.value = '';
      vaultImport.input.focus();
    }
  }

  vaultImport.submit.addEventListener('click', () => { void submitVaultImport(); });
  vaultImport.cancel.addEventListener('click', () => {
    report.lastStimulus = 'escape';
    menuController.close(vaultImportEntry);
  });
  vaultImport.input.addEventListener('keydown', (/** @type {any} */ e) => {
    if (e.key === 'Enter') { e.preventDefault(); void submitVaultImport(); }
  });
  attachModalCard({
    node: vaultImportNode,
    getCycle: () => [
      vaultImport.masterRadio, vaultImport.recoveryRadio, vaultImport.input,
      vaultImport.submit, vaultImport.cancel,
    ],
    close: (stimulus) => { report.lastStimulus = stimulus; menuController.close(vaultImportEntry); },
  });

  /* -------------------------------------------------- template: vault-change-master */
  // Master-password CHANGE entry (M12 F4 Leg 2 key-rotation, DD3/DD2) — a dialog-style card on
  // the shared modal-card helper, MIRRORING vault-set but with THREE fields: old-password (the
  // step-up), new-password, and confirm. The confirm === new check is CLIENT-SIDE; only the OLD
  // + NEW secrets submit as Uint8Arrays over the DEDICATED menu-overlay:vault-change-master
  // Buffer channel — NEVER channel-4 sendActivated. The sheet awaits { ok }: false → stay open +
  // show the error (a WRONG old password re-prompts); true → close (there is no one-time display
  // — the new master password is operator-chosen).

  const vaultChangeMaster = buildVaultChangeMasterCard(document);
  const vaultChangeMasterNode = vaultChangeMaster.node;
  root.appendChild(vaultChangeMasterNode);

  // Guards a concurrent submit (double-Enter / Enter+click); reset on every open.
  let vaultChangeMasterBusy = false;

  const vaultChangeMasterEntry = menuController.register({
    trigger: vaultChangeMasterNode,
    menu: vaultChangeMasterNode,
    onOpen() {
      vaultChangeMaster.oldInput.value = '';
      vaultChangeMaster.newInput.value = '';
      vaultChangeMaster.confirm.value = '';
      vaultChangeMaster.error.textContent = '';
      vaultChangeMasterBusy = false;
      vaultChangeMasterNode.classList.remove('hidden');
      vaultChangeMaster.oldInput.focus();
    },
    onClose() {
      vaultChangeMasterNode.classList.add('hidden');
      // Scrub the field DOM values on close (best-effort — the input V8 strings are unscrubbable,
      // the accepted DD4 limitation).
      vaultChangeMaster.oldInput.value = '';
      vaultChangeMaster.newInput.value = '';
      vaultChangeMaster.confirm.value = '';
      reportDismissed();
    },
    focusReturn: () => {}
  });

  // Submit → the DEDICATED change-master channel. Client-side: empty guards + confirm-MATCH check
  // (NO invoke on an empty field / mismatch). Encode BOTH secrets to Uint8Arrays (never a JS
  // string on the wire), invoke, act on { ok }. The sheet-side copies are zeroized after the
  // round-trip; main zeroizes its own Buffer copies + the transferred arrays (dual-zeroize).
  async function submitVaultChangeMaster() {
    if (report.sent || report.token == null || vaultChangeMasterBusy) return;
    const oldValue = vaultChangeMaster.oldInput.value;
    const newValue = vaultChangeMaster.newInput.value;
    if (!oldValue) {
      vaultChangeMaster.error.textContent = 'Enter your current master password';
      vaultChangeMaster.oldInput.focus();
      return;
    }
    if (!newValue) {
      vaultChangeMaster.error.textContent = 'Choose a new master password';
      vaultChangeMaster.newInput.focus();
      return;
    }
    if (newValue !== vaultChangeMaster.confirm.value) {
      vaultChangeMaster.error.textContent = 'New passwords do not match';
      vaultChangeMaster.confirm.focus();
      return;
    }
    const token = report.token;
    const oldSecret = new TextEncoder().encode(oldValue);
    const newSecret = new TextEncoder().encode(newValue);
    vaultChangeMasterBusy = true;
    let res;
    try {
      res = await window.menuOverlay.changeMaster({ token, oldSecret, newSecret });
    } catch {
      res = { ok: false };
    } finally {
      vaultChangeMasterBusy = false;
      oldSecret.fill(0);
      newSecret.fill(0);
    }
    if (report.token !== token || report.sent) return;
    if (res && res.ok) {
      report.sent = true; // suppress the trailing dismissed; main closes the sheet.
      menuController.close(vaultChangeMasterEntry);
    } else {
      vaultChangeMaster.error.textContent = 'Wrong current master password. Nothing was changed.';
      vaultChangeMaster.oldInput.value = '';
      vaultChangeMaster.oldInput.focus();
    }
  }

  vaultChangeMaster.submit.addEventListener('click', () => { void submitVaultChangeMaster(); });
  vaultChangeMaster.cancel.addEventListener('click', () => {
    report.lastStimulus = 'escape';
    menuController.close(vaultChangeMasterEntry);
  });
  const vaultChangeMasterEnter = (/** @type {any} */ e) => {
    if (e.key === 'Enter') { e.preventDefault(); void submitVaultChangeMaster(); }
  };
  vaultChangeMaster.oldInput.addEventListener('keydown', vaultChangeMasterEnter);
  vaultChangeMaster.newInput.addEventListener('keydown', vaultChangeMasterEnter);
  vaultChangeMaster.confirm.addEventListener('keydown', vaultChangeMasterEnter);
  attachModalCard({
    node: vaultChangeMasterNode,
    getCycle: () => [
      vaultChangeMaster.oldInput, vaultChangeMaster.newInput, vaultChangeMaster.confirm,
      vaultChangeMaster.submit, vaultChangeMaster.cancel,
    ],
    close: (stimulus) => { report.lastStimulus = stimulus; menuController.close(vaultChangeMasterEntry); },
  });

  /* --------------------------------------------------------- template: vault-recover */
  // RECOVER-after-forgotten-master entry (M12 F4 Leg 2 key-rotation, DD3/DD2) — a dialog-style
  // card on the shared modal-card helper, MIRRORING vault-change-master but with a RECOVERY-KEY
  // field (the step-up — master-equivalent proof) in place of the old-password field. The
  // confirm === new check is CLIENT-SIDE; only the RECOVERY + NEW secrets submit as Uint8Arrays
  // over the DEDICATED menu-overlay:vault-recover Buffer channel — NEVER channel-4 sendActivated.
  // The sheet awaits { ok }: false → stay open + show the error (a WRONG recovery key re-prompts);
  // true → close (the store installs the MRK → the page moves to unlocked off the lock-state
  // broadcast). Works FROM the LOCKED state (the recovery key is its own step-up).

  const vaultRecover = buildVaultRecoverCard(document);
  const vaultRecoverNode = vaultRecover.node;
  root.appendChild(vaultRecoverNode);

  // Guards a concurrent submit (double-Enter / Enter+click); reset on every open.
  let vaultRecoverBusy = false;

  const vaultRecoverEntry = menuController.register({
    trigger: vaultRecoverNode,
    menu: vaultRecoverNode,
    onOpen() {
      vaultRecover.recoveryInput.value = '';
      vaultRecover.newInput.value = '';
      vaultRecover.confirm.value = '';
      vaultRecover.error.textContent = '';
      vaultRecoverBusy = false;
      vaultRecoverNode.classList.remove('hidden');
      vaultRecover.recoveryInput.focus();
    },
    onClose() {
      vaultRecoverNode.classList.add('hidden');
      vaultRecover.recoveryInput.value = '';
      vaultRecover.newInput.value = '';
      vaultRecover.confirm.value = '';
      reportDismissed();
    },
    focusReturn: () => {}
  });

  // Submit → the DEDICATED recover channel. Client-side: empty guards + confirm-MATCH check.
  // Encode BOTH secrets to Uint8Arrays (never a JS string on the wire), invoke, act on { ok }.
  // The sheet-side copies are zeroized after the round-trip; main zeroizes its own Buffer copies
  // + the transferred arrays (dual-zeroize).
  async function submitVaultRecover() {
    if (report.sent || report.token == null || vaultRecoverBusy) return;
    const recoveryValue = vaultRecover.recoveryInput.value;
    const newValue = vaultRecover.newInput.value;
    if (!recoveryValue) {
      vaultRecover.error.textContent = 'Enter your recovery key';
      vaultRecover.recoveryInput.focus();
      return;
    }
    if (!newValue) {
      vaultRecover.error.textContent = 'Choose a new master password';
      vaultRecover.newInput.focus();
      return;
    }
    if (newValue !== vaultRecover.confirm.value) {
      vaultRecover.error.textContent = 'New passwords do not match';
      vaultRecover.confirm.focus();
      return;
    }
    const token = report.token;
    const recoverySecret = new TextEncoder().encode(recoveryValue);
    const newSecret = new TextEncoder().encode(newValue);
    vaultRecoverBusy = true;
    let res;
    try {
      res = await window.menuOverlay.recoverMaster({ token, recoverySecret, newSecret });
    } catch {
      res = { ok: false };
    } finally {
      vaultRecoverBusy = false;
      recoverySecret.fill(0);
      newSecret.fill(0);
    }
    if (report.token !== token || report.sent) return;
    if (res && res.ok) {
      report.sent = true; // suppress the trailing dismissed; main closes the sheet.
      menuController.close(vaultRecoverEntry);
    } else {
      vaultRecover.error.textContent = 'Wrong recovery key. Nothing was changed.';
      vaultRecover.recoveryInput.value = '';
      vaultRecover.recoveryInput.focus();
    }
  }

  vaultRecover.submit.addEventListener('click', () => { void submitVaultRecover(); });
  vaultRecover.cancel.addEventListener('click', () => {
    report.lastStimulus = 'escape';
    menuController.close(vaultRecoverEntry);
  });
  const vaultRecoverEnter = (/** @type {any} */ e) => {
    if (e.key === 'Enter') { e.preventDefault(); void submitVaultRecover(); }
  };
  vaultRecover.recoveryInput.addEventListener('keydown', vaultRecoverEnter);
  vaultRecover.newInput.addEventListener('keydown', vaultRecoverEnter);
  vaultRecover.confirm.addEventListener('keydown', vaultRecoverEnter);
  attachModalCard({
    node: vaultRecoverNode,
    getCycle: () => [
      vaultRecover.recoveryInput, vaultRecover.newInput, vaultRecover.confirm,
      vaultRecover.submit, vaultRecover.cancel,
    ],
    close: (stimulus) => { report.lastStimulus = stimulus; menuController.close(vaultRecoverEntry); },
  });

  /* ----------------------------------------------------------- template: downloads */
  // Downloads popup (M11 Flight 1 Leg 3, DD2/DD3): a role="dialog" list of the
  // current/recent downloads in the latest chrome-owned model. The sheet remains
  // presentation-only: while open, progress/terminal events replace or update
  // that model; the sheet owns no download state. COMPLETED rows render a
  // filename button (dl:open:<id>) + a folder-reveal button (dl:folder:<id>);
  // IN-PROGRESS rows render the filename as non-interactive text + a progress
  // indicator with NO action buttons (so an in-progress item is inherently not
  // openable — cleaner than a disabled button, and it avoids a disabled-first-
  // button focus trap). A footer button (dl:page) is ALWAYS present, so
  // onOpen's querySelector('button') always lands on an enabled control even when
  // every row is in-progress. Registered WITHOUT an items getter (the controller's
  // roving no-ops — the chrome-popup regime, like info-popup); the local keydown
  // owns Escape (close) and Tab/Shift+Tab (CYCLE focus through the keyboard-
  // scrollable list and enabled buttons — the dialog must not close on Tab).

  const downloadsNode = document.createElement('div');
  downloadsNode.id = 'sheet-downloads';
  downloadsNode.setAttribute('role', 'dialog');
  downloadsNode.tabIndex = -1;
  downloadsNode.classList.add('hidden');
  root.appendChild(downloadsNode);

  const DOWNLOADS_LABELS = { downloads: 'Downloads' };

  const downloadsEntry = menuController.register({
    trigger: downloadsNode,
    menu: downloadsNode,
    // no `items` — roving no-ops (controller guard); the local keydown owns Tab.
    onOpen() {
      downloadsNode.classList.remove('hidden');
      // Focus the first button (a completed row's filename, or — when every row is
      // in-progress — the always-present footer). querySelector('button') is safe:
      // only completed rows and the footer render buttons, all enabled.
      (downloadsNode.querySelector('button') || downloadsNode).focus();
    },
    onClose() {
      downloadsNode.classList.add('hidden');
      reportDismissed();
    },
    focusReturn: () => {}
  });

  // Local keydown: Escape → dismiss (escape flavor); Tab/Shift+Tab → cycle focus
  // through the list scroll region + enabled buttons (NO dismissal, NO
  // lastStimulus write on Tab). The controller's menu-keydown no-ops
  // (!entry.items), so this listener owns both keys.
  downloadsNode.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      report.lastStimulus = 'escape';
      menuController.close(downloadsEntry);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const cycle = /** @type {HTMLElement[]} */ ([...downloadsNode.querySelectorAll('.dl-list, button')]);
      if (!cycle.length) return;
      const i = cycle.indexOf(/** @type {any} */ (document.activeElement));
      const n = (i + (e.shiftKey ? -1 : 1) + cycle.length) % cycle.length;
      cycle[n].focus();
    }
  });

  /** Folder-reveal icon (Lucide folder, ISC) built via createElementNS — no
   * innerHTML, and it is aria-hidden (the button's aria-label carries the name).
   * @returns {SVGElement} */
  function folderIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '15');
    svg.setAttribute('height', '15');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z');
    svg.appendChild(p);
    return svg;
  }

  /** Progress label for an in-progress row (WORDS, not color alone).
   * @param {any} item @returns {string} */
  function downloadProgressText(item) {
    if (item.paused) return 'Paused';
    const total = item.total;
    const received = item.received;
    if (typeof total === 'number' && total > 0 && typeof received === 'number') {
      return Math.min(100, Math.max(0, Math.floor((received / total) * 100))) + '%';
    }
    return 'In progress';
  }

  /** Build a decorative progress bar element for an in-progress row (Leg 4,
   * Option 1). aria-hidden — the row's progress TEXT is the AT-facing state
   * carrier (avoids a chatty live progressbar role in a dialog). Structure:
   * `<div class="dl-bar" aria-hidden="true"><span></span></div>` — the inner
   * span's inline width is the only thing mutated per update.
   * @param {any} item @returns {HTMLElement} */
  function buildProgressBar(item) {
    const bar = document.createElement('div');
    bar.className = 'dl-bar';
    bar.setAttribute('aria-hidden', 'true');
    bar.appendChild(document.createElement('span'));
    applyProgressBar(bar, item);
    return bar;
  }

  /** Apply an item's progress to an existing bar element IN PLACE (shared by
   * initial render and the in-place update path). Known received/total → the
   * inner span's width = the fraction (clamped 0-100%). Unknown/zero total →
   * `.dl-bar-indeterminate` (CSS-driven sweep animation). Paused freezes the
   * bar "for free": received/total stop changing while paused, so re-applying
   * the same fraction repaints the same width; `.dl-bar-paused` additionally
   * halts the indeterminate sweep so a paused-with-unknown-total row doesn't
   * keep animating as if still downloading.
   * @param {HTMLElement} bar @param {any} item */
  function applyProgressBar(bar, item) {
    const fill = /** @type {HTMLElement | null} */ (bar.firstElementChild);
    const total = item.total;
    const received = item.received;
    const known = typeof total === 'number' && total > 0 && typeof received === 'number';
    bar.classList.toggle('dl-bar-indeterminate', !known);
    bar.classList.toggle('dl-bar-paused', !!item.paused);
    if (fill) fill.style.width = known ? Math.min(100, Math.max(0, (received / total) * 100)) + '%' : '';
  }

  /** Structural-change predicate (Leg 4, Option 1): true iff the CURRENT
   * rendered rows carry the exact same ordered (id, completed) pairs as the
   * incoming model — the update-vs-rebuild decision. A mismatch (a download
   * completed and gained buttons, or one appeared/vanished) returns false so
   * the caller falls through to the normal rebuild-and-reopen path.
   * @param {any[]} model @returns {boolean} */
  function sameDownloadsStructure(model) {
    if (!Array.isArray(model)) return false;
    const rows = /** @type {HTMLElement[]} */ ([...downloadsNode.querySelectorAll('.dl-row')]);
    if (rows.length !== model.length) return false;
    for (let i = 0; i < rows.length; i++) {
      const item = model[i];
      if (!item || typeof item.id !== 'number') return false;
      if (rows[i].dataset.id !== String(item.id)) return false;
      if (rows[i].dataset.completed !== String(!!item.completed)) return false;
    }
    return true;
  }

  /** In-place update (Leg 4, Option 1): walks the EXISTING `.dl-row`s (same
   * order as the model — guaranteed by sameDownloadsStructure having just
   * passed) and rewrites only each in-progress row's progress text + bar.
   * Completed rows are untouched (their buttons never change once completed).
   * No DOM removal/creation, no closeAll, no onOpen — focus/Tab position and
   * the sheet's open/hidden state are all left exactly as they were.
   * @param {any[]} model */
  function updateDownloads(model) {
    const rows = /** @type {HTMLElement[]} */ ([...downloadsNode.querySelectorAll('.dl-row')]);
    for (let i = 0; i < rows.length; i++) {
      const item = model[i];
      if (!item || item.completed) continue; // completed rows carry no live fields
      const row = rows[i];
      const progressEl = row.querySelector('.dl-progress');
      if (progressEl) progressEl.textContent = downloadProgressText(item);
      const bar = /** @type {HTMLElement | null} */ (row.querySelector('.dl-bar'));
      if (bar) applyProgressBar(bar, item);
    }
  }

  /** Render the downloads list from the current chrome model (a flat item array).
   * All filenames via textContent (DD8 — untrusted / RTL / long names; CSS
   * ellipsis handles length).
   * @param {string} menuType @param {any[]} model @param {any} anchor */
  function renderDownloads(menuType, model, anchor) {
    downloadsNode.textContent = '';
    downloadsNode.dataset.menuType = menuType;
    downloadsNode.setAttribute('aria-label', DOWNLOADS_LABELS[menuType] || 'Downloads');
    const list = document.createElement('div');
    list.className = 'dl-list';
    list.tabIndex = 0;
    list.setAttribute('role', 'region');
    list.setAttribute('aria-label', 'Download items');
    downloadsNode.appendChild(list);
    for (const item of model) {
      if (!item || typeof item.id !== 'number') continue;
      const row = document.createElement('div');
      row.className = 'dl-row';
      if (item.completed) {
        // Completed: filename button (open) + folder-reveal button.
        const name = document.createElement('button');
        name.className = 'dl-name';
        name.type = 'button';
        name.textContent = String(item.filename != null ? item.filename : '');
        name.addEventListener('click', () => {
          if (sendActivatedOnce({ id: 'dl:open:' + item.id })) menuController.close(downloadsEntry);
        });
        const folder = document.createElement('button');
        folder.className = 'dl-folder';
        folder.type = 'button';
        folder.setAttribute('aria-label', 'Show in folder');
        folder.appendChild(folderIcon());
        folder.addEventListener('click', () => {
          if (sendActivatedOnce({ id: 'dl:folder:' + item.id })) menuController.close(downloadsEntry);
        });
        row.append(name, folder);
      } else {
        // In-progress: filename as NON-INTERACTIVE text + progress + a decorative
        // live-updating bar (Leg 4, Option 1). The bar is aria-hidden — the
        // adjacent progress text (WORDS, not the bar alone) already carries the
        // state to AT (a live progressbar role in a dialog would be chatty).
        const name = document.createElement('span');
        name.className = 'dl-name';
        name.textContent = String(item.filename != null ? item.filename : '');
        const progress = document.createElement('span');
        progress.className = 'dl-progress';
        progress.textContent = downloadProgressText(item);
        const bar = buildProgressBar(item);
        row.append(name, bar, progress);
      }
      // Structural fingerprint (Leg 4): id + completed-flag, read back by
      // sameDownloadsStructure() to decide update-in-place vs. rebuild.
      row.dataset.id = String(item.id);
      row.dataset.completed = String(!!item.completed);
      list.appendChild(row);
    }
    // Footer is ALWAYS a button (the enabled-first-button guarantee for onOpen).
    const footer = document.createElement('button');
    footer.className = 'dl-footer';
    footer.type = 'button';
    footer.textContent = 'Open downloads page';
    footer.addEventListener('click', () => {
      if (sendActivatedOnce({ id: 'dl:page' })) menuController.close(downloadsEntry);
    });
    downloadsNode.appendChild(footer);
    // Unhide before positioning (point/align clamps measure the node).
    downloadsNode.classList.remove('hidden');
    positionNode(downloadsNode, anchor);
  }

  /* ----------------------------------------------------- registry + init dispatch */

  /** @type {{ [menuType: string]: 'menu' | 'info-popup' | 'input-dialog' | 'suggestions' | 'downloads' | 'vault-unlock' | 'vault-picker' | 'vault-capture' | 'vault-set' | 'vault-recovery-show' | 'vault-stepup' | 'vault-accesskey-show' | 'vault-import' | 'vault-change-master' | 'vault-recover' | 'vault-adminkey-show' }} */
  const TEMPLATES = {
    kebab: 'menu',
    container: 'menu',
    'page-context': 'menu', // Leg 4 — point-anchored, separator/note item types
    'site-info': 'info-popup',
    'new-container': 'input-dialog',
    'vault-unlock': 'vault-unlock', // M12 F2 Leg 2 — the FIFTH kind (see above)
    'vault-picker': 'vault-picker', // M12 F2 Leg 3 — the SIXTH kind (see above)
    'vault-capture': 'vault-capture', // M12 F2 Leg 4 — the SEVENTH kind (see above)
    'vault-set': 'vault-set', // M12 F3 Leg 4 — the EIGHTH kind (first-run setup)
    'vault-recovery-show': 'vault-recovery-show', // M12 F3 Leg 4 — the NINTH kind (dismiss-disabled)
    'vault-stepup': 'vault-stepup', // M12 F3 Leg 5 — the TENTH kind (access-key mint step-up)
    'vault-accesskey-show': 'vault-accesskey-show', // M12 F3 Leg 5 — the ELEVENTH kind (dismiss-disabled)
    'vault-import-unlock': 'vault-import', // M12 F4 Leg 1 — the TWELFTH kind (import-bundle secret entry)
    'vault-change-master': 'vault-change-master', // M12 F4 Leg 2 — the THIRTEENTH kind (master-pw change)
    'vault-recover': 'vault-recover', // M12 F4 Leg 2 — the FOURTEENTH kind (recover-after-forgotten-master)
    'vault-adminkey-show': 'vault-adminkey-show', // M12 F4 Leg 3 — the FIFTEENTH kind (dismiss-disabled)
    // LOAD-BEARING (M08 Flight 4 DD2): the fallback below (`TEMPLATES[menuType] ||
    // 'menu'`) is the FOCUSING menu template — an unregistered/missing entry here
    // would silently fall into it and break the suggestions template's
    // non-focusing guarantee. The suggestions template must NEVER focus the
    // sheet — never remove this entry without an equivalent non-focusing fallback.
    suggestions: 'suggestions',
    downloads: 'downloads' // M11 Flight 1 Leg 3 — role="dialog" downloads popup
  };
  const NODE_OF_ENTRY = new Map([
    [menuEntry, menuNode],
    [popupEntry, popupNode],
    [dialogEntry, dialogNode],
    [suggestionsEntry, suggestionsNode],
    [downloadsEntry, downloadsNode],
    [vaultEntry, vaultNode],
    [pickerEntry, pickerNode],
    [captureEntry, captureNode],
    [vaultSetEntry, vaultSetNode],
    [recoveryEntry, recoveryNode],
    [vaultStepupEntry, vaultStepupNode],
    [accessKeyEntry, accessKeyNode],
    [vaultImportEntry, vaultImportNode],
    [vaultChangeMasterEntry, vaultChangeMasterNode],
    [vaultRecoverEntry, vaultRecoverNode],
    [adminKeyEntry, adminKeyNode]
  ]);

  // Capture-phase reason attribution (document capture beats the controller's
  // menu-node keydown and document-bubble pointerdown). Only meaningful while one
  // of OUR entries is the open one. Tab → 'escape' applies to the MENU template
  // only (the info-popup attributes its own Tab; the input-dialog cycles).
  document.addEventListener(
    'keydown',
    (e) => {
      const cur = menuController.current;
      if (!cur || !NODE_OF_ENTRY.has(cur)) return;
      if (e.key === 'Escape') report.lastStimulus = 'escape';
      else if (e.key === 'Tab' && (cur === menuEntry || cur === pickerEntry)) report.lastStimulus = 'escape';
    },
    true
  );
  document.addEventListener(
    'pointerdown',
    (e) => {
      const cur = menuController.current;
      const node = cur && NODE_OF_ENTRY.get(cur);
      if (!node) return;
      if (!node.contains(/** @type {Node} */ (e.target))) report.lastStimulus = 'outside-click';
    },
    true
  );

  window.menuOverlay.onInit((payload) => {
    const { menuType, model, anchor, startIndex, token } = payload || {};
    if (typeof menuType !== 'string' || typeof token !== 'number') return;
    // Template resolved BEFORE the model-shape check (M08 Flight 4 Leg 3, design
    // review): every template except `suggestions` carries a flat item array;
    // `suggestions` carries the omnibox OBJECT shape (`{items, selectedIndex,
    // emptyNote?}` — DD1). A bare `Array.isArray(model)` guard would reject that
    // object outright and the sheet would silently never render suggestions.
    const template = TEMPLATES[menuType] || 'menu';
    // `suggestions` and `vault-capture` carry an OBJECT model (the omnibox shape /
    // the capture offer `{origin, username, mode, defaultVaultId, choices, captureId}`);
    // every other template carries a flat item array. A bare Array.isArray guard would
    // reject the object and the sheet would silently never render it.
    const modelShapeOk = (template === 'suggestions' || template === 'vault-capture'
      || template === 'vault-recovery-show' || template === 'vault-stepup' || template === 'vault-accesskey-show'
      || template === 'vault-adminkey-show')
      ? model && typeof model === 'object' && !Array.isArray(model)
      : Array.isArray(model);
    if (!modelShapeOk) return;

    // In-place downloads update (Leg 4, Option 1): a repaint that arrives while
    // the downloads popup is ALREADY the open template, with an unchanged row
    // structure (sameDownloadsStructure), patches only the in-progress rows'
    // progress text + bar — checked and handled BEFORE the shared reset below,
    // so it skips closeAll()/rebuild/onOpen entirely (no hide flash, no stolen
    // focus). The new token is adopted silently (`sent` stays whatever it was —
    // false, since the dialog is still open and nothing has activated/dismissed
    // it yet). Falls through to the normal rebuild-and-reopen path when the
    // popup isn't already open OR the structure changed (a download completed,
    // appeared, or vanished — rare; full rebuild is acceptable there).
    if (template === 'downloads' && menuController.current === downloadsEntry && sameDownloadsStructure(model)) {
      report.adoptToken(token);
      updateDownloads(model);
      return;
    }

    // Silence any still-open prior render (model-replace / re-open of a persisted
    // DOM after a main-initiated close): null the token FIRST so the closing
    // entry's onClose sends nothing — the superseded menu's channel 7 was already
    // emitted by main, and a late page-side dismissed would be stale anyway.
    report.silence();
    menuController.closeAll();
    report.begin(token);

    if (template === 'menu') {
      renderMenu(menuType, model, anchor);
      // Open through the shared controller (roving tabindex + focus via focusItem;
      // startIndex −1 = last item, the trigger-ArrowUp contract).
      menuController.open(menuEntry, typeof startIndex === 'number' ? startIndex : 0);
    } else if (template === 'info-popup') {
      renderPopup(menuType, model, anchor);
      // startIndex is meaningless without items — onOpen focuses the action
      // button ("Site settings →") when present, the chrome popup's contract.
      menuController.open(popupEntry, 0);
    } else if (template === 'suggestions') {
      renderSuggestions(menuType, model, anchor);
      // startIndex is meaningless without items — onOpen focuses NOTHING (DD2).
      // Still opened through the shared controller so the global outside-click/
      // blur listeners cover this template uniformly (module header rule).
      menuController.open(suggestionsEntry, 0);
    } else if (template === 'vault-unlock') {
      // Fixed layout (password + error + Unlock/Cancel), centered via CSS — the
      // anchor is ignored, model may be empty. onOpen clears + focuses the input;
      // it must NOT fall through to the non-focusing 'menu' fallback.
      menuController.open(vaultEntry, 0);
    } else if (template === 'vault-picker') {
      // Roving list of badged credential rows, centered via CSS — the anchor is
      // ignored. Build the rows FIRST (the items getter reads them at open), then
      // open through the controller so roving/outside-click/blur apply uniformly.
      // An empty model → the non-focusable note; onOpen focuses the card instead.
      renderPicker(model);
      menuController.open(pickerEntry, typeof startIndex === 'number' ? startIndex : 0);
    } else if (template === 'vault-capture') {
      // Fixed layout (heading + origin/username + optional vault choice + Save/Cancel),
      // centered via CSS — the anchor is ignored. Render FIRST (stashes captureId +
      // choices), then open through the controller. onOpen focuses the first choice
      // (save) or Save (update); it must NOT fall through to the non-focusing fallback.
      renderCapture(model);
      menuController.open(captureEntry, 0);
    } else if (template === 'vault-set') {
      // Fixed layout (password + confirm + error + Set up/Cancel), centered via CSS — the
      // anchor is ignored, model is an empty array. onOpen clears + focuses the password
      // input; it must NOT fall through to the non-focusing 'menu' fallback.
      menuController.open(vaultSetEntry, 0);
    } else if (template === 'vault-recovery-show') {
      // Read-only, DISMISS-DISABLED one-time key display. Render FIRST (stashes the key
      // from the object model), then open through the controller. onOpen focuses the key
      // value; it must NOT fall through to the non-focusing fallback.
      renderRecovery(model);
      menuController.open(recoveryEntry, 0);
    } else if (template === 'vault-stepup') {
      // Fixed layout (password + error + Mint/Cancel), centered via CSS — the anchor is
      // ignored. Render FIRST (stashes the target vault id from the object model), then open
      // through the controller. onOpen clears + focuses the password input; it must NOT fall
      // through to the non-focusing 'menu' fallback.
      renderStepup(model);
      menuController.open(vaultStepupEntry, 0);
    } else if (template === 'vault-accesskey-show') {
      // Read-only, DISMISS-DISABLED one-time minted-secret display. Render FIRST (stashes the
      // secret + keyId from the object model), then open through the controller. onOpen
      // focuses the secret value; it must NOT fall through to the non-focusing fallback.
      renderAccessKey(model);
      menuController.open(accessKeyEntry, 0);
    } else if (template === 'vault-adminkey-show') {
      // Read-only, DISMISS-DISABLED one-time minted-admin-key display. Render FIRST (stashes the
      // private key from the object model), then open through the controller. onOpen focuses the
      // key value; it must NOT fall through to the non-focusing fallback.
      renderAdminKey(model);
      menuController.open(adminKeyEntry, 0);
    } else if (template === 'vault-import') {
      // Fixed layout (secretKind radios + secret + error + Import/Cancel), centered via CSS —
      // the anchor is ignored, model is an empty array (the destination target + the bundle
      // are held main-side). onOpen clears + resets to master + focuses the secret input; it
      // must NOT fall through to the non-focusing 'menu' fallback.
      menuController.open(vaultImportEntry, 0);
    } else if (template === 'vault-change-master') {
      // Fixed layout (old + new + confirm + error + Change/Cancel), centered via CSS — the
      // anchor is ignored, model is an empty array. onOpen clears + focuses the old-password
      // input; it must NOT fall through to the non-focusing 'menu' fallback.
      menuController.open(vaultChangeMasterEntry, 0);
    } else if (template === 'vault-recover') {
      // Fixed layout (recovery + new + confirm + error + Recover/Cancel), centered via CSS — the
      // anchor is ignored, model is an empty array. onOpen clears + focuses the recovery-key
      // input; it must NOT fall through to the non-focusing 'menu' fallback.
      menuController.open(vaultRecoverEntry, 0);
    } else if (template === 'downloads') {
      // Flat item array (modelShapeOk's non-suggestions branch). startIndex is
      // meaningless without items — onOpen focuses the first enabled button.
      renderDownloads(menuType, model, anchor);
      menuController.open(downloadsEntry, 0);
    } else {
      // input-dialog: fixed layout, model may be empty; centered via CSS —
      // the anchor is deliberately ignored.
      menuController.open(dialogEntry, 0);
    }
  });
})();
