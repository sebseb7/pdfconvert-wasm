import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { pdfToPng } from '../../index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const fixturesDir = path.join(rootDir, 'test', 'fixtures');
const refImagesDir = path.join(rootDir, 'test', 'reference', 'images');
const diffDir = path.join(rootDir, 'test', 'diff');

fs.mkdirSync(diffDir, { recursive: true });

const pdfFiles = fs
  .readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.pdf'))
  .sort();

console.log(`\n=== Visual Regression Tests (WASM pdfToPng vs pdftoppm) ===`);
console.log(`Fixtures: ${pdfFiles.length} PDFs`);
console.log(`Max pixel mismatch tolerance: 1.5%\n`);

let totalPages = 0;
let passedPages = 0;
let failedPages = 0;

// Maximum allowed mismatch percentage for FreeType / antialiasing variance
const MAX_DIFF_PERCENT = 1.5;
const MAX_DIMENSION_DIFF = 2;

for (const file of pdfFiles) {
  const baseName = path.basename(file, '.pdf');
  const pdfPath = path.join(fixturesDir, file);
  const pdfBytes = fs.readFileSync(pdfPath);

  let renderedPages;
  try {
    renderedPages = await pdfToPng(pdfBytes, { dpi: 150 });
  } catch (err) {
    console.error(`✗ [ERROR] Failed to render ${file}:`, err.message);
    failedPages++;
    continue;
  }

  // Find all reference images corresponding to this baseName
  const refFiles = fs
    .readdirSync(refImagesDir)
    .filter((img) => img.startsWith(`${baseName}-`) && img.endsWith('.png'))
    .sort((a, b) => {
      const numA = parseInt(a.replace(`${baseName}-`, '').replace('.png', ''), 10);
      const numB = parseInt(b.replace(`${baseName}-`, '').replace('.png', ''), 10);
      return numA - numB;
    });

  if (refFiles.length !== renderedPages.length) {
    console.error(
      `✗ [PAGE COUNT MISMATCH] ${file}: rendered ${renderedPages.length} pages, found ${refFiles.length} reference files`
    );
    failedPages += Math.max(renderedPages.length, refFiles.length);
    continue;
  }

  for (let i = 0; i < renderedPages.length; i++) {
    totalPages++;
    const pageObj = renderedPages[i];
    const pageNum = pageObj.pageNumber || i + 1;
    const refFile = refFiles[i];
    const refPath = path.join(refImagesDir, refFile);

    const wasmPng = PNG.sync.read(Buffer.from(pageObj.data));
    const refPng = PNG.sync.read(fs.readFileSync(refPath));

    const dimDiff = Math.abs(wasmPng.width - refPng.width) + Math.abs(wasmPng.height - refPng.height);
    const commonW = Math.min(wasmPng.width, refPng.width);
    const commonH = Math.min(wasmPng.height, refPng.height);

    const imgWasm = new PNG({ width: commonW, height: commonH });
    const imgRef = new PNG({ width: commonW, height: commonH });
    PNG.bitblt(wasmPng, imgWasm, 0, 0, commonW, commonH, 0, 0);
    PNG.bitblt(refPng, imgRef, 0, 0, commonW, commonH, 0, 0);

    const diffPng = new PNG({ width: commonW, height: commonH });
    const diffPixels = pixelmatch(imgWasm.data, imgRef.data, diffPng.data, commonW, commonH, {
      threshold: 0.1,
      includeAA: false,
    });

    const totalPixels = commonW * commonH;
    const diffPct = (diffPixels / totalPixels) * 100;

    const isPass = dimDiff <= MAX_DIMENSION_DIFF && diffPct <= MAX_DIFF_PERCENT;

    if (isPass) {
      passedPages++;
      const detail =
        diffPixels === 0
          ? 'exact match'
          : `${diffPixels} diff px (${diffPct.toFixed(2)}%) within tolerance`;
      console.log(`  ✓ ${baseName} p.${pageNum}: PASSED (${detail})`);
    } else {
      failedPages++;
      const diffOutPath = path.join(diffDir, `${baseName}-p${pageNum}-diff.png`);
      fs.writeFileSync(diffOutPath, PNG.sync.write(diffPng));
      console.error(
        `  ✗ ${baseName} p.${pageNum}: FAILED (diff=${diffPixels}/${totalPixels} [${diffPct.toFixed(
          2
        )}%], dims: wasm=${wasmPng.width}x${wasmPng.height}, ref=${refPng.width}x${refPng.height})`
      );
      console.error(`    Diff image saved to: ${path.relative(rootDir, diffOutPath)}`);
    }
  }
}

console.log(`\n------------------------------------------------------------`);
console.log(`Image Regression Summary: ${passedPages}/${totalPages} pages passed (${failedPages} failed).`);
console.log(`------------------------------------------------------------\n`);

if (failedPages > 0) {
  process.exit(1);
}
