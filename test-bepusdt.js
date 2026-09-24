#!/usr/bin/env node
/**
 * BEpusdt 数字货币网关接入自测
 * ------------------------------------------------------------------
 * 覆盖内容：
 *   A. 签名算法金标准 —— 用官方文档给出的样例签名做断言
 *   B. 全链路 —— 本地起一个 BEpusdt 兼容 mock 网关，跑通
 *      「平台下单 → 网关逐单地址 → 链上回调 → 订单自动完成」
 *   C. 安全与健壮性 —— 错误签名被拒 / 重复回调幂等 / 超时回调关单
 *
 * 运行：node test-bepusdt.js          （需先启动 server.js；会临时切换沙箱与通道配置，结束后恢复）
 * 环境：BASE=http://127.0.0.1:8899  ADMIN_PW=admin888
 */
const http = require('http');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:8899';
const ADMIN_PW = process.env.ADMIN_PW || 'admin888';
const GW_PORT = Number(process.env.GW_PORT) || 8091;
const GW_TOKEN = 'epusdt_password_xasddawqe';
const GW_ORIGIN = 'http://127.0.0.1:' + GW_PORT;

const payment = require(path.join(__dirname, 'lib', 'payment.js'));

let passed = 0, failed = 0;
const pass = (m) => { passed++; console.log('  \x1b[32m✓\x1b[0m ' + m); };
const fail = (m) => { failed++; console.log('  \x1b[31m✗\x1b[0m ' + m); };
const head = (m) => console.log('\n\x1b[36m▶ ' + m + '\x1b[0m');

async function call(pathname, opt = {}) {
  const res = await fetch(BASE + pathname, opt);
  const text = await res.text();
  try { return { status: res.status, ...JSON.parse(text) }; } catch (e) { return { status: res.status, ok: false, raw: text.slice(0, 200) }; }
}
const post = (p, body, token) => call(p, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
  body: JSON.stringify(body || {}),
});

/* ------------------------------------------------------------------ */
/* A. 签名算法金标准（官方文档样例）                                    */
/* ------------------------------------------------------------------ */
function testSign() {
  head('A · 签名算法（对照官方文档样例）');
  const params = {
    order_id: '20220201030210321',
    amount: 42,
    notify_url: 'http://example.com/notify',
    redirect_url: 'http://example.com/redirect',
  };
  const expect = '1cd4b52df5587cfb1968b0c0c6e156cd';
  const got = payment.bepusdtSign(params, GW_TOKEN);
  got === expect ? pass(`签名与文档样例一致：${got}`) : fail(`签名不一致：得到 ${got}，文档为 ${expect}`);

  const raw = payment.bepusdtSignRaw(params, GW_TOKEN);
  raw.endsWith(GW_TOKEN) && raw.startsWith('amount=42&notify_url=')
    ? pass('签名原串拼接顺序正确（字典序 + 末尾直接追加令牌，无 & 分隔）：' + raw.slice(0, 52) + '…')
    : fail('签名原串异常：' + raw);

  // 验签：正确 / 空签名 / 被篡改
  payment.bepusdtVerify(Object.assign({}, params, { signature: expect }), GW_TOKEN)
    ? pass('正确签名验签通过') : fail('正确签名验签失败');
  !payment.bepusdtVerify(Object.assign({}, params, { signature: '' }), GW_TOKEN)
    ? pass('空签名被拒') : fail('空签名未被拒');
  !payment.bepusdtVerify(Object.assign({}, params, { amount: 43, signature: expect }), GW_TOKEN)
    ? pass('篡改金额后验签失败（防伪造到账）') : fail('篡改后仍验签通过');
  !payment.bepusdtVerify(Object.assign({}, params, { signature: expect }), GW_TOKEN + 'x')
    ? pass('令牌不匹配时验签失败') : fail('令牌不匹配仍通过');
  // 大写签名应被容错接受（比较前统一小写）
  payment.bepusdtVerify(Object.assign({}, params, { signature: expect.toUpperCase() }), GW_TOKEN)
    ? pass('大写签名兼容处理') : fail('大写签名未兼容');
}

