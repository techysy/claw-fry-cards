#!/usr/bin/env node
/**
 * 发版脚本：校验 → 构建 → 打标签 → 推 Git → 发 npm → 建 GitHub Release。
 *
 * 用法：
 *   node scripts/release.mjs                 # 交互确认后全量发版
 *   node scripts/release.mjs --dry-run       # 只打印将要做什么，不做任何写操作
 *   node scripts/release.mjs --yes           # 跳过确认（CI / 信任场景）
 *   node scripts/release.mjs --skip-gh       # 不发 GitHub Release（只 npm + tag）
 *   node scripts/release.mjs --skip-npm      # 不发 npm（只 tag + GitHub Release）
 *
 * 设计原则：
 *   - 默认全量但在真正写操作前停下来确认一次（npm publish / 打 tag / push 均不可逆）
 *   - 任一步失败立即中止，不吞错；已完成的步骤在报错里说明，便于人工收尾
 *   - 版本号唯一来源是 package.json，且必须与 CHANGELOG 顶部小节一致
 *
 * 约定（与仓库既有发版保持一致）：
 *   - 三位 semver，标签 `v<version>`（annotated，message 即版本号）
 *   - CHANGELOG 顶部形如 `## <version> (YYYY-MM-DD)`
 *   - GitHub Release 标题 `v<version> — <副标题>`，正文取 CHANGELOG 该小节
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = 'techysy/claw-fry-cards';
// 用 fileURLToPath + dirname 处理 Windows 盘符与路径中的空格（%20 会被 URL.pathname 保留）
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CHANGELOG_PATH = join(ROOT, 'CHANGELOG.md');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const ASSUME_YES = args.has('--yes');
const SKIP_GH = args.has('--skip-gh');
const SKIP_NPM = args.has('--skip-npm');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const isWin = process.platform === 'win32';
const resolveCmd = (cmd) => (isWin && (cmd === 'npm' || cmd === 'pnpm') ? `${cmd}.cmd` : cmd);

const sh = (cmd, argv, opts = {}) =>
  execFileSync(resolveCmd(cmd), argv, { cwd: ROOT, encoding: 'utf8', stdio: opts.quiet ? 'pipe' : 'inherit', ...opts });

const capture = (cmd, argv) =>
  execFileSync(resolveCmd(cmd), argv, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const step = (msg) => console.log(`\n\x1b[36m▸ ${msg}\x1b[0m`);
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const warn = (msg) => console.log(`  \x1b[33m!\x1b[0m ${msg}`);
const die = (msg) => {
  console.error(`\n\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
};

async function confirm(question) {
  if (ASSUME_YES) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question(`${question} [y/N] `, res));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

/** 读取 package.json / CHANGELOG，返回版本与更新日志小节。 */
function readVersionAndNotes() {
  const pkg = JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf8'));
  const version = pkg.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    die(`package.json version 不是三位 semver：${version}`);
  }

  const changelog = readFileSync(CHANGELOG_PATH, 'utf8');
  // 顶部 `## <version> (date)` 小节，截到下个 `## ` 之前
  // 注意：不用 \b 收尾——版本号含 `.`，`\b` 在 `3.1.0` 后会因点号边界语义而不匹配；
  // 用「版本号后必须紧跟空白或行尾」限定，避免 `3.1.0` 误配 `3.1.01`。
  const heading = new RegExp(`^## ${version.replace(/\./g, '\\.')}(?:\\s|$)`, 'm');
  const match = heading.exec(changelog);
  if (!match) {
    die(`CHANGELOG.md 顶部找不到 \`## ${version}\` 小节——请先补更新日志再发版。`);
  }
  const rest = changelog.slice(match.index + match[0].length);
  const nextHeading = rest.search(/^## /m);
  const notes = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
  if (!notes) die(`CHANGELOG.md 的 \`## ${version}\` 小节为空。`);

  // 小节首行（去掉 markdown 强调）作为 Release 副标题
  const subtitle = (notes.split('\n').find((l) => l.trim()) ?? '')
    .replace(/[*_`>#]/g, '')
    .trim();

  return { version, notes, subtitle };
}

// ---------------------------------------------------------------------------
// preflight
// ---------------------------------------------------------------------------

function preflight(version, tag) {
  step('发版前校验');

  // 工作区必须干净
  const dirty = capture('git', ['status', '--porcelain']);
  if (dirty) die(`工作区不干净，先提交或 stash：\n${dirty}`);
  ok('工作区干净');

  // 分支应为 main
  const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') warn(`当前分支是 ${branch}，非 main——确认这是有意为之`);

  // 与远端同步
  try {
    capture('git', ['fetch', 'origin', 'main', '--quiet']);
    const local = capture('git', ['rev-parse', 'HEAD']);
    const remote = capture('git', ['rev-parse', 'origin/main']);
    if (local !== remote) warn('本地 main 与 origin/main 不一致（可能需要先 push/pull）');
    else ok('与 origin/main 同步');
  } catch {
    warn('git fetch 失败（离线？）——跳过远端同步检查');
  }

  // 标签不能已存在
  const existing = capture('git', ['tag', '--list', tag]);
  if (existing) die(`标签 ${tag} 已存在——版本号是否忘了上调？`);

  // npm 上不能已有同版本
  if (!SKIP_NPM) {
    try {
      const published = capture('npm', ['view', `${pkgName()}@${version}`, 'version']);
      if (published) die(`npm 上已存在 ${pkgName()}@${version}——npm 版本号不可复用。`);
      ok(`npm 上尚无 ${pkgName()}@${version}`);
    } catch {
      ok(`npm 上尚无 ${pkgName()}@${version}`);
    }
  }

  ok(`版本 ${version} → 标签 ${tag}`);
}

function pkgName() {
  return JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf8')).name;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const { version, notes, subtitle } = readVersionAndNotes();
const tag = `v${version}`;
const title = `${tag} — ${subtitle}`;

if (DRY_RUN) step('DRY RUN（不做任何写操作）');
preflight(version, tag);

step('将要执行：');
console.log(`  1. npm run lint && npm run typecheck && npm test   （质量门禁，先跑后发）`);
console.log(`  2. npm run build                                   构建 dist/`);
if (!SKIP_NPM) console.log(`  3. npm publish                                    发布 ${pkgName()}@${version}`);
console.log(`  4. git tag -a ${tag} -m "${version}"                 打标签`);
console.log(`  5. git push origin main && git push origin ${tag}   推送`);
if (!SKIP_GH) console.log(`  6. gh release create ${tag}                        建 GitHub Release`);

if (DRY_RUN) {
  console.log('\n（dry-run：到此为止）');
  process.exit(0);
}

if (!(await confirm('\n确认执行以上发版步骤？'))) {
  console.log('已取消。');
  process.exit(0);
}

// 1. 质量门禁——本地先跑一遍，避免发出去了才发现 CI 红
step('质量门禁');
sh('npm', ['run', 'lint']);
sh('npm', ['run', 'typecheck']);
sh('npm', ['test']);
ok('lint / typecheck / test 通过');

// 2. 构建
step('构建');
sh('npm', ['run', 'build']);
ok('构建完成');

// 3. 发布 npm
if (!SKIP_NPM) {
  step(`发布 npm ${pkgName()}@${version}`);
  sh('npm', ['publish']);
  ok('npm 发布完成（registry 生效可能有几分钟延迟）');
} else {
  warn('按 --skip-npm 跳过 npm 发布');
}

// 4. 打标签
step(`打标签 ${tag}`);
sh('git', ['tag', '-a', tag, '-m', version]);
ok(`标签 ${tag} 已创建`);

// 5. 推送
step('推送到 origin');
const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
sh('git', ['push', 'origin', branch]);
sh('git', ['push', 'origin', tag]);
ok(`已推送 ${branch} 与 ${tag}`);

// 6. GitHub Release
if (!SKIP_GH) {
  step('创建 GitHub Release');
  const compare = `https://github.com/${REPO}/compare/${prevTagOf(tag)}...${tag}`;
  const body = `${notes}\n\n**Full Changelog**: ${compare}\n`;
  sh('gh', ['release', 'create', tag, '--title', title, '--notes', body]);
  ok('GitHub Release 已创建');
} else {
  warn('按 --skip-gh 跳过 GitHub Release');
}

console.log(`\n\x1b[32m🎉 ${tag} 发版完成\x1b[0m`);
console.log('  提示：npm registry 生效需几分钟；GitHub Release 正文取自 CHANGELOG 对应小节。');

/** 找该标签的前一个版本标签，用于 compare 链接。 */
function prevTagOf(current) {
  const tags = capture('git', ['tag', '--sort=-creatordate'])
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => t && t !== current);
  return tags[0] ?? current;
}
