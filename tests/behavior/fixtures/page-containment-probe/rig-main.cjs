'use strict';
// Page-containment probe rig (flight 01, leg 01, Track A). Standalone Electron main.
// Every probe is a yes/no measurement of one of OUR OWN isolation boundaries; it
// prints one `PROBE {json}` line and moves on. Nothing observed is ever used.
// Exit code is non-zero only for a rig failure, never for a "boundary does not hold".
// Run: node tests/behavior/fixtures/page-containment-probe/run-rig.mjs [--phases=q1,q2,q3]
const { app, BaseWindow, WebContentsView, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { startServer } = require('./server.cjs');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const BUNDLE = path.join(REPO, 'src', 'preload', 'webview-preload.bundle.js');
const RIG_PRELOAD = path.join(__dirname, 'rig-preload.cjs');
const VAULT_WORLD = 745821; // VAULT_ENTRY_OBSERVER_WORLD_ID (src/preload/webview-preload.js)
const RIG_WORLD = 745000; // the rig's own reads, kept off the vault world

const phasesArg = process.argv.find((a) => a.startsWith('--phases='));
const PHASES = (phasesArg ? phasesArg.slice(9) : 'q1,q2,q3').split(',');

// Rig-only: software rendering (the GPU process dies on repeated view churn under WSLg).
app.disableHardwareAcceleration();
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'gf-probe-')));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let rigFailed = false;
function probe(id, obj) {
  console.log('PROBE ' + JSON.stringify({ id, ...obj }));
}

// ---- rig-side stubs for the product preload's two synchronous channels (live values) ----
const state = { farble: true, eligibleAnswered: 0, farbleAnswered: [] };
const ipcLog = [];
ipcMain.on('vault-eligible', (e) => {
  state.eligibleAnswered++;
  e.returnValue = { eligible: true, unlocked: false };
});
ipcMain.on('shields-farble', (e) => {
  state.farbleAnswered.push(state.farble);
  e.returnValue = { farble: state.farble, seed: 123456789 };
});
for (const ch of [
  'guest-vault-gesture', 'guest-vault-icon-menu', 'guest-vault-capture', 'guest-vault-capture-card',
  'guest-vault-capture-identity', 'guest-vault-gesture-settle', 'guest-media-list', 'guest-privacy-fp',
  'guest-tab-boundary', 'guest-window-close', 'guest-bookmark-drop'
]) {
  ipcMain.on(ch, (e, payload) => {
    ipcLog.push({ ch, keys: payload && typeof payload === 'object' ? Object.keys(payload) : typeof payload });
  });
}

let win = null;
let view = null;
let partitionN = 0;
// Mirrors the product web-guest branch of src/main/register-tab-ipc.js (webPreferencesObj).
function newGuest(preload) {
  if (view) {
    try {
      win.contentView.removeChildView(view);
      view.webContents.close();
    } catch {}
  }
  view = new WebContentsView({
    webPreferences: {
      preload,
      contextIsolation: false,
      sandbox: true,
      nodeIntegration: false,
      partition: 'probe-' + ++partitionN,
      plugins: true,
      autoplayPolicy: 'document-user-activation-required'
    }
  });
  win.contentView.addChildView(view);
  view.webContents.on('console-message', (_e, level, message, line, src) => {
    if (level >= 2) probe('console', { level, message: String(message).slice(0, 200), line, src: String(src).slice(-40) });
  });
  view.setBounds({ x: 0, y: 0, width: 1000, height: 700 });
  return view.webContents;
}

const iso = (wc, code, world = RIG_WORLD) => wc.executeJavaScriptInIsolatedWorld(world, [{ code }]);
const ids = (wc) => {
  const f = wc.mainFrame;
  const o = {};
  for (const k of ['processId', 'routingId', 'frameToken', 'frameTreeNodeId', 'osProcessId', 'origin', 'detached', 'url']) {
    try {
      o[k] = f[k];
    } catch (e) {
      o[k] = 'ERR:' + e.message;
    }
  }
  return o;
};
async function click(wc, x, y) {
  wc.sendInputEvent({ type: 'mouseMove', x, y });
  await sleep(40);
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await sleep(40);
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  await sleep(120);
}
async function typeText(wc, text) {
  for (const ch of text) {
    wc.sendInputEvent({ type: 'keyDown', keyCode: ch });
    wc.sendInputEvent({ type: 'char', keyCode: ch });
    wc.sendInputEvent({ type: 'keyUp', keyCode: ch });
    await sleep(15);
  }
}
const rectOf = async (wc, sel) =>
  JSON.parse(await iso(wc, `(function(){var r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return JSON.stringify({x:r.left,y:r.top,w:r.width,h:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2});})()`));
