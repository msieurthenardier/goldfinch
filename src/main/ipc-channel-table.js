'use strict';

// IPC channel classification table (Mission 23 Flight 1, leg `ipc-gate`, DD2).
//
// ONE row per main-process IPC channel: the caller class that may invoke it. The gate
// (`ipc-gate.js`) refuses to register a channel that is absent from this table or whose
// registrar class differs from its entry here, and `test/unit/ipc-gate-invariant.test.js`
// asserts, by scanning `src/main/**`, that the registered channels and these keys are the
// same set. Runtime data on purpose: a mis-classed registration fails at boot.
//
// Classes (each names WHO may call; see `ipc-gate.js` for the enforcement):
//   chrome             any window's chrome view
//   owning-chrome      a window's chrome view AND, when the call names a tab, that window owns it
//   chrome-or-internal a window's chrome view, or a trusted goldfinch:// internal page
//   internal           a trusted goldfinch:// internal page (registerInternalHandler)
//   tab-guest          a tab's own guest page: its main frame, a web tab (popups / internal tabs /
//                      active-tab-only are per-registration switches; see `ipc-gate.js`)
//   sheet              the per-window menu-overlay sheet, valid only under the menu types in
//                      `SHEET_MENU_TYPES` below
//   find / save-prompt the per-window find overlay / corner save-prompt view
//   find-or-owning-chrome  the find overlay, or a window chrome (`find-overlay:close`)
//
// Taken from `missions/23-security-review-remediation/flights/01-page-containment/
// ipc-census.md`, with each migrated channel's class confirmed against its handler.

const CLASSES = Object.freeze([
  'chrome',
  'owning-chrome',
  'chrome-or-internal',
  'internal',
  'tab-guest',
  'sheet',
  'find',
  'save-prompt',
  'find-or-owning-chrome'
]);

