// @ts-check
'use strict';

// Mission 20 Flight 3 Leg 3 (DD7 — operator constraint): a local, append-only
// record of every crash/hang recovery event. The field set is CLOSED — see
// `record()`'s object literal below, source-scan pinned by
// `test/unit/crash-log.test.js` — and can never carry a full URL, path,
// query, fragment, userinfo, title, jar name, cookie, header, or page
// content. Electron-free: every host dependency (`dir`, `fs`, `now`) is
// injected so the module runs offline under `node --test`.

const path = require('path');
const { isBurnerPartition } = require('../shared/burner');
const { INTERNAL_PARTITION } = require('../shared/internal-page');

const CRASH_LOG_FILE = 'crash-log.jsonl';

// DD7's enum, amended (flight-log Decision) to include the popup site's
// `closed` value. An unrecognized value never reaches disk as itself —
// `record()` folds it to the safest member, `ignored`.
const RECOVERY_VALUES = new Set(['panel', 'reloaded', 'paused', 'ignored', 'closed']);

/**
 * Scheme + host + non-default port of `url`, with EVERYTHING else stripped —
 * path, query, fragment, and userinfo are never read into the return value
 * (a burner tab returns `null` regardless of url; an unparsable/empty url
 * returns `null`). `goldfinch://host` is reconstructed by hand because
 * Node's `new URL(...).origin` returns the literal string `'null'` for a
 * non-special custom scheme (the CLAUDE.md Node-vs-Blink gotcha) — Blink's
 * own frame-origin serialization is what the rest of the app matches
 * against, and this mirrors that shape for the log instead.
 * @param {string | null | undefined} url
 * @param {string | null | undefined} partition
 * @returns {string | null}
 */
function originOf(url, partition) {
  if (isBurnerPartition(partition)) return null;
  if (typeof url !== 'string' || url.length === 0) return null;
  /** @type {URL | null} */
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.origin;
  if (parsed.protocol === 'goldfinch:') return `${parsed.protocol}//${parsed.host}`;
  return null;
}

/**
 * @param {string | null | undefined} partition
 * @returns {'persistent' | 'burner' | 'internal' | null}
 */
function jarKindOf(partition) {
  if (partition == null) return null;
  if (partition === INTERNAL_PARTITION) return 'internal';
  if (isBurnerPartition(partition)) return 'burner';
  return 'persistent';
}

/**
 * @param {{ dir: string, fs: typeof import('fs'), now: () => Date, cap?: number, keepDumps?: number, logger?: { warn: (...a: any[]) => void } }} deps
 */
