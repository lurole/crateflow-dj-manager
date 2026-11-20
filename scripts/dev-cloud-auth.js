import { createServer } from 'node:http';
import handler from '../api/cloud-auth.js';
import { accountPath } from '../lib/cloud-auth.js';

const origin = 'http://127.0.0.1:3000';

createServer(async (req, res) => {
  if (req.url.split('?')[0] !== accountPath) {
    res.writeHead(404).end();
    return;
  }
  res.status = code => { res.statusCode = code; return res; };
  res.send = body => res.end(body);

  try {
    if (req.method === 'POST') {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      req.body = Buffer.concat(chunks).toString('utf8');
    }
    await handler(req, res);
  } catch {
    if (!res.headersSent && !res.destroyed) res.writeHead(500).end();
  }
}).listen(3000, '127.0.0.1', () => {
  console.log('Cloud Auth development route at ' + origin + accountPath);
});
