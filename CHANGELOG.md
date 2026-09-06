# Changelog

## 0.1.0 (2026-09-06)

首个版本 — fry-cards 卡片样式的 OpenClaw 移植版。

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
