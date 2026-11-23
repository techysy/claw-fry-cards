# Changelog

## 3.3.2 (2026-11-23)

修复「续跑轮回复溢出卡片」的问题（fnOS 群 2026-11-23 21:51 实测：后台批量抓取任务超时被宿主掐断，exec 完成事件唤醒的续跑轮回复以裸 markdown 消息落入群——无统一面板、无指标条、文本贴边，被误报为卡片溢出）。

- 🔁 **续跑轮晚到回复走 fry 卡片路径**：主回复的流式卡封口（dispatch complete）后，宿主仍可能把同会话 system event 唤醒的续跑轮 deliver 派回同一 dispatcher。原逻辑此时会落进静态兜底，把晚到文本按裸 markdown 卡片/纯文本分块发出——群里出现一张「无面板、无指标、贴边」的残卡。现识别该场景（controller 已 completed）改走 `sendMarkdownCardFeishu` 卡片路径（沿用 🍤 样式 + 表格降级保底），晚到内容不再裸奔
- 🛡️ **失败回落链**：晚到卡片发送失败（非消息不可用类错误）自动回落纯文本，保证内容必达；消息不可用（撤回/删除）仍由 UnavailableGuard 照常终止
- 🧪 新增 6 项单测：晚到正文/纯思考走卡、streaming 正常态不拦截、aborted 不拦截、卡发送失败回落文本、空负载不发送。全套 542 过 / 2 skip，typecheck / lint(0 error) / build 全绿

## 3.3.1 (2026-11-23)

修复单条长研究回复溢出飞书卡片的问题（fnOS 群 2026-11-23 实测：小虾米一条超长研究回复正文 bullet 多 + 长段落，卡片在末尾被截断悬停）。

- 📏 **正文/思考 UTF-8 字节预算（根治长回复溢出）**：此前卡片已有元素数收纳（v3.1.1 `MAX_DISPLAY_TOOL_STEPS=15`）与表格数降级（`FEISHU_CARD_TABLE_LIMIT=3`）两层防护，但正文由**单个 markdown 元素**承载且无任何体积预算——单条长回复直接撑爆飞书单卡 ~30KB JSON 上限，终态封卡失败/渲染截断。现参照 hermes-fry-cards `clamp_utf8` 口径补齐第三层防护：answer 元素 18KB（≈6000 汉字）、reasoning 元素 10KB（流式覆盖语义全文重发，无预算时每秒重写 20–28KB 会打满客户端渲染）、工具步骤 detail/result/error 代码块 per-item 4KB
- ✂️ **截断保尾语义（hermes 同款）**：终态封卡截断保留首 60% + 中段省略标记 + 尾 40%——长研究回复的末尾核心结论不丢；流式进行中头截断（渐进补全）。UTF-8 字节级钳制（二分查找 + 不切割代理对），CJK 3 字节/字场景下字符数估算不可靠
- 🔧 **渲染链全路径覆盖**：终态卡正文与思考（`prepareTerminalCardContent` 统一收口——onIdle 封卡/错误卡/中止卡/降级重试全走此路径）、流式帧（CardKit streamCardContent + IM patch fallback 双路径）、onIdle 无增量补偿的打字机全文、静态 markdown 元素（工具步骤 detail/output）
- 🧪 新增 18 项单测：字节计长（CJK/emoji）、保尾截断（首标记+尾结论存活）、代理对不切割、极小预算回落、builder 集成回归（36KB 长回复封卡后卡片 JSON < 30KB、尾结论保留、reasoning ≤10KB、普通长度原样通过）。全套 536 过 / 2 skip，typecheck / lint(0 error) / build 全绿

## 3.3.0 (2026-11-23)

卡片健壮化专项：修复 fnOS 生产实例复盘出的「拒答空壳卡」「重启僵尸卡」两类悬空卡问题（小虾米装机补丁进源码，重装不再丢），并按用户反馈把统一面板字段改成复选框显隐、官方模型名映射与 logo 显隐解耦。

