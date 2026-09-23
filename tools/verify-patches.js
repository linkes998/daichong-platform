/** 一次性的改动标记自检：node tools/verify-patches.js */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const EXPECT = {
  'server.js': [
    'const noAccount = product.accountType === \'none\';',
    'accountType: product.accountType || \'account\',',
    '免填账号（自动发货）',
    'account: p.accountType === \'none\' ? \'\' : accounts[p.accountType]',
    'notice: p.notice || \'\',',
  ],
  'lib/supplier.js': ["order.accountType !== 'none'"],
  'public/assets/store.js': [
    "const needAcc = p.accountType !== 'none';",
    'notice-box',
    'if (needAcc) {',
    'const stock = (p.skus || []).reduce',
    'const soldOut = stock <= 0;',
    '该商品暂时缺货，到货后可下单',
    '自动发货（免填账号）',
    '虚拟商品 <b style="color:var(--danger)">一经发放不支持退款</b>',
    '多份为独立账号，将分别发放',
    "<span class=\"n\">3</span>订单信息",
    "s.stock > 0 ? '库存 ' + s.stock : '已售罄'",
  ],
  'public/assets/query.js': [
    '自动发货（免填账号）',
    '请输入订单号或联系方式',
  ],
  'public/assets/admin.js': [
    'const ACC_TYPES = [',
    "const accTypeText = (t) =>",
    'const accTypes = ACC_TYPES;',
    'escapeHtml(accTypeText(p.accountType))',
    'id="pNotice"',
    "notice: v('pNotice'),",
    '免填（账号 / 卡密类商品，自动发货）',
  ],
};

let bad = 0;
Object.keys(EXPECT).forEach((f) => {
  const full = path.join(ROOT, f);
  const s = fs.readFileSync(full, 'utf8');
  const miss = EXPECT[f].filter((m) => !s.includes(m));
  const n = EXPECT[f].length;
  if (miss.length) {
    bad += miss.length;
    console.log(`\x1b[31m✗ ${f} — 缺少 ${miss.length}/${n} 处\x1b[0m`);
    miss.forEach((m) => console.log('     · ' + JSON.stringify(m)));
  } else {
    console.log(`\x1b[32m✓ ${f} — ${n} 处标记全部就位\x1b[0m`);
  }
});
console.log(bad ? `\n共有 ${bad} 处改动缺失` : '\n所有改动均已就位');
process.exitCode = bad ? 1 : 0;
