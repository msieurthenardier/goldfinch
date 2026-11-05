'use strict';
// @ts-check

// Sortie 06 Leg 3 (R5): the single "focus this window's active guest" predicate, shared by the
// `tab-focus-guest` IPC handler, the save prompt's Shift+F6 hop and its refocus-on-close. Refuses
// (returns false, never throws) when there is no active tab, its view is destroyed, or the guest
// is taken over by a load-failure / crash panel (Mission 20: a taken-over guest never receives OS
// focus; the chrome moves focus into the panel instead).

const { guestTakenOver } = require('../shared/load-failure');

/**
 * @param {{ activeTabWcId?: number | null, tabViews?: Map<number, any> } | null | undefined} rec
 * @returns {boolean}
 */
function focusActiveGuest(rec) {
  if (!rec) return false;
  const wcId = rec.activeTabWcId;
  if (wcId == null) return false;
  const entry = rec.tabViews && rec.tabViews.get(wcId);
  if (!entry || entry.view.webContents.isDestroyed() || guestTakenOver(entry)) return false;
  entry.view.webContents.focus();
  return true;
}

module.exports = { focusActiveGuest };
