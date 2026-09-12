# 🧪 兼容性测试报告 — 两代插件对 OpenClaw 老版本宿主

- **日期**：2026-09-12
- **被测对象**：claw-fry-cards 1.0（钩子伴侣插件，commit `f8a22e5`）· claw-lark-cards（通道插件，v2026.9.12）
- **测试环境**：Windows x64 · Node v24.20.0 · npm 直连 registry
- **结论**：**claw-lark-cards 的真实兼容下限是 OpenClaw 2026.5.12**，低于其 README 宣称的 2026.8.1；claw-fry-cards 1.0 在 2026.5.4 仍可通过。

---

## 📊 实测矩阵

| OpenClaw 宿主 | 🍤 claw-fry-cards 1.0 | 🦐 claw-lark-cards |
|---|---|---|
| 2026.5.4 | ✅ 加载 + 注册通过 | ❌ `ERR_PACKAGE_PATH_NOT_EXPORTED`（缺 `plugin-sdk/channel-message` 导出）|
| **2026.5.12** | ✅ | ✅ **通过（实测下限）** |
| 2026.6.35 | ✅ | ✅ |
| 2026.7.1 | ✅ | ✅（API 面 10/10 · 通道契约必填项 4/4）|
| 2026.8.1+ | ✅ | ✅（README 实测口径）|

## 🔬 测试方法（仿宿主沙箱）

模拟 OpenClaw 插件加载器的真实行为，三层验证：

1. **加载层**：`npm install openclaw@<版本>` 装出真实宿主依赖树充当沙箱，把插件构建产物（`dist/index.mjs` 等）放入沙箱内，Node ESM 动态 import——能捕获裸包解析失败、子路径导出缺失、命名导出不存在（`ERR_MODULE_NOT_FOUND` / `ERR_PACKAGE_PATH_NOT_EXPORTED`）。
2. **注册层**：对插件的 `default` 导出调用 `register(mockApi)`，mock 用递归 Proxy 记录插件触碰的完整 API 面——任何缺失的宿主方法都会显形。
3. **契约层**：静态比对宿主 `.d.ts` 类型定义——`OpenClawPluginApi` 成员、`ChannelPlugin` 必填成员（`id` / `meta` / `capabilities` / `config`，其余可选，`configPrefixes` 在可选的 `reload` 内），确认 7.1 与 8.1 契约形状无漂移。

## 🎯 下限确定过程

- 2026.5.4 实测失败，报缺 `./plugin-sdk/channel-message` 导出（9 个必需子路径中唯一缺失项）。
- 用 `npm view openclaw@<版本> exports` 对中间稳定版做二分：5.5 / 5.6 / 5.7 均无该导出，**5.12 起有**（5.7 与 5.12 之间无稳定版）。
- 2026.5.12 沙箱实测：两插件均加载 + 注册通过。

## ✅ 已核对的关键接口（2026.7.1 / 6.35 宿主）

| 插件需要的 API | 7.1 | 6.35 | 5.12 |
|---|---|---|---|
| `api.on` / `api.logger` / `api.pluginConfig`（fry-cards 全部依赖）| ✓ | ✓ | ✓ |
| `api.registerChannel` / `registerTool` / `registerCommand` / `registerCli` / `registerInteractiveHandler` / `config` / `runtime`（lark-cards 依赖）| ✓ | ✓ | ✓ |
| `ChannelPlugin` 契约必填项（id / meta / capabilities / config）| ✓ | ✓ | ✓ |

## ⚠️ 范围与保留

1. **这是加载级测试，不是端到端**：排除了老宿主上的主要死法（模块解析、导出缺失、API 方法缺失、通道契约不满足），但真实卡片流转（websocket 收发、CardKit 流式渲染）需连接真实飞书应用验证。
2. **统一面板指标的降级**：模型/token/上下文段读 agent transcript SQLite（2.0 会话存储）。老宿主无此库时代码路径为 `catch → return undefined`，仅面板缺指标段，卡片与回复不受影响（`streaming-card-controller.ts` 已核）。
3. claw-fry-cards 1.0 的 README 声称支持 ≥2026.2.26，本次实测覆盖到 2026.5.4 通过；更早版本未测（其 API 面极小，风险低）。

## 📎 附录：沙箱复现

```bash
mkdir sandbox && cd sandbox && npm init -y
npm install openclaw@2026.5.12 zod image-size @sinclair/typebox@0.34.49 @larksuiteoapi/node-sdk
# 插件 dist 放入 sandbox/plugin-lark/dist 后：
node harness.mjs <sandbox>/plugin-lark/dist/index.mjs withcfg
# harness：import 插件入口 → register(递归 Proxy mock) → 输出 API 面与结果
```
