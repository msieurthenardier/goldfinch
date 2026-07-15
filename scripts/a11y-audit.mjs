// Accessibility audit harness — injects axe-core into the running app over the
// loopback MCP automation surface and diffs violations against a curated baseline.
// (Origin: DD3 — the MCP `injectScript`/`evaluate` tools run in the guest MAIN
// WORLD via `webContents.executeJavaScript`, which is CSP-immune for direct eval,
// so we can inject axe into the running renderer without `<script>`-tag CSP.)
//
// Baseline-diff gate (DD7): rather than failing on ANY violation, the harness
// diffs each violation's per-node target selectors against a small, hand-curated
// committed ACCEPTED allowlist ({ id, selector, reason }, optional state). A
// violation node is "accepted" only when some ACCEPTED entry matches its rule id
// AND its node selector (state as an optional tiebreak); any unmatched
// (id, node-selector) pair is a NEW finding and fails the gate. The allowlist is
// curated and REVIEWED IN THE PR — it is never auto-dumped from raw axe output
// (a `--update` golden-dump would churn and get rubber-stamped, so there isn't
// one). Matching is per node, so an accepted selector never suppresses a
// different, unaccepted node of the same rule id.
//
// Usage:
//   npm run a11y                       # full rule set (verify-leg sweep)
//   npm run a11y -- --rules=button-name,aria-valid-attr-value
//   npm run a11y -- --tags=wcag2a,wcag2aa
//   npm run a11y -- --url=http://127.0.0.1:8000/   # media fixture to load
//   npm run a11y -- --target=goldfinch://settings  # audit a guest <webview>
//                                                  # target by URL substring
//                                                  # instead of the chrome
//
// `nested-interactive` is ALWAYS disabled: the tab strip's role="tab" wrapping
// a focusable close <button> is an accepted, documented APG pattern (see
// missions/.../legs/01-tab-strip-a11y.md "Cross-Leg Note"). With no --rules /
// --tags filter the harness runs axe's full default rule set (minus that one),
// which is what the verify-a11y leg gates on.
//
// PREREQUISITES — the ATTACH + env-key model (the app is launched out-of-band;
// this script attaches to its loopback MCP server). This gate is
// real-environment / verify-only and is NOT part of headless CI.
//   1. Launch the app with the automation surface bound + a dev key minted:
//        GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation
//      It prints ONE line:  AUTOMATION_DEV_MINT {"key":"<jarKey>","adminKey":"<adminKey>"}
//   2. Export the key the audit needs:
//        export GOLDFINCH_MCP_ADMIN_KEY=<adminKey>   # default chrome 6-state sweep (admin)
//        export GOLDFINCH_MCP_KEY=<jarKey>           # --target guest mode (jar)
//   3. Serve the media fixture (tests/behavior/fixtures/a11y-media/) on :8000:
//        python3 -m http.server 8000 --directory tests/behavior/fixtures/a11y-media
//   4. npm run a11y
//   (Endpoint override: GOLDFINCH_MCP_URL / GOLDFINCH_MCP_PORT, default :49707 —
//   same contract as scripts/mcp-example-client.mjs.)
//
// The default sweep (5 chrome states + 5 menu-overlay SHEET states) needs the
// ADMIN key (getChromeTarget is admin-only, and the sheet's wcId resolves only
// under the admin relaxation — it is deliberately not in tabViews, DD8);
// `--target` guest mode uses a jar key (or admin). NOTE: `goldfinch://settings`
// is the INTERNAL session and the eval tool refuses it even for admin, so it
// CANNOT be audited via `evaluate` (the old CDP path could) — see the
// findGuestTarget note. The default chrome sweep — what this gate gates on —
// never depended on a settings-guest run.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { connectAutomation, callTool } from './lib/mcp-client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE_URL = 'http://127.0.0.1:8000/';

// ---------- argv ----------
function argValue(flag) {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : null;
}
const rulesArg = argValue('--rules');
const tagsArg = argValue('--tags');
const fixtureUrl = argValue('--url') || DEFAULT_FIXTURE_URL;
// A reasonable image path inside the fixture, used to force the lightbox open.
const fixtureImageUrl = new URL('bird.png', fixtureUrl).href;
// --target=<url-substring>: audit an already-loaded guest page/<webview> target
// (e.g. goldfinch://settings) instead of the chrome index.html renderer (DD7).
const targetArg = argValue('--target');