- 🗑️ **静默回复撤回占位卡（修复拒答空壳卡）**：「派发即建卡」让占位卡在 dispatch 一开始就已发出，agent 最终选择不回复（NO_REPLY/空回复，如群消息语义性拒答）时，老行为是灌 `Done.` 兜底文案——群里留一张无信息空壳卡。现改为 `im.message.delete` 撤回占位卡（机器人撤回自己的消息），撤回失败（缺权限/消息已删）自动回落兜底文案路径，占位卡必收尾
- 📔 **在途卡 journal + 启动收尾（修复重启僵尸卡）**：优雅关机 hook 挡不住 `kill -9`/崩溃/断电。卡片消息发出即记入本地 journal（`~/.openclaw/claw-fry-cards/card-journal-<account>.json`，原子写、best-effort），控制器进终态即移除；插件启动时按残留条目把上一进程没收尾的流式卡补成终态（CardKit 关流式 + 整体替换为中断说明卡，失败回落 `im.message.patch`），条目按账号隔离、7 天过期清理、失败保留下次启动重试。这也是缺口④（状态持久化）的最小实现
- 🛡️ **降级收尾保留面板与 logo 条**：终态更新撞元素超限/10002 类错误时的降级重试卡不再硬编码 `showToolUse: false`——统一面板与厂商路由 logo 按配置保留（降级只剥离大体积工具步骤/思考正文），降级链改为「完整卡 → 精简卡（留面板/logo）→ `im.message.patch` 最小卡（仅正文）」，每层都比原实现更稳
- ☑️ **面板字段显隐改为复选框（`panel.fieldToggles`）**：设置界面从「下拉框+垃圾桶」（只能删、条目销毁）改为逐字段复选框——勾选显示、取消隐藏、配置条目保留不销毁；顺序固定内置默认（model → reasoning → tools → context → cache → output → speed → elapsed）。配置了 fieldToggles 时优先于旧版 `fields` 有序数组（旧数组管自定义顺序，继续可用）。`openclaw.plugin.json` 内嵌 configSchema 已同步（教训：不同步会被宿主按旧 schema quarantine）
- 🏷️ **官方模型名映射与 logo 显隐解耦**：v3.2.0 起 model 段仅在 logo 条渲染成功时才映射官方名（厂商官网口径），logo 关闭/上传失败/未命中就露代理原模型名（如 `hy4-flash`）。现改为恒映射：已知厂商（内置家族表，hy4/qwen/claude/grok/longcat/mimo 等 10R fleet 全家族）关掉 logo 也显示官方名（`hy4-flash` → `Hy4 flash`），只有未知家族回落原模型名；🍤 品牌图标取舍仍随 logo
- 🧪 新增 33 项单测：静默回复撤回（撤回/回落/正常回复不误撤/journal 记录）、journal 存取（账号隔离/覆盖/坏文件容忍）、启动收尾（CardKit/IM 兜底/过期清理/失败保留）、fieldToggles 解析（优先级/全不勾/非法键过滤）、官方名解耦（无 logo 映射/未知厂商回落）；builder 终态 3 项断言随解耦语义更新。全套 518 过 / 2 skip，typecheck / lint(0 error) / build 全绿

## 3.2.0 (2026-11-22)

统一面板新增**厂商路由 logo 条**与**实际路由模型直显**：展开区顶部渲染「厂商 PNG logo + 本轮路由模型」column_set 条（12 家厂商图标随包分发），header model 段直接显示 10R 本轮实际路由到的模型（组合名不上卡，无 logo 条时回落 🍤 品牌图标）。数据链零路由端改动——实际模型由 10R 响应体回传、宿主落库 transcript `message.responseModel`，卡片直读。

