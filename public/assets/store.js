/* ============================================================
   前台商城逻辑：多语言 / 商品渲染 / 一屏下单 / 多方式收银台 / 订单跟踪
   ------------------------------------------------------------
   语言：默认英语，initI18n() 会先按浏览器语言即时渲染，再按 /api/locale
         （服务端依据访问者 IP）校正；用户手动切换后不再被覆盖。
   ============================================================ */

let STORE = { settings: {}, categories: [], payMethods: [], payInfo: {}, products: [] };
let state = {
  activeCat: 'all',
  keyword: '',
  product: null,
  skuId: '',
  qty: 1,
  payMethod: '',
  order: null,
  pay: null,
  view: 'form',
  pollTimer: null,
};
let liveTimer = null;

/* ---------------- 初始化 ---------------- */
async function boot() {
  // 先定语言，避免首屏中文闪现（默认英文）
  await initI18n();

  const res = await api('/api/store');
  if (!res.ok) {
    document.getElementById('prodGrid').innerHTML =
      '<div class="empty"><div class="big">😵</div>' + t('toast.offline') + '</div>';
    return;
  }
  STORE = res;
  state.payMethod = (STORE.payMethods[0] || {}).code || '';
  renderStaticText();
  renderStats();
  renderHubs();
  renderTabs();
  renderProducts();
  bindFaq();
  loadLive();
  liveTimer = setInterval(loadLive, 9000);

  // 语言变化后重渲染数据驱动的内容
  onLangChange(() => {
    renderStaticText();
    renderStats();
    renderHubs();
    renderTabs();
    renderProducts();
    loadLive();
    if (state.product && state.view !== 'form') renderModal();
  });
}

/** 站点名 / 副标题 / 标语 / 公告等由后台配置的文案 */
function renderStaticText() {
  const s = STORE.settings || {};
  const siteName = pick(s.siteName, s.siteNameEn);
  document.title = siteName + ' · ' + pick(s.siteSubtitle, s.siteSubtitleEn);
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v || '—'; };
  set('brandName', siteName);
  set('brandSub', pick(s.siteSubtitle, s.siteSubtitleEn));
  document.querySelectorAll('.fBrandName').forEach((el) => (el.textContent = siteName));

  const slogan = pick(s.slogan, s.sloganEn);
  set('slogan', slogan || t('slogan.default'));
  set('noticeText', pick(s.notice, s.noticeEn));

  const svc = s.service || {};
  set('cTg', svc.tg); set('cWx', svc.wechat); set('cQq', svc.qq); set('cTime', svc.workTime);
  set('footVer', 'v1.1.0' + (s.sandboxMode ? ' · ' + t('sys.sandbox') : ''));
}