/* ------------------------------------------------------------------ */
/* B. mock 网关                                                        */
/* ------------------------------------------------------------------ */
function startMockGateway() {
  const state = { created: [], canceled: [], last: null, notifyResults: [] };
  const sign = (p) => payment.bepusdtSign(p, GW_TOKEN);
  const send = (res, code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  };
  const readJson = (req) => new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve({}); } });
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, GW_ORIGIN);
    const p = url.pathname;

    if (p === '/api/v1/order/create-transaction' && req.method === 'POST') {
      const body = await readJson(req);
      state.last = body;
      if (sign(body) !== String(body.signature).toLowerCase()) {
        return send(res, 200, { status_code: 400, message: 'signature verify failed' });
      }
      const rate = 7.2;
      const actual = Math.round((Number(body.amount) / rate) * 100) / 100;
      const rec = {
        trade_id: 'MOCK-' + Date.now().toString(36).toUpperCase(),
        order_id: body.order_id,
        amount: String(body.amount),
        actual_amount: String(actual),
        token: 'TQ5NMqJjvvLhWvGPKHmVBTvkRnJfGHgVfz',
        expiration_time: Number(body.timeout) || 600,
        status: 1,
        payment_url: GW_ORIGIN + '/pay/checkout-counter/' + body.order_id,
        notify_url: body.notify_url,
        canceled: false,
      };
      state.created.push(rec);
      return send(res, 200, { status_code: 200, message: 'success', data: rec, request_id: '' });
    }

    if (p === '/api/v1/order/cancel-transaction' && req.method === 'POST') {
      const body = await readJson(req);
      if (sign(body) !== String(body.signature).toLowerCase()) {
        return send(res, 200, { status_code: 400, message: 'signature verify failed' });
      }
      const rec = state.created.find((x) => x.trade_id === body.trade_id);
      if (rec) rec.canceled = true;
      state.canceled.push(body.trade_id);
      return send(res, 200, { status_code: 200, message: 'success', data: { trade_id: body.trade_id }, request_id: '' });
    }

    /* 测试辅助：以网关身份向商户回调地址推送通知 */
    if (p === '/test/notify' && req.method === 'POST') {
      const body = await readJson(req);
      const rec = state.created.find((x) => x.order_id === body.order_id);
      if (!rec) return send(res, 200, { ok: false, message: 'no such order' });
      const payload = {
        trade_id: rec.trade_id,
        order_id: rec.order_id,
        amount: rec.amount,
        actual_amount: rec.actual_amount,
        token: rec.token,
        block_transaction_id: body.txid || '',
        status: Number(body.status),
      };
      if (body.breakSign) payload.signature = 'deadbeef'.repeat(8);
      else payload.signature = sign(payload);

      try {
        const r = await fetch(rec.notify_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const text = await r.text();
        state.notifyResults.push({ status: r.status, text });
        return send(res, 200, { ok: true, merchantStatus: r.status, merchantBody: text, payload });
      } catch (e) {
        return send(res, 200, { ok: false, message: e.message });
      }
    }

    if (p === '/test/state') return send(res, 200, state);
    send(res, 404, { status_code: 404, message: 'not found' });
  });

  return new Promise((resolve) => server.listen(GW_PORT, '127.0.0.1', () => resolve({ server, state })));
}

