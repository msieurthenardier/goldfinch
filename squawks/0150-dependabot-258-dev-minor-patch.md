# Squawk 0150: Apply the dev-minor-patch dependency bumps (Dependabot #258) with verification

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-22
**Completed**: —

## Report
Dependabot PR #258 ("bump the dev-minor-patch group with 3 updates") includes an Electron bump. Squawk 0138 set the rule that Electron bumps need project verification before merging (#245 was reverted for skipping it). Apply the same delta through the squawk flow, as squawk 0144 did for #250:
- `electron` 44.5.1 → 44.7.1 (exact pin; a minor release inside major 44, moving Chromium 152.0.7977.130 → 152.0.7977.149)
- `prettier` ^3.9.9 → ^3.9.10
- `@types/node` ^26.6.4 → ^26.6.5

What each bump needs beyond CI:
- **Electron**: the CLAUDE.md Electron-bump rule. Re-run the `node:sqlite` store suite (part of `npm test`). Check that `ForceThirdPartyCookieBlockingEnabled` is still in the binary: native third-party cookie isolation fails open if the name is dropped. Run the `third-party-cookie-isolation` behavior test.
  - **Changelog item that touches us**: 44.7.1 fixes "a `WebContentsView` that was removed with `removeChildView()` and re-added with `addChildView()` staying hidden behind its sibling views on Linux" (electron#54798). Our menu-overlay sheet shows by calling `addChildView` after the guest, so z-order matters. The live smoke should open and close the sheet several times (kebab, then an automatable menuType such as `site-info`) and check that it still composites above the guest.
  - Nothing else applies to us: 44.6.0 adds the experimental `protocol.registerSource()` (we don't use it), and the 44.7.0 `net.fetch` / macOS `autoUpdater` changes don't affect our paths.
- **Prettier**: 3.9.10 changes Markdown table parsing (micromark-extension-gfm-table). `npm run format:check` covers the whole tree, including many tables in `.md` artifacts, so it must stay clean. If it drifts, that reformat goes in this squawk's diff and gets reviewed.
- **@types/node**: `npm run typecheck` must stay clean.

## Evidence
- PR #258 (`dependabot/npm_and_yarn/dev-minor-patch-b715e3018a`) changes only `package.json` and `package-lock.json`. The `package.json` diff keeps the exact Electron pin (`"electron": "44.7.1"`, no caret).
- `package.json` today: `"electron": "44.5.1"`, `"prettier": "^3.9.9"`, `"@types/node": "^26.6.4"`.
- Precedent: squawks 0138 and 0144. PR #258 reports no checks.

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
