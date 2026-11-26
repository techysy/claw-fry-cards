/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * 面板头左侧 icon 槽位的 logo（PNG）→ 飞书 image_key + 官方模型展示名。
 *
 * 面板 header 的 icon 槽位放 PNG（custom_icon + icon_position=left，原
 * 展开箭头位，不展开也可见）；资产来自 @lobehub/icons-static-png（白底可见版）
 * 随包分发（hermes-fry-cards / feige-fry-cards 同款资产与规则，三侧保持一致）。
 *
 * 取图口径（resolveLogoAsset）：
 * 1. 命中厂商家族 → assets/vendor-logos（口径不变，先命中先得）；
 * 2. 未命中厂商，但模型串或宿主 agentId 里含智能体词 → assets/agent-logos；
 * 3. 都认不出 → 本宿主品牌图 openclaw.png（本仓宿主是 OpenClaw 网关自己），
 *    绝不让面板头左侧重演「空着」。
 * `panel.vendorLogo === false` 时厂商图与兜底图都不出（调用方早退），回到
 * 右侧展开箭头 + 标题 🍤 的旧观感。
 *
 * 首次渲染读取本地文件经 uploadImageLark 换 image_key，进程内缓存；缓存键带
 * 文件内容摘要（sha256 前 12 位），换过像素的资产必然重新上传；失败静默降级纯文本。
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenClawConfig } from 'openclaw/plugin-sdk/core';
import { uploadImageLark } from '../messaging/outbound/media';
import { getLarkAccount } from '../core/accounts';
import { larkLogger } from '../core/lark-logger';

const log = larkLogger('card/vendor-logos');

/** 模型名子串（大小写不敏感）→ 打包内 logo 资产；先命中先得（与渠道前缀无关） */
const VENDOR_LOGO_RULES: ReadonlyArray<readonly [string, string]> = [
  ['deepseek', 'deepseek.png'],
  ['qwen', 'qwen.png'],
  ['zhipu', 'zhipu.png'],
  ['glm', 'zhipu.png'],
  ['zcode', 'zhipu.png'],
  ['chatglm', 'zhipu.png'],
  ['claude', 'claude.png'],
  ['anthropic', 'claude.png'],
  ['gemini', 'gemini.png'],
  ['kimi', 'kimi.png'],
  ['moonshot', 'moonshot.png'],
  ['minimax', 'minimax.png'],
  ['doubao', 'doubao.png'],
  ['hunyuan', 'hunyuan.png'],
  ['gpt', 'openai.png'],
  ['openai', 'openai.png'],
  ['step', 'stepfun.png'],
  // 10R fleet 实际在用的模型家族（按模型名登记，与渠道前缀无关）
  ['hy4', 'hunyuan.png'], // hy4-preview / hy4-flash：腾讯混元 Hy 家族（渠道是 CodeBuddy，模型是混元）
  ['codebuddy', 'codebuddy.png'],
  ['grok', 'grok.png'],
  ['longcat', 'longcat.png'],
  ['mimo', 'xiaomimimo.png'], // Xiaomi MiMo（lobehub 资产名 xiaomimimo）
  ['dots', 'dotsstudio.png'], // dots3-note-prev（lobehub 资产名 dotsstudio）
  ['muse', 'muse.png'], // muse-spark-*
  ['ling', 'ling.png'], // ling-3.0 / ling-3.1（InclusionAI Ling）
  ['upstage', 'upstage.png'], // nous/upstage/solar-mini4
];

/** 家族 → 官方拼写（厂商官网口径，如混元官网的 "Hy4 flash"） */
const FAMILY_OFFICIAL: Readonly<Record<string, string>> = {
  hy4: 'Hy4',
  hunyuan: 'Hunyuan',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  glm: 'GLM',
  chatglm: 'ChatGLM',
  zhipu: 'Zhipu',
  zcode: 'ZCode',
  claude: 'Claude',
  anthropic: 'Claude',
  gemini: 'Gemini',
  kimi: 'Kimi',
  moonshot: 'Moonshot',
  minimax: 'MiniMax',
  doubao: 'Doubao',
  gpt: 'GPT',
  openai: 'OpenAI',
  step: 'Step',
  codebuddy: 'CodeBuddy',
  grok: 'Grok',
  longcat: 'LongCat',
  mimo: 'MiMo',
  dots: 'Dots',
  muse: 'Muse',
  ling: 'Ling',
  upstage: 'Upstage',
};

/** 模型名 → 打包内 logo 文件名（未命中返回 undefined，渲染端降级纯文本） */
export function resolveVendorLogoAsset(model: string): string | undefined {
  const lower = model.toLowerCase();
  for (const [needle, file] of VENDOR_LOGO_RULES) {
    if (lower.includes(needle)) return file;
  }
  return undefined;
}

