// The hang notice's own controller (Mission 20 Flight 3 Leg 2, DD3). A
// non-blocking bar between the toolbar/bookmarks-bar and #main, shown while
// the ACTIVE tab's renderer is unresponsive, cleared the moment it answers
// again. Unlike load-failure-controller.js this controller builds no DOM —
// #hang-notice's text and two buttons are static markup in index.html (no
// per-item data to render), so this file only toggles visibility and drives
// Wait / Kill-and-reload.

/** @param {any} deps */
export function createHangNoticeController(deps) {
  const {
    els,
    isActiveTab,
    findTabByWcId,
    tabNavigate,
    refreshStrip, // load-failure-controller.js's applyStripState equivalent
    sendActiveBounds
  } = deps;

  let visible = false; // last APPLIED DOM state — matches index.html's default-hidden markup
  // The tab this bar is CURRENTLY showing for — resolved by project(), read
  // by the two button handlers below (there is no other way for a click
  // handler to know which tab it acts on; the bar only ever shows the
  // active tab's own episode).
  let currentTab = null;

  // applyVisibility(next): the #bookmarks-bar / applyBarVisibility precedent
  // (window-controller.js) — INSTANT reflow, no transition: toggling this
  // row changes #main's flex-computed height, which moves the active guest's
  // bounds in ONE discrete compositor step (the styles.css INVARIANT on
  // #bookmarks-bar applies here verbatim). sendActiveBounds() fires ONLY on
  // a NET visibility change, never on every push.
  function applyVisibility(next) {
    if (next === visible) return;
    visible = next;
    els.hangNotice.classList.toggle('hidden', !visible);
    sendActiveBounds();
  }

  // project(tab): the panel-family projection every activation-class event
  // calls (tab-controller.js's activateTab, and this controller's own
  // onTabHung push handler below). A push for a BACKGROUND tab (not the one
  // just projected/activated) must never touch the bar showing for the real
  // active tab — gated on isActiveTab(tab) first, before anything else.
  function project(tab) {
    if (!tab || !isActiveTab(tab)) return;
    const shouldShow = !!(tab.hung && !tab.hangDismissed);
    currentTab = shouldShow ? tab : null;
    applyVisibility(shouldShow);
  }

  // onTabHung({ wcId, hung }): the owner-routed push handler — registered by
  // renderer.js (window.goldfinch.onTabHung(hangNoticeController.onTabHung)),
  // the onTabLoadFailure self-subscription shape minus the bridge dependency
  // (this controller never imports bridge/document directly).
  function onTabHung({ wcId, hung }) {
    const tab = findTabByWcId(wcId);
    if (!tab) return;
    const rising = !!hung && !tab.hung;
    tab.hung = !!hung;
    // A FRESH hang episode clears any earlier dismissal (DD3: Wait hides for
    // THIS episode only; it reappears on the next unresponsive/responsive
    // cycle) — a falling edge (recovered) leaves hangDismissed untouched,
    // it is meaningless once hung is false.
    if (rising) tab.hangDismissed = false;
    refreshStrip(tab);
    project(tab);
  }

  // Wait: hides the bar for THIS hang episode only (DD3) — the next rising
  // edge (a fresh unresponsive after a responsive) re-shows it.
  els.hangNoticeWait.addEventListener('click', () => {
    if (!currentTab) return;
    currentTab.hangDismissed = true;
    project(currentTab);
  });

  // Kill and reload: `kill-reload` sequencing lives main-side (DD3) — sets
  // `killRequested`, force-crashes the renderer, and reloads on the
  // resulting render-process-gone, WHATEVER its reported reason (never the
  // crash panel).
  els.hangNoticeKill.addEventListener('click', () => {
    if (!currentTab || currentTab.wcId == null) return;
    tabNavigate({ wcId: currentTab.wcId, verb: 'kill-reload' });
  });

  return { project, onTabHung };
}
