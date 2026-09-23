/**
 * 云充站 · 虚拟商品代充交易平台
 * 零依赖 Node HTTP 服务：静态资源 + 前台 API + 后台管理 API
 * 启动：node server.js   （默认 http://localhost:8899）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('./lib/db');
const supplier = require('./lib/supplier');
const payment = require('./lib/payment');

const PORT = Number(process.env.PORT || 8899);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

const STATUS_TEXT = {
  pending_payment: '待支付',
  paid: '已支付·待充值',
  recharging: '充值中',
  success: '已完成',
  failed: '充值失败',
  refunded: '已退款',
  closed: '已关闭',
};

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const tokens = new Map(); // token -> { username, name, exp }

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function json(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function ok(res, data) {
  json(res, 200, Object.assign({ ok: true }, data || {}));
}
function fail(res, msg, code) {
  json(res, code || 400, { ok: false, message: msg });
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => {
      buf += c;
      if (buf.length > 2 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      if (!buf) return resolve({});
      const ct = String(req.headers['content-type'] || '');
      if (ct.includes('application/json')) {
        try {
          return resolve(JSON.parse(buf));
        } catch (e) {
          return resolve({});
        }
      }
      const out = {};
      new URLSearchParams(buf).forEach((v, k) => (out[k] = v));
      resolve(out);
    });
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) return fail(res, '非法路径', 403);
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      // 未找到静态文件时回退首页（便于前端路由）
      if (!path.extname(rel)) {
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, home) => {
          if (e2) return fail(res, 'Not Found', 404);
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(home);
        });
      }
      return fail(res, 'Not Found: ' + rel, 404);
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  });
}

function auth(req) {
  const h = String(req.headers.authorization || '');
  const t = h.replace(/^Bearer\s+/i, '').trim();
  if (!t) return null;
  const rec = tokens.get(t);
  if (!rec) return null;
  if (rec.exp < Date.now()) {
    tokens.delete(t);
    return null;
  }
  rec.exp = Date.now() + 8 * 3600 * 1000;
  return rec;
}

/* ------------------------------------------------------------------ */
/* 订单业务                                                            */
/* ------------------------------------------------------------------ */

function decorate(order) {
  const data = db.get();
  const o = Object.assign({}, order);
  o.statusText = STATUS_TEXT[o.status] || o.status;
  const sup = data.suppliers.find((s) => s.id === o.supplierId);
  o.supplierName = sup ? sup.name : '未分配';
  o.grossProfit = round2((o.amount || 0) - (o.cost || 0) * (o.quantity || 1));
  return o;
}

function findSku(skuId) {
  const data = db.get();
  for (const p of data.products) {
    const sku = (p.skus || []).find((s) => s.id === skuId);
    if (sku) return { product: p, sku };
  }
  return null;
}

function pushLog(order, msg, level) {
  order.logs = order.logs || [];
  order.logs.push({ t: new Date().toISOString(), msg, level: level || 'info' });
}

/** 提交订单到商品来源（供应商 API） */
async function dispatch(order, opts) {
  const data = db.get();
  const found = findSku(order.skuId);
  const product = found ? found.product : null;
  const sku = found ? found.sku : null;
  const sup = supplier.resolveSupplier(sku, product);

  order.attempts = (order.attempts || 0) + 1;
  order.supplierId = sup ? sup.id : '';
  order.supplierSku = sku ? sku.supplierSku : '';
  order.status = 'recharging';
  pushLog(order, `第 ${order.attempts} 次提交商品来源：${sup ? sup.name : '无可用来源'}${opts && opts.manual ? '（人工触发）' : ''}`);
  db.save();

  const r = await supplier.submitOrder(order, sup);
  order.lastUpstreamMessage = r.message;
  if (r.supplierOrderNo) order.supplierOrderNo = r.supplierOrderNo;
  pushLog(order, `上游返回：${r.message}`, r.ok ? 'info' : 'error');

  if (!r.ok) {
    order.status = 'failed';
    db.addLog('order.failed', `订单 ${order.no} 充值失败：${r.message}`, 'system');
    db.save();
    return { ok: false, message: r.message };
  }

  if (r.status === 'success') {
    markSuccess(order, '上游同步返回成功');
  } else {
    order.status = 'recharging';
    const delay = sup && sup.mockDelaySec ? sup.mockDelaySec * 1000 : 5000;
    scheduleSettle(order.no, delay);
  }
  db.save();
  return { ok: true, message: r.message };
}

const settleTimers = new Map();

function scheduleSettle(orderNo, delay) {
  if (settleTimers.has(orderNo)) clearTimeout(settleTimers.get(orderNo));
  const t = setTimeout(() => {
    settleTimers.delete(orderNo);
    const data = db.get();
    const order = data.orders.find((o) => o.no === orderNo);
    if (!order || order.status !== 'recharging') return;
    const sup = data.suppliers.find((s) => s.id === order.supplierId);
    if (sup && sup.mode === 'manual') return; // 人工工位只能后台手动完成
    // 与首次提交保持一致的确定性结果
    const r = supplier.md5(order.no + (sup ? sup.id : ''));
    const rate = sup && typeof sup.mockSuccessRate === 'number' ? sup.mockSuccessRate : 0.95;
    const okFlag = parseInt(r.slice(0, 8), 16) / 0xffffffff < rate;
    if (okFlag) markSuccess(order, '上游异步回调：充值成功');
    else {
      order.status = 'failed';
      order.lastUpstreamMessage = '上游异步回调：充值失败（账号校验不通过，示例失败原因）';
      pushLog(order, order.lastUpstreamMessage, 'error');
      db.addLog('order.failed', `订单 ${order.no} 充值失败`, 'system');
    }
    db.save();
  }, Math.max(1200, delay));
  if (t.unref) t.unref();
  settleTimers.set(orderNo, t);
}

