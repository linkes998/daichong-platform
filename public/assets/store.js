/* ============================================================
   前台商城逻辑：商品渲染 / 一屏下单 / 收银台 / 订单跟踪
   ============================================================ */

let STORE = { settings: {}, categories: [], payMethods: [], products: [] };
let state = {
  activeCat: 'all',
  keyword: '',
  product: null,
  skuId: '',
  qty: 1,
  payMethod: '',
  order: null,
  view: 'form',
  pollTimer: null,
};
let liveTimer = null;

/* ---------------- 初始化 ---------------- */
async function boot() {
  const res = await api('/api/store');
  if (!res.ok) {
    document.getElementById('prodGrid').innerHTML = '<div class="empty"><div class="big">😵</div>服务连接失败，请确认后端已启动</div>';
    return;
  }
  STORE = res;
  document.title = STORE.settings.siteName + ' · ' + STORE.settings.siteSubtitle;
  document.getElementById('brandSub').textContent = STORE.settings.siteSubtitle || '';
  document.getElementById('noticeText').textContent = STORE.settings.notice || '';
  document.getElementById('slogan').textContent = STORE.settings.slogan || '';
  const svc = STORE.settings.service || {};
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v || '—'; };
  set('cTg', svc.tg); set('cWx', svc.wechat); set('cQq', svc.qq); set('cTime', svc.workTime);
  document.getElementById('footVer').textContent = 'v1.0.0' + (STORE.settings.sandboxMode ? ' · 沙箱模式' : '');
  state.payMethod = (STORE.payMethods[0] || {}).code || '';

  renderStats();
  renderHubs();
  renderTabs();
  renderProducts();
  bindFaq();
  loadLive();
  liveTimer = setInterval(loadLive, 9000);
}

function renderStats() {
  const orders = STORE.products.reduce((s, p) => s + (p.sales || 0), 0);
  document.getElementById('statOrders').textContent = orders > 10000 ? (orders / 10000).toFixed(1) + ' 万+' : orders + '+';
  document.getElementById('statGoods').textContent = STORE.products.length + ' 款';
  document.getElementById('statRate').textContent = '1 分钟';
  document.getElementById('hubCount').textContent = STORE.categories.length + ' 个专区 · ' + STORE.products.length + ' 款商品';
}

/* ---------------- 专区 ---------------- */
function renderHubs() {
  const grid = document.getElementById('hubGrid');
  grid.innerHTML = STORE.categories
    .map((c, i) => {
      const count = STORE.products.filter((p) => p.catId === c.id).length;
      return `<div class="hub-card" onclick="pickCat('${c.id}')">
        <div class="glow" style="background:${c.hue}"></div>
        <div class="idx">0${i + 1} / ${String(STORE.categories.length).padStart(2, '0')}</div>
        <div class="ico">${c.icon}</div>
        <h3>${escapeHtml(c.name)}</h3>
        <p>${escapeHtml(c.desc || '')} · ${count} 款商品</p>
        <div class="go">进入专区 →</div>
      </div>`;
    })
    .join('');
}

function renderTabs() {
  const tabs = document.getElementById('catTabs');
  tabs.innerHTML =
    `<div class="cat-tab ${state.activeCat === 'all' ? 'on' : ''}" onclick="pickCat('all')">全部</div>` +
    STORE.categories
      .map((c) => `<div class="cat-tab ${state.activeCat === c.id ? 'on' : ''}" onclick="pickCat('${c.id}')">${c.icon} ${escapeHtml(c.name)}</div>`)
      .join('');
}

