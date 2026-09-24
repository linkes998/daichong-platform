/**
 * 支付网关适配层
 * ------------------------------------------------------------------
 * 支持 5 类收款方式，按 code 分派到不同适配器：
 *
 *   alipay / wechat / qqpay / ...   → 易支付（彩虹聚合）类网关，扫码或跳转
 *   usdt                            → 加密货币收款：地址 + 网络 + 汇率换算 + 交易哈希回填
 *   creditcard                      → 国际信用卡（Stripe Checkout 托管收银台 / 通用托管页）
 *   paypal                          → PayPal 标准收款（PayPal Standard + IPN 回调）
 *
 * 沙箱模式（payConfig.sandboxMode !== false）下不会发起真实下单请求，
 * 一律返回本地模拟收银台，便于演示与联调。
 *
 * 通道参数统一放在 payConfig.channels[code]，由后台「支付配置」维护。
 * 注意：密钥类字段（secretKey / clientSecret / merchantKey）只存在于服务端，
 *       绝不可通过 /api/store 下发给前端（见 server.js 的 publicPayInfo）。
 */
const crypto = require('crypto');
const db = require('./db');

/* ------------------------------------------------------------------ */
/* 配置读取                                                            */
/* ------------------------------------------------------------------ */

function payConfig() {
  return db.get().payConfig || {};
}

function isSandbox() {
  const cfg = payConfig();
  return cfg.sandboxMode !== false;
}

/** 取某通道的配置（与 payMethods 中的展示字段合并） */
function getChannel(code) {
  const cfg = payConfig();
  const channels = cfg.channels || {};
  const method = (db.get().payMethods || []).find((m) => m.code === code) || {};
  return Object.assign({}, method, channels[code] || {});
}

/** 各通道的默认参数，供后台表单与运行时兜底 */
const CHANNEL_DEFAULTS = {
  usdt: {
    /**
     * 收款模式：
     *   manual  —— 展示一个固定收款地址，买家自行转账并回填 TxID，人工核验（默认，零依赖）
     *   bepusdt —— 对接 BEpusdt 自建网关：逐单分配收款地址、链上自动确认、回调自动完成订单
     */
    provider: 'manual',
    network: 'TRC20',
    address: '',
    rate: 7.2, // 1 USDT = ? CNY
    rateApiUrl: '',
    autoRate: false,
    minAmount: 10, // 最小收款金额（USDT）
    confirmations: 1,
    uniqueAmount: true, // 金额加尾数便于对账
    payWindowMinutes: 30,
    tips: '请务必使用所选网络转账，跨链转账将导致资金丢失。',
    qrTemplate: '',
    /* ---- 以下仅在 provider = bepusdt 时使用 ---- */
    gatewayUrl: 'http://127.0.0.1:8080', // BEpusdt 站点地址
    apiToken: '', // 后台「系统管理 → 基本设置 → API 设置 → 对接令牌」
    tradeType: 'usdt.trc20', // usdt.trc20 / usdt.erc20 / usdt.bep20 / usdt.polygon ...
    fiat: 'CNY', // CNY / USD / EUR / GBP / JPY
    useCashier: false, // false=create-transaction（锁定链与金额）；true=create-order（网关收银台自选币种/网络）
    currencies: '', // useCashier 时限定币种，如 "USDT" 或 "-ETH,-BNB"；留空不限制
    notifyUrl: '', // 留空则自动使用 {站点}/api/callback/bepusdt
    redirectUrl: '', // 留空则自动使用 {站点}/pay.html?no={订单号}
    timeoutSec: 600, // 网关侧订单超时（秒，最小 120）
    notifyAck: 'ok', // 回调成功应答文本（官方文档存在 ok / success 两种说法，可在此调整）
  },
  creditcard: {
    provider: 'stripe', // stripe | generic
    publishableKey: '',
    secretKey: '',
    webhookSecret: '',
    currency: 'USD',
    rate: 7.2, // 1 USD = ? CNY
    apiUrl: 'https://api.stripe.com/v1/checkout/sessions',
    genericPayUrl: '',
    genericSignKey: '',
    statement: 'YUNCHONG',
  },
  paypal: {
    merchantEmail: '',
    clientId: '',
    clientSecret: '',
    mode: 'sandbox', // sandbox | live
    currency: 'USD',
    rate: 7.2,
    ipnUrl: '',
    brandName: 'YunChong',
  },
};