/** @type {Readonly<Record<string, string>>} */
const CHANNEL_CLASS = Object.freeze({
  // app-lifecycle.js
  'window-boot-config': 'chrome',
  'app-quit': 'chrome',
  'automation:dev-invoke': 'chrome',
  // history-ipc.js
  'history-suggest': 'chrome',
  'internal-history-page': 'internal',
  'internal-history-search': 'internal',
  'internal-history-delete': 'internal',
  'internal-history-clear': 'internal',
  'internal-history-count': 'internal',
  'internal-history-suggest': 'internal',
  // jar-data-ipc.js
  'jars-clear-data': 'chrome',
  'jars-wipe': 'chrome',
  'jars-set-retention': 'chrome',
  'internal-jars-clear-data': 'internal',
  'internal-jars-wipe': 'internal',
  'internal-jars-set-retention': 'internal',
  'internal-jars-cookies-list': 'internal',
  'internal-jars-cookies-remove': 'internal',
  'internal-jars-cookies-value': 'internal',
  'internal-jars-sitedata-list': 'internal',
  'internal-jars-sitedata-remove-origin': 'internal',
  // jar-registry-ipc.js
  'jars-list': 'chrome',
  'jars-add': 'chrome',
  'jars-rename': 'chrome',
  'jars-set-default': 'chrome',
  'jars-get-default': 'chrome',
  'jars-remove': 'chrome',
  'internal-jars-list': 'internal',
  'internal-jars-add': 'internal',
  'internal-jars-rename': 'internal',
  'internal-jars-set-default': 'internal',
  'internal-jars-get-default': 'internal',
  'internal-jars-remove': 'internal',
  // main.js
  'vault-lock-state-get': 'chrome',
  'vault-automation-held-get': 'chrome',
  'vault-lock': 'chrome',
  'vault-reachable-items': 'owning-chrome',
  'vault-fill-human': 'owning-chrome',
  'vault-fill-generated': 'owning-chrome',
  'vault-certificate-acknowledge': 'owning-chrome',
  // register-bookmarks-ipc.js
  'bookmarks-get': 'chrome',
  'bookmark-add': 'chrome',
  'bookmark-update': 'chrome',
  'bookmark-remove': 'chrome',
  'bookmark-reorder': 'chrome',
  'bookmarks-suggest': 'chrome',
  // register-browser-ipc.js
  'shields-farble': 'tab-guest',
  'window-minimize': 'chrome',
  'window-toggle-maximize': 'chrome',
  'window-close': 'chrome',
  'window-is-maximized': 'chrome',
  'window-create': 'chrome',
  'new-container-create': 'chrome',
  'vault-eligible': 'tab-guest',
  'guest-vault-gesture': 'tab-guest',
  'guest-tab-boundary': 'tab-guest',
  'guest-vault-icon-menu': 'tab-guest',
  'guest-vault-capture': 'tab-guest',
  'guest-vault-capture-card': 'tab-guest',
  'guest-vault-capture-identity': 'tab-guest',
  'guest-vault-gesture-settle': 'tab-guest',
  'vault-capture-dismiss': 'chrome',
  'vault-capture-finalize': 'chrome',
  'internal-vault-request-setup': 'internal',
  'internal-vault-request-unlock': 'internal',
  'internal-vault-request-mint': 'internal',
  'internal-vault-pick-import-file': 'internal',
  'internal-vault-begin-import-unlock': 'internal',
  'internal-vault-clear-pending-import': 'internal',
  'internal-vault-import-labels': 'internal',
  'internal-vault-import-commit': 'internal',
  'internal-vault-sever-dismiss': 'internal',
  'internal-vault-browser-import-pick': 'internal',
  'internal-vault-browser-import-summary': 'internal',
  'internal-vault-browser-import-cancel': 'internal',
  'internal-vault-browser-import-commit': 'internal',
  'internal-vault-request-rotate-recovery': 'internal',
  'internal-vault-request-rotate-admin': 'internal',
  'internal-vault-request-change-master': 'internal',
  'internal-vault-request-recover': 'internal',
  'internal-vault-request-compromise': 'internal',
  'guest-media-list': 'tab-guest',
  'guest-privacy-fp': 'tab-guest',
  'guest-window-close': 'tab-guest',
  'rescan-media': 'owning-chrome',
  'zoom-apply': 'owning-chrome',
  'get-zoom': 'owning-chrome',
  print: 'owning-chrome',
  'toggle-devtools': 'owning-chrome',
  'is-devtools-open': 'owning-chrome',
  'page-context-correct': 'owning-chrome',
  'page-context-action': 'owning-chrome',
  'internal-open-tab-in-jar': 'internal',
  'identity-new': 'chrome',
  'privacy-cookies': 'owning-chrome',
  'privacy-clear-cookies': 'owning-chrome',
  'privacy-clear-storage': 'owning-chrome',
  // register-download-ipc.js
  'download-media': 'owning-chrome',
  'choose-download-dir': 'chrome',
  'show-item-in-folder': 'chrome',
  'downloads-snapshot': 'chrome',
  'open-downloaded-file': 'chrome',
  'reveal-downloaded-file': 'chrome',
  'internal-downloads-list': 'internal',
  'internal-downloads-action': 'internal',
  'internal-downloads-clear': 'internal',
  // register-overlay-ipc.js
  'menu-overlay:open': 'chrome',
  'menu-overlay:close': 'chrome',
  'menu-overlay:activated': 'sheet',
  'menu-overlay:dismissed': 'sheet',
  'menu-overlay:refocus': 'sheet',
  'menu-overlay:vault-unlock': 'sheet',
  'menu-overlay:vault-setup': 'sheet',
  'menu-overlay:vault-stepup-mint': 'sheet',
  'menu-overlay:vault-import': 'sheet',
  'menu-overlay:vault-rotate-recovery': 'sheet',
  'menu-overlay:vault-rotate-admin': 'sheet',
  'menu-overlay:vault-change-master': 'sheet',
  'menu-overlay:vault-recover': 'sheet',
  'menu-overlay:vault-compromise': 'sheet',
  'menu-overlay:vault-compromise-recover': 'sheet',
  'menu-overlay:copy-text': 'sheet',
  'menu-overlay:auth-submit': 'sheet',
  'menu-overlay:bookmark-edit-submit': 'sheet',
  'menu-overlay:overflow-drop': 'sheet',
  'menu-overlay:cert-override-proceed': 'sheet',
  'menu-overlay:sheet-drag': 'sheet',
  'find-overlay:open': 'owning-chrome',
  'find-overlay:close': 'find-or-owning-chrome',
  'find-overlay:query': 'find',
  'tearoff-overlay:show': 'chrome',
  'tearoff-overlay:move': 'chrome',
  'tearoff-overlay:hide': 'chrome',
  // register-save-prompt-ipc.js
  'save-prompt:open': 'chrome',
  'save-prompt:anchor': 'chrome',
  'save-prompt:pointer': 'save-prompt',
  'save-prompt:focus': 'save-prompt',
  'save-prompt:height': 'save-prompt',
  'save-prompt:dismiss': 'save-prompt',
  'save-prompt:save': 'save-prompt',
  'save-prompt:consent': 'save-prompt',
  // register-settings-ipc.js
  'settings-get': 'chrome',
  'shields-get': 'chrome',
  'shields-isolation-state': 'chrome',
  'shields-restart-to-apply': 'chrome',
  'shields-set': 'chrome',
  'shields-pause': 'chrome',
  'internal-settings-get': 'internal',
  'internal-settings-set': 'internal',
  'internal-shields-get': 'internal',
  'internal-shields-isolation-state': 'internal',
  'internal-shields-restart-to-apply': 'internal',
  'internal-shields-set': 'internal',
  'automation:get-status': 'internal',
  'automation:set-port': 'internal',
  'default-browser:get-status': 'internal',
  'default-browser:make-default': 'internal',
  'automation:find-free-port': 'internal',
  'clipboard:write': 'internal',
  'automation:list-keys': 'internal',
  'automation:jar-key-mint': 'internal',
  'automation:jar-key-revoke': 'internal',
  'automation:admin-key-mint': 'internal',
  'automation:admin-key-revoke': 'internal',
  'automation:get-activity': 'chrome-or-internal',
  'chrome-clipboard-write': 'chrome',
  'unpin-toolbar-item': 'chrome',
  'toggle-bookmarks-bar': 'chrome',
  'chrome-welcome-set': 'chrome',
  // register-tab-ipc.js
  'tab-create': 'chrome',
  'tab-close': 'owning-chrome',
  'tab-reopen': 'chrome',
  'tab-history-snapshot': 'owning-chrome',
  'tab-certificate-get': 'owning-chrome',
  'closed-tab-stack-size': 'chrome',
  'move-targets': 'chrome',
  'tab-move-to-new-window': 'owning-chrome',
  'tab-move-to-window': 'owning-chrome',
  'tab-tear-off': 'owning-chrome',
  'tab-drag-started': 'owning-chrome',
  'tab-drag-ended': 'owning-chrome',
  'bookmark-drag-started': 'chrome',
  'bookmark-drag-ended': 'chrome',
  'guest-bookmark-drop': 'tab-guest',
  'tab-adopt-by-drop': 'chrome',
  'tab-hide': 'owning-chrome',
  'tab-navigate': 'owning-chrome',
  'tab-focus-guest': 'chrome',
  'tab-set-active': 'owning-chrome',
  'tab-set-bounds': 'owning-chrome',
  'tab-find': 'owning-chrome',
  // register-vault-ipc.js
  'internal-vault-state': 'internal',
  'internal-vault-lock': 'internal',
  'internal-vault-compromise-dismiss': 'internal',
  'internal-vault-has': 'internal',
  'internal-vault-list': 'internal',
  'internal-vault-reveal': 'internal',
  'internal-vault-item-save': 'internal',
  'internal-vault-totp-code': 'internal',
  'internal-vault-item-delete': 'internal',
  'internal-vault-item-copy': 'internal',
  'internal-vault-accesskey-list': 'internal',
  'internal-vault-accesskey-revoke': 'internal',
  'internal-vault-export': 'internal',
  'internal-vault-export-profile': 'internal',
  'internal-vault-pick-save-path': 'internal'
});

