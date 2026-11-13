// Q1 instrumentation: runs first in <head>, in the page main world. It wraps the
// page-patchable built-ins the guest preload could later call through and records
// ONLY whether any `this` / argument it ever sees looks like an IPC send/invoke
// object, and whether require/process/Electron globals are reachable. It never
// calls, stores for later use, or reads through anything it observes.
(function () {
  'use strict';
  var R = { apply: Reflect.apply, ownKeys: Reflect.ownKeys };
  var nativeStringify = JSON.stringify;
  var hasOwn = Object.prototype.hasOwnProperty;
  var defProp = Object.defineProperty;
  var muted = true;
  var inside = false;
  var calls = 0;
  var hits = [];
  var hookCounts = {};
  var planShapes = {};
  var credShape = {};
  var senderDetail = [];
  var seenSenderKinds = {};
  var control = { fired: false };

  function ipcLike(v) {
    try {
      if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return false;
      if (typeof v.sendSync === 'function') return true;
      if (typeof v.invoke === 'function' && typeof v.send === 'function') return true;
      var c = v.constructor;
      return !!(c && c.name === 'IpcRenderer');
    } catch (e) {
      return false;
    }
  }
  function note(where, role, isControl) {
    if (hits.length < 40) hits.push({ where: where, role: role, control: !!isControl });
  }
  function scan(v, where, role) {
    if (ipcLike(v)) note(where, role, !muted && control.active);
    try {
      if (Array.isArray(v)) {
        var n = v.length < 16 ? v.length : 16;
        for (var i = 0; i < n; i++) {
          var e = v[i];
          if (ipcLike(e)) note(where, role + '[elem]', control.active);
          if (e && typeof e === 'object' && typeof e.channel === 'string' && 'payload' in e) {
            planShapes[e.channel] = (planShapes[e.channel] || 0) + 1;
          }
        }
      } else if (v && typeof v === 'object') {
        if (hasOwn.call(v, 'ipcRenderer') || hasOwn.call(v, 'electron')) note(where, role + '[member-name]', control.active);
        if (hasOwn.call(v, 'sender') && ipcLike(v.sender)) {
          note(where, role + '[.sender]', control.active);
          // Metadata only (constructor name, typeof of five method names, caller frames); nothing is called.
          if (!control.active && senderDetail.length < 8 && !seenSenderKinds[(v.sender.constructor && v.sender.constructor.name) + '|' + where + '|' + role] ) {
            var snd = v.sender;
            seenSenderKinds[(snd.constructor && snd.constructor.name) + '|' + where + '|' + role] = 1;
            var fns = [];
            ['send', 'invoke', 'sendSync', 'sendToHost', 'postMessage'].forEach(function (m) {
              fns.push(m + ':' + typeof snd[m]);
            });
            var stk = '';
            try {
              stk = String(new Error().stack).slice(0, 420).replace(/\n\s*/g, ' < ');
            } catch (e3) {}
            senderDetail.push({ where: where, ctor: snd.constructor && snd.constructor.name, ownKeysOfEvent: Reflect.ownKeys(v).map(String).slice(0, 6).join(','), fns: fns.join(' '), stack: stk });
          }
        }
        // Yes/no only: did an object with credential-shaped key NAMES pass through? (values never read)
        if (hasOwn.call(v, 'password') && hasOwn.call(v, 'username')) credShape[where] = (credShape[where] || 0) + 1;
      }
    } catch (e2) {
      /* ignore */
    }
  }
  function see(where, self, args) {
    if (inside) return;
    inside = true;
    try {
      calls++;
      hookCounts[where] = (hookCounts[where] || 0) + 1;
      scan(self, where, 'this');
      var n = args && args.length < 8 ? args.length : 8;
      for (var i = 0; i < n; i++) scan(args[i], where, 'arg' + i);
    } finally {
      inside = false;
    }
  }
  function wrap(obj, name, label) {
    var d = Object.getOwnPropertyDescriptor(obj, name);
    if (!d || typeof d.value !== 'function') return;
    var orig = d.value;
    var w = function () {
      if (!muted) see(label + '.' + String(name), this, arguments);
      return R.apply(orig, this, arguments);
    };
    try {
      defProp(obj, name, { value: w, writable: d.writable, configurable: d.configurable, enumerable: d.enumerable });
    } catch (e) {
      /* non-configurable */
    }
  }
  function wrapAll(obj, label, names) {
    for (var i = 0; i < names.length; i++) wrap(obj, names[i], label);
  }

  wrapAll(Function.prototype, 'Function.prototype', ['call', 'apply', 'bind']);
  wrapAll(Array.prototype, 'Array.prototype', [
    'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'concat', 'join', 'indexOf', 'includes', 'find', 'findIndex',
    'forEach', 'map', 'filter', 'reduce', 'some', 'every', 'flat', 'flatMap', 'sort', 'reverse', 'fill', 'at', 'entries', 'keys', 'values'
  ]);
  // for...of over an array: the iterator factory and the iterator's next().
  (function () {
    var it = Array.prototype[Symbol.iterator];
    var wi = function () {
      if (!muted) see('Array.prototype[Symbol.iterator]', this, arguments);
      return R.apply(it, this, arguments);
    };
    try {
      defProp(Array.prototype, Symbol.iterator, { value: wi, writable: true, configurable: true });
    } catch (e) {}
    var AIP = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
    var nx = AIP.next;
    var wn = function () {
      var r = R.apply(nx, this, arguments);
      if (!muted && r && !r.done) see('ArrayIteratorPrototype.next', this, [r.value]);
      return r;
    };
    try {
      defProp(AIP, 'next', { value: wn, writable: true, configurable: true });
    } catch (e) {}
  })();
  wrapAll(Object, 'Object', ['defineProperty', 'defineProperties', 'assign', 'keys', 'values', 'entries', 'freeze', 'create',
    'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', 'getOwnPropertyNames', 'setPrototypeOf', 'getPrototypeOf', 'fromEntries']);
  wrapAll(Reflect, 'Reflect', ['get', 'set', 'has', 'ownKeys', 'defineProperty', 'getPrototypeOf', 'construct']);
  wrapAll(JSON, 'JSON', ['stringify', 'parse']);
  wrapAll(Promise.prototype, 'Promise.prototype', ['then', 'catch', 'finally']);
  wrapAll(Promise, 'Promise', ['resolve', 'reject', 'all', 'allSettled', 'race', 'any']);
  wrapAll(Map.prototype, 'Map.prototype', ['get', 'set', 'has', 'forEach']);
  wrapAll(Set.prototype, 'Set.prototype', ['add', 'has', 'forEach']);
  wrapAll(WeakMap.prototype, 'WeakMap.prototype', ['get', 'set', 'has']);
  wrapAll(EventTarget.prototype, 'EventTarget.prototype', ['addEventListener', 'removeEventListener', 'dispatchEvent']);
  // Promise resolution looks up `.then` on a resolved object: an accessor on
  // Object.prototype sees every such `this`.
  try {
    defProp(Object.prototype, 'then', {
      configurable: true,
      get: function () {
        if (!muted) see('Object.prototype.then(getter)', this, []);
        return undefined;
      },
      set: function () {}
    });
  } catch (e) {}

  function globalsReport() {
    var out = {};
    var names = ['require', 'process', 'electron', 'ipcRenderer', 'Buffer', 'module', 'global', 'webFrame', 'contextBridge', '__dirname'];
    for (var i = 0; i < names.length; i++) out[names[i]] = typeof window[names[i]];
    out.ipcLikeGlobal = [];
    try {
      var keys = R.ownKeys(window);
      for (var j = 0; j < keys.length; j++) {
        if (typeof keys[j] !== 'string') continue;
        var v;
        try {
          v = Object.getOwnPropertyDescriptor(window, keys[j]);
          v = v && 'value' in v ? v.value : undefined;
        } catch (e) {
          v = undefined;
        }
        if (ipcLike(v)) out.ipcLikeGlobal.push(keys[j]);
      }
    } catch (e) {}
    return out;
  }

  // Positive control: prove the detector fires when an IPC-shaped object does pass through.
  control.active = true;
  muted = false;
  var fake = { send: function () {}, invoke: function () {}, sendSync: function () {}, on: function () {} };
  [].push.call([], fake);
  [].push.call([], { sender: fake });
  [].push.call([], { username: 'x', password: 'y' });
  muted = true;
  control.active = false;
  var controlHits = hits.slice();
  credShape = {}; // discard the control's own pass-through
  control.fired = hits.some(function (h) {
    return h.control;
  });

  muted = false;
  var timer = setInterval(function () {
    if (inside) return;
    var was = muted;
    muted = true;
    var rep = {
      calls: calls,
      hits: hits.filter(function (h) {
        return !h.control;
      }),
      controlDetectorFired: control.fired,
      controlSenderDetectorFired: controlHits.some(function (h) {
        return /\.sender/.test(h.role);
      }),
      hookCounts: hookCounts,
      planShapes: planShapes,
      credentialShapedObjectSeenBy: credShape,
      senderDetail: senderDetail,
      globals: globalsReport()
    };
    document.title = 'Q1:' + nativeStringify(rep);
    muted = was;
  }, 400);
  window.__q1stop = function () {
    clearInterval(timer);
  };
})();