function pickCat(id) {
  state.activeCat = id;
  renderTabs();
  renderProducts();
  const name = id === 'all' ? '全部专区' : (STORE.categories.find((c) => c.id === id) || {}).name;
  document.getElementById('prodSub').textContent = name;
  document.getElementById('products').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------------- 商品 ---------------- */
function visibleProducts() {
  const kw = state.keyword.trim().toLowerCase();
  return STORE.products.filter((p) => {
    if (state.activeCat !== 'all' && p.catId !== state.activeCat) return false;
    if (!kw) return true;
    return (p.name + p.subtitle + (p.tags || []).join('') + (p.skus || []).map((s) => s.name).join('')).toLowerCase().includes(kw);
  });
}

function renderProducts() {
  const list = visibleProducts();
  const grid = document.getElementById('prodGrid');
  const empty = document.getElementById('prodEmpty');
  if (!list.length) {
    grid.innerHTML = '';
    empty.classList.remove('hide');
    return;
  }
  empty.classList.add('hide');
  grid.innerHTML = list
    .map((p) => {
      const cheapest = (p.skus || []).slice().sort((a, b) => a.price - b.price)[0] || {};
      const stock = (p.skus || []).reduce((n, s) => n + (s.stock || 0), 0);
      const soldOut = stock <= 0;
      const badge = soldOut ? '售罄' : p.badge;
      return `<div class="prod-card">
        ${badge ? `<div class="badge">${escapeHtml(badge)}</div>` : ''}
        <div class="prod-top">
          <div class="prod-ico" style="background:${hexA(p.hue, 0.16)};border:1px solid ${hexA(p.hue, 0.32)}">${p.icon}</div>
          <div style="min-width:0">
            <h3>${escapeHtml(p.name)}</h3>
            <div class="sub">${escapeHtml(p.subtitle || '')}</div>
          </div>
        </div>
        <div class="prod-tags">${(p.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
          <span class="tag">${(p.skus || []).length} 个套餐</span></div>
        <div class="prod-foot">
          <div>
            <div class="price"><small>¥</small>${money(p.minPrice)}${(p.skus || []).length > 1 ? '<small> 起</small>' : ''}</div>
            <div class="prod-sales">已售 ${p.sales || 0}${soldOut ? ' · 暂时缺货' : ' · 库存 ' + stock}</div>
          </div>
          ${
            soldOut
              ? '<button class="btn btn-sm" disabled style="opacity:.45;cursor:not-allowed">已售罄</button>'
              : `<button class="btn btn-primary btn-sm" onclick="openOrder('${p.id}')">立即购买</button>`
          }
        </div>
      </div>`;
    })
    .join('');
}

function doSearch() {
  state.keyword = document.getElementById('heroSearch').value;
  state.activeCat = 'all';
  renderTabs();
  renderProducts();
  document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('heroSearch');
  if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
});

/* ---------------- 实时动态 ---------------- */
async function loadLive() {
  const res = await api('/api/recent');
  if (!res.ok || !res.list) return;
  const wrap = document.getElementById('liveList');
  wrap.innerHTML = res.list
    .slice(0, 5)
    .map((o) => {
      const p = STORE.products.find((x) => x.id === o.productId) || {};
      const st = STATUS_MAP[o.status] || {};
      return `<div class="live-item">
        <div class="ico" style="background:${hexA(p.hue || '#6d5efc', 0.16)}">${p.icon || '🎁'}</div>
        <div class="txt">
          <div><b>${escapeHtml(o.maskAccount)}</b> 购买了 ${escapeHtml(o.productName)} · ${escapeHtml(o.skuName)}</div>
          <div>${fmtShort(o.createdAt)} · ${st.text || ''}</div>
        </div>
      </div>`;
    })
    .join('');
}

/* ---------------- 下单弹窗 ---------------- */
function openOrder(productId) {
  const p = STORE.products.find((x) => x.id === productId);
  if (!p) return;
  const skus = p.skus || [];
  if (!skus.some((s) => (s.stock || 0) > 0)) {
    toast('该商品暂时缺货，到货后可下单', 'err');
    return;
  }
  state.product = p;
  state.skuId = (skus.find((s) => (s.stock || 0) > 0) || skus[0] || {}).id || '';
  state.qty = 1;
  state.order = null;
  state.view = 'form';
  renderModal();
}

