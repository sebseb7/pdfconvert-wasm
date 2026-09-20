/**
 * Cross-OS pixel-diff-rate comparison.
 *
 * Compares the pixeldiffrate columns of two benchmark reports (e.g. the
 * ubuntu-latest and windows-latest matrix runs) and prints a markdown table
 * to the console. The pixel diff rate is deterministic for a given renderer
 * + fixture + WASM binary, so both OS rows should agree; any difference
 * indicates a platform-dependent rendering discrepancy worth investigating.
 *
 * Usage:
 *   node test/benchmark/compare-os.js <reportA.json> <reportB.json> \
 *     [--name-a Linux] [--name-b Windows] [--tolerance 0.05]
 *
 * Exits non-zero when any pixeldiffrate differs by more than --tolerance
 * percentage points (unless --no-fail is passed).
 */

import fs from 'node:fs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const reportAPath = process.argv[2];
const reportBPath = process.argv[3];
if (!reportAPath || !reportBPath) {
  console.error('Usage: node compare-os.js <reportA.json> <reportB.json> [--name-a X] [--name-b Y] [--tolerance N] [--no-fail]');
  process.exit(2);
}

const nameA = arg('--name-a', 'A');
const nameB = arg('--name-b', 'B');
const tolerance = parseFloat(arg('--tolerance', '0.05'));
const noFail = process.argv.includes('--no-fail');

const rowsA = JSON.parse(fs.readFileSync(reportAPath, 'utf8'));
const rowsB = JSON.parse(fs.readFileSync(reportBPath, 'utf8'));

// report.json rows: { pdf, page, nodeWasmDiff, nodePdfjsDiff, browserWasmDiff, browserPdfjsDiff, ... }
const diffColumns = [
  ['nodeWasmDiff', 'nodejs-pdfconvert-wasm'],
  ['nodePdfjsDiff', 'nodejs-pdfjs-dist'],
  ['browserWasmDiff', 'playwright-pdfconvert-wasm'],
  ['browserPdfjsDiff', 'playwright-pdfjs-dist'],
];

const byKeyA = new Map(rowsA.map((r) => [`${r.pdf}-p${r.page}`, r]));
const byKeyB = new Map(rowsB.map((r) => [`${r.pdf}-p${r.page}`, r]));

const keys = [...new Set([...byKeyA.keys(), ...byKeyB.keys()])].sort();

const fmt = (v) => (v == null ? 'n/a' : `${v.toFixed(2)}%`);

const header = ['Page', ...diffColumns.flatMap(([, label]) => [`${label} (${nameA})`, `${label} (${nameB})`, 'Δ'])];
const lines = [
  `# Pixel diff rate comparison — ${nameA} vs ${nameB}`,
  '',
  `Tolerance: ${tolerance.toFixed(2)} percentage points. Δ = |${nameA} − ${nameB}|.`,
  '',
  `| ${header.join(' | ')} |`,
  `| ${header.map(() => '---').join(' | ')} |`,
];

let worst = 0;
let failures = 0;

for (const key of keys) {
  const a = byKeyA.get(key) || {};
  const b = byKeyB.get(key) || {};
  const cells = [key];

  for (const [col] of diffColumns) {
    const va = a[col];
    const vb = b[col];
    const delta = va != null && vb != null ? Math.abs(va - vb) : null;
    if (delta != null) worst = Math.max(worst, delta);
    const flag = delta != null && delta > tolerance ? ' ⚠️' : '';
    if (flag) failures++;
    cells.push(`${fmt(va)}${flag}`, fmt(vb), delta == null ? 'n/a' : `${delta.toFixed(2)}${flag}`);
  }

  lines.push(`| ${cells.join(' | ')} |`);
}

lines.push(
  '',
  `Max Δ across all renderers/pages: **${worst.toFixed(2)}** percentage points ` +
    `(tolerance ${tolerance.toFixed(2)}). ` +
    (failures === 0
      ? '✅ All pixeldiffrates agree across OSes.'
      : `⚠️ ${failures} cell(s) exceed the tolerance.`)
);

const report = lines.join('\n') + '\n';
console.log(report);

// Also write next to the inputs for artifact upload.
const outPath = reportAPath.replace(/\.json$/, '-compare.md');
fs.writeFileSync(outPath, report);
console.log(`\nComparison written to ${outPath}`);

if (!noFail && failures > 0) {
  console.error(`\n${failures} pixeldiffrate cell(s) differ by more than ${tolerance} points between ${nameA} and ${nameB}.`);
  process.exit(1);
}
