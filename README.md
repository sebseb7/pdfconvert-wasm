# pdfconvert-wasm

[![CI](https://github.com/sebseb7/pdfconvert-wasm/actions/workflows/ci.yml/badge.svg)](https://github.com/sebseb7/pdfconvert-wasm/actions/workflows/ci.yml)
![NPM Version](https://img.shields.io/npm/v/pdfconvert-wasm)

WebAssembly PDF to text and PDF to PNG converter based on Poppler C++ (`poppler-cpp`).

## Why pdfconvert-wasm?

The purpose of this library is **pixel-identical PDF to image rendering** on any platform. Because Poppler is compiled to WebAssembly and rendering happens entirely in-process, you get the exact same output everywhere:

- **Browsers** (any OS)
- **Node.js** backends
- **Any WASM runtime** backend (WASI, Wasmtime, Wasmer, V8, etc.)

No native dependency headaches: unlike `canvas` (node-canvas), which is notoriously painful to install on Windows, there are no system libraries to build or install — just pure JavaScript + a precompiled `.wasm` binary.

In Node.js, conversions run in a reusable worker thread, keeping the main event loop responsive. Browser builds run in the calling thread by default and can optionally be placed in a Web Worker.

**Fonts are bundled**: all fallback font metrics ship with the package, so font rendering and antialiasing are pixel-perfect and fully independent of which fonts are installed on the host platform.

### Rendering consistency and performance

Cross-platform comparisons show the following trade-offs:

| Renderer | Rendering consistency |
| --- | --- |
| `pdftocairo` | Not pixel-perfect between Windows and Linux |
| `pdfjs-dist` | Not pixel-perfect between Node.js and Chrome, or between Chrome on Linux and Chrome on Windows |
| `pdfconvert-wasm` | Pixel-perfect across supported browsers and operating systems |

`pdfjs-dist` is the fastest renderer by a significant margin. Choose `pdfconvert-wasm` when deterministic, pixel-identical output across browsers and operating systems is more important than maximum rendering speed.

- **exports**: **`pdfToText`** and **`pdfToPng`**.

---

## Installation

```bash
npm install pdfconvert-wasm
```

---

## Usage in Node.js

### 1. Extract Text (`pdfToText`)

Converts a PDF buffer into layout-preserved text directly in memory.

```javascript
import { pdfToText, splitPdfPages } from 'pdfconvert-wasm';
import fs from 'node:fs';

const pdfBuffer = fs.readFileSync('document.pdf');

// Extract text with physical layout preserved:
const text = await pdfToText(pdfBuffer, { layout: true });
console.log(text);

// Split into individual pages by form-feed (\f):
const pages = splitPdfPages(text);
console.log(`Extracted ${pages.length} pages:`, pages);
```

### 2. Render Pages to PNG (`pdfToPng`)

Renders PDF pages directly into PNG image byte buffers in memory.

```javascript
import { pdfToPng } from 'pdfconvert-wasm';
import fs from 'node:fs';

const pdfBuffer = fs.readFileSync('document.pdf');

// Render pages to PNG at 150 DPI:
const images = await pdfToPng(pdfBuffer, { dpi: 150 });

images.forEach(({ pageNumber, data }) => {
  console.log(`Page ${pageNumber}: ${data.length} bytes`);
  fs.writeFileSync(`page-${pageNumber}.png`, data);
});
```

---

## Usage in Browser / Vite

`pdfconvert-wasm` works seamlessly in modern frontend frameworks (Vite, Next.js, Webpack) with standard ES module imports.

### Example: HTML + Vite

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>PDF Convert Demo</title>
  </head>
  <body>
    <input type="file" id="pdfInput" accept="application/pdf" />
    <pre id="output"></pre>
    <div id="pages"></div>

    <script type="module">
      import { pdfToText, pdfToPng, splitPdfPages } from 'pdfconvert-wasm';

      const input = document.getElementById('pdfInput');
      const output = document.getElementById('output');
      const pagesContainer = document.getElementById('pages');

      input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        output.textContent = 'Processing PDF in WebAssembly...';
        pagesContainer.innerHTML = '';

        // 1. Extract Text directly from File/Blob
        const text = await pdfToText(file, { layout: true });
        output.textContent = text;

        // 2. Render Pages to PNG directly in browser
        const images = await pdfToPng(file, { dpi: 150 });

        images.forEach(({ pageNumber, data }) => {
          const img = document.createElement('img');
          const objectUrl = URL.createObjectURL(new Blob([data], { type: 'image/png' }));
          img.src = objectUrl;
          img.onload = () => URL.revokeObjectURL(objectUrl);
          img.alt = `Page ${pageNumber}`;
          img.style.maxWidth = '100%';
          img.style.marginBottom = '1rem';
          img.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
          pagesContainer.appendChild(img);
        });
      });
    </script>
  </body>
</html>
```

### Optional: Processing in a Web Worker (Vite)

To keep the UI responsive for large PDFs:

```javascript
// worker.js
import { pdfToText, pdfToPng } from 'pdfconvert-wasm';

self.onmessage = async (e) => {
  const { id, file, type, options } = e.data;
  try {
    if (type === 'text') {
      const text = await pdfToText(file, options);
      self.postMessage({ id, success: true, text });
    } else if (type === 'png') {
      const images = await pdfToPng(file, options);
      self.postMessage({ id, success: true, images });
    }
  } catch (err) {
    self.postMessage({ id, success: false, error: err.message });
  }
};
```

---

## API Reference

### `pdfToText(pdfSource, options?)`

* **`pdfSource`**: `Uint8Array | ArrayBuffer | Buffer | Blob | File`
* **`options`**:
  * **`layout`** (`boolean`, default: `true`): Preserves original physical column/line layout (`poppler::page::physical_layout`). Set `false` for raw stream order.
  * **`firstPage`** (`number`, default: `1`): 1-based first page to extract.
  * **`lastPage`** (`number`, default: `-1`): 1-based last page to extract (`-1` for all pages).
  * **`noPageBreaks`** (`boolean`, default: `false`): Don't insert form-feed (`\f`) between pages.
* **Returns**: `Promise<string>`

In Node.js this operation is dispatched to a worker thread. For code that is already running in a worker, `pdfToTextSync` avoids the extra dispatch (it still returns a `Promise`, but performs the CPU work on the calling thread).

### `pdfToPng(pdfSource, options?)`

* **`pdfSource`**: `Uint8Array | ArrayBuffer | Buffer | Blob | File`
* **`options`**:
  * **`dpi`** (`number`, default: `150`): Resolution in DPI.
  * **`firstPage`** (`number`, default: `1`): 1-based first page to render.
  * **`lastPage`** (`number`, default: total pages): 1-based last page to render.
  * **`scaleTo`** (`number`): Scale longest edge to this size in pixels, preserving aspect ratio.
  * **`scaleToX`** (`number`): Scale width to this size in pixels (`-1` for proportional to height).
  * **`scaleToY`** (`number`): Scale height to this size in pixels (`-1` for proportional to width).
  * **`singleFile`** (`boolean`, default: `false`): Only render the first requested page.
* **Returns**: `Promise<Array<{ pageNumber: number, name: string, data: Uint8Array }>>`

In Node.js this operation is dispatched to a worker thread. The corresponding direct-call export is `pdfToPngSync`.

### `splitPdfPages(text)`

* **`text`**: Raw string extracted by `pdfToText`.
* **Returns**: `string[]` Array of individual page strings split by form-feed (`\f`).

---

## Repository & Publishing Workflow

This repository is set up with a clean separation between git source tracking and npm distribution:

* **Git Repository ([github.com/sebseb7/pdfconvert-wasm](https://github.com/sebseb7/pdfconvert-wasm))**:
  * Contains only source code, C++ wrappers, Dockerfile, and fallback font metrics.
  * Compiled binaries (`poppler.js`, `poppler.wasm`) are gitignored (`.gitignore`) to keep the repository lightweight.
* **NPM Package (`pdfconvert-wasm`)**:
  * Uses `"files": ["index.js", "poppler.js", "poppler.wasm", "LICENSE", "README.md"]` in `package.json`.
  * Pre-compiles the WebAssembly binary before publishing so consumers don't need any compiler toolchains.

### Rebuilding WebAssembly Binaries

```bash
npm run build:docker
```

### Publishing to NPM

```bash
# 1. Build the release WebAssembly binaries
npm run build:docker

# 2. Publish to npm (will include poppler.js and poppler.wasm automatically)
npm publish
```

---

## License

GPLv3 (following Poppler's license).