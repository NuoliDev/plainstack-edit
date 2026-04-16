/**
 * Plainstack inline normalization: wrap loose text under data-editor-id, merge plain runs, verify.
 * Loaded before renderer.js; attaches window.plainstackNormalize (browser + Node tests via vm/eval).
 */

(function initPlainstackNormalize() {
  var EDITOR_ID_ATTR = 'data-editor-id';
  var EDITOR_ID_PREFIX = 'ed-';
  /** Marks auto-wrapped run spans so preview CSS can inherit from the block (avoid accidental `.highlight span` styling). */
  var PLAINSTACK_RUN_CLASS = 'plainstack-edit-run';
  var MAX_PREVIEW_LEN = 80;

  function truncate(s, max) {
    max = max == null ? MAX_PREVIEW_LEN : max;
    var t = String(s).replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    return t.slice(0, max - 1) + '\u2026';
  }

  function buildSelectorPath(node) {
    var parts = [];
    var cur = node;
    while (cur && cur.nodeType === 1 && cur.tagName && cur.tagName.toLowerCase() !== 'html') {
      var tag = cur.tagName.toLowerCase();
      var parent = cur.parentElement;
      if (!parent) break;
      var siblings = [].slice.call(parent.children).filter(function (c) {
        return c.tagName === cur.tagName;
      });
      var idx = siblings.indexOf(cur) + 1;
      parts.unshift(siblings.length > 1 ? tag + ':nth-of-type(' + idx + ')' : tag);
      cur = parent;
    }
    return parts.length ? parts.join(' > ') : '';
  }

  function getMaxNumericEditorIndex(doc) {
    var max = -1;
    if (!doc || !doc.querySelectorAll) return max;
    [].forEach.call(doc.querySelectorAll('[' + EDITOR_ID_ATTR + ']'), function (el) {
      var v = el.getAttribute(EDITOR_ID_ATTR) || '';
      var m = new RegExp('^' + EDITOR_ID_PREFIX + '(\\d+)$').exec(v);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return max;
  }

  /**
   * Visible text is covered if some ancestor carries data-editor-id.
   */
  function isTextNodeInsideEditorHost(textNode) {
    var el = textNode.parentElement;
    while (el) {
      if (el.hasAttribute && el.hasAttribute(EDITOR_ID_ATTR)) return true;
      el = el.parentElement;
    }
    return false;
  }

  function subtreeTextFullyUnderEditorHosts(rootEl) {
    var doc = rootEl.ownerDocument;
    if (!doc) return false;
    var sawVisible = false;
    var tw = doc.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentElement;
        if (!p || !rootEl.contains(p)) return NodeFilter.FILTER_REJECT;
        var t = p.tagName.toLowerCase();
        if (t === 'script' || t === 'style' || t === 'noscript' || t === 'template')
          return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest('svg')) return NodeFilter.FILTER_REJECT;
        if (t === 'textarea') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (tw.nextNode()) {
      var tn = tw.currentNode;
      if (!tn.data || !/\S/.test(tn.data)) continue;
      sawVisible = true;
      if (!isTextNodeInsideEditorHost(tn)) return false;
    }
    return sawVisible;
  }

  /**
   * Wrap unhosted visible text. Idempotent: second pass finds all text under [data-editor-id] and wraps nothing.
   */
  function wrapUnhostedVisibleText(doc) {
    var audit = [];
    if (!doc.body) return audit;

    var next = getMaxNumericEditorIndex(doc) + 1;
    var batch = [];
    var tw = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        var t = p.tagName.toLowerCase();
        if (t === 'script' || t === 'style' || t === 'noscript' || t === 'template')
          return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest('svg')) return NodeFilter.FILTER_REJECT;
        if (t === 'textarea') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (tw.nextNode()) batch.push(tw.currentNode);

    for (var i = 0; i < batch.length; i++) {
      var textNode = batch[i];
      var raw = textNode.data;
      if (!raw || !/\S/.test(raw)) continue;
      if (isTextNodeInsideEditorHost(textNode)) continue;

      var parent = textNode.parentElement;
      if (!parent) continue;

      var id = EDITOR_ID_PREFIX + next;
      next += 1;

      audit.push({
        assignedId: id,
        parentTag: parent.tagName.toLowerCase(),
        parentSelectorHint: buildSelectorPath(parent),
        textPreview: truncate(raw.replace(/\s+/g, ' ').trim(), 80),
      });

      var span = doc.createElement('span');
      span.setAttribute(EDITOR_ID_ATTR, id);
      span.setAttribute('class', PLAINSTACK_RUN_CLASS);
      var preserved = textNode.data;
      parent.replaceChild(span, textNode);
      span.appendChild(doc.createTextNode(preserved));
    }

    return audit;
  }

  /**
   * Merge adjacent sibling span[data-editor-id] that are "plain" (only data-editor-id, text children only).
   * Reduces fragmentation from neighboring text nodes; keeps first id. Idempotent when nothing mergeable.
   */
  function mergeAdjacentPlainEditorSpans(doc) {
    if (!doc.body) return 0;

    function isPlainRunWrapper(el) {
      if (!el || el.nodeType !== 1) return false;
      if (el.tagName.toLowerCase() !== 'span') return false;
      if (!el.hasAttribute(EDITOR_ID_ATTR)) return false;
      var al = el.attributes.length;
      if (al !== 1 && al !== 2) return false;
      if (al === 2 && el.getAttribute('class') !== PLAINSTACK_RUN_CLASS) return false;
      var hi;
      for (hi = 0; hi < el.attributes.length; hi++) {
        var nm = el.attributes[hi].name;
        if (nm !== EDITOR_ID_ATTR && nm !== 'class') return false;
      }
      for (var c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 3) return false;
      }
      return true;
    }

    var merged = 0;
    var containers = [doc.body];
    [].forEach.call(doc.body.querySelectorAll('*'), function (el) {
      containers.push(el);
    });

    for (var pi = 0; pi < containers.length; pi++) {
      var parent = containers[pi];
      var child = parent.firstChild;
      while (child) {
        var next = child.nextSibling;
        if (child.nodeType === 1 && next && next.nodeType === 1) {
          var a = child;
          var b = next;
          if (isPlainRunWrapper(a) && isPlainRunWrapper(b)) {
            while (b.firstChild) a.appendChild(b.firstChild);
            b.remove();
            merged++;
            continue;
          }
        }
        child = next;
      }
    }
    return merged;
  }

  function verifyAllVisibleTextUnderEditorHost(doc) {
    var failures = [];
    if (!doc.body) return { ok: true, failures: failures };

    var tw = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        var t = p.tagName.toLowerCase();
        if (t === 'script' || t === 'style' || t === 'noscript' || t === 'template')
          return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest('svg')) return NodeFilter.FILTER_REJECT;
        if (t === 'textarea') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (tw.nextNode()) {
      var tn = tw.currentNode;
      if (!tn.data || !/\S/.test(tn.data)) continue;
      if (!isTextNodeInsideEditorHost(tn)) {
        failures.push({
          textPreview: truncate((tn.data || '').replace(/\s+/g, ' ').trim(), 80),
          parentTag: tn.parentElement ? tn.parentElement.tagName.toLowerCase() : '?',
        });
      }
    }
    return { ok: failures.length === 0, failures: failures };
  }

  function runPlainstackInlineNormalize(doc) {
    var audit = wrapUnhostedVisibleText(doc);
    var merged = mergeAdjacentPlainEditorSpans(doc);
    return { audit: audit, mergedAdjacentSpans: merged };
  }

  /** @type {typeof global.plainstackNormalize} */
  var api = {
    EDITOR_ID_ATTR: EDITOR_ID_ATTR,
    EDITOR_ID_PREFIX: EDITOR_ID_PREFIX,
    PLAINSTACK_RUN_CLASS: PLAINSTACK_RUN_CLASS,
    getMaxNumericEditorIndex: getMaxNumericEditorIndex,
    isTextNodeInsideEditorHost: isTextNodeInsideEditorHost,
    subtreeTextFullyUnderEditorHosts: subtreeTextFullyUnderEditorHosts,
    wrapUnhostedVisibleText: wrapUnhostedVisibleText,
    mergeAdjacentPlainEditorSpans: mergeAdjacentPlainEditorSpans,
    verifyAllVisibleTextUnderEditorHost: verifyAllVisibleTextUnderEditorHost,
    runPlainstackInlineNormalize: runPlainstackInlineNormalize,
  };

  // jsdom: window.eval can leave globalThis as Node's global, not the Window — expose on both.
  var root =
    typeof globalThis !== 'undefined'
      ? globalThis
      : typeof window !== 'undefined'
        ? window
        : typeof self !== 'undefined'
          ? self
          : this;
  if (root) root.plainstackNormalize = api;
  if (typeof window !== 'undefined' && window !== root) window.plainstackNormalize = api;
})();
