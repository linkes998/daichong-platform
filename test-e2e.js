/**
 * 端到端自测：前台下单 → 支付 → 自动派单 → 上游结果 → 后台操作
 * 运行：node test-e2e.js
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8899';

async function call(path, options) {
  const res = await fetch(BASE + path, options);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { ok: false, raw: text.slice(0, 200) };
  }
}
const post = (p, body, headers) =>
  call(p, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: JSON.stringify(body || {}) });

const pass = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m);
const fail = (m) => { console.log('  \x1b[31m✗\x1b[0m ' + m); process.exitCode = 1; };
const head = (m) => console.log('\n\x1b[36m▶ ' + m + '\x1b[0m');

(async () => {
  head('1. 读取前台数据');
  const store = await call('/api/store');
  if (!store.ok) return fail('GET /api/store 失败');
  pass(`商品 ${store.products.length} 款 / 分类 ${store.categories.length} 个 / 支付方式 ${store.payMethods.length} 种`);

  const recent = await call('/api/recent');
  pass(`实时动态 ${recent.list ? recent.list.length : 0} 条，示例：${(recent.list[0] || {}).maskAccount || '-'}`);

  head('2. 参数校验（应当被拒绝）');
  const bad1 = await post('/api/orders', { skuId: 'x', account: '' });
  bad1.ok ? fail('空账号竟然下单成功') : pass('拦截：' + bad1.message);
  const bad2 = await post('/api/orders', { skuId: 'p1-s1', account: '123' });
  bad2.ok ? fail('错误手机号竟然通过') : pass('拦截：' + bad2.message);
  const bad3 = await post('/api/orders', { skuId: 'p1-s1', account: '13800138000', accountConfirm: '13800138001' });
  bad3.ok ? fail('两次账号不一致竟然通过') : pass('拦截：' + bad3.message);

  head('3. 正常下单');
  const p1 = store.products.find((p) => p.id === 'p1');
  const sku = p1.skus[0];
  const created = await post('/api/orders', {
    skuId: sku.id, account: '13800138000', accountConfirm: '13800138000',
    contact: 'test@example.com', payMethod: 'alipay', quantity: 1,
  });
  if (!created.ok) return fail('下单失败：' + created.message);
  const no = created.order.no;
  pass(`订单 ${no}｜${created.order.productName} ${created.order.skuName}｜¥${created.order.amount}｜状态 ${created.order.statusText}`);
  pass(`收银台：sandbox=${created.pay.sandbox}，二维码内容已生成 ${created.pay.qrContent ? '✓' : '✗'}`);

  head('4. 模拟支付 + 自动派单');
  const paid = await post(`/api/orders/${no}/pay`);
  if (!paid.ok) return fail('支付失败');
  pass(`支付后状态：${paid.order.statusText}`);

  await new Promise((r) => setTimeout(r, 2600));
  const mid = await call(`/api/orders/${no}`);
  pass(`2.6s 后：${mid.order.statusText}｜商品来源：${mid.order.supplierName}｜上游单号：${mid.order.supplierOrderNo || '-'}`);

  head('5. 等待上游异步结果');
  let final = mid.order;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const r = await call(`/api/orders/${no}`);
    final = r.order;
    if (['success', 'failed'].includes(final.status)) break;
  }
  if (['success', 'failed'].includes(final.status)) {
    pass(`最终状态：${final.statusText}`);
    console.log('    处理日志：');
    final.logs.forEach((l) => console.log('      · ' + l.msg));
  } else fail('订单未在预期时间内结束，当前：' + final.statusText);

  head('6. 订单查询（按账号）');
  const q = await post('/api/orders/query', { keyword: '13800138000' });
  q.ok && q.list.length ? pass(`按充值账号查到 ${q.list.length} 笔订单`) : fail('按账号查询失败');

  head('7. 后台登录与鉴权');
  const noAuth = await call('/api/admin/overview');
  noAuth.ok ? fail('未登录竟然能访问后台') : pass('拦截未登录访问：' + noAuth.message);
  const login = await post('/api/admin/login', { username: 'admin', password: 'wrong' });
  login.ok ? fail('错误密码登录成功') : pass('拦截错误密码');
  const good = await post('/api/admin/login', { username: 'admin', password: 'admin888' });
  if (!good.ok) return fail('后台登录失败');
  pass(`登录成功：${good.admin.name}`);
  const auth = { Authorization: 'Bearer ' + good.token };

  head('8. 后台数据');
  const ov = await call('/api/admin/overview', { headers: auth });
  pass(`概览：总订单 ${ov.cards.totalOrders} / 今日 ${ov.cards.todayOrders} / 今日销售额 ¥${ov.cards.todayAmount} / 成功率 ${ov.cards.successRate}% / 通道余额 ¥${ov.cards.supplierBalance}`);
  pass(`近 7 日趋势 ${ov.trend.length} 天，最近一天：${ov.trend[6].date} 订单 ${ov.trend[6].orders} 笔 ¥${ov.trend[6].amount}`);
  pass(`分类销售占比 ${ov.categories.length} 项：${ov.categories.map((c) => c.name + '¥' + c.amount).join('、')}`);

  const orders = await call('/api/admin/orders?page=1&size=5', { headers: auth });
  pass(`订单列表 共 ${orders.total} 笔，本页 ${orders.list.length} 笔`);

  const prods = await call('/api/admin/products', { headers: auth });
  pass(`商品管理 ${prods.list.length} 款，套餐 ${prods.list.reduce((s, p) => s + p.skus.length, 0)} 个，已带毛利字段（示例：${prods.list[0].skus[0].supplierName} 毛利率 ${prods.list[0].skus[0].margin}%）`);

  const sups = await call('/api/admin/suppliers', { headers: auth });
  pass(`商品来源 ${sups.list.length} 个：${sups.list.map((s) => s.name + '(' + s.mode + '/' + s.status + ')').join('、')}`);

  head('9. 供应商接口测试');
  const t1 = await post('/api/admin/suppliers/s1/test', {}, auth);
  t1.ok ? pass(`s1 测试：${t1.result.mode} 模式，${t1.result.message}（签名串 ${t1.result.signString.slice(0, 60)}…）`) : fail('接口测试失败');

  head('10. 后台订单操作（重试派单 / 手动完成 / 备注）');
  const failedList = await call('/api/admin/orders?status=failed&size=1', { headers: auth });
  if (failedList.list.length) {
    const target = failedList.list[0];
    const retry = await post(`/api/admin/orders/${target.no}/action`, { action: 'retry' }, auth);
    retry.ok ? pass(`订单 ${target.no} 重试派单：${retry.message}｜当前 ${retry.order.statusText}`) : fail('重试失败：' + retry.message);
  } else {
    const alt = orders.list[0];
    const note = await post(`/api/admin/orders/${alt.no}/action`, { action: 'note', text: '自测备注' }, auth);
    note.ok ? pass(`无失败订单，改为测试备注写入：订单 ${alt.no} 日志 ${note.order.logs.length} 条`) : fail('备注失败');
  }
  const pendingList = await call('/api/admin/orders?status=paid&size=1', { headers: auth });
  if (pendingList.list.length) {
    const done = await post(`/api/admin/orders/${pendingList.list[0].no}/action`, { action: 'complete' }, auth);
    done.ok ? pass(`手动完成 ${done.order.no} → ${done.order.statusText}`) : fail('手动完成失败');
  } else {
    const rc = await call('/api/admin/orders?status=recharging&size=1', { headers: auth });
    if (rc.list.length) {
      const done = await post(`/api/admin/orders/${rc.list[0].no}/action`, { action: 'complete' }, auth);
      done.ok ? pass(`人工工位订单 ${done.order.no} 手动完成 → ${done.order.statusText}`) : fail('手动完成失败');
    } else pass('当前无待处理订单，跳过手动完成测试');
  }

  head('11. 新增商品来源 + 新增商品 + 套餐保存');
  const ns = await post('/api/admin/suppliers', { supplier: { name: '测试通道·自测', mode: 'mock', apiUrl: 'https://test.local/api', appId: 'T1', appSecret: 's', markup: 1.5, priority: 5, categories: ['c1'], status: 'active' } }, auth);
  ns.ok ? pass('新增通道：' + ns.supplier.name + '（' + ns.supplier.id + '）') : fail('新增通道失败');

  const np = await post('/api/admin/products', { product: { name: '自测商品·视频月卡', catId: 'c1', icon: '🧪', accountType: 'phone', accountLabel: '测试手机号', needConfirm: true, status: 'active' } }, auth);
  np.ok ? pass('新增商品：' + np.product.name) : fail('新增商品失败');
  const pid = np.product.id;

  const ns2 = await post(`/api/admin/products/${pid}/skus`, { skus: [{ name: '月卡', faceValue: 30, price: 20, cost: 14, stock: 100, supplierId: ns.supplier.id, supplierSku: 'TEST_1M', status: 'active' }] }, auth);
  ns2.ok ? pass('套餐保存成功，共 ' + ns2.product.skus.length + ' 个') : fail('套餐保存失败');

  head('12. 用新商品跑一遍下单（走新建通道）');
  const o2 = await post('/api/orders', { skuId: ns2.product.skus[0].id, account: '13900139000', accountConfirm: '13900139000', payMethod: 'wechat' });
  if (!o2.ok) fail('新商品下单失败：' + o2.message);
  else {
    await post(`/api/orders/${o2.order.no}/pay`);
    await new Promise((r) => setTimeout(r, 2200));
    const chk = await call(`/api/orders/${o2.order.no}`);
    pass(`订单 ${chk.order.no} 已派发到「${chk.order.supplierName}」，状态 ${chk.order.statusText}`);
  }

  head('13. 商品下架/删除与数据清理');
  const del = await call(`/api/admin/products/${pid}`, { method: 'DELETE', headers: auth });
  del.ok ? pass('删除自测商品成功') : fail('删除商品失败');
  const delS = await call(`/api/admin/suppliers/${ns.supplier.id}`, { method: 'DELETE', headers: auth });
  delS.ok ? pass('删除自测通道成功') : fail('删除通道失败');

  head('14. 操作日志');
  const logs = await call('/api/admin/logs', { headers: auth });
  pass(`日志 ${logs.list.length} 条，最新：${logs.list[0].action} — ${logs.list[0].detail}`);

  console.log('\n' + (process.exitCode ? '\x1b[31m测试存在失败项\x1b[0m' : '\x1b[32m全部通过 ✓\x1b[0m') + '\n');
})();
