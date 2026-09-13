# 🧪 兼容性测试报告 — claw-fry-cards 对 OpenClaw 各版本宿主

- **版本**：claw-fry-cards 2.0.4（npm 正式包）· 2.0.5-dev（兼容垫片）· 1.0（伴侣插件终版）
- **测试方法**：仿宿主沙箱（真实依赖树 + 递归 Proxy mock，见附录）× **真机**（Docker 2026.9.4 · 飞牛 fnOS 应用 2026.9.4）
- **环境**：Windows x64 · Node 24 · npm registry

## ✅ 结论速览

| 项 | 结论 |
|---|---|
| 兼容下限（无垫片，≤2.0.4）| OpenClaw **2026.5.12**（远低于官方插件时代的 2026.2.26 口径）|
| 兼容下限（2.0.5+ 垫片）| OpenClaw **2026.5.4** |
| 推荐宿主 | **2026.9.4+**（Docker 与飞牛 fnOS 真机 E2E 全链路验证版本）|
| 断崖方向 | 裸导出 `./plugin-sdk` 在 2026.8.1 移除——新宿主跑不了旧插件（官方 openclaw-lark 失效原因），反向无此问题 |

## 📊 兼容性矩阵（最终态）

| OpenClaw 宿主 | 1.0 伴侣插件 | 2.0.4（npm 包）| 2.0.5+（垫片）| 备注 |
|---|---|---|---|---|
| 2026.5.4 | ✅ | ❌ 缺 `plugin-sdk/channel-message` 导出 | ✅ **垫片回落生效** | 负例/下限边界 |
| **2026.5.12** | ✅ | ✅ **实测下限** | ✅ | 下限定位：5.7 无该导出、5.12 起 |
| 2026.6.35 | ✅ | ✅ | ✅ | |
| 2026.7.1 | ✅ | ✅ | ✅ | 与 8.1 契约形状无漂移 |
| 2026.8.1+ | ✅ | ✅ | ✅ | 裸 `./plugin-sdk` 移除（内置插件不受影响）|
| **2026.9.4** | ✅ | ✅ | ✅ **推荐** | Docker + 飞牛 fnOS 真机 E2E 全链路 |

## 🔬 测试方法

### 仿宿主沙箱（加载级）

`npm install openclaw@<版本>` 装出真实宿主依赖树充当沙箱，插件构建产物放入后模拟加载器执行 `import` + `register(递归 Proxy mock)`——覆盖三类死法：裸包解析失败、子路径/命名导出缺失、宿主 API 方法缺失。配套 harness：[compat-test-harness.mjs](compat-test-harness.mjs)。

### 真机（运行级）

- **Docker**：`ghcr.io/openclaw/openclaw:latest`（2026.9.4）+ 插件，飞书 websocket 全链路
- **飞牛 fnOS 应用**：trim.openclaw 应用（Bun 包装层 + 原生网关），同为 2026.9.4——部署排障全程见 [nas-fnos-trip-report.md](nas-fnos-trip-report.md)、通用化指南见 [fnos-deploy-guide.md](fnos-deploy-guide.md)

**沙箱盲区（实证）**：插件兼容垫片首版使用顶层 await（TLA），沙箱（native import）全部通过，真实网关加载器直接 SyntaxError——**模块解析验证不能替代网关加载器语义，发版前必须过真实网关**（已改为 createRequire 同步解析）。

## 🎯 下限定位过程（2026.5.12 的由来）

2026.5.4 失败报缺 `./plugin-sdk/channel-message` 导出（必需子路径中唯一缺失项）→ `npm view openclaw@<版本> exports` 对中间稳定版二分 → 5.7 无、**5.12 起**有（5.7 与 5.12 之间无稳定版）→ 5.12 实测通过。

2.0.5 垫片后：`channel-message` 缺失时自动回落 `channel-runtime`（5.4 同名同签名，8.x 已移除故仅老宿主触发）——**下限从 5.12 下探至 5.4**。

## ✅ 已核对的关键接口

| 插件依赖的宿主 API | 2026.5.4 | 2026.5.12 | 2026.7.1 | 2026.9.4 |
|---|---|---|---|---|
| `api.on` / `logger` / `pluginConfig`（伴侣插件全依赖）| ✓ | ✓ | ✓ | ✓ |
| `registerChannel` / `registerTool` / `registerCommand` / `registerCli` / `registerInteractiveHandler` / `config` / `runtime`（通道插件依赖）| ✓ | ✓ | ✓ | ✓ |
| `ChannelPlugin` 契约必填项（id / meta / capabilities / config）| ✓ | ✓ | ✓ | ✓ |
| 垫片回落路径 `plugin-sdk/channel-runtime` | ✓ | ✓ | ✓（未触发）| ✗（不需要）|

## ⚠️ 范围与已知限制

1. **沙箱为加载级验证**：模块解析 + 注册 + 契约核对；卡片流转、飞书收发等运行级行为以 Docker/飞牛真机 E2E 为准（均已通过）
2. **统一面板指标**读 agent transcript SQLite：老宿主无此库时优雅降级（面板自动省略指标段，卡片与回复不受影响）
3. **fnOS 应用的差异全在 wrapper 层**（配置写入/preflight/进程管理，详见 [fnos-deploy-guide.md](fnos-deploy-guide.md) 坑 ①②③），不影响插件加载语义
4. claw-fry-cards 1.0 README 口径 ≥2026.2.26：实测覆盖至 5.4 通过，更早未测（其 API 面极小，风险低）

## 📎 附录：沙箱复现

```bash
mkdir sandbox && cd sandbox && npm init -y
npm install openclaw@2026.5.12 zod image-size @sinclair/typebox@0.34.49 @larksuiteoapi/node-sdk
# 插件 dist 放入 sandbox/plugin/dist 后：
node docs/compat-test-harness.mjs <sandbox>/plugin/dist/index.mjs withcfg
```
