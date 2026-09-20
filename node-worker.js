import { parentPort } from 'node:worker_threads';
import { pdfToPng, pdfToText } from './index.js';

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: error?.stack,
  };
}

parentPort.on('message', async ({ id, operation, bytes, options }) => {
  try {
    let result;
    if (operation === 'text') result = await pdfToText(bytes, options);
    else if (operation === 'png') result = await pdfToPng(bytes, options);
    else throw new TypeError(`Unknown PDF operation: ${operation}`);

    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: serializeError(error) });
  }
});