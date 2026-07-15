# Leg: stack-and-cache

**Status**: completed
**Flight**: [Multi-Window Shell, Part 1](../flight.md)

## Objective

Land flight DD4 (global windowId-tagged closed-tab stack + whole-window
capture at the `close` event) and DD6 (stack-size push-cache; the
tab-context opener goes synchronous — the F5 known-edge fold-in).

## Context

Flight DD4/DD6 are authoritative (two-pass design review; H2/L1/L2
resolutions embedded verbatim) — read them fully, plus the leg-2 flight-log
entry (the `close`-event capture POINT is already wired; this leg fills the
body) and the F5 flight-log "Known edge" note (the cross-type stale-resolve
edge this leg deletes). Spike fact: guests are alive and
`navigationHistory`-readable at `close` AND `closed` (margin confirmed).

## Acceptance Criteria

- [x] Stack entries gain `windowId` (tab-close capture site tags the
      sender-resolved window's id; the stack module itself is untouched —
      entry-shape-agnostic).
- [x] Whole-window capture at the window's `close` event: every
      persist-jar tab captured as an ordinary entry (reusing the tab-close
      capture body — same positive allowlist, same trusted/internal
      structural exclusions), in `tabViews` insertion order, each with
      `stripIndex` = the append sentinel (-1) and the dying window's
      `windowId`. `win.destroy()` skips `close` — accepted edge,
      documented in a code comment at the capture site.
- [x] Pop rules (`tab-reopen`): honor `entry.stripIndex` only when
      `entry.windowId` === the INVOKING window's id (sender-resolved);
      otherwise the append sentinel. Unit-covered where the logic is pure.
- [x] `closed-tab-stack-size` stays GLOBAL; DD6 push-cache:
      `closed-tab-stack-changed {size}` broadcast to ALL chromes (NOT
      internal-session — no consumer) on every stack mutation (push, pop,
      and any clear path); renderer caches it; seed/push race rule = a
      received push always wins, the boot-seed invoke applies only if no
      push has arrived.
- [x] `openTabContextMenu` goes SYNCHRONOUS (model built from the cached
      size; the awaited invoke deleted from the opener; `tabCtx` stale-
      resolve guard simplified away). Duplicate's `sourceIndex` staleness
      goes with it (computed and used synchronously now). The
      `closed-tab-stack-size` invoke handler remains as the boot seed.
- [x] The F5 flight-log known-edge note gets a one-line addendum: folded
      in here (reference this leg).
- [x] Unit tests: capture-order/sentinel/windowId-tagging and pop-rule
      logic (pure parts); cache seed/push race (pure renderer logic if
      extractable, else covered by the existing opener tests' update).
- [x] `npm test` (all suites), lint, typecheck green. Live MCP smoke:
      close-a-tab → menu shows Reopen without any invoke round-trip
      (verify the opener no longer awaits — e.g. the menu opens correctly
      immediately after a stack mutation); reopen honors position
      same-window; `closed-tab-stack-size` boot seed still works on a
      fresh chrome. Targeted-kill teardown.
- [x] Flight log leg entry (incl. the doc-enumeration-invalidation
      answer); leg → landed. Do NOT commit.

## Files Affected

- `src/main/main.js` (capture body at `close`; windowId tagging; stack
  broadcast; pop rules)
- `src/renderer/renderer.js` (cache + sync opener; duplicate sourceIndex)
- `src/preload/chrome-preload.js` + `renderer-globals.d.ts` (the
  `closed-tab-stack-changed` sink, per the declare rule)
- `test/unit/` (stack capture/pop rules; opener/cache updates)
- missions/.../05-tab-context-menu/flight-log.md (one-line addendum)
- flight-log.md

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit — the flight commits once after review
