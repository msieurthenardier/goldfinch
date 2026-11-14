// G6: page-side hooks that try to substitute an inert marker in any reply that passes through
// the page world. ?mode=A Object.prototype.then getter, B Promise.prototype.then wrapper,
// C Object.prototype.toJSON getter. window.__g6calls counts how often a hook ran.
(function () {
  'use strict';
  var mode = new URLSearchParams(location.search).get('mode');
  var calls = (window.__g6calls = { then: 0, ptThen: 0, toJSON: 0 });
  function isOrig(o) {
    var d = Reflect.getOwnPropertyDescriptor(o, 'marker');
    return d && typeof d.value === 'string' && d.value.indexOf('ORIG') === 0;
  }
  if (mode === 'A') {
    Object.defineProperty(Object.prototype, 'then', {
      configurable: true,
      get: function () {
        calls.then++;
        if (this && typeof this === 'object' && isOrig(this)) {
          return function (resolve) {
            resolve({ marker: 'SUBSTITUTE' });
          };
        }
        return undefined;
      }
    });
  } else if (mode === 'B') {
    var orig = Promise.prototype.then;
    Promise.prototype.then = function (a, b) {
      calls.ptThen++;
      var wrapped =
        typeof a === 'function'
          ? function (v) {
              if (v && typeof v === 'object' && isOrig(v)) v = { marker: 'SUBSTITUTE' };
              else if (v === 'ORIG-STRING') v = 'SUBSTITUTE-STRING';
              return a(v);
            }
          : a;
      return Reflect.apply(orig, this, [wrapped, b]);
    };
  } else if (mode === 'C') {
    Object.defineProperty(Object.prototype, 'toJSON', {
      configurable: true,
      get: function () {
        calls.toJSON++;
        if (this && typeof this === 'object' && isOrig(this)) {
          return function () {
            return { marker: 'SUBSTITUTE' };
          };
        }
        return undefined;
      }
    });
  }
  document.title = 'g6-' + mode;
})();
