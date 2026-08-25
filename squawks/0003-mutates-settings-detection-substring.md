# Squawk 0003: broadcast-invariant detection side still matches by raw substring — indirect mutation escapes the net entirely

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-08
**Completed**: 2026-08-24

## Report

The DD8 net in `test/unit/broadcast-invariant.test.js` has two halves: detect which handlers
mutate settings, then check each of those broadcasts `settings-changed`. Squawk 0001
hardened the **broadcast** half to require an actual call shape rather than marker text
appearing anywhere in the slice. The **detection** half was left as a raw substring test and
is now asymmetric with it.

`mutatesSettings` asks only whether a handler's own body literally contains
`settings.set(` (or one of the jar-key markers). A handler that mutates **indirectly** — via
a module-scope helper that wraps the mutation, exactly the shape `register-settings-ipc.js`
already uses on the broadcast side with `broadcastSettings()` — contains no marker, is never
classified as mutating, and so is never checked for a broadcast at all.

That is a **false PASS**, and it is a wider hole than the ones squawk 0001 closed: those let a
non-broadcasting handler slip past the broadcast check, this one keeps the handler out of the
net's inventory entirely.

The mirror-image case is benign: marker text in a comment or string with no real call
produces a false *failure*, which is fail-safe.

**Latent, not live.** No registrar wraps a mutation marker in a helper today, so no handler
currently escapes. The risk is that adding one is natural — the codebase already DRYs the
broadcast side that way — and the net would go quiet without anyone noticing.

**Genuinely pre-existing**, not introduced by squawk 0001: this is out-of-diff scope the
Reviewer flagged during that squawk's review, logged here rather than folded into it.

## Evidence

The detection half, unchanged since the god-file decomposition:

```
test/unit/broadcast-invariant.test.js:60 —
  function mutatesSettings(slice) {
    return MUTATION_MARKERS.some((m) => slice.includes(m));
  }
```

Byte-identical at the decomposition commit and on `origin/main`:

```
$ git show be7aeb0:test/unit/broadcast-invariant.test.js | grep -A2 "function mutatesSettings"
function mutatesSettings(slice) {
  return MUTATION_MARKERS.some((m) => slice.includes(m));
}
$ git show origin/main:test/unit/broadcast-invariant.test.js | grep -A2 "function mutatesSettings"
function mutatesSettings(slice) {
  return MUTATION_MARKERS.some((m) => slice.includes(m));
}
```

Undetected handlers are dropped before the broadcast check ever runs —
`test/unit/broadcast-invariant.test.js:316`:

```js
.filter((r) => mutatesSettings(r.slice) && !broadcastsSettingsChanged(r.slice, r.helperNames))
```

Confirmed latent: no module-scope helper in any registrar wraps a mutation marker
(`grep -rn "^const [a-zA-Z]* = .*\(settings\.set(\|mintJarKey(\|revokeJarKey(\)" src/main/*-ipc.js`
→ no matches).

## Suggested direction

Mirror onto the detection side the mutation-helper crediting that squawk 0001 built for the
broadcast side: a module-scope helper whose body calls a mutation marker makes its callers
count as mutating. The machinery (`extractBroadcastHelperNames`, `locallyShadowsName`, the
call-shape regexes) already exists and generalizes.

Note the direction of change differs from squawk 0001's: that fix *narrowed* what counted as
broadcasting, this one *widens* what counts as mutating. Widening detection can surface
handlers that genuinely mutate indirectly without broadcasting. If it does, those are real
findings — they belong in their own squawk or flight, not folded into this one.

See squawk [0001](0001-broadcast-invariant-tripwire.md), whose Disclosed Residual Limitations
section records this gap.

## Corrective Action

Mirrored the detection half onto the exact mechanism squawk 0001 already built for the
broadcast half, in `test/unit/broadcast-invariant.test.js`:

- **`extractMutationHelperNames(source)`** (new): the mutation-side twin of
  `extractBroadcastHelperNames`. Reuses the SAME `BROADCAST_HELPER_RE` scan (module-scope
  `const NAME = (...) => <expr>;` one-liners — the exact shape `register-settings-ipc.js`
  already uses for `broadcastSettings`) and credits `NAME` only when `<expr>` is, at the
  top level, a direct call to a real mutation primitive — checked with a new anchored
  `MUTATION_CALL_RE` (`^\s*(?:settings\.set|mintJarKey|revokeJarKey|mintAdminKey|revokeAdminKey)\(`),
  the same anchor-at-start discipline `BROADCAST_CALL_RE` uses. This was necessary, not
  just parallel structure for its own sake: a first pass that credited a helper via a bare
  `MUTATION_MARKERS.some((m) => m[2].includes(m))` substring test over the one-liner body
  wrongly credited a decoy whose body is only a string literal that happens to open with
  the marker text (`() => 'settings.set( marker but does nothing'`) — caught by the new
  positive-control test itself before this fix was finalized.
