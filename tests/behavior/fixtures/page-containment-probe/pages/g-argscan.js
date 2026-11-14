// G7/G8 page-side argument scanner. Wraps built-ins and records (label only) whenever an
// argument or receiver contains the substring "INERT" (rig markers are inert strings
// such as G7-INERT-MARKER). Nothing here uses what it sees; hits are read by the rig.
(function () {
  'use strict';
  var hits = (window.__hits = { n: 0, labels: [] });
  var ownKeys = Reflect.ownKeys;
  var gopd = Object.getOwnPropertyDescriptor;
  var idx = String.prototype.indexOf;
  var apply = Reflect.apply;
  var push = Array.prototype.push;
  var busy = false;
  function has(v, depth) {
    var t = typeof v;
    if (t === 'string') return apply(idx, v, ['INERT']) !== -1 || apply(idx, v, ['inert']) !== -1;
    if (!v || (t !== 'object' && t !== 'function') || depth > 2) return false;
    var ks;
    try {
      ks = ownKeys(v);
    } catch (e) {
      return false;
    }
    for (var i = 0; i < ks.length && i < 12; i++) {
      var d;
      try {
        d = gopd(v, ks[i]);
      } catch (e) {
        continue;
      }
      if (d && 'value' in d && has(d.value, depth + 1)) return true;
    }
    return false;
  }
  function record(label, args, self) {
    if (busy) return;
    busy = true;
    var where = has(self, 0) ? '@this(' + (Array.isArray(self) ? 'array' : typeof self) + ')' : '';
    for (var i = 0; !where && i < args.length; i++) if (has(args[i], 0)) where = '@arg' + i;
    if (where) {
      hits.n++;
      if (hits.labels.length < 40) apply(push, hits.labels, [label + where]);
    }
    busy = false;
  }
  function wrapAll(obj, label) {
    ownKeys(obj).forEach(function (k) {
      var d = gopd(obj, k);
      if (!d || typeof d.value !== 'function' || !d.configurable) return;
      if (k === 'constructor' || k === 'caller' || k === 'arguments') return;
      var orig = d.value;
      var w = function () {
        record(label + '.' + String(k), arguments, this);
        return apply(orig, this, arguments);
      };
      try {
        Object.defineProperty(obj, k, { value: w, writable: d.writable, configurable: true, enumerable: d.enumerable });
      } catch (e) {}
    });
  }
  [
    [JSON, 'JSON'], [Reflect, 'Reflect'], [Object, 'Object'], [Array, 'Array'], [Array.prototype, 'Array.prototype'],
    [String, 'String'], [String.prototype, 'String.prototype'], [Promise, 'Promise'], [Promise.prototype, 'Promise.prototype'],
    [EventTarget.prototype, 'EventTarget.prototype'], [Map.prototype, 'Map.prototype'], [Set.prototype, 'Set.prototype'],
    [RegExp.prototype, 'RegExp.prototype'], [Error, 'Error'], [console, 'console']
  ].forEach(function (p) { wrapAll(p[0], p[1]); });
})();
