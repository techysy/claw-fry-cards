# 🦞 claw-fry-cards 安装指南

## 前置要求

- OpenClaw `>= 2026.2.26`（`openclaw -v` 检查，升级：`npm install -g openclaw`）
- Node.js `>= 22`
- 官方飞书通道已可用：[`@larksuite/openclaw-lark`](https://github.com/larksuite/openclaw-lark)（`openclaw plugins install @larksuite/openclaw-lark`）
- 一个飞书自建应用（与官方通道共用即可），已开通**卡片交互**相关权限：
  - `im:message`（发送消息/回复）
  - `cardkit:card`（读写卡片，CardKit 全部端点）

## 方式一：从源码安装（当前推荐）

```bash
git clone <本仓库地址> claw-fry-cards   # 或直接拷贝项目目录
cd claw-fry-cards
npm install
npm run build
openclaw plugins install . --force --accept-capabilities
```

> `--accept-capabilities` 是必须的：本插件声明了 `message_sending`（回复接管）等会话级钩子，OpenClaw 要求显式接受能力声明。
> 在 Docker Desktop / Windows 挂载目录下安装时，OpenClaw 会拒绝 world-writable 路径（`blocked plugin candidate: world-writable path`）——先把插件拷贝到容器/宿主本地目录（如 `~/.openclaw/plugins-src/`）再安装。

## 方式二：npm 安装（发布后可用）

```bash
openclaw plugins install claw-fry-cards
```

## 配置

编辑 `~/.openclaw/openclaw.json`（Windows: `%USERPROFILE%\.openclaw\openclaw.json`）：

```json
{
  "gateway": { "mode": "local" },
  "plugins": {
    "entries": {
      "claw-fry-cards": {
        "enabled": true,
        "hooks": {
          "allowConversationAccess": true
        },
        "config": {
          "feishu": {
            "brand": "feishu",
            "app_id": "cli_xxxxxxxx",
            "app_secret": "xxxxxxxx"
          },
          "display": {
            "show_tool_use": true,
            "context_display_mode": "text_bar"
          }
        }
      }
    }
  }
}
```

> ⚠️ **`hooks.allowConversationAccess: true` 必须配置**：`llm_output` / `agent_end` 属于可接触对话内容的钩子，非内置插件默认被网关拦截（日志报 `typed hook "llm_output" blocked ...`）。没有这一项，插件能加载但模型/上下文信息拿不到。

> app_secret 支持安全引用格式（`{"source": "env", "provider": "...", "id": "..."}`），与 OpenClaw secret 契约一致。

### 可选：限定生效的群聊

```json
"chats": { "allowlist": ["oc_群聊chat_id"], "blocklist": [] }
```

chat_id 获取：在目标群里 @机器人 说句话，日志里 `session_created session=feishu:oc_xxx` 中的 `oc_xxx` 即是。

## 启用与重启

```bash
openclaw gateway restart
```

验证：

```bash
openclaw plugins list          # claw-fry-cards 出现在列表中
openclaw plugins info claw-fry-cards
```

在飞书里给机器人发一条消息：

1. 立刻出现一张 **🦞 处理中** 蓝色流式卡片（工具面板 + loading 转圈）
2. 机器人调用工具时，工具面板实时滚动（图标/状态/耗时）
3. 回答生成完，卡片收尾为绿色 **✅ Completed** 卡，底部统一面板显示 `🦞 模型 · 💭 · 🔧 · 上下文 · ⏱️ 耗时`

## 卸载

```bash
openclaw plugins uninstall claw-fry-cards
openclaw gateway restart
```

卸载后消息展示立即回落官方飞书通道默认行为，无需其他清理。

## 故障排查

| 现象 | 原因 | 解决方案 |
|------|------|----------|
| 一直只有纯文本回复，没有卡片 | 凭据缺失/错误，或插件未启用 | 日志搜 `config missing feishu`；确认 `plugins.entries.claw-fry-cards.config.feishu` |
| 日志出现 `typed hook "llm_output" blocked` | 未声明会话访问权限 | 配置 `plugins.entries.claw-fry-cards.hooks.allowConversationAccess: true`（见上方配置示例） |
| 安装报 `world-writable path` | 安装源目录权限过宽（Windows 挂载/Docker bind mount） | 拷贝到本地目录后再安装 |
| 安装报 `requires capability consent` | 未接受能力声明 | `openclaw plugins install ... --accept-capabilities` |
| 有卡片但没有工具进度 | `display.show_tool_use=false`，或 OpenClaw 版本过低没有工具钩子 | 检查配置；`openclaw -v` 确认版本 |
| 回复出现两次（卡片+文本） | `cancel_text_on_card=false`，或封卡失败回落 | 检查配置；日志搜 `card_seal_failed` |
| 卡片永远转圈 | 网关进程在封卡前被杀 | 等待 `stale_timeout_sec` 自动封卡；重启后重新发消息即可 |
| 群里不生效 | allowlist 限制 | 检查 `chats.allowlist` / `blocklist` |

日志统一带 🦞 前缀：`openclaw gateway logs` 或 `~/.openclaw/logs/`。
