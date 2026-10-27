# VPN.lat-APK-2api

VPN.lat Android APK 逆向成果知识库 + 节点拉取工具集。目标：提取 VPN.lat 的 WireGuard/OpenVPN 节点资源，作为 new-api 代理池的长久稳定节点源。

## 项目状态

| 阶段 | 状态 |
|------|------|
| APK 静态逆向（Flutter AOT 字符串挖掘） | ✅ 完成 |
| API 协议全解（4 端点 + 请求/响应格式） | ✅ 完成 |
| 本机网络绕过（SNI 阻断） | ✅ 完成 |
| 节点数据拉取 | ⛔ 被 geo 围栏阻塞（需真实拉美出口 IP） |
| 接入 new-api 代理池 | ⏳ 待节点拉取打通 |

## 核心发现

### API 端点（hetecn.com = 54.39.108.255, nginx/1.26.3）

| 端点 | 用途 | 响应 |
|------|------|------|
| `GET /server` | 国家/地区表（`getRegionalData`） | JSON 数组 `[{country, shortcountry, category}]` |
| `GET /random/wire/server` | 随机 WireGuard 节点 | 节点 JSON（含 endpoint/密钥） |
| `GET /wire/server/<cc>` | 指定国家 WG 节点配置 | 节点 JSON |
| `GET /opvn/server/<cc>` | 指定国家 OpenVPN 配置 | base64 conf（字段 `openVPNConfigDataBase64`） |

- UA 伪装：`Dart/3.5 (dart:io)`（Flutter dart:io HttpClient 默认 UA）
- Firebase 库 `vpn-lat` 已被 owner 禁用（HTTP 423），节点下发全走 hetecn.com
- 国家码用小写 ISO 码（`/wire/server/argentina` 风格也探测过，403——以实际响应为准）

### Geo 围栏（当前最大阻塞）

服务端按**请求来源 IP 的国家**判定：
- 非支持国家（拉美）→ `/server` 返回 834B 的 "not supported by VPN.LAT" 表；`/wire/*` `/opvn/*` 直接 403
- 免费拉美代理实测：geonode 437 个候选仅 ~2.5% 可达，可达者也被 nginx 层拦
- **打通条件：一个真实的拉美出口 IP**（阿根廷/巴西 VPN 节点即可）

### 已知网络坑（实测教训）

1. **本机 SNI 阻断**：带 `hetecn.com` SNI 的 TLS 握手被 RST。绕过法：TLS 直连 IP 不带 SNI（`tls.connect({host:'54.39.108.255'})` 不传 `servername`）——但此法仅绕本地阻断，geo 判定仍看真实出口
2. **免费代理打 80 端口必 404**：nginx 默认 vhost 接住明文请求。必须 CONNECT 隧道走 443
3. **HTTP 响应 chunked 编码**：手写 TLS 客户端记得解 chunk（`N\r\n...\r\n` 循环）
4. **免费代理列表必须现抓现用**：TheSpeedX 大列表 LATAM 段 98% 是死的；geonode `country=` 过滤 + `lastChecked` 排序质量最高

## 工具集

| 脚本 | 用途 |
|------|------|
| `tools/apk_strings.js` | Dart AOT so 文件的 ASCII 字符串提取 + 协议关键词过滤 |
| `tools/probe_api.js` | 无 SNI TLS 直连探测 hetecn API（绕本地 SNI 阻断） |
| `tools/latam_fetch.js` | 拉美出口全链路：geonode 抓代理 → CONNECT 隧道 → 拉 `/server`+节点配置 |
| `tools/bench.js` | 代理池压测：并发/存活率/P50/P95 延迟/错误分布 |

## 仓库结构

```
docs/
  REVERSE_REPORT.md    # 完整逆向报告（协议、字段、流程、坑）
  ROADMAP.md           # 打通节点拉取的路线图
tools/                 # 上述脚本（Node，Windows 可直接跑）
SKILL.md               # 「Flutter VPN APK 逆向」技能卡（可复用方法论）
```

## 接入 new-api 代理池（打通后）

1. 节点 JSON → 解析 endpoint（ip:port）入 `relay/channel/tryingopen/free_fetcher.go` 源清单
2. OVPN/WG 配置 → `TRYINGOPEN_PROXY_FILE` 静态文件灌入
3. 压测验收：`tools/bench.js` 跑存活率/P95，接入现有权重池 + 冷却机制

## 相关

- new-api 主项目：`lza6/new-api-Max`（tryingopen 渠道 type 64、proxy-pool 管理页）
- geonode LATAM 源已入池（13 国，2026-10-28）

## License

MIT
