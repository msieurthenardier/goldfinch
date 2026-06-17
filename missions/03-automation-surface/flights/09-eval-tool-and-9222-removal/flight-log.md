# Flight Log: Eval tool + DevTools tool + a11y/farbling migration + final :9222 removal

**Flight**: [Eval tool + DevTools tool + a11y/farbling migration + final :9222 removal](flight.md)

## Summary
**Ready** (operator sign-off 2026-06-17). The deferred SC11 remainder (the F7 "F8-eval"). Drafted from the mission roadmap + the F7/F8 debriefs; reconnaissance run against current code (below); Architect-reviewed (approve-with-changes, all HIGH/MEDIUM folded in); OQ1–OQ4 settled. DD1–DD9; 8 legs. Two prereqs deferred to execution: a GUI display + the leg-1 `executeJavaScript`-injects-axe spike. Awaiting execution.

---

## Reconnaissance Report (Phase 1b)

Every F9 source item walked against current code (branch `main` @ `36590a4`, post-F8 merge):

| Item | Classification | Evidence | Recommendation |
|------|----------------|----------|----------------|
| Eval/`injectScript` MCP tool | **confirmed-live** | No `evaluate`/`injectScript` in `mcp-tools.js` (16 tools: 12 drive / 4 observe / 1 admin); engine has only `executeJavaScript` for self-contained read snippets (`observe.js`, `engine.js:44`) | Build it (leg 1, keystone) |
| `scripts/a11y-audit.mjs` rewrite | **confirmed-live** | 350 lines fully on CDP `:9222` — `CDP_HTTP='http://127.0.0.1:9222'` (`:44`), `fetch /json`, WebSocket CDP client (`:183`), axe injection via `Runtime.evaluate` | Rewrite onto the eval tool (leg 3) |
| `farbling-correctness` migration | **confirmed-live** | Spec apparatus is `chrome-devtools` MCP `evaluate_script` attached to `:9222` (`farbling-correctness.md:16,21,31`); reads in the guest main world | Migrate to the eval tool (leg 4) |
| `devtools-cdp-conflict` unblock | **confirmed-live (blocked-as-written)** | Spec `Status: draft`, BLOCKED on the missing non-CDP DevTools-open affordance (`devtools-cdp-conflict.md:10,12`); `openDevTools`/`closeDevTools` grep → **none** in `src/` (net-new) | Add the DevTools tool (leg 2) → run the spec (leg 5) |
| Final `:9222` removal | **confirmed-live** | `dev:debug` in `package.json:11` (`--remote-debugging-port=9222 --remote-allow-origins=http://127.0.0.1:9222`); `--remote-debugging-port` arm in `automation-dev.js:25`; `scripts/cdp-driver.mjs:25`; `main.js:270,1002` comments | Remove last (leg 6), after a11y+farbling migrate |
| F8: serialize `applyAutomationEnabledChange` | **confirmed-live** | F8 debrief — serializes against `rebinding` only, not against concurrent toggle flips | Bundle (leg 7) |
| F8: `userData`-redirect ordering test | **confirmed-live** | F8 debrief — ordering invariant protected only by human review | Bundle (leg 7) |
| F8: `resolvePort` `honorEnv` JSDoc warning | **confirmed-live** | F8 debrief — `honorEnv: true` default is a latent foot-gun for a forgetful caller | Bundle (leg 7) |
| `.mcp.json` `:9222`/playwright remnant | **already-satisfied** | F7 trimmed it; `.mcp.json` ships `{"mcpServers": {}}` (verified during F8 leg 6) | No action — verify-only in leg 6 |

**Premise flagged for the Architect (OQ1):** does `webContents.executeJavaScript` inject axe-core + read it back (CSP-immune for direct eval)? If yes → zero CDP → clean `:9222` death. If no → eval tool needs a CDP `Runtime.evaluate` path through `cdp.js`. **Not verifiable from static reading alone — needs the leg-1 spike**; the Architect should treat it as the load-bearing premise.

---

## Leg Progress
_(none yet — planning)_

---

## Decisions
Runtime decisions not in original plan.

---

## Deviations

---

## Anomalies

---

## Flight Director Notes
- 2026-06-17 — Flight created via `/flight` (mission 3, goldfinch) immediately after F8 landed/merged, at operator request ("let's plan the next flight" while the Windows installer build waits on a stalled Concourse worker). Operator decisions captured: (1) **no steer on the eval-tool mechanism/gating — negotiate with the Architect** (the Phase-5b design review settles OQ1/OQ2 with code-cited premise audits); (2) **keep F9 as one flight** (the full bundle, ~8 legs — large but agreed); (3) **DevTools should be available via MCP** — resolved by adding a real `openDevTools`/`closeDevTools` tool (DD3), which doubles as the non-CDP affordance that unblocks `devtools-cdp-conflict` (turning "add affordance OR retire" into "ship the capability → run the spec"). Reconnaissance run (above) — all roadmap/debrief items confirmed-live except the `.mcp.json` remnant (already-satisfied by F7).

## Session Notes
- 2026-06-17 — Planning draft written (flight.md DD1–DD9, 8 legs).
- 2026-06-17 — **Architect design review complete (approve-with-changes).** Settled the operator-delegated premises: **OQ1** — `executeJavaScript` is CSP-immune for direct eval + auto-awaits Promises → **zero CDP for eval, `:9222` dies clean** (~95%; leg-1 spike confirms live). **OQ2** — **two tools** (`evaluate` + `injectScript`); jar-scoped guests + admin chrome; **HIGH: internal-session excluded even for admin** (admin carries `allowInternal` so `resolveContents` won't throw — the eval op must add an explicit `isInternalContents` refusal, else arbitrary JS in `goldfinch://settings` compromises the privileged bridge). **OQ3** — `openDevTools`/`closeDevTools` `{mode:'detach'}`, same gating, confound-free; the `readAxTree` conflict is the recorded finding; eval works under DevTools. **DD7** — the `--remote-debugging-port` arm of `isAutomationDevEnabled` was never active in the renderer; switch `main.js` to `isMcpAutomationEnabled`, then remove the function — cut is safe. Incorporated: the HIGH guard, the 17→21 tool-count fixes (incl. the `devtools-cdp-conflict` `=== 16` self-halt), the concurrent-flip mutex (one chain covering `rebinding` + `applyAutomationEnabledChange`), the inject-then-run pairing for a11y. No second review cycle (changes were the Architect's own enumerated resolutions). **Next: operator sign-off → `ready`.**