function withDefaults(code) {
  const c = getChannel(code);
  if (!CHANNEL_DEFAULTS[code]) return c;
  return Object.assign({}, CHANNEL_DEFAULTS[code], c);
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** 汇率兜底：非法或为 0 时退回默认值 */
function safeRate(v, fallback) {
  const n = Number(v);
  return n > 0 ? n : fallback;
}

function tradeNo() {
  return 'PAY' + crypto.randomBytes(6).toString('hex').toUpperCase();
}

/**
 * 为金额生成唯一尾数（USDT / 加密货币收款对账常用）
 * 同一订单稳定，不同订单不同，避免两个订单金额完全相同导致无法匹配。
 */
function uniqueAmount(base, orderNo) {
  const h = crypto.createHash('md5').update(String(orderNo)).digest();
  const tail = 1 + (h.readUInt16BE(0) % 98); // 0.01 ~ 0.98
  return Math.round((Math.floor(base) + tail / 100) * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* 各通道适配器                                                        */
/* ------------------------------------------------------------------ */

/** ① 易支付 / 彩虹聚合类：拼接签名后的收银台地址 */
function buildEpay(order) {
  const cfg = payConfig();
  const params = {
    pid: cfg.merchantId,
    type: order.payMethod,
    out_trade_no: order.no,
    notify_url: cfg.notifyUrl,
    return_url: cfg.notifyUrl,
    name: order.productName + ' ' + order.skuName,
    money: Number(order.amount).toFixed(2),
  };
  const keys = Object.keys(params).sort();
  const raw = keys.map((k) => `${k}=${params[k]}`).join('&') + (cfg.merchantKey || '');
  params.sign = crypto.createHash('md5').update(raw, 'utf8').digest('hex');
  params.sign_type = 'MD5';
  const url = (cfg.apiUrl || '') + '?' + new URLSearchParams(params).toString();
  return {
    kind: 'redirect',
    payUrl: url,
    qrContent: url,
    message: '已生成第三方收银台直达地址',
  };
}

/** ② USDT：返回收款地址 / 网络 / 换算金额 / 唯一金额尾数 */
function buildUsdt(order) {
  const c = withDefaults('usdt');
  const rate = safeRate(c.rate, 7.2);
  let usdt = order.amount / rate;
  if (c.uniqueAmount !== false) usdt = uniqueAmount(usdt, order.no);
  usdt = Math.round(usdt * 100) / 100;
  const tooSmall = usdt < Number(c.minAmount || 0);
  const address = String(c.address || '').trim();
  const token = c.network === 'TRC20' ? 'USDT-TRC20' : 'USDT-' + c.network;
  return {
    kind: 'crypto',
    payUrl: '',
    qrContent: address ? address : '',
    usdt: {
      network: c.network || 'TRC20',
      address,
      rate,
      amount: usdt,
      minAmount: Number(c.minAmount || 0),
      confirmations: Number(c.confirmations || 1),
      tips: c.tips || '',
      token,
      configured: !!address,
      tooSmall,
      memo: order.no,
    },
    message: address
      ? `请向下方 ${token} 地址转账 ${usdt} USDT，并在转账备注中填写订单号 ${order.no}`
      : 'USDT 收款地址尚未配置，请联系客服或管理员在后台补充',
  };
}

/* ------------------------------------------------------------------ */
/* ②b BEpusdt 网关（自建数字货币收款：逐单地址 + 链上自动确认）          */
/* ------------------------------------------------------------------ */

/** 从站点支付回调地址推导站点根地址，用于拼接回调 / 跳转地址 */
function siteOrigin() {
  const n = String(payConfig().notifyUrl || '');
  const m = n.match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1] : '';
}

/**
 * 金额规范化：网关侧会把 JSON number 解析为数值后再拼签名串，
 * 因此统一使用「最短数值字符串」参与签名与传输，避免 20 与 "20.00" 不一致导致验签失败。
 */
function canonAmount(v) {
  const n = Number(v);
  return isFinite(n) ? String(n) : '0';
}

/**
 * BEpusdt 签名（网关文档规则）：
 *   1. 取所有非空、且非 signature 的参数，按参数名 ASCII 字典序升序
 *   2. 拼成 k=v&k=v...
 *   3. 末尾「直接追加」API Token（注意：没有 & 分隔符）
 *   4. MD5 后取小写
 * ⚠️ 与 lib/supplier.js 的上游签名规则不同（那边是 &key=secret + 大写 MD5），不要混用。
 */
function bepusdtSign(params, token) {
  const keys = Object.keys(params)
    .filter((k) => k !== 'signature' && params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort();
  const raw = keys.map((k) => `${k}=${params[k]}`).join('&') + (token || '');
  return crypto.createHash('md5').update(raw, 'utf8').digest('hex');
}

/** 校验 BEpusdt 回调签名（恒定时间比较，防时序侧信道） */
function bepusdtVerify(params, token) {
  const given = String((params && params.signature) || '').trim().toLowerCase();
  if (!given) return false;
  const a = Buffer.from(bepusdtSign(params || {}, token));
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** 网关配置是否完整 */
function bepusdtReady(c) {
  return !!(String(c.gatewayUrl || '').trim() && String(c.apiToken || '').trim());
}

/** 推导回调与跳转地址（未显式配置时按站点地址自动生成） */
function bepusdtUrls(order, c) {
  const origin = siteOrigin();
  return {
    notify: String(c.notifyUrl || '').trim() || (origin ? origin + '/api/callback/bepusdt' : ''),
    redirect: String(c.redirectUrl || '').trim() || (origin ? origin + '/pay.html?no=' + encodeURIComponent(order.no) : ''),
  };
}

/** 组装创建交易的请求参数（签名前的原始参数） */
function bepusdtParams(order, c, notify, redirect) {
  const cashier = !!c.useCashier;
  const params = {
    order_id: order.no,
    notify_url: notify,
    redirect_url: redirect,
    amount: Number(canonAmount(order.amount)),
    fiat: (c.fiat || 'CNY').toUpperCase(),
    name: `${order.productName} ${order.skuName}`.slice(0, 60),
    timeout: Math.max(120, Number(c.timeoutSec) || 600),
  };
  if (cashier) {
    if (String(c.currencies || '').trim()) params.currencies = String(c.currencies).trim();
  } else {
    params.trade_type = String(c.tradeType || 'usdt.trc20').trim();
  }
  params.signature = bepusdtSign(params, c.apiToken);
  return { params, cashier };
}

/** 调用 BEpusdt 创建交易，返回逐单收款地址与收银台链接 */
async function createBepusdtTransaction(order, c) {
  const base = String(c.gatewayUrl || '').trim().replace(/\/+$/, '');
  if (!base) return { ok: false, error: 'BEpusdt 网关地址未配置' };
  if (!String(c.apiToken || '').trim()) return { ok: false, error: 'BEpusdt 对接令牌（API Token）未配置' };
  const { notify, redirect } = bepusdtUrls(order, c);
  if (!notify) return { ok: false, error: '无法推导回调地址，请在通道配置中显式填写 notifyUrl' };
  if (!redirect) return { ok: false, error: '无法推导跳转地址，请在通道配置中显式填写 redirectUrl' };

  const { params, cashier } = bepusdtParams(order, c, notify, redirect);
  const url = base + (cashier ? '/api/v1/order/create-order' : '/api/v1/order/create-transaction');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout ? AbortSignal.timeout(Number(c.timeoutMs) || 15000) : undefined,
    });
    const text = await res.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) { /* 保留原文以便排查 */ }
    if (!j) return { ok: false, error: `网关返回非 JSON（HTTP ${res.status}）：${String(text).slice(0, 160)}`, request: params };
    if (Number(j.status_code) !== 200) {
      return { ok: false, error: `网关返回失败[${j.status_code}]：${j.message || '未知原因'}`, request: params, response: j };
    }
    const d = j.data || {};
    return {
      ok: true,
      cashier,
      tradeId: d.trade_id || '',
      address: d.token || '',
      actualAmount: d.actual_amount !== undefined ? Number(d.actual_amount) : 0,
      fiatAmount: d.amount !== undefined ? Number(d.amount) : Number(order.amount),
      fiat: d.fiat || params.fiat,
      paymentUrl: d.payment_url || '',
      expireSec: Number(d.expiration_time) || params.timeout,
      request: params,
      response: j,
    };
  } catch (e) {
    return { ok: false, error: '请求网关失败：' + (e.message || String(e)), request: params };
  }
}

