#!/usr/bin/env node
// Apparatus for the `vault-card-fill-capture` behavior test (issue #152).
//
// Drives the running dev app over the MCP surface and reports what the REAL
// preload detects on the committed `index.html` fixture. It closes the gap the
// unit suite cannot: the card detector's heuristics run against real Chromium
// `autocomplete` reflection and real layout/visibility gating here, not a
// hand-rolled fake document.
//
// USAGE (app already running — this does NOT launch it):
//   GOLDFINCH_MCP_PORT=49707 GOLDFINCH_MCP_ADMIN_KEY=<key> \
//     node tests/behavior/fixtures/vault-card/drive.mjs
//
// Env: GOLDFINCH_MCP_PORT (default 49707), GOLDFINCH_MCP_ADMIN_KEY or
// GOLDFINCH_MCP_KEY, FIXTURE_URL (default http://127.0.0.1:8098/), JAR_ID
// (default 'work' — must be a PERSISTENT jar; see the burner note below).
//
// Exits non-zero if any case fails.
//
// ── THREE APPARATUS CONSTRAINTS, LEARNED THE HARD WAY ────────────────────────
// Re-deriving these costs an hour each; two of them produce CONVINCING FALSE
// RESULTS rather than errors.
//
// 1. `openTab` takes `jarId`, NOT `container`. An unrecognized property is
//    silently ignored, so `container: 'burner'` opens a tab in the DEFAULT jar
//    and every burner-exclusion assertion then "fails" against a persistent-jar
//    tab that legitimately shows icons. There is no burner id to pass either —
//    `openTab` refuses any jarId absent from the registry — so the burner
//    exclusion is NOT reachable from this apparatus at all. Do not try to
//    assert it here; it is a unit/manual concern.
//
// 2. Sheets cannot be dismissed from here. `pressKey` targets a GUEST wcId, and
//    the sheet itself is refused to every drive op by the (menuType × op) gate
//    (no `vault-*` menuType is in AUTOMATABLE_MENU_TYPES). An Escape sent after
//    a sheet opens goes to the page, the sheet stays up, and every LATER case
//    then trivially observes `sheetVisible: true`. Each case therefore runs in
//    its OWN tab and closes it — `tab-close` is a real sheet-close reason — and
//    asserts a clean start. Never share a tab across capture cases.
//
// 3. `.focus()` is legitimate here; a scripted CLICK is not. Only click and
//    contextmenu are isTrusted-gated, so scripted focus exercises exactly the
//    placement path a human focus takes. Clicks must go through the `click`
//    tool (sendInputEvent) to be trusted — case G2 pins that a scripted
//    dispatch is ignored.
//
// 4. ⚠ THE DETECTION + GESTURE SUITES REQUIRE THE APP WINDOW TO HOLD REAL OS
//    FOCUS, and this is the failure mode most likely to produce a FALSE PASS.
//    Blink does not dispatch focus events to an unfocused document: `el.focus()`
//    still sets `document.activeElement`, but NO `focusin` fires, so the icon is
//    never placed. Every NEGATIVE assertion ("no icon on the address form") then
//    passes for the wrong reason, and a run can look 100% green while measuring
//    nothing. `activateTab` does NOT fix it — under WSLg a programmatic
//    `win.focus()` does not take (documented in CLAUDE.md), and neither does a
//    synthetic `click`, because sendInputEvent injects into the renderer without
//    moving OS focus. Both were measured, not assumed.
//    → `assertGuestFocus()` below is therefore a HARD PRECONDITION: it drives a
//      known-good positive control and ABORTS the focus-dependent suites if the
//      icon does not appear. If it aborts, click the Goldfinch window once to
//      give it focus and re-run. The CAPTURE suite is unaffected (it drives real
//      button clicks and reads `sheetVisible`, neither of which needs focus) and
//      still runs.

import { connectAutomation, callTool } from '../../../../scripts/lib/mcp-client.mjs';

const FIXTURE = process.env.FIXTURE_URL || 'http://127.0.0.1:8098/';
const JAR_ID = process.env.JAR_ID || 'work';

