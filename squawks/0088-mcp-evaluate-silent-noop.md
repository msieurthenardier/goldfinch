# Squawk 0088: MCP `evaluate` is a silent no-op in some builds

**Status**: deferred
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-18
**Completed**: —

## Report

`evaluate` returns `{"ok":true}` while the evaluated code never runs. No error, no
rejection — a caller cannot tell, which is the worst possible shape for this.

Three observations that do not yet agree, which is why this is logged rather than
fixed:

1. Against the operator's **installed 0.16.5** build: `evaluate` set a DOM
   attribute, and a following `readDom` confirmed the attribute was absent.
   `readDom`'s `selector` / `maxLength` arguments also appeared to be ignored.
2. Mission 21 Flight 1's **Leg 2 spike** explicitly verified `evaluate` WORKS in a
   dev build from source (a `1+41 → 42` sanity check before relying on it).
3. Flight 1's **Leg 3 live probe** then observed `evaluate` as a silent no-op on a
   genuine `npm run dev:automation` dev-build launch — contradicting (2).

## Evidence

- Observation (1), this session: `evaluate` with
  `document.documentElement.setAttribute('data-probe-marker','alive')` resolved
  `{"ok":true}`; a subsequent `readDom` showed `data-probe-marker` absent.
- Observations (2) and (3) are recorded in
  `missions/21-saving-not-just-filling/flights/01-the-save-moment/flight-log.md`
  (Leg 2 findings; Leg 3 progress entry).

## Disposition at logging (superseded)

**Left OPEN, not completed in the 2026-09-19 turnaround.** It fails squawk
qualification criterion 2 (*no design decisions — the fix approach is obvious, or
discoverable in one read pass*): the cause is unknown and the evidence is
self-contradictory, so the next step is a deliberate reproduction across packaged
and dev builds, not a fix. Completing it would mean growing an investigation inside
a squawk, which is what the gate exists to prevent.

Worth noting for whoever picks it up: the fix may be as much about **failing
loudly** as about the underlying cause. A silent no-op on an automation primitive
is a defect independent of why the evaluation is dropped.

## Disposition (Flight Director, 2026-09-19)

**Deferred — NOT reproducible against current source, and partly a
misdiagnosis on the reporter's side.** Closing it as `completed` would imply a
corrective action; there was none, and the honest record matters more.

Three things the diagnostic established:

1. **Version skew ruled out.** `git diff faca454..HEAD --stat -- src/main/`
   (faca454 = the 0.16.5 release-prep commit) shows ZERO changes under
   `src/main/automation/**`. The installed build and this tree run byte-identical
   automation code, so "the packaged build predates a fix" is false.
2. **The headline symptom does not reproduce.** Against the SAME running
   installed instance, `evaluate(wcId, "1+1")` → `2`; concurrent
   `evaluate`s returned their own correct values (ruling out a request-ordering
   race); and a `setAttribute` expression's effect WAS present in the live DOM
   afterwards.
3. **Part of the original report was a misreading.** `serialize()` collapses an
   `undefined` return into `{"ok":true}`, and a `setAttribute` expression
   evaluates to `undefined` — so that probe's `{"ok":true}` was CORRECT, not
   evidence of a no-op. The reporter read a correct response as a broken one.

What remains genuinely unexplained: the reporter also observed `1+1` returning
`{"ok":true}` and a marker absent from a following `readDom`. That is not
explainable by the `undefined` collapse and was not reproducible later the same
day. Environmental or transient; cause unknown.

Also corrected: `readDom` never accepted `selector`/`maxLength` — its schema is
`{wcId}` only. Those arguments were not "ignored"; they never existed.

**Revisit trigger**: if the symptom recurs, capture in the same session — the
exact `wcId`, the full tool response, whether OTHER ops work at that moment, and
whether DevTools is open on that tab (it takes Chromium's single CDP slot, which
affects CDP-dependent ops though `evaluate` is CDP-free). Starting from that
evidence beats re-deriving it, which is what this squawk cost.

## Corrective Action

**No code changed.** This diagnostic pass (2026-09-19) could not reproduce the
headline symptom (a `1+41`-style expression resolving `{"ok":true}`) against the
exact running instance the squawk was originally filed against, and found the
automation source is byte-identical between the `v0.16.5` release commit and this
branch's `HEAD` — so "old packaged build" is ruled out as an explanation; the
installed binary and this source tree run the same code.

**What was checked:**

