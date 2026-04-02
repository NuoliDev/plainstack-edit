# HTML Text Editor Preview — App schema (Sprint 3)

Human-readable overview for tools and collaborators. Describes structure, data shapes, editing model, and IPC.

---

## What this app is

- **Name:** HTML Text Editor Preview  
- **Stack:** Electron, plain JavaScript (no framework), minimal HTML/CSS.  
- **Sprint 1:** Open one local `.html` file, preview in an **iframe** (`srcdoc`), **parse** the same HTML with **`DOMParser`** (working document), **outline** in the **sidebar**, **scroll** to outline targets in the live preview.  
- **Sprint 2:** **Safe inline text editing** on approved elements only; **`data-editor-id`** maps live iframe nodes to **`workingDom`**; **plain-text paste**; **Escape** cancels; **blur** or **Enter** commits; **dirty** state.  
- **Sprint 3:** **Save** and **Save As** write **`serializeHtmlDocument(workingDom)`** to disk via IPC; **`currentFilePath`** tracks the open/saved file; dirty clears only after a successful write.  
- **Export PDF:** **Does not** print the shell or live iframe chrome. Renderer sends **serialized document HTML** (editor IDs stripped) through IPC; the **main** process writes a **temporary** `.html` file with **print/export mode** markup and **`export-print.css`**, opens it in a **hidden** `BrowserWindow`, then **`webContents.printToPDF()`** writes the user-chosen `.pdf`. **`styles.css`** (app shell) is **not** part of the export document.

---

## File layout

| File | Role |
|------|------|
| `package.json` | `npm start` runs `electron .`; `main` is `main.js`. |
| `main.js` | Electron main process: window, `open-html-file`, `save-html-file`, `save-html-file-as`, **`export-html-to-pdf`** (temp file + hidden window + `printToPDF`). |
| `preload.js` | `contextBridge.exposeInMainWorld('electronAPI', { openHtmlFile, filePathToBaseHref, saveHtmlFile, saveHtmlFileAs, **`exportHtmlToPdf`** })`. |
| `index.html` | Shell UI: toolbar, sidebar, preview iframe, dirty hint, **Export PDF** button. |
| `styles.css` | Split layout (toolbar / sidebar / preview); **`@media print`** rules hide shell chrome if the user prints the **main** window (Export PDF uses a **separate** document). |
| `export-document.js` | **`stripEditorIdsFromSerializedHtml(serializedHtml)`** — string-only removal of `data-editor-id` (no `DOMParser` round-trip; preserves markup fidelity). |
| `export-print.css` | Injected **only** into the temp export HTML: **`html.print-mode`** print layout (fixed canvas, outer 3-column grids, inner card/stack rules). Not loaded by the live editor. |
| `renderer.js` | Open/save file, parse DOM, stamp `data-editor-id`, outline, iframe sync, inline edit, **Export PDF** handler. |

---

## Security model (Electron)

- **`contextIsolation`:** `true`  
- **`nodeIntegration`:** `false` (renderer has no Node `require`)  
- **Preload:** small API on `window.electronAPI` only.

---

## IPC: main ↔ renderer (current)

| Channel | Direction | Payload / behavior |
|---------|-----------|---------------------|
| `open-html-file` | invoke | Returns `null` (cancel), `{ path, content }`, or `{ path, error, content: null }`. |
| `save-html-file` | invoke | `{ path, html }` → UTF-8 write → `{ ok: true, path }` or `{ ok: false, error }`. |
| `save-html-file-as` | invoke | `{ defaultPath?, html }` → save dialog (`.html`/`.htm`) → cancel: `{ ok: false, cancelled: true }`; success: `{ ok: true, path }`; write error: `{ ok: false, error }`. |
| **`export-html-to-pdf`** | invoke | **`{ html, defaultPath? }`** — `html` is export-ready string (see **Export PDF** below). **Save PDF** dialog first → write temp HTML (print mode + injected CSS) → hidden window **`loadURL(file://…)`** → **`printToPDF`** → write `.pdf` → delete temp file. Returns `{ ok: true, path }`, `{ ok: false, cancelled: true }`, or `{ ok: false, error }`. |

**Renderer:** **Save** calls `save-html-file` when **`currentFilePath`** is set; if none, **Save** runs the same flow as **Save As**. **Save As** always uses **`save-html-file-as`** with **`defaultPath: currentFilePath || ''`** (main falls back to Documents/`untitled.html` when empty).

