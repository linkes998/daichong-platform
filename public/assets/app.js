/* ============================================================
   公共脚本：请求封装 / 提示 / 弹窗 / 格式化 / 状态
   ============================================================ */

const STATUS_MAP = {
  pending_payment: { text: '待支付', cls: 'chip-warn', dot: 'dot-warn', icon: '⏳' },
  paid: { text: '已支付·待充值', cls: 'chip-info', dot: 'dot-warn', icon: '💳' },
  recharging: { text: '充值中', cls: 'chip-info', dot: 'dot-warn', icon: '🔄' },
  success: { text: '已完成', cls: 'chip-ok', dot: 'dot-ok', icon: '✅' },
  failed: { text: '充值失败', cls: 'chip-danger', dot: 'dot-err', icon: '⚠️' },
  refunded: { text: '已退款', cls: 'chip', dot: 'dot-idle', icon: '↩️' },
  closed: { text: '已关闭', cls: 'chip', dot: 'dot-idle', icon: '🚫' },
};

async function api(path, options = {}) {
  const opt = Object.assign({ headers: {} }, options);
  if (opt.body && typeof opt.body === 'object') {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(opt.body);
  }
  const token = localStorage.getItem('admin_token');
  const hadToken = !!token;
  if (token) opt.headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, opt);
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = { ok: false, message: '服务返回异常（HTTP ' + res.status + '）' };
  }
  // 仅在「本地存有 token 但已失效」时才提示重登录，避免未登录时反复跳转
  if (res.status === 401 && hadToken && path.startsWith('/api/admin/') && !path.endsWith('/login')) {
    localStorage.removeItem('admin_token');
    toast('登录已过期，请重新登录', 'err');
    setTimeout(() => (location.href = '/admin.html'), 900);
  }
  return data;
}

function toast(msg, type) {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

function money(n) {
  const v = Number(n) || 0;
  return v.toFixed(2).replace(/\.00$/, '');
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function fmtShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  const p = (x) => String(x).padStart(2, '0');
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/** 掩码显示账号 */
function maskAccount(acc) {
  const s = String(acc || '');
  if (s.length <= 4) return s;
  if (s.includes('@') && s.indexOf('@') > 1) {
    const [a, b] = s.split('@');
    return a.slice(0, Math.min(3, a.length - 1)) + '***@' + b;
  }
  return s.slice(0, 3) + '****' + s.slice(-2);
}

/** 用字符串生成一个稳定、看起来像二维码的图案（纯前端，无依赖） */
function qrSvg(text, size) {
  size = size || 190;
  const N = 25;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let seed = h >>> 0;
  const rnd = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 4294967295;
  };
  const cell = size / N;
  const isFinder = (r, c) =>
    (r < 7 && c < 7) || (r < 7 && c >= N - 7) || (r >= N - 7 && c < 7);
  let rects = '';
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (isFinder(r, c)) continue;
      if (rnd() > 0.52) {
        rects += `<rect x="${(c * cell).toFixed(2)}" y="${(r * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" rx="${(cell * 0.18).toFixed(2)}"/>`;
      }
    }
  }
  const finder = (r, c) =>
    `<rect x="${c * cell}" y="${r * cell}" width="${cell * 7}" height="${cell * 7}" rx="${cell * 1.1}" fill="none" stroke="#0b0d16" stroke-width="${cell * 1.1}"/>` +
    `<rect x="${(c + 2) * cell}" y="${(r + 2) * cell}" width="${cell * 3}" height="${cell * 3}" rx="${cell * 0.6}" fill="#0b0d16"/>`;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" rx="14" fill="#ffffff"/>
    <g fill="#0b0d16">${rects}</g>
    ${finder(0, 0)}${finder(0, N - 7)}${finder(N - 7, 0)}
  </svg>`;
}

function el(html) {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function copyText(text, tip) {
  const done = () => toast(tip || '已复制到剪贴板', 'ok');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallback());
  } else fallback();
  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动选择', 'err'); }
    ta.remove();
  }
}

/** 十六进制色转 rgba，用于按商品主题色渲染浅底 */
function hexA(hex, a) {
  const h = String(hex || '#6d5efc').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** 状态徽标 */
function statusChip(status) {
  const s = STATUS_MAP[status] || { text: status, cls: 'chip', dot: 'dot-idle', icon: '•' };
  return `<span class="chip ${s.cls}">${s.text}</span>`;
}

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}
