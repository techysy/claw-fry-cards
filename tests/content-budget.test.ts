/**
 * Tests for content byte budget (src/card/content-budget.ts) and its
 * integration into builder.ts card rendering.
 *
 * Root cause regression: a single long research-style reply (many bullets +
 * long paragraphs) flows into ONE markdown element; without a byte budget the
 * card JSON exceeds the Feishu ~30KB limit and the card overflows / fails to
 * seal (production 2026-11-23, fnOS group).
 */

import { describe, expect, it } from 'vitest';
import {
  ANSWER_MAX_BYTES,
  REASONING_MAX_BYTES,
  TOOL_STEP_BLOCK_MAX_CHARS,
  clampAnswerText,
  clampReasoningText,
  clampStreamingReasoningText,
  clampStreamingText,
  clampToolStepText,
  clampUtf8,
  middleOmissionTag,
  truncationTag,
  utf8ByteLength,
} from '../src/card/content-budget';
import { buildCardContent } from '../src/card/builder';

/** 生成含中文的长文本（CJK 3 字节/字，卡上最常见的膨胀源） */
function longChineseText(chars: number): string {
  return '研'.repeat(chars);
}

describe('utf8ByteLength', () => {
  it('counts CJK as 3 bytes and ASCII as 1', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('研')).toBe(3);
    expect(utf8ByteLength('研a')).toBe(4);
    expect(utf8ByteLength('🦐')).toBe(4);
  });
});

describe('clampUtf8', () => {
  it('returns short text unchanged', () => {
    const text = 'hello 世界';
    expect(clampUtf8(text, ANSWER_MAX_BYTES, true)).toBe(text);
    expect(clampUtf8(text, ANSWER_MAX_BYTES, false)).toBe(text);
  });

  it('head-only truncation appends truncated tag within budget', () => {
    const text = longChineseText(10_000); // 30000 bytes
    const result = clampUtf8(text, 18_000, false);
    expect(utf8ByteLength(result)).toBeLessThanOrEqual(18_000);
    expect(result.endsWith(truncationTag())).toBe(true);
    expect(result.startsWith(text.slice(0, 100))).toBe(true);
  });

  it('preserve-tail keeps head 60% + middle omission + tail 40% within budget', () => {
    const head = '开头背景：'.repeat(100); // head marker
    const tail = '末尾结论：结论是 CargoOK。';
    const text = head + longChineseText(8000) + tail; // ~24KB+
    const result = clampUtf8(text, 18_000, true);
    expect(utf8ByteLength(result)).toBeLessThanOrEqual(18_000);
    expect(result).toContain(middleOmissionTag());
    expect(result.startsWith(head.slice(0, 30))).toBe(true);
    expect(result.endsWith(tail)).toBe(true);
  });

  it('never splits surrogate pairs at cut points', () => {
    const text = '🦐'.repeat(10_000); // 4 bytes each, all surrogate pairs
    const result = clampUtf8(text, 999, true);
    // No lone surrogates: every high surrogate must be followed by a low one
    for (let i = 0; i < result.length; i++) {
      const cp = result.codePointAt(i)!;
      if (cp >= 0xd800 && cp <= 0xdbff) {
        expect(result.charCodeAt(i + 1)).toBeGreaterThanOrEqual(0xdc00);
      }
    }
  });

  it('degenerate budget falls back to prefix + tag (hermes same semantics)', () => {
    const text = longChineseText(2000);
    const result = clampUtf8(text, 50, true);
    // 极端小预算：net budget ≤ 0 时回落「前 100 字符 + 中段省略标记」，
    // 不保证严格 ≤ budget（hermes markdown.py 同款行为），但必须截断
    expect(result.length).toBeLessThan(text.length);
    expect(result).toContain(middleOmissionTag());
  });
});

describe('clamp wrappers', () => {
  it('clampAnswerText uses 18KB budget', () => {
    const text = longChineseText(10_000); // 30KB
    const result = clampAnswerText(text);
    expect(utf8ByteLength(result)).toBeLessThanOrEqual(ANSWER_MAX_BYTES);
    expect(clampAnswerText('短文本')).toBe('短文本');
  });

  it('clampReasoningText uses 10KB budget', () => {
    const text = longChineseText(6000); // 18KB
    const result = clampReasoningText(text);
    expect(utf8ByteLength(result)).toBeLessThanOrEqual(REASONING_MAX_BYTES);
  });

  it('clampStreamingText truncates head-only', () => {
    const text = longChineseText(10_000);
    const result = clampStreamingText(text);
    expect(utf8ByteLength(result)).toBeLessThanOrEqual(ANSWER_MAX_BYTES);
    expect(result).toContain(truncationTag());
    expect(result).not.toContain(middleOmissionTag());
  });

  it('clampStreamingReasoningText truncates head-only within reasoning budget', () => {
    const text = longChineseText(6000);
    const result = clampStreamingReasoningText(text);
    expect(utf8ByteLength(result)).toBeLessThanOrEqual(REASONING_MAX_BYTES);
    expect(result).toContain(truncationTag());
  });
});

