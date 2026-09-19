import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const fixturesDir = path.join(rootDir, 'test', 'fixtures');
const refTextDir = path.join(rootDir, 'test', 'reference', 'text');

fs.mkdirSync(refTextDir, { recursive: true });

const pdfFiles = fs
  .readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.pdf'))
  .sort();

console.log(`Generating reference text for ${pdfFiles.length} fixtures using pdftotext -layout...`);

let successCount = 0;
for (const file of pdfFiles) {
  const inputPdf = path.join(fixturesDir, file);
  const baseName = path.basename(file, '.pdf');
  const outputTxt = path.join(refTextDir, `${baseName}.txt`);

  try {
    execFileSync('pdftotext', ['-layout', inputPdf, outputTxt], { stdio: 'pipe' });
    const stats = fs.statSync(outputTxt);
    console.log(`  ✓ ${file} -> ${path.relative(rootDir, outputTxt)} (${stats.size} bytes)`);
    successCount++;
  } catch (err) {
    console.error(`  ✗ Failed to generate text for ${file}:`, err.message);
    process.exitCode = 1;
  }
}

console.log(`\nReference text generation complete: ${successCount}/${pdfFiles.length} succeeded.`);