/** 取消网关订单（用于连通性自测收尾、或本地订单关闭时同步释放） */
async function cancelBepusdtTransaction(tradeId, c) {
  const base = String(c.gatewayUrl || '').trim().replace(/\/+$/, '');
  if (!base || !tradeId) return { ok: false, error: '参数不足' };
  const params = { trade_id: tradeId, signature: bepusdtSign({ trade_id: tradeId }, c.apiToken) };
  try {
    const res = await fetch(base + '/api/v1/order/cancel-transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout ? AbortSignal.timeout(Number(c.timeoutMs) || 15000) : undefined,
    });
    const text = await res.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) {}
    return { ok: !!(j && Number(j.status_code) === 200), response: j, raw: text.slice(0, 200) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * 后台「测试网关连通性」：真实创建一个 0.01 法币的最小订单并立即取消。
 * 这样可以在不产生实际收款的前提下，验证 网关地址 / 令牌 / 签名 / 回调地址 是否被网关接受。
 */
async function testBepusdt(cfg) {
  const c = Object.assign({}, CHANNEL_DEFAULTS.usdt, cfg || {});
  const base = String(c.gatewayUrl || '').trim().replace(/\/+$/, '');
  if (!base) return { ok: false, stage: 'config', message: '网关地址（gatewayUrl）未配置' };
  if (!String(c.apiToken || '').trim()) return { ok: false, stage: 'config', message: '对接令牌（apiToken）未配置' };

  const fake = { no: 'SELFTEST' + Date.now() };
  const { notify, redirect } = bepusdtUrls(fake, c);
  const params = {
    order_id: fake.no,
    notify_url: notify || 'https://example.com/api/callback/bepusdt',
    redirect_url: redirect || 'https://example.com/pay.html',
    amount: 1,
    fiat: (c.fiat || 'CNY').toUpperCase(),
    trade_type: String(c.tradeType || 'usdt.trc20').trim(),
    name: 'YunChong connectivity self-test',
    timeout: 120,
  };
  params.signature = bepusdtSign(params, c.apiToken);

  const t0 = Date.now();
  let created = null;
  try {
    const res = await fetch(base + '/api/v1/order/create-transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout ? AbortSignal.timeout(Number(c.timeoutMs) || 15000) : undefined,
    });
    const text = await res.text();
    try { created = JSON.parse(text); } catch (e) { created = null; }
    if (!created) {
      return { ok: false, stage: 'http', latency: Date.now() - t0, request: params, signString: bepusdtSignRaw(params, c.apiToken), message: `网关返回非 JSON（HTTP ${res.status}）：${String(text).slice(0, 200)}` };
    }
  } catch (e) {
    return { ok: false, stage: 'connect', latency: Date.now() - t0, request: params, signString: bepusdtSignRaw(params, c.apiToken), message: '连接失败：' + (e.message || String(e)) };
  }

  const latency = Date.now() - t0;
  const signString = bepusdtSignRaw(params, c.apiToken);
  if (Number(created.status_code) !== 200) {
    return { ok: false, stage: 'sign-or-param', latency, request: params, signString, response: created, message: `网关拒绝（${created.status_code}）：${created.message || '请核对令牌与签名'}` };
  }

  // 自测成功 → 立即取消，避免在网关上留下待支付订单
  const tradeId = (created.data && created.data.trade_id) || '';
  const canceled = tradeId ? await cancelBepusdtTransaction(tradeId, c) : { ok: false, error: '网关未返回 trade_id' };
  const d = created.data || {};
  return {
    ok: true,
    stage: 'done',
    latency,
    gateway: base,
    tradeId,
    address: d.token || '',
    actualAmount: d.actual_amount,
    paymentUrl: d.payment_url || '',
    expireSec: d.expiration_time,
    canceled: canceled.ok,
    cancelMessage: canceled.ok ? '自测订单已取消' : '自测订单取消失败（' + (canceled.error || JSON.stringify(canceled.response || {}).slice(0, 120)) + '）',
    request: params,
    signString,
    response: created,
    message: `网关连通正常：签名校验通过，逐单收款地址 ${d.token || '-'}，应付 ${d.actual_amount || '-'}（自测金额 1 ${params.fiat}，已取消）`,
  };
}

