# Flight Log: Alignment / HAT

**Flight**: [Alignment / HAT](flight.md)

## Summary

HAT session in progress. Environment: admin-keyed dev launch (fresh mint; instance identity by construction), fixture on :8091, automation endpoint 127.0.0.1:49707 gated correctly.

## Session Notes

### web-compat-fullscreen run 2026-07-28-18-04-00 (live, Witnessed, admin-keyed)

- Checkpoint 1 (fixture baseline): **PASS** (Validator; rendered + DOM agree).
- Checkpoint 2 (fullscreen enter): Validator **FAIL** on window captures showing chrome still visible — **overridden to PASS by operator witness** (human watched live: video went fullscreen, no tabs, no flicker; paint arrived "in a couple chunks", judged acceptable; operator's manual Esc exit restored chrome cleanly, corroborating step 3's path).
- **Root cause of the false FAIL (apparatus, not app)**: `grabWindow`'s WSLg/Wayland fallback composites chrome + guest with the guest pasted at the renderer-reported `#webviews` slot rect — it models the window instead of observing it, and the model ignores `record.htmlFullscreen` (guest actually at full-window bounds, raised above chrome). Confirmed by reading `main.js:449+` (FIX 2(b) path).
- **Operator decision**: rerun-step after an inline single-surface fix (HAT fix-vs-feature gate: FIX — capture correctness; one function in `main.js`). Developer spawned to source the guest layer from main-side `view.getBounds()` ground truth and respect actual z-order. App relaunch required after the fix (main-process code); minted key hashes persist, so existing keys remain valid under a plain `GOLDFINCH_AUTOMATION_ADMIN=1` relaunch.
- Note for the mission debrief: this is the **third distinct apparatus-defect class** of the mission (jar-tier gap; stale-instance binding; now non-veridical synthetic composite) — the Witnessed pattern's independent-observer discipline caught it only because a human was watching. Consider a "capture veridicality" check in the apparatus audit: one known-state capture compared against an operator observation before trusting captures for pass/fail.

### Fullscreen run closed: 7/7 operator-ruled PASS (run log: tests/behavior/web-compat-fullscreen/runs/2026-07-28-18-04-00.md)

- Steps 1, 3-6 clean; step 2 fail→pass (apparatus composite fix, both verdicts preserved); step 7 Validator-pass → operator-FAIL (screenshot: oversized/cropped chrome+guest in an un-maximized window) → **operator-ruled PASS with a Known Issue** after the resize probe (view self-corrects on any window resize; manual YouTube fullscreen works end to end).
- **Known Issue (mission-level, accepted by operator)**: stale-oversized guest/chrome bounds after fullscreen-exit × window-geometry interleavings (observed under WSLg Wayland + display scaling); self-corrects on resize. Follow-up diagnosis queued — suspect a units/convention mismatch between `win.getContentBounds()` (used by the fullscreen expansion/resize re-expand) and the renderer-measured slot convention; the fullscreen logical-viewport undershoot (1400x900 CSS vs ~2558 real) is the same finding's other face.
- **Capture-veridicality catalog (Validator closing)**: three divergences in one run — stale-slot composite (fixed inline), oversized-guest geometry invisible to the fixed composite, `capturePage` blindness to physical cropping. Recommendation adopted for the debrief: captures should be stamped with their bounds source, and the apparatus should self-check composite dimensions against main-side window bounds once per run.
- **Spec/fixture follow-ups (Validator + Executor closings)**: require timing offsets in step reports; demand precondition evidence for forced-transition steps; fixture's fullscreen button is enter-only (unreachable under top-layer video) — move it into the fullscreen element; use a multi-minute video for the live-site step; document click-tool coordinate-only interface and capture base64 handling for driver authors.
- Human-judgment record (operator): fullscreen enter/exit feel — good, no flicker, chunked paint acceptable; Esc and native-control exits both felt right.

### web-compat-basic-auth run closed: 7/7 PASS (run log: tests/behavior/web-compat-basic-auth/runs/2026-07-28-19-58-55.md)

