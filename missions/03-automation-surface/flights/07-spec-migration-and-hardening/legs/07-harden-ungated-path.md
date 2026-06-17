# Leg: harden-ungated-path

**Status**: completed
**Flight**: [Bulk spec migration + ungated-path hardening (scoped)](../flight.md)

> **Progress (2026-06-16):** landed — narrowing applied, probe passed. The two-arm WS probe (run live by the FD) confirmed: arm1 no-Origin → 101 (no-Origin Node clients still attach), arm2 `Origin: http://evil.example` → 403 (foreign origin blocked → narrowing is load-bearing), arm3 loopback Origin → 101; `npm run a11y` ran successfully over the narrowed port. `package.json` `dev:debug` narrowed to `--remote-allow-origins=http://127.0.0.1:9222` (AC1/AC2/AC3). Deterministic parts done earlier — `.mcp.json` trimmed (AC4), `devtools-cdp-conflict.md` annotated (AC5), docs (AC6); gates green (AC7).

## Objective
Harden the ungated `:9222` path (DD3) without removing it: **empirically determine** (Node-22 WS probe) a `--remote-allow-origins` form that blocks the wide-open `*` exposure yet keeps the deferred `a11y-audit.mjs` + `farbling-correctness` Node/CDP clients attaching; trim the stale `.mcp.json` Playwright-`:9222` entry; and annotate the `devtools-cdp-conflict` block as gated on the missing non-CDP DevTools affordance (NOT the now-narrowed Origin). **Resolve-or-divert**: land the narrowing only if the probe confirms the clients still attach; otherwise apply a documented fallback.

## Context
- **DD3** (flight): narrow `dev:debug`'s `--remote-allow-origins=*` to a **loopback-Origin allow-list**, keep `:9222` available ONLY for the deferred `a11y-audit.mjs` + `farbling-correctness`, trim the stale `.mcp.json` Playwright entry. Full removal is F8-eval (those two still need `:9222`).
- **Premise risk (Architect MED) — verify EMPIRICALLY before landing the flag**: `a11y-audit.mjs` connects with Node 22's **global `WebSocket`** (`scripts/a11y-audit.mjs:182` `new WebSocket(wsUrl)`), which by default sends **no `Origin` header**. Chromium's `--remote-allow-origins` is matched against that header on the WS upgrade. So narrowing `*` → a specific list may (a) be a **no-op** for the Node client (no Origin → nothing to match → it may still attach; the flag historically blocks *web-page* origins, which always send Origin) OR (b) **break** the attach. Unknown from code alone → a **resolve-or-divert** at this leg: run a Node-22 WS probe against the narrowed flag FIRST, then choose the form.
- **Three `:9222` consumers, two remediation surfaces** (Architect review):
  1. `scripts/a11y-audit.mjs` — Node-22 global `WebSocket`, **no Origin** (editable; shim-able).
  2. `scripts/cdp-driver.mjs` — the trusted-input sibling, **same** Node-global-`WebSocket` no-Origin pattern (`cdp-driver.mjs:25` `CDP_HTTP`, `:7-9`). Post-migration it is **no longer named by any migrated spec** (legs 2–5 moved them onto the MCP surface) — effectively dormant but not removed (final removal = F8-eval with `:9222`). Editable; same no-Origin attach behavior as a11y-audit, so the no-Origin probe arm covers it (an attaching a11y-audit ⇒ cdp-driver attaches too).
  3. `farbling-correctness` — attaches via the **`chrome-devtools` MCP** `evaluate_script` on `:9222` (`tests/behavior/farbling-correctness.md:16,23`). **External tool — NOT editable**, so the Origin-injecting-shim divert does NOT apply to it; if its MCP attach sends an Origin the loopback list rejects, that consumer falls straight to the documented-residual divert (c). Its Origin behavior is part of the land decision (characterize it in the probe).
- **Guided live step (operator decision 2026-06-16: "you run them, I guide")**: the empirical probe runs the GUI app + a Node WS client. The Flight Director **guides the operator** through launching the app with the candidate flag and running the probe; the operator reports the result; the FD interprets → the narrowing form is chosen → a Developer applies it.
- This leg is config/doc only — `package.json` (a `--remote-allow-origins` value), `.mcp.json` (trim), `tests/behavior/devtools-cdp-conflict.md` (annotation), and `CLAUDE.md`/`docs` if the dev workflow note changes. No app source logic.
- **`:9222` is NOT removed** this flight (narrowed); final removal + the `evaluate` tool + the a11y/farbling rewrites are F8-eval.

