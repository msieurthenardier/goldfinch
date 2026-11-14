'use strict';

// The pure decision behind "only a real click raises the vault picker" (Mission 23 Flight 1, leg
// `vault-fill-trust`, revised DD4). Electron-free; every input is an argument.
//
// WHY MAIN WITNESSES THE CLICK. Web guests run `contextIsolation:false`, so nothing the page-side
// icon code reads about an event (`isTrusted`, `target`, ...) can be believed: a page can spoof it,
// and can send the gesture message itself with no click at all. Main, by contrast, sees the guest's
// REAL input through `webContents.on('input-event')` (fired for real input only, ahead of the page,
// with no page code involved; measured in the product build, see the flight log). The page-side
// message is therefore only a HINT; this function decides whether main's own witnessed input agrees.
//
// STATED RESIDUAL (also in docs/vault.md). The icon's box in the message is PAGE-SUPPLIED. A page that
// sends the message itself can claim a box around any real click the operator made on that page. It
// cannot raise the sheet with no click, from a background tab, or more than once per click. With the
// page-world trust check gone a page can also choose which of ITS OWN fields is the fill target; the
// credential still reaches only that page. The picker's own controls (leg `vault-picker-controls`)
// are the defence against a misdirected click.

/** A witnessed real click is usable for this long after its release (milliseconds). */
const WITNESS_WINDOW_MS = 2000;
/** At most one accepted gesture of a kind per tab per this interval (milliseconds). */
const RATE_INTERVAL_MS = 1000;
/** The fill icon's real size in CSS pixels (drift-guarded against `vault-fill-icon.js`). */
const ICON_WIDTH = 30;
const ICON_HEIGHT = 16;
/** A reported box may be at most this many times the icon's real size in either dimension (a
 * transformed ancestor inflates the measured box; beyond this it is not the icon). */
const BOX_MAX_FACTOR = 4;
/** Slack, in view pixels AFTER scaling by the zoom factor, when testing a point against the box:
 * Chromium rounds `clientX` to integers, which at zoom 0.67 is up to about one view pixel. */
const BOX_TOLERANCE_PX = 2;

/**
 * @typedef {{ x: number, y: number, t: number }} PointStamp  view-local coordinates and a monotonic time (ms)
 * @typedef {{ leftDown: PointStamp | null, leftUp: PointStamp | null, rightDown: PointStamp | null }} WitnessRecord
 * @typedef {'gesture' | 'icon-menu'} GestureKind
 * @typedef {'origin' | 'no-real-input' | 'bad-box' | 'outside-box' | 'rate'} RefusalReason
 */

/** @returns {WitnessRecord} */
function emptyRecord() {
  return { leftDown: null, leftUp: null, rightDown: null };
}

/**
 * The box the guest reported, or `null` when it is not four finite numbers describing a plausible icon
 * (positive size, no larger than `BOX_MAX_FACTOR` times the icon in either dimension).
 * @param {unknown} message  the IPC payload
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
function readBox(message) {
  const raw = message && typeof message === 'object' ? /** @type {any} */ (message).box : null;
  if (!raw || typeof raw !== 'object') return null;
  const { x, y, width, height } = raw;
  for (const n of [x, y, width, height]) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  }
  if (width <= 0 || height <= 0) return null;
  if (width > ICON_WIDTH * BOX_MAX_FACTOR || height > ICON_HEIGHT * BOX_MAX_FACTOR) return null;
  return { x, y, width, height };
}

/**
 * Whether a view-local point lies inside the page-reported box once the box is scaled by the tab's LIVE
 * zoom factor (view coordinates are `clientX x zoomFactor`), with the stated tolerance.
 * @param {PointStamp} point
 * @param {{ x: number, y: number, width: number, height: number }} box  CSS pixels
 * @param {number} zoom
 */
function boxContains(point, box, zoom) {
  const left = box.x * zoom - BOX_TOLERANCE_PX;
  const top = box.y * zoom - BOX_TOLERANCE_PX;
  const right = (box.x + box.width) * zoom + BOX_TOLERANCE_PX;
  const bottom = (box.y + box.height) * zoom + BOX_TOLERANCE_PX;
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}

/** @param {PointStamp | null} stamp @param {number} now */
function withinWindow(stamp, now) {
  return !!stamp && now >= stamp.t && now - stamp.t <= WITNESS_WINDOW_MS;
}

/**
 * Decide one gesture message. Checked IN THIS ORDER; the first failure names the refusal:
 *   1. `origin`        - the tab's committed origin is not an http(s) tuple origin (`origin` is null);
 *   2. `no-real-input` - no real input within the window: for `gesture`, a left-button release inside
 *                        the window whose press is on record at or before it; for `icon-menu`, a
 *                        right-button PRESS inside the window (press only - the platform decides
 *                        whether `contextmenu` fires on press or release);
 *   3. `bad-box`       - the message carries no plausible box;
 *   4. `outside-box`   - the scaled box does not contain the witnessed point(s) (press AND release for
 *                        a gesture);
 *   5. `rate`          - an acceptance of this kind for this tab happened less than the interval ago.
 * Injected clicks have press and release in the SAME instant: ordering is checked, never a duration.
 * Pure: it neither reads a clock nor mutates the record; the caller consumes on acceptance only.
 *
 * @param {{ kind: GestureKind, record: WitnessRecord | null | undefined, message: unknown, zoom: number,
 *   now: number, origin: string | null, lastAcceptedAt: number | null | undefined }} arg
 * @returns {{ ok: true } | { ok: false, reason: RefusalReason }}
 */
function verifyGesture({ kind, record, message, zoom, now, origin, lastAcceptedAt }) {
  if (typeof origin !== 'string' || origin.length === 0) return { ok: false, reason: 'origin' };
  const rec = record || emptyRecord();
  /** @type {PointStamp[]} */
  let points;
  if (kind === 'icon-menu') {
    if (!withinWindow(rec.rightDown, now)) return { ok: false, reason: 'no-real-input' };
    points = [/** @type {PointStamp} */ (rec.rightDown)];
  } else {
    const up = rec.leftUp;
    const down = rec.leftDown;
    if (!withinWindow(up, now) || !down || !up || down.t > up.t) return { ok: false, reason: 'no-real-input' };
    points = [down, up];
  }
  const box = readBox(message);
  if (!box) return { ok: false, reason: 'bad-box' };
  const z = typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  for (const p of points) {
    if (!boxContains(p, box, z)) return { ok: false, reason: 'outside-box' };
  }
  if (typeof lastAcceptedAt === 'number' && now - lastAcceptedAt < RATE_INTERVAL_MS) {
    return { ok: false, reason: 'rate' };
  }
  return { ok: true };
}

module.exports = {
  WITNESS_WINDOW_MS,
  RATE_INTERVAL_MS,
  ICON_WIDTH,
  ICON_HEIGHT,
  BOX_MAX_FACTOR,
  BOX_TOLERANCE_PX,
  emptyRecord,
  readBox,
  boxContains,
  verifyGesture
};
