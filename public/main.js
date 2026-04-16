const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 800,
    minHeight: 500,
    title: 'HTML Text Editor Preview',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Allow srcdoc preview to load relative file:// CSS/JS/assets from the opened file’s folder (distinct from the app bundle path).
      webSecurity: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function focusedOrMainWindow() {
  return BrowserWindow.getFocusedWindow() ?? mainWindow;
}

/**
 * Open a single .html file via system dialog; read contents in main process.
 * Returns null if user cancels or no file selected.
 */
ipcMain.handle('open-html-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open HTML file',
    properties: ['openFile'],
    filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
  });

  if (result.canceled || !result.filePaths?.length) {
    return null;
  }

  const filePath = result.filePaths[0];
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return { path: filePath, content };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      path: filePath,
      content: null,
    };
  }
});

/**
 * @param {Electron.IpcMainInvokeEvent} _e
 * @param {{ path: string, html: string }} payload
 */
ipcMain.handle('save-html-file', async (_e, payload) => {
  const filePath = payload?.path;
  const html = payload?.html;
  if (typeof filePath !== 'string' || !filePath) {
    return { ok: false, error: 'Invalid path' };
  }
  if (typeof html !== 'string') {
    return { ok: false, error: 'Invalid HTML' };
  }
  try {
    await fs.writeFile(filePath, html, 'utf8');
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

/**
 * @param {Electron.IpcMainInvokeEvent} _e
 * @param {{ defaultPath?: string, html: string }} payload
 */
ipcMain.handle('save-html-file-as', async (_e, payload) => {
  const html = payload?.html;
  if (typeof html !== 'string') {
    return { ok: false, error: 'Invalid HTML' };
  }

  const win = focusedOrMainWindow();
  const defaultPath =
    typeof payload?.defaultPath === 'string' && payload.defaultPath
      ? payload.defaultPath
      : path.join(app.getPath('documents'), 'untitled.html');

  const result = await dialog.showSaveDialog(win, {
    title: 'Save HTML as',
    defaultPath,
    filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
  });

  if (result.canceled || !result.filePath) {
    return { ok: false, cancelled: true };
  }

  const savePath = result.filePath;
  try {
    await fs.writeFile(savePath, html, 'utf8');
    return { ok: true, path: savePath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

/**
 * Export/print mode only (temp file for PDF): fixed viewport + html.print-mode.
 * Does not touch the live editor DOM.
 * @param {string} html
 * @returns {string}
 */
/** Fixed layout width for export (must match BrowserWindow width for faithful render). */
const EXPORT_WINDOW_WIDTH = 1400;
const EXPORT_WINDOW_HEIGHT = 2400;

/**
 * Letter landscape: 11in wide, 0.5in left/right @page margin → 10in printable width.
 * CSS px at 96dpi (Chromium print convention for scale math).
 */
const PRINTABLE_WIDTH_PX = Math.round(10 * 96);

const PDF_SCALE_MIN = 0.7;
const PDF_SCALE_MAX = 1.0;

/**
 * @param {number} measuredWidth
 * @returns {number}
 */
function computePdfScale(measuredWidth) {
  if (!Number.isFinite(measuredWidth) || measuredWidth <= 0) {
    return PDF_SCALE_MAX;
  }
  const raw = PRINTABLE_WIDTH_PX / measuredWidth;
  if (raw >= PDF_SCALE_MAX) {
    return PDF_SCALE_MAX;
  }
  if (raw < PDF_SCALE_MIN) {
    return PDF_SCALE_MIN;
  }
  return raw;
}

function injectExportPrintMode(html) {
  const metaViewport = `<meta name="viewport" content="width=${EXPORT_WINDOW_WIDTH}, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no">`;
  let out = html.replace(/<meta\s+[^>]*name=["']viewport["'][^>]*>/gi, '');
  out = out.replace(/<html(\s[^>]*)?>/i, (match, attrs) => {
    const a = attrs || '';
    if (/\sclass=/i.test(a)) {
      return a.includes('print-mode')
        ? match
        : match.replace(/class=(["'])([^"']*)\1/i, (m, q, classes) => `class=${q}${classes} print-mode${q}`);
    }
    return `<html${a} class="print-mode">`;
  });
  if (/<head[^>]*>/i.test(out)) {
    return out.replace(/<head[^>]*>/i, (m) => `${m}\n${metaViewport}\n`);
  }
  return out;
}

/**
 * Insert export print CSS before </head> for the PDF-only temp document.
 * @param {string} html
 * @param {string} cssText
 * @returns {string}
 */
function injectPrintCssIntoHead(html, cssText) {
  const styleBlock = `<style id="plainstack-export-print">\n${cssText}\n</style>`;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${styleBlock}\n</head>`);
  }
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}\n${styleBlock}\n`);
  }
  return `<!DOCTYPE html><html><head>${styleBlock}</head><body>${html}</body></html>`;
}

/**
 * @param {string | undefined} sourceHtmlPath
 * @returns {string}
 */
function defaultPdfSavePath(sourceHtmlPath) {
  if (typeof sourceHtmlPath === 'string' && sourceHtmlPath) {
    const dir = path.dirname(sourceHtmlPath);
    const stem = path.basename(sourceHtmlPath, path.extname(sourceHtmlPath));
    return path.join(dir, `${stem || 'document'}.pdf`);
  }
  return path.join(app.getPath('documents'), 'document.pdf');
}

/**
 * @param {Electron.IpcMainInvokeEvent} _e
 * @param {{ html: string, defaultPath?: string }} payload
 */
ipcMain.handle('export-html-to-pdf', async (_e, payload) => {
  const html = payload?.html;
  if (typeof html !== 'string' || !html) {
    return { ok: false, error: 'Invalid HTML' };
  }

  const saveResult = await dialog.showSaveDialog(focusedOrMainWindow(), {
    title: 'Export PDF',
    defaultPath: defaultPdfSavePath(payload?.defaultPath),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { ok: false, cancelled: true };
  }

  const targetPath = saveResult.filePath;

  let printCss;
  try {
    printCss = await fs.readFile(path.join(__dirname, 'export-print.css'), 'utf8');
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const htmlWithPrint = injectPrintCssIntoHead(injectExportPrintMode(html), printCss);
  const tempPath = path.join(
    app.getPath('temp'),
    `plainstack-export-${Date.now()}-${Math.random().toString(36).slice(2)}.html`
  );

  try {
    await fs.writeFile(tempPath, htmlWithPrint, 'utf8');
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const pdfWin = new BrowserWindow({
    show: false,
    width: EXPORT_WINDOW_WIDTH,
    height: EXPORT_WINDOW_HEIGHT,
    minWidth: EXPORT_WINDOW_WIDTH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  try {
    await pdfWin.loadURL(pathToFileURL(tempPath).href);

    const measuredWidth = await pdfWin.webContents.executeJavaScript(`
      (async () => {
        try { await document.fonts.ready; } catch (e) {}
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const de = document.documentElement;
        const body = document.body;
        const candidates = [
          de.scrollWidth,
          de.clientWidth,
          body ? body.scrollWidth : 0,
          body ? body.clientWidth : 0,
        ];
        const main = document.querySelector('main, [role="main"], .page, #content, #root');
        if (main) {
          candidates.push(main.scrollWidth, main.clientWidth);
        }
        return Math.max(1, ...candidates.filter((n) => Number.isFinite(n) && n > 0));
      })();
    `);

    const scale = computePdfScale(measuredWidth);

    const pdfBuffer = await pdfWin.webContents.printToPDF({
      printBackground: true,
      displayHeaderFooter: false,
      landscape: true,
      preferCSSPageSize: false,
      pageSize: 'Letter',
      scale,
    });

    await fs.writeFile(targetPath, pdfBuffer);
    return { ok: true, path: targetPath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      await fs.unlink(tempPath);
    } catch {
      /* ignore */
    }
    if (!pdfWin.isDestroyed()) {
      pdfWin.destroy();
    }
  }
});