**Export PDF:** **`onExportPdfClick`** → `flushActiveEditToWorkingDom()` → **`stripEditorIdsFromSerializedHtml(serializeHtmlDocument(workingDom))`** → **`electronAPI.exportHtmlToPdf({ html, defaultPath: currentFilePath })`**. No second `DOMParser` pass in the renderer (avoids HTML normalization).

---

## Export PDF — pipeline and print layout (not the live editor)

### What is *not* exported

- The **Electron shell** (`index.html`: toolbar, sidebar, toasts) is never serialized for PDF.  
- The **live** `iframe` DOM is not printed directly; export uses the same **serialized HTML** as save, after stripping **`data-editor-id`**.

### Main-process steps (`main.js`)

1. **`injectExportPrintMode(html)`** (string transforms only):  
   - Remove existing **viewport** `<meta>` tags; inject **`width=1400`** viewport (matches hidden window width).  
   - Add **`class="print-mode"`** to **`<html>`** (merges with existing `class`).  
2. **`injectPrintCssIntoHead(html, exportPrintCss)`** — append contents of **`export-print.css`** (minimal: `@page`, editor chrome guards, outline reset) before **`</head>`**.  
3. Write the result to a **temp** `.html`; **`loadURL`** via **`pathToFileURL`**.  
4. **Hidden `BrowserWindow`:** **`width` / `minWidth`: 1400px**, **`height`: 2400**, **`webSecurity: false`**.  
5. **`executeJavaScript`:** **`document.fonts.ready`**, two **`requestAnimationFrame`** ticks, then **measure** content width: **`Math.max`** of **`documentElement` / `body` `scrollWidth` & `clientWidth`**, and optional **`main, [role="main"], .page, #content, #root`** if present. Minimum **1**.  
6. **`computePdfScale(measuredWidth)`:** **`printableWidthPx / measuredWidth`**, where **`printableWidthPx = round(10 × 96)`** = **960** (Letter **landscape** 11in wide minus **0.5in** left/right **`@page`** margins → **10in** at **96 CSS px/in**). If ratio **≥ 1**, use **`scale: 1`**. If **< 1**, clamp **`scale`** to **[0.7, 1.0]** (Electron **`printToPDF`** uses **`scale`**, not `scaleFactor`).  
7. **`webContents.printToPDF({ printBackground: true, displayHeaderFooter: false, landscape: true, preferCSSPageSize: false, pageSize: 'Letter', scale })`** — horizontal layout is preserved by **scaling the whole page** to fit the printable width, not by rewriting grids/cards in CSS.  
8. Write PDF; **unlink** temp HTML; **destroy** hidden window.

### Print layout strategy (`export-print.css`, scoped under **`html.print-mode`**)

Minimal rules only: **`@page` Letter landscape + margins**, **`html`/`body`** full width of the export window, **print-color-adjust**, hide stray shell class names, editor outline guards. **No** global grid/flex/card overrides — layout matches the document as rendered at **1400px**; PDF fit is **`scale`**.

| Concern | Approach |
|--------|----------|
| **Width fidelity** | Render at **1400px**; measure **scrollWidth** / **clientWidth**; **`scale = clamp(printablePdfWidth / measuredWidth, 0.7, 1.0)`** with **`printablePdfWidth = 960`**. |
| **Editor markers** | **`[data-editor-id]`** stripped in renderer; print CSS still clears outline if present. |

### Portable reuse (web / Firebase)

- **`stripEditorIdsFromSerializedHtml`** is plain JS ( **`export-document.js`** ).  
- **`export-print.css`** can be hosted and injected the same way, or merged into a **`/export`** route that renders document-only HTML.

---

## Two documents + editor mapping (critical)

1. **`workingDom`** — `Document` from `DOMParser`. **Authoritative** for outline metadata and **post-commit** serialization (`lastHtml`).  
2. **Live preview** — `iframe.contentDocument` after `srcdoc` load. User **edits** here.

**Stable mapping (recommended approach):** Mutate the **working `Document` first** — stamp every approved editable element in **tree (preorder) order** with `data-editor-id="ed-0"`, `ed-1`, … — then **`serializeHtmlDocument(workingDom)`** once and assign that string to **`iframe.srcdoc`**. The preview DOM is parsed from that string, so **working DOM and iframe DOM get the same tags without separately walking the iframe**. Do **not** stamp the iframe after load as a second source of truth.