/**
 * 代理拼接名 → 官方模型展示名；未命中家族返回 undefined.
 *
 * `tencent/hy4-flash:free` → 剥渠道前缀与 `:free` 标签 → `hy4-flash` →
 * 官方家族拼写 `Hy4` + 变体尾巴 `flash` → `Hy4 flash`（混元官网口径）。
 */
export function resolveVendorDisplayName(model: string): string | undefined {
  const file = resolveVendorLogoAsset(model);
  if (!file) return undefined;
  const lower = model.toLowerCase();
  const needle = VENDOR_LOGO_RULES.find(([n, f]) => f === file && lower.includes(n))?.[0];
  if (needle === undefined) return undefined;
  const official = FAMILY_OFFICIAL[needle] ?? needle.charAt(0).toUpperCase() + needle.slice(1);
  const base = model.trim().split('/').pop()!.split(':')[0].trim();
  const idx = base.toLowerCase().indexOf(needle);
  if (idx < 0) return official;
  const tail = base
    .slice(idx + needle.length)
    .replace(/^[-_]+/, '')
    .trim();
  return `${official} ${tail}`.trim() || official;
}

/**
 * 智能体词（小写子串）→ assets/agent-logos 文件名。
 *
 * 文件名与 vendor-logos/ 严格不重名——缓存键含目录前缀，重名仍会串图，故两目录
 * 文件名零交集由测试守卫。本数组**长词在前**：`kimi-code` 必须先于 `kimi`、
 * `claude-code` 先于 `claude`，否则短词会抢走长词的图。
 */
export const AGENT_LOGO_FILES: ReadonlyArray<readonly [string, string]> = [
  ['claude-code', 'claude-code.png'],
  ['claude', 'claude-code.png'],
  ['antigravity', 'antigravity.png'],
  ['kimi-code', 'kimi-code.png'],
  ['openclaw', 'openclaw.png'],
  ['codex', 'codex.png'],
  ['hermes', 'hermes.png'],
  ['zcode', 'zcode.png'],
  ['kimi', 'kimi-code.png'],
  ['agy', 'antigravity.png'],
];

/** 本宿主品牌图：模型与 agentId 都认不出时的最终兜底（宿主就是 OpenClaw 网关） */
const HOST_BRAND_LOGO = 'openclaw.png';

/** 资产所在目录（决定 logoAssetPath 的解析位置，也是缓存键的前缀） */
export type LogoAssetDir = 'vendor-logos' | 'agent-logos';

/** 面板头 logo 资产：文件名 + 所在目录 */
export interface LogoAsset {
  file: string;
  dir: LogoAssetDir;
}

/**
 * 智能体 logo 文件名（assets/agent-logos）；模型串与 agentId 都不含智能体词时返回 undefined.
 *
 * 子串匹配、大小写不敏感（`10router/combo/Hermes` → hermes.png）；本仓宿主没有
 * host 字段，OpenClaw 的 `agentId` 就是宿主/智能体标识，故两路都查：模型串优先。
 * 与 feige-fry-cards 的 `resolve_agent_logo_asset` 同口径（那边靠 host 参数与
 * 「宿主 · 模型」前缀，这边靠子串）。
 */
export function resolveAgentLogoAsset(model: string, agentId?: string): string | undefined {
  const needles = [model, agentId ?? ''].map((s) => s.trim().toLowerCase());
  for (const needle of needles) {
    if (!needle) continue;
    for (const [word, file] of AGENT_LOGO_FILES) {
      if (needle.includes(word)) return file;
    }
  }
  return undefined;
}

/**
 * 面板头 logo 资产（厂商优先 → 智能体词 → 本宿主品牌图兜底）.
 *
 * 恒返回资产：认不出模型就显示智能体/宿主图标，面板头左侧不会空着
 * （`panel.vendorLogo === false` 的关闭语义在调用方早退，与此函数无关）。
 */
export function resolveLogoAsset(model: string, agentId?: string): LogoAsset {
  const vendor = resolveVendorLogoAsset(model);
  if (vendor) return { file: vendor, dir: 'vendor-logos' };
  const agent = resolveAgentLogoAsset(model, agentId);
  if (agent) return { file: agent, dir: 'agent-logos' };
  return { file: HOST_BRAND_LOGO, dir: 'agent-logos' };
}

/** 资产名/目录名合法性：拒绝空串、路径分隔符与 `..`（防穿越，feige 同款守卫） */
function isSafeAssetName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) return false;
  return trimmed === path.basename(trimmed);
}

