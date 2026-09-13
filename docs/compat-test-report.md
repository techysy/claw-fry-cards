# 🧪 兼容性测试报告 — 两代插件对 OpenClaw 老版本宿主

- **日期**：2026-09-12（首轮）· 2026-09-13（2.0.4 复测轮 + 飞牛 NAS 真机场景）
- **被测对象**：claw-fry-cards 1.0（钩子伴侣插件，commit `f8a22e5`）· claw-lark-cards（通道插件，v2026.9.12）· **claw-fry-cards 2.0.4（npm 正式包，复测轮）** · **claw-fry-cards 2.0.5-dev（飞牛真机场景）**
- **测试环境**：Windows x64 · Node v24.20.0 · npm 直连 registry · 飞牛 NAS（fnOS，x86_64，trim.openclaw fnOS 应用）
- **结论**：**通道插件的兼容下限是 OpenClaw 2026.5.12**（首轮以 claw-lark-cards 实测，2.0.4 复测轮边界不变）；兼容垫片（2.0.5 起）进一步下探至 **2026.5.4**；claw-fry-cards 1.0 在 2026.5.4 仍可通过。

---

## 🐬 飞牛 NAS 真机场景（2026-09-13，fnOS trim.openclaw 应用）

完整部署与排障行程见 [nas-fnos-trip-report.md](nas-fnos-trip-report.md)，此处记录兼容性相关结论。

### 环境画像

| 项 | 值 |
|---|---|
| 架构 | fnOS 应用（**非 Docker**）：Bun 包装层（端口 5666）+ OpenClaw 网关原生进程 |
| 升级后宿主 | OpenClaw **2026.9.4**（应用「检查更新」升级）+ Node 24.17.0（见下） |
| 运行用户 | `trim.openclaw`（nologin 专用用户）；SSH 免密用户 yangyu 仅 Administrators 组 |
| 状态树 | `/vol4/@apphome/trim.openclaw/data/home/.openclaw/`（openclaw.json / agents / extensions / logs）|

### 兼容性发现与处置

| # | 发现 | 处置 |
|---|---|---|
| 1 | 升级后 preflight 拒绝 fnOS nodejs_v24 的 Node 24.15.0（node:sqlite NUL 截断 bug，nodejs/node#61954，24.16+ 修复）→ 网关起不来 | 安装独立 Node 24.17.0（应用目录内）+ `nodejs_v24` node 二进制原地升级（备份保留，claude-code 等共用方受益）|
| 2 | 5.4 时代配置被 9.4 schema 拒绝 | `doctor --fix` 自动迁移（先备份）|
| 3 | 包装层**无条件重写** 9.4 已废弃的配置键（`gateway.controlUi.allowInsecureAuth`、根级 `cli`）→ 每次启动把配置写坏 | 包装层补丁（屏蔽写入，备份 `server/index.js.bak-nodefix`）+ 清理已写入键；**应用重启后才生效**（Bun 进程跑旧代码）|
| 4 | 状态树属主污染（以 yangyu 手动跑网关，1.3 万+文件属主变 yangyu）→ 宿主属主/权限安全检查连锁拒绝 | 借 docker 组权限容器化 chown 归属 `trim.openclaw` + 收紧 world/group write |
| 5 | 官方 feishu 插件被网关自动装回 → 双 feishu 通道冲突 | `plugins uninstall feishu`（注意会连带删 `channels.feishu` 配置，需重建）|

### 结果

- claw-fry-cards 2.0.5-dev 在 NAS 真机加载运行 ✓（通道页/插件设置页中文化生效、卡片面板完整）
- 卡片 E2E ✓（用户飞书截图确认）+ 面板上下文段依赖模型条目 `contextWindow`（UI 添加模型时易漏，见排障记录）
- 峰谷价 `peakValley` 谷段显示验证 ✓（周日晚谷段 → 梁文谷⚡️）

### 对兼容矩阵的增量结论

- **下限 2026.5.12 之外新增垫片路径**：`plugin-sdk/channel-message` 导出在 5.4 缺失，但同名函数经 `plugin-sdk/channel-runtime` 可用（2.0.5 垫片自动回落）→ 兼容下限实际可下探至 **2026.5.4**（负例边界从 5.4 移至更早版本，未再向下探测）
- **fnOS 应用的宿主形态差异不影响插件加载语义**（9.4 内核一致），差异全在 wrapper 层（配置写入/preflight/进程管理）
- **加载级沙箱盲区实证**：垫片首版用顶层 await（TLA），沙箱 harness 全过、真实网关加载器 SyntaxError——**发版前必须过真实网关**（已改为 createRequire 同步解析）

---

## 🔁 2.0.4 复测轮（2026-09-13，npm 正式包产物）

被测对象改为 **npm registry 上的 `claw-fry-cards@2.0.4` tarball**（即用户实际安装的产物），沙箱与 harness 同首轮。

| OpenClaw 宿主 | 🍤 claw-fry-cards 2.0.4（npm 包）|
|---|---|
| 2026.5.4 | ❌ 同首轮：缺 `plugin-sdk/channel-message` 导出（**下限边界无漂移**）|
| 2026.5.12 | ✅ 加载 + 注册通过 |
| 2026.6.35 | ✅ |
| 2026.7.1 | ✅ |
| 2026.9.4 | ✅ |

2.0.4 相对首轮的增量（新配置键 `panel.peakValley` / `modelAliasesEnabled` / `truncateModelName`、configSchema 声明、uiHints）全部位于插件自有配置面，不新增宿主 API 依赖——矩阵与首轮一致，下限维持 **2026.5.12**。

---

## 📊 首轮实测矩阵（2026-09-12）

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
3. 飞牛真机场景的属主/权限/包装层问题属 fnOS 应用形态特有（普通 Docker/npm 部署不涉及）。
4. claw-fry-cards 1.0 的 README 声称支持 ≥2026.2.26，本次实测覆盖到 2026.5.4 通过；更早版本未测（其 API 面极小，风险低）。

## 📎 附录：沙箱复现

测试 harness 已入库：[`docs/compat-test-harness.mjs`](compat-test-harness.mjs)（递归 Proxy mock，记录插件触碰的完整 API 面）。

```bash
mkdir sandbox && cd sandbox && npm init -y
npm install openclaw@2026.5.12 zod image-size @sinclair/typebox@0.34.49 @larksuiteoapi/node-sdk
# 插件 dist 放入 sandbox/plugin-lark/dist 后：
node docs/compat-test-harness.mjs <sandbox>/plugin-lark/dist/index.mjs withcfg
# 输出：import 阶段解析结果 → register 阶段 → 触碰的 API 面 → PASS
```
