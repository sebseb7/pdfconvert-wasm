/**
 * Benchmark: render all fixture PDFs to PNG with pdftocairo (baseline)
 * and pdfconvert-wasm in Node.js, one PNG per page.
 *
 * Outputs (under test/benchmark/out/):
 *   pdftocairo/<pdf>-p<page>.png + timings-pdftocairo.json
 *   nodejs-pdfconvert-wasm/<pdf>-p<page>.png + timings-node.json
 *
 * Individual renderers can be skipped (when their outputs were restored
 * from the GitHub actions cache) via env:
 *   SKIP_PDFTOCAIRO=1
 *   SKIP_NODE_WASM=1
 */

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
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

ensureOutDirs();

const timings = { pdftocairo: {}, nodeWasm: {} };

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
console.log(`\nNode benchmark complete.`);
