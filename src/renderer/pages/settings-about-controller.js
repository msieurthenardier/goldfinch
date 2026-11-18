// @ts-check
// goldfinch://settings serves imports through an exact flat allowlist. This module carries no static
// import of its own — the pure model functions are injected by settings.js (the
// vault-filter-controller.js precedent) — so it needs only its own route in internal-page-map.js.

/** The locale's short formats (tests inject their own). */
const defaultFormat = {
  time: (/** @type {number} */ ms) => new Date(ms).toLocaleTimeString([], { timeStyle: 'short' }),
  date: (/** @type {number} */ ms) => new Date(ms).toLocaleDateString([], { dateStyle: 'medium' })
};

/**
 * settings-about-controller.js — the Settings -> About controller (Mission 23 F3 leg `update-notice`,
 * moved out of settings.js by sortie 09 leg `about-controller-and-dot` so it can be unit-tested).
 * Dependencies are injected: `document`, `window` (for `pagehide`), the internal `bridge`, and the pure
 * `updateNoticeModel` / `downloadResultHint`. Returns nothing; a missing bridge or core element makes
 * the call a no-op.
 *
 * @param {{ document: any, window: any, bridge: any, updateNoticeModel: (s: any) => any, downloadResultHint: (r: any) => string, checkNowView?: (state: any, pressing: boolean, lastAnswer: string | null, now: number, fmt: { time: (ms: number) => string, date: (ms: number) => string }) => { buttonDisabled: boolean, resultText: string, resultHidden: boolean, lastCheckedText: string }, now?: () => number, format?: { time: (ms: number) => string, date: (ms: number) => string } }} deps
 */
