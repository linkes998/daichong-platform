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
      const r = buildUsdt(order);
      return Object.assign({ sandbox: true, method: code, tradeNo: no }, r, {
        message: r.usdt.configured
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
    out.usdt = {
      network: c.network,
      address: c.address || '',
      rate: safeRate(c.rate, 7.2),
      minAmount: Number(c.minAmount || 0),
      confirmations: Number(c.confirmations || 1),
      tips: c.tips || '',
      // 可选：自建二维码服务模板，支持 {address} / {amount} 占位
      qrTemplate: c.qrTemplate || '',
      configured: !!String(c.address || '').trim(),
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

module.exports = { createPayment, isSandbox, publicPayInfo, getChannel, CHANNEL_DEFAULTS, METHOD_DEFS, safeRate };
