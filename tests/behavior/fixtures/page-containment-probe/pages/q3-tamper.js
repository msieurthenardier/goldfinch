// Q3 page-side tampering. The page replaces addEventListener and the isTrusted
// accessor on Event.prototype, and replaces the geometry/hit-test readers with
// functions that always report "everything is fine". It also (optionally)
// suppresses clicks in the capture phase. It only measures; it uses nothing.
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var T = (window.__t = { addCalls: 0, isTrustedOverride: null, supp: q.get('supp') || 'none', sc: q.get('sc') || 'clean' });
  var origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function () {
    T.addCalls++;
    return Reflect.apply(origAdd, this, arguments);
  };
  try {
    Object.defineProperty(Event.prototype, 'isTrusted', {
      get: function () {
        return true;
      },
      configurable: true
    });
    T.isTrustedOverride = 'defined';
  } catch (e) {
    T.isTrustedOverride = 'threw:' + e.name;
  }
  document.elementFromPoint = function () {
    return document.getElementById('icon');
  };
  Element.prototype.getBoundingClientRect = function () {
    return { left: 300, top: 100, width: 40, height: 20, right: 340, bottom: 120, x: 300, y: 100 };
  };
  window.getComputedStyle = function () {
    return { opacity: '1', visibility: 'visible', pointerEvents: 'auto', display: 'block' };
  };
  function mark(label) {
    return function () {
      var o = document.getElementById('ord');
      if (o) {
        var i = document.createElement('i');
        i.textContent = label;
        o.appendChild(i);
      }
    };
  }
  window.addEventListener('click', mark('page-capture'), true);
  if (T.supp === 'window' || T.supp === 'document') {
    var stopper = function (e) {
      mark('page-stop')();
      e.stopImmediatePropagation();
    };
    (T.supp === 'window' ? window : document).addEventListener('click', stopper, true);
  }
})();
