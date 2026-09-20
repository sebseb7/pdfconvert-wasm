/**
 * Builds the benchmark markdown table and uploads-ready artifacts.
 *
 * One row per PDF page. Columns:
 *   - pdftocairo ms
 *   - nodejs-pdfconvert-wasm ms
 *   - nodejs-pdfconvert-wasm pixeldiffrate
 *   - nodejs-pdfjs-dist ms
 *   - nodejs-pdfjs-dist pixeldiffrate
 *   - playwright-pdfconvert-wasm ms
 *   - playwright-pdfconvert-wasm pixeldiffrate
 *   - playwright-pdfjs-dist ms
 *   - playwright-pdfjs pixeldiffrate
 *
 * Pixel diff rate = % of differing pixels vs. the pdftocairo baseline image
 * for the same page (0 = pixel identical).
 *
 * Usage: node test/benchmark/report.js
 * Reads:  test/benchmark/out/{timings-node.json,timings-browser.json}
 *         test/benchmark/out/<renderer>/*.png
 * Writes: test/benchmark/out/report.md and report.json
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  fixturePdfs,
  rendererDir,
  pageImageName,
  outDir,
  RENDERERS,
  diffAgainstBaseline,
} from './lib.js';

const nodeTimings = {};
for (const f of ['timings-pdftocairo.json', 'timings-node.json']) {
  const p = path.join(outDir, f);
  if (fs.existsSync(p)) Object.assign(nodeTimings, JSON.parse(fs.readFileSync(p, 'utf8')));
}
const browserTimings = JSON.parse(
  fs.readFileSync(path.join(outDir, 'timings-browser.json'), 'utf8')
);

const fmtMs = (ms) => (ms == null ? 'n/a' : ms.toFixed(1));
const fmtDiff = (pct) => (pct == null ? 'n/a' : `${pct.toFixed(2)}%`);

const rows = [];
const header = [
  'Page',
  'pdftocairo ms',
  'nodejs-pdfconvert-wasm ms',
  'nodejs-pdfconvert-wasm pixeldiffrate',
  'nodejs-pdfjs-dist ms',
  'nodejs-pdfjs-dist pixeldiffrate',
  'playwright-pdfconvert-wasm ms',
  'playwright-pdfconvert-wasm pixeldiffrate',
  'playwright-pdfjs-dist ms',
  'playwright-pdfjs pixeldiffrate',
];

for (const pdfPath of fixturePdfs()) {
  const pdfBase = path.basename(pdfPath, '.pdf');
  const baseDir = rendererDir(RENDERERS.pdftocairo);

  const pages = fs
    .readdirSync(baseDir)
    .filter((f) => f.startsWith(`${pdfBase}-p`) && f.endsWith('.png'))
    .map((f) => parseInt(f.slice(pdfBase.length + 2, -'.png'.length), 10))
    .sort((a, b) => a - b);

  for (const page of pages) {
    const key = `${pdfBase}-p${page}`;
    const nodePng = path.join(rendererDir(RENDERERS.nodeWasm), pageImageName(pdfBase, page));
    const njPng = path.join(rendererDir(RENDERERS.nodePdfjs), pageImageName(pdfBase, page));
    const bwPng = path.join(rendererDir(RENDERERS.browserWasm), pageImageName(pdfBase, page));
    const bjPng = path.join(rendererDir(RENDERERS.browserPdfjs), pageImageName(pdfBase, page));

    rows.push({
      pdf: pdfBase,
      page,
      pdftocairoMs: nodeTimings.pdftocairo?.[key],
      nodeWasmMs: nodeTimings.nodeWasm?.[key],
      nodeWasmDiff: diffAgainstBaseline(pdfBase, page, nodePng),
      nodePdfjsMs: nodeTimings.nodePdfjs?.[key],
      nodePdfjsDiff: diffAgainstBaseline(pdfBase, page, njPng),
      browserWasmMs: browserTimings.browserWasm?.[key],
      browserWasmDiff: diffAgainstBaseline(pdfBase, page, bwPng),
      browserPdfjsMs: browserTimings.browserPdfjs?.[key],
      browserPdfjsDiff: diffAgainstBaseline(pdfBase, page, bjPng),
    });
  }
}

const mdLines = [
  `# Rendering Benchmark — ${process.env.RUNNER_OS || 'local'} (${new Date().toISOString()})`,
  '',
  'Baseline: `pdftocairo -png -r 150`. Pixel diff rate is the % of differing pixels',
  'vs. the baseline image for the same page (0.00% = pixel identical).',
  '',
  `| ${header.join(' | ')} |`,
  `| ${header.map(() => '---').join(' | ')} |`,
];

for (const r of rows) {
  mdLines.push(
    `| ${r.pdf} p.${r.page} | ${fmtMs(r.pdftocairoMs)} | ${fmtMs(r.nodeWasmMs)} | ${fmtDiff(
      r.nodeWasmDiff
    )} | ${fmtMs(r.nodePdfjsMs)} | ${fmtDiff(r.nodePdfjsDiff)} | ${fmtMs(
      r.browserWasmMs
    )} | ${fmtDiff(r.browserWasmDiff)} | ${fmtMs(r.browserPdfjsMs)} | ${fmtDiff(
      r.browserPdfjsDiff
    )} |`
  );
}

const reportMd = mdLines.join('\n') + '\n';
fs.writeFileSync(path.join(outDir, 'report.md'), reportMd);
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(rows, null, 2));

console.log(reportMd);
console.log(`\nReport written to ${path.join(outDir, 'report.md')} and report.json`);
