#!/usr/bin/env node
/**
 * 货源商品导入器
 * ---------------------------------------------------------------
 * 把「货源站清单」（data/source-import/*.json）里的分类 / 商品来源 / 商品
 * 批量 upsert 进平台数据库（默认 data/db.json），按 id 覆盖同名项，其余集合
 * （orders / logs / admins / settings / payConfig）原样不动。
 *
 * 用法：
 *   node tools/import-source.js                              # 导入 source-import 下最新一份清单
 *   node tools/import-source.js data/source-import/xxx.json  # 指定清单
 *   node tools/import-source.js --dry                        # 只校验 + 预览，不写盘
 *   node tools/import-source.js --db data/db.json            # 指定目标库
 *   node tools/import-source.js --seed                       # 目标改为 data/seed.json（初始化模板）
 *
 * 清单结构（见 data/source-import/icloud011.json）：
 *   { source: {...}, supplier: {...}, categories: [...], products: [...] }
 *
 * 注意：平台服务运行时会整库读写 data/db.json。导入前请先停掉服务，
 *       导入后再启动，否则内存中的旧数据可能在下次保存时覆盖本次导入。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const DRY = has('--dry');
const TO_SEED = has('--seed');
const DB_PATH = path.resolve(ROOT, TO_SEED ? 'data/seed.json' : val('--db', 'data/db.json'));

/** 解析清单路径：显式参数 > source-import 目录下最新一份 */
function resolveManifest() {
  const explicit = argv.find((a) => !a.startsWith('--') && a.endsWith('.json'));
  if (explicit) return path.resolve(ROOT, explicit);
  const dir = path.join(ROOT, 'data', 'source-import');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error('data/source-import/ 下没有可导入的清单文件');
  return path.join(dir, files[0].f);
}

function main() {
  const manifestPath = resolveManifest();
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const dbPath = DB_PATH;
  if (!fs.existsSync(dbPath)) throw new Error('目标库不存在：' + dbPath);
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

  const cats = m.categories || [];
  const sups = m.supplier ? [m.supplier] : m.suppliers || [];
  const prods = m.products || [];

  /* ---------------- 校验 ---------------- */
  const errs = [];
  const ids = new Set();
  const dup = (arr, label) => {
    arr.forEach((x) => {
      const k = label + ':' + x.id;
      if (ids.has(k)) errs.push(`清单内 ${label} id 重复：${x.id}`);
      ids.add(k);
    });
  };
  dup(cats, '分类');
  dup(sups, '来源');
  dup(prods, '商品');
  prods.forEach((p) => {
    if (!p.name) errs.push(`商品 ${p.id} 缺少 name`);
    if (!p.catId) errs.push(`商品 ${p.id} 缺少 catId`);
    if (!(p.skus || []).length) errs.push(`商品 ${p.id} 没有套餐（skus）`);
    const catOk =
      cats.some((c) => c.id === p.catId) || (db.categories || []).some((c) => c.id === p.catId);
    if (!catOk) errs.push(`商品 ${p.id} 的 catId「${p.catId}」在清单和目标库里都不存在`);
    (p.skus || []).forEach((s) => {
      if (!s.id) errs.push(`商品 ${p.id} 下有套餐缺少 id`);
      if (!(s.price >= 0)) errs.push(`套餐 ${s.id} 售价非法`);
      if (s.supplierId) {
        const supOk =
          sups.some((x) => x.id === s.supplierId) ||
          (db.suppliers || []).some((x) => x.id === s.supplierId);
        if (!supOk) errs.push(`套餐 ${s.id} 绑定的来源「${s.supplierId}」不存在`);
      }
    });
  });
  if (errs.length) {
    console.log('❌ 清单校验未通过：');
    errs.forEach((e) => console.log('   · ' + e));
    process.exit(1);
  }

  /* ---------------- upsert ---------------- */
  const stat = { cat: [0, 0], sup: [0, 0], prod: [0, 0], sku: [0, 0] };
  const upsert = (list, item, key) => {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) {
      list[i] = Object.assign({}, list[i], item);
      stat[key][1]++;
    } else {
      list.push(item);
      stat[key][0]++;
    }
  };

  cats.forEach((c) => upsert(db.categories, c, 'cat'));
  sups.forEach((s) => upsert(db.suppliers, s, 'sup'));
  prods.forEach((p) => {
    const i = (db.products || []).findIndex((x) => x.id === p.id);
    if (i >= 0) {
      const before = db.products[i];
      const beforeSkus = new Map((before.skus || []).map((s) => [s.id, s]));
      // 保留运行期产生的销量，其余以清单为准
      const merged = Object.assign({}, before, p, { sales: before.sales || p.sales || 0 });
      merged.skus = (p.skus || []).map((s) => Object.assign({}, beforeSkus.get(s.id) || {}, s));
      db.products[i] = merged;
      stat.prod[1]++;
      stat.sku[1] += merged.skus.length;
    } else {
      db.products.push(p);
      stat.prod[0]++;
      stat.sku[0] += (p.skus || []).length;
    }
  });

  const line = (label, [add, upd]) => `   ${label.padEnd(6, ' ')} 新增 ${add}  更新 ${upd}`;
  console.log(`📦 清单：${path.relative(ROOT, manifestPath)}`);
  console.log(`   货源：${m.source ? m.source.name + '（' + m.source.site + '）' : '未标注'}`);
  console.log(`🎯 目标库：${path.relative(ROOT, dbPath)}`);
  console.log(line('分类', stat.cat));
  console.log(line('来源', stat.sup));
  console.log(line('商品', stat.prod));
  console.log(line('套餐', stat.sku));

  if (DRY) {
    console.log('\n(--dry 预览模式，未写盘)');
    return;
  }

  if (!TO_SEED) {
    // 写入初始化模板（--seed）时不落日志，保持模板干净
    db.logs = db.logs || [];
    db.logs.unshift({
      id: 'L' + new Date().toISOString().replace(/\D/g, '').slice(0, 14) + require('crypto').randomBytes(3).toString('hex').toUpperCase(),
      action: 'source.import',
      detail: `导入货源清单 ${path.basename(manifestPath)}：分类 +${stat.cat[0]}/~${stat.cat[1]}、来源 +${stat.sup[0]}/~${stat.sup[1]}、商品 +${stat.prod[0]}/~${stat.prod[1]}、套餐 +${stat.sku[0]}/~${stat.sku[1]}`,
      operator: 'system',
      at: new Date().toISOString(),
    });
    if (db.logs.length > 800) db.logs.length = 800;
  }
  db.meta = Object.assign({}, db.meta, { updatedAt: new Date().toISOString() });

  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
  console.log(`\n✅ 已写入 ${path.relative(ROOT, dbPath)}（订单/日志未改动，当前商品总数 ${db.products.length}）`);
}

try {
  main();
} catch (e) {
  console.log('❌ 导入失败：' + (e.message || e));
  process.exit(1);
}
