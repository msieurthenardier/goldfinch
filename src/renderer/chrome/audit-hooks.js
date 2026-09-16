// Mission 20 Flight 2 Leg 1 (DD11): the `open*ForAudit` hook family, extracted
// VERBATIM out of renderer.js — a behaviour-preserving move, not a rewrite.
// Every hook opens a menu-overlay sheet menuType with a REPRESENTATIVE
// synthetic (never-secret, never-live) model so `npm run a11y` and the MCP
// evaluate seam can audit a sheet state that would otherwise require driving
// a real, hard-to-reach app condition (an actual auth prompt, an actual
// bookmark, an actual overflowing tab strip …). Each hook's own provenance
// comment (which flight/leg added it, which SHEET_STATES entry it feeds)
// travels with its body below — see CLAUDE.md's evaluate-seam / SEAM_COUNT
// note and `scripts/a11y-audit.mjs`'s `SHEET_STATES` table — the seam
// republishes each hook by NAME from renderer.js, so a move here changes
// neither SEAM_COUNT nor the a11y audit's `open:` strings. M20 F2 L3 added
// openCertOverrideOverlayForAudit (36 → 37) alongside the original six. M20
// F2 L4 added openCertViewerOverlayForAudit (37 → 38, then 38 → 39 with the
// behavior-spec-driven openCertificateViewer seam publish in renderer.js).
'use strict';

import { tabContextModel } from '../../shared/tab-context-model.js';

/**
 * @param {{
 *   openOverlayMenu: (menuType: string, model: any, anchor: any, startIndex: number, opts?: any) => void,
 *   els: any,
 *   tabs: Map<string, any>,
 *   orderedTabIds: () => string[],
 *   activeTab: () => any,
 *   chromePointToSheet: (cx: number, cy: number) => any,
 *   pageCtx: { wcId: number|null, params: any, returnFocus: any, toolbarItem: any },
 *   tabCtx: { tabId: string|null, returnFocus: any },
 *   openPageContextOverlaySheet: (anchor: any) => void
 * }} deps
 */
