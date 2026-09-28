/**
 * Tests for pure utility functions exported from src/card/builder.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCardContent,
  compactNumber,
  computeCacheHitRate,
  formatFooterRuntimeSegments,
  formatTokensPerSecond,
} from '../src/card/builder';
import type { ToolUseDisplayStep } from '../src/card/tool-use-display';

// ---------------------------------------------------------------------------
// compactNumber
// ---------------------------------------------------------------------------

describe('compactNumber', () => {
  it('formats values across ranges', () => {
    expect(compactNumber(0)).toBe('0');
    expect(compactNumber(999)).toBe('999');
    expect(compactNumber(1000)).toBe('1.0k');
    expect(compactNumber(1250)).toBe('1.3k');
    expect(compactNumber(100_000)).toBe('100k');
    expect(compactNumber(1_000_000)).toBe('1.0m');
    expect(compactNumber(123_456_789)).toBe('123m');
  });
});

// ---------------------------------------------------------------------------
// formatFooterRuntimeSegments
// ---------------------------------------------------------------------------

describe('formatFooterRuntimeSegments', () => {
  it('renders configured runtime metrics split into primary and detail lines', () => {
    const result = formatFooterRuntimeSegments({
      footer: {
        status: true,
        elapsed: true,
        tokens: true,
        cache: true,
        context: true,
        model: true,
      },
      elapsedMs: 12_300,
      metrics: {
        inputTokens: 1200,
        outputTokens: 3500,
        cacheRead: 800,
        cacheWrite: 200,
        totalTokens: 4500,
        totalTokensFresh: true,
        contextTokens: 128000,
        model: 'claude-opus-4-6',
      },
    });

    // Primary line: status, elapsed, model
    expect(result.primaryZh).toEqual(['已完成', '耗时 12.3s', 'claude-opus-4-6']);
    expect(result.primaryEn).toEqual(['Completed', 'Elapsed 12.3s', 'claude-opus-4-6']);

    // Detail line: tokens, cache, context（上下文口径 = 最后一轮 inputTokens）
    expect(result.detailZh).toEqual(['↑ 1.2k ↓ 3.5k', '缓存 800/200 (36%)', '上下文 1.2k/128k (1%)']);
    expect(result.detailEn).toEqual(['↑ 1.2k ↓ 3.5k', 'Cache 800/200 (36%)', 'Context 1.2k/128k (1%)']);
  });

  it('respects missing metrics and status variants', () => {
    const stopped = formatFooterRuntimeSegments({
      footer: { status: true, tokens: true, cache: true, context: true, model: true },
      isAborted: true,
      metrics: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        totalTokensFresh: false,
        contextTokens: 4096,
        model: ' ',
      },
    });

    expect(stopped.primaryZh).toEqual(['已停止']);
    expect(stopped.primaryEn).toEqual(['Stopped']);
    expect(stopped.detailZh).toEqual(['↑ 100 ↓ 50', '上下文 100/4.1k (2%)']);
    expect(stopped.detailEn).toEqual(['↑ 100 ↓ 50', 'Context 100/4.1k (2%)']);

    const errored = formatFooterRuntimeSegments({
      footer: { status: true, elapsed: true },
      elapsedMs: 1000,
      isError: true,
    });

    expect(errored.primaryZh).toEqual(['出错', '耗时 1.0s']);
    expect(errored.primaryEn).toEqual(['Error', 'Elapsed 1.0s']);
    expect(errored.detailZh).toEqual([]);
    expect(errored.detailEn).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 💾 缓存命中率 / ⚡ 速度（统一面板 header 新增段）
// ---------------------------------------------------------------------------

describe('computeCacheHitRate', () => {
  it('computes read share over input+read+write', () => {
    expect(computeCacheHitRate({ inputTokens: 7465, cacheRead: 47488, cacheWrite: 0 })).toBe(86);
    expect(computeCacheHitRate({ inputTokens: 1000, cacheRead: 1000, cacheWrite: 3000 })).toBe(20);
  });

  it('treats missing cacheWrite as 0 but requires positive cacheRead', () => {
    expect(computeCacheHitRate({ inputTokens: 500, cacheRead: 1500 })).toBe(75);
    expect(computeCacheHitRate({ inputTokens: 500, cacheRead: 0, cacheWrite: 200 })).toBeUndefined();
    expect(computeCacheHitRate({ cacheRead: 100 })).toBeUndefined();
    expect(computeCacheHitRate(undefined)).toBeUndefined();
  });
});

describe('formatTokensPerSecond', () => {
  it('rounds at 100+ and keeps one decimal below', () => {
    expect(formatTokensPerSecond(135.2)).toBe('135');
    expect(formatTokensPerSecond(38.44)).toBe('38.4');
    expect(formatTokensPerSecond(5)).toBe('5.0');
  });
});

describe('buildCardContent – unified panel header cache/speed segments', () => {
  function panelHeaderText(card: ReturnType<typeof buildCardContent>): string {
    const panel = ((card.elements ?? []).find((el) => (el as Record<string, unknown>).tag === 'collapsible_panel') ??
      {}) as Record<string, unknown>;
    const header = panel.header as { title?: { content?: string } } | undefined;
    return header?.title?.content ?? '';
  }

  const richMetrics = {
    inputTokens: 7465,
    outputTokens: 882,
    outputTokensTotal: 1200,
    cacheRead: 47488,
    cacheWrite: 0,
    contextTokens: 131072,
    tokensPerSecond: 135.2,
    model: 'test-model',
  };

  it('hides 💾 and ⚡ by default (panel.showCacheHit/showSpeed unset)', () => {
    const card = buildCardContent('complete', { text: 'hello', elapsedMs: 6000, footerMetrics: richMetrics });
    const text = panelHeaderText(card);
    expect(text).not.toContain('💾');
    expect(text).not.toContain('⚡');
    // 其余指标段照常显示
    expect(text).toContain('🎫 1.2k');
    expect(text).toContain('⏱️');
  });

  it('renders 💾 hit rate and ⚡ speed only when explicitly enabled', () => {
    const card = buildCardContent('complete', {
      text: 'hello',
      elapsedMs: 6000,
      panel: { showCacheHit: true, showSpeed: true },
      footerMetrics: richMetrics,
    });
    const text = panelHeaderText(card);
    expect(text).toContain('💾 86%');
    expect(text).toContain('⚡ 135 tok/s');
    // 段序：💾 在 🎫 之前，⚡ 在 🎫 与 ⏱️ 之间
    expect(text.indexOf('💾')).toBeLessThan(text.indexOf('🎫'));
    expect(text.indexOf('⚡')).toBeGreaterThan(text.indexOf('🎫'));
    expect(text.indexOf('⚡')).toBeLessThan(text.indexOf('⏱️'));
  });

  it('omits cache and speed segments when data is unavailable', () => {
    const card = buildCardContent('complete', {
      text: 'hello',
      elapsedMs: 6000,
      panel: { showCacheHit: true, showSpeed: true },
      footerMetrics: { inputTokens: 100, outputTokens: 50, model: 'test-model' },
    });
    const text = panelHeaderText(card);
    expect(text).not.toContain('💾');
    expect(text).not.toContain('⚡');
    expect(text).toContain('🎫 50');
  });
});

// ---------------------------------------------------------------------------
// buildCardContent – footer rendered as a single markdown element with \n
// ---------------------------------------------------------------------------

describe('buildCardContent – footer line joining', () => {
  /** Extract footer markdown elements (notation-sized) from the card's top-level elements array. */
  function footerElements(card: ReturnType<typeof buildCardContent>) {
    const elements = (card as { elements?: Array<Record<string, unknown>> }).elements ?? [];
    return elements.filter((el) => el.tag === 'markdown' && el.text_size === 'notation');
  }

  it('merges primary and detail lines into one markdown element with \\n', () => {
    const card = buildCardContent('complete', {
      text: 'hello',
      footer: { status: true, elapsed: true, tokens: true, cache: true, context: true, model: true },
      footerMetrics: {
        inputTokens: 1000,
        outputTokens: 200,
        cacheRead: 500,
        cacheWrite: 100,
        totalTokens: 1200,
        totalTokensFresh: true,
        contextTokens: 128000,
        model: 'test-model',
      },
      elapsedMs: 5000,
    });

    const fes = footerElements(card);

    // Should be exactly ONE footer element (not two)
    expect(fes).toHaveLength(1);

    // The zh_cn content should contain \n joining the two lines
    const zhContent = (fes[0].i18n_content as Record<string, string>)?.zh_cn;
    const lines = zhContent.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('已完成');
    expect(lines[0]).toContain('耗时');
    expect(lines[0]).toContain('test-model');
    expect(lines[1]).toContain('↑');
    expect(lines[1]).toContain('缓存');
    expect(lines[1]).toContain('上下文');
  });

  it('renders single line when only primary segments exist', () => {
    const card = buildCardContent('complete', {
      text: 'hello',
      footer: { status: true, elapsed: true },
      elapsedMs: 3000,
    });

    const fes = footerElements(card);
    expect(fes).toHaveLength(1);

    const content = fes[0].content as string;
    expect(content).not.toContain('\n');
  });

  it('renders no footer element when all footer flags are off', () => {
    const card = buildCardContent('complete', { text: 'hello' });
    expect(footerElements(card)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildCardContent – tool-use step markdown rendering
// ---------------------------------------------------------------------------

describe('buildCardContent – tool-use step rendering', () => {
  const toolUseContentIndent = '0px 0px 0px 22px';

  function toolUseElements(card: ReturnType<typeof buildCardContent>) {
    // 虾条布局：工具行在统一面板（collapsible_panel）的 children 里
    const panel = ((card.elements ?? []).find((el) => (el as Record<string, unknown>).tag === 'collapsible_panel') ??
      {}) as Record<string, unknown>;
    return (panel.elements ?? []) as Array<Record<string, unknown>>;
  }

  it('renders tool-use steps as separate title, detail, and result rows', () => {
    const toolUseSteps = [
      {
        title: 'Run command (2.0 s)',
        detail: 'echo foo > bar',
        status: 'success',
        iconToken: 'setting_outlined',
        resultBlock: {
          language: 'json',
          content: '{\n  "status": "completed",\n  "exitCode": 0\n}',
        },
      },
    ] satisfies ToolUseDisplayStep[];

    const card = buildCardContent('complete', {
      text: 'hello',
      toolUseSteps,
    });

    const panel = ((card.elements ?? []).find((el) => (el as Record<string, unknown>).tag === 'collapsible_panel') ??
      {}) as Record<string, unknown>;
    const [titleRow, detailRow, outputRow] = toolUseElements(card);
    expect(panel.vertical_spacing).toBe('4px');
    expect(((titleRow?.icon ?? {}) as Record<string, unknown>).color).toBe('grey');
    expect(((titleRow?.text ?? {}) as Record<string, unknown>).tag).toBe('lark_md');
    expect(((titleRow?.text ?? {}) as Record<string, unknown>).text_size).toBe('notation');
    expect(((titleRow?.text ?? {}) as Record<string, unknown>).content).toMatch(/Succeeded|Completed/);
    expect(((titleRow?.text ?? {}) as Record<string, unknown>).content).not.toContain("<font color='grey'>");
    expect(((titleRow?.text ?? {}) as Record<string, unknown>).content).not.toContain('```json');

    expect(((detailRow?.text ?? {}) as Record<string, unknown>).tag).toBe('plain_text');
    expect(((detailRow?.text ?? {}) as Record<string, unknown>).text_color).toBe('grey');
    expect(((detailRow?.text ?? {}) as Record<string, unknown>).text_size).toBe('notation');
    expect(((detailRow?.text ?? {}) as Record<string, unknown>).content).toBe('echo foo > bar');
    expect(((detailRow?.text ?? {}) as Record<string, unknown>).content).not.toContain('\\>');
    expect(detailRow?.margin).toBe(toolUseContentIndent);

    expect(((outputRow?.text ?? {}) as Record<string, unknown>).tag).toBe('lark_md');
    expect(((outputRow?.text ?? {}) as Record<string, unknown>).text_size).toBe('notation');
    expect(((outputRow?.text ?? {}) as Record<string, unknown>).content).toContain('```json');
    expect(((outputRow?.text ?? {}) as Record<string, unknown>).content).toContain('"status": "completed"');
    expect(((outputRow?.text ?? {}) as Record<string, unknown>).content).not.toContain('<br>');
    expect(((outputRow?.text ?? {}) as Record<string, unknown>).content).not.toContain('\n\n**Result**');
    expect(outputRow?.margin).toBe(toolUseContentIndent);
  });

  it('renders tool-use errors as separate detail and fenced output rows', () => {
    const toolUseSteps = [
      {
        title: 'Run command (420 ms)',
        detail: 'cat < input.txt > output.txt',
        status: 'error',
        iconToken: 'setting_outlined',
        errorBlock: {
          language: 'text',
          content: 'exit code 1',
        },
      },
    ] satisfies ToolUseDisplayStep[];

    const card = buildCardContent('complete', {
      text: 'hello',
      toolUseSteps,
    });

    const [titleRow, detailRow, outputRow] = toolUseElements(card);
    expect(((titleRow?.icon ?? {}) as Record<string, unknown>).color).toBe('grey');
    expect(((titleRow?.text ?? {}) as Record<string, unknown>).text_size).toBe('notation');
    expect(((titleRow?.text ?? {}) as Record<string, unknown>).content).toContain('Failed');

    expect(((detailRow?.text ?? {}) as Record<string, unknown>).tag).toBe('plain_text');
    expect(((detailRow?.text ?? {}) as Record<string, unknown>).content).toBe('cat < input.txt > output.txt');
    expect(detailRow?.margin).toBe(toolUseContentIndent);

    expect(((outputRow?.text ?? {}) as Record<string, unknown>).tag).toBe('lark_md');
    expect(((outputRow?.text ?? {}) as Record<string, unknown>).content).toContain('```text');
    expect(((outputRow?.text ?? {}) as Record<string, unknown>).content).toContain('exit code 1');
    expect(outputRow?.margin).toBe(toolUseContentIndent);
  });
});
