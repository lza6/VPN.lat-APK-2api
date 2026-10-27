#!/usr/bin/env node
// bench.js — 免费代理池压测：并发/存活率/P50/P95 延迟/错误分布
// 用法: node bench.js <proxies.txt> [--target URL] [--conc N] [--mode plain|tunnel]
// proxies.txt 每行: ip:port[:cc] 或 scheme://ip:port
//   mode plain  — 明文 http 经代理（快，适合纯列表验活）
//   mode tunnel — CONNECT→TLS 到目标 443（目标站有 SNI/geo 需求时用，默认）
const fs = require('fs');
const http = require('http');
const tls = require('tls');

const args = process.argv.slice(2);
const file = args[0];
if (!file) { console.error('usage: node bench.js <proxies.txt> [--target URL] [--conc N] [--mode plain|tunnel]'); process.exit(1); }
const get = (flag, dft) => { const i = args.indexOf(flag); return i > -1 ? args[i + 1] : dft; };

const TARGET = get('--target', 'https://hetecn.com/server');
const CONC = parseInt(get('--conc', '20'), 10);
const MODE = get('--mode', 'tunnel');
const u = new URL(TARGET);
const HOST = u.hostname;
const HOST_IP = process.env.HETECN_IP || null; // 若目标被本地 SNI 阻断，设 HETECN_IP 直连

const nodes = fs.readFileSync(file, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);

function stripScheme(p) { return p.replace(/^\w+:\/\//, ''); }

function plain(proxy, cb) {
  const [h, port] = stripScheme(proxy).split(':');
  const req = http.request({ host: h, port: +port, method: 'GET', path: u.href, headers: { 'User-Agent': 'bench/1' }, timeout: 10000 }, res => {
    let n = 0; res.on('data', d => n += d.length);
    res.on('end', () => cb(null, { status: res.statusCode, bytes: n }));
  });
  req.on('error', e => cb(e)); req.on('timeout', () => { req.destroy(); cb(new Error('timeout')); });
  req.end();
}

function tunnel(proxy, cb) {
  const [h, port] = stripScheme(proxy).split(':');
  const req = http.request({ host: h, port: +port, method: 'CONNECT', path: `${HOST}:443`, timeout: 8000 });
  req.on('connect', (res, socket) => {
    if (res.statusCode !== 200) { socket.destroy(); return cb(new Error('CONNECT ' + res.statusCode)); }
    const opts = { socket, servername: HOST, rejectUnauthorized: false, timeout: 10000 };
    if (HOST_IP) { opts.host = HOST_IP; delete opts.servername; }
    const s = tls.connect(opts, () => {
      s.end(`GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${HOST}\r\nUser-Agent: bench/1\r\nConnection: close\r\n\r\n`);
    });
    let b = '';
    s.on('data', d => b += d.toString('latin1'));
    s.on('end', () => {
      const m = b.match(/HTTP\/1\.[01] (\d{3})/);
      cb(null, { status: m ? m[1] : '?', bytes: b.length });
    });
    s.on('error', e => cb(e));
  });
  req.on('error', e => cb(e)); req.on('timeout', () => { req.destroy(); cb(new Error('timeout')); });
  req.end();
}

(async () => {
  const res = { alive: 0, dead: 0, lat: [], errs: {}, statuses: {} };
  const queue = [...nodes];
  const send = MODE === 'plain' ? plain : tunnel;
  await Promise.all(Array(CONC).fill(0).map(async () => {
    while (queue.length) {
      const p = queue.shift();
      await new Promise(r => {
        const t0 = Date.now();
        send(p, (e, m) => {
          if (e) { res.dead++; const k = e.code || e.message || 'err'; res.errs[k] = (res.errs[k] || 0) + 1; }
          else { res.alive++; res.lat.push(Date.now() - t0); const k = m.status; res.statuses[k] = (res.statuses[k] || 0) + 1; }
          r();
        });
      });
    }
  }));
  res.lat.sort((a, b) => a - b);
  const q = f => res.lat.length ? res.lat[Math.floor(res.lat.length * f)] + 'ms' : '-';
  console.log(JSON.stringify({
    total: nodes.length, mode: MODE, target: TARGET,
    alive: res.alive, dead: res.dead,
    aliveRate: (res.alive / nodes.length * 100).toFixed(1) + '%',
    p50: q(0.5), p95: q(0.95),
    statuses: res.statuses, errors: res.errs
  }, null, 2));
})();
