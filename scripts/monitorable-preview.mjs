/** Customer-only local preview with in-memory, sessionless WST test receipts. */
import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PBE_PREVIEW_PORT || 8099);
const host = '127.0.0.1';
const origin = `http://${host}:${port}`;
const pages = new Set(['index.html','gallery.html','photo.html','basket.html','liked.html','order.html','campaign.html','support.html','privacy.html','terms.html','data-deletion.html']);
const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split('\n'));
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.avif':'image/avif', '.ico':'image/x-icon', '.mp4':'video/mp4', '.woff2':'font/woff2', '.wasm':'application/wasm', '.sqlite':'application/vnd.sqlite3' };
const stats = { environment:'preview', page_views:0, cta_presses:0, ctas:{}, started_at:new Date().toISOString() };
const receipts = new Set();
const knownCtas = new Set(JSON.parse(await readFile(path.join(root, '.wst/site.json'), 'utf8')).monitorability.cta_ids);

/** Only reviewed customer pages and tracked public assets may leave this server. */
function allowed(file) {
  if (file === 'VERSION' || file === '.wst/site.json' || file === 'wst-actions.js') return true;
  if (['review/monitorable/counter.js','review/monitorable/counter.css','review/monitorable/wst-beacon.js'].includes(file)) return true;
  if (!tracked.has(file)) return false;
  if (!file.includes('/')) return pages.has(file) || /\.(?:m?js|css|ico|webmanifest)$/.test(file);
  if (/^assets\/(?:owner-actions|hidden|reserve|private)\//.test(file)) return false;
  if (file.endsWith('.sqlite')) return file === 'assets/catalog/photosbyelie.sqlite';
  return /^(?:assets|landing-concept|vendor)\//.test(file) && Boolean(types[path.extname(file)]);
}

function send(res, status, body, type='text/plain') {
  res.writeHead(status, { 'Content-Type':type, 'Cache-Control':'no-store', 'X-Robots-Tag':'noindex, nofollow, noarchive', 'X-Content-Type-Options':'nosniff' });
  res.end(body);
}

/** Validate a small test event and retain counts only; reject arbitrary payloads. */
async function collect(req, res) {
  if (req.headers.origin !== origin) return send(res, 403, 'Preview origin required');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 4096) return send(res, 413, 'Event too large');
  }
  const event = JSON.parse(body);
  const topKeys = ['schema_version','event_id','occurred_at','site_id','environment','event_name','source','synthetic','bot_classification','consent_state','properties'];
  const propertyKeys = ['path','locale','referrer_site','campaign','cta_id'];
  const props = event.properties || {};
  const valid = Object.keys(event).every(key => topKeys.includes(key))
    && Object.keys(props).every(key => propertyKeys.includes(key))
    && event.schema_version === 'wst.event.v1' && event.site_id === 'photosbyelie'
    && event.environment === 'preview' && event.synthetic === true
    && event.source === 'browser' && event.consent_state === 'not_required'
    && /^[a-f0-9-]{36}$/.test(event.event_id) && Number.isFinite(Date.parse(event.occurred_at))
    && (props.path === '/' || pages.has(props.path?.slice(1)))
    && ['page_view','cta_press'].includes(event.event_name)
    && (event.event_name !== 'cta_press' || knownCtas.has(props.cta_id));
  if (!valid) return send(res, 400, 'Invalid preview event');
  if (!receipts.has(event.event_id)) {
    if (receipts.size >= 10000) return send(res, 429, 'Restart preview to begin a new counter window');
    receipts.add(event.event_id);
    if (event.event_name === 'page_view') stats.page_views++;
    else { stats.cta_presses++; stats.ctas[props.cta_id] = (stats.ctas[props.cta_id] || 0) + 1; }
  }
  send(res, 202, 'Preview event counted');
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== `${host}:${port}`) return send(res, 403, 'Use the printed preview URL');
    const url = new URL(req.url, origin);
    if (url.pathname === '/__wst/events' && req.method === 'POST') return await collect(req,res);
    if (!['GET','HEAD'].includes(req.method)) return send(res,405,'Method not allowed');
    if (url.pathname === '/__wst/stats') return send(res,200,JSON.stringify(stats),'application/json');
    if (url.pathname === '/robots.txt') return send(res,200,'User-agent: *\nDisallow: /\n');
    // Existing card caption sampling uses a same-origin copy of public thumbnails.
    if (/^\/__photosbyelie\/public-media\/expo\/[a-zA-Z0-9_-]+_(?:320|600|900|1600)\.jpg$/.test(url.pathname)) {
      const mediaKey = url.pathname.slice('/__photosbyelie/public-media/'.length);
      const response = await fetch('https://download.photos-by-elie.com/media/'+mediaKey, { signal:AbortSignal.timeout(10000), redirect:'error' });
      if (!response.ok) return send(res,404,'Public thumbnail unavailable');
      return send(res,200,Buffer.from(await response.arrayBuffer()),'image/jpeg');
    }
    if (url.pathname === '/review/monitorable/' || url.pathname === '/Archive/') { res.writeHead(302,{Location:'/'}); return res.end(); }
    const file = decodeURIComponent(url.pathname).slice(1) || 'index.html';
    if (!allowed(file)) return send(res,404,'Not a public preview asset');
    const filename = await realpath(path.join(root,file));
    if (!filename.startsWith(root)) return send(res,404,'Not found');
    let data = await readFile(filename);
    if (pages.has(file)) {
      const version = (await readFile(path.join(root,'VERSION'),'utf8')).trim();
      let html = data.toString().replace('<head>', '<head><meta name="robots" content="noindex,nofollow,noarchive"><script>window.photosByElieMonitoringPreview=true;</script>');
      html = html.replace('</head>', '<link rel="stylesheet" href="/review/monitorable/counter.css"></head>');
      html = html.replace(/(<body[^>]*>)/, '$1<div class="wst-preview-banner">Photos By Elie preview · v'+version+' · <a href="/">Home</a></div>');
      html = html.replace(/<script src="\.\/analytics\.js[^<]*<\/script>/g,'');
      html = html.replace('</body>', `<footer class="wst-preview-legal"><p>This preview counts page views and button presses to improve the site. No form contents or visitor identifiers are collected.</p><nav aria-label="Privacy and terms"><a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a> · <a href="/data-deletion.html">Data deletion</a></nav></footer><script src="/wst-actions.js"></script><script src="/review/monitorable/wst-beacon.js" data-wst-enabled="true" data-wst-endpoint="/__wst/events" data-wst-site="photosbyelie" data-wst-environment="preview" data-wst-synthetic="true" data-wst-sessionless="true" data-wst-consent="not_required"></script><script src="/review/monitorable/counter.js"></script></body>`);
      data = Buffer.from(html);
    }
    if (file === 'media-config.js') data = Buffer.from(data+'\nwindow.photosByElieMediaConfig.publicMediaHostnames.push("127.0.0.1");\n');
    send(res,200,req.method === 'HEAD' ? '' : data,path.extname(file) === '.mjs' ? 'text/javascript' : types[path.extname(file)] || 'text/plain');
  } catch { send(res,400,'Preview request could not be served'); }
});
server.listen(port,host,() => console.log(`PBE monitorable preview: ${origin}/ (local counters only)`));
