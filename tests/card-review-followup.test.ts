/**
 * Tests for card table sanitization and the table-budget sharing logic
 * across reply-mode, card-error, and streaming-card-controller.
 *
 * With vitest we mock only the leaf dependencies instead of the old
 * hand-written stub-and-rewrite approach.
 */

import { describe, expect, it, vi } from 'vitest';

// Mock leaf dependency used by card-error → parseCardApiError
vi.mock('../src/core/api-error', () => ({
  extractLarkApiCode: () => undefined,
}));

// streaming-card-controller has heavy infra imports — mock them all.
// card-error and builder are kept real so prepareTerminalCardContent works.
vi.mock('openclaw/plugin-sdk/reply-runtime', () => ({ SILENT_REPLY_TOKEN: '__silent__' }));
vi.mock('../src/core/lark-logger', () => ({
  larkLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../src/core/lark-client', () => ({ LarkClient: {} }));
vi.mock('../src/core/shutdown-hooks', () => ({ registerShutdownHook: () => () => {} }));
vi.mock('../src/messaging/outbound/send', () => ({
  sendCardFeishu: vi.fn(),
  updateCardFeishu: vi.fn(),
}));
vi.mock('../src/card/cardkit', () => ({
  createCardEntity: vi.fn(),
  sendCardByCardId: vi.fn(),
  setCardStreamingMode: vi.fn(),
  streamCardContent: vi.fn(),
  updateCardKitCard: vi.fn(),
}));
vi.mock('../src/card/flush-controller', () => ({
  FlushController: class {
    constructor() {}
    cancelPendingFlush() {}
    complete() {}
    waitForFlush() {
      return Promise.resolve();
    }
    setCardMessageReady() {}
    throttledUpdate() {
      return Promise.resolve();
    }
  },
}));
vi.mock('../src/card/image-resolver', () => ({
  ImageResolver: class {
    resolveImages(t: string) {
      return t;
    }
    resolveImagesAwait(t: string) {
      return Promise.resolve(t);
    }
  },
}));
vi.mock('../src/card/unavailable-guard', () => ({
  UnavailableGuard: class {
    shouldSkip() {
      return false;
    }
    terminate() {
      return false;
    }
    get isTerminated() {
      return false;
    }
  },
}));

import { shouldUseCard } from '../src/card/reply-mode';
import {
  findMarkdownTablesOutsideCodeBlocks,
  isCardElementLimitError,
  sanitizeTextForCard,
} from '../src/card/card-error';
import { buildCardContent, MAX_DISPLAY_TOOL_STEPS } from '../src/card/builder';
import type { ToolUseDisplayStep } from '../src/card/tool-use-display';
import { prepareTerminalCardContent } from '../src/card/streaming-card-controller';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTable(label: string): string {
  return `| name | value |\n| --- | --- |\n| ${label} | ${label} |`;
}

function buildCodeBlockWithTables(count: number): string {
  return ['```md', ...Array.from({ length: count }, (_, i) => buildTable(`code-${i + 1}`)), '```'].join('\n\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('shouldUseCard', () => {
  // scope A (M2 D1): rich text now renders natively as post(`tag:md`); we never
  // force a card for code blocks / tables. Fenced-code tables still don't count
  // toward the limit, so this under-limit case stays on the text path (false).
  it('does not force a card for fenced-code tables (under the table limit)', () => {
    const text = buildCodeBlockWithTables(4);
    expect(shouldUseCard(text)).toBe(false);
  });

  it('does NOT force a card for plain markdown tables (rendered natively)', () => {
    const text = [buildTable('a'), buildTable('b')].join('\n\n');
    expect(shouldUseCard(text)).toBe(false);
  });

  it('does NOT force a card for a fenced code block (rendered natively)', () => {
    const text = ['Here is code:', '```ts\nconst x = 1;\n```'].join('\n\n');
    expect(shouldUseCard(text)).toBe(false);
  });
});

describe('sanitizeTextForCard', () => {
  it('only wraps excess tables outside fenced code blocks', () => {
    const text = [
      buildCodeBlockWithTables(4),
      buildTable('real-1'),
      buildTable('real-2'),
      buildTable('real-3'),
      buildTable('real-4'),
    ].join('\n\n');

    const sanitized = sanitizeTextForCard(text);

    // Code-block tables untouched
    expect(sanitized).toMatch(/```md[\s\S]*\| code-4 \| code-4 \|[\s\S]*```/);
    // 4th real table wrapped in code fence
    expect(sanitized).toMatch(/```\n\| name \| value \|\n\| --- \| --- \|\n\| real-4 \| real-4 \|\n```/);
    // Code-block tables not wrapped
    expect(sanitized).not.toContain('```\n| name | value |\n| --- | --- |\n| code-4 | code-4 |\n```');
  });
});

describe('prepareTerminalCardContent', () => {
  it('sanitizes only the final answer body', () => {
    const rawText = ['Before', buildTable('real-1'), buildTable('real-2'), 'After'].join('\n\n');

    const imageResolver = {
      resolveImages(text: string) {
        return text.replace('Before', 'Resolved');
      },
    };

    const safeContent = prepareTerminalCardContent({ text: rawText }, imageResolver);

    expect(safeContent.text).toMatch(/^Resolved/);
    expect(findMarkdownTablesOutsideCodeBlocks(safeContent.text).length).toBe(2);
    expect(safeContent.text).not.toContain('```');
  });
});

describe('isCardElementLimitError & tool step truncation', () => {
  it('detects 300305 and 11310 element limit errors', () => {
    expect(isCardElementLimitError({ code: 300305, msg: 'ErrMsg: element exceeds the limit; ' })).toBe(true);
    expect(
      isCardElementLimitError({
        code: 230099,
        msg: 'Failed to create card content, ext=ErrCode: 11310; ErrMsg: element exceeds the limit; ',
      }),
    ).toBe(true);
    expect(isCardElementLimitError(new Error('cardkit card.update FAILED: code=300305, msg=ErrMsg: element exceeds the limit; '))).toBe(true);
    expect(isCardElementLimitError({ code: 230020, msg: 'rate limited' })).toBe(false);
  });

  it('truncates excessive tool steps to MAX_DISPLAY_TOOL_STEPS and prepends notice', () => {
    const steps: ToolUseDisplayStep[] = Array.from({ length: 46 }, (_, i) => ({
      title: `Step ${i + 1}`,
      detail: `arg-${i + 1}`,
      iconToken: 'setting_outlined',
      status: 'success',
    }));

    const card = buildCardContent('complete', {
      text: 'Finished task',
      toolUseSteps: steps,
      elapsedMs: 6000,
      showToolUse: true,
    });

    const panel = (card.elements.find((el) => el.tag === 'collapsible_panel') ?? {}) as {
      elements?: Array<{ tag: string; text?: { content?: string } }>;
    };

    expect(panel.elements).toBeDefined();
    // 顶部应当有折叠提示
    const noticeElement = panel.elements![0];
    expect(noticeElement?.text?.content).toContain(`... and ${46 - MAX_DISPLAY_TOOL_STEPS} earlier steps (46 total)`);

    // 实际渲染的 step 数量为 MAX_DISPLAY_TOOL_STEPS
    const stepTitleElements = panel.elements!.filter(
      (el) => el.tag === 'div' && (el as { icon?: unknown }).icon !== undefined,
    );
    expect(stepTitleElements.length).toBe(MAX_DISPLAY_TOOL_STEPS);
  });
});