Findings adopted from the run: **D1** port missing from the auth sheet (FIXED inline — `displayHost` in auth-challenges.js, 3090 tests; live re-verify pending next sheet appearance); **O1** per-jar auth-cache auto-answer (design observation → debrief); **O2** blur-close/refocus-re-present verified live twice; **P1–P5** security positives (out-of-jar refusal, no-DOM-while-prompting, fill-only contract, reject-and-re-challenge via operator mistype, quit-cancels-pending). Spec improvements S1–S4 queued for AUTHORING/spec revisions. **HAT-raised FEATURE (operator-ruled: follow-up flight)**: human vault integration on the auth sheet — fill-from-vault + save-on-submit; today the agent path has vault powers the human lacks. Cert-picker shows no host line (observation).

### CRITICAL HAT FINDING: main-process crash on client-cert fixture navigation (open, Developer diagnosing)

Navigating to https://127.0.0.1:8493/ (TLS fixture, requestCert:true, client cert present in NSS, --insecure-tls-fixtures active and confirmed on the Electron cmdline) kills the main process, exit 1, silently — no exception in --enable-logging output. First seen on the operator's manual attempt ("page won't load"), confirmed by an FD-driven openTab that coincided with app death. Suspect region: the select-client-certificate → cert-picker path with REAL Electron Certificate objects (unit fakes may mis-model the shape). Developer spawned with controlled-repro instructions (scratch profile, stderr capture, instrumentation).

### Client-cert HAT segment (in progress) — findings ledger

