// Accessibility audit harness — injects axe-core into the running app's
// renderer over CDP and diffs violations against a curated baseline.
// (Origin: DD3 — CDP `Runtime.evaluate` bypasses the page CSP, which is what
// lets us inject axe into the running renderer at all.)
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
// PREREQUISITE: the GUI must be running with the debug port open
// (`npm run dev:debug`, which exposes CDP at http://127.0.0.1:9222). This gate
// is real-environment / verify-only and is NOT part of headless CI.
//
// Node 22 is assumed (global WebSocket + global fetch) so no runtime deps are
// added beyond the axe-core devDependency. WebSocket is behind a flag on Node 20.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CDP_HTTP = 'http://127.0.0.1:9222';
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
// VERIFY-LEG6: every entry below is SEEDED from the Flight 1–3 debriefs + the
// mission Known Issues, NOT yet reconciled against a real `npm run a11y` run
// (that needs the live GUI the autonomous harness can't launch). Leg 6
// (verify-integration) runs the live gate, confirms/adjusts these selectors to
// match the actual axe targets, reconciles the mission Known-Issue text, and
// drops the VERIFY-LEG6 markers. Stale seeds are harmless: an entry that matches
// nothing simply never suppresses anything (we do not fail on unused entries).
const ACCEPTED = [
  // ~8 moderate structural app-shell findings (Flight 2 debrief): the browser
  // chrome is an app shell, not a document, so it has landmark/heading/region
  // advisories that are accepted exceptions (cf. the committed nested-interactive
  // disable). Region targets confirmed against src/renderer/index.html ids.
  { id: 'region', selector: '#tabs', reason: 'app-shell tab strip sits outside a landmark; accepted chrome exception (VERIFY-LEG6)' },
  { id: 'region', selector: '#brand', reason: 'app-shell brand pill sits outside a landmark; accepted chrome exception (VERIFY-LEG6)' },
  { id: 'region', selector: '#address-wrap', reason: 'app-shell address bar sits outside a landmark; accepted chrome exception (VERIFY-LEG6)' },
  { id: 'landmark-one-main', selector: 'html', reason: 'browser chrome shell has no single <main> landmark; accepted app-shell exception (VERIFY-LEG6)' },
  { id: 'page-has-heading-one', selector: 'html', reason: 'browser chrome shell has no document <h1>; accepted app-shell exception (VERIFY-LEG6)' },
  // 2× serious scrollable-region-focusable (WCAG 2.1.1) — mission Known Issues:
  // a scroll container that isn't keyboard-focusable. Selectors are best-effort
  // (the privacy-panel body + the lightbox scroll stage) pending leg-6 reconcile.
  { id: 'scrollable-region-focusable', selector: '#privacy-body', state: 'privacy-panel', reason: 'privacy-panel scroll body not keyboard-focusable; mission Known Issue (VERIFY-LEG6)' },
  { id: 'scrollable-region-focusable', selector: '#lightbox-stage', state: 'lightbox', reason: 'lightbox scroll stage not keyboard-focusable; mission Known Issue (VERIFY-LEG6)' }
];

// ---------- pick the renderer target ----------
async function findRendererTarget() {
  let list;
  try {
    const res = await fetch(`${CDP_HTTP}/json`);
    list = await res.json();
  } catch (e) {
    fail(
      `cannot reach CDP at ${CDP_HTTP} (${e.message}). ` +
        'Start the app with `npm run dev:debug` first — this gate needs the live GUI.'
    );
  }
  // The renderer chrome is loaded from a local index.html; <webview> guests are
  // http(s) pages. Pick the page target whose url ends with index.html.
  const target = list.find(
    (t) => t.type === 'page' && typeof t.url === 'string' && t.url.split('?')[0].endsWith('index.html')
  );
  if (!target || !target.webSocketDebuggerUrl) {
    fail('no renderer target (url ending in index.html) found at :9222 — is the app running?');
  }
  return target;
}

