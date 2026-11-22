/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * 厂商 logo（PNG）→ 飞书 image_key。
 *
 * header title 是 plain_text，贴不了图；厂商 PNG logo 渲染在统一面板展开区顶部
 * （column_set：logo 并排实际路由模型名）。logo 资产来自 @lobehub/icons-static-png
 * （dark/*-color），打包在插件 assets/vendor-logos/ 下随插件分发；首次渲染时读取
 * 本地文件经 uploadImageLark 换取 image_key，进程内缓存（logo 不可变，无需持久化）。
 * 上传失败静默降级为纯文本模型名，不影响出卡。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenClawConfig } from 'openclaw/plugin-sdk/core';
import { uploadImageLark } from '../messaging/outbound/media';
import { larkLogger } from '../core/lark-logger';

const log = larkLogger('card/vendor-logos');

/** 模型名子串（大小写不敏感）→ 打包内 logo 资产；先命中先得 */
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
];

/** 模型名 → 打包内 logo 文件名（未命中返回 undefined，渲染端降级为纯文本） */
export function resolveVendorLogoAsset(model: string): string | undefined {
  const lower = model.toLowerCase();
  for (const [needle, file] of VENDOR_LOGO_RULES) {
    if (lower.includes(needle)) return file;
  }
  return undefined;
}

function logoAssetPath(file: string): string {
  // dist/ → ../assets/vendor-logos/<file>（安装布局 <plugin>/{dist,assets/vendor-logos}）
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'vendor-logos', file);
}

const memo = new Map<string, Promise<string | null>>();

/**
 * 取厂商 logo 的 image_key（懒上传 + 进程内缓存；失败返回 null）。
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