function closeModal() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
  document.getElementById('modalRoot').innerHTML = '';
}

function renderModal() {
  const p = state.product;
  const root = document.getElementById('modalRoot');
  const shell = (title, body, foot) => `<div class="modal-mask" id="mask">
      <div class="modal order-modal">
        <div class="modal-head">
          <span class="brand-mark" style="width:28px;height:28px;font-size:14px;border-radius:8px">⚡</span>
          <h3>${title}</h3>
          <button class="modal-close" onclick="closeModal()">×</button>
        </div>
        ${body}
        ${foot || ''}
      </div>
    </div>`;
  root.innerHTML = shell(...viewParts());
  const mask = document.getElementById('mask');
  mask.addEventListener('mousedown', (e) => { if (e.target === mask) closeModal(); });
  if (state.view === 'form') bindFormEvents();
  document.removeEventListener('keydown', escClose);
  document.addEventListener('keydown', escClose);
}

function escClose(e) { if (e.key === 'Escape') closeModal(); }

function viewParts() {
  if (state.view === 'cashier') return cashierView();
  if (state.view === 'result') return resultView();
  return formView();
}

/* ---- 视图 1：填写信息 ---- */
function formView() {
  const p = state.product;
  const sku = p.skus.find((s) => s.id === state.skuId) || p.skus[0] || {};
  const amount = (sku.price || 0) * state.qty;
  // accountType = 'none'：账号 / 卡密类商品（如邮箱账号），买家无需填写充值账号
  const needAcc = p.accountType !== 'none';

  const body = `<div class="order-body">
    <div class="order-left">
      <div class="order-prod">
        <div class="ico" style="background:${hexA(p.hue, 0.16)};border:1px solid ${hexA(p.hue, 0.32)}">${p.icon}</div>
        <div>
          <h3>${escapeHtml(p.name)}</h3>
          <div class="meta">${escapeHtml(p.subtitle || '')}</div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${(p.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
        </div>
      </div>
      ${
        p.notice
          ? `<div class="notice-box"><span class="ni">📋</span><div><b>商品说明与使用须知</b><p>${escapeHtml(p.notice)}</p></div></div>`
          : ''
      }

      <div class="sec-title"><span class="n">1</span>选择套餐</div>
      <div class="sku-list" id="skuList">
        ${p.skus
          .map(
            (s) => `<div class="sku-item ${s.id === state.skuId ? 'on' : ''}" data-sku="${s.id}">
              <div class="radio"></div>
              <div class="info"><b>${escapeHtml(s.name)}</b><div>${s.faceValue > 0 && s.faceValue !== s.price ? '面值 ¥' + money(s.faceValue) + ' · ' : ''}${s.stock > 0 ? '库存 ' + s.stock : '已售罄'}</div></div>
              <div class="p"><b>¥${money(s.price)}</b>${s.faceValue > 0 && s.faceValue !== s.price ? `<div>¥${money(s.faceValue)}</div>` : ''}</div>
            </div>`
          )
          .join('')}
      </div>

      <div class="sec-title"><span class="n">2</span>购买数量</div>
      <div class="qty-row">
        <div class="stepper">
          <button type="button" data-qty="-1">−</button><span id="qtyVal">${state.qty}</span><button type="button" data-qty="1">+</button>
        </div>
        <span class="muted" style="font-size:12.5px">${needAcc ? '单笔最多 10 份，多份将连续充值到同一账号' : '单笔最多 10 份，多份为独立账号，将分别发放'}</span>
      </div>
    </div>

    <div class="order-right">
      ${
        needAcc
          ? `<div class="sec-title" style="margin-top:0"><span class="n">3</span>填写${escapeHtml(p.accountLabel || '充值账号')}</div>
      <div class="field">
        <input class="input" id="accountInput" placeholder="${escapeHtml(p.accountPlaceholder || '')}" autocomplete="off">
        <div class="hint">${escapeHtml(p.accountHint || '')}</div>
        <div class="err hide" id="accountErr"></div>
      </div>
      ${
        p.needConfirm
          ? `<div class="field">
              <label>再次确认账号<span class="req">*</span></label>
              <input class="input" id="accountConfirm" placeholder="请重复输入一遍，防止填错" autocomplete="off">
            </div>`
          : ''
      }`
          : `<div class="sec-title" style="margin-top:0"><span class="n">3</span>订单信息</div>
      ${p.accountHint ? `<div class="field"><div class="hint" style="margin-bottom:0">💡 ${escapeHtml(p.accountHint)}</div></div>` : ''}`
      }
      <div class="field">
        <label>联系方式<span class="muted" style="font-weight:400">（选填，便于异常时联系你）</span></label>
        <input class="input" id="contactInput" placeholder="手机号 / 邮箱 / Telegram" autocomplete="off">
      </div>
      <div class="field">
        <label>订单备注<span class="muted" style="font-weight:400">（选填）</span></label>
        <input class="input" id="remarkInput" placeholder="例如：不同账号请分开下单" maxlength="120">
      </div>

      <div class="sec-title"><span class="n">4</span>支付方式</div>
      <div class="pay-list" id="payList">
        ${STORE.payMethods
          .map(
            (m) => `<div class="pay-item ${m.code === state.payMethod ? 'on' : ''}" data-pay="${m.code}">
              <span class="ic">${m.icon || '💳'}</span>${escapeHtml(m.name)}
            </div>`
          )
          .join('')}
      </div>

      <div class="summary">
        <div class="row"><span>商品金额</span><span>¥${money(amount)}</span></div>
        <div class="row" id="feeRow" style="display:none"><span>手续费</span><span>¥0</span></div>
        <div class="row total"><span>应付金额</span><b>¥${money(amount)}</b></div>
      </div>
      <div class="trust">
        <span>🔒 无需密码</span><span>⚡ 自动充值</span><span>↩️ 失败退款</span>
      </div>
    </div>
  </div>`;

  const foot = `<div class="modal-foot">
      <div style="font-size:12.5px;color:var(--text-3);line-height:1.5">
        ${
          needAcc
            ? `提交即表示你已核对充值账号 <b style="color:var(--danger)">填写错误无法退款</b><br>`
            : `虚拟商品 <b style="color:var(--danger)">一经发放不支持退款</b>，请确认需求后再下单<br>`
        }
        订单有效期 ${STORE.settings.orderExpireMinutes || 30} 分钟
      </div>
      <div style="margin-left:auto;display:flex;align-items:center;gap:14px">
        <div style="text-align:right"><div style="font-size:11.5px;color:var(--text-3)">应付金额</div>
        <div style="font-size:22px;font-weight:750;color:#ffb4a8;letter-spacing:-.6px">¥${money(amount)}</div></div>
        <button class="btn btn-primary btn-lg" id="submitOrder">去支付</button>
      </div>
    </div>`;

  return ['确认订单信息', body, foot];
}

