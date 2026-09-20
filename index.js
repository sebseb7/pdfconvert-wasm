import createPopplerModule from './poppler.js';

let popplerModulePromise;

function getPopplerModule() {
  if (!popplerModulePromise) {
    popplerModulePromise = createPopplerModule().catch((error) => {
      popplerModulePromise = undefined;
      throw error;
    });
  }
  return popplerModulePromise;
}

function toUint8Array(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(source)) return new Uint8Array(source);
  throw new TypeError('Expected Uint8Array, ArrayBuffer, Blob, File, or Buffer');
}

async function resolvePdfBytes(pdfSource) {
  if (typeof pdfSource?.arrayBuffer === 'function') {
    return new Uint8Array(await pdfSource.arrayBuffer());
  }
  return toUint8Array(pdfSource);
}

/**
 * Converts a PDF buffer to text directly in memory.
 *
 * @param {Uint8Array|ArrayBuffer|Blob|File} pdfSource - PDF file or buffer
 * @param {Object} [options]
 * @param {boolean} [options.layout=true] - Maintain physical layout (identical to -layout)
 * @param {number} [options.firstPage=1] - First page to convert (1-based)
 * @param {number} [options.lastPage=-1] - Last page to convert (1-based, -1 for all)
 * @param {boolean} [options.noPageBreaks=false] - Don't insert form-feed page breaks between pages
 * @returns {Promise<string>} The extracted text
 */
export async function pdfToText(pdfSource, options = {}) {
  const {
    layout = true,
    firstPage = 1,
    lastPage = -1,
    noPageBreaks = false,
  } = options;

  const bytes = await resolvePdfBytes(pdfSource);
  const mod = await getPopplerModule();

  const ptr = mod._malloc(bytes.length);
  mod.HEAPU8.set(bytes, ptr);

  let text = '';
  let doc = 0;
  try {
    doc = mod._poppler_open_document(ptr, bytes.length);
    if (!doc) return text;

    const textPtr = mod._poppler_extract_text(
      doc,
      layout ? 1 : 0,
      firstPage != null ? firstPage : 1,
      lastPage != null ? lastPage : -1,
      noPageBreaks ? 1 : 0
    );
    if (textPtr) {
      text = mod.UTF8ToString(textPtr);
      mod._poppler_free(textPtr);
    }
  } finally {
    if (doc) mod._poppler_close_document(doc);
    mod._free(ptr);
  }

  return text;
}

/**
 * Converts PDF pages into PNG images directly in memory.
 *
 * @param {Uint8Array|ArrayBuffer|Blob|File} pdfSource - PDF file or buffer
 * @param {Object} [options]
 * @param {number} [options.dpi=150] - Resolution in DPI (default: 150)
 * @param {number} [options.firstPage] - First page to convert (1-based)
 * @param {number} [options.lastPage] - Last page to convert (1-based)
 * @param {number} [options.scaleTo] - Scale longest edge to this size in pixels, preserving aspect ratio
 * @param {number} [options.scaleToX] - Scale width to this size in pixels (-1 for proportional)
 * @param {number} [options.scaleToY] - Scale height to this size in pixels (-1 for proportional)
 * @param {boolean} [options.singleFile=false] - Only render the first requested page
 * @returns {Promise<Array<{ pageNumber: number, name: string, data: Uint8Array, blob: Blob|null, dataUrl: string|null }>>}
 */
export async function pdfToPng(pdfSource, options = {}) {
  const {
    dpi = 150,
    resolution,
    firstPage,
    lastPage,
    scaleTo,
    scaleToX,
    scaleToY,
    singleFile = false,
  } = options;

  const targetDpi = dpi ?? resolution ?? 150;

  const bytes = await resolvePdfBytes(pdfSource);
  const mod = await getPopplerModule();

  const ptr = mod._malloc(bytes.length);
  mod.HEAPU8.set(bytes, ptr);

  const results = [];
  const lenPtr = mod._malloc(4);
  let doc = 0;

  try {
    doc = mod._poppler_open_document(ptr, bytes.length);
    if (!doc) return results;

    const totalPages = mod._poppler_get_page_count(doc);
    const startP = Math.max(1, firstPage || 1);
    let endP = (lastPage != null && lastPage <= totalPages) ? lastPage : totalPages;
    if (singleFile) endP = startP;

    for (let p = startP; p <= endP; p++) {
      const pngPtr = mod._poppler_render_page_png(
        doc,
        p,
        targetDpi,
        scaleTo != null ? scaleTo : -1,
        scaleToX != null ? scaleToX : -1,
        scaleToY != null ? scaleToY : -1,
        lenPtr
      );

      if (pngPtr) {
        const pngLen = mod.HEAP32[lenPtr >> 2];
        const data = new Uint8Array(mod.HEAPU8.buffer, pngPtr, pngLen).slice();
        mod._poppler_free(pngPtr);

        let blob = null;
        if (typeof Blob !== 'undefined') {
          blob = new Blob([data], { type: 'image/png' });
        }

        let dataUrl = null;
        if (typeof btoa !== 'undefined') {
          let binary = '';
          const len = data.byteLength;
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(data[i]);
          }
          dataUrl = `data:image/png;base64,${btoa(binary)}`;
        }

        results.push({
          pageNumber: p,
          name: singleFile ? 'page.png' : `page-${p}.png`,
          data,
          blob,
          dataUrl,
        });
      }
    }
  } finally {
    if (doc) mod._poppler_close_document(doc);
    mod._free(lenPtr);
    mod._free(ptr);
  }

  return results;
}

/**
 * Splits extracted text into individual pages by form feed ('\f').
 *
 * @param {string} text - Raw extracted text
 * @returns {string[]} Array of non-empty page strings
 */
export function splitPdfPages(text) {
  return text
    .split('\f')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export const pdfToImages = pdfToPng;
export { createPopplerModule as createPoppler };
export default pdfToText;