- **CRASH ROOT-CAUSED AND FIXED (inline fix #3)**: Electron 43's `select-client-certificate` callback **SIGSEGVs on zero-argument invocation** — every cert-cancel path was fatal. Isolation harness measured all four callback shapes (`()` SIGSEGV / `undefined` throw / `null` correct cert-less continue / `list[0]` selects). Fix: kind-aware cancel in `resolveOnce` (`cb(null)` for certs). Real nine-key Certificate shape captured live and pinned in regression tests. 3092 tests green. Killer sequence replayed alive. **Attribution nuance (honest record)**: the original live crash predated the sandbox-launch discovery below, so its mechanism has two candidates (the proven SIGSEGV; a Chromium-under-sandbox-denial variant) — the SIGSEGV is real and fixed regardless.
- **APPARATUS LESSON #4 (major)**: launching the app-under-test from a sandboxed orchestrator shell silently amputated `~/.pki/nssdb` — Chromium saw an empty cert store and continued cert-less **without ever emitting the event**. Explains operator's silent cert-less loads and the scratch-vs-live divergence. Rule: the app under test must be launched with real-user filesystem visibility.
- **Design behaviors verified live in passing**: background-tab challenge hold → present-on-activate; tab-close of a live cert challenge survives post-fix (the former killer sequence, exercised twice by the operator incidentally).
- **OPEN (inline fix #4 in flight)**: with certs finally visible, the chooser "presents" (`sheetVisible: true`) but renders NOTHING (operator screenshot: blank content area; capture blocked by the pending-load quirk). Suspects: cert-picker model/dispatch rejecting real certSummaries shapes (fake-vs-real premise gap, same class as the crash), or sheet bounds seeding on driven activation (stale-bounds family). Developer diagnosing with unsandboxed scratch recipe.
- Developer observations queued for debrief: cert sheet stayed visible across a tab switch in scratch repro (occlusion-contract check needed); Chromium coalesces same-host cert requests; cert sheet displays no host line (display observation).

### Client-cert item CLOSED (operator-verified live)

- **Inline fix #4** (blank sheet) root-caused as a **cross-flight regression**: F2's popup-marker change (commit 6d5f8d8) switched the cert model to object form but missed `menu-overlay.js`'s `modelShapeOk` gate → silent reject → visible empty sheet. Masked by the a11y hook's legacy bare-array and dispatch-bypassing template tests. Fixed with both ends contract-pinned; 3093 tests. **Debrief flag**: two design reviews + flight Reviewer + full suite all missed it — integration seam between flights needs a pin class of its own.
- **Selection path operator-verified**: chooser rendered (screenshot: "Select a certificate", cert row 'Goldfinch Fixture Client / Goldfinch Fixture Throwaway CA', "Continue without a certificate"), selection → `Auth state: client-cert-presented`. Cancel/cert-less path verified thrice incidentally (tab-close ×2 post-fix, cert-less continue) — richer than planned coverage; deliberate-Esc variant deemed covered (isolation harness + unit pins + incidental live).
- **Operator UX finding → inline fix #5 (in flight)**: sheet lacks site attribution + purpose line ("needs clarification to the user") — security-parity gap vs auth-basic's origin display. Fix: host on the payload/model + subtitle copy. Live re-verify at next relaunch.
- Feature path was carrying THREE stacked defects (SIGSEGV cancel, sandbox-starved NSS, gate-rejected render) — explains all shape-shifting symptoms; none reachable by unit tests; all HAT-caught.

### Operator-driven Chrome contrast → follow-up flight candidates (with the vault-on-auth-sheet feature)

Operator compared the same fixture in Chrome. Three findings ruled as FEATURE candidates for the debrief to route: **(1) TLS trust-failure UX** — goldfinch has no `certificate-error` handling: bad-cert sites fail blank (the mission's silent-failure class in an adjacent, deliberately out-of-scope surface); Chrome shows interstitial + informed override + persistent "Not secure" indicators. Highest-value candidate. **(2) Certificate viewer/inspection** — no goldfinch equivalent of Chrome's cert viewer. **(3)** Validation: Chrome with an empty cert store silently continues cert-less exactly as goldfinch did under the sandbox-starved store — Chromium-native behavior, calibrates our diagnosis. Chrome's chooser attribution line also matches fix #5's direction independently.

### Inline fix #5 landed (cert sheet attribution)

Host was already on the payload (port-carrying); renderer relay dropped it. Subtitle line added ("The site <host> is asking you to identify yourself with a certificate."), a11y bare-array path preserved, both ends contract-pinned, renderer.js net-zero (1765/1766). 3094 tests × 3 consecutive runs; one unreproduced single-run transient flagged for debrief tracking.

### Final segment: PDF, OAuth fixture, live-provider witnessed run — ALL CLOSED

- **PDF (lean HAT mode — FD machine reads + operator visual)**: inline render human-verified; zero download on inline; attachment variant downloaded (`doc-attachment.pdf`, completed); guard probes covered by leg-04 premise evidence + unit pins. CLOSED.
- **Inline fixes #6 (cert subtitle padding — root: zero-padding `.vault-picker-inner` card; sibling popup-note line fixed same stroke) and #7 (cert host derivation: Electron passes bare `host:port`; letter-leading hosts parsed as URL *schemes* → silent blank attribution on essentially every real-world mTLS domain; never-blank fallback + six-form pin; discovered via the operator's trailing-dot probe)**: both operator-re-verified live (subtitle present, correct copy incl. port, properly inset). 3095 tests.
- **OAuth fixture (operator-driven, FD census)**: real floating popup window (screenshot), held at approval; census criterion verified LIVE while the popup floated — `enumerateWindows` popup entry {popupWcId, openerWindowId, url} + `enumerateTabs` popup:true row; Approve → self-close observed by the opener handle (`Popup state: closed`) → token delivered (`Result: fixture-oauth-token-…`); census clean post-close (0 residue). CLOSED.
- **LIVE PROVIDER WITNESSED RUN — CLOSED with a deviation stronger than spec**: operator's GitHub path doesn't force a popup (they auth to GitHub via Google), so the operator substituted **claude.ai sign-in via Google OAuth popup — completed end to end in goldfinch, operator-witnessed** ("it worked!"). Google was the provider flagged hardest (bot heuristics, Electron-UA rejection — the very reason the fixture net exists); succeeding there exceeds the "GitHub preferred" wording. Deviation recorded.
- **Vault-login re-run carry-forward**: proposed disposition SUBSUMED by this session's extensive live vault exercise (MCP unlock/list/answerAuth + human sheet flows + operator vault UI usage incl. item-add and key-mint) — mission debrief to ratify.

### Session totals

Seven inline fixes (grabWindow composite veridicality; auth-sheet port display; cert-cancel SIGSEGV; cert-picker model-gate cross-flight regression; cert sheet attribution; subtitle padding; cert host derivation). Four apparatus lessons (key tier; instance identity; capture veridicality ×3 forms; sandboxed-launch NSS amputation). One GitHub issue filed (#143 TLS trust UX + cert viewer). Two feature candidates queued (vault-on-auth-sheet — operator-ruled follow-up flight; #143 pair). One mission Known Issue accepted (stale-bounds after fullscreen-exit × geometry change, self-corrects on resize). Every remaining mission criterion live-verified this session.
