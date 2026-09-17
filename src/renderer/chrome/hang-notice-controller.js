// The hang notice's own controller (Mission 20 Flight 3 Leg 2, DD3). A
// non-blocking bar between the toolbar/bookmarks-bar and #main, shown while
// the ACTIVE tab's renderer is unresponsive, cleared the moment it answers
// again. Unlike load-failure-controller.js this controller builds no DOM —
// #hang-notice's text and two buttons are static markup in index.html (no
// per-item data to render), so this file only toggles visibility and drives
// Wait / Kill-and-reload.

// HAT H3 follow-up fix (Leg 5): the forced kill of a busy renderer takes
// several seconds to land (Chromium's own force-crash + respawn), so the
// click otherwise appears to do nothing. HUNG_MESSAGE is the bar's own
// steady-state copy — the exact text index.html ships as #hang-notice-text's
// initial content — so endKilling() can restore it byte-for-byte without
// reading the DOM back (a read-back would be a no-op in the fake-DOM harness
// anyway, since FakeElement's textContent getter returns whatever was last
// SET, never index.html's literal).
const HUNG_MESSAGE = "This page isn't responding";
const KILLING_MESSAGE = 'Stopping the page…';

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
  // killing: true from the Kill click until this episode's tab-hung-false
  // push or its next committed navigation lands (endKilling() below) — NOT
  // cleared by applyVisibility/project on its own, since the bar deliberately
  // stays VISIBLE (still showing the "Stopping the page…" text) through the
  // whole kill-and-respawn window; only the two clearing events below end it.
  let killing = false;

  // beginKilling()/endKilling(): the ONLY writers of #hang-notice-text's
  // textContent, the two buttons' `disabled`, and #hang-notice's
  // `data-state` — the load-failure-controller.js `dataset.failureKind`
  // idiom (assign/`delete …dataset.state`, never toggle a `.hidden` class on
  // this pair, since both buttons stay visible-but-inert while killing).
  function beginKilling() {
    killing = true;
    els.hangNoticeText.textContent = KILLING_MESSAGE;
    els.hangNoticeWait.disabled = true;
    els.hangNoticeKill.disabled = true;
    els.hangNotice.dataset.state = 'killing';
  }

  function endKilling() {
    if (!killing) return;
    killing = false;
    els.hangNoticeText.textContent = HUNG_MESSAGE;
    els.hangNoticeWait.disabled = false;
    els.hangNoticeKill.disabled = false;
    delete els.hangNotice.dataset.state;
  }

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
    // HAT H3 follow-up fix: a falling edge (recovered) for the tab the bar is
    // CURRENTLY showing/killing ends the pending-kill state — checked BEFORE
    // project() below, since project() may null out currentTab on this very
    // call (shouldShow becomes false once tab.hung flips). A falling edge for
    // some OTHER (background) tab must never touch this bar's own state.
    if (!hung && tab === currentTab) endKilling();
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
  // edge (a fresh unresponsive after a responsive) re-shows it. Inert (and
  // `disabled` in the DOM) while killing — no explicit guard needed here
  // beyond the disabled attribute, since Kill's own handler already refuses
  // a second click.
  els.hangNoticeWait.addEventListener('click', () => {
    if (!currentTab) return;
    currentTab.hangDismissed = true;
    project(currentTab);
  });

  // Kill and reload: `kill-reload` sequencing lives main-side (DD3) — sets
  // `killRequested`, force-crashes the renderer, and reloads on the
  // resulting render-process-gone, WHATEVER its reported reason (never the
  // crash panel). HAT H3 follow-up fix: the forced kill takes several
  // seconds to land, so beginKilling() gives synchronous, visible feedback
  // (text + disabled buttons + data-state) BEFORE the verb is even sent — a
  // second click while `killing` is a harmless no-op (never a second
  // tabNavigate call for the same episode).
  els.hangNoticeKill.addEventListener('click', () => {
    if (!currentTab || currentTab.wcId == null || killing) return;
    beginKilling();
    tabNavigate({ wcId: currentTab.wcId, verb: 'kill-reload' });
  });

  // onTabDidNavigate(tab): HAT H2b fix — the load-failure-controller.js
  // sibling hook. A renderer that just committed a navigation has answered,
  // so it cannot still be hung; clears a (possibly synthetic,
  // showHangNoticeForAudit-stamped) hung/dismissed state that main's own
  // did-start-navigation clear-and-push-false never reaches, since that push
  // only fires for entries main itself stamped. A real hang is already
  // cleared by main's `tab-hung false` push by the time did-navigate fires,
  // so this is a harmless no-op in that case.
  // HAT H3 follow-up fix: also ends a pending-kill state for this same
  // bar — a committed navigation is the OTHER clearing event named in the
  // fix (alongside the tab-hung-false push above).
  /** @param {any} tab */
  function onTabDidNavigate(tab) {
    if (!tab || !tab.hung) return;
    if (tab === currentTab) endKilling();
    tab.hung = false;
    tab.hangDismissed = false;
    refreshStrip(tab);
    project(tab);
  }

  return { project, onTabHung, onTabDidNavigate };
}