1. **Version skew, ruled out.** `git diff faca454..HEAD --stat -- src/main/` (`faca454`
   = `release-prep: bump to 0.16.5`) shows zero changes to `src/main/automation/**`
   between the 0.16.5 tag and current `HEAD`. The installed build and this source
   tree run byte-identical `mcp-tools.js` / `observe.js` / `engine.js` /
   `mcp-server.js` / `scope.js`. There is no fix in source that the installed build
   predates.

2. **Live re-test against the operator's actual running installed build** (the
   `goldfinch` MCP server at `127.0.0.1:49152`, the same instance the squawk's
   observation (1) was taken against), read-only, via a self-opened throwaway tab
   (closed after use):
   - `evaluate(wcId, "1+1")` → `2` (not `{"ok":true}`).
   - `evaluate(wcId, "1+41")` → `42`, and `evaluate(wcId, "document.title")` →
     `"Example Domain"`, fired as two concurrent tool calls in one turn — correct,
     non-serialized results for both, ruling out a same-session request-ordering
     race as an explanation.
   - `evaluate(wcId, "document.documentElement.setAttribute('data-probe-marker','alive')")`
     → `{"ok":true}`, followed by `readDom(wcId)` → the returned `html` genuinely
     contains `data-probe-marker="alive"`. **The code ran; the DOM was mutated.**
   None of these reproduce the reported no-op. `evaluate` is not currently broken
   on the instance in question.

3. **A real, confirmed, live-reproducible ambiguity was found — but it is not a
   no-op.** `mcp-tools.js`'s `serialize()` (the wire-shaping function every tool
   result passes through) is:
   ```js
   serialize(value) = value === undefined ? '{"ok":true}' : JSON.stringify(value)
   ```
   This collapse is *correct and pinned by test* for the genuinely-void drive ops
   (`navigate`, `click`, `typeText`, …, per `test/unit/automation-mcp-tools.test.js`'s
   `'void ops (resolve undefined) serialize to the {"ok":true} success shape'`), which
   always resolve `undefined` by construction. But `evaluate`'s return value is
   supposed to be *meaningful* — and a large class of ordinary JS expressions
   legitimately evaluate to `undefined` (`element.setAttribute(...)`,
   `console.log(...)`, most DOM-mutation one-liners, a bare declaration). When that
   happens, `evaluate`'s response is byte-for-byte identical to `injectScript`'s
   documented void-success shape and to every void drive op's success shape —
   confirmed above: the `setAttribute` call above genuinely ran and mutated the
   DOM, yet its wire response is indistinguishable from "nothing happened." This
   is a real ambiguity in the MCP result contract, not a code defect that drops
   work. `docs/mcp-automation.md`'s "Result and refusal semantics" table (line
   ~826) doesn't even list `evaluate` in either its "Void ops" or "Ops with a real
   return value" enumeration — a genuine documentation gap consistent with this
   ambiguity being unrecognized rather than deliberately accepted.

4. **A plausible, but unconfirmed, mechanical explanation matching the *exact*
   reported symptom shape: a tool-name mix-up with `injectScript`.**
   `injectScript` is a separate, adjacently-registered, similarly-described MCP
   tool (`mcp-tools.js`, registered immediately after `evaluate`) whose contract is
   genuinely "run the script, discard whatever it returns, always resolve
   `{"ok":true}`" (`observe.js`'s `injectScript`: `await wc.executeJavaScript(script); `
   — the resolved value is thrown away, `return` is implicit `undefined`). Live
   confirmation: `injectScript(wcId, "1+41")` → literally `{"ok":true}` — the exact
   string Leg 3's anomaly note reports for `evaluate` on the same expression. If
   the reporting session's tooling invoked `injectScript` while believing it was
   calling `evaluate` (the two tools have near-identical descriptions and sit next
   to each other in a 30-tool list), every observed symptom in Leg 3's note (`ok:true`
   for `1+41`, for `document.title`, for DOM-mutation triggers) would be exactly
   reproduced with zero server-side defect. This does **not** fully explain this
   squawk's own observation (1) — `injectScript` genuinely executes, so
   `injectScript` + `setAttribute` really does mutate the DOM (verified live: same
   sequence via `injectScript` then `readDom` shows the attribute present) — so
   "attribute absent after the call" is not reproduced by the tool-mixup theory
   either. That specific detail is most consistent with a `wcId` mismatch between
   the `evaluate` and `readDom` calls in that original session (e.g. a stale wcId
   from an earlier tab reused in the follow-up read) rather than a code defect;
   it was not otherwise reproducible.