/** 输出签名原串（给人核对用） */
function bepusdtSignRaw(params, token) {
  const keys = Object.keys(params)
    .filter((k) => k !== 'signature' && params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort();
  return keys.map((k) => `${k}=${params[k]}`).join('&') + (token || '');
}

/** ③ 国际信用卡：Stripe Checkout 托管收银台（无密钥时降级为本地沙箱） */
async function buildCreditCard(order) {
  const c = withDefaults('creditcard');
  const rate = safeRate(c.rate, 7.2);
  const amount = Math.round(((order.amount / rate) * 100)) / 100;
  const base = { kind: 'redirect', amount, currency: (c.currency || 'USD').toUpperCase(), rate };

  // 未配置密钥 → 沙箱/占位收银台
  if (!c.secretKey) {
    return Object.assign(base, {
      sandboxFallback: true,
      payUrl: '',
      qrContent: '',
      message: c.provider === 'stripe'
        ? '国际信用卡通道尚未配置 Stripe 密钥，订单已创建，请联系客服完成收款'
        : '国际信用卡通道尚未配置，请联系客服完成收款',
    });
  }

  if (c.provider !== 'stripe') {
    // 通用托管页：{amount} / {orderNo} / {currency} 占位替换
    const tpl = String(c.genericPayUrl || '');
    const url = tpl
      .replace(/\{amount\}/g, amount.toFixed(2))
      .replace(/\{orderNo\}/g, encodeURIComponent(order.no))
      .replace(/\{currency\}/g, (c.currency || 'USD').toUpperCase());
    return Object.assign(base, {
      payUrl: url,
      qrContent: url,
      message: url ? '已生成信用卡托管收银台地址' : '通用信用卡收银台地址未配置',
    });
  }

  // Stripe Checkout Session（服务端创建，返回托管收银台 URL）
  try {
    const notify = c.returnUrl || payConfig().notifyUrl || '';
    const host = notify ? notify.replace(/\/api\/callback\/pay.*$/, '') : '';
    const body = new URLSearchParams();
    body.set('mode', 'payment');
    body.set('client_reference_id', order.no);
    body.set('metadata[orderNo]', order.no);
    body.set('line_items[0][quantity]', String(order.quantity || 1));
    body.set('line_items[0][price_data][currency]', (c.currency || 'USD').toLowerCase());
    body.set('line_items[0][price_data][unit_amount]', String(Math.round(amount * 100)));
    body.set('line_items[0][price_data][product_data][name]', `${order.productName} ${order.skuName}`);
    if (c.statement) body.set('payment_intent_data[statement_descriptor]', String(c.statement).slice(0, 22));
    if (host) {
      body.set('success_url', `${host}/pay.html?no=${encodeURIComponent(order.no)}&paid=1`);
      body.set('cancel_url', `${host}/pay.html?no=${encodeURIComponent(order.no)}`);
    }
    const res = await fetch(c.apiUrl || CHANNEL_DEFAULTS.creditcard.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + c.secretKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
    });
    const j = await res.json();
    if (j && j.url) {
      return Object.assign(base, { payUrl: j.url, qrContent: j.url, sessionId: j.id || '', message: '已跳转 Stripe 托管收银台' });
    }
    const msg = (j && j.error && j.error.message) || 'Stripe 未返回收银台地址';
    return Object.assign(base, { payUrl: '', qrContent: '', error: msg, message: 'Stripe 下单失败：' + msg });
  } catch (e) {
    const msg = e.message || String(e);
    return Object.assign(base, { payUrl: '', qrContent: '', error: msg, message: 'Stripe 请求异常：' + msg });
  }
}

