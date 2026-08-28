# Leg: mcp-automation-docs-truing

**Status**: completed
**Flight**: [Automation-Surface Internal-Session Invariant](../flight.md)
**Slug**: `mcp-automation-docs-truing`
**Risk tier**: low — documentation only; no code. (Closing leg; must reflect the SHIPPED state of Legs 1–3.)

## Objective

Close finding F10k (flight DD5): true `docs/mcp-automation.md`, the behavior-test crew apparatus note, **and the shipped-code comments/descriptions Leg 1 wrote**, to the tier-based internal-session model this flight shipped — using the CORRECTED justification (the admin tier is a high-bar, key-gated, loopback-bound tier that CAN be enabled on a packaged build; **NOT** "dev-only"). Every claim verified against the landed code, not the pre-pivot text and not the retracted dev-only draft.

## Context

Legs 1–3 changed the reality the docs describe:
- **Leg 1** relaxed the op-local admin refusals on `evaluate`/`injectScript`/`openDevTools`/`closeDevTools` — admin (dev-only) now reaches internal `goldfinch://` guests; non-admin is still refused at the resolver; the secret sheet is still refused for all.
- **Leg 2** threaded the sheet predicates into the vault tools, so `vaultFill`/`vaultAnswerAuth` now go through the same sheet gate (the master-password sheet is refused for all tiers).
- **Leg 3** did not touch `mcp-automation.md`'s covered surface (download-ipc trust) — no doc change owed there for this finding.

**Stale claims to rewrite (verified 2026-08-28 against the pre-truing doc; re-verify against the SHIPPED code before editing):**

