/* 订单查询页 */

async function search() {
  const kw = document.getElementById('kw').value.trim();
  const host = document.getElementById('resultHost');
  if (!kw) return toast('请输入订单号或联系方式', 'err');
  host.innerHTML = '<div class="card"><div class="skeleton" style="height:60px"></div></div>';
  const res = await api('/api/orders/query', { method: 'POST', body: { keyword: kw } });
  if (!res.ok) {
    host.innerHTML = `<div class="empty"><div class="big">😵</div>${escapeHtml(res.message || '查询失败')}</div>`;
    return;
  }
  if (!res.list.length) {
    host.innerHTML = `<div class="empty"><div class="big">🔍</div>${escapeHtml(res.message || '未查询到订单')}<div style="margin-top:14px"><a class="btn btn-sm" href="/">去下单</a></div></div>`;
    return;
  }
  host.innerHTML = res.list.map(card).join('');
  res.list.forEach((o) => {
    const t = document.getElementById('tl-' + o.no);
    if (t) t.addEventListener('click', () => {
      const box = document.getElementById('logs-' + o.no);
      box.classList.toggle('hide');
    });
  });
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
      return `<div class="tl-item ${cls}"><div class="m">${escapeHtml(l.msg)}</div><div class="t">${fmtTime(l.t)}</div></div>`;
    })
    .join('');
  return `<div class="q-order">
    <div class="top">
      <span style="font-size:19px">${st.icon || '📦'}</span>
      <div>
        <div class="nm">${escapeHtml(o.productName)} · ${escapeHtml(o.skuName)}</div>
        <div class="muted mono" style="font-size:12px">${o.no}</div>
      </div>
      <div class="st">${statusChip(o.status)}
        <button class="btn btn-xs btn-ghost" style="margin-left:8px" onclick="copyText('${o.no}','订单号已复制')">复制</button>
      </div>
    </div>
    <div class="info-rows" style="margin-bottom:14px">
      ${
        o.account
          ? `<div class="r"><span class="k">充值账号</span><span class="v"><b>${escapeHtml(o.account)}</b></span></div>`
          : '<div class="r"><span class="k">发货方式</span><span class="v">自动发货（免填账号）</span></div>'
      }
      <div class="r"><span class="k">实付金额</span><span class="v">¥${money(o.amount)} · ${escapeHtml(o.payMethodName)}</span></div>
      <div class="r"><span class="k">商品来源</span><span class="v">${escapeHtml(o.supplierName || '—')}${o.supplierOrderNo ? ' · ' + escapeHtml(o.supplierOrderNo) : ''}</span></div>
      <div class="r"><span class="k">下单时间</span><span class="v">${fmtTime(o.createdAt)}</span></div>
      ${o.finishedAt ? `<div class="r"><span class="k">完成时间</span><span class="v">${fmtTime(o.finishedAt)}</span></div>` : ''}
    </div>
    <div style="display:flex;gap:10px;align-items:center">
      <button class="btn btn-sm" id="tl-${o.no}" onclick="document.getElementById('logs-${o.no}').classList.toggle('hide')">查看处理日志</button>
      ${o.status === 'pending_payment' ? `<a class="btn btn-sm btn-primary" href="/pay.html?no=${o.no}">继续支付</a>` : ''}
      ${o.status === 'failed' ? `<span class="muted" style="font-size:12.5px">请联系客服处理，客服会核对上游扣费情况</span>` : ''}
    </div>
    <div class="hide" id="logs-${o.no}" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--line)">
      <div class="timeline">${logs}</div>
    </div>
  </div>`;
}

document.getElementById('searchBtn').addEventListener('click', search);
document.getElementById('kw').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });

const initKw = qs('kw');
if (initKw) { document.getElementById('kw').value = initKw; search(); }
