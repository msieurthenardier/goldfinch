# Squawk 0150: Apply the dev-minor-patch dependency bumps (Dependabot #258) with verification

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-22
**Completed**: 2026-10-22

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
Applied #258's exact delta (`gh pr diff 258 | git apply`, `--check` clean; `package.json` + `package-lock.json` only): `electron` 44.5.1 -> 44.7.1 (exact pin, no caret), `prettier` ^3.9.9 -> ^3.9.10, `@types/node` ^26.6.4 -> ^26.6.5. `npm ci` clean. No source changes; no Prettier reformat was needed.

## Verification
Static checks done (Developer, 2026-10-22):
- Electron resolves to 44.7.1 (`npx electron --version` v44.7.1; Chromium 152.0.7977.149; `npx electron` downloaded the binary). `ForceThirdPartyCookieBlockingEnabled` present in the binary (`strings | grep -c` = 1).
- `npm test`: 5974 tests, 5970 pass, 0 fail, 4 todo (includes the `node:sqlite` store suite). `npm run typecheck`, `npm run lint` and `npm run format:check` clean (Prettier 3.9.10 produced no Markdown table drift).
- `npm audit --audit-level=high` exits 0.
- `git diff --stat`: only `package.json` and `package-lock.json` (plus this squawk file and 0149's pre-existing changes); no source changed.
Re-verified by the Flight Director (2026-10-22): the same versions, the feature string count (1), and identical `npm test` totals (5974 / 5970 / 0 fail / 4 todo); typecheck, lint, format:check and audit clean.
Live checks done (Flight Director, 2026-10-22):
- `third-party-cookie-isolation` behavior test on 44.7.1: **pass**. 14/14 judged steps, step 9 struck, Version appendix pass, no regression against the 44.5.1 baseline (`tests/behavior/third-party-cookie-isolation/runs/2026-10-22-16-14-55.md`):
  - running electron 44.7.1 / Chromium 152.0.7977.149;
  - `ForceThirdPartyCookieBlockingEnabled` in `--enable-features` exactly when isolation is configured on;
  - cookie shapes identical to the baseline;
  - both relaunches attested. Relaunch 1's old-PID exit time was not captured because of an Executor helper bug; the Validator ruled it adequately evidenced (see the run log).
- MCP attach smoke: covered by that run. `tools/list` returned 35 tools, and the same admin key authenticated across launch plus two app-driven relaunches. `evaluate`, `openTab`, `reload`, `click`, `captureWindow` and `getChromeTarget` were exercised with no `isError`. `appQuit` returned `fetch failed` at the wire because the process exited first (PID gone at +98 ms).
- Sheet z-order (electron#54798, the `removeChildView`/`addChildView` fix on Linux): **by-eye pass** by the operator on a scratch-profile dev instance. The kebab menu, site-info, the find bar (Ctrl+F) and repeated tab switching all composited above the guest. This is by-eye only, because on WSLg/Wayland `captureWindow` builds a capturePage composite and can't observe native z-order.
- The run surfaced squawk 0151 (the settings page dims the Isolate row while isolation is enforced). That is a pre-existing defect, not caused by this bump.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped)
**Verdict**: confirmed, no blocking or non-blocking issues. The PR #258 delta matches exactly (`git apply --check -R`), and the Electron pin stays exact. The lockfile changes are confined to the three packages. The Reviewer re-ran the gates: `npm test` 5974 tests (5970 pass, 0 fail, 4 todo); typecheck, lint, format:check and audit clean. Live-verified by the `third-party-cookie-isolation` run 2026-10-22-16-14-55 (pass) and the operator's by-eye sheet check.
**Commit**: the `squawk: turnaround 2026-10-22` commit on `squawk/turnaround-2026-10-22` (supersedes Dependabot #258)
