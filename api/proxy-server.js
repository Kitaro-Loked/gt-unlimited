/**
 * GT UNLIMITED — lightweight CORS proxy for widgets
 *
 * Serves static files from ../web and proxies external API/RSS requests
 * under /api/proxy?url=<encoded-url> to bypass browser CORS limits.
 *
 * Usage:
 *   node api/proxy-server.js
 *   # listens on 0.0.0.0:3456 by default, set PORT env to override
 *
 * Proxied endpoints used by the widgets:
 *   - Polymarket Gamma API
 *   - GDACS disaster RSS
 *   - BBC/other news RSS
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3456;
const WEB_ROOT = path.resolve(__dirname, '../web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(body);
}

function proxyRequest(targetUrl, res) {
  const parsed = url.parse(targetUrl);
  const client = parsed.protocol === 'https:' ? https : http;
  const req = client.request(
    {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      method: 'GET',
      headers: {
        'User-Agent': 'GT-UNLIMITED-Proxy/1.0',
        Accept: '*/*',
      },
      timeout: 20000,
    },
    (upstream) => {
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };
      if (upstream.headers['content-type']) {
        headers['Content-Type'] = upstream.headers['content-type'];
      }
      res.writeHead(upstream.statusCode || 200, headers);
      upstream.pipe(res);
    }
  );
  req.on('error', (err) => {
    console.error('proxy error:', err.message);
    send(res, 502, JSON.stringify({ error: 'proxy error', message: err.message }), 'application/json');
  });
  req.on('timeout', () => {
    req.destroy();
    send(res, 504, JSON.stringify({ error: 'proxy timeout' }), 'application/json');
  });
  req.end();
}

function serveStatic(reqPath, res) {
  const safe = path.normalize(reqPath).replace(/^(\.\.(\/|$))+/, '');
  const file = path.join(WEB_ROOT, safe) || path.join(WEB_ROOT, 'index.html');
  const target = fs.existsSync(file) && fs.statSync(file).isDirectory()
    ? path.join(file, 'index.html')
    : file;

  if (!fs.existsSync(target)) {
    send(res, 404, 'Not found');
    return;
  }

  const ext = path.extname(target).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  fs.createReadStream(target).pipe(res);
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  if (req.method === 'OPTIONS') {
    send(res, 204, '');
    return;
  }

  if (parsed.pathname === '/health') {
    send(res, 200, JSON.stringify({ ok: true, ts: new Date().toISOString() }), 'application/json');
    return;
  }

  if (parsed.pathname === '/api/proxy') {
    const target = parsed.query.url;
    if (!target) {
      send(res, 400, JSON.stringify({ error: 'missing url param' }), 'application/json');
      return;
    }
    try {
      // eslint-disable-next-line no-new
      new URL(target);
    } catch (e) {
      send(res, 400, JSON.stringify({ error: 'invalid url' }), 'application/json');
      return;
    }
    proxyRequest(target, res);
    return;
  }

  serveStatic(parsed.pathname, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`GT UNLIMITED proxy server running at http://0.0.0.0:${PORT}`);
  console.log(`Static root: ${WEB_ROOT}`);
});