## Inputs
- `package.json:11` — `"dev:debug": "electron . --enable-logging --no-sandbox --remote-debugging-port=9222 --remote-allow-origins=*"` (the wide-open flag).
- `.mcp.json` — single `playwright` server: `npx -y @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:9222` (stale — the migrated specs no longer use Playwright-MCP; `responsive-tab-strip`, the named consumer, was rewritten in leg 2).
- `scripts/a11y-audit.mjs` — Node-22 global `WebSocket` CDP client (`:182`), `CDP_HTTP = 'http://127.0.0.1:9222'` (`:44`); the primary "no-Origin Node client" to keep attaching.
- `tests/behavior/farbling-correctness.md` — deferred (F8-eval); attaches via `chrome-devtools` MCP on `:9222` (`:16,23`); the second `:9222` consumer.
- `tests/behavior/devtools-cdp-conflict.md` (status `draft`, BLOCKED-AS-WRITTEN, `:10`) — blocked on the missing non-CDP DevTools-open affordance; venue is `dev:automation` (no `:9222`). Needs the annotation that the block ≠ the Origin.
- `CLAUDE.md` / `docs/mcp-automation.md` — any `dev:debug` dev-workflow note that the narrowing changes.

## Outputs
- **Empirical probe protocol + result** (guided, recorded in the flight log): a Node-22 `new WebSocket('ws://127.0.0.1:9222/…')` attach test against the app launched with the **candidate narrowed** `--remote-allow-origins`, observing whether the no-Origin Node client still attaches; plus a post-narrowing confirmation that `npm run a11y` and the `farbling` chrome-devtools-MCP attach still work.
- **`package.json` `dev:debug`** — `--remote-allow-origins` set to the empirically-chosen form:
  - **Land** a loopback allow-list (e.g. `http://127.0.0.1:9222` / `http://localhost:9222`, or whatever the probe shows admits the no-Origin Node client while blocking `*`) if the probe confirms `a11y-audit` + `farbling` still attach; OR
  - **Divert** (per the flight's named divert) to: an allow-list form that still admits the absent/loopback Origin, OR an Origin-injecting shim on the Node client(s), OR — if narrowing can't both block `*` and keep the attach — keep `*` documented as a **known dev-only residual carried to F8-eval**. The migration/paging work lands regardless.
- **`.mcp.json` trimmed** — the Playwright-`:9222` entry removed (confirm no remaining spec/tooling references it first). If that empties `mcpServers`, leave a valid empty object or remove the file per project convention — note which.
- **`devtools-cdp-conflict.md` annotated** — stays `draft`/BLOCKED-AS-WRITTEN; the block is annotated as gated on the **missing non-CDP DevTools-open affordance**, explicitly NOT the (now-narrowed) wide-open Origin → carry to F8-eval.
- **`CLAUDE.md`/`docs`** — the `dev:debug` note updated if the narrowed flag changes the documented dev workflow.
- The chosen disposition (land vs divert) + the probe result recorded in the flight log Decisions/Anomalies.

## Acceptance Criteria
- [x] **AC1 (empirical probe run + recorded — BOTH arms)** — Two probe arms were run against the app launched with the candidate narrowed `--remote-allow-origins` and recorded in the flight log: **(arm 1, no-Origin)** a Node-22 `new WebSocket` with no Origin still attaches (proves the deferred Node clients survive); **(arm 2, with-Origin)** a `new WebSocket(wsUrl, { headers: { Origin: 'http://evil.example' } })` is **rejected** under the narrowed list (and admitted under `*`) — proving the narrowing actually blocks a disallowed web origin, not just that the Node client attaches. The narrowing form is chosen FROM both arms, not guessed. (`a11y` runs? `farbling` attaches? also recorded.)
- [x] **AC2 (`*` no longer wide-open AND demonstrably load-bearing — or documented residual)** — `package.json` `dev:debug` no longer uses `--remote-allow-origins=*` (a loopback allow-list is landed) **and arm 2 confirmed it rejects a disallowed Origin** (so the narrowing is real hardening, not a no-op); OR, if the probe shows narrowing breaks the no-Origin Node attach (arm 1 fails) and no admitting form works, the divert is taken and the residual `*` is **explicitly documented** (CLAUDE.md/flight log) as a known dev-only exposure carried to F8-eval. If arm 1 passes but arm 2 shows narrowing is a no-op (Chromium ignores Origin entirely), record that the narrowing provides no added protection and treat it as a documented residual → F8-eval (don't claim false hardening). One disposition is true and recorded.
- [x] **AC3 (deferred consumers still served)** — After the change, `npm run a11y` (the axe harness over `:9222`) and the `farbling-correctness` chrome-devtools-MCP attach both still work (operator-confirmed live). `scripts/cdp-driver.mjs` (the same-shape no-Origin sibling) is acknowledged: its attach is covered by probe arm 1 (no-Origin) — confirm it's no longer named by any migrated spec (dormant; removal is F8-eval). If the landed narrowing broke any consumer, the divert (AC2) was taken instead.
- [x] **AC4 (`.mcp.json` trimmed)** — The Playwright-`:9222` entry is removed; `grep -rn "9222" .mcp.json` returns nothing. No remaining spec/tooling references the Playwright-`:9222` endpoint (verified before trimming).
- [x] **AC5 (devtools-cdp-conflict annotated)** — `devtools-cdp-conflict.md` carries an annotation that its BLOCKED-AS-WRITTEN state is due to the missing non-CDP DevTools-open affordance, NOT the now-narrowed Origin; it stays `draft`, venue unchanged (`dev:automation`, no `:9222`), carried to F8-eval.
- [x] **AC6 (docs current)** — `CLAUDE.md`/`docs/mcp-automation.md` `dev:debug`/automation notes reflect the narrowed flag (or the documented residual).
- [x] **AC7 (gates green)** — `npm test` + `npm run typecheck` + `npm run lint` pass (config/doc change; expect green).

## Verification Steps
- AC1/AC2/AC3: the guided probe + post-change live confirmation (operator runs; FD records). Inspect `package.json:11`.
- AC4: `grep -rn "9222" .mcp.json` empty; `grep -rln "playwright\|@playwright/mcp" tests/ .mcp.json` shows no live consumer.
- AC5: read `devtools-cdp-conflict.md` — annotation present, status `draft`.
- AC6: read the relevant `CLAUDE.md`/`docs` note.
- AC7: `npm test && npm run typecheck && npm run lint`.

## Implementation Guidance

**Split: deterministic (Developer agent) → guided probe (FD + operator) → apply narrowing (Developer agent).**

1. **Deterministic first (Developer agent)** — do the parts that need no live app:
   - **Trim `.mcp.json`**: confirm no spec/tooling still references the Playwright-`:9222` endpoint (`grep -rn "playwright\|@playwright/mcp\|cdp-endpoint\|:9222" tests/ .mcp.json` — the migrated specs use the MCP surface; `responsive-tab-strip` was rewritten in leg 2). Remove the Playwright entry; leave a valid `.mcp.json` (empty `mcpServers` object) or remove per project convention — note which.
   - **Annotate `devtools-cdp-conflict.md`**: add a note at the block that BLOCKED-AS-WRITTEN is gated on the missing non-CDP DevTools-open affordance, NOT the wide-open Origin (which F7 narrows); carry to F8-eval. Keep status `draft`, venue `dev:automation`.
   - Run `npm test`/typecheck/lint (expect green).
2. **Guided empirical probe (FD guides; operator runs)** — the FD provides:
   - A candidate narrowed flag to try first (e.g. `--remote-allow-origins=http://127.0.0.1:9222`).
   - A **two-arm** Node-22 WS probe: (arm 1) connect `new WebSocket(webSocketDebuggerUrl)` with no Origin → expect **attach** (the no-Origin client survives); (arm 2) connect `new WebSocket(webSocketDebuggerUrl, { headers: { Origin: 'http://evil.example' } })` → expect **rejection** under the narrowed list (and attach under `*`, as a control) — proving the narrowing is load-bearing, not a no-op. Targets come from `curl http://127.0.0.1:9222/json`.
   - The operator launches `npm run dev:debug` **with the candidate flag**, runs BOTH probe arms, runs `npm run a11y`, and (if feasible) the `farbling` attach (also characterize what Origin the chrome-devtools MCP sends); reports results. The FD records them verbatim in the flight log (so F8-eval inherits a characterized baseline).
3. **Apply the narrowing (Developer agent)** — based on the probe:
   - If the Node client + `a11y` + `farbling` attach under the narrowed list → set `package.json` `dev:debug` `--remote-allow-origins` to that form. (Update `CLAUDE.md`/`docs`.)
   - If narrowing breaks the no-Origin attach and no admitting form works → take the divert (AC2): document the residual `*` as a known dev-only exposure → F8-eval (CLAUDE.md + flight log), OR implement an Origin-injecting shim **on the editable Node clients (`a11y-audit.mjs`, `cdp-driver.mjs`) — NOT `farbling`'s external chrome-devtools MCP**; if `farbling`'s MCP attach is the one rejected, that consumer falls straight to documented-residual (c). Record the chosen path per consumer.
   - **Also fix the stale CLAUDE.md Playwright sentence** (`CLAUDE.md:12` "The Playwright MCP can also attach via `.mcp.json`.") — false once the entry is trimmed; remove/update it. Sweep `BACKLOG.md:45` (the `--remote-allow-origins=*` item) — update or mark as the F8-eval tracking item.
   - Re-run gates.

## Edge Cases
- **No-Origin vs absent-list semantics**: the probe must distinguish "narrowing is a no-op for the Node client (it still attaches because no Origin is sent)" from "narrowing rejects the no-Origin attach." Only the former lets us land the narrowing cleanly; the latter triggers the divert.
- **Two consumers, not one**: confirm BOTH `a11y-audit.mjs` (Node `WebSocket`) AND `farbling` (chrome-devtools MCP) attach post-narrowing — they connect differently; the chrome-devtools MCP may send an Origin where the Node client does not.
- **`.mcp.json` empties**: if removing the Playwright entry leaves no servers, keep a valid `{"mcpServers":{}}` (or remove the file) — don't leave invalid JSON; note the choice.
- **Don't over-trim**: only the Playwright-`:9222` entry goes; do not remove `:9222` itself from `dev:debug` (the deferred items still need the port — only the `*` Origin is hardened).
- **devtools-cdp-conflict stays blocked**: the annotation clarifies *why*; it does not unblock the spec (the affordance is still missing → F8-eval).

## Files Affected
- `package.json` — `dev:debug` `--remote-allow-origins` narrowed (or documented residual).
- `.mcp.json` — Playwright-`:9222` entry trimmed.
- `tests/behavior/devtools-cdp-conflict.md` — block annotation (block ≠ Origin).
- `CLAUDE.md` — the stale "Playwright MCP can also attach via `.mcp.json`" sentence (`:12`) removed/updated; `dev:debug` note if the workflow changes.
- `BACKLOG.md` — the `--remote-allow-origins=*` item (`:45`) updated or marked as the F8-eval tracking item.
- `docs/mcp-automation.md` — `dev:debug` note (if documented).
- *(divert-(b) only)* `scripts/a11y-audit.mjs` / `scripts/cdp-driver.mjs` — Origin-injecting shim, ONLY if the shim divert is chosen (not `farbling` — external tool).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified (incl. the recorded probe result + chosen disposition)
- [x] `grep -rn "9222" .mcp.json` empty
- [x] `npm test`/typecheck/lint green
- [x] Update flight-log.md with leg progress entry + the probe result + land-vs-divert decision
- [x] Set this leg's status to `completed` (probe passed; narrowing landed)
- [x] Check off this leg in flight.md
- [x] Committed (this leg lands in its own post-probe commit, not the earlier batched Phase-2d block)

## Citation Audit
To verify at design-review time (2026-06-16): `package.json:11` (`dev:debug` `--remote-allow-origins=*`); `.mcp.json` (Playwright `--cdp-endpoint http://127.0.0.1:9222`); `scripts/a11y-audit.mjs:182` (Node global `WebSocket`), `:44` (`CDP_HTTP`); `farbling-correctness.md:16,23` (chrome-devtools MCP on `:9222`); `devtools-cdp-conflict.md:10` (BLOCKED-AS-WRITTEN, missing affordance). The design-review Developer cross-checks the probe protocol soundness (does it actually exercise the no-Origin attach against the narrowed list?) and the divert completeness.
