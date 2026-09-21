# 🐬 fnOS（飞牛 NAS）部署 OpenClaw + 虾条卡片指南

> 面向在飞牛 fnOS 上通过 **trim.openclaw 应用**（或同架构的原生部署）运行 OpenClaw，并接入 🍤 [claw-fry-cards](https://github.com/techysy/claw-fry-cards) 流式卡片的用户。本文记录真实部署中踩到的全部坑与修复方法，按"遇到什么 → 怎么修"组织。

- **适用**：fnOS x86_64 · trim.openclaw fnOS 应用（OpenClaw 2026.9.x）· claw-fry-cards 2.0.4+
- **验证环境**：飞牛 <NAS 主机名>（trim 定制内核 6.18）· Node 24.17.0 · 飞书自建应用 websocket 模式

---

## 1. 架构速览（先搞清再动手）

fnOS 的 trim.openclaw 应用**不是 Docker**，是原生进程组合：

```
Bun 包装层（trim.openclaw 用户，端口 5666）
  ├─ 写配置 / 环境预检（preflight）/ 反向代理 / 实例管理
  └─ 拉起 → OpenClaw 网关原生进程（内部端口 36412，仅 loopback）
```

| 路径                                 | 内容                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `/vol4/@appcenter/trim.openclaw/`    | 应用程序（server/index.js 包装层、bin/openclaw CLI 包装、vendor 补丁）                        |
| `/vol4/@apphome/trim.openclaw/data/` | 数据根（DATA_ROOT）：`home/.openclaw/`（状态）、`openclaw/`（npm 安装）、`state`、`workspace` |
| `data/home/.openclaw/openclaw.json`  | 网关主配置                                                                                    |
| `data/monitor/monitor.sqlite`        | 实例数据库（仪表板"未安装/已停止"状态看这里）                                                 |
| 配置声明                             | `config/openclaw-version.env`（版本）、`config/privilege`（运行用户）                         |

运行用户是专用的 `trim.openclaw`（uid 984）——**所有属主/权限问题的根源都和它有关**（见 §3）。

## 2. 安装虾条卡片

```bash
# fnOS 终端（SSH）执行；应用自带的 CLI 包装会设好全部环境变量
/vol4/@appcenter/trim.openclaw/bin/openclaw plugins install claw-fry-cards --force --accept-capabilities
```

- 版本固定：`claw-fry-cards@2.0.4`
- 从 tgz 安装（离线/dev 构建）：`plugins install /path/to/xxx.tgz --force --accept-capabilities`
- ⚠️ **不接受目录路径**（只收 .ts/.js/.zip/.tgz/npm spec）
- ⚠️ Git Bash 用户：MSYS 会把容器/绝对路径实参改写成 Windows 路径，命令前加 `MSYS_NO_PATHCONV=1`
- npm 发布后有 **1~4 分钟 CDN 延迟**，立刻装会 `notarget`，等一会重试

装完在**仪表板点「启动服务」**（或重启服务）。验证：`plugins list | grep claw-fry-cards` + 网关日志 `plugins: ... claw-fry-cards ...`。

## 3. 五个必踩的坑与修复

### 坑 ①：升级后网关起不来（Node 版本 preflight）

**现象**：应用升级 OpenClaw 后点启动，日志停在
`[preflight:config-validate-failed] node:sqlite truncates TEXT at embedded NUL (nodejs/node#61954); use 24.16+/26.1+`

**原因**：新版 OpenClaw 的环境预检拒绝 fnOS `nodejs_v24` 应用自带的 Node 24.15.0（sqlite bug，24.16+ 才修）。

**修复**（独立装一份新 Node，不动 fnOS 全局应用，不影响其他应用）：

```bash
cd /vol4/@apphome/trim.openclaw/data
curl -LO https://registry.npmmirror.com/-/binary/node/v24.17.0/node-v24.17.0-linux-x64.tar.gz
tar -xzf node-v24.17.0-linux-x64.tar.gz && rm node-v24.17.0-linux-x64.tar.gz
```

然后让网关用上新 Node（二选一）：

- **改 CLI 包装**（推荐）：`bin/openclaw` 的 export PATH 最前面插入 `data/node-v24.17.0-linux-x64/bin:`（应用更新会覆盖此文件，更新后重打；改前备份）
- 或原地升级 `nodejs_v24` 应用的 node 二进制（mv 换名 + cp 新版；同主版本补丁升级，claude-code 等共用方受益；`Text file busy` 就先 mv 旧文件再 cp）

### 坑 ②：配置 schema 代差（5.4 时代配置被 9.4 拒绝）

应用升级到 2026.9.x 后，旧配置会触发 `config-validate-failed`（如 `Unrecognized key`）。

**修复**：先备份，再自动迁移：

```bash
cp data/home/.openclaw/openclaw.json data/home/.openclaw/openclaw.json.bak
bin/openclaw doctor --fix
bin/openclaw config validate   # 确认 Config valid
```

常见代差（手写配置注意）：

- `channels.feishu.streaming`：旧布尔 `true` → 新对象 `{ "mode": "partial" }`
- `channels.feishu.replyMode`：**整个键废弃**（9.4 schema 会拒绝）
- 包装层启动时无条件写入的键（见坑 ③）

### 坑 ③：包装层每次启动都写入 9.4 已废弃的配置键

**现象**：每次点「启动服务」，preflight 都报 `Unrecognized key: "allowInsecureAuth"`（或根级 `cli`）——清理配置也没用，反复复发。

**原因**：应用包装层（server/index.js）在写配置时**无条件**添加这几个 5.4 时代键（约 3 处：系统配置块 ×2 + 实例配置块 ×1），其中实例配置块在**每次点启动**时执行。

**修复**：注释掉包装层里的写入行（3 处 `controlUi.allowInsecureAuth = true;` + 1 处 `config.cli = cli;`），然后清掉配置里已写入的键：

```bash
# 包装层补丁（先备份 server/index.js）
sed -i 's|^\(\s*\)controlUi.allowInsecureAuth = true;|\1// patched: 9.4 schema rejects allowInsecureAuth|' server/index.js
sed -i 's|^\(\s*\)config.cli = cli;|\1// patched: 9.4 schema rejects root cli|' server/index.js
# 清配置里已写入的键
sed -i '/"allowInsecureAuth"/d' data/home/.openclaw/openclaw.json
```

⚠️ **改完必须重启整个 fnOS 应用**（应用中心停止→启动）——只点"重启服务"不重启 Bun 进程，旧代码还在内存里，改了也白改。

### 坑 ④：状态树属主污染（以管理员用户手动跑网关后）

**现象**：以 SSH 管理员用户（如 <管理员用户>）手动跑过网关后，fnOS 应用报"无法读取状态/未安装"，网关报
`device identity coordinator directory belongs to another user` 或插件
`blocked plugin candidate: suspicious ownership`。

**原因**：手动跑网关会把整棵状态树（1 万+ 文件）写成管理员用户属主；切回应用运行（trim.openclaw 用户）后，属主/权限安全检查全部拒绝。

**修复**（<管理员用户> 无 sudo 时，借 docker 组权限用容器 chown；fnOS 应用本身非 Docker，容器只是工具）：

```bash
docker run --rm -v /vol4/@apphome/trim.openclaw/data:/target alpine:3.20 chown -R 984:901 /target
# 顺手清掉 world-writable（插件目录必须非 world-writable，否则插件被安全检查拒载）
find /vol4/@apphome/trim.openclaw/data -perm -002 -exec chmod o-w {} +
```

**预防**：调试网关一律走应用自身生命周期（UI 启停）或 `bin/openclaw`（会以正确用户环境执行），不要用管理员 SSH 会话裸跑。

### 坑 ⑤：官方飞书插件被自动装回（双通道冲突）

网关配置收敛机制会把 `feishu` 通道的官方插件（`@openclaw/feishu`）自动装回来——和虾条卡片的通道冲突（双 feishu 通道抢消息）。

**修复**：

```bash
bin/openclaw plugins uninstall feishu --force
```

⚠️ 该命令会**连带删除 `channels.feishu` 配置**（凭据！）——先备份，卸载后重建 `channels.feishu` 再重启。

## 4. 虾条卡片配置速查（fnOS 场景）

```json
"panel": {
  "unifiedPanelMinDuration": 0,
  "contextDisplayMode": "text",
  "truncateModelName": true,
  "modelAliasesEnabled": true,
  "modelAliases": { "mimo": "小虾米" },
  "peakValley": { "deepseek": { "peakName": "梁文锋⚡️", "valleyName": "梁文谷⚡️", "schedule": "deepseek" } }
}
```

- **群聊不出卡片**（只回纯文本）？群聊**默认静态文本**（继承官方行为防刷屏）——要卡片需在 `channels.feishu` 显式配 `"replyMode": { "default": "streaming", "group": "streaming" }` + 总开关 `"streaming": { "mode": "partial" }`；只配 replyMode 漏 streaming 也会退化为纯文本
- ⚠️ 别把通道配置写进 `plugins.entries.claw-fry-cards.config.feishu`——该路径已随 2.0.5 撤销，写了不生效（只会造成改了没用的错觉）
- **面板上下文段不显示**？检查模型配置里有没有 `contextWindow`（Control UI 添加模型时容易漏填，如 `"contextWindow": 1048576`）——该段数据缺失时自动省略
- 模型别名的 key 是**子串匹配**（`"mimo"` 命中 `mimo/mimo-v2.5`），`peakValley` 的 key 同理（`"deepseek"` 命中所有 deepseek 模型）
- 配置编辑两条路：Control UI 配置页（可视化，中文）或直接改 `openclaw.json` + 重启服务

## 5. 快速排障命令

```bash
CLI=/vol4/@appcenter/trim.openclaw/bin/openclaw
$CLI plugins list                          # 插件注册状态
$CLI config validate                       # 配置校验（9.4 schema）
$CLI doctor --fix                          # 自动迁移旧配置
tail -50 /vol4/@apphome/trim.openclaw/data/home/.openclaw/logs/gateway.log   # 网关日志
grep 🍤 <同上>                              # 只看卡片插件日志
```

---

> 本指南来自 claw-fry-cards 2.0.4 → 2.0.5-dev 在 fnOS 的真实部署排障（2026-09-13）。配套深度文档：[兼容性测试报告](compat-test-report.md) · [部署行程报告](nas-fnos-trip-report.md)
