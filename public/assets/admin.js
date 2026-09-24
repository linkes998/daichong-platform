/* ============================================================
   后台管理逻辑
   ============================================================ */

let ME = null;
let CACHE = { products: [], categories: [], suppliers: [], settings: {}, payMethods: [], payConfig: {}, counts: {}, statusText: {} };
let PAGE = 'overview';

const PAGES = {
  overview: { title: '数据概览', sub: '经营数据与通道健康度' },
  orders: { title: '订单管理', sub: '查询、派单、补发与退款' },
  products: { title: '商品与套餐', sub: '商品信息、充值账号字段与套餐价格' },
  suppliers: { title: '商品来源 / API 通道', sub: '维护上游供货接口、加价率与优先级' },
  categories: { title: '分类管理', sub: '专区分类的排序与展示' },
  pay: { title: '支付配置', sub: '支付方式开关与网关参数' },
  settings: { title: '系统设置', sub: '站点信息、交易参数与管理员' },
  logs: { title: '操作日志', sub: '后台关键操作留痕' },
};

/** 商品「充值账号字段」类型：none = 账号 / 卡密类商品，买家免填，下单后自动发货 */
const ACC_TYPES = [
  ['none', '免填（账号 / 卡密类商品，自动发货）'],
  ['phone', '手机号'],
  ['email', '邮箱'],
  ['uid', '数字 UID'],
  ['username', '@用户名'],
  ['gameid', '游戏区服+角色'],
  ['account', '通用账号'],
];
const accTypeText = (t) => (ACC_TYPES.find((a) => a[0] === (t || 'account')) || [, t || 'account'])[1];

/* ---------------- 通用组件 ---------------- */
function openModal(opt) {
  document.getElementById('modalRoot').innerHTML = `<div class="modal-mask" id="adminMask">
    <div class="modal" style="max-width:${opt.maxWidth || 760}px">
      <div class="modal-head">
        <h3>${opt.title || ''}</h3>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body">${opt.body || ''}</div>
      ${opt.foot ? `<div class="modal-foot">${opt.foot}</div>` : ''}
    </div></div>`;
  const mask = document.getElementById('adminMask');
  if (!opt.lock) mask.addEventListener('mousedown', (e) => { if (e.target === mask) closeModal(); });
  if (opt.after) opt.after();
}
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }

function openDrawer(title, body, foot) {
  document.getElementById('drawerRoot').innerHTML = `
    <div class="drawer-mask" id="dMask"></div>
    <aside class="drawer">
      <div class="drawer-head"><h3 style="font-size:15px;font-weight:650">${title}</h3>
        <button class="modal-close" style="margin-left:auto" onclick="closeDrawer()">×</button></div>
      <div class="drawer-body">${body}</div>
      ${foot ? `<div class="drawer-foot">${foot}</div>` : ''}
    </aside>`;
  document.getElementById('dMask').addEventListener('click', closeDrawer);
}
function closeDrawer() { document.getElementById('drawerRoot').innerHTML = ''; }

function statCard(label, value, foot, hue) {
  return `<div class="stat">
    <div class="glow" style="background:${hue || '#6d5efc'}"></div>
    <div class="lb">${label}</div>
    <div class="vl">${value}</div>
    <div class="ft">${foot || ''}</div>
  </div>`;
}

/* ---------------- 初始化 ---------------- */
async function boot() {
  const token = localStorage.getItem('admin_token');
  if (!token) return showLogin();
  const me = await api('/api/admin/me');
  if (!me.ok) return showLogin();
  ME = me.admin;
  showApp();
}

function showLogin() {
  document.getElementById('loginView').classList.remove('hide');
  document.getElementById('appView').classList.add('hide');
  document.getElementById('lgPass').value = '';
  document.getElementById('lgPass').focus();
}

function showApp() {
  document.getElementById('loginView').classList.add('hide');
  document.getElementById('appView').classList.remove('hide');
  document.getElementById('adminChip').textContent = '👤 ' + ME.name;
  bindNav();
  const h = (location.hash || '#overview').slice(1);
  go(PAGES[h] ? h : 'overview');
}

function bindNav() {
  document.querySelectorAll('#sideNav a').forEach((a) => a.addEventListener('click', () => go(a.dataset.page)));
}

function go(page) {
  PAGE = page;
  location.hash = page;
  document.querySelectorAll('#sideNav a').forEach((a) => a.classList.toggle('on', a.dataset.page === page));
  document.getElementById('pageTitle').textContent = PAGES[page].title;
  document.getElementById('pageSub').textContent = PAGES[page].sub;
  document.getElementById('pageBody').innerHTML = '<div class="skeleton" style="height:280px"></div>';
  ({ overview: renderOverview, orders: renderOrders, products: renderProducts, suppliers: renderSuppliers,
     categories: renderCategories, pay: renderPay, settings: renderSettings, logs: renderLogs })[page]();
}

/* ---- 登录 ---- */
document.getElementById('lgBtn').addEventListener('click', doLogin);
document.getElementById('lgPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  const btn = document.getElementById('lgBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 登录中';
  const res = await api('/api/admin/login', {
    method: 'POST',
    body: { username: document.getElementById('lgUser').value.trim(), password: document.getElementById('lgPass').value },
  });
  btn.disabled = false; btn.textContent = '登录';
  if (!res.ok) return toast(res.message || '登录失败', 'err');
  localStorage.setItem('admin_token', res.token);
  ME = res.admin;
  toast('欢迎回来，' + res.admin.name, 'ok');
  showApp();
}

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('admin_token');
  location.reload();
});

/* ============================================================
   1. 数据概览
   ============================================================ */
