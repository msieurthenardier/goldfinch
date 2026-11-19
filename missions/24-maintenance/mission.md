# Mission: Maintenance

**Status**: active

## Outcome

Resolve codebase health issues identified in maintenance report 2026-11-18.

## Context

Routine maintenance on 2026-11-18, after Mission 23, rated the codebase **Maintenance Required**: 0 Critical, 3 Action Required, 31 Advisory. See [maintenance/2026-11-18.md](../../maintenance/2026-11-18.md).

The code is healthy: all 7,323 tests pass, and lint, format and typecheck are clean. The three Action Required findings are:

1. **The release process tags commits that fail their own gate.** `npm audit --audit-level=high` has been red since 2026-10-19 (`picomatch` GHSA-fc5q-39xc-vjpf, no patched release). v0.19.16–.18 were all tagged on failing commits, and nothing noticed, because `build.yml` runs no gate of its own.
2. **The reveal gate's per-item grant can be swapped.** Mission 23 built the gate. Vault item save and copy are ungated by design, but a Replace-copy keeps the item id that a grant is keyed on.
3. **The composition root keeps absorbing behavior.** `main.js` has grown 2,014 → 3,263 lines since August, and `renderer.js` is at 1,504 of its 1,505-line budget.

Operator rulings at report review (2026-11-18):

- The audit gate waits for an upstream fix: no `node-gyp` override and no exception.
- The release build runs `npm audit` and `check-fuses` itself.
- All three flights are in scope.
- Squawk-sized findings were logged separately as squawks 0210–0221.

## Success Criteria

- [x] **A release cannot be built from a commit that fails the audit or fuse gate**: `build.yml` runs both before any installer is staged, and `release-workflow-invariants.test.js` pins it. *(Finding #1, incl. #16.)*
- [x] **Dependabot cannot quietly regress SHA pinning**: `.github/dependabot.yml` records the re-pin rule, and the runtime is on the current Electron 45 patch (45.3.4 or later). *(Findings #14, #9.)*
- [x] **A reveal-gate grant covers one item's content, not one item id**: a test shows that a save, Replace-copy or delete drops that item's grants, and that the dialog cannot be misled by a rename. `admin-reach-refusal` passes in full. *(Finding #2, #38 part.)*
- [x] **Opening a downloaded program from admin-scripted code has an operator ruling, implemented and documented** in `docs/mcp-automation.md` *What each tier can reach*. *(Finding #3.)*
- [x] **`main.js` no longer owns the window-capture, vault-wiring and human-wiring blocks**, and `renderer.js` has at least 40 lines of budget headroom. All gates are green and both `createEngine` grep pins are intact. *(Finding #10.)*

## Stakeholders

- **The operator (the only human user):** relies on the reveal gate when running admin automation, and on releases being what the gates say they are.
- **Future flights:** blocked by `renderer.js`'s budget, and slowed by `main.js`.

## Constraints

- **Never lower a gate** (CLAUDE.md *Release / CI*). No `npm audit` allowlist and no override outside a declared range, unless the operator rules otherwise.
- **The workflow hardening stays intact**: SHA-pinned `uses:`; `build` holds `contents: read` and runs no publish step; `upload` alone holds `id-token` / `attestations`. Any `build.yml` change keeps `release-workflow-invariants.test.js` green and extends it.
- **The reveal gate's definition holds**: secret-returning, key-minting and bundle-destination channels. Widening it is an operator ruling, recorded in the docs.
- **Extractions are behavior-neutral**: no channel changes class or switches; the `markScripted`, `injectedInput`, `sheetMenuFor` and `isSavePromptContents` grep pins at both `createEngine` sites stay green; the CLAUDE.md TDZ checklist item applies to every move.
- **Squawks 0210–0221 are not in this mission**: they are completed in turnarounds.

## Environment Requirements

- Local toolchain: Node 22, `npm test` / `lint` / `typecheck` / `format:check`.
- Live smokes: `npm run dev:automation` with `GOLDFINCH_AUTOMATION_ADMIN=1` and `GOLDFINCH_AUTOMATION_DEV_MINT=1` (Flight 2). Admin runs raise real native dialogs on the operator's screen: do not click them, give `callTool` more than 60 s, and leave none open.
- Concourse `fly -t local-goldfinch` authorized, to see the `ci` job (Flight 1).
- A manual `workflow_dispatch` run of `build.yml` (Flight 1).

## Open Questions

- [x] **Release blocking (Flight 1).** Ruled 2026-11-18: hold the audit leg until `picomatch` is patched; fly the rest. Original question: "Wait for upstream" plus "the release build runs audit" means no release can be built until `picomatch` is patched, once the gate leg merges. Confirm this is intended before that leg merges, or revisit the audit-gate ruling.
- [x] **Reveal-gate fix shape (Flight 2).** Ruled 2026-11-18: (A). Original question: (A) Drop grants on any write and show the title as of grant time, or (B) drop grants on any write and confirm save/copy while the gate applies.
- [x] **Opening a downloaded program from admin script (Flight 2).** Ruled 2026-11-18: (B). Original question: (A) Accept as admin power and document it, or (B) a native confirmation while the gate applies.
- [x] **F10g (Flight 2, optional):** left out; carried as Advisory. Original question: should `vault-eligible` stop telling web pages whether the vault is unlocked?

## Known Issues

- [ ] Concourse `ci` history since 2026-10-19 was not visible to the review (`fly` not authorized). Discovered at maintenance; affects Flight 1's verification.

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are planned and created one at a time as work progresses. This list will evolve based on discoveries during implementation.

- [x] Flight 1: [Release integrity](flights/01-release-integrity/flight.md): the release build runs the audit and fuse gates; Dependabot re-pin note; Electron 45.3.4.
- [x] Flight 2: [Reveal gate covers vault item writes](flights/02-reveal-gate-item-writes/flight.md): grant-swap test first, then the fix; the open-download ruling; `isOperatorInput`; squawk 0194 and a full `admin-reach-refusal` pass.
- [x] Flight 3: [Decompose main.js and restore renderer.js headroom](flights/03-decompose-main/flight.md): window-capture, vault-wiring and human-wiring out of `main.js`; the context-menu cluster out of `renderer.js`.