1. `docs/mcp-automation.md:42` — invariant row: *"Internal-session (`goldfinch://settings`) always excluded — Both eval tools and both DevTools tools refuse the internal session — even for admin."* Now **false for admin**. Rewrite to the tier model.
2. `:579-584` — eval-tools "Security invariant — internal session always excluded, even for admin" block. Rewrite.
3. `:606-607` — DevTools-tools equivalent block. Rewrite.
4. `:334-376` — the menu-overlay **sheet** section. Add that the **vault tools** (`vaultFill`/`vaultAnswerAuth`) now resolve through the same `isSheetContents` gate (Leg 2), so the master-password sheet is refused to them at every tier — the section currently describes the general engine ops and never names the vault tools.
5. `:686` — `vaultFill` return-shape row: currently `{ filled: true, id }` with reasons `"locked"/"no-match"/"origin-mismatch"`. The shipped `fill()` returns `{ filled: true, id, origin }` (`vault-context.js:512`) and has an `"ambiguous"` reason (`:494`). Add `origin` and `"ambiguous"`.
6. **Shipped-code dev-only claims (retraction, HIGH):** Leg 1 wrote a FALSE "admin is dev-only / cannot exist in a packaged build" justification into shipped code — `src/main/automation/observe.js` (comments ~`:48,51,68,474,492,534,574-575,612`) and `src/main/automation/mcp-tools.js` (tool descriptions `:508,532,566,583` + comments `:432,555`). Replace every "dev-only" / "cannot exist in a packaged build" / "`!app.isPackaged`" claim with the accurate tier model: the admin tier reaches internal guests by design; it is a high-bar, deliberately-enabled, loopback-bound, key-gated tier (env `GOLDFINCH_AUTOMATION_ADMIN` + a minted key + the Settings toggle) that CAN be enabled on a packaged build; non-admin is refused at the resolver; the secret sheet is refused for all tiers; secrets never enter the page DOM. Keep the comments concise.
7. `.flightops/agent-crews/behavior-tests-execution.md:~347` — the apparatus note *"`evaluate` on internal guests: refused outright … judge internal-guest DOM state from rendered pixels/a11y, never `evaluate`."* Under the pivot, `evaluate`/`readDom` on internal guests now WORK under admin — correct the note so the crew knows it can evaluate internal guests (rather than being told it can't).

## Inputs

- `flight/02` after Legs 1–3 landed (uncommitted). Docs-only; no overlap with any code leg's files.

## Outputs

- `docs/mcp-automation.md` — items 1–5 rewritten to the tier model + the vaultFill shape trued.
- `.flightops/agent-crews/behavior-tests-execution.md` — item 6 note corrected.
- Flight-log leg entry; this leg `landed`.

## Acceptance Criteria

- [x] AC1: the `:42` invariant row states the tier model — non-admin refused internal on every op (at the resolver); the admin (dev-only) tier reaches internal guests on every op; the master-password secret sheet refused for all tiers — and no longer says "even for admin" for eval/DevTools.
- [x] AC2: the eval-tools (`:579`) and DevTools-tools (`:606`) security-invariant blocks are rewritten to the tier model (name the resolver as the non-admin wall; state admin reaches internal guests; keep the SHEET refusal for all).
- [x] AC3: the sheet section (`:334-376`) states the vault tools now resolve through the `isSheetContents` gate (Leg 2), so the secret sheet is refused to `vaultFill`/`vaultAnswerAuth` at every tier.
- [x] AC4: the `vaultFill` return-shape row (`:686`) includes `origin` in the success shape and `"ambiguous"` among the reasons, matching `vault-context.js:494/512`.
- [x] AC5: the behavior-crew apparatus note is corrected (evaluate/readDom on internal guests work under admin).
- [x] AC6: every rewritten claim matches the SHIPPED code (the Developer greps the landed `observe.js`/`vault-context.js`/`resolve.js` to confirm each statement); no NEW inaccuracy introduced. Gates: `npm test` (docs don't change it, but confirm no doc-pinning test breaks — e.g. a doc-source-pin), `npm run lint`, `npx prettier --check .`.

## Verification Steps

- AC1–AC5: read the rewritten sections; each factual claim cross-checked against the cited code line.
- AC6: grep for any test that pins `docs/mcp-automation.md` text (there may be a doc-truth pin); run the gates.

## Implementation Guidance

1. Before editing, re-read the landed `observe.js` (the four ops no longer refuse admin), `resolve.js:210/233` (sheet + non-admin gates), `vault-context.js:494/512` (vaultFill reasons/return), and Leg 2's `resolveTarget` change — write only what the code does.
2. Rewrite items 1–5 in `docs/mcp-automation.md`. Keep the doc's voice/table shape. For the invariant row and the two blocks, the core sentence is: "Non-admin (jar) keys are refused internal `goldfinch://` targets on every op at the resolver; the admin tier — dev-only, `GOLDFINCH_AUTOMATION_ADMIN` + `!app.isPackaged`, absent in a packaged build — reaches internal guests on every op; the master-password secret sheet is refused for all tiers."
3. Correct item 6 in the crew file — keep it factual and brief.
4. Check for a doc-source-pin test (grep `mcp-automation` in `test/`); if one asserts the old text, update it in step with the doc (rename/adjust, don't weaken).
5. Gates.

## Edge Cases

- **Do not overclaim**: admin reaching internal guests is real, but the secret SHEET is still refused to everyone — keep that distinction sharp in every rewritten sentence (it is the DD3 line).
- **`origin` is non-secret**: the doc should note (as the code comment does) that `vaultFill`'s returned `origin` is the resolved top-frame origin, never a credential.
- **A doc-pin test may exist**: if a test greps the doc for a stale phrase, it must be updated alongside the doc, not left to fail.

## Files Affected

`docs/mcp-automation.md`, `.flightops/agent-crews/behavior-tests-execution.md`, and any doc-pin test that references the changed text. (No source code.)

## Citation Audit

2026-08-28, against `flight/02` post-Legs-1–3: `docs/mcp-automation.md:42/334-376/579-584/606-607/686`; `vault-context.js:494` (`ambiguous`) / `:512` (`{ filled, id, origin }`); `resolve.js:210/233`; `behavior-tests-execution.md:~347`. All read at design time; the Developer re-verifies against shipped code per AC6.
