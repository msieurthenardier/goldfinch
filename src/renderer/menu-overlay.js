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
import { BOOKMARK_DND_MIME, overflowDropIndexY, overflowIndicatorY } from '../shared/bookmark-drag.js';
import { buildVaultUnlockCard } from '../shared/vault-unlock-template.js';
import { buildAuthBasicCard } from '../shared/auth-basic-template.js';
import { buildBookmarkEditCard, applyBookmarkEditModel } from '../shared/bookmark-edit-template.js';
import { buildBookmarkStarIcon } from '../shared/bookmark-star-icon.js';
import {
  buildCertPickerCard,
  renderCertPickerRows,
  renderCertPickerSubtitle,
  certPickId,
  CERT_CANCEL_ID
} from '../shared/cert-picker-template.js';
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
import { createSheetReport, attachModalCard, attachBackdropPressGate } from '../shared/modal-card-controller.js';

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

  // Whether the CURRENT render opted into keep-focus (payload.keepFocus): the menu must
  // survive, and hold OS focus across, a focus steal by its own guest. Exactly one menu
  // uses it today — the unlock-to-save prompt raised when a login submit into a LOCKED
  // vault holds the credential, since that same submit navigates the page underneath it.
  // Set on every init (never left stale) and read by the vault-unlock branch + the
  // window-blur listener at the bottom of this file.
  let keepFocusMenu = false;
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
    'tab-context': 'Tab menu', // M09 Flight 5 Leg 1 — right-click / Context-Menu-key on a tab
    'bookmarks-overflow': 'More bookmarks' // M15 F1 Leg 3 — the bar's overflow chevron menu
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
      hideOverflowIndicator();
      reportDismissed();
    },
    // No-op focusReturn: trigger === menu (a now-hidden node) — Escape/Tab must
    // not try to focus it. The real refocus is main-side (focusChrome) + chrome
    // trigger focus, resolved per reason.
    focusReturn: () => {}
  });

  /* ───────────────────────── bar → overflow DROP TARGET (M15 F3 Leg 5a) ─────
   *
   * Operator session 3 MEASURED this transport: a sheet opened MID-DRAG by a
   * spring-loaded chevron received 23 dragenter / 200 dragover / 2 drop, with
   * `application/x-goldfinch-bookmark` intact across the crossing. This is the
   * receiving half. The sheet is a drop TARGET ONLY — it is deliberately NOT a
   * drag source (there is still no `draggable` anywhere in this file); the
   * reverse direction is a different, unmeasured transport and belongs to leg 5b.
   *
   * ⚠ EVERYTHING HERE IS GATED TO `bookmarks-overflow` (AC3a). `renderMenu` is
   * shared by kebab / container / page-context / tab-context, and an ungated drop
   * target or indicator would attach to all five. The per-row `contextmenu` at
   * the bottom of renderMenu is the precedent, gated exactly this way. The gate
   * reads `menuNode.dataset.menuType`, which renderMenu stamps — one source of
   * truth, no parallel state to drift.
   *
   * ⚠ THE INDICATOR IS PARENTED TO `root` (#menu-root), NOT to `menuNode`.
   * renderMenu opens with `menuNode.textContent = ''`, which would wipe a child
   * indicator on every render. #menu-root is `position: absolute; inset: 0`, so
   * it is already an absolute containing block spanning the sheet and viewport
   * coordinates need no translation. And #sheet-menu is ALREADY
   * `position: absolute` — do NOT add `position: relative` to it, that would
   * break positionNode's right/left anchoring.
   */

  const overflowIndicator = document.createElement('div');
  overflowIndicator.className = 'sheet-drop-indicator hidden';
  root.appendChild(overflowIndicator);

  const isOverflowMenu = () => menuNode.dataset.menuType === 'bookmarks-overflow';

  function hideOverflowIndicator() {
    overflowIndicator.classList.add('hidden');
  }

  /** The rendered rows' viewport rects, in snapshot order — the input to the
   * pure y-axis pair. Read live per event rather than snapshotted: the indicator
   * is absolutely positioned and out of flow (leg 3's lesson), so showing it
   * cannot move a row, and a fresh read costs nothing at drag rates. */
  function overflowRowRects() {
    return items().map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height };
    });
  }

  /** Shared gate for both drag handlers: this must be the overflow menu, and the
   * drag must be carrying OUR type. Without the MIME check the sheet would
   * `preventDefault()` every drag that crosses it — including native file and
   * link drags — exactly the mistake DD2 names for the guest side. */
  function overflowDragEvent(e) {
    if (!isOverflowMenu()) return null;
    const dt = e.dataTransfer;
    if (!dt || !dt.types || !dt.types.includes(BOOKMARK_DND_MIME)) return null;
    return dt;
  }

  menuNode.addEventListener('dragover', (e) => {
    const dt = overflowDragEvent(e);
    if (!dt) return;
    e.preventDefault(); // without this the drop is never dispatched at all
    dt.dropEffect = 'move';
    const rows = overflowRowRects();
    const index = overflowDropIndexY(rows, e.clientY);
    const y = index == null ? null : overflowIndicatorY(rows, index);
    if (y == null) {
      hideOverflowIndicator();
      return;
    }
    // Span the menu's own box so the line reads as "between these two rows"
    // rather than as a floating tick.
    const box = menuNode.getBoundingClientRect();
    overflowIndicator.style.left = `${Math.round(box.left)}px`;
    overflowIndicator.style.width = `${Math.round(box.width)}px`;
    overflowIndicator.style.top = `${Math.round(y)}px`;
    overflowIndicator.classList.remove('hidden');
  });

  // A child→child transition inside the menu also fires dragleave; only a
  // departure from the menu box itself should retract the indicator.
  menuNode.addEventListener('dragleave', (e) => {
    const related = e && e.relatedTarget;
    if (related && menuNode.contains(/** @type {Node} */ (related))) return;
    hideOverflowIndicator();
  });

  menuNode.addEventListener('drop', (e) => {
    const dt = overflowDragEvent(e);
    if (!dt) return;
    e.preventDefault();
    hideOverflowIndicator();
    // A release on the menu's PADDING rather than on a row still resolves — the
    // y-axis midpoint rule answers `rows.length` for a point below the last row,
    // which the chrome's clamp turns into "last position" (Edge Case).
    const index = overflowDropIndexY(overflowRowRects(), e.clientY);
    if (index == null) return; // unreadable geometry never spends a write
    const token = report.token;
    if (typeof token !== 'number') return; // no live open — nothing to answer for
    // Deliberately NOT sendActivatedOnce: this is not an activation, it must not
    // consume the one-report-per-token budget, and channel 4 would navigate the
    // tab (AC8). The dedicated channel carries the index and nothing else.
    window.menuOverlay.overflowDrop?.({ token, index });
  });

  /* ───────────────────────── overflow → bar DRAG SOURCE (M15 F3 Leg 5b) ─────
   *
   * The sheet's FIRST-EVER drag source. Operator session 4 MEASURED this
   * transport before a line of it was written: a drag started INSIDE the sheet
   * delivers 54 `dragover` + 1 `drop` to the chrome with
   * `application/x-goldfinch-bookmark` intact — and the sheet receives its own
   * `dragend` despite being blur-closed → `hide()` → `removeChildView` at drag
   * start, which is why the chrome's lifecycle gate has a real clear signal
   * (its timer bound is defence-in-depth, not the only recovery).
   *
   * ⚠ GATED TO `bookmarks-overflow`, like every other drag affordance here
   * (AC1). `renderMenu` is shared by kebab / container / page-context /
   * tab-context; an ungated `draggable = true` would make every menu row in the
   * app a drag source. Same single `isOverflowMenu()` predicate the drop target
   * uses — one source of truth, no parallel condition to drift.
   *
   * ⚠ WHAT THE PAYLOAD CARRIES — AC2, decided and recorded: the SNAPSHOT INDEX,
   * never a bookmark id or url. The sheet is a dumb renderer (DD9): its model is
   * `{id:'bookmark:<i>', label}` and it genuinely does not know either. The
   * asymmetry this buys, stated rather than discovered: an overflow-sourced drag
   * populates NO `text/uri-list` / `text/plain`, so dragging a row OUT of the
   * overflow menu onto a page (leg 4's path) does nothing. Bar-sourced drags are
   * unaffected — they still carry all three types.
   */

  /**
   * Make one overflow row a drag source. `rowId` is its `bookmark:<i>` model id;
   * the snapshot index parsed out of it is the only thing that crosses.
   * @param {HTMLElement} btn @param {string} rowId
   */
  function attachOverflowDragSource(btn, rowId) {
    const index = Number(rowId.slice('bookmark:'.length));
    if (!Number.isInteger(index) || index < 0) return;
    btn.draggable = true;
    /** The open token THIS gesture answers for, captured at `dragstart`.
     * Deliberately not re-read at `dragend`: the sheet is blur-closed the instant
     * the drag begins, and main's close-reset runs `report.silence()`, so
     * `report.token` is already null by then. */
    let dragToken = /** @type {number | null} */ (null);
    btn.addEventListener('dragstart', (e) => {
      const dt = e.dataTransfer;
      const token = report.token;
      // Refuse rather than start a gesture the chrome could never resolve: with
      // no token main's start gate refuses, and a source that armed anyway would
      // drag a row that commits nothing.
      if (!dt || typeof token !== 'number') {
        e.preventDefault();
        return;
      }
      dt.setData(BOOKMARK_DND_MIME, String(index));
      dt.effectAllowed = 'move';
      dragToken = token;
      // The chrome learns WHICH row from this trusted, main-gated signal — never
      // from the dataTransfer, which a hostile page could also populate with our
      // type (the DD6 "WHERE from the wire, WHAT from our own state" split, with
      // the roles swapped: here the trusted channel is the one that carries WHAT).
      window.menuOverlay.sheetDrag?.({ token, phase: 'start', index });
    });
    btn.addEventListener('dragend', () => {
      const token = dragToken;
      dragToken = null;
      if (typeof token !== 'number') return; // never armed — nothing to clear
      window.menuOverlay.sheetDrag?.({ token, phase: 'end' });
    });
  }

  /** Rebuild the menu item list from the model. Labels via textContent ONLY (DD8 —
   * the model carries guest-controlled / user-supplied strings; no markup path).
   * `color` is DATA: applied via style.background on a dedicated dot span AFTER
   * the shared isSafeColor check (the product's own color domain — jars.js);
   * invalid → the default grey dot. Property assignment cannot inject
   * sibling declarations regardless — the validation is defense-in-depth.
   * @param {string} menuType @param {any[]} model @param {any} anchor */
  function renderMenu(menuType, model, anchor) {
    menuNode.textContent = '';
    hideOverflowIndicator(); // the rows it pointed between are gone as of the line above
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
      // Per-row contextmenu (M15 F1 Leg 3, DD9 — the sheet's FIRST-EVER
      // per-row contextmenu): gated to bookmarks-overflow ONLY, so no other
      // 'menu'-family menuType (kebab/container/page-context/tab-context)
      // gets this listener. Sends a SECOND id family on the SAME channel 4
      // (`bookmark-edit:<i>`, the same index the row's own `bookmark:<i>`
      // click id carries) — no new IPC channel; id is type-checked only,
      // length-unbounded (verified).
      if (menuType === 'bookmarks-overflow' && item.id.startsWith('bookmark:')) {
        btn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const editId = 'bookmark-edit:' + item.id.slice('bookmark:'.length);
          if (sendActivatedOnce({ id: editId })) menuController.close(menuEntry);
        });
        // M15 F3 Leg 5b (AC1): …and the same rows are drag SOURCES. Gated on the
        // menuType renderMenu itself stamped a few lines above, through the one
        // named predicate the drop target already uses.
        if (isOverflowMenu()) attachOverflowDragSource(btn, item.id);
      }
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
  // HAT FIX 2 (M15 F2 Leg 4 HAT fixes — H6): press-gated via
  // attachBackdropPressGate — a text-selection drag starting inside the card
  // and releasing on the backdrop must NOT dismiss.
  attachBackdropPressGate({
    node: dialogNode,
    dismiss: () => {
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
        // M15 F1 Leg 5 HAT fix (full-height star): the primary/secondary pair
        // moves into its own column ('.sg-text') so `.sg-option` can become a
        // ROW flex container — the bookmark badge is now a real flex sibling
        // that stretches to the row's full content height (see menu-overlay.css),
        // instead of an absolutely-positioned corner chip. Non-bookmark rows are
        // unaffected: `.sg-text` reproduces the prior column layout exactly.
        const text = document.createElement('span');
        text.className = 'sg-text';
        const primary = document.createElement('span');
        primary.className = 'sg-primary';
        primary.textContent = String(item && item.primary != null ? item.primary : '');
        const secondary = document.createElement('span');
        secondary.className = 'sg-secondary';
        secondary.textContent = String(item && item.secondary != null ? item.secondary : '');
        text.append(primary, secondary);
        row.append(text);
        // M15 F1 Leg 4 (DD11): kind==='bookmark' rows get a visible badge —
        // a REAL DOM node (design review: no CSS `content:` glyph — zero
        // precedent for generated-content markers in this codebase) plus an
        // accessible description. The badge itself is `aria-hidden` so its
        // visible glyph never leaks into the option's computed accessible
        // NAME (which stays primary+secondary, matching every other row);
        // the actual accessible signal is a separate `.sr-only` text node
        // wired via `aria-describedby` — deliberately NOT `aria-label` on the
        // row, which would override the computed name outright and drop the
        // visible primary/secondary text for AT users (design review).
        // M15 F1 Leg 5 HAT fix: the badge was originally a text pill
        // (`textContent = 'Bookmark'`); operator asked for a star glyph
        // matching the address-bar star's visual idiom instead. Built via
        // the shared `buildBookmarkStarIcon` (createElementNS-only, same
        // no-innerHTML discipline as `.sg-badge`'s prior textContent form)
        // — the a11y contract above (aria-hidden badge + sr-only description)
        // is unchanged; only the visible glyph moved from text to SVG.
        if (item && item.kind === 'bookmark') {
          const badge = document.createElement('span');
          badge.className = 'sg-badge';
          badge.setAttribute('aria-hidden', 'true');
          badge.appendChild(buildBookmarkStarIcon(document));
          row.appendChild(badge);

          const descId = 'sg-bookmark-desc-' + i;
          const desc = document.createElement('span');
          desc.className = 'sr-only';
          desc.id = descId;
          desc.textContent = 'bookmark';
          row.appendChild(desc);
          row.setAttribute('aria-describedby', descId);
        }
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
  const vaultCloseBtn = vault.close;
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

  vaultUnlockBtn.addEventListener('click', () => {
    void submitVault();
  });
  // Cancel is user-explicit like Escape: dismissed{reason:'escape'} → chrome
  // returns focus to the trigger (wired by the pick-and-fill leg).
  vaultCancelBtn.addEventListener('click', () => {
    report.lastStimulus = 'escape';
    menuController.close(vaultEntry);
  });
  // Header close (X): a deliberate dismiss, same as Cancel/Escape.
  vaultCloseBtn.addEventListener('click', () => {
    report.lastStimulus = 'escape';
    menuController.close(vaultEntry);
  });
  vaultInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitVault();
    }
  });
  // Dialog-local Escape + Tab-cycle (close → input → Unlock → Cancel → close) + backdrop
  // dismiss via the SHARED, unit-tested modal-card helper (M12 F3 Leg 4, DD5 refactor). The
  // header X joins the Tab cycle so it is keyboard-reachable. dismissible defaults true.
  attachModalCard({
    node: vaultNode,
    getCycle: () => [vaultCloseBtn, vaultInput, vaultUnlockBtn, vaultCancelBtn],
    close: (stimulus) => {
      report.lastStimulus = stimulus;
      menuController.close(vaultEntry);
    }
  });

  /* --------------------------------------------------------- template: auth-basic */
  // HTTP basic-auth credential prompt (M14 F1 L2, flight DD2) — modal-card
  // family, near-cloning vault-unlock: centered backdrop + card, dialog-local
  // Tab-cycle + Escape via attachModalCard, and — critically — the password
  // leaving ONLY via the DEDICATED dual-zeroized channel
  // (menuOverlay.authSubmit), NEVER channel-4 sendActivated (string-only /
  // 24-char capped). Cancel rides channel-4 `activated` with the non-secret id
  // 'cancel' (the leg contract — an explicit resolution-family close; the
  // chrome dispatch validated-no-ops it). Host + realm arrive in the OBJECT
  // model and render via textContent only (server-controlled strings).

  const auth = buildAuthBasicCard(document);
  const authNode = auth.node;
  root.appendChild(authNode);

  let authBusy = false; // guards a concurrent submit (double-Enter / Enter+click)

  const authEntry = menuController.register({
    trigger: authNode,
    menu: authNode,
    // no `items` — roving no-ops; Tab-cycling + Escape are dialog-local below.
    onOpen() {
      auth.username.value = '';
      auth.password.value = '';
      auth.error.textContent = '';
      authBusy = false;
      authNode.classList.remove('hidden');
      auth.username.focus();
    },
    onClose() {
      authNode.classList.add('hidden');
      reportDismissed();
    },
    focusReturn: () => {}
  });

  /** Render the host + realm context line from the init model (textContent only),
   * and toggle the popup marker copy line (M14 F2 L2, DD5 — shown only when the
   * store stamped `popup: true` on the presentation payload).
   * @param {any} model */
  function renderAuthBasic(model) {
    const host = model && typeof model.host === 'string' ? model.host : '';
    const realm = model && typeof model.realm === 'string' ? model.realm : '';
    auth.origin.textContent = realm
      ? `The server ${host} says: “${realm}”`
      : `The server ${host} requires a username and password.`;
    auth.popupNote.classList.toggle('hidden', !(model && model.popup === true));
  }

  // Submit → the DEDICATED credential channel (the vault-unlock submit shape:
  // encode to a Uint8Array, invoke, zeroize the sheet-side copy in finally;
  // main zeroizes its Buffer copy + the transferred array; the inputs' V8
  // strings are unscrubbable — the accepted DD4-class limitation). Empty
  // username/password submit as empty strings — legal in basic auth.
  async function submitAuth() {
    if (report.sent || report.token == null || authBusy) return;
    const token = report.token;
    const username = auth.username.value;
    const secret = new TextEncoder().encode(auth.password.value);
    authBusy = true;
    let res;
    try {
      res = await window.menuOverlay.authSubmit({ token, username, secret });
    } catch {
      res = { answered: false }; // a rejected invoke degrades to a re-prompt
    } finally {
      authBusy = false;
      secret.fill(0);
    }
    // Stale-resolution guard: a supersede during the await moves the live token.
    if (report.token !== token || report.sent) return;
    if (res && res.answered) {
      report.sent = true; // main (the auth store) closes the sheet; suppress the trailing dismissed
      menuController.close(authEntry);
    } else {
      // The challenge vanished mid-entry (navigation/agent answer) or the
      // submit raced a close — stay open; the operator can Cancel out.
      auth.error.textContent = 'Sign-in is no longer pending for this page';
      auth.username.focus();
    }
  }

  auth.submit.addEventListener('click', () => {
    void submitAuth();
  });
  // Cancel — the leg contract: channel-4 `activated` with the NON-SECRET id
  // 'cancel' (an explicit resolution-family close; the store cancels the
  // challenge via its 'activated' bucket mapping).
  auth.cancel.addEventListener('click', () => {
    if (sendActivatedOnce({ id: 'cancel' })) menuController.close(authEntry);
  });
  // Header close (X): a deliberate dismiss, same family as Escape.
  auth.close.addEventListener('click', () => {
    report.lastStimulus = 'escape';
    menuController.close(authEntry);
  });
  const authEnterSubmits = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitAuth();
    }
  };
  auth.username.addEventListener('keydown', authEnterSubmits);
  auth.password.addEventListener('keydown', authEnterSubmits);
  attachModalCard({
    node: authNode,
    getCycle: () => [auth.close, auth.username, auth.password, auth.submit, auth.cancel],
    close: (stimulus) => {
      report.lastStimulus = stimulus;
      menuController.close(authEntry);
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
  const pickerList = picker.list; // the role="menu" roving host (rows render here)
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
    // closeAll() it mid-navigation. The roving `items` live inside pickerList; their
    // keydowns bubble up to pickerNode's menu-keydown listener (the shared APG roving
    // contract), and pickerList carries role="menu"/menuitem for a11y. Outside-click
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
      else pickerList.focus(); // empty (note) state — focus the list so Escape/Tab work
    },
    onClose() {
      pickerNode.classList.add('hidden');
      reportDismissed();
    },
    focusReturn: () => {}
  });

  // The header's close (X) is a deliberate dismiss — parity with Escape/backdrop. A mouse
  // affordance the empty state previously lacked; keyboard users still use Escape.
  picker.close.addEventListener('click', () => {
    report.lastStimulus = 'escape';
    menuController.close(pickerEntry);
  });

  /** Render the picker rows from the metadata model + wire per-row selection.
   * @param {any[]} model */
  function renderPicker(model) {
    pickerRows = renderVaultPickerRows(document, pickerList, model);
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
  // getter returning [], so arrows no-op safely). HAT FIX 2 (M15 F2 Leg 4 HAT fixes —
  // H6): press-gated via attachBackdropPressGate — a text-selection drag starting
  // inside the card and releasing on the backdrop must NOT dismiss. Deliberately NOT
  // retrofitted onto attachModalCard — the vault-picker's roving keyboard contract is
  // documented above as NOT using that helper.
  attachBackdropPressGate({
    node: pickerNode,
    dismiss: () => {
      report.lastStimulus = 'outside-click';
      menuController.close(pickerEntry);
    }
  });

  /* -------------------------------------------------------- template: cert-picker */
  // TLS client-certificate chooser (M14 F1 L3, flight DD4) — the vault-picker
  // DOM/roving-list shape (centered backdrop, role="menu" roving rows, an
  // index-carrying row id `cert:<i>`), with a deliberate ROUTING deviation:
  // the selection is resolved MAIN-SIDE in register-overlay-ipc's activated
  // handler (ledger-first against the pending-challenge store) — this sheet
  // only reports the index over channel 4, exactly like every other row. The
  // model is display strings only ({subject, issuer} per row); no certificate
  // object or secret ever reaches this sheet. The separated Cancel row rides
  // the NON-INDEX id 'cancel' — main lets it fall through to the close's
  // resolution-cancel (continue without a certificate), same as Escape.

  const certPicker = buildCertPickerCard(document);
  const certPickerNode = certPicker.node;
  const certPickerList = certPicker.list; // the role="menu" roving host
  root.appendChild(certPickerNode);

  /** @type {HTMLElement[]} */
  let certPickerRows = [];
  const certPickerItems = () => certPickerRows;

  const certPickerEntry = menuController.register({
    // trigger === menu === backdrop: opens are programmatic per init (the
    // vault-picker registration rationale applies verbatim — see above).
    trigger: certPickerNode,
    menu: certPickerNode,
    items: certPickerItems,
    /** @param {number} [startIndex] */
    onOpen(startIndex = 0) {
      certPickerNode.classList.remove('hidden');
      const list = certPickerItems();
      if (list.length) focusItem(list, startIndex === -1 ? list.length - 1 : startIndex);
      else certPickerList.focus(); // defensive empty (note) state
    },
    onClose() {
      certPickerNode.classList.add('hidden');
      reportDismissed();
    },
    focusReturn: () => {}
  });

  // Header close (X): a deliberate dismiss — parity with Escape/backdrop; the
  // store maps the dismissal to resolution-cancel (continue cert-less).
  certPicker.close.addEventListener('click', () => {
    report.lastStimulus = 'escape';
    menuController.close(certPickerEntry);
  });

  /** Render the chooser rows from the display-string model + wire selection.
   * The model is EITHER the bare rows array (pre-popup shape — the a11y audit
   * hook still sends it; no host → subtitle hidden) OR `{ certs, host?, popup? }`
   * (M14 F2 L2: the popup marker rides the object form; M14 F3 HAT fix: `host`
   * feeds the site-attribution subtitle — copy-line renders, nothing else changes).
   * @param {any[] | { certs?: any[], host?: string, popup?: boolean }} model */
  function renderCertPicker(model) {
    const rows = Array.isArray(model) ? model : model && Array.isArray(model.certs) ? model.certs : [];
    const popup = !Array.isArray(model) && !!model && model.popup === true;
    const host = !Array.isArray(model) && model && typeof model.host === 'string' ? model.host : '';
    renderCertPickerSubtitle(certPicker.subtitle, host);
    certPicker.popupNote.classList.toggle('hidden', !popup);
    certPickerRows = renderCertPickerRows(document, certPickerList, rows);
    certPickerRows.forEach((btn) => {
      btn.addEventListener('click', () => {
        // A cert row reports its INDEX (`cert:<i>`, from data-cert-index); the
        // separated Cancel row (no data-cert-index) reports CERT_CANCEL_ID.
        // Activation wins over the onClose dismissal (one report per token).
        const ci = btn.dataset.certIndex;
        const id = ci != null && ci !== '' ? certPickId(Number(ci)) : CERT_CANCEL_ID;
        if (sendActivatedOnce({ id })) menuController.close(certPickerEntry);
      });
    });
  }

  // Backdrop click (outside the card) dismisses — vault-picker parity (the
  // controller's global pointerdown can't own in-sheet backdrop clicks). HAT FIX 2
  // (M15 F2 Leg 4 HAT fixes — H6): press-gated via attachBackdropPressGate — a
  // text-selection drag starting inside the card and releasing on the backdrop must
  // NOT dismiss.
  attachBackdropPressGate({
    node: certPickerNode,
    dismiss: () => {
      report.lastStimulus = 'outside-click';
      menuController.close(certPickerEntry);
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
    // dismissible: false — but NOT for the one-time-key reason. The capture offer is SPAWNED BY a
    // login-form submit, which also navigates the page; when the submitted page finishes loading it
    // pulls focus back into the guest view, blurring this sheet. Without the opt-out the menu-
    // controller's window-blur → closeAll would tear the "Save password?" prompt down before the
    // operator can act (the prompt flashes and vanishes). This skips ONLY the incidental window-blur
    // (and outside-click) in the sheet controller; Escape / Cancel / backdrop still dismiss it via
    // attachModalCard's direct close below, and a real whole-window app-switch still closes it main-
    // side (currentDismissible stays true — the open call does NOT pass dismissible:false), so the
    // decline paths are unaffected. The captured credential lives main-side under captureId with a
    // 2-min safety timeout, so persisting the sheet across the spawning navigation is safe.
    dismissible: false,
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
      capture.error.textContent =
        res && res.reason === 'locked' ? 'The manager locked — unlock it and try again' : 'Couldn’t save the password';
    }
  }

  capture.save.addEventListener('click', () => {
    void submitCapture();
  });
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
    close: (stimulus) => {
      report.lastStimulus = stimulus;
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

  vaultSet.submit.addEventListener('click', () => {
    void submitVaultSet();
  });
  vaultSet.cancel.addEventListener('click', () => {
    report.lastStimulus = 'escape';
    menuController.close(vaultSetEntry);
  });
  const vaultSetEnter = (/** @type {any} */ e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitVaultSet();
    }
  };
  vaultSet.input.addEventListener('keydown', vaultSetEnter);
  vaultSet.confirm.addEventListener('keydown', vaultSetEnter);
  attachModalCard({
    node: vaultSetNode,
    getCycle: () => [vaultSet.input, vaultSet.confirm, vaultSet.submit, vaultSet.cancel],
    close: (stimulus) => {
      report.lastStimulus = stimulus;
      menuController.close(vaultSetEntry);
    }
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
    close: () => {} // dismiss-disabled — Escape/backdrop never close (see above)
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
      res =
        mode === 'rotate-recovery'
          ? // M12 F4 Leg 2: recovery rotation's master-password step-up. On success main mints the
            // new recovery key + drives vault-recovery-show (post-write). No target.
            await window.menuOverlay.rotateRecovery({ token, secret })
          : mode === 'rotate-admin'
            ? // M12 F4 Leg 3: admin-key rotation/provision's master-password step-up. On success main
              // mints the new admin keypair + drives vault-adminkey-show (post-write). No target.
              await window.menuOverlay.rotateAdminKey({ token, secret })
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
      vaultStepup.error.textContent =
        mode === 'rotate-recovery'
          ? 'Wrong master password. The recovery key was not rotated.'
          : mode === 'rotate-admin'
            ? 'Wrong master password. The admin key was not rotated.'
            : 'Wrong master password. Nothing was minted.';
      vaultStepup.input.value = '';
      vaultStepup.input.focus();
    }
  }

  vaultStepup.submit.addEventListener('click', () => {
    void submitVaultStepup();
  });
  vaultStepup.cancel.addEventListener('click', () => {
    report.lastStimulus = 'escape';
    menuController.close(vaultStepupEntry);
  });
  vaultStepup.input.addEventListener('keydown', (/** @type {any} */ e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitVaultStepup();
    }
  });
  attachModalCard({
    node: vaultStepupNode,
    getCycle: () => [vaultStepup.input, vaultStepup.submit, vaultStepup.cancel],
    close: (stimulus) => {
      report.lastStimulus = stimulus;
      menuController.close(vaultStepupEntry);
    }
  });

  /** Stash the step-up mode + (for mint) the target vault id from the object model. Re-read each
   * init so a model-replace never acts on a stale target/mode. The vault-stepup sheet is reused
   * for recovery rotation's master-password step-up (M12 F4 Leg 2, DD3): mode 'rotate-recovery'
   * re-labels the lede + submit and routes submit to the rotateRecovery channel; 'mint' (default)
   * is the F3 access-key step-up.
   * @param {any} model */
  function renderStepup(model) {
    vaultStepupMode =
      model && (model.mode === 'rotate-recovery' || model.mode === 'rotate-admin') ? model.mode : 'mint';
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
    close: () => {} // dismiss-disabled — Escape/backdrop never close (see above)
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
    close: () => {} // dismiss-disabled — Escape/backdrop never close (see above)
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

  vaultImport.submit.addEventListener('click', () => {
    void submitVaultImport();
  });
  vaultImport.cancel.addEventListener('click', () => {
    report.lastStimulus = 'escape';
    menuController.close(vaultImportEntry);
  });
  vaultImport.input.addEventListener('keydown', (/** @type {any} */ e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitVaultImport();
    }
  });
  attachModalCard({
    node: vaultImportNode,
    getCycle: () => [
      vaultImport.masterRadio,
      vaultImport.recoveryRadio,
      vaultImport.input,
      vaultImport.submit,
      vaultImport.cancel
    ],
    close: (stimulus) => {
      report.lastStimulus = stimulus;
      menuController.close(vaultImportEntry);
    }
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

  vaultChangeMaster.submit.addEventListener('click', () => {
    void submitVaultChangeMaster();
  });
  vaultChangeMaster.cancel.addEventListener('click', () => {
    report.lastStimulus = 'escape';
    menuController.close(vaultChangeMasterEntry);
  });
  const vaultChangeMasterEnter = (/** @type {any} */ e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitVaultChangeMaster();
    }
  };
  vaultChangeMaster.oldInput.addEventListener('keydown', vaultChangeMasterEnter);
  vaultChangeMaster.newInput.addEventListener('keydown', vaultChangeMasterEnter);
  vaultChangeMaster.confirm.addEventListener('keydown', vaultChangeMasterEnter);
  attachModalCard({
    node: vaultChangeMasterNode,
    getCycle: () => [
      vaultChangeMaster.oldInput,
      vaultChangeMaster.newInput,
      vaultChangeMaster.confirm,
      vaultChangeMaster.submit,
      vaultChangeMaster.cancel
    ],
    close: (stimulus) => {
      report.lastStimulus = stimulus;
      menuController.close(vaultChangeMasterEntry);
    }
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

  vaultRecover.submit.addEventListener('click', () => {
    void submitVaultRecover();
  });
  vaultRecover.cancel.addEventListener('click', () => {
    report.lastStimulus = 'escape';
    menuController.close(vaultRecoverEntry);
  });
  const vaultRecoverEnter = (/** @type {any} */ e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitVaultRecover();
    }
  };
  vaultRecover.recoveryInput.addEventListener('keydown', vaultRecoverEnter);
  vaultRecover.newInput.addEventListener('keydown', vaultRecoverEnter);
  vaultRecover.confirm.addEventListener('keydown', vaultRecoverEnter);
  attachModalCard({
    node: vaultRecoverNode,
    getCycle: () => [
      vaultRecover.recoveryInput,
      vaultRecover.newInput,
      vaultRecover.confirm,
      vaultRecover.submit,
      vaultRecover.cancel
    ],
    close: (stimulus) => {
      report.lastStimulus = stimulus;
      menuController.close(vaultRecoverEntry);
    }
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
    p.setAttribute(
      'd',
      'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'
    );
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

  /* ---------------------------------------------------- template: bookmark-edit */
  // Star/bar/overflow quick-edit popover (M15 F1 Leg 2, flight DD4) — the
  // SIXTEENTH template kind, and the FIRST-EVER ANCHORED modal card (leg
  // design review): every prior dialog-style card ignores its anchor and
  // centers via CSS; this one is positioned via `positionNode` applied to the
  // CARD itself (not the backdrop) — see the card's own `position: absolute`
  // override in menu-overlay.css. Name + URL fields, a 4-way Tab-cycle (name →
  // url → Remove → Done) via the shared attachModalCard helper. The form
  // payload does NOT ride channel-4 sendActivated (24-char cap; close-on-
  // activation) — Done/Remove both submit over the DEDICATED
  // menu-overlay:bookmark-edit-submit invoke (no secret, but the same
  // request/response discipline as the vault-unlock family: the sheet awaits
  // { ok } to decide whether to stay open with an inline error).

  const bookmarkEdit = buildBookmarkEditCard(document);
  const bookmarkEditNode = bookmarkEdit.node;
  root.appendChild(bookmarkEditNode);

  /** @type {string | null} the bookmark id currently rendered — stashed per-init. */
  let bookmarkEditId = null;
  let bookmarkEditBusy = false; // guards a concurrent submit (double-Enter / Enter+click)

  const bookmarkEditEntry = menuController.register({
    trigger: bookmarkEditNode,
    menu: bookmarkEditNode,
    // no `items` — roving no-ops; Tab-cycling + Escape are the modal-card helper below.
    onOpen() {
      bookmarkEditBusy = false;
      bookmarkEditNode.classList.remove('hidden');
      bookmarkEdit.name.focus();
    },
    onClose() {
      bookmarkEditNode.classList.add('hidden');
      bookmarkEditId = null;
      reportDismissed();
    },
    focusReturn: () => {}
  });

  /** Render the name/url fields + reset the error line from the object model
   * ({ id, name, url }), then position the CARD (not the backdrop) at the
   * translated anchor — unhide FIRST (positionNode's point-anchor clamp
   * measures the node; offsetWidth/Height are 0 under display:none).
   * @param {any} model @param {any} anchor */
  function renderBookmarkEdit(model, anchor) {
    bookmarkEditId = model && typeof model.id === 'string' ? model.id : null;
    applyBookmarkEditModel(bookmarkEdit, model);
    bookmarkEditNode.classList.remove('hidden');
    positionNode(bookmarkEdit.card, anchor);
  }

  /** Reason-specific inline error copy for a rejected submit (HAT FIX 1, M15
   * F2 Leg 4 HAT fixes — H5): every rejection class now keeps the sheet open
   * with THIS line as its feedback surface (a post-close chrome toast is
   * architecturally invisible behind the guest view). Wording is
   * implementer's discretion (flight DD12's acceptable-variation ruling).
   * @param {unknown} [reason] @returns {string} */
  function bookmarkEditErrorCopy(reason) {
    if (reason === 'duplicate-url') return 'A bookmark for this web address already exists in this jar.';
    if (reason === 'not-found') return 'This bookmark could not be found — it may have been removed.';
    return 'Enter a name and a valid web address';
  }

  /** Submit → the DEDICATED bookmark-edit-submit invoke. `action` is 'save'
   * (Done — carries the current field values) or 'remove' (no fields needed).
   * Client-side: no empty/format guard here — the pre-forward validator is
   * main-side (the single source of truth for what counts as a valid
   * name/url, shared with nothing else to keep in sync). The sheet awaits
   * { ok }: false → stay open + show a reason-specific inline error (a
   * malformed/unsafe/internal URL or empty field, a same-jar duplicate-url,
   * or a since-vanished not-found target — HAT FIX 1 folded all three into
   * one path); true → main already closed the sheet (close-only-on-success).
   * @param {'save' | 'remove'} action */
  async function submitBookmarkEdit(action) {
    if (report.sent || report.token == null || bookmarkEditBusy || bookmarkEditId == null) return;
    const token = report.token;
    const id = bookmarkEditId;
    /** @type {any} */
    const payload = { token, id, action };
    if (action === 'save') {
      payload.name = bookmarkEdit.name.value;
      payload.url = bookmarkEdit.url.value;
    }
    bookmarkEditBusy = true;
    let res;
    try {
      res = await window.menuOverlay.bookmarkEditSubmit(payload);
    } catch {
      res = { ok: false }; // a rejected invoke degrades to a re-prompt, never a crash
    } finally {
      bookmarkEditBusy = false;
    }
    // Stale-resolution guard: a supersede / model-replace during the await
    // moved the live token; a late result must not act on the new menu.
    if (report.token !== token || report.sent) return;
    if (res && res.ok) {
      report.sent = true; // suppress the trailing dismissed; main already closed the sheet.
      menuController.close(bookmarkEditEntry);
    } else {
      bookmarkEdit.error.textContent = bookmarkEditErrorCopy(res && res.reason);
    }
  }

  bookmarkEdit.done.addEventListener('click', () => {
    void submitBookmarkEdit('save');
  });
  bookmarkEdit.remove.addEventListener('click', () => {
    void submitBookmarkEdit('remove');
  });
  const bookmarkEditEnterSubmits = (/** @type {any} */ e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitBookmarkEdit('save');
    }
  };
  bookmarkEdit.name.addEventListener('keydown', bookmarkEditEnterSubmits);
  bookmarkEdit.url.addEventListener('keydown', bookmarkEditEnterSubmits);
  attachModalCard({
    node: bookmarkEditNode,
    getCycle: () => [bookmarkEdit.name, bookmarkEdit.url, bookmarkEdit.remove, bookmarkEdit.done],
    close: (stimulus) => {
      report.lastStimulus = stimulus;
      menuController.close(bookmarkEditEntry);
    }
  });

  /* ----------------------------------------------------- registry + init dispatch */

  /** @type {{ [menuType: string]: 'menu' | 'info-popup' | 'input-dialog' | 'suggestions' | 'downloads' | 'vault-unlock' | 'vault-picker' | 'vault-capture' | 'vault-set' | 'vault-recovery-show' | 'vault-stepup' | 'vault-accesskey-show' | 'vault-import' | 'vault-change-master' | 'vault-recover' | 'vault-adminkey-show' | 'auth-basic' | 'cert-picker' | 'bookmark-edit' }} */
  const TEMPLATES = {
    kebab: 'menu',
    container: 'menu',
    'page-context': 'menu', // Leg 4 — point-anchored, separator/note item types
    'bookmarks-overflow': 'menu', // M15 F1 Leg 3 — shares menuNode; no NODE_OF_ENTRY addition
    'site-info': 'info-popup',
    'new-container': 'input-dialog',
    'auth-basic': 'auth-basic', // M14 F1 L2 — HTTP basic-auth credential prompt
    'cert-picker': 'cert-picker', // M14 F1 L3 — TLS client-certificate chooser
    'bookmark-edit': 'bookmark-edit', // M15 F1 Leg 2 — star/bar/overflow quick-edit popover (anchored)
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
    [authEntry, authNode],
    [pickerEntry, pickerNode],
    [certPickerEntry, certPickerNode],
    [captureEntry, captureNode],
    [vaultSetEntry, vaultSetNode],
    [recoveryEntry, recoveryNode],
    [vaultStepupEntry, vaultStepupNode],
    [accessKeyEntry, accessKeyNode],
    [vaultImportEntry, vaultImportNode],
    [vaultChangeMasterEntry, vaultChangeMasterNode],
    [vaultRecoverEntry, vaultRecoverNode],
    [adminKeyEntry, adminKeyNode],
    [bookmarkEditEntry, bookmarkEditNode]
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

  // DD1f (M15 F3 L1) — the EAGER DOM SCRUB, driven by main's one close message.
  //
  // Identical body to onInit's pre-render reset below (report.silence() then
  // menuController.closeAll()), run at CLOSE time instead of waiting for the next open's
  // init. That difference is the whole point and it is a SECURITY property: the sheet is a
  // single persistent document rendering every menu, and main now admits readDom /
  // readAxTree / captureScreenshot on it while its current menuType is allowlisted. Main
  // flips currentMenu + show() synchronously and only then sends init, so a lazy
  // scrub-on-next-init leaves a window in which main reports an allowlisted menuType while
  // this DOM still holds the previous menu's content — a one-time recovery key's textContent
  // among it. Scrubbing here removes that premise instead of racing it.
  //
  // closeAll() runs the closing entry's onClose, which is where the three secret cards clear
  // their own textContent — so the scrub is complete, not merely a hide. `<body>` data
  // attributes are deliberately untouched (DD8's drag-probe counters must survive the close).
  //
  // Guarded for a preload that predates the channel (an old sheet bundle simply keeps the
  // pre-DD1f lazy behavior rather than throwing at boot).
  if (typeof window.menuOverlay.onCloseReset === 'function') {
    window.menuOverlay.onCloseReset(() => {
      report.silence();
      menuController.closeAll();
    });
  }

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
    // cert-picker accepts BOTH shapes — renderCertPicker's documented domain:
    // the bare rows array (the a11y audit hook's pre-popup shape) OR
    // `{ certs, popup? }` (the LIVE cert-challenge-present path since M14 F2
    // L2 — the popup marker rides the object form). M14 F3 HAT fix: this gate
    // previously demanded an array here while the live chrome sent the object,
    // so every real cert challenge bailed AFTER main had already shown the
    // sheet — a visible blank sheet with no card (contract-pinned in
    // cert-picker-template.test.js).
    const modelShapeOk =
      template === 'cert-picker'
        ? !!model && typeof model === 'object'
        : template === 'suggestions' ||
            template === 'vault-capture' ||
            template === 'vault-recovery-show' ||
            template === 'vault-stepup' ||
            template === 'vault-accesskey-show' ||
            template === 'vault-adminkey-show' ||
            template === 'auth-basic' ||
            template === 'bookmark-edit'
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
    // Keep-focus opt-in for THIS render (see the blur listener at the bottom of the
    // file). Assigned unconditionally so a keep-focus menu's flag can never leak into
    // the next, ordinary one.
    keepFocusMenu = payload.keepFocus === true;

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
    } else if (template === 'auth-basic') {
      // Fixed layout (host/realm line + username + password + Sign in/Cancel),
      // centered via CSS — the anchor is ignored; the model is the {host, realm}
      // object. Render FIRST (sets the context line), then open through the
      // controller. onOpen clears + focuses the username input; it must NOT
      // fall through to the non-focusing 'menu' fallback.
      renderAuthBasic(model);
      menuController.open(authEntry, 0);
    } else if (template === 'vault-unlock') {
      // Fixed layout (password + error + Unlock/Cancel), centered via CSS — the
      // anchor is ignored, model may be empty. onOpen clears + focuses the input;
      // it must NOT fall through to the non-focusing 'menu' fallback.
      //
      // Keep-focus opens (the unlock-to-save prompt raised by a locked-vault capture)
      // additionally opt OUT of the controller's incidental window-blur / outside-click
      // dismissal — the login submit that spawned the held credential ALSO navigates the
      // page, and the loading guest's focus steal was tearing this prompt down before the
      // operator could type (the vault-capture entry's dismissible:false precedent, which
      // fixed exactly this for the already-unlocked branch of the same flow). Escape /
      // Cancel / the header X / a backdrop click still dismiss it (attachModalCard's own
      // direct closes), and a real app-switch still closes it main-side (the open call
      // keeps currentDismissible true), so every decline path is unchanged. ASSIGNED ON
      // BOTH BRANCHES — the entry is a singleton, so a stale `false` would silently make
      // every later gesture-raised unlock prompt non-dismissable.
      vaultEntry.dismissible = !keepFocusMenu;
      menuController.open(vaultEntry, 0);
    } else if (template === 'vault-picker') {
      // Roving list of badged credential rows, centered via CSS — the anchor is
      // ignored. Build the rows FIRST (the items getter reads them at open), then
      // open through the controller so roving/outside-click/blur apply uniformly.
      // An empty model → the non-focusable note; onOpen focuses the card instead.
      renderPicker(model);
      menuController.open(pickerEntry, typeof startIndex === 'number' ? startIndex : 0);
    } else if (template === 'cert-picker') {
      // Roving list of subject/issuer rows + the Cancel row, centered via CSS —
      // the anchor is ignored. Build FIRST (the items getter reads the rows at
      // open), then open through the controller (vault-picker discipline).
      renderCertPicker(model);
      menuController.open(certPickerEntry, typeof startIndex === 'number' ? startIndex : 0);
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
    } else if (template === 'bookmark-edit') {
      // The FIRST-EVER anchored modal card (leg design review) — render FIRST
      // (stashes the id, positions the CARD at the translated anchor), then
      // open through the controller. onOpen focuses the name input; it must
      // NOT fall through to the non-focusing 'menu' fallback.
      renderBookmarkEdit(model, anchor);
      menuController.open(bookmarkEditEntry, 0);
    } else {
      // input-dialog: fixed layout, model may be empty; centered via CSS —
      // the anchor is deliberately ignored.
      menuController.open(dialogEntry, 0);
    }
  });

  // Keep-focus re-grab (see `keepFocusMenu` above). menu-controller.js registers its own
  // window-blur listener FIRST (classic script, parsed before this module), where a
  // dismissible:false entry early-returns instead of closing — so by the time this runs,
  // a keep-focus menu is still open and asking for its focus back is meaningful. Every
  // gate that matters lives main-side (sheet identity, the window still being focused,
  // the menu's own opt-in); this end only reports the blur. The optional call keeps an
  // older preload from throwing at boot.
  window.addEventListener('blur', () => {
    if (!keepFocusMenu || !menuController.current) return;
    window.menuOverlay.requestFocus?.();
  });
})();
