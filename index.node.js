import {
  createPoppler,
  pdfToImages as pdfToImagesSync,
  pdfToPng as pdfToPngSync,
  pdfToText as pdfToTextSync,
  splitPdfPages,
} from './index.js';
import { runInWorker } from './node-worker-client.js';

/**
 * Extracts PDF text in a worker thread so Poppler does not block Node.js's
 * main event loop.
 */
export function pdfToText(pdfSource, options = {}) {
  return runInWorker('text', pdfSource, options);
}

/**
 * Renders PDF pages in a worker thread so Poppler does not block Node.js's
 * main event loop.
 */
export function pdfToPng(pdfSource, options = {}) {
  return runInWorker('png', pdfSource, options);
}

export const pdfToImages = pdfToPng;
export { createPoppler, splitPdfPages };

// Explicit escape hatches for callers already running inside a worker.
export { pdfToTextSync, pdfToPngSync, pdfToImagesSync };

export default pdfToText;