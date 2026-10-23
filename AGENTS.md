# AGENTS.md

## Project

**claw-fry-cards** — OpenClaw 飞书/Lark **通道插件**（id: `claw-fry-cards`），基于官方 [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark)（MIT）做 OpenClaw 2.0 SDK 适配，并内置 fry 风格 CardKit v2.0 流式卡片引擎（🍤 虾条卡片）。

- TypeScript, ESM, Node >= 22, 构建用 tsdown，测试用 vitest，安装依赖需 `npm install --legacy-peer-deps`（官方 fork 的 peer 依赖约束）。
- 入口 `index.ts`：`register(api)`（普通对象字面量导出，非 `definePluginEntry`）注册通道 + 39 项工具契约 + hooks + CLI 诊断命令。
- 版本线：main 为**插件自身 3.x** 通道插件（唯一维护线，当前 v3.1.0+）；形态自 2.0 起固定为通道插件。**1.0（钩子伴侣插件形态）保留在 `v1.0.0` 标签**，自 2026-09-13 起冻结，仅为历史降级保留，新装不要checkout。前身 claw-lark-cards 仓库已废弃合并至此。

## Commands

```bash
npm install --legacy-peer-deps
npm test              # vitest run
npm run typecheck     # tsc --noEmit
npm run build         # tsdown → dist/（index.mjs + monitor-<hash>.mjs 分 chunk）
npm run lint          # eslint src/ index.ts secret-contract-api.ts
```

## Architecture

```
index.ts                 插件入口：register() 注册通道/工具/hooks/CLI；re-export 对外 API
src/card/                卡片引擎（fry 风格核心）
  builder.ts               卡片 JSON 构建（含统一面板 header）
  cardkit.ts               CardKit 开放 API 封装（create/element.content/update）
  streaming-card-controller.ts  流式卡控制器（统一面板指标读 transcript SQLite）
  flush-controller.ts      节流刷新（timer + mutex + reflush-on-conflict）
  reply-dispatcher.ts      回复分发（streaming/static/auto 场景路由）
  tool-use-display.ts / tool-use-trace-store.ts   工具步骤展示与追踪
  reasoning-utils.ts       原生 reasoning 处理
src/channel/             feishu 通道实现（websocket 长连接、账号、探针）
src/messaging/           收发消息、媒体、converters（interactive 卡片消息解析）
src/tools/               oapi（bitable/calendar/chat/drive/im/sheets/task/wiki）+ mcp 文档工具 + oauth
src/commands/            feishu-diagnose 诊断 CLI
src/core/                LarkClient（@larksuiteoapi/node-sdk 封装）、logger、targets、安全检查
  channel-message-compat.ts  channel-message 垫片（channel-outbound→channel-message→channel-runtime）
  command-auth-compat.ts     command-auth 垫片（10.x 重建组合器；≤9.x 透传）
  session-store-compat.ts    session-store 垫片（getSessionEntry；≤9.x 回落旧全量存储对）
  sdk-compat.ts              readReactionParams 签名适配（2026.3.14 起变更）
skills/                  官方技能目录（openclaw.plugin.json 声明）
```

## Key constraints

