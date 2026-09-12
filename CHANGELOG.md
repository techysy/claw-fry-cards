# Changelog

## 2.0.1 (2026-09-12)

2.0.0 发布审查后的修正版（元数据与文档层面，无引擎代码变更）。

- 🔖 `openclaw.plugin.json` 显示名 `OpenClaw Lark Cards` → `Claw Fry Cards`（2.0.0 漏改项，插件列表可见）
- 📝 Issue 模板更名：bug_report 插件版本字段 openclaw-lark → claw-fry-cards；config.yml 的 Ideas / Q&A 链接从官方 larksuite/openclaw-lark discussions 改指本仓库（已启用 Discussions）
- 📦 package.json 补 `repository` 字段（npm 包主页源码链接）
- 🧪 兼容性测试 harness 入库（`docs/compat-test-harness.mjs`），报告附录改为引用仓库内路径
- 🧹 测试临时目录前缀 openclaw-lark-tool-use → claw-fry-cards-tool-use

## 2.0.0 (2026-09-12)

**主线转向通道插件形态** — 前身 [claw-lark-cards](https://github.com/techysy/claw-lark-cards)（官方 openclaw-lark 的 2.0 适配 fork）合并入本仓库并更名，claw-lark-cards 仓库同步废弃。1.0 伴侣插件形态保留于 `v1.0.0` 标签，按需降级使用。

- 🦐→🍤 形态升级：由"钩子伴侣插件"转为**通道插件**——官方通道 2.0 全量适配（SDK 导出路径迁移 100+ 处、`OpenClawConfig` 类型迁移、会话存储迁移 agent transcript SQLite），替换官方 `@larksuite/openclaw-lark`
- 🍤 卡片引擎内置：派发即建卡、CardKit streaming_mode 打字机、原生 reasoning 展示（1.0 仅支持回复文本中的 `<thinking>` 标签）、统一指标面板、状态边框
- 🧰 继承官方全部工具契约（im / doc / wiki / drive / bitable / sheet / calendar / task / oauth 等 38 项）与 skills
- 🔖 插件标识更名：`openclaw-lark` → `claw-fry-cards`；用户配置 `plugins.entries.openclaw-lark` 改为 `plugins.entries.claw-fry-cards`（`channels.feishu` 不变）
- 🧪 实测兼容下限 OpenClaw **2026.5.12**（低于前身 README 宣称的 2026.8.1，见 `docs/compat-test-report.md`）；老版本宿主统一面板自动省略指标段
- 🗑️ 移除 1.0 伴侣插件代码（`src/cardkit` / `src/streaming` / `controller.ts` 等），仅在 `v1.0.0` 标签中保留

## 1.0.0 (2026-09-06)

首个版本（原版本号 2026.9.1，日期式风格）— fry-cards 卡片样式的 OpenClaw 移植版。

- 🍤 OpenClaw 伴侣插件：官方飞书通道（`@larksuite/openclaw-lark`）继续负责消息收发，本插件通过公开钩子接管回复展示
- 🎴 CardKit v2.0 流式占位卡（`streaming_mode` + loading 图标 + 工具面板），`message_received` 触发创建
- 🔧 工具面板实时刷新（`before_tool_call` / `after_tool_call`）：图标映射、Running/Succeeded/Failed 状态、耗时、脱敏后的命令/路径/URL 预览
- ✍️ 回复打字机：`message_sending` 将答案写入 `streaming_content`（100ms 分片，长回复按 `typewriter_max_ms` 自动加速），完成后 `{ cancel: true }` 接管官方文本回复
- 🎯 完成态统一面板：`🍤 模型 · 💭n · 🔧n · 上下文 [███▓▒░░░] x% · ⏱️ 耗时`，边框颜色随状态（绿/黄/红）
- 🧠 `<thinking>` / `<antthinking>` / `Reasoning:` 标签剥离进统一面板
- 🛡️ 全链路回落：建卡/封卡失败、卡片超时（`stale_timeout_sec`）、交互组件消息均回落官方通道文本；封卡失败降级删除 loading 图标防卡片残留转圈
- 🌐 卡片文案 zh_cn / en_us 双语，跟随飞书客户端语言
- 🔒 工具参数脱敏（token/api_key/Authorization/--flag 与路径 basename 化）
- ✅ vitest 80 tests（i18n / markdown / text / tooluse / flush / builder / feishu / controller / config），tsc strict 通过
