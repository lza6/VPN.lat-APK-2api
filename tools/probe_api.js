#!/usr/bin/env node
// probe_api.js — hetecn.com API 探测器（绕本地 SNI 阻断 + 串行防 RST）
// 用法: node probe_api.js [path ...]   默认探测全部已知端点
// 说明: 本机网络对 hetecn.com 的 TLS SNI 有 RST 阻断时，此脚本用「TLS 直连 IP 不带 SNI
//       + HTTP Host 头」绕过。geo 拦截是服务端行为，本脚本会如实显示 unsupported/403。
const tls = require('tls');
const HOST_IP = process.env.HETECN_IP || '54.39.108.255';
const HOST_NAME = 'hetecn.com';
const UA = process.env.HETECN_UA || 'Dart/3.5 (dart:io)';

function req(path, cb) {
  const s = tls.connect({ host: HOST_IP, port: 443, rejectUnauthorized: false, timeout: 20000 }, () => {
    s.end(`GET ${path} HTTP/1.1\r\nHost: ${HOST_NAME}\r\nUser-Agent: ${UA}\r\nConnection: close\r\n\r\n`);
  });
  let buf = '';
  s.on('data', d => buf += d.toString('latin1'));
  s.on('end', () => {
    const i = buf.indexOf('\r\n\r\n');
    cb(null, buf.slice(0, 40).replace(/\r\n/g, ' '), i > 0 ? buf.slice(i + 4) : '');
  });
  s.on('error', e => cb(e, '', ''));
  s.setTimeout(21000, () => { s.destroy(); cb(new Error('timeout'), '', ''); });
}

const paths = process.argv.length > 2
  ? process.argv.slice(2)
  : ['/server', '/random/wire/server', '/wire/server/AR', '/opvn/server/AR'];

(async () => {
  for (const p of paths) {
    await new Promise(r => req(p, (e, st, body) => {
      if (e) console.log(`== ${p} | ERROR ${e.message}`);
      else {
        console.log(`== ${p} | ${st} | len ${body.length}`);
        if (body.length < 3000) console.log(body.slice(0, 2000));
        else console.log(body.slice(0, 400) + '\n... (truncated, len=' + body.length + ')');
      }
      r();
    }));
    await new Promise(r => setTimeout(r, 1500)); // 串行间隔防 RST
  }
})();
