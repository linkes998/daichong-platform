#!/usr/bin/env node
/**
 * SPA 站点渲染抓取探针（CDP）
 * ---------------------------------------------------------------
 * 用本机 Chrome 真实渲染目标页面，随后：
 *   1) 捕获所有 XHR / fetch 的 JSON 响应体（很多货源站商品数据走接口）
 *   2) 导出渲染后的可见文本（innerText）
 *   3) 可选整页截图
 *
 * 依赖：本机 Chrome/Edge + Node 18+（无 npm 依赖）
 *
 * 用法：
 *   node tools/grab-spa.js --url https://example.com/products --out shots
 *   node tools/grab-spa.js --url ... --wait 12000 --shot
 *   node tools/grab-spa.js --url ... --proxy ""        # 不使用代理（默认读环境变量）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};
const URL_ = arg('url');
const OUT = path.resolve(arg('out', '.'));
const WAIT = Number(arg('wait', 9000));
const PORT = Number(arg('port', 9411));
const SHOT = argv.includes('--shot');

if (!URL_) {
  console.log('用法：node tools/grab-spa.js --url <地址> [--out 目录] [--wait 毫秒] [--shot]');
  process.exit(1);
}

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
  (process.env.LOCALAPPDATA || '') + '/Microsoft/Edge/Application/msedge.exe',
];
const CHROME = CHROME_CANDIDATES.find((p) => p && fs.existsSync(p));

const get = (u) =>
  new Promise((res, rej) =>
    http
      .get(u, (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => res(d));
      })
      .on('error', rej)
  );

const newTab = (url) =>
  new Promise((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/json/new?' + url, method: 'PUT' }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => res(JSON.parse(d)));
    });
    req.on('error', rej);
    req.end();
  });

class CDP {
  constructor(ws, onEvent) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.onEvent = onEvent || (() => {});
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method) {
        this.onEvent(m);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error('CDP 超时: ' + method));
        }
      }, 30000);
    });
  }
}

(async () => {
  if (!CHROME) {
    console.error('未找到 Chrome/Edge');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const profile = path.join(OUT, '.grab-profile-' + PORT);
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=' + PORT,
      '--no-first-run',
      '--no-default-browser-check',
      '--user-data-dir=' + profile,
      '--window-size=1600,1200',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  for (let i = 0; i < 40; i++) {
    try {
      await get(`http://127.0.0.1:${PORT}/json/version`);
      break;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  const tab = await newTab('about:blank');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));

  const apis = [];
  const pendingBodies = [];
  let cdp;
  const handle = (m) => {
    if (m.method === 'Network.responseReceived') {
      const { requestId, response, type } = m.params;
      const t = (response.mimeType || '') + '';
      if (/json|javascript|text\/plain/i.test(t) === false && type !== 'Fetch' && type !== 'XHR') return;
      if (type !== 'Fetch' && type !== 'XHR' && !/json/i.test(t)) return;
      apis.push({ url: response.url, status: response.status, mime: t, reqId: requestId });
      pendingBodies.push(
        cdp
          .send('Network.getResponseBody', { requestId })
          .then((r) => {
            const item = apis.find((a) => a.reqId === requestId);
            if (item) item.body = r.base64Encoded ? '(base64) ' + r.body.slice(0, 200) : r.body.slice(0, 40000);
          })
          .catch(() => {})
      );
    }
    if (m.method === 'Network.loadingFailed') {
      const item = apis.find((a) => a.reqId === m.params.requestId);
      if (item) item.failed = m.params.errorText;
    }
  };
  cdp = new CDP(ws, handle);

  await cdp.send('Network.enable');
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1200, deviceScaleFactor: 1, mobile: false });

  console.log('▶ 渲染 ' + URL_);
  await cdp.send('Page.navigate', { url: URL_ });
  await new Promise((r) => setTimeout(r, WAIT));

  // 渲染后文本
  const txt = await cdp
    .send('Runtime.evaluate', { expression: 'document.body?document.body.innerText:""', returnByValue: true })
    .then((r) => r.result.value || '')
    .catch(() => '');

  await Promise.all(pendingBodies).catch(() => {});

  const base = arg('name', 'spa');

  // 可选：在页面上下文里执行脚本（用于同源 fetch 抓全量接口数据），结果落盘
  const evalFile = arg('eval-file');
  if (evalFile) {
    const expr = fs.readFileSync(path.resolve(process.cwd(), evalFile), 'utf8');
    const r = await cdp
      .send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 90000 })
      .catch((e) => ({ exceptionDetails: { text: e.message } }));
    if (r.exceptionDetails) {
      console.log('\n=== 页面内脚本异常 ===\n' + JSON.stringify(r.exceptionDetails).slice(0, 1200));
    } else {
      const v = r.result && r.result.value;
      const text = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
      const outFile = arg('eval-out', base + '-eval.json');
      fs.writeFileSync(path.join(OUT, outFile), text, 'utf8');
      console.log('\n=== 页面内脚本结果（' + text.length + ' 字节）→ ' + outFile + ' ===');
      console.log(text.slice(0, 2500));
    }
  }

  fs.writeFileSync(path.join(OUT, base + '-text.txt'), txt, 'utf8');
  console.log('\n=== 渲染后可见文本（' + txt.length + ' 字符）===\n' + txt.slice(0, 6000));

  console.log('\n=== 捕获到的接口（' + apis.length + '）===');
  apis.forEach((a) => {
    console.log(`\n[${a.status}] ${a.url}${a.failed ? '  FAILED: ' + a.failed : ''}`);
    if (a.body) console.log('  ' + a.body.replace(/\s+/g, ' ').slice(0, 1200));
  });
  fs.writeFileSync(path.join(OUT, base + '-api.json'), JSON.stringify(apis, null, 2), 'utf8');

  if (SHOT) {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(OUT, base + '.png'), Buffer.from(shot.data, 'base64'));
    console.log('\n截图：' + path.join(OUT, base + '.png'));
  }

  ws.close();
  proc.kill();
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch (e) {}
  console.log('\n临时文件：' + base + '-text.txt / ' + base + '-api.json');
  process.exit(0);
})();
