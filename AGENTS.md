# AGENTS.md

## Project

OpenClaw companion plugin that renders **fry-cards style** Feishu/Lark CardKit v2.0 streaming cards for OpenClaw agent runs. Message transport stays with the official `@larksuite/openclaw-lark` channel plugin; this plugin observes OpenClaw's public plugin hooks and takes over the reply presentation with a streaming card (🦞 brand, ported from hermes-fry-cards).

- TypeScript, ESM, Node >= 22, built with tsdown, tested with vitest.
- Plugin identity: `openclaw.plugin.json` (`id: "claw-fry-cards"`), entry `src/index.ts` via `definePluginEntry` (dynamically imported so the pure modules never hard-depend on `openclaw`).

## Commands

```bash
npm install
npm test              # vitest run (80 tests)
npm run typecheck     # tsc --noEmit (strict)
npm run build         # tsdown → dist/index.mjs + dist/index.d.mts
```

## Architecture

```
src/index.ts            插件入口：definePluginEntry + api.on(...) 注册 7 个钩子
src/config.ts           parseConfig：openclaw.json → plugins.entries.claw-fry-cards.config
src/types.ts            OpenClaw 钩子事件本地类型（对齐 2026.8 hook-types）
src/feishu.ts           FeishuClient — fetch 版 lark-oapi 替代：
                          token 缓存 / cardkit create / element.content (PUT) /
                          card update（全量替换）/ batch_update / settings(关流式) / reply
src/controller.ts       ClawCardController — 编排层（唯一有状态类）
src/cardkit/            移植自 hermes-fry-cards cardkit/
  i18n.ts                 zh_cn/en_us 文本映射（LocaleText = {content, i18n_content}）
  markdown.ts             标题降级/表格降级/图片key剥离/长文本分块(2400)
  text.ts                 <thinking>/<antthinking>/Reasoning: 标签解析
  builder.ts              buildStreamingCardV2（占位卡）/ buildCompleteCard（完成卡，
                          统一面板 header: 🦞 model · 💭n · 🔧n · ctx · ⏱️）/ 工具面板
src/streaming/          移植自 hermes-fry-cards streaming/
  session.ts              CardSession 状态机 idle→creating→streaming→completed/aborted/failed
                          + serialized()（per-card 互斥，保证 sequence 单调）
  flush.ts                FlushController 节流（100ms 窗口 / 长空闲 300ms 小批）
  tooluse.ts              ToolUseTracker：工具步骤追踪 + 图标映射 + 脱敏（command/path/search/url）
```

## Key constraints

- **SDK 导入路径**（2026.9.1 实测）：入口必须 `import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry"`。裸的 `openclaw/plugin-sdk` 在宿主 package.json exports 中**不存在**（官方 lark 插件源码里的裸引用是旧约定）；构建产物里不能有 top-level await（OpenClaw 插件加载器不支持，会报 SyntaxError）。
- **安装门槛**：本地目录安装需 `openclaw plugins install <path> --force --accept-capabilities`；安装源目录不能是 world-writable（Docker Desktop / Windows bind mount 会 777，被 `blocked plugin candidate` 拒绝）；package.json 必须有 `openclaw.extensions: ["./dist/index.mjs"]`。
- **钩子权限**：`llm_output` / `agent_end` 被网关归类为可接触对话内容，必须在 openclaw.json 配 `plugins.entries.claw-fry-cards.hooks.allowConversationAccess: true`，否则运行时被 block（插件加载成功但这两个钩子静默失效）。

- **钩子与语义**（详见 `src/types.ts`，与 openclaw 2026.9.1 hook-types 实测对齐）：
  - `message_received`（Observe）→ 建流式卡；`/`开头命令跳过，`/stop` 封卡为停止
  - `before_tool_call` / `after_tool_call`（ctx 带 sessionKey/toolCallId）→ 工具面板 batch_update
  - `llm_output` → model/usage/contextTokenBudget 记录
  - `message_sending`（Modify/gate）→ 返回 `{ cancel: true }` 接管回复；返回 `undefined` 回落官方文本
  - `agent_end` → 5s 宽限后兜底封卡
  - `gateway_stop` → dispose
- **sessionKey 是跨钩子关联键**（`channelId === "feishu"` 过滤渠道）；conversationId / from 里的 `oc_` 前缀 id 用于发消息
- **封卡 = cardkitCloseStreaming + cardkitUpdate（全量替换）**，顺序固定，sequence 必须单调递增；所有 per-card 调用必须经 `serialized(session, fn)` 串行化
- **回落优先**：建卡失败 → `phase=failed`（官方文本照常）；封卡失败 → 删 loading 图标 + 返回 undefined；任何钩子异常不得影响 OpenClaw 主流程
- batch_update 动作语法：`{"action": "partial_update_element", "params": {"element_id", "partial_element"}}`、`{"type": "delete", "element_id"}`、`{"action": "add_elements", "params": {"type": "insert_before", ...}}`
- 流式 loading 图标 img_key 与 fry-cards / 官方 openclaw-lark 同源，跨租户可用（`DEFAULT_LOADING_IMG_KEY`）
- `stripReasoningTags` 必须先删成对块、再删未闭合尾部、最后删游离标签——顺序颠倒会把推理内容泄漏进答案（有测试锁定）
- 完成卡的模型名截断在 `buildCompleteCard` 源头统一生效（统一面板 header 与 footer 保持一致）
- Commit messages: body should use bullet list format (unnumbered `- item`).