/** ④ PayPal 标准收款（无需服务端 API，走 IPN 回调） */
function buildPaypal(order) {
  const c = withDefaults('paypal');
  const rate = safeRate(c.rate, 7.2);
  const amount = Math.round(((order.amount / rate) * 100)) / 100;
  const base = { kind: 'redirect', amount, currency: (c.currency || 'USD').toUpperCase(), rate };
  const email = String(c.merchantEmail || '').trim();
  if (!email) {
    return Object.assign(base, {
      payUrl: '',
      qrContent: '',
      sandboxFallback: true,
      message: 'PayPal 收款账号尚未配置，请联系客服完成收款',
    });
  }
  const host = c.mode === 'live' ? 'https://www.paypal.com' : 'https://www.sandbox.paypal.com';
  const notify = c.ipnUrl || payConfig().notifyUrl || '';
  const params = new URLSearchParams({
    cmd: '_xclick',
    business: email,
    item_name: `${order.productName} ${order.skuName}`,
    item_number: order.no,
    amount: amount.toFixed(2),
    currency_code: (c.currency || 'USD').toUpperCase(),
    custom: order.no,
    no_shipping: '1',
    no_note: '0',
    notify_url: notify,
  });
  const url = `${host}/cgi-bin/webscr?${params.toString()}`;
  return Object.assign(base, {
    payUrl: url,
    qrContent: url,
    mode: c.mode || 'sandbox',
    message: '已跳转 PayPal 收银台',
  });
}

