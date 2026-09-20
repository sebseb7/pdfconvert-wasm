/**
 * Shared helpers for the rendering benchmark suite.
 *
 * The benchmark compares, per PDF page:
 *   - pdftocairo (native Poppler CLI)
 *   - pdfconvert-wasm in Node.js
 *   - pdfjs-dist in Node.js
 *   - pdfconvert-wasm in a browser (Playwright + Chromium)
 *   - pdfjs-dist in a browser (Playwright + Chromium)
 *
 * Every renderer writes PNGs to an output dir named after the renderer:
 *   out/<renderer>/<pdf-base>-p<page>.png
 *
 * The report generator then diffs renderer outputs against the pdftocairo
 * baseline (pixel diff rate in %) and emits one markdown table row per page.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const rootDir = path.resolve(__dirname, '..', '..');
export const fixturesDir = path.join(rootDir, 'test', 'fixtures');
export const benchDir = path.join(rootDir, 'test', 'benchmark');
export const outDir = process.env.BENCH_OUT_DIR || path.join(benchDir, 'out');

export const RENDERERS = {
  pdftocairo: 'pdftocairo',
  nodeWasm: 'nodejs-pdfconvert-wasm',
  nodePdfjs: 'nodejs-pdfjs-dist',
  browserWasm: 'playwright-pdfconvert-wasm',
  browserPdfjs: 'playwright-pdfjs-dist',
};

export function fixturePdfs() {
  return fs
    .readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.pdf'))
    .sort()
    .map((f) => path.join(fixturesDir, f));
}

export function rendererDir(renderer) {
  return path.join(outDir, renderer);
}

export function pageImageName(pdfBase, page) {
  return `${pdfBase}-p${page}.png`;
}

export function ensureOutDirs() {
  for (const renderer of Object.values(RENDERERS)) {
    fs.mkdirSync(rendererDir(renderer), { recursive: true });
  }
}

/**
 * Render one PDF with pdftocairo into the pdftocairo output dir.
 * Uses the same DPI as the WASM renderer (150) so images are comparable.
 * Returns a Map of page -> elapsed ms.
 */
export async function renderWithPdftocairo(pdfPath, dpi = 150) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  const pdfBase = path.basename(pdfPath, '.pdf');
  const destDir = rendererDir(RENDERERS.pdftocairo);

  const t0 = performance.now();
  await execFileAsync('pdftocairo', [
    '-png',
    '-r',
    String(dpi),
    '-singlefile', // names output <pdfBase>.png? No: -singlefile drops page numbers, so don't use it for multi-page.
    pdfPath,
    path.join(destDir, pdfBase),
  ]).catch(async () => {
    // -singlefile only writes the first page; fall back to default naming.
    await execFileAsync('pdftocairo', [
      '-png',
      '-r',
      String(dpi),
      pdfPath,
      path.join(destDir, pdfBase),
    ]);
  });
  const elapsed = performance.now() - t0;

  // pdftocairo writes <base>-<page>.png (or <base>.png with -singlefile).
  // Rename/normalize to our pageImageName convention and record page count.
  const written = fs
    .readdirSync(destDir)
    .filter((f) => f.startsWith(pdfBase) && f.endsWith('.png'));

  const timings = new Map();
  let page = 0;
  for (const f of written.sort()) {
    page++;
    const target = pageImageName(pdfBase, page);
    const src = path.join(destDir, f);
    if (f !== target) {
      fs.renameSync(src, path.join(destDir, target));
    }
    // Whole-document wall time is distributed evenly across pages for the
    // table (pdftocairo has no per-page timing without spawning per page).
    timings.set(page, elapsed / page);
  }
  return timings;
}

/**
 * Compute the pixel diff rate (%) of a candidate PNG against the
 * pdftocairo baseline PNG for the same page. Dimensions may differ by a
 * couple of pixels between renderers; we diff on the common area.
 * Returns null when the baseline image is missing.
 */
export function diffAgainstBaseline(pdfBase, page, candidatePath) {
  const baselinePath = path.join(
    rendererDir(RENDERERS.pdftocairo),
    pageImageName(pdfBase, page)
  );
  if (!fs.existsSync(baselinePath) || !fs.existsSync(candidatePath)) return null;

  const basePng = PNG.sync.read(fs.readFileSync(baselinePath));
  const candPng = PNG.sync.read(fs.readFileSync(candidatePath));

  const w = Math.min(basePng.width, candPng.width);
  const h = Math.min(basePng.height, candPng.height);

  const baseCrop = new PNG({ width: w, height: h });
  const candCrop = new PNG({ width: w, height: h });
  PNG.bitblt(basePng, baseCrop, 0, 0, w, h, 0, 0);
  PNG.bitblt(candPng, candCrop, 0, 0, w, h, 0, 0);

  const diff = pixelmatch(baseCrop.data, candCrop.data, null, w, h, {
    threshold: 0.1,
    includeAA: false,
  });
  return (diff / (w * h)) * 100;
}
