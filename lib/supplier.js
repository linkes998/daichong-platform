/**
 * 商品来源（供应商 API）对接层
 *
 * 统一对接协议（接入方按此实现两个接口即可）：
 *   POST {apiUrl}{orderPath}
 *     appId, outTradeNo, skuCode, account, quantity, notifyUrl, timestamp, nonce, sign
 *     -> { code: 0, msg: "ok", data: { supplierOrderNo, status: "PENDING|SUCCESS|FAILED", message } }
 *   POST {apiUrl}{queryPath}
 *     appId, outTradeNo, timestamp, nonce, sign
 *     -> { code: 0, data: { status, supplierOrderNo, message } }
 *
 * 签名：非空参数按 key 字典序拼接 k=v&k=v，末尾拼 &key=appSecret，md5 / hmac-sha256 后大写。
 * 沙箱模式（settings.sandboxMode = true）下不会发起真实请求，而是本地模拟，便于演示与联调。
 */
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const db = require('./db');

const STATUS_MAP = {
  PENDING: 'recharging',
  PROCESSING: 'recharging',
  SUCCESS: 'success',
  DONE: 'success',
  FAILED: 'failed',
  ERROR: 'failed',
};

function md5(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

function nonce() {
  return crypto.randomBytes(8).toString('hex');
}

/** 按对接协议生成签名 */
function buildSign(params, secret, signType) {
  const keys = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort();
  const raw = keys.map((k) => `${k}=${params[k]}`).join('&');
  if (signType === 'hmac-sha256') {
    return crypto.createHmac('sha256', secret || '').update(raw, 'utf8').digest('hex').toUpperCase();
  }
  if (signType === 'none') return '';
  return md5(raw + '&key=' + (secret || '')).toUpperCase();
}

/** 生成签名串（后台「签名调试」用，可复制给接入方核对） */
function buildSignRaw(params, secret) {
  const keys = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort();
  return keys.map((k) => `${k}=${params[k]}`).join('&') + '&key=' + (secret || '');
}

function request(cfg, urlStr, body, isJson, timeoutSec) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch (e) {
      return reject(new Error('接口地址格式错误：' + urlStr));
    }
    const isHttps = u.protocol === 'https:';
    const payload = isJson ? JSON.stringify(body) : new URLSearchParams(body).toString();
    const opts = {
      method: cfg.method || 'POST',
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + (u.search || ''),
      headers: {
        'Content-Type': isJson ? 'application/json;charset=utf-8' : 'application/x-www-form-urlencoded;charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: (timeoutSec || 15) * 1000,
    };
    const lib = isHttps ? https : http;
    const req = lib.request(opts, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(buf);
        } catch (e) {
          /* 保留原文 */
        }
        resolve({ status: res.statusCode, raw: buf, json: parsed });
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('请求超时（' + (timeoutSec || 15) + 's）'));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/** 选择该 SKU 应走的供应商：显式绑定优先，其次按分类 + 优先级挑选启用中的供应商 */
function resolveSupplier(sku, product) {
  const data = db.get();
  const list = data.suppliers.filter((s) => s.status === 'active');
  if (sku && sku.supplierId) {
    const bound = list.find((s) => s.id === sku.supplierId);
    if (bound) return bound;
  }
  const cat = product ? product.catId : null;
  const candidates = list
    .filter((s) => !cat || !s.categories || !s.categories.length || s.categories.includes(cat))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  return candidates[0] || null;
}

/** 模拟模式下的确定性随机器（同一订单号结果稳定） */
function seededRand(seed) {
  const h = crypto.createHash('md5').update(String(seed)).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}

function isSandbox(supplier) {
  const s = db.get().settings;
  if (supplier.mode === 'mock') return true;
  if (supplier.mode === 'manual') return true;
  return !!s.sandboxMode;
}

/**
 * 提交充值订单到供应商
 * @returns {Promise<{ok, supplierOrderNo, status, message, mode}>}
 */
async function submitOrder(order, supplier) {
  const t0 = Date.now();
  if (!supplier) {
    return { ok: false, status: 'failed', message: '未配置可用商品来源，订单已转入待处理', mode: 'none' };
  }
  if (supplier.mode === 'manual') {
    return {
      ok: true,
      status: 'recharging',
      supplierOrderNo: '',
      message: '该商品走人工工位，已进入客服处理队列，请等待人工完成',
      mode: 'manual',
      cost: Date.now() - t0,
    };
  }

  const skuCode = order.supplierSku;
  if (!skuCode) {
    return { ok: false, status: 'failed', message: '该套餐未绑定供应商商品编码，无法自动充值', mode: 'error' };
  }

  if (isSandbox(supplier)) {
    // ---- 本地沙箱模拟 ----
    const r = seededRand(order.no + supplier.id);
    const rate = typeof supplier.mockSuccessRate === 'number' ? supplier.mockSuccessRate : 0.95;
    const ok = r < rate;
    const delay = (supplier.mockDelaySec || 4) * 1000;
    await new Promise((res) => setTimeout(res, Math.min(delay, 1500)));
    const fakeNo = 'SP' + crypto.randomBytes(5).toString('hex').toUpperCase();
    // accountType = 'none'（账号 / 卡密类商品）本身就没有充值账号，不算异常
    const badAccount = /^\s*$/.test(order.account || '') && order.accountType !== 'none';
    if (badAccount) {
      return { ok: false, status: 'failed', message: '[沙箱] 充值账号为空，供应商拒绝受理', mode: 'sandbox', cost: Date.now() - t0 };
    }
    return {
      ok,
      status: ok ? 'recharging' : 'failed',
      supplierOrderNo: fakeNo,
      message: ok
        ? `[沙箱] 上游已受理，${supplier.mockDelaySec || 4} 秒后返回结果`
        : '[沙箱] 上游返回失败：该账号近期已充值过同类套餐（示例错误）',
      mode: 'sandbox',
      cost: Date.now() - t0,
    };
  }

  // ---- 真实 API 请求 ----
  const params = {
    appId: supplier.appId,
    outTradeNo: order.no,
    skuCode,
    account: order.account,
    quantity: String(order.quantity || 1),
    notifyUrl: supplier.notifyUrl || '',
    timestamp: String(Math.floor(Date.now() / 1000)),
    nonce: nonce(),
  };
  params.sign = buildSign(params, supplier.appSecret, supplier.signType);
  const isJson = supplier.contentType === 'json';
  const url = (supplier.apiUrl || '').replace(/\/$/, '') + (supplier.orderPath || '');

  const maxRetry = Math.max(0, Number(supplier.retry) || 0);
  let lastErr = '';
  for (let i = 0; i <= maxRetry; i++) {
    try {
      const res = await request(supplier, url, params, isJson, supplier.timeout);
      const j = res.json;
      if (!j) {
        lastErr = '上游返回非 JSON：' + String(res.raw).slice(0, 120);
        continue;
      }
      if (Number(j.code) !== 0 && j.code !== '0') {
        return {
          ok: false,
          status: 'failed',
          supplierOrderNo: (j.data && j.data.supplierOrderNo) || '',
          message: `上游业务失败[${j.code}]：${j.msg || '未知原因'}`,
          mode: 'api',
          cost: Date.now() - t0,
          request: params,
        };
      }
      const st = (j.data && (j.data.status || j.data.orderStatus)) || 'PENDING';
      return {
        ok: true,
        status: STATUS_MAP[String(st).toUpperCase()] || 'recharging',
        supplierOrderNo: (j.data && j.data.supplierOrderNo) || '',
        message: (j.data && j.data.message) || '上游已受理',
        mode: 'api',
        cost: Date.now() - t0,
        request: params,
      };
    } catch (e) {
      lastErr = e.message || String(e);
      if (i < maxRetry) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  return {
    ok: false,
    status: 'failed',
    message: `请求上游失败（已重试 ${maxRetry} 次）：${lastErr}`,
    mode: 'api',
    cost: Date.now() - t0,
    request: params,
  };
}

/** 后台「测试连通性」：只做参数构造 + 可选真实探测，不产生订单 */
async function testConnection(supplier) {
  const params = {
    appId: supplier.appId,
    outTradeNo: 'TEST' + Date.now(),
    skuCode: 'PING',
    account: 'test',
    quantity: '1',
    timestamp: String(Math.floor(Date.now() / 1000)),
    nonce: nonce(),
  };
  const sign = buildSign(params, supplier.appSecret, supplier.signType);
  const raw = buildSignRaw(params, supplier.appSecret);
  const base = {
    params: Object.assign({}, params, { sign }),
    signType: supplier.signType,
    signString: raw,
  };
  if (isSandbox(supplier)) {
    return Object.assign(base, {
      mode: supplier.mode === 'manual' ? 'manual' : 'sandbox',
      ok: true,
      latency: Math.round(20 + Math.random() * 120),
      message:
        supplier.mode === 'manual'
          ? '人工工位无需接口测试，订单将在后台手动完成'
          : '沙箱模式：签名与参数构造正常，未发起真实请求',
    });
  }
  const url = (supplier.apiUrl || '').replace(/\/$/, '') + (supplier.queryPath || '');
  const t0 = Date.now();
  try {
    const res = await request(supplier, url, Object.assign({}, params, { sign }), supplier.contentType === 'json', supplier.timeout);
    return Object.assign(base, {
      mode: 'api',
      ok: res.status >= 200 && res.status < 500,
      latency: Date.now() - t0,
      httpStatus: res.status,
      message: res.status >= 200 && res.status < 500 ? '接口可达（业务返回见下方原文）' : 'HTTP ' + res.status,
      response: res.json || String(res.raw).slice(0, 300),
    });
  } catch (e) {
    return Object.assign(base, {
      mode: 'api',
      ok: false,
      latency: Date.now() - t0,
      message: '连接失败：' + (e.message || e),
    });
  }
}

/** 解析上游异步回调 */
function parseCallback(body) {
  const j = typeof body === 'string' ? JSON.parse(body) : body;
  const outTradeNo = j.outTradeNo || j.out_trade_no || (j.data && j.data.outTradeNo);
  const st = String(j.status || j.orderStatus || (j.data && j.data.status) || '').toUpperCase();
  return {
    outTradeNo,
    status: STATUS_MAP[st] || '',
    supplierOrderNo: j.supplierOrderNo || (j.data && j.data.supplierOrderNo) || '',
    message: j.message || j.msg || '',
  };
}

module.exports = { submitOrder, resolveSupplier, buildSign, buildSignRaw, testConnection, parseCallback, STATUS_MAP, md5 };
