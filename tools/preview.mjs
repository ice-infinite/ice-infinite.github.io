import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.json':'application/json', '.txt':'text/plain', '.xml':'application/xml', '.apk':'application/vnd.android.package-archive' };

export function previewServer(port = 4190) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const name = pathname === '/' ? 'index.html' : pathname.slice(1);
      const path = resolve(root, name);
      if (!path.startsWith(resolve(root) + sep) ||
          !(name.startsWith('assets/') || /^downloads\/anyao-\d+\.\d+\.\d+-\d+-arm64-v8a\.apk$/.test(name) || ['index.html','privacy.html','robots.txt','sitemap.xml'].includes(name))) {
        response.writeHead(404).end('Not found'); return;
      }
      const data = await readFile(path);
      const headers = {'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'};
      if (extname(path) === '.apk') headers['Content-Disposition'] = `attachment; filename="${basename(path)}"`;
      response.writeHead(200, headers).end(data);
    } catch { response.writeHead(404).end('Not found'); }
  });
  return new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => done(server));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await previewServer();
  console.log(`Local: http://127.0.0.1:${server.address().port}/`);
}
