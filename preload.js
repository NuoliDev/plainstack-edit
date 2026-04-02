const { contextBridge, ipcRenderer } = require('electron');

/**
 * Same directory URL as Node path.dirname + pathToFileURL, without Node APIs.
 * Preload may run with sandbox enabled — require('node:path') would crash the script.
 * @param {string} filePath
 * @returns {string}
 */
function filePathToBaseHref(filePath) {
  if (typeof filePath !== 'string' || !filePath) return '';
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

/**
 * Secure bridge: renderer never gets raw Node APIs.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Opens file dialog; main process reads file and returns path + UTF-8 content.
   * @returns {Promise<{ path: string, content: string } | { path: string, error: string, content: null } | null>}
   */
  openHtmlFile() {
    return ipcRenderer.invoke('open-html-file');
  },

  /**
   * Directory URL (with trailing slash) for the opened file, for preview <base href>.
   * @param {string} filePath absolute path to the .html file
   * @returns {string} e.g. file:///Users/me/slides/
   */
  filePathToBaseHref,

  /**
   * Write HTML to an existing path (UTF-8).
   * @param {{ path: string, html: string }} payload
   * @returns {Promise<{ ok: true, path: string } | { ok: false, error: string }>}
   */
  saveHtmlFile(payload) {
    return ipcRenderer.invoke('save-html-file', payload);
  },

  /**
   * Save dialog, then write HTML (UTF-8).
   * @param {{ defaultPath?: string, html: string }} payload
   * @returns {Promise<{ ok: true, path: string } | { ok: false, cancelled: true } | { ok: false, error: string }>}
   */
  saveHtmlFileAs(payload) {
    return ipcRenderer.invoke('save-html-file-as', payload);
  },

  /**
   * @param {{ html: string, defaultPath?: string }} payload
   */
  exportHtmlToPdf(payload) {
    return ipcRenderer.invoke('export-html-to-pdf', payload);
  },
});
