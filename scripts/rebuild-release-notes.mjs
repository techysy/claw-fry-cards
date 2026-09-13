// 一次性工具：重建全部 release body（此前 -F body=@- 传输失误导致全部清空）。
// 用法：node scripts/rebuild-release-notes.mjs
import { execFileSync } from 'node:child_process';

const REPO = 'techysy/claw-fry-cards';
const CHANGELOG = '详见 [CHANGELOG](https://github.com/techysy/claw-fry-cards/blob/main/CHANGELOG.md)';
const SCRIPT_LINE = 'curl -fsSL https://raw.githubusercontent.com/techysy/claw-fry-cards/main/install.sh | bash';
const SOURCE_BUILD = 'git clone https://github.com/techysy/claw-fry-cards.git && cd claw-fry-cards && npm install --legacy-peer-deps && npm run build';

const installBlock = (npmLine, note) => {
  let b = '\n## 📦 安装\n\n';
  if (note) {
    b += note + '\n\n```bash\n' + npmLine + '\n```\n';
  } else {
    b += '一键安装脚本（agent 可直接执行；自动定位 OpenClaw CLI 含 npx 回退，**不自动重启网关**）：\n\n```bash\n' + SCRIPT_LINE + '\n```\n\n';
    b += '或指定本版本：`' + npmLine + '`\n\n';
    b += '源码构建：`' + SOURCE_BUILD + '` → `openclaw plugins install . --force --accept-capabilities`\n';
  }
  return b;
};

