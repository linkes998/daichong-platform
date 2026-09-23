/**
 * 真实浏览器渲染检查：通过 Chrome DevTools Protocol 打开页面、捕获控制台错误、整页截图。
 * 运行：node visual-check.js
 * 依赖：本机已安装 Chrome（自动探测），无需 npm 依赖。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
];
const CHROME = CHROME_CANDIDATES.find((p) => p && fs.existsSync(p));
const PORT = 9333;
const BASE = process.env.BASE || 'http://127.0.0.1:8899';
const OUT = path.join(__dirname, 'shots');

const SHOTS = [
  { name: '01-首页', url: '/', actions: [] },
  { name: '02-下单弹窗', url: '/', actions: [{ click: '.prod-card .btn-primary' }, { wait: 700 }] },
  { name: '10-邮箱商品专区', url: '/', actions: [{ click: '#catTabs .cat-tab:nth-child(7)' }, { wait: 600 }] },
  { name: '11-免填账号下单弹窗', url: '/', actions: [{ click: '#catTabs .cat-tab:nth-child(7)' }, { wait: 600 }, { click: '.prod-card .btn-primary' }, { wait: 700 }] },
  { name: '12-AI会员专区', url: '/', actions: [{ click: '#catTabs .cat-tab:nth-child(10)' }, { wait: 600 }] },
  { name: '13-AI会员下单弹窗', url: '/', actions: [{ click: '#catTabs .cat-tab:nth-child(10)' }, { wait: 600 }, { click: '.prod-card .btn-primary' }, { wait: 700 }] },
  { name: '14-海外专区（含X Premium+）', url: '/', actions: [{ click: '#catTabs .cat-tab:nth-child(6)' }, { wait: 600 }] },
  { name: '03-订单查询', url: '/query.html', actions: [{ wait: 400 }] },
  { name: '04-后台登录', url: '/admin.html', actions: [{ wait: 500 }] },
  { name: '05-后台概览', url: '/admin.html', login: true, actions: [{ wait: 1600 }] },
  { name: '06-订单管理', url: '/admin.html#orders', login: true, actions: [{ wait: 1500 }] },
  { name: '07-商品与套餐', url: '/admin.html#products', login: true, actions: [{ wait: 1400 }] },
  { name: '08-商品来源API', url: '/admin.html#suppliers', login: true, actions: [{ wait: 1500 }] },
  { name: '09-系统设置', url: '/admin.html#settings', login: true, actions: [{ wait: 1300 }] },
];

const get = (u) => new Promise((res, rej) => http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(d)); }).on('error', rej));

/** 新建标签页（新版 Chrome 要求 PUT） */
const newTab = (url) =>
  new Promise((res, rej) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: '/json/new?' + url, method: 'PUT' },
      (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }
    );
    req.on('error', rej);
    req.end();
  });

async function waitPort(retry = 40) {
  for (let i = 0; i < retry; i++) {
    try {
      await get(`http://127.0.0.1:${PORT}/json/version`);
      return true;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  throw new Error('Chrome 调试端口未就绪');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method) this.events.push(m);
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('CDP 超时: ' + method)); } }, 30000);
    });
  }
  errors() {
    return this.events
      .filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
      .map((e) =>
        e.method === 'Runtime.exceptionThrown'
          ? (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description) || e.params.exceptionDetails.text
          : e.params.entry.text
      );
  }
  consoleMsgs() {
    return this.events.filter((e) => e.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(e.params.type))
      .map((e) => '[' + e.params.type + '] ' + e.params.args.map((a) => a.value || a.description || '').join(' '));
  }
  clear() { this.events = []; }
}

(async () => {
  if (!CHROME) return console.error('未找到 Chrome，跳过可视化检查');
  fs.mkdirSync(OUT, { recursive: true });
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(OUT, 'profile'), '--window-size=1440,1000', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore', detached: false });

  await waitPort();
  console.log('\n\x1b[36m▶ 真实浏览器渲染检查\x1b[0m\n');

  let issues = 0;
  for (const shot of SHOTS) {
    const tab = await newTab('about:blank');
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    const cdp = new CDP(ws);

    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

    // 后台页面先注入登录态
    if (shot.login) {
      await cdp.send('Page.navigate', { url: BASE + '/admin.html' });
      await new Promise((r) => setTimeout(r, 900));
      const login = await cdp.send('Runtime.evaluate', {
        expression: `fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin888'})}).then(r=>r.json()).then(d=>{localStorage.setItem('admin_token',d.token);return d.ok})`,
        awaitPromise: true, returnByValue: true,
      });
      if (!login.result.value) { console.log('  \x1b[31m✗\x1b[0m 后台登录失败，跳过'); issues++; ws.close(); continue; }
      cdp.clear();
    }

    await cdp.send('Page.navigate', { url: BASE + shot.url });
    await new Promise((r) => setTimeout(r, 1200));

    for (const act of shot.actions) {
      if (act.wait) await new Promise((r) => setTimeout(r, act.wait));
      if (act.click) {
        await cdp.send('Runtime.evaluate', { expression: `document.querySelector('${act.click}') && document.querySelector('${act.click}').click()` });
      }
    }
    await new Promise((r) => setTimeout(r, 500));

    const metrics = await cdp.send('Page.getLayoutMetrics');
    const h = Math.min(Math.ceil(metrics.cssContentSize.height), 4200);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: h, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 350));
    const img = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(OUT, shot.name + '.png'), Buffer.from(img.data, 'base64'));

    const errs = cdp.errors().filter((e) => !/favicon|net::ERR_/i.test(e));
    const warns = cdp.consoleMsgs().filter((e) => !/favicon|DevTools/i.test(e));
    const title = await cdp.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
    const textLen = await cdp.send('Runtime.evaluate', { expression: 'document.body.innerText.trim().length', returnByValue: true });
    const marker = errs.length ? '\x1b[31m✗\x1b[0m' : '\x1b[32m✓\x1b[0m';
    if (errs.length) issues++;
    console.log(`  ${marker} ${shot.name}｜「${title.result.value}」｜正文 ${textLen.result.value} 字符｜高度 ${h}px`);
    errs.slice(0, 4).forEach((e) => console.log('      \x1b[31m错误: ' + String(e).split('\n')[0] + '\x1b[0m'));
    warns.slice(0, 3).forEach((e) => console.log('      \x1b[33m' + String(e).slice(0, 150) + '\x1b[0m'));

    ws.close();
  }

  console.log('\n  截图已保存到 shots/ 目录');
  console.log(issues ? `\n\x1b[31m发现 ${issues} 个页面存在控制台错误\x1b[0m\n` : '\n\x1b[32m所有页面渲染正常，无控制台错误 ✓\x1b[0m\n');
  try { proc.kill(); } catch (e) {}
  process.exitCode = issues ? 1 : 0;
})();
