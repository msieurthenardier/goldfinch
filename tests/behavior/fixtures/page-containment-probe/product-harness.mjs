#!/usr/bin/env node
// Product-side harness (flight 01 leg 01, Track A): Q1(b), Q4 and the apparatus smoke,
// driven over the MCP automation surface of a running `npm run dev:automation`.
//
// Launch the app first (dev profile, never the registered goldfinch MCP server):
//   GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation
// then export the key from the printed AUTOMATION_DEV_MINT line and run:
//   GOLDFINCH_MCP_ADMIN_KEY=<adminKey> node tests/behavior/fixtures/page-containment-probe/product-harness.mjs
// Port 8231 must be free: the harness serves ./pages there itself and stops it on exit.
// Every probe prints one `PRODUCT {json}` line. A "boundary does not hold" answer is a result.
import { createRequire } from 'node:module';
import { connectAutomation, callTool } from '../../../../scripts/lib/mcp-client.mjs';

const require = createRequire(import.meta.url);
const { startServer } = require('./server.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (id, o) => console.log('PRODUCT ' + JSON.stringify({ id, ...o }));

const server = await startServer(8231);
const BASE = 'http://127.0.0.1:8231';
let client;
try {
  client = await connectAutomation();
  const call = async (name, args = {}) => {
    try {
      const r = await callTool(client, name, args);
      return r;
    } catch (e) {
      return { value: null, isError: true, thrown: String(e && e.message).slice(0, 200) };
    }
  };
  const brief = (v, n = 300) => {
    if (Array.isArray(v) && v[0] && v[0].type === 'image') return `image/png base64 length ${v[0].data ? v[0].data.length : '?'}`;
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s === undefined ? 'undefined' : s.slice(0, n);
  };
  const tabRow = async (wcId) => {
    const t = await call('enumerateTabs');
    return Array.isArray(t.value) ? t.value.find((r) => r.wcId === wcId) : { error: brief(t.value) };
  };

  // ---------------- apparatus smoke (part 1: discovery) ----------------
  const smoke = {};
  const w = await call('enumerateWindows');
  smoke.enumerateWindows = brief(w.isError ? w : w.value.map((r) => ({ windowId: r.windowId, booted: r.booted, chromeWcId: r.chromeWcId })));
  const t0 = await call('enumerateTabs');
  smoke.enumerateTabs = `${Array.isArray(t0.value) ? t0.value.length : '?'} rows; isError=${t0.isError}`;
  const chrome = await call('getChromeTarget');
  const chromeWcId = chrome.value && chrome.value.wcId;
  smoke.getChromeTarget = brief(chrome.value);

  // ---------------- Q1(b): guest reach in the product ----------------
  const open1 = await call('openTab', { url: BASE + '/q1-hostile.html' });
  const q1Tab = open1.value;
  smoke.openTab = `wcId=${brief(open1.value)} isError=${open1.isError}`;
  await sleep(1500);
  // fixed coordinates of the login form in pages/q1-hostile.html (form at 20,20; 228x34 inputs)
  await call('click', { wcId: q1Tab, x: 134, y: 37 });
  const typed = await call('typeText', { wcId: q1Tab, text: 'probe-user' });
  smoke.typeText = brief(typed.value);
  await call('click', { wcId: q1Tab, x: 134, y: 81 });
  await call('typeText', { wcId: q1Tab, text: 'probe-pass-1' });
  const pk = await call('pressKey', { wcId: q1Tab, name: 'Tab' });
  smoke.pressKey = brief(pk.value);
  const clk = await call('click', { wcId: q1Tab, x: 70, y: 124 });
  smoke.click = brief(clk.value);
  await sleep(2500);
  const row = await tabRow(q1Tab);
  let rep = null;
  try {
    rep = JSON.parse(String(row.title).slice(3));
  } catch {}
  // The product's own main->guest message (the media panel's rescan): the preload-side
  // IPC dispatch path (Electron's emit) only runs when main sends the guest something.
  await call('evaluate', { wcId: chromeWcId, expression: `window.goldfinch.rescanMedia({ wcId: ${q1Tab} }); 1` });
  await sleep(1500);
  const rowAfter = await tabRow(q1Tab);
  let repAfter = null;
  try {
    repAfter = JSON.parse(String(rowAfter.title).slice(3));
  } catch {}
  out('Q1b.afterMainToGuestMessage', { report: repAfter });
  // Reading the DOM happens AFTER the report was captured from the title (readDom runs page-side script).
  const dom = await call('readDom', { wcId: q1Tab });
  smoke.readDom = `title=${dom.value && dom.value.title && String(dom.value.title).slice(0, 20)} html length=${dom.value && dom.value.html && dom.value.html.length}`;
  const html = (dom.value && dom.value.html) || '';
  out('Q1b', {
    tab: row && { wcId: row.wcId, url: row.url, jarId: row.jarId },
    report: rep,
    titleRaw: rep ? undefined : row && String(row.title).slice(0, 200),
    iconNodeInDom: /data-goldfinch-vault-lock/.test(html),
    iconCount: (html.match(/data-goldfinch-vault-lock/g) || []).length
  });

  // Liveness of the icon path in the product: focus the username field of a fresh copy of the
  // page and look for the product's own icon node (the report above was already captured).
  const live = (await call('openTab', { url: BASE + '/login-form.html' })).value;
  await sleep(1500);
  await call('click', { wcId: live, x: 134, y: 37 });
  await sleep(900);
  const liveDom = await call('readDom', { wcId: live });
  out('Q1b.iconLiveness', { iconNodesAfterFocusingUsername: ((liveDom.value && liveDom.value.html) || '').match(/data-goldfinch-vault-lock/g)?.length || 0 });
  await call('closeTab', { wcId: live });

  // ---------------- Q4: userinfo URLs ----------------
  const chromeAddr = async () => {
    const a = await call('evaluate', { wcId: chromeWcId, expression: '({value: document.getElementById("address").value, chip: (document.getElementById("address-chip")||{}).textContent||null, active: document.activeElement && document.activeElement.id})' });
    return a.value;
  };
  const userinfoUrl = 'http://probeuser:probepass@127.0.0.1:8231/userinfo-target.html';
  const tab4 = (await call('openTab', { url: BASE + '/benign.html' })).value;
  await sleep(800);
  server.log.length = 0;
  const navDirect = await call('navigate', { wcId: tab4, url: userinfoUrl });
  await sleep(1500);
  const rowD = await tabRow(tab4);
  out('Q4.direct', { navigate: brief(navDirect.value), isError: navDirect.isError, enumerateTabsUrl: rowD && rowD.url, title: rowD && rowD.title, loadState: rowD && rowD.loadState, addressBar: await chromeAddr(), serverSaw: server.log.slice(-3) });
  smoke.navigate = brief(navDirect.value);
  server.log.length = 0;
  const navRedir = await call('navigate', { wcId: tab4, url: BASE + '/redir' });
  await sleep(1500);
  const rowR = await tabRow(tab4);
  out('Q4.redirect', { navigate: brief(navRedir.value), isError: navRedir.isError, enumerateTabsUrl: rowR && rowR.url, title: rowR && rowR.title, loadState: rowR && rowR.loadState, addressBar: await chromeAddr(), serverSaw: server.log.slice(-4) });
  const openUi = await call('openTab', { url: userinfoUrl });
  await sleep(1500);
  const rowO = await tabRow(openUi.value);
  out('Q4.openTab', { openTab: brief(openUi.value), isError: openUi.isError, enumerateTabsUrl: rowO && rowO.url, title: rowO && rowO.title, addressBar: await chromeAddr() });

  // ---------------- apparatus smoke (part 2) ----------------
  const ev = await call('evaluate', { wcId: tab4, expression: 'document.title + "|" + location.href' });
  smoke.evaluate = brief(ev.value);
  const shot = await call('captureScreenshot', { wcId: tab4 });
  smoke.captureScreenshot = brief(shot.value) + ` isError=${shot.isError}`;
  const win = await call('captureWindow', {});
  smoke.captureWindow = brief(win.value) + ` isError=${win.isError}`;
  out('Smoke', smoke);

  for (const id of [q1Tab, tab4, openUi.value]) if (typeof id === 'number') await call('closeTab', { wcId: id });
} catch (e) {
  out('HARNESS_ERROR', { error: String(e && e.stack).slice(0, 600) });
  process.exitCode = 2;
} finally {
  try {
    await client?.close();
  } catch {}
  await server.close();
}
