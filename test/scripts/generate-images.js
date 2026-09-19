import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const fixturesDir = path.join(rootDir, 'test', 'fixtures');
const refImagesDir = path.join(rootDir, 'test', 'reference', 'images');

fs.mkdirSync(refImagesDir, { recursive: true });

const pdfFiles = fs
  .readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.pdf'))
  .sort();

console.log(`Generating reference images for ${pdfFiles.length} fixtures using pdftoppm -png -r 150...`);

let successCount = 0;
let totalPagesCount = 0;

for (const file of pdfFiles) {
  const inputPdf = path.join(fixturesDir, file);
  const baseName = path.basename(file, '.pdf');
  const outputPrefix = path.join(refImagesDir, baseName);

  try {
    execFileSync('pdftoppm', ['-png', '-r', '150', inputPdf, outputPrefix], { stdio: 'pipe' });
    const generatedImages = fs
      .readdirSync(refImagesDir)
      .filter((img) => img.startsWith(`${baseName}-`) && img.endsWith('.png'));
    totalPagesCount += generatedImages.length;
    console.log(`  ✓ ${file} -> ${generatedImages.length} page(s)`);
    successCount++;
  } catch (err) {
    console.error(`  ✗ Failed to generate images for ${file}:`, err.message);
    process.exitCode = 1;
  }
}

console.log(`\nReference image generation complete: ${successCount}/${pdfFiles.length} files (${totalPagesCount} total pages).`);