function bindFormEvents() {
  const p = state.product;
  document.querySelectorAll('[data-sku]').forEach((node) => {
    node.addEventListener('click', () => {
      state.skuId = node.getAttribute('data-sku');
      renderModal();
    });
  });
  document.querySelectorAll('[data-qty]').forEach((node) => {
    node.addEventListener('click', () => {
      const d = Number(node.getAttribute('data-qty'));
      state.qty = Math.max(1, Math.min(10, state.qty + d));
      renderModal();
    });
  });
  document.querySelectorAll('[data-pay]').forEach((node) => {
    node.addEventListener('click', () => {
      state.payMethod = node.getAttribute('data-pay');
      renderModal();
    });
  });

  const acc = document.getElementById('accountInput');
  const accErr = document.getElementById('accountErr');
  if (acc) {
    acc.addEventListener('input', () => {
      const msg = checkAccount(p.accountType, acc.value.trim());
      if (acc.value && msg) { accErr.textContent = msg; accErr.classList.remove('hide'); acc.style.borderColor = 'var(--danger)'; }
      else { accErr.classList.add('hide'); acc.style.borderColor = ''; }
    });
    acc.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitOrder(); });
  }
  const btn = document.getElementById('submitOrder');
  if (btn) btn.addEventListener('click', submitOrder);
  setTimeout(() => acc && acc.focus(), 120);
}

