/* 订单查询页（多语言） */

async function search() {
  const kw = document.getElementById('kw').value.trim();
  const host = document.getElementById('resultHost');
  if (!kw) return toast(t('query.empty'), 'err');
  host.innerHTML = '<div class="card"><div class="skeleton" style="height:60px"></div></div>';
  const res = await api('/api/orders/query', { method: 'POST', body: { keyword: kw } });
  if (!res.ok) {
    host.innerHTML = `<div class="empty"><div class="big">😵</div>${escapeHtml(t(res.message || 'toast.orderFail'))}</div>`;
    return;
  }
  if (!res.list.length) {
    host.innerHTML = `<div class="empty"><div class="big">🔍</div>${escapeHtml(t(res.message || 'query.notFound'))}<div style="margin-top:14px"><a class="btn btn-sm" href="/">${escapeHtml(t('query.toOrder'))}</a></div></div>`;
    return;
  }
  host.innerHTML = res.list.map(card).join('');
  if (res.list.length === 1) {
    const box = document.getElementById('logs-' + res.list[0].no);
    if (box) box.classList.remove('hide');
  }
}

function card(o) {
  const st = STATUS_MAP[o.status] || {};
  const logs = (o.logs || [])
    .slice()
    .reverse()
    .map((l) => {
      const cls = l.level === 'success' ? 'ok' : l.level === 'error' ? 'err' : l.level === 'warn' ? 'warn' : '';
      return `<div class="tl-item ${cls}"><div class="m">${escapeHtml(t(l.msg))}</div><div class="t">${fmtTime(l.t)}</div></div>`;
    })
    .join('');
  return `<div class="q-order">
    <div class="top">
      <span style="font-size:19px">${st.icon || '📦'}</span>
      <div>
        <div class="nm">${escapeHtml(pick(o.productName))} · ${escapeHtml(t(o.skuName))}</div>
        <div class="muted mono" style="font-size:12px">${o.no}</div>
      </div>
      <div class="st">${statusChip(o.status)}
        <button class="btn btn-xs btn-ghost" style="margin-left:8px" onclick="copyText('${o.no}','${escapeHtml(t('toast.copied'))}')">⧉</button>
      </div>
    </div>
    <div class="info-rows" style="margin-bottom:14px">
      ${
        o.account
          ? `<div class="r"><span class="k">${escapeHtml(t('result.account'))}</span><span class="v"><b>${escapeHtml(o.account)}</b></span></div>`
          : `<div class="r"><span class="k">${escapeHtml(t('cashier.delivery'))}</span><span class="v">${escapeHtml(t('cashier.auto'))}</span></div>`
      }
      <div class="r"><span class="k">${escapeHtml(t('result.paid'))}</span><span class="v">¥${money(o.amount)} · ${escapeHtml(pick(o.payMethodName))}</span></div>
      ${
        o.payForeignAmount
          ? `<div class="r"><span class="k">${escapeHtml(t('pay.foreignAmount', o.payCurrency || 'USD'))}</span><span class="v">${escapeHtml(o.payForeignAmount)} ${escapeHtml(o.payCurrency || '')}</span></div>`
          : ''
      }
      ${o.payTxId ? `<div class="r"><span class="k">TxID</span><span class="v mono" style="word-break:break-all">${escapeHtml(o.payTxId)}</span></div>` : ''}
      <div class="r"><span class="k">${escapeHtml(t('result.supplier'))}</span><span class="v">${escapeHtml(pick(o.supplierName) || '—')}${o.supplierOrderNo ? ' · ' + escapeHtml(o.supplierOrderNo) : ''}</span></div>
      <div class="r"><span class="k">${escapeHtml(t('result.createdAt'))}</span><span class="v">${fmtTime(o.createdAt)}</span></div>
      ${o.finishedAt ? `<div class="r"><span class="k">${escapeHtml(t('result.finishedAt'))}</span><span class="v">${fmtTime(o.finishedAt)}</span></div>` : ''}
    </div>
    <div style="display:flex;gap:10px;align-items:center">
      <button class="btn btn-sm" onclick="document.getElementById('logs-${o.no}').classList.toggle('hide')">${escapeHtml(t('query.logs'))}</button>
      ${o.status === 'pending_payment' ? `<a class="btn btn-sm btn-primary" href="/pay.html?no=${o.no}">${escapeHtml(t('query.continuePay'))}</a>` : ''}
      ${o.status === 'failed' ? `<span class="muted" style="font-size:12.5px">${escapeHtml(t('query.failedNote'))}</span>` : ''}
    </div>
    <div class="hide" id="logs-${o.no}" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--line)">
      <div class="timeline">${logs}</div>
    </div>
  </div>`;
}

/* ---------------- 启动 ---------------- */
async function boot() {
  await initI18n();
  // 查询页不请求 /api/store，站点名直接走 i18n 词条
  document.getElementById('brandName').textContent = t('brand.name');
  document.getElementById('brandSub').textContent = t('brand.sub');
  document.title = t('query.title') + ' · ' + t('brand.name');

  document.getElementById('searchBtn').addEventListener('click', search);
  document.getElementById('kw').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });

  // 语言切换后重刷结果与静态文案
  onLangChange(() => {
    applyI18n();
    document.getElementById('brandName').textContent = t('brand.name');
    document.getElementById('brandSub').textContent = t('brand.sub');
    document.title = t('query.title') + ' · ' + t('brand.name');
    const kw = document.getElementById('kw').value.trim();
    if (kw) search();
  });

  const initKw = qs('kw');
  if (initKw) { document.getElementById('kw').value = initKw; search(); }
}

boot();
