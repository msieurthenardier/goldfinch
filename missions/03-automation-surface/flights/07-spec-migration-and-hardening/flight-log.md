# Flight Log: Bulk spec migration + ungated-path hardening (scoped)

**Flight**: [Bulk spec migration + ungated-path hardening (scoped)](flight.md)

## Summary
Flight `planning` (drafted 2026-06-16). Scope (operator): migrate the surface-compatible remaining Group-B specs onto the admin/jar MCP surface, add audit-log paging (20/page, in-memory), and **harden** the ungated `:9222` path (not fully remove it). The `evaluate` MCP tool + `farbling-correctness` + the `a11y-audit.mjs` rewrite + the *final* `:9222` removal are **deferred to a follow-on (F8-eval)** because they need in-page JS evaluation the surface lacks. Persistence of the audit log is explicitly a **future mission** (operator). SC11 part 2 (scoped).

Operator decisions (planning, 2026-06-16): scope = migrate-what-fits + harden + paging; audit paging = **20/page, in-memory**, persistence deferred to a future mission; eval-dependent items (`farbling-correctness`, `a11y-audit` rewrite, full `:9222` removal) deferred to F8-eval.

---

## Reconnaissance Report
Sources: mission SC11 (part 2), the F6 debrief action items, the F6 recon's Group-A/Group-B split. Every cited item walked against current code (2026-06-16).

| Item | Classification | Evidence / disposition |
|------|----------------|------------------------|
| **Un-migrated Group-B specs** | **confirmed-live** | 12 Group-B at F6; F6 migrated 3 (`tab-keyboard-operability`, `kebab-menu`, `settings-shell`). Remaining drive via `:9222`/`cdp-driver`: `unified-tab-controls`, `responsive-tab-strip`, `toolbar-pins`, `menu-dismissal`, `tab-scheme-guard`, `settings-controls`, `settings-automation`, `core-browsing-shields`, `farbling-correctness`. Classified by launch apparatus (`dev:debug`/`cdp-driver` count vs `dev:automation`). The 8 Group-A `mcp-*`/`foreground-to-act`/`observe-refusal-contract`/`internal-session-exclusion`/`devtools-cdp-conflict` only *mention* `:9222` to disqualify it — already on the surface. |
| **`settings-automation`** | **confirmed-live (migratable)** | `tests/behavior/settings-automation.md:23,44,55` — reads the chrome `#automation-indicator` + the settings-guest viewer via `cdp-driver`/`:9222`; the MCP session it stages is the system-under-test. Migrate the READS to admin `getChromeTarget`+`readDom`/`readAxTree`. Eval-free (DOM elements). |
| **`core-browsing-shields`** | **needs-human-recheck** | Guest-driving (shields). Migratable to a jar key + guest `wcId` IF its assertions are DOM/a11y/content-readable (request-blocked → element/content absence). If it reads script-runtime values → defer with `farbling`. Premise-audit at `migrate-guest-specs` leg. |
| **`farbling-correctness`** | **confirmed-live; DEFERRED (eval)** | Asserts on script-runtime fingerprint values (`navigator.*`, canvas/WebGL) not in `outerHTML`; the surface has no in-page `evaluate`. Also uses the disqualified `chrome-devtools` MCP. → **F8-eval** (needs the `evaluate` tool). |
| **`a11y-audit.mjs` rewrite** | **confirmed-live; DEFERRED (eval)** | `scripts/a11y-audit.mjs:1-4,44,137` — injects axe-core via CDP `Runtime.evaluate` at `:9222` (CSP-bypass) and runs axe's rule engine in-page. `readAxTree` gives the AX *tree*, NOT axe rule evaluation. Rewrite needs an `evaluate`/`inject` capability. → **F8-eval**. |
| **`dev:debug` `--remote-allow-origins=*`** | **confirmed-live** | `package.json:11`. Wide-open Origin allow-list (the cautionary tale). F7 **hardens** (narrow to loopback-Origin) — can't fully remove while a11y+farbling still use `:9222`. → `harden-ungated-path` leg (DD3). |
| **`.mcp.json` Playwright-`:9222` entry** | **confirmed-live** | `.mcp.json` registers `playwright` `--cdp-endpoint http://127.0.0.1:9222`. With the bulk leaving `:9222`, trim it (the migrated specs use the MCP surface, not Playwright-MCP). Full `.mcp.json` cleanup completes when `:9222` is removed (F8-eval). |
| **`devtools-cdp-conflict` `BLOCKED-AS-WRITTEN`** | **confirmed-live; carry blocked** | Needs a non-CDP DevTools-open affordance (deferred since F3). Stays blocked through F7; re-evaluate at `harden-ungated-path` (default: annotate + keep blocked → F8-eval). |
| **Audit-log paging gap** | **confirmed-live** | `settings.js` `LOG_DISPLAY_CAP = 50` silent slice of the 500-entry ring (`audit-log.js`). F6 debrief flagged it as a pre-bulk-migration must (bulk runs generate hundreds of entries). → `audit-log-paging` leg (DD4): 20/page, in-memory, renderer-only. |

