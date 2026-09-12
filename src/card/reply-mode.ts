/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Pure functions for resolving the Feishu reply mode.
 *
 * Extracted from reply-dispatcher.ts to enable independent testing
 * and eliminate `as any` casts on FeishuConfig.
 */

import type { FeishuConfig } from '../core/types';
import { FEISHU_CARD_TABLE_LIMIT, findMarkdownTablesOutsideCodeBlocks } from './card-error';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReplyModeValue = 'auto' | 'static' | 'streaming';

/**
 * streaming 配置的两种形态：
 * - 布尔（OpenClaw ≤2026.9.1 宿主）：true 总开关
 * - 对象（OpenClaw ≥2026.9.4 宿主）：`{ mode: "off" | "partial" }`，宿主 schema 已禁止布尔
 */
type StreamingSetting = boolean | { mode?: string } | undefined;

/**
 * 流式是否开启：布尔 true 或对象 mode !== "off"（未设 mode 视为开启）。
 */
export function isStreamingEnabled(value: StreamingSetting): boolean {
  if (value === true) return true;
  if (value !== null && typeof value === 'object') return value.mode !== 'off';
  return false;
}

// ---------------------------------------------------------------------------
// resolveReplyMode
// ---------------------------------------------------------------------------

/**
 * Resolve the effective reply mode based on configuration and chat type.
 *
 * Priority: replyMode.{scene} > replyMode.default > replyMode (string) > "auto"
 */
export function resolveReplyMode(params: {
  feishuCfg: FeishuConfig | undefined;
  chatType?: 'p2p' | 'group';
}): ReplyModeValue {
  const { feishuCfg, chatType } = params;

  // streaming 总开关：兼容布尔（旧宿主）与对象（2026.9.4+ 宿主）两种形态
  if (!isStreamingEnabled(feishuCfg?.streaming)) return 'static';

  const replyMode = feishuCfg?.replyMode;
  if (!replyMode) return 'auto';

  if (typeof replyMode === 'string') return replyMode;

  // Object form: pick scene-specific value
  const sceneMode = chatType === 'group' ? replyMode.group : chatType === 'p2p' ? replyMode.direct : undefined;
  return sceneMode ?? replyMode.default ?? 'auto';
}

// ---------------------------------------------------------------------------
// expandAutoMode
// ---------------------------------------------------------------------------

/**
 * Expand "auto" mode to a concrete mode based on streaming flag and chat type.
 *
 * When streaming enabled: group → static, direct → streaming (legacy behavior).
 * When streaming disabled/unset: always static (new default).
 */
export function expandAutoMode(params: {
  mode: ReplyModeValue;
  streaming: StreamingSetting;
  chatType?: 'p2p' | 'group';
}): 'static' | 'streaming' {
  const { mode, streaming, chatType } = params;
  if (mode !== 'auto') return mode;

  return isStreamingEnabled(streaming) ? (chatType === 'group' ? 'static' : 'streaming') : 'static';
}

// ---------------------------------------------------------------------------
// shouldUseCard
// ---------------------------------------------------------------------------

/**
 * scope A: rich text now renders natively as post(`tag:md`); we never force a
 * card for code blocks OR tables anymore. Native rendering also keeps bot-at-bot
 * @ delivery working — wrapping a reply in a card breaks it (cards have limited
 * @ support). The only remaining card-path guard is the table-count hard limit,
 * retained for the runtime fallback in reply-dispatcher (card rejected by
 * Feishu → plain text).
 */
export function shouldUseCard(text: string): boolean {
  const tableMatches = findMarkdownTablesOutsideCodeBlocks(text);
  if (tableMatches.length > FEISHU_CARD_TABLE_LIMIT) {
    return false;
  }
  return false;
}