const settle = async (p, ms = 4000) => {
  try {
    return await Promise.race([
      Promise.resolve(p).then((value) => ({ status: 'resolved', value })),
      sleep(ms).then(() => ({ status: 'no-reply-within-' + ms + 'ms' }))
    ]);
  } catch (e) {
    return { status: 'rejected', message: String(e && e.message).slice(0, 200) };
  }
};

// ============================ Q1(a): guest reach, product bundle ============================
async function phaseQ1(base) {
  for (const farble of [true, false]) {
    state.farble = farble;
    ipcLog.length = 0;
    const wc = newGuest(BUNDLE);
    await wc.loadURL(base + '/q1-hostile.html');
    await sleep(800);
    wc.focus();
    const u = await rectOf(wc, '#u');
    await click(wc, u.cx, u.cy);
    await typeText(wc, 'probe-user');
    const p = await rectOf(wc, '#p');
    await click(wc, p.cx, p.cy);
    await typeText(wc, 'probe-pass-1');
    await sleep(400);
    const icons = await iso(wc, 'document.querySelectorAll("svg[data-goldfinch-vault-lock]").length');
    const s = await rectOf(wc, '#s');
    await click(wc, s.cx, s.cy);
    await sleep(400);
    // exercise the fill listeners (dummy values, local fixture)
    wc.send('vault-lock-changed', { unlocked: true });
    wc.send('vault-fill', { username: 'probe-user', password: 'probe-fill-1' });
    await sleep(1200);
    const filled = JSON.parse(await iso(wc, 'JSON.stringify({u: document.getElementById("u").value.length, p: document.getElementById("p").value.length})'));
    const title = wc.getTitle();
    let rep = null;
    try {
      rep = JSON.parse(title.slice(3));
    } catch {}
    probe('Q1a', { farble, iconsRendered: icons, stubs: { eligibleAnswered: state.eligibleAnswered, farbleAnsweredWith: state.farbleAnswered.slice(), reply: 'eligible:true' }, fieldValueLengthsAfterTypingAndFill: filled, ipcChannelsSeenByMain: ipcLog.map((x) => x.ch), report: rep, titleRaw: rep ? undefined : title.slice(0, 200) });
  }
}

