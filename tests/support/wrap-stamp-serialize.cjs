/**
 * Test harness: same rules as public/renderer.js for isEditableElement + stampEditorIds + serialize.
 * Keep in sync with renderer.js when stamping logic changes.
 */
const EDITABLE_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'a', 'blockquote', 'small', 'td', 'th', 'figcaption', 'button', 'label',
  'strong', 'em', 'b', 'i',
]);

const PHRASING_CHILD_TAGS = new Set([
  'span', 'a', 'strong', 'em', 'b', 'i', 'u', 'small', 'br', 'mark', 'code', 'abbr', 'time', 'sub', 'sup', 'kbd', 'wbr',
  's', 'del', 'ins', 'cite', 'bdi', 'bdo', 'ruby', 'rt', 'rp', 'data', 'q', 'samp', 'var',
]);

const BLOCK_OR_STRUCTURAL_DESCENDANT = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'blockquote', 'figure', 'figcaption', 'td', 'th', 'button', 'label',
  'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav', 'form', 'ul', 'ol', 'table', 'pre', 'hr',
  'dl', 'dt', 'dd', 'fieldset', 'address', 'video', 'audio', 'canvas', 'iframe',
]);

const EDITOR_ID_ATTR = 'data-editor-id';
const EDITOR_ID_PREFIX = 'ed-';

function isInsideSvg(node) {
  return !!(node.closest && node.closest('svg'));
}

function isHiddenLike(el) {
  if (el.closest('template')) return true;
  if (el.hasAttribute('hidden')) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  const style = el.getAttribute('style');
  if (style && /display\s*:\s*none/i.test(style)) return true;
  return false;
}

function getDirectTextContent(element) {
  let text = '';
  for (const child of element.childNodes) {
    if (child.nodeType === 3) {
      text += child.textContent || '';
    }
  }
  return text;
}

function getVisibleTextPreview(element) {
  const tag = element.tagName.toLowerCase();
  if (tag === 'a' || tag === 'button' || tag === 'label') {
    const direct = getDirectTextContent(element).trim();
    if (direct) return direct;
  }
  return (element.textContent || '').trim();
}

function isLikelyTextHolderSpanOrDiv(element) {
  const tag = element.tagName.toLowerCase();
  if (tag !== 'span' && tag !== 'div') return false;
  if (isHiddenLike(element) || isInsideSvg(element)) return false;
  const text = (element.textContent || '').trim();
  if (!text) return false;

  const descendants = element.querySelectorAll('*');
  if (descendants.length > 14) return false;

  for (const d of descendants) {
    const t = d.tagName.toLowerCase();
    if (BLOCK_OR_STRUCTURAL_DESCENDANT.has(t)) return false;
    if (!PHRASING_CHILD_TAGS.has(t) && t !== 'br') return false;
  }

  const elemChildren = Array.from(element.children);
  if (elemChildren.length === 1) {
    const only = elemChildren[0].tagName.toLowerCase();
    if (only === 'span' || only === 'div' || only === 'a' || only === 'button' || only === 'label') {
      return false;
    }
  }

  return true;
}

function isEditableElement(element) {
  if (!element || element.nodeType !== 1) return false;
  const tag = element.tagName.toLowerCase();
  if (tag === 'script' || tag === 'style' || tag === 'noscript') return false;
  if (tag === 'svg' || isInsideSvg(element)) return false;
  if (isHiddenLike(element)) return false;

  if (EDITABLE_TAGS.has(tag)) {
    return !!getVisibleTextPreview(element);
  }

  if (tag === 'span' || tag === 'div') {
    return isLikelyTextHolderSpanOrDiv(element);
  }

  return false;
}

/**
 * @param {import('jsdom').JSDOM['window']['Document']} doc
 * @param {{ getMaxNumericEditorIndex: (d: Document) => number; subtreeTextFullyUnderEditorHosts: (el: Element) => boolean }} pn
 */
function stampEditorIds(doc, pn) {
  if (!doc.body) return 0;
  let n = pn.getMaxNumericEditorIndex(doc) + 1;

  const walk = (node) => {
    if (node.nodeType !== 1) return;
    const element = /** @type {Element} */ (node);
    const tag = element.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript') return;
    if (tag === 'svg' || isInsideSvg(element)) return;

    if (isEditableElement(element)) {
      if (!element.hasAttribute(EDITOR_ID_ATTR)) {
        if (pn.subtreeTextFullyUnderEditorHosts(element)) {
          /* skip */
        } else {
          element.setAttribute(EDITOR_ID_ATTR, `${EDITOR_ID_PREFIX}${n}`);
          n += 1;
        }
      }
    }
    for (const child of element.children) {
      walk(child);
    }
  };
  walk(doc.body);
  return n;
}

function serializeHtmlDocument(doc) {
  let out = '';
  if (doc.doctype) {
    out += `<!DOCTYPE ${doc.doctype.name}>\n`;
  }
  if (doc.documentElement) {
    out += doc.documentElement.outerHTML;
  }
  return out;
}

module.exports = {
  stampEditorIds,
  serializeHtmlDocument,
  EDITOR_ID_ATTR,
};
