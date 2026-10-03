import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.js';

const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
loadEnv();
const { default: agent } = await import('./api/agent.js');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown' };
const port = Number(process.env.PORT) || 3000;

http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/agent')) return agent(req, res);
  const path = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  if (path.includes('..')) { res.writeHead(400); return res.end(); }
  try {
    const buf = await readFile(join(PUBLIC, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(port, () => console.log(`Kindred on http://localhost:${port}${process.env.MOCK === '1' ? ' (MOCK data)' : ''}`));
