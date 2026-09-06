import { sendJson } from './httpResponseHelpers.js';

export function parseBody(request, maxSize = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxSize) {
        request.destroy();
        reject(new Error('REQUEST_BODY_TOO_LARGE'));
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
    request.on('error', () => resolve({}));
  });
}

export async function safeParseBody(request, response) {
  try {
    return await parseBody(request);
  } catch (err) {
    if (err?.message === 'REQUEST_BODY_TOO_LARGE') {
      sendJson(response, 413, { error: 'Request body too large' });
      return null;
    }
    sendJson(response, 400, { error: 'Invalid request body' });
    return null;
  }
}