function createCrashLog({ dir, fs, now, cap = 200, keepDumps = 20, logger }) {
  const filePath = path.join(dir, CRASH_LOG_FILE);

  /**
   * Rotation: on a write that pushes the file over `cap` lines, keep only
   * the newest `cap / 2`. Fail-soft — a read/write failure here must never
   * escape into the caller (`record` already wraps this in its own
   * try/catch, but this is defensive in its own right too).
   */
  function rotateIfNeeded() {
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      const lines = text.split('\n').filter((l) => l.length > 0);
      if (lines.length > cap) {
        const kept = lines.slice(-Math.floor(cap / 2));
        fs.writeFileSync(filePath, kept.join('\n') + '\n');
      }
    } catch {
      // best-effort only — never throw into record()'s caller
    }
  }

  /**
   * Appends exactly one JSON line with the CLOSED field set. Destructures
   * its input (never spreads it) so no caller can smuggle an extra field —
   * a title, a jar name, page content — through to disk. Never throws.
   * @param {{ kind: string, reason?: any, exitCode?: any, url?: string | null, partition?: string | null, windowId?: number | null, recovery?: string }} input
   */
  function record(input) {
    try {
      const { kind, reason, exitCode, url, partition, windowId, recovery } = input || {};
      /** @type {{ ts: string, kind: any, reason: any, exitCode: any, origin: string | null, jarKind: string | null, windowId: number | null, recovery: string }} */
      const entry = {
        ts: now().toISOString(),
        kind,
        reason,
        exitCode,
        origin: originOf(url, partition),
        jarKind: jarKindOf(partition),
        windowId: windowId ?? null,
        recovery: RECOVERY_VALUES.has(recovery) ? recovery : 'ignored'
      };
      fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
      logger?.warn?.('[crash-log]', entry.kind, entry.reason, entry.recovery);
      rotateIfNeeded();
    } catch (err) {
      logger?.warn?.('[crash-log] record failed:', err && /** @type {any} */ (err.message || err));
    }
  }

  /**
   * Deletes `*.dmp` files (plus each one's `.meta` sibling, if present)
   * under `dumpDir` except the newest `keepDumps`, sorted by mtime.
   *
   * `dumpDir` is `app.getPath('crashDumps')`, which on Linux/Windows with
   * Crashpad IS the Crashpad database directory itself — confirmed against
   * a live dev profile, whose dumps sit at `<dumpDir>/pending`,
   * `<dumpDir>/completed`, and `<dumpDir>/new`, never a nested
   * `<dumpDir>/Crashpad/...` — so those three are probed directly under
   * the given root; the root itself is also probed flat (tolerates a
   * Breakpad-style flat layout, or any other caller). Fail-soft throughout:
   * an absent subdirectory (no crash of that kind yet) is skipped, and the
   * whole call never throws into `app.ready`.
   * @param {string} dumpDir
   */
  function pruneDumps(dumpDir) {
    try {
      /** @type {{ dmp: string, meta: string | null, mtime: number }[]} */
      const candidates = [];
      const probe = (/** @type {string} */ d) => {
        try {
          for (const name of fs.readdirSync(d)) {
            if (!name.endsWith('.dmp')) continue;
            const full = path.join(d, name);
            try {
              const mtime = fs.statSync(full).mtimeMs;
              const metaPath = full.slice(0, -'.dmp'.length) + '.meta';
              let meta = null;
              try {
                fs.statSync(metaPath);
                meta = metaPath;
              } catch {
                // no matching .meta sibling — nothing to remove alongside
              }
              candidates.push({ dmp: full, meta, mtime });
            } catch {
              // vanished between readdir and stat — skip
            }
          }
        } catch {
          // directory absent — nothing to probe
        }
      };
      probe(dumpDir);
      probe(path.join(dumpDir, 'pending'));
      probe(path.join(dumpDir, 'completed'));
      probe(path.join(dumpDir, 'new'));
      candidates.sort((a, b) => a.mtime - b.mtime);
      const excess = candidates.length - keepDumps;
      if (excess <= 0) return;
      const toRemove = candidates.slice(0, excess);
      for (const c of toRemove) {
        try {
          fs.unlinkSync(c.dmp);
        } catch {
          // best effort
        }
        if (c.meta) {
          try {
            fs.unlinkSync(c.meta);
          } catch {
            // best effort
          }
        }
      }
      logger?.warn?.('[crash-log] pruned', toRemove.length, 'dumps');
    } catch {
      // fail-soft — pruning must never throw into app.ready
    }
  }

  return { record, pruneDumps };
}

// Mission 20 Flight 3 Leg 3 (DD2/DD7): `app.on('child-process-gone')`'s
// `details.type` is Electron's own capitalised vocabulary
// ('GPU' | 'Utility' | 'Zygote' | 'Sandbox helper' | 'Pepper Plugin' |
// 'Pepper Plugin Broker' | 'Unknown'). An EXPLICIT table, never a
// `.toLowerCase()` shortcut — every value not named `GPU`/`Utility` folds to
// `other` regardless of what future Electron versions add to the list.
const CHILD_PROCESS_KIND_TABLE = { GPU: 'gpu', Utility: 'utility' };

/**
 * @param {string | null | undefined} type
 * @returns {'gpu' | 'utility' | 'other'}
 */
function kindOfChildProcess(type) {
  return CHILD_PROCESS_KIND_TABLE[/** @type {string} */ (type)] || 'other';
}

module.exports = { createCrashLog, originOf, jarKindOf, kindOfChildProcess };
