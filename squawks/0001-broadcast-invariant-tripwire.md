# Squawk 0001: broadcast-invariant test lost its self-deriving tripwire

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-08
**Completed**: 2026-08-08

## Report

`test/unit/broadcast-invariant.test.js` guards DD8: every settings/jar-mutating IPC
handler must broadcast a corresponding `*-changed` invalidation. The original net derived
its inventory of mutating handlers **from production source**, so a future handler added
without a broadcast would fail the test with nobody editing the test.

The god-file decomposition (#99 / #105) rewrote the test and dropped that derivation. The
invariant is still verified for *today's* handlers against the real registrar, but the
tripwire no longer re-arms itself — a new mutating handler added to any registrar without
a broadcast would pass silently.

No runtime impact. This is a regression-net integrity defect.

Tracked as GitHub issue #106.

## Evidence

`extractMainRegistrations` is exercised only against inline fixture strings, never
production source:

```
$ grep -n "readFileSync" test/unit/broadcast-invariant.test.js
(no matches)
```

Its sole call site is `test/unit/broadcast-invariant.test.js:168`, inside the test
`'a registration-shaped mention inside a comment (main.js:996 precedent) is not picked up
as a real registration'`, whose input is the literal
`"// see ipcMain.handle('tab-create') for details\nipcMain.handle('real-channel', () => {});"`.

Nine registrar modules now own the handlers and none are scanned:
`src/main/register-{bookmarks,browser,download,overlay,settings,tab,vault}-ipc.js`,
`src/main/jar-registry-ipc.js`, `src/main/jar-data-ipc.js`.

## Corrective Action

Re-armed the self-deriving scan in `test/unit/broadcast-invariant.test.js` against the
nine registrar modules (`src/main/register-{bookmarks,browser,download,overlay,settings,
tab,vault}-ipc.js`, `src/main/jar-registry-ipc.js`, `src/main/jar-data-ipc.js`), matching
the pre-#105 net's per-file strategy split:

- **Inline-callback modules** (`register-browser-ipc.js`, `register-download-ipc.js`,
  `register-overlay-ipc.js`, `register-settings-ipc.js`, `register-tab-ipc.js`,
  `register-vault-ipc.js`) — scanned at the registration site with the existing
  `extractMainRegistrations` (unchanged, just no longer main.js-only).
- **Named-function-declaration modules** (`register-bookmarks-ipc.js`,
  `jar-registry-ipc.js`, `jar-data-ipc.js`) — a new `extractNamedFunctionHandlers`,
  restoring the brace-balanced-function-body strategy the pre-decomposition net used for
  `jar-ipc.js` (dropped entirely in the rewrite, not just left unwired).

Both read real production source via `fs.readFileSync` + `path.join(__dirname, '../../
src/main')`, not fixture strings. A new test, `'every settings-mutating registrar handler
in production source broadcasts settings-changed'`, extracts all handlers from all nine
files (147 today, vacuity-guarded at `> 140`), filters to ones matching the mutation
markers, and asserts every one also matches the broadcast marker (or the allowlist,
pinned empty by the existing test).

**One real complication, not a design decision:** the naive per-body literal-string
match (the pre-decomposition net's exact behavior) produced 8 false-positive violations,
all in `register-settings-ipc.js`. That file DRYs the repeated
`broadcast('settings-changed', settings.getAll())` call into one module-scope
`const broadcastSettings = () => broadcast('settings-changed', settings.getAll());`,
and every mutating handler there calls `broadcastSettings()` instead of inlining the
broadcast — correct, working code the decomposition legitimately introduced. Reproducing
the old literal-match behavior verbatim would have made the tripwire permanently red on
current `main`, which is worse than not having it. Fixed by extending the marker check
(not the production code, not the allowlist) with `extractBroadcastHelperNames`: it finds
module-scope `const NAME = (...) => <expr>;` declarations and credits a handler that
calls `NAME(...)` as broadcasting. This stays source-derived (no hardcoded helper name)
and is scoped to the test file and what it scans, per the squawk's scope gate — no
production file was touched. With this resolved, the net finds zero violations on
current `main`, matching the empty-allowlist invariant the existing `'the allowlist is
empty'` test already pins.

**Review round 2 (blocking finding, fixed before close):** an independent reviewer
found that the first cut of `extractBroadcastHelperNames` credited `NAME` whenever the
matched declaration's RAW TEXT merely *contained the literal substring* `settings-changed`
anywhere in the one-liner — including inside an unrelated string literal that never calls
a broadcast primitive at all, e.g. `const fakeBroadcastHelper = () => 'settings-changed
marker but does nothing';`. A handler calling that decoy helper was silently credited as
broadcasting, reintroducing the same class of gap this squawk exists to close, just one
level of indirection deeper. Fixed by requiring the helper's body to itself be, at the top
level, a direct call to a real broadcast primitive whose first argument is exactly the
marker string: `BROADCAST_HELPER_RE` now captures the body separately, and
`extractBroadcastHelperNames` only credits `NAME` when
`/^\s*(?:broadcast|broadcastToChromeAndInternal)\(\s*(['"`])([^'"`]*)\1/` matches the body
AND the captured first argument equals the marker exactly (not a substring test). The
decoy shape above no longer matches — it has no call to `broadcast`/
`broadcastToChromeAndInternal` at all — while the genuine `broadcastSettings` helper
(direct call, marker as first argument) still matches. A new test, `'extractBroadcastHelperNames
credits a genuine broadcast helper but NOT a decoy that merely mentions the marker string
(squawk 0001 review finding)'`, pins both the positive case (including the
`broadcastToChromeAndInternal` variant) and the reviewer's exact decoy, end-to-end through
`broadcastsSettingsChanged`. Still test-file-only; no production file touched.

The existing runtime-harness tests (hardcoded channel list invoked through
`makeSettingsIpcHarness`/`makeHarness`, asserting actual broadcast calls and, for jar
removal, broadcast ORDER) and the fixture-based regression tests for `mutatesSettings` /
`broadcastsSettingsChanged` / `maskComments` / the comment-precedent case were kept
unchanged — they cover properties (execution order, masking correctness) the static
source scan doesn't, and the task's helper-coverage requirement asked to keep them.

**Review round 3 (fix cycle 2) — two more blocking findings, both fixed:** a second,
independent reviewer probed the round-2 net and defeated it two more ways, both one layer
shallower than what round 2 closed.

- **Finding A — the base check (`broadcastsSettingsChanged`'s first line) was still a raw
  `slice.includes(BROADCAST_MARKER)` substring test**, never tightened when round 2
  tightened only the *helper-crediting* path. A mutating handler needs no helper at all to
  defeat it — any incidental occurrence of the literal text `settings-changed` anywhere in
  the handler's own body (e.g. an unrelated local string) passed it. Reviewer's exact
  reproduction against production source:
  ```js
  ipcMain.on('probe-inline-marker-string', () => {
    settings.set('automationPort', 1);
    const note = 'settings-changed is intentionally not sent for this internal counter';
  });
  ```
  Fixed by replacing the substring test with `BASE_BROADCAST_CALL_RE`, requiring the
  marker to appear as the literal first argument of an actual call to `broadcast(` /
  `broadcastToChromeAndInternal(` — the same call-shape discipline round 2 already applied
  to helper bodies, now applied to the base check too.

- **Finding B — helper crediting (`broadcastsSettingsChanged`'s helper loop) matched a
  bare identifier with no scope resolution.** `new RegExp(\`\\b${name}\\s*\\(\`)` credits
  any call shaped like `NAME(...)` in the handler's slice, including a call to a LOCAL
  redeclaration of `NAME` that shadows the real module-scope helper. Reviewer's exact
  reproduction:
  ```js
  ipcMain.on('probe-shadowed-name', () => {
    settings.set('automationPort', 1);
    const broadcastSettings = () => {};
    broadcastSettings();
  });
  ```
  Fixed by adding `locallyShadowsName(slice, name)` — before crediting a call to helper
  `NAME`, reject it if the handler's own slice contains a `const`/`let`/`var`/`function`
  binding of that same name. This is a text-level shadow guard (a regex checking for a
  redeclaration keyword immediately before the name), not real scope resolution.

Two regression tests pin the reviewer's exact probe shapes end-to-end through
`broadcastsSettingsChanged` (Finding A's test also re-confirms both real call spellings
still credit; Finding B's test also covers `let`/`var`/`function` shadowing, not just
`const`, and re-confirms an unshadowed call to the same helper still credits).

**Proactive hardening, found while re-probing the fix cycle 2 changes (not reviewer
findings, but the same class one layer deeper again — closed rather than left for a third
round):**

- A same-named **method call** on an unrelated local decoy object
  (`fakeBroadcast.broadcast('settings-changed', …)`) would have satisfied the tightened
  base regex, because `\b` alone is satisfied across a `.` — a `.` is a non-word character,
  so `\bbroadcast\(` matches equally after a dot as after nothing. Closed with a
  `(?<!\.)` negative lookbehind on `BASE_BROADCAST_CALL_RE`, rejecting any match
  immediately preceded by `.`. Confirmed no production registrar calls `broadcast` via a
  method chain (`grep -rn "\.broadcast(" src/main/register-*.js …` → no matches), so this
  adds no false positives against current source.
- A handler locally shadowing the **base primitive itself** (not a named helper) —
  `const broadcast = () => {}; broadcast('settings-changed', 'noop');` — is the exact
  Finding B class applied one level shallower (the primitive `broadcastsSettingsChanged`
  was matching against, rather than a helper name credited on top of it). Closed by
  running `BASE_BROADCAST_CALL_RE` globally, capturing which identifier
  (`broadcast`/`broadcastToChromeAndInternal`) matched, and rejecting a match whose
  identifier is locally shadowed via the same `locallyShadowsName` guard used for Finding
  B — no new mechanism, just the existing Finding B fix applied to the base check's own
  identifiers.

A third regression test pins both of these end-to-end (decoy method call, self-shadowed
`broadcast`, and a genuine unshadowed direct call as the no-regression control).

**Review round 4 (fix cycle 3) — one blocking finding, fixed:** a third, independent
reviewer probed `locallyShadowsName` itself and found it defeated by a shape one class
different from rounds 2/3: `\b(?:const|let|var|function)\s+${name}\b` requires NAME to
appear **directly** after the declaration keyword, which a destructuring binding defeats
even though a declaration keyword IS present. Reviewer's exact reproduction against
production source:
```js
ipcMain.on('probe-destructure-shadow', () => {
  settings.set('automationPort', 1);
  const { broadcast } = { broadcast: () => {} };
  broadcast('settings-changed', 'noop');
});
```
— and its helper-name analog (`const { broadcastSettings } = {...};
broadcastSettings();`). Both were silently credited as broadcasting: a false PASS, the
same class as the disclosed bare-reassignment gap, but reached *through* a declaration
keyword, which the artifact's prior framing implied was caught. The reviewer also noted a
function-parameter shadow (`(broadcast) => {...}`) as the same class, though contrived for
an `ipcMain.on` callback.

Fixed by extending `locallyShadowsName` with three more checks, kept as a regex extension
(no rewrite):
- **Object/array destructuring bindings** — `\b(?:const|let|var)\s+\{[^}]*\bNAME\b`
  (object) and the array-bracket analog `\b(?:const|let|var)\s+\[[^\]]*\bNAME\b`,
  matching the reviewer's suggested shape.
- **Parenthesized function-parameter shadowing** — `\(([^()]*\bNAME\b[^()]*)\)\s*=>`
  (arrow) and `\bfunction\b[^{(]*\(([^()]*\bNAME\b[^()]*)\)` (declaration/expression).
  Deliberately gated on `=>` or a `function` keyword immediately governing the
  parenthesized list, so an unrelated `if (NAME) {` / `while (NAME) {` condition check
  isn't mistaken for a parameter binding.
- **Parenless single-param arrow shadowing** — `\bNAME\s*=>` (no surrounding parens at
  all, e.g. `broadcast => {...}`). Found while verifying the parenthesized fix: the
  parenthesized-only pattern does not match this shape at all, and it is the exact
  near-miss this squawk's own Disclosed Residual Limitations section had already flagged
  as a risk for a *different*, never-added reassignment regex — closed here for the
  shadow check instead, since it is real, uncontrived JS (unlike the reviewer's
  parenthesized single-param probe, which is contrived for an `ipcMain.on` callback).

Four regression tests pin these end-to-end through `broadcastsSettingsChanged`: the
reviewer's exact destructuring probe and its helper-name analog (plus the array form as a
sibling case), the reviewer's parenthesized parameter-shadow probe, and the parenless
single-param arrow probe — each also re-confirming an unshadowed direct call still
credits (no regression).

**Then stopped hardening** (per this fix cycle's bound) and instead ran an exhaustive
audit of what a text-level matcher still cannot reach after these fixes, verified each
candidate gap directly against `locallyShadowsName` (not just reasoned about), and
rewrote Disclosed Residual Limitations below to state every remaining false-PASS shape
explicitly and label it **unsound** — not fail-safe — while shapes that only produce
false failures stay labeled fail-safe. See that section for the four newly-identified
unsound gaps (nested destructuring, nested-paren parameter defaults, catch-clause and
other non-arrow/non-`function` parameter bindings) and the corrected framing.

All changes are confined to `test/unit/broadcast-invariant.test.js`; no production file
was touched by this squawk (`src/main/main.js`'s diff is squawk 0002's unrelated
AppUserModelID change, confirmed byte-for-byte unchanged by this work — see Verification).

## Disclosed Residual Limitations

Per the task's bounding note, text-level matching cannot reach full soundness without a
real parser, which is out of squawk scope. Every remaining shape below was verified
directly against the actual functions (`locallyShadowsName`, `mutatesSettings`,
`extractBroadcastHelperNames`, `maskComments`), not just reasoned about — this section
means what it says: a shape marked **unsound** is a verified false PASS (a real,
no-broadcast handler that the net would silently let through); a shape marked
**fail-safe** is a verified false FAILURE (a genuinely-broadcasting handler the net would
incorrectly flag, never the reverse) or a loud, visible failure mode. **No shape in this
list is broader coverage than what the regexes actually deliver** — if a shape isn't
listed here as unsound, it either doesn't defeat the net or wasn't found despite the
attempt below.

After fix cycle 3's changes, a further genuine attempt was made to defeat the net again:
block-bodied helpers, `function`-declared helpers, chained/nested helper calls, marker as
a non-first argument, template literals, commented-out broadcasts, bare reassignment,
nested destructuring, parameter lists containing nested parens, and parameter-binding
constructs other than arrow functions and `function` declarations (catch clauses, and by
the same reasoning class methods / object-method shorthand / generator and setter
parameter lists).

**Unsound (verified false PASS — a real, no-broadcast handler is silently credited):**

- **Bare reassignment of `broadcast`/a credited helper name, without a `const`/`let`/`var`/
  `function` keyword** (e.g. `broadcast = () => {};` inside a handler, mutating the
  enclosing closure variable directly rather than declaring a new local binding) is NOT
  caught by `locallyShadowsName`, which only matches declaration keywords or the parameter/
  destructuring shapes added in fix cycle 3 — none of which apply to a bare reassignment.
  It was deliberately left open rather than patched: distinguishing a real reassignment
  (`broadcast = …`) from unrelated code containing the same character sequence (an object
  literal's `broadcast:` key, an `==`/`===` comparison, or a parenless single-param arrow
  `broadcast => {}`, whose `=>` a naive `\bbroadcast\s*=` regex would misread as `=` —
  fix cycle 3 closed the shadow check for that exact shape, but a reassignment check using
  the same naive pattern would still misfire on it) is exactly the kind of
  one-more-special-case chase this squawk's bounding note warns against. No registrar
  today reassigns `broadcast` or any helper name (`grep -n "broadcast\s*="` over the nine
  registrars → no matches), so the gap is latent, not live. Flagged for a follow-up squawk
  or issue if closing it is wanted.
- **Nested destructuring where the target name sits after an earlier-closing nested
  sub-pattern within the same binding** defeats both destructuring checks added in fix
  cycle 3. Object form: `const { a: { x }, broadcast } = obj; broadcast('settings-changed',
  …);` — array form: `const [[x], broadcast] = arr; broadcast('settings-changed', …);`.
  `[^}]*` / `[^\]]*` stop at the FIRST unrelated closing bracket (the nested sub-pattern's
  own `}` / `]`), so the scan never reaches a name positioned after it — verified:
  `locallyShadowsName` returns `false` for both reproductions above even though `broadcast`
  is genuinely locally bound. The same truncation is reached by a **default-value
  initializer containing braces or brackets** on an earlier property, with no nested
  binding pattern involved at all: `const { other = {}, broadcast } = { broadcast: () => {}
  };` — the `= {}`'s own `}` closes the scan before `broadcast` is seen (verified as a false
  PASS during final review). Any construct that puts a `}` / `]` between the opening brace
  and the target name has this effect. No registrar today destructures at all, so the gap
  is latent, not live.
- **Function-parameter lists containing nested parentheses before the target name defeat
  the parameter-shadow check for the WHOLE list, not just that parameter** — e.g. a
  default value that's a call expression: `(a = fn(), broadcast) => { broadcast(
  'settings-changed', …); }`. Both parameter-shadow regexes require the entire span between
  the outer `(` and `)` to contain no nested `(`/`)` at all; a nested call breaks the match
  outright. Verified: `locallyShadowsName` returns `false` for the reproduction above. No
  registrar today default-initializes an `ipcMain` callback parameter with a call
  expression, so the gap is latent, not live.
- **Parameter-binding constructs other than arrow-function and `function`-declaration
  parameter lists are not recognized as shadow sites at all** — the fix cycle 3 checks are
  deliberately gated on `=>` or a `function` keyword governing the parenthesized list.
  A catch-clause parameter is the concrete, verified case: `try {} catch (broadcast) {
  broadcast('settings-changed', …); }` → `locallyShadowsName` returns `false` even though
  `broadcast` is genuinely locally bound for the catch block. By the same reasoning, a
  class-method parameter, an object-method-shorthand parameter, or a generator/setter
  parameter list would be equally unrecognized. No registrar handler today contains a
  try/catch, a class, or object-method-shorthand parameter shadowing `broadcast` or a
  helper name, so the gap is latent, not live.
- **`mutatesSettings` (the mutation-detection side, untouched by any finding across all
  three fix cycles) has the identical raw-substring shape** the base broadcast check had
  before fix cycle 2's Finding A: `MUTATION_MARKERS.some((m) => slice.includes(m))`. A
  handler that mutates via a shape not containing the literal text `settings.set(` — e.g.
  bracket-notation property access, `settings['set'](...)` — is not recognized as mutating
  at all, and so is never checked for a broadcast — a stronger evasion than every other
  item in this section: it skips the net entirely rather than defeating only the broadcast
  credit. This predates this squawk and no review round across all three fix cycles has
  flagged it; fixing all five mutation markers symmetrically is a larger, separate change
  and is disclosed here rather than folded into this squawk's scope.

**Fail-safe (verified false failure or loud failure — no genuine handler is silently
under-credited):**

- **Helper-calling-helper (two-level indirection) is not credited.** `extractBroadcastHelperNames`
  only credits a helper whose OWN body is, at the top level, a direct call to
  `broadcast(`/`broadcastToChromeAndInternal(`. A helper whose body calls a SECOND helper
  that itself broadcasts (`const inner = () => broadcast('settings-changed', …); const
  broadcastSettings = () => inner();`) is not recognized as broadcasting, so a handler
  calling `broadcastSettings()` in that shape would incorrectly FAIL the net — a false
  negative in the fail-safe direction, never the reverse. No registrar today uses
  two-level helper indirection. Closing it properly needs recursive helper-graph
  resolution — a small design decision about how deep to recurse — so it is disclosed
  rather than added here.
- **Block-bodied (`=> { ... }`) or `function`-declared broadcast helpers are not
  recognized as helpers at all** (`BROADCAST_HELPER_RE` only matches the one-liner
  `const NAME = (...) => <expr>;` shape). Same fail-safe direction as above: a handler
  calling such a helper would fail the net even if the helper genuinely broadcasts. No
  registrar today defines a broadcast helper this way.
- **The inherited `maskComments` regex-literal blind spot** (documented in
  `test/helpers/source-scan.js`'s header): a regex literal containing an odd number of
  quote characters (e.g. `/don't/`) desyncs quote-parity tracking and disables comment
  masking for the rest of the file. The toolkit's own header explains why this stays
  fail-safe rather than unsound: an inverted mask leaves comment TEXT unmasked and
  scanned as code, which tends to light up the nets with spurious matches (loud) rather
  than quiet them (silent) — it does not selectively hide a real no-broadcast handler.
  Latent on current source (`grep -cE "/\[[^]]*['\"]" src/main/main.js` → 0), unchanged by
  this squawk, and already disclosed at the toolkit level.
- **The marker computed via concatenation, interpolation, or a non-literal expression**
  (`broadcast('settings' + '-changed', …)`, a template literal with `${}` substitution, or
  a channel name read from a variable) is not recognized — deliberate, matching the fix
  cycle 2 reviewer's own framing that the marker must be a literal first argument, and
  fail-safe (a real handler using this shape would fail the net loudly, not pass silently).

None of the fail-safe items lets a genuinely no-broadcast mutating handler pass the net
silently. The unsound items are the live soundness gaps: each is judged narrower than the
findings closed across the three fix cycles (all of which were trivially reachable by an
ordinary refactor — a DRY helper extraction, a decoy string, a shadowed name, a
destructured binding) because each requires either deliberately obfuscated code with no
legitimate reason to be written that way, or a parameter/binding shape with zero current
production precedent anywhere in the nine registrars, confirmed by grep for every item
above.

## Verification

Commands run (all from `~/projects/goldfinch`, on `squawk/turnaround-2026-08-08`):

```
$ node --test --test-timeout=60000 test/unit/broadcast-invariant.test.js
# tests 26
# pass 26
# fail 0

$ node --test --test-timeout=60000 test/unit/*.test.js   # full suite, fail-fast timeout
# tests 3667
# pass 3667
# fail 0

$ npx eslint test/unit/broadcast-invariant.test.js
(no output — clean)
```

**Tripwire re-arm proof — ten properties, each proved by temporarily editing
`src/main/register-settings-ipc.js` and reverting** (rounds 1–3's six properties, plus fix
cycle 3's four new shapes — the third reviewer's destructuring probe, its helper-name
analog, the parenthesized parameter-shadow probe, and the parenless single-param arrow
probe — all re-proved together in one pass):

All ten probes were added to `src/main/register-settings-ipc.js` at once, right before its
closing `}`:
```js
ipcMain.on('probe-mutate-no-broadcast', () => {
  settings.set('automationPort', 1);
});

const fakeBroadcastHelperProbe = () => 'settings-changed marker but does nothing';
ipcMain.on('probe-decoy-helper', () => {
  settings.set('automationPort', 1);
  fakeBroadcastHelperProbe();
});

ipcMain.on('probe-inline-marker-string', () => {          // Finding A
  settings.set('automationPort', 1);
  const note = 'settings-changed is intentionally not sent for this internal counter';
});

ipcMain.on('probe-shadowed-name', () => {                 // Finding B
  settings.set('automationPort', 1);
  const broadcastSettings = () => {};
  broadcastSettings();
});

ipcMain.on('probe-decoy-method', () => {                  // proactive hardening
  settings.set('automationPort', 1);
  const fakeBroadcast = { broadcast: () => {} };
  fakeBroadcast.broadcast('settings-changed', 'noop');
});

ipcMain.on('probe-shadowed-broadcast', () => {            // proactive hardening
  settings.set('automationPort', 1);
  const broadcast = () => {};
  broadcast('settings-changed', 'noop');
});

ipcMain.on('probe-destructure-shadow', () => {            // fix cycle 3, third review
  settings.set('automationPort', 1);
  const { broadcast } = { broadcast: () => {} };
  broadcast('settings-changed', 'noop');
});

ipcMain.on('probe-destructure-helper-shadow', () => {     // fix cycle 3, helper-name analog
  settings.set('automationPort', 1);
  const { broadcastSettings } = { broadcastSettings: () => {} };
  broadcastSettings();
});

ipcMain.on('probe-param-shadow', (broadcast) => {         // fix cycle 3, contrived shape
  settings.set('automationPort', 1);
  broadcast('settings-changed', 'noop');
});

ipcMain.on('probe-parenless-param-shadow', broadcast => { // fix cycle 3, parenless arrow
  settings.set('automationPort', 1);
  broadcast('settings-changed', 'noop');
});
```

`node --test --test-timeout=60000 test/unit/broadcast-invariant.test.js` failed with all
ten correctly reported as violations in one run:
```
handler(s) mutate settings without broadcasting settings-changed: register-settings-ipc.js:probe-mutate-no-broadcast, register-settings-ipc.js:probe-decoy-helper, register-settings-ipc.js:probe-inline-marker-string, register-settings-ipc.js:probe-shadowed-name, register-settings-ipc.js:probe-decoy-method, register-settings-ipc.js:probe-shadowed-broadcast, register-settings-ipc.js:probe-destructure-shadow, register-settings-ipc.js:probe-destructure-helper-shadow, register-settings-ipc.js:probe-param-shadow, register-settings-ipc.js:probe-parenless-param-shadow
```

- `probe-mutate-no-broadcast`, `probe-decoy-helper`, `probe-inline-marker-string`,
  `probe-shadowed-name`, `probe-decoy-method`, and `probe-shadowed-broadcast` re-confirm
  all six properties fixed in rounds 1–3 still fail correctly (no regression).
- `probe-destructure-shadow` is the third reviewer's exact reproduction (this fix cycle's
  blocking finding) → now correctly fails (previously reported `ok`, 0 violations, per the
  review).
- `probe-destructure-helper-shadow` is the helper-name analog the reviewer also named →
  now correctly fails.
- `probe-param-shadow` is the reviewer's parenthesized function-parameter shadow (`(broadcast)
  => {...}`, the "contrived shape" the reviewer flagged) → now correctly fails.
- `probe-parenless-param-shadow` is the parenless single-param arrow form (`broadcast =>
  {...}`) found while verifying the parameter-shadow fix — not in the reviewer's report,
  but the same class, closed in the same pass rather than left for a fourth round → now
  correctly fails.

**The genuine `broadcastSettings()` indirection → still correctly credited, suite green.**
Reverted all ten probes (`cp /tmp/register-settings-ipc.js.orig
src/main/register-settings-ipc.js`, confirmed by `diff /tmp/register-settings-ipc.js.orig
src/main/register-settings-ipc.js` — byte-identical, no output) and re-ran: `node --test
--test-timeout=60000 test/unit/broadcast-invariant.test.js` → 26/26 pass, zero violations
on the real `broadcastSettings()` helper and on `jar-registry-ipc.js`'s direct
`broadcast('settings-changed', settings.getAll())` call. `git diff --stat` confirmed
`src/main/register-settings-ipc.js` carries no probe residue and no diff at all against
this squawk's baseline (untouched — squawk 0002's `src/main/main.js` changes remain the
only production diff, unchanged by this squawk and out of scope). Re-ran the full suite
(`node --test --test-timeout=60000 test/unit/*.test.js`) to confirm the revert restored
green: 3667/3667 passing (3665 pre-existing + the 2 new fixture tests this fix cycle
added).

No genuine handlers were found broadcasting insufficiently on current `main`. No handler
fix was applied; none was needed — every finding across all three fix cycles, and every
proactively-hardened shape, was a scanner gap, not a real production defect.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the implementer's reasoning) —
four review rounds
**Verdict**: confirmed

Three rounds each defeated the net with a decoy the previous fix hadn't considered, and
each was closed in turn: (1) helper-crediting by raw substring match, (2) the base check by
raw substring match plus bare-identifier helper matching with no scope resolution, (3)
`locallyShadowsName` missing destructuring and parameter-shadow bindings. The final round
verified by probe against production source that all closed shapes now fail the net, that
the genuine `broadcastSettings()` indirection is still credited, and that every entry in
Disclosed Residual Limitations is correctly bucketed — each **Unsound** shape reproduces a
false PASS, each **Fail-safe** shape errs toward a false failure. One further false-PASS
shape found in the final hunt (a default-value initializer truncating the destructuring
scan) was judged an instance of an already-disclosed class, not a new one, and has been
folded into that entry.

The reported defect is closed: the net derives its handler inventory from production source
again, so a mutating handler added without its broadcast fails the test with nobody editing
the test. The residual blind spots are inherent to text-level matching — closing them would
need a real parser, which exceeds squawk scope — and are disclosed rather than papered over.

**Commit**: `squawk/turnaround-2026-08-08`
