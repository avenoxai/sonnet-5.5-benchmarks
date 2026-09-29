#!/usr/bin/env node
// Headless-Chrome screenshot tool driven over the DevTools Protocol.
//
// Usage:
//   node tools/shot.js --url index.html?shot=1 --out shots/a.png [options]
//
// Options:
//   --url <path|url>     page to open. Relative paths are resolved against the project root (file://).
//   --out <file.png>     output file (with --cams, "<base>-<cam>.png" is written per camera)
//   --w <px> --h <px>    viewport size (default 1600x900), --dpr <n> device pixel ratio (default 1)
//   --wait <js expr>     truthy expression to wait for (default: window.__ready === true)
//   --timeout <ms>       max wait for readiness (default 180000)
//   --cams a,b,c         after ready, for each name call `await window.PG_APP.setCamera(name)` and capture
//   --eval <js>          run JS (awaited) after ready, before capture; result is printed
//   --logs               print all console messages (errors/warnings are always printed)
//   --keep-open <ms>     wait this long before capture (e.g. for animations)
//   --canvas             capture through PG_APP.screenshot() (gl.readPixels of the WebGL canvas) instead of Page.captureScreenshot; the DOM UI overlay is not included
//   --shot-timeout <ms>  give up on Page.captureScreenshot after this long (default 25000) and use PG_APP.screenshot() (canvas) instead
// Transport is --remote-debugging-pipe (no WebSocket: Node's client stalled on CDP messages > ~4 MB, i.e. big noisy screenshots).
// Exit code 0 on success, 2 on timeout / page error while waiting, 3 when the screenshot could not be taken.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function parseArgs(argv) {
  const o = { w: 1600, h: 900, dpr: 1, wait: 'window.__ready === true', timeout: 180000, cams: [], logs: false, keep: 0, shotTimeout: 25000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const nx = () => argv[++i];
    if (a === '--url') o.url = nx();
    else if (a === '--out') o.out = nx();
    else if (a === '--w') o.w = +nx();
    else if (a === '--h') o.h = +nx();
    else if (a === '--dpr') o.dpr = +nx();
    else if (a === '--wait') o.wait = nx();
    else if (a === '--timeout') o.timeout = +nx();
    else if (a === '--cams') o.cams = nx().split(',').filter(Boolean);
    else if (a === '--eval') o.eval = nx();
    else if (a === '--logs') o.logs = true;
    else if (a === '--keep-open') o.keep = +nx();
    else if (a === '--shot-timeout') o.shotTimeout = +nx();
    else if (a === '--canvas') o.canvas = true;
    else { console.error('unknown arg ' + a); process.exit(1); }
  }
  if (!o.url) { console.error('--url required'); process.exit(1); }
  if (!o.out) o.out = path.join(ROOT, 'shots', 'shot.png');
  return o;
}

function resolveUrl(u) {
  if (/^(https?|file):/.test(u)) return u;
  const [p, q] = u.split('?');
  const abs = path.isAbsolute(p) ? p : path.join(ROOT, p);
  return 'file://' + abs.split('/').map(encodeURIComponent).join('/') + (q ? '?' + q : '');
}