5. **No dispatch/registration mismatch found.** `mcp-tools.js`'s `TOOLS` array
   registers `evaluate` and `injectScript` as two distinct defs with distinct
   `call` mappers; `engine.js` dispatches `evaluate` → `observe.evaluate` and
   returns its resolved value untouched (no coercion); `scope.js`'s
   `WCID_FIRST_OPS` correctly lists `evaluate`. Nothing internally routes one
   tool's calls into the other's handler, and `readDom`'s tool schema
   (`{wcId}` only) has never accepted `selector`/`maxLength` — those parameters
   don't exist on this tool at all (confirmed against both `mcp-tools.js`'s
   `readDom` def and `observe.js`'s `readDom(wcId, deps)` signature), so
   observation (1)'s "selector/maxLength appeared to be ignored" is expected
   behavior for a tool that was never built to take them — a caller assumption
   mismatch, not a bug (extraneous JSON args are simply dropped, unvalidated).

**Disposition:** the original headline symptom (a genuine full no-op — `evaluate`
returning `{"ok":true}` for an expression like `1+41` that has a real, non-`undefined`
value) is **not reproducible against current source**, live-tested on the exact
installed instance in question. The one real, confirmed-live defect found (item 3,
the `undefined`-collapse ambiguity) is a **wire-contract design question**, not a
one-line fix: `evaluate` and `injectScript`/the void ops currently share one
`serialize()` function and one success shape by deliberate, tested, documented
design (DD6); giving `evaluate` a distinguishable shape for a legitimate
`undefined` result (e.g. always wrapping its success as `{value: <x>}`, or some
other envelope) is a breaking change to `docs/mcp-automation.md`'s documented
consumer contract and to `serialize()`'s DD6 design, and needs an explicit FD/design
ruling on the new shape — squawk qualification criterion 2 (no design decisions)
is not met. **No fail-loudly guard was added** for the same reason: the only
"loud" options available without a wire-contract change (e.g. refusing to run an
`evaluate` expression whose value happens to be `undefined`) would make `evaluate`
error on a wide range of completely legitimate scripts, which is a behavior change
in its own right and worse than the status quo.

Recommend: close **this squawk's original headline symptom** as not reproducible
against current source (both installed 0.16.5 and this tree run identical, correctly-
functioning automation code); separately, log a **new**, narrowly-scoped follow-up
for item 3 above (the `evaluate` `undefined`/void-op wire-shape ambiguity) framed as
a design question for the Flight Director — e.g. "should `evaluate`'s success shape
be distinguishable from a void op's, and if so, how" — rather than continuing to
carry it under this squawk's already-closed defect framing.

## Verification

No production code was changed, so the standing `npm test` / `npm run lint` /
`npm run typecheck` / `npm run format` gates were not re-run (nothing to verify).

Live verification performed against the operator's running installed 0.16.5
build (`goldfinch` MCP server, `127.0.0.1:49152`), read-only, via a self-opened
`about:blank` tab (wcId 26) and a self-opened `https://example.com` tab (wcId 27),
both closed at the end of the session:

- `evaluate(26, "1+1")` → `2`
- `evaluate(27, "1+41")` and `evaluate(27, "document.title")`, fired concurrently
  → `42` and `"Example Domain"` respectively
- `evaluate(26, "document.documentElement.setAttribute('data-probe-marker','alive')")`
  → `{"ok":true}`; `readDom(26)` → `html` contains `data-probe-marker="alive"`
  (the mutation genuinely landed)
- `injectScript(27, "1+41")` → `{"ok":true}` (confirms the tool-mixup theory's
  shape match)
- `injectScript(27, "document.documentElement.setAttribute('data-probe-marker','alive')")`
  → `{"ok":true}`; `readDom(27)` → `html` contains `data-probe-marker="alive"`
  (confirms `injectScript` genuinely executes, ruling it out as an explanation for
  observation (1)'s "attribute absent" specifically)
- `git diff faca454..HEAD --stat -- src/main/` → zero hits under
  `src/main/automation/`, confirming no version skew between the installed 0.16.5
  build and this source tree in the relevant code path
- `grep` confirmed no test in `test/unit/automation-mcp-tools.test.js` pins
  `evaluate`'s behavior when the evaluated expression's value is `undefined`
  (the void-ops list explicitly excludes `evaluate`/`injectScript`; a separate
  `evaluate maps named args → …` test only exercises a non-`undefined` return) —
  the ambiguity in item 3 above is confirmed unpinned, not deliberately tested.

## Sign-Off

*(written at completion)*
