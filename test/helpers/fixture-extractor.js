'use strict';

// Hand-rolled minimal HTML form-control extractor (Mission 21, Flight 1, Leg 4 —
// fixture-corpus, DD6). Turns committed HTML fixture TEXT into the DOM surface the
// pure detection modules consume: `querySelectorAll('input, select')`, `.form` /
// `.closest('form')`, attributes, `.type`, `.value`, `.options`, `.maxLength`,
// `.dispatchEvent`, `.addEventListener`, `.documentElement`. Test-only: no `fs` read
// happens at app runtime, and this file adds no new devDependency (plain string
// scanning, no parser library).
//
// WHAT THIS PROVES AND WHAT IT DOES NOT (leg design-review finding, recorded so a
// future reader doesn't over-trust it): this module's OWN unit tests
// (test/unit/save-moment-extractor.test.js) prove it is INTERNALLY CONSISTENT —
// that its output matches the two pinned association rules below by its own
// reading of them. They do NOT prove the output matches what a real browser (the
// app's actual Chromium guest) would build for the same markup. Only a live
// cross-check retires that risk (DD6) — see the flight log for why that check is
// tracked as a gap in this leg's landing rather than silently assumed clean.
//
// ---------------------------------------------------------------------------
// THE TWO PINNED FORM-ASSOCIATION RULES (not "handle nesting" — these two, only):
// ---------------------------------------------------------------------------
//   (a) A `<form>` start tag encountered while a form is already open is IGNORED
//       per the HTML parsing algorithm's "form element pointer" — a browser never
//       builds a nested form element at all; its content reparents to whatever was
//       already open (typically the outer form). Modeled below with a single
//       `formPointer` (never a stack of forms, matching the real single-pointer
//       algorithm): a `</form>` end tag closes whichever real form the pointer
//       currently names, REGARDLESS of which `<form>` tag it appears to match in
//       the source text — the real per-spec surprise, not a name/depth search. Every
//       fixture in this corpus is written so no content sits between an ignored
//       inner form's `</form>` and the real outer form's `</form>`, which is the one
//       case where the two possible readings of "which close tag closes what" would
//       actually diverge; within that constraint this extractor's behavior is
//       byte-for-byte what the real algorithm produces.
//   (b) A valid `form=` IDREF WINS OVER CONTAINMENT, anywhere in the tree — checked
//       first in the `.form` getter below, before any ancestor walk.
//
// Attribute-vs-property normalization (a separate, easy trap from association):
//   - a missing/invalid `type` on an `<input>` normalizes to `'text'`;
//   - `.maxLength` defaults to `-1` (never null/undefined — `formatCombinedExpiry`
//     in vault-card-fields.js reads it directly);
//   - a `<select>`'s `.value` derives from the SELECTED OPTION (last one carrying a
//     `selected` attribute wins, else the first option, matching real markup
//     authoring and the real DOM's own dedup-to-last-declared behavior), never a
//     literal attribute on the `<select>` tag itself (which doesn't exist in HTML).
//
// ---------------------------------------------------------------------------
// EVENT MODEL
// ---------------------------------------------------------------------------
// Real capturing + target + bubbling propagation, because `createEntryObserver`
// (src/preload/vault-entry-observer.js, landed Leg 3) needs a genuinely working
// `document.addEventListener(type, fn, /* capture */ true)` to receive events
// fired on descendant fields — not just a document object that HAS the method.
// `dispatchEvent` wraps the passed event in a Proxy that overrides only `.target`
// (always the node dispatchEvent was called ON — never settable on a real
// `Event` instance, which is why a Proxy rather than a plain property write) and
// forwards every other read (`.type`, `.bubbles`, `.isTrusted`) straight through to
// whatever the caller passed — a real `new Event(...)` instance (as
// vault-fill-fields.js's setFieldValue constructs) or a plain
// `{ type, isTrusted, bubbles }` object (as a trusted-gesture simulation would
// need to build, since a script-constructed real `Event` is always
// `isTrusted === false` by browser design — matching reality, not a limitation of
// this extractor).

const fs = require('fs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
]);

// Known HTML5 <input> type keywords. Anything else (missing, misspelled, or a
// keyword this list doesn't carry) normalizes to 'text', matching the real
// "invalid value default" behavior of the type IDL attribute.
const KNOWN_INPUT_TYPES = new Set([
  'text',
  'password',
  'email',
  'tel',
  'number',
  'checkbox',
  'radio',
  'hidden',
  'submit',
  'button',
  'reset',
  'file',
  'date',
  'month',
  'week',
  'time',
  'datetime-local',
  'color',
  'range',
  'search',
  'url',
  'image'
]);

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};

