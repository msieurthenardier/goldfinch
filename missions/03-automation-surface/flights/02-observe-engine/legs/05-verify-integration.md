# Leg: verify-integration

**Status**: completed
**Flight**: [Observe Engine (screenshot / DOM / a11y)](../flight.md)

## Objective

Prove the wired observe engine works end to end against the **live** app — foreground a guest and
`captureScreenshot` / `readDom` / `readAxTree` it through the dev seam + `cdp-driver.mjs`, capture a
whole-window shot, confirm the DD6 internal-session exclusion holds live, and **record** (not assert)
the chrome-a11y-under-`cdp-driver` outcome — with the full unit suite + typecheck + lint green.

## Context

- This is the flight's integration gate (flight Verification section). The observe orchestration is
  unit-tested (33 cases); this leg confirms the **Electron-bound capture/read/attach actually works on
  the live app**, which unit tests cannot.
- **Interim verification standard** (mission decision): SC3/SC4 are *behavior-test-backed* only once
  the Flight-3 transport exists; this flight is verified by **unit tests + a dev-seam/`cdp-driver` live
  smoke** + the Leg-6 operator-oracle HAT. No behavior-test spec is authored. The accepted standard is
  **FD-driven runs with cited machine-read evidence** (M02-debrief carry-in) — `cdp-driver.mjs eval`
  supplies the machine reads.
- **Apparatus.** Under `npm run dev:debug` (port 9222, WSLg display), the chrome renderer exposes
  `window.goldfinch.automationDevInvoke(op, argsArray)`. Drive it with
  `node scripts/cdp-driver.mjs eval "<jsExpr>"`, which evaluates in the chrome renderer and prints the
  JSON result. The observe ops return: `captureScreenshot`/`captureWindow` → base64 PNG string;
  `readDom` → `{url,title,html}`; `readAxTree` → AX node array **or** the
  `{automation:'debugger-unavailable',…}` refusal object.
- **Live unknowns resolved HERE** (flight Open Questions / Divert criteria): (1) does a foregrounded
  guest `capturePage` come back **non-blank** (and is the `DEFAULT_PAINT_DELAY_MS = 80` enough, or does
  it need tuning via the `{delayMs}` opts)? (2) does `webContents.debugger.attach('1.3')` +
  `Accessibility.enable` + `getFullAXTree` actually return a tree on a **guest** on Electron ^42, and is
  `enable` required first? If the smoke shows a problem, fix `observe.js` + its unit tests and re-verify
  (a new commit, no amend) — observe is not "done" until it reads a live guest.
- **DD8 / single CDP client (opportunistic, NOT a required assertion).** `cdp-driver.mjs` holds the
  **chrome** CDP target during the smoke. Attempting a **chrome** `readAxTree` while it is attached
  **may** refuse (`debugger-unavailable`) or **may** succeed — the in-process-vs-port contention is the
  unverified premise. **Record which occurs** as a finding; the clean-refusal path is authoritatively
  covered by the unit test + the Leg-6 DevTools HAT.

## Inputs
- Legs 1–4 landed + committed (`observe.js` + engine wiring + dev seam from Flight 1).
- `scripts/cdp-driver.mjs` — `eval` / `shot` over the chrome renderer CDP target at
  `http://127.0.0.1:9222`.
- `npm run dev:debug` — launches the app with the dev seam active (WSLg display, `--no-sandbox
  --disable-dev-shm-usage`, port 9222).
- A live GUI reachable (operator confirms WSLg display + port 9222 free).

## Acceptance Criteria
- [x] **AC1 (static)** — `npm test` (full unit suite, 391 pass) green, `npm run typecheck` clean,
  `npm run lint` clean. *(Satisfied by the autonomous batch; re-confirmed here.)*
- [ ] **AC2 (live — guest screenshot, non-blank)** — under `npm run dev:debug`, foreground a guest tab,
  `captureScreenshot(guestWcId)` via the dev seam; decode the base64 and confirm a **non-blank** PNG of
  real dimensions (write it to the ephemeral evidence dir and eyeball it in the HAT). Record the
  paint-settle value used and whether tuning was needed.