// ============================ Q2: main -> isolated world ============================
async function phaseQ2(base, portNum) {
  const A = base;
  const X = 'http://localhost:' + portNum;
  const wc = newGuest(RIG_PRELOAD);
  await wc.loadURL(A + '/q2-hostile.html');
  await sleep(300);
  const expected = { marker: 'q2-roundtrip', n: 42, arr: [1, 2, { k: 'v' }], nested: { a: null, b: true } };
  // Counters are read through the page title (browser-side getter), never by a main-world read.
  const readCnt = async () => {
    await sleep(500);
    return wc.getTitle();
  };
  const t0 = await readCnt();
  const tControl = await readCnt(); // nothing happened in between
  const got = await iso(wc, '(' + JSON.stringify(expected) + ')', VAULT_WORLD);
  const t1 = await readCnt();
  const got2 = await iso(wc, '(' + JSON.stringify(expected) + ')', VAULT_WORLD);
  const t2 = await readCnt();
  await wc.executeJavaScript('1'); // positive control for the method: an ordinary main-world call
  const t3 = await readCnt();
  await wc.executeJavaScript('window.__mark("after-controls")');
  const cntLog = await wc.executeJavaScript('window.__cntLog.slice(0, 30)');
  const identity = await iso(
    wc,
    `(function(){var nat=function(f){return /native code/.test(Function.prototype.toString.call(f));};
    return {pageArrayMarkerVisible: Array.prototype.__pageWrapped===true, pageObjectMarkerVisible: Object.prototype.__pageMarker!==undefined,
    objectThenAccessorVisible: !!Object.getOwnPropertyDescriptor(Object.prototype,'then'), pageCntVisible: typeof window.__cnt,
    nativePush: nat(Array.prototype.push), nativeStringify: nat(JSON.stringify), nativeThen: nat(Promise.prototype.then),
    nativeAddEventListener: nat(EventTarget.prototype.addEventListener), promiseGlobalIsNative: nat(Promise)};})()`,
    VAULT_WORLD
  );
  probe('Q2.roundtrip', {
    equalsExpected: JSON.stringify(got) === JSON.stringify(expected),
    got,
    secondCallEqualsExpected: JSON.stringify(got2) === JSON.stringify(expected),
    pageCounterTitles: { beforeAnyCall: t0, idleControl: tControl, afterIsoCall1: t1, afterIsoCall2: t2, afterOrdinaryExecuteJavaScript: t3 },
    identityInsideWorld: identity
  });
  probe('Q2.wrapperLogTail', { note: 'first 30 page-wrapper hits with stack (rig diagnostics: who called the wrapper)', entries: cntLog.slice(0, 30).map((x) => String(x).replace(/http:\/\/[\d.:]+\/q2-wrappers.js:\d+:\d+/g, 'W').replace(/node:electron\/js2c\/sandbox_bundle:/g, 'SB:').slice(0, 420)) });
  probe('Q2.throw', {
    throwStatement: await settle(iso(wc, 'throw new Error("probe-throw")', VAULT_WORLD)),
    syntaxError: await settle(iso(wc, 'this is not js', VAULT_WORLD)),
    rejectedPromise: await settle(iso(wc, 'Promise.reject(new Error("probe-reject"))', VAULT_WORLD)),
    undefinedValue: await settle(iso(wc, 'undefined', VAULT_WORLD))
  });

  // frame identity across navigation kinds
  const wc2 = newGuest(RIG_PRELOAD);
  await wc2.loadURL(A + '/nav-a.html');
  await sleep(200);
  const steps = [];
  let prev = wc2.mainFrame;
  await iso(wc2, 'globalThis.__state = "set-in-world"; true', VAULT_WORLD);
  const snap = async (label) => {
    const st = await settle(iso(wc2, 'globalThis.__state', VAULT_WORLD));
    const cur = wc2.mainFrame;
    steps.push({ label, sameFrameObject: cur === prev, prevDetached: prev.detached, ids: ids(wc2), stateInWorld: st.value ?? st.message });
    prev = cur;
  };
  await snap('initial');
  await wc2.executeJavaScript('history.pushState({}, "", "/pushed"); 1');
  await sleep(150);
  await snap('pushState');
  await wc2.executeJavaScript('location.hash = "#h"; 1');
  await sleep(150);
  await snap('hashchange');
  await wc2.loadURL(A + '/nav-b.html');
  await sleep(200);
  await snap('same-site cross-document');
  await iso(wc2, 'globalThis.__state = "set-in-world-2"; true', VAULT_WORLD);
  await wc2.loadURL(X + '/nav-c.html');
  await sleep(200);
  await snap('cross-site cross-document');
  probe('Q2.frameIdentity', { steps });

  // navigation between the call and its reply
  const wc3 = newGuest(RIG_PRELOAD);
  await wc3.loadURL(A + '/nav-a.html');
  await sleep(200);
  await iso(wc3, 'globalThis.__state = "old-document"; true', VAULT_WORLD);
  const f0 = wc3.mainFrame;
  const before = ids(wc3);
  const raw = wc3.executeJavaScriptInIsolatedWorld(VAULT_WORLD, [{ code: 'new Promise(function(r){setTimeout(function(){r({late:true,state:globalThis.__state})},700)})' }]);
  let rawSettled = 'pending';
  raw.then(
    (v) => (rawSettled = 'resolved:' + JSON.stringify(v)),
    (e) => (rawSettled = 'rejected:' + String(e && e.message).slice(0, 120))
  );
  const pending = settle(raw);
  await sleep(100);
  const navP = settle(wc3.loadURL(X + '/nav-c.html'), 8000);
  const reply = await pending;
  const navResult = await navP;
  await sleep(3000);
  const rawSettledAfterExtraWait = rawSettled;
  const after = ids(wc3);
  let oldFrameCall;
  const frameMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(f0)).filter((n) => /execute|isolated/i.test(n));
  try {
    oldFrameCall = await settle(f0.executeJavaScriptInIsolatedWorld(VAULT_WORLD, [{ code: 'globalThis.__state' }]));
  } catch (e) {
    oldFrameCall = { threw: e.message, webFrameMainMethodsMatchingExecute: frameMethods };
  }
  probe('Q2.navigateMidCall', {
    reply,
    navigationResult: navResult.status,
    callPromiseStateAfterNavigationPlus3s: rawSettledAfterExtraWait,
    idsBeforeCall: before,
    idsAfterNavigation: after,
    oldFrameDetached: f0.detached,
    oldFrameIdsNow: (() => {
      const o = {};
      for (const k of ['processId', 'routingId', 'frameToken', 'frameTreeNodeId', 'detached']) {
        try {
          o[k] = f0[k];
        } catch (e) {
          o[k] = 'ERR:' + e.message;
        }
      }
      return o;
    })(),
    oldFrameObjectIsCurrent: f0 === wc3.mainFrame,
    callOnOldFrameObject: oldFrameCall
  });
}

