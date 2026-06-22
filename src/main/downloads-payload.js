// @ts-check
'use strict';

// Pure, electron-free builders for the download record + 'download-progress'/'download-done'
// broadcast payloads (Flight 6, DD4). Extracted from wireDownloadHandler so the two Flight-5
// HAT-fix reads are unit-testable. Built to take INJECTED ACCESSORS (the live DownloadItem's
// methods in production, fakes in tests) so a unit test covers the *reads*, not just assembly.
//
// ELECTRON PAUSED FACT (load-bearing, re-tripped ~6 places): a paused DownloadItem keeps
// getState() === 'progressing'. The ONLY source of truth for paused is item.isPaused(). So the
// payload reads `paused` from isPaused() and NEVER derives it from getState(). (Flight-5 HAT.)
//
// FILENAME FACT: the display filename is basename(getSavePath()) — the deduped/sanitized on-disk
// name (uniquePath adds " (n)") — NOT item.getFilename() (the original server-suggested name).
// (Flight-5 HAT wrong-filename fix.)

const path = require('path');

/**
 * The subset of Electron.DownloadItem methods these builders read. In production the live
 * `item` IS an accessor bag (it has all these methods); the handler passes `item` directly.
 * In tests, pass a plain object of fake methods. Optional methods mirror today's optional-call
 * (`item.getMimeType?.()` / `item.isPaused?.()` / `item.getState?.()`) semantics.
 *
 * @typedef {object} DownloadItemAccessors
 * @property {() => string} getSavePath    Final on-disk path (set via setSavePath BEFORE register).
 * @property {() => boolean} [isPaused]     Electron exposes paused ONLY here (see top note).
 * @property {() => string} [getState]      Note: stays 'progressing' while paused — do NOT derive paused from it.
 * @property {() => number} getReceivedBytes
 * @property {() => number} getTotalBytes
 * @property {() => (string|undefined)} [getMimeType]
 */

/**
 * The display filename = basename(getSavePath()) — the deduped on-disk name, NOT getFilename().
 * @param {DownloadItemAccessors} acc
 * @returns {string}
 */
function displayFilename(acc) {
  return path.basename(acc.getSavePath());
}

/**
 * The manager.register({ url, filename, savePath, mime, startTime }) arg shape.
 * `mime` uses optional-call semantics (absent accessor → undefined), which register drops via
 * its `typeof mime === 'string'` guard — byte-identical to today's `item.getMimeType?.()`.
 * @param {DownloadItemAccessors} acc
 * @param {{ url: string, startTime: number }} fixed
 */
function buildRegisterRecord(acc, { url, startTime }) {
  return {
    url,
    filename: displayFilename(acc),
    savePath: acc.getSavePath(),
    mime: acc.getMimeType ? acc.getMimeType() : undefined,
    startTime
  };
}

/**
 * The 'download-progress' broadcast payload (and the source of the manager.update patch).
 * `paused` is read from isPaused() (the only source of truth — see top note), with optional-call
 * semantics (absent accessor → undefined) matching today's `item.isPaused?.()`.
 * @param {DownloadItemAccessors} acc
 * @param {{ id: number, url: string, state: string }} fixed
 */
function buildProgressPayload(acc, { id, url, state }) {
  return {
    id,
    url,
    filename: displayFilename(acc),
    state,
    received: acc.getReceivedBytes(),
    total: acc.getTotalBytes(),
    paused: acc.isPaused ? acc.isPaused() : undefined
  };
}

/**
 * The 'download-done' broadcast payload. savePath is the real path only on 'completed';
 * any non-completed terminal state yields null and getSavePath() is NOT called.
 * @param {DownloadItemAccessors} acc
 * @param {{ id: number, url: string, state: string }} fixed
 */
function buildDonePayload(acc, { id, url, state }) {
  const savePath = state === 'completed' ? acc.getSavePath() : null;
  return { id, url, filename: displayFilename(acc), state, savePath };
}

module.exports = { displayFilename, buildRegisterRecord, buildProgressPayload, buildDonePayload };