// ---------- pick a guest target by URL substring (DD7, --target mode) ----------
// Selects a guest page/<webview> whose URL contains `substring` (e.g.
// 'goldfinch://settings') instead of the chrome. Assumes the guest is ALREADY
// loaded — this mode does no fixture navigate and drives none of the chrome's
// state functions (a guest has no togglePanel/togglePrivacy/openLightbox).
//
// LEG-6 CAVEAT (live-confirm): the flat CDP `/json` list may NOT surface Electron
// `<webview>` guests (especially the privileged goldfinch:// internal page) —
// they can be out-of-process targets reachable only via Target.getTargets /
// Target.setAutoAttach over the browser-level endpoint. If a goldfinch:// guest
// doesn't appear in this list, leg 6 must switch to that mechanism; this
// flat-list find is the statically-correct starting point, not a proven one.
async function findGuestTarget(substring) {
  let list;
  try {
    const res = await fetch(`${CDP_HTTP}/json`);
    list = await res.json();
  } catch (e) {
    fail(
      `cannot reach CDP at ${CDP_HTTP} (${e.message}). ` +
        'Start the app with `npm run dev:debug` first — this gate needs the live GUI.'
    );
  }
  const target = list.find(
    (t) =>
      (t.type === 'page' || t.type === 'webview') &&
      typeof t.url === 'string' &&
      t.url.includes(substring)
  );
  if (!target || !target.webSocketDebuggerUrl) {
    fail(
      `no guest target with a url containing "${substring}" found at :9222 — is it loaded? ` +
        '(a <webview> guest may not appear in the flat /json list; leg 6 may need ' +
        'Target.getTargets/setAutoAttach — see the findGuestTarget note.)'
    );
  }
  return target;
}

// ---------- minimal CDP client over WebSocket ----------
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    } catch {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else resolve(msg.result);
    }
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', (e) => reject(new Error(`WebSocket error: ${e.message || e}`)));
  });

  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  return { ready, send, close: () => ws.close() };
}

// Evaluate an expression in the renderer's main world. CDP Runtime.evaluate
// bypasses the page CSP, so injecting axe is permitted. `awaitPromise` resolves
// promises (axe.run returns one); `returnByValue` brings the result back as JSON.
async function evaluate(cdp, expression, { awaitPromise = false } = {}) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    const ex = result.exceptionDetails;
    throw new Error(ex.exception?.description || ex.text || 'Runtime.evaluate exception');
  }
  return result.result?.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- run axe in the current DOM state ----------
async function runAxe(cdp, axeSource, stateLabel) {
  // (Re)inject axe; idempotent — defines window.axe.
  await evaluate(cdp, axeSource);
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
  const violations = await evaluate(cdp, expr, { awaitPromise: true });
  return (violations || []).map((v) => ({ ...v, state: stateLabel }));
}

// ---------- drive the UI into each state, audit, aggregate ----------
async function main() {
  const target = targetArg ? await findGuestTarget(targetArg) : await findRendererTarget();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');

  const axeSource = readFileSync(join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');

  const allViolations = [];

  if (targetArg) {
    // Guest mode (DD7): the target is an already-loaded guest page/<webview>
    // (e.g. goldfinch://settings). It has none of the chrome's state-driving
    // functions, so we skip the 4-state sweep entirely — just inject axe and
    // audit its current DOM once (no fixture navigate, no UI driving).
    allViolations.push(...(await runAxe(cdp, axeSource, `guest:${targetArg}`)));
  } else {
    // Chrome mode: load the media fixture so the media panel has something to
    // catalog, then drive the renderer into each state and audit.
    await evaluate(cdp, `navigate(${JSON.stringify(fixtureUrl)})`);
    await sleep(2500); // let the guest load + the media scan populate

    // The media & privacy panels are mutually exclusive (togglePrivacy(true)
    // closes the media panel) and renderPrivacy() early-returns while collapsed,
    // so each state must be opened and audited separately — NOT by toggling the
    // .collapsed class directly. Drive the renderer's own functions.

    // 1) Base chrome.
    allViolations.push(...(await runAxe(cdp, axeSource, 'base-chrome')));

    // 2) Media panel open (media cards / iconBtn / media-pick controls render).
    await evaluate(cdp, 'togglePanel(true)');
    await sleep(400);
    allViolations.push(...(await runAxe(cdp, axeSource, 'media-panel')));

    // 3) Privacy panel open (pShields() renders the Shields switches).
    await evaluate(cdp, 'togglePrivacy(true)');
    await sleep(400);
    allViolations.push(...(await runAxe(cdp, axeSource, 'privacy-panel')));

    // 4) Lightbox open on a fixture image (dialog + transport controls render).
    await evaluate(cdp, `openLightbox({ url: ${JSON.stringify(fixtureImageUrl)}, name: 'fixture', label: 'fixture' })`);
    await sleep(400);
    allViolations.push(...(await runAxe(cdp, axeSource, 'lightbox')));
  }

  cdp.close();

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