- **插件 id 已从 `openclaw-lark` 更名为 `claw-fry-cards`**（package.json / openclaw.plugin.json / index.ts 三处一致）；用户配置键 `plugins.entries.claw-fry-cards`，通道配置 `channels.feishu` 不变。
- 流式卡片开关按宿主代际：2026.9.4+ 宿主 `streaming: { mode: "partial" }`（`replyMode` 已废弃）；旧宿主 `streaming: true` + `replyMode`。插件端两代兼容（2.0.2 起）。
- **`streaming`/`replyMode` 必须写在 `channels.feishu`（通道账号配置）下**，不是 `plugins.entries.claw-fry-cards.config`——插件 configSchema 只声明 `panel`，写到 plugin config 里的 `feishu` 块会被静默忽略（网关不报错不警告），回复模式解析退化为 `static`（纯文本无卡片）。判定证据看日志 `reply-dispatcher` 的 `reply mode resolved` 探针行（注意：该探针源码在 `src/card/reply-dispatcher.ts`，但**打包后落在 `monitor-<hash>.mjs` chunk**，在 `index.mjs` 里 grep 不到；且在默认日志级别下未必输出——验证 reply mode 优先看回复本身是卡片还是纯文本）。真实事故：2026-10-08 Docker 部署配置错位排查半天才定位。TODO：后续版本可在插件启动时对 plugin config 中未识别键打 warning（网关 schema 校验目前是 loose 的）。
- 统一面板指标来源是 agent transcript SQLite（`~/.openclaw/agents/<agent>/agent/openclaw-agent.sqlite`）；读取失败时静默省略指标段，不报错。
- 宿主兼容下限 OpenClaw **2026.5.4**（2.0.5 起 channel-message 垫片回落 channel-runtime；无垫片的 2.0.4 为 ≥2026.5.12），见 `docs/compat-test-report.md`；SDK 子路径导出以宿主 package.json 的 exports 为准，裸的 `openclaw/plugin-sdk` 在宿主 ≥2026.8.1 已移除。
- **宿主 2026.10.3 断崖与三类破坏**（3.1.0 适配）：① 子路径移除（`channel-message`、`command-auth` 等 9 个）；② **子路径仍在但具名导出被删**（`session-store-runtime` 的 `loadSessionStore`/`resolveSessionStoreEntry`）——这类**子路径比对查不到**，import 期直接 SyntaxError 且 `try/catch` 救不了，**升级评估必须逐符号核对值导入，不能只比子路径**。三个垫片：`src/core/channel-message-compat.ts`（channel-outbound→channel-message→channel-runtime 三代回落）、`src/core/command-auth-compat.ts`（10.x 用存活原语按原语义重建组合器；≤9.x 透传）、`src/core/session-store-compat.ts`（`getSessionEntry`；≤9.x 回落旧全量存储对）。三者均用 `createRequire` 同步解析、禁 TLA。**已在真实 `ghcr.io/openclaw/openclaw:2026.10.3` 生产容器（带真实飞书凭据）全链路实测**：插件加载 enabled、网关 healthy、飞书 websocket `client ready`、真实群消息进出（`dispatch complete (queuedFinal=true, replies=1)`）、`progressCard.get` 成功、回复经人工确认为 🍤 卡片（reply mode 未退化）、三垫片命中 10.x 分支、重建鉴权逻辑与 9.4 原实现四种用例结果一致。**2026.10.6 已就地升级复测通过**（同一生产容器仅换镜像，插件未改动）：`plugin-sdk` 子路径 344→345 无新增移除（插件所需 26 个仍只缺 `channel-message`/`channel-runtime`/`command-auth` 这 3 个 10.3 已删项）、具名导出只增不减、宿主自动迁移 agent DB `v24→v25`、插件 enabled、飞书 websocket ready、容器 healthy、真实群消息收发正常且回复人工确认为 🍤 卡片（reply mode 未退化）；官方 feishu 插件未回装。**当前推荐宿主：2026.10.6**。
- ⚠️ **升级到 2026.10.x 后必查：宿主会自动安装并启用官方 `@openclaw/feishu` 通道插件，与本插件抢占 `feishu` 通道**（实测 2026-10-15：升级前 `plugins.entries` 仅 `claw-fry-cards`，升级后宿主自动加入 `feishu` 并置 enabled，日志报 `channel already registered: feishu (claw-fry-cards)`；本插件先注册而保住通道，但官方插件仍 enabled 并尝试另起连接，状态混乱）。**修复：`openclaw plugins disable feishu`**（使 `plugins.entries.feishu = {"enabled":false}`），重启后冲突消失。这与插件代码无关，是宿主的自动启用行为，**每次宿主大版本升级后都要复查**。⚠️ 改用卸载清理时：`openclaw plugins uninstall feishu --force` **会连带删除 `channels.feishu`（appId/appSecret/群策略）**，而这是本插件的通道配置——必须先导出、卸载后立即写回并逐字段比对（2026-10-23 实测，卸载后 `channels.feishu` 确为 ABSENT，恢复后 13 键一致）；卸载会自动清除 `plugins.entries.feishu`。
- 构建产物分 chunk（`index.mjs` + `secret-contract-api.mjs` + `monitor-<hash>.mjs`），部署时需全部拷贝并清理旧 hash 残留；`secret-contract-api.mjs` 是插件根目录发现 shim（`secret-contract-api.js`）的 re-export 目标（密钥字段解析依赖），漏拷会导致通道无法认证。
- 本地安装：`openclaw plugins install . --force --accept-capabilities`；安装源目录不能 world-writable（777 会被 `blocked plugin candidate` 拒绝）。
- 版本号用三位 semver（1.0.0 / 2.0.0 / 3.0.0…），发版打 `v<版本>` 标签。
- Commit messages: body should use bullet list format (unnumbered `- item`).
