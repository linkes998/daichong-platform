#!/usr/bin/env node
/**
 * 管理员口令离线重置工具（忘记密码时的救援通道）
 * ---------------------------------------------------------------
 * 直接改写 data/db.json 中的管理员口令为 scrypt 加盐哈希，
 * 不需要提供旧密码，适用于后台登录失败 / 口令丢失的场景。
 *
 * ⚠️ 平台服务运行时会整库读写 data/db.json，运行本脚本前请先停服，
 *    否则内存中的旧数据可能在下次保存时覆盖本次重置。
 *
 * 用法：
 *   node tools/reset-admin.js <新密码>                    # 重置默认账号 admin
 *   node tools/reset-admin.js <新密码> --user root         # 指定用户名
 *   node tools/reset-admin.js <新密码> --db data/seed.json # 指定目标库
 *   node tools/reset-admin.js --list                       # 仅列出所有管理员
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const DB_PATH = path.resolve(ROOT, val('--db', 'data/db.json'));
const USER = val('--user', 'admin');

function makeHash(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(String(plain), salt, 32).toString('hex') };
}

function readDb() {
  if (!fs.existsSync(DB_PATH)) {
    console.log('❌ 数据库不存在：' + DB_PATH);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    console.log('❌ 数据库解析失败：' + e.message);
    process.exit(1);
  }
}

const db = readDb();
const admins = Array.isArray(db.admins) ? db.admins : [];

if (has('--list')) {
  console.log('📋 ' + path.relative(ROOT, DB_PATH) + ' 中的管理员：');
  if (!admins.length) console.log('   （无）');
  admins.forEach((a) => {
    console.log(
      `   · ${a.username}  ${a.name || ''}  ${a.role || ''}  ` +
        `${a.passwordHash ? '[已哈希]' : a.password ? '[⚠️ 明文]' : '[无口令]'}`
    );
  });
  process.exit(0);
}

// 取第一个「位置参数」作为新密码（排除 --user / --db 的取值）
const consumed = new Set();
['--user', '--db'].forEach((f) => {
  const i = argv.indexOf(f);
  if (i >= 0) {
    consumed.add(i);
    consumed.add(i + 1);
  }
});
const positional = argv.filter((a, i) => !a.startsWith('--') && !consumed.has(i));
const newPw = positional[0];
if (!newPw) {
  console.log('用法：node tools/reset-admin.js <新密码> [--user admin] [--db data/db.json]');
  console.log('      node tools/reset-admin.js --list');
  process.exit(1);
}
if (newPw.length < 8) {
  console.log('❌ 新密码至少 8 位');
  process.exit(1);
}
if (/\s/.test(newPw)) {
  console.log('❌ 新密码不能包含空格');
  process.exit(1);
}

const target = admins.find((a) => a.username === USER);
if (!target) {
  console.log('❌ 未找到管理员：' + USER + '（可用 --list 查看现有账号）');
  process.exit(1);
}

const { salt, hash } = makeHash(newPw);
target.passwordSalt = salt;
target.passwordHash = hash;
delete target.password;
target.passwordUpdatedAt = new Date().toISOString();

db.logs = db.logs || [];
db.logs.unshift({
  id: 'L' + new Date().toISOString().replace(/\D/g, '').slice(0, 14) + crypto.randomBytes(3).toString('hex').toUpperCase(),
  action: 'admin.password.reset',
  detail: `通过离线工具重置管理员 ${USER} 的登录口令`,
  operator: 'cli',
  at: new Date().toISOString(),
});
if (db.logs.length > 800) db.logs.length = 800;
db.meta = Object.assign({}, db.meta, { updatedAt: new Date().toISOString() });

const tmp = DB_PATH + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
fs.renameSync(tmp, DB_PATH);

console.log('✅ 已重置 ' + USER + ' 的登录口令（scrypt 加盐哈希）');
console.log('   目标库：' + path.relative(ROOT, DB_PATH));
console.log('   ⚠️ 若服务正在运行，请立即重启以使新口令生效：');
console.log('      sudo systemctl restart daichong-platform');
