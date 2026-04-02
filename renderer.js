/**
 * HTML Text Editor Preview — renderer (Sprint 3)
 * Open/save HTML, preview in iframe (srcdoc), workingDom, inline edit, canonical sidebar.
 */

/** @typedef {{ id: string, editorId: string, tagName: string, textPreview: string, headingLevel?: number, path: string, containerHint?: string }} EditableMeta */

const EDITABLE_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'a',
  'blockquote',
  'small',
  'td',
  'th',
  'figcaption',
  'button',
  'label',
]);

/** Phrasing content allowed inside span/div text holders (no layout blocks). */
const PHRASING_CHILD_TAGS = new Set([
  'span',
  'a',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'small',
  'br',
  'mark',
  'code',
  'abbr',
  'time',
  'sub',
  'sup',
  'kbd',
  'wbr',
  's',
  'del',
  'ins',
  'cite',
  'bdi',
  'bdo',
  'ruby',
  'rt',
  'rp',
  'data',
  'q',
  'samp',
  'var',
]);

/** Block / structural descendants: if inside div/span candidate, wrapper is skipped (child is edited). */
const BLOCK_OR_STRUCTURAL_DESCENDANT = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'blockquote',
  'figure',
  'figcaption',
  'td',
  'th',
  'button',
  'label',
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'aside',
  'nav',
  'form',
  'ul',
  'ol',
  'table',
  'pre',
  'hr',
  'dl',
  'dt',
  'dd',
  'fieldset',
  'address',
  'video',
  'audio',
  'canvas',
  'iframe',
]);

/** Single-line-ish: Enter commits. */
const COMMIT_ENTER_SINGLE_LINE = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'button',
  'label',
  'a',
  'small',
  'span',
  'div',
]);

const CONTAINER_TAGS = new Set(['section', 'article', 'main', 'aside', 'nav']);

const MAX_PREVIEW_LEN = 80;

const EDITOR_ID_ATTR = 'data-editor-id';

const EDITOR_ID_PREFIX = 'ed-';

const el = (id) => document.getElementById(id);

