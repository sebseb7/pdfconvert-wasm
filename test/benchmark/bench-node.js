/**
 * Benchmark: render all fixture PDFs to PNG with pdftocairo (baseline),
 * pdfconvert-wasm in Node.js and pdfjs-dist in Node.js, one PNG per page.
 *
 * Outputs (under test/benchmark/out/):
 *   pdftocairo/<pdf>-p<page>.png + timings-pdftocairo.json
 *   nodejs-pdfconvert-wasm/<pdf>-p<page>.png + timings-node.json
 *   nodejs-pdfjs-dist/<pdf>-p<page>.png + timings-node.json
 *
 * Individual renderers can be skipped (when their outputs were restored
 * from the GitHub actions cache) via env:
 *   SKIP_PDFTOCAIRO=1
 *   SKIP_NODE_WASM=1
 *   SKIP_NODE_PDFJS=1
 */

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { pdfToPng } from '../../index.js';
import {
  fixturePdfs,
  renderWithPdftocairo,
  rendererDir,
  pageImageName,
  ensureOutDirs,
  outDir,
  RENDERERS,
} from './lib.js';

const DPI = 150;

const require = createRequire(import.meta.url);

ensureOutDirs();

const timings = { pdftocairo: {}, nodeWasm: {}, nodePdfjs: {} };

// Merge in previously generated timings so skipped renderers keep their data.
for (const f of ['timings-pdftocairo.json', 'timings-node.json']) {
  const p = path.join(outDir, f);
  if (fs.existsSync(p)) {
    Object.assign(timings, JSON.parse(fs.readFileSync(p, 'utf8')));
  }
}

// 1. Baseline: pdftocairo
if (process.env.SKIP_PDFTOCAIRO === '1') {
  console.log('=== Skipping pdftocairo (SKIP_PDFTOCAIRO=1, restored from cache) ===');
} else {
  console.log('=== Benchmark: pdftocairo (baseline) ===');
  for (const pdfPath of fixturePdfs()) {
    const pdfBase = path.basename(pdfPath, '.pdf');
    process.stdout.write(`  pdftocairo ${pdfBase} ... `);
    const pageTimings = await renderWithPdftocairo(pdfPath, DPI);
    for (const [page, ms] of pageTimings) {
      timings.pdftocairo[`${pdfBase}-p${page}`] = Math.round(ms * 100) / 100;
    }
    console.log(`${Array.from(pageTimings.values()).reduce((a, b) => a + b, 0).toFixed(0)} ms`);
  }
  fs.writeFileSync(
    path.join(outDir, 'timings-pdftocairo.json'),
    JSON.stringify({ pdftocairo: timings.pdftocairo }, null, 2)
  );
}

// 2. pdfconvert-wasm in Node.js
if (process.env.SKIP_NODE_WASM === '1') {
  console.log('=== Skipping nodejs-pdfconvert-wasm (SKIP_NODE_WASM=1, restored from cache) ===');
} else {
  console.log('=== Benchmark: pdfconvert-wasm (Node.js) ===');
  for (const pdfPath of fixturePdfs()) {
    const pdfBase = path.basename(pdfPath, '.pdf');
    const pdfBytes = fs.readFileSync(pdfPath);
    process.stdout.write(`  nodejs-pdfconvert-wasm ${pdfBase} ... `);

    const t0 = performance.now();
    const pages = await pdfToPng(pdfBytes, { dpi: DPI });
    const totalMs = performance.now() - t0;

    const perPage = totalMs / pages.length;
    const destDir = rendererDir(RENDERERS.nodeWasm);
    for (const pageObj of pages) {
      fs.writeFileSync(
        path.join(destDir, pageImageName(pdfBase, pageObj.pageNumber)),
        pageObj.data
      );
      timings.nodeWasm[`${pdfBase}-p${pageObj.pageNumber}`] = Math.round(perPage * 100) / 100;
    }
    console.log(`${totalMs.toFixed(0)} ms (${pages.length} pages)`);
  }
  fs.writeFileSync(
    path.join(outDir, 'timings-node.json'),
    JSON.stringify({ nodeWasm: timings.nodeWasm }, null, 2)
  );
}

// 3. pdfjs-dist in Node.js (canvas-based renderer)
if (process.env.SKIP_NODE_PDFJS === '1') {
  console.log('=== Skipping nodejs-pdfjs-dist (SKIP_NODE_PDFJS=1, restored from cache) ===');
} else {
  console.log('=== Benchmark: pdfjs-dist (Node.js) ===');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = require.resolve(
    'pdfjs-dist/legacy/build/pdf.worker.mjs'
  );
  const { createCanvas } = require('@napi-rs/canvas');

  for (const pdfPath of fixturePdfs()) {
    const pdfBase = path.basename(pdfPath, '.pdf');
    const pdfBytes = new Uint8Array(fs.readFileSync(pdfPath));
    process.stdout.write(`  nodejs-pdfjs-dist ${pdfBase} ... `);

    const doc = await pdfjs.getDocument({ data: pdfBytes }).promise;
    const destDir = rendererDir(RENDERERS.nodePdfjs);
    const scale = DPI / 72;

    for (let p = 1; p <= doc.numPages; p++) {
      const pdfPage = await doc.getPage(p);
      const viewport = pdfPage.getViewport({ scale });

      const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
      const ctx = canvas.getContext('2d');

      const t0 = performance.now();
      await pdfPage.render({ canvasContext: ctx, viewport, canvas }).promise;
      const ms = performance.now() - t0;

      fs.writeFileSync(
        path.join(destDir, pageImageName(pdfBase, p)),
        canvas.toBuffer('image/png')
      );
      timings.nodePdfjs[`${pdfBase}-p${p}`] = Math.round(ms * 100) / 100;
    }
    console.log(`${doc.numPages} pages`);
  }
  fs.writeFileSync(
    path.join(outDir, 'timings-node.json'),
    JSON.stringify({ nodeWasm: timings.nodeWasm, nodePdfjs: timings.nodePdfjs }, null, 2)
  );
}
console.log(`\nNode benchmark complete.`);
