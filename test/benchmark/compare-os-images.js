/**
 * Cross-OS image comparison.
 *
 * Compares ALL renderer outputs between two benchmark runs (e.g. the
 * ubuntu-latest and windows-latest matrix jobs). Every renderer is compared
 * against its OWN counterpart on the other OS — image-by-image, directly:
 *
 *   pdftocairo/<page>.png            (Linux)  vs  pdftocairo/<page>.png (Windows)
 *   nodejs-pdfconvert-wasm/<page>.png (Linux) vs  nodejs-pdfconvert-wasm/... (Windows)
 *   nodejs-pdfjs-dist/<page>.png      (Linux) vs  nodejs-pdfjs-dist/...     (Windows)
 *   playwright-pdfconvert-wasm/...    (Linux) vs  playwright-...            (Windows)
 *   playwright-pdfjs-dist/...         (Linux) vs  playwright-...            (Windows)
 *
 * This is NOT a comparison of baseline-relative diff rates (those are
 * meaningless across OSes); the actual PNGs are diffed pixel-by-pixel.
 *
 * Failure policy: the pdfconvert-wasm renderers run the same platform-
 * independent WASM binary on every OS, so their output MUST be pixel-
 * identical — a difference fails the job. pdftocairo (native poppler,
 * different builds/fonts per OS) and pdfjs-dist (platform canvas/font
 * stacks) legitimately differ across OSes, so their differences are
 * reported in the table but never fail the run.
 *
 * Usage:
 *   node test/benchmark/compare-os-images.js <outDirA> <outDirB> \
 *     [--name-a Linux] [--name-b Windows] [--tolerance 0.05] \
 *     [--out report.md] [--no-fail]
 *
 * outDirA/outDirB are benchmark out dirs containing one subdirectory per
 * renderer (e.g. test/benchmark/out from each OS artifact).
 */

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dirA = process.argv[2];
const dirB = process.argv[3];
if (!dirA || !dirB) {
  console.error('Usage: node compare-os-images.js <outDirA> <outDirB> [--name-a X] [--name-b Y] [--tolerance N] [--out F] [--no-fail]');
  process.exit(2);
}

const nameA = arg('--name-a', 'A');
const nameB = arg('--name-b', 'B');
const tolerance = parseFloat(arg('--tolerance', '0.05'));
const outPath = arg('--out', null);
const noFail = process.argv.includes('--no-fail');

// Renderers whose output must be pixel-identical across OSes.
const ENFORCED = new Set(['nodejs-pdfconvert-wasm', 'playwright-pdfconvert-wasm']);

// Discover renderer subdirs present in both runs.
const subA = new Set(
  fs.readdirSync(dirA, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
);
const subB = new Set(
  fs.readdirSync(dirB, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
);
const renderers = [...subA.intersection(subB)].sort();

const lines = [
  `# Cross-OS image comparison — ${nameA} vs ${nameB}`,
  '',
  'Every renderer is compared against its own counterpart on the other OS',
  '(direct PNG-vs-PNG diff, not baseline-relative diff rates).',
  `Tolerance: ${tolerance.toFixed(2)}% differing pixels.`,
  'pdfconvert-wasm renderers are enforced (same WASM binary ⇒ must be',
  'pixel-identical); pdftocairo/pdfjs-dist differences are informational.',
  '',
];

let totalFailures = 0;
let enforcedFailures = 0;
let compared = 0;

for (const renderer of renderers) {
  const enforced = ENFORCED.has(renderer);
  const filesA = new Set(fs.readdirSync(path.join(dirA, renderer)).filter((f) => f.endsWith('.png')));
  const filesB = new Set(fs.readdirSync(path.join(dirB, renderer)).filter((f) => f.endsWith('.png')));
  const files = [...filesA.union(filesB)].sort();

  lines.push(`## ${renderer}${enforced ? ' (enforced)' : ' (informational)'}`, '');
  lines.push('| Page | diff rate |', '| --- | --- |');

  let rendererWorst = 0;
  let rendererWorstKey = '';
  let rendererFailures = 0;

  for (const f of files) {
    const pa = path.join(dirA, renderer, f);
    const pb = path.join(dirB, renderer, f);
    if (!fs.existsSync(pa) || !fs.existsSync(pb)) {
      const missingIn = !fs.existsSync(pa) ? nameA : nameB;
      lines.push(`| ${f} | missing in ${missingIn} ⚠️ |`);
      rendererFailures++;
      continue;
    }
    const a = PNG.sync.read(fs.readFileSync(pa));
    const b = PNG.sync.read(fs.readFileSync(pb));
    if (a.width !== b.width || a.height !== b.height) {
      lines.push(`| ${f} | dimension mismatch (${a.width}x${a.height} vs ${b.width}x${b.height}) ⚠️ |`);
      rendererFailures++;
      continue;
    }
    const d = pixelmatch(a.data, b.data, null, a.width, a.height, {
      threshold: 0.1,
      includeAA: false,
    });
    const rate = (d / (a.width * a.height)) * 100;
    compared++;
    if (rate > rendererWorst) {
      rendererWorst = rate;
      rendererWorstKey = f;
    }
    const flag = rate > tolerance ? ' ⚠️' : '';
    if (flag) rendererFailures++;
    lines.push(`| ${f} | ${rate.toFixed(2)}%${flag} |`);
  }

  lines.push(
    '',
    `Compared ${files.length} page(s). Max diff rate: **${rendererWorst.toFixed(2)}%**` +
      (rendererWorstKey ? ` (${rendererWorstKey})` : '') +
      '.',
    ''
  );

  totalFailures += rendererFailures;
  if (enforced) enforcedFailures += rendererFailures;
}

lines.push(
  `Summary: ${compared} image pair(s) compared across ${renderers.length} renderer(s). ` +
    (enforcedFailures === 0
      ? '✅ pdfconvert-wasm output is pixel-identical across OSes.'
      : `⚠️ ${enforcedFailures} pdfconvert-wasm page(s) exceed the tolerance.`)
);

const report = lines.join('\n') + '\n';
console.log(report);

if (outPath) {
  fs.writeFileSync(outPath, report);
  console.log(`\nComparison written to ${outPath}`);
}

if (!noFail && enforcedFailures > 0) {
  console.error(
    `\n${enforcedFailures} pdfconvert-wasm page(s) differ by more than ${tolerance}% between ${nameA} and ${nameB}.`
  );
  process.exit(1);
}
