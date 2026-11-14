// @ts-check
'use strict';

// Main-side validation of the media list a guest page sends (`guest-media-list`).
//
// The list is page-controlled data: the chrome renders it (thumbnails, a docked player, download
// buttons), so it is rebuilt here from an explicit field list before the chrome ever sees it.
// Electron-free and pure; never throws. A page that sends garbage gets an empty panel, nothing more.
//
// What survives: items whose `url` is `http:` / `https:`; image items whose `url` is a `data:` URL of
// a raster image type (the one inline scheme the panel renders without a fetch). Everything else
// (`goldfinch-media:`, `file:`, `ftp:`, `javascript:`, `blob:`, `about:`, custom schemes, `data:`
// non-images, SVG) is dropped. Length checks run BEFORE any URL parsing.

/** Most items kept from one list; the rest are cut. */
const MAX_ITEMS = 2000;
/** Longest accepted web (`http(s):`) URL, in characters. Checked before parsing. */
const MAX_WEB_URL_LENGTH = 2048;
/** Longest accepted `data:` image URL, in characters (~192 KiB of payload once base64-decoded). */
const MAX_DATA_URL_LENGTH = 262144;
/** Longest accepted `name` / `label` / `alt`, in characters. */
const MAX_TEXT_LENGTH = 256;
/** Largest accepted `width` / `height`. */
const MAX_DIMENSION = 1e6;

const ITEM_TYPES = new Set(['image', 'video', 'audio', 'embed']);

// Raster image types only. SVG is excluded on purpose (it can carry script and external references).
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg|gif|webp|avif|bmp)(?:;[^,]*)?,/i;

/**
 * `true` for a string that parses as an `http:` or `https:` URL (length-capped before parsing).
 * @param {unknown} value
 * @returns {boolean}
 */
function isWebUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_WEB_URL_LENGTH) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The raster subtype (`png`, `jpeg`, ...) of an allowed `data:` image URL, else `null`. Length-capped
 * and matched on the prefix only - the payload is never parsed.
 * @param {unknown} value
 * @returns {string | null}
 */
function dataImageType(value) {
  if (typeof value !== 'string' || value.length > MAX_DATA_URL_LENGTH) return null;
  const m = DATA_IMAGE_RE.exec(value);
  return m ? m[1].toLowerCase() : null;
}

/**
 * `true` for a `blob:` URL (length-capped before parsing). A blob URL resolves only inside the document
 * and session that made it, so it can never name another jar's data.
 * @param {unknown} value
 * @returns {boolean}
 */
function isBlobUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_WEB_URL_LENGTH) return false;
  try {
    return new URL(value).protocol === 'blob:';
  } catch {
    return false;
  }
}

/**
 * What `download-media` accepts: `http:`, `https:`, `blob:` and a raster `data:` image - the schemes the
 * media panel and the page context menu's save-image legitimately hand over. Everything else (`file:`,
 * `ftp:`, `goldfinch-media:`, SVG `data:`, custom schemes) is refused.
 * @param {unknown} value
 * @returns {boolean}
 */
function isDownloadableMediaUrl(value) {
  return isWebUrl(value) || isBlobUrl(value) || dataImageType(value) !== null;
}

/**
 * Own-property read: an inherited (prototype-polluted) value is invisible.
 * @param {any} obj
 * @param {string} key
 */
function own(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

/** @param {unknown} v @returns {string | undefined} */
function text(v) {
  return typeof v === 'string' ? v.slice(0, MAX_TEXT_LENGTH) : undefined;
}

/** @param {unknown} v @returns {number | undefined} */
function dimension(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_DIMENSION ? v : undefined;
}

/**
 * @param {any} raw
 * @returns {Record<string, any> | null}
 */
function validateItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = own(raw, 'type');
  if (typeof type !== 'string' || !ITEM_TYPES.has(type)) return null;
  const rawUrl = own(raw, 'url');

  /** @type {Record<string, any>} */
  const item = { type };
  const dataType = type === 'image' ? dataImageType(rawUrl) : null;
  if (dataType) {
    item.url = rawUrl;
    // A data: URL's derived name is its whole payload; never let that become a file name.
    item.name = `image.${dataType}`;
  } else if (isWebUrl(rawUrl)) {
    item.url = new URL(rawUrl).href;
    const name = text(own(raw, 'name'));
    item.name = name !== undefined && name !== '' ? name : new URL(rawUrl).hostname;
  } else {
    return null;
  }

  const width = dimension(own(raw, 'width'));
  const height = dimension(own(raw, 'height'));
  const alt = text(own(raw, 'alt'));
  const label = text(own(raw, 'label'));
  const poster = own(raw, 'poster');
  if (width !== undefined) item.width = width;
  if (height !== undefined) item.height = height;
  if (alt !== undefined) item.alt = alt;
  if (label !== undefined) item.label = label;
  if (isWebUrl(poster)) item.poster = new URL(poster).href;
  return item;
}

/**
 * Turn whatever the guest sent into a clean list (possibly empty). Never throws.
 * @param {unknown} raw
 * @returns {Array<Record<string, any>>}
 */
function validateMediaList(raw) {
  /** @type {Array<Record<string, any>>} */
  const out = [];
  try {
    if (!Array.isArray(raw)) return out;
    const n = Math.min(raw.length, MAX_ITEMS);
    for (let i = 0; i < n; i++) {
      try {
        const item = validateItem(raw[i]);
        if (item) out.push(item);
      } catch {
        // a hostile getter or exotic object: this item is dropped, the rest are judged on their own
      }
    }
  } catch {
    return [];
  }
  return out;
}

module.exports = {
  validateMediaList,
  isWebUrl,
  isBlobUrl,
  isDownloadableMediaUrl,
  dataImageType,
  MAX_ITEMS,
  MAX_WEB_URL_LENGTH,
  MAX_DATA_URL_LENGTH,
  MAX_TEXT_LENGTH
};