- [ ] **AC3 (live — guest DOM)** — `readDom(guestWcId)` returns `{url,title,html}` whose `url`/`title`
  match the foregrounded page and whose `html` contains expected page markup (machine read-back).
- [ ] **AC4 (live — guest a11y tree)** — `readAxTree(guestWcId)` returns a **non-empty** AX node array
  for a real rendered page (an array, not the refusal object). Confirms `attach('1.3')` + `enable` +
  `getFullAXTree` work on a guest on Electron ^42. Record the protocol/enable findings.
- [ ] **AC5 (live — whole-window capture)** — `captureWindow()` returns a non-blank base64 PNG of the
  whole window (chrome + composited guest).
- [ ] **AC6 (live — DD6 internal-session exclusion holds)** — the internal `goldfinch://settings` guest
  is (a) **absent** from `enumerateTabs`, and (b) when its `wcId` is supplied directly to
  `captureScreenshot` / `readDom` / `readAxTree`, each **throws** `automation: internal-session` (not a
  refusal — a throw). This is the load-bearing security check while the flight is ungated.
- [ ] **AC7 (opportunistic, recorded not asserted)** — attempt a **chrome** `readAxTree` while
  `cdp-driver` is attached; **record** whether it returns a refusal or a tree (DD8 premise). Not a
  pass/fail gate.
- [ ] Evidence captured to the ephemeral dir `/tmp/behavior-tests/goldfinch/observe-verify/{ts}/`
  (screenshots, machine-read JSON) — **never committed**; referenced from the flight log.

## Verification Steps (operator-guided)
> The Flight Director presents one step at a time; the operator runs it and reports the result.
1. **Static gates** (FD or operator): `npm test`, `npm run typecheck`, `npm run lint` → all green.
2. **Launch** (operator): `npm run dev:debug` in a WSLg-capable shell; confirm the window appears and
   port 9222 is listening.
3. **Enumerate + foreground a guest**:
   `node scripts/cdp-driver.mjs eval "window.goldfinch.automationDevInvoke('enumerateTabs', [])"`
   → pick a non-internal guest `wcId` (open/navigate one to a known page first if needed via
   `openTab`/`navigate`).
4. **Screenshot** (AC2): `… automationDevInvoke('captureScreenshot', [<wcId>])` → base64; pipe to a file
   in the evidence dir, open it, confirm non-blank + correct page. Tune `{delayMs}` only if blank.
5. **DOM** (AC3): `… automationDevInvoke('readDom', [<wcId>])` → check `url`/`title`/`html`.
6. **A11y** (AC4): `… automationDevInvoke('readAxTree', [<wcId>])` → confirm a non-empty array.
7. **Whole window** (AC5): `… automationDevInvoke('captureWindow', [])` → non-blank PNG.
8. **Internal-session** (AC6): confirm settings guest absent from `enumerateTabs`; if its `wcId` can be
   obtained, pass it to each observe op and confirm an `automation: internal-session` throw.
9. **Chrome a11y under cdp-driver** (AC7): `… automationDevInvoke('readAxTree', [<chromeWcId>])` →
   record refuse vs succeed.

## Edge Cases
- **Blank guest screenshot** → bump `{delayMs}` via the `captureScreenshot` opts; if still blank, this
  is a flight **Divert** trigger (re-open the render-strategy question). Record findings either way.
- **`readAxTree` returns the refusal object on a guest with no other client** → unexpected; investigate
  (protocol version? `enable` ordering?) before landing — a guest read should succeed.
- **`enable` not required / different protocol version** → adjust `observe.js` + unit tests, re-verify,
  new commit (no amend).

## Files Affected
- None expected (verification only) — unless the live smoke surfaces a fix to `src/main/automation/observe.js`
  (+ its unit tests), which would be a new commit.

---

## Post-Completion Checklist
- [ ] AC1 re-confirmed; AC2–AC6 pass live; AC7 recorded
- [ ] Evidence captured to the ephemeral dir + referenced in the flight log
- [ ] Flight-log Leg Progress entry (incl. paint-settle + a11y-protocol findings, AC7 outcome)
- [ ] Set this leg's status to `completed` and check it off in flight.md
- [ ] Any observe fix committed (new commit, no amend) and the draft PR updated
