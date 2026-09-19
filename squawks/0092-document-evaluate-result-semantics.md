# Squawk 0092: `evaluate` result semantics are undocumented and ambiguous

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-19
**Completed**: 2026-09-19

## Report

`docs/mcp-automation.md`'s result-semantics section does not list `evaluate` in
either its void-ops enumeration or its real-return-value enumeration. A consumer
reading the doc cannot tell what a successful `evaluate` looks like.

This is not academic: it directly caused a misdiagnosis. `serialize()` collapses an
`undefined` return into `{"ok":true}` — the same shape genuinely-void drive ops
return — so an ordinary mutation expression (`setAttribute`, `console.log`, most
one-liners) succeeds with a response indistinguishable from a no-op. That was read
as a broken `evaluate` and cost a squawk (0088) and a flight-wide instruction to
treat the op as unavailable.

Found while diagnosing 0088; confirmed live, not inferred.

## Evidence

- `src/main/automation/mcp-tools.js` — `serialize()` maps an `undefined` op return
  to `{ ok: true }`; `evaluate`'s ToolDef rides the default serializer.
- Live against the installed build: `evaluate(wcId, "1+1")` → `2`;
  `evaluate(wcId, "document.documentElement.setAttribute(...)")` → `{"ok":true}`
  while the attribute WAS set.
- `injectScript` returns `{"ok":true}` by contract (return discarded) — adjacent
  in the tool list, similarly described, and a plausible mix-up for a consumer.

## Scope

Documentation only: state `evaluate`'s result semantics explicitly, including that
an expression evaluating to `undefined` is indistinguishable from a void op's
success, and contrast it with `injectScript`'s discard-by-contract. That is
squawk-sized.

**Raised but NOT decided here** — whether `evaluate`'s success shape SHOULD be
distinguishable from a void op's is a wire-contract question: changing it breaks
the documented consumer contract and DD6's tested design, while refusing
`undefined`-valued expressions would break legitimate scripts. That needs an FD
ruling and does not ride this squawk.

## Corrective Action

Verified the actual shapes before writing anything (per the assignment's instruction
not to take the report on trust):

- `serialize()` (`src/main/automation/mcp-tools.js:57-59`) is exactly
  `value === undefined ? '{"ok":true}' : JSON.stringify(value)`.
- `evaluate` (`src/main/automation/observe.js:489-508`) awaits
  `wc.executeJavaScript(expression)` and returns the resolved value verbatim (after
  a JSON-serializability pre-flight). Its ToolDef (`mcp-tools.js`) rides the default
  serializer with no special-casing — so a resolved `undefined` collapses to
  `{"ok":true}` exactly like the report says.
- `injectScript` (`observe.js:549-556`) always `await`s and then discards
  `wc.executeJavaScript(script)`'s result — the function has no `return` statement,
  so it resolves `undefined` unconditionally, regardless of what the injected
  script evaluates to. Its `{"ok":true}` is void **by contract**, not by
  coincidence — confirms the report's contrast.

All three claims in the squawk/report were accurate; nothing needed correcting.

Documentation changes (no source/behavior changes):

- `docs/mcp-automation.md`, *Eval tools* section: added a clause to the `evaluate`
  table row stating that a resolved `undefined` serializes to `{"ok":true}`;
  clarified the `injectScript` row's `(void)` as "by contract" and why that's
  unambiguous; added a new gotcha blockquote directly under the tools table
  spelling out the collapse, the practical consequence (an ordinary mutation
  one-liner's success is indistinguishable from a no-op), the sentinel-return
  workaround, the contrast with `injectScript`, and a pointer back to squawk 0088.
- `docs/mcp-automation.md`, *Result and refusal semantics* section: added
  `injectScript` to the void-ops enumeration (with a one-clause "by contract"
  note), and added a new bullet stating plainly that `evaluate` belongs to neither
  the void-ops nor the real-return-value enumeration — its result is whatever the
  expression evaluates to, including `undefined`, which collapses to the same
  `{"ok":true}` shape. Includes the same sentinel-return recommendation and the
  `injectScript` contrast, and names squawk 0088 as the cost of the gap.
- `CLAUDE.md`'s Automation engine section: appended one clause to the existing
  `evaluate`/`injectScript` sentence (which already said "`evaluate` returns must
  be JSON-serializable") noting the `undefined`-collapse and citing this squawk —
  judged to genuinely belong there since the existing sentence already documents
  adjacent `evaluate` result-shape behavior and the map/manual split favors a
  short pointer over silence on a gap that already cost a squawk.

Scope respected: `serialize()`, both `evaluate`/`injectScript` ToolDefs, and every
other wire shape are untouched — `git diff` touches only `CLAUDE.md`,
`docs/mcp-automation.md`, and this squawk file. Whether `evaluate`'s success shape
*should* be distinguishable from a void op's remains open and undecided, as scoped.

## Verification

- `npm test` — 5173 tests, 5170 pass / 0 fail / 3 todo (pre-existing todos,
  unrelated to this change).
- `npm run lint` — clean, no findings.
- `npm run typecheck` — clean, no findings.
- `npm run format` — re-run after edits; `npx prettier --check CLAUDE.md
  docs/mcp-automation.md squawks/0092-document-evaluate-result-semantics.md`
  confirms all three are Prettier-clean.
- Re-read the edited sections of `docs/mcp-automation.md` after writing them to
  confirm the new text doesn't contradict the table rows or the security-invariant
  blockquotes it sits beside.

## Sign-Off

**Reviewer**: independent Reviewer agent (leg-execution crew)
**Verdict**: confirmed — all three factual claims the doc now makes were
re-verified against source (`serialize()`'s `undefined` collapse; `evaluate`
returning the resolved value verbatim with no `shape` mapper; `injectScript`
having no `return` at all, so its void shape is genuinely by contract). No
inaccurate statement found — which was the blocking bar, since a wrong doc about
exactly this would be worse than the silence it replaced.
**Commit**: see `squawk/0088-mcp-evaluate-silent-noop` branch
