#!/usr/bin/env node
/**
 * 后台多项功能自检
 * ------------------------------------------------------------------
 * 覆盖四项需求的验收点：
 *   1) 管理员密码重置：校验、二次确认、旧会话注销、明文不再落盘、专用审计日志
 *   2) 多语言：/api/locale 识别结果与前台可见性
 *   3) USDT 收款通道设置维护：通道参数读写、公开信息下发、密钥不外泄
 *   4) 信用卡 / PayPal 收款方式：方式存在、金额换算、下单链路可用
 *
 * 运行：node test-features.js   （需先启动 server.js）
 * 结束时会把被改动的配置恢复原状，可重复执行。
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8899';

let passed = 0;
let failed = 0;
const pass = (m) => { passed++; console.log('  \x1b[32m✓\x1b[0m ' + m); };
const fail = (m) => { failed++; console.log('  \x1b[31m✗\x1b[0m ' + m); };
const head = (m) => console.log('\n\x1b[36m▶ ' + m + '\x1b[0m');
const info = (m) => console.log('    ' + m);

async function call(path, opt = {}) {
  const res = await fetch(BASE + path, opt);
  const text = await res.text();
  try { return { status: res.status, ...JSON.parse(text) }; }
  catch (e) { return { status: res.status, ok: false, raw: text.slice(0, 200) }; }
}
const post = (p, body, token) =>
  call(p, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: JSON.stringify(body || {}),
  });
const get = (p, token) => call(p, { headers: token ? { Authorization: 'Bearer ' + token } : {} });

const NEW_PW = process.env.ADMIN_NEW_PW || 'YunChong#2026';
// 线上环境口令通常已被修改，可用 ADMIN_PW 指定当前口令
const OLD_PW = process.env.ADMIN_PW || 'admin888';

(async () => {
  /* ============ 0. 备份现状，便于收尾恢复 ============ */
  const login0 = await post('/api/admin/login', { username: 'admin', password: OLD_PW });
  if (!login0.ok) {
    console.log('\n\x1b[31m无法用默认口令登录，请确认管理员口令；测试中止\x1b[0m');
    process.exit(1);
  }
  let TOKEN = login0.token;
  const snapshot = await get('/api/admin/settings', TOKEN);
  const backup = {
    payMethods: snapshot.payMethods,
    payConfig: snapshot.payConfig,
    settings: snapshot.settings,
  };

  /* ================================================================
     需求 1：管理员密码重置
     ================================================================ */
  head('需求 1 · 修改管理员密码');

  const t1 = await post('/api/admin/password', { oldPassword: 'wrong-pw', newPassword: NEW_PW, confirmPassword: NEW_PW }, TOKEN);
  !t1.ok && t1.status === 400 ? pass('错误当前密码被拒：' + t1.message) : fail('错误当前密码未被拦截');

  const t2 = await post('/api/admin/password', { oldPassword: OLD_PW, newPassword: '', confirmPassword: '' }, TOKEN);
  !t2.ok && /请填写新密码/.test(t2.message || '') ? pass('新密码为空被明确拒绝（修复了原「静默成功」问题）：' + t2.message) : fail('新密码为空竟然返回成功：' + JSON.stringify(t2));

  const t3 = await post('/api/admin/password', { oldPassword: OLD_PW, newPassword: 'abc', confirmPassword: 'abc' }, TOKEN);
  !t3.ok && /至少 8 位/.test(t3.message || '') ? pass('过短密码被拒：' + t3.message) : fail('过短密码未被拦截');

  const t4 = await post('/api/admin/password', { oldPassword: OLD_PW, newPassword: 'abc def123', confirmPassword: 'abc def123' }, TOKEN);
  !t4.ok && /空格/.test(t4.message || '') ? pass('含空格密码被拒：' + t4.message) : fail('含空格密码未被拦截');

  const t5 = await post('/api/admin/password', { oldPassword: OLD_PW, newPassword: '1234567890', confirmPassword: '1234567890' }, TOKEN);
  !t5.ok && /纯数字/.test(t5.message || '') ? pass('纯数字密码被拒：' + t5.message) : fail('纯数字密码未被拦截');

  const t6 = await post('/api/admin/password', { oldPassword: OLD_PW, newPassword: OLD_PW, confirmPassword: OLD_PW }, TOKEN);
  !t6.ok && /不能与原密码相同/.test(t6.message || '') ? pass('与原密码相同被拒：' + t6.message) : fail('与原密码相同未被拦截');

  const t7 = await post('/api/admin/password', { oldPassword: OLD_PW, newPassword: NEW_PW, confirmPassword: NEW_PW + 'x' }, TOKEN);
  !t7.ok && /不一致/.test(t7.message || '') ? pass('二次确认不一致被拒：' + t7.message) : fail('二次确认不一致未被拦截');

  // 旧接口必须明确报错，不能静默
  const t8 = await post('/api/admin/settings', { admin: { username: 'admin', oldPassword: OLD_PW, newPassword: NEW_PW } }, TOKEN);
  !t8.ok && /api\/admin\/password/.test(t8.message || '') ? pass('旧设置接口不再静默改密，返回明确指引') : fail('旧接口仍在处理口令：' + JSON.stringify(t8));

  // 第二个会话，用于验证改密后其他会话被注销
  const second = await post('/api/admin/login', { username: 'admin', password: OLD_PW });
  const TOKEN2 = second.token;

  const okChange = await post('/api/admin/password', { oldPassword: OLD_PW, newPassword: NEW_PW, confirmPassword: NEW_PW }, TOKEN);
  okChange.ok ? pass(`改密成功：${okChange.message}`) : fail('改密失败：' + okChange.message);

  const loginNew = await post('/api/admin/login', { username: 'admin', password: NEW_PW });
  loginNew.ok ? pass('新口令可正常登录（满足「成功重置密码并正常登录」）') : fail('新口令无法登录：' + loginNew.message);

  const loginOld = await post('/api/admin/login', { username: 'admin', password: OLD_PW });
  !loginOld.ok ? pass('旧口令已失效') : fail('旧口令仍可登录');

  const me1 = await get('/api/admin/me', TOKEN);
  const me2 = await get('/api/admin/me', TOKEN2);
  me1.ok && !me2.ok ? pass('当前会话保留、其他会话已被注销') : fail(`会话处理异常：当前=${me1.ok} 其他=${me2.ok}`);

  const logs = await get('/api/admin/logs', TOKEN);
  const hasAudit = (logs.list || []).some((l) => l.action === 'admin.password.change');
  hasAudit ? pass('已写入专用审计日志 admin.password.change') : fail('缺少改密审计日志');

  const settle = await get('/api/admin/settings', TOKEN);
  const adm = (settle.admins || [])[0] || {};
  adm.hashed ? pass('口令为哈希存储（hashed=true）') : fail('口令未哈希存储');
  !('password' in adm) && !('passwordHash' in adm) ? pass('接口不回传口令及其哈希') : fail('接口泄露了口令字段');

  // 恢复为默认口令，保证后续步骤与重复执行可用
  const restorePw = await post('/api/admin/password', { oldPassword: NEW_PW, newPassword: OLD_PW, confirmPassword: OLD_PW }, TOKEN);
  restorePw.ok ? pass('已恢复默认口令 admin888') : fail('恢复默认口令失败：' + restorePw.message);
  TOKEN = (await post('/api/admin/login', { username: 'admin', password: OLD_PW })).token;

  /* ================================================================
     需求 2：多语言
     ================================================================ */
  head('需求 2 · 前台多语言（默认英文 / 按 IP 自动切换 / 手动切换）');

  const loc = await get('/api/locale');
  ['zh', 'en'].includes(loc.lang) ? pass(`/api/locale 返回 lang=${loc.lang}（来源 ${loc.source}，IP ${loc.ip || '-'}）`) : fail('/api/locale 返回异常：' + JSON.stringify(loc));

  const locZh = await get('/api/locale?lang=zh');
  locZh.lang === 'zh' && locZh.source === 'query' ? pass('URL 显式指定 ?lang=zh 优先生效') : fail('URL 语言参数未生效');

  const store = await get('/api/store');
  store.settings && 'defaultLang' in store.settings ? pass(`前台返回语言配置：defaultLang=${store.settings.defaultLang} i18nEnabled=${store.settings.i18nEnabled} autoLangByIp=${store.settings.autoLangByIp}`) : fail('前台未返回语言配置');
  (store.settings.defaultLang === 'en') ? pass('默认语言为英文（符合需求）') : fail('默认语言不是英文：' + store.settings.defaultLang);

  const i18nTest = await get('/api/admin/i18n/test&ip=114.114.114.114'.replace('&', '?'), TOKEN);
  i18nTest.ok ? pass(`语言识别自测接口可用（114.114.114.114 → ${i18nTest.lang}/${i18nTest.source}）`) : fail('语言识别自测接口异常');

  /* ================================================================
     需求 3：USDT 收款通道设置维护
     ================================================================ */
  head('需求 3 · USDT 收款通道设置维护');

  const DEFAULTS = snapshot.channelDefaults || {};
  Object.keys(DEFAULTS.usdt || {}).length >= 8
    ? pass(`后台可获取 USDT 通道参数模板（${Object.keys(DEFAULTS.usdt).join('、')}）`)
    : fail('缺少 USDT 通道参数模板');

  const usdtCfg = {
    network: 'TRC20',
    address: 'TQ5NMqJjvvLhWvGPKHmVBTvkRnJfGHgVfz',
    rate: 7.15,
    minAmount: 10,
    confirmations: 2,
    uniqueAmount: true,
    payWindowMinutes: 30,
    tips: '请务必使用 TRC20 网络转账',
  };
  const saveUsdt = await post('/api/admin/settings', { payConfig: { channels: { usdt: usdtCfg } } }, TOKEN);
  saveUsdt.ok ? pass('USDT 通道参数保存成功') : fail('USDT 参数保存失败：' + saveUsdt.message);

  const store2 = await get('/api/store');
  const pu = (store2.payInfo || {}).usdt || {};
  pu.address === usdtCfg.address && pu.rate === usdtCfg.rate
    ? pass(`前台已获取 USDT 公开收款信息：${pu.network} / ${pu.address.slice(0, 10)}… / 汇率 ${pu.rate}`)
    : fail('前台未获取到 USDT 收款信息：' + JSON.stringify(pu));

  const pubStr = JSON.stringify(store2.payInfo || {});
  !/secretKey|clientSecret|merchantKey|privateKey/.test(pubStr)
    ? pass('前台公开信息中不含任何密钥字段（安全）')
    : fail('前台公开信息泄露了密钥字段！');

  // USDT 下单：走加密货币流程
  const usdtMethod = (store2.payMethods || []).find((m) => m.code === 'usdt');
  usdtMethod ? pass(`USDT 收款方式在前台可见（${usdtMethod.name}，通道类型 ${usdtMethod.kind}）`) : fail('前台看不到 USDT 收款方式');

  const anySku = (store2.products || []).flatMap((p) => (p.skus || []).map((s) => ({ p, s }))).find((x) => (x.s.stock || 0) > 0);
  if (!anySku) { fail('没有可用套餐，跳过下单验证'); }
  else {
    const noAccount = anySku.p.accountType === 'none';
    const o = await post('/api/orders', {
      skuId: anySku.s.id,
      account: noAccount ? '' : '13800138000',
      accountConfirm: noAccount ? '' : '13800138000',
      payMethod: 'usdt',
      quantity: 1,
    });
    if (!o.ok) fail('USDT 下单失败：' + o.message);
    else {
      o.pay.kind === 'crypto' ? pass(`USDT 收银台类型正确（kind=crypto，应付 ${o.pay.usdt.amount} USDT / 汇率 ${o.pay.usdt.rate}）`) : fail('USDT 收银台类型异常：' + o.pay.kind);
      o.order.payCurrency === 'USDT' ? pass(`订单已记录外币金额：${o.order.payForeignAmount} ${o.order.payCurrency}（网络 ${o.order.payNetwork}）`) : fail('订单未记录 USDT 金额');

      // 沙箱下回填交易哈希
      const txid = 'a'.repeat(64);
      const paid = await post(`/api/orders/${o.order.no}/pay`, { txid }, TOKEN);
      paid.ok && /TxID|交易哈希/.test(JSON.stringify(paid.order.logs)) ? pass('回填交易哈希后完成支付并留痕') : fail('回填交易哈希流程异常');
      paid.order && paid.order.payTxId === txid ? pass('订单已保存 payTxId') : fail('订单未保存 payTxId');

      const badTx = await post(`/api/orders/${o.order.no}/pay`, {}, TOKEN);
      badTx.ok ? info('（订单已支付，重复支付被忽略，符合预期）') : info('（重复支付被拒：' + badTx.message + '）');
    }
  }

  /* ================================================================
     需求 4：国际信用卡 + PayPal
     ================================================================ */
  head('需求 4 · 国际信用卡与 PayPal 收款');

  const defs = snapshot.methodDefs || [];
  const codes = defs.map((d) => d.code);
  codes.includes('creditcard') && codes.includes('paypal')
    ? pass('后台已内置 creditcard / paypal 收款方式定义')
    : fail('缺少新增收款方式定义：' + codes.join(','));

  const withCard = backup.payMethods.map((m) => (['creditcard', 'paypal'].includes(m.code) ? Object.assign({}, m, { enabled: true }) : m));
  const enable = await post('/api/admin/settings', {
    payMethods: withCard,
    payConfig: {
      channels: {
        creditcard: { provider: 'stripe', secretKey: 'sk_test_fake_for_selftest', publishableKey: 'pk_test_fake', currency: 'USD', rate: 7.2 },
        paypal: { merchantEmail: 'pay@example.com', mode: 'sandbox', currency: 'USD', rate: 7.2 },
      },
    },
  }, TOKEN);
  enable.ok ? pass('信用卡 / PayPal 通道配置保存成功') : fail('配置保存失败：' + enable.message);

  const store3 = await get('/api/store');
  const pmCodes = (store3.payMethods || []).map((m) => m.code);
  pmCodes.includes('creditcard') && pmCodes.includes('paypal')
    ? pass('前台支付方式列表已含信用卡与 PayPal：' + pmCodes.join('、'))
    : fail('前台缺少新收款方式：' + pmCodes.join('、'));

  const pi = store3.payInfo || {};
  pi.creditcard && pi.creditcard.currency === 'USD' ? pass(`信用卡公开信息：币种 ${pi.creditcard.currency} / 供应商 ${pi.creditcard.provider} / publishableKey 已下发`) : fail('信用卡公开信息缺失');
  pi.paypal && pi.paypal.merchantEmail === 'pay@example.com' ? pass(`PayPal 公开信息：收款账号 ${pi.paypal.merchantEmail} / 模式 ${pi.paypal.mode}`) : fail('PayPal 公开信息缺失');
  !/sk_test_fake_for_selftest/.test(JSON.stringify(pi)) ? pass('Stripe 私钥未下发到前台（安全）') : fail('Stripe 私钥泄露到前台！');

  if (anySku) {
    const noAccount = anySku.p.accountType === 'none';
    for (const method of ['creditcard', 'paypal']) {
      const o = await post('/api/orders', {
        skuId: anySku.s.id,
        account: noAccount ? '' : '13800138000',
        accountConfirm: noAccount ? '' : '13800138000',
        payMethod: method,
        quantity: 1,
      });
      if (!o.ok) { fail(`${method} 下单失败：` + o.message); continue; }
      const rightCurrency = o.order.payCurrency === 'USD' && o.order.payForeignAmount > 0;
      rightCurrency
        ? pass(`${method} 下单成功：¥${o.order.amount} → ${o.order.payForeignAmount} ${o.order.payCurrency}（汇率 ${o.order.payRate}）`)
        : fail(`${method} 订单未正确换算外币金额：` + JSON.stringify({ c: o.order.payCurrency, a: o.order.payForeignAmount }));
      const paid = await post(`/api/orders/${o.order.no}/pay`, {}, TOKEN);
      paid.ok ? pass(`${method} 支付确认可用，订单进入 ${paid.order.statusText}`) : fail(`${method} 支付确认失败`);
    }
  }

  /* ============ 收尾：恢复快照 ============ */
  head('收尾 · 恢复测试前配置');
  const restoreStore = await get('/api/admin/settings', TOKEN);
  const r = await post('/api/admin/settings', {
    payMethods: backup.payMethods,
    payConfig: Object.assign({}, backup.payConfig, { channels: backup.payConfig.channels }),
    settings: { i18n: backup.settings.i18n },
  }, TOKEN);
  const after = await get('/api/store');
  const finalCodes = (after.payMethods || []).filter((m) => ['creditcard', 'paypal'].includes(m.code));
  r.ok ? pass('配置已恢复（新收款方式回到测试前状态：' + (finalCodes.map((m) => m.code).join('、') || '均未启用') + '）') : fail('恢复失败：' + r.message);

  console.log('\n' + (failed ? `\x1b[31m${failed} 项失败 / ${passed} 项通过\x1b[0m` : `\x1b[32m全部通过 ✓（${passed} 项）\x1b[0m`) + '\n');
  process.exitCode = failed ? 1 : 0;
})();