export function createAuditHooks({
  openOverlayMenu,
  els,
  tabs,
  orderedTabIds,
  activeTab,
  chromePointToSheet,
  pageCtx,
  tabCtx,
  openPageContextOverlaySheet
}) {
  // M14 F1 L2 (auth-challenges): a11y SHEET_STATES hook for the auth-basic credential
  // sheet. Opens with a synthetic NON-SECRET host/realm model so the labeled
  // username/password fields + Sign in/Cancel render (dialog-style, Escape-dismissible).
  // Same leg-authorized evaluate-seam precedent as openAuthBasicOverlayForAudit.
  const openAuthBasicOverlayForAudit = () =>
    openOverlayMenu('auth-basic', { host: '127.0.0.1:8091', realm: 'fixture' }, null, 0);

  // M14 F1 L3 (client-cert): a11y SHEET_STATES hook for the cert-picker chooser
  // sheet. Opens with a synthetic display-string row (subject + issuer — never a
  // certificate object) so the roving list + Cancel row render. Same
  // leg-authorized evaluate-seam precedent as openAuthBasicOverlayForAudit.
  const openCertPickerOverlayForAudit = () =>
    openOverlayMenu(
      'cert-picker',
      [{ subject: 'CN=Fixture Client', issuer: 'CN=Goldfinch Fixture Throwaway CA' }],
      null,
      0
    );

  // M15 F1 Leg 2 (FD-ruled seam addition): a11y SHEET_STATES hook for the
  // bookmark-edit popover. Opens with a synthetic NON-SECRET row (id/name/url
  // are all this leg's own already-public data) so the labeled name/url fields
  // + Remove/Done render (dialog-style, Escape-dismissible). Same
  // leg-authorized evaluate-seam precedent as openAuthBasicOverlayForAudit.
  const openBookmarkEditOverlayForAudit = () =>
    openOverlayMenu(
      'bookmark-edit',
      { id: 'bm-audit', name: 'Fixture Bookmark', url: 'https://example.com/' },
      null,
      0
    );

  // M15 F1 Leg 3 (FD-ruled seam addition, SHEET_STATES ordering rule — see the
  // flight-log FD ruling: placed BEFORE sheet:kebab so this new surface gets
  // real audit coverage instead of being masked by the pre-existing kebab
  // secret-sheet refusal): a11y hook for the bookmarks-overflow chevron menu.
  // Opens with a synthetic NON-SECRET row (this leg's own already-public data
  // shape) so the roving item list renders — template family 'menu' (shares
  // menuNode with kebab/container/page-context/tab-context; no NODE_OF_ENTRY
  // addition, per the leg's audit-seam AC).
  const openBookmarksOverflowOverlayForAudit = () =>
    openOverlayMenu('bookmarks-overflow', [{ id: 'bookmark:0', label: 'Fixture Bookmark' }], null, 0);

  // M20 F2 L3 (leg-authorized seam addition, SEAM_COUNT 36 → 37): a11y
  // SHEET_STATES hook for the cert-override card. Opens with a synthetic
  // NON-SECRET model (a fixture host/error, never a live certificate) so the
  // heading/body/error-line + Back/Proceed render — dialog-style,
  // Escape-dismissible. The card this opens is ITSELF refused to every
  // automation op (DD3/DD10 — cert-override never joins
  // AUTOMATABLE_MENU_TYPES), so this record entry exists for the a11y
  // audit's skip list, not for coverage — same accepted shape as
  // openCertPickerOverlayForAudit before it.
  const openCertOverrideOverlayForAudit = () =>
    openOverlayMenu(
      'cert-override',
      {
        host: '127.0.0.1:8443',
        error: 'ERR_CERT_AUTHORITY_INVALID',
        title: "This connection isn't private",
        body: "This site's security certificate is from an authority Goldfinch doesn't trust."
      },
      null,
      0
    );

  // M20 F2 L4 (leg-authorized seam addition, SEAM_COUNT 38 → 39): a11y
  // SHEET_STATES hook for the read-only cert-viewer card. Opens with a
  // synthetic, already-public-shaped summary model (the same fields
  // certificate-summary.js produces — a fixture host/CA, never a live
  // certificate) so the status line + every labelled row render. This
  // menuType IS admitted for the three read ops (DD10 — site-info/
  // cert-viewer join AUTOMATABLE_MENU_TYPES) — unlike cert-override's hook,
  // this record exists for REAL audit coverage, not the skip list.
  const openCertViewerOverlayForAudit = () =>
    openOverlayMenu(
      'cert-viewer',
      {
        subject: { commonName: '127.0.0.1' },
        issuer: { commonName: 'Goldfinch Fixture Trusted CA' },
        validFrom: '2026-01-01T00:00:00.000Z',
        validTo: '2026-01-08T00:00:00.000Z',
        serial: '01',
        fingerprints: { sha256: 'AA:BB:CC', sha1: 'DD:EE:FF' },
        san: ['127.0.0.1'],
        chain: [{ subject: 'CN=127.0.0.1', issuer: 'CN=Goldfinch Fixture Trusted CA' }],
        status: 'trusted'
      },
      null,
      0
    );

  /**
   * Test/audit hook: open the page context menu with a representative synthetic params payload
   * so the `npm run a11y` harness can audit the open sheet menu. Builds a full-section
   * menu (link + selection + editable + spelling-suggestions + Inspect) at a fixed chrome coord.
   * Reachable via the MCP evaluate tool (published by the evaluate-reachable seam
   * at the bottom of renderer.js — module scope hides top-level functions).
   */
  function openPageContextMenuForAudit() {
    pageCtx.wcId = (activeTab() && activeTab().wcId) || null;
    pageCtx.params = {
      linkURL: 'https://example.com/',
      selectionText: 'sample',
      isEditable: true,
      editFlags: { canCut: true, canCopy: true, canPaste: true, canUndo: true, canRedo: true },
      misspelledWord: 'teh',
      dictionarySuggestions: ['the', 'ten', 'tea'],
      x: 80,
      y: 80
    };
    pageCtx.toolbarItem = null;
    pageCtx.returnFocus = els.address;
    // The synthetic 80,80 CHROME coords are translated chrome→sheet like the other
    // keyboard-mode anchors — immaterial to the audit's purpose, pinned for determinism.
    openPageContextOverlaySheet(chromePointToSheet(80, 80));
  }

  /**
   * Test/audit hook: open the tab context menu with a REPRESENTATIVE synthetic
   * model (bypassing the live orderedTabIds()/stack-size-cache reads that
   * openTabContextMenu makes, exactly the way openPageContextMenuForAudit
   * bypasses the live guest params) — items-to-right and a non-empty stack so all
   * five items render, per the a11y checkpoint. Anchored at the first tab if one
   * exists, else the tab strip itself. Reachable via the MCP evaluate tool
   * (closed-set seam at the bottom of renderer.js — FD-ruled addition, flight DD).
   *
   * The synthetic moveTargets (M09 F8 Leg 4) is the point of the word REPRESENTATIVE:
   * the live cache is empty in a one-window app, so an audit that read it would render
   * no "Move to window …" item and report clean on a menu MISSING the item type leg 4
   * added. The audit must exercise the shape it is auditing.
   */
  function openTabContextMenuForAudit() {
    const ids = orderedTabIds();
    const id = ids[0] || null;
    const anchorEl = (id && tabs.get(id) && tabs.get(id).btn) || els.tabs;
    tabCtx.tabId = id;
    tabCtx.returnFocus = els.address;
    const r = anchorEl.getBoundingClientRect();
    // isInternal:false — representative synthetic model with EVERY item rendered
    // (seven since M09 F8: tab:move-new-window — F6 — plus one tab:move-window:<id>),
    // per the a11y checkpoint.
    const moveTargets = [{ windowId: 0, label: 'Another window' }];
    const model = tabContextModel({
      tabId: id || 'audit',
      isLastTab: false,
      tabsToRight: 1,
      stackSize: 1,
      isInternal: false,
      moveTargets
    });
    openOverlayMenu('tab-context', model, chromePointToSheet(r.left, r.bottom), 0);
  }

  return {
    openAuthBasicOverlayForAudit,
    openCertPickerOverlayForAudit,
    openBookmarkEditOverlayForAudit,
    openBookmarksOverflowOverlayForAudit,
    openCertOverrideOverlayForAudit,
    openCertViewerOverlayForAudit,
    openPageContextMenuForAudit,
    openTabContextMenuForAudit
  };
}
