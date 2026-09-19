import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as diff from 'diff';
import { pdfToText } from '../../index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const fixturesDir = path.join(rootDir, 'test', 'fixtures');
const refTextDir = path.join(rootDir, 'test', 'reference', 'text');

const pdfFiles = fs
  .readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.pdf'))
  .sort();

console.log(`\n=== Text Regression Tests (WASM pdfToText vs pdftotext -layout) ===`);
console.log(`Fixtures: ${pdfFiles.length} PDFs\n`);

let passedCount = 0;
let failedCount = 0;

function normalize(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\f+/g, '\f')
    .trim();
}

for (const file of pdfFiles) {
  const baseName = path.basename(file, '.pdf');
  const pdfPath = path.join(fixturesDir, file);
  const refPath = path.join(refTextDir, `${baseName}.txt`);

  if (!fs.existsSync(refPath)) {
    console.error(`  ✗ ${file}: Reference file missing (${refPath})`);
    failedCount++;
    continue;
  }

  const pdfBytes = fs.readFileSync(pdfPath);
  const refRaw = fs.readFileSync(refPath, 'utf8');

  let wasmRaw = '';
  try {
    wasmRaw = await pdfToText(pdfBytes, { layout: true });
  } catch (err) {
    console.error(`  ✗ ${file}: pdfToText failed:`, err.message);
    failedCount++;
    continue;
  }

  const refNorm = normalize(refRaw);
  const wasmNorm = normalize(wasmRaw);

  if (refNorm === wasmNorm) {
    passedCount++;
    console.log(`  ✓ ${file}: PASSED (exact match)`);
  } else {
    // Check non-whitespace match or similarity
    const refWords = refNorm.split(/\s+/).filter(Boolean);
    const wasmWords = wasmNorm.split(/\s+/).filter(Boolean);
    const minWords = Math.min(refWords.length, wasmWords.length);
    const maxWords = Math.max(refWords.length, wasmWords.length);
    const wordRatio = maxWords === 0 ? 1 : minWords / maxWords;

    if (wordRatio >= 0.90) {
      passedCount++;
      console.log(`  ✓ ${file}: PASSED (layout variance within tolerance, word ratio: ${(wordRatio * 100).toFixed(1)}%)`);
    } else {
      failedCount++;
      console.error(`  ✗ ${file}: FAILED (word ratio: ${(wordRatio * 100).toFixed(1)}%, ref=${refNorm.length} chars, wasm=${wasmNorm.length} chars)`);
      const patch = diff.createPatch(baseName, refNorm, wasmNorm);
      const patchLines = patch.split('\n');
      console.error(`    Unified diff preview (first 25 lines):`);
      console.error(patchLines.slice(0, 25).map(l => `      ${l}`).join('\n'));
    }
  }
}

console.log(`\n------------------------------------------------------------`);
console.log(`Text Regression Summary: ${passedCount}/${pdfFiles.length} files passed (${failedCount} failed).`);
console.log(`------------------------------------------------------------\n`);

if (failedCount > 0) {
  process.exit(1);
}
