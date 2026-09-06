# 🦞 小龙虾卡片 (claw-fry-cards)

> 🦞 OpenClaw 飞书流式卡片插件 — fry-cards 风格的 CardKit v2.0 卡片：实时工具进度 · 统一面板 · 打字机收尾

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-%E2%89%A52026.2.26-2463eb)](https://docs.openclaw.ai)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522-blue)](https://nodejs.org/)

**claw-fry-cards** 是 [🍟 hermes-fry-cards](https://github.com/techysy/hermes-fry-cards)（薯条卡片）的小龙虾版本：同样的卡片审美（🍟→🦞），平台从 Hermes Gateway 换到 [OpenClaw](https://openclaw.ai)。

- [安装指南](INSTALL.md) · [🍟 原版薯条卡片](https://github.com/techysy/hermes-fry-cards)

---

## 它是怎么工作的

OpenClaw 的飞书消息收发由官方通道插件 [`@larksuite/openclaw-lark`](https://github.com/larksuite/openclaw-lark) 负责；本插件是一个**伴侣插件**，通过 OpenClaw 公开钩子观测同一轮对话，用自建 CardKit v2.0 卡片接管回复展示：

```
用户消息 ──▶ message_received ──▶ 创建流式占位卡（🦞 处理中 + 工具面板 + loading）
   │
   ├─ before/after_tool_call ──▶ 工具面板实时刷新（图标 / 状态 / 耗时 / 结果预览）
   ├─ llm_output ──────────────▶ 记录模型名、token 用量、上下文窗口
   │
   └─ message_sending ──▶ 答案写入卡片打字机（CardKit streaming_mode）
                          └─▶ 关流式 + 全量替换完成态卡（统一面板）＋ cancel 官方文本回复
```

- 回复内容**不经本插件转发**——飞书凭据、消息路由、DM 安全策略全部仍在官方通道；本插件只做"展示层接管"
- 任何一步失败（建卡失败 / 封卡失败）自动回落官方通道的默认文本回复，消息永不丢失
- 纯钩子实现（`message_received` / `before_tool_call` / `after_tool_call` / `llm_output` / `message_sending` / `agent_end`），不 patch 任何 OpenClaw 内部代码，升级无感

## ✨ 卡片特性（承自 fry-cards）

| 能力 | 说明 |
|------|------|
| 🎴 **流式卡片** | CardKit v2.0 `streaming_mode` 打字机效果，完成后关流式 |
| 🔧 **工具调用面板** | `before/after_tool_call` 驱动，实时显示图标、状态（Running/Succeeded/Failed）、耗时、结果预览；工具名→图标映射与 fry-cards 同源 |
| 🎯 **统一面板** | 完成态底部折叠面板：`🦞 模型 · 💭n · 🔧n · 上下文 · ⏱️ 耗时`，边框颜色随状态（绿=完成 黄=停止 红=错误） |
| 📊 **上下文显示** | `55.6k/1.0m [███▓▒░░░] 6%` 渐变进度条（text / bar / text_bar 三种模式） |
| 🧠 **推理展示** | `<thinking>` / `<antthinking>` / `Reasoning:` 标签自动剥离进统一面板，不混入答案 |
| 🌐 **中英双语** | 卡片文本根据飞书客户端语言自动切换 |
| 🛡️ **稳定回落** | 建卡/封卡失败、卡片超时（默认 15 分钟）、消息含交互组件时全部回落官方通道 |
| 🔒 **安全脱敏** | 工具命令里的密钥（token/api_key/Authorization…）与路径自动脱敏后才上卡 |

## ⚙️ 配置

配置放在 `openclaw.json` 的 `plugins.entries.claw-fry-cards.config`（完整示例见 [INSTALL.md](INSTALL.md)）：

```json
{
  "feishu":  { "brand": "feishu", "app_id": "cli_xxx", "app_secret": "xxx" },
  "chats":   { "allowlist": ["oc_xxx"], "blocklist": [] },
  "streaming": {
    "header_enabled": false,
    "footer_enabled": false,
    "footer_fields": [["status", "elapsed", "context", "model"]],
    "flush_interval_ms": 100,
    "typewriter_max_ms": 3000,
    "stale_timeout_sec": 900
  },
  "display": {
    "show_tool_use": true,
    "show_context": true,
    "context_display_mode": "text_bar",
    "truncate_model_name": true,
    "unified_panel_min_duration": 5,
    "cancel_text_on_card": true
  }
}
```

> 凭据与官方飞书通道使用**同一个飞书应用**即可（卡片以该应用身份发送）。`brand` 为 `lark` 时走 `open.larksuite.com`。

### 配置项一览

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `feishu.brand` | `feishu` / `lark` | `feishu` |
| `chats.allowlist` / `blocklist` | 会话白/黑名单（chat_id） | 空=全部启用 |
| `streaming.header_enabled` | 卡片顶部状态栏 | `false` |
| `streaming.footer_enabled` | 底部元数据栏（有统一面板时自动隐藏） | `false` |
| `streaming.footer_fields` | footer 字段布局 | `[[status, elapsed, context, model]]` |
| `streaming.width_mode` | 卡片宽度 (`default` / `compact` / `fill`) | `default` |
| `streaming.flush_interval_ms` | 打字机分片间隔 | `100` |
| `streaming.typewriter_max_ms` | 打字机最长耗时（长回复自动加速） | `3000` |
| `streaming.stale_timeout_sec` | 卡片无更新自动封卡超时 | `900` |
| `display.show_tool_use` | 工具面板 | `true` |
| `display.show_context` | 统一面板显示上下文窗口 | `true` |
| `display.context_display_mode` | `text` / `bar` / `text_bar` | `text_bar` |
| `display.truncate_model_name` | `openai/gpt-5.4` → `⇲gpt-5.4` | `true` |
| `display.unified_panel_min_duration` | 统一面板最小展示耗时（秒） | `5` |
| `display.cancel_text_on_card` | 卡片接管后取消官方文本回复 | `true` |

## 🧪 开发

```bash
npm install
npm test          # vitest — 80 tests
npm run typecheck # tsc --noEmit
npm run build     # tsdown → dist/index.mjs
```

## 📄 归属说明

卡片样式、状态机与节流调度移植自 [🍟 hermes-fry-cards](https://github.com/techysy/hermes-fry-cards)（MIT），该项目的卡片逻辑又源自 [hermes-lark-streaming](https://github.com/Cheerwhy/hermes-lark-streaming)（Cheerwhy，MIT）。流式 loading 图标与官方 [openclaw-lark](https://github.com/larksuite/openclaw-lark) 通用。

## 📄 许可证

[MIT](LICENSE)
