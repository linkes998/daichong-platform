/**
 * 轻量 JSON 数据层：零依赖、原子写入、带简易队列避免并发写坏文件。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SEED_FILE = path.join(DATA_DIR, 'seed.json');

let data = null;
let writing = false;
let dirty = false;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  ensureDir(DATA_DIR);
  if (fs.existsSync(DB_FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      const bak = DB_FILE + '.broken-' + Date.now();
      fs.copyFileSync(DB_FILE, bak);
      console.error('[db] db.json 解析失败，已备份到', bak, '并重新从种子初始化');
      data = null;
    }
  }
  if (!data) {
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    seed.meta = seed.meta || {};
    seed.meta.createdAt = seed.meta.createdAt || new Date().toISOString();
    data = seed;
    save();
  }
  // 兼容性补齐
  ['products', 'orders', 'logs', 'suppliers', 'categories', 'payMethods'].forEach((k) => {
    if (!Array.isArray(data[k])) data[k] = [];
  });
  if (!data.settings) data.settings = {};
  if (!data.settings.i18n) {
    data.settings.i18n = { enabled: true, defaultLang: 'en', autoByIp: true, ipApiUrl: 'http://ip-api.com/json/', timeoutMs: 1500, cacheHours: 6 };
  }
  if (!data.payConfig) data.payConfig = {};
  if (!data.payConfig.channels) data.payConfig.channels = {};
  if (!Array.isArray(data.admins) || !data.admins.length) {
    // 首次初始化：默认口令 admin888，服务启动时会立即转成 scrypt 哈希，不留明文
    data.admins = [{ id: 'a1', username: 'admin', password: 'admin888', name: '超级管理员', role: 'owner', lastLogin: '' }];
  }
  return data;
}

function save() {
  if (!data) return;
  dirty = true;
  if (writing) return;
  writing = true;
  try {
    let guard = 0;
    while (dirty && guard++ < 50) {
      dirty = false;
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, DB_FILE);
    }
  } catch (e) {
    console.error('[db] 写入失败', e);
  } finally {
    writing = false;
  }
}

function get() {
  if (!data) load();
  return data;
}

/** 生成业务主键 */
function uid(prefix) {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}${stamp}${rand}`;
}

/** 写操作日志 */
function addLog(action, detail, operator) {
  const db = get();
  db.logs.unshift({
    id: uid('L'),
    action,
    detail: detail || '',
    operator: operator || 'system',
    at: new Date().toISOString(),
  });
  if (db.logs.length > 800) db.logs.length = 800;
  save();
}

module.exports = { load, save, get, uid, addLog, DB_FILE, DATA_DIR, ROOT };