function markSuccess(order, reason) {
  if (order.status === 'success') return;
  order.status = 'success';
  order.finishedAt = new Date().toISOString();
  pushLog(order, reason || '充值完成', 'success');
  const data = db.get();
  const found = findSku(order.skuId);
  if (found) {
    found.product.sales = (found.product.sales || 0) + (order.quantity || 1);
    found.sku.stock = Math.max(0, (found.sku.stock || 0) - (order.quantity || 1));
  }
  db.addLog('order.success', `订单 ${order.no} 充值完成`, 'system');
}

/* ------------------------------------------------------------------ */
/* 演示数据：首次启动生成历史订单                                      */
/* ------------------------------------------------------------------ */

function genDemoOrders() {
  const data = db.get();
  if (data.orders.length) return;
  const accounts = {
    phone: () => '138' + String(Math.floor(10000000 + Math.random() * 89999999)),
    email: () => 'user' + Math.floor(1000 + Math.random() * 8999) + '@gmail.com',
    uid: () => String(Math.floor(1000000 + Math.random() * 89999999)),
    username: () => '@user_' + Math.random().toString(36).slice(2, 8),
    gameid: () => '微信区 / 角色ID ' + Math.floor(100000000 + Math.random() * 899999999),
    account: () => 'user' + Math.random().toString(36).slice(2, 8),
  };
  const payCodes = ['alipay', 'wechat', 'qqpay', 'usdt'];
  const now = Date.now();
  const list = [];
  for (let i = 0; i < 86; i++) {
    const p = data.products[Math.floor(Math.random() * data.products.length)];
    const sku = p.skus[Math.floor(Math.random() * p.skus.length)];
    const sup = data.suppliers.find((s) => s.id === sku.supplierId) || data.suppliers[0];
    // 越接近现在，订单越多
    const ageH = Math.pow(Math.random(), 1.7) * 24 * 7;
    const created = new Date(now - ageH * 3600 * 1000);
    const payCode = payCodes[Math.floor(Math.random() * payCodes.length)];
    const isToday = created.toDateString() === new Date().toDateString();
    const r = Math.random();
    let status;
    if (isToday && r < 0.08) status = 'pending_payment';
    else if (isToday && r < 0.16) status = 'recharging';
    else if (r < 0.87) status = 'success';
    else if (r < 0.94) status = 'failed';
    else status = 'refunded';
    const o = {
      no: 'DC' + created.getFullYear() + String(created.getMonth() + 1).padStart(2, '0') + String(created.getDate()).padStart(2, '0') + crypto.randomBytes(3).toString('hex').toUpperCase(),
      productId: p.id,
      productName: p.name,
      skuId: sku.id,
      skuName: sku.name,
      account: p.accountType === 'none' ? '' : accounts[p.accountType] ? accounts[p.accountType]() : 'user_demo',
      accountType: p.accountType || 'account',
      contact: '',
      remark: '',
      quantity: 1,
      price: sku.price,
      cost: sku.cost,
      amount: sku.price,
      faceValue: sku.faceValue,
      payMethod: payCode,
      payMethodName: (data.payMethods.find((m) => m.code === payCode) || {}).name || payCode,
      status,
      supplierId: sup ? sup.id : '',
      supplierSku: sku.supplierSku,
      supplierOrderNo: status === 'success' || status === 'recharging' ? 'SP' + crypto.randomBytes(5).toString('hex').toUpperCase() : '',
      createdAt: created.toISOString(),
      paidAt: status === 'pending_payment' ? '' : new Date(created.getTime() + 60000).toISOString(),
      finishedAt: status === 'success' ? new Date(created.getTime() + 180000).toISOString() : '',
      lastUpstreamMessage: status === 'failed' ? '上游异步回调：充值失败（账号校验不通过）' : '',
      attempts: 1,
      logs: [
        { t: created.toISOString(), msg: '订单创建成功，等待支付', level: 'info' },
        ...(status === 'pending_payment' ? [] : [{ t: created.toISOString(), msg: '支付成功，已提交商品来源', level: 'info' }]),
        ...(status === 'success' ? [{ t: created.toISOString(), msg: '上游回调：充值成功', level: 'success' }] : []),
        ...(status === 'failed' ? [{ t: created.toISOString(), msg: '上游回调：充值失败', level: 'error' }] : []),
      ],
    };
    list.push(o);
  }
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  data.orders = list;
  data.logs = [
    { id: db.uid('L'), action: 'system.init', detail: '系统初始化，导入演示历史订单 ' + list.length + ' 笔', operator: 'system', at: new Date().toISOString() },
  ];
  db.save();
  console.log('[init] 已生成演示订单', list.length, '笔');
}

/* ------------------------------------------------------------------ */
/* 统计                                                                */
/* ------------------------------------------------------------------ */

