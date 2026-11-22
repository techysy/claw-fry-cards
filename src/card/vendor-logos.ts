/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * 厂商路由 logo（PNG）→ 飞书 image_key + 官方模型展示名。
 *
 * 面板 header 的 icon 槽位放家族 PNG（custom_icon + icon_position=left，原
 * 展开箭头位，不展开也可见）；资产来自 @lobehub/icons-static-png（dark/-color）
 * 随包分发（hermes-fry-cards 同款资产与规则，两侧保持一致）。首次渲染读取本地
 * 文件经 uploadImageLark 换 image_key，进程内缓存；失败静默降级纯文本。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenClawConfig } from 'openclaw/plugin-sdk/core';
import { uploadImageLark } from '../messaging/outbound/media';
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
  const tail = base.slice(idx + needle.length).replace(/^[-_]+/, '').trim();
  return `${official} ${tail}`.trim() || official;
}

function logoAssetPath(file: string): string {
  // dist/ → ../assets/vendor-logos/<file>（安装布局 <plugin>/{dist,assets/vendor-logos}）
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'vendor-logos', file);
}

const memo = new Map<string, Promise<string | null>>();

/**
 * 取厂商 logo 的 image_key（懒上传 + 进程内缓存；失败返回 null）.
 * assetRoot 用于测试注入替代路径。
 */
export async function resolveVendorLogoImageKey(
  cfg: OpenClawConfig,
  accountId: string | undefined,
  model: string,
  assetRoot?: string,
): Promise<string | null> {
  const file = resolveVendorLogoAsset(model);
  if (!file) return Promise.resolve(null);
  const cached = memo.get(file);
  if (cached) return cached;
  const upload = (async () => {
    try {
      const source = assetRoot ? path.join(assetRoot, file) : logoAssetPath(file);
      const buffer = fs.readFileSync(source);
      const { imageKey } = await uploadImageLark({ cfg, image: buffer, imageType: 'message', accountId });
      log.info('vendor logo uploaded', { file, imageKey });
      return imageKey;
    } catch (err) {
      log.warn('vendor logo upload failed; rendering text-only', { file, error: String(err) });
      return null;
    }
  })();
  memo.set(file, upload);
  return upload;
}
