# HTML Text Editor Preview (Sprint 3)

Minimal Electron app for macOS and Windows: open a local `.html` file, preview it in an iframe (`srcdoc`), parse a working DOM with `DOMParser`, edit inline with a canonical sidebar outline, and **Save** / **Save As** to write the working document back to disk (UTF-8).

## Install and run

Requires [Node.js](https://nodejs.org/) (LTS recommended). The first `npm install` downloads Electron.

### macOS / Linux (bash)

```bash
cd html-text-editor-preview
npm install
npm start
```

### Windows

1. Install [Node.js LTS](https://nodejs.org/) using the Windows installer. Leave **Add to PATH** enabled so `node` and `npm` work in the terminal.
2. Open **Command Prompt** or **PowerShell**, change to the project folder (use your actual path):

   ```powershell
   cd C:\path\to\html-text-editor-preview
   ```

3. Install dependencies and start the app:

   ```powershell
   npm install
   npm start
   ```

If `npm` is not recognized, close and reopen the terminal, or sign out and back in so the updated PATH is picked up.

## Save / open

- **Open** — `ipcMain.handle('open-html-file')` reads UTF-8; renderer sets **`currentFilePath`** after a successful parse.
- **Save** — writes **`serializeHtmlDocument(workingDom)`** to **`currentFilePath`**; if no path is set yet, **Save** behaves like **Save As**.
- **Save As** — `dialog.showSaveDialog`, then write; updates **`currentFilePath`**, filename label, and preview **`<base href>`** for relative assets.

See **`APP_SCHEMA_FOR_CHATGPT.md`** for IPC payloads and renderer state.
