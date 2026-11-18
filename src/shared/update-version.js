// Pure update-check decisions (Mission 23 Flight 3, leg `update-check`). The ONLY thing the app
// believes from GitHub's answer is `tag_name`, and only when it is a strict stable semantic
// version (`v` + MAJOR.MINOR.PATCH, no leading zeros, no prerelease, no build suffix). No text or
// address from the response is ever shown or opened: the release address is built here from the
// validated version alone. Never throws.

export const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/msieurthenardier/goldfinch/releases/latest';
// `owner/repo` — drift-guarded against package.json `build.publish`.
export const REPO_SLUG = 'msieurthenardier/goldfinch';
export const MAX_BODY_BYTES = 512 * 1024;
export const MAX_TAG_LENGTH = 64;

const NUM = '(0|[1-9][0-9]*)';
const STABLE_TAG = new RegExp('^v' + NUM + '\\.' + NUM + '\\.' + NUM + '$');
const STABLE_VERSION = new RegExp('^' + NUM + '\\.' + NUM + '\\.' + NUM + '$');
// The forms the app can be running: a stable core, optionally with a prerelease (no build part).
const RUNNING_VERSION = new RegExp('^' + NUM + '\\.' + NUM + '\\.' + NUM + '(?:-([0-9A-Za-z.-]+))?$');

/** @param {string[]} parts */
function coreOk(parts) {
  return parts.every((p) => Number.isSafeInteger(Number(p)));
}

/**
 * @param {unknown} tag
 * @returns {string | null} the bare version ("0.19.16") or null
 */
export function parseStableTag(tag) {
  if (typeof tag !== 'string' || tag.length > MAX_TAG_LENGTH) return null;
  const m = STABLE_TAG.exec(tag);
  if (!m || !coreOk([m[1], m[2], m[3]])) return null;
  return tag.slice(1);
}

/**
 * @param {unknown} version
 * @returns {{ core: number[], pre: string[] | null } | null}
 */
function parseRunning(version) {
  if (typeof version !== 'string' || version.length > MAX_TAG_LENGTH) return null;
  const m = RUNNING_VERSION.exec(version);
  if (!m || !coreOk([m[1], m[2], m[3]])) return null;
  const core = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (m[4] === undefined) return { core, pre: null };
  const pre = m[4].split('.');
  for (const id of pre) {
    if (id === '') return null;
    if (/^[0-9]+$/.test(id) && id.length > 1 && id[0] === '0') return null;
  }
  return { core, pre };
}

/**
 * True when `version` is a well-formed running version: MAJOR.MINOR.PATCH with an optional
 * prerelease and an optional build suffix (the release workflow's tag shape), at most 64
 * characters. For DISPLAY of the app's own version only; it takes no part in comparison.
 * @param {unknown} version
 * @returns {boolean}
 */
export function isWellFormedVersion(version) {
  if (typeof version !== 'string' || version.length > MAX_TAG_LENGTH) return false;
  const plus = version.indexOf('+');
  let core = version;
  if (plus !== -1) {
    const build = version.slice(plus + 1);
    if (!/^[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*$/.test(build)) return false;
    core = version.slice(0, plus);
  }
  return parseRunning(core) !== null;
}

/**
 * Semantic-version precedence. Returns -1, 0, 1, or null when either side is unparseable.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {-1 | 0 | 1 | null}
 */
export function compareVersions(a, b) {
  const pa = parseRunning(a);
  const pb = parseRunning(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  const n = Math.min(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === y) continue;
    const xn = /^[0-9]+$/.test(x);
    const yn = /^[0-9]+$/.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn) return -1;
    if (yn) return 1;
    return x < y ? -1 : 1;
  }
  if (pa.pre.length === pb.pre.length) return 0;
  return pa.pre.length < pb.pre.length ? -1 : 1;
}

/**
 * @param {unknown} available a bare stable version
 * @param {unknown} current the running version
 * @returns {boolean} false when either is unparseable
 */
export function isNewer(available, current) {
  if (typeof available !== 'string' || !STABLE_VERSION.test(available)) return false;
  return compareVersions(available, current) === 1;
}

/**
 * @param {unknown} version a bare stable version
 * @returns {string | null}
 */
export function releaseUrlFor(version) {
  if (typeof version !== 'string' || version.length > MAX_TAG_LENGTH) return null;
  const m = STABLE_VERSION.exec(version);
  if (!m || !coreOk([m[1], m[2], m[3]])) return null;
  return 'https://github.com/' + REPO_SLUG + '/releases/tag/v' + version;
}

/**
 * The installer file name for this machine and a stable version, or null when there is no direct
 * download (an Intel Mac, Linux on another architecture, a prerelease or malformed version). The
 * five names are the release workflow's own (`artifact-names.test.js` drift guard).
 * @param {{ platform?: unknown, arch?: unknown, appImage?: unknown, version?: unknown }} input
 * @returns {string | null}
 */
export function installerNameFor({ platform, arch, appImage, version } = {}) {
  if (releaseUrlFor(version) === null) return null;
  const v = /** @type {string} */ (version);
  if (platform === 'win32') return `Goldfinch-Setup-${v}.exe`;
  if (platform === 'darwin' && arch === 'arm64') return `Goldfinch-${v}-arm64.dmg`;
  if (platform === 'linux' && arch === 'x64') {
    return appImage ? `Goldfinch-${v}.AppImage` : `goldfinch_${v}_amd64.deb`;
  }
  return null;
}

/**
 * The release-download address, built from the constant slug, the re-validated version and the
 * installer name only (never from a response or an override). Null for a null name, a malformed
 * version, or a name that is not one `installerNameFor` returns for that version.
 * @param {unknown} name
 * @param {unknown} version
 * @returns {string | null}
 */
export function installerUrlFor(name, version) {
  if (typeof name !== 'string' || releaseUrlFor(version) === null) return null;
  const known = [
    `Goldfinch-Setup-${version}.exe`,
    `Goldfinch-${version}-arm64.dmg`,
    `Goldfinch-${version}.AppImage`,
    `goldfinch_${version}_amd64.deb`
  ];
  if (!known.includes(name)) return null;
  return 'https://github.com/' + REPO_SLUG + '/releases/download/v' + version + '/' + name;
}

/**
 * Reads the one field believed from a response body.
 * @param {unknown} bodyText
 * @returns {{ version: string } | { reason: 'too-large' | 'bad-json' | 'bad-tag' }}
 */
export function readLatestTag(bodyText) {
  if (typeof bodyText !== 'string') return { reason: 'bad-json' };
  if (new TextEncoder().encode(bodyText).length > MAX_BODY_BYTES) return { reason: 'too-large' };
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { reason: 'bad-json' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { reason: 'bad-json' };
  const version = parseStableTag(/** @type {any} */ (parsed).tag_name);
  if (version === null) return { reason: 'bad-tag' };
  return { version };
}