- 🏷️ **`panel.vendorLogo` 开关（默认开启）**：面板展开区顶部渲染「厂商 PNG logo + 本轮路由模型」column_set 条；logo 资产取自 @lobehub/icons-static-png（12 家：Qwen/Zhipu/DeepSeek/Claude/Gemini/Kimi/Moonshot/MiniMax/OpenAI/Doubao/Hunyuan/StepFun）随包分发，新模块 `cardkit/vendor-logos` 首次渲染懒上传换 image_key 并进程内缓存，失败静默降级纯文本
- 🎯 **model 段直显实际路由模型**：transcript `message.responseModel` 优先（组合名不上卡，维护者自知），直连 provider 回落请求模型；无 logo 条时回落 🍤 品牌图标
- 🔁 **实际路由模型数据链零路由端改动**：10R 响应体本就回传实际模型，宿主落库 `message.responseModel`，卡片直读即可——无需 10R 任何配合
- 📋 **`openclaw.plugin.json` 内嵌 configSchema 与 zod 同次同步**：`fields` 语义更新（教训：清单是手工维护的静态 JSON Schema，改 zod 必须同步，否则宿主准入按旧 schema quarantine 插件配置）

## 3.1.1 (2026-11-04)

修复复杂任务下多工具步骤导致飞书卡片元素超限（300305 / 230099: 11310）且终态卡无法封口的问题。

- 🛡️ **工具步骤溢出收纳（解决 300305 `element exceeds the limit`）**：单轮执行长链路任务触发数十次工具调用时，因卡片内元素数量超出飞书单卡硬性限制（约 99 个元素），飞书 CardKit 会报错并拒绝更新终态卡片，导致客户端卡片一直悬停在“等待工具执行”。现增加 `MAX_DISPLAY_TOOL_STEPS = 15` 限制，保留最近 15 步并在顶部以轻量折叠提示呈现早期步骤，从源头阻断元素溢出
- 🔄 **终态封卡双层降级保底**：`onIdle` 中 CardKit 更新遇到元素超限或其他异常时，自动剥离复杂步骤重试精简卡；若 CardKit 接口仍被拒绝，无缝回落到 `im.message.patch` 兜底更新，确保卡片 100% 能够封口置为终态
- 🩹 **中止与异常流关闭保护**：`closeStreamingAndUpdate` 补齐 `setCardStreamingMode` 异常捕获与 `im.message.patch` 终态兜底，避免非正常结束时卡片停滞

## 3.1.0 (2026-10-15)

适配 **OpenClaw 2026.10.x** 大版本（宿主在 10.3 移除了三个本插件依赖的 SDK 导出，旧版插件会**加载失败、整条飞书通道消失**）。

