#!/usr/bin/env node
// latam_fetch.js — VPN.lat 节点全链路拉取（挂上拉美出口后运行此脚本）
// 前提: 以下二选一
//   a) 本地代理端口:  env LATAM_PROXY=http://127.0.0.1:10808 (CONNECT 隧道)
//   b) 透明出口(TUN):  直接跑，出口已是拉美
// 用法: node latam_fetch.js [--direct] [--out out/]
// 产出: out/countries.json, out/wire/<cc>.json, out/ovpn/<cc>.b64
const fs = require('fs');
const path = require('path');
const http = require('http');
const tls = require('tls');

const LOCAL_PROXY = process.env.LATAM_PROXY || 'http://127.0.0.1:10808';
const DIRECT = process.argv.includes('--direct');
const OUT = path.resolve(process.argv[process.argv.indexOf('--out') + 1] || 'out');
const HOST_NAME = 'hetecn.com';
const HOST_IP = process.env.HETECN_IP || '54.39.108.255';
const UA = 'Dart/3.5 (dart:io)';

fs.mkdirSync(path.join(OUT, 'wire'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'ovpn'), { recursive: true });

// ---- 传输层 ----
function connectTLS(cb) {
  if (DIRECT) {
    const s = tls.connect({ host: HOST_NAME, port: 443, rejectUnauthorized: false, timeout: 20000 }, () => cb(null, s));
    s.on('error', e => cb(e));
    return;
  }
  const u = new URL(LOCAL_PROXY);
  const req = http.request({ host: u.hostname, port: u.port || 80, method: 'CONNECT', path: `${HOST_NAME}:443`, timeout: 15000 });
  req.on('connect', (res, socket) => {
    if (res.statusCode !== 200) { socket.destroy(); return cb(new Error('CONNECT ' + res.statusCode)); }
    const s = tls.connect({ socket, servername: HOST_NAME, rejectUnauthorized: false, timeout: 20000 }, () => cb(null, s));
    s.on('error', e => cb(e));
  });
  req.on('error', e => cb(e));
  req.on('timeout', () => { req.destroy(); cb(new Error('proxy timeout')); });
  req.end();
}

function get(path, cb) {
  connectTLS((e, s) => {
    if (e) return cb(e, '', null);
    let buf = [];
    s.end(`GET ${path} HTTP/1.1\r\nHost: ${HOST_NAME}\r\nUser-Agent: ${UA}\r\nConnection: close\r\n\r\n`);
    s.on('data', d => buf.push(d));
    s.on('end', () => {
      const b = Buffer.concat(buf);
      const i = b.indexOf('\r\n\r\n');
      const head = b.slice(0, i).toString();
      const status = (head.match(/HTTP\/1\.[01] (\d{3})/) || [])[1];
      cb(null, status, decodeChunked(b.slice(i + 4)));
    });
    s.on('error', err => cb(err, '', null));
  });
}

function decodeChunked(buf) {
  const s = buf.toString('latin1');
  if (!/^[0-9a-f]{1,8}\r\n/i.test(s)) return s;
  let out = '', i = 0;
  while (i < s.length) {
    const j = s.indexOf('\r\n', i); if (j < 0) break;
    const n = parseInt(s.slice(i, j), 16); if (!n) break;
    out += s.slice(j + 2, j + 2 + n); i = j + 2 + n + 2;
  }
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('== step 1: /server 国家表 ==');
  const countries = await new Promise(r => get('/server', (e, st, body) => {
    if (e || st !== '200') { console.log('FAIL', e ? e.message : st); return r(null); }
    try {
      const j = JSON.parse(body);
      fs.writeFileSync(path.join(OUT, 'countries.json'), JSON.stringify(j, null, 2));
      const supported = j.filter(c => c.category && c.category !== 'unsupported');
      console.log('total entries:', j.length, '| supported:', supported.length);
      console.log('saved → out/countries.json');
      r(supported.length ? j : j);
    } catch (_) { console.log('parse fail, raw saved'); fs.writeFileSync(path.join(OUT, 'countries.json'), body); r(null); }
  }));
  if (!countries) { console.log('仍被 geo 拦截——确认出口 IP 确实在拉美（curl http://ip-api.com/json/ 查）'); process.exit(2); }

  // 支持国家码（从 countries.json 的 shortcountry 提取）
  const codes = [...new Set(countries.map(c => c.shortcountry).filter(Boolean))];
  console.log('== step 2: 逐国拉 WG + OVPN 配置, codes =', codes.join(','), '==');
  for (const cc of codes) {
    await new Promise(r => get(`/wire/server/${cc}`, (e, st, body) => {
      if (!e && st === '200' && body.length > 50) {
        fs.writeFileSync(path.join(OUT, 'wire', `${cc}.json`), body);
        console.log(`WG ${cc}: OK len=${body.length}`);
      } else console.log(`WG ${cc}: ${e ? e.message : st}`);
      r();
    }));
    await sleep(1200);
    await new Promise(r => get(`/opvn/server/${cc}`, (e, st, body) => {
      if (!e && st === '200' && body.length > 50) {
        fs.writeFileSync(path.join(OUT, 'ovpn', `${cc}.b64`), body);
        console.log(`OVPN ${cc}: OK len=${body.length}`);
      } else console.log(`OVPN ${cc}: ${e ? e.message : st}`);
      r();
    }));
    await sleep(1200);
  }
  console.log('== done. 检查 out/ 目录，随后用解析脚本提取 endpoint 入代理池 ==');
})();