/**
 * 资产 → 本地 PNG 绝对路径；含路径分隔符 / `..` 的输入返回 undefined（防穿越）.
 *
 * 默认 dist/ → ../assets/<dir>/<file>（安装布局 <plugin>/{dist,assets/{vendor,agent}-logos}）；
 * assetRoot（测试注入）替代 assets 根目录，其下同样是 <dir>/<file> 布局。
 * dir 与 file 都过守卫，避免调用方拿目录名/文件名做穿越。
 */
export function logoAssetPath(file: string, dir: LogoAssetDir, assetRoot?: string): string | undefined {
  if (!isSafeAssetName(file) || !isSafeAssetName(dir)) return undefined;
  // assetRoot 是目录基路径，允许分隔符（绝对路径），但同样拒绝 `..`
  if (assetRoot !== undefined && (!assetRoot.trim() || assetRoot.includes('..'))) return undefined;
  return path.join(assetRoot ?? defaultAssetRoot(dir), dir, file.trim());
}

/**
 * 默认 assets 根目录：安装布局是 <plugin>/{dist,assets}（模块在 dist/ → ../assets），
 * 源码/测试直跑时模块在 src/card/ → ../../assets。取第一个真实存在的目录，
 * 两种布局都能读到资产（只认目录存在，不做任何穿越）。
 */
function defaultAssetRoot(dir: LogoAssetDir): string {
  // CJS 产物用 __dirname，ESM（tsdown / vitest 直跑）用 import.meta.url，与 core/version.ts 同款
  const moduleDir = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(moduleDir, '..', 'assets'), path.join(moduleDir, '..', '..', 'assets')];
  return candidates.find((root) => fs.existsSync(path.join(root, dir))) ?? candidates[0];
}

const memo = new Map<string, Promise<string | null>>();

/**
 * 缓存键的应用维度：image_key 属于上传它的飞书应用，跨 app 不可复用.
 *
 * 取 appId（而非 accountId）——同一 app 配在两个账号名下时 key 仍可共用；
 * 读不到凭据（未配置 / 配置读取抛错）时退化为账号名，宁可多传一次也不串图。
 */
function appScope(cfg: OpenClawConfig, accountId?: string): string {
  try {
    const appId = getLarkAccount(cfg, accountId).appId;
    if (appId) return appId;
  } catch {
    // 配置异常不该影响出卡：退化到账号维度
  }
  return `acct:${accountId ?? 'default'}`;
}

/**
 * 取面板头 logo 的 image_key（懒上传 + 进程内缓存；失败返回 null）.
 *
 * 名字沿用厂商版以兼容既有调用与测试打桩，实际口径是 resolveLogoAsset
 * （厂商命中优先，未识别回退智能体/宿主品牌图）。
 * opts.agentId 为 OpenClaw 智能体 id（宿主标识）；opts.assetRoot 用于测试注入
 * 替代资产根目录（其下按 <dir>/<file> 布局）。
 *
 * 缓存键 = `<app>|<dir>/<file>:<sha256(文件字节) 前 12 位>`：先同步读字节再查缓存，
 * 否则资产换过像素后老进程永远命中旧 image_key，修复在卡上看不见。
 * app 维度不可省：image_key 属于上传它的那个飞书应用，多账号配置下 B 账号复用
 * A 的 key 会直接渲染失败（与姊妹仓 feige / hermes 的缓存口径一致）。
 */
export async function resolveVendorLogoImageKey(
  cfg: OpenClawConfig,
  accountId: string | undefined,
  model: string,
  opts?: { agentId?: string; assetRoot?: string },
): Promise<string | null> {
  const { file, dir } = resolveLogoAsset(model, opts?.agentId);
  const source = logoAssetPath(file, dir, opts?.assetRoot);
  if (!source) {
    log.warn('logo asset path rejected; rendering text-only', { file, dir });
    return null;
  }
  // 同步读字节：内容摘要进缓存键，换像素必然重新上传（读失败静默降级 null）
  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(source);
  } catch (err) {
    log.warn('logo asset read failed; rendering text-only', { file, dir, error: String(err) });
    return null;
  }
  const digest = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
  const cacheKey = `${appScope(cfg, accountId)}|${dir}/${file}:${digest}`;
  const cached = memo.get(cacheKey);
  if (cached) return cached;
  const upload = (async () => {
    try {
      const { imageKey } = await uploadImageLark({ cfg, image: buffer, imageType: 'message', accountId });
      log.info('panel logo uploaded', { file, dir, imageKey });
      return imageKey;
    } catch (err) {
      log.warn('panel logo upload failed; rendering text-only', { file, dir, error: String(err) });
      return null;
    }
  })();
  memo.set(cacheKey, upload);
  return upload;
}