/* ------------------------------------------------------------------ */
/* 对外入口                                                            */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 支付方式清单（新增通道时同步维护）                                   */
/* ------------------------------------------------------------------ */

/** 全部支持的支付方式定义，用于初始化与「缺失即补齐」 */
const METHOD_DEFS = [
  { code: 'alipay', name: '支付宝', nameEn: 'Alipay', icon: '🅰️', enabled: true, sort: 1, fee: 0, kind: 'qr' },
  { code: 'wechat', name: '微信支付', nameEn: 'WeChat Pay', icon: '💚', enabled: true, sort: 2, fee: 0, kind: 'qr' },
  { code: 'qqpay', name: 'QQ钱包', nameEn: 'QQ Wallet', icon: '🐧', enabled: true, sort: 3, fee: 0, kind: 'qr' },
  { code: 'usdt', name: 'USDT（加密货币）', nameEn: 'USDT (Crypto)', icon: '🪙', enabled: true, sort: 4, fee: 0, kind: 'crypto' },
  { code: 'creditcard', name: '国际信用卡', nameEn: 'Credit / Debit Card', icon: '💳', enabled: true, sort: 5, fee: 0, kind: 'redirect' },
  { code: 'paypal', name: 'PayPal', nameEn: 'PayPal', icon: '🅿️', enabled: true, sort: 6, fee: 0, kind: 'redirect' },
  { code: 'card', name: '卡密支付', nameEn: 'Redeem Code', icon: '🎫', enabled: false, sort: 7, fee: 0, kind: 'none' },
];

