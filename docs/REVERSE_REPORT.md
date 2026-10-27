# VPN.lat 逆向报告（2026-10-27/28）

> 目标 APK：`VPN.lat v3.9.61 b7793 (Premium By ElaMods).apk`（37.5MB）
> 分析环境：Windows 10，无 jadx/apktool，纯 zip 解包 + Node 二进制字符串挖掘

## 1. APK 结构

```
classes.dex ×7          # Java/Kotlin 层（VPN 引擎胶水）
lib/arm64-v8a/
  libapp.so             # ★ Flutter Dart AOT —— 全部业务逻辑在这里
  libflutter.so         # Flutter 引擎
  libopenvpn.so / libovpnexec.so / libopvpnutil.so   # OpenVPN 3 引擎
  libwg-go.so / libwg.so / libwg-quick.so            # WireGuard Go 引擎
  libdevice_trust_native.so  # 反模拟器/root 检测（Java_com_mikoloy_device_1trust_DeviceTrustNative_collectNativeSignals）
  libnative-lib.so           # 崩溃信号处理（原包名 com.vpn.free.hotspot.secure.vpnify）
  libelamods.so / "El-a Mo-ds.so"  # ElaMods 破解层（Premium 解锁）
assets/
  flutter_assets/       # Flutter 资源
  pie_openvpn.* / nopie_openvpn.*  # OpenVPN 二进制（各 ABI）
```

关键库清单（`pubspec` 推断）：
- `wireguard_flutter_plus`（method channel: `orban.group.wireguard_flutter_plus/wgcontrol`、`/wgstage`）
- `openvpn_flutter`（`id.laskarmedia.openvpn_flutter/vpncontrol`、`/vpnstage`）
- `device_trust`（root/模拟器检测，服务端校验）

## 2. 应用包名与 Dart 模块

```
包名: com.vpn.lat
Dart 模块:
  package:com_vpn_lat/apis/vpn_lat_api.dart     # ★ 节点 API 客户端
  package:com_vpn_lat/models/vpn.dart           # Vpn 模型
  package:com_vpn_lat/models/country_model.dart # CountryModel.fromJson
  package:com_vpn_lat/models/city_model.dart    # CityModel.fromJsonConfig（城市级配置）
  package:com_vpn_lat/screens/home_screen.dart
  package:com_vpn_lat/screens/location_screen_city.dart
  package:com_vpn_lat/helpers/cache_config.dart # 配置缓存
  package:com_vpn_lat/helpers/network_config.dart
  package:com_vpn_lat/screens/network_test_screen.dart
```

## 3. API 协议（已验证）

### 3.1 端点

| 端点 | 用途 | 验证状态 |
|------|------|---------|
| `https://hetecn.com/server` | 国家/地区表（getRegionalData） | ✅ 实测 200（返回 unsupported 表=geo 拦截） |
| `https://hetecn.com/random/wire/server` | 随机 WG 节点 | ✅ 端点存在（403=geo 拦截） |
| `https://hetecn.com/wire/server/<cc>` | 指定国家 WG 配置 | ✅ 端点存在（403=geo 拦截） |
| `https://hetecn.com/opvn/server/<cc>` | 指定国家 OpenVPN 配置 | ✅ 端点存在（403=geo 拦截） |
| `http://ip-api.com/json/` | 客户端自身 IP 查询（getIPDetails） | 公共 API |
| `https://vpn-lat.firebaseio.com` | 旧配置通道 | ❌ 423 已被 owner 禁用 |

服务器 IP：`54.39.108.255`（OVH，nginx/1.26.3）

### 3.2 请求特征

- UA：Flutter dart:io HttpClient 默认 `Dart/3.5 (dart:io)`（未观测到自定义 header；应用内唯一自定义头线索是 `deviceId` 字段名，用于 device_trust 上报，非 HTTP 头）
- 响应：`application/json; charset=utf-8`，chunked

### 3.3 已验证响应样本

`/server` 在非支持国家返回（834B）：