const gwCall = async (p, body) => {
  const r = await fetch(GW_ORIGIN + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json();
};

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */
(async () => {
  testSign();

  const health = await call('/api/store');
  if (!health.ok) {
    console.log('\n\x1b[31m无法访问服务 ' + BASE + '，请先启动 server.js\x1b[0m\n');
    process.exit(1);
  }

  const login = await post('/api/admin/login', { username: 'admin', password: ADMIN_PW });
  if (!login.ok) {
    console.log('\n\x1b[33m⊘ 管理员口令不正确（可用 ADMIN_PW=xxx 指定），跳过 B/C 段\x1b[0m\n');
    console.log(`\x1b[33mA 段通过 ${passed} 项\x1b[0m\n`);
    return;
  }
  const TOKEN = login.token;
  const snapshot = await call('/api/admin/settings', { headers: { Authorization: 'Bearer ' + TOKEN } });
  const backup = { settings: snapshot.settings, payConfig: snapshot.payConfig, payMethods: snapshot.payMethods };

  const { server: gw, state: gwState } = await startMockGateway();
  console.log(`\n\x1b[90m已启动 BEpusdt 兼容 mock 网关：${GW_ORIGIN}\x1b[0m`);

  const restore = async () => {
    await post('/api/admin/settings', {
      settings: { sandboxMode: backup.settings.sandboxMode, autoRecharge: backup.settings.autoRecharge },
      payConfig: {
        sandboxMode: backup.payConfig.sandboxMode,
        channels: { usdt: backup.payConfig.channels.usdt },
      },
      payMethods: backup.payMethods,
    }, TOKEN);
  };

  const setChannel = (ch) => post('/api/admin/settings', { payConfig: { channels: { usdt: ch } } }, TOKEN);

  try {
    const baseUsdt = Object.assign({}, backup.payConfig.channels.usdt, {
      provider: 'bepusdt',
      gatewayUrl: GW_ORIGIN,
      apiToken: GW_TOKEN,
      tradeType: 'usdt.trc20',
      fiat: 'CNY',
      timeoutSec: 600,
      notifyAck: 'ok',
      useCashier: false,
      notifyUrl: '',
      redirectUrl: '',
    });

    /* ---------------- 连通性自测接口 ---------------- */
    head('B1 · 后台「测试网关连通性」');
    const t = await post('/api/admin/pay/bepusdt/test', { channel: baseUsdt }, TOKEN);
    if (!t.ok) fail('自测接口调用失败：' + t.message);
    else {
      t.result.ok ? pass('自测通过：' + t.result.message) : fail('自测失败：' + t.result.message);
      t.result.tradeId ? pass('网关返回 trade_id 与逐单地址：' + t.result.tradeId + ' / ' + String(t.result.address).slice(0, 12) + '…') : fail('未返回 trade_id');
      t.result.canceled ? pass('自测订单已自动取消（不留待支付单）') : fail('自测订单未取消：' + t.result.cancelMessage);
      gwState.canceled.length === 1 ? pass('mock 网关确认收到取消请求') : fail('mock 网关未收到取消请求');
    }
    const badGw = await post('/api/admin/pay/bepusdt/test', { channel: Object.assign({}, baseUsdt, { apiToken: 'wrong-token' }) }, TOKEN);
    badGw.ok && !badGw.result.ok ? pass('令牌错误时自测正确失败：' + badGw.result.message) : fail('令牌错误却自测通过');

    /* ---------------- 下单拿到逐单地址 ---------------- */
    head('B2 · 平台下单 → 网关逐单分配收款地址');
    await setChannel(baseUsdt);
    // 注意：支付通道的沙箱开关是 payConfig.sandboxMode（后台「支付配置 → 沙箱模式」），
    // 与 settings.sandboxMode（全站上游充值沙箱）是两个独立开关，别改错。
    await post('/api/admin/settings', { payConfig: { sandboxMode: false }, settings: { autoRecharge: false } }, TOKEN);

    const store = await call('/api/store');
    const pu = (store.payInfo || {}).usdt || {};
    pu.provider === 'bepusdt' ? pass('前台公开信息显示收款模式为 bepusdt') : fail('前台未反映网关模式：' + pu.provider);
    pu.configured ? pass('网关模式可用性判定为已配置') : fail('网关配置判定异常');
    !JSON.stringify(pu).includes(GW_TOKEN) ? pass('公开信息未泄露 apiToken（安全）') : fail('apiToken 泄露到前台！');

    const pick = (() => {
      for (const p of store.products) for (const k of p.skus || []) if ((k.stock || 0) > 0) return { p, k };
      return null;
    })();
    if (!pick) throw new Error('没有可下单的商品');
    const acc = { phone: '13800138000', email: 'buyer@example.com', uid: '100086', username: '@buyer2026', account: 'buyer2026', gameid: 'x', none: '' }[pick.p.accountType || 'account'];
    const created = await post('/api/orders', { skuId: pick.k.id, account: acc, accountConfirm: acc, contact: 'gw@example.com', payMethod: 'usdt', quantity: 1 });
    if (!created.ok) throw new Error('下单失败：' + created.message);
    const no = created.order.no;
    created.pay.kind === 'crypto' ? pass('收银台类型为加密货币：kind=crypto') : fail('kind 异常：' + created.pay.kind);
    created.pay.gateway === 'bepusdt' ? pass('收银台标记网关来源为 bepusdt') : fail('未标记网关来源');
    /^http:\/\/127\.0\.0\.1:8091\/pay\//.test(created.pay.payUrl || '') ? pass('返回网关收银台链接：' + String(created.pay.payUrl).slice(0, 46) + '…') : fail('未返回网关收银台链接：' + created.pay.payUrl);
    created.pay.usdt.address && created.pay.usdt.address.startsWith('TQ5N') ? pass('拿到网关逐单收款地址：' + created.pay.usdt.address.slice(0, 12) + '…') : fail('未拿到逐单地址');
    created.pay.usdt.amount > 0 ? pass(`按法币金额换算应付：¥${created.order.amount} → ${created.pay.usdt.amount} USDT`) : fail('未换算应付金额（' + created.pay.usdt.amount + '）');

    const rec = gwState.created.find((x) => x.order_id === no);
    rec ? pass('mock 网关已收到下单请求并经签名校验通过') : fail('mock 网关未收到下单请求（或签名被拒）');
    if (rec) {
      rec.notify_url.indexOf('/api/callback/bepusdt') > 0 ? pass('回调地址自动推导正确：' + rec.notify_url) : fail('回调地址异常：' + rec.notify_url);
      String(rec.amount) === String(Number(created.order.amount)) ? pass('传给网关的法币金额一致：' + rec.amount) : fail(`金额不一致：网关 ${rec.amount} vs 订单 ${created.order.amount}`);
      !('trade_type' in rec) || rec.trade_type === 'usdt.trc20' ? pass('交易类型已下发：' + rec.trade_type) : fail('交易类型异常');
    }
    const detail = await call('/api/orders/' + no);
    detail.order.payGateway === 'bepusdt' && detail.order.payUrl ? pass('订单已持久化网关信息（payGateway / payUrl / payAddress）') : fail('订单未持久化网关信息');
    detail.order.payAddress ? pass('订单已记录逐单收款地址') : fail('订单未记录收款地址');

    /* ---------------- 回调：成功 ---------------- */
    head('B3 · 链上到账回调 → 订单自动完成');
    const TXID = '12ef6267b42e43959795cf31808d0cc72b3d0a48953ed19c61d4b6665a341d10';
    const n1 = await gwCall('/test/notify', { order_id: no, status: 2, txid: TXID });
    n1.ok ? pass('mock 网关已按文档规则签名并推送回调') : fail('mock 推送失败：' + n1.message);
    n1.merchantBody === 'ok' ? pass('平台应答 ok（网关视为通知成功）') : fail('平台应答异常：' + n1.merchantBody);

    const after = await call('/api/orders/' + no);
    after.order.status === 'paid' ? pass('订单状态已推进为「' + after.order.statusText + '」（已支付待充值）') : fail('订单状态未推进：' + after.order.statusText);
    after.order.payTxId === TXID ? pass('已回写链上交易哈希：' + TXID.slice(0, 18) + '…') : fail('未回写 TxID：' + after.order.payTxId);
    (after.order.logs || []).some((l) => l.msg.includes('网关确认到账')) ? pass('订单日志记录了网关到账信息') : fail('订单日志缺少到账记录');

    /* ---------------- 回调：幂等 ---------------- */
    head('B4 · 重复回调的幂等性');
    const n2 = await gwCall('/test/notify', { order_id: no, status: 2, txid: TXID });
    n2.merchantBody === 'ok' ? pass('重复回调仍应答 ok') : fail('重复回调应答异常：' + n2.merchantBody);
    const after2 = await call('/api/orders/' + no);
    after2.order.status === 'paid' && after2.order.paidAt === after.order.paidAt
      ? pass('状态与支付时间未被重复回调改动（幂等）') : fail('重复回调改动了订单状态');
    (after2.order.logs || []).some((l) => l.msg.includes('重复回调')) ? pass('日志中标注了重复回调并跳过处理') : fail('未记录重复回调');

    /* ---------------- 回调：验签失败 ---------------- */
    head('B5 · 伪造回调被拒绝');
    const bad = await gwCall('/test/notify', { order_id: no, status: 2, txid: 'f'.repeat(64), breakSign: true });
    bad.merchantBody === 'SIGN_ERROR' ? pass('错误签名被拒（应答 SIGN_ERROR）') : fail('错误签名应答异常：' + bad.merchantBody);
    const after3 = await call('/api/orders/' + no);
    after3.order.payTxId === TXID ? pass('伪造回调未篡改订单 TxID') : fail('伪造回调篡改了订单数据');

    /* ---------------- 回调：超时关单 ---------------- */
    head('B6 · 支付超时回调自动关单');
    const created2 = await post('/api/orders', { skuId: pick.k.id, account: acc, accountConfirm: acc, payMethod: 'usdt', quantity: 1 });
    if (!created2.ok) fail('第二笔下单失败：' + created2.message);
    else {
      const no2 = created2.order.no;
      const n3 = await gwCall('/test/notify', { order_id: no2, status: 3 });
      n3.merchantBody === 'ok' ? pass('超时回调被接受') : fail('超时回调应答异常：' + n3.merchantBody);
      const a2 = await call('/api/orders/' + no2);
      a2.order.status === 'closed' ? pass('订单已自动关闭（' + a2.order.statusText + '）') : fail('订单未关闭：' + a2.order.statusText);
    }

    /* ---------------- 回调：等待支付 ---------------- */
    head('B7 · 等待支付回调（每分钟推送）');
    const created3 = await post('/api/orders', { skuId: pick.k.id, account: acc, accountConfirm: acc, payMethod: 'usdt', quantity: 1 });
    if (created3.ok) {
      const no3 = created3.order.no;
      await gwCall('/test/notify', { order_id: no3, status: 1 });
      await gwCall('/test/notify', { order_id: no3, status: 1 });
      const a3 = await call('/api/orders/' + no3);
      const hits = (a3.order.logs || []).filter((l) => l.msg.includes('等待链上付款')).length;
      a3.order.status === 'pending_payment' && hits === 1
        ? pass('等待支付回调不改变订单状态，且只记录一条日志（避免刷屏）') : fail(`等待支付处理异常：status=${a3.order.status} 日志条数=${hits}`);
    }
  } catch (e) {
    fail('测试执行异常：' + (e.message || e));
  } finally {
    await restore();
    console.log('\n\x1b[90m已恢复测试前的沙箱与通道配置\x1b[0m');
    gw.close();
  }

  console.log('\n' + (failed ? `\x1b[31m${failed} 项失败 / ${passed} 项通过\x1b[0m` : `\x1b[32m全部通过 ✓（${passed} 项）\x1b[0m`) + '\n');
  process.exitCode = failed ? 1 : 0;
})();