export function createAboutController({
  document,
  window,
  bridge,
  updateNoticeModel,
  downloadResultHint,
  checkNowView,
  now = Date.now,
  format = defaultFormat
}) {
  // Renders ONLY from main's validated update state, through the pure model. Patch-in-place
  // (textContent / hidden / aria-label) — the button is never rebuilt, so it keeps focus across a
  // push. The button calls the no-argument bridge method and nothing else; the page never fetches
  // or builds an address.
  if (!bridge) return;
  const versionEl = document.getElementById('about-version');
  const statusEl = document.getElementById('about-update-status');
  const btn = /** @type {HTMLButtonElement|null} */ (document.getElementById('about-update-open'));
  const check = /** @type {HTMLInputElement|null} */ (document.getElementById('update-check-enabled'));
  if (!versionEl || !statusEl || !btn || !check) return;
  // Leg `update-download`: fetched separately and tolerated absent, so the early return above never
  // depends on them (a page without them still shows the notice and the release-page button).
  const dlBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('about-update-download'));
  const hintEl = document.getElementById('about-update-hint');

  // Check now (sortie 09): optional elements, like the download pair. `pressing` is the in-flight flag
  // (never twice concurrently from this page); `lastAnswer` is the latest answer to THIS page's press;
  // `lastState` is the latest state rendered, so an answer can re-render without a push.
  const checkBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('about-check-now'));
  const resultEl = document.getElementById('about-check-result');
  const lastEl = document.getElementById('about-last-checked');
  let pressing = false;
  /** @type {string | null} */
  let lastAnswer = null;
  let lastState = null;
  // Which check `lastAnswer` belongs to, by `lastCheck.at`: `answerAt` is that check's time (null = none
  // recorded), `adoptFrom` is set (to the `at` seen at press time) when the answer arrived BEFORE its own
  // check's push, so the next push carrying a different `at` is that check and is adopted, not a reason to
  // clear. A push whose `at` is neither means another check happened: the old line is stale and goes.
  let answerAt = null;
  /** @type {{ from: any } | null} */
  let adoptFrom = null;
  let pressBaseAt = null;
  let prevShowNotice = false;
  const atOf = (/** @type {any} */ s) =>
    s && s.lastCheck && typeof s.lastCheck.at === 'number' ? s.lastCheck.at : null;

  function renderCheck() {
    if (!checkBtn || !resultEl || !lastEl || !checkNowView) return;
    const v = checkNowView(lastState, pressing, lastAnswer, now(), format);
    if (checkBtn.disabled !== v.buttonDisabled) checkBtn.disabled = v.buttonDisabled;
    if (resultEl.textContent !== v.resultText) resultEl.textContent = v.resultText;
    resultEl.hidden = v.resultHidden;
    if (lastEl.textContent !== v.lastCheckedText) lastEl.textContent = v.lastCheckedText;
  }

  let pushed = false;
  // The hint after a click (started / could not start). It survives state pushes while the button is
  // shown, and is dropped when the button goes away (notice cleared or no direct installer) or when
  // the available version / installer name changes.
  /** @type {string | null} */
  let hintOverride = null;
  // What the state said (`available` + `downloadName`) when the override was set, and what it says now:
  // a push that changes either drops the override (it describes the old version's download).
  let overrideKey = '';
  let stateKey = '';

  function render(state) {
    const m = updateNoticeModel(state);
    lastState = state;
    if (lastAnswer !== null) {
      const at = atOf(state);
      if (adoptFrom) {
        if (at !== adoptFrom.from) {
          answerAt = at;
          adoptFrom = null;
        }
      } else if (at !== answerAt) lastAnswer = null;
      if (prevShowNotice && !m.showNotice) lastAnswer = null;
    }
    prevShowNotice = m.showNotice;
    stateKey = JSON.stringify([state && state.available, state && state.downloadName]);
    if (hintOverride !== null && overrideKey !== stateKey) hintOverride = null;
    if (versionEl.textContent !== m.versionText) versionEl.textContent = m.versionText;
    if (statusEl.textContent !== m.noticeText) statusEl.textContent = m.noticeText;
    if (btn.textContent !== m.openLabel && m.showNotice) btn.textContent = m.openLabel;
    if (m.showNotice) btn.setAttribute('aria-label', m.openAriaLabel);
    else btn.removeAttribute('aria-label');
    const hadFocus = document.activeElement === btn;
    const dlHadFocus = !!dlBtn && document.activeElement === dlBtn;
    statusEl.hidden = !m.showNotice;
    btn.hidden = !m.showNotice;
    if (dlBtn) {
      if (m.showDownload) {
        if (dlBtn.textContent !== m.downloadLabel) dlBtn.textContent = m.downloadLabel;
        dlBtn.setAttribute('aria-label', m.downloadAriaLabel);
      } else {
        dlBtn.removeAttribute('aria-label');
      }
      dlBtn.hidden = !m.showDownload;
    }
    if (hintEl) {
      const text = m.showNotice && hintOverride !== null && m.showDownload ? hintOverride : m.hintText;
      if (hintEl.textContent !== text) hintEl.textContent = text;
      hintEl.hidden = !m.showNotice;
    }
    if (!m.showNotice || !m.showDownload) hintOverride = null;
    // A hidden focused control drops focus to the document: move it to the checkbox instead
    // (or, when only the download button goes away, to the release-page button).
    if (hadFocus && !m.showNotice) check.focus();
    else if (dlHadFocus && !m.showDownload) (m.showNotice ? btn : check).focus();
    renderCheck();
  }

  render(null);
  if (typeof bridge.updateGetState === 'function') {
    bridge
      .updateGetState()
      .then((s) => {
        // A push that already arrived is newer than this boot read.
        if (!pushed) render(s);
      })
      .catch(() => {});
  }
  if (typeof bridge.onUpdateStateChanged === 'function') {
    const hUpdate = bridge.onUpdateStateChanged((s) => {
      pushed = true;
      render(s);
    });
    window.addEventListener('pagehide', () => bridge.offUpdateStateChanged?.(hUpdate), { once: true });
  }

  btn.addEventListener('click', () => {
    bridge.updateOpenReleasePage().catch(() => {});
  });

  // The call takes NO argument: main builds the address and starts one ordinary download. The hint
  // shows main's answer (`name` is what main downloaded, which a push between render and click can
  // change); the button stays enabled so a second click is simply answered by main.
  if (dlBtn && hintEl) {
    dlBtn.addEventListener('click', () => {
      const show = (/** @type {any} */ result) => {
        hintOverride = downloadResultHint(result);
        overrideKey = stateKey;
        hintEl.textContent = hintOverride;
      };
      if (typeof bridge.updateDownload !== 'function') return show(null);
      bridge.updateDownload().then(show, () => show(null));
    });
  }

  if (checkBtn) {
    checkBtn.addEventListener('click', () => {
      if (pressing || typeof checkNowView !== 'function') return;
      // A disabled button may drop focus: remember it and hand it back once the answer re-enables it.
      const refocus = document.activeElement === checkBtn;
      pressing = true;
      lastAnswer = null;
      adoptFrom = null;
      pressBaseAt = atOf(lastState);
      renderCheck();
      /** @type {Promise<any>} */
      let call;
      try {
        call = Promise.resolve(bridge.updateCheckNow());
      } catch {
        call = Promise.reject(new Error('unavailable'));
      }
      call
        .then(
          (r) =>
            r && typeof r === 'object' && typeof r.outcome === 'string'
              ? { outcome: r.outcome, real: true }
              : { outcome: 'failed', real: false },
          () => ({ outcome: 'failed', real: false })
        )
        .then(({ outcome, real }) => {
          pressing = false;
          lastAnswer = outcome;
          // Only an answer to a check that actually ran has a push of its own coming.
          const ran = real && (outcome === 'newer' || outcome === 'current' || outcome === 'failed');
          const nowAt = atOf(lastState);
          if (ran && nowAt === pressBaseAt) {
            adoptFrom = { from: pressBaseAt };
          } else {
            answerAt = nowAt;
            adoptFrom = null;
          }
          renderCheck();
          if (refocus && !checkBtn.disabled) checkBtn.focus();
        });
    });
  }

  // The checkbox follows the stored setting (never .click()/dispatchEvent — that would echo).
  // A push seen before the boot read resolves wins (the read is older); a rejected write reverts
  // the box to the last known stored value.
  let checkPushSeen = false;
  let checkKnown = false;
  bridge
    .settingsGet('updateCheckEnabled')
    .then((v) => {
      if (checkPushSeen) return;
      checkKnown = v === true;
      check.checked = checkKnown;
    })
    .catch(() => {});
  check.addEventListener('change', () => {
    bridge.settingsSet('updateCheckEnabled', !!check.checked).catch(() => {
      check.checked = checkKnown;
    });
  });
  const hSettings = bridge.onSettingsChanged((all) => {
    if (all && typeof all.updateCheckEnabled === 'boolean') {
      checkPushSeen = true;
      checkKnown = all.updateCheckEnabled;
      check.checked = checkKnown;
    }
  });
  window.addEventListener('pagehide', () => bridge.offSettingsChanged(hSettings), { once: true });
}