**Premise audit (both axes) for the deferred items** — the surface can *act* + *observe* DOM/a11y/pixels, but has **no in-page JS `evaluate`**: confirmed against `observe.js:READ_DOM_SNIPPET` (outerHTML only) and the 17-tool registry. `farbling` (runtime-value reads) and `a11y-audit` (axe injection) are therefore not expressible on the current surface → F8-eval. This is the load-bearing reason for the scope split.

---

## Design Review Notes
Architect review (2026-06-16): **approve with changes** — all incorporated (single cycle; reviewer-prescribed fixes, no new design risk → operator sign-off is the next gate).
- **[HIGH] `core-browsing-shields` is not pure guest-driving** — its Step-5 tracker-block assertion reads the **chrome** privacy panel (`.tag.blk`/`#privacy-count`), reachable only via `getChromeTarget`+`readDom` (admin); a jar key is refused. Reframed DD2 + the leg to an **admin** spec (guest nav via `openTab` + chrome-panel read via `getChromeTarget`); operator Q1 → admin-only (simpler; the spec asserts chrome-visible state, not jar isolation).
- **[HIGH] Audit paging + live ring is incoherent without a freshness contract** — the ring grows on every tool call (broadcast per `record`), so naive page indices shift under the operator mid-read. DD4 now specifies **freeze-on-page-2+** (page 1 live; page 2+ snapshots + "paused — N newer · back to live"), newest-first, renderer-side windowing over the full snapshot.
- **[MED] DD3 hardening / Node WebSocket** — `a11y-audit.mjs` uses Node 22's global `WebSocket`, which sends **no `Origin`** by default; narrowing `--remote-allow-origins` may be a no-op or may break the attach. Added an **empirical WS-probe before landing the flag** + a **named divert** in Adaptation Criteria.
- **[MED] `settings-automation` dual target** — the settings-guest viewer reads need the `settings-shell` admin-`allowInternal` `enumerateTabs`→internal-`wcId` pattern, not `getChromeTarget` (chrome-only). Technical Approach §3 + the leg updated.
- **[LOW] `.mcp.json` trim ordering** — trim the Playwright-`:9222` entry only after the specs that name it (`responsive-tab-strip`) are rewritten; noted in DD3.
- Suggestions incorporated: paging newest-first; `devtools-cdp-conflict` annotation clarified (block = missing non-CDP DevTools affordance, not the Origin); a confound-free "`:9222` stopped" re-run AC added to Verification; renderer-side-windowing-over-full-snapshot noted.
- Confirmed sound: the scope split (migrate-what-fits / defer-eval / harden-not-remove); the premise audit (no in-page eval → farbling + a11y genuinely can't migrate); the bulk-before-harden sequencing; reuse of the F6 template; prerequisites.

---

## Leg Progress
_None yet._

---

## Flight Director Notes
_Orchestration decisions recorded here during execution._

### 2026-06-16 — Flight planned + signed off (status `ready`)
Designed via `/flight` (recon → spec → Architect review → operator sign-off). Architect: approve-with-changes, all incorporated (single cycle; no second pass — reviewer-prescribed fixes, no new design risk). **Operator signed off; status → `ready`.** Staged for a future `/agentic-workflow` run (not executed now — operator's call). Sequencing reminder for execution: bulk migration (legs 1–4) BEFORE `harden-ungated-path` (leg 6); the `harden` leg's `--remote-allow-origins` narrowing is a resolve-or-divert (empirical Node-WS Origin probe first).

---

## Decisions
_Runtime decisions not in the original plan._

---

## Deviations
_Departures from the planned approach._

---

## Anomalies
_Unexpected issues._

---

## Session Notes
_Chronological notes from work sessions._