/**
 * The sheet class's menu-type rule per channel — the ONE table (Mission 23 Flight 1, leg
 * `ipc-gate-complete`, DD13 / 22a). A non-empty list: the channel is valid only while the
 * sheet's CURRENT menu is one of these types. `'any-open-menu'`: valid under every menu type,
 * refused when no menu is open. `'sender-only'`: sheet identity alone, valid even with no menu
 * open — for `menu-overlay:sheet-drag` only, whose `end` phase arrives after the sheet has
 * blur-closed (a no-menu refusal would drop the drag's clear signal).
 *
 * The lists are the single sender site of each preload method in
 * `src/renderer/menu-overlay.js` (wire menu types, not templates): the three step-up channels
 * (`mint`, `rotate-recovery`, `rotate-admin`) are one card in three modes and the mode is not in
 * the current-menu record, so they are not separable by menu type.
 *
 * @type {Readonly<Record<string, 'any-open-menu' | 'sender-only' | readonly string[]>>}
 */
const SHEET_MENU_TYPES = Object.freeze({
  'menu-overlay:activated': 'any-open-menu',
  'menu-overlay:dismissed': 'any-open-menu',
  'menu-overlay:refocus': 'any-open-menu',
  'menu-overlay:sheet-drag': 'sender-only',
  'menu-overlay:overflow-drop': Object.freeze(['bookmarks-overflow']),
  'menu-overlay:cert-override-proceed': Object.freeze(['cert-override']),
  'menu-overlay:vault-compromise': Object.freeze(['vault-compromise']),
  'menu-overlay:vault-compromise-recover': Object.freeze(['vault-compromise-recover']),
  'menu-overlay:vault-unlock': Object.freeze(['vault-unlock']),
  'menu-overlay:vault-setup': Object.freeze(['vault-set']),
  'menu-overlay:vault-stepup-mint': Object.freeze(['vault-stepup']),
  'menu-overlay:vault-rotate-recovery': Object.freeze(['vault-stepup']),
  'menu-overlay:vault-rotate-admin': Object.freeze(['vault-stepup']),
  'menu-overlay:vault-import': Object.freeze(['vault-import-unlock']),
  'menu-overlay:vault-change-master': Object.freeze(['vault-change-master']),
  'menu-overlay:vault-recover': Object.freeze(['vault-recover']),
  'menu-overlay:copy-text': Object.freeze(['vault-recovery-show', 'vault-accesskey-show', 'vault-adminkey-show']),
  'menu-overlay:auth-submit': Object.freeze(['auth-basic']),
  'menu-overlay:bookmark-edit-submit': Object.freeze(['bookmark-edit'])
});

module.exports = { CLASSES, CHANNEL_CLASS, SHEET_MENU_TYPES };
