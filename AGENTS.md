# AGENTS.md

## Project

**claw-fry-cards** — OpenClaw 飞书/Lark **通道插件**（id: `claw-fry-cards`），基于官方 [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark)（MIT）做 OpenClaw 2.0 SDK 适配，并内置 fry 风格 CardKit v2.0 流式卡片引擎（🍤 虾条卡片）。

- TypeScript, ESM, Node >= 22, 构建用 tsdown，测试用 vitest，安装依赖需 `npm install --legacy-peer-deps`（官方 fork 的 peer 依赖约束）。
- 入口 `index.ts`：`definePluginEntry`（来自 `openclaw/plugin-sdk/plugin-entry`）注册通道 + 38 项工具契约 + hooks + CLI 诊断命令。
- 版本线：**1.0（钩子伴侣插件形态）保留在 `v1.0.0` 标签**；main 为 2.0 通道插件。前身 claw-lark-cards 仓库已废弃合并至此。

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
skills/                  官方技能目录（openclaw.plugin.json 声明）
```

## Key constraints

- **插件 id 已从 `openclaw-lark` 更名为 `claw-fry-cards`**（package.json / openclaw.plugin.json / index.ts 三处一致）；用户配置键 `plugins.entries.claw-fry-cards`，通道配置 `channels.feishu` 不变。
- 流式卡片三层开关缺一不可：`streaming: true` → `replyMode`（streaming/auto）→ `toolUseDisplay`（默认开）。
- 统一面板指标来源是 agent transcript SQLite（`~/.openclaw/agents/<agent>/agent/openclaw-agent.sqlite`）；读取失败时静默省略指标段，不报错。
- 宿主兼容实测下限 OpenClaw **2026.5.12**（低于前身 README 曾宣称的 2026.8.1），见 `docs/compat-test-report.md`；SDK 子路径导出以宿主 package.json 的 exports 为准，裸的 `openclaw/plugin-sdk` 在宿主 ≥2026.8.1 已移除。
- 构建产物分 chunk（`index.mjs` + `monitor-<hash>.mjs`），部署时需全部拷贝并清理旧 hash 残留。
- 本地安装：`openclaw plugins install . --force --accept-capabilities`；安装源目录不能 world-writable（777 会被 `blocked plugin candidate` 拒绝）。
- 版本号用三位 semver（1.0.0 / 2.0.0…），发版打 `v<版本>` 标签。
- Commit messages: body should use bullet list format (unnumbered `- item`).
