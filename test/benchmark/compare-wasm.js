/**
 * Cross-OS WASM determinism check.
 *
 * The pdfconvert-wasm WASM binary is platform-independent, so the PNG it
 * renders for a given fixture page must be pixel-identical on every OS.
 * This script compares the WASM-rendered PNGs from two benchmark runs
 * DIRECTLY (wasm-vs-wasm), instead of comparing baseline-relative diff
 * rates — the latter are meaningless across OSes because each OS diffs
 * against its own pdftocairo baseline (different poppler builds/fonts).
 *
 * Usage:
 *   node test/benchmark/compare-wasm.js <dirA> <dirB> \
 *     [--name-a Linux] [--name-b Windows] [--tolerance 0.05] [--no-fail]
 *
 * dirA/dirB are renderer output dirs containing <pdf>-p<page>.png files
 * (e.g. test/benchmark/out/nodejs-pdfconvert-wasm from each OS artifact).
 *
 * Exits non-zero when any page differs by more than --tolerance %.
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
  console.error('Usage: node compare-wasm.js <dirA> <dirB> [--name-a X] [--name-b Y] [--tolerance N] [--no-fail]');
  process.exit(2);
}

const nameA = arg('--name-a', 'A');
const nameB = arg('--name-b', 'B');
const tolerance = parseFloat(arg('--tolerance', '0.05'));
const noFail = process.argv.includes('--no-fail');

const filesA = new Set(fs.readdirSync(dirA).filter((f) => f.endsWith('.png')));
const filesB = new Set(fs.readdirSync(dirB).filter((f) => f.endsWith('.png')));
const files = [...filesA.union(filesB)].sort();

const lines = [
  `# WASM determinism check — ${nameA} vs ${nameB}`,
  '',
  'Direct wasm-vs-wasm PNG comparison (same WASM binary on both OSes).',
  `Tolerance: ${tolerance.toFixed(2)}% differing pixels.`,
  '',
  '| Page | diff rate |',
  '| --- | --- |',
];

let worst = 0;
let worstKey = '';
let failures = 0;
let compared = 0;

for (const f of files) {
  const pa = path.join(dirA, f);
  const pb = path.join(dirB, f);
  if (!fs.existsSync(pa) || !fs.existsSync(pb)) {
    lines.push(`| ${f} | missing in ${!fs.existsSync(pa) ? nameA : nameB} ⚠️ |`);
    failures++;
    continue;
  }
  const a = PNG.sync.read(fs.readFileSync(pa));
  const b = PNG.sync.read(fs.readFileSync(pb));
  if (a.width !== b.width || a.height !== b.height) {
    lines.push(`| ${f} | dimension mismatch (${a.width}x${a.height} vs ${b.width}x${b.height}) ⚠️ |`);
    failures++;
    continue;
  }
  const d = pixelmatch(a.data, b.data, null, a.width, a.height, {
    threshold: 0.1,
    includeAA: false,
  });
  const rate = (d / (a.width * a.height)) * 100;
  compared++;
  if (rate > worst) {
    worst = rate;
    worstKey = f;
  }
  const flag = rate > tolerance ? ' ⚠️' : '';
  if (flag) failures++;
  lines.push(`| ${f} | ${rate.toFixed(2)}%${flag} |`);
}

lines.push(
  '',
  `Compared ${compared} page(s). Max diff rate: **${worst.toFixed(2)}%**` +
    (worstKey ? ` (${worstKey})` : '') +
    ` (tolerance ${tolerance.toFixed(2)}%). ` +
    (failures === 0
      ? '✅ WASM rendering is pixel-identical across OSes.'
      : `⚠️ ${failures} page(s) exceed the tolerance.`)
);

const report = lines.join('\n') + '\n';
console.log(report);

const outPath = arg('--out', path.join(path.dirname(dirA), 'wasm-compare.md'));
fs.writeFileSync(outPath, report);
console.log(`\nComparison written to ${outPath}`);

if (!noFail && failures > 0) {
  console.error(`\n${failures} page(s) differ by more than ${tolerance}% between ${nameA} and ${nameB}.`);
  process.exit(1);
}