// axe `runOnly` selector: rules take precedence over tags; omit for the full set.
let runOnly = null;
if (rulesArg) {
  runOnly = {
    type: 'rule',
    values: rulesArg
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  };
} else if (tagsArg) {
  runOnly = {
    type: 'tag',
    values: tagsArg
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  };
}

function fail(msg) {
  console.error(`a11y-audit: ${msg}`);
  process.exit(1);
}

// ---------- curated a11y baseline (DD7) ----------
// Hand-curated allowlist of accepted, pre-existing violations. A violation node
// is suppressed ONLY when an entry matches the rule `id` AND the node `selector`
// (with `state` as an optional tiebreak — when set, the entry only matches that
// UI state). Curated + reviewed in the PR — never auto-dumped.
//
// Reconciled against the live `npm run a11y` run on 2026-06-07 (Flight 4, leg
// verify-integration). The 5 structural app-shell entries were CONFIRMED present
// in the live run (16 matching nodes across base-chrome/media-panel/privacy-panel/
// lightbox). The 2 scrollable-region-focusable entries did NOT fire in the gate's
// states — they only trigger when the scroll region actually overflows, which the
// gate's empty privacy/lightbox states don't; they are kept PRE-ACCEPTED (mission
// Known Issue stands) so they don't surface as NEW if a future overflow state is
// audited. Curated + reviewed in the PR — never auto-dumped. Unused entries are
// harmless (an entry that matches nothing never suppresses anything).
const ACCEPTED = [
  // ~8 moderate structural app-shell findings: the browser chrome is an app shell,
  // not a document, so it has landmark/heading/region advisories that are accepted
  // exceptions (cf. the committed nested-interactive disable). Confirmed live
  // 2026-06-07; targets verified against src/renderer/index.html ids.
  { id: 'region', selector: '#tabs', reason: 'app-shell tab strip sits outside a landmark; accepted chrome exception' },
  { id: 'region', selector: '#brand', reason: 'app-shell brand pill sits outside a landmark; accepted chrome exception' },
  { id: 'region', selector: '#address-wrap', reason: 'app-shell address bar sits outside a landmark; accepted chrome exception' },
  // NOTE (M05 F8 cutover): the old chrome `#page-context-menu` region entry was
  // retired with the chrome-DOM menus — the page-context state now audits the
  // menu-overlay SHEET document. The three state-scoped `#sheet-menu` entries
  // below are its successors, confirmed live 2026-07-02 (Leg 5 CP4 run): the
  // sheet's `menu`-template states fire the same region advisory the chrome
  // menu did — a transient role="menu" popup overlay is not document content
  // requiring a landmark (the same accepted-chrome-exception class as
  // #tabs/#brand). The `info-popup` (site-info) and `input-dialog`
  // (new-container) templates raise NO findings (role="dialog" content is
  // outside the region rule's scope) — no entries needed for them.
  { id: 'region', selector: '#sheet-menu', state: 'sheet:kebab', reason: 'transient role="menu" sheet overlay (kebab); floating menu needs no landmark — chrome #page-context-menu precedent. Menuitem roles/names/keyboard nav raise no violations.' },
  { id: 'region', selector: '#sheet-menu', state: 'sheet:container', reason: 'transient role="menu" sheet overlay (container picker); floating menu needs no landmark — chrome #page-context-menu precedent.' },
  { id: 'region', selector: '#sheet-menu', state: 'sheet:page-context', reason: 'transient role="menu" sheet overlay (page context); floating menu needs no landmark — direct successor of the retired chrome #page-context-menu entry.' },
  { id: 'region', selector: '#sheet-menu', state: 'sheet:tab-context', reason: 'transient role="menu" sheet overlay (tab context menu, M09 Flight 5 Leg 1); same accepted-chrome-exception class as the other menu-template sheet states.' },
  // The two `html` entries below are deliberately STATE-UNSCOPED: they match the
  // chrome document in every chrome state AND the sheet document in the sheet
  // states (the sheet is a transient popup layer, not a document with main/h1).
  { id: 'landmark-one-main', selector: 'html', reason: 'browser chrome shell has no single <main> landmark; accepted app-shell exception' },
  { id: 'page-has-heading-one', selector: 'html', reason: 'browser chrome shell has no document <h1>; accepted app-shell exception' },
  // 2× serious scrollable-region-focusable (WCAG 2.1.1) — mission Known Issue: a
  // scroll container that isn't keyboard-focusable. Not reproduced by the gate's
  // current (no-overflow) privacy-panel/lightbox states as of 2026-06-07; kept
  // pre-accepted so a future overflow-state audit doesn't flag them as NEW.
  { id: 'scrollable-region-focusable', selector: '#privacy-body', state: 'privacy-panel', reason: 'privacy-panel scroll body not keyboard-focusable; mission Known Issue (not gate-reproduced w/o overflow content)' },
  { id: 'scrollable-region-focusable', selector: '#lightbox-stage', state: 'lightbox', reason: 'lightbox scroll stage not keyboard-focusable; mission Known Issue (not gate-reproduced w/o overflow content)' }
];

