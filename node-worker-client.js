import { Worker } from 'node:worker_threads';

let worker;
let nextRequestId = 1;
const pending = new Map();

function deserializeError(serialized) {
  const error = new Error(serialized.message);
  error.name = serialized.name || 'Error';
  if (serialized.stack) error.stack = serialized.stack;
  return error;
}

function rejectAll(error) {
  for (const { reject } of pending.values()) reject(error);
  pending.clear();
}

function getWorker() {
  if (worker) return worker;

  worker = new Worker(new URL('./node-worker.js', import.meta.url));
  worker.unref();

  worker.on('message', ({ id, result, error }) => {
    const request = pending.get(id);
    if (!request) return;

    pending.delete(id);
    if (pending.size === 0) worker?.unref();

    if (error) request.reject(deserializeError(error));
    else request.resolve(result);
  });

  worker.on('error', (error) => {
    rejectAll(error);
  });

  worker.on('exit', (code) => {
    const exitedWorker = worker;
    worker = undefined;
    if (pending.size > 0) {
      rejectAll(new Error(`PDF worker stopped unexpectedly with exit code ${code}`));
    }
    exitedWorker?.removeAllListeners();
  });

  return worker;
}

async function copyPdfBytes(pdfSource) {
  if (typeof pdfSource?.arrayBuffer === 'function') {
    return new Uint8Array(await pdfSource.arrayBuffer());
  }
  if (pdfSource instanceof Uint8Array) return pdfSource.slice();
  if (pdfSource instanceof ArrayBuffer) return new Uint8Array(pdfSource.slice(0));
  throw new TypeError('Expected Uint8Array, ArrayBuffer, Blob, File, or Buffer');
}

export async function runInWorker(operation, pdfSource, options) {
  const bytes = await copyPdfBytes(pdfSource);
  const id = nextRequestId++;
  const pdfWorker = getWorker();
  pdfWorker.ref();

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      pdfWorker.postMessage(
        { id, operation, bytes, options },
        [bytes.buffer]
      );
    } catch (error) {
      pending.delete(id);
      if (pending.size === 0) pdfWorker.unref();
      reject(error);
    }
  });
}