// Sortie 01 (default browser) leg 1: the two crash/hang audit-state hooks, extracted
// VERBATIM out of renderer.js (a behaviour-preserving move that pays for the leg's own
// renderer lines — zero-headroom budget). renderer.js still republishes both by NAME at
// the seam tail, so SEAM_COUNT is unchanged. The controllers are read through GETTERS:
// they are `let` bindings assigned well after this factory's construction site.
'use strict';

/**
 * Mission 20 F3 Leg 2 (DD11 seam ruling): synthetic crash/hang records on the active
 * tab for the a11y audit's two chrome states. HAT H2b: cleared by the tab's next
 * committed navigation (both controllers' onTabDidNavigate hooks) or a real push —
 * the audit visits each state fresh.
 * @param {{
 *   activeTab: () => any,
 *   getLoadFailureController: () => any,
 *   getHangNoticeController: () => any
 * }} deps
 */
export function createAuditStates({ activeTab, getLoadFailureController, getHangNoticeController }) {
  function showCrashPanelForAudit() {
    const tab = activeTab();
    if (!tab || tab.wcId == null) return;
    tab.crash = { reason: 'crashed', exitCode: 139, url: tab.url };
    tab.loadFailure = null;
    tab.hung = false;
    getLoadFailureController().applyStripState(tab);
    getLoadFailureController().show(tab);
  }
  function showHangNoticeForAudit() {
    const tab = activeTab();
    if (!tab || tab.wcId == null) return;
    tab.hung = true;
    getHangNoticeController().project(tab);
  }
  return { showCrashPanelForAudit, showHangNoticeForAudit };
}