async function renderOverview() {
  const res = await api('/api/admin/overview');
  if (!res.ok) return;
  const c = res.cards;
  CACHE.counts = { pending: c.pendingCount };
  document.getElementById('sandboxChip').innerHTML = c.sandboxMode
    ? '<span class="dot dot-warn"></span>沙箱模式'
    : '<span class="dot dot-ok"></span>生产模式';

  const body = document.getElementById('pageBody');
  body.innerHTML = `
    <div class="stat-grid">
      ${statCard('今日订单', c.todayOrders, `累计 ${c.totalOrders} 笔`, '#6d5efc')}
      ${statCard('今日销售额', '¥' + money(c.todayAmount), `毛利 ¥${money(c.todayProfit)}`, '#22d3ee')}
      ${statCard('累计营收', '¥' + money(c.revenue), `累计毛利 ¥${money(c.profit)}`, '#f5c451')}
      ${statCard('充值成功率', c.successRate + '%', '按已结算订单统计', '#22c55e')}
      ${statCard('待处理订单', c.pendingCount, `其中人工工位 ${c.manualCount} 笔`, '#f59e0b')}
      ${statCard('上游通道余额', '¥' + money(c.supplierBalance), '所有启用通道合计', '#8b5cf6')}
    </div>

    <div class="chart-row">
      <div class="chart-card">
        <h3>近 7 日经营趋势</h3>
        <div class="sub">柱状为销售额，折线为订单量</div>
        ${trendChart(res.trend)}
        <div class="legend"><span><i style="background:#6d5efc"></i>销售额</span><span><i style="background:#22d3ee"></i>订单量</span></div>
      </div>
      <div class="chart-card">
        <h3>分类销售占比</h3>
        <div class="sub">已完成订单的销售额分布</div>
        ${catBars(res.categories)}
      </div>
    </div>

    <div class="chart-row" style="grid-template-columns:1fr 1.35fr">
      <div class="chart-card">
        <h3>商品来源通道健康度</h3>
        <div class="sub">成功率与余额（含沙箱模拟数据）</div>
        ${supHealth(res.suppliers)}
      </div>
      <div class="chart-card" style="padding-bottom:8px">
        <h3>最近订单</h3>
        <div class="sub">点击行可查看详情并处理</div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>订单号</th><th>商品</th><th>金额</th><th>通道</th><th>状态</th><th>时间</th></tr></thead>
          <tbody>${res.recent.map((o) => `<tr style="cursor:pointer" onclick="orderDetail('${o.no}')">
            <td class="mono" style="font-size:12px">${o.no}</td>
            <td>${escapeHtml(o.productName)}<div class="muted" style="font-size:11.5px">${escapeHtml(o.skuName)}</div></td>
            <td>¥${money(o.amount)}</td>
            <td class="muted" style="font-size:12px">${escapeHtml(o.supplierName)}</td>
            <td>${statusChip(o.status)}</td>
            <td class="muted" style="font-size:12px">${fmtShort(o.createdAt)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>

    ${c.pendingCount ? `<div class="card card-tight" style="margin-top:16px;border-color:rgba(245,158,11,.3)">
      <div class="row-flex"><span style="font-size:19px">⚠️</span>
      <div><b>有 ${c.pendingCount} 笔订单待处理</b>
      <div class="muted" style="font-size:12.5px">包含待支付与充值中订单，建议先到订单管理批量派单</div></div>
      <button class="btn btn-sm btn-primary" style="margin-left:auto" onclick="go('orders')">去处理</button></div></div>` : ''}
  `;
}

function trendChart(trend) {
  const W = 640, H = 210, PL = 44, PR = 44, PT = 16, PB = 28;
  const iw = W - PL - PR, ih = H - PT - PB;
  const maxAmt = Math.max(1, ...trend.map((t) => t.amount));
  const maxOrd = Math.max(1, ...trend.map((t) => t.orders));
  const step = iw / trend.length;
  const bw = Math.min(38, step * 0.46);
  let bars = '', line = '', dots = '', grid = '', labels = '';
  for (let i = 0; i <= 4; i++) {
    const y = PT + (ih / 4) * i;
    grid += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="rgba(255,255,255,.055)"/>`;
    grid += `<text x="${PL - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6d7288">${Math.round((maxAmt / 4) * (4 - i))}</text>`;
    grid += `<text x="${W - PR + 8}" y="${y + 4}" font-size="10" fill="#6d7288">${Math.round((maxOrd / 4) * (4 - i))}</text>`;
  }
  trend.forEach((t, i) => {
    const cx = PL + step * i + step / 2;
    const h = (t.amount / maxAmt) * ih;
    const y = PT + ih - h;
    bars += `<rect x="${cx - bw / 2}" y="${y}" width="${bw}" height="${Math.max(2, h)}" rx="5" fill="url(#g1)"/>`;
    const oy = PT + ih - (t.orders / maxOrd) * ih;
    line += (i ? ' L' : 'M') + cx + ' ' + oy;
    dots += `<circle cx="${cx}" cy="${oy}" r="3.4" fill="#0b0d16" stroke="#22d3ee" stroke-width="2"/>`;
    labels += `<text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="#6d7288">${t.date}</text>`;
    labels += `<title>${t.date}：¥${t.amount} / ${t.orders} 单</title>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
    <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#8b7cff"/><stop offset="100%" stop-color="#4f43c9"/></linearGradient></defs>
    ${grid}${bars}<path d="${line}" fill="none" stroke="#22d3ee" stroke-width="2"/>${dots}${labels}
  </svg>`;
}

function catBars(cats) {
  if (!cats.length) return '<div class="empty" style="padding:30px">暂无数据</div>';
  const total = cats.reduce((s, c) => s + c.amount, 0) || 1;
  const colors = ['#6d5efc', '#22d3ee', '#f5c451', '#22c55e', '#f43f5e', '#8b5cf6', '#38bdf8'];
  return cats
    .map((c, i) => `<div class="bar-row">
      <span class="nm">${escapeHtml(c.name)}</span>
      <span class="track"><span class="fill" style="width:${(c.amount / total) * 100}%;background:${colors[i % colors.length]}"></span></span>
      <span class="vv">¥${money(c.amount)}</span>
    </div>`)
    .join('') + `<div class="muted" style="font-size:12px;margin-top:14px">合计 ¥${money(total)}</div>`;
}

function supHealth(list) {
  return list
    .map((s) => {
      const color = s.rate >= 95 ? '#22c55e' : s.rate >= 88 ? '#f59e0b' : '#f43f5e';
      const modeTxt = { api: '接口', mock: '模拟', manual: '人工' }[s.mode] || s.mode;
      return `<div style="margin-bottom:16px">
        <div class="row-flex" style="margin-bottom:7px">
          <span class="dot ${s.status === 'active' ? 'dot-ok' : 'dot-idle'}"></span>
          <b style="font-size:13px;font-weight:600">${escapeHtml(s.name)}</b>
          <span class="muted" style="font-size:11.5px">${modeTxt}</span>
          <span style="margin-left:auto;font-size:12.5px;color:${color}">${s.rate}%</span>
        </div>
        <div class="bar-row" style="margin-bottom:0"><span class="track"><span class="fill" style="width:${s.rate}%;background:${color}"></span></span></div>
        <div class="muted" style="font-size:11.5px;margin-top:5px">结算 ${s.total} 笔 · 余额 ¥${money(s.balance)}</div>
      </div>`;
    })
    .join('');
}

/* ============================================================
   2. 订单管理
   ============================================================ */
let orderFilter = { status: '', keyword: '', page: 1 };

async function renderOrders() {
  const params = new URLSearchParams({ status: orderFilter.status, keyword: orderFilter.keyword, page: orderFilter.page, size: 20 });
  const res = await api('/api/admin/orders?' + params.toString());
  if (!res.ok) return;
  CACHE.statusText = res.statusText;

  const tabs = [
    ['', '全部', Object.values(res.counts).reduce((a, b) => a + b, 0)],
    ['pending_payment', '待支付', res.counts.pending_payment],
    ['paid', '已支付待充值', res.counts.paid],
    ['recharging', '充值中', res.counts.recharging],
    ['success', '已完成', res.counts.success],
    ['failed', '充值失败', res.counts.failed],
    ['refunded', '已退款', res.counts.refunded],
  ];

  const rows = res.list.map((o) => `<tr style="cursor:pointer" onclick="orderDetail('${o.no}')">
      <td><div class="mono" style="font-size:12px">${o.no}</div>
        <div class="muted" style="font-size:11px">${fmtTime(o.createdAt)}</div></td>
      <td><div style="font-weight:550">${escapeHtml(o.productName)}</div>
        <div class="muted" style="font-size:11.5px">${escapeHtml(o.skuName)}${o.quantity > 1 ? ' ×' + o.quantity : ''}</div></td>
      <td><div class="mono" style="font-size:12.5px">${o.account ? escapeHtml(o.account) : '<span class="muted">免填</span>'}</div>
        ${o.contact ? `<div class="muted" style="font-size:11px">${escapeHtml(o.contact)}</div>` : ''}</td>
      <td><b>¥${money(o.amount)}</b><div class="muted" style="font-size:11px">成本 ¥${money((o.cost || 0) * o.quantity)}</div></td>
      <td class="muted" style="font-size:12px">${escapeHtml(o.supplierName)}</td>
      <td>${statusChip(o.status)}</td>
      <td style="text-align:right" onclick="event.stopPropagation()">
        ${o.status === 'recharging' ? `<button class="btn btn-xs" onclick="orderAction('${o.no}','complete')">标记完成</button>` : ''}
        ${o.status === 'failed' ? `<button class="btn btn-xs" onclick="orderAction('${o.no}','retry')">重试</button>` : ''}
        ${o.status === 'pending_payment' ? `<button class="btn btn-xs" onclick="orderAction('${o.no}','close')">关闭</button>` : ''}
      </td>
    </tr>`).join('');

  document.getElementById('pageBody').innerHTML = `
    <div class="tabs">
      ${tabs.map(([v, t, n]) => `<div class="t ${orderFilter.status === v ? 'on' : ''}" onclick="orderFilter.status='${v}';orderFilter.page=1;renderOrders()">${t}<span class="n">${n}</span></div>`).join('')}
    </div>
    <div class="toolbar">
      <input class="input" id="ordKw" placeholder="搜索订单号 / 充值账号 / 商品 / 上游单号" value="${escapeHtml(orderFilter.keyword)}">
      <button class="btn btn-sm" onclick="orderFilter.keyword=document.getElementById('ordKw').value;orderFilter.page=1;renderOrders()">搜索</button>
      <div class="spacer"></div>
      <button class="btn btn-sm" onclick="batchDispatch()">🚀 批量派单（已支付未充值）</button>
      <button class="btn btn-sm" onclick="exportOrders()">⬇️ 导出 CSV</button>
    </div>
    <div class="panel">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>订单号 / 时间</th><th>商品 / 套餐</th><th>充值账号</th><th>金额</th><th>商品来源</th><th>状态</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7"><div class="empty">没有符合条件的订单</div></td></tr>'}</tbody>
      </table></div>
    </div>
    <div class="toolbar" style="justify-content:center;margin-top:16px">
      <button class="btn btn-sm" ${res.page <= 1 ? 'disabled' : ''} onclick="orderFilter.page=${res.page - 1};renderOrders()">← 上一页</button>
      <span class="muted" style="font-size:13px">第 ${res.page} / ${Math.max(1, Math.ceil(res.total / res.size))} 页 · 共 ${res.total} 笔</span>
      <button class="btn btn-sm" ${res.page >= Math.ceil(res.total / res.size) ? 'disabled' : ''} onclick="orderFilter.page=${res.page + 1};renderOrders()">下一页 →</button>
    </div>
  `;
  document.getElementById('ordKw').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { orderFilter.keyword = e.target.value; orderFilter.page = 1; renderOrders(); }
  });
}

async function orderDetail(no) {
  const res = await api('/api/admin/orders?keyword=' + no + '&size=1');
  if (!res.ok || !res.list.length) return toast('订单不存在', 'err');
  const o = res.list.find((x) => x.no === no) || res.list[0];
  const logs = (o.logs || []).slice().reverse().map((l) => {
    const cls = l.level === 'success' ? 'ok' : l.level === 'error' ? 'err' : l.level === 'warn' ? 'warn' : '';
    return `<div class="tl-item ${cls}"><div class="m">${escapeHtml(l.msg)}</div><div class="t">${fmtTime(l.t)}</div></div>`;
  }).join('');
  const body = `
    <div class="info-rows">
      <div class="r"><span class="k">订单状态</span><span class="v">${statusChip(o.status)}</span></div>
      <div class="r"><span class="k">商品</span><span class="v">${escapeHtml(o.productName)} · ${escapeHtml(o.skuName)}${o.quantity > 1 ? ' ×' + o.quantity : ''}</span></div>
      <div class="r"><span class="k">充值账号</span><span class="v"><b>${escapeHtml(o.account)}</b></span></div>
      <div class="r"><span class="k">订单金额</span><span class="v">¥${money(o.amount)}（成本 ¥${money((o.cost || 0) * o.quantity)}，毛利 ¥${money(o.grossProfit)}）</span></div>
      <div class="r"><span class="k">支付方式</span><span class="v">${escapeHtml(o.payMethodName)}</span></div>
      <div class="r"><span class="k">商品来源</span><span class="v">${escapeHtml(o.supplierName)}${o.supplierSku ? ' · SKU ' + escapeHtml(o.supplierSku) : ''}</span></div>
      <div class="r"><span class="k">上游单号</span><span class="v">${o.supplierOrderNo ? '<b>' + escapeHtml(o.supplierOrderNo) + '</b>' : '—'}</span></div>
      <div class="r"><span class="k">派单次数</span><span class="v">${o.attempts || 0} 次${o.lastUpstreamMessage ? ' · ' + escapeHtml(o.lastUpstreamMessage) : ''}</span></div>
      <div class="r"><span class="k">联系方式</span><span class="v">${escapeHtml(o.contact || '—')}</span></div>
      <div class="r"><span class="k">备注</span><span class="v">${escapeHtml(o.remark || '—')}</span></div>
      <div class="r"><span class="k">下单时间</span><span class="v">${fmtTime(o.createdAt)}</span></div>
      <div class="r"><span class="k">支付时间</span><span class="v">${fmtTime(o.paidAt)}</span></div>
      <div class="r"><span class="k">完成时间</span><span class="v">${fmtTime(o.finishedAt)}</span></div>
    </div>
    <div class="sec-title" style="margin-top:0"><span class="n">✓</span>处理日志</div>
    <div class="timeline">${logs}</div>`;

  const foot = `
    ${['failed', 'recharging', 'paid'].includes(o.status) ? `<button class="btn btn-sm btn-primary" onclick="orderAction('${o.no}','retry')">重试派单</button>` : ''}
    ${o.status !== 'success' && o.status !== 'refunded' && o.status !== 'closed' ? `<button class="btn btn-sm" onclick="orderAction('${o.no}','complete')">标记完成</button>` : ''}
    ${!['success', 'refunded', 'closed'].includes(o.status) ? `<button class="btn btn-sm" onclick="orderAction('${o.no}','fail')">标记失败</button>` : ''}
    ${['success', 'failed'].includes(o.status) ? `<button class="btn btn-sm btn-danger" onclick="orderAction('${o.no}','refund')">退款 ¥${money(o.amount)}</button>` : ''}
    <button class="btn btn-sm btn-ghost" style="margin-left:auto" onclick="orderAction('${o.no}','note')">加备注</button>`;
  openDrawer('订单详情 · ' + o.no, body, foot);
}

