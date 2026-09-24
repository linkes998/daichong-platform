/**
 * 前端静态一致性检查：确认 JS 引用的 DOM id 在对应页面（静态 HTML 或 JS 动态生成的模板）中存在。
 * 运行：node check-dom.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const pages = [
  { name: 'index.html', js: ['assets/app.js', 'assets/i18n.js', 'assets/store.js'] },
  { name: 'query.html', js: ['assets/app.js', 'assets/i18n.js', 'assets/query.js'] },
  { name: 'pay.html', js: ['assets/app.js', 'assets/i18n.js'] },
  { name: 'admin.html', js: ['assets/app.js', 'assets/admin.js'] },
];

const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let problems = 0;

pages.forEach((page) => {
  const html = rd('public/' + page.name);
  const jsSrc = page.js.map((f) => rd('public/' + f)).join('\n');
  const corpus = html + '\n' + jsSrc;

  const used = new Set();
  const re = /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(jsSrc))) used.add(m[1]);

  // 动态拼接的 id（如 'logs-'+o.no、'tl-'+o.no）不做校验
  const dynamicPrefix = ['logs-', 'tl-'];

  const missing = [...used].filter((id) => !dynamicPrefix.some((p) => id.startsWith(p)) && !new RegExp(`id=["']${id}["']`).test(corpus));
  const unusedInHtml = [...html.matchAll(/id=["']([^"']+)["']/g)].map((x) => x[1]).filter((id) => !jsSrc.includes(`'${id}'`) && !jsSrc.includes(`"${id}"`));

  if (missing.length) {
    problems++;
    console.log(`\x1b[31m✗ ${page.name}\x1b[0m  JS 引用了不存在的 id：${missing.join(', ')}`);
  } else {
    console.log(`\x1b[32m✓ ${page.name}\x1b[0m  JS 引用的 ${used.size} 个 id 全部存在`);
  }
  if (unusedInHtml.length) console.log(`    （HTML 中未被 JS 直接引用的 id，正常：${unusedInHtml.join(', ')}）`);
});

/* 检查 onclick 内联调用到的函数是否已定义 */
const storeJs = rd('public/assets/store.js');
const adminJs = rd('public/assets/admin.js');
const allJs = storeJs + adminJs + rd('public/assets/query.js') + rd('public/assets/app.js') + rd('public/assets/i18n.js');
const htmlAll = ['index.html', 'query.html', 'pay.html', 'admin.html'].map((f) => rd('public/' + f)).join('\n');
const inlineCalls = new Set([...htmlAll.matchAll(/on(?:click|change|input)=["']([a-zA-Z_$][\w$]*)\(/g)].map((x) => x[1]));
const tmplCalls = new Set([...(storeJs + adminJs).matchAll(/on(?:click|change)=["']([a-zA-Z_$][\w$]*)\(/g)].map((x) => x[1]));
const undef = [...inlineCalls, ...tmplCalls].filter((fn) => !new RegExp(`(function\\s+${fn}\\b|const\\s+${fn}\\s*=|let\\s+${fn}\\s*=)`).test(allJs));
if (undef.length) {
  problems++;
  console.log(`\x1b[31m✗ 内联事件调用了未定义的函数：${undef.join(', ')}\x1b[0m`);
} else {
  console.log(`\x1b[32m✓\x1b[0m  内联事件调用的 ${new Set([...inlineCalls, ...tmplCalls]).size} 个函数均已定义`);
}

/* 检查 CSS 里被 JS/HTML 使用的关键类是否存在 */
const css = rd('public/assets/theme.css') + rd('public/assets/store.css') + rd('public/assets/admin.css');
const keyClasses = ['modal-mask', 'modal-body', 'modal-foot', 'order-body', 'order-left', 'order-right', 'sku-item', 'pay-item',
  'stat-grid', 'sup-grid', 'sup-card', 'drawer', 'switch', 'timeline', 'info-rows', 'live-item', 'prod-card', 'hub-card',
  'cat-tab', 'flow-step', 'faq-item', 'bar-row', 'tabs', 'panel', 'code-box', 'sku-editor', 'countdown', 'cashier'];
const missCss = keyClasses.filter((c) => !new RegExp(`\\.${c}[\\s,{:.]`).test(css));
if (missCss.length) { problems++; console.log(`\x1b[31m✗ CSS 缺少类定义：${missCss.join(', ')}\x1b[0m`); }
else console.log(`\x1b[32m✓\x1b[0m  检查的 ${keyClasses.length} 个关键类样式全部存在`);

/* 语法检查：所有前端与服务端脚本必须能通过 Node 语法解析 */
const { execFileSync } = require('child_process');
const syntaxTargets = [
  'public/assets/app.js', 'public/assets/i18n.js', 'public/assets/store.js',
  'public/assets/query.js', 'public/assets/admin.js',
  'server.js', 'lib/db.js', 'lib/supplier.js', 'lib/payment.js', 'lib/i18n.js',
];
const syntaxBad = [];
syntaxTargets.forEach((f) => {
  try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' });
  } catch (e) {
    const line = String(e.stderr || e.message).split('\n').find((l) => /Error/.test(l)) || '语法错误';
    syntaxBad.push(`${f} → ${line.trim()}`);
  }
});
if (syntaxBad.length) {
  problems++;
  console.log(`\x1b[31m✗ 以下文件存在语法错误：\x1b[0m`);
  syntaxBad.forEach((s) => console.log('   · ' + s));
} else {
  console.log(`\x1b[32m✓\x1b[0m  ${syntaxTargets.length} 个脚本语法检查通过`);
}

console.log('\n' + (problems ? `\x1b[31m发现 ${problems} 处问题\x1b[0m` : '\x1b[32m静态检查全部通过 ✓\x1b[0m') + '\n');
process.exitCode = problems ? 1 : 0;
