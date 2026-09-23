/**
 * 货源导入验证：新增的 iCloud 邮箱类商品（免填账号）全链路自测
 * 运行：node test-source-import.js
 *
 * 覆盖：
 *   1. 商品库 / 分类 / 货源通道是否成功并入
 *   2. 免填账号商品的下单 → 支付 → 派单 → 上游回调全链路
 *   3. 原有「必须填账号」商品的校验未被破坏（回归）
 *   4. 售罄商品被正确拦截
 *   5. 后台接口能看到新商品与新通道
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8899';

async function call(path, options) {
  const res = await fetch(BASE + path, options);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { ok: false, raw: text.slice(0, 200), status: res.status };
  }
}
const post = (p, body, headers) =>
  call(p, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: JSON.stringify(body || {}) });

const pass = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m);
const fail = (m) => { console.log('  \x1b[31m✗\x1b[0m ' + m); process.exitCode = 1; };
const head = (m) => console.log('\n\x1b[36m▶ ' + m + '\x1b[0m');
const NEW_IDS = ['p18', 'p19', 'p20', 'p21', 'p22', 'p23', 'p24', 'p25', 'p26'];

(async () => {
  head('1. 前台商品库');
  const store = await call('/api/store');
  if (!store.ok) return fail('GET /api/store 失败，请确认服务已启动');
  pass(`商品 ${store.products.length} 款 / 分类 ${store.categories.length} 个`);
  const cats = store.categories.map((c) => c.id);
  ['c6', 'c7', 'c8'].every((c) => cats.includes(c))
    ? pass('新增分类 c6 / c7 / c8 已上架：' + store.categories.filter((c) => ['c6', 'c7', 'c8'].includes(c.id)).map((c) => c.name).join('、'))
    : fail('新增分类缺失');

  const imported = store.products.filter((p) => NEW_IDS.includes(p.id));
  imported.length === 9
    ? pass(`新增商品 ${imported.length} 款全部在最前台可见`)
    : fail(`新增商品只有 ${imported.length} 款可见，应为 9 款`);
  imported.forEach((p) => {
    const s = (p.skus || [])[0] || {};
    if (p.accountType !== 'none') fail(`${p.id} accountType 应为 none，实际 ${p.accountType}`);
    if (s.supplierId !== 's7') fail(`${p.id} 未绑定货源 s7，实际 ${s.supplierId}`);
  });
  pass('全部为 accountType=none（免填账号）且已绑定货源 s7');
  console.log('    导入清单：');
  imported
    .sort((a, b) => a.sort - b.sort)
    .forEach((p) => {
      const s = (p.skus || [])[0] || {};
      console.log(`      · ${p.id} ${p.name}｜¥${s.price}｜库存 ${s.stock}｜已售 ${p.sales}`);
    });

  const soldOut = store.products.filter((p) => NEW_IDS.includes(p.id)).filter((p) => (p.skus || []).every((s) => (s.stock || 0) <= 0));
  soldOut.length ? pass(`售罄商品 ${soldOut.length} 款（${soldOut.map((p) => p.id).join('、')}）已被识别`) : console.log('    （本批无售罄商品）');

  head('2. 回归：原有商品仍要求填写账号');
  const r1 = await post('/api/orders', { skuId: 'p1-s1', account: '', payMethod: 'alipay', quantity: 1 });
  r1.ok ? fail('原有商品空账号竟然下单成功') : pass('拦截：' + r1.message);
  const r2 = await post('/api/orders', { skuId: 'p1-s1', account: '123', payMethod: 'alipay', quantity: 1 });
  r2.ok ? fail('错误手机号竟然通过') : pass('拦截：' + r2.message);

  head('3. 售罄商品拦截');
  const so = await post('/api/orders', { skuId: 'p26-s1', contact: 'test@example.com', payMethod: 'alipay', quantity: 1 });
  so.ok ? fail('售罄商品竟然可以下单') : pass('拦截：' + so.message);

  head('4. 免填账号商品：下单（不带 account 字段）');
  const created = await post('/api/orders', { skuId: 'p18-s1', contact: 'test@example.com', payMethod: 'alipay', quantity: 2 });
  if (!created.ok) return fail('下单失败：' + created.message);
  const no = created.order.no;
  pass(`订单 ${no}｜${created.order.productName} ${created.order.skuName} ×${created.order.quantity}｜¥${created.order.amount}`);
  created.order.account === '' ? pass('订单账号字段为空（免填），未出现占位脏数据') : fail('期望账号为空，实际 ' + JSON.stringify(created.order.account));

  head('5. 支付 → 自动派单到 iCloud 货源');
  const paid = await post(`/api/orders/${no}/pay`);
  if (!paid.ok) return fail('支付失败：' + paid.message);
  pass(`支付后状态：${paid.order.statusText}`);

  let final = paid.order;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const r = await call(`/api/orders/${no}`);
    final = r.order;
    if (['success', 'failed'].includes(final.status)) break;
  }
  final.supplierName && final.supplierName.includes('icloud')
    ? pass(`派单到货源：${final.supplierName}`)
    : fail(`派单货源异常：${final.supplierName}`);
  ['success', 'failed'].includes(final.status)
    ? pass(`最终状态：${final.statusText}｜上游单号 ${final.supplierOrderNo || '-'}`)
    : fail('订单未在 18s 内到达终态：' + final.statusText);
  console.log('    处理日志：');
  (final.logs || []).forEach((l) => console.log('      · ' + l.msg));

  head('6. 订单查询页接口（免填账号订单）');
  const q = await post('/api/orders/query', { keyword: no });
  q.ok && q.list.length ? pass(`按订单号查回 ${q.list.length} 条，账号字段：${JSON.stringify(q.list[0].account)}`) : fail('查询失败：' + q.message);

  head('7. 后台可见性');
  const login = await post('/api/admin/login', { username: 'admin', password: 'admin888' });
  if (!login.ok) return fail('后台登录失败：' + login.message);
  const auth = { Authorization: 'Bearer ' + login.token };
  const ap = await call('/api/admin/products', { headers: auth });
  ap.ok ? pass(`后台商品总数 ${ap.list.length}，其中新商品 ${ap.list.filter((p) => NEW_IDS.includes(p.id)).length} 款`) : fail('后台商品列表失败');
  const one = ap.list.find((p) => p.id === 'p18');
  one && one.accountType === 'none' && one.notice ? pass('新商品在后台带出 accountType=none 与商品说明（notice）') : fail('新商品后台字段不完整');
  const su = await call('/api/admin/suppliers', { headers: auth });
  const sup = (su.list || []).find((s) => s.id === 's7');
  sup ? pass(`货源通道已就绪：${sup.name}｜模式 ${sup.mode}｜绑定分类 ${(sup.categories || []).join('/')}`) : fail('后台找不到货源 s7');

  console.log('\n' + (process.exitCode ? '\x1b[31m有断言失败，请查看上方 ✗\x1b[0m' : '\x1b[32m全部通过 ✓\x1b[0m'));
})();
