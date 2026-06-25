import fs from 'node:fs';

export function sendVideoFile(response, filePath, requestHeaders = {}) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const rangeHeader = requestHeaders.range || requestHeaders.Range;

  if (!rangeHeader) {
    response.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(response);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader).trim());
  if (!match || (!match[1] && !match[2])) {
    response.writeHead(416, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Range': `bytes */${fileSize}`,
    });
    response.end(JSON.stringify({ error: 'Invalid Range header' }));
    return;
  }

  let start = 0;
  let end = fileSize - 1;
  if (match[1] && match[2]) {
    start = Number(match[1]);
    end = Number(match[2]);
  } else if (match[1]) {
    start = Number(match[1]);
  } else {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      response.writeHead(416, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Range': `bytes */${fileSize}`,
      });
      response.end(JSON.stringify({ error: 'Requested range not satisfiable' }));
      return;
    }
    start = Math.max(fileSize - suffixLength, 0);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= fileSize) {
    response.writeHead(416, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Range': `bytes */${fileSize}`,
    });
    response.end(JSON.stringify({ error: 'Requested range not satisfiable' }));
    return;
  }

  response.writeHead(206, {
    'Content-Type': 'video/mp4',
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Accept-Ranges': 'bytes',
  });
  fs.createReadStream(filePath, { start, end }).pipe(response);
}