async function orderAction(no, action) {
  let payload = { action };
  if (action === 'note') {
    const text = prompt('请输入备注内容：');
    if (!text) return;
    payload.text = text;
  }
  if (action === 'refund' && !confirm('确认对该订单退款？此操作会写入日志。')) return;
  const res = await api('/api/admin/orders/' + no + '/action', { method: 'POST', body: payload });
  if (!res.ok) return toast(res.message || '操作失败', 'err');
  toast('操作成功：' + (res.message || (res.order ? res.order.statusText : '')), 'ok');
  closeDrawer();
  if (PAGE === 'orders') renderOrders(); else renderOverview();
}

async function batchDispatch() {
  if (!confirm('将把所有「已支付未充值」的订单批量提交到上游通道，确认继续？')) return;
  const res = await api('/api/admin/orders/batch-dispatch', { method: 'POST' });
  if (!res.ok) return toast(res.message || '操作失败', 'err');
  toast(`批量派单完成：${res.dispatched}/${res.total} 笔已提交`, 'ok');
  renderOrders();
}

async function exportOrders() {
  const token = localStorage.getItem('admin_token');
  const res = await fetch('/api/admin/orders/export', { headers: { Authorization: 'Bearer ' + token } });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'orders-' + Date.now() + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  toast('已导出 CSV（Excel 可直接打开）', 'ok');
}

/* ============================================================
   3. 商品与套餐
   ============================================================ */
