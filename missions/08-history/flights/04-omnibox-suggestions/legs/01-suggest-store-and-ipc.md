# Leg: suggest-store-and-ipc

**Status**: completed
**Flight**: [Address-Bar Suggestions](../flight.md)

## Objective

Land the frecency `suggest` query (store), the `history-suggest` IPC twins
(6th op), and the chrome bridge (`historySuggest` + d.ts) — unit-pinned
per flight DD3/DD4.

## Contract

1. **`src/main/history-store.js`** — **signature PINNED** *(design
   review)*: `suggest(jarId, query, { limit = 6, now } = {})` — `now`
   lives in the options bag but is REQUIRED (no default; TypeError on
   non-finite, `pruneOneJar`-style) — external shape matches
   `search`/`listRecent`, determinism contract matches `pruneOneJar`
   (the store never calls `Date.now()`). The IPC handler supplies
   `now: Date.now()`.
   - Validation: `recordVisit`-style TypeErrors on bad jarId/query types.
   - Sanitization: reuse `sanitizeSearchQuery`; empty result → `[]`.
   - SQL — the review-probe-verified statement VERBATIM (placeholders:
     `?1`=now ×4 — SAME logical value reused, deliberately, NOT the
     bare-`?`-mixing hazard; `?2`=ftsQuery, `?3`=jarId, `?4`=limit):
     ```sql
     SELECT v.url, MAX(v.visited_at) AS lastVisitedAt, v.title,
       SUM(CASE
         WHEN ((?1 - v.visited_at) / 86400000) <= 4  THEN 100
         WHEN ((?1 - v.visited_at) / 86400000) <= 14 THEN 70
         WHEN ((?1 - v.visited_at) / 86400000) <= 31 THEN 50
         WHEN ((?1 - v.visited_at) / 86400000) <= 90 THEN 30
         ELSE 10
       END) AS score
     FROM visits_fts
     JOIN visits v ON v.id = visits_fts.rowid
     WHERE visits_fts MATCH ?2 AND v.jar_id = ?3
     GROUP BY v.url
     ORDER BY score DESC, MAX(v.visited_at) DESC, v.url ASC
     LIMIT ?4
     ```
     Add the gotcha comment *(design review)*: node:sqlite binds plain JS
     numbers as REAL — the division does NOT truncate; do NOT "fix" with
     CAST (it would change probe-verified bucket semantics). Truth-table
     boundary fixtures use exact `now − N*86400000` values.
   - JSDoc note: rows are per-URL AGGREGATES, hence `lastVisitedAt` (a
     deliberate divergence from `visitedAt` on Visit rows — don't
     normalize).
   - Suggest-specific clamp: `SUGGEST_MIN_LIMIT = 1`,
     `SUGGEST_MAX_LIMIT = 10`, default 6 (own named constants — NOT the
     store's 1–500).
   - Returns `[{ url, title, score, lastVisitedAt }]`.
   - Tests (extend `history-store.test.js`): ranking truth table with a
     fixed `now` — frequent-old vs recent-rare ordering, bucket
     boundaries, tie-break stability (`url ASC`), per-jar isolation,
     dedupe-by-url with most-recent title, token-prefix row
     (`exampl` matches `examplezzz.com` — document the semantics),
     limit clamp rows, empty/operator-injection queries safe, repo-
     interface + throws-before-open lists updated.
2. **`src/main/history-ipc.js`** — `history-suggest` /
   `internal-history-suggest` (6th op; internal twin gets a one-line
   registered-but-unused comment): payload `{ jarId, query, limit? }`;
   fail-closed static strings `history: suggest — malformed-payload |
   unknown-jar | bad-args | store-failure`; success
   `{ ok: true, suggestions }`. Handler injects `now: Date.now()`.
   Tests: registration surface 6+6, untrusted-sender, verbatim strings,
   success shape, throwing-fake toggle, twin same-identifier.
3. **`src/preload/chrome-preload.js`** — `historySuggest: (payload) =>
   ipcRenderer.invoke('history-suggest', payload)` beside the
   settings/shields cluster; **`renderer-globals.d.ts`** —
   `historySuggest(payload: any): Promise<any>;` on `GoldfinchBridge`
   (NOT the internal interface).

## Acceptance Criteria

- [x] Store + IPC + bridge per contract; all new error strings verbatim-
      pinned; ranking truth table green with fixed `now`.
- [x] Grep-ACs: zero `${` in history-ipc.js (still); suggest SQL uses
      unaliased `visits_fts` and distinct placeholders (read-verified).
- [x] `npm test` / typecheck / lint green; suite ~1s (truth table uses
      tiny fixtures).

## Files Affected

- `src/main/history-store.js`, `test/unit/history-store.test.js`
- `src/main/history-ipc.js`, `test/unit/history-ipc.test.js`
- `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts`

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit

## Citation Audit

Seams verified at the Flight-4 Architect review (same session, live
probes): the GROUP BY construction, sanitizeSearchQuery reuse, history-ipc
5-op surface, chrome-preload settings-get precedent, GoldfinchBridge
declare region. Symbol-form.
