# Leg: restore-spike-and-stack

**Status**: completed
**Flight**: [Closed-Tab Stack and Reopen](../flight.md)

## Objective

Run the `navigationHistory.restore()` fidelity spike (GATE), then land the
pure `closed-tab-stack.js` module + unit net and the capture wiring in
main's `tab-close` handler (positive persist-jar allowlist, stripIndex,
try/catch discipline).

## Context

Flight DD1/DD2 are authoritative and unusually detailed — read them fully;
every wiring decision is embedded there (incl. two design-review passes).
Key additional implementation notes:
- **`stripIndex` must be snapshotted BEFORE DOM removal** in the renderer's
  `closeTab` (`orderedTabIds()` reads live children — capture after removal
  yields -1; Architect second-pass nit).
- The renderer's `tabClose(wcId)` preload bridge gains the optional
  `stripIndex` second arg (additive; update `renderer-globals.d.ts`).
- Capture in `tab-close` sits after the `tabViews.get` guard and strictly
  BEFORE `destroy()` and `tabViews.delete`; positive allowlist =
  `jars.list().find(j => j.partition === partition)` (history-recorder
  idiom); belt-and-suspenders `!entry.trusted` check; whole block try/catch.

## Acceptance Criteria

- [x] **Spike (FIRST, gate)**: live round-trip — navigate a jar tab through
      ≥3 pages, `getAllEntries()`/`getActiveIndex()` via a temp probe,
      close it, construct a fresh view in the same partition, `restore()`
      with the held entries+index, verify: the restored page renders, back/
      forward traverse the restored history, `getActiveIndex()` matches.
      Record the verdict + any `pageState` observations in the flight log.
      On failure: STOP, record, signal [BLOCKED:restore-premise] (divert is
      an FD decision). **PASS — see flight-log.md Leg 1 entry.**
- [x] `src/shared/closed-tab-stack.js` (pure ESM): push/pop/peek/size,
      MAX_ENTRIES=25 oldest-evicted, toJSON/fromJSON seam; consumed from
      main.js via `require(esm)` (precedented: sheet-accelerator).
- [x] `test/unit/closed-tab-stack.test.js`: bound/evict order, LIFO,
      empty-pop, peek non-mutating, toJSON/fromJSON round-trip, entry-shape
      passthrough — green.
- [x] Capture wiring live: closing a persist-jar tab pushes
      {url, title, jarId, stripIndex, navEntries, navIndex, closedAt};
      closing a burner or internal tab pushes NOTHING (verified live via a
      temp `evaluate`-side probe or a main-side debug read — record how).
- [x] `tabClose` bridge carries stripIndex (snapshotted pre-removal);
      d.ts updated.
- [x] `npm test`, lint, typecheck green; flight log leg entry (spike
      verdict prominent).

## Files Affected

- `src/shared/closed-tab-stack.js` (new), `test/unit/closed-tab-stack.test.js` (new)
- `src/main/main.js` (capture block), `src/preload/chrome-preload.js` +
  `renderer-globals.d.ts` (stripIndex arg), `src/renderer/renderer.js`
  (closeTab snapshot + pass)
- flight-log.md

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit — the flight commits once after review
