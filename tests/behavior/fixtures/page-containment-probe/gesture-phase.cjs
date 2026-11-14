'use strict';
// Gesture-transport probes G1-G8 (flight 01 divert). Loaded by rig-main.cjs for --phases=g
// (or any of g1..g8). Every probe is a yes/no measurement; nothing observed is used.
// ctx: { newGuest, iso, click, sleep, rectOf, settle, probe, base, port, VAULT_WORLD,
//        RIG_PRELOAD, getView, phases }.

const now = () => performance.timeOrigin + performance.now();

async function runGesture(ctx) {
  const { newGuest, iso, sleep, rectOf, settle, probe, base, port, VAULT_WORLD, RIG_PRELOAD, getView, phases } = ctx;
  const want = (n) => phases.includes('g') || phases.includes(n);
  const X = 'http://localhost:' + port;
  const slim = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === undefined ? '__undef' : v)));

  // ---- main-side listeners (one set per guest) ----
  function attachMain(wc) {
    const log = [];
    let on = true;
    const dump = (kind) => (event, arg) => {
      if (!on) return;
      let evKeys = [];
      try {
        for (const k in event) evKeys.push(k);
      } catch {}
      log.push({ src: kind, t: now(), d: Date.now(), ev: kind === 'input-event' || kind === 'before-mouse-event' || kind === 'before-input-event' || kind === 'context-menu' ? slim(arg && typeof arg === 'object' ? pick(kind, arg) : arg) : arg, evKeys: log.length === 0 ? evKeys : undefined });
    };
    const pick = (kind, a) => {
      if (kind === 'context-menu') return { x: a.x, y: a.y, frame: a.frame ? { url: a.frame.url, processId: a.frame.processId, routingId: a.frame.routingId } : 'absent', frameURL: a.frameURL, mediaType: a.mediaType, isEditable: a.isEditable, keys: Object.keys(a).slice(0, 40) };
      const o = {};
      for (const k in a) o[k] = typeof a[k] === 'function' ? '[fn]' : a[k];
      return o;
    };
    const hs = {
      'input-event': dump('input-event'),
      'before-mouse-event': dump('before-mouse-event'),
      'before-input-event': dump('before-input-event'),
      'context-menu': dump('context-menu')
    };
    for (const [n, h] of Object.entries(hs)) wc.on(n, h);
    return { log, off: () => { on = false; for (const [n, h] of Object.entries(hs)) wc.off(n, h); }, clear: () => { log.length = 0; } };
  }

  const ISO_LISTEN = `(function(){ window.__il = []; var L = window.__il;
    ['pointerdown','mousedown','mouseup','click','contextmenu','keydown','keyup','input'].forEach(function (t) {
      window.addEventListener(t, function (e) {
        var tg = e.target && (e.target.id || e.target.tagName);
        L.push({ type: e.type, t: performance.timeOrigin + performance.now(), d: Date.now(), cx: e.clientX, cy: e.clientY, px: e.pageX, py: e.pageY, isTrusted: e.isTrusted, key: e.key, tgt: tg });
      }, true);
    }); return true; })()`;
  const isoLog = async (wc) => JSON.parse(await iso(wc, 'JSON.stringify(window.__il)', VAULT_WORLD));
  const isoClear = (wc) => iso(wc, 'window.__il.length = 0; true', VAULT_WORLD);
  const readCnt = async (wc) => {
    await sleep(450);
    return wc.getTitle();
  };
  async function click(wc, x, y, button = 'left') {
    wc.sendInputEvent({ type: 'mouseMove', x, y });
    await sleep(40);
    wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 1 });
    await sleep(40);
    wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: 1 });
    await sleep(150);
  }
  async function loadG(wc, url) {
    await wc.loadURL(url);
    await sleep(300);
    wc.focus();
    await iso(wc, ISO_LISTEN, VAULT_WORLD);
  }
  const iconRect = (wc) => rectOf(wc, '#icon');
  const slimEv = (l) => l.map((e) => ({ src: e.src, ...e.ev, dt: undefined, t: undefined })).map((e) => JSON.stringify(e));

  // ================= G1: main-side events vs real and synthetic input =================
  if (want('g1')) {
    const wc = newGuest(RIG_PRELOAD);
    await loadG(wc, base + '/g-page.html');
    const r = await iconRect(wc);
    const plain = await rectOf(wc, '#plain');
    // input control: a plain button must report isTrusted:true for a rig click
    await click(wc, plain.cx, plain.cy);
    const ctl = await wc.executeJavaScript('window.__pg.slice()');
    const controlOk = ctl.some((s) => s === 'plain:click:trusted=true');
    probe('G1.inputControl', { pageHandlerLog: ctl, realClickTrusted: controlOk });
    if (!controlOk) return probe('G1.verdict', { verdict: 'cannot answer here', reason: 'input control failed' });

    // counter method (Q2): title mirror; control click with NO main listeners, then with listeners
    const c0 = await readCnt(wc);
    await click(wc, r.cx, r.cy);
    const c1 = await readCnt(wc); // click with no main-side listeners attached
    const m = attachMain(wc);
    await isoClear(wc);
    const c2 = await readCnt(wc);
    await click(wc, r.cx, r.cy);
    const c3 = await readCnt(wc); // click with 4 main-side listeners attached
    const realLog = m.log.slice();
    const realIso = await isoLog(wc);
    probe('G1.realClick', {
      iconRect: r,
      clickedAt: [r.cx, r.cy],
      mainEventsBySource: realLog.reduce((a, e) => ((a[e.src + ':' + (e.ev && e.ev.type)] = (a[e.src + ':' + (e.ev && e.ev.type)] || 0) + 1), a), {}),
      mainEventsFull: realLog.map((e) => ({ src: e.src, d: e.d, ev: e.ev })),
      eventObjectEnumerableKeys: realLog.find((e) => e.evKeys)?.evKeys,
      domEventsInIsolatedWorld: realIso.map((e) => ({ type: e.type, cx: e.cx, cy: e.cy, isTrusted: e.isTrusted, tgt: e.tgt })),
      pageCounters: { before: c0, afterClickNoMainListeners: c1, beforeClickWithListeners: c2, afterClickWithListeners: c3 }
    });
    m.clear();
    await isoClear(wc);
    const c4 = await readCnt(wc);
    await wc.executeJavaScript('(function(){var i=document.getElementById("icon"); i.click(); i.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,clientX:320,clientY:110})); i.dispatchEvent(new MouseEvent("mousedown",{bubbles:true})); i.dispatchEvent(new MouseEvent("mouseup",{bubbles:true})); return 1;})()');
    await sleep(200);
    const synIso = await isoLog(wc);
    probe('G1.syntheticClick', {
      mainEventsCount: m.log.length,
      mainEvents: m.log.map((e) => ({ src: e.src, ev: e.ev })),
      domEventsInIsolatedWorld: synIso.map((e) => ({ type: e.type, isTrusted: e.isTrusted, tgt: e.tgt })),
      counterBeforeSynth: c4
    });
    m.off();
    probe('G1.note', {
      limit: 'this host can only deliver input through webContents.sendInputEvent (no physical pointer under WSL2/headless).',
      typingsSay: 'electron.d.ts: input-event is "Emitted when an input event is sent to the WebContents"; before-mouse-event/before-input-event "before dispatching ... in the page". No statement that OS input vs sendInputEvent differ or share a path.'
    });
  }

  // ================= G2: coordinate space =================
  if (want('g2')) {
    const wc = newGuest(RIG_PRELOAD);
    await loadG(wc, base + '/g-page.html');
    const m = attachMain(wc);
    const rows = [];
    async function trial(label, mapFn) {
      const r = await iconRect(wc);
      const dpr = Number(await iso(wc, 'window.devicePixelRatio', VAULT_WORLD));
      const vv = JSON.parse(await iso(wc, 'JSON.stringify({iw: innerWidth, ih: innerHeight, sx: scrollX, sy: scrollY, vvScale: visualViewport.scale})', VAULT_WORLD));
      const zf = wc.getZoomFactor();
      const hypotheses = {};
      for (const [name, f] of Object.entries(mapFn)) {
        m.clear();
        await isoClear(wc);
        const [x, y] = f(r, zf, dpr);
        await click(wc, x, y);
        const down = m.log.find((e) => e.src === 'input-event' && e.ev && e.ev.type === 'mouseDown');
        const il = (await isoLog(wc)).filter((e) => e.type === 'mousedown');
        hypotheses[name] = { sent: [x, y], mainInputEventXY: down ? [down.ev.x, down.ev.y] : null, mainGlobalXY: down ? [down.ev.globalX, down.ev.globalY] : null, domClientXY: il[0] ? [il[0].cx, il[0].cy] : null, domTarget: il[0] ? il[0].tgt : null };
      }
      rows.push({ label, zoomFactor: zf, devicePixelRatio: dpr, viewport: vv, isoRectCss: { cx: r.cx, cy: r.cy, x: r.x, y: r.y, w: r.w, h: r.h }, hypotheses });
    }
    const hyp = { 'A:cssCentre': (r) => [r.cx, r.cy], 'B:cssCentre*zoom': (r, z) => [r.cx * z, r.cy * z], 'C:cssCentre*dpr': (r, z, d) => [r.cx * d, r.cy * d] };
    await trial('default zoom, no scroll', hyp);
    await iso(wc, 'window.scrollTo(0, 60); true', VAULT_WORLD);
    await sleep(150);
    await trial('default zoom, scrollY=60', hyp);
    await iso(wc, 'window.scrollTo(0, 0); true', VAULT_WORLD);
    wc.setZoomFactor(1.5);
    await sleep(300);
    await trial('setZoomFactor(1.5)', hyp);
    wc.setZoomFactor(1);
    await sleep(200);
    let emu;
    try {
      wc.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: 1000, height: 700 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 2, viewSize: { width: 1000, height: 700 }, scale: 1 });
      await sleep(400);
      emu = 'enableDeviceEmulation(deviceScaleFactor:2) accepted';
      await trial('device emulation dsf=2', hyp);
      wc.disableDeviceEmulation();
    } catch (e) {
      emu = 'threw: ' + String(e.message).slice(0, 200);
    }
    m.off();
    probe('G2', { deviceScaleEmulation: emu, rows });
  }

  // ================= G3: ordering and timing =================
  if (want('g3')) {
    const wc = newGuest(RIG_PRELOAD);
    await loadG(wc, base + '/g-page.html');
    const r = await iconRect(wc);
    const m = attachMain(wc);
    async function run(label, busyMs) {
      const out = [];
      for (let i = 0; i < 5; i++) {
        m.clear();
        await isoClear(wc);
        if (busyMs) {
          // block the page main thread right before the click is delivered
          wc.executeJavaScript('(function(){var t=Date.now();while(Date.now()-t<' + busyMs + '){} return 1;})()');
          await sleep(20);
        }
        wc.sendInputEvent({ type: 'mouseMove', x: r.cx, y: r.cy });
        await sleep(40);
        wc.sendInputEvent({ type: 'mouseDown', x: r.cx, y: r.cy, button: 'left', clickCount: 1 });
        await sleep(40);
        wc.sendInputEvent({ type: 'mouseUp', x: r.cx, y: r.cy, button: 'left', clickCount: 1 });
        await sleep(busyMs ? busyMs + 250 : 200);
        const il = await isoLog(wc);
        const mDown = m.log.filter((e) => e.src === 'input-event' && e.ev.type === 'mouseDown')[0];
        const bDown = m.log.filter((e) => e.src === 'before-mouse-event' && e.ev.type === 'mouseDown')[0];
        const mUp = m.log.filter((e) => e.src === 'input-event' && e.ev.type === 'mouseUp')[0];
        const dDown = il.find((e) => e.type === 'mousedown');
        const dClick = il.find((e) => e.type === 'click');
        const f = (v) => (v === undefined ? null : Math.round(v * 100) / 100);
        out.push({
          mainBeforeMouseDownFirst: mDown && bDown ? bDown.t <= mDown.t : null,
          'input-event mouseDown -> DOM mousedown (ms)': mDown && dDown ? f(dDown.t - mDown.t) : null,
          'before-mouse-event mouseDown -> DOM mousedown (ms)': bDown && dDown ? f(dDown.t - bDown.t) : null,
          'input-event mouseUp -> DOM click (ms)': mUp && dClick ? f(dClick.t - mUp.t) : null,
          'DateNow: input-event mouseDown -> DOM mousedown (ms)': mDown && dDown ? dDown.d - mDown.d : null,
          'DateNow: input-event mouseUp -> DOM click (ms)': mUp && dClick ? dClick.d - mUp.d : null,
          mainFirst: mDown && dDown ? mDown.t < dDown.t : null,
          mainUpFirst: mUp && dClick ? mUp.t < dClick.t : null,
          domOrder: il.map((e) => e.type)
        });
      }
      return out;
    }
    probe('G3.idle', { runs: await run('idle', 0) });
    probe('G3.pageMainThreadBlocked', { note: 'page main thread blocked (busy loop) around the click', runs: await run('busy', 150) });
    m.off();
  }

  // ================= G4: keyboard and context-menu =================
  if (want('g4')) {
    const wc = newGuest(RIG_PRELOAD);
    await loadG(wc, base + '/g-page.html');
    const m = attachMain(wc);
    await iso(wc, 'document.getElementById("icon").focus(); true', VAULT_WORLD);
    await sleep(100);
    const focusSeen = await iso(wc, 'document.activeElement && document.activeElement.id', VAULT_WORLD);
    const keyRun = async (keyCode) => {
      m.clear();
      await isoClear(wc);
      wc.sendInputEvent({ type: 'keyDown', keyCode });
      wc.sendInputEvent({ type: 'char', keyCode });
      wc.sendInputEvent({ type: 'keyUp', keyCode });
      await sleep(250);
      return {
        key: keyCode,
        mainEvents: m.log.map((e) => ({ src: e.src, ev: e.ev })),
        eventObjectKeys: m.log.find((e) => e.evKeys)?.evKeys,
        domEventsInIsolatedWorld: (await isoLog(wc)).map((e) => ({ type: e.type, key: e.key, isTrusted: e.isTrusted, tgt: e.tgt }))
      };
    };
    probe('G4.keyboard', { isolatedWorldActiveElement: focusSeen, enter: await keyRun('Enter'), space: await keyRun('Space'), mainKnowsFocusedElementField: 'Input has only type/key/code/isAutoRepeat/isComposing/modifiers; no target or frame (see mainEvents)' });
    // context-menu
    m.clear();
    await isoClear(wc);
    const r = await iconRect(wc);
    wc.sendInputEvent({ type: 'mouseMove', x: r.cx, y: r.cy });
    await sleep(40);
    wc.sendInputEvent({ type: 'mouseDown', x: r.cx, y: r.cy, button: 'right', clickCount: 1 });
    await sleep(40);
    wc.sendInputEvent({ type: 'mouseUp', x: r.cx, y: r.cy, button: 'right', clickCount: 1 });
    await sleep(400);
    const real = { mainEvents: m.log.map((e) => ({ src: e.src, ev: e.ev })), dom: (await isoLog(wc)).map((e) => ({ type: e.type, cx: e.cx, cy: e.cy, isTrusted: e.isTrusted })) };
    m.clear();
    await isoClear(wc);
    await wc.executeJavaScript('document.getElementById("icon").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:320,clientY:110,button:2})); 1');
    await sleep(400);
    const syn = { mainEvents: m.log.map((e) => ({ src: e.src, ev: e.ev })), dom: (await isoLog(wc)).map((e) => ({ type: e.type, isTrusted: e.isTrusted })) };
    probe('G4.contextMenu', { iconCentre: [r.cx, r.cy], realRightClick: real, syntheticContextmenuDispatch: syn });
    m.off();
  }

  // ================= G5: subframes =================
  if (want('g5')) {
    for (const [label, origin] of [['same-site iframe', base], ['cross-site iframe', X]]) {
      const wc = newGuest(RIG_PRELOAD);
      await wc.loadURL(base + '/g-frame.html?inner=' + encodeURIComponent(origin + '/g-inner.html'));
      await sleep(900);
      wc.focus();
      const m = attachMain(wc);
      const frames = wc.mainFrame.frames.map((f) => ({ url: f.url, origin: f.origin, processId: f.processId, sameProcessAsMain: f.processId === wc.mainFrame.processId }));
      const cx = 100 + 50 + 20;
      const cy = 150 + 30 + 10;
      await click(wc, cx, cy);
      const child = wc.mainFrame.frames[0];
      let inner = null;
      try {
        inner = await settle(child.executeJavaScript('JSON.stringify(window.__pg)'), 2500);
      } catch (e) {
        inner = { threw: String(e.message).slice(0, 120) };
      }
      probe('G5.' + label, {
        frames,
        clickedAtTopLevelXY: [cx, cy],
        expectedInnerClientXY: [70, 40],
        mainEvents: m.log.filter((e) => e.src !== 'before-input-event').map((e) => ({ src: e.src, ev: e.ev })),
        eventObjectKeys: m.log.find((e) => e.evKeys)?.evKeys,
        innerPageSawEvents: inner
      });
      m.clear();
      await click(wc, cx, cy, 'right');
      await sleep(300);
      probe('G5.' + label + '.contextMenu', { contextMenuEvents: m.log.filter((e) => e.src === 'context-menu').map((e) => e.ev) });
      m.off();
    }
  }

  // ================= G6: can the page alter the isolated-world reply? =================
  if (want('g6')) {
    for (const mode of ['A', 'B', 'C']) {
      const wc = newGuest(RIG_PRELOAD);
      await wc.loadURL(base + '/g6.html?mode=' + mode);
      await sleep(300);
      // control: the hook does alter a page-world promise
      await wc.executeJavaScript('Promise.resolve({marker:"ORIG-ctl"}).then(function(v){window.__ctl=v.marker; return 1;}); 1');
      await sleep(100);
      const ctl = await wc.executeJavaScript('JSON.stringify({ctl: window.__ctl, calls: window.__g6calls, mode: ' + JSON.stringify(mode) + '})');
      await wc.executeJavaScript('window.__g6calls.then=0; window.__g6calls.ptThen=0; window.__g6calls.toJSON=0; 1');
      const objReply = await iso(wc, '({marker:"ORIG-obj"})', VAULT_WORLD);
      const strReply = await iso(wc, '"ORIG-STRING"', VAULT_WORLD);
      const promReply = await iso(wc, 'Promise.resolve({marker:"ORIG-prom"})', VAULT_WORLD);
      const calls = await wc.executeJavaScript('JSON.stringify(window.__g6calls)');
      probe('G6.mode' + mode, { hookWorksOnPageOwnPromise: ctl, mainReceivedObject: objReply, mainReceivedString: strReply, mainReceivedPromiseValue: promReply, hookCallsDuringIsoCalls: JSON.parse(calls) });
    }
  }

  // ================= G7: is the outbound script text page-visible? =================
  if (want('g7')) {
    const wc = newGuest(RIG_PRELOAD);
    await loadG(wc, base + '/g-page.html');
    const hits = async () => JSON.parse(await wc.executeJavaScript('JSON.stringify(window.__hits)'));
    // scanner positive control: a main-world call whose page-visible argument carries the marker
    await wc.executeJavaScript('JSON.stringify({m:"G7-INERT-CTL"}); 1');
    const h0 = await hits();
    await sleep(300);
    const r1 = await iso(wc, '/* G7-INERT-MARKER */ "benign"', VAULT_WORLD);
    const h1 = await hits();
    const r2 = await iso(wc, '"G7-INERT-REPLY"', VAULT_WORLD);
    const h2 = await hits();
    const r3 = await iso(wc, '("G7-INE" + "RT-SPLIT")', VAULT_WORLD); // marker only in the REPLY, not in the code text
    const h3 = await hits();
    await wc.executeJavaScript('/* G7-INERT-MAINWORLD-CODE */ 1');
    const h4 = await hits();
    probe('G7.attribution', { afterMarkerOnlyInReply: { reply: r3, hits: h3 }, afterMainWorldExecuteJavaScriptWithMarkerInCodeOnly: h4 });
    probe('G7', {
      scannerPositiveControl_afterJSON_stringify_of_marker: h0,
      afterMarkerOnlyInCode: { reply: r1, hits: h1 },
      afterMarkerInReply: { reply: r2, hits: h2 }
    });
  }

  // ================= G8: delivery alternatives =================
  if (want('g8')) {
    const wc = newGuest(RIG_PRELOAD);
    await loadG(wc, base + '/g-page.html');
    await iso(wc, 'globalThis.__wmark = "w745821"; true', VAULT_WORLD); // make the world exist
    const hits = async () => JSON.parse(await wc.executeJavaScript('JSON.stringify(window.__hits)'));
    const c0 = await readCnt(wc);
    const h0 = await hits();
    const dbg = wc.debugger;
    const ctxs = [];
    let attachErr = null;
    try {
      dbg.attach('1.3');
    } catch (e) {
      attachErr = e.message;
    }
    if (attachErr) probe('G8a', { verdict: 'cannot answer here', attachErr });
    else {
      dbg.on('message', (_e, method, params) => {
        if (method === 'Runtime.executionContextCreated') ctxs.push(params.context);
      });
      await dbg.sendCommand('Runtime.enable');
      await sleep(300);
      const probeCtx = [];
      for (const c of ctxs) {
        let v;
        try {
          const rr = await dbg.sendCommand('Runtime.evaluate', { contextId: c.id, expression: 'typeof globalThis.__wmark === "string" ? globalThis.__wmark : "none"', returnByValue: true });
          v = rr.result && rr.result.value;
        } catch (e) {
          v = 'ERR ' + e.message.slice(0, 60);
        }
        probeCtx.push({ id: c.id, name: c.name, origin: c.origin, auxData: c.auxData, wmark: v });
      }
      const target = probeCtx.find((c) => c.wmark === 'w745821');
      const cA = await readCnt(wc);
      const hA = await hits();
      let result = null;
      if (target) {
        result = await dbg.sendCommand('Runtime.evaluate', { contextId: target.id, expression: '/* G8A-INERT-EXPR */ ({marker: "G8A-INERT-REPLY", n: 42})', returnByValue: true });
      }
      const cB = await readCnt(wc);
      const hB = await hits();
      // new-world alternative: Page.createIsolatedWorld makes a NEW world, not id 745821
      let created = null;
      try {
        const fid = ctxs.find((c) => c.auxData && c.auxData.frameId)?.auxData.frameId;
        const w = await dbg.sendCommand('Page.createIsolatedWorld', { frameId: fid, worldName: 'g8-probe' });
        const rr = await dbg.sendCommand('Runtime.evaluate', { contextId: w.executionContextId, expression: 'typeof globalThis.__wmark', returnByValue: true });
        created = { createdContextId: w.executionContextId, wmarkInNewWorld: rr.result.value };
      } catch (e) {
        created = { threw: e.message.slice(0, 120) };
      }
      // positive control for the scanner: the same reply through the Electron API
      await iso(wc, '({marker: "G8A-INERT-API-REPLY"})', VAULT_WORLD);
      const hC = await hits();
      let secondAttach;
      try {
        wc.debugger.attach('1.3');
        secondAttach = 'second attach succeeded';
      } catch (e) {
        secondAttach = 'second attach threw: ' + e.message.slice(0, 100);
      }
      probe('G8a', {
        contexts: probeCtx,
        selectedContextForWorld745821: target ? target.id : null,
        evaluateResult: result && result.result && result.result.value,
        isAttachedWhileHeld: dbg.isAttached(),
        secondAttach,
        pageCounters: { beforeAttach: c0, afterAttachEnableAndContextSearch: cA, afterEvaluateInTargetWorld: cB },
        scannerHits: { beforeAttach: h0, afterAttachEnableAndContextSearch: hA, afterEvaluate: hB, afterControlViaElectronApi: hC },
        pageCreateIsolatedWorld: created
      });
      dbg.detach();
      probe('G8a.detached', { isAttached: dbg.isAttached() });
    }
    // (b) insertText
    const wc2 = newGuest(RIG_PRELOAD);
    await loadG(wc2, base + '/g-page.html');
    const hits2 = async () => JSON.parse(await wc2.executeJavaScript('JSON.stringify(window.__hits)'));
    const f = await rectOf(wc2, '#f');
    await click(wc2, f.cx, f.cy); // focus the field with a real click
    const active = await iso(wc2, 'document.activeElement && document.activeElement.id', VAULT_WORLD);
    const typed = async (txt) => {
      for (const ch of txt) {
        wc2.sendInputEvent({ type: 'keyDown', keyCode: ch });
        wc2.sendInputEvent({ type: 'char', keyCode: ch });
        wc2.sendInputEvent({ type: 'keyUp', keyCode: ch });
        await sleep(15);
      }
    };
    const t0 = await hits2();
    await typed('inert'); // control: the same kind of text delivered as real key events
    await sleep(300);
    const t1 = await hits2();
    await iso(wc2, 'document.getElementById("f").value = ""; true', VAULT_WORLD);
    const d0 = await readCnt(wc2);
    const e0 = await hits2();
    await isoClear(wc2);
    await wc2.insertText('G8B-INERT-TEXT');
    await sleep(300);
    const d1 = await readCnt(wc2);
    const e1 = await hits2();
    const value = await iso(wc2, 'document.getElementById("f").value', VAULT_WORLD);
    const pg = await wc2.executeJavaScript('window.__pg.slice()');
    // counter control, no marker: one real key press vs one insertText of one char
    const ca = await readCnt(wc2);
    await typed('x');
    const cb = await readCnt(wc2);
    await wc2.insertText('x');
    const cc = await readCnt(wc2);
    probe('G8b.counterControl', { beforeKeyX: ca, afterRealKeyX: cb, afterInsertTextX: cc });
    probe('G8b', { realKeyTypingControl: { before: t0, after: t1 }, activeElement: active, fieldValueAfterInsertText: value, pageOwnHandlerLog: pg.filter((s) => s.indexOf('f:') === 0), pageCounters: { before: d0, after: d1 }, scannerHits: { before: e0, after: e1 } });
  }
}

module.exports = { runGesture };
