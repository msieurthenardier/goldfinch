# Leg: docs-and-security-model

**Status**: completed
**Flight**: [Production gating re-architecture + dev-profile isolation + port free-fallback](../flight.md)

## Objective
Rewrite (not append) the automation-security narrative in `CLAUDE.md` and `docs/mcp-automation.md` to describe the **toggle-binds production model** delivered by legs 1–5 — so no doc still claims the surface "binds only under `--automation-dev`", "is not in any released build", or "has no production launch path".

## Context
- **DD7** — "rewrite, not append. Appending would leave self-contradicting text." The F7 debrief flagged that the docs describe the now-retired flag-gated model. After legs 1–5 the truth is: the **Settings toggle binds** the surface (launch + live) on the **packaged binary**; enablement is **human-only**; `--automation-dev` is a **dev-only force-bind (no-op when packaged)**; dev runs are **profile-isolated**; the admin env works **on the packaged build**; `GOLDFINCH_MCP_PORT` is **dev-only** and the port **free-falls-back**.
- **Docs-only leg** — no source changes (legs 1–5 already shipped the behavior). The risk here is *incomplete* rewrite: a half-updated security doc that contradicts itself is worse than none. Enumerate every stale claim and fix all of them.

## Inputs — every stale claim to fix (enumerated against current files)

### `docs/mcp-automation.md`
- **Lines 8–10 (Status banner):** "dev-gated, not yet shipped … gated behind `--automation-dev` … exposed in no released build before Flight 4 … None of this is reachable in an installed Goldfinch." → **rewrite** to the production posture (the Settings toggle binds it on the shipped binary; opt-in/key-gated/loopback/Origin-guarded unchanged).
- **Lines 27–30 (Launch):** "The `--automation-dev` flag is the **only** thing that starts the MCP server … There is no production launch path; the surface ships in no release before Flight 4." → **rewrite**: production binds on the **Settings `automationEnabled` toggle** (launch + live); `--automation-dev` is a **dev-only convenience** (force-bind + auth + auto-mint + dev-seam) that is a **no-op on a packaged build**. Keep the `dev:debug` decoupling note.
- **Line 38 (Endpoint / Port override):** "`GOLDFINCH_MCP_PORT` (any valid positive integer; else `49707`)" → **dev-only** override (honored only when `!app.isPackaged`); production port = `automationPort` setting + **free-fallback**; the **bound** port is surfaced.
- **Lines 69–71 (Settings: Enable):** "The server only binds under `--automation-dev`, but even then the auth gate `401`s …" → **rewrite**: the toggle is the **bind gate** (production); off is the safe default; nothing binds or is reachable until the human turns it on.
- **Lines 77–83 (Settings: Port):** "`GOLDFINCH_MCP_PORT` (the dev/test env override) still takes precedence where set" → **dev-only** (ignored on a packaged build); add the **free-fallback** (a taken port auto-moves to a free one; the persisted preference is not overwritten); dev env pin is **bind-exactly-or-fail-loudly**.
- **Lines 84–87 (Bind status):** the "Not running — start Goldfinch with `--automation-dev` to bind the surface" status string must match the **new renderer copy** (leg 2 changed it to the toggle-binds wording) — update the doc to quote the new copy, not the old.
- **Lines 92–104 (Authentication):** "Even under `--automation-dev` the server *binds*, but a second pre-routing gate …" → **reframe**: in production the toggle both **binds and auth-enables**; the auth gate still requires enable **+** a valid key. Add the **dev-enable override** note (in dev, `--automation-dev` satisfies the enable side of the gate without writing the setting — so the persisted toggle stays off while the dev harness is usable).
- **Lines 175–177 (Status blockquote):** "There is no production launch path yet." → **remove / rewrite** (there is one now: the toggle on the packaged binary).
- **`.mcp.json` section (344–356):** verify the "still registers the `playwright` server" line against the current `.mcp.json` (F7 trimmed it) — correct if stale; otherwise leave. Keep the off-by-default framing (still true).
- **Add (new or folded into existing sections):** human-only enablement (DD3 — no programmatic enable; minting a key no longer enables), dev-profile isolation (DD1 — dev uses `~/.config/goldfinch-dev`), admin on the packaged binary (DD5), and the DD9 key-generation gating (mint disabled while the toggle is off; revoke always available).

### `CLAUDE.md` (Automation engine section)
- **"Gating landed (Flight 4)" bullet:** "It still only binds under the `--automation-dev` flag, so it is not in any released build." → **FALSE** — rewrite to toggle-binds production posture (legs land in F8); keep the headless auto-mint apparatus note (still dev-only, now `!app.isPackaged`-gated).
- **"Management UI landed (Flight 5)" bullet:** the `resolvePort` precedence "`env GOLDFINCH_MCP_PORT > setting > default`" → **dev:** env > setting > default+fallback; **production:** setting > default+fallback (**env ignored**). Note the bound-port capture + free-fallback.
- **"Convention — settings writes from a handler must broadcast" bullet:** the example "`enableAndMintJarKey` flipping `automationEnabled`" is **stale** (leg 3 renamed it `mintJarKey` and removed the enable write). **Rewrite the example** — the convention stands, but cite a current example (e.g. `automation:jar-key-mint` broadcasting after writing `automationKeyHashes`); do not reference the removed side-effect.
- **"MCP transport" subsection — "Gated on `--automation-dev` only" bullet:** "**Gated on `--automation-dev` only** via `isMcpAutomationEnabled` … Launch it with `npm run dev:automation`." → **rewrite**: production binds on the **Settings toggle** (`shouldBindAutomation`); `--automation-dev` is a **dev-only force-bind** (call-sites `&& !app.isPackaged`); dev runs are **profile-isolated** (DD1). Keep the `dev:debug` decoupling + the tool-count/`getChromeTarget` detail. Update "default port `49707` (override `GOLDFINCH_MCP_PORT`)" to the dev-only env scope.
- **"The dev seam is interim … folded into the gated transport in Flight 3" bullet:** update the tense/status (the transport landed; the dev-invoke seam remains a dev-only seam, now `!app.isPackaged`-gated) — light touch, not a full rewrite.
- **Line ~12 (testing guidance):** the `dev:automation` drive note is fine; optionally add that the **packaged** binary now binds via the toggle (so dogfching/external drives no longer require a dev launch).

