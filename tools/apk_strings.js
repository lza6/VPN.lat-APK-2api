#!/usr/bin/env node
// apk_strings.js — Dart AOT (libapp.so) 字符串提取器
// 用法: node apk_strings.js <libapp.so> [关键词正则] [-c 上下文字节数]
// 示例: node apk_strings.js libapp.so "hetecn|wire/server" -c 300
const fs = require('fs');

const args = process.argv.slice(2);
const file = args[0];
const kw = args[1] || null;
let ctx = 0;
const ci = args.indexOf('-c');
if (ci > -1) ctx = parseInt(args[ci + 1], 10) || 0;

if (!file) { console.error('usage: node apk_strings.js <libapp.so> [keyword-regex] [-c ctxBytes]'); process.exit(1); }

const s = fs.readFileSync(file).toString('latin1');
const re = /[\x20-\x7e]{6,}/g;
let m; const out = new Set();
while ((m = re.exec(s))) {
  const t = m[0];
  if (kw) {
    if (new RegExp(kw, 'i').test(t)) {
      if (ctx > 0) {
        const start = Math.max(0, m.index - ctx), end = Math.min(s.length, m.index + t.length + ctx);
        out.add('CTX @' + m.index + ': ' + JSON.stringify(s.slice(start, end)));
      } else out.add(t);
    }
  } else {
    out.add(t);
  }
}
console.log([...out].join('\n'));