// ---------------------------------------------------------------------------
// Entity decoding (minimal — only what curated, trimmed real markup needs)
// ---------------------------------------------------------------------------

/**
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole;
  });
}

// ---------------------------------------------------------------------------
// Tokenizer — a small hand-rolled scanner, quote-aware for attribute values so a
// `>` inside a quoted attribute (e.g. an onclick handler, unlikely but possible in
// pasted real markup) never desyncs tag boundaries.
// ---------------------------------------------------------------------------

/**
 * @param {string} html
 * @returns {Array<any>}
 */
function tokenize(html) {
  const tokens = [];
  const n = html.length;
  let i = 0;

  while (i < n) {
    if (html[i] !== '<') {
      const start = i;
      while (i < n && html[i] !== '<') i++;
      const text = html.slice(start, i);
      if (text.trim().length) tokens.push({ type: 'text', text: decodeEntities(text) });
      continue;
    }

    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html.startsWith('<!', i)) {
      // DOCTYPE or other markup declaration — skip to the closing '>'.
      const end = html.indexOf('>', i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (html[i + 1] === '/') {
      const end = html.indexOf('>', i);
      const name = html
        .slice(i + 2, end === -1 ? n : end)
        .trim()
        .toLowerCase();
      tokens.push({ type: 'close', name });
      i = end === -1 ? n : end + 1;
      continue;
    }

    // Opening tag.
    let j = i + 1;
    const nameStart = j;
    while (j < n && /[a-zA-Z0-9-]/.test(html[j])) j++;
    const name = html.slice(nameStart, j).toLowerCase();
    if (!name) {
      // A bare '<' with no tag name (stray text) — treat as literal text and move on.
      tokens.push({ type: 'text', text: '<' });
      i++;
      continue;
    }

    const attrs = {};
    let selfClose = false;
    while (j < n) {
      while (j < n && /\s/.test(html[j])) j++;
      if (html[j] === '>') {
        j++;
        break;
      }
      if (html[j] === '/' && html[j + 1] === '>') {
        selfClose = true;
        j += 2;
        break;
      }
      if (j >= n) break;
      const attrNameStart = j;
      while (j < n && !/[\s=/>]/.test(html[j])) j++;
      const attrName = html.slice(attrNameStart, j).toLowerCase();
      while (j < n && /\s/.test(html[j])) j++;
      let attrValue = '';
      if (html[j] === '=') {
        j++;
        while (j < n && /\s/.test(html[j])) j++;
        if (html[j] === '"' || html[j] === "'") {
          const quote = html[j];
          j++;
          const valStart = j;
          while (j < n && html[j] !== quote) j++;
          attrValue = html.slice(valStart, j);
          if (j < n) j++; // skip closing quote
        } else {
          const valStart = j;
          while (j < n && !/[\s>]/.test(html[j])) j++;
          attrValue = html.slice(valStart, j);
        }
      }
      if (attrName) attrs[attrName] = decodeEntities(attrValue);
    }

    // Raw-text elements: their content is never parsed as markup and carries no
    // detection-relevant nodes, so it is discarded rather than tokenized.
    if (name === 'script' || name === 'style') {
      tokens.push({ type: 'open', name, attrs, selfClose: false });
      if (!selfClose) {
        const closeTag = `</${name}`;
        const lower = html.toLowerCase();
        const closeIdx = lower.indexOf(closeTag, j);
        const closeEnd = closeIdx === -1 ? n : html.indexOf('>', closeIdx);
        i = closeIdx === -1 ? n : closeEnd === -1 ? n : closeEnd + 1;
        tokens.push({ type: 'close', name });
      } else {
        i = j;
      }
      continue;
    }

    tokens.push({ type: 'open', name, attrs, selfClose });
    i = j;
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Event propagation
// ---------------------------------------------------------------------------

class EventTargetMixin {
  constructor() {
    this._captureListeners = new Map();
    this._bubbleListeners = new Map();
  }

  /**
   * @param {string} type
   * @param {Function} fn
   * @param {boolean} [capture]
   */
  addEventListener(type, fn, capture) {
    const store = capture ? this._captureListeners : this._bubbleListeners;
    if (!store.has(type)) store.set(type, []);
    store.get(type).push(fn);
  }

  /**
   * @param {string} type
   * @param {Function} fn
   * @param {boolean} [capture]
   */
  removeEventListener(type, fn, capture) {
    const store = capture ? this._captureListeners : this._bubbleListeners;
    const list = store.get(type);
    if (!list) return;
    const idx = list.indexOf(fn);
    if (idx >= 0) list.splice(idx, 1);
  }

  _invoke(type, capture, event) {
    const store = capture ? this._captureListeners : this._bubbleListeners;
    for (const fn of (store.get(type) || []).slice()) fn(event);
  }
}

/**
 * Every ancestor of `node`, starting with `node` itself and ending at the owning
 * document (the top of the chain — its own `.parentNode` is undefined, which is
 * what stops the walk).
 * @param {any} node
 * @returns {any[]}
 */
function ancestorChain(node) {
  const chain = [];
  let cur = node;
  while (cur) {
    chain.push(cur);
    cur = cur.parentNode;
  }
  return chain;
}

/**
 * Wrap `event` so every read of `.target` returns `field` — the node
 * `dispatchEvent` was actually invoked on — while every other property/method
 * forwards straight through to the original. A real `Event` instance's `.target`
 * is not a settable own property (only a prototype getter), so a plain
 * reassignment would throw in strict mode; the Proxy sidesteps that without ever
 * touching the underlying instance's internal slots.
 * @param {any} event
 * @param {any} field
 * @returns {any}
 */
function withResolvedTarget(event, field) {
  return new Proxy(event, {
    get(target, prop) {
      if (prop === 'target') return field;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

/**
 * Real capture → target → bubble propagation (WHATWG event-path shape). Document-
 * level capturing listeners (the shape `createEntryObserver.install()` relies on)
 * fire BEFORE the event reaches its target, exactly as in a real browser.
 * @param {any} node
 * @param {any} event
 * @returns {boolean}
 */
function dispatch(node, event) {
  const wrapped = withResolvedTarget(event, node);
  const chain = ancestorChain(node); // [node, parent, ..., documentElement, document]

  for (let idx = chain.length - 1; idx >= 1; idx--) chain[idx]._invoke(event.type, true, wrapped);
  node._invoke(event.type, true, wrapped);
  node._invoke(event.type, false, wrapped);
  if (event.bubbles) {
    for (let idx = 1; idx < chain.length; idx++) chain[idx]._invoke(event.type, false, wrapped);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Selector matching — deliberately narrow: only the shapes the pinned DOM surface
// actually uses (`tag`, `tag[attr]`, `tag[attr=value]`, `*`, comma lists thereof).
// ---------------------------------------------------------------------------

const SIMPLE_SELECTOR_RE = /^(\*|[a-zA-Z][a-zA-Z0-9-]*)?(?:\[([a-zA-Z-]+)(?:=(.*))?\])?$/;

/**
 * @param {any} el
 * @param {string} simple  one comma-free selector clause, already trimmed.
 * @returns {boolean}
 */
function matchesSimple(el, simple) {
  const m = SIMPLE_SELECTOR_RE.exec(simple);
  if (!m) throw new Error(`fixture-extractor: unsupported selector clause "${simple}"`);
  const [, tag, attrName, rawAttrVal] = m;
  if (tag && tag !== '*' && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
  if (attrName) {
    if (!el.hasAttribute(attrName)) return false;
    if (rawAttrVal !== undefined) {
      const want = rawAttrVal.replace(/^["']|["']$/g, '');
      if ((el.getAttribute(attrName) || '') !== want) return false;
    }
  }
  return true;
}

/**
 * @param {any} el
 * @param {string} selector  comma-separated list of simple clauses.
 * @returns {boolean}
 */
function matchesSelector(el, selector) {
  return selector
    .split(',')
    .map((s) => s.trim())
    .some((s) => matchesSimple(el, s));
}

/**
 * @param {any} root
 * @param {string} selector
 * @param {boolean} includeSelf
 * @returns {any[]}
 */
function queryAll(root, selector, includeSelf) {
  const out = [];
  function visit(node) {
    if (!(node instanceof ExtractedElement)) return;
    if (matchesSelector(node, selector)) out.push(node);
    for (const child of node.children) visit(child);
  }
  if (includeSelf) visit(root);
  else for (const child of root.children) visit(child);
  return out;
}

// ---------------------------------------------------------------------------
// Element / Document
// ---------------------------------------------------------------------------

class ExtractedElement extends EventTargetMixin {
  /**
   * @param {string} tagNameUpper
   * @param {any} ownerDocument
   */
  constructor(tagNameUpper, ownerDocument) {
    super();
    this.tagName = tagNameUpper;
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this._attrs = new Map();
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  getAttribute(name) {
    const v = this._attrs.get(String(name).toLowerCase());
    return v === undefined ? null : v;
  }

  hasAttribute(name) {
    return this._attrs.has(String(name).toLowerCase());
  }

  setAttribute(name, value) {
    this._attrs.set(String(name).toLowerCase(), String(value));
  }

  removeAttribute(name) {
    this._attrs.delete(String(name).toLowerCase());
  }

  get textContent() {
    let out = '';
    for (const child of this.children) {
      out += child instanceof ExtractedElement ? child.textContent : child.textContent || '';
    }
    return out;
  }

  querySelectorAll(selector) {
    return queryAll(this, selector, false);
  }

  querySelector(selector) {
    return queryAll(this, selector, false)[0] || null;
  }

  closest(selector) {
    let node = this;
    while (node instanceof ExtractedElement) {
      if (matchesSelector(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  dispatchEvent(event) {
    return dispatch(this, event);
  }
}

class ExtractedDocument extends EventTargetMixin {
  constructor() {
    super();
    this.documentElement = new ExtractedElement('HTML', this);
    this.documentElement.parentNode = this; // terminates ancestorChain at the document
    this._idIndex = new Map();
  }

  getElementById(id) {
    return this._idIndex.get(id) || null;
  }

  querySelectorAll(selector) {
    return queryAll(this.documentElement, selector, true);
  }

  querySelector(selector) {
    return queryAll(this.documentElement, selector, true)[0] || null;
  }
}

// ---------------------------------------------------------------------------
// Property normalization per element kind
// ---------------------------------------------------------------------------

/** Rule (b): a valid `form=` IDREF wins over containment, anywhere in the tree. */
function defineFormOwner(el) {
  Object.defineProperty(el, 'form', {
    enumerable: true,
    get() {
      const idref = el.getAttribute('form');
      if (idref) {
        const byId = el.ownerDocument.getElementById(idref);
        if (byId && byId.tagName === 'FORM') return byId;
      }
      let p = el.parentNode;
      while (p instanceof ExtractedElement) {
        if (p.tagName === 'FORM') return p;
        p = p.parentNode;
      }
      return null;
    }
  });
}

function defineInputProperties(el) {
  Object.defineProperty(el, 'type', {
    enumerable: true,
    get() {
      const raw = (el.getAttribute('type') || '').toLowerCase();
      return KNOWN_INPUT_TYPES.has(raw) ? raw : 'text';
    }
  });
  Object.defineProperty(el, 'maxLength', {
    enumerable: true,
    get() {
      const raw = el.getAttribute('maxlength');
      if (raw == null) return -1;
      const n = Number.parseInt(String(raw).trim(), 10);
      return Number.isInteger(n) && n >= 0 ? n : -1;
    }
  });
  // `.value` is a genuinely mutable property (not attribute-derived on every
  // read) so setFieldValue's plain `field.value = x` assignment behaves like the
  // real IDL attribute: initialized from the `value` content attribute, then
  // freely overwritten thereafter.
  el.value = el.getAttribute('value') != null ? el.getAttribute('value') : '';
}

function defineOptionProperties(el) {
  Object.defineProperty(el, 'value', {
    enumerable: true,
    get() {
      return el.hasAttribute('value') ? el.getAttribute('value') : el.textContent;
    }
  });
}

function defineSelectProperties(el) {
  Object.defineProperty(el, 'options', {
    enumerable: true,
    get() {
      return queryAll(el, 'option', false);
    }
  });
  // Rule: a <select>'s .value derives from the SELECTED OPTION, never a literal
  // attribute on the <select> tag (which has no such attribute in real HTML).
  Object.defineProperty(el, 'value', {
    enumerable: true,
    get() {
      const opts = el.options;
      if (!opts.length) return '';
      let chosen = null;
      for (const o of opts) if (o.hasAttribute('selected')) chosen = o; // last-declared wins
      return (chosen || opts[0]).value;
    },
    set(v) {
      // Best-effort, not spec-complete (Leg 4 tests detection only) — good enough
      // for a future fill-simulation call site not to throw or silently no-op.
      let matched = null;
      for (const o of el.options) {
        o.removeAttribute('selected');
        if (matched === null && o.value === v) matched = o;
      }
      if (matched) matched.setAttribute('selected', '');
    }
  });
}

/**
 * @param {string} tagLower
 * @param {Record<string,string>} attrs
 * @param {ExtractedDocument} doc
 * @returns {ExtractedElement}
 */
function makeElement(tagLower, attrs, doc) {
  const el = new ExtractedElement(tagLower.toUpperCase(), doc);
  for (const [k, v] of Object.entries(attrs)) el._attrs.set(k, v);

  if (attrs.id && !doc._idIndex.has(attrs.id)) doc._idIndex.set(attrs.id, el);

  el.id = attrs.id || '';
  el.name = attrs.name || '';
  el.placeholder = attrs.placeholder || '';

  if (tagLower === 'input') {
    defineInputProperties(el);
    defineFormOwner(el);
  } else if (tagLower === 'select') {
    defineSelectProperties(el);
    defineFormOwner(el);
  } else if (tagLower === 'option') {
    defineOptionProperties(el);
  }

  return el;
}

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------

/**
 * Parse `tokens` and append the resulting tree as children of `rootNode`, using
 * `doc` for id registration / ownerDocument wiring. Shared by `buildTree` (parses
 * into a fresh document's `documentElement`) and `createFragment` (parses into a
 * detached container so a `simulate(doc)` hook can graft the result elsewhere in
 * an ALREADY-extracted document — the framework-re-render shape's "replace this
 * node with an equivalent-looking new one" needs exactly this).
 * @param {ExtractedDocument} doc
 * @param {ExtractedElement} rootNode
 * @param {Array<any>} tokens
 */
function parseInto(doc, rootNode, tokens) {
  const stack = [{ node: rootNode, tagName: '#root' }];
  let formPointer = null; // rule (a): a SINGLE pointer, never a stack of forms.

  const currentParent = () => stack[stack.length - 1].node;

  for (const tok of tokens) {
    if (tok.type === 'text') {
      currentParent().children.push({ nodeType: 3, textContent: tok.text });
      continue;
    }

    if (tok.type === 'open') {
      if (tok.name === 'form') {
        if (formPointer !== null) {
          // Rule (a): ignored. No element, no stack frame — content that follows
          // reparents to whatever was already open (the real outer form, or
          // whatever ancestor was current).
          continue;
        }
        const el = makeElement('form', tok.attrs, doc);
        currentParent().appendChild(el);
        if (tok.selfClose) continue; // degenerate, but never leaves a dangling pointer
        stack.push({ node: el, tagName: 'form' });
        formPointer = el;
        continue;
      }

      const el = makeElement(tok.name, tok.attrs, doc);
      currentParent().appendChild(el);
      if (VOID_ELEMENTS.has(tok.name) || tok.selfClose) continue; // no frame — no children expected
      stack.push({ node: el, tagName: tok.name });
      continue;
    }

    if (tok.type === 'close') {
      if (tok.name === 'form') {
        if (formPointer === null) continue; // no open form — parse error, ignored
        for (let idx = stack.length - 1; idx >= 1; idx--) {
          if (stack[idx].node === formPointer) {
            stack.length = idx;
            break;
          }
        }
        formPointer = null;
        continue;
      }
      for (let idx = stack.length - 1; idx >= 1; idx--) {
        if (stack[idx].tagName === tok.name) {
          stack.length = idx;
          break;
        }
      }
      continue;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @param {string} html
 * @returns {ExtractedDocument}
 */
function extractDocument(html) {
  const doc = new ExtractedDocument();
  parseInto(doc, doc.documentElement, tokenize(html));
  return doc;
}

/**
 * Test-only convenience: read a fixture file and extract it. `fs` is used here,
 * in test helper code, never at app runtime.
 * @param {string} filePath  absolute path.
 * @returns {ExtractedDocument}
 */
function extractFixtureFile(filePath) {
  return extractDocument(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Parse `html` as new top-level nodes belonging to the ALREADY-EXTRACTED `doc`
 * (correct id registration / ownerDocument wiring), returned detached (no
 * `parentNode` yet) so a caller — typically a manifest entry's `simulate(doc)`
 * hook — can graft them into the live tree at any point, e.g. to model a
 * framework re-render that unmounts one node and mounts an equivalent-looking
 * new one in its place.
 * @param {ExtractedDocument} doc
 * @param {string} html
 * @returns {ExtractedElement[]}
 */
function createFragment(doc, html) {
  const container = new ExtractedElement('#FRAGMENT', doc);
  parseInto(doc, container, tokenize(html));
  for (const child of container.children) if (child instanceof ExtractedElement) child.parentNode = null;
  return container.children.filter((c) => c instanceof ExtractedElement);
}

module.exports = {
  extractDocument,
  extractFixtureFile,
  createFragment,
  ExtractedElement,
  ExtractedDocument
};