**On commit:** `syncLiveEditToWorkingDom(editorId, newText)` sets **`textContent`** on `[data-editor-id="…"]` in **`workingDom`** only (no `outerHTML` replacement, no attribute changes). Then `lastHtml = serializeHtmlDocument(workingDom)`.

**Cancel:** restores **live** element `textContent` from a snapshot; **`workingDom`** unchanged.

**MVP caveat:** `textContent` assignment **flattens** nested inline markup **inside** that one element; acceptable per Sprint 2 scope.

---

## Editable targets (`isEditableElement`)

**Allowed tags (non-empty visible text, not hidden, not in SVG):**  
`h1`–`h6`, `p`, `li`, `a`, `blockquote`, `small`, `td`, `th`, `figcaption`, `button`, `label`.

**Excluded:** `script`, `style`, `noscript`, SVG subtrees, `template`, hidden-like elements, **layout containers** (`div`, `section`, …) unless they are **not** in the list (they are not editable).

---

## Outline sidebar (canonical editable model)

- **`buildCanonicalEditableModel(workingDom)`** — walks **`collectEditableCandidates`** (same document order as stamping): one sidebar row per stamped **`[data-editor-id]`** node. **No** heading-only mode; **all** editables are listed.
- **Live node:** `iframe.contentDocument.querySelector('[data-editor-id="' + id + '"]')` — **only** mapping key is **`data-editor-id`**.
- **Click row:** `onOutlineRowClick(editorId)` → `findLiveElementByEditorId` → scroll → `beginInlineEdit`.
- **After commit:** `rebuildOutline()` rebuilds items from **`workingDom`**, re-renders sidebar, preserves **`activeOutlineEditorId`** if that id still exists.

**Outline UI:** Each row **`button[data-editor-id="…"]`** matches the content id. **`.active`** = **`activeOutlineEditorId`**. Headings **h1–h3** use stronger indent classes; **h4–h6** use **`outline-item--h4`**.

**span/div (real-world HTML):** Additional **`isLikelyTextHolderSpanOrDiv`** heuristics: non-empty text, limited subtree size, phrasing-only descendants, no structural block descendants, delegation when a single child is another text-holder or `a`/`button`/`label`.

**Toolbar:** **Save** writes to **`currentFilePath`** (or **Save As** if no path). **Save As** picks a path and updates **`currentFilePath`** and preview **`<base>`** when the file moves.

---

## Inline editing behavior

| Action | Effect |
|--------|--------|
| **Click** approved `[data-editor-id]` in preview | **capture** `click`, `preventDefault` / `stopPropagation`, `beginInlineEdit` (starts `contenteditable`). |
| **Blur** | **Commit** (`commitInlineEdit`). |
| **Enter** | **Commit** (MVP: all listed tags; paragraph-like and `li` also commit on Enter). |
| **Escape** | **Cancel** (`cancelInlineEdit`), restore snapshot. |
| **Paste** | **Plain text only** (`clipboardData.getData('text/plain')`), `insertText` / fallback. |

---

## Renderer state (main variables)

| Name | Meaning |
|------|--------|
| `workingDom` | Parsed `Document` with `data-editor-id` stamps. |
| `lastHtml` | Last serialized HTML string (after load or commit). |
| `currentFilePath` | Absolute path of last opened or saved file, or `null` if none / parse failure. |
| `lastCanonicalEditableItems` | `EditableMeta[]` from last `buildCanonicalEditableModel(workingDom)` (sidebar + debug). |
| `documentDirty` | Unsaved edits since last open or successful save. |

---

## Debug hook (`window.__htmlPreviewDebug`)

- `getWorkingDom`, `getLastHtml`, `getCanonicalEditableItems`, `getResolvedBaseHref`, `getCurrentFilePath`, `getDirty`, `getActiveEditElement`, `getActiveOutlineEditorId`  
- `syncLiveEditToWorkingDom`, `rebuildOutline` (for tests)

---

## Version note

This file describes **Sprint 3** as implemented, including **Export PDF** and **print-mode** layout. Update when changing IPC contracts, persistence behavior, or export/print pipeline.