```json
[{"country":"Your country is not supported by VPN.LAT","shortcountry":"GB","category":"unsupported"},
 {"country":"Tu país no está soportado por VPN.LAT","shortcountry":"ES","category":"unsupported"},
 ...]  // GB ES RU PT FR DE IT ID
```

推论：支持国家（拉美）返回真实国家表 `{country, shortcountry, category:"supported", cities:[...]}` 结构，城市对象经 `CityModel.fromJsonConfig` 解析。

### 3.4 OpenVPN 配置下发

字段名 `openVPNConfigDataBase64` —— 服务端返回 base64 编码的 .ovpn 文本，客户端 decode 后交给 OpenVPN3 引擎。

### 3.5 WireGuard 配置拼装

Dart 层未发现 `[Interface]`/`PrivateKey` 模板字符串 → WG 配置在**服务端拼好整体下发**（或经 `wireguard_flutter_plus` 原生层解析），需 LATAM 出口拉到实际响应确认字段。

## 4. 地理围栏机制（阻塞点）

1. 服务端按 TCP 连接来源 IP 做 GeoIP 判定（非请求头，X-Forwarded-For 无效，已实测）
2. 非支持国家：`/server` 返回 unsupported 表；`/wire/*` `/opvn/*` `/random/*` 返回 `403 {"error":"Forbidden"}`
3. 支持地区：拉美（西语/葡语系国家，从多语言文案推断：AR/BR/MX/CO/PE/CL/EC/VE/UY/PY/BO/GT/DO 等）
4. Accept-Language 头不影响判定（实测）

## 5. 网络坑与绕过（实测记录）

### 5.1 本地 SNI 阻断
- 现象：带 `hetecn.com` SNI 的 ClientHello → ECONNRESET
- 绕过：`tls.connect({host:'54.39.108.255', rejectUnauthorized:false})` 不传 `servername`，HTTP 层带 `Host: hetecn.com` → 200 通
- 注意：仅绕本地阻断；geo 判定看真实出口 IP，无 SNI 也没用

### 5.2 免费代理转发 80 端口
- 现象：明文 `http://hetecn.com/server` 经免费代理 → nginx 默认 vhost 404
- 正确姿势：`CONNECT hetecn.com:443` 隧道 → TLS → 再发请求

### 5.3 手写 TLS 客户端 chunked
- 响应 Transfer-Encoding: chunked，需手动解 `N\r\n` 长度帧

### 5.4 免费拉美代理质量
- TheSpeedX 全量大列表：3050 个中 ip-api 筛出 187 个 LATAM，实测 341 失败/6 可达
- geonode `country=` 过滤：437 个候选，可达率仍 ~2.5%，且可达者打 hetecn 返回空 body（代理侧 MITM/拦截）
- 结论：免费代理打不通 geo 门，**必须真实拉美出口**（住宅代理或 VPN 节点）

## 6. Firebase 通道

```
GET https://vpn-lat.firebaseio.com/.json → 423
{"error": "The Firebase database 'vpn-lat' has been disabled by a database owner."}
```
节点下发已全量迁移到 hetecn.com。

## 7. 后续打通路线

1. 挂拉美出口（任意 AR/BR/... 节点）
2. `node tools/latam_fetch.js` 一键拉 `/server` → 国家表 → 逐国 `/wire/server/<cc>` + `/opvn/server/<cc>`
3. 落盘节点 JSON + OVPN base64 → 解析 endpoint
4. 接入 new-api tryingopen 代理池（静态文件 `TRYINGOPEN_PROXY_FILE` 或新增 fetcher 源）
5. `node tools/bench.js` 压测验收

## 8. 方法论（可复用）

Flutter APK 逆向不依赖 jadx 的最小路径：
1. `unzip` 解包 → `lib/arm64-v8a/libapp.so` 是 Dart AOT 快照
2. Node 读文件转 latin1 字符串，正则提取 URL/路径/字段名（Dart one-byte 字符串连续存储，上下文 ±300B 可还原语义）
3. `package:xxx/yyy.dart` 字符串还原模块结构；method channel 名还原原生桥
4. API 端点直接实弹探测：UA 伪装 + 无 SNI 绕阻断 + 响应长度/内容比对定位拦截层
