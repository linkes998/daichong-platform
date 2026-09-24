/**
 * 服务端语言识别
 * ------------------------------------------------------------------
 * 判定优先级（从高到低）：
 *   1. 显式 URL 参数 ?lang=zh|en
 *   2. 访问者 IP 归属地（IP → 国家码 → 中文地区判为 zh，其余判为 en）
 *   3. 浏览器 Accept-Language 头（含 zh 判为 zh）
 *   4. settings.i18n.defaultLang（默认 en）
 *
 * IP 归属地查询说明：
 *   · 默认使用 ip-api.com 免费接口（无需密钥），带 1.5s 超时；
 *   · 结果按 IP 缓存在内存中（默认 6 小时），避免每次请求都外呼；
 *   · 查询失败 / 内网地址 / 未开启时，自动回退到 Accept-Language，不会阻塞页面；
 *   · 接口地址、开关、缓存时长均可在后台「系统设置 → 多语言」中维护。
 */
const db = require('./db');

const ZH_REGIONS = ['CN', 'HK', 'MO', 'TW'];
const cache = new Map(); // ip -> { country, at }
const inflight = new Map(); // ip -> Promise，合并并发查询
let failCount = 0;
const CACHE_TTL = 6 * 3600 * 1000;

function settings() {
  const s = (db.get().settings || {}).i18n || {};
  return {
    enabled: s.enabled !== false,
    defaultLang: s.defaultLang === 'zh' ? 'zh' : 'en',
    autoByIp: s.autoByIp !== false,
    ipApiUrl: s.ipApiUrl || 'http://ip-api.com/json/',
    timeoutMs: Number(s.timeoutMs) || 2500,
    cacheHours: Number(s.cacheHours) || 6,
  };
}

/** 取真实访问者 IP（兼容 nginx 反代） */
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const real = String(req.headers['x-real-ip'] || '').trim();
  let ip = xff || real || (req.socket && req.socket.remoteAddress) || '';
  // IPv6 映射形式 ::ffff:1.2.3.4 → 1.2.3.4
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

/** 内网 / 回环 / 非法地址不做归属地查询 */
function isPrivateIp(ip) {
  if (!ip) return true;
  if (/^127\./.test(ip) || ip === 'localhost') return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^f[cd]/i.test(ip)) return true; // IPv6 ULA
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && !ip.includes(':')) return true;
  return false;
}

/** 从 Accept-Language 推断 */
function fromAcceptLanguage(req) {
  const al = String(req.headers['accept-language'] || '').toLowerCase();
  if (!al) return null;
  const first = al.split(',')[0].trim();
  if (first.startsWith('zh')) return 'zh';
  if (/^[a-z]{2}/.test(first)) return 'en';
  if (al.includes('zh')) return 'zh';
  return null;
}

/** 查询 IP 归属国家码（带正/负缓存与超时，失败不阻塞请求） */
async function countryOf(ip, cfg) {
  const hit = cache.get(ip);
  const ttl = hit && hit.country ? cfg.cacheHours * 3600 * 1000 : 60 * 1000; // 失败结果只缓存 60 秒
  if (hit && Date.now() - hit.at < ttl) return hit.country;

  // 同一 IP 的并发请求合并为一次外呼
  if (inflight.has(ip)) return inflight.get(ip);

  const task = (async () => {
    try {
      const url = cfg.ipApiUrl + encodeURIComponent(ip);
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
      const j = await res.json();
      const country = String((j && (j.countryCode || j.country_code || j.country)) || '').toUpperCase().slice(0, 2);
      cache.set(ip, { country, at: Date.now() });
      if (!country) failCount++;
      return country;
    } catch (e) {
      // 失败做短缓存，避免接口不可用时每次请求都白等一个超时
      cache.set(ip, { country: '', at: Date.now() });
      failCount++;
      return '';
    } finally {
      inflight.delete(ip);
    }
  })();
  inflight.set(ip, task);
  return task;
}

/**
 * 识别本次请求应使用的语言
 * @returns {Promise<{lang:'zh'|'en', country:string, ip:string, source:string}>}
 */
async function detectLang(req, query) {
  const cfg = settings();
  const ip = clientIp(req);

  // 1) URL 显式指定
  const forced = query && String(query.get('lang') || '').toLowerCase();
  if (forced === 'zh' || forced === 'en') {
    return { lang: forced, country: '', ip, source: 'query' };
  }

  if (!cfg.enabled) return { lang: cfg.defaultLang, country: '', ip, source: 'disabled' };

  // 2) IP 归属地
  let country = '';
  if (cfg.autoByIp && !isPrivateIp(ip)) {
    country = await countryOf(ip, cfg);
    if (country) {
      return {
        lang: ZH_REGIONS.includes(country) ? 'zh' : 'en',
        country,
        ip,
        source: 'ip',
      };
    }
  }

  // 3) Accept-Language
  const al = fromAcceptLanguage(req);
  if (al) return { lang: al, country, ip, source: 'accept-language' };

  // 4) 默认
  return { lang: cfg.defaultLang, country, ip, source: 'default' };
}

/** 手动清空缓存（后台改配置后可调用） */
function clearCache() {
  cache.clear();
}

/** 缓存状态，便于后台展示 */
function cacheStats() {
  let zh = 0, en = 0, unknown = 0;
  for (const v of cache.values()) {
    if (!v.country) unknown++;
    else if (ZH_REGIONS.includes(v.country)) zh++;
    else en++;
  }
  return { size: cache.size, zh, en, unknown, failCount, inflight: inflight.size };
}

module.exports = { detectLang, clientIp, settings, clearCache, cacheStats, isPrivateIp, ZH_REGIONS };