/**
 * 创建支付：返回收银台信息
 * @param {object} order 订单对象
 * @returns {Promise<object>} { sandbox, method, tradeNo, kind, payUrl, qrContent, usdt?, amount?, currency?, message }
 */
async function createPayment(order) {
  const code = order.payMethod || 'alipay';
  const sandbox = isSandbox();
  const no = tradeNo();

  // 沙箱：仅 USDT 仍需给出真实收款地址（便于演示加密货币流程），其余走本地模拟
  if (sandbox) {
    if (code === 'usdt') {
      const c = withDefaults('usdt');
      const isGw = c.provider === 'bepusdt';
      const r = buildUsdt(order);
      return Object.assign({ sandbox: true, method: code, tradeNo: no, gateway: isGw ? 'bepusdt' : '' }, r, {
        message: isGw
          ? bepusdtReady(c)
            ? '[沙箱] 已配置 BEpusdt 网关：关闭全站沙箱后，将逐单分配收款地址并由链上确认自动完成订单（当前为本地模拟）'
            : '[沙箱] 收款模式为 BEpusdt，但网关地址 / 对接令牌尚未配置完整'
          : r.usdt.configured
            ? r.message
            : '[沙箱] ' + r.message + '（可点击下方按钮模拟支付成功）',
      });
    }
    const extra = {};
    if (code === 'creditcard' || code === 'paypal') {
      const c = withDefaults(code);
      const rate = safeRate(c.rate, 7.2);
      extra.amount = Math.round((order.amount / rate) * 100) / 100;
      extra.currency = (c.currency || 'USD').toUpperCase();
      extra.rate = rate;
      if (code === 'paypal' && c.merchantEmail) extra.paypalMode = c.mode || 'sandbox';
    }
    return Object.assign(
      {
        sandbox: true,
        method: code,
        tradeNo: no,
        kind: 'redirect',
        payUrl: '/pay.html?no=' + order.no,
        qrContent: 'sandbox://pay?order=' + order.no + '&amount=' + order.amount + '&trade=' + no,
        message: '沙箱收银台：点击「模拟支付成功」即可触发自动充值',
      },
      extra
    );
  }

  // 生产模式
  if (code === 'usdt') {
    const c = withDefaults('usdt');
    const rate = safeRate(c.rate, 7.2);

    // 模式二：BEpusdt 网关 —— 逐单收款地址 + 链上确认 + 异步回调自动完成
    if (c.provider === 'bepusdt') {
      const g = await createBepusdtTransaction(order, c);
      if (!g.ok) {
        return {
          sandbox: false,
          method: code,
          tradeNo: no,
          kind: 'crypto',
          gateway: 'bepusdt',
          payUrl: '',
          qrContent: '',
          error: g.error,
          usdt: {
            network: c.network,
            address: '',
            rate,
            amount: Math.round((order.amount / rate) * 100) / 100,
            configured: false,
            memo: order.no,
          },
          message: '数字货币网关下单失败：' + g.error,
        };
      }
      return {
        sandbox: false,
        method: code,
        tradeNo: no,
        kind: 'crypto',
        gateway: 'bepusdt',
        gatewayTradeId: g.tradeId,
        cashier: g.cashier,
        payUrl: g.paymentUrl,
        qrContent: g.paymentUrl || g.address,
        usdt: {
          network: c.network,
          address: g.address,
          rate,
          amount: g.actualAmount,
          minAmount: Number(c.minAmount || 0),
          confirmations: Number(c.confirmations || 1),
          tips: c.tips || '',
          token: 'USDT-' + c.network,
          configured: !!g.address,
          tooSmall: false,
          memo: order.no,
          fiat: g.fiat,
          fiatAmount: g.fiatAmount,
          expireSec: g.expireSec,
        },
        message: g.address
          ? `网关已锁定收款地址，请转账 ${g.actualAmount} USDT（${c.network}），链上确认后自动到账`
          : '网关已创建订单，请前往收银台完成支付',
      };
    }

    // 模式一（默认）：固定地址 + 买家回填 TxID
    return Object.assign({ sandbox: false, method: code, tradeNo: no }, buildUsdt(order));
  }
  if (code === 'creditcard') {
    return Object.assign({ sandbox: false, method: code, tradeNo: no }, await buildCreditCard(order));
  }
  if (code === 'paypal') {
    return Object.assign({ sandbox: false, method: code, tradeNo: no }, buildPaypal(order));
  }
  if (code === 'card') {
    return { sandbox: false, method: code, tradeNo: no, kind: 'none', payUrl: '', qrContent: '', message: '卡密支付需人工核销，请按页面提示提交卡密' };
  }
  return Object.assign({ sandbox: false, method: code, tradeNo: no }, buildEpay(order));
}

