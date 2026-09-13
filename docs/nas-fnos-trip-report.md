# 📋 NAS fnOS 部署行程报告 — trim.openclaw 应用接入 claw-fry-cards 2.0.4

- **日期**：2026-09-13
- **目标**：把飞牛 NAS 上的 trim.openclaw fnOS 应用作为**真实网关 E2E 测试靶**（区别于仿宿主沙箱的加载级测试）
- **状态**：链路已通（可复用的通用化指南见 [fnos-deploy-guide.md](fnos-deploy-guide.md)）（卡片 E2E 验证 ✓），**待一条 root 命令收尾**（见 §6）

---

## 1. NAS 环境架构（摸底结论）

fnOS 应用**不是 Docker**，是原生进程组合：

| 组件 | 路径 / 说明 |
|---|---|
| Bun 包装层 | `/vol4/@appcenter/trim.openclaw/server/index.js`（14k 行），监听 5666，负责配置写入、preflight、代理与实例管理 |
| OpenClaw 网关 | 原生进程（实例 id `default`），内部端口 36412，由 wrapper 拉起 |
| 网关状态 | `/vol4/@apphome/trim.openclaw/data/home/.openclaw/`（openclaw.json、agents、logs、extensions、npm）|
| 运行时安装 | `data/openclaw/node_modules/openclaw`（升级后为 **2026.9.4**）|
| CLI 包装 | `@appcenter/trim.openclaw/bin/openclaw`（export PATH/HOME/OPENCLAW_DATA_DIR/OPENCLAW_CONFIG_PATH 后 exec 真正 CLI）|
| 实例数据库 | `data/monitor/monitor.sqlite`（instances 表：端口、路径、状态）|
| 运行用户 | `trim.openclaw`（nologin）；SSH 免密用户为 `<管理员用户>`（仅 Administrators 组，无免密 sudo）|
| Node 依赖 | fnOS 应用 `nodejs_v24`（`/var/apps/nodejs_v24/target/bin/node`）|

wrapper 关键行为：每次启动**无条件重写** openclaw.json 的部分键（`gateway.controlUi.*`、根级 `cli`、`agents.defaults.workspace` 等），并运行环境 preflight（Node 版本检查、配置 schema 校验、插件目录扫描）。

## 2. 时间线与问题修复

### ① 升级打挂网关（Node 24.15.0 preflight）
应用升级把 OpenClaw 带到 2026.9.4，但新版 preflight 拒绝 fnOS `nodejs_v24` 应用的 Node 24.15.0（node:sqlite NUL 截断 bug，nodejs/node#61954，24.16+ 修复）→ 网关起不来，仪表板不可用。
**修复**：安装独立 Node v24.17.0 到 `data/node-v24.17.0-linux-x64/` + 前置 `bin/openclaw` 的 PATH；后将 `nodejs_v24` 的 node 二进制原地升级为 24.17.0（备份 `node.v24.15.0.bak`，同主版本补丁升级，claude-code 等共用方受益）。

### ② 配置 schema 代差
5.4 时代配置被 9.4 schema 拒绝。**修复**：`doctor --fix` 自动迁移（备份 `openclaw.json.bak-20260913`）。

### ③ 插件安装与飞书接入 ✓
`plugins install claw-fry-cards@2.0.4` → 飞书凭据（`cli_aa2f****（NAS 应用）`，fnOS 专用新应用）→ **卡片链路 E2E 通过**（飞书截图确认：流式卡 + ⇲截断 + 统一面板 + 🎫累计输出）。

### ④ 面板上下文段缺失
根因两个：provider key 大小写不一致（`10Router` vs transcript 里的 `10router`）+ UI 添加的模型条目缺 `contextWindow`。**修复**：key 统一小写 + 补 `contextWindow: 1048576` + 固定 `agents.defaults.model.primary`。

### ⑤ 兼容垫片与 TLA 教训（对插件代码的反哺）
排查中发现 NAS 原装 OpenClaw 是 **2026.5.4**——低于插件下限 2026.5.12，差在 `plugin-sdk/channel-message` 一个导出。实现兼容垫片（`channel-message-compat.ts`：新路径失败回落 `channel-runtime`），**下限下探至 2026.5.4**。
**关键教训**：首版垫片用了顶层 await（TLA），沙箱 harness（native import）全部通过，但**真实网关加载器不支持 TLA**——插件加载直接 SyntaxError。已改为 `createRequire` 同步双路径解析（commit `5f2ef11`），Docker 与 NAS 真网关双重验证通过。**沙箱 harness 只覆盖模块解析，加载器语义必须真网关验证。**

### ⑥ 设置页「不支持的架构节点」
`appSecret` 上的 `format: 'password'` 自定义元数据不被设置页渲染器支持。撤销后确认：**宿主表单按字段名正则（/secret/i 等）自动掩码**，无需任何 schema 元数据（commit `a9b675c`）。

