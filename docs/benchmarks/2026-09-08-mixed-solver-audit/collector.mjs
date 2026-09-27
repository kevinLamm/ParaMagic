// Local-only audit result sink. Does not change application/server code.
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
const allowed = new Set(['original-browser', 'mixed-browser']);
createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5187');
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<label>Results<textarea id="payload"></textarea></label><button id="save">Save original results</button><output id="status"></output><script>document.querySelector("button").onclick=async()=>{const r=await fetch("/original-browser",{method:"POST",body:document.querySelector("textarea").value});document.querySelector("output").textContent=await r.text()}</script>');
    return;
  }
  const name = req.url.slice(1);
  if (req.method !== 'POST' || !allowed.has(name)) { res.writeHead(400); res.end('Invalid audit output'); return; }
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 20_000_000) { res.writeHead(413); res.end(); return; } }
  const parsed = JSON.parse(body);
  if(parsed.screenshot && ['ottoman','mixed-2','mixed-4'].includes(parsed.screenshot.name)) {
    writeFileSync(new URL(`./${parsed.screenshot.name}.png`,import.meta.url),Buffer.from(parsed.screenshot.base64,'base64'));
    res.end('Saved audit screenshot');return;
  }
  writeFileSync(new URL(`./${name}.json`, import.meta.url), JSON.stringify(parsed, null, 2) + '\n');
  res.end(`Saved ${parsed.results.length} measurements`);
}).listen(5188, '127.0.0.1', () => console.log('Audit collector http://127.0.0.1:5188'));
