// @ts-check
'use strict';

// Automation audit log — the DATA half of SC10 (Flight 4, Leg 3, DD8).
//
// A pure, Electron-free, dependency-free in-memory store of two things:
//   1. a BOUNDED RING of recent tool invocations ({ ts, sessionId, identity, op,
//      targetWcId, outcome, errorCode }), oldest evicted past `capacity`, and
//   2. a SESSION-ACTIVE map (which identities currently hold an open transport,
//      distinguishing admin vs jar and NAMING the jar).
//
// Persistence decision (DD8, confirmed this leg): IN-MEMORY RING ONLY — no disk
// persistence. The data backs a live indicator (Flight 5), is bounded, and is
// cheap to lose on restart. The ring `capacity` is a named constant
// (DEFAULT_CAPACITY) and an injectable option. Reversible to a persisted store
// later if Flight 5 wants history across restarts.
//
// `now` is injected (defaults to Date.now) so unit tests stamp deterministic
// timestamps. `onChange(snapshot())` fires after EVERY mutation that changes
// state so the caller (mcp-server.js) can broadcast the new snapshot. The module
// itself knows nothing about broadcasting or Electron.

// The ring's default capacity. A live tail, not an archive — see the persistence
// decision above. Bounded so a long-running session can't grow memory unbounded.
const DEFAULT_CAPACITY = 500;

// Longest stored `op` / `errorCode` / `detail` (leg `automation-bounds`): code points, not UTF-16 units.
// `op` is the tool name straight off the wire and `detail` is built from tool arguments, so a key holder
// could otherwise park 500 megabyte strings in the ring. `sessionId` and `identity` are NOT clipped: the
// page joins sessions to log rows on them byte-for-byte against what `noteSessionOpen` recorded.
const MAX_FIELD_CODE_POINTS = 256;

/**
 * Coerce to a string and clip to MAX_FIELD_CODE_POINTS code points (an ellipsis replaces the cut; never
 * splits a surrogate pair). null/undefined stay null.
 * @param {any} v
 * @returns {string | null}
 */
function clipField(v) {
  if (v === null || v === undefined) return null;
  const str = typeof v === 'string' ? v : String(v);
  // Cheap bound first: a code point is at most 2 units, so a string this short cannot exceed the cap.
  if (str.length <= MAX_FIELD_CODE_POINTS) return str;
  // Only the head is ever split into code points, so a megabyte input costs a constant.
  const head = Array.from(str.slice(0, MAX_FIELD_CODE_POINTS * 2));
  if (head.length <= MAX_FIELD_CODE_POINTS && str.length <= MAX_FIELD_CODE_POINTS * 2) return str;
  return head.slice(0, MAX_FIELD_CODE_POINTS - 1).join('') + '\u2026';
}

/**
 * Derive the {kind, jarId} pair from a bound identity. `'admin'` → the admin
 * tier (no jar); any other string is a jarId.
 * @param {string} identity
 * @returns {{ kind: 'admin' | 'jar', jarId: string | null }}
 */
function classifyIdentity(identity) {
  return identity === 'admin' ? { kind: 'admin', jarId: null } : { kind: 'jar', jarId: identity };
}

/**
 * Create an in-memory audit log.
 *
 * @param {object} [opts]
 * @param {number} [opts.capacity=500]  ring capacity; oldest entries evicted past it.
 * @param {() => number} [opts.now]  clock, injected for deterministic tests.
 * @param {(snapshot: { sessions: any[], log: any[] }) => void} [opts.onChange]
 *   called with snapshot() after every state-changing mutation.
 * @returns {{
 *   record: (e: { identity: string, sessionId: string|null, op: string, targetWcId: number|null, outcome: 'ok'|'error', errorCode?: string|null, detail?: string|null }) => void,
 *   noteSessionOpen: (sessionId: string, identity: string) => void,
 *   noteSessionClose: (sessionId: string) => void,
 *   recentEntries: () => any[],
 *   activeSessions: () => Array<{ sessionId: string, identity: string, kind: 'admin'|'jar', jarId: string|null, since: number }>,
 *   snapshot: () => { sessions: any[], log: any[] },
 * }}
 */
function createAuditLog(opts = {}) {
  const capacity = Number.isInteger(opts.capacity) && opts.capacity > 0 ? opts.capacity : DEFAULT_CAPACITY;
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const onChange = typeof opts.onChange === 'function' ? opts.onChange : null;

  // The ring: a plain array in append order (newest LAST). On overflow the oldest
  // (index 0) is shifted off so length never exceeds `capacity`.
  /** @type {Array<{ ts: number, sessionId: string|null, identity: string, op: string, targetWcId: number|null, outcome: 'ok'|'error', errorCode: string|null, detail: string|null }>} */
  const ring = [];

  // Active sessions, keyed by transport session id.
  /** @type {Map<string, { identity: string, kind: 'admin'|'jar', jarId: string|null, since: number }>} */
  const active = new Map();

  /** @returns {any[]} a copy of the ring in newest-LAST (natural append) order. */
  function recentEntries() {
    return ring.map((e) => ({ ...e }));
  }

  /**
   * @returns {Array<{ sessionId: string, identity: string, kind: 'admin'|'jar', jarId: string|null, since: number }>}
   */
  function activeSessions() {
    const out = [];
    for (const [sessionId, info] of active) {
      out.push({ sessionId, identity: info.identity, kind: info.kind, jarId: info.jarId, since: info.since });
    }
    return out;
  }

  /** @returns {{ sessions: any[], log: any[] }} a fresh snapshot of both views. */
  function snapshot() {
    return { sessions: activeSessions(), log: recentEntries() };
  }

  /** Fire onChange with a fresh snapshot, if a listener is registered. */
  function fire() {
    if (onChange) onChange(snapshot());
  }

  /**
   * Append a tool-invocation record to the ring, stamping `ts` via the injected
   * clock. Evicts the oldest entry past capacity. Fires onChange.
   * @param {{ identity: string, sessionId: string|null, op: string, targetWcId: number|null, outcome: 'ok'|'error', errorCode?: string|null, detail?: string|null }} e
   */
  function record(e) {
    ring.push({
      ts: now(),
      sessionId: e.sessionId ?? null,
      identity: e.identity,
      op: clipField(e.op) ?? '',
      targetWcId: e.targetWcId ?? null,
      outcome: e.outcome,
      errorCode: clipField(e.errorCode),
      detail: clipField(e.detail)
    });
    while (ring.length > capacity) ring.shift();
    fire();
  }

  /**
   * Mark a session active under `identity` (admin vs jar derived; jar named).
   * `since` is stamped via the injected clock. Fires onChange.
   * @param {string} sessionId
   * @param {string} identity
   */
  function noteSessionOpen(sessionId, identity) {
    const { kind, jarId } = classifyIdentity(identity);
    active.set(sessionId, { identity, kind, jarId, since: now() });
    fire();
  }

  /**
   * Remove a session from the active map. IDEMPOTENT: if `sessionId` isn't
   * tracked, no-op and do NOT fire onChange (handles double-close / stop-after-
   * close without a spurious broadcast). Fires onChange only on a real removal.
   * @param {string} sessionId
   */
  function noteSessionClose(sessionId) {
    if (!active.has(sessionId)) return;
    active.delete(sessionId);
    fire();
  }

  return { record, noteSessionOpen, noteSessionClose, recentEntries, activeSessions, snapshot };
}

module.exports = { createAuditLog, DEFAULT_CAPACITY, MAX_FIELD_CODE_POINTS };
