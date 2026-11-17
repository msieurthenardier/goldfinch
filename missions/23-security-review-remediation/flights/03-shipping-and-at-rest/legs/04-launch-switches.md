# Leg: launch-switches

**Status**: landed
**Flight**: [Shipping and At-Rest](../flight.md)

> Developer design review 2026-11-17: **approve with changes**, incorporated — the site-isolation feature's registered name is `SitePerProcess` (added, tokens trimmed); six more switches of the same kind join the refused set and one the stripped set; a failed or ineffective removal is promoted to a refusal; "no profile directory" became "no store, no lock", compared against a baseline; on Linux the error box is a second stderr line; the four existing order pins were read and admit the block unmodified.

## Objective

An installed (packaged) build no longer obeys the launch switches that turn off its protections: each is either stripped before it takes effect or makes the app refuse to start, saying which switch was the reason.

## Context

- Flight DD5 (mission finding 18, the launch-switch part; operator ruling 2026-11-16: refuse the dangerous ones, keep `--no-sandbox`; 2026-11-17: `--proxy-server` is not refused, `GOLDFINCH_AUTOMATION_ADMIN` stays honoured).
- **The threat this answers** is the app being repurposed through its command line by something that is not a local attacker with a debugger — a shortcut, a wrapper script, a URL-handler argument. Someone who can edit the files on disk already runs code as the operator; that is stated in the docs, not defended.
- **Measured in leg `packaged-measurements`** (`packaged-measurements.md`, *AC3 / Q3*), on the packaged Linux build, each effect observed from outside the app:
  - `app.commandLine.removeSwitch(name)` called as the first statements of `main.js`, before `ready`, **stops the effect** of `--remote-debugging-port`, `--remote-debugging-pipe`, `--ignore-certificate-errors`, `--disable-web-security`, `--host-rules`, `--host-resolver-rules`.
  - `--js-flags`: removal reaches the renderers but **not the main process** (its V8 had the flag before any script ran). Only refusing to start neutralises it.
  - `--load-extension`: Electron ignores it (a positive control through `session.loadExtension` worked). No refusal is needed; removing it is harmless and covers a later Electron that honours it.
  - `app.exit(code)` at that point, after printing one line, leaves no window and no listening port, for every switch tried.
  - Only the `--name=value` form was given. Chromium's own parser decides what counts as a switch (bare, `=value`, and on Windows a `/` prefix; nothing after a bare `--`), so the decision asks **`app.commandLine.hasSwitch`** rather than re-parsing `argv`.
