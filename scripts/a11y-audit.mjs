// Accessibility audit harness — injects axe-core into the running app's
// renderer over CDP and fails on violations. (Flight 5 / DD3.)
//
// Usage:
//   npm run a11y                       # full rule set (verify-leg sweep)
//   npm run a11y -- --rules=button-name,aria-valid-attr-value
//   npm run a11y -- --tags=wcag2a,wcag2aa
//   npm run a11y -- --url=http://127.0.0.1:8000/   # media fixture to load
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
  const expr = `axe.run(document, ${JSON.stringify(opts)}).then(r => r.violations.map(v => ({
    id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help
  })))`;
  const violations = await evaluate(cdp, expr, { awaitPromise: true });
  return (violations || []).map((v) => ({ ...v, state: stateLabel }));
}

// ---------- drive the UI into each state, audit, aggregate ----------
async function main() {
  const target = await findRendererTarget();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');

  const axeSource = readFileSync(join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');

  // Load the media fixture so the media panel has something to catalog.
  await evaluate(cdp, `navigate(${JSON.stringify(fixtureUrl)})`);
  await sleep(2500); // let the guest load + the media scan populate

  const allViolations = [];

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

  cdp.close();

  // ---------- report ----------
  console.log(
    `\na11y-audit — ${runOnly ? `${runOnly.type}s: ${runOnly.values.join(',')}` : 'full rule set'} (nested-interactive disabled)`
  );
  if (allViolations.length === 0) {
    console.log('No violations across all states. ✅');
    process.exit(0);
  }
  console.log(`\n${allViolations.length} violation(s):`);
  for (const v of allViolations) {
    console.log(`  [${v.state}] ${v.id} — ${v.impact || 'n/a'} — ${v.nodes} node(s) — ${v.help}`);
  }
  process.exit(1);
}

main().catch((e) => fail(e.message));