const releases = [
  {
    tag: 'v1.0.0',
    body:
      '🍤 1.0 终版 — 钩子伴侣插件形态：官方飞书通道继续收发，本插件通过公开钩子观测并接管回复展示（版本号由日期式 v2026.9.1 改为三位 semver 1.0.0）。\n\n' +
      '> 主线已转向 2.0 通道插件（原 claw-lark-cards 并入）；需要不替换官方通道的轻量方案时使用本版本。获取方式：`git checkout v1.0.0`。\n\n' +
      '---\n\n' +
      '## 🍤 虾条卡片 v2026.9.1 — OpenClaw 飞书流式卡片插件首发\n\n' +
      '> 首个版本 — [🍟 hermes-fry-cards](https://github.com/techysy/hermes-fry-cards) 卡片样式的 **OpenClaw 移植版**（🍟→🍤 兄弟品牌）。平台从 Hermes Gateway 换到 OpenClaw，通过公开钩子接管回复展示，不 patch 任何 OpenClaw 内部代码。\n\n' +
      '### ✨ 核心特性\n\n' +
      '- **OpenClaw 伴侣插件**：官方飞书通道（`@larksuite/openclaw-lark`）负责消息收发，本插件经公开钩子接管回复展示\n' +
      '- **CardKit v2.0 流式占位卡**：`streaming_mode` + loading 图标 + 工具面板，`message_received` 触发创建\n' +
      '- **工具面板实时刷新**：`before_tool_call` / `after_tool_call`，图标映射 + Running/Succeeded/Failed 状态 + 耗时 + 脱敏预览\n' +
      '- **回复打字机**：`message_sending` 分片写入（100ms，长回复自动加速），完成后接管官方文本\n' +
      '- **完成态统一面板**：`🍤 模型 · 💭n · 🔧n · 上下文 [███▓▒░░░] x% · ⏱️ 耗时`，边框色随状态\n' +
      '- **推理剥离**：`<thinking>` / `<antthinking>` / `Reasoning:` 进统一面板\n' +
      '- **全链路回落**：建卡/封卡失败、超时、交互消息均回落官方通道文本\n' +
      '- **双语卡片**：zh_cn / en_us 跟随飞书语言；工具参数脱敏\n\n' +
      '### 🔧 版本说明\n\n' +
      '- 原版本号 `2026.9.1` 对齐 OpenClaw 日期式版本风格（后统一为三位 semver 1.0.0）\n' +
      '- vitest 80 tests + tsc strict 通过\n\n' +
      installBlock(
        'git clone https://github.com/techysy/claw-fry-cards.git && cd claw-fry-cards\ngit checkout v1.0.0\nnpm install --legacy-peer-deps && npm run build\nopenclaw plugins install . --force --accept-capabilities\nopenclaw gateway restart',
        '1.0.0 未发布 npm 包（npm 自 2.0.1 起），从标签源码构建：',
      ) +
      '\n' + CHANGELOG,
  },
  {
    tag: 'v2.0.0',
    body:
      '**主线转向通道插件形态** — 前身 [claw-lark-cards](https://github.com/techysy/claw-lark-cards)（官方 openclaw-lark 的 2.0 适配 fork）合并入本仓库并更名，claw-lark-cards 仓库同步废弃。1.0 伴侣插件形态保留于 `v1.0.0` 标签，按需降级使用。\n\n' +
      '- 🦐→🍤 形态升级：由"钩子伴侣插件"转为**通道插件**——官方通道 2.0 全量适配（SDK 导出路径迁移 100+ 处、`OpenClawConfig` 类型迁移、会话存储迁移 agent transcript SQLite），替换官方 `@larksuite/openclaw-lark`\n' +
      '- 🍤 卡片引擎内置：派发即建卡、CardKit streaming_mode 打字机、原生 reasoning 展示、统一指标面板、状态边框\n' +
      '- 🧰 继承官方全部工具契约（im / doc / wiki / drive / bitable / sheet / calendar / task / oauth 等 38 项）与 skills\n' +
      '- 🔖 插件标识更名：`openclaw-lark` → `claw-fry-cards`；用户配置 `plugins.entries.openclaw-lark` 改为 `plugins.entries.claw-fry-cards`（`channels.feishu` 不变）\n' +
      '- 🧪 实测兼容下限 OpenClaw **2026.5.12**（见 docs/compat-test-report.md）；老版本宿主统一面板自动省略指标段\n\n' +
      installBlock(
        SOURCE_BUILD + '\nopenclaw plugins install . --force --accept-capabilities\nopenclaw gateway restart',
        '2.0.0 未发布 npm 包（自 2.0.1 起），从源码构建：',
      ) +
      '\n**Full Changelog**: https://github.com/techysy/claw-fry-cards/compare/v1.0.0...v2.0.0\n\n' + CHANGELOG,
  },
  {
    tag: 'v2.0.1',
    body:
      '2.0.0 发布审查后的修正版（元数据与文档层面，无引擎代码变更）。\n\n' +
      '- 🔖 `openclaw.plugin.json` 显示名 `OpenClaw Lark Cards` → `Claw Fry Cards`（2.0.0 漏改项，插件列表可见）\n' +
      '- 📝 Issue 模板更名：bug_report 插件版本字段 openclaw-lark → claw-fry-cards；config.yml 的 Ideas / Q&A 链接从官方 discussions 改指本仓库（已启用 Discussions）\n' +
      '- 📦 package.json 补 `repository` 字段（npm 包主页源码链接）\n' +
      '- 🧪 兼容性测试 harness 入库（docs/compat-test-harness.mjs），报告附录改为引用仓库内路径\n' +
      '- 🧹 测试临时目录前缀 openclaw-lark-tool-use → claw-fry-cards-tool-use\n\n' +
      installBlock('openclaw plugins install claw-fry-cards@2.0.1 --force --accept-capabilities') +
      '\n**Full Changelog**: https://github.com/techysy/claw-fry-cards/compare/v2.0.0...v2.0.1\n\n' + CHANGELOG,
  },
  {
    tag: 'v2.0.2',
    body:
      '**修复 OpenClaw ≥2026.9.4 宿主上卡片永不生效的问题**（本地 Docker 部署实测发现）。\n\n' +
      '- 🐛 宿主 2026.9.4 起把 `channels.feishu.streaming` 从布尔迁移为对象（`{ mode: "off" | "partial" }`）并废弃 `replyMode`，旧判定 `streaming === true` 恒为 false，全部回复退化为纯文本\n' +
      '- ✅ 现兼容两种形态：布尔（≤2026.9.1 宿主）与对象（≥2026.9.4 宿主）\n' +
      '- 🧪 新增 reply-mode 单测（两代宿主 schema 形态）\n\n' +
      installBlock('openclaw plugins install claw-fry-cards@2.0.2 --force --accept-capabilities') +
      '\n**Full Changelog**: https://github.com/techysy/claw-fry-cards/compare/v2.0.1...v2.0.2\n\n' + CHANGELOG,
  },
  {
    tag: 'v2.0.3',
    body:
      '**统一面板设置迁入插件自有配置**（随插件版本化，不再受宿主 channels.feishu schema 演化影响）。\n\n' +
      '- ✨ 面板设置新位置：`plugins.entries.claw-fry-cards.config.panel`；插件 configSchema 由空声明改为完整 JSON Schema（openclaw.plugin.json + 入口 `buildPluginConfigSchema`）\n' +
      '- 🛡️ 旧位置 `channels.feishu.panel` 仍兼容读取，插件配置优先\n' +
      '- 🔧 builder 面板 modelAliases 类型放宽为 `ModelAliasEntry`（兼容时段人设对象形态）\n' +
      '- 🧪 新增 panel-config 单测\n\n' +
      installBlock('openclaw plugins install claw-fry-cards@2.0.3 --force --accept-capabilities') +
      '\n**Full Changelog**: https://github.com/techysy/claw-fry-cards/compare/v2.0.2...v2.0.3\n\n' + CHANGELOG,
  },
  {
    tag: 'v2.0.4',
    body:
      '**面板模型名显示与峰谷价标识版本（本地 Docker + 飞书真机全链路实测）**。\n\n' +
      '- ⇲ **模型名截断**（默认开）：mimo/mimo-v2.5 → ⇲mimo-v2.5\n' +
      '- ⏱️ **峰谷价标识 peakValley**：DeepSeek 等峰谷计费模型按时间窗切换显示名（峰段 梁文锋⚡️ / 谷段 梁文谷⚡️），内置峰段预置（deepseek / workday-918 / everyday-day / always-peak / custom），可多条，Control UI 可视化编辑、默认收起\n' +
      '- 🏷️ **模型别名升级**：子串匹配 + 独立开关 + 星期数组化（修复 "1-5" 区间从未生效的存量 bug）\n' +
      '- 🎯 **面板标题对齐 zcode-feishu-bridge**：模型·💭·🔧·上下文·🎫累计输出·⏱️；上下文=最后一轮 inputTokens\n' +
      '- 📝 配置全字段中文声明 + uiHints（配置页中文标签/全宽/收起）\n' +
      '- 🧪 56 文件 / 471 tests · tsc strict · CI 绿\n\n' +
      installBlock('openclaw plugins install claw-fry-cards@2.0.4 --force --accept-capabilities') +
      '\n**Full Changelog**: https://github.com/techysy/claw-fry-cards/compare/v2.0.3...v2.0.4\n\n' + CHANGELOG,
  },
];

for (const r of releases) {
  ghPatch(r.tag, r.body);
}

function ghPatch(tag, body) {
  const id = execFileSync('gh', ['api', `repos/${REPO}/releases/tags/${tag}`, '--jq', '.id'], { encoding: 'utf8' }).trim();
  execFileSync('gh', ['api', '-X', 'PATCH', `repos/${REPO}/releases/${id}`, '--input', '-'], {
    input: JSON.stringify({ body }),
    encoding: 'utf8',
  });
  const after = execFileSync('gh', ['api', `repos/${REPO}/releases/tags/${tag}`, '--jq', '.body'], { encoding: 'utf8' });
  const checks = ['📦 安装', 'Full Changelog', 'CHANGELOG'];
  const missing = checks.filter((c) => !after.includes(c));
  console.log(`${tag}: body ${after.length} 字符, 缺失项: ${missing.length ? missing.join(',') : '无'}`);
}
