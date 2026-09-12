/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Unit tests for panel model-name display (hermes-fry-cards 同款语义):
 *  - 别名 key 大小写不敏感子串匹配，插入序第一条命中
 *  - 别名（含时段人设对象）优先于截断
 *  - truncateModelName !== false 时回落 ⇲ 截断（取最后一段）
 */

import { describe, expect, it } from 'vitest';

import { resolvePanelModelName, truncateModelId } from '../src/card/builder';

describe('truncateModelId', () => {
  it('keeps the last path segment with ⇲ prefix', () => {
    expect(truncateModelId('nvidia/moonshotai/kimi-k3')).toBe('⇲kimi-k3');
    expect(truncateModelId('10router/ag/gemini-3.8-flash-high')).toBe('⇲gemini-3.8-flash-high');
    expect(truncateModelId('mimo/mimo-v2.5')).toBe('⇲mimo-v2.5');
  });

  it('returns bare names unchanged (no slash)', () => {
    expect(truncateModelId('kimi-k3')).toBe('kimi-k3');
  });
});

describe('resolvePanelModelName', () => {
  it('falls back to truncation by default (truncateModelName unset)', () => {
    expect(resolvePanelModelName({}, 'mimo/mimo-v2.5')).toBe('⇲mimo-v2.5');
  });

  it('shows the full name when truncateModelName is false', () => {
    expect(resolvePanelModelName({}, 'mimo/mimo-v2.5', { truncateModelName: false })).toBe(
      'mimo/mimo-v2.5',
    );
  });

  it('matches alias keys case-insensitively as substrings', () => {
    expect(resolvePanelModelName({ mimo: '小虾米' }, 'mimo/mimo-v2.5')).toBe('小虾米');
    expect(resolvePanelModelName({ MIMO: '小虾米' }, 'mimo/mimo-v2.5')).toBe('小虾米');
    expect(resolvePanelModelName({ 'mimo-v2': 'V2' }, 'mimo/mimo-v2.5')).toBe('V2');
  });

  it('returns the first hit in insertion order', () => {
    expect(resolvePanelModelName({ mimo: 'A', 'mimo/mimo': 'B' }, 'mimo/mimo-v2.5')).toBe('A');
  });

  it('alias hit takes priority over truncation', () => {
    expect(resolvePanelModelName({ mimo: '小虾米' }, 'mimo/mimo-v2.5', {})).toBe('小虾米');
  });

  it('resolves time-persona alias entries via resolveModelAlias', () => {
    expect(resolvePanelModelName({ mimo: { name: '默认名' } }, 'mimo/mimo-v2.5')).toBe('默认名');
  });

  it('no match and no slash → unchanged even with truncation on', () => {
    expect(resolvePanelModelName({}, 'kimi-k3')).toBe('kimi-k3');
  });
});
