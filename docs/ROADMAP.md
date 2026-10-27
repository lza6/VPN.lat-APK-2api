# 打通路线图

## 当前卡点（唯一）

**需要一个真实的拉美出口 IP**。geo 围栏在服务端按 TCP 来源 IP 判定，免费代理打不通（详见 REVERSE_REPORT.md §5.4）。

## 路线 A：用户挂拉美 VPN（最快，推荐）

1. 本机 V2ray/Clash 切任意阿根廷/巴西/墨西哥节点
2. 运行：
   ```bash
   # 方式1：走本地代理端口（脚本内置 127.0.0.1:10808 CONNECT）
   node tools/latam_fetch.js
   
   # 方式2：透明出口（TUN 模式），脚本直连即可
   node tools/latam_fetch.js --direct
   ```
3. 产出：
   - `out/countries.json` — 支持国家表
   - `out/wire/<cc>.json` — 各国 WG 节点
   - `out/ovpn/<cc>.b64` — 各国 OVPN base64 配置
4. 解析 endpoint → 按下文入池

## 路线 B：住宅代理服务

买按流量的拉美住宅代理（Bright Data/IPRoyal 等，几美元），`HTTPS_PROXY` 指过去跑同一脚本。优点：可长期值守自动刷新节点。

## 路线 C：云端 VPS

拉美区域 VPS（AWS São Paulo / GCP Santiago 等）跑值守任务，每日拉节点推送到 new-api。

## 入池方案（打通后）

### 方案 1：静态文件（最简单）
```bash
# 解析出的 endpoint 写入文件，每行 ip://port 或 http://ip:port
kubectl/scp 到服务器 → 
export TRYINGOPEN_PROXY_FILE=/data/vpnlat_proxies.txt
# 重启 new-api 或 POST /api/twoapi_panel/proxy_pool/reload
```

### 方案 2：新增 fetcher 源（长期）
`relay/channel/tryingopen/free_fetcher.go` 增加 `vpnlat` 源：
- 需先在拉美出口部署一个小中转（因为 new-api 服务器出口不在拉美）
- 中转示例（Cloudflare Worker 不行——出口固定；需真拉美 VPS）：
  ```
  GET https://<latam-vps>/vpnlat/wire/<cc>  → 后端代理请求 hetecn.com 并缓存 1h
  ```
- Go fetcher 直接抓中转 URL，格式 JSON 行解析（复用 parseGeonodeJSON 模式）

### 方案 3：WG/OVPN 真隧道（重量级）
拉到的是 WireGuard/OpenVPN 配置，可以：
- 服务器上 wg-quick 起隧道，隧道内再起正向代理（gost/dante）
- 把 `127.0.0.1:port` 作为 socks5 代理入池 → new-api 获得拉美出口能力
- 此方案让 tryingopen 等需要非美国 IP 的渠道全部受益

## 验收标准

- [ ] `out/countries.json` 出现 `category:"supported"` 条目
- [ ] 至少 1 个国家拉到完整 WG/OVPN 配置
- [ ] endpoint 经 `tools/bench.js` 压测存活率 > 60%
- [ ] 入池后 new-api 管理页（`/api/twoapi_panel/proxy_pool`）可见 vpnlat 来源
