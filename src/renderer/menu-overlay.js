'use strict';

// Menu-overlay sheet page script (M05 Flight 8, Legs 2-3 / DD4). Presentation-only:
// receives the serialized menu model over `menu-overlay:init` (channel 3), renders
// it under #menu-root via a TEMPLATE REGISTRY keyed by menuType (Leg 3):
//
//   menu         (kebab, container)  — role="menu" item list, APG roving via the
//                                      SHARED menu-controller.js
//   info-popup   (site-info)         — note/row/action rows, NO items getter (the
//                                      controller's roving no-ops; local keydown
//                                      owns Escape/Tab — the chrome popup pattern)
//   input-dialog (new-container)     — fixed label+input+Create/Cancel layout,
//                                      centered via CSS (anchor ignored), dialog-
//                                      local Tab-cycle; model may be empty
//
// EVERY template registers a menuController entry and opens via menuController.open,
// so the controller's global pointerdown/blur listeners deliver outside-click/blur
// dismissal uniformly for all three (an unregistered dialog would dangle on
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
// <script>; isSafeColor by ../shared/safe-color.js (the SAME color domain the
// product accepts — jars.js re-exports it). Both load before this file.

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
    'page-context': 'Page actions' // parity with chrome #page-context-menu (index.html:54)
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

  /* ----------------------------------------------------- registry + init dispatch */

  /** @type {{ [menuType: string]: 'menu' | 'info-popup' | 'input-dialog' }} */
  const TEMPLATES = {
    kebab: 'menu',
    container: 'menu',
    'page-context': 'menu', // Leg 4 — point-anchored, separator/note item types
    'site-info': 'info-popup',
    'new-container': 'input-dialog'
  };
  const NODE_OF_ENTRY = new Map([
    [menuEntry, menuNode],
    [popupEntry, popupNode],
    [dialogEntry, dialogNode]
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
      else if (e.key === 'Tab' && cur === menuEntry) lastStimulus = 'escape';
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
    if (typeof menuType !== 'string' || !Array.isArray(model) || typeof token !== 'number') return;

    // Silence any still-open prior render (model-replace / re-open of a persisted
    // DOM after a main-initiated close): null the token FIRST so the closing
    // entry's onClose sends nothing — the superseded menu's channel 7 was already
    // emitted by main, and a late page-side dismissed would be stale anyway.
    currentToken = null;
    menuController.closeAll();
    sent = false;
    lastStimulus = 'blur';
    currentToken = token;

    const template = TEMPLATES[menuType] || 'menu';
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
    } else {
      // input-dialog: fixed layout, model may be empty; centered via CSS —
      // the anchor is deliberately ignored.
      menuController.open(dialogEntry, 0);
    }
  });
})();
