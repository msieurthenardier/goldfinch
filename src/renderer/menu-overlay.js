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
//                                      among the buttons — input-dialog regime);
//                                      snapshot-at-open, one-shot activation (M11
//                                      F1 Leg 3)
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

  /* ----------------------------------------------------------- template: downloads */
  // Downloads popup (M11 Flight 1 Leg 3, DD2/DD3): a role="dialog" list of the
  // current/recent downloads captured in the snapshot the chrome sent at open
  // (presentation-only, one-shot activation — no live progress push here; live
  // progress stays in the #downloads-indicator button). COMPLETED rows render a
  // filename button (dl:open:<id>) + a folder-reveal button (dl:folder:<id>);
  // IN-PROGRESS rows render the filename as non-interactive text + a progress
  // indicator with NO action buttons (so an in-progress item is inherently not
  // openable — cleaner than a disabled button, and it avoids a disabled-first-
  // button focus trap). A footer button (dl:page) is ALWAYS present, so
  // onOpen's querySelector('button') always lands on an enabled control even when
  // every row is in-progress. Registered WITHOUT an items getter (the controller's
  // roving no-ops — the chrome-popup regime, like info-popup); the local keydown
  // owns Escape (close) and Tab/Shift+Tab (CYCLE focus among the enabled buttons —
  // the input-dialog regime, a multi-button dialog must cycle, NOT close on Tab).

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
  // among the enabled buttons (input-dialog regime — NO dismissal, NO lastStimulus
  // write on Tab). The controller's menu-keydown no-ops (!entry.items), so this
  // listener owns both keys.
  downloadsNode.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      lastStimulus = 'escape';
      menuController.close(downloadsEntry);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const cycle = /** @type {HTMLElement[]} */ ([...downloadsNode.querySelectorAll('button')]);
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

  /** Render the downloads list from the open-time snapshot (a flat item array).
   * All filenames via textContent (DD8 — untrusted / RTL / long names; CSS
   * ellipsis handles length).
   * @param {string} menuType @param {any[]} model @param {any} anchor */
  function renderDownloads(menuType, model, anchor) {
    downloadsNode.textContent = '';
    downloadsNode.dataset.menuType = menuType;
    downloadsNode.setAttribute('aria-label', DOWNLOADS_LABELS[menuType] || 'Downloads');
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
      downloadsNode.appendChild(row);
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

  /** @type {{ [menuType: string]: 'menu' | 'info-popup' | 'input-dialog' | 'suggestions' | 'downloads' }} */
  const TEMPLATES = {
    kebab: 'menu',
    container: 'menu',
    'page-context': 'menu', // Leg 4 — point-anchored, separator/note item types
    'site-info': 'info-popup',
    'new-container': 'input-dialog',
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
    [downloadsEntry, downloadsNode]
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
    if (typeof menuType !== 'string' || typeof token !== 'number') return;
    // Template resolved BEFORE the model-shape check (M08 Flight 4 Leg 3, design
    // review): every template except `suggestions` carries a flat item array;
    // `suggestions` carries the omnibox OBJECT shape (`{items, selectedIndex,
    // emptyNote?}` — DD1). A bare `Array.isArray(model)` guard would reject that
    // object outright and the sheet would silently never render suggestions.
    const template = TEMPLATES[menuType] || 'menu';
    const modelShapeOk = template === 'suggestions'
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
      currentToken = token;
      updateDownloads(model);
      return;
    }

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
