// Minimal Chrome DevTools Protocol sürücüsü (Node 22, bağımlılık yok).
// Kendi user-data-dir'i ile headless Chrome başlatır, iş bitince süreci kapatır ve klasörü siler.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_BIN || (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function launch({ width = 1200, height = 1200, tag = 'tk' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${tag}-chrome-`));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--hide-scrollbars',
    `--window-size=${width},${height}`, '--no-first-run', '--no-sandbox', '--disable-gpu', '--no-default-browser-check', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--allow-file-access-from-files',
    '--autoplay-policy=no-user-gesture-required', 'about:blank'];
  const proc = spawn(CHROME, args, { stdio: 'ignore' });
  let port = 0;
  for (let i = 0; i < 200; i++) {
    try {
      const f = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n');
      port = parseInt(f[0]); if (port) break;
    } catch { /* bekle */ }
    await sleep(100);
  }
  if (!port) { proc.kill('SIGKILL'); throw new Error('Chrome başlamadı'); }
  let list = [];
  for (let i = 0; i < 50; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.find(x => x.type === 'page')) break; } catch { /* */ }
    await sleep(100);
  }
  const page = list.find(x => x.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method) listeners.forEach(l => l(m));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error('JS hatası: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const close = async () => {
    try { await Promise.race([send('Browser.close'), sleep(1500)]); } catch { /* */ }
    try { ws.close(); } catch { /* */ }
    await sleep(200);
    try { proc.kill('SIGKILL'); } catch { /* */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  };
  const on = (fn) => listeners.push(fn);
  await send('Page.enable'); await send('Runtime.enable');
  return { send, evaluate, close, on, proc };
}

// Sayfayı aç, TKREADY olana kadar bekle, konsol hatalarını topla.
export async function openApp(browser, url) {
  const errors = [];
  browser.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) errors.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  await browser.send('Page.navigate', { url });
  let lastErr = '';
  for (let i = 0; i < 300; i++) {
    try { if (await browser.evaluate('window.TKREADY===true', false)) return errors; } catch (e) { lastErr = String(e).slice(0, 300); }
    await sleep(100);
  }
  errors.push('son bekleme hatası: ' + lastErr);
  throw new Error('Sayfa hazır olmadı. Hatalar: ' + errors.join(' | '));
}
export const appUrl = (root, q = 'capture=1', page = 'index.html') => 'file://' + encodeURI(path.join(root, page)) + '?' + q;
