// Q2 page-side counting wrappers. Replaces Promise, JSON members, Array.prototype
// members, Object.prototype accessors and EventTarget.prototype members in the page
// main world. Each wrapper only increments a numeric counter on window.__cnt.
(function () {
  'use strict';
  var cnt = { total: 0 };
  window.__cnt = cnt;
  var apply = Reflect.apply;
  var def = Object.defineProperty;
  var nativePush = Array.prototype.push;
  var log = (window.__cntLog = []);
  var busy = false;
  var muted = false;
  function shape(v) {
    try {
      if (v === null) return 'null';
      var t = typeof v;
      if (t !== 'object' && t !== 'function') return t;
      var out = t + (Array.isArray(v) ? '[len=' + v.length + ']' : '');
      var ks = Reflect.ownKeys(v);
      var names = '';
      for (var i = 0; i < ks.length && i < 6; i++) names += (names ? ',' : '') + String(ks[i]);
      var ctor = v.constructor && v.constructor.name;
      return out + '{' + names + '}' + (ctor ? ' ctor=' + ctor : '');
    } catch (e) {
      return 'unreadable';
    }
  }
  function bump(k, self) {
    if (muted) return;
    cnt[k] = (cnt[k] || 0) + 1;
    cnt.total++;
    if (busy || log.length > 400) return;
    busy = true;
    var st = '';
    try {
      st = String(new Error().stack).slice(0, 900);
    } catch (e) {}
    nativePush.call(log, cnt.total + ' ' + k + ' this=' + shape(self) + ' | ' + st.replace(/\n\s*/g, ' < '));
    busy = false;
  }
  window.__mark = function (label) {
    nativePush.call(log, '--- MARK ' + label);
    return 1;
  };
  function wrap(obj, name, label) {
    var d = Object.getOwnPropertyDescriptor(obj, name);
    if (!d || typeof d.value !== 'function') return;
    var orig = d.value;
    var key = label + '.' + String(name);
    def(obj, name, {
      value: function () {
        bump(key, this);
        return apply(orig, this, arguments);
      },
      writable: true,
      configurable: true,
      enumerable: d.enumerable
    });
  }
  ['stringify', 'parse'].forEach(function (n) { wrap(JSON, n, 'JSON'); });
  ['push', 'pop', 'slice', 'map', 'forEach', 'filter', 'concat', 'join', 'indexOf', 'includes', 'reduce', 'some', 'every', 'find', 'splice', 'flat', 'entries', 'values', 'keys'].forEach(function (n) {
    wrap(Array.prototype, n, 'Array.prototype');
  });
  ['then', 'catch', 'finally'].forEach(function (n) { wrap(Promise.prototype, n, 'Promise.prototype'); });
  ['resolve', 'reject', 'all', 'race'].forEach(function (n) { wrap(Promise, n, 'Promise'); });
  ['addEventListener', 'removeEventListener', 'dispatchEvent'].forEach(function (n) { wrap(EventTarget.prototype, n, 'EventTarget.prototype'); });
  ['keys', 'values', 'entries', 'assign', 'defineProperty', 'getPrototypeOf', 'freeze'].forEach(function (n) { wrap(Object, n, 'Object'); });
  // Object.prototype accessors the platform or a script may consult implicitly.
  ['then', 'toJSON', 'value', 'done', 'message', 'length', 'result'].forEach(function (n) {
    if (Object.getOwnPropertyDescriptor(Object.prototype, n)) return;
    var d = Object.create(null); // null-prototype descriptor: earlier accessors must not leak into it
    d.configurable = true;
    d.get = function () {
      bump('Object.prototype.' + n + '(get)', this);
      return undefined;
    };
    d.set = function (v) {
      bump('Object.prototype.' + n + '(set)');
      var nd = Object.create(null);
      nd.value = v;
      nd.writable = true;
      nd.configurable = true;
      nd.enumerable = true;
      def(this, n, nd);
    };
    def(Object.prototype, n, d);
  });
  // Replace the Promise global itself with a counting subclass.
  var P = Promise;
  var RP = class extends P {
    constructor(ex) {
      bump('Promise(ctor)');
      super(ex);
    }
  };
  window.Promise = RP;
  // Markers the isolated world checks to prove it is NOT looking at the page's built-ins.
  Array.prototype.__pageWrapped = true;
  Object.prototype.__pageMarker = 'page';
  // Counter readout that needs no main-world read from the rig: the page mirrors its
  // own counters into document.title (string concatenation only, wrappers muted) so
  // the rig can read them with webContents.getTitle() (a browser-process getter).
  setInterval(function () {
    muted = true;
    document.title = 'CNT ' + cnt.total + ' push=' + (cnt['Array.prototype.push'] | 0) + ' then=' + (cnt['Object.prototype.then(get)'] | 0);
    muted = false;
  }, 100);
  document.title = 'q2-hostile';
})();
