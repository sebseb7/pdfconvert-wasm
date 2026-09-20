/**
 * Benchmark: render all fixture PDFs inside a headless Chromium via Playwright
 * with two libraries:
 *   - pdfconvert-wasm (our library)
 *   - pdfjs-dist (Mozilla's JS renderer)
 *
 * Each fixture PDF is loaded once per library, and every page is rendered
 * to a PNG which is written to test/benchmark/out/<renderer>/<pdf>-p<page>.png.
 *
 * pdfjs-dist is resolved from node_modules at runtime and served to the
 * browser page together with the fixture PDFs via a tiny static file server,
 * so no build step or bundler is needed.
 *
 * Individual renderers can be skipped (when their outputs were restored
 * from the GitHub actions cache) via env:
 *   SKIP_BROWSER_WASM=1
 *   SKIP_BROWSER_PDFJS=1
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import {
  fixturePdfs,
  rendererDir,
  pageImageName,
  ensureOutDirs,
  outDir,
  rootDir,
  RENDERERS,
} from './lib.js';

const DPI = 150;

const require = createRequire(import.meta.url);

ensureOutDirs();

// ---------------------------------------------------------------------------
// Tiny static file server: serves fixtures, our package files and pdfjs-dist.
// ---------------------------------------------------------------------------

const MIME = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.html': 'text/html',
  '.json': 'application/json',
  '.pfb': 'application/octet-stream',
  '.map': 'application/json',
};

function startServer() {
  const roots = [
    path.join(rootDir, 'test', 'fixtures'), // /fixtures/...
    rootDir, // /pkg/...        (index.js, poppler.js, poppler.wasm, fonts/)
  ];
  let pdfjsRoot = null;
  try {
    pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
  } catch {
    throw new Error('pdfjs-dist is not installed. Run: npm install --save-dev pdfjs-dist');
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let base;
    if (rel.startsWith('fixtures/')) {
      base = roots[0];
      rel = rel.slice('fixtures/'.length);
    } else if (rel.startsWith('pkg/')) {
      base = roots[1];
      rel = rel.slice('pkg/'.length);
    } else if (rel.startsWith('pdfjs/')) {
      base = pdfjsRoot;
      rel = rel.slice('pdfjs/'.length);
    } else {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const file = path.join(base, rel);
    if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    });
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function serverUrl(server, rel) {
  const { port } = server.address();
  return `http://127.0.0.1:${port}/${rel}`;
}

// ---------------------------------------------------------------------------
// Browser-side renderers. Injected via page.evaluate; each returns an array of
// { page, ms, pngBase64 }.
// ---------------------------------------------------------------------------

/** Render every page of a PDF with pdfconvert-wasm inside the browser. */
async function evalBrowserWasm(page, pdfUrl, dpi) {
  return page.evaluate(
    async ({ pdfUrl, dpi }) => {
      const { pdfToPng } = await import('/pkg/index.js');
      const res = await fetch(pdfUrl);
      const bytes = new Uint8Array(await res.arrayBuffer());

      const results = [];
      // Warm-up + measured runs are identical here; we time one full render.
      const t0 = performance.now();
      const images = await pdfToPng(bytes, { dpi });
      const totalMs = performance.now() - t0;
      const perPage = totalMs / images.length;

      for (const img of images) {
        results.push({
          page: img.pageNumber,
          ms: perPage,
          pngBase64: btoa(
            Array.from(img.data)
              .map((b) => String.fromCharCode(b))
              .join('')
          ),
        });
      }
      return results;
    },
    { pdfUrl, dpi }
  );
}