/** 对外暴露给前端的公开收款信息（不含任何密钥） */
function publicPayInfo() {
  const data = db.get();
  const enabled = (code) => {
    const m = (data.payMethods || []).find((x) => x.code === code);
    return !!(m && m.enabled);
  };
  const out = {};
  if (enabled('usdt')) {
    const c = withDefaults('usdt');
    const isGw = c.provider === 'bepusdt';
    out.usdt = {
      provider: c.provider || 'manual',
      network: c.network,
      address: c.address || '',
      rate: safeRate(c.rate, 7.2),
      minAmount: Number(c.minAmount || 0),
      confirmations: Number(c.confirmations || 1),
      tips: c.tips || '',
      // 可选：自建二维码服务模板，支持 {address} / {amount} 占位
      qrTemplate: c.qrTemplate || '',
      // 网关模式下收款地址由网关逐单分配，因此以「网关配置是否完整」判定可用性
      configured: isGw ? bepusdtReady(c) : !!String(c.address || '').trim(),
      // 只暴露公开信息，绝不下发 apiToken
      gateway: isGw ? { name: 'BEpusdt', useCashier: !!c.useCashier, tradeType: c.tradeType } : null,
    };
  }
  if (enabled('paypal')) {
    const c = withDefaults('paypal');
    out.paypal = {
      merchantEmail: c.merchantEmail || '',
      currency: (c.currency || 'USD').toUpperCase(),
      rate: safeRate(c.rate, 7.2),
      mode: c.mode || 'sandbox',
      configured: !!String(c.merchantEmail || '').trim(),
    };
  }
  if (enabled('creditcard')) {
    const c = withDefaults('creditcard');
    out.creditcard = {
      provider: c.provider || 'stripe',
      publishableKey: c.publishableKey || '',
      currency: (c.currency || 'USD').toUpperCase(),
      rate: safeRate(c.rate, 7.2),
      configured: c.provider === 'stripe' ? !!c.secretKey : !!c.genericPayUrl,
    };
  }
  return out;
}

module.exports = {
  createPayment,
  isSandbox,
  publicPayInfo,
  getChannel,
  CHANNEL_DEFAULTS,
  METHOD_DEFS,
  safeRate,
  /* BEpusdt 网关（供服务端回调验签、后台连通性自测使用） */
  bepusdtSign,
  bepusdtVerify,
  bepusdtReady,
  bepusdtSignRaw,
  testBepusdt,
  cancelBepusdtTransaction,
};