const client = await connectAutomation();
const call = async (name, args = {}) => {
  const r = await callTool(client, name, args);
  if (r.isError) throw new Error(`${name}: ${r.value}`);
  try { return JSON.parse(r.value); } catch { return r.value; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sheetOpen = async () => (await call('enumerateWindows')).some((w) => w.sheetVisible);

const results = [];
function record(suite, label, pass, detail) {
  results.push({ suite, label, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n          ${detail}` : ''}`);
}

async function freshTab() {
  const wcId = await call('openTab', { url: FIXTURE, jarId: JAR_ID });
  await sleep(2200);
  return wcId;
}

// ── Suite D: detection sweep ────────────────────────────────────────────────
// Focus every field of every form and read back the injected icon + its
// accessible name. `expect` is the fixture's documented contract per field.

const EXPECTED = {
  'hinted-combined': { cardnumber: 'card', ccname: 'card', ccexp: 'card', cvc: 'card' },
  'hinted-longyear': { cardnumber: 'card', ccexp: 'card' },
  'split-selects': { cardnumber: 'card', month: null, year: null, cvc: 'card' },
  prefixed: { cardnumber: 'card', ccexp: 'card', cvc: 'card' },
  unhinted: { card_number: 'card', expiration_date: 'card', cvv: 'card' },
  'hinted-with-decoy': { cardnumber: 'card', membership_expiry: null },
  'negative-address': {
    phone_number: null, house_number: null, quantity: null, order_number: null, street: null,
  },
  'negative-luhn': { cardnumber: 'card', cvc: 'card' },
  'login-control': { username: 'login', password: 'login' },
};

/**
 * Positive control for constraint 4. Focuses a field that MUST anchor an icon and
 * reports whether it appeared, alongside the `document.hasFocus()` reading that
 * explains a miss. Callers abort the focus-dependent suites on a false.
 */
async function assertGuestFocus(wcId) {
  const probe = await call('evaluate', {
    wcId,
    awaitPromise: true,
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const el = document.querySelector('form[data-fixture="hinted-combined"] [name="cardnumber"]');
      el.focus();
      await sleep(250);
      return {
        hasFocus: document.hasFocus(),
        activeEl: document.activeElement && document.activeElement.name,
        icon: !!document.querySelector('[data-goldfinch-vault-lock]'),
      };
    })()`,
  });
  if (!probe.icon) {
    console.error('\n  ABORT: the positive control did not place an icon.');
    console.error(`         document.hasFocus()=${probe.hasFocus}, activeElement=${probe.activeEl}`);
    console.error('         The app window almost certainly lacks OS focus (constraint 4):');
    console.error('         Blink fires no focusin on an unfocused document, so NOTHING can');
    console.error('         place an icon and every negative case would pass vacuously.');
    console.error('         Click the Goldfinch window once, then re-run.');
    return false;
  }
  return true;
}

async function suiteDetection() {
  console.log('\n=== D. Detection sweep (real Chromium, real preload) ===\n');
  const wcId = await freshTab();
  if (!(await assertGuestFocus(wcId))) {
    await call('closeTab', { wcId });
    return false;
  }

  const rows = await call('evaluate', {
    wcId,
    awaitPromise: true,
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const out = [];
      for (const form of document.querySelectorAll('form')) {
        for (const el of form.querySelectorAll('input, select')) {
          el.focus();
          await sleep(60);
          const icon = document.querySelector('[data-goldfinch-vault-lock]');
          out.push({
            form: form.dataset.fixture,
            field: el.name || '(unnamed)',
            label: icon ? icon.getAttribute('aria-label') : null,
          });
          el.blur();
          await sleep(25);
        }
      }
      return out;
    })()`,
  });

  // An icon's accessible name is the kind carrier (there is deliberately no
  // data-kind attribute — the icon's attribute set is a pinned security guard).
  const kindOf = (label) => (label == null ? null : (label.includes('card') ? 'card' : 'login'));

  let swept = 0;
  for (const [form, fields] of Object.entries(EXPECTED)) {
    for (const [field, want] of Object.entries(fields)) {
      const row = rows.find((r) => r.form === form && r.field === field);
      swept += 1;
      const got = row ? kindOf(row.label) : 'MISSING FIELD';
      record('detection', `${form} / ${field}`, got === want,
        got === want ? '' : `expected ${want === null ? 'no icon' : want} icon, got ${got === null ? 'no icon' : got}`);
    }
  }
  await call('closeTab', { wcId });
  await sleep(500);
  console.log(`  (${swept} fields swept)`);
  return true;
}

// ── Suite C: capture plausibility gate ──────────────────────────────────────
// The offer sheet's CONTENT is unobservable (the whole vault-* menuType family
// is refused to readDom/readAxTree/captureScreenshot), but
// `enumerateWindows().sheetVisible` is an admin read with zero cached state —
// and "did an offer open at all?" is precisely what the gate decides.
//
// With the vault LOCKED, a held capture raises the unlock sheet rather than the
// save sheet; both are sheets, so the signal holds either way. Running unlocked
// exercises the same assertions.

async function submitForm(wcId, fixture, values) {
  await call('evaluate', {
    wcId,
    expression: `(() => {
      const f = document.querySelector('form[data-fixture=${JSON.stringify(fixture)}]');
      for (const [name, val] of Object.entries(${JSON.stringify(values)})) {
        const el = f.querySelector('[name="' + name + '"]');
        if (el) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }
      }
      f.querySelector('button[type=submit]').scrollIntoView({ block: 'center' });
      return true;
    })()`,
  });
  await sleep(250);
  const pos = await call('evaluate', {
    wcId,
    expression: `(() => {
      const b = document.querySelector('form[data-fixture=${JSON.stringify(fixture)}] button[type=submit]');
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`,
  });
  // A REAL trusted click — the capture listener ignores synthetic submits by design.
  await call('click', { wcId, x: pos.x, y: pos.y });
  await sleep(900);
}

const CAPTURE_CASES = [
  ['valid Visa (4242…) → offer', 'hinted-combined',
    { cardnumber: '4242424242424242', ccname: 'A Lovelace', ccexp: '12/28', cvc: '123' }, true],
  ['Luhn-invalid (…4241) → refused', 'negative-luhn',
    { cardnumber: '4242424242424241', cvc: '123' }, false],
  ['too short (12345) → refused', 'negative-luhn',
    { cardnumber: '12345', cvc: '123' }, false],
  ['address/quantity form → refused', 'negative-address',
    { phone_number: '5551234567', house_number: '42', quantity: '2', order_number: '1234567890123456' }, false],
  // Last on purpose: a valid card AFTER the refusals proves they were the gate
  // deciding, not a wedged or one-shot capture path.
  ['valid Mastercard on the unhinted form → offer', 'unhinted',
    { card_number: '5555555555554444', expiration_date: '07/29', cvv: '321' }, true],
];

async function suiteCapture() {
  console.log('\n=== C. Capture plausibility gate ===\n');
  for (const [label, fixture, values, expect] of CAPTURE_CASES) {
    const wcId = await freshTab();
    const clean = !(await sheetOpen());
    await submitForm(wcId, fixture, values);
    const opened = await sheetOpen();
    await call('closeTab', { wcId });
    await sleep(700);
    record('capture', label, clean && opened === expect,
      clean ? (opened === expect ? '' : `expected sheet=${expect}, got ${opened}`)
        : 'DIRTY START — a prior sheet was still open; result is meaningless');
  }
}

// ── Suite G: gesture round-trip + the isTrusted guard ───────────────────────

async function suiteGesture() {
  console.log('\n=== G. Card gesture round-trip + isTrusted guard ===\n');

  // G1: a REAL click on a CARD icon reaches main → chrome → sheet.
  {
    const wcId = await freshTab();
    if (!(await assertGuestFocus(wcId))) {
      await call('closeTab', { wcId });
      return false;
    }
    const clean = !(await sheetOpen());
    const icon = await call('evaluate', {
      wcId,
      awaitPromise: true,
      expression: `(async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const el = document.querySelector('form[data-fixture="hinted-combined"] [name="cardnumber"]');
        el.scrollIntoView({ block: 'center' });
        await sleep(120);
        el.focus();
        await sleep(200);
        const i = document.querySelector('[data-goldfinch-vault-lock]');
        if (!i) return { found: false };
        const r = i.getBoundingClientRect();
        return { found: true, label: i.getAttribute('aria-label'),
                 x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`,
    });
    if (!icon.found) {
      record('gesture', 'trusted click on a card icon opens a sheet', false, 'no icon to click');
    } else {
      await call('click', { wcId, x: icon.x, y: icon.y });
      await sleep(1200);
      const opened = await sheetOpen();
      record('gesture', 'trusted click on a card icon opens a sheet', clean && opened,
        `icon label=${JSON.stringify(icon.label)}, sheet=${opened}`);
    }
    await call('closeTab', { wcId });
    await sleep(700);
  }

  // G2: a SCRIPTED dispatch must be ignored — a hostile page cannot raise the prompt.
  {
    const wcId = await freshTab();
    if (!(await assertGuestFocus(wcId))) {
      await call('closeTab', { wcId });
      return false;
    }
    const clean = !(await sheetOpen());
    await call('evaluate', {
      wcId,
      awaitPromise: true,
      expression: `(async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const el = document.querySelector('form[data-fixture="hinted-combined"] [name="cardnumber"]');
        el.focus();
        await sleep(200);
        const i = document.querySelector('[data-goldfinch-vault-lock]');
        if (!i) return { dispatched: false };
        // NOTE: SVGElement has no .click() here — dispatch directly. Either way
        // the event carries isTrusted=false, which is what the guard reads.
        i.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        i.dispatchEvent(new PointerEvent('click', { bubbles: true }));
        return { dispatched: true };
      })()`,
    });
    await sleep(1000);
    const opened = await sheetOpen();
    // NOTE: guarded by the same positive control — without it, "no sheet" here
    // would pass even when no icon existed to dispatch on.
    record('gesture', 'scripted click on a card icon is ignored', clean && !opened,
      `sheet=${opened}`);
    await call('closeTab', { wcId });
    await sleep(500);
  }
  return true;
}

// ── run ─────────────────────────────────────────────────────────────────────

console.log(`vault-card apparatus — fixture=${FIXTURE} jar=${JAR_ID}`);
const startClean = !(await sheetOpen());
if (!startClean) {
  console.error('\nABORT: a sheet is already open. Dismiss it in the app first — this apparatus');
  console.error('cannot close sheets (see constraint 2 in the header).');
  await client.close();
  process.exit(2);
}

const detectionRan = await suiteDetection();
await suiteCapture();          // focus-independent — always runs
const gestureRan = detectionRan ? await suiteGesture() : false;
if (!detectionRan || !gestureRan) {
  console.log('\n  ⚠ focus-dependent suites were SKIPPED — see the ABORT above.');
}

const failed = results.filter((r) => !r.pass);
const skipped = !detectionRan || !gestureRan;
console.log('\n=== SUMMARY ===');
for (const suite of ['detection', 'capture', 'gesture']) {
  const s = results.filter((r) => r.suite === suite);
  console.log(`  ${suite.padEnd(10)} ${s.filter((r) => r.pass).length}/${s.length}`);
}
console.log(`  ${'TOTAL'.padEnd(10)} ${results.length - failed.length}/${results.length}`);
for (const f of failed) console.log(`    FAILED: [${f.suite}] ${f.label}`);

console.log('\nNOT covered by this apparatus (see the header + the spec):');
console.log('  - an actual card FILL (needs a vault unlock, which is human-only by design)');
console.log('  - picker / offer sheet CONTENT (the vault-* menuTypes are unobservable)');
console.log('  - burner + internal tab exclusion (openTab cannot address either)');

await client.close();
process.exit(failed.length || skipped ? 1 : 0);
