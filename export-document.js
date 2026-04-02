/**
 * Portable export helpers for print/PDF — no DOM round-trip.
 * Re-parsing with DOMParser + outerHTML can normalize HTML and shift layout;
 * stripping editor-only attributes from the serialized string preserves bytes
 * outside those attributes (reusable for web/Firebase: same string transform).
 *
 * Print/export mode (html.print-mode, viewport, export-print.css) is applied in
 * the main process when building the temporary file for printToPDF — not here.
 */

/**
 * Remove data-editor-id attributes from a full document string from serializeHtmlDocument().
 * @param {string} serializedHtml
 * @returns {string}
 */
function stripEditorIdsFromSerializedHtml(serializedHtml) {
  return String(serializedHtml ?? '')
    .replace(/\s+data-editor-id="[^"]*"/gi, '')
    .replace(/\s+data-editor-id='[^']*'/gi, '');
}

if (typeof window !== 'undefined') {
  window.stripEditorIdsFromSerializedHtml = stripEditorIdsFromSerializedHtml;
}