async function renderProducts() {
  const res = await api('/api/admin/products');
  if (!res.ok) return;
  CACHE.products = res.list;
  CACHE.categories = res.categories;
  CACHE.suppliers = res.suppliers;

  const rows = res.list.map((p) => {
    const cat = res.categories.find((c) => c.id === p.catId) || {};
    const skus = (p.skus || []).sort((a, b) => a.sort - b.sort);
    return `<tr>
      <td>
        <div class="row-flex">
          <span style="width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-size:17px;background:${hexA(p.hue, 0.16)}">${p.icon}</span>
          <div><div style="font-weight:600">${escapeHtml(p.name)}</div>
          <div class="muted" style="font-size:11.5px">${escapeHtml(p.subtitle || '')}</div></div>
        </div>
      </td>
      <td><span class="chip">${cat.icon || ''} ${escapeHtml(cat.name || '—')}</span></td>
      <td style="font-size:12px">
        <div>${escapeHtml(p.accountLabel || '')}</div>
        <div class="muted">${p.needConfirm ? '需二次确认' : '免二次确认'} · ${escapeHtml(accTypeText(p.accountType))}</div>
      </td>
      <td>${skus.length} 个<div class="muted" style="font-size:11.5px">¥${money(p.minPrice)} 起</div></td>
      <td>${p.sales || 0}</td>
      <td>${p.status === 'active' ? '<span class="chip chip-ok">上架中</span>' : '<span class="chip">已下架</span>'}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-xs" onclick="editSkus('${p.id}')">套餐</button>
        <button class="btn btn-xs" onclick="editProduct('${p.id}')">编辑</button>
        <button class="btn btn-xs btn-danger" onclick="delProduct('${p.id}','${escapeHtml(p.name)}')">删除</button>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('pageBody').innerHTML = `
    <div class="toolbar">
      <div class="muted" style="font-size:13px">共 ${res.list.length} 款商品 · ${res.list.reduce((s, p) => s + p.skus.length, 0)} 个套餐</div>
      <div class="spacer"></div>
      <button class="btn btn-sm btn-primary" onclick="editProduct()">＋ 新增商品</button>
    </div>
    <div class="panel"><div class="table-wrap"><table class="table">
      <thead><tr><th>商品</th><th>分类</th><th>充值账号字段</th><th>套餐</th><th>销量</th><th>状态</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7"><div class="empty">还没有商品，点右上角新增</div></td></tr>'}</tbody>
    </table></div></div>`;
}

function editProduct(id) {
  const p = id ? CACHE.products.find((x) => x.id === id) : null;
  const cats = CACHE.categories;
  const accTypes = ACC_TYPES;
  const body = `<div class="form-grid">
    <div class="form-sec full">基本信息</div>
    <div class="field full"><label>商品名称 <span class="req">*</span></label>
      <input class="input" id="pName" value="${p ? escapeHtml(p.name) : ''}" placeholder="例如：爱奇艺黄金VIP会员"></div>
    <div class="field full"><label>副标题</label>
      <input class="input" id="pSub" value="${p ? escapeHtml(p.subtitle || '') : ''}" placeholder="例如：支持手机/电脑/平板，不含电视端"></div>
    <div class="field"><label>所属分类</label>
      <select class="select" id="pCat">${cats.map((c) => `<option value="${c.id}" ${p && p.catId === c.id ? 'selected' : ''}>${c.icon} ${escapeHtml(c.name)}</option>`).join('')}</select></div>
    <div class="field"><label>图标 Emoji</label>
      <input class="input" id="pIcon" value="${p ? escapeHtml(p.icon) : '🎁'}"></div>
    <div class="field"><label>主题色</label>
      <input class="input" id="pHue" value="${p ? p.hue : '#6d5efc'}" placeholder="#6d5efc"></div>
    <div class="field"><label>角标</label>
      <input class="input" id="pBadge" value="${p ? escapeHtml(p.badge || '') : ''}" placeholder="例如：热销 / 新上架，留空不显示"></div>
    <div class="field"><label>标签（逗号分隔）</label>
      <input class="input" id="pTags" value="${p ? (p.tags || []).join('，') : ''}" placeholder="官方直充，秒到账"></div>
    <div class="field"><label>排序</label>
      <input class="input" id="pSort" type="number" value="${p ? p.sort : (CACHE.products.length + 1)}"></div>

    <div class="form-sec full">充值账号字段（前台下单时要求买家填写的内容）</div>
    <div class="field"><label>账号类型</label>
      <select class="select" id="pAccType">${accTypes.map(([v, t]) => `<option value="${v}" ${p && p.accountType === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="field"><label>字段名称</label>
      <input class="input" id="pAccLabel" value="${p ? escapeHtml(p.accountLabel || '') : '充值账号'}" placeholder="例如：爱奇艺账号（手机号）"></div>
    <div class="field full"><label>输入框提示语</label>
      <input class="input" id="pAccPh" value="${p ? escapeHtml(p.accountPlaceholder || '') : ''}" placeholder="例如：请输入爱奇艺登录手机号"></div>
    <div class="field full"><label>填写说明</label>
      <textarea class="textarea" id="pAccHint" placeholder="提示用户如何找到正确的账号">${p ? escapeHtml(p.accountHint || '') : ''}</textarea></div>
    <div class="field full"><label>商品说明与使用须知<span class="muted" style="font-weight:400">（选填，展示在下单弹窗内，适合放使用限制 / 合规声明）</span></label>
      <textarea class="textarea" id="pNotice" placeholder="例如：本商品为邮箱账号有偿租用，仅支持接收邮件；严禁用于诈骗、赌博、非法批量注册等任何违法违规用途。">${p ? escapeHtml(p.notice || '') : ''}</textarea></div>

    <div class="form-sec full">交付与状态</div>
    <div class="field"><label>交付方式</label>
      <select class="select" id="pDelivery">
        <option value="auto" ${!p || p.deliveryMode === 'auto' ? 'selected' : ''}>自动充值（对接上游 API）</option>
        <option value="manual" ${p && p.deliveryMode === 'manual' ? 'selected' : ''}>人工处理（后台手动完成）</option>
      </select></div>
    <div class="field"><label>商品状态</label>
      <select class="select" id="pStatus">
        <option value="active" ${!p || p.status === 'active' ? 'selected' : ''}>上架</option>
        <option value="disabled" ${p && p.status !== 'active' ? 'selected' : ''}>下架</option>
      </select></div>
    <div class="field full"><label class="switch ${p && p.needConfirm ? 'on' : ''}" id="pConfirmSw" onclick="this.classList.toggle('on')">
      <span class="track"></span><span>要求买家二次确认充值账号（强烈建议开启，可显著降低填错率）</span></label></div>
  </div>`;

  const foot = `<button class="btn" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" style="margin-left:auto" onclick="saveProduct(${p ? "'" + p.id + "'" : 'null'})">保存商品</button>`;
  openModal({ title: p ? '编辑商品 · ' + p.name : '新增商品', body, foot, maxWidth: 820 });
}

async function saveProduct(id) {
  const v = (k) => document.getElementById(k).value.trim();
  if (!v('pName')) return toast('商品名称必填', 'err');
  const payload = {
    id: id || undefined,
    name: v('pName'), subtitle: v('pSub'), catId: v('pCat'), icon: v('pIcon'), hue: v('pHue'),
    badge: v('pBadge'), tags: v('pTags') ? v('pTags').split(/[，,]/).map((s) => s.trim()).filter(Boolean) : [],
    sort: Number(v('pSort')) || 0, status: v('pStatus'), deliveryMode: v('pDelivery'),
    accountType: v('pAccType'), accountLabel: v('pAccLabel'), accountPlaceholder: v('pAccPh'), accountHint: v('pAccHint'),
    notice: v('pNotice'),
    needConfirm: document.getElementById('pConfirmSw').classList.contains('on'),
  };
  const res = await api('/api/admin/products', { method: 'POST', body: { product: payload } });
  if (!res.ok) return toast(res.message || '保存失败', 'err');
  toast('商品已保存', 'ok');
  closeModal();
  renderProducts();
}

async function delProduct(id, name) {
  if (!confirm(`确认删除商品「${name}」？该操作不可恢复。`)) return;
  const res = await api('/api/admin/products/' + id, { method: 'DELETE' });
  if (!res.ok) return toast(res.message || '删除失败', 'err');
  toast('已删除', 'ok');
  renderProducts();
}

function editSkus(id) {
  const p = CACHE.products.find((x) => x.id === id);
  if (!p) return;
  const sups = CACHE.suppliers.filter((s) => s.status === 'active');
  const rowHtml = (s) => `<tr data-row>
    <td><input class="input" data-f="name" value="${s ? escapeHtml(s.name) : ''}" placeholder="月卡"></td>
    <td><input class="input" data-f="faceValue" type="number" step="0.01" value="${s ? s.faceValue : ''}" style="width:76px"></td>
    <td><input class="input" data-f="price" type="number" step="0.01" value="${s ? s.price : ''}" style="width:76px"></td>
    <td><input class="input" data-f="cost" type="number" step="0.01" value="${s ? s.cost : ''}" style="width:76px"></td>
    <td><input class="input" data-f="stock" type="number" value="${s ? s.stock : 999}" style="width:70px"></td>
    <td><select class="select" data-f="supplierId" style="width:150px">${sups.map((x) => `<option value="${x.id}" ${s && s.supplierId === x.id ? 'selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}</select></td>
    <td><input class="input" data-f="supplierSku" value="${s ? escapeHtml(s.supplierSku || '') : ''}" placeholder="上游SKU" style="width:120px"></td>
    <td><button class="del" onclick="this.closest('tr').remove()">×</button></td>
  </tr>`;

  const body = `<div class="muted" style="font-size:12.5px;margin-bottom:14px">
      为每个套餐绑定「商品来源通道」与上游 SKU 编码，派单时会带上这些参数调用通道接口。加价率可参考：售价 ÷ 成本。
    </div>
    <div class="table-wrap"><table class="sku-editor">
      <thead><tr><th>套餐名</th><th>面值</th><th>售价</th><th>成本</th><th>库存</th><th>商品来源</th><th>上游SKU编码</th><th></th></tr></thead>
      <tbody id="skuRows">${(p.skus || []).map(rowHtml).join('')}</tbody>
    </table></div>
    <button class="btn btn-sm" style="margin-top:10px" onclick="addSkuRow()">＋ 添加套餐</button>
    <div class="hint" style="margin-top:12px">提示：留空的价格会按 0 处理；库存低于 100 会在概览页预警。</div>`;

  const foot = `<button class="btn" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" style="margin-left:auto" onclick="saveSkus('${id}')">保存套餐</button>`;
  openModal({ title: '套餐管理 · ' + p.name, body, foot, maxWidth: 1000 });
}

function addSkuRow() {
  const sups = CACHE.suppliers.filter((s) => s.status === 'active');
  const tr = document.createElement('tr');
  tr.setAttribute('data-row', '');
  tr.innerHTML = `<td><input class="input" data-f="name" placeholder="月卡"></td>
    <td><input class="input" data-f="faceValue" type="number" step="0.01" style="width:76px"></td>
    <td><input class="input" data-f="price" type="number" step="0.01" style="width:76px"></td>
    <td><input class="input" data-f="cost" type="number" step="0.01" style="width:76px"></td>
    <td><input class="input" data-f="stock" type="number" value="999" style="width:70px"></td>
    <td><select class="select" data-f="supplierId" style="width:150px">${sups.map((x) => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('')}</select></td>
    <td><input class="input" data-f="supplierSku" placeholder="上游SKU" style="width:120px"></td>
    <td><button class="del" onclick="this.closest('tr').remove()">×</button></td>`;
  document.getElementById('skuRows').appendChild(tr);
}

async function saveSkus(id) {
  const rows = [...document.querySelectorAll('#skuRows tr')];
  const skus = rows.map((tr, i) => {
    const g = (f) => { const e = tr.querySelector(`[data-f="${f}"]`); return e ? e.value : ''; };
    return {
      id: (CACHE.products.find((p) => p.id === id).skus[i] || {}).id,
      name: g('name') || '未命名套餐',
      faceValue: Number(g('faceValue')) || 0,
      price: Number(g('price')) || 0,
      cost: Number(g('cost')) || 0,
      stock: Number(g('stock')) || 0,
      supplierId: g('supplierId'),
      supplierSku: g('supplierSku'),
      status: 'active',
      sort: i + 1,
    };
  });
  if (!skus.length) return toast('至少保留一个套餐', 'err');
  const res = await api(`/api/admin/products/${id}/skus`, { method: 'POST', body: { skus } });
  if (!res.ok) return toast(res.message || '保存失败', 'err');
  toast(`已保存 ${skus.length} 个套餐`, 'ok');
  closeModal();
  renderProducts();
}

/* ============================================================
   4. 商品来源 / API 通道
   ============================================================ */
async function renderSuppliers() {
  const [res, prodRes] = await Promise.all([api('/api/admin/suppliers'), api('/api/admin/products')]);
  if (!res.ok) return;
  CACHE.suppliers = res.list;
  if (prodRes.ok) {
    CACHE.products = prodRes.list;
    CACHE.categories = prodRes.categories;
  }
  const cats = CACHE.categories;

  const cards = res.list.map((s) => {
    const modeTxt = { api: 'API 接口', mock: '本地模拟', manual: '人工工位' }[s.mode] || s.mode;
    const modeCls = { api: 'mode-api', mock: 'mode-mock', manual: 'mode-manual' }[s.mode] || 'mode-mock';
    const bound = CACHE.products.flatMap((p) => (p.skus || []).filter((k) => k.supplierId === s.id)).length;
    const catNames = (s.categories || []).map((c) => (cats.find((x) => x.id === c) || {}).name).filter(Boolean).join('、') || '未限定';
    return `<div class="sup-card">
      <div class="hd">
        <div class="ico">${s.mode === 'manual' ? '🧑‍💻' : '🔌'}</div>
        <div style="min-width:0;flex:1">
          <h4>${escapeHtml(s.name)}</h4>
          <div class="mono">${escapeHtml(s.code || '—')}</div>
        </div>
        <div style="text-align:right">
          <span class="badge-mode ${modeCls}">${modeTxt}</span>
          <div style="margin-top:5px">${s.status === 'active' ? '<span class="chip chip-ok">启用</span>' : '<span class="chip">停用</span>'}</div>
        </div>
      </div>
      <div class="kv"><span>接口地址</span><span class="mono" style="font-size:11px;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(s.apiUrl || '—')}</span></div>
      <div class="kv"><span>签名方式</span><span>${escapeHtml(s.signType)}</span></div>
      <div class="kv"><span>加价率 / 优先级</span><span>×${s.markup} / ${s.priority}</span></div>
      <div class="kv"><span>通道余额</span><span>¥${money(s.balance)}</span></div>
      <div class="kv"><span>支持分类</span><span>${escapeHtml(catNames)}</span></div>
      <div class="kv"><span>已绑定套餐</span><span>${bound} 个</span></div>
      ${s.mode !== 'manual' ? `<div class="kv"><span>模拟成功率 / 延时</span><span>${Math.round((s.mockSuccessRate || 0) * 100)}% / ${s.mockDelaySec}s</span></div>` : ''}
      ${s.remark ? `<div class="muted" style="font-size:12px;margin-top:10px;line-height:1.6">${escapeHtml(s.remark)}</div>` : ''}
      <div class="acts">
        <button class="btn btn-xs" onclick="testSupplier('${s.id}')">测试连通性</button>
        <button class="btn btn-xs" onclick="editSupplier('${s.id}')">配置</button>
        <button class="btn btn-xs btn-danger" style="margin-left:auto" onclick="delSupplier('${s.id}','${escapeHtml(s.name)}')">删除</button>
      </div>
    </div>`;
  }).join('');

  const sandbox = (await api('/api/admin/settings')).settings.sandboxMode;
  document.getElementById('pageBody').innerHTML = `
    <div class="toolbar">
      <div class="muted" style="font-size:13px">共 ${res.list.length} 个商品来源通道${sandbox ? ' · <span class="chip chip-warn">沙箱模式已开启，接口调用不会真实发出</span>' : ''}</div>
      <div class="spacer"></div>
      <button class="btn btn-sm btn-primary" onclick="editSupplier()">＋ 接入新通道</button>
    </div>
    <div class="sup-grid">${cards}</div>

    <div class="panel" style="margin-top:22px">
      <div class="panel-head"><h3>🔌 上游对接协议说明</h3><span class="chip">接入方按此实现 2 个接口即可</span></div>
      <div class="panel-body">
        <div class="form-grid">
          <div>
            <div class="form-sec" style="margin-top:0">① 下单接口 POST {apiUrl}{orderPath}</div>
            <div class="code-box">{
  "appId": "CY10086",
  "outTradeNo": "DC20260920A1B2C3",   // 本站订单号
  "skuCode": "IQIYI_GOLD_1M",          // 上游商品编码
  "account": "13800138000",            // 充值账号
  "quantity": "1",
  "notifyUrl": "https://你的域名/api/callback/supplier",
  "timestamp": "1789000000",
  "nonce": "a1b2c3d4e5f6",
  "sign": "大写HEX"
}
→ 返回
{ "code": 0, "msg": "ok",
  "data": { "supplierOrderNo": "SP123", "status": "PENDING" } }</div>
          </div>
          <div>
            <div class="form-sec" style="margin-top:0">② 查单接口 POST {apiUrl}{queryPath}</div>
            <div class="code-box">{
  "appId": "CY10086",
  "outTradeNo": "DC20260920A1B2C3",
  "timestamp": "1789000000",
  "nonce": "a1b2c3d4e5f6",
  "sign": "大写HEX"
}
→ 返回
{ "code": 0,
  "data": { "status": "SUCCESS", "supplierOrderNo": "SP123" } }</div>
            <div class="form-sec">③ 签名规则</div>
            <div class="code-box">1. 取所有非空参数（不含 sign），按 key 字典序升序
2. 拼成 k=v&amp;k=v&amp;...
3. md5：末尾追加 &amp;key={appSecret} 后取 MD5 大写
   hmac-sha256：直接对拼接串做 HMAC-SHA256（密钥=appSecret）取大写
4. code 非 0 视为业务失败，status 取值 PENDING/SUCCESS/FAILED</div>
          </div>
        </div>
        <div class="hint" style="margin-top:14px">回调地址：<b class="mono">POST /api/callback/supplier</b>，请求体含 outTradeNo、status、supplierOrderNo 即可，返回纯文本 SUCCESS。点击任意通道的「测试连通性」可看到实际会用到的参数与签名串，直接复制给上游开发即可核对。</div>
      </div>
    </div>`;
}

function editSupplier(id) {
  const s = id ? CACHE.suppliers.find((x) => x.id === id) : null;
  const cats = CACHE.categories;
  const body = `<div class="form-grid">
    <div class="form-sec full">基本信息</div>
    <div class="field full"><label>通道名称 <span class="req">*</span></label>
      <input class="input" id="sName" value="${s ? escapeHtml(s.name) : ''}" placeholder="例如：云充科技·视频会员通道"></div>
    <div class="field"><label>通道标识 code</label>
      <input class="input" id="sCode" value="${s ? escapeHtml(s.code || '') : ''}" placeholder="YUNCHONG_VIDEO"></div>
    <div class="field"><label>接入模式</label>
      <select class="select" id="sMode">
        <option value="api" ${s && s.mode === 'api' ? 'selected' : ''}>API 接口（真实对接）</option>
        <option value="mock" ${s && s.mode === 'mock' ? 'selected' : ''}>本地模拟（不请求真实接口）</option>
        <option value="manual" ${s && s.mode === 'manual' ? 'selected' : ''}>人工工位（后台手动完成）</option>
      </select></div>

    <div class="form-sec full">接口配置</div>
    <div class="field full"><label>接口基础地址 apiUrl</label>
      <input class="input" id="sApi" value="${s ? escapeHtml(s.apiUrl || '') : ''}" placeholder="https://api.供应商.com/openapi/v1"></div>
    <div class="field"><label>下单路径 orderPath</label>
      <input class="input" id="sOrder" value="${s ? escapeHtml(s.orderPath || '') : ''}" placeholder="/createOrder"></div>
    <div class="field"><label>查单路径 queryPath</label>
      <input class="input" id="sQuery" value="${s ? escapeHtml(s.queryPath || '') : ''}" placeholder="/queryOrder"></div>
    <div class="field"><label>请求方式</label>
      <select class="select" id="sMethod"><option value="POST" ${!s || s.method === 'POST' ? 'selected' : ''}>POST</option><option value="GET" ${s && s.method === 'GET' ? 'selected' : ''}>GET</option></select></div>
    <div class="field"><label>请求体格式</label>
      <select class="select" id="sCT">
        <option value="form" ${!s || s.contentType === 'form' ? 'selected' : ''}>form-urlencoded</option>
        <option value="json" ${s && s.contentType === 'json' ? 'selected' : ''}>JSON</option>
      </select></div>

    <div class="form-sec full">鉴权与签名</div>
    <div class="field"><label>AppId / 商户号</label>
      <input class="input" id="sAppId" value="${s ? escapeHtml(s.appId || '') : ''}"></div>
    <div class="field"><label>AppSecret / 密钥</label>
      <input class="input" id="sSecret" value="${s ? escapeHtml(s.appSecret || '') : ''}" placeholder="用于签名，请妥善保管"></div>
    <div class="field"><label>签名方式</label>
      <select class="select" id="sSign">
        <option value="md5" ${!s || s.signType === 'md5' ? 'selected' : ''}>MD5（k=v&…&key=secret）</option>
        <option value="hmac-sha256" ${s && s.signType === 'hmac-sha256' ? 'selected' : ''}>HMAC-SHA256</option>
        <option value="none" ${s && s.signType === 'none' ? 'selected' : ''}>不签名</option>
      </select></div>
    <div class="field"><label>异步回调地址 notifyUrl</label>
      <input class="input" id="sNotify" value="${s ? escapeHtml(s.notifyUrl || '') : ''}" placeholder="留空则使用站点默认回调"></div>

    <div class="form-sec full">供货策略</div>
    <div class="field"><label>加价率（售价系数）</label>
      <input class="input" id="sMarkup" type="number" step="0.01" value="${s ? s.markup : 1.25}"></div>
    <div class="field"><label>优先级（越大越优先）</label>
      <input class="input" id="sPriority" type="number" value="${s ? s.priority : 5}"></div>
    <div class="field"><label>通道余额（元）</label>
      <input class="input" id="sBalance" type="number" step="0.01" value="${s ? s.balance : 0}"></div>
    <div class="field"><label>超时（秒）</label>
      <input class="input" id="sTimeout" type="number" value="${s ? s.timeout : 15}"></div>
    <div class="field"><label>失败重试次数</label>
      <input class="input" id="sRetry" type="number" value="${s ? s.retry : 2}"></div>
    <div class="field"><label>沙箱模拟成功率</label>
      <input class="input" id="sRate" type="number" step="0.01" min="0" max="1" value="${s ? s.mockSuccessRate : 0.95}"></div>
    <div class="field"><label>模拟处理时长（秒）</label>
      <input class="input" id="sDelay" type="number" value="${s ? s.mockDelaySec : 5}"></div>
    <div class="field"><label>通道状态</label>
      <select class="select" id="sStatus">
        <option value="active" ${!s || s.status === 'active' ? 'selected' : ''}>启用</option>
        <option value="disabled" ${s && s.status !== 'active' ? 'selected' : ''}>停用</option>
      </select></div>

    <div class="form-sec full">支持的分类（不勾选表示不限）</div>
    <div class="field full row-flex" style="flex-wrap:wrap;gap:14px">
      ${cats.map((c) => `<label class="switch ${s && (s.categories || []).includes(c.id) ? 'on' : ''}" data-cat="${c.id}" onclick="this.classList.toggle('on')">
        <span class="track" style="width:32px;height:18px"></span><span>${c.icon} ${escapeHtml(c.name)}</span></label>`).join('')}
    </div>
    <div class="field full"><label>备注</label>
      <textarea class="textarea" id="sRemark" placeholder="例如：主通道，覆盖视频会员；高峰期偶发超时">${s ? escapeHtml(s.remark || '') : ''}</textarea></div>
  </div>`;

  const foot = `<button class="btn" onclick="closeModal()">取消</button>
    ${s ? `<button class="btn btn-ghost" onclick="testSupplier('${s.id}')">先测试一下</button>` : ''}
    <button class="btn btn-primary" style="margin-left:auto" onclick="saveSupplier(${s ? "'" + s.id + "'" : 'null'})">保存通道</button>`;
  openModal({ title: s ? '配置通道 · ' + s.name : '接入新通道', body, foot, maxWidth: 880 });
}

async function saveSupplier(id) {
  const v = (k) => document.getElementById(k).value.trim();
  if (!v('sName')) return toast('通道名称必填', 'err');
  const categories = [...document.querySelectorAll('[data-cat]')].filter((n) => n.classList.contains('on')).map((n) => n.dataset.cat);
  const payload = {
    id: id || undefined,
    name: v('sName'), code: v('sCode'), mode: v('sMode'), apiUrl: v('sApi'), orderPath: v('sOrder'), queryPath: v('sQuery'),
    method: v('sMethod'), contentType: v('sCT'), appId: v('sAppId'), appSecret: v('sSecret'), signType: v('sSign'),
    notifyUrl: v('sNotify'), markup: Number(v('sMarkup')) || 1, priority: Number(v('sPriority')) || 0,
    balance: Number(v('sBalance')) || 0, timeout: Number(v('sTimeout')) || 15, retry: Number(v('sRetry')) || 0,
    mockSuccessRate: Math.max(0, Math.min(1, Number(v('sRate')) || 0.95)), mockDelaySec: Number(v('sDelay')) || 5,
    status: v('sStatus'), categories, remark: v('sRemark'),
  };
  const res = await api('/api/admin/suppliers', { method: 'POST', body: { supplier: payload } });
  if (!res.ok) return toast(res.message || '保存失败', 'err');
  toast('通道已保存', 'ok');
  closeModal();
  renderSuppliers();
}

async function delSupplier(id, name) {
  if (!confirm(`确认删除通道「${name}」？`)) return;
  const res = await api('/api/admin/suppliers/' + id, { method: 'DELETE' });
  if (!res.ok) return toast(res.message || '删除失败', 'err');
  toast('已删除', 'ok');
  renderSuppliers();
}

async function testSupplier(id) {
  const res = await api(`/api/admin/suppliers/${id}/test`, { method: 'POST' });
  if (!res.ok) return toast(res.message || '测试失败', 'err');
  const r = res.result;
  const body = `
    <div class="row-flex" style="margin-bottom:16px">
      <span style="font-size:26px">${r.ok ? '✅' : '❌'}</span>
      <div><b style="font-size:15px">${escapeHtml(r.message)}</b>
      <div class="muted" style="font-size:12.5px">模式：${r.mode} · 耗时：${r.latency} ms${r.httpStatus ? ' · HTTP ' + r.httpStatus : ''}</div></div>
    </div>
    <div class="sec-title" style="margin-top:0"><span class="n">1</span>请求参数（实际会发送的内容）</div>
    <div class="code-box">${escapeHtml(JSON.stringify(r.params, null, 2))}</div>
    <div class="sec-title"><span class="n">2</span>签名原串（${escapeHtml(r.signType)}）</div>
    <div class="code-box">${escapeHtml(r.signString)}</div>
    ${r.response ? `<div class="sec-title"><span class="n">3</span>上游返回</div><div class="code-box">${escapeHtml(JSON.stringify(r.response, null, 2))}</div>` : ''}
    <div class="hint" style="margin-top:14px">把「请求参数」与「签名原串」发给上游对接人，可快速核对签名与字段是否一致。</div>`;
  const foot = `<button class="btn btn-sm" onclick="copyText(${JSON.stringify(JSON.stringify(r.params))},'请求参数已复制')">复制参数</button>
    <button class="btn btn-sm" onclick="copyText(${JSON.stringify(r.signString)},'签名原串已复制')">复制签名原串</button>
    <button class="btn btn-sm btn-primary" style="margin-left:auto" onclick="closeModal()">知道了</button>`;
  openModal({ title: '接口连通性测试结果', body, foot });
}

/* ============================================================
   5. 分类管理
   ============================================================ */
async function renderCategories() {
  const res = await api('/api/admin/products');
  if (!res.ok) return;
  CACHE.categories = res.categories;
  CACHE.products = res.list;

  const rows = res.categories.sort((a, b) => a.sort - b.sort).map((c) => {
    const n = res.list.filter((p) => p.catId === c.id).length;
    return `<tr>
      <td><div class="row-flex"><span style="width:32px;height:32px;border-radius:10px;display:grid;place-items:center;font-size:16px;background:${hexA(c.hue, 0.16)}">${c.icon}</span>
        <div><div style="font-weight:600">${escapeHtml(c.name)}</div><div class="muted" style="font-size:11.5px">${escapeHtml(c.desc || '')}</div></div></div></td>
      <td class="mono" style="font-size:12px">${c.id}</td>
      <td>${n} 款</td>
      <td>${c.sort}</td>
      <td>${c.status === 'active' ? '<span class="chip chip-ok">显示</span>' : '<span class="chip">隐藏</span>'}</td>
      <td style="text-align:right"><button class="btn btn-xs" onclick="editCategory('${c.id}')">编辑</button>
        <button class="btn btn-xs btn-danger" onclick="delCategory('${c.id}','${escapeHtml(c.name)}')">删除</button></td>
    </tr>`;
  }).join('');

  document.getElementById('pageBody').innerHTML = `
    <div class="toolbar"><div class="muted" style="font-size:13px">分类即前台的「服务专区」，共 ${res.categories.length} 个</div>
      <div class="spacer"></div><button class="btn btn-sm btn-primary" onclick="editCategory()">＋ 新增分类</button></div>
    <div class="panel"><div class="table-wrap"><table class="table">
      <thead><tr><th>分类</th><th>ID</th><th>商品数</th><th>排序</th><th>状态</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;
}

function editCategory(id) {
  const c = id ? CACHE.categories.find((x) => x.id === id) : null;
  const body = `<div class="form-grid">
    <div class="field"><label>分类名称 <span class="req">*</span></label><input class="input" id="cName" value="${c ? escapeHtml(c.name) : ''}" placeholder="例如：视频会员"></div>
    <div class="field"><label>图标 Emoji</label><input class="input" id="cIcon" value="${c ? escapeHtml(c.icon) : '📦'}"></div>
    <div class="field"><label>主题色</label><input class="input" id="cHue" value="${c ? c.hue : '#6d5efc'}"></div>
    <div class="field"><label>排序</label><input class="input" id="cSort" type="number" value="${c ? c.sort : CACHE.categories.length + 1}"></div>
    <div class="field full"><label>描述</label><input class="input" id="cDesc" value="${c ? escapeHtml(c.desc || '') : ''}" placeholder="例如：主流视频平台会员直充"></div>
    <div class="field full"><label>状态</label><select class="select" id="cStatus">
      <option value="active" ${!c || c.status === 'active' ? 'selected' : ''}>显示</option>
      <option value="disabled" ${c && c.status !== 'active' ? 'selected' : ''}>隐藏</option></select></div>
  </div>`;
  const foot = `<button class="btn" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" style="margin-left:auto" onclick="saveCategory(${c ? "'" + c.id + "'" : 'null'})">保存</button>`;
  openModal({ title: c ? '编辑分类' : '新增分类', body, foot, maxWidth: 620 });
}

async function saveCategory(id) {
  const v = (k) => document.getElementById(k).value.trim();
  if (!v('cName')) return toast('分类名称必填', 'err');
  const res = await api('/api/admin/categories', {
    method: 'POST',
    body: { category: { id: id || undefined, name: v('cName'), icon: v('cIcon'), hue: v('cHue'), sort: Number(v('cSort')) || 0, desc: v('cDesc'), status: v('cStatus') } },
  });
  if (!res.ok) return toast(res.message || '保存失败', 'err');
  toast('已保存', 'ok');
  closeModal();
  renderCategories();
}

async function delCategory(id, name) {
  if (!confirm(`确认删除分类「${name}」？`)) return;
  const res = await api('/api/admin/categories/' + id, { method: 'DELETE' });
  if (!res.ok) return toast(res.message || '删除失败', 'err');
  toast('已删除', 'ok');
  renderCategories();
}

/* ============================================================
   6. 支付配置
   ============================================================ */
/* ============================================================
   6. 支付配置（支付方式开关 + 网关参数 + 各收款通道参数）
   ============================================================ */
async function renderPay() {
  const res = await api('/api/admin/settings');
  if (!res.ok) return;
  CACHE.payMethods = res.payMethods;
  CACHE.payConfig = res.payConfig;
  CACHE.channelDefaults = res.channelDefaults || {};

  const cfg = res.payConfig || {};
  const ch = cfg.channels || {};
  const def = CACHE.channelDefaults;
  const usdt = Object.assign({}, def.usdt || {}, ch.usdt || {});
  const cc = Object.assign({}, def.creditcard || {}, ch.creditcard || {});
  const pp = Object.assign({}, def.paypal || {}, ch.paypal || {});
  const on = (code) => {
    const m = (res.payMethods || []).find((x) => x.code === code);
    return !!(m && m.enabled);
  };
  const offHint = (code) =>
    on(code) ? '' : '<div class="hint hint-warn" style="margin:-6px 0 12px">⚠️ 该方式当前已关闭，配置保存后仍需在上方开关中启用才会出现在前台收银台。</div>';

  document.getElementById('pageBody').innerHTML = `
    <div class="chart-row" style="grid-template-columns:1fr 1.2fr;margin-top:0">
      <div class="chart-card">
        <h3>支付方式开关</h3>
        <div class="sub">关闭后前台收银台不再展示该方式</div>
        <div id="pmList" style="display:grid;gap:12px">
          ${res.payMethods.map((m) => `<div class="row-flex" style="padding:11px 14px;background:var(--surface-2);border:1px solid var(--line);border-radius:11px">
            <span style="font-size:17px">${m.icon || '💳'}</span>
            <div><b style="font-size:13.5px">${escapeHtml(m.name)}</b>
              <div class="muted" style="font-size:11.5px">code: ${m.code}${m.kind ? ' · 类型 ' + m.kind : ''}</div></div>
            <label class="switch ${m.enabled ? 'on' : ''}" style="margin-left:auto" data-pm="${m.code}" onclick="this.classList.toggle('on');this.querySelector('span:last-child').textContent=this.classList.contains('on')?'已启用':'已关闭'">
              <span class="track"></span><span>${m.enabled ? '已启用' : '已关闭'}</span></label>
          </div>`).join('')}
        </div>
      </div>
      <div class="chart-card">
        <h3>支付网关参数（国内扫码通道）</h3>
        <div class="sub">沙箱模式开启时不会发起真实支付请求</div>
        <div class="form-grid">
          <div class="field"><label>网关类型</label>
            <select class="select" id="gType">
              <option value="epay" ${cfg.gateway === 'epay' ? 'selected' : ''}>易支付 / 彩虹聚合</option>
              <option value="alipay" ${cfg.gateway === 'alipay' ? 'selected' : ''}>支付宝当面付</option>
              <option value="wechat" ${cfg.gateway === 'wechat' ? 'selected' : ''}>微信 Native 支付</option>
            </select></div>
          <div class="field"><label>商户 ID</label><input class="input" id="gMid" value="${escapeHtml(cfg.merchantId || '')}"></div>
          <div class="field full"><label>网关接口地址</label><input class="input" id="gUrl" value="${escapeHtml(cfg.apiUrl || '')}"></div>
          <div class="field full"><label>商户密钥</label><input class="input" id="gKey" value="${escapeHtml(cfg.merchantKey || '')}" placeholder="用于 MD5 签名，请妥善保管"></div>
          <div class="field full"><label>异步通知地址</label><input class="input" id="gNotify" value="${escapeHtml(cfg.notifyUrl || '')}"></div>
          <div class="field full"><label class="switch ${cfg.sandboxMode !== false ? 'on' : ''}" id="gSandbox" onclick="this.classList.toggle('on')">
            <span class="track"></span><span>沙箱模式（当前为演示环境，建议保持开启）</span></label></div>
          <div class="field full"><label class="switch ${cfg.autoRefundOnFail ? 'on' : ''}" id="gAutoRefund" onclick="this.classList.toggle('on')">
            <span class="track"></span><span>充值失败自动退款（需网关支持退款接口）</span></label></div>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:18px">
      <div class="panel-head"><h3>🪙 USDT 收款通道设置</h3>
        <span class="chip ${on('usdt') ? 'chip-ok' : ''}">${on('usdt') ? '前台已启用' : '前台已关闭'}</span></div>
      <div class="panel-body">
        ${offHint('usdt')}
        <div class="form-grid">
          <div class="field"><label>收款网络</label>
            <select class="select" id="uNetwork">
              ${['TRC20', 'ERC20', 'BEP20', 'Polygon', 'Solana']
                .map((n) => `<option value="${n}" ${usdt.network === n ? 'selected' : ''}>${n}</option>`)
                .join('')}
            </select></div>
          <div class="field"><label>最小收款金额（USDT）</label>
            <input class="input" id="uMin" type="number" step="0.01" value="${Number(usdt.minAmount) || 0}"></div>
          <div class="field"><label>参考汇率（1 USDT = ? CNY）</label>
            <input class="input" id="uRate" type="number" step="0.0001" value="${Number(usdt.rate) || 0}"></div>
          <div class="field"><label>需要确认数</label>
            <input class="input" id="uConf" type="number" value="${Number(usdt.confirmations) || 1}"></div>
          <div class="field full"><label>收款地址 <span class="req">*</span></label>
            <input class="input mono" id="uAddr" value="${escapeHtml(usdt.address || '')}" placeholder="例如 TRC20 地址 TXxx…">
            <div class="hint">前台收银台会展示该地址与换算后的 USDT 金额，并要求买家回填转账的 TxID 以便对账。</div></div>
          <div class="field"><label>支付窗口（分钟）</label>
            <input class="input" id="uWindow" type="number" value="${Number(usdt.payWindowMinutes) || 30}"></div>
          <div class="field full"><label class="switch ${usdt.uniqueAmount !== false ? 'on' : ''}" id="uUnique" onclick="this.classList.toggle('on')">
            <span class="track"></span><span>金额加唯一尾数（便于链上对账，推荐开启）</span></label></div>
          <div class="field full"><label>二维码图片地址模板（可选）</label>
            <input class="input" id="uQr" value="${escapeHtml(usdt.qrTemplate || '')}" placeholder="留空则使用内置示意图；支持 {address} 与 {amount} 占位">
            <div class="hint">如需可被钱包真实扫描的二维码，填入你的二维码服务地址，例如 <span class="mono">https://你的域名/qr?text={address}</span>。</div></div>
          <div class="field full"><label>收款提示（展示在收银台）</label>
            <textarea class="textarea" id="uTips" placeholder="例如：请务必使用所选网络转账，跨链转账将导致资金丢失。">${escapeHtml(usdt.tips || '')}</textarea></div>
        </div>
      </div>
    </div>

    <div class="chart-row" style="margin-top:18px">
      <div class="chart-card">
        <h3>💳 国际信用卡通道</h3>
        <div class="sub">Stripe Checkout 托管收银台，或任意托管页</div>
        ${offHint('creditcard')}
        <div class="form-grid">
          <div class="field"><label>服务商</label>
            <select class="select" id="cProvider">
              <option value="stripe" ${cc.provider === 'stripe' ? 'selected' : ''}>Stripe Checkout</option>
              <option value="generic" ${cc.provider === 'generic' ? 'selected' : ''}>通用托管页</option>
            </select></div>
          <div class="field"><label>结算币种</label>
            <input class="input" id="cCur" value="${escapeHtml(cc.currency || 'USD')}"></div>
          <div class="field"><label>汇率（1 外币 = ? CNY）</label>
            <input class="input" id="cRate" type="number" step="0.0001" value="${Number(cc.rate) || 0}"></div>
          <div class="field"><label>账单显示名</label>
            <input class="input" id="cStmt" value="${escapeHtml(cc.statement || '')}"></div>
          <div class="field full"><label>Publishable Key（下发前台，可公开）</label>
            <input class="input mono" id="cPub" value="${escapeHtml(cc.publishableKey || '')}" placeholder="pk_live_…"></div>
          <div class="field full"><label>Secret Key（仅服务端使用，不会下发前台）</label>
            <input class="input mono" id="cSec" type="password" value="${escapeHtml(cc.secretKey || '')}" placeholder="sk_live_…">
            <div class="hint">留空表示未配置：前台仍可下单，但会提示联系客服完成收款。</div></div>
          <div class="field full"><label>Stripe 接口地址</label>
            <input class="input" id="cApi" value="${escapeHtml(cc.apiUrl || 'https://api.stripe.com/v1/checkout/sessions')}"></div>
          <div class="field full"><label>通用托管页地址（服务商选「通用托管页」时使用）</label>
            <input class="input" id="cGeneric" value="${escapeHtml(cc.genericPayUrl || '')}" placeholder="https://gateway.example/pay?amount={amount}&order={orderNo}&currency={currency}"></div>
        </div>
      </div>

      <div class="chart-card">
        <h3>🅿️ PayPal 通道</h3>
        <div class="sub">PayPal 标准收款 + IPN 异步通知</div>
        ${offHint('paypal')}
        <div class="form-grid">
          <div class="field full"><label>收款账号（PayPal 邮箱）<span class="req">*</span></label>
            <input class="input" id="ppEmail" value="${escapeHtml(pp.merchantEmail || '')}" placeholder="pay@example.com"></div>
          <div class="field"><label>模式</label>
            <select class="select" id="ppMode">
              <option value="sandbox" ${pp.mode !== 'live' ? 'selected' : ''}>Sandbox 沙箱</option>
              <option value="live" ${pp.mode === 'live' ? 'selected' : ''}>Live 生产</option>
            </select></div>
          <div class="field"><label>结算币种</label>
            <input class="input" id="ppCur" value="${escapeHtml(pp.currency || 'USD')}"></div>
          <div class="field"><label>汇率（1 外币 = ? CNY）</label>
            <input class="input" id="ppRate" type="number" step="0.0001" value="${Number(pp.rate) || 0}"></div>
          <div class="field full"><label>IPN 通知地址</label>
            <input class="input" id="ppIpn" value="${escapeHtml(pp.ipnUrl || '')}" placeholder="留空则使用站点默认回调 /api/callback/pay"></div>
          <div class="field full"><label>Client ID（可选）</label>
            <input class="input mono" id="ppClient" value="${escapeHtml(pp.clientId || '')}"></div>
          <div class="field full"><label>Client Secret（可选，仅服务端）</label>
            <input class="input mono" id="ppSecret" type="password" value="${escapeHtml(pp.clientSecret || '')}"></div>
        </div>
      </div>
    </div>

    <div class="toolbar" style="margin-top:18px;justify-content:flex-end">
      <button class="btn btn-primary" onclick="savePay()">保存支付配置</button>
    </div>`;
}

async function savePay() {
  const v = (k) => { const e = document.getElementById(k); return e ? e.value.trim() : ''; };
  const on = (k) => { const e = document.getElementById(k); return !!(e && e.classList.contains('on')); };
  const methods = CACHE.payMethods.map((m) => {
    const sw = document.querySelector(`[data-pm="${m.code}"]`);
    return Object.assign({}, m, { enabled: !!(sw && sw.classList.contains('on')) });
  });
  const res = await api('/api/admin/settings', {
    method: 'POST',
    body: {
      payMethods: methods,
      payConfig: {
        gateway: v('gType'),
        merchantId: v('gMid'),
        apiUrl: v('gUrl'),
        merchantKey: v('gKey'),
        notifyUrl: v('gNotify'),
        sandboxMode: on('gSandbox'),
        autoRefundOnFail: on('gAutoRefund'),
        channels: {
          usdt: {
            network: v('uNetwork'),
            address: v('uAddr'),
            rate: Number(v('uRate')) || 0,
            minAmount: Number(v('uMin')) || 0,
            confirmations: Number(v('uConf')) || 1,
            payWindowMinutes: Number(v('uWindow')) || 30,
            uniqueAmount: on('uUnique'),
            qrTemplate: v('uQr'),
            tips: v('uTips'),
          },
          creditcard: {
            provider: v('cProvider'),
            currency: v('cCur') || 'USD',
            rate: Number(v('cRate')) || 0,
            statement: v('cStmt'),
            publishableKey: v('cPub'),
            secretKey: v('cSec'),
            apiUrl: v('cApi'),
            genericPayUrl: v('cGeneric'),
          },
          paypal: {
            merchantEmail: v('ppEmail'),
            mode: v('ppMode'),
            currency: v('ppCur') || 'USD',
            rate: Number(v('ppRate')) || 0,
            ipnUrl: v('ppIpn'),
            clientId: v('ppClient'),
            clientSecret: v('ppSecret'),
          },
        },
      },
    },
  });
  if (!res.ok) return toast(res.message || '保存失败', 'err');
  toast('支付配置已保存', 'ok');
  renderPay();
}

/* ============================================================
   7. 系统设置
   ============================================================ */
async function renderSettings() {
  const res = await api('/api/admin/settings');
  if (!res.ok) return;
  const s = res.settings;
  const svc = s.service || {};
  const adm = (res.admins || [])[0] || {};
  const i18nCfg = s.i18n || {};
  const i18nInfo = res.i18nInfo || {};
  document.getElementById('pageBody').innerHTML = `
    <div class="chart-row" style="grid-template-columns:1.3fr 1fr;margin-top:0">
      <div class="chart-card">
        <h3>站点信息</h3>
        <div class="sub">展示在前台顶部、Hero 与页脚</div>
        <div class="form-grid">
          <div class="field"><label>站点名称</label><input class="input" id="stName" value="${escapeHtml(s.siteName || '')}"></div>
          <div class="field"><label>副标题</label><input class="input" id="stSub" value="${escapeHtml(s.siteSubtitle || '')}"></div>
          <div class="field full"><label>首页主标语</label><textarea class="textarea" id="stSlogan">${escapeHtml(s.slogan || '')}</textarea></div>
          <div class="field full"><label>顶部公告</label><textarea class="textarea" id="stNotice">${escapeHtml(s.notice || '')}</textarea></div>
        </div>
        <div class="form-sec">客服信息</div>
        <div class="form-grid">
          <div class="field"><label>Telegram</label><input class="input" id="stTg" value="${escapeHtml(svc.tg || '')}"></div>
          <div class="field"><label>微信</label><input class="input" id="stWx" value="${escapeHtml(svc.wechat || '')}"></div>
          <div class="field"><label>QQ</label><input class="input" id="stQq" value="${escapeHtml(svc.qq || '')}"></div>
          <div class="field"><label>工作时间</label><input class="input" id="stTime" value="${escapeHtml(svc.workTime || '')}"></div>
        </div>
      </div>

      <div class="chart-card">
        <h3>交易与运行参数</h3>
        <div class="sub">影响下单与派单行为</div>
        <div class="form-grid">
          <div class="field"><label>订单支付有效期（分钟）</label><input class="input" id="stExpire" type="number" value="${s.orderExpireMinutes || 30}"></div>
          <div class="field"><label>低库存预警阈值</label><input class="input" id="stMin" type="number" value="${s.minAmountAlert || 1000}"></div>
          <div class="field full"><label class="switch ${s.autoRecharge !== false ? 'on' : ''}" id="stAuto" onclick="this.classList.toggle('on')">
            <span class="track"></span><span>支付后自动派单到商品来源（关闭则需后台手动派单）</span></label></div>
          <div class="field full"><label class="switch ${s.sandboxMode ? 'on' : ''}" id="stSandbox" onclick="this.classList.toggle('on')">
            <span class="track"></span><span>全站沙箱模式（API 通道不发起真实请求，用于演示与联调）</span></label></div>
        </div>
        <button class="btn btn-primary" style="margin-top:6px" onclick="saveSettings()">保存设置</button>

        <div class="form-sec">管理员账号与登录密码</div>
        <div class="row-flex" style="padding:12px 14px;background:var(--surface-2);border:1px solid var(--line);border-radius:11px;margin-bottom:12px">
          <span style="width:32px;height:32px;border-radius:9px;display:grid;place-items:center;background:var(--brand-soft);font-size:15px">🔐</span>
          <div>
            <div><b style="font-size:13.5px">${escapeHtml(adm.name || adm.username || 'admin')}</b>
              <span class="chip" style="margin-left:6px">${escapeHtml(adm.username || 'admin')}</span></div>
            <div class="muted" style="font-size:11.5px">
              ${adm.hashed ? '口令已使用 scrypt 加盐哈希存储 ✓' : '⚠️ 口令尚未加密，请修改一次以完成升级'}
              ${adm.passwordUpdatedAt ? ' · 上次修改 ' + fmtTime(adm.passwordUpdatedAt) : ''}
              ${adm.lastLogin ? ' · 上次登录 ' + fmtTime(adm.lastLogin) : ''}
            </div>
          </div>
        </div>
        <button class="btn btn-sm btn-primary" onclick="openPasswordModal()">🔑 修改登录密码</button>
        <div class="hint" style="margin-top:10px">
          修改成功后，<b>其他已登录的会话会被强制下线</b>（当前会话保留）；操作会记入审计日志。若忘记密码，可在服务器执行
          <code class="mono">node tools/reset-admin.js &lt;新密码&gt;</code> 重置。
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:18px">
      <div class="panel-head"><h3>🌐 前台多语言</h3><span class="chip">默认英语 · 可按访问者 IP 自动切换</span></div>
      <div class="panel-body">
        <div class="form-grid">
          <div class="field"><label>默认语言</label>
            <select class="select" id="i18nDefault">
              <option value="en" ${i18nCfg.defaultLang !== 'zh' ? 'selected' : ''}>英语 English（默认）</option>
              <option value="zh" ${i18nCfg.defaultLang === 'zh' ? 'selected' : ''}>简体中文</option>
            </select></div>
          <div class="field"><label>IP 归属地查询接口</label>
            <input class="input" id="i18nApi" value="${escapeHtml(i18nCfg.ipApiUrl || 'http://ip-api.com/json/')}"></div>
          <div class="field"><label>查询超时（毫秒）</label>
            <input class="input" id="i18nTimeout" type="number" value="${Number(i18nCfg.timeoutMs) || 2500}"></div>
          <div class="field"><label>结果缓存（小时）</label>
            <input class="input" id="i18nCache" type="number" value="${Number(i18nCfg.cacheHours) || 6}"></div>
          <div class="field full"><label class="switch ${i18nCfg.enabled !== false ? 'on' : ''}" id="i18nEnabled" onclick="this.classList.toggle('on')">
            <span class="track"></span><span>启用前台多语言（关闭后所有访客固定使用默认语言）</span></label></div>
          <div class="field full"><label class="switch ${i18nCfg.autoByIp !== false ? 'on' : ''}" id="i18nByIp" onclick="this.classList.toggle('on')">
            <span class="track"></span><span>按访问者 IP 自动切换（中国 / 港澳台 → 中文，其余 → 英语）</span></label></div>
        </div>
        <div class="row-flex" style="margin-top:4px;flex-wrap:wrap;gap:10px">
          <button class="btn btn-sm btn-primary" onclick="saveSettings()">保存设置</button>
          <div class="spacer" style="flex:1"></div>
          <input class="input" id="i18nTestIp" placeholder="输入 IP 测试，例如 114.114.114.114" style="max-width:260px">
          <button class="btn btn-sm" onclick="testI18nIp()">测试识别</button>
        </div>
        <div class="hint" id="i18nTestOut">缓存状态：已缓存 ${(i18nInfo.cache || {}).size || 0} 个 IP（中文 ${
          (i18nInfo.cache || {}).zh || 0
        } / 英文 ${(i18nInfo.cache || {}).en || 0} / 未知 ${(i18nInfo.cache || {}).unknown || 0}，查询失败 ${
          (i18nInfo.cache || {}).failCount || 0
        } 次）</div>
      </div>
    </div>

    <div class="panel" style="margin-top:18px">
      <div class="panel-head"><h3>⚠️ 演示数据</h3></div>
      <div class="panel-body row-flex">
        <div><b>重置演示订单</b><div class="muted" style="font-size:12.5px">清空现有订单并重新生成一批近 7 天的演示订单，用于演示后台看板</div></div>
        <button class="btn btn-sm btn-danger" style="margin-left:auto" onclick="resetDemo()">重置订单数据</button>
      </div>
    </div>`;
}

async function saveSettings() {
  const v = (k) => { const e = document.getElementById(k); return e ? e.value.trim() : ''; };
  const on = (k) => { const e = document.getElementById(k); return !!(e && e.classList.contains('on')); };
  const body = {
    settings: {
      siteName: v('stName'), siteSubtitle: v('stSub'), slogan: v('stSlogan'), notice: v('stNotice'),
      service: { tg: v('stTg'), wechat: v('stWx'), qq: v('stQq'), workTime: v('stTime') },
      orderExpireMinutes: Number(v('stExpire')) || 30,
      minAmountAlert: Number(v('stMin')) || 1000,
      autoRecharge: on('stAuto'),
      sandboxMode: on('stSandbox'),
      i18n: {
        defaultLang: v('i18nDefault') || 'en',
        enabled: on('i18nEnabled'),
        autoByIp: on('i18nByIp'),
        ipApiUrl: v('i18nApi') || 'http://ip-api.com/json/',
        timeoutMs: Number(v('i18nTimeout')) || 2500,
        cacheHours: Number(v('i18nCache')) || 6,
      },
    },
  };
  const res = await api('/api/admin/settings', { method: 'POST', body });
  if (!res.ok) return toast(res.message || '保存失败', 'err');
  toast('设置已保存', 'ok');
  renderSettings();
}

/* ============================================================
   管理员密码修改（独立弹窗：二次确认 + 强度校验 + 明确报错）
   ============================================================ */
function openPasswordModal() {
  const body = `<div class="form-grid">
    <div class="field full"><label>当前密码 <span class="req">*</span></label>
      <input class="input" id="pwOld" type="password" autocomplete="current-password" placeholder="请输入当前登录密码"></div>
    <div class="field full"><label>新密码 <span class="req">*</span></label>
      <input class="input" id="pwNew" type="password" autocomplete="new-password" placeholder="至少 8 位，不含空格，不能是纯数字"></div>
    <div class="field full"><label>确认新密码 <span class="req">*</span></label>
      <input class="input" id="pwNew2" type="password" autocomplete="new-password" placeholder="请再输入一遍，避免打错后无法登录"></div>
    <div class="field full"><div class="hint" id="pwMsg">建议使用「字母 + 数字 + 符号」组合，长度 8-64 位。修改成功后其他登录会话会被强制下线。</div></div>
  </div>`;
  const foot = `<button class="btn" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" style="margin-left:auto" id="pwSubmit" onclick="submitPassword()">确认修改</button>`;
  openModal({
    title: '🔑 修改管理员登录密码',
    body,
    foot,
    maxWidth: 560,
    after: () => {
      document.getElementById('pwOld').focus();
      ['pwOld', 'pwNew', 'pwNew2'].forEach((id) => {
        document.getElementById(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPassword(); });
      });
    },
  });
}

async function submitPassword() {
  const v = (k) => { const e = document.getElementById(k); return e ? e.value : ''; };
  const msg = (txt, type) => {
    const el = document.getElementById('pwMsg');
    if (el) {
      el.textContent = txt;
      el.style.color = type === 'err' ? 'var(--danger)' : 'var(--text-3)';
    }
  };
  const oldPw = v('pwOld');
  const newPw = v('pwNew');
  const newPw2 = v('pwNew2');

  if (!oldPw) return msg('请填写当前密码', 'err');
  if (!newPw) return msg('请填写新密码', 'err');
  if (newPw.length < 8) return msg('新密码至少 8 位', 'err');
  if (newPw.length > 64) return msg('新密码最多 64 位', 'err');
  if (/\s/.test(newPw)) return msg('新密码不能包含空格', 'err');
  if (/^\d+$/.test(newPw)) return msg('新密码不能是纯数字', 'err');
  if (newPw === oldPw) return msg('新密码不能与当前密码相同', 'err');
  if (newPw !== newPw2) return msg('两次输入的新密码不一致，请重新核对', 'err');

  const btn = document.getElementById('pwSubmit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> 提交中';
  const res = await api('/api/admin/password', {
    method: 'POST',
    body: { oldPassword: oldPw, newPassword: newPw, confirmPassword: newPw2 },
  });
  btn.disabled = false;
  btn.textContent = '确认修改';
  if (!res.ok) return msg(res.message || '修改失败', 'err');
  closeModal();
  toast(res.message || '密码已更新', 'ok');
  renderSettings();
}

/** 语言识别自测：输入 IP 看会判定成哪种语言 */
async function testI18nIp() {
  const ip = (document.getElementById('i18nTestIp').value || '').trim();
  const out = document.getElementById('i18nTestOut');
  out.textContent = '识别中…';
  const res = await api('/api/admin/i18n/test' + (ip ? '?ip=' + encodeURIComponent(ip) : ''));
  if (!res.ok) { out.textContent = res.message || '测试失败'; return; }
  out.textContent = `IP ${res.ip} → 判定为 ${res.lang === 'zh' ? '中文' : '英语'}（依据：${res.source}${
    res.country ? '，国家码 ' + res.country : ''
  }）`;
}

async function resetDemo() {
  if (!confirm('将清空现有订单并重新生成演示数据，确认继续？')) return;
  const res = await api('/api/admin/reset-demo', { method: 'POST' });
  if (!res.ok) return toast(res.message || '操作失败', 'err');
  toast(`已重置，重新生成 ${res.count} 笔演示订单`, 'ok');
  go('overview');
}

/* ============================================================
   8. 操作日志
   ============================================================ */
async function renderLogs() {
  const res = await api('/api/admin/logs');
  if (!res.ok) return;
  const rows = res.list.map((l) => `<tr>
    <td class="mono" style="font-size:12px">${l.action}</td>
    <td>${escapeHtml(l.detail)}</td>
    <td><span class="chip">${escapeHtml(l.operator)}</span></td>
    <td class="muted" style="font-size:12.5px">${fmtTime(l.at)}</td>
  </tr>`).join('');
  document.getElementById('pageBody').innerHTML = `
    <div class="toolbar"><div class="muted" style="font-size:13px">记录后台登录、商品/通道变更、订单操作等关键行为，最多保留 800 条</div>
      <div class="spacer"></div><button class="btn btn-sm" onclick="renderLogs()">刷新</button></div>
    <div class="panel"><div class="table-wrap"><table class="table">
      <thead><tr><th style="width:170px">动作</th><th>详情</th><th style="width:110px">操作人</th><th style="width:170px">时间</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4"><div class="empty">暂无日志</div></td></tr>'}</tbody></table></div></div>`;
}

window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (PAGES[h] && h !== PAGE && !document.getElementById('appView').classList.contains('hide')) go(h);
});

boot();