// ============================ Q3: isolated-world listener trust ============================
const LISTEN = 'window.__log = []; var n = document.getElementById("icon"); window.__node = n; n.addEventListener("click", function (e) { window.__log.push({ isTrusted: e.isTrusted, type: e.type }); }); true';
const readLog = async (wc) => JSON.parse(await iso(wc, 'JSON.stringify(window.__log)'));
const readOrd = async (wc) => JSON.parse(await iso(wc, 'JSON.stringify(Array.prototype.map.call(document.querySelectorAll("#ord i"), function (i) { return i.textContent; }))'));

async function phaseQ3(base) {
  // input control (benign page, rig preload)
  let wc = newGuest(RIG_PRELOAD);
  await wc.loadURL(base + '/benign.html');
  await sleep(300);
  wc.focus();
  await click(wc, 80, 40);
  const ctl = wc.getTitle();
  probe('Q3.inputControl', { title: ctl, realClickDeliveredTrusted: ctl === 'plain:true' });
  if (ctl !== 'plain:true') {
    probe('Q3.verdict', { verdict: 'cannot answer here', reason: 'input control failed: real click did not report isTrusted true' });
    return;
  }

  async function scenario(label, query, { realClick = true } = {}) {
    wc = newGuest(RIG_PRELOAD);
    await wc.loadURL(base + '/q3.html?isoStart=1&' + query);
    await sleep(300);
    wc.focus();
    const addBefore = await wc.executeJavaScript('window.__t.addCalls');
    await iso(wc, LISTEN);
    const addAfter = await wc.executeJavaScript('window.__t.addCalls');
    const trueRect = await rectOf(wc, '#icon');
    const hit = JSON.parse(
      await iso(
        wc,
        `(function(){var n=document.getElementById("icon"),r=n.getBoundingClientRect(),cs=getComputedStyle(n);
        var e=document.elementFromPoint(320,110);
        return JSON.stringify({isoElementFromPointAtIconCentre: e? (e.id||e.tagName):null, isoRect:[r.left,r.top,r.width,r.height],
        opacity:cs.opacity, visibility:cs.visibility, pointerEvents:cs.pointerEvents});})()`
      )
    );
    const pageView = await wc.executeJavaScript('window.__pageRead()');
    // detection verdicts, from isolated-world readings only
    const detects = {
      transparentElementAbove: hit.isoElementFromPointAtIconCentre !== 'icon',
      scaledToCover: hit.isoRect[2] > 100 || hit.isoRect[3] > 100,
      opacityZero: Number(hit.opacity) === 0
    };
    let real = null;
    if (realClick) {
      await click(wc, 320, 110);
      real = await readLog(wc);
    }
    const ordAfterReal = await readOrd(wc);
    await wc.executeJavaScript('window.__synth()');
    await sleep(100);
    const all = await readLog(wc);
    probe('Q3.' + label, {
      query,
      pageWrapperSawIsoRegistration: addAfter - addBefore,
      isoReads: hit,
      pageReadsWhileLying: pageView,
      detectsFromIsolatedWorld: detects,
      isoLogAfterRealClick: real,
      isoLogAfterRealThenSynthetic: all,
      clickOrderInSharedDom: ordAfterReal
    });
    return { wc, all };
  }

  const base1 = await scenario('clean', 'sc=clean&supp=none');
  const tr = await base1.wc.executeJavaScript('window.__tryRemove()');
  await click(base1.wc, 320, 110);
  probe('Q3.pageRemoveAttempt', { note: tr, isoLogAfterAnotherRealClick: await readLog(base1.wc) });
  await scenario('suppress-window-capture', 'sc=clean&supp=window');
  await scenario('suppress-document-capture', 'sc=clean&supp=document');
  await scenario('hit-overlay', 'sc=overlay&supp=none');
  await scenario('hit-scaled', 'sc=scale&supp=none');
  await scenario('hit-opacity0', 'sc=opacity&supp=none');

  // product's own icon (product bundle in the rig)
  state.farble = true;
  ipcLog.length = 0;
  wc = newGuest(BUNDLE);
  await wc.loadURL(base + '/q3-login.html?sc=clean&supp=none');
  await sleep(900);
  wc.focus();
  const u = await rectOf(wc, '#u');
  await click(wc, u.cx, u.cy);
  await sleep(500);
  const iconInfo = JSON.parse(
    await iso(
      wc,
      `(function(){var i=document.querySelectorAll("svg[data-goldfinch-vault-lock]");var o=[];
      i.forEach(function(n){var r=n.getBoundingClientRect();o.push({cx:r.left+r.width/2,cy:r.top+r.height/2,w:r.width,h:r.height,visible:getComputedStyle(n).visibility,display:getComputedStyle(n).display});});
      return JSON.stringify(o);})()`
    )
  );
  if (!iconInfo.length) {
    probe('Q3.productIcon', { rendered: false, note: 'icon not rendered in rig after focusing username', ipcChannelsSeenByMain: ipcLog.map((x) => x.ch) });
    return;
  }
  const iconSel = 'svg[data-goldfinch-vault-lock]';
  await iso(wc, 'window.__log=[]; var n=document.querySelector("' + iconSel + '"); n.addEventListener("click", function(e){ window.__log.push({isTrusted:e.isTrusted,type:e.type}); }); true');
  const gest0 = ipcLog.filter((x) => x.ch === 'guest-vault-gesture').length;
  await click(wc, iconInfo[0].cx, iconInfo[0].cy);
  const afterReal = JSON.parse(await iso(wc, 'JSON.stringify(window.__log)'));
  const gest1 = ipcLog.filter((x) => x.ch === 'guest-vault-gesture').length;
  await wc.executeJavaScript(`document.querySelector("${iconSel}") && document.querySelector("${iconSel}").dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true})); 1`);
  await sleep(200);
  const afterSyn = JSON.parse(await iso(wc, 'JSON.stringify(window.__log)'));
  const gest2 = ipcLog.filter((x) => x.ch === 'guest-vault-gesture').length;
  probe('Q3.productIcon', {
    rendered: true,
    iconRect: iconInfo[0],
    isoLogAfterRealClick: afterReal,
    isoLogAfterRealThenSynthetic: afterSyn,
    productGestureIpcFromRealClick: gest1 - gest0,
    productGestureIpcFromSyntheticClick: gest2 - gest1
  });
}

