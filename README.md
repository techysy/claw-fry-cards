<div align="center">

# 🍤 claw-fry-cards — 虾条卡片

**OpenClaw 飞书 / Lark 通道插件：CardKit v2.0 流式消息 · 派发即建卡 · 打字机效果 · 统一指标面板 · 峰谷价标识**

[![Release](https://img.shields.io/github/v/release/techysy/claw-fry-cards?label=%E7%89%88%E6%9C%AC&color=2563eb)](https://github.com/techysy/claw-fry-cards/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/techysy/claw-fry-cards/ci.yml?branch=main&label=CI)](https://github.com/techysy/claw-fry-cards/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/claw-fry-cards?label=npm&color=cb3837)](https://www.npmjs.com/package/claw-fry-cards)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-%E2%89%A5%202026.5.4-2463eb)](https://openclaw.ai)
[![Node](https://img.shields.io/badge/Node.js-%E2%89%A5%2022-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/techysy/claw-fry-cards?label=%E8%AE%B8%E5%8F%AF&color=f59e0b)](LICENSE)

[特性](#-特性) · [安装](#-安装) · [配置](#-配置) · [面板功能](#-统一面板完成态底部折叠面板) · [开发](#-开发) · [相关项目](#-相关项目) · [许可证](#-许可证)

<img src="assets/card-demo.png" width="860" alt="卡片效果示例">

</div>

> **这是什么**：一个**飞书通道插件**（替代官方 `@larksuite/openclaw-lark` / 内置 `@openclaw/feishu`），负责 OpenClaw Agent 的飞书消息收发，并用 CardKit v2.0 流式卡片呈现每一轮回复。  
> **为什么存在**：官方通道插件停更于 2026-07-16，未适配 OpenClaw 2.0（SDK 导出重构、会话存储迁移 SQLite），在新版网关上无法加载。本项目完成了 2.0 适配，并将流式卡片体验升级到 fry-cards 系列风格。

---

## 🧭 版本说明（1.0 → 2.0）

| 版本 | 形态 | 获取方式 |
| --- | --- | --- |
| **2.0**（本主线） | **通道插件**：官方通道 2.0 适配，卡片引擎内置，替换官方通道 | `main` 分支 / `v2.0.0+` 标签 |
| **1.0**（伴侣插件） | 钩子观测自建卡片，官方通道继续收发，不替换通道 | `git checkout v1.0.0`（降级使用） |

> ⚠️ 1.0 与 2.0 架构不同，**切勿同时启用**（两套卡片会互相冲突）。  
> 2.0 前身 [claw-lark-cards](https://github.com/techysy/claw-lark-cards) 已合并入本仓库并废弃，后续仅在此维护。

### 从 claw-lark-cards 升级
```bash
openclaw plugins uninstall openclaw-lark --force   # 按其实际目录名卸载
```
配置迁移：插件 ID 已更名为 `claw-fry-cards`，`channels.feishu` 配置不变，仅需将 `plugins.entries.openclaw-lark` 改为 `plugins.entries.claw-fry-cards`。

### 从 1.0 伴侣插件升级
2.0 为通道插件，会**替换官方通道**。先卸载官方飞书通道（`openclaw plugins uninstall feishu --force`，注意该命令会删除 `channels.feishu` 配置，请备份后恢复），再安装本插件；1.0 的 `hooks.allowConversationAccess` 在 2.0 下不再需要。

---

## ✨ 特性

### 1. 通道基础能力（承自官方，2.0 全量适配）
- 💬 **消息全覆盖**：群聊 / 单聊收发、话题回复、消息搜索、图片 / 文件上传下载。
- 📄 **云文档交互**：云文档创建、更新、读取。
- 📊 **多维表格**：数据表 / 字段 / 记录 CRUD、批量操作、高级筛选、视图。
- 📈 **电子表格**：在线电子表格创建、编辑、查看。
- 📅 **日历与任务**：日程管理、参会人忙闲查询；任务 / 清单 / 评论全周期追踪。

### 2. 🍤 虾条式流式卡片（增强体验）
- ⚡ **派发即建卡**：用户消息到达 1 秒内建立“处理中”卡片，杜绝空白等待焦虑。
- ✍️ **打字机输出**：基于 CardKit streaming_mode 客户端动画，回复文字流畅逐字上屏。
- 🎯 **统一指标面板**：完成态底部收归单一折叠面板，一行带全关键指标：`🍤 ⇲模型 · 💭N · 🔧N · 上下文 (x%) · 🎫 输出 · ⏱️耗时`。
- 🎨 **状态感知边框**：边框颜色随终态反馈变化（绿=完成 · 红=出错 · 黄=中断）；展开后清晰呈现思考过程与工具调用明细。
- ⏱️ **峰谷计费标识**：按时间窗口自动切换 DeepSeek 等模型的显示名（如工作日高峰显示`梁文锋⚡️`、谷段显示`梁文谷⚡️`）。
- 🏷️ **灵活别名映射**：大小写不敏感匹配，支持按星期、时段自动切换模型名称展示。
- 📊 **原生会话指标**：实时读取 OpenClaw agent transcript SQLite，准确统计 token 与上下文水位。

### 3. OpenClaw 2.0 底层适配
- 全面迁移 SDK 导入路径（`openclaw/plugin-sdk` → `plugin-sdk/core` 等 100+ 处）。
- 升级类型定义（`ClawdbotConfig` → `OpenClawConfig`），对齐运行时配置 API。
- 会话指标源自 SQLite 数据库提取，不再依赖已废弃的 `sessions.json`。
- 保留官方 TypeScript 构建链路，规范产出标准 ESM 产物。

---

## 📦 安装

**环境要求**：
- OpenClaw ≥ 2026.5.4（推荐 **2026.9.4+**，已在 Docker + 飞牛 fnOS 验证）
- Node.js ≥ 22

### 方式一：一键脚本（推荐 · Agent 友好）
```bash
curl -fsSL https://raw.githubusercontent.com/techysy/claw-fry-cards/main/install.sh | bash
```
脚本将自动定位 OpenClaw CLI 并从 npm 拉取注册（可通过 `FRY_VERSION=2.0.5` 指定版本）。安装完成后需手动重启网关：
```bash
openclaw gateway restart
```

### 方式二：npm 安装
```bash
openclaw plugins install claw-fry-cards --force --accept-capabilities
openclaw gateway restart
```

### 方式三：从源码构建安装
```bash
git clone https://github.com/techysy/claw-fry-cards.git
cd claw-fry-cards
npm install --legacy-peer-deps
npm run build        # 产物输出至 dist/

openclaw plugins install . --force --accept-capabilities
openclaw gateway restart
```

> ⚠️ 若之前使用过官方通道，请先执行清理：`openclaw plugins uninstall feishu --force` 并移除 `plugins.entries.feishu` 配置项，防止宿主收敛机制自动回装旧版本。

---

## ⚙️ 配置

<div align="center">
<img src="assets/settings-panel.png" width="860" alt="Control UI 配置页">
</div>

在 `~/.openclaw/openclaw.json` 中配置：

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "domain": "feishu",
      "connectionMode": "websocket",
      "appId": "cli_xxxxxxxx",
      "appSecret": "xxxxxxxx",
      "dmPolicy": "open",
      "allowFrom": ["*"],
      "groupPolicy": "open",
      "groupAllowFrom": ["*"],
      "requireMention": true,
      "streaming": { "mode": "partial" }
    }
  },
  "plugins": {
    "entries": {
      "claw-fry-cards": {
        "enabled": true,
        "config": {
          "panel": {
            "unifiedPanelMinDuration": 5,
            "contextDisplayMode": "text",
            "peakValley": { "deepseek": { "peakName": "梁文锋⚡️", "valleyName": "梁文谷⚡️", "schedule": "deepseek" } },
            "modelAliases": { "mimo/mimo-v2.5": "小虾米" }
          }
        }
      }
    }
  }
}
```

### 流式卡片三层开关（排障核对标准）

| 层级 | 配置（2026.9.4+） | 配置（旧版 ≤2026.9.1） | 说明 |
| --- | --- | --- | --- |
| ① **总开关** | `streaming: { mode: "partial" }` | `streaming: true` | 未配置此开关则恒定输出为纯文本（`mode: "off"` 关闭） |
| ② **交互模式** | 无需额外配置（2.0.6 起默认流式） | 同左 | **群聊与私聊默认统一采用流式卡片**；若群聊需保持安静可显式配置 `replyMode: { group: "static" }` |
| ③ **工具展示** | 默认开启 | 默认开启 | `toolUseDisplay` 缺省即开启，自动展示工具调用步骤 |

> ⚠️ **注意**：飞牛/本地部署请将凭据配置在 `channels.feishu.*` 下，勿混写至插件配置中。  
> 飞牛 / 飞书开放平台应用须开通：`im:message`（消息收发）与 `cardkit:card`（卡片操作权限）。推荐采用 `websocket` 模式直连。

---

## 🎯 统一面板（完成态底部折叠面板）

当 Agent 回复生成完成时，底部会自动注入统计面板。面板支持在 **Control UI → 设置 → Claw Fry Cards** 界面进行全中文可视化配置。

| 项 | 规则与行为 |
| --- | --- |
| **标题格式** | `🍤 ⇲模型 · 💭N · 🔧N · 368.6k/1.0m (37%) · 🎫 1.5k · ⏱️ 13.3s`（缺失字段自适应折叠省略） |
| **展开内容** | 模型的完整思考推导记录 + 工具调用顺序流水；两项均空时呈现“暂无思考与工具调用过程” |
| **展示触发** | 单次交互耗时 ≥ 5 秒，**或**会话中包含了思考/工具调用步骤 |
| **边框反馈** | 绿色（成功完成）· 红色（执行异常）· 黄色（任务被手动停止） |

### 核心面板选项（`panel`）

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `unifiedPanelMinDuration` | 面板常驻显示的耗时门槛（秒）。耗时超出该阈值或含有工具调用时渲染，`0` 表示全量显示 | `5` |
| `contextDisplayMode` | 上下文消耗指标呈现格式：`text` (`129.3k/1.0m (13%)`)、`bar` (`[██▓░░░░░] 13%`)、`text_bar` | `text` |
| `truncateModelName` | 超长模型名自适应截断（如 `mimo/mimo-v2.5` → `⇲mimo-v2.5`） | `true` |
| `modelAliases` | 模型重命名与分时段人设映射字典 | `{}` |
| `peakValley` | 针对特定模型的峰谷电价式名称映射配置 | `{}` |

---

## 🧪 开发

```bash
# 安装依赖
npm install --legacy-peer-deps

# 编译 ESM 产物 (dist/)
npm run build

# 运行自动化测试
npm test

# 类型安全检查
npm run typecheck
```

---

## 🔗 相关项目

- [🍟 hermes-fry-cards](https://github.com/techysy/hermes-fry-cards) — Hermes Gateway 飞书流式卡片插件
- [🕊️ feige-fry-cards](https://github.com/techysy/feige-fry-cards) — 跨 Agent 战报结果汇报插件
- [🌉 zcode-feishu-bridge](https://github.com/techysy/zcode-feishu-bridge) — ZCode 会话转飞书流式卡片桥接器

---

## 🔒 安全与归属

- **上游归属**：基于 [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark)（MIT），OpenClaw 2.0 基础适配归功于 [@Mirr0ch1](https://github.com/Mirr0ch1)。
- **安全声明**：OpenClaw 具备本地命令执行及自动化能力，飞书应用凭据切勿泄漏。建议将机器人作为**私聊办公助手**使用，加入公开群聊时需谨慎配置访问与审批策略。

## 📄 许可证

[MIT](LICENSE)
