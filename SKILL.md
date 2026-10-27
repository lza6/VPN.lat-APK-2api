# Skill: Flutter VPN APK 逆向 → 节点资源提取

> 来源：VPN.lat v3.9.61 实战（2026-10-27/28）。适用于所有 Flutter 架构的 VPN/网络类 APK。

## 适用场景

- 用户给一个 Flutter 架构的 VPN APK，要求提取节点/服务器资源
- 目标：还原节点下发 API 协议 → 拿到 WG/OVPN 配置 → 转化为可用代理源

## 工作流（不依赖 jadx 的最小路径）

### Phase 1: 解包 + 定位

```bash
unzip -o app.apk -d apk_raw
# Flutter 应用的业务逻辑全在 libapp.so（Dart AOT 快照）
ls apk_raw/lib/arm64-v8a/   # 认出: libapp.so + libflutter.so
# VPN 类认引擎: libwg-go.so/libwg.so=WireGuard, libopenvpn.so=OpenVPN3
```

### Phase 2: 字符串挖掘（无 jadx 也能还原协议）

Dart one-byte 字符串连续存储，Node 直接读：

```bash
node tools/apk_strings.js apk_raw/lib/arm64-v8a/libapp.so "https?://" -o
node tools/apk_strings.js apk_raw/lib/arm64-v8a/libapp.so "package:com_.*?/"    # 还原模块结构
node tools/apk_strings.js apk_raw/lib/arm64-v8a/libapp.so "wire|opvn|server" -c 300   # 带上下文还原语义
```

还原出的东西：
- API 端点（完整 URL 或 `域名 + /path` 片段）
- Dart 模块结构（`package:<pkg>/apis/xxx.dart` → API 客户端位置）
- Method channel 名（`orban.group.wireguard_flutter_plus/wgcontrol` → 原生桥）
- 响应字段名（`openVPNConfigDataBase64` 等）

### Phase 3: 实弹探测（先本机直连，定位拦截层）

```bash
node tools/probe_api.js /server /random/wire/server
```

拦截层判定表（实测经验）：

| 现象 | 拦截层 | 对策 |
|------|--------|------|
| TLS 握手 ECONNRESET | 本地网络 SNI 阻断 | TLS 直连 IP 不带 servername + Host 头 |
| 连接后立即 RST/空 body | 中间设备 | 换出口 |
| 200 但返回 "unsupported" 表 / 403 Forbidden | **服务端 geo 围栏** | 必须换到目标国家的真实出口 |
| nginx 默认页 404 | 明文 80 被默认 vhost 接住 | CONNECT 隧道走 443 |

**关键认知：geo 围栏看 TCP 来源 IP，X-Forwarded-For/Accept-Language 全都无效（实测）。**

### Phase 4: 出口准备（geo 围栏类应用的必经之路）

优先级：
1. 用户本机 V2ray/Clash 切目标国节点（最快）
2. 住宅代理服务（可自动化）
3. 目标国 VPS（可长期值守）

免费公共代理列表基本打不通 geo 门（实测存活率 ~2.5% 且可达者被 MITM 拦）——不要浪费时间在上面。

### Phase 5: 全链路拉取

```bash
# 挂好拉美出口后
node tools/latam_fetch.js                    # 走 127.0.0.1:10808
node tools/latam_fetch.js --direct           # TUN 透明出口
```

产出 `out/countries.json` + `out/wire/<cc>.json` + `out/ovpn/<cc>.b64`。

### Phase 6: 入池 + 压测

- endpoint → `TRYINGOPEN_PROXY_FILE` 静态文件或 fetcher 源
- `node tools/bench.js out/proxies.txt --conc 30` 验存活率/P95
- WG/OVPN 配置可起真隧道 → 隧道内起正向代理（gost）→ 入池获得该国出口能力

## 通用坑清单（每条都实测踩过）

1. **chunked 编码**：手写 TLS 客户端必须解 `N\r\n` 帧
2. **免费代理 80 端口**：明文请求被 nginx 默认 vhost 吃掉，一律 CONNECT 443
3. **免费代理列表现抓现用**：大列表（TheSpeedX）死链 98%；geonode `country=` 过滤 + `lastChecked` 排序质量最高
4. **geonode port 字段双型**：JSON 里可能是数字或字符串，解析用 `any` + `%v`
5. **Firebase 通道可能已废弃**：HTTP 423 = owner 禁用，找新下发通道（通常是自有域名 API）
6. **串行探测防 RST**：同 IP 高频并发会被服务端/中间设备 RST，请求间隔 1-1.5s
7. **device_trust 反模拟器**：Flutter VPN 类常带 root/模拟器检测（`libdevice_trust_native.so`），纯静态逆向不受影响，动态分析时要处理

## 交付物模板

- `docs/REVERSE_REPORT.md`（协议/字段/坑/方法论）
- `docs/ROADMAP.md`（打通路线 + 入池方案 + 验收标准）
- `tools/`（apk_strings / probe_api / fetch / bench 四件套）
- 记忆沉淀（ICM）+ 知识库（memoir）+ 本技能卡更新
