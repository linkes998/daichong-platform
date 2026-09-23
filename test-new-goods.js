#!/usr/bin/env node
/**
 * 新增货源商品回归测试
 * ---------------------------------------------------------------
 * 覆盖本次导入的两批货源：
 *   · 玉米须AI（189990.xyz）→ GPT 卡密类（免填账号，通道 s9）
 *   · CheJiu.VIP（chejiu888.online）→ X Premium / TG 会员新档位 + X Premium+（通道 s8）
 *
 * 校验点：分类与商品落库、免填账号下单、needConfirm 二次确认、账号格式校验、
 *        全链路派单（下单 → 支付 → 派单 → 上游回调 → 完成）、后台通道与商品接口。
 *
 * 用法：node test-new-goods.js      （需先启动 server.js）
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8899';

let passed = 0;
let failed = 0;
const pass = (m) => {
  passed++;
  console.log('  ✓ ' + m);
};
const fail = (m) => {
  failed++;
  console.log('  ✗ ' + m);
};
const head = (m) => console.log('\n' + m);

async function api(path, opt = {}) {
  const res = await fetch(BASE + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opt));
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = { ok: false, message: 'HTTP ' + res.status };
  }
  return data;
}
const post = (p, body, headers) =>
  api(p, { method: 'POST', body: JSON.stringify(body || {}), headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) });
const get = (p, headers) => api(p, { headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) });

/** 下单 → 支付 → 等待上游回调 */
async function fullFlow(skuId, opts = {}) {
  const created = await post('/api/orders', Object.assign({ skuId, quantity: 1 }, opts));
  if (!created.ok) return { ok: false, at: 'create', message: created.message };
  const no = created.order.no;
  const paid = await post(`/api/orders/${no}/pay`, {});
  if (!paid.ok) return { ok: false, at: 'pay', message: paid.message, order: paid.order };
  // 沙箱模式下派单 + 回调需要时间（mockDelaySec 一般 3~5 秒）
  let order = paid.order;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 700));
    const q = await get('/api/orders/' + no);
    if (q.ok && q.order) order = q.order;
    if (['success', 'failed'].includes(order.status)) break;
  }
  return { ok: true, order };
}