- **The two sets, fixed here.** *Stripped* (removal measured, or the switch is meaningless once its partner is stripped): `remote-debugging-port`, `remote-debugging-pipe`, `remote-debugging-address`, `remote-allow-origins`, `remote-debugging-targets`, `ignore-certificate-errors`, `disable-web-security`, `host-rules`, `host-resolver-rules`, `load-extension`, `disable-extensions-except`. *Refused* (removal measured insufficient, or not measured — refusing needs no proof that removal is in time): `js-flags`, `ignore-certificate-errors-spki-list`, `unsafely-treat-insecure-origin-as-secure`, `disable-site-isolation-trials`, `disable-site-isolation-for-policy`, `allow-file-access-from-files` (the chrome is a `file://` page), `allow-running-insecure-content`, `ssl-key-log-file` and `log-net-log` (they write session secrets and a full network capture to a file of the launcher's choosing), and a `disable-features` value that names `IsolateOrigins`, `SitePerProcess` (the feature's registered name) or `site-per-process` (the legacy spelling) — exact, case-sensitive tokens after splitting on commas and trimming whitespace; the operator's other `--disable-features` entries keep working and the `enable-features` composition is not touched. Everything in the refused set beyond `js-flags` is **unmeasured and refused by default**; the docs say so.
- **Not on either list, by decision**: `--no-sandbox` and `--disable-gpu-sandbox` (some Linux hosts cannot start the sandbox; documented as lowering protection); `--proxy-server` and its relatives (operator ruling); `--user-data-dir`; `--enable-features` / `--disable-features` in general. **Not covered and said so in the docs**: the process-launcher family (`--gpu-launcher`, `--renderer-cmd-prefix`, `--utility-cmd-prefix`, `--browser-subprocess-path`) — whether a refusal at the top of `main.js` is early enough for them was not measured, so no protection is claimed; Electron's own argument check for URL-handler launches is the existing defence for that route.
- **The startup block** (`src/main/main.js`), in order today: the `if (!app.isPackaged) { app.setPath('userData', …) }` redirect → `app.requestSingleInstanceLock()` (loser: `app.exit(0); process.exit(0)`) → `readStartupShieldsConfig` → `app.commandLine.getSwitchValue('enable-features')` / `('disable-features')` → `decideStartup` → the one `appendSwitch('enable-features'` → `crashReporter.start(`. Pinned by `test/unit/single-instance-lock-order.test.js` and `test/unit/third-party-cookie-startup-order.test.js`.
- **Placement**: a new block immediately **after** the dev-profile redirect and **before** the single-instance lock. Before the lock so a refused launch touches nothing (no lock, no store, no hand-off of its arguments to a running instance); before the `enable-features` reader by the flight's ruling. It runs only when `app.isPackaged`.
- **This leg installs nothing global** (no `app.on`, no session listener) but edits the block that the third-party-cookie premise rests on, so that premise is re-run: the `third-party-cookie-isolation` behavior spec is run by the Flight Director after this leg lands, and this leg itself reads `isolateEffective` on the packaged build.
- A packaged build on this host is launched only by leg 02's recipe (both `HOME` and `XDG_CONFIG_HOME` in scratch; `--no-sandbox --ozone-platform=wayland`), and is drivable over MCP from a seeded profile (*AC2* of the measurements; `docs/dev-testing.md` after leg `runtime-fuses`).

## Inputs

- Legs 01, 02, 05 and 03 landed (uncommitted): `main.js` carries leg 05's wiring (none of it in the startup block); `npm run pack` produces a fused build.

## Outputs

- New `src/main/launch-switches.js` (Electron-free, CJS, main-only) and its unit test; a pin test for placement.
- `src/main/main.js` — one block. Docs.

## Acceptance Criteria