// ---------- pick the renderer target (chrome mode, admin) ----------
// The chrome+sheet sweep drives the app shell, which is reachable only via the
// admin-only getChromeTarget tool — it returns { wcId, kind: 'chrome', url }.
async function getChromeWcId(client) {
  const { value, isError } = await callTool(client, 'getChromeTarget', {});
  if (isError || !value || typeof value.wcId !== 'number') {
    fail(
      'getChromeTarget did not return a chrome wcId' +
        (isError ? ` (isError: ${JSON.stringify(value)})` : '') +
        ' — getChromeTarget is ADMIN ONLY, so set GOLDFINCH_MCP_ADMIN_KEY (and launch with ' +
        'GOLDFINCH_AUTOMATION_ADMIN=1) for the chrome sweep.'
    );
  }
  return value.wcId;
}

// ---------- pick a guest target by URL substring (DD7, --target mode) ----------
// Selects a guest tab whose URL contains `substring` (e.g. a fixture host)
// instead of the chrome. Assumes the guest is ALREADY loaded — this mode does no
// fixture navigate and drives none of the chrome's state functions (a guest has
// no togglePanel/togglePrivacy/openLightbox).
//
// CAVEAT (internal-session exclusion): the eval tool ALWAYS excludes the internal
// `goldfinch://settings` session (even for admin), so `--target=goldfinch://settings`
// cannot be audited via `evaluate` — the old CDP path could. enumerateTabs also
// omits the internal tab for jar keys; a settings-guest a11y audit via the eval
// tool is out of reach by design. The default chrome sweep never depended on it.
async function getGuestWcId(client, substring) {
  const { value: tabs, isError } = await callTool(client, 'enumerateTabs', {});
  if (isError || !Array.isArray(tabs)) {
    fail(`enumerateTabs failed${isError ? ` (isError: ${JSON.stringify(tabs)})` : ''}.`);
  }
  const tab = tabs.find((t) => t && typeof t.url === 'string' && t.url.includes(substring));
  if (!tab || typeof tab.wcId !== 'number') {
    fail(
      `no guest tab with a url containing "${substring}" found via enumerateTabs — is it loaded? ` +
        '(the internal goldfinch://settings session is excluded from the eval tool even for admin; ' +
        'see the getGuestWcId note.)'
    );
  }
  return tab.wcId;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- discover the menu-overlay sheet's wcId (M05 F8 DD6/DD8; M09 F7 DD2) ----------
// The sheet is a per-window lazy-singleton chrome-class WebContentsView created on
// the FIRST menu open in its window. It is deliberately absent from enumerateTabs
// (never in tabViews — DD8). Called ONCE per run, after the first sheet state opens;
// the wcId is stable across states unless the sheet crashes (self-teardown +
// recreate would mint a new one).
//
// M09 F7 DD2: the sheet's wcId now comes from `enumerateWindows` — an EXACT, O(1)
// read. This RETIRES the id-space probe walk (build a skip set from enumerateTabs +
// the chrome's own id, then evaluate location.href against every id in 1..64 looking
// for menu-overlay.html). Why the walk existed at all, and why it can go:
//   - No op could ENUMERATE non-tab contents. The admin relaxation made overlay views
//     ADDRESSABLE, never LISTABLE — so the only way to find the sheet was to guess an
//     id and ask. enumerateWindows is the op that LISTS them.
//   - The walk's enumerateTabs-failure branch fell back to an UNFILTERED walk, and
//     the skip set it built was window-scoped in a multi-window app.
//   - Its foreground-first hazard (probing a background TAB would activate it,
//     switching tabs and closing the just-opened menu) is separately gone since F7
//     DD6 removed the activate from `evaluate` — an optimization now, not a safety
//     requirement. The O(64)-guess-vs-O(1)-exact argument is what retires it.
//
// NO FALLBACK — if enumerateWindows fails, `npm run a11y` fails LOUDLY. That is the
// point: a silent fallback to the walk would let DD2 be broken while this checkpoint
// stayed green.
async function findSheetWcId(client) {
  const { value: wins, isError } = await callTool(client, 'enumerateWindows', {});
  if (!isError && Array.isArray(wins)) {
    // Prefer the window actually SHOWING a sheet; else any window that has ever
    // instantiated one (sheetWcId present but hidden). An ABSENT sheetWcId means the
    // sheet was never created in that window (lazy — DD5), which is not a candidate.
    const row = wins.find((w) => w.sheetVisible && w.sheetWcId != null)
      || wins.find((w) => w.sheetWcId != null);
    if (row) return row.sheetWcId;
  }
  fail(
    'menu-overlay sheet wcId not found via enumerateWindows — the sheet is a per-window ' +
      'lazy singleton, so a menu state must have OPENED before discovery (and the audit ' +
      'needs the ADMIN key: enumerateWindows is admin-only).'
  );
}

// Sheet-side dismissal (design constraint): a chrome-side menuOverlayClose would
// leave the sheet DOM rendered (the deliberate persist-after-main-close design),
// breaking the DOM-closed check between states — so dismissal is a synthesized
// Escape keydown on the OPEN template node, evaluated IN THE SHEET document.
// That drives the sheet's own dismissal path (capture-phase 'escape' attribution
// → controller close → dismissed{escape} → main close → chrome refocus).
const SHEET_DISMISS_EXPR = `(() => {
  const open = ['sheet-menu', 'sheet-popup', 'sheet-dialog']
    .map((id) => document.getElementById(id))
    .find((el) => el && !el.classList.contains('hidden'));
  if (!open) return 'none-open';
  open.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return 'escaped';
})()`;
const SHEET_CLOSED_EXPR = `['sheet-menu', 'sheet-popup', 'sheet-dialog']
  .every((id) => { const el = document.getElementById(id); return !el || el.classList.contains('hidden'); })`;

// Evaluate an expression in the target tab's main world via the eval tool. The
// MCP `evaluate` tool runs `webContents.executeJavaScript` (no CDP), natively
// awaits a returned Promise, and brings the JSON-serializable result back as JSON
// text (unwrapped here). An in-page throw surfaces as isError.
async function evaluate(client, wcId, expression) {
  const { value, isError } = await callTool(client, 'evaluate', { wcId, expression });
  if (isError) {
    throw new Error(`evaluate failed: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }
  return value;
}

// ---------- run axe in the current DOM state ----------
async function runAxe(client, wcId, axeSource, stateLabel) {
  // (Re)inject axe per state — injectScript makes NO persistence guarantee
  // (mcp-tools.js), so the inject-then-run pair (DD2) must be re-done each state
  // exactly as the old CDP path re-evaluated axeSource every state. Pair the
  // inject IMMEDIATELY with the run; do not assume window.axe survives a gap.
  const { isError: injectErr, value: injectVal } = await callTool(client, 'injectScript', {
    wcId,
    script: axeSource
  });
  if (injectErr) {
    throw new Error(
      `injectScript(axe) failed for state "${stateLabel}": ${
        typeof injectVal === 'string' ? injectVal : JSON.stringify(injectVal)
      }`
    );
  }
  const opts = { rules: { 'nested-interactive': { enabled: false } } };
  if (runOnly) opts.runOnly = runOnly;
  // Capture each node's target SELECTORS (not just a count) so allowlist matching
  // is by id + selector, per node. axe `target` is a CrossTreeSelector[] and
  // shadow-DOM entries are themselves arrays (arrays-of-arrays), so flatten
  // before join or a shadow target collapses into a malformed "#a #b,#c".
  const expr = `axe.run(document, ${JSON.stringify(opts)}).then(r => r.violations.map(v => ({
    id: v.id, impact: v.impact, help: v.help,
    count: v.nodes.length,
    nodes: v.nodes.map(n => n.target.flat(Infinity).join(' '))
  })))`;
  const violations = await evaluate(client, wcId, expr);
  return (violations || []).map((v) => ({ ...v, state: stateLabel }));
}

// ---------- drive the UI into each state, audit, aggregate ----------
async function main() {
  let client;
  try {
    client = await connectAutomation();
  } catch (e) {
    fail(
      `${e.message} — is the app running with the automation surface? Launch ` +
        '`GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` and ' +
        'export the printed key (this gate needs the live GUI).'
    );
  }

  const axeSource = readFileSync(join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');

  const allViolations = [];

  try {
    if (targetArg) {
      // Guest mode (DD7): the target is an already-loaded guest tab (e.g. a
      // fixture page). It has none of the chrome's state-driving functions, so we
      // skip the multi-state chrome sweep entirely — just inject axe and audit its current
      // DOM once (no fixture navigate, no UI driving).
      const wcId = await getGuestWcId(client, targetArg);
      allViolations.push(...(await runAxe(client, wcId, axeSource, `guest:${targetArg}`)));
    } else {
      // Chrome mode: acquire the chrome renderer's wcId (admin-only), load the
      // media fixture so the media panel has something to catalog, then drive the
      // renderer into each state and audit. Navigation MUST go through the chrome
      // renderer's own `navigate()` global (which opens a guest tab from the
      // chrome shell) and then audit the CHROME wcId — NOT the `navigate` MCP
      // drive tool, which navigates a guest tab by wcId (different semantics).
      const wcId = await getChromeWcId(client);

      await evaluate(client, wcId, `navigate(${JSON.stringify(fixtureUrl)})`);
      await sleep(2500); // let the guest load + the media scan populate

      // The media & privacy panels are mutually exclusive (togglePrivacy(true)
      // closes the media panel) and renderPrivacy() early-returns while collapsed,
      // so each state must be opened and audited separately — NOT by toggling the
      // .collapsed class directly. Drive the renderer's own functions through the
      // explicit evaluate-reachable seam (the `Object.assign(globalThis, {...})`
      // block at the bottom of src/renderer/renderer.js — a module's top-level
      // fns are NOT page globals; the seam publishes the closed set this script
      // calls, reachable in the main world by executeJavaScript).

      // 1) Base chrome.
      allViolations.push(...(await runAxe(client, wcId, axeSource, 'base-chrome')));

      // 2) Media panel open (media cards / iconBtn / media-pick controls render).
      await evaluate(client, wcId, 'togglePanel(true)');
      await sleep(400);
      allViolations.push(...(await runAxe(client, wcId, axeSource, 'media-panel')));

      // 3) Privacy panel open (pShields() renders the Shields switches).
      await evaluate(client, wcId, 'togglePrivacy(true)');
      await sleep(400);
      allViolations.push(...(await runAxe(client, wcId, axeSource, 'privacy-panel')));

      // 4) Lightbox open on a fixture image (dialog + transport controls render).
      await evaluate(client, wcId, `openLightbox({ url: ${JSON.stringify(fixtureImageUrl)}, name: 'fixture', label: 'fixture' })`);
      await sleep(400);
      allViolations.push(...(await runAxe(client, wcId, axeSource, 'lightbox')));

      // NOTE (M05 F7 cutover): the former find-bar state was REMOVED. The find UI now
      // lives in a main-owned overlay WebContentsView (find-overlay.html), which is not
      // MCP-addressable by construction (never in tabViews; getChromeTarget returns only
      // the chrome), so axe cannot be injected into it through this apparatus. Overlay
      // a11y conformance rests on the DD12 verbatim attribute carry-over from the audited
      // chrome bar (role="search", aria-live/aria-atomic count, button labels) + the HAT
      // keyboard/focus pass. The chrome sweep stays green and meaningful on the chrome.

      // 5) DevTools button visible (pin it; default is unpinned so the toolbar button is .hidden).
      // Audits the button's static a11y — accessible name + valid aria-pressed (NOT aria-expanded).
      // The lightbox state (state 4) leaves the lightbox OPEN; close it so unrelated nodes
      // don't pollute this state. applyToolbarPins is a top-level renderer fn
      // (window global, like togglePanel/closeLightbox) and toggles .hidden on
      // els.toggleDevtools per pins.devtools (Leg 2), so pinning un-hides the button for axe.
      // We do NOT open DevTools (no detached window in the gate) — the unpressed static a11y is
      // the target. This state mutates live toolbar visibility and does not restore the
      // default pin map afterward — harmless, since the client closes immediately below.
      await evaluate(client, wcId, 'closeLightbox()');
      await sleep(200);
      await evaluate(client, wcId, "applyToolbarPins({ media: true, shields: true, devtools: true })");
      await sleep(400);
      allViolations.push(...(await runAxe(client, wcId, axeSource, 'devtools-button')));

      // 6-10) Menu-overlay SHEET states (M05 F8 cutover, DD6). Every popup menu
      // renders in the transparent sheet WebContentsView, so each state opens
      // from the CHROME (evaluate on the chrome's own top-level open paths —
      // the same bodies the trigger click/keydown handlers run) and audits the
      // SHEET's wcId. The old chrome `page-context-menu` state re-targets the
      // sheet here; chrome base states above are unchanged. `new-container` has
      // no chrome-side trigger element — `openNewContainerOverlay()` is the
      // module-scope open path (the same body the container menu's
      // 'action:new-container' activation runs; sanctioned at leg design).
      // Between states, dismissal is SHEET-SIDE (see SHEET_DISMISS_EXPR) and the
      // DOM-closed check runs before the next open.
      const SHEET_STATES = [
        { label: 'sheet:kebab', open: 'openKebabOverlay(0)' },
        { label: 'sheet:container', open: 'openContainerOverlay(0)' },
        { label: 'sheet:site-info', open: 'openSiteInfoOverlay()' },
        { label: 'sheet:new-container', open: 'openNewContainerOverlay()' },
        // The audit hook builds a representative full-section synthetic params
        // payload (link + selection + editable + spelling-suggestions + Inspect).
        { label: 'sheet:page-context', open: 'openPageContextMenuForAudit()' },
        // M09 Flight 5 Leg 1: the tab context menu. The audit hook builds a
        // representative synthetic model (items-to-right + non-empty stack) so
        // all five items render, mirroring the page-context hook's synthetic params.
        { label: 'sheet:tab-context', open: 'openTabContextMenuForAudit()' }
      ];
      let sheetWcId = null;
      for (const state of SHEET_STATES) {
        await evaluate(client, wcId, state.open);
        await sleep(400);
        if (sheetWcId == null) sheetWcId = await findSheetWcId(client); // once — stable across states
        allViolations.push(...(await runAxe(client, sheetWcId, axeSource, state.label)));
        const dismissed = await evaluate(client, sheetWcId, SHEET_DISMISS_EXPR);
        if (dismissed !== 'escaped') {
          throw new Error(`sheet state "${state.label}": no open template node to dismiss (got ${dismissed})`);
        }
        await sleep(300);
        const closed = await evaluate(client, sheetWcId, SHEET_CLOSED_EXPR);
        if (!closed) {
          throw new Error(`sheet state "${state.label}" did not close after the sheet-side Escape`);
        }
      }
    }
  } finally {
    await client.close();
  }

  // ---------- partition: accepted (baseline) vs NEW, PER NODE (DD7) ----------
  // Explode every violation into per-node (id, selector, state) pairs and match
  // each pair independently against ACCEPTED. A pair is accepted iff some entry
  // shares the same id AND selector (and, when the entry sets `state`, the same
  // state). Per-node matching means an accepted selector NEVER suppresses a
  // different, unaccepted node of the same rule id.
  const accepted = [];
  const newPairs = [];
  for (const v of allViolations) {
    for (const selector of v.nodes) {
      const pair = { id: v.id, selector, state: v.state, impact: v.impact, help: v.help };
      const isAccepted = ACCEPTED.some(
        (e) =>
          e.id === v.id &&
          e.selector === selector &&
          (e.state === undefined || e.state === v.state)
      );
      (isAccepted ? accepted : newPairs).push(pair);
    }
  }

  // ---------- report ----------
  console.log(
    `\na11y-audit — ${runOnly ? `${runOnly.type}s: ${runOnly.values.join(',')}` : 'full rule set'} (nested-interactive disabled)` +
      (targetArg ? ` — guest target containing "${targetArg}"` : '')
  );

  if (accepted.length > 0) {
    console.log(`\n${accepted.length} accepted (baseline) violation node(s) — informational:`);
    for (const p of accepted) {
      console.log(`  [${p.state}] ${p.id} — ${p.impact || 'n/a'} — ${p.selector}`);
    }
  }

  if (newPairs.length === 0) {
    console.log('\nNo NEW violations — every violation node is in the ACCEPTED baseline. ✅');
    process.exit(0);
  }

  console.log(`\n${newPairs.length} NEW violation node(s) — not in the ACCEPTED baseline:`);
  for (const p of newPairs) {
    console.log(`  [${p.state}] ${p.id} — ${p.impact || 'n/a'} — ${p.selector} — ${p.help}`);
  }
  process.exit(1);
}

main().catch((e) => fail(e.message));