// Profile slots so parallel runs never share a Chrome profile, and we never delete anything.
function acquireSlot() {
  for (let i = 0; i < 48; i++) {
    const lock = `/tmp/pg-chrome-lock-${i}`;
    try { fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'pid'), String(process.pid)); return { i, lock }; }
    catch (e) {
      try {
        const pid = +fs.readFileSync(path.join(lock, 'pid'), 'utf8');
        try { process.kill(pid, 0); } catch (_) { fs.writeFileSync(path.join(lock, 'pid'), String(process.pid)); return { i, lock }; }
      } catch (_) {}
    }
  }
  throw new Error('no free chrome profile slot');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const slot = acquireSlot();
  const profile = `/tmp/pg-chrome-profile-${slot.i}`;
  fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--mute-audio', '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    `--window-size=${o.w},${o.h}`, ...(process.env.PG_CHROME_FLAGS ? process.env.PG_CHROME_FLAGS.split(' ') : []), 'about:blank',
  ], { stdio: process.env.PG_CHROME_LOG ? ['ignore', fs.openSync(process.env.PG_CHROME_LOG, 'w'), fs.openSync(process.env.PG_CHROME_LOG, 'a'), 'pipe', 'pipe'] : ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return; cleaned = true;
    try { chrome.kill('SIGKILL'); } catch (_) {}
    try { fs.unlinkSync(path.join(slot.lock, 'pid')); fs.rmdirSync(slot.lock); } catch (_) {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  // Transport: --remote-debugging-pipe (fd 3 = commands to Chrome, fd 4 = responses, NUL-delimited JSON). The WebSocket transport of
  // Node's built-in client stalls forever on CDP messages larger than a few MB (every large screenshot of a bright scene), the pipe does not.
  let id = 0; const pending = new Map(); let pageError = null, sessionId = null;
  const toChrome = chrome.stdio[3], fromChrome = chrome.stdio[4];
  const rawSend = (method, params, sid) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej }); const msg = { id: i, method, params: params || {} }; if (sid) msg.sessionId = sid;
    toChrome.write(JSON.stringify(msg) + '\0');
  });
  const send = (method, params = {}) => rawSend(method, params, sessionId);
  const fmtArg = a => a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : (a.description || a.type);
  const onMessage = m => {
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
    if (m.method === 'Runtime.consoleAPICalled') {
      const t = m.params.type; const txt = m.params.args.map(fmtArg).join(' ');
      if (o.logs || t === 'error' || t === 'warning' || t === 'assert') console.log(`[console.${t}] ${txt}`);
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails; pageError = (d.exception && d.exception.description) || d.text;
      console.log('[exception] ' + pageError);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry; if (e.level === 'error' || o.logs) console.log(`[log.${e.level}] ${e.text} ${e.url || ''}`);
    }
  };
  let rbuf = Buffer.alloc(0);
  fromChrome.on('data', chunk => {
    rbuf = Buffer.concat([rbuf, chunk]);
    let k;
    while ((k = rbuf.indexOf(0)) >= 0) { const line = rbuf.slice(0, k).toString('utf8'); rbuf = rbuf.slice(k + 1); if (line) { try { onMessage(JSON.parse(line)); } catch (e) { console.error('bad CDP message', e.message); } } }
  });
  chrome.on('exit', () => { if (!cleaned) { console.error('chrome exited unexpectedly'); process.exit(1); } });
  let pageTarget = null;
  for (let i = 0; i < 100 && !pageTarget; i++) {
    try { const t = await rawSend('Target.getTargets', {}); pageTarget = t.targetInfos.find(x => x.type === 'page'); } catch (_) {}
    if (!pageTarget) await sleep(100);
  }
  if (!pageTarget) { console.error('chrome did not start'); cleanup(); process.exit(1); }
  sessionId = (await rawSend('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true })).sessionId;
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: o.w, height: o.h, deviceScaleFactor: o.dpr, mobile: false });
  const url = resolveUrl(o.url);
  const t0 = Date.now();
  await send('Page.navigate', { url });

  let ok = false;
  while (Date.now() - t0 < o.timeout) {
    try {
      const r = await send('Runtime.evaluate', { expression: `(function(){try{return !!(${o.wait})}catch(e){return false}})()`, returnByValue: true });
      if (r.result && r.result.value === true) { ok = true; break; }
    } catch (_) {}
    if (pageError && /SyntaxError|ReferenceError|TypeError/.test(pageError)) break;
    await sleep(250);
  }
  if (!ok) {
    const st = await send('Runtime.evaluate', { expression: 'window.__status || document.title || ""', returnByValue: true }).catch(() => ({}));
    console.error(`TIMEOUT/ERROR waiting for "${o.wait}" after ${Date.now() - t0}ms. status=${st.result && st.result.value}`);
    try { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(o.out.replace(/\.png$/, '') + '-FAILED.png', Buffer.from(s.data, 'base64')); } catch (_) {}
    cleanup(); process.exit(2);
  }
  console.log(`ready in ${Date.now() - t0}ms`);
  if (o.eval) {
    const r = await send('Runtime.evaluate', { expression: o.eval, awaitPromise: true, returnByValue: true });
    console.log('[eval] ' + JSON.stringify(r.result && (r.result.value !== undefined ? r.result.value : r.result.description)) + (r.exceptionDetails ? ' EXC ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description) : ''));
  }
  if (o.keep) await sleep(o.keep);
  const base = o.out.replace(/\.png$/, '');
  const list = o.cams.length ? o.cams : [null];
  for (const cam of list) {
    if (cam) {
      const r = await send('Runtime.evaluate', { expression: `window.PG_APP.setCamera(${JSON.stringify(cam)})`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) console.log('[setCamera error] ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    }
    const f = cam ? `${base}-${cam}.png` : o.out;
    // (Old versions hung on screenshots > ~4 MB because of the WebSocket transport; the pipe transport fixed that. The timeout stays as a safety net.)
    let data = null;
    if (o.canvas) {
      const r = await send('Runtime.evaluate', { expression: 'window.PG_APP ? PG_APP.screenshot() : ""', returnByValue: true });
      const u = r && r.result && r.result.value; if (u && u.indexOf(',') > 0) data = u.slice(u.indexOf(',') + 1);
    } else try {
      const s = await Promise.race([send('Page.captureScreenshot', { format: 'png' }), sleep(o.shotTimeout).then(() => { throw new Error('captureScreenshot timed out'); })]);
      data = s.data;
    } catch (e) {
      console.log('[shot] ' + e.message + ' -> falling back to canvas.toDataURL');
      const alive = await Promise.race([send('Runtime.evaluate', { expression: '1+1', returnByValue: true }), sleep(3000).then(() => null)]).catch(() => null);
      console.log('[shot] page main thread ' + (alive ? 'alive' : 'BLOCKED'));
      const r = await Promise.race([send('Runtime.evaluate', { expression: 'window.PG_APP ? PG_APP.screenshot() : ""', returnByValue: true }), sleep(o.shotTimeout).then(() => null)]).catch(() => null);
      const u = r && r.result && r.result.value; if (u && u.indexOf(',') > 0) data = u.slice(u.indexOf(',') + 1);
    }
    if (!data) { console.error('screenshot failed (Chrome stuck?) - try a smaller --w/--h (< 2500x1440 is safe)'); cleanup(); process.exit(3); }
    fs.writeFileSync(f, Buffer.from(data, 'base64'));
    console.log('wrote ' + f);
  }
  cleanup();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
