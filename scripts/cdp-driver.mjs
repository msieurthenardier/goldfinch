// Raw CDP-over-WebSocket driver for the RUNNING Goldfinch app (the behavior-test apparatus).
//
// WHY THIS EXISTS: behavior tests must drive the live Goldfinch *chrome* (tab strip, pill,
// window controls) with TRUSTED input. The `chrome-devtools` MCP does NOT qualify — it launches
// its own browser, which has none of Goldfinch's chrome, so it false-passes ("the standing
// Goldfinch trap"). This driver instead ATTACHES to the already-running app's CDP endpoint and
// never launches a browser. It is the trusted-input sibling of `scripts/a11y-audit.mjs` (same
// attach-don't-launch, Node-global-`WebSocket`, zero-runtime-dep pattern), adding
// `Input.dispatch{Mouse,Key}Event` so it can deliver real (trusted) clicks/keys that fire the
// renderer's actual handlers and native focus traversal.
//
// PRECONDITION: the app is running with CDP exposed, e.g. `npm run dev:debug`
// (`--remote-debugging-port=9222 --remote-allow-origins=* --no-sandbox`). Override the endpoint
// with the CDP_HTTP env var (e.g. for comparing a second build on another port).
//
// Usage:
//   node scripts/cdp-driver.mjs eval '<jsExpr>'              -> prints the JSON result value
//   node scripts/cdp-driver.mjs click <x> <y>               -> trusted left press+release at x,y
//   node scripts/cdp-driver.mjs move  <x> <y>               -> trusted mouseMoved only (hover / mouseleave)
//   node scripts/cdp-driver.mjs key   <name>                -> trusted key down+up (see KEYS below)
//   node scripts/cdp-driver.mjs shot  <outPath> [x,y,w,h]   -> PNG screenshot (optional clip rect)
//   node scripts/cdp-driver.mjs reload                      -> hard-reload the renderer
//   CDP_HTTP=http://127.0.0.1:9223 node scripts/cdp-driver.mjs eval '1+1'

const CDP_HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:9222';
const args = process.argv.slice(2);
const cmd = args[0];

// Resolve the top-level Goldfinch RENDERER target (its url is the local index.html),
// never a <webview> guest page.
async function getRendererWs() {
  const res = await fetch(`${CDP_HTTP}/json`);
  const list = await res.json();
  const t = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
  if (!t) throw new Error(`no renderer target at ${CDP_HTTP} (is the app running with CDP?)`);
  return t.webSocketDebuggerUrl;
}

// CDP key descriptors. ShiftTab is handled as Tab + shift modifier (mods=8).
const KEYS = {
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 },
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
  Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, text: ' ' },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 },
  Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36, nativeVirtualKeyCode: 36 },
  End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 35 },
  Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 }
};

const ws = new WebSocket(await getRendererWs());
let id = 0;
const pend = {};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pend[i] = { res, rej };
    ws.send(JSON.stringify({ id: i, method, params }));
  });
ws.onmessage = (m) => {
  const r = JSON.parse(m.data);
  if (r.id && pend[r.id]) {
    r.error ? pend[r.id].rej(new Error(JSON.stringify(r.error))) : pend[r.id].res(r.result);
    delete pend[r.id];
  }
};
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = (e) => rej(new Error('ws ' + e.message));
});

async function out(v) {
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
}

try {
  if (cmd === 'eval') {
    const r = await send('Runtime.evaluate', { expression: args[1], returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      console.log('EVAL_ERROR', JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails));
      process.exit(2);
    }
    await out(r.result.value);
  } else if (cmd === 'click') {
    const x = Number(args[1]),
      y = Number(args[2]);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await out('clicked ' + x + ',' + y);
  } else if (cmd === 'move') {
    const x = Number(args[1]),
      y = Number(args[2]);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await out('moved ' + x + ',' + y);
  } else if (cmd === 'key') {
    let name = args[1];
    let mods = 0;
    if (name === 'ShiftTab') {
      name = 'Tab';
      mods = 8; // shift modifier
    }
    const k = KEYS[name];
    if (!k) throw new Error('unknown key ' + name + ' (known: ' + Object.keys(KEYS).join(', ') + ', ShiftTab)');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: mods, ...k });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: mods, ...k });
    await out('key ' + args[1]);
  } else if (cmd === 'shot') {
    await send('Page.enable');
    const params = { format: 'png' };
    if (args[2]) {
      const [x, y, w, h] = args[2].split(',').map(Number);
      params.clip = { x, y, width: w, height: h, scale: 1 };
    }
    const r = await send('Page.captureScreenshot', params);
    const fs = await import('fs');
    fs.writeFileSync(args[1], Buffer.from(r.data, 'base64'));
    await out('saved ' + args[1]);
  } else if (cmd === 'reload') {
    await send('Page.enable');
    await send('Page.reload', { ignoreCache: true });
    await out('reloaded');
  } else {
    throw new Error('unknown cmd ' + cmd + ' (eval|click|move|key|shot|reload)');
  }
  ws.close();
  process.exit(0);
} catch (e) {
  console.log('ERR', e.message);
  ws.close();
  process.exit(1);
}