(async () => {
  console.log('▶ 新增货源商品回归测试  base=' + BASE);

  head('1. 商品与分类落库');
  const store = await get('/api/store');
  if (!store.ok) {
    fail('无法读取 /api/store：' + store.message);
    return finish();
  }
  const cat = (store.categories || []).find((c) => c.id === 'c9');
  cat ? pass(`新增分类 c9「${cat.name}」已上架`) : fail('缺少分类 c9（AI 会员）');
  const gpt = ['p27', 'p28', 'p29'].map((id) => (store.products || []).find((p) => p.id === id));
  gpt.every(Boolean) ? pass('GPT 三款卡密商品全部上架（p27/p28/p29）') : fail('GPT 商品缺失：' + gpt.map((p) => (p ? p.id : '?')).join(','));
  const xpp = (store.products || []).find((p) => p.id === 'p30');
  xpp ? pass(`X Premium+ 已上架（${xpp.skus.length} 个档位，最低 ¥${xpp.minPrice}）`) : fail('缺少 p30（X Premium+）');
  const p15 = (store.products || []).find((p) => p.id === 'p15');
  const p16 = (store.products || []).find((p) => p.id === 'p16');
  const s4 = p15 && p15.skus.find((s) => s.id === 'p15-s4');
  const s5 = p15 && p15.skus.find((s) => s.id === 'p15-s5');
  s4 && s5 ? pass(`X Premium 合并 CheJiu 档位（3个月 ¥${s4.price} / 6个月 ¥${s5.price}）`) : fail('X Premium 缺少 CheJiu 档位');
  const t6 = p16 && p16.skus.find((s) => s.id === 'p16-s6');
  t6 ? pass(`Telegram Premium 合并 CheJiu 档位（12个月 ¥${t6.price}）`) : fail('TG 缺少 CheJiu 档位');
  const noticeOk = [...gpt, xpp].filter((p) => p && p.notice && p.notice.length > 30).length;
  noticeOk === 4 ? pass('新增商品均带「商品说明与使用须知」（notice）') : fail(`notice 缺失：仅 ${noticeOk}/4 个商品有`);

  head('2. 免填账号下单（GPT 卡密类）');
  const noAcc = await post('/api/orders', { skuId: 'p27-s1', quantity: 1 });
  if (noAcc.ok) {
    noAcc.order.account === '' ? pass('不传 account 即可下单，订单账号字段留空') : fail('免填商品却写入了账号：' + noAcc.order.account);
    noAcc.order.accountType === 'none' ? pass('订单 accountType 记录为 none') : fail('accountType 记录异常：' + noAcc.order.accountType);
    Math.abs(noAcc.order.amount - 113) < 0.01 ? pass(`金额正确 ¥${noAcc.order.amount}`) : fail('金额异常：' + noAcc.order.amount);
    // 免填商品传了 account 也应被忽略
    const dirty = await post('/api/orders', { skuId: 'p27-s1', account: 'someone@example.com', quantity: 1 });
    dirty.ok && dirty.order.account === '' ? pass('免填商品即使传了 account 也会被忽略') : fail('免填商品未忽略 account');
  } else {
    fail('免填账号下单失败：' + noAcc.message);
  }

  head('3. X Premium+ 账号校验与二次确认');
  const empty = await post('/api/orders', { skuId: 'p30-s1', quantity: 1 });
  !empty.ok ? pass('未填账号被拒绝：' + empty.message) : fail('未填账号竟然下单成功');
  const badFmt = await post('/api/orders', { skuId: 'p30-s1', account: 'a!b', accountConfirm: 'a!b', quantity: 1 });
  !badFmt.ok ? pass('账号格式错误被拒绝：' + badFmt.message) : fail('非法账号格式未被拦截');
  const mismatch = await post('/api/orders', { skuId: 'p30-s1', account: '@apple_tester', accountConfirm: '@apple_teste', quantity: 1 });
  !mismatch.ok ? pass('两次输入不一致被拒绝：' + mismatch.message) : fail('二次确认未生效');

  head('4. 全链路派单（GPT / X Premium+ / X Premium 新档位）');
  const flows = [
    ['p28-s1', { quantity: 1 }, 'GPT Pro 5x', 's9'],
    ['p30-s3', { account: '@apple_tester', accountConfirm: '@apple_tester', quantity: 1 }, 'X Premium+ 12个月', 's8'],
    ['p15-s4', { account: '@apple_tester', accountConfirm: '@apple_tester', quantity: 1 }, 'X Premium 3个月（CheJiu）', 's8'],
  ];
  for (const [skuId, opts, label, expectSup] of flows) {
    const r = await fullFlow(skuId, opts);
    if (!r.ok) {
      fail(`${label} 流程失败（${r.at}）：${r.message}`);
      continue;
    }
    const o = r.order;
    const supOk = o.supplierId === expectSup || (o.logs || []).some((l) => String(l.msg).includes(expectSup));
    o.status === 'success'
      ? pass(`${label} 全链路完成（订单 ${o.no}｜通道 ${o.supplierId}｜¥${o.amount}）`)
      : fail(`${label} 未完成，当前状态 ${o.status}（${o.statusText || ''}）`);
    if (o.status === 'success' && !supOk) fail(`${label} 派单通道异常：${o.supplierId}，预期 ${expectSup}`);
  }

  head('5. 数量上限与库存保护');
  const bulk = await post('/api/orders', { skuId: 'p27-s1', quantity: 99 });
  bulk.ok && bulk.order.quantity === 10 ? pass('单笔数量被限制为 10 份') : fail('数量上限未生效：' + (bulk.ok ? bulk.order.quantity : bulk.message));

  head('6. 后台通道与商品接口');
  const login = await post('/api/admin/login', { username: 'admin', password: 'admin888' });
  if (!login.ok || !login.token) {
    fail('后台登录失败：' + (login.message || ''));
  } else {
    const auth = { Authorization: 'Bearer ' + login.token };
    const sup = await get('/api/admin/suppliers', auth);
    const s8 = (sup.list || []).find((s) => s.id === 's8');
    const s9 = (sup.list || []).find((s) => s.id === 's9');
    s8 && s9 ? pass(`新增两条货源通道：${s8.name} / ${s9.name}`) : fail('货源通道缺失（s8/s9）');
    if (s9) {
      const conn = await post('/api/admin/suppliers/s9/test', {}, auth);
      conn.ok ? pass('通道 s9（玉米须AI）连通性测试通过：' + (conn.message || '').slice(0, 60)) : fail('通道 s9 测试失败：' + conn.message);
    }
    const prods = await get('/api/admin/products', auth);
    const accTypes = ['p27', 'p28', 'p29'].map((id) => {
      const p = (prods.list || []).find((x) => x.id === id);
      return p && p.accountType;
    });
    accTypes.every((t) => t === 'none') ? pass('后台商品列表正确显示免填账号类型') : fail('后台免填类型显示异常：' + accTypes.join(','));

    // 订单查询页能按账号查到新商品订单
    const q = await post('/api/orders/query', { keyword: '@apple_tester' });
    q.ok && (q.list || []).length ? pass(`按 X 账号可查到 ${q.list.length} 笔新订单`) : fail('按账号查单失败：' + (q.message || '无结果'));
  }

  finish();
})().catch((e) => {
  console.log('\n测试异常：' + (e.stack || e.message));
  finish(1);
});

function finish(code) {
  console.log(`\n断言通过 ${passed} 项，失败 ${failed} 项`);
  process.exit(code || (failed ? 1 : 0));
}
