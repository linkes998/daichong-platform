#!/usr/bin/env node
/**
 * Next.js App Router (flight) 数据解析器
 * ---------------------------------------------------------------
 * 站点把首屏数据内联在 `self.__next_f.push([1,"...json-string..."])` 里。
 * 本脚本把这些片段还原成一份连续的 flight 数据流文本，并按需抽取
 * 指定 key 后面的 JSON 值（数组 / 对象），打印或另存。
 *
 * 用法：
 *   node tools/parse-next-flight.js <html文件>                    # 打印数据流概览与顶层 key
 *   node tools/parse-next-flight.js <html文件> initialProducts    # 抽取该 key 的 JSON
 *   node tools/parse-next-flight.js <html文件> initialProducts --save out.json
 */
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.log('用法：node tools/parse-next-flight.js <html文件> [key] [--save 输出文件]');
  process.exit(1);
}
const wantKey = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
const saveIdx = process.argv.indexOf('--save');
const saveTo = saveIdx > 0 ? process.argv[saveIdx + 1] : null;

const html = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

/** 还原所有 push 片段 */
function extractFlight(html) {
  const chunks = [];
  const re = /self\.__next_f\.push\((\[[\s\S]*?\])\)\s*<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      const arr = JSON.parse(m[1]);
      if (Array.isArray(arr) && typeof arr[1] === 'string') chunks.push(arr[1]);
    } catch (e) {
      /* 跳过无法解析的片段 */
    }
  }
  return chunks.join('\n');
}

/** 从文本中提取 key 后紧跟的 JSON 值（括号配对） */
function grabJson(text, key) {
  const idx = text.indexOf(`"${key}":`);
  if (idx < 0) return null;
  let i = text.indexOf(':', idx) + 1;
  while (i < text.length && /\s/.test(text[i])) i++;
  const open = text[i];
  const close = open === '[' ? ']' : open === '{' ? '}' : null;
  if (!close) {
    // 简单标量
    const end = text.indexOf(',', i);
    const raw = text.slice(i, end < 0 ? i + 60 : end);
    try {
      return JSON.parse(raw);
    } catch (e) {
      return raw;
    }
  }
  let depth = 0,
    inStr = false,
    esc = false;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        const raw = text.slice(i, j + 1);
        try {
          return JSON.parse(raw);
        } catch (e) {
          return raw;
        }
      }
    }
  }
  return null;
}

const flight = extractFlight(html);
console.log(`HTML ${html.length} 字节 → 还原 flight 数据流 ${flight.length} 字节`);

if (!wantKey) {
  const keys = [...new Set([...flight.matchAll(/"([a-zA-Z_][a-zA-Z0-9_]{2,30})":/g)].map((m) => m[1]))];
  console.log('顶层可见 key（' + keys.length + '）：\n  ' + keys.slice(0, 120).join(', '));
  const saved = path.resolve(process.cwd(), file.replace(/\.html$/, '-flight.txt'));
  fs.writeFileSync(saved, flight, 'utf8');
  console.log('\n数据流已保存：' + path.basename(saved));
  process.exit(0);
}

const val = grabJson(flight, wantKey);
if (val === null) {
  console.log(`未找到 key「${wantKey}」`);
  process.exit(1);
}
const json = JSON.stringify(val, null, 2);
console.log(`「${wantKey}」共 ${Array.isArray(val) ? val.length + ' 条' : '1 个对象'}，${json.length} 字节`);
if (saveTo) {
  const p = path.resolve(process.cwd(), saveTo);
  fs.writeFileSync(p, json, 'utf8');
  console.log('已保存：' + saveTo);
} else {
  console.log(json.slice(0, 4000));
}