> 起因：用户 koler（[Bilibili @koler](https://space.bilibili.com/567523)）于 2026-10-13 反馈宿主升到 2026.10.2 后插件失效（[#1](https://github.com/techysy/claw-fry-cards/issues/1)）。感谢反馈 🙏

- 🔌 **`channel-outbound` 改为 channel-message 垫片首选路径**：`createReplyPrefixContext` / `createTypingCallbacks` 在 10.3 由 `plugin-sdk/channel-message` 迁走（该子路径已移除）。垫片改按 `channel-outbound` → `channel-message` → `channel-runtime` 三代回落——`channel-outbound` 在 9.4 与 10.3 均存在，故向前不回溯
- 🔐 **新增 `core/command-auth-compat` 垫片**：`plugin-sdk/command-auth` 聚合门面在 10.3 被整体移除（其导出在 9.4 已标 `@deprecated`）。官方替代 `resolveChannelMessageIngress` 入参是约 20 个结构化字段、出参与既有调用点形状不兼容，故垫片改为**用 10.3 中仍存活的保留原语按原语义重建**同一组合器（`resolveDmGroupAccessWithLists` / `resolveCommandAuthorizedFromAuthorizers` / `shouldComputeCommandAuthorized` / `expandAllowFromWithAccessGroups`），老宿主（≤9.x）直接透传原实现——逐行等价，零行为漂移
- 🗂️ **新增 `core/session-store-compat` 垫片**：`plugin-sdk/session-store-runtime` 子路径虽仍在，但其 `loadSessionStore` / `resolveSessionStoreEntry` 两个具名导出已在 10.3 移除（**子路径比对查不到**这类破坏——import 阶段直接 SyntaxError，`try/catch` 救不了）。垫片改用 9.4 起即提供的 `getSessionEntry`，老宿主回落到旧全量存储对
- 🧪 **修正测试 mock 目标**：`vi.mock` 目标从已移除的宿主子路径改为对应垫片模块（`createRequire` 本就绕过 `vi.mock`，旧 mock 早已是惰性伪装）
- 📦 devDependency `openclaw` 由 `^2026.8.1` 升至 `^2026.10.3`，typecheck / 单测改在真实 10.3 宿主类型下验证
- ⬇️ peer 下限**维持 `>=2026.5.4`**：三代回落垫片保留老路径，不牺牲既有下限
- ✅ **验证**：`docs/compat-test-harness.mjs` 在 **2026.9.4** 与 **2026.10.3** 两个真实宿主依赖树上均 `RESULT: PASS`（import + register 全通过，API 面一致）；**真实 2026.10.3 生产容器 + 真实飞书凭据全链路实测**——宿主由 9.4 就地升级至 10.3，插件加载 `enabled`、网关 `healthy`、飞书 websocket `client ready`、真实群消息走完「收→gate→agent→模型→回复」全链路（`dispatch complete (queuedFinal=true, replies=1)`）、卡片引擎 `progressCard.get` 调用成功且**回复经人工确认为 🍤 卡片**（`streaming.mode=partial` 被正确解析、未退化为静态纯文本）；三垫片在真实宿主上均命中 10.x 分支（channel-outbound / 重建路径 / getSessionEntry）；重建鉴权逻辑与 9.4 原实现**四种用例结果完全一致**；482 项单测、typecheck、lint(0 error) 全绿
- ⚠️ **升级到 10.x 的必查项**：宿主 2026.10.3 会自动安装并启用官方 `@openclaw/feishu` 通道插件，与本插件抢占 `feishu` 通道（实测日志 `channel already registered: feishu (claw-fry-cards)`）。修复：`openclaw plugins disable feishu`。此与插件代码无关，属宿主自动启用行为，每次宿主大版本升级后都需复查
- ✅ **2026.10.6 复测**（2026-10-23，无代码改动）：生产容器由 10.3 就地升级至 `2026.10.6 (fe06181)`，插件 3.1.0 未重装即正常运行——`plugin-sdk` 子路径 344→345 无新增移除、具名导出只增不减、宿主自动迁移 agent DB `v24→v25`、插件 `enabled`、飞书 websocket `client ready`、容器 `healthy`、真实群消息收发正常且**回复经人工确认为 🍤 卡片**、官方 feishu 插件未回装。**10.6 为当前推荐宿主**。另修正文档：`openclaw plugins uninstall feishu --force` 会连带删除 `channels.feishu`（含 `appId`/`appSecret`），需先导出再恢复

## 3.0.1 (2026-09-29)

修复 3.0.0 的插件加载失败（**请勿使用 3.0.0**）。

- 🐛 **修复 `Cannot access 'PANEL_FIELD_POOL' before initialization`**：3.0.0 让 `panel-config` 在模块顶层 import `builder` 的常量来构建字段校验集合，两个模块互相引用导致 TDZ——插件在真实网关里**加载失败、整条飞书通道消失**（本地单测发现不了：错误只发生在模块初始化期）
- 🧪 **新增插件加载冒烟测试** `tests/plugin-load.test.ts`：真实加载卡片引擎模块并断言字段池解析，专门捕获此类 TDZ / 初始化顺序回归（已反向验证：注入原缺陷写法时该测试失败）
- ♻️ `panel-config` 的字段池改为本地声明（`satisfies ReadonlyArray<PanelField>` 与 builder 保持同步，改动时 TS 报错提醒）
- 📦 3.0.0 的功能与迁移说明见下节，3.0.1 仅含此加载修复

## 3.0.0 (2026-09-29) ⚠️ 该版本插件无法加载，请用 3.0.1

**破坏性更新**：面板字段改为可排序的有序数组（配置结构变更）。

- 🧩 **`panel.fields` 有序数组**（替代 2.0.6 的 `panel.segments` 布尔对象）：数组顺序即卡片标题各段的显示顺序，成员即要显示的段——一次解决“开关太多太长”“顺序写死不可调”两个问题
  ```jsonc
  // 只显示 模型名 · 缓存命中 · 输出 · 耗时，并按此顺序
  "panel": { "fields": ["model", "cache", "output", "elapsed"] }
  ```
- 📐 字段池（与 hermes-fry-cards 的 `panel_fields` 同源约定，配置互通）：`model` / `reasoning` / `tools` / `context` / `cache` / `output` / `speed` / `elapsed`
- ⚙️ 缺省（不配 `fields`）= 上述全字段按此顺序；空数组 `[]` = 标题只留 `🍤`；未列出的段不显示
- 🖥️ 配置页由「8 个复选框」变成「1 个可增删条目的列表」，显著缩短表单
- ⚡ 💾 速度段（`⚡ 42.3 tok/s`，transcript 时间戳推算）与缓存命中率段（`💾 86%` = `cacheRead/(input+read+write)`）随 2.0.6 一并保留
- 🐛 修复出错/停止卡片丢弃面板配置（`onError` / `abortCard` 补传 `panel`）
- ⚠️ **迁移**：旧键 `panel.segments` / `showCacheHit` / `showSpeed` **已移除且不再解析**，网关加载时会提示无效配置。升级到 3.0 后把旧的布尔对象改写为 `fields` 数组即可：
  ```jsonc
  // 2.x
  "segments": { "model": true, "reasoning": true, "tools": true, "context": true,
                "cache": true, "output": true, "speed": true, "elapsed": true }
  // 3.0 等价写法（也可只留你想要的段、自由调序）
  "fields": ["model", "reasoning", "tools", "context", "cache", "output", "speed", "elapsed"]
  ```
- 🧪 56 文件 / 480 tests（数组顺序、缺省、空数组、未知字段过滤用例），tsc strict，本地 Docker 全链路验证

## 2.0.6 (2026-09-29)

群聊默认流式卡片 + 面板可选速度/缓存指标版本（本地 Docker 真机实测）。

- 💬 **群聊默认改为流式卡片**：群聊回复默认走卡片（`streaming.mode=partial`），与私聊一致
- ⚡ **面板新增速度段**：`⚡ 42.3 tok/s`，本轮 output ÷ 生成耗时（transcript 时间戳推算：本轮 assistant 事件 − 前一条事件，不含工具执行段，>30 分钟视为异常省略）
- 💾 **面板新增缓存命中率段**：`💾 86%` = 本轮 `cacheRead/(input+read+write)`（旧 footer 缓存段同口径）
- 🎛️ **面板各段均可勾选**：新增 `panel.segments`（配置页每段一个复选框）——`model` / `reasoning` / `tools` / `context` / `cache` / `output` / `speed` / `elapsed`，**默认全部开启**，关闭即从标题隐藏
- 🐛 **修复出错/停止卡片丢弃面板配置**：`onError` / `abortCard` 分支补传 `panel`，模型别名、上下文样式、段开关在两条路径下与完成卡一致
- ♻️ 兼容：早期 `showCacheHit` / `showSpeed` 键解析时并入 `segments.cache` / `segments.speed`
- 🧪 56 文件 / 479 tests（新增缓存命中率、速度格式化、段开关缺省与逐段关闭用例），tsc strict，本地 Docker 全链路验证

## 2.0.5 (2026-09-13)

通道配置中文化与兼容性扩展版本（本地 Docker + 飞牛 fnOS 真机全链路实测）。

- 🎨 **通道配置页中文化**：`channels.feishu` 核心字段中文 describe + uiHints（中文 label/help、App Secret 等敏感字段自动掩码，改用标准 `buildChannelConfigSchema` 入口）；通道 meta 品牌化（「飞书 Feishu」/ 虾条卡片 blurb / 文档指向本仓库）
- 📝 **配置字段中文 title**：插件设置页字段标题汉化（schema title 通路）
- ⏱️ **峰谷价标识 `peakValley` 定型 record 形态**：修复 anyOf 联合类型导致 Control UI 值编辑器退化为窄 JSON 框、配置被清空的问题
- 🛡️ **兼容垫片**：`channel-message` 缺失时回落 `channel-runtime`（createRequire 同步解析，真网关加载器不支持顶层 await）——**兼容下限从 2026.5.12 下探至 2026.5.4**
- 📚 文档：fnOS 专项部署指南 / NAS 部署行程报告 / 兼容性测试报告整合版；一键安装脚本 `install.sh`；全部 release 说明统一版式
- 🔧 Windows 测试清理兼容（open file rmSync）；`.v2c` 取消跟踪

## 2.0.4 (2026-09-13)

面板模型名显示与峰谷价标识版本（本地 Docker + 飞书真机全链路实测）。

- ⇲ **模型名截断**（`truncateModelName`，默认开）：mimo/mimo-v2.5 → ⇲mimo-v2.5
- 🏷️ **模型别名升级**：key 大小写不敏感子串匹配（"mimo" 命中 mimo/mimo-v2.5）、`modelAliasesEnabled` 独立开关、`days` 星期数组化（`[1,2,3,4,5]`）并修复存量 bug（区间正则丢 `\d` 导致 `"1-5"` 从未生效）
- ⏱️ **峰谷价标识 `peakValley`**：DeepSeek 等峰谷计费模型按时间窗切换显示名（峰段 peakName / 谷段 valleyName），内置峰段预置（deepseek / workday-918 / everyday-day / always-peak / custom），record 多条可配，Control UI 可视化编辑、默认收起
- 🎯 **面板标题对齐 zcode-feishu-bridge**：段序 模型·💭·🔧·上下文·🎫·⏱️；上下文 used 改用最后一轮 inputTokens；🎫 改为会话累计输出 tokens；`contextDisplayMode` 默认 text
- 📝 **配置声明完善**：全字段中文 describe + uiHints（Control UI 中文标签/全宽布局/收起层级）；峰谷价时段规则 days 支持 0-6 枚举选择
- 🔧 修复：插件图标改 base64 data URI（CDN 不可达时 Control UI 字母兜底）；CI 修复（prettier 锁死 3.8.1 + pnpm-lock 同步）
- 🧪 56 文件 / 471 tests（新增 model-display / panel-config 用例），tsc strict，本地 Docker + 飞书真机全链路验证（截图见 README）

## 2.0.3 (2026-09-12)

统一面板设置迁入插件自有配置（随插件版本化，不再受宿主 channels.feishu schema 演化影响）。

- ✨ 面板设置新位置：`plugins.entries.claw-fry-cards.config.panel`（unifiedPanelMinDuration / contextDisplayMode / expanded / modelAliases）；插件 configSchema 由空声明改为完整 JSON Schema（openclaw.plugin.json + 入口 `buildPluginConfigSchema`）
- 🛡️ 旧位置 `channels.feishu.panel` 仍兼容读取，插件配置优先
- 🔧 builder 面板 modelAliases 类型放宽为 `ModelAliasEntry`（兼容时段人设对象形态）
- 🧪 新增 panel-config 单测

## 2.0.2 (2026-09-12)

修复 OpenClaw ≥2026.9.4 宿主上卡片永不生效的问题（本地 Docker 部署实测发现）。

- 🐛 **卡片引擎流式判定适配新 schema**：2026.9.4 起宿主把 `channels.feishu.streaming` 从布尔迁移为对象（`{ mode: "off" | "partial" }`）并废弃 `replyMode`，旧判定 `streaming === true` 恒为 false，全部回复退化为纯文本。现兼容布尔（旧宿主）与对象（新宿主）两种形态，`replyMode` 仍向后兼容
- 🧪 新增 reply-mode 单测（两代宿主 schema 形态）

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