app.whenReady().then(async () => {
  let server;
  try {
    const sha = crypto.createHash('sha256').update(fs.readFileSync(BUNDLE)).digest('hex');
    probe('Q0.env', { electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node, platform: process.platform, bundleSha256: sha, phases: PHASES, ozone: app.commandLine.getSwitchValue('ozone-platform') || '(default)' });
    server = await startServer(0);
    const base = 'http://127.0.0.1:' + server.port;
    win = new BaseWindow({ width: 1000, height: 700, show: true });
    await sleep(500);
    if (PHASES.includes('q1')) await phaseQ1(base).catch((e) => ((rigFailed = true), probe('Q1a.RIGERROR', { error: String(e && e.stack).slice(0, 500) })));
    if (PHASES.includes('q2')) await phaseQ2(base, server.port).catch((e) => ((rigFailed = true), probe('Q2.RIGERROR', { error: String(e && e.stack).slice(0, 500) })));
    if (PHASES.includes('q3')) await phaseQ3(base).catch((e) => ((rigFailed = true), probe('Q3.RIGERROR', { error: String(e && e.stack).slice(0, 500) })));
  } catch (e) {
    rigFailed = true;
    probe('RIGERROR', { error: String(e && e.stack).slice(0, 500) });
  } finally {
    if (server) await server.close();
    app.exit(rigFailed ? 2 : 0);
  }
});