function checkAccount(type, v) {
  if (!v) return '';
  if (type === 'phone' && !/^1[3-9]\d{9}$/.test(v)) return '手机号格式看起来不对，请检查（应为 11 位数字）';
  if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return '邮箱格式看起来不对';
  if (type === 'uid' && !/^\d{4,}$/.test(v)) return 'UID 应为纯数字';
  if (type === 'username' && !/^@?\w{2,}$/.test(v)) return '用户名格式不对，例如 @username';
  return '';
}

async function submitOrder() {
  const p = state.product;
  const btn = document.getElementById('submitOrder');
  const needAcc = p.accountType !== 'none';
  const account = (document.getElementById('accountInput') || {}).value || '';
  const accountConfirm = (document.getElementById('accountConfirm') || {}).value || '';
  const contact = (document.getElementById('contactInput') || {}).value || '';
  const remark = (document.getElementById('remarkInput') || {}).value || '';

  if (needAcc) {
    if (!account.trim()) {
      document.getElementById('accountInput').style.borderColor = 'var(--danger)';
      document.getElementById('accountErr').textContent = '请填写充值账号';
      document.getElementById('accountErr').classList.remove('hide');
      return;
    }
    const fmtErr = checkAccount(p.accountType, account.trim());
    if (fmtErr) {
      document.getElementById('accountErr').textContent = fmtErr;
      document.getElementById('accountErr').classList.remove('hide');
      document.getElementById('accountInput').style.borderColor = 'var(--danger)';
      return;
    }
    if (p.needConfirm && account.trim() !== accountConfirm.trim()) {
      toast('两次填写的充值账号不一致，请核对', 'err');
      return;
    }
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> 提交中';
  const res = await api('/api/orders', {
    method: 'POST',
    body: { skuId: state.skuId, account: account.trim(), accountConfirm: accountConfirm.trim(), contact, remark, payMethod: state.payMethod, quantity: state.qty },
  });
  btn.disabled = false;
  btn.textContent = '去支付';
  if (!res.ok) {
    toast(res.message || '下单失败', 'err');
    return;
  }
  state.order = res.order;
  state.pay = res.pay;
  state.view = 'cashier';
  renderModal();
  startPolling();
}

/* ---- 视图 2：收银台 ---- */
function cashierView() {
  const o = state.order;
  const pm = STORE.payMethods.find((m) => m.code === o.payMethod) || {};
  const body = `<div class="modal-body" style="padding:30px 24px">
    <div class="cashier">
      <div style="margin-bottom:6px;display:flex;justify-content:center;gap:8px;align-items:center">
        <span class="chip chip-brand">${pm.icon || '💳'} ${escapeHtml(o.payMethodName)}</span>
        <span class="chip">订单已创建</span>
      </div>
      <div class="qr">${qrSvg(o.payTradeNo || o.no, 190)}</div>
      <div class="amt"><small>¥</small>${money(o.amount)}</div>
      <div class="oid">订单号 <b id="cashierOrderNo">${o.no}</b>
        <button class="btn btn-xs btn-ghost" style="margin-left:6px" onclick="copyText('${o.no}','订单号已复制')">复制</button>
      </div>
      <div class="countdown" id="cdBox">⏳ 剩余支付时间 <b id="cdText">--:--</b></div>
      <div style="max-width:420px;margin:22px auto 0;text-align:left">
        <div class="info-rows" style="margin-bottom:16px">
          <div class="r"><span class="k">充值商品</span><span class="v">${escapeHtml(o.productName)} · ${escapeHtml(o.skuName)}</span></div>
          ${
            o.account
              ? `<div class="r"><span class="k">充值账号</span><span class="v"><b>${escapeHtml(o.account)}</b></span></div>`
              : '<div class="r"><span class="k">发货方式</span><span class="v">自动发货（免填账号）</span></div>'
          }
        </div>
        ${
          state.pay && state.pay.sandbox
            ? `<div class="card card-tight" style="background:rgba(245,158,11,.08);border-color:rgba(245,158,11,.28);margin-bottom:16px">
                <div style="font-size:12.5px;color:#fbc65e;line-height:1.7">
                  当前为<b>沙箱演示支付</b>：二维码不可真实支付。点击下方按钮即可模拟支付成功，
                  系统会立刻触发自动充值并展示完整链路。
                </div>
              </div>`
            : ''
        }
        <button class="btn btn-primary btn-block btn-lg" id="mockPay">
          ${state.pay && state.pay.sandbox ? '✅ 模拟支付成功（演示）' : '我已支付完成'}
        </button>
        <div style="text-align:center;margin-top:12px">
          <span class="muted" style="font-size:12.5px">支付遇到问题？联系客服 ${escapeHtml((STORE.settings.service || {}).tg || '')}</span>
        </div>
      </div>
    </div>
  </div>`;

  const foot = `<div class="modal-foot">
      <div style="font-size:12.5px;color:var(--text-3)">支付完成后系统自动充值，页面会自动刷新状态</div>
      <button class="btn btn-sm" style="margin-left:auto" onclick="closeModal()">稍后再看（订单号已可在查询页找回）</button>
    </div>`;
  return ['扫码支付', body, foot];
}

function startCountdown() {
  const box = document.getElementById('cdBox');
  const txt = document.getElementById('cdText');
  if (!box || !txt || !state.order || !state.order.expireAt) return;
  const tick = () => {
    const left = new Date(state.order.expireAt).getTime() - Date.now();
    if (left <= 0) { txt.textContent = '已过期'; return; }
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    txt.textContent = m + ':' + String(s).padStart(2, '0');
  };
  tick();
  const t = setInterval(() => {
    if (!document.getElementById('cdText')) return clearInterval(t);
    tick();
  }, 1000);
}

async function doPay() {
  const btn = document.getElementById('mockPay');
  if (!state.order) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> 确认支付中';
  const res = await api('/api/orders/' + state.order.no + '/pay', { method: 'POST' });
  if (!res.ok) { toast(res.message || '支付确认失败', 'err'); btn.disabled = false; btn.textContent = '重试'; return; }
  state.order = res.order;
  state.view = 'result';
  renderModal();
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  setTimeout(startCountdown, 60);
  const mp = document.getElementById('mockPay');
  if (mp) mp.addEventListener('click', doPay);
  state.pollTimer = setInterval(async () => {
    if (!state.order) return;
    const res = await api('/api/orders/' + state.order.no);
    if (!res.ok) return;
    const prev = state.order.status;
    state.order = res.order;
    if (state.view === 'result') {
      const host = document.getElementById('resultHost');
      if (host) host.innerHTML = resultInner();
    }
    if (prev !== res.order.status && ['success', 'failed'].includes(res.order.status)) {
      clearInterval(state.pollTimer);
      toast(res.order.status === 'success' ? '充值成功，已到账！' : '充值失败，请联系客服处理', res.order.status === 'success' ? 'ok' : 'err');
    }
    if (['success', 'failed', 'refunded', 'closed'].includes(res.order.status)) clearInterval(state.pollTimer);
  }, 2500);
}

/* ---- 视图 3：结果 ---- */
function resultInner() {
  const o = state.order;
  const st = STATUS_MAP[o.status] || {};
  const iconMap = { success: '✅', failed: '⚠️', recharging: '🔄', paid: '💳', pending_payment: '⏳', refunded: '↩️', closed: '🚫' };
  const titleMap = {
    success: '充值成功，已到账',
    failed: '充值失败',
    recharging: '上游处理中，请稍候',
    paid: '已支付，正在派单',
    pending_payment: '等待支付',
    refunded: '已退款',
    closed: '订单已关闭',
  };
  const descMap = {
    success: '权益已发放至充值账号，请登录对应平台查看。感谢你的信任。',
    failed: '上游返回失败，我们已记录。请联系客服并提供订单号，可安排补发或退款。',
    recharging: '正在对接上游通道充值，通常 1-5 分钟完成，页面会自动更新。',
    paid: '支付已确认，系统正在提交上游通道。',
    pending_payment: '订单尚未支付。',
    refunded: '款项已原路退回。',
    closed: '订单已关闭。',
  };
  const logs = (o.logs || [])
    .slice()
    .reverse()
    .map((l) => {
      const cls = l.level === 'success' ? 'ok' : l.level === 'error' ? 'err' : l.level === 'warn' ? 'warn' : '';
      return `<div class="tl-item ${cls}"><div class="m">${escapeHtml(l.msg)}</div><div class="t">${fmtTime(l.t)}</div></div>`;
    })
    .join('');

  return `<div class="modal-body">
    <div class="result-head">
      <div class="big">${iconMap[o.status] || '📦'}</div>
      <h3>${titleMap[o.status] || o.statusText}</h3>
      <p>${descMap[o.status] || ''}</p>
      ${o.status === 'recharging' ? '<div style="margin-top:14px"><span class="spin"></span> <span style="font-size:12.5px;color:var(--text-3);margin-left:6px">正在向商品来源下发充值指令…</span></div>' : ''}
    </div>
    <div class="info-rows">
      <div class="r"><span class="k">订单号</span><span class="v"><b>${o.no}</b>
        <button class="btn btn-xs btn-ghost" onclick="copyText('${o.no}','订单号已复制')">复制</button></span></div>
      <div class="r"><span class="k">商品</span><span class="v">${escapeHtml(o.productName)} · ${escapeHtml(o.skuName)}</span></div>
      <div class="r"><span class="k">充值账号</span><span class="v"><b>${escapeHtml(o.account)}</b></span></div>
      <div class="r"><span class="k">实付金额</span><span class="v">¥${money(o.amount)}（${escapeHtml(o.payMethodName)}）</span></div>
      <div class="r"><span class="k">商品来源</span><span class="v">${escapeHtml(o.supplierName || '—')}${o.supplierOrderNo ? ' · 上游单号 ' + escapeHtml(o.supplierOrderNo) : ''}</span></div>
      <div class="r"><span class="k">下单时间</span><span class="v">${fmtTime(o.createdAt)}</span></div>
    </div>
    <div class="sec-title" style="margin-top:0"><span class="n">✓</span>处理进度</div>
    <div class="timeline">${logs}</div>
  </div>`;
}

function resultView() {
  const body = `<div id="resultHost">${resultInner()}</div>`;
  const foot = `<div class="modal-foot">
      <button class="btn" onclick="closeModal()">继续逛逛</button>
      <a class="btn btn-ghost" href="/query.html?kw=${encodeURIComponent(state.order.no)}">订单查询页</a>
      <button class="btn btn-primary" style="margin-left:auto" onclick="openOrder('${state.product.id}')">再买一单</button>
    </div>`;
  return ['订单结果', body, foot];
}

/* ---------------- FAQ ---------------- */
function bindFaq() {
  document.querySelectorAll('.faq-q').forEach((q) => {
    q.addEventListener('click', () => q.parentElement.classList.toggle('on'));
  });
}

boot();