- **`mutatesSettings(slice, mutationHelperNames)`**: now takes an optional second
  parameter, mirroring `broadcastsSettingsChanged(slice, broadcastHelperNames)`. Checks
  the handler's own slice for a marker first (unchanged, preserves the existing fail-safe
  string-literal-false-positive behavior); if that misses and helper names were supplied,
  loops them the same way `broadcastsSettingsChanged` does — skipping any name the
  handler's slice locally shadows (reuses `locallyShadowsName` as-is, no changes needed)
  and crediting a call to an unshadowed name.
- **Call site** (the net's own `test('every settings-mutating registrar handler...')`):
  each of the nine registrar files now also computes `mutationHelperNames =
  extractMutationHelperNames(source)` alongside the existing `helperNames =
  extractBroadcastHelperNames(source)`, threaded through to `mutatesSettings(r.slice,
  r.mutationHelperNames)` in the violations filter.

Why this fix and not another: the squawk's own suggested direction said the existing
machinery "generalizes," and it does — no new helper-resolution mechanism, no change to
how registrars are structured, no change to `locallyShadowsName`. The only genuinely new
piece is `MUTATION_CALL_RE`, a direct structural analog of `BROADCAST_CALL_RE` needed
because "does the helper body call a mutation primitive" and "does the helper body call
`broadcast('settings-changed', ...)`" are the same shape of question. This stayed within
squawk scope — a same-file test change with no design decisions, structured as the
mirror-image of an already-reviewed fix.

## Verification

Commands run (all from `~/projects/goldfinch`, branch `squawk/turnaround-2026-08-24`):

- `timeout 300 npm test` — 3715 tests, 3715 pass, 0 fail, duration ~3.1s (was 3714
  tests/3714 pass before this squawk's one new test).
- `timeout 60 node --test test/unit/broadcast-invariant.test.js` — 27/27 pass, ~0.2s,
  including the net test (`every settings-mutating registrar handler in production
  source broadcasts settings-changed`) confirming **zero violations** against the real
  `src/main/*.js` registrars with the widened detection in place (matches the squawk's
  own confirmed-latent grep: no registrar currently wraps a mutation marker in a helper).
- `timeout 180 npm run typecheck` — clean, no output.
- `timeout 180 npm run lint` — clean, no output.

New positive-control test: **`mutatesSettings credits a handler that mutates only
indirectly, through a module-scope helper (squawk 0003)`**, added alongside the existing
synthetic-classification test at `test/unit/broadcast-invariant.test.js:371`. It:
1. Builds a genuine mutation helper (`const setPref = (k, v) => settings.set(k, v);`) and
   asserts `extractMutationHelperNames` credits it.
2. Asserts a handler calling only that helper (no marker of its own) is classified
   `mutatesSettings(...) === false` when no helper names are resolved (regression
   baseline reproducing the exact false-PASS the squawk reports), and `=== true` once the
   resolved helper names are passed in.
3. Asserts the handler is reported as a real violation end-to-end: mutates (indirectly)
   AND does not broadcast.
4. Asserts a decoy helper whose body is only a string literal mentioning the marker text
   is NOT credited (mirrors squawk 0001's decoy finding on the broadcast side).
5. Asserts a handler that locally shadows the helper name is NOT credited (Finding B,
   reused as-is).

Neutering check (done by hand, not committed — same practice as the leg's "remove a
broadcast and re-run" sanity check the file's header describes): temporarily reverted
`mutatesSettings` to its pre-fix raw-substring form (`return MUTATION_MARKERS.some((m) =>
slice.includes(m));`, no second parameter) and re-ran
`test/unit/broadcast-invariant.test.js`. The new positive-control test went red exactly
as expected (`AssertionError: false !== true` on the "classified as mutating once helper
names are resolved" assertion, test 6 of 27); all other 26 tests still passed. Reverted
back to the fix and re-ran — 27/27 pass again — before finishing.

Files changed: `test/unit/broadcast-invariant.test.js` (detection-half fix + new test),
`squawks/0003-mutates-settings-detection-substring.md` (this file, status +
completion sections). No source files under `src/` touched — this is a test-only fix, in
scope for a squawk.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the implementer's reasoning) — one review round, batch turnaround 2026-08-24
**Verdict**: confirmed
**Commit**: `8fa22ba` (`squawk: turnaround 2026-08-24`, PR #166) on `squawk/turnaround-2026-08-24`

Reviewer independently ran the suite (3716/3716, ~3.1 s), typecheck and lint clean, and the broadcast-invariant file alone (27/27, zero violations against the nine real registrars). Checked the false-pass question directly: every production `settings.set(` call has the name adjacent to `(`, and the anchored `MUTATION_CALL_RE` can only produce a false *negative* on a gap — fail-safe. Positive control covers helper credit, the pre-fix false-PASS baseline, decoy rejection, and shadowing.

## Sign-Off

*(written at completion)*
