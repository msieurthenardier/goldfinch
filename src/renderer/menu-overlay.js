// Menu-overlay sheet page script (M05 Flight 8, Legs 2-3 / M08 Flight 4 Leg 2).
// Presentation-only: receives the serialized menu model over `menu-overlay:init`
// (channel 3), renders it under #menu-root via a TEMPLATE REGISTRY keyed by
// menuType (Leg 3, suggestions added M08 F4 Leg 2 — FOUR templates now):
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
import { buildVaultPickerCard, renderVaultPickerRows, pickId } from '../shared/vault-picker-template.js';
import { buildVaultCaptureCard, renderVaultCaptureCard, selectedVaultId } from '../shared/vault-capture-template.js';

(() => {
  const root = document.getElementById('menu-root');
  if (!root || !window.menuOverlay || typeof window.menuOverlay.onInit !== 'function') return;

  /* ------------------------------------------------ shared per-open state (hoisted) */

  /** @type {number | null} */
  let currentToken = null; // the open token this render answers for (null = none)
  let sent = false; // exactly one of activated/dismissed per token — first send wins
  let lastStimulus = 'blur'; // default flavor; see header

  // Report the dismissal for the live token — UNLESS an activation already
  // reported for it (activation wins), or no token is live (silent rebuild /
  // model-replace path). Shared by every template entry's onClose.
  function reportDismissed() {
    if (!sent && currentToken != null) {
      sent = true;
      window.menuOverlay.sendDismissed({ reason: lastStimulus, token: currentToken });
    }
    lastStimulus = 'blur'; // reset after every send — see header
  }

  /** One-shot activated send (first send wins over the onClose dismissal).
   * @param {{ id: string, value?: string }} payload @returns {boolean} */
  function sendActivatedOnce(payload) {
    if (sent || currentToken == null) return false;
    sent = true;
    window.menuOverlay.sendActivated(Object.assign({}, payload, { token: currentToken }));
    return true;
  }

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
      lastStimulus = 'escape'; // Tab pinned to the escape flavor (chip refocus parity)
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
    if (sent || currentToken == null) return;
    if (!dialogInput.value.trim()) return; // whitespace-only → dialog stays open
    sent = true;
    window.menuOverlay.sendActivated({ id: 'create', value: dialogInput.value, token: currentToken });
    menuController.close(dialogEntry);
  }

  dialogCreate.addEventListener('click', submitDialog);
  // Cancel is user-explicit like Escape (design decision): dismissed{reason:'escape'}
  // → chrome returns focus to the ▾ trigger.
  dialogCancel.addEventListener('click', () => {
    lastStimulus = 'escape';
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
      lastStimulus = 'escape';
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
      lastStimulus = 'outside-click';
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
    if (sent || currentToken == null || vaultBusy) return;
    const value = vaultInput.value;
    if (!value) {
      // Empty → inline hint, stay open, no invoke (page-side no-op, like the
      // input-dialog's whitespace guard).
      vaultError.textContent = 'Enter your master password';
      vaultInput.focus();
      return;
    }
    const token = currentToken;
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
    if (currentToken !== token || sent) return;
    if (res && res.ok) {
      sent = true; // suppress the trailing dismissed; main also closes the sheet.
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
    lastStimulus = 'escape';
    menuController.close(vaultEntry);
  });
  vaultInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitVault();
    }
  });
  // Dialog-local keydown: Escape dismisses (escape flavor); Tab/Shift+Tab cycle
  // the three focusables (input → Unlock → Cancel → input) — a dialog-local trap.
  // The controller's menu-keydown no-ops (!entry.items), so this listener owns both.
  vaultNode.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      lastStimulus = 'escape';
      menuController.close(vaultEntry);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const cycle = [vaultInput, vaultUnlockBtn, vaultCancelBtn];
      const i = cycle.indexOf(/** @type {any} */ (document.activeElement));
      const n = (i + (e.shiftKey ? -1 : 1) + cycle.length) % cycle.length;
      cycle[n].focus();
    }
  });
  // Backdrop click (outside the card) dismisses — parity with input-dialog.
  vaultNode.addEventListener('click', (e) => {
    if (e.target === vaultNode) {
      lastStimulus = 'outside-click';
      menuController.close(vaultEntry);
    }
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
    pickerRows.forEach((btn, i) => {
      btn.addEventListener('click', () => {
        // Index selection — activation wins over the onClose dismissal (one report
        // per token). The password is NEVER on this path; `pick:<i>` is an index.
        if (sendActivatedOnce({ id: pickId(i) })) menuController.close(pickerEntry);
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
      lastStimulus = 'outside-click';
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
    if (sent || currentToken == null || captureBusy || captureCaptureId == null) return;
    const token = currentToken;
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
    if (currentToken !== token || sent) return;
    if (res && res.saved) {
      sent = true; // suppress the trailing dismissed; main also closes the sheet.
      menuController.close(captureEntry);
    } else {
      capture.error.textContent = res && res.reason === 'locked'
        ? 'The manager locked — unlock it and try again'
        : 'Couldn’t save the password';
    }
  }

  capture.save.addEventListener('click', () => { void submitCapture(); });
  capture.cancel.addEventListener('click', () => {
    lastStimulus = 'escape';
    menuController.close(captureEntry);
  });
  // Dialog-local keydown: Escape dismisses (escape flavor); Tab/Shift+Tab cycle the
  // focusables (choice radios → Save → Cancel). The controller's menu-keydown no-ops
  // (!entry.items), so this listener owns both — parity with vault-unlock.
  captureNode.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      lastStimulus = 'escape';
      menuController.close(captureEntry);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void submitCapture();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const cycle = [...captureChoiceInputs, capture.save, capture.cancel];
      const i = cycle.indexOf(/** @type {any} */ (document.activeElement));
      const n = (i + (e.shiftKey ? -1 : 1) + cycle.length) % cycle.length;
      cycle[n].focus();
    }
  });
  // Backdrop click (outside the card) dismisses — parity with input-dialog / vault-unlock.
  captureNode.addEventListener('click', (e) => {
    if (e.target === captureNode) {
      lastStimulus = 'outside-click';
      menuController.close(captureEntry);
    }
  });

  /** Render the capture card from the offer model + stash the captureId + choices.
   * @param {any} model */
  function renderCapture(model) {
    captureCaptureId = model && typeof model.captureId === 'string' ? model.captureId : null;
    captureDefaultVaultId = model && model.defaultVaultId;
    const { choiceInputs } = renderVaultCaptureCard(document, capture, model);
    captureChoiceInputs = choiceInputs;
  }

  /* ----------------------------------------------------- registry + init dispatch */

  /** @type {{ [menuType: string]: 'menu' | 'info-popup' | 'input-dialog' | 'suggestions' | 'vault-unlock' | 'vault-picker' | 'vault-capture' }} */
  const TEMPLATES = {
    kebab: 'menu',
    container: 'menu',
    'page-context': 'menu', // Leg 4 — point-anchored, separator/note item types
    'site-info': 'info-popup',
    'new-container': 'input-dialog',
    'vault-unlock': 'vault-unlock', // M12 F2 Leg 2 — the FIFTH kind (see above)
    'vault-picker': 'vault-picker', // M12 F2 Leg 3 — the SIXTH kind (see above)
    'vault-capture': 'vault-capture', // M12 F2 Leg 4 — the SEVENTH kind (see above)
    // LOAD-BEARING (M08 Flight 4 DD2): the fallback below (`TEMPLATES[menuType] ||
    // 'menu'`) is the FOCUSING menu template — an unregistered/missing entry here
    // would silently fall into it and break the suggestions template's
    // non-focusing guarantee. The suggestions template must NEVER focus the
    // sheet — never remove this entry without an equivalent non-focusing fallback.
    suggestions: 'suggestions'
  };
  const NODE_OF_ENTRY = new Map([
    [menuEntry, menuNode],
    [popupEntry, popupNode],
    [dialogEntry, dialogNode],
    [suggestionsEntry, suggestionsNode],
    [vaultEntry, vaultNode],
    [pickerEntry, pickerNode],
    [captureEntry, captureNode]
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
      if (e.key === 'Escape') lastStimulus = 'escape';
      else if (e.key === 'Tab' && (cur === menuEntry || cur === pickerEntry)) lastStimulus = 'escape';
    },
    true
  );
  document.addEventListener(
    'pointerdown',
    (e) => {
      const cur = menuController.current;
      const node = cur && NODE_OF_ENTRY.get(cur);
      if (!node) return;
      if (!node.contains(/** @type {Node} */ (e.target))) lastStimulus = 'outside-click';
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
    const modelShapeOk = (template === 'suggestions' || template === 'vault-capture')
      ? model && typeof model === 'object' && !Array.isArray(model)
      : Array.isArray(model);
    if (!modelShapeOk) return;

    // Silence any still-open prior render (model-replace / re-open of a persisted
    // DOM after a main-initiated close): null the token FIRST so the closing
    // entry's onClose sends nothing — the superseded menu's channel 7 was already
    // emitted by main, and a late page-side dismissed would be stale anyway.
    currentToken = null;
    menuController.closeAll();
    sent = false;
    lastStimulus = 'blur';
    currentToken = token;

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
    } else {
      // input-dialog: fixed layout, model may be empty; centered via CSS —
      // the anchor is deliberately ignored.
      menuController.open(dialogEntry, 0);
    }
  });
})();
