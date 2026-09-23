#!/usr/bin/env node
/**
 * 货源站抓取探针
 * ---------------------------------------------------------------
 * 用法：node tools/grab-site.js <url> [输出文件名前缀]
 * 作用：抓取目标页 HTML，落盘，并打印标题 / 脚本 / 内嵌数据线索，
 *       方便判断站点类型（独角数卡 / Next.js / 自研）与商品数据来源。
 */
const fs = require('fs');
const path = require('path');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function grab(url, headers = {}) {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(url, {
      signal: c.signal,
      redirect: 'follow',
      headers: Object.assign(
        { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*', 'Accept-Language': 'zh-CN,zh;q=0.9' },
        headers
      ),
    });
    const text = await r.text();
    return { ok: true, status: r.status, type: r.headers.get('content-type'), text, finalUrl: r.url };
  } catch (e) {
    return { ok: false, error: `${e.name}: ${e.message}${e.cause && e.cause.code ? ' (' + e.cause.code + ')' : ''}` };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const target = process.argv[2];
  const prefix = process.argv[3] || 'grab';
  if (!target) {
    console.log('用法：node tools/grab-site.js <url> [前缀]');
    process.exit(1);
  }
  const urls = [target, target.replace(/^https:/, 'http:')].filter((v, i, a) => a.indexOf(v) === i);
  let res = null;
  let used = '';
  for (const u of urls) {
    process.stdout.write(`尝试 ${u} ... `);
    res = await grab(u);
    if (res.ok) {
      console.log(`OK ${res.status} ${res.type} ${res.text.length} 字节`);
      used = u;
      break;
    }
    console.log('失败：' + res.error);
  }
  if (!res || !res.ok) {
    console.log('\n所有方式均失败。');
    return;
  }
  const file = path.resolve(__dirname, '..', `${prefix}-raw.html`);
  fs.writeFileSync(file, res.text, 'utf8');
  const t = res.text;
  console.log('\n最终地址：' + (res.finalUrl || used));
  console.log('标题：' + ((t.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '(无)').trim());
  const srcs = [...t.matchAll(/<script[^>]*src=["']([^"']+)["']/g)].map((m) => m[1]);
  console.log('外部脚本：\n  ' + srcs.join('\n  '));
  const links = [...t.matchAll(/<link[^>]*href=["']([^"']+)["']/g)].map((m) => m[1]);
  console.log('样式/资源：\n  ' + links.slice(0, 15).join('\n  '));
  const inline = [...t.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  console.log(`内联脚本 ${inline.length} 段，总长 ${inline.reduce((s, x) => s + x.length, 0)}`);
  const marks = [
    ['独角数卡', /独角数卡|lenz|shop\.js|acg/i],
    ['Next.js', /__NEXT_DATA__|self\.__next_f|_next\/static/i],
    ['Vue SPA', /vue(\.min)?\.js|createApp|v-if=/i],
    ['React SPA', /react(\.production\.min)?\.js|ReactDOM/i],
    ['商品接口线索', /\/api\/[a-zA-Z0-9_\-\/]{2,}/g],
  ];
  console.log('\n特征识别：');
  marks.forEach(([label, re]) => {
    const m = t.match(re);
    console.log(`  ${label}：${m ? '命中 ' + (m.length > 1 ? m.length + ' 处' : m[0]) : '无'}`);
  });
  const paths = [...new Set([...t.matchAll(/["'`](\/(?:api|user-api|shop|goods|product)[a-zA-Z0-9_\-\/]{2,})["'`]/g)].map((m) => m[1]))];
  if (paths.length) console.log('  HTML 内接口路径：\n    ' + paths.slice(0, 30).join('\n    '));
  console.log('\n已保存：' + path.relative(path.resolve(__dirname, '..'), file));
}

main();