function truncate(s, max = MAX_PREVIEW_LEN) {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function normalizePlainText(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

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
    if (child.nodeType === Node.TEXT_NODE) {
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

/**
 * span/div: likely a text leaf or small phrasing cluster, not a layout wrapper.
 * @param {Element} element
 * @returns {boolean}
 */
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


/**
 * Approved visible text-bearing element for editing (must have non-empty preview).
 * @param {Element} element
 * @returns {boolean}
 */
function isEditableElement(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
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

function buildSelectorPath(node) {
  const parts = [];
  let cur = node;
  while (cur && cur.nodeType === Node.ELEMENT_NODE && cur.tagName.toLowerCase() !== 'html') {
    const tag = cur.tagName.toLowerCase();
    const parent = cur.parentElement;
    if (!parent) break;
    const siblings = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
    const idx = siblings.indexOf(cur) + 1;
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
    cur = parent;
  }
  return parts.length ? parts.join(' > ') : '';
}

function getContainerHint(node) {
  let p = node.parentElement;
  while (p) {
    const t = p.tagName.toLowerCase();
    if (CONTAINER_TAGS.has(t)) return t;
    const tag = p.tagName.toLowerCase();
    if (tag === 'header' || tag === 'footer') return tag;
    p = p.parentElement;
  }
  return undefined;
}

/**
 * @param {Document} doc
 * @returns {number} count stamped
 */
function stampEditorIds(doc) {
  if (!doc.body) return 0;
  let n = 0;
  const walk = (node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = /** @type {Element} */ (node);
    const tag = element.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript') return;
    if (tag === 'svg' || isInsideSvg(element)) return;

    if (isEditableElement(element)) {
      element.setAttribute(EDITOR_ID_ATTR, `${EDITOR_ID_PREFIX}${n}`);
      n += 1;
    }
    for (const child of element.children) {
      walk(child);
    }
  };
  walk(doc.body);
  return n;
}

/**
 * @param {Document | Element} root
 * @returns {Element[]}
 */
function collectEditableCandidates(root) {
  /** @type {Element[]} */
  const out = [];
  const doc = root.nodeType === Node.DOCUMENT_NODE ? /** @type {Document} */ (root) : null;
  const treeRoot = doc ? doc.documentElement : /** @type {Element} */ (root);

  const walk = (node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = /** @type {Element} */ (node);
    const tag = element.tagName.toLowerCase();

    if (tag === 'script' || tag === 'style' || tag === 'noscript') return;
    if (tag === 'svg' || isInsideSvg(element)) return;

    if (isEditableElement(element) && element.hasAttribute(EDITOR_ID_ATTR)) {
      const preview = getVisibleTextPreview(element);
      if (preview) out.push(element);
    }

    for (const child of element.children) {
      walk(child);
    }
  };

  const body = doc ? doc.body : treeRoot;
  if (body) walk(body);
  return out;
}

function elementToMeta(element, index) {
  const tag = element.tagName.toLowerCase();
  const editorId = element.getAttribute(EDITOR_ID_ATTR) || `cand-${index}`;
  /** @type {EditableMeta} */
  const meta = {
    id: editorId,
    editorId,
    tagName: tag,
    textPreview: truncate(getVisibleTextPreview(element)),
    path: buildSelectorPath(element),
    containerHint: getContainerHint(element),
  };
  if (/^h[1-6]$/.test(tag)) {
    meta.headingLevel = parseInt(tag.slice(1), 10);
  }
  return meta;
}

/**
 * Canonical editable list: every stamped node in document order (same walk as collectEditableCandidates).
 * @param {Document} doc
 * @returns {{ items: EditableMeta[] }}
 */
function buildCanonicalEditableModel(doc) {
  const elements = collectEditableCandidates(doc);
  const items = elements.map((el, i) => elementToMeta(el, i));
  return { items };
}

/**
 * @param {Document} idoc
 * @param {string} editorId
 * @returns {Element | null}
 */
function findLiveElementByEditorId(idoc, editorId) {
  if (!idoc || !editorId) return null;
  if (!/^ed-[0-9]+$/.test(editorId)) return null;
  return idoc.querySelector(`[${EDITOR_ID_ATTR}="${editorId}"]`);
}

function insertBaseAtHeadStart(doc, baseHref) {
  let head = doc.head;
  if (!head && doc.documentElement) {
    head = doc.createElement('head');
    doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
  }
  if (!head) return;
  const prev = head.querySelector('base');
  if (prev) prev.remove();
  const base = doc.createElement('base');
  base.setAttribute('href', baseHref);
  head.insertBefore(base, head.firstChild);
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

function injectBaseIntoHtml(html, baseHref) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  insertBaseAtHeadStart(doc, baseHref);
  return serializeHtmlDocument(doc);
}

function fallbackFilePathToBaseHref(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const dirWithSlash = normalized.includes('/')
    ? normalized.slice(0, normalized.lastIndexOf('/') + 1)
    : `${normalized}/`;
  if (/^[a-zA-Z]:/.test(dirWithSlash)) {
    return `file:///${dirWithSlash}`;
  }
  if (dirWithSlash.startsWith('/')) {
    return `file://${dirWithSlash}`;
  }
  return `file:///${dirWithSlash}`;
}

// --- UI state ---

/** @type {Document | null} */
let workingDom = null;

/** @type {string} */
let lastHtml = '';

/** @type {string} */
let lastResolvedBaseHref = '';

/** Absolute path of the file last opened or saved to; null if none. */
/** @type {string | null} */
let currentFilePath = null;

/** @type {EditableMeta[]} */
let lastCanonicalEditableItems = [];

/** @type {string | null} */
let activeOutlineEditorId = null;

/** @type {Element | null} */
let activeEditEl = null;

/** @type {string} */
let preEditTextSnapshot = '';

/** @type {number | undefined} */
let blurFinishTimer;

/** @type {(() => void) | null} */
let activeBlurHandler = null;

/** @type {boolean} */
let documentDirty = false;

/** @type {number | undefined} */
let saveToastTimer;

function syncLiveEditToWorkingDom(editorId, newText) {
  if (!workingDom) return;
  const safeId = editorId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (safeId !== editorId) return;
  const w = workingDom.querySelector(`[${EDITOR_ID_ATTR}="${safeId}"]`);
  if (w) {
    w.textContent = normalizePlainText(newText);
  }
}

/**
 * @param {string | null} editorId
 */
function setActiveOutlineEditorId(editorId) {
  activeOutlineEditorId = editorId;
  highlightActiveOutlineRow();
}

function highlightActiveOutlineRow() {
  const list = el('outline-list');
  if (!list) return;
  list.querySelectorAll('.outline-item.active').forEach((b) => b.classList.remove('active'));
  const id = activeOutlineEditorId;
  if (!id) return;
  const btn = list.querySelector(`button.outline-item[${EDITOR_ID_ATTR}="${id}"]`);
  if (btn) {
    btn.classList.add('active');
    try {
      btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch {
      btn.scrollIntoView({ block: 'nearest' });
    }
  }
}

function rebuildOutline() {
  const frame = /** @type {HTMLIFrameElement} */ (el('preview-frame'));
  const idoc = frame.contentDocument;
  if (!workingDom || !idoc) return;

  const preserveId = activeOutlineEditorId;
  const stillValid = !!(preserveId && workingDom.querySelector(`[${EDITOR_ID_ATTR}="${preserveId}"]`));
  activeOutlineEditorId = stillValid ? preserveId : null;

  const { items } = buildCanonicalEditableModel(workingDom);
  lastCanonicalEditableItems = items;
  renderCanonicalSidebar(items);
}

function setDirty(d) {
  documentDirty = d;
  const hint = el('dirty-hint');
  if (hint) hint.hidden = !d;
  const fn = el('filename');
  if (fn) fn.classList.toggle('is-dirty', d);
}

function detachActiveBlurListener() {
  if (blurFinishTimer !== undefined) {
    clearTimeout(blurFinishTimer);
    blurFinishTimer = undefined;
  }
  if (activeEditEl && activeBlurHandler) {
    activeEditEl.removeEventListener('blur', activeBlurHandler);
  }
  activeBlurHandler = null;
}

function discardActiveEditNoSync() {
  detachActiveBlurListener();
  if (!activeEditEl) return;
  const node = activeEditEl;
  activeEditEl = null;
  preEditTextSnapshot = '';
  node.contentEditable = 'false';
  node.classList.remove('preview-editing');
}

function beginInlineEdit(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
  if (!element.getAttribute(EDITOR_ID_ATTR)) return;
  if (!isEditableElement(element)) return;

  const eid = element.getAttribute(EDITOR_ID_ATTR);
  if (eid) setActiveOutlineEditorId(eid);

  if (activeEditEl && activeEditEl !== element) {
    commitInlineEdit(activeEditEl);
  }
  if (activeEditEl === element) return;

  activeEditEl = element;
  preEditTextSnapshot = element.textContent ?? '';
  element.contentEditable = 'true';
  element.classList.add('preview-editing');

  const frame = /** @type {HTMLIFrameElement} */ (el('preview-frame'));
  const idoc = element.ownerDocument;
  try {
    frame.contentWindow?.focus();
  } catch {
    /* ignore */
  }
  element.focus();

  const win = idoc.defaultView;
  const sel = win?.getSelection();
  if (sel && idoc) {
    try {
      const r = idoc.createRange();
      r.selectNodeContents(element);
      sel.removeAllRanges();
      sel.addRange(r);
    } catch {
      /* ignore */
    }
  }

  const onBlur = () => {
    blurFinishTimer = window.setTimeout(() => {
      blurFinishTimer = undefined;
      if (activeEditEl !== element) return;
      const active = element.ownerDocument?.activeElement;
      if (active && (active === element || element.contains(active))) return;
      commitInlineEdit(element);
    }, 0);
  };
  activeBlurHandler = onBlur;
  element.addEventListener('blur', onBlur, { passive: true });
}

function commitInlineEdit(element) {
  if (!element || activeEditEl !== element) return;
  const editorId = element.getAttribute(EDITOR_ID_ATTR);
  if (!editorId) return;

  detachActiveBlurListener();
  activeEditEl = null;
  preEditTextSnapshot = '';
  element.contentEditable = 'false';
  element.classList.remove('preview-editing');

  const text = normalizePlainText(element.textContent ?? '');
  syncLiveEditToWorkingDom(editorId, text);
  lastHtml = serializeHtmlDocument(workingDom);
  setDirty(true);
  rebuildOutline();
}

function cancelInlineEdit(element) {
  if (!element || activeEditEl !== element) return;

  detachActiveBlurListener();
  activeEditEl = null;
  element.textContent = preEditTextSnapshot;
  preEditTextSnapshot = '';
  element.contentEditable = 'false';
  element.classList.remove('preview-editing');
}

function attachPreviewEditListeners(frame) {
  const idoc = frame.contentDocument;
  if (!idoc) return;
  injectPreviewEditStyles(idoc);

  idoc.addEventListener(
    'click',
    (e) => {
      const raw = e.target;
      const start =
        raw && raw.nodeType === Node.TEXT_NODE ? /** @type {Node} */ (raw).parentElement : /** @type {Element} */ (raw);
      if (!start || start.nodeType !== Node.ELEMENT_NODE) return;
      const block = /** @type {Element} */ (start).closest(`[${EDITOR_ID_ATTR}]`);
      if (!block || !isEditableElement(block)) return;
      if (activeEditEl === block) return;

      e.preventDefault();
      e.stopPropagation();
      beginInlineEdit(block);
    },
    true
  );

  idoc.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') {
        if (activeEditEl) {
          e.preventDefault();
          cancelInlineEdit(activeEditEl);
        }
        return;
      }
      if (e.key !== 'Enter' || !activeEditEl) return;
      const elNode = activeEditEl;
      const tag = elNode.tagName.toLowerCase();
      if (COMMIT_ENTER_SINGLE_LINE.has(tag)) {
        e.preventDefault();
        commitInlineEdit(elNode);
        return;
      }
      e.preventDefault();
      commitInlineEdit(elNode);
    },
    true
  );

  idoc.addEventListener(
    'paste',
    (e) => {
      if (!activeEditEl || !activeEditEl.contains(/** @type {Node} */ (e.target))) return;
      e.preventDefault();
      const plain = normalizePlainText(e.clipboardData?.getData('text/plain') ?? '');
      const doc = idoc;
      if (doc.execCommand) {
        doc.execCommand('insertText', false, plain);
      } else {
        const sel = idoc.defaultView?.getSelection();
        if (sel?.rangeCount) {
          const r = sel.getRangeAt(0);
          r.deleteContents();
          r.insertNode(doc.createTextNode(plain));
        }
      }
    },
    true
  );
}

function injectPreviewEditStyles(idoc) {
  if (!idoc.head || idoc.getElementById('preview-editor-styles')) return;
  const s = idoc.createElement('style');
  s.id = 'preview-editor-styles';
  s.textContent = `
    [${EDITOR_ID_ATTR}] { cursor: text; }
    [${EDITOR_ID_ATTR}]:hover:not(.preview-editing) {
      outline: 1px dashed rgba(13, 110, 253, 0.45);
      outline-offset: 2px;
    }
    .preview-editing {
      outline: 2px solid #0d6efd;
      outline-offset: 2px;
    }
  `;
  idoc.head.appendChild(s);
}

function setSidebarMessage(text, isError = false) {
  const box = el('sidebar-message');
  box.textContent = text;
  box.classList.toggle('is-error', isError);
}

function setPreviewError(message) {
  const err = el('preview-error');
  if (!message) {
    err.hidden = true;
    err.textContent = '';
    return;
  }
  err.hidden = false;
  err.textContent = message;
}

function showToolbarToast(message, isError = false) {
  const t = el('toolbar-toast');
  if (!t) return;
  if (saveToastTimer !== undefined) {
    clearTimeout(saveToastTimer);
  }
  t.textContent = message;
  t.classList.toggle('is-error', isError);
  t.hidden = false;
  saveToastTimer = window.setTimeout(() => {
    t.hidden = true;
    t.classList.remove('is-error');
    saveToastTimer = undefined;
  }, 3200);
}

/**
 * Copy live edit text into workingDom so serializeHtmlDocument(workingDom) matches the preview.
 */
function flushActiveEditToWorkingDom() {
  if (!activeEditEl || !workingDom) return;
  const editorId = activeEditEl.getAttribute(EDITOR_ID_ATTR);
  if (!editorId) return;
  syncLiveEditToWorkingDom(editorId, normalizePlainText(activeEditEl.textContent ?? ''));
  lastHtml = serializeHtmlDocument(workingDom);
}

/**
 * Reload iframe from workingDom and reattach listeners (e.g. after Save As to a new folder changes <base>).
 */
function refreshIframeFromWorkingDom() {
  if (!workingDom) return;
  lastHtml = serializeHtmlDocument(workingDom);
  const frame = /** @type {HTMLIFrameElement} */ (el('preview-frame'));
  frame.removeAttribute('srcdoc');
  frame.srcdoc = lastHtml;
  frame.onload = () => {
    const idoc = frame.contentDocument;
    if (!idoc) return;
    attachPreviewEditListeners(frame);
    rebuildOutline();
  };
}

/**
 * @param {string} newPath absolute path
 */
function applySavedPathAndRefreshPreview(newPath) {
  discardActiveEditNoSync();
  currentFilePath = newPath;
  const fn = el('filename');
  if (fn) {
    fn.textContent = pathBasename(newPath);
    fn.title = newPath;
  }
  const api = window.electronAPI;
  lastResolvedBaseHref = api?.filePathToBaseHref ? api.filePathToBaseHref(newPath) : fallbackFilePathToBaseHref(newPath);
  if (workingDom) {
    insertBaseAtHeadStart(workingDom, lastResolvedBaseHref);
    refreshIframeFromWorkingDom();
  }
}

async function onSaveClick() {
  const api = window.electronAPI;
  if (!api?.saveHtmlFile) {
    showToolbarToast('Save is not available.', true);
    return;
  }
  if (!workingDom) {
    showToolbarToast('Nothing to save.', true);
    return;
  }
  if (!currentFilePath) {
    await onSaveAsClick();
    return;
  }
  flushActiveEditToWorkingDom();
  const html = serializeHtmlDocument(workingDom);
  const result = await api.saveHtmlFile({ path: currentFilePath, html });
  if (result && result.ok) {
    lastHtml = html;
    setDirty(false);
    showToolbarToast('Saved');
  } else {
    showToolbarToast(result?.error ?? 'Save failed', true);
  }
}

async function onSaveAsClick() {
  const api = window.electronAPI;
  if (!api?.saveHtmlFileAs) {
    showToolbarToast('Save As is not available.', true);
    return;
  }
  if (!workingDom) {
    showToolbarToast('Nothing to save.', true);
    return;
  }
  flushActiveEditToWorkingDom();
  const html = serializeHtmlDocument(workingDom);
  const result = await api.saveHtmlFileAs({
    defaultPath: currentFilePath || '',
    html,
  });
  if (result?.ok && result.path) {
    applySavedPathAndRefreshPreview(result.path);
    setDirty(false);
    showToolbarToast('Saved');
  } else if (result?.cancelled) {
    /* user cancelled — keep dirty */
  } else {
    showToolbarToast(result?.error ?? 'Save failed', true);
  }
}

async function onExportPdfClick() {
  const api = window.electronAPI;
  if (!api?.exportHtmlToPdf) {
    showToolbarToast('Export PDF is not available.', true);
    return;
  }
  if (!workingDom) {
    showToolbarToast('Nothing to export. Open an HTML file first.', true);
    return;
  }
  if (typeof window.stripEditorIdsFromSerializedHtml !== 'function') {
    showToolbarToast('Export module not loaded.', true);
    return;
  }
  flushActiveEditToWorkingDom();
  const serialized = serializeHtmlDocument(workingDom);
  const html = window.stripEditorIdsFromSerializedHtml(serialized);
  const result = await api.exportHtmlToPdf({
    html,
    defaultPath: currentFilePath || undefined,
  });
  if (result?.ok) {
    showToolbarToast('PDF exported');
  } else if (result?.cancelled) {
    /* user cancelled save dialog */
  } else {
    showToolbarToast(result?.error ?? 'Export failed', true);
  }
}

function renderCanonicalSidebar(items) {
  const list = el('outline-list');
  list.innerHTML = '';

  if (items.length === 0) {
    setSidebarMessage('No editable text blocks found. Open a different file or add content.', false);
    return;
  }

  setSidebarMessage('All editable blocks (document order). Active row matches by data-editor-id. Click to edit.', false);

  items.forEach((m) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'outline-item';
    btn.setAttribute(EDITOR_ID_ATTR, m.editorId);
    const hl = m.headingLevel;
    if (hl === 1) btn.classList.add('outline-item--h1');
    else if (hl === 2) btn.classList.add('outline-item--h2');
    else if (hl === 3) btn.classList.add('outline-item--h3');
    else if (hl === 4 || hl === 5 || hl === 6) btn.classList.add('outline-item--h4');

    const tagSpan = document.createElement('span');
    tagSpan.className = 'outline-item-tag';
    tagSpan.textContent = m.containerHint ? `${m.tagName} · ${m.containerHint}` : m.tagName;

    const prevSpan = document.createElement('span');
    prevSpan.className = 'outline-item-preview';
    prevSpan.textContent = m.textPreview || '(empty)';

    btn.appendChild(tagSpan);
    btn.appendChild(prevSpan);
    btn.addEventListener('click', () => onOutlineRowClick(m.editorId));
    li.appendChild(btn);
    list.appendChild(li);
  });

  highlightActiveOutlineRow();
}

/**
 * @param {string} editorId
 */
function onOutlineRowClick(editorId) {
  const frame = /** @type {HTMLIFrameElement} */ (el('preview-frame'));
  const doc = frame.contentDocument;
  if (!doc) return;

  const target = findLiveElementByEditorId(doc, editorId);
  if (!target) return;

  setActiveOutlineEditorId(editorId);

  target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  try {
    frame.contentWindow?.focus();
  } catch {
    /* cross-origin shouldn't happen with srcdoc */
  }
  beginInlineEdit(target);
}

function loadHtmlIntoApp(html, filePath = null) {
  discardActiveEditNoSync();
  setActiveOutlineEditorId(null);
  setDirty(false);
  setPreviewError('');

  lastResolvedBaseHref = '';
  let htmlForPreview = html;
  const api = window.electronAPI;
  if (filePath) {
    const baseHref = api?.filePathToBaseHref ? api.filePathToBaseHref(filePath) : fallbackFilePathToBaseHref(filePath);
    lastResolvedBaseHref = baseHref;
    htmlForPreview = injectBaseIntoHtml(html, baseHref);
  }

  let parsed;
  try {
    parsed = new DOMParser().parseFromString(htmlForPreview, 'text/html');
  } catch (e) {
    setPreviewError(`Could not parse HTML: ${e instanceof Error ? e.message : String(e)}`);
    workingDom = null;
    lastCanonicalEditableItems = [];
    lastResolvedBaseHref = '';
    currentFilePath = null;
    renderCanonicalSidebar([]);
    return;
  }

  stampEditorIds(parsed);
  workingDom = parsed;
  currentFilePath = filePath || null;
  lastHtml = serializeHtmlDocument(parsed);

  const { items } = buildCanonicalEditableModel(parsed);
  lastCanonicalEditableItems = items;

  const frame = /** @type {HTMLIFrameElement} */ (el('preview-frame'));
  frame.removeAttribute('srcdoc');
  frame.srcdoc = lastHtml;

  frame.onload = () => {
    const idoc = frame.contentDocument;
    if (!idoc) return;

    const scriptCount = idoc.querySelectorAll('script').length;
    console.log('[preview] iframe loaded');
    console.log('[preview] script tags present:', scriptCount > 0, `count=${scriptCount}`);
    console.log('[preview] resolved base href:', lastResolvedBaseHref || '(none)');

    renderCanonicalSidebar(items);
    attachPreviewEditListeners(frame);
  };
}

async function onOpenClick() {
  const api = window.electronAPI;
  if (!api?.openHtmlFile) {
    setPreviewError('Preload bridge missing. Cannot open files.');
    return;
  }

  const result = await api.openHtmlFile();
  if (result === null) {
    return;
  }

  if ('error' in result && result.error) {
    el('filename').textContent = result.path ? pathBasename(result.path) : 'Error';
    el('filename').title = result.path || '';
    setPreviewError(`Failed to read file: ${result.error}`);
    workingDom = null;
    lastCanonicalEditableItems = [];
    lastResolvedBaseHref = '';
    currentFilePath = null;
    setDirty(false);
    setActiveOutlineEditorId(null);
    renderCanonicalSidebar([]);
    return;
  }

  const pathStr = result.path;
  const content = result.content;
  el('filename').textContent = pathBasename(pathStr);
  el('filename').title = pathStr;

  if (typeof content !== 'string') {
    currentFilePath = null;
    setPreviewError('Invalid file content.');
    return;
  }

  loadHtmlIntoApp(content, pathStr);
}

function pathBasename(p) {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

el('btn-open').addEventListener('click', onOpenClick);

const btnSave = el('btn-save');
const btnSaveAs = el('btn-save-as');
const btnExportPdf = el('btn-export-pdf');
if (btnSave) btnSave.addEventListener('click', () => void onSaveClick());
if (btnSaveAs) btnSaveAs.addEventListener('click', () => void onSaveAsClick());
if (btnExportPdf) btnExportPdf.addEventListener('click', () => void onExportPdfClick());

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activeEditEl) {
    e.preventDefault();
    cancelInlineEdit(activeEditEl);
  }
});

window.__htmlPreviewDebug = {
  getWorkingDom: () => workingDom,
  getLastHtml: () => lastHtml,
  getCanonicalEditableItems: () => lastCanonicalEditableItems,
  getResolvedBaseHref: () => lastResolvedBaseHref,
  getCurrentFilePath: () => currentFilePath,
  getDirty: () => documentDirty,
  getActiveEditElement: () => activeEditEl,
  getActiveOutlineEditorId: () => activeOutlineEditorId,
  syncLiveEditToWorkingDom,
  rebuildOutline,
};