function overview() {
  const data = db.get();
  const today = new Date().toDateString();
  const isToday = (o) => new Date(o.createdAt).toDateString() === today;
  const paidStatus = ['paid', 'recharging', 'success', 'failed', 'refunded'];
  const todays = data.orders.filter(isToday);
  const todayPaid = todays.filter((o) => paidStatus.includes(o.status));
  const settle = data.orders.filter((o) => ['success', 'failed'].includes(o.status));
  const successList = data.orders.filter((o) => o.status === 'success');
  const revenue = round2(successList.reduce((s, o) => s + o.amount, 0));
  const cost = round2(successList.reduce((s, o) => s + (o.cost || 0) * (o.quantity || 1), 0));

  // 近 7 日趋势
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toDateString();
    const dayOrders = data.orders.filter((o) => new Date(o.createdAt).toDateString() === key);
    const dayOk = dayOrders.filter((o) => o.status === 'success');
    trend.push({
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      orders: dayOrders.length,
      amount: round2(dayOk.reduce((s, o) => s + o.amount, 0)),
      profit: round2(dayOk.reduce((s, o) => s + o.amount - (o.cost || 0) * (o.quantity || 1), 0)),
    });
  }

  // 分类占比
  const catMap = {};
  data.orders
    .filter((o) => o.status === 'success')
    .forEach((o) => {
      const p = data.products.find((x) => x.id === o.productId);
      const c = p ? data.categories.find((x) => x.id === p.catId) : null;
      const name = c ? c.name : '其他';
      catMap[name] = catMap[name] || { name, amount: 0, count: 0 };
      catMap[name].amount = round2(catMap[name].amount + o.amount);
      catMap[name].count++;
    });

  // 通道成功率
  const supStats = data.suppliers.map((s) => {
    const list = data.orders.filter((o) => o.supplierId === s.id && ['success', 'failed'].includes(o.status));
    const okc = list.filter((o) => o.status === 'success').length;
    return {
      id: s.id,
      name: s.name,
      status: s.status,
      total: list.length,
      rate: list.length ? Math.round((okc / list.length) * 1000) / 10 : 0,
      balance: s.balance,
      mode: s.mode,
    };
  });

  return {
    cards: {
      todayOrders: todays.length,
      todayAmount: round2(todayPaid.reduce((s, o) => s + o.amount, 0)),
      todayProfit: round2(todayPaid.reduce((s, o) => s + o.amount - (o.cost || 0), 0)),
      successRate: settle.length ? Math.round((successList.length / settle.length) * 1000) / 10 : 100,
      pendingCount: data.orders.filter((o) => ['pending_payment', 'recharging'].includes(o.status)).length,
      manualCount: data.orders.filter((o) => o.status === 'recharging' && (data.suppliers.find((s) => s.id === o.supplierId) || {}).mode === 'manual').length,
      totalOrders: data.orders.length,
      revenue,
      profit: round2(revenue - cost),
      supplierBalance: round2(data.suppliers.reduce((s, x) => s + (x.balance || 0), 0)),
      productCount: data.products.length,
      activeProductCount: data.products.filter((p) => p.status === 'active').length,
      sandboxMode: !!data.settings.sandboxMode,
      supplierCount: data.suppliers.length,
      activeSupplierCount: data.suppliers.filter((s) => s.status === 'active').length,
      categoryCount: data.categories.length,
    },
    trend,
    categories: Object.values(catMap).sort((a, b) => b.amount - a.amount),
    suppliers: supStats,
    recent: data.orders.slice(0, 10).map(decorate),
    lowStock: data.products
      .flatMap((p) => (p.skus || []).filter((s) => (s.stock || 0) < 100).map((s) => ({ productName: p.name, skuName: s.name, stock: s.stock })))
      .slice(0, 6),
  };
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, pathname, query) {
  const method = req.method.toUpperCase();

  /* ------------------------ 前台 ------------------------ */

  if (pathname === '/api/store' && method === 'GET') {
    const data = db.get();
    const products = data.products
      .filter((p) => p.status === 'active')
      .sort((a, b) => a.sort - b.sort)
      .map((p) => {
        const skus = (p.skus || []).filter((s) => s.status === 'active').sort((a, b) => a.sort - b.sort);
        const prices = skus.map((s) => s.price);
        return Object.assign({}, p, {
          skus,
          minPrice: prices.length ? Math.min(...prices) : 0,
          maxPrice: prices.length ? Math.max(...prices) : 0,
        });
      });
    const s = data.settings;
    return ok(res, {
      settings: {
        siteName: s.siteName,
        siteSubtitle: s.siteSubtitle,
        slogan: s.slogan,
        notice: s.notice,
        service: s.service,
        orderExpireMinutes: s.orderExpireMinutes,
        sandboxMode: !!s.sandboxMode,
      },
      categories: data.categories.filter((c) => c.status !== 'disabled').sort((a, b) => a.sort - b.sort),
      payMethods: data.payMethods.filter((m) => m.enabled).sort((a, b) => a.sort - b.sort),
      products,
    });
  }

  /** 首页实时成交动态（脱敏） */
  if (pathname === '/api/recent' && method === 'GET') {
    const data = db.get();
    const mask = (s) => {
      const str = String(s || '');
      if (str.length <= 4) return str.replace(/./g, '*');
      const at = str.indexOf('@');
      if (at > 1) return str.slice(0, 3) + '***' + str.slice(at);
      return str.slice(0, 3) + '****' + str.slice(-2);
    };
    const list = data.orders
      .filter((o) => ['success', 'recharging', 'paid'].includes(o.status))
      .slice(0, 6)
      .map((o) => ({
        productId: o.productId,
        productName: o.productName,
        skuName: o.skuName,
        maskAccount: mask(o.account),
        createdAt: o.createdAt,
        status: o.status,
      }));
    return ok(res, { list });
  }

  if (pathname.startsWith('/api/product/') && method === 'GET') {
    const id = pathname.split('/')[3];
    const data = db.get();
    const p = data.products.find((x) => x.id === id);
    if (!p) return fail(res, '商品不存在', 404);
    const skus = (p.skus || []).filter((s) => s.status === 'active').sort((a, b) => a.sort - b.sort);
    const cat = data.categories.find((c) => c.id === p.catId);
    const related = data.products.filter((x) => x.catId === p.catId && x.id !== p.id && x.status === 'active').slice(0, 4);
    return ok(res, { product: Object.assign({}, p, { skus, minPrice: skus.length ? Math.min(...skus.map((s) => s.price)) : 0 }), category: cat, related });
  }

  /** 创建订单 —— 前台唯一写操作，一屏完成 */
  if (pathname === '/api/orders' && method === 'POST') {
    const body = await readBody(req);
    const data = db.get();
    const found = findSku(body.skuId);
    if (!found) return fail(res, '套餐不存在或已下架');
    const { product, sku } = found;
    if (product.status !== 'active' || sku.status !== 'active') return fail(res, '该套餐已下架');
    if ((sku.stock || 0) <= 0) return fail(res, '该套餐库存不足，请联系客服');

    // accountType = 'none'：账号 / 卡密类商品（如邮箱账号），买家无需填写充值账号
    const noAccount = product.accountType === 'none';
    const account = noAccount ? '' : String(body.account || '').trim();
    if (!noAccount) {
      if (!account) return fail(res, '请填写充值账号');
      if (product.accountType === 'phone' && !/^1[3-9]\d{9}$/.test(account)) return fail(res, '手机号格式不正确，请检查后重试');
      if (product.accountType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) return fail(res, '邮箱格式不正确，请检查后重试');
      if (product.accountType === 'username' && !/^@?\w{2,}$/.test(account)) return fail(res, '用户名格式不正确，例如 @username');
      if (product.needConfirm && String(body.accountConfirm || '').trim() !== account) return fail(res, '两次填写的充值账号不一致，请核对');
    }

    const payMethod = data.payMethods.find((m) => m.code === body.payMethod && m.enabled) || data.payMethods.find((m) => m.enabled);
    if (!payMethod) return fail(res, '支付方式不可用');

    const qty = Math.max(1, Math.min(10, Number(body.quantity) || 1));
    const now = Date.now();
    const expireMin = data.settings.orderExpireMinutes || 30;
    const order = {
      no: 'DC' + (() => { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); })() + crypto.randomBytes(3).toString('hex').toUpperCase(),
      productId: product.id,
      productName: product.name,
      skuId: sku.id,
      skuName: sku.name,
      account,
      accountType: product.accountType || 'account',
      contact: String(body.contact || '').trim(),
      remark: String(body.remark || '').trim().slice(0, 120),
      quantity: qty,
      price: sku.price,
      cost: sku.cost,
      amount: round2(sku.price * qty),
      faceValue: sku.faceValue,
      payMethod: payMethod.code,
      payMethodName: payMethod.name,
      status: 'pending_payment',
      supplierId: '',
      supplierSku: sku.supplierSku || '',
      supplierOrderNo: '',
      createdAt: new Date(now).toISOString(),
      expireAt: new Date(now + expireMin * 60000).toISOString(),
      paidAt: '',
      finishedAt: '',
      attempts: 0,
      logs: [{ t: new Date(now).toISOString(), msg: '订单创建成功，等待支付', level: 'info' }],
    };
    const pay = payment.createPayment(order);
    order.payTradeNo = pay.tradeNo;
    data.orders.unshift(order);
    db.addLog('order.create', `新订单 ${order.no}｜${product.name} ${sku.name}｜${noAccount ? '免填账号（自动发货）' : '账号 ' + account}｜¥${order.amount}`, 'customer');
    db.save();
    return ok(res, { order: decorate(order), pay });
  }

  /** 沙箱支付回调：标记已支付并自动派单 */
  if (pathname.match(/^\/api\/orders\/[^/]+\/pay$/) && method === 'POST') {
    const no = pathname.split('/')[3];
    const data = db.get();
    const order = data.orders.find((o) => o.no === no);
    if (!order) return fail(res, '订单不存在', 404);
    if (order.status !== 'pending_payment') return ok(res, { order: decorate(order), message: '订单状态无需重复支付' });
    order.status = 'paid';
    order.paidAt = new Date().toISOString();
    pushLog(order, `支付成功（${order.payMethodName}）¥${order.amount}`, 'success');
    db.addLog('order.paid', `订单 ${order.no} 支付成功 ¥${order.amount}`, 'customer');
    db.save();
    if (data.settings.autoRecharge !== false) {
      setTimeout(() => {
        const o = db.get().orders.find((x) => x.no === no);
        if (o && o.status === 'paid') dispatch(o).catch((e) => console.error(e));
      }, 300);
    } else {
      pushLog(order, '自动充值已关闭，等待后台手动派单', 'warn');
      db.save();
    }
    return ok(res, { order: decorate(order), pay: { sandbox: true } });
  }

  /** 供应商异步回调 */
  if (pathname === '/api/callback/supplier' && method === 'POST') {
    const body = await readBody(req);
    let parsed;
    try {
      parsed = supplier.parseCallback(body);
    } catch (e) {
      return fail(res, '回调数据解析失败');
    }
    const data = db.get();
    const order = data.orders.find((o) => o.no === parsed.outTradeNo);
    if (!order) return fail(res, '订单不存在', 404);
    if (parsed.supplierOrderNo) order.supplierOrderNo = parsed.supplierOrderNo;
    pushLog(order, `收到上游回调：${parsed.message || parsed.status}`, parsed.status === 'failed' ? 'error' : 'info');
    if (parsed.status === 'success') markSuccess(order, '上游异步回调：充值成功');
    else if (parsed.status === 'failed') order.status = 'failed';
    db.save();
    return res.writeHead(200, { 'Content-Type': 'text/plain' }).end('SUCCESS');
  }

  /** 支付网关回调（含沙箱） */
  if (pathname === '/api/callback/pay' && method === 'POST') {
    const body = await readBody(req);
    const no = body.out_trade_no || body.outTradeNo || body.no;
    const data = db.get();
    const order = data.orders.find((o) => o.no === no);
    if (!order) return res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ORDER_NOT_FOUND');
    if (order.status === 'pending_payment') {
      order.status = 'paid';
      order.paidAt = new Date().toISOString();
      pushLog(order, '支付网关回调：支付成功', 'success');
      db.save();
      setTimeout(() => {
        const o = db.get().orders.find((x) => x.no === no);
        if (o && o.status === 'paid') dispatch(o).catch((e) => console.error(e));
      }, 300);
    }
    return res.writeHead(200, { 'Content-Type': 'text/plain' }).end('SUCCESS');
  }

  /** 订单查询：订单号 / 充值账号 */
  if (pathname === '/api/orders/query' && method === 'POST') {
    const body = await readBody(req);
    const kw = String(body.keyword || '').trim();
    if (!kw) return fail(res, '请输入订单号或充值账号');
    const data = db.get();
    const list = data.orders
      .filter((o) => o.no.toLowerCase() === kw.toLowerCase() || o.account === kw || (o.contact && o.contact === kw))
      .slice(0, 20)
      .map(decorate);
    if (!list.length) return ok(res, { list: [], message: '未查询到订单，请核对订单号或充值账号' });
    return ok(res, { list });
  }

  if (pathname.match(/^\/api\/orders\/[^/]+$/) && method === 'GET') {
    const no = pathname.split('/')[3];
    const data = db.get();
    const order = data.orders.find((o) => o.no === no);
    if (!order) return fail(res, '订单不存在', 404);
    return ok(res, { order: decorate(order) });
  }

  /* ------------------------ 后台 ------------------------ */

  if (pathname === '/api/admin/login' && method === 'POST') {
    const body = await readBody(req);
    const data = db.get();
    const u = String(body.username || '').trim();
    const p = String(body.password || '');
    const admin = data.admins.find((a) => a.username === u && a.password === p);
    if (!admin) {
      db.addLog('admin.login.fail', `登录失败：${u}`, 'guest');
      return fail(res, '用户名或密码错误', 401);
    }
    const token = crypto.randomBytes(24).toString('hex');
    tokens.set(token, { username: admin.username, name: admin.name, role: admin.role, exp: Date.now() + 8 * 3600 * 1000 });
    admin.lastLogin = new Date().toISOString();
    db.addLog('admin.login', `${admin.name} 登录后台`, admin.username);
    db.save();
    return ok(res, { token, admin: { username: admin.username, name: admin.name, role: admin.role } });
  }

  // 以下均需鉴权
  const isAdminApi = pathname.startsWith('/api/admin/');
  let me = null;
  if (isAdminApi) {
    me = auth(req);
    if (!me) return fail(res, '登录已过期，请重新登录', 401);
  }

  if (pathname === '/api/admin/me' && method === 'GET') {
    return ok(res, { admin: { username: me.username, name: me.name, role: me.role } });
  }

  if (pathname === '/api/admin/overview' && method === 'GET') {
    return ok(res, overview());
  }

  /* ---- 商品 ---- */
  if (pathname === '/api/admin/products' && method === 'GET') {
    const data = db.get();
    const list = data.products.map((p) => {
      const skus = (p.skus || []).map((s) => {
        const sup = data.suppliers.find((x) => x.id === s.supplierId);
        return Object.assign({}, s, {
          supplierName: sup ? sup.name : '未绑定',
          margin: s.price ? Math.round(((s.price - s.cost) / s.price) * 1000) / 10 : 0,
          profit: round2(s.price - s.cost),
        });
      });
      return Object.assign({}, p, {
        skus,
        minPrice: skus.length ? Math.min(...skus.map((s) => s.price)) : 0,
        sales: p.sales || 0,
      });
    });
    return ok(res, { list, categories: data.categories, suppliers: data.suppliers });
  }

  if (pathname === '/api/admin/products' && method === 'POST') {
    const body = await readBody(req);
    const data = db.get();
    const p = body.product || {};
    if (!p.name) return fail(res, '商品名称必填');
    let target;
    if (p.id && data.products.find((x) => x.id === p.id)) {
      target = data.products.find((x) => x.id === p.id);
      Object.assign(target, {
        name: p.name,
        subtitle: p.subtitle || '',
        catId: p.catId || target.catId,
        icon: p.icon || target.icon,
        hue: p.hue || target.hue,
        tags: p.tags || [],
        badge: p.badge || '',
        sort: Number(p.sort) || 0,
        status: p.status || 'active',
        accountType: p.accountType || 'account',
        accountLabel: p.accountLabel || '充值账号',
        accountPlaceholder: p.accountPlaceholder || '',
        accountHint: p.accountHint || '',
        notice: p.notice || '',
        needConfirm: !!p.needConfirm,
        deliveryMode: p.deliveryMode || 'auto',
      });
      db.addLog('product.update', `更新商品：${target.name}`, me.username);
    } else {
      target = {
        id: db.uid('P').toLowerCase(),
        sales: 0,
        skus: [],
        name: p.name,
        subtitle: p.subtitle || '',
        catId: p.catId || (data.categories[0] || {}).id,
        icon: p.icon || '🎁',
        hue: p.hue || '#6d5efc',
        tags: p.tags || [],
        badge: p.badge || '',
        sort: Number(p.sort) || data.products.length + 1,
        status: p.status || 'active',
        accountType: p.accountType || 'account',
        accountLabel: p.accountLabel || '充值账号',
        accountPlaceholder: p.accountPlaceholder || '',
        accountHint: p.accountHint || '',
        notice: p.notice || '',
        needConfirm: !!p.needConfirm,
        deliveryMode: p.deliveryMode || 'auto',
      };
      data.products.push(target);
      db.addLog('product.create', `新增商品：${target.name}`, me.username);
    }
    db.save();
    return ok(res, { product: target });
  }

  if (pathname.startsWith('/api/admin/products/') && method === 'DELETE') {
    const id = pathname.split('/')[4];
    const data = db.get();
    const idx = data.products.findIndex((p) => p.id === id);
    if (idx < 0) return fail(res, '商品不存在', 404);
    const name = data.products[idx].name;
    data.products.splice(idx, 1);
    db.addLog('product.delete', `删除商品：${name}`, me.username);
    db.save();
    return ok(res, {});
  }

  /** 保存套餐（整体覆盖） */
  if (pathname.match(/^\/api\/admin\/products\/[^/]+\/skus$/) && method === 'POST') {
    const id = pathname.split('/')[4];
    const body = await readBody(req);
    const data = db.get();
    const p = data.products.find((x) => x.id === id);
    if (!p) return fail(res, '商品不存在', 404);
    const list = Array.isArray(body.skus) ? body.skus : [];
    p.skus = list.map((s, i) => ({
      id: s.id || db.uid('S').toLowerCase(),
      name: s.name || '未命名套餐',
      faceValue: Number(s.faceValue) || 0,
      price: Number(s.price) || 0,
      cost: Number(s.cost) || 0,
      stock: Number(s.stock) || 0,
      supplierId: s.supplierId || '',
      supplierSku: s.supplierSku || '',
      status: s.status || 'active',
      sort: Number(s.sort) || i + 1,
    }));
    db.addLog('sku.save', `更新商品「${p.name}」套餐 ${p.skus.length} 个`, me.username);
    db.save();
    return ok(res, { product: p });
  }

  /* ---- 分类 ---- */
  if (pathname === '/api/admin/categories' && method === 'POST') {
    const body = await readBody(req);
    const data = db.get();
    const c = body.category || {};
    if (!c.name) return fail(res, '分类名称必填');
    let target = c.id ? data.categories.find((x) => x.id === c.id) : null;
    if (target) Object.assign(target, { name: c.name, icon: c.icon || target.icon, desc: c.desc || '', sort: Number(c.sort) || target.sort, status: c.status || target.status, hue: c.hue || target.hue });
    else {
      target = { id: db.uid('C').toLowerCase(), name: c.name, icon: c.icon || '📦', desc: c.desc || '', sort: data.categories.length + 1, status: 'active', hue: c.hue || '#6d5efc' };
      data.categories.push(target);
    }
    db.addLog('category.save', `保存分类：${target.name}`, me.username);
    db.save();
    return ok(res, { category: target });
  }
  if (pathname.startsWith('/api/admin/categories/') && method === 'DELETE') {
    const id = pathname.split('/')[4];
    const data = db.get();
    const used = data.products.filter((p) => p.catId === id).length;
    if (used) return fail(res, `该分类下还有 ${used} 个商品，请先转移或删除`);
    data.categories = data.categories.filter((c) => c.id !== id);
    db.save();
    return ok(res, {});
  }

  /* ---- 商品来源（供应商 API） ---- */
  if (pathname === '/api/admin/suppliers' && method === 'GET') {
    const data = db.get();
    return ok(res, { list: data.suppliers });
  }

  if (pathname === '/api/admin/suppliers' && method === 'POST') {
    const body = await readBody(req);
    const data = db.get();
    const s = body.supplier || {};
    if (!s.name) return fail(res, '通道名称必填');
    const fields = {
      name: s.name,
      code: s.code || '',
      mode: s.mode || 'api',
      apiUrl: s.apiUrl || '',
      orderPath: s.orderPath || '',
      queryPath: s.queryPath || '',
      method: s.method || 'POST',
      appId: s.appId || '',
      appSecret: s.appSecret || '',
      signType: s.signType || 'md5',
      contentType: s.contentType || 'form',
      timeout: Number(s.timeout) || 15,
      retry: Number(s.retry) || 0,
      markup: Number(s.markup) || 1,
      priority: Number(s.priority) || 0,
      balance: Number(s.balance) || 0,
      mockSuccessRate: s.mockSuccessRate === undefined ? 0.95 : Number(s.mockSuccessRate),
      mockDelaySec: s.mockDelaySec === undefined ? 5 : Number(s.mockDelaySec),
      notifyUrl: s.notifyUrl || '',
      categories: s.categories || [],
      status: s.status || 'active',
      remark: s.remark || '',
    };
    let target = s.id ? data.suppliers.find((x) => x.id === s.id) : null;
    if (target) {
      Object.assign(target, fields);
      db.addLog('supplier.update', `更新商品来源：${target.name}`, me.username);
    } else {
      target = Object.assign({ id: db.uid('SP').toLowerCase() }, fields);
      data.suppliers.push(target);
      db.addLog('supplier.create', `新增商品来源：${target.name}`, me.username);
    }
    db.save();
    return ok(res, { supplier: target });
  }

  if (pathname.startsWith('/api/admin/suppliers/') && pathname.endsWith('/test') && method === 'POST') {
    const id = pathname.split('/')[4];
    const data = db.get();
    const s = data.suppliers.find((x) => x.id === id);
    if (!s) return fail(res, '通道不存在', 404);
    const r = await supplier.testConnection(s);
    db.addLog('supplier.test', `测试通道「${s.name}」：${r.message}`, me.username);
    return ok(res, { result: r });
  }

  if (pathname.startsWith('/api/admin/suppliers/') && method === 'DELETE') {
    const id = pathname.split('/')[4];
    const data = db.get();
    const used = data.products.flatMap((p) => p.skus || []).filter((s) => s.supplierId === id).length;
    if (used) return fail(res, `还有 ${used} 个套餐绑定该通道，请先改绑`);
    data.suppliers = data.suppliers.filter((s) => s.id !== id);
    db.addLog('supplier.delete', `删除通道 ` + id, me.username);
    db.save();
    return ok(res, {});
  }

  /* ---- 订单 ---- */
  if (pathname === '/api/admin/orders' && method === 'GET') {
    const data = db.get();
    const status = query.get('status') || '';
    const kw = (query.get('keyword') || '').trim().toLowerCase();
    const productId = query.get('productId') || '';
    const page = Math.max(1, Number(query.get('page')) || 1);
    const size = Math.max(1, Math.min(100, Number(query.get('size')) || 20));
    let list = data.orders.slice();
    if (status) list = list.filter((o) => o.status === status);
    if (productId) list = list.filter((o) => o.productId === productId);
    if (kw) list = list.filter((o) => (o.no + o.account + o.productName + (o.supplierOrderNo || '')).toLowerCase().includes(kw));
    const total = list.length;
    const pageList = list.slice((page - 1) * size, page * size).map(decorate);
    const counts = {};
    Object.keys(STATUS_TEXT).forEach((k) => (counts[k] = data.orders.filter((o) => o.status === k).length));
    return ok(res, { list: pageList, total, page, size, counts, statusText: STATUS_TEXT });
  }

  /** 订单操作：重试派单 / 手动完成 / 标记失败 / 退款 / 关闭 / 改账号 */
  if (pathname.match(/^\/api\/admin\/orders\/[^/]+\/action$/) && method === 'POST') {
    const no = pathname.split('/')[4];
    const body = await readBody(req);
    const data = db.get();
    const order = data.orders.find((o) => o.no === no);
    if (!order) return fail(res, '订单不存在', 404);
    const action = body.action;
    if (action === 'retry') {
      if (['success', 'closed'].includes(order.status)) return fail(res, '订单已终结，无法重试');
      order.status = 'paid';
      pushLog(order, `后台手动重试派单（操作人：${me.name}）`, 'warn');
      db.save();
      const r = await dispatch(order, { manual: true });
      db.addLog('order.retry', `订单 ${order.no} 重试派单：${r.message}`, me.username);
      db.save();
      return ok(res, { order: decorate(order), message: r.message });
    }
    if (action === 'complete') {
      markSuccess(order, `后台手动标记完成（操作人：${me.name}）`);
      db.save();
      return ok(res, { order: decorate(order) });
    }
    if (action === 'fail') {
      order.status = 'failed';
      order.lastUpstreamMessage = body.reason || '后台手动标记失败';
      pushLog(order, `后台标记失败：${order.lastUpstreamMessage}`, 'error');
      db.addLog('order.fail', `订单 ${order.no} 标记失败`, me.username);
      db.save();
      return ok(res, { order: decorate(order) });
    }
    if (action === 'refund') {
      if (!['success', 'failed'].includes(order.status)) return fail(res, '仅已完成或失败的订单可退款');
      order.status = 'refunded';
      order.refundedAt = new Date().toISOString();
      order.refundAmount = order.amount;
      pushLog(order, `已退款 ¥${order.amount}（操作人：${me.name}）`, 'warn');
      db.addLog('order.refund', `订单 ${order.no} 退款 ¥${order.amount}`, me.username);
      db.save();
      return ok(res, { order: decorate(order) });
    }
    if (action === 'close') {
      order.status = 'closed';
      pushLog(order, `订单关闭（操作人：${me.name}）`, 'warn');
      db.addLog('order.close', `订单 ${order.no} 关闭`, me.username);
      db.save();
      return ok(res, { order: decorate(order) });
    }
    if (action === 'note') {
      pushLog(order, `备注：${body.text || ''}（${me.name}）`, 'info');
      db.save();
      return ok(res, { order: decorate(order) });
    }
    return fail(res, '未知操作');
  }

  /** 批量派单：把已支付未派单的订单一次性推到上游 */
  if (pathname === '/api/admin/orders/batch-dispatch' && method === 'POST') {
    const data = db.get();
    const list = data.orders.filter((o) => o.status === 'paid');
    let okc = 0;
    for (const o of list) {
      const r = await dispatch(o, { manual: true });
      if (r.ok) okc++;
    }
    db.addLog('order.batch', `批量派单：成功提交 ${okc}/${list.length} 笔`, me.username);
    return ok(res, { total: list.length, dispatched: okc });
  }

  if (pathname === '/api/admin/orders/export' && method === 'GET') {
    const data = db.get();
    const head = ['订单号', '商品', '套餐', '充值账号', '金额', '成本', '毛利', '支付方式', '状态', '来源通道', '上游单号', '下单时间', '完成时间'];
    const rows = data.orders.map((o) => {
      const sup = data.suppliers.find((s) => s.id === o.supplierId);
      return [
        o.no, o.productName, o.skuName, o.account, o.amount, o.cost, round2(o.amount - (o.cost || 0) * (o.quantity || 1)),
        o.payMethodName, STATUS_TEXT[o.status] || o.status, sup ? sup.name : '', o.supplierOrderNo || '',
        new Date(o.createdAt).toLocaleString('zh-CN'), o.finishedAt ? new Date(o.finishedAt).toLocaleString('zh-CN') : '',
      ];
    });
    const csv = '\ufeff' + [head, ...rows].map((r) => r.map((c) => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    db.addLog('order.export', `导出订单 ${rows.length} 行`, me.username);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="orders-' + Date.now() + '.csv"',
    });
    return res.end(csv);
  }

  /* ---- 设置 / 日志 / 系统 ---- */
  if (pathname === '/api/admin/settings' && method === 'GET') {
    const data = db.get();
    return ok(res, { settings: data.settings, payMethods: data.payMethods, payConfig: data.payConfig, admins: data.admins.map((a) => ({ username: a.username, name: a.name, role: a.role, lastLogin: a.lastLogin })) });
  }

  if (pathname === '/api/admin/settings' && method === 'POST') {
    const body = await readBody(req);
    const data = db.get();
    if (body.settings) Object.assign(data.settings, body.settings);
    if (Array.isArray(body.payMethods)) data.payMethods = body.payMethods;
    if (body.payConfig) Object.assign(data.payConfig, body.payConfig);
    if (body.admin && body.admin.username) {
      const a = data.admins.find((x) => x.username === me.username);
      if (a) {
        if (body.admin.newPassword) {
          if (body.admin.oldPassword !== a.password) return fail(res, '原密码不正确');
          a.password = body.admin.newPassword;
        }
        if (body.admin.name) a.name = body.admin.name;
      }
    }
    db.addLog('settings.save', '更新系统设置', me.username);
    db.save();
    return ok(res, { settings: data.settings, payMethods: data.payMethods, payConfig: data.payConfig });
  }

  if (pathname === '/api/admin/logs' && method === 'GET') {
    const data = db.get();
    return ok(res, { list: data.logs.slice(0, 200) });
  }

  if (pathname === '/api/admin/reset-demo' && method === 'POST') {
    const data = db.get();
    data.orders = [];
    genDemoOrders();
    db.addLog('system.reset', '重置并重新生成演示订单', me.username);
    return ok(res, { count: db.get().orders.length });
  }

  return fail(res, '接口不存在：' + pathname, 404);
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = u.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    });
    return res.end();
  }

  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname, u.searchParams);
    return serveStatic(req, res, pathname);
  } catch (e) {
    console.error('[error]', pathname, e);
    return fail(res, '服务器内部错误：' + (e.message || e), 500);
  }
});

db.load();
genDemoOrders();

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ┌───────────────────────────────────────────────┐');
  console.log('  │  云充站 · 虚拟商品代充平台已启动              │');
  console.log('  └───────────────────────────────────────────────┘');
  console.log('   前台商城：http://' + HOST + ':' + PORT + '/');
  console.log('   后台管理：http://' + HOST + ':' + PORT + '/admin.html   (admin / admin888)');
  console.log('   订单查询：http://' + HOST + ':' + PORT + '/query.html');
  console.log('   数据文件：' + db.DB_FILE);
  console.log('');
});
