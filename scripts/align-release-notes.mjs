// 一次性工具：为所有 release 对齐「📦 安装」节（含一键安装脚本）。
// 用法：node scripts/align-release-notes.mjs
import { execFileSync } from 'node:child_process';

const REPO = 'techysy/claw-fry-cards';
const SCRIPT_LINE =
  'curl -fsSL https://raw.githubusercontent.com/techysy/claw-fry-cards/main/install.sh | bash';
const SOURCE_BUILD =
  'git clone https://github.com/techysy/claw-fry-cards.git && cd claw-fry-cards && npm install --legacy-peer-deps && npm run build';

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' });

const releases = [
  {
    tag: 'v1.0.0',
    note: '1.0.0 未发布 npm 包（npm 自 2.0.1 起），从标签源码构建：',
    cmd: `git clone https://github.com/${REPO}.git && cd claw-fry-cards\ngit checkout v1.0.0\nnpm install --legacy-peer-deps && npm run build\nopenclaw plugins install . --force --accept-capabilities\nopenclaw gateway restart`,
    installLine: null,
  },
  {
    tag: 'v2.0.0',
    note: '2.0.0 未发布 npm 包（自 2.0.1 起），从源码构建：',
    cmd: `${SOURCE_BUILD}\nopenclaw plugins install . --force --accept-capabilities\nopenclaw gateway restart`,
    installLine: null,
  },
  { tag: 'v2.0.1', note: null, cmd: 'openclaw gateway restart', installLine: 'openclaw plugins install claw-fry-cards@2.0.1 --force --accept-capabilities' },
  { tag: 'v2.0.2', note: null, cmd: 'openclaw gateway restart', installLine: 'openclaw plugins install claw-fry-cards@2.0.2 --force --accept-capabilities' },
  { tag: 'v2.0.3', note: null, cmd: 'openclaw gateway restart', installLine: 'openclaw plugins install claw-fry-cards@2.0.3 --force --accept-capabilities' },
  { tag: 'v2.0.4', note: null, cmd: 'openclaw gateway restart', installLine: 'openclaw plugins install claw-fry-cards@2.0.4 --force --accept-capabilities' },
];

for (const r of releases) {
  const body = gh(['api', `repos/${REPO}/releases/tags/${r.tag}`, '--jq', '.body']);
  const id = gh(['api', `repos/${REPO}/releases/tags/${r.tag}`, '--jq', '.id']).trim();

  // 去掉旧的 📦 安装 节（从 "## 📦 安装" 到下一个 "## " 或 Full Changelog 前）
  let next = body.replace(/\n## 📦 安装[\s\S]*?(?=\n---\n\n\*\*Full Changelog\*\*|\n## |\n\*\*Full Changelog\*\*|$)/, '\n');

  let block = '\n## 📦 安装\n\n';
  if (r.installLine) {
    block += '一键安装脚本（agent 可直接执行；自动定位 OpenClaw CLI 含 npx 回退，**不自动重启网关**）：\n\n```bash\n' + SCRIPT_LINE + '\n```\n\n或指定本版本：`' + r.installLine + '`\n\n源码构建：`' + SOURCE_BUILD + '` → `openclaw plugins install . --force --accept-capabilities`\n';
  } else {
    block += r.note + '\n\n```bash\n' + r.cmd + '\n```\n';
  }

  // 插入到 Full Changelog 之前；没有 Full Changelog 就追加到尾部
  if (/\*\*Full Changelog\*\*/.test(next)) {
    next = next.replace(/(\*\*Full Changelog\*\*)/, block.trimEnd() + '\n\n$1');
  } else {
    next = next.trimEnd() + '\n\n' + block.trimEnd() + '\n';
  }

  gh(['api', '-X', 'PATCH', `repos/${REPO}/releases/${id}`, '-F', `body=@-`], { input: next });
  console.log(`${r.tag}: 安装节已对齐`);
}