## Outputs
- `docs/mcp-automation.md` describes the toggle-binds production model end to end; no residual "not shipped / binds only under `--automation-dev` / no production launch path" claims; `GOLDFINCH_MCP_PORT` framed as dev-only; the port free-fallback + human-only enable + dev-profile isolation + admin-on-packaged + DD9 gating are documented.
- `CLAUDE.md` automation-security narrative matches; the stale `enableAndMintJarKey`-flips-enable example is replaced.
- (Optional) a one-line note in `package.json`/README if a script's meaning changed — only if it genuinely helps; package.json is JSON (no comments), so prefer the README or skip.

## Acceptance Criteria
- [x] **No residual false production claims:** `grep -n "not yet shipped\|no released build\|no production launch\|only binds under\|only thing that starts\|not in any released build" CLAUDE.md docs/mcp-automation.md` returns **nothing** (rc=1, clean). Pasted into the flight-log.
- [x] **`docs/mcp-automation.md`** Status banner, Launch, Endpoint port-override, Settings (Enable/Port/Bind-status), Authentication, and the closing status blockquote all describe **toggle-binds** + **dev-only `--automation-dev`** + **dev-only `GOLDFINCH_MCP_PORT`** + **port free-fallback**; Bind-status string updated to the new leg-2 renderer copy (`Not running — turn on the Automation toggle to bind the surface`).
- [x] **Human-only enable, dev-profile isolation, admin-on-packaged, and DD9 key-gen gating** are documented (added a Keys bullet for DD9; folded the rest into Launch / Status / Authentication).
- [x] **`CLAUDE.md`**: the "Gating landed" / "Management UI" / "Convention" / "MCP transport gating" / dev-seam bullets are rewritten per the enumeration; the `enableAndMintJarKey`-flips-`automationEnabled` example is replaced with `automation:jar-key-mint` writing `automationKeyHashes`; `resolvePort` precedence reflects the dev/prod split.
- [x] **Accuracy cross-check:** every rewritten claim verified against the **landed code** (legs 1–5) — `shouldBindAutomation`, the `!app.isPackaged` dev gating, `mintJarKey` (no enable), `honorEnv`/free-fallback, the dev-enable override, the `renderStatus` copy. No aspirational text.
- [x] `npm run lint`, `npm test` (732 pass / 0 fail), and `npm run typecheck` stay green (no source changed).

## Verification Steps
- The grep above returns clean.
- Read both files end-to-end: the production posture is internally consistent (no sentence contradicts another).
- Spot-check against code: `shouldBindAutomation` (automation-dev.js), the three `!app.isPackaged` call sites (main.js), `mintJarKey` (mcp-server.js, no enable), `resolvePort(..., {honorEnv})` (mcp-server.js).

## Edge Cases
- **Historical references** (e.g. "Flight 4 landed gating") may stay if clearly past-tense and dated — only the **present-tense production claims** must be corrected. Don't rewrite history; correct the current-state description.
- **`.mcp.json` playwright line** — verify before editing; F7 may have trimmed it. If unchanged, leave the doc as-is.
- **Don't over-reach** — this leg is the security narrative + the enumerated stale claims, not a full doc rewrite. Leave accurate sections (tool reference, result semantics, a11y caveat, audit contract) untouched except where they assert the old gating.

## Files Affected
- `CLAUDE.md` — automation-engine + MCP-transport security narrative.
- `docs/mcp-automation.md` — status/launch/endpoint/settings/auth narrative.
- (Optional) `README.md` if a user-facing script meaning changed (likely not — README reframe is F10).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing (trivially — no source change; suite confirmed: 732 pass / 0 fail)
- [x] Update flight-log.md with leg progress entry (no-false-claims grep pasted)
- [x] Set this leg's status to `landed` (per FD instruction; `completed` is set at flight close)
- [ ] Check off this leg in flight.md — DEFERRED to FD (per orchestration instruction)
- [ ] If final leg of flight: (N/A — leg 6 of 8; legs 7–8 are verification)
- [ ] Commit deferred to flight-end batch review

## Citation Audit
Citations verified against current files at leg design time (2026-06-17, post-leg-5):
- `docs/mcp-automation.md` lines 8–10 (status banner), 27–30 (Launch "only thing that starts"), 38 (port override), 69–71 (Enable), 77–83 (Port), 84–87 (Bind status string), 92–104 (Auth), 175–177 (status blockquote), 344–356 (`.mcp.json`) — **OK** (read directly, full file).
- `CLAUDE.md` "Gating landed (Flight 4)" / "Management UI landed (Flight 5)" / "Convention — settings writes must broadcast" (cites `enableAndMintJarKey` flipping `automationEnabled` — now stale post-leg-3) / "Gated on `--automation-dev` only" / "The dev seam is interim" bullets — **OK** (read directly; line numbers ~156–167 but anchored by bullet text).
