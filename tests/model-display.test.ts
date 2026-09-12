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

import { resolveModelAlias, resolvePanelModelName, truncateModelId } from '../src/card/builder';

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

  it('modelAliasesEnabled=false ignores aliases entirely', () => {
    expect(
      resolvePanelModelName({ mimo: '小虾米' }, 'mimo/mimo-v2.5', { modelAliasesEnabled: false }),
    ).toBe('⇲mimo-v2.5');
  });
});

describe('resolveModelAlias days forms', () => {
  // 2026-09-14T04:00Z = 北京时间周一 12:00
  const mondayNoon = new Date('2026-09-14T04:00:00Z');

  it('accepts array days [1] (selectable form)', () => {
    const entry = { name: '默认', timeAliases: [{ days: [1], name: '工作日' }] };
    expect(resolveModelAlias(entry, mondayNoon)).toBe('工作日');
    expect(resolveModelAlias({ name: '默认', timeAliases: [{ days: [2], name: '周二' }] }, mondayNoon)).toBe('默认');
  });

  it('accepts legacy string range "1-5" (regression: regex had lost \\d)', () => {
    const entry = { name: '默认', timeAliases: [{ days: '1-5', name: '工作日' }] };
    expect(resolveModelAlias(entry, mondayNoon)).toBe('工作日');
  });

  it('respects time windows in array form', () => {
    const entry = {
      name: '默认',
      timeAliases: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', name: '上班' }],
    };
    expect(resolveModelAlias(entry, mondayNoon)).toBe('上班');
    const night = { name: '默认', timeAliases: [{ days: [1], start: '00:00', end: '08:00', name: '夜班' }] };
    expect(resolveModelAlias(night, mondayNoon)).toBe('默认');
  });
});
