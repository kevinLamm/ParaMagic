import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { publishingTestRuntime } from './publishing-test-runtime.mjs';
import { publishingFixtureDrawing } from './publishing-fixture-drawing.mjs';
import { createPublishingClient } from '../src/PublishingClient.js';

// Isolated, in-memory browser fixture. No production credentials or storage are used.
// The production build starts at worker/index.js and cannot reach these routes.
const { runtime, identity, sessionFor } = await publishingTestRuntime({ providers: false });
const users = { owner: await identity('Local test owner'), other: await identity('Local other owner') };
const fixtureClient = createPublishingClient({ fetchImpl: (path, options) => runtime.dispatchFetch(`http://localhost:5180${path}`, {
  ...options, headers: { ...options?.headers, Origin: 'http://localhost:5180', Cookie: users.owner.cookie },
}) });
const fixture = await fixtureClient.publish(publishingFixtureDrawing());
const root = resolve('dist/client');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const origin = 'http://localhost:5180';
    if (req.headers.host !== 'localhost:5180' && req.headers.host !== '127.0.0.1:5180') { res.writeHead(403).end(); return; }
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/__test__/')) {
      const user = users[url.pathname.slice('/__test__/'.length)];
      if (!user) { res.writeHead(404).end(); return; }
      const session = await sessionFor(user.id);
      res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': `${session.cookie}; Path=/; HttpOnly; SameSite=Lax` })
        .end('<h1>Local test account ready</h1><a href="/">Open editor</a><script>if(opener){opener.postMessage({type:"paramagic-auth",success:true},location.origin);close()}</script>'); return;
    }
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const response = await runtime.dispatchFetch(url.href, { method: req.method, headers: req.headers,
        redirect: 'manual', ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) for await (const chunk of response.body) res.write(chunk);
      res.end(); return;
    }
    const file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(root + sep) && file !== root) { res.writeHead(403).end(); return; }
    let body;
    try { body = await readFile(file); } catch { body = await readFile(resolve(root, 'index.html')); }
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'text/html', 'Cache-Control': 'no-store' }); res.end(body);
  } catch (error) { console.error(error.message); res.writeHead(500).end('Local fixture error'); }
});
server.listen(5180, '127.0.0.1', () => console.log(`Isolated publishing preview: http://localhost:5180\nViewer fixture: http://localhost:5180/?view=${fixture.id}`));
async function stop() { server.close(); await runtime.dispose(); process.exit(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
