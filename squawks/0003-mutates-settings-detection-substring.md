# Squawk 0003: broadcast-invariant detection side still matches by raw substring — indirect mutation escapes the net entirely

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-08
**Completed**: —

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

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