function renderStats() {
  const orders = STORE.products.reduce((s, p) => s + (p.sales || 0), 0);
  document.getElementById('statOrders').textContent = orders > 10000 ? (orders / 10000).toFixed(1) + ' 万+' : orders + '+';
  document.getElementById('statGoods').textContent = STORE.products.length;
  document.getElementById('statRate').textContent = t('hero.stat.rateValue');
  document.getElementById('hubCount').textContent = t('hubs.count', STORE.categories.length, STORE.products.length);
  document.getElementById('prodSub').textContent =
    state.activeCat === 'all'
      ? t('products.all')
      : t((STORE.categories.find((c) => c.id === state.activeCat) || {}).name || '');
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
        <h3>${escapeHtml(pick(c.name, c.nameEn))}</h3>
        <p>${escapeHtml(pick(c.desc, c.descEn))} · ${t('hubs.goods', count)}</p>
        <div class="go">${t('hubs.enter')}</div>
      </div>`;
    })
    .join('');
}

function renderTabs() {
  const tabs = document.getElementById('catTabs');
  tabs.innerHTML =
    `<div class="cat-tab ${state.activeCat === 'all' ? 'on' : ''}" onclick="pickCat('all')">${escapeHtml(t('products.all'))}</div>` +
    STORE.categories
      .map((c) => `<div class="cat-tab ${state.activeCat === c.id ? 'on' : ''}" onclick="pickCat('${c.id}')">${c.icon} ${escapeHtml(pick(c.name, c.nameEn))}</div>`)
      .join('');
}

function pickCat(id) {
  state.activeCat = id;
  renderTabs();
  renderProducts();
  const name = id === 'all' ? t('products.all') : t((STORE.categories.find((c) => c.id === id) || {}).name || '');
  document.getElementById('prodSub').textContent = name;
  document.getElementById('products').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------------- 商品 ---------------- */
function visibleProducts() {
  const kw = state.keyword.trim().toLowerCase();
  return STORE.products.filter((p) => {
    if (state.activeCat !== 'all' && p.catId !== state.activeCat) return false;
    if (!kw) return true;
    const hay = [p.name, p.nameEn || '', p.subtitle || '', (p.tags || []).join(''), (p.skus || []).map((s) => s.name).join('')]
      .join(' ')
      .toLowerCase();
    return hay.includes(kw);
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
      const stock = (p.skus || []).reduce((n, s) => n + (s.stock || 0), 0);
      const soldOut = stock <= 0;
      const badge = soldOut ? t('products.soldOut') : pick(p.badge, p.badgeEn);
      const tags = (p.tags || []).map((tg) => `<span class="tag">${escapeHtml(t(tg))}</span>`).join('');
      return `<div class="prod-card">
        ${badge ? `<div class="badge">${escapeHtml(badge)}</div>` : ''}
        <div class="prod-top">
          <div class="prod-ico" style="background:${hexA(p.hue, 0.16)};border:1px solid ${hexA(p.hue, 0.32)}">${p.icon}</div>
          <div style="min-width:0">
            <h3>${escapeHtml(pick(p.name, p.nameEn))}</h3>
            <div class="sub">${escapeHtml(pick(p.subtitle, p.subtitleEn))}</div>
          </div>
        </div>
        <div class="prod-tags">${tags}
          <span class="tag">${escapeHtml(t('products.skuCount', (p.skus || []).length))}</span></div>
        <div class="prod-foot">
          <div>
            <div class="price"><small>¥</small>${money(p.minPrice)}${(p.skus || []).length > 1 ? '<small>' + t('products.from') + '</small>' : ''}</div>
            <div class="prod-sales">${escapeHtml(t('products.sold', p.sales || 0))}${soldOut ? ' · ' + t('products.noStock') : ' · ' + escapeHtml(t('products.stockLeft', stock))}</div>
          </div>
          ${
            soldOut
              ? `<button class="btn btn-sm" disabled style="opacity:.45;cursor:not-allowed">${escapeHtml(t('products.soldOut'))}</button>`
              : `<button class="btn btn-primary btn-sm" onclick="openOrder('${p.id}')">${escapeHtml(t('products.buy'))}</button>`
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
  if (!wrap) return;
  wrap.innerHTML = res.list
    .slice(0, 5)
    .map((o) => {
      const p = STORE.products.find((x) => x.id === o.productId) || {};
      return `<div class="live-item">
        <div class="ico" style="background:${hexA(p.hue || '#6d5efc', 0.16)}">${p.icon || '🎁'}</div>
        <div class="txt">
          <div><b>${escapeHtml(o.maskAccount)}</b> ${escapeHtml(t('live.bought'))} ${escapeHtml(pick(o.productName))} · ${escapeHtml(pick(o.skuName))}</div>
          <div>${fmtShort(o.createdAt)} · ${escapeHtml(statusLabel(o.status))}</div>
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
    toast(t('toast.soldOut'), 'err');
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
  root.innerHTML = shell.apply(null, viewParts());
  const mask = document.getElementById('mask');
  if (mask) mask.addEventListener('mousedown', (e) => { if (e.target === mask) closeModal(); });
  if (state.view === 'form') bindFormEvents();
  if (state.view === 'cashier') bindCashierEvents();
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
  const accLabel = pick(p.accountLabel) || t('modal.placeholder.account');

  const body = `<div class="order-body">
    <div class="order-left">
      <div class="order-prod">
        <div class="ico" style="background:${hexA(p.hue, 0.16)};border:1px solid ${hexA(p.hue, 0.32)}">${p.icon}</div>
        <div>
          <h3>${escapeHtml(pick(p.name, p.nameEn))}</h3>
          <div class="meta">${escapeHtml(pick(p.subtitle, p.subtitleEn))}</div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${(p.tags || []).map((tg) => `<span class="tag">${escapeHtml(t(tg))}</span>`).join('')}</div>
        </div>
      </div>
      ${
        p.notice
          ? `<div class="notice-box"><span class="ni">📋</span><div><b>${escapeHtml(t('modal.noticeTitle'))}</b><p>${escapeHtml(t(p.notice))}</p></div></div>`
          : ''
      }

      <div class="sec-title"><span class="n">1</span>${escapeHtml(t('modal.sec1'))}</div>
      <div class="sku-list" id="skuList">
        ${p.skus
          .map(
            (s) => `<div class="sku-item ${s.id === state.skuId ? 'on' : ''}" data-sku="${s.id}">
              <div class="radio"></div>
              <div class="info"><b>${escapeHtml(t(s.name))}</b><div>${s.faceValue > 0 && s.faceValue !== s.price ? '¥' + money(s.faceValue) + ' · ' : ''}${s.stock > 0 ? escapeHtml(t('products.stockLeft', s.stock)) : escapeHtml(t('products.soldOut'))}</div></div>
              <div class="p"><b>¥${money(s.price)}</b>${s.faceValue > 0 && s.faceValue !== s.price ? `<div>¥${money(s.faceValue)}</div>` : ''}</div>
            </div>`
          )
          .join('')}
      </div>

      <div class="sec-title"><span class="n">2</span>${escapeHtml(t('modal.sec2'))}</div>
      <div class="qty-row">
        <div class="stepper">
          <button type="button" data-qty="-1">−</button><span id="qtyVal">${state.qty}</span><button type="button" data-qty="1">+</button>
        </div>
        <span class="muted" style="font-size:12.5px">${escapeHtml(needAcc ? t('modal.qtyHint') : t('modal.qtyHintNone'))}</span>
      </div>
    </div>

    <div class="order-right">
      ${
        needAcc
          ? `<div class="sec-title" style="margin-top:0"><span class="n">3</span>${escapeHtml(t('modal.sec3', accLabel))}</div>
      <div class="field">
        <input class="input" id="accountInput" placeholder="${escapeHtml(t(p.accountPlaceholder || 'modal.placeholder.account'))}" autocomplete="off">
        <div class="hint">${escapeHtml(t(p.accountHint || ''))}</div>
        <div class="err hide" id="accountErr"></div>
      </div>
      ${
        p.needConfirm
          ? `<div class="field">
              <label>${escapeHtml(t('modal.confirmLabel'))}<span class="req">*</span></label>
              <input class="input" id="accountConfirm" placeholder="${escapeHtml(t('modal.confirmPh'))}" autocomplete="off">
            </div>`
          : ''
      }`
          : `<div class="sec-title" style="margin-top:0"><span class="n">3</span>${escapeHtml(t('modal.sec3none'))}</div>
      ${p.accountHint ? `<div class="field"><div class="hint" style="margin-bottom:0">💡 ${escapeHtml(t(p.accountHint))}</div></div>` : ''}`
      }
      <div class="field">
        <label>${escapeHtml(t('modal.contact'))}<span class="muted" style="font-weight:400">${escapeHtml(t('modal.contactOpt'))}</span></label>
        <input class="input" id="contactInput" placeholder="${escapeHtml(t('modal.contactPh'))}" autocomplete="off">
      </div>
      <div class="field">
        <label>${escapeHtml(t('modal.remark'))}<span class="muted" style="font-weight:400">${escapeHtml(t('modal.remarkOpt'))}</span></label>
        <input class="input" id="remarkInput" placeholder="${escapeHtml(t('modal.remarkPh'))}" maxlength="120">
      </div>

      <div class="sec-title"><span class="n">4</span>${escapeHtml(t('modal.pay'))}</div>
      <div class="pay-list" id="payList">
        ${STORE.payMethods
          .map(
            (m) => `<div class="pay-item ${m.code === state.payMethod ? 'on' : ''}" data-pay="${m.code}">
              <span class="ic">${m.icon || '💳'}</span>${escapeHtml(pick(m.name, m.nameEn))}
            </div>`
          )
          .join('')}
      </div>

      <div class="summary">
        <div class="row"><span>${escapeHtml(t('modal.amount'))}</span><span>¥${money(amount)}</span></div>
        <div class="row" id="feeRow" style="display:none"><span>${escapeHtml(t('modal.fee'))}</span><span>¥0</span></div>
        <div class="row total"><span>${escapeHtml(t('modal.total'))}</span><b>¥${money(amount)}</b></div>
      </div>
      <div class="trust">
        <span>${escapeHtml(t('modal.trust1'))}</span><span>${escapeHtml(t('modal.trust2'))}</span><span>${escapeHtml(t('modal.trust3'))}</span>
      </div>
    </div>
  </div>`;

  const foot = `<div class="modal-foot">
      <div style="font-size:12.5px;color:var(--text-3);line-height:1.5">
        ${needAcc ? t('modal.agree') : t('modal.agreeNone')}<br>
        ${escapeHtml(t('modal.expire', STORE.settings.orderExpireMinutes || 30))}
      </div>
      <div style="margin-left:auto;display:flex;align-items:center;gap:14px">
        <div style="text-align:right"><div style="font-size:11.5px;color:var(--text-3)">${escapeHtml(t('modal.total'))}</div>
        <div style="font-size:22px;font-weight:750;color:#ffb4a8;letter-spacing:-.6px">¥${money(amount)}</div></div>
        <button class="btn btn-primary btn-lg" id="submitOrder">${escapeHtml(t('modal.submit'))}</button>
      </div>
    </div>`;

  return [escapeHtml(t('modal.title')), body, foot];
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
  if (type === 'phone' && !/^1[3-9]\d{9}$/.test(v)) return t('手机号格式不正确，请检查后重试');
  if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return t('邮箱格式不正确，请检查后重试');
  if (type === 'uid' && !/^\d{4,}$/.test(v)) return 'UID: digits only';
  if (type === 'username' && !/^@?\w{2,}$/.test(v)) return t('用户名格式不正确，例如 @username');
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
      document.getElementById('accountErr').textContent = t('请填写充值账号');
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
      toast(t('toast.accountMismatch'), 'err');
      return;
    }
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> …';
  const res = await api('/api/orders', {
    method: 'POST',
    body: { skuId: state.skuId, account: account.trim(), accountConfirm: accountConfirm.trim(), contact, remark, payMethod: state.payMethod, quantity: state.qty },
  });
  btn.disabled = false;
  btn.textContent = t('modal.submit');
  if (!res.ok) {
    toast(t(res.message || 'toast.orderFail'), 'err');
    return;
  }
  state.order = res.order;
  state.pay = res.pay || {};
  state.view = 'cashier';
  renderModal();
  startPolling();
}

/* ---- 视图 2：收银台（按收款方式类型分派） ---- */
function cashierView() {
  const o = state.order;
  const pay = state.pay || {};
  const kind = pay.kind || o.payKind || 'redirect';
  if (kind === 'crypto') return cryptoCashier(o, pay);
  if (kind === 'redirect' && !pay.sandbox) return redirectCashier(o, pay);
  return mockCashier(o, pay);
}

/** 头部：订单摘要 */
function cashierInfoRows(o) {
  return `<div class="info-rows" style="margin-bottom:16px">
      <div class="r"><span class="k">${escapeHtml(t('cashier.product'))}</span><span class="v">${escapeHtml(pick(o.productName))} · ${escapeHtml(t(o.skuName))}</span></div>
      ${o.account
        ? `<div class="r"><span class="k">${escapeHtml(t('cashier.account'))}</span><span class="v"><b>${escapeHtml(o.account)}</b></span></div>`
        : `<div class="r"><span class="k">${escapeHtml(t('cashier.delivery'))}</span><span class="v">${escapeHtml(t('cashier.auto'))}</span></div>`}
    </div>`;
}

function orderNoRow(o) {
  return `<div class="oid">${escapeHtml(t('result.orderNo'))} <b>${o.no}</b>
      <button class="btn btn-xs btn-ghost" style="margin-left:6px" onclick="copyText('${o.no}','${escapeHtml(t('toast.copied'))}')">${escapeHtml(t('result.orderNo'))}</button>
    </div>`;
}

/** 2a. USDT 等加密货币：地址 + 网络 + 金额 + 交易哈希回填 */
function cryptoCashier(o, pay) {
  const u = pay.usdt || {};
  const cfg = (STORE.payInfo || {}).usdt || {};
  const address = u.address || cfg.address || '';
  const amount = u.amount || o.payForeignAmount || 0;
  const network = u.network || cfg.network || 'TRC20';
  const rate = u.rate || cfg.rate || 0;
  const memo = o.no;
  const tooSmall = !!u.tooSmall;
  const canPay = !!address && !tooSmall;

  const qr = (() => {
    const tpl = cfg.qrTemplate || '';
    if (tpl && address) {
      const src = tpl.replace(/\{address\}/g, encodeURIComponent(address)).replace(/\{amount\}/g, amount);
      return `<div class="qr"><img src="${escapeHtml(src)}" alt="USDT QR" style="width:100%;height:100%;border-radius:12px"></div>`;
    }
    return `<div class="qr">${qrSvg(address || o.no, 190)}</div>`;
  })();

  const body = `<div class="modal-body" style="padding:26px 24px">
    <div class="cashier">
      <div style="margin-bottom:6px;display:flex;justify-content:center;gap:8px;align-items:center">
        <span class="chip chip-brand">🪙 ${escapeHtml('USDT · ' + network)}</span>
        <span class="chip">${escapeHtml(t('cashier.created'))}</span>
      </div>
      ${canPay ? qr : ''}
      <div class="amt"><small>${escapeHtml(amount)}</small> USDT</div>
      ${rate ? `<div class="muted" style="font-size:12px;text-align:center">¥${money(o.amount)} · ${escapeHtml(t('usdt.rateUnit', money(rate)))}</div>` : ''}
      ${orderNoRow(o)}
      <div class="countdown" id="cdBox">⏳ ${escapeHtml(t('cashier.expire'))} <b id="cdText">--:--</b></div>

      <div style="max-width:460px;margin:22px auto 0;text-align:left">
        ${
          !address
            ? `<div class="card card-tight" style="background:rgba(244,63,94,.08);border-color:rgba(244,63,94,.3);margin-bottom:16px">
                <div style="font-size:12.5px;color:#ff8598;line-height:1.7">${escapeHtml(t('usdt.unconfigured'))}</div></div>`
            : ''
        }
        ${
          tooSmall
            ? `<div class="card card-tight" style="background:rgba(245,158,11,.08);border-color:rgba(245,158,11,.3);margin-bottom:16px">
                <div style="font-size:12.5px;color:#fbc65e;line-height:1.7">${escapeHtml(t('usdt.tooSmall', u.minAmount || 0))}</div></div>`
            : ''
        }

        <div class="usdt-fields">
          <div class="uf">
            <div class="k">${escapeHtml(t('usdt.network'))}</div>
            <div class="v"><span class="chip chip-brand">${escapeHtml(network)}</span></div>
          </div>
          <div class="uf">
            <div class="k">${escapeHtml(t('usdt.address'))}</div>
            <div class="v mono" style="word-break:break-all">${escapeHtml(address || '—')}
              ${address ? `<button class="btn btn-xs btn-ghost" onclick="copyText('${escapeHtml(address)}','${escapeHtml(t('usdt.copyAddress'))}')">⧉</button>` : ''}
            </div>
          </div>
          <div class="uf">
            <div class="k">${escapeHtml(t('usdt.amount'))}</div>
            <div class="v"><b>${escapeHtml(amount)} USDT</b>
              <button class="btn btn-xs btn-ghost" onclick="copyText('${escapeHtml(amount)}','${escapeHtml(t('usdt.copyAmount'))}')">⧉</button>
            </div>
          </div>
          <div class="uf">
            <div class="k">${escapeHtml(t('usdt.memo'))}</div>
            <div class="v mono">${escapeHtml(memo)}</div>
          </div>
        </div>
        <div class="hint" style="margin-top:10px">${escapeHtml(t('usdt.memoHint', memo))}</div>
        ${u.tips || cfg.tips ? `<div class="hint hint-warn" style="margin-top:6px">⚠️ ${escapeHtml(t(u.tips || cfg.tips))}</div>` : ''}

        <div class="field" style="margin-top:18px">
          <label>${escapeHtml(t('usdt.txid'))}<span class="req">*</span></label>
          <input class="input" id="txidInput" placeholder="${escapeHtml(t('usdt.txidPh'))}" autocomplete="off">
          <div class="hint">${escapeHtml(t('usdt.txidHint'))}</div>
        </div>

        ${
          pay.sandbox
            ? `<div class="card card-tight" style="background:rgba(245,158,11,.08);border-color:rgba(245,158,11,.28);margin-bottom:14px">
                <div style="font-size:12.5px;color:#fbc65e;line-height:1.7">${escapeHtml(t('cashier.sandboxText'))}</div></div>`
            : ''
        }
        <button class="btn btn-primary btn-block btn-lg" id="mockPay">${escapeHtml(pay.sandbox ? t('cashier.mockPay') : t('usdt.submit'))}</button>
      </div>
    </div>
  </div>`;

  const foot = `<div class="modal-foot">
      <div style="font-size:12.5px;color:var(--text-3)">${escapeHtml(t('cashier.autoNote'))}</div>
      <button class="btn btn-sm" style="margin-left:auto" onclick="closeModal()">${escapeHtml(t('cashier.later'))}</button>
    </div>`;
  return [escapeHtml(t('usdt.title')), body, foot];
}

/** 2b. 跳转型（信用卡 / PayPal / 网关）：给出外币金额与跳转按钮 */
function redirectCashier(o, pay) {
  const kindLabel = o.payMethod === 'paypal' ? t('pay.paypalTitle') : o.payMethod === 'creditcard' ? t('pay.cardTitle') : pick(o.payMethodName);
  const body = `<div class="modal-body" style="padding:28px 24px">
    <div class="cashier">
      <div style="margin-bottom:8px;display:flex;justify-content:center;gap:8px;align-items:center">
        <span class="chip chip-brand">${escapeHtml(kindLabel)}</span>
        <span class="chip">${escapeHtml(t('cashier.created'))}</span>
      </div>
      <div class="amt"><small>¥</small>${money(o.amount)}</div>
      ${
        o.payForeignAmount
          ? `<div class="muted" style="font-size:13px;text-align:center">${escapeHtml(t('pay.foreignAmount', o.payCurrency || 'USD'))}
             <b style="color:var(--text)">${escapeHtml(o.payForeignAmount)} ${escapeHtml(o.payCurrency || '')}</b>
             ${o.payRate ? ' · ' + escapeHtml(t('pay.rate')) + ' ' + money(o.payRate) : ''}</div>`
          : ''
      }
      ${orderNoRow(o)}
      <div class="countdown" id="cdBox">⏳ ${escapeHtml(t('cashier.expire'))} <b id="cdText">--:--</b></div>

      <div style="max-width:440px;margin:22px auto 0;text-align:left">
        ${cashierInfoRows(o)}
        <div class="card card-tight" style="background:rgba(109,94,252,.08);border-color:rgba(109,94,252,.28);margin-bottom:16px">
          <div style="font-size:12.5px;color:#b3a9ff;line-height:1.7">${escapeHtml(t('pay.redirectNote'))}</div>
        </div>
        ${
          pay.payUrl
            ? `<a class="btn btn-primary btn-block btn-lg" href="${escapeHtml(pay.payUrl)}">${escapeHtml(t('pay.redirect'))} →</a>`
            : `<div class="card card-tight" style="background:rgba(244,63,94,.08);border-color:rgba(244,63,94,.3)">
                <div style="font-size:12.5px;color:#ff8598;line-height:1.7">${escapeHtml(t('pay.unconfigured'))}</div></div>`
        }
        <div style="text-align:center;margin-top:12px">
          <span class="muted" style="font-size:12.5px">${escapeHtml(t('cashier.help', ((STORE.settings || {}).service || {}).tg || ''))}</span>
        </div>
      </div>
    </div>
  </div>`;

  const foot = `<div class="modal-foot">
      <div style="font-size:12.5px;color:var(--text-3)">${escapeHtml(t('cashier.autoNote'))}</div>
      <button class="btn btn-sm" style="margin-left:auto" onclick="closeModal()">${escapeHtml(t('cashier.later'))}</button>
    </div>`;
  return [escapeHtml(pay.sandbox ? t('cashier.title') : kindLabel), body, foot];
}

/** 2c. 本地模拟 / 二维码收银台（沙箱与国内扫码通道） */
function mockCashier(o, pay) {
  const pm = STORE.payMethods.find((m) => m.code === o.payMethod) || {};
  const body = `<div class="modal-body" style="padding:30px 24px">
    <div class="cashier">
      <div style="margin-bottom:6px;display:flex;justify-content:center;gap:8px;align-items:center">
        <span class="chip chip-brand">${pm.icon || '💳'} ${escapeHtml(pick(o.payMethodName, pm.nameEn))}</span>
        <span class="chip">${escapeHtml(t('cashier.created'))}</span>
      </div>
      <div class="qr">${qrSvg(o.payTradeNo || o.no, 190)}</div>
      <div class="amt"><small>¥</small>${money(o.amount)}</div>
      ${orderNoRow(o)}
      <div class="countdown" id="cdBox">⏳ ${escapeHtml(t('cashier.expire'))} <b id="cdText">--:--</b></div>
      <div style="max-width:420px;margin:22px auto 0;text-align:left">
        ${cashierInfoRows(o)}
        ${
          pay.sandbox
            ? `<div class="card card-tight" style="background:rgba(245,158,11,.08);border-color:rgba(245,158,11,.28);margin-bottom:16px">
                <div style="font-size:12.5px;color:#fbc65e;line-height:1.7"><b>${escapeHtml(t('cashier.sandboxTitle'))}</b>：${escapeHtml(t('cashier.sandboxText'))}</div>
              </div>`
            : ''
        }
        <button class="btn btn-primary btn-block btn-lg" id="mockPay">
          ${escapeHtml(pay.sandbox ? t('cashier.mockPay') : t('cashier.iPaid'))}
        </button>
        <div style="text-align:center;margin-top:12px">
          <span class="muted" style="font-size:12.5px">${escapeHtml(t('cashier.help', ((STORE.settings || {}).service || {}).tg || ''))}</span>
        </div>
      </div>
    </div>
  </div>`;

  const foot = `<div class="modal-foot">
      <div style="font-size:12.5px;color:var(--text-3)">${escapeHtml(t('cashier.autoNote'))}</div>
      <button class="btn btn-sm" style="margin-left:auto" onclick="closeModal()">${escapeHtml(t('cashier.later'))}</button>
    </div>`;
  return [escapeHtml(t('cashier.title')), body, foot];
}

/** 收银台事件绑定（倒计时 + 支付按钮 + 交易哈希输入框） */
function bindCashierEvents() {
  startCountdown();
  const tx = document.getElementById('txidInput');
  if (tx && state.order && state.order.payTxId) tx.value = state.order.payTxId;
  const mp = document.getElementById('mockPay');
  if (mp) mp.addEventListener('click', doPay);
}

function startCountdown() {
  const txt = document.getElementById('cdText');
  if (!txt || !state.order) return;
  const expireAt = state.order.expireAt;
  if (!expireAt) { txt.textContent = '--:--'; return; }
  const tick = () => {
    const left = new Date(expireAt).getTime() - Date.now();
    if (left <= 0) { txt.textContent = '00:00'; return; }
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    txt.textContent = m + ':' + String(s).padStart(2, '0');
  };
  tick();
  const timer = setInterval(() => {
    if (!document.getElementById('cdText')) return clearInterval(timer);
    tick();
  }, 1000);
}

async function doPay() {
  const btn = document.getElementById('mockPay');
  if (!state.order) return;
  const txEl = document.getElementById('txidInput');
  const txid = txEl ? txEl.value.trim() : '';
  const isCrypto = (state.pay && state.pay.kind) === 'crypto' || state.order.payKind === 'crypto';
  const sandbox = !!(state.pay && state.pay.sandbox);
  if (isCrypto && !sandbox && !txid) {
    toast(t('usdt.txidRequired'), 'err');
    if (txEl) txEl.focus();
    return;
  }
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> …';
  const res = await api('/api/orders/' + state.order.no + '/pay', { method: 'POST', body: txid ? { txid } : {} });
  if (!res.ok) { toast(t(res.message || 'toast.orderFail'), 'err'); btn.disabled = false; btn.textContent = t('usdt.submit'); return; }
  state.order = res.order;
  state.view = 'result';
  renderModal();
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
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
      toast(res.order.status === 'success' ? t('toast.success') : t('toast.failed'), res.order.status === 'success' ? 'ok' : 'err');
    }
    if (['success', 'failed', 'refunded', 'closed'].includes(res.order.status)) clearInterval(state.pollTimer);
  }, 2500);
}

/* ---- 视图 3：结果 ---- */
function resultInner() {
  const o = state.order;
  const iconMap = { success: '✅', failed: '⚠️', recharging: '🔄', paid: '💳', pending_payment: '⏳', refunded: '↩️', closed: '🚫' };
  const titleKey = {
    success: 'result.successTitle',
    failed: 'result.failedTitle',
    recharging: 'result.rechargingTitle',
    paid: 'result.paidTitle',
    pending_payment: 'result.pendingTitle',
    refunded: 'result.refundedTitle',
    closed: 'result.closedTitle',
  };
  const descKey = {
    success: 'result.successDesc',
    failed: 'result.failedDesc',
    recharging: 'result.rechargingDesc',
    paid: 'result.paidDesc',
    pending_payment: 'result.pendingDesc',
    refunded: 'result.refundedDesc',
    closed: 'result.closedDesc',
  };
  const logs = (o.logs || [])
    .slice()
    .reverse()
    .map((l) => {
      const cls = l.level === 'success' ? 'ok' : l.level === 'error' ? 'err' : l.level === 'warn' ? 'warn' : '';
      return `<div class="tl-item ${cls}"><div class="m">${escapeHtml(t(l.msg))}</div><div class="t">${fmtTime(l.t)}</div></div>`;
    })
    .join('');

  return `<div class="modal-body">
    <div class="result-head">
      <div class="big">${iconMap[o.status] || '📦'}</div>
      <h3>${escapeHtml(t(titleKey[o.status] || ''))}</h3>
      <p>${escapeHtml(t(descKey[o.status] || ''))}</p>
      ${o.status === 'recharging' ? `<div style="margin-top:14px"><span class="spin"></span> <span style="font-size:12.5px;color:var(--text-3);margin-left:6px">${escapeHtml(t('result.rechargingNote'))}</span></div>` : ''}
    </div>
    <div class="info-rows">
      <div class="r"><span class="k">${escapeHtml(t('result.orderNo'))}</span><span class="v"><b>${o.no}</b>
        <button class="btn btn-xs btn-ghost" onclick="copyText('${o.no}','${escapeHtml(t('toast.copied'))}')">⧉</button></span></div>
      <div class="r"><span class="k">${escapeHtml(t('result.product'))}</span><span class="v">${escapeHtml(pick(o.productName))} · ${escapeHtml(t(o.skuName))}</span></div>
      ${o.account ? `<div class="r"><span class="k">${escapeHtml(t('result.account'))}</span><span class="v"><b>${escapeHtml(o.account)}</b></span></div>` : `<div class="r"><span class="k">${escapeHtml(t('cashier.delivery'))}</span><span class="v">${escapeHtml(t('cashier.auto'))}</span></div>`}
      <div class="r"><span class="k">${escapeHtml(t('result.paid'))}</span><span class="v">¥${money(o.amount)}（${escapeHtml(pick(o.payMethodName))}）</span></div>
      ${o.payTxId ? `<div class="r"><span class="k">TxID</span><span class="v mono" style="word-break:break-all">${escapeHtml(o.payTxId)}</span></div>` : ''}
      <div class="r"><span class="k">${escapeHtml(t('result.supplier'))}</span><span class="v">${escapeHtml(pick(o.supplierName) || '—')}${o.supplierOrderNo ? ' · ' + escapeHtml(o.supplierOrderNo) : ''}</span></div>
      <div class="r"><span class="k">${escapeHtml(t('result.createdAt'))}</span><span class="v">${fmtTime(o.createdAt)}</span></div>
    </div>
    <div class="sec-title" style="margin-top:0"><span class="n">✓</span>${escapeHtml(t('result.timeline'))}</div>
    <div class="timeline">${logs}</div>
  </div>`;
}

function resultView() {
  const body = `<div id="resultHost">${resultInner()}</div>`;
  const foot = `<div class="modal-foot">
      <button class="btn" onclick="closeModal()">${escapeHtml(t('result.again'))}</button>
      <a class="btn btn-ghost" href="/query.html?kw=${encodeURIComponent(state.order.no)}">${escapeHtml(t('result.query'))}</a>
      <button class="btn btn-primary" style="margin-left:auto" onclick="openOrder('${state.product.id}')">${escapeHtml(t('result.rebuy'))}</button>
    </div>`;
  return [escapeHtml(t('result.timeline')), body, foot];
}

/* ---------------- FAQ ---------------- */
function bindFaq() {
  document.querySelectorAll('.faq-q').forEach((q) => {
    q.addEventListener('click', () => q.parentElement.classList.toggle('on'));
  });
}

boot();
