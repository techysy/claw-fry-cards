/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Content byte budget — prevents card JSON overflow.
 *
 * Feishu cards have a hard ~30KB JSON size limit (single-card update rejected
 * with 230099 otherwise). The card already guards element count
 * (MAX_DISPLAY_TOOL_STEPS) and table count (FEISHU_CARD_TABLE_LIMIT), but a
 * single long research-style reply (many bullets + long paragraphs) flows
 * into ONE markdown element with no byte budget at all — the whole card JSON
 * exceeds the limit and the final card fails to seal (production 2026-11-23,
 * fnOS group long-reply overflow).
 *
 * Mirrors hermes-fry-cards `cardkit/markdown.py` clamp_utf8 semantics:
 * - UTF-8 byte clamping (CJK chars are 3 bytes; char-count limits underestimate)
 * - ANSWER budget 18000 bytes (~6000 汉字)
 * - REASONING budget 10000 bytes (streaming re-sends full text every frame;
 *   unbounded reasoning rewrites 20–28KB per second and overwhelms the client)
 * - preserve_tail: head 60% + tail 40% with a middle-omission tag (final card —
 *   closing conclusions are at the end and must survive)
 * - head-only truncation with a truncated tag (streaming frames — progressive)
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 单个 answer（正文）元素的 UTF-8 字节预算（≈6000 汉字）。 */
export const ANSWER_MAX_BYTES = 18_000;

/** 单个 reasoning（思考）元素的 UTF-8 字节预算（answer 的 ~55%）。 */
export const REASONING_MAX_BYTES = 10_000;

/**
 * 工具步骤 detail / result / error 代码块的字符串预算。
 * 工具步骤本身有 MAX_DISPLAY_TOOL_STEPS=15 收纳，但单步的 result JSON
 * （RESULT_STRING_LIMIT=1024 是 trace 层的，display 层 buildDisplayBlock
 * 不截断）在 15 步叠加时仍可观；per-item 4KB 封顶。
 */
export const TOOL_STEP_BLOCK_MAX_CHARS = 4096;

const TRUNCATED_TAG_ZH = '…（内容过长已截断，防卡片溢出）…';
const MIDDLE_OMITTED_TAG_ZH = '…（中段内容已省略，保留开头背景与末尾核心结论，防卡片溢出）…';

// ---------------------------------------------------------------------------
// UTF-8 helpers
// ---------------------------------------------------------------------------

export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * 二分查找最大前缀长度使 UTF-8 字节数 ≤ budget。
 * 不切割代理对：越界的 surrogate 起点回退一位。
 */
function maxBytePrefixLength(text: string, budget: number): number {
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (utf8ByteLength(text.slice(0, mid)) <= budget) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  // Avoid splitting a surrogate pair at the cut point.
  if (lo > 0 && lo < text.length) {
    const cp = text.codePointAt(lo - 1) ?? 0;
    if (cp > 0xffff) return lo - 1;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// clamp functions
// ---------------------------------------------------------------------------

/**
 * 按 UTF-8 字节钳制长文（hermes-fry-cards clamp_utf8 同款语义）。
 *
 * - preserve_tail=true：首 60% + 中段省略标记 + 尾 40%，用于终态封卡
 *   （结尾结论不丢）。
 * - preserve_tail=false：头截断 + 截断标记，用于流式进行中（渐进截断，
 *   后续增量自然补全）。
 */
export function clampUtf8(text: string, maxBytes: number, preserveTail: boolean): string {
  if (!text || utf8ByteLength(text) <= maxBytes) return text;

  if (!preserveTail) {
    const tag = TRUNCATED_TAG_ZH;
    const budget = maxBytes - utf8ByteLength(`\n\n${tag}`);
    if (budget <= 0) return text.slice(0, 100) + tag;
    return text.slice(0, maxBytePrefixLength(text, budget)) + `\n\n${tag}`;
  }

  const tag = `\n\n${MIDDLE_OMITTED_TAG_ZH}\n\n`;
  const tagBytes = utf8ByteLength(tag);
  const netBudget = maxBytes - tagBytes;
  if (netBudget <= 0) return text.slice(0, 100) + tag;

  const headBudget = Math.floor(netBudget * 0.6);
  const tailBudget = netBudget - headBudget;

  const headText = text.slice(0, maxBytePrefixLength(text, headBudget));
  const tailLen = maxByteSuffixLength(text, tailBudget);
  const tailText = tailLen > 0 ? text.slice(text.length - tailLen) : '';

  return headText + tag + tailText;
}

/**
 * 二分查找最大后缀长度使 UTF-8 字节数 ≤ budget。
 * 不切割代理对：越界的 surrogate 起点再前移一位。
 */
function maxByteSuffixLength(text: string, budget: number): number {
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (utf8ByteLength(text.slice(text.length - mid)) <= budget) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  // Avoid splitting a surrogate pair at the cut point.
  if (lo > 0 && lo < text.length) {
    const cp = text.codePointAt(text.length - lo) ?? 0;
    if (cp > 0xffff && cp < 0xdc00) return lo - 1;
  }
  return lo;
}

/**
 * 面向卡片的正文钳制入口：answer 元素预算，终态保尾。
 */
export function clampAnswerText(text: string, preserveTail = true): string {
  return clampUtf8(text, ANSWER_MAX_BYTES, preserveTail);
}

/**
 * 面向卡片的思考文本钳制入口：reasoning 元素预算，终态保尾。
 */
export function clampReasoningText(text: string, preserveTail = true): string {
  return clampUtf8(text, REASONING_MAX_BYTES, preserveTail);
}

/**
 * 面向卡片的流式帧钳制入口：answer 预算、头截断（渐进补全）。
 */
export function clampStreamingText(text: string): string {
  return clampUtf8(text, ANSWER_MAX_BYTES, false);
}

/**
 * 面向卡片的流式思考钳制入口：reasoning 预算、头截断。
 */
export function clampStreamingReasoningText(text: string): string {
  return clampUtf8(text, REASONING_MAX_BYTES, false);
}

/**
 * 工具步骤 detail / result / error 代码块内容钳制（per-item）。
 * 超限截断 + 提示标记；i18n 双语由调用方按需拼接，这里统一中文口径
 * （工具面板为 notation 小字，中英混合可接受）。
 */
export function clampToolStepText(text: string): string {
  if (!text || text.length <= TOOL_STEP_BLOCK_MAX_CHARS) return text;
  const tag = '\n…（内容过长已截断）…';
  return text.slice(0, TOOL_STEP_BLOCK_MAX_CHARS - tag.length) + tag;
}

// ---------------------------------------------------------------------------
// i18n tag accessors（供测试与调用方断言用）
// ---------------------------------------------------------------------------

export function truncationTag(): string {
  return TRUNCATED_TAG_ZH;
}

export function middleOmissionTag(): string {
  return MIDDLE_OMITTED_TAG_ZH;
}
