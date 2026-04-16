/**
 * Apply committed plain text to [data-editor-id] hosts without flattening inline
 * markup when a single phrasing wrapper holds the text (span/strong/em/b/i).
 * Loaded before renderer.js; attaches globalThis.plainstackEditorHostSync.
 */
(function initPlainstackEditorHostSync() {
  var INLINE_PHRASING = { span: 1, strong: 1, em: 1, b: 1, i: 1 };

  function normalizeNewlines(s) {
    return String(s ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
  }

  /**
   * Replace host content with plain text (one run), preserving one level of phrasing when safe.
   * @param {Element} host
   * @param {string} newText
   */
  function applyPlainTextToEditorHost(host, newText) {
    var t = normalizeNewlines(newText);
    var doc = host.ownerDocument;
    if (!doc) {
      host.textContent = t;
      return;
    }

    /** @type {Element[]} */
    var nonBrElements = [];
    var ch = host.firstChild;
    while (ch) {
      if (ch.nodeType === 1) {
        var tag = ch.tagName && ch.tagName.toLowerCase();
        if (tag !== 'br') nonBrElements.push(/** @type {Element} */ (ch));
      }
      ch = ch.nextSibling;
    }

    if (nonBrElements.length === 0) {
      while (host.firstChild) host.removeChild(host.firstChild);
      host.appendChild(doc.createTextNode(t));
      return;
    }

    if (nonBrElements.length === 1) {
      var inner = nonBrElements[0];
      var tn = inner.tagName && inner.tagName.toLowerCase();
      if (
        INLINE_PHRASING[tn] &&
        inner.childNodes.length === 1 &&
        inner.firstChild.nodeType === 3
      ) {
        inner.firstChild.data = t;
        return;
      }
    }

    var tw = doc.createTreeWalker(host, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var n;
    while ((n = tw.nextNode())) nodes.push(n);
    if (nodes.length === 1) {
      nodes[0].data = t;
      return;
    }

    host.textContent = t;
  }

  var api = {
    applyPlainTextToEditorHost: applyPlainTextToEditorHost,
    normalizeNewlines: normalizeNewlines,
  };

  var root =
    typeof globalThis !== 'undefined'
      ? globalThis
      : typeof window !== 'undefined'
        ? window
        : typeof self !== 'undefined'
          ? self
          : this;
  if (root) root.plainstackEditorHostSync = api;
  if (typeof window !== 'undefined' && window !== root) window.plainstackEditorHostSync = api;
})();
