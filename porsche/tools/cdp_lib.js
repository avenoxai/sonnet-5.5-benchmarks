// Small headless-Chrome driver (DevTools Protocol over --remote-debugging-pipe) shared by tools/profile.js.
// (tools/shot.js has its own copy of this plumbing; the behaviour is identical: profile slots in /tmp, no leftover Chrome processes.)
//
//   const { open } = require('./cdp_lib');
//   const page = await open({ url, w, h, dpr, timeout, logs });   // waits for window.__ready
//   const value = await page.eval('expression', true /*awaitPromise*/);
//   await page.close();
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function resolveUrl(u) {
  if (/^(https?|file):/.test(u)) return u;
  const [p, q] = u.split('?');
  const abs = path.isAbsolute(p) ? p : path.join(ROOT, p);
  return 'file://' + abs.split('/').map(encodeURIComponent).join('/') + (q ? '?' + q : '');
}
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

async function open(o) {
  o = Object.assign({ w: 1600, h: 900, dpr: 1, timeout: 180000, logs: false }, o);
  const slot = acquireSlot();
  const profile = `/tmp/pg-chrome-profile-${slot.i}`;
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--mute-audio', '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    `--window-size=${o.w},${o.h}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return; cleaned = true;
    try { chrome.kill('SIGKILL'); } catch (_) {}
    try { fs.unlinkSync(path.join(slot.lock, 'pid')); fs.rmdirSync(slot.lock); } catch (_) {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  let id = 0; const pending = new Map(); let sessionId = null; const messages = [];
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
      const t = m.params.type, txt = m.params.args.map(fmtArg).join(' ');
      if (o.logs || t === 'error' || t === 'warning' || t === 'assert') { messages.push(`[console.${t}] ${txt}`); console.error(`[console.${t}] ${txt}`); }
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails; const t = (d.exception && d.exception.description) || d.text; messages.push('[exception] ' + t); console.error('[exception] ' + t);
    }
  };
  let rbuf = Buffer.alloc(0);
  fromChrome.on('data', chunk => {
    rbuf = Buffer.concat([rbuf, chunk]); let k;
    while ((k = rbuf.indexOf(0)) >= 0) { const line = rbuf.slice(0, k).toString('utf8'); rbuf = rbuf.slice(k + 1); if (line) { try { onMessage(JSON.parse(line)); } catch (e) { /* ignore */ } } }
  });
  chrome.on('exit', () => { if (!cleaned) { console.error('chrome exited unexpectedly'); process.exit(1); } });
  let pageTarget = null;
  for (let i = 0; i < 100 && !pageTarget; i++) {
    try { const t = await rawSend('Target.getTargets', {}); pageTarget = t.targetInfos.find(x => x.type === 'page'); } catch (_) {}
    if (!pageTarget) await sleep(100);
  }
  if (!pageTarget) { cleanup(); throw new Error('chrome did not start'); }
  sessionId = (await rawSend('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true })).sessionId;
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: o.w, height: o.h, deviceScaleFactor: o.dpr, mobile: false });
  const t0 = Date.now();
  await send('Page.navigate', { url: resolveUrl(o.url) });
  let ok = false;
  while (Date.now() - t0 < o.timeout) {
    try { const r = await send('Runtime.evaluate', { expression: '!!window.__ready', returnByValue: true }); if (r.result && r.result.value === true) { ok = true; break; } } catch (_) {}
    await sleep(200);
  }
  if (!ok) {
    const st = await send('Runtime.evaluate', { expression: 'window.__status || ""', returnByValue: true }).catch(() => ({}));
    cleanup(); throw new Error('timeout waiting for window.__ready, status=' + (st.result && st.result.value));
  }
  return {
    readyMs: Date.now() - t0, messages,
    async eval(expression, awaitPromise) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: !!awaitPromise, returnByValue: true });
      if (r.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
      return r.result ? r.result.value : undefined;
    },
    async close() { cleanup(); },
  };
}
module.exports = { open, ROOT };
