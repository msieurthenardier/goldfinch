# Flight: Automation-Surface Internal-Session Invariant

**Status**: landed
**Mission**: [Codebase Health — 2026-08-27 Maintenance](../../mission.md)

## Contributing to Criteria

- [x] The internal-session boundary is **tier-based**: non-admin keys are refused internal `goldfinch://` targets (already enforced at the resolver); the admin key **may reach** internal targets on every op (a high-bar, key-gated, loopback-bound tier — see DD2); the master-password secret sheet is refused for **all** tiers; docs state only what is enforced (criterion 3, **reframed by the 2026-08-28 pivot — see Design Decisions**)
- [x] Vault tools share the resolver predicate set so they cannot target the secret sheet even under admin; `download-media` validates its `webContentsId` (criterion 4)

---

## Pre-Flight

### Objective

> **PIVOTED 2026-08-28 (operator ruling).** The paragraph below is the ORIGINAL
> framing — enforce internal-session exclusion *even for admin* on every op.
> The operator reframed the model during flight design: the boundary is by
> **tier** — non-admin refused internal (already enforced), admin (a high-bar,
> deliberately-enabled, loopback-bound, key-gated tier) allowed to reach
> internal pages for end-to-end automation, the secret sheet walled off from
> all. (An earlier draft mis-justified this as "admin is dev-only, absent in a
> packaged build" — FALSE; corrected under DD2. The operator re-decided on the
> corrected facts: keep admin's internal reach on all builds.) The live
> objective is **DD1–DD5** below; this text is the pre-pivot record.

*(pre-pivot)* Close the guard drift between the automation resolver and its callers so
the invariant `observe.js:452` states — internal-session exclusion even for
admin — is actually enforced on every op, then true the docs to the code.

### Open Questions

- [x] Enumerate-vs-act ruling: **RESOLVED by the 2026-08-28 pivot (DD1–DD3).**
      The boundary is by TIER: non-admin refused every op on internal (already
      true); admin (the high-bar, key-gated tier) allowed every op on internal guests; the
      master-password secret sheet refused for all.

### Design Decisions

*Written at flight design, 2026-08-28, after an upstream recon (F1/F10c
confirmed-live; F9 drifted to `src/main/vault/vault-context.js` but live; F10k
stale) and an operator ruling. The recon also found the real constraint: the
behavior-test crew relies on `captureScreenshot`/`readAxTree` against internal
guests under admin as its ONLY apparatus there, so the original "refuse even
for admin" plan would have broken the test system.*

**DD1 — the internal-session boundary is by TIER, not by page.** The wall that
matters — a non-admin (jar-scoped) key must never reach an internal
`goldfinch://` page — **already holds** at the resolver: `resolve.js` refuses
`isInternalContents` when `!allowInternal`, and only admin sets
`allowInternal: true` (`engine.js`). Non-admin is blocked for every op,
including the ones F1 flagged (`input.js`, the three `observe.js` reads). This
flight does not touch that wall.

**DD2 — the admin key may reach internal guests on EVERY op, including
`evaluate`/`injectScript`/DevTools (operator ruling 2026-08-28; justification
CORRECTED 2026-08-28).** The op-local "even for admin" refusals on
`evaluate`/`injectScript`/`openDevTools`/`closeDevTools` are the only thing
between the admin tier and end-to-end internal-page automation, and are
**relaxed** for admin (non-admin stays refused at the resolver). `input.js`
and the three `observe.js` reads already allow admin and stay so — so F1
**inverts**: no longer "add refusals," but "make the admin surface consistent."
This also moots the behavior-crew conflict.

> **Correction (2026-08-28).** An earlier draft justified this by "admin is a
> dev-only key that cannot exist in a packaged build." **That is false** — the
> Leg 4 Developer caught it and the FD verified: `mintAdminKey` /
> `resolveIdentity` gate the admin tier purely on the `GOLDFINCH_AUTOMATION_ADMIN`
> env var (no `isPackaged`), the `automation:admin-key-mint` IPC is registered
> unconditionally and reachable from Settings in a **packaged** build, and
> `docs/mcp-automation.md:399-403` already documents "the admin tier works on
> the packaged binary … env-only, no dev/isPackaged coupling." The FD's
> `!app.isPackaged` reading was of the headless-harness *auto-mint*, not the
> tier. **The operator re-decided on corrected facts (keep-as-is).** The real
> justification: admin is a **high-bar, deliberately-enabled** tier — it needs
> the `GOLDFINCH_AUTOMATION_ADMIN` env var at launch, a separately-minted admin
> key shown once, the Settings automation toggle on, and the key presented over
> the loopback-only transport — and it can be enabled on a packaged build. The
> operator accepts the defense-in-depth tradeoff (an enabled admin session
> reaching the internal Settings/vault *pages*) for end-to-end automation reach,
> because (a) the enablement bar is high and local, (b) master-equivalent
> secrets never enter the vault *page* DOM — they live in the sheet, refused for
> ALL tiers (DD3) — and (c) the transport is loopback-only. No "dev-only" claim
> may appear in the shipped code, docs, or these artifacts.

**DD3 — the master-password / secret-entry sheet is refused for ALL tiers,
admin included (operator ruling).** Two independent gates keep it so and BOTH
must hold after this flight: (a) the menu-overlay **sheet** gate
(`resolve.js`'s `isSheetContents` check, ungated by `allowInternal` — READABLE
BUT NOT SCRIPTABLE since M15 F3) refuses write/eval ops on any sheet wcId for
everyone; DD2 relaxes only the internal-**guest** (`isInternalContents`) check,
NOT this sheet check. (b) F9: the vault tools (`vaultFill`/`vaultAnswerAuth`,
`src/main/vault/vault-context.js` `resolveTarget`) omit the
`isSheetContents`/`sheetMenuFor`/`isTabViewWcId`/`isPopupWcId` predicates from
their `scopeCtx`, so their own resolve path can name the secret sheet
unrefused — thread the full set so a vault tool targeting the master-password
sheet or find overlay is refused even under admin. Secrets never enter the
page DOM regardless, so DD2 exposes no plaintext; DD3 hardens the entry surface.

**DD4 — `download-media` / `show-item-in-folder` trust (F10c, unchanged by the
pivot).** `register-download-ipc.js` trusts a renderer-supplied `webContentsId`
with no validation (naming the chrome id reopens the default-session cookie
leak DD6 closed), and `show-item-in-folder` takes a raw renderer path against
its own comment. Validate the id against tab contents; confine the folder path
to a main-resolved record.

**DD5 — docs trued to the tier model (F10k), closing leg.** Rewrite the
internal-session-invariant row, the sheet-refusal section, and the `vaultFill`
return shape in `docs/mcp-automation.md` to state: non-admin refused internal;
admin (the high-bar, key-gated tier) reaches internal guests on every op; the secret sheet refused
for all. Only after the code lands. **Also (design-review LOW):** correct the
behavior-test crew apparatus note at
`.flightops/agent-crews/behavior-tests-execution.md:~347` ("`evaluate` on
internal guests: refused outright ... never `evaluate`") — under the pivot,
`evaluate`/`readDom` on internal guests now work under admin; the note should
say so. **Not in DD5's scope:** the LIVE `mcp-tools.js` tool descriptions —
those are folded into Leg 1 (they are the running-app contract for Leg 1's
behavior change), not this doc leg.

### Prerequisites

- [x] Maintenance report 2026-08-27, findings F1, F9, F10c, F10k

### Pre-Flight Checklist

- [x] The enumerate-vs-act ruling recorded (DD1–DD3, 2026-08-28 pivot)
- Other items N/A — maintenance flight.

---

## In-Flight

### Technical Approach

> **Note (2026-08-28):** the F1 paragraph below is the PRE-PIVOT plan (add the
> refusal to `input.js` and the three observe ops). Under DD2 that inverts. The
> F9/F10c/F10k paragraphs stand (F9's file is now `src/main/vault/vault-context.js`).
> Kept for the code-location detail.

**F1 — op-local internal refusals.** `engine.js:167` sets
`allowInternal:true` for the admin tier, so `resolve.js:215` never refuses;
the compensating op-local `isInternalContents` check exists on
`observe.js` `evaluate:475`, `injectScript:532`, `openDevTools:577`,
`closeDevTools:606` and on all of `nav.js:57/79/99/117`, `zoom.js:46/72`,
`print.js:38`, `find.js:94/182` — but not on `input.js` (`click:284`,
`typeText:294`, `scroll:364`, `pressKey:396` — the file never imports
`isInternalContents`) nor on `observe.js` `readDom:286`, `readAxTree:388`,
`captureScreenshot:194`. Add the refusal to `input.js`'s shared
`actOn`/`actOnPaced` entry and to the three observe ops, mirroring the
existing guarded ops' error shape. Unit-pin each with a truth-table case
and a neuter check.

**F9 — vault-tool resolver predicates.** `vault-context.js:398` builds
`scopeCtx` without `isSheetContents`/`sheetMenuFor`/`isTabViewWcId`/
`isPopupWcId`; `main.js:1024-1032` never supplies them, so the
`typeof`-gated checks at `resolve.js:197` and `:231` no-op for
`vaultFill`/`vaultAnswerAuth` (residual guard: `vault-context.js:456`
origin match). Thread the same predicate set into `scopeCtx` and pass it
through `resolveTarget`; pin that naming the master-password sheet or the
find overlay as a target is refused.

**F10c — `download-media` `webContentsId`.** `register-download-ipc.js:
49-52` trusts a renderer-supplied id; naming the chrome's own id reopens
the default-session cookie leak DD6 closed by removing the fallback.
Validate against tab contents with the resolver's existing predicate.
While there, `show-item-in-folder:85` takes a raw renderer path contrary
to the comment at `:88` — confine to a path the main process already
knows.

**F10k — docs.** `docs/mcp-automation.md:42` (internal-session invariant
row), `:344-373` (sheet-refusal claim on the vault-tool path), `:686`
(`vaultFill` return shape) — rewrite to match the shipped code as the
closing leg. Not before: the doc cannot be trued until the code matches.

### Checkpoints

- [x] CP1: under an admin key, `click`/`readDom` on a `goldfinch://vault`
      tab refused — live, plus unit truth tables
- [x] CP2: `vaultFill` targeting the secret sheet / find overlay refused
- [x] CP3: `download-media` with the chrome's wcId refused; jar download
      path unchanged
- [x] CP4: docs match; suite/typecheck/lint green

### Adaptation Criteria

**Divert if**: the enumerate-vs-act ruling reveals a consumer (the a11y
audit script, the behavior-test crew) that legitimately reads internal
pages under admin — then the refusal needs a test-scoped exception
designed alongside Flight 3's allowlist, not an ad-hoc bypass.

**Acceptable variations**: consolidating the op-local check into the
resolver behind an explicit per-op capability flag, if that is smaller
than seven call-site additions.

### Legs

- [x] `admin-internal-reach` - F1 (inverted per DD2): relax the op-local admin refusals on `evaluate`/`injectScript`/`openDevTools`/`closeDevTools`; non-admin unchanged; the sheet gate untouched; invert the tests that pinned admin-refused-on-internal for those ops
- [x] `secret-sheet-wall` - F9 (DD3): thread the sheet/tab/popup predicate set into the vault tools' `resolveTarget` so `vaultFill`/`vaultAnswerAuth` cannot target the master-password sheet or find overlay even under admin
- [x] `download-ipc-trust` - F10c (DD4)
- [x] `mcp-automation-docs-truing` - F10k (DD5), closing leg

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [x] Code merged
- [x] Tests passing
- [x] Documentation updated (`docs/mcp-automation.md`)

### Verification

A behavior spec authored at flight design: under an admin key, attempt
`click` and `readDom` against a `goldfinch://vault` tab and a
`goldfinch://settings` tab and assert refusal with the documented error;
then the same ops against a normal guest succeed. Unit truth tables per
op.