/** Render every page of a PDF with pdfjs-dist inside the browser. */
async function evalBrowserPdfjs(page, pdfUrl, dpi) {
  return page.evaluate(
    async ({ pdfUrl, dpi }) => {
      const pdfjs = await import('/pdfjs/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/build/pdf.worker.mjs';

      const res = await fetch(pdfUrl);
      const data = await res.arrayBuffer();
      const doc = await pdfjs.getDocument({ data }).promise;

      const scale = dpi / 72;
      const results = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const pdfPage = await doc.getPage(p);
        const viewport = pdfPage.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d');

        const t0 = performance.now();
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        const ms = performance.now() - t0;

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        const buf = new Uint8Array(await blob.arrayBuffer());
        results.push({
          page: p,
          ms,
          pngBase64: btoa(
            Array.from(buf)
              .map((b) => String.fromCharCode(b))
              .join('')
          ),
        });
      }
      return results;
    },
    { pdfUrl, dpi }
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const timings = { browserWasm: {}, browserPdfjs: {} };

// Merge in previously generated timings so skipped renderers keep their data.
const timingsPath = path.join(outDir, 'timings-browser.json');
if (fs.existsSync(timingsPath)) {
  Object.assign(timings, JSON.parse(fs.readFileSync(timingsPath, 'utf8')));
}

const skipWasm = process.env.SKIP_BROWSER_WASM === '1';
const skipPdfjs = process.env.SKIP_BROWSER_PDFJS === '1';

let server = null;
let browser = null;
let page = null;

if (skipWasm && skipPdfjs) {
  console.log('=== Skipping browser benchmarks (both renderers restored from cache) ===');
} else {
  server = await startServer();
  browser = await chromium.launch();
  const context = await browser.newContext();
  page = await context.newPage();
  page.on('pageerror', (err) => console.error('  [browser error]', err.message));
  // Navigate to the server origin once so absolute module specifiers
  // (/pkg/index.js, /pdfjs/...) resolve against it instead of about:blank.
  await page.goto(serverUrl(server, 'fixtures/'), { waitUntil: 'load' }).catch(() => {});

  for (const pdfPath of fixturePdfs()) {
    const pdfBase = path.basename(pdfPath, '.pdf');
    const pdfUrl = serverUrl(server, `fixtures/${pdfBase}.pdf`);

    // 1. pdfconvert-wasm in browser
    if (skipWasm) {
      console.log(`  playwright-pdfconvert-wasm ${pdfBase}: skipped (cache hit)`);
    } else {
      process.stdout.write(`  playwright-pdfconvert-wasm ${pdfBase} ... `);
      try {
        const results = await evalBrowserWasm(page, pdfUrl, DPI);
        const destDir = rendererDir(RENDERERS.browserWasm);
        for (const r of results) {
          fs.writeFileSync(
            path.join(destDir, pageImageName(pdfBase, r.page)),
            Buffer.from(r.pngBase64, 'base64')
          );
          timings.browserWasm[`${pdfBase}-p${r.page}`] = Math.round(r.ms * 100) / 100;
        }
        console.log(`${results.length} pages`);
      } catch (err) {
        console.error(`FAILED: ${err.message}`);
      }
    }

    // 2. pdfjs-dist in browser
    if (skipPdfjs) {
      console.log(`  playwright-pdfjs-dist ${pdfBase}: skipped (cache hit)`);
    } else {
      process.stdout.write(`  playwright-pdfjs-dist ${pdfBase} ... `);
      try {
        const results = await evalBrowserPdfjs(page, pdfUrl, DPI);
        const destDir = rendererDir(RENDERERS.browserPdfjs);
        for (const r of results) {
          fs.writeFileSync(
            path.join(destDir, pageImageName(pdfBase, r.page)),
            Buffer.from(r.pngBase64, 'base64')
          );
          timings.browserPdfjs[`${pdfBase}-p${r.page}`] = Math.round(r.ms * 100) / 100;
        }
        console.log(`${results.length} pages`);
      } catch (err) {
        console.error(`FAILED: ${err.message}`);
      }
    }
  }

  await browser.close();
  server.close();
}

if (!(skipWasm && skipPdfjs)) {
  fs.writeFileSync(timingsPath, JSON.stringify(timings, null, 2));
}