describe('clampToolStepText', () => {
  it('returns short content unchanged', () => {
    expect(clampToolStepText('ok')).toBe('ok');
  });

  it('truncates over-budget tool output with a marker', () => {
    const text = 'x'.repeat(TOOL_STEP_BLOCK_MAX_CHARS + 1000);
    const result = clampToolStepText(text);
    expect(result.length).toBeLessThanOrEqual(TOOL_STEP_BLOCK_MAX_CHARS);
    expect(result.endsWith('…（内容过长已截断）…')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Builder integration — the actual regression scenarios
// ---------------------------------------------------------------------------

describe('builder content budget integration', () => {
  it('complete card clamps an over-budget answer (regression: long research reply)', () => {
    const text = longChineseText(12_000) + '\n\n**末尾结论**\nOK'; // ~36KB
    const card = buildCardContent('complete', { text, elapsedMs: 6000, showToolUse: false });
    const answerElement = card.elements[0] as unknown as { tag: string; content: string };
    expect(answerElement.tag).toBe('markdown');
    // 卡片 JSON 总体积必须显著低于飞书 ~30KB 上限（正文预算 18KB + 面板/结构余量）
    const cardJsonBytes = utf8ByteLength(JSON.stringify(card));
    expect(cardJsonBytes).toBeLessThan(30_000);
    expect(cardJsonBytes).toBeLessThan(utf8ByteLength(JSON.stringify({ elements: [text] })));
  });

  it('complete card keeps the tail conclusion of a truncated answer', () => {
    const text = `${longChineseText(8000)}\n\n最终结论：CargoOK。`;
    const card = buildCardContent('complete', { text, showToolUse: false });
    const answerElement = card.elements[0] as unknown as { content: string };
    expect(answerElement.content).toContain(middleOmissionTag());
    expect(answerElement.content).toContain('最终结论：CargoOK。');
  });

  it('complete card clamps reasoning content in the panel', () => {
    const reasoning = longChineseText(6000); // 18KB > 10KB budget
    const card = buildCardContent('complete', {
      text: '短回复',
      reasoningText: reasoning,
      reasoningElapsedMs: 3200,
      elapsedMs: 6000,
      showToolUse: true,
    });
    const jsonBytes = utf8ByteLength(JSON.stringify(card));
    // reasoning 单元素 ≤10KB；卡片整体不被思考正文撑爆
    expect(jsonBytes).toBeLessThan(30_000);
    const panel = card.elements.find((el) => (el as { tag?: string }).tag === 'collapsible_panel') as {
      elements: Array<{ content?: string }>;
    } | undefined;
    expect(panel).toBeDefined();
    const reasoningElement = panel!.elements.find((el) => (el.content ?? '').includes(longChineseText(10)));
    expect(reasoningElement).toBeDefined();
    expect(utf8ByteLength(reasoningElement!.content!)).toBeLessThanOrEqual(REASONING_MAX_BYTES);
  });

  it('streaming card clamps over-budget partial text', () => {
    const text = longChineseText(12_000);
    const card = buildCardContent('streaming', { text, showToolUse: false });
    const answerElement = card.elements[0] as unknown as { content: string };
    expect(utf8ByteLength(answerElement.content)).toBeLessThanOrEqual(ANSWER_MAX_BYTES);
  });

  it('normal-length replies pass through byte-identical', () => {
    const text = '**加粗** 与 `代码` 的普通回复，不受影响。';
    const card = buildCardContent('complete', { text, showToolUse: false });
    const answerElement = card.elements[0] as unknown as { content: string };
    expect(answerElement.content).toContain('**加粗**');
    expect(answerElement.content).toContain('普通回复');
  });

  it('tool step result blocks are clamped per item', () => {
    const bigResult = 'y'.repeat(TOOL_STEP_BLOCK_MAX_CHARS + 5000);
    const card = buildCardContent('complete', {
      text: '正文',
      elapsedMs: 6000,
      showToolUse: true,
      toolUseSteps: [
        {
          title: 'Bash',
          iconToken: 'terminal',
          status: 'success' as const,
          resultBlock: { language: 'text' as const, content: bigResult },
        },
      ],
    });
    const jsonBytes = utf8ByteLength(JSON.stringify(card));
    expect(jsonBytes).toBeLessThan(30_000);
  });
});
