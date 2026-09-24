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
const i18n = require('./lib/i18n');

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
const loginFails = new Map(); // `${username}|${ip}` -> { n, first } 登录失败限流

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ------------------------------------------------------------------ */
/* 管理员口令：scrypt 加盐哈希                                          */
/*   · 历史数据是明文 password 字段，首次登录成功后自动升级为哈希        */
/*   · 明文仅在迁移瞬间使用，升级后立即从数据库中删除                    */
/* ------------------------------------------------------------------ */

const PW_MIN = 8;
const PW_MAX = 64;

function makeHash(plain, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  return { salt: s, hash: crypto.scryptSync(String(plain), s, 32).toString('hex') };
}

/** 校验口令：优先哈希比对，兼容历史明文 */
function verifyAdminPassword(admin, plain) {
  if (!admin) return false;
  const p = String(plain == null ? '' : plain);
  if (admin.passwordHash && admin.passwordSalt) {
    const { hash } = makeHash(p, admin.passwordSalt);
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(String(admin.passwordHash), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  if (typeof admin.password === 'string' && admin.password) return admin.password === p;
  return false;
}

/** 写入口令：改为哈希存储并删除明文 */
function setAdminPassword(admin, plain) {
  const { salt, hash } = makeHash(plain);
  admin.passwordSalt = salt;
  admin.passwordHash = hash;
  if ('password' in admin) delete admin.password;
  admin.passwordUpdatedAt = new Date().toISOString();
}

/** 口令强度校验，返回错误信息或空字符串 */
function validateNewPassword(pw, oldPw) {
  const p = String(pw == null ? '' : pw);
  if (!p) return '请填写新密码';
  if (p.length < PW_MIN) return `新密码至少 ${PW_MIN} 位`;
  if (p.length > PW_MAX) return `新密码最多 ${PW_MAX} 位`;
  if (/\s/.test(p)) return '新密码不能包含空格';
  if (oldPw && p === String(oldPw)) return '新密码不能与原密码相同';
  if (/^\d+$/.test(p)) return '新密码不能是纯数字';
  return '';
}

/** 使除当前 token 之外的所有会话失效 */
function revokeOtherTokens(keepToken, username) {
  let n = 0;
  for (const [t, rec] of tokens) {
    if (t === keepToken) continue;
    if (!username || rec.username === username) {
      tokens.delete(t);
      n++;
    }
  }
  return n;
}

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
/* 启动时同步：补齐新增收款方式与通道配置（不覆盖已有设置）             */
/* ------------------------------------------------------------------ */

function syncPayMethods() {
  const data = db.get();
  data.payMethods = Array.isArray(data.payMethods) ? data.payMethods : [];
  let added = 0;
  payment.METHOD_DEFS.forEach((def) => {
    const cur = data.payMethods.find((m) => m.code === def.code);
    if (!cur) {
      data.payMethods.push(Object.assign({}, def));
      added++;
    } else {
      // 只补缺失字段，保留运营已配置的开关/名称/排序
      Object.keys(def).forEach((k) => {
        if (cur[k] === undefined) cur[k] = def[k];
      });
    }
  });

  data.payConfig = data.payConfig || {};
  data.payConfig.channels = data.payConfig.channels || {};
  Object.keys(payment.CHANNEL_DEFAULTS).forEach((code) => {
    data.payConfig.channels[code] = Object.assign(
      {},
      payment.CHANNEL_DEFAULTS[code],
      data.payConfig.channels[code] || {}
    );
  });

  data.settings = data.settings || {};
  data.settings.i18n = Object.assign(
    { enabled: true, defaultLang: 'en', autoByIp: true, ipApiUrl: 'http://ip-api.com/json/', timeoutMs: 1500, cacheHours: 6 },
    data.settings.i18n || {}
  );

  if (added) db.addLog('system.paymethods.sync', `已补齐 ${added} 个新增收款方式`, 'system');
  db.save();
}

/** 启动时把历史明文口令一次性升级为 scrypt 哈希，避免明文落盘 */
function migrateAdminPasswords() {
  const data = db.get();
  let n = 0;
  (data.admins || []).forEach((a) => {
    if (typeof a.password === 'string' && a.password && !a.passwordHash) {
      setAdminPassword(a, a.password);
      n++;
    }
  });
  if (n) {
    db.addLog('system.password.migrate', `已将 ${n} 个管理员口令升级为 scrypt 哈希存储`, 'system');
    db.save();
    console.log('[init] 管理员口令已升级为哈希存储：' + n + ' 个');
  }
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
    const i18nCfg = s.i18n || {};
    return ok(res, {
      settings: {
        siteName: s.siteName,
        siteNameEn: s.siteNameEn || '',
        siteSubtitle: s.siteSubtitle,
        siteSubtitleEn: s.siteSubtitleEn || '',
        slogan: s.slogan,
        sloganEn: s.sloganEn || '',
        notice: s.notice,
        noticeEn: s.noticeEn || '',
        service: s.service,
        orderExpireMinutes: s.orderExpireMinutes,
        sandboxMode: !!s.sandboxMode,
        defaultLang: i18nCfg.defaultLang === 'zh' ? 'zh' : 'en',
        i18nEnabled: i18nCfg.enabled !== false,
        autoLangByIp: i18nCfg.autoByIp !== false,
      },
      categories: data.categories.filter((c) => c.status !== 'disabled').sort((a, b) => a.sort - b.sort),
      payMethods: data.payMethods
        .filter((m) => m.enabled)
        .sort((a, b) => a.sort - b.sort)
        .map((m) => ({ code: m.code, name: m.name, nameEn: m.nameEn || '', icon: m.icon, kind: m.kind || '', fee: m.fee || 0 })),
      // 收款通道的公开信息（地址 / 汇率 / 币种），绝不含任何密钥
      payInfo: payment.publicPayInfo(),
      products,
    });
  }

  /** 语言识别：按访问者 IP 归属地 / Accept-Language 判定 */
  if (pathname === '/api/locale' && method === 'GET') {
    const r = await i18n.detectLang(req, query);
    return ok(res, r);
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
    const pay = await payment.createPayment(order);
    order.payTradeNo = pay.tradeNo;
    order.payKind = pay.kind || '';
    if (pay.currency) {
      order.payCurrency = pay.currency;
      order.payForeignAmount = pay.amount;
      order.payRate = pay.rate;
    }
    if (pay.usdt) {
      order.payCurrency = 'USDT';
      order.payForeignAmount = pay.usdt.amount;
      order.payRate = pay.usdt.rate;
      order.payNetwork = pay.usdt.network;
      order.payAddress = pay.usdt.address || '';
      // 网关模式下有效期以网关返回值为准，避免两边倒计时不一致
      if (pay.usdt.expireSec) order.expireAt = new Date(now + Number(pay.usdt.expireSec) * 1000).toISOString();
    }
    if (pay.gateway) {
      order.payGateway = pay.gateway;
      order.payGatewayTradeId = pay.gatewayTradeId || '';
    }
    if (pay.payUrl) order.payUrl = pay.payUrl;
    if (pay.error || pay.sandboxFallback) pushLog(order, '收款通道提示：' + pay.message, 'warn');
    data.orders.unshift(order);
    db.addLog('order.create', `新订单 ${order.no}｜${product.name} ${sku.name}｜${noAccount ? '免填账号（自动发货）' : '账号 ' + account}｜¥${order.amount}`, 'customer');
    db.save();
    return ok(res, { order: decorate(order), pay });
  }

  /** 确认支付：沙箱一键模拟；USDT / 加密货币可回填交易哈希 */
  if (pathname.match(/^\/api\/orders\/[^/]+\/pay$/) && method === 'POST') {
    const no = pathname.split('/')[3];
    const body = await readBody(req);
    const data = db.get();
    const order = data.orders.find((o) => o.no === no);
    if (!order) return fail(res, '订单不存在', 404);
    if (order.status !== 'pending_payment') return ok(res, { order: decorate(order), message: '订单状态无需重复支付' });

    const txid = String(body.txid || body.txId || '').trim();
    const sandbox = payment.isSandbox();
    const cryptoLike = order.payKind === 'crypto' || order.payCurrency === 'USDT';

    // 生产模式下加密货币收款必须回填交易哈希，便于人工/链上核验
    if (cryptoLike && !sandbox && !txid) {
      return fail(res, '请填写链上转账的交易哈希（TxID）后再提交，以便核验到账');
    }
    if (txid) {
      if (!/^[A-Za-z0-9x]{16,120}$/.test(txid)) return fail(res, '交易哈希格式不正确，请核对后重新粘贴');
      order.payTxId = txid;
      pushLog(order, `用户回填链上交易哈希：${txid}`, 'info');
    }

    order.status = 'paid';
    order.paidAt = new Date().toISOString();
    pushLog(
      order,
      `支付成功（${order.payMethodName}）¥${order.amount}` +
        (order.payForeignAmount ? ` ≈ ${order.payForeignAmount} ${order.payCurrency || ''}` : '') +
        (txid ? '｜TxID ' + txid : ''),
      'success'
    );
    db.addLog('order.paid', `订单 ${order.no} 支付成功 ¥${order.amount}${txid ? '（TxID ' + txid + '）' : ''}`, 'customer');
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

  /**
   * BEpusdt 数字货币网关异步回调
   * ------------------------------------------------------------------
   * 验签：与网关下单同一套规则 —— 非空参数按 key 字典序拼 k=v&k=v，末尾直接追加
   *       apiToken，MD5 取小写。验签不通过一律拒绝，避免伪造到账。
   * status：1=等待支付（每分钟推送）2=支付成功 3=支付超时
   * 幂等：重复回调只确认不重复派单；已进入终态的订单不回溯改状态。
   * 应答：默认纯文本 ok（官方两份文档分别写了 ok / success，可在通道配置 notifyAck 调整）。
   */
  if (pathname === '/api/callback/bepusdt' && method === 'POST') {
    const body = await readBody(req);
    const cfg = Object.assign({}, payment.CHANNEL_DEFAULTS.usdt, payment.getChannel('usdt') || {});
    const ack = (text) => res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text);

    if (!String(cfg.apiToken || '').trim()) {
      db.addLog('pay.callback.invalid', 'BEpusdt 回调被拒：通道未配置 apiToken', 'system');
      return ack('CONFIG_ERROR');
    }
    if (!payment.bepusdtVerify(body, cfg.apiToken)) {
      db.addLog('pay.callback.invalid', `BEpusdt 回调验签失败：${JSON.stringify(body).slice(0, 240)}`, 'system');
      return ack('SIGN_ERROR');
    }

    const orderNo = String(body.order_id || body.out_trade_no || '');
    const data = db.get();
    const order = data.orders.find((o) => o.no === orderNo);
    if (!order) return ack('ORDER_NOT_FOUND');

    const st = Number(body.status);
    const actual = body.actual_amount !== undefined && body.actual_amount !== '' ? Number(body.actual_amount) : 0;
    const txid = String(body.block_transaction_id || '').trim();
    const maybeAddr = String(body.token || '').trim();

    // 回写链上信息（地址形态才记为收款地址，避免把币种名写进去）
    order.payGateway = 'bepusdt';
    if (body.trade_id) order.payGatewayTradeId = String(body.trade_id);
    if (txid) order.payTxId = txid;
    if (actual) order.payForeignAmount = actual;
    if (/^[A-Za-z0-9]{20,}$/.test(maybeAddr)) order.payAddress = maybeAddr;

    /* ---- 支付成功 ---- */
    if (st === 2) {
      // 幂等：只要订单已越过「待支付」，本次就是重复或迟到的成功通知，一律不再重复处理
      if (order.status !== 'pending_payment') {
        const settled = ['paid', 'recharging', 'success'].includes(order.status);
        pushLog(
          order,
          settled
            ? `收到网关重复回调（status=2），订单已处于「${STATUS_TEXT[order.status]}」，跳过重复处理`
            : `收到到账回调，但订单已处于「${STATUS_TEXT[order.status]}」，未变更状态`,
          settled ? 'info' : 'warn'
        );
        db.save();
        return ack(cfg.notifyAck || 'ok');
      }
      order.status = 'paid';
      order.paidAt = order.paidAt || new Date().toISOString();
      pushLog(
        order,
        `数字货币网关确认到账${actual ? '：' + actual + ' ' + (order.payCurrency || 'USDT') : ''}${txid ? '｜TxID ' + txid : ''}`,
        'success'
      );
      db.save();
      db.addLog('order.paid', `订单 ${order.no} 数字货币到账${txid ? '（TxID ' + txid + '）' : ''}`, 'system');
      if (data.settings.autoRecharge !== false) {
        setTimeout(() => {
          const o = db.get().orders.find((x) => x.no === order.no);
          if (o && o.status === 'paid') dispatch(o).catch((e) => console.error(e));
        }, 300);
      }
      return ack(cfg.notifyAck || 'ok');
    }

    /* ---- 支付超时 ---- */
    if (st === 3) {
      if (order.status === 'pending_payment') {
        order.status = 'closed';
        order.closedAt = new Date().toISOString();
        pushLog(order, '数字货币网关通知：支付超时，订单已关闭', 'warn');
        db.addLog('order.close', `订单 ${order.no} 数字货币支付超时，自动关闭`, 'system');
        db.save();
      }
      return ack('ok');
    }

    /* ---- 等待支付（每分钟推送）：首次记录一条日志，其余仅确认 ---- */
    if (order.status === 'pending_payment' && !order.payGatewayNotifiedAt) {
      order.payGatewayNotifiedAt = new Date().toISOString();
      pushLog(order, '数字货币网关已接单，等待链上付款', 'info');
      db.save();
    }
    return ack('ok');
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

  /** 收银台跳转地址：跳转型收款方式（信用卡 / PayPal / 网关）按需获取 */
  if (pathname.match(/^\/api\/orders\/[^/]+\/paylink$/) && method === 'GET') {
    const no = pathname.split('/')[3];
    const data = db.get();
    const order = data.orders.find((o) => o.no === no);
    if (!order) return fail(res, '订单不存在', 404);
    if (order.status !== 'pending_payment') return ok(res, { payUrl: '', reason: 'not_pending' });
    const pay = await payment.createPayment(order);
    return ok(res, {
      payUrl: pay.payUrl || '',
      kind: pay.kind,
      sandbox: !!pay.sandbox,
      amount: pay.amount,
      currency: pay.currency,
      message: pay.message,
    });
  }

  if (pathname.match(/^\/api\/orders\/[^/]+$/) && method === 'GET') {
    const no = pathname.split('/')[3];
    const data = db.get();
    const order = data.orders.find((o) => o.no === no);
    if (!order) return fail(res, '订单不存在', 404);
    // 带上收款通道公开信息与沙箱开关，使独立收银台 pay.html 也能渲染 USDT / 信用卡 / PayPal
    return ok(res, { order: decorate(order), payInfo: payment.publicPayInfo(), sandbox: payment.isSandbox() });
  }

  /* ------------------------ 后台 ------------------------ */

  if (pathname === '/api/admin/login' && method === 'POST') {
    const body = await readBody(req);
    const data = db.get();
    const u = String(body.username || '').trim();
    const p = String(body.password == null ? '' : body.password);

    // 登录失败限流：同一账号 10 分钟内连续失败 5 次即锁定
    const key = u + '|' + i18n.clientIp(req);
    const rec = loginFails.get(key) || { n: 0, first: Date.now() };
    if (Date.now() - rec.first > 10 * 60 * 1000) {
      rec.n = 0;
      rec.first = Date.now();
    }
    if (rec.n >= 5) {
      db.addLog('admin.login.locked', `登录被锁定（连续失败 ${rec.n} 次）：${u}`, 'guest');
      const wait = Math.ceil((10 * 60 * 1000 - (Date.now() - rec.first)) / 60000);
      return fail(res, `登录失败次数过多，请 ${wait} 分钟后再试`, 429);
    }

    const admin = data.admins.find((a) => a.username === u);
    if (!admin || !verifyAdminPassword(admin, p)) {
      rec.n++;
      loginFails.set(key, rec);
      db.addLog('admin.login.fail', `登录失败：${u}（第 ${rec.n} 次）`, 'guest');
      return fail(res, '用户名或密码错误', 401);
    }

    // 历史明文口令 → 自动升级为哈希
    if (!admin.passwordHash && admin.password) {
      setAdminPassword(admin, p);
      db.addLog('admin.password.upgrade', `管理员 ${admin.username} 口令已升级为哈希存储`, 'system');
    }

    loginFails.delete(key);
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

  /**
   * 修改管理员密码（独立接口）
   * 修复点：
   *   1. 新密码为空时不再「静默成功」，一律返回明确错误
   *   2. 校验长度 / 空格 / 纯数字 / 与原密码相同
   *   3. 支持二次确认，避免打错后永久锁死
   *   4. 改密成功后注销该账号的其他会话
   *   5. 写入专用审计日志 admin.password.change
   *   6. 明文口令升级为 scrypt 加盐哈希
   */
  if (pathname === '/api/admin/password' && method === 'POST') {
    const body = await readBody(req);
    const data = db.get();
    const a = data.admins.find((x) => x.username === me.username);
    if (!a) return fail(res, '管理员账号不存在', 404);

    const oldPw = String(body.oldPassword == null ? '' : body.oldPassword);
    const newPw = String(body.newPassword == null ? '' : body.newPassword);
    const confirmPw = body.confirmPassword == null ? '' : String(body.confirmPassword);

    if (!oldPw) return fail(res, '请填写当前密码');
    if (!verifyAdminPassword(a, oldPw)) {
      db.addLog('admin.password.fail', `修改口令失败（当前密码不正确）：${a.username}`, a.username);
      return fail(res, '当前密码不正确', 400);
    }
    const bad = validateNewPassword(newPw, oldPw);
    if (bad) return fail(res, bad, 400);
    if (confirmPw && confirmPw !== newPw) return fail(res, '两次输入的新密码不一致，请重新核对', 400);

    setAdminPassword(a, newPw);
    const rawToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const revoked = revokeOtherTokens(rawToken, a.username);
    db.addLog(
      'admin.password.change',
      `管理员 ${a.username} 修改登录口令成功（口令已哈希存储；已注销其他 ${revoked} 个会话）`,
      a.username
    );
    db.save();
    return ok(res, {
      message: `密码已更新${revoked ? `，已注销其他 ${revoked} 个登录会话` : ''}`,
      revoked,
      passwordUpdatedAt: a.passwordUpdatedAt,
      hashed: true,
    });
  }

  /** 口令策略查询（前端提示用） */
  if (pathname === '/api/admin/password/policy' && method === 'GET') {
    return ok(res, { min: PW_MIN, max: PW_MAX, rules: ['不少于 8 位', '不含空格', '不能是纯数字', '须与当前密码不同'] });
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
    return ok(res, {
      settings: data.settings,
      payMethods: data.payMethods,
      payConfig: data.payConfig,
      // 各收款通道的默认参数模板，供后台表单渲染
      channelDefaults: payment.CHANNEL_DEFAULTS,
      methodDefs: payment.METHOD_DEFS,
      i18nInfo: { settings: i18n.settings(), cache: i18n.cacheStats() },
      admins: data.admins.map((a) => ({
        username: a.username,
        name: a.name,
        role: a.role,
        lastLogin: a.lastLogin,
        // 只回传布尔值，绝不回传口令或其哈希
        hashed: !!(a.passwordHash && a.passwordSalt),
        passwordUpdatedAt: a.passwordUpdatedAt || '',
      })),
    });
  }

  if (pathname === '/api/admin/settings' && method === 'POST') {
    const body = await readBody(req);
    const data = db.get();

    // 口令不再走这里：避免「传了参数却静默不生效」，明确引导到专用接口
    if (body.admin && (body.admin.newPassword || body.admin.password)) {
      return fail(res, '修改密码请使用「修改管理员密码」入口（POST /api/admin/password），此处不再处理口令变更', 400);
    }

    if (body.settings) {
      const inc = body.settings;
      const deep = ['service', 'i18n'];
      const shallow = Object.assign({}, inc);
      deep.forEach((k) => delete shallow[k]);
      Object.assign(data.settings, shallow);
      deep.forEach((k) => {
        if (inc[k] && typeof inc[k] === 'object') data.settings[k] = Object.assign({}, data.settings[k] || {}, inc[k]);
      });
    }

    if (Array.isArray(body.payMethods)) {
      data.payMethods = body.payMethods.map((m) => {
        const def = payment.METHOD_DEFS.find((d) => d.code === m.code) || {};
        return Object.assign({}, def, m);
      });
    }

    if (body.payConfig) {
      const inc = Object.assign({}, body.payConfig);
      const channels = inc.channels;
      delete inc.channels;
      Object.assign(data.payConfig, inc);
      if (channels && typeof channels === 'object') {
        data.payConfig.channels = data.payConfig.channels || {};
        Object.keys(channels).forEach((code) => {
          data.payConfig.channels[code] = Object.assign(
            {},
            payment.CHANNEL_DEFAULTS[code] || {},
            data.payConfig.channels[code] || {},
            channels[code] || {}
          );
        });
      }
    }

    // 多语言配置变更后清空 IP 归属地缓存，立即生效
    i18n.clearCache();
    db.addLog('settings.save', '更新系统设置', me.username);
    db.save();
    return ok(res, {
      settings: data.settings,
      payMethods: data.payMethods,
      payConfig: data.payConfig,
      channelDefaults: payment.CHANNEL_DEFAULTS,
    });
  }

  /** 语言识别自测：给定 IP 看会判定成哪种语言（便于运营核对） */
  if (pathname === '/api/admin/i18n/test' && method === 'GET') {
    const ip = String(query.get('ip') || '').trim() || i18n.clientIp(req);
    const fake = { headers: { 'x-forwarded-for': ip }, socket: {} };
    const r = await i18n.detectLang(fake, new URLSearchParams());
    return ok(res, { ip: r.ip || ip, lang: r.lang, country: r.country, source: r.source, cache: i18n.cacheStats() });
  }

  /**
   * BEpusdt 网关连通性自测
   * 真实创建一笔 0.01 法币的最小订单并立即取消，用于验证「网关地址 + 对接令牌 + 签名」是否被接受，
   * 同时可核对签名原串，便于与网关侧排查不一致。
   */
  if (pathname === '/api/admin/pay/bepusdt/test' && method === 'POST') {
    const body = await readBody(req);
    const saved = Object.assign({}, payment.CHANNEL_DEFAULTS.usdt, payment.getChannel('usdt') || {});
    const cfg = Object.assign({}, saved, body.channel || {});
    const r = await payment.testBepusdt(cfg);
    db.addLog('pay.bepusdt.test', `BEpusdt 网关自测：${r.message}`, me.username);
    return ok(res, { result: r });
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
syncPayMethods();
migrateAdminPasswords();
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
