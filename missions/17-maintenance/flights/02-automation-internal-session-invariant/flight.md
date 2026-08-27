# Flight: Automation-Surface Internal-Session Invariant

**Status**: ready
**Mission**: [Codebase Health — 2026-08-27 Maintenance](../../mission.md)

## Contributing to Criteria

- [ ] Admin-tier input/observe ops refuse internal targets; docs state only what is enforced (criterion 3)
- [ ] Vault tools share the resolver predicate set; `download-media` validates its `webContentsId` (criterion 4)

---

## Pre-Flight

### Objective

Close the guard drift between the automation resolver and its callers so
the invariant `observe.js:452` states — internal-session exclusion even for
admin — is actually enforced on every op, then true the docs to the code.

### Open Questions

- [ ] `tabs.js` deliberately keeps internal tabs *enumerable* for admin. Is
      the rule "refuse every op on internal targets" or "refuse
      input/read ops, allow enumerate/metadata"? Design review rules; the
      existing guarded ops (`evaluate`, `nav`, `zoom`, `print`, `find`) are
      the precedent.

### Design Decisions

*(to be written at flight design)*

### Prerequisites

- [x] Maintenance report 2026-08-27, findings F1, F9, F10c, F10k

### Pre-Flight Checklist

- [ ] The enumerate-vs-act ruling recorded before leg 1
- Other items N/A — maintenance flight.

---

## In-Flight

### Technical Approach

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

- [ ] CP1: under an admin key, `click`/`readDom` on a `goldfinch://vault`
      tab refused — live, plus unit truth tables
- [ ] CP2: `vaultFill` targeting the secret sheet / find overlay refused
- [ ] CP3: `download-media` with the chrome's wcId refused; jar download
      path unchanged
- [ ] CP4: docs match; suite/typecheck/lint green

### Adaptation Criteria

**Divert if**: the enumerate-vs-act ruling reveals a consumer (the a11y
audit script, the behavior-test crew) that legitimately reads internal
pages under admin — then the refusal needs a test-scoped exception
designed alongside Flight 3's allowlist, not an ad-hoc bypass.

**Acceptable variations**: consolidating the op-local check into the
resolver behind an explicit per-op capability flag, if that is smaller
than seven call-site additions.

### Legs

- [ ] `input-observe-internal-refusal` - F1
- [ ] `vault-tool-resolver-predicates` - F9
- [ ] `download-ipc-trust` - F10c
- [ ] `mcp-automation-docs-truing` - F10k

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing
- [ ] Documentation updated (`docs/mcp-automation.md`)

### Verification

A behavior spec authored at flight design: under an admin key, attempt
`click` and `readDom` against a `goldfinch://vault` tab and a
`goldfinch://settings` tab and assert refusal with the documented error;
then the same ops against a normal guest succeed. Unit truth tables per
op.