- [ ] **AC1 — The decision is a pure function.** `decideLaunchSwitches({ isPackaged, hasSwitch, getSwitchValue })` → `{ remove: string[], refuse: string[] }`, both in table order, names without dashes, drawn only from the module's two frozen tables (never from `argv` text). Unpackaged → both empty whatever is present. Unit table: each stripped switch alone; each refused switch alone; several together; none; `disable-features` with `IsolateOrigins`, with `site-per-process`, with both among other names, with a near-miss (`IsolateOriginsX`, different case) → not refused, with an empty value; a switch on neither list (`no-sandbox`, `proxy-server`, `enable-features`) → untouched; `disable-features` with `SitePerProcess` alone, mixed, with spaces around it, and as a near-miss; a switch present with an empty value; a `hasSwitch` that throws → treated as a refusal of that name (fail closed), never an uncaught throw. A drift guard asserts no name is in both tables. A second pure function, `applyLaunchSwitches(decision, { removeSwitch, hasSwitch })` → the final refusal list: it removes each `remove` name in its own `try`, then re-asks `hasSwitch`; a removal that throws, or a switch still present afterwards, is **promoted to a refusal**. Unit-tested with fakes for both failures.
- [ ] **AC2 — The block applies it and does nothing else.** In `main.js`, inside `if (app.isPackaged) { … }`: `applyLaunchSwitches` strips the `remove` names, then **one** line to stderr lists the names actually removed; if the final refusal list is non-empty: one line to stderr naming them, `dialog.showErrorBox` with a fixed title and a body that names the switches (names from the table only — never a value, never text from the command line), then `app.exit(64); process.exit(64)` (64 is `EX_USAGE`). The exit code and both line formats are documented. The block contains no `setPath('userData'` text and no `appendSwitch` (two existing pins locate their landmarks by first occurrence and by count). `process.argv` is not rewritten by a removal — nothing in `src/` reads it for a listed switch (`isMcpAutomationEnabled` matches one exact dev token; `extractLaunchUrls` drops flags). No store is opened, no lock taken and no window created on a refusal. On a non-refusing launch the block has no other effect.
- [ ] **AC3 — Placement is pinned.** A source-scan test (wrap-insensitive regexes, throwing if a landmark is not found — the project's mutation-pin convention) asserts the block sits after the `setPath('userData'` redirect, before `requestSingleInstanceLock(`, before `getSwitchValue('enable-features')`, and that `removeSwitch(` appears nowhere else in `src/main/**`. and that `app.exit(64)` appears exactly once. `single-instance-lock-order.test.js`, `third-party-cookie-startup-order.test.js`, `crash-reporter-pins.test.js` and `dev-profile-redirect-order.test.js` pass **unmodified** (design review read all four: each anchors on its own landmark and none counts exits; the block must sit after the redirect, never before it); if one of them needs editing to admit the new block, say exactly why in the log.
- [ ] **AC4 — Stripped switches have no effect on the packaged build**, each observed from outside the app as in leg 02, on the freshly packed build with this leg's code (not a patched copy): the debugging port does not answer; a CDP message on the pipe gets no reply; a self-signed HTTPS fixture receives no request; a cross-origin read is reported `blocked`; a mapped hostname's request does not reach the fixture (both rule switches); and with each one the app **starts and works** — attach over MCP and run `enumerateWindows`, `enumerateTabs`, `openTab`, `readDom`, `evaluate`, `captureScreenshot`, `closeTab` once (the fixture pages for the certificate, cross-origin and host-rule observations are loaded by the harness and report to their own origin — they are not MCP primitives; `readDom`, `openTab`, `closeTab` and `captureScreenshot` are first-time on a packaged build unless leg `runtime-fuses` already ran them). Each of `remote-debugging-address`, `remote-allow-origins` and `remote-debugging-targets` is given together with the port switch: still no answer.
- [ ] **AC5 — Refused switches stop the launch**, each alone, in the bare form and the `=value` form where the switch takes one: exit code 64, the refusal line on stderr (on Linux, before `ready`, the error box is itself written to stderr — a second line there is expected), no window (no display-initialisation lines), no listening port, **no store and no lock** in the scratch config home (`app.db`, `history.db`, `vaults/`, `SingletonLock`, the crash log — absent; whatever Chromium itself creates before any script runs is established by one baseline run of a copy that exits at `main.js`'s first statement, and the refused launch must leave nothing the baseline does not), and — with an instance already running on that profile — the running instance receives **no** hand-off from the refused launch (its tab census is unchanged). `--js-flags=--expose-gc` in particular.
- [ ] **AC6 — What must keep working, does.** On the packaged build: `--no-sandbox` (every launch here uses it); `--proxy-server=http://127.0.0.1:<port>` — a loopback proxy fixture receives the request for a plain-HTTP page; an operator `--disable-features=<some other feature>` and `--enable-features=<some other feature>` still compose — `isolateEffective` read through MCP (the `shields-isolation-state` read, by admin `evaluate` in the chrome) is `true` with default settings in each case, and with no feature switches at all; and `--disable-features=ForceThirdPartyCookieBlockingEnabled` is **not** refused and shows up as the operator override exactly as it does today (the boundary of "refuse only the site-isolation tokens"); a URL argument still opens; a second instance still hands off. On an **unpackaged** dev launch (`dev:automation` plus `--remote-debugging-port=<n>`): the port **does** answer — dev is unchanged.
- [ ] **AC7 — Every existing apparatus primitive still answers on the packaged build with the block in place** (project rule): the full list from leg `runtime-fuses` AC4, once, on a launch with no listed switch.
- [ ] **AC8 — Docs.** `docs/RELEASING.md` or the security-relevant doc the Developer judges right (named in the report): the two lists and what each entry would otherwise allow; what is deliberately still honoured and why (`--no-sandbox`, `--proxy-server`, `GOLDFINCH_AUTOMATION_ADMIN` — accepted, with the operator's reason: whoever can set it already has full access, and it still needs automation enabled and a minted key); what is not covered (the launcher family, a local attacker); the exit code and the message; that dev launches are unaffected. CLAUDE.md: one entry (the module, the placement pin, "a new dangerous switch is a table row plus a measurement of whether removal is in time; when in doubt it goes in the refused set").
- [ ] **AC9 — Gates.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`.

## Verification Steps

- AC1–AC3: the new tests and the three existing pins.
- AC4–AC7: the smoke script's table in the flight log (switch → form → observation), script in the scratch directory.
- After landing, the Flight Director runs `/mission-control:behavior-test third-party-cookie-isolation` (dev mode) and records the run log beside this leg's entry.

## Implementation Guidance

1. The module and its table test.
2. The block and the placement pin. Run the three existing pins.
3. `npm run pack`; the packaged smoke, reusing leg 03's seeding helper and leg 02's fixtures (rebuild them in scratch — nothing of theirs was kept).
4. The dev control (AC6, last line).
5. Docs, gates. Leg `landed`, flight-log entry, `[LAND:leg]`. Do not commit.

## Edge Cases

- **`dialog.showErrorBox` before `ready`**: Electron documents it as safe before `ready` (on Linux it then writes to stderr instead of showing a box). If it throws or blocks the exit on this host, keep the stderr line and the exit, drop nothing silently, and report what happened — the box is a courtesy, the exit is the control.
- **`app.exit` returns before the process is gone**: hence `process.exit` straight after, as the single-instance loser already does.
- **The refusal runs in a second instance while a first is open**: it must exit before the lock, so no arguments reach the first instance (AC5).
- **A relaunch (Shields restart-to-apply) carries the original arguments**: a launch that passed the check passes again; a stripped switch is stripped again. Check once with a stripped switch present (`relaunch-options.js` re-passes `process.argv.slice(1)`).
- **Windows `/switch` forms and case**: handled by Chromium's parser through `hasSwitch`; not measurable here — unit-covered by the predicate being the only reader, and listed for the walk.
- **A switch given twice or with an empty value**: `hasSwitch` is true; same handling.
- **`removeSwitch` on a name that is absent**: a no-op; the block only calls it for names `hasSwitch` reported.
- **Anything needing a design call** (a pin that cannot admit the block, a listed switch that still takes effect after removal): `[BLOCKED:<reason>]` — do not move a switch between the two sets yourself except from *stripped* to *refused*, which is always allowed and is reported.
- Packaged launches only with both variables redirected; processes stopped by recorded pid; no vault unlock, clipboard write, download, or registered MCP server.

## Files Affected

- `src/main/launch-switches.js` (new), `test/unit/launch-switches.test.js` (new), `test/unit/launch-switches-placement.test.js` (new, or folded into the first)
- `src/main/main.js` — the one block (and a `dialog` import if not already present)
- `docs/RELEASING.md` or the doc chosen, `CLAUDE.md`

## Citation Audit

Checked by the Flight Director on 2026-11-17: `src/main/main.js` — the `!app.isPackaged` redirect block, `requestSingleInstanceLock()` with its `app.exit(0); process.exit(0)` loser path, `getSwitchValue('enable-features')` / `('disable-features')`, the single `appendSwitch('enable-features'`, `crashReporter.start(`, and the comments naming the two order-pin tests; `packaged-measurements.md` *AC3 / Q3* (per-switch rows, the summary table, the notes on `--js-flags`, `--load-extension`, switch forms and the unmeasured switches); flight DD5's list and placement. **Not verified by reading**: that the two order pins accept a block between the redirect and the lock (AC3 makes it a criterion), and `showErrorBox`'s behaviour before `ready` on this host (an edge case with a fallback). Tier: **high** — the security-sensitive start of the main process, shared with three pinned orderings. Developer design review done (one cycle; every change is the reviewer's remedy or a move toward refusing, so no second pass). Flight Director answers to its four questions: `SitePerProcess` added; AC5 relaxed to stores and lock against a baseline; the extra switches are added now rather than recorded as uncovered; a failed removal is promoted to a refusal.

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