### ⑦ 插件侧飞书凭据功能撤销（用户定夺）
曾实现 `config.feishu` 凭据覆盖（插件设置页配置 appId/appSecret），后确认 Control UI 通道页已可配置，插件侧冗余——整体撤销（含凭据合并逻辑与测试）。

### ⑧ 状态树属主污染（当前待收尾）
排查期间以 <管理员用户> 手动跑网关，**13,774 个状态文件变成 <管理员用户> 属主** → wrapper 以 `trim.openclaw` 拉起网关时，宿主安全检查（插件树属主校验 + world-writable 扫描）拒绝加载。
已做：wrapper 补丁（停止写入 9.4 拒绝的 `allowInsecureAuth`/根级 `cli` 键，原文件备份 `server/index.js.bak-nodefix`）→ `doctor --fix` 清理 → `config validate` 通过；<管理员用户> 属主文件权限补齐后又收紧（扩展目录去 world/group write）。
**遗留**：属主修正需要 root（见 §6）；另 `data/openclaw/node_modules/openclaw` 被应用写成 777 需去 world-write。

### ⑨ 已定性为宿主限制的两个现象（插件侧无解，可提 issue）

- **通道配置页字段说明为英文**：feishu 是宿主认识的内置通道 id，通道页渲染宿主内置 schema 字典（英文描述，如 dmPolicy 的 "Who may DM the agent..."），插件声明的 schema/uiHints 被覆盖；选项圆片（pairing/open 等）是配置值本身不可翻译。插件侧可局部化的是：通道 meta（label「飞书 Feishu」✓ 已生效）、**插件设置页**全字段中文 ✓
- **「自定义条目」小标题**：宿主 zh-CN locale 固定文案（customEntries），无 per-option 标签机制

### ⑩ 其他一次性现象（已定性，无需处理）
- 卡在「等待工具执行」的孤儿卡：网关强杀打断运行中的轮次所致，视觉残留无害
- 12:49 的 post 纯文本回复：重启混乱窗口期走了静态路径的偶发
- wrapper 不自动重启网关：网关死了需在 fnOS 应用界面点「启动服务」

## 3. 沉淀的方法与教训

1. **沙箱 harness 的盲区**：`import` 级验证 ≠ 网关加载器语义（TLA/CJS 互操作等）——发版前必须过一次真网关加载。
2. **fnOS 应用运维三件套**：wrapper 无条件写 5.4 键（升级后需补丁）、`openclaw-version.env` 可能陈旧（升级中断时）、bin/openclaw 会被应用更新覆盖（PATH 补丁需重打）。
3. **不要以管理员用户的身份直接跑网关**：状态树属主会被污染，宿主的属主/权限安全检查会连锁拒绝。
4. 内联脚本写文件必须验证落盘；zod v4 链式改写易丢 `.optional()`（本round被 471 tests 拦下）。

## 4. 当前快照

| 项 | 值 |
|---|---|
| NAS OpenClaw | 2026.9.4（应用升级后）+ Node 24.17.0（原地升级，备份在 bin/node.v24.15.0.bak）|
| 插件 | claw-fry-cards **2.0.5-dev.0**（含通道配置中文化 + uiHints；未发 npm）|
| 飞书 | `cli_aa2f****（NAS 应用）`（fnOS 专用应用），ws client ready |
| 网关进程 | 已停止（等待属主修复后由 wrapper 拉起）|
| wrapper 补丁 | `server/index.js.bak-nodefix` 备份在位；bin/openclaw PATH 补丁在位 |

## 5. 关键命令速查

```bash
# 状态/日志
ssh <NAS-IP> 'tail -30 /vol4/@apphome/trim.openclaw/data/home/.openclaw/logs/gateway.log'
ssh <NAS-IP> 'pgrep -af openclaw'

# 安装/升级插件（dev 构建走 tgz；正式版走 npm spec）
ssh <NAS-IP> '/vol4/@appcenter/trim.openclaw/bin/openclaw plugins install claw-fry-cards@<ver> --force --accept-capabilities'

# 网关启停：fnOS 应用界面「启动服务」按钮（wrapper 负责；无自动重启）
```

## 6. ⏳ 待办（root 一条命令）

```bash
sudo chown -R trim.openclaw:trim.openclaw /vol4/@apphome/trim.openclaw/data
sudo chmod -R o-w /vol4/@apphome/trim.openclaw/data/openclaw/node_modules/openclaw
```

执行后：**fnOS 应用中心将应用整体停止再启动**（关键：必须重启整个应用让 Bun wrapper 加载补丁并重读干净配置——仅点仪表板「重启服务」无效，wrapper 内存中的旧配置快照会把坏键写回）→ 仪表板点「启动服务」→ 飞书发消息复验（卡片 + 上下文段）→ 本报告状态更新为「已完成」。
