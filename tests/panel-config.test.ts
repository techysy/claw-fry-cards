/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Unit tests for unified panel settings resolution:
 *  - plugin-owned config (`plugins.entries.claw-fry-cards.config.panel`) wins
 *  - legacy `channels.feishu.panel` fallback
 *  - seconds → ms conversion and invalid-shape tolerance
 */

import { describe, expect, it } from 'vitest';

import { expandPeakValley, resolvePanelSettings } from '../src/card/panel-config';

describe('resolvePanelSettings', () => {
  it('reads plugin-owned panel config', () => {
    const cfg = {
      plugins: {
        entries: {
          'claw-fry-cards': {
            config: {
              panel: { unifiedPanelMinDuration: 0, contextDisplayMode: 'text', expanded: true },
            },
          },
        },
      },
    };
    expect(resolvePanelSettings(cfg)).toEqual({
      unifiedPanelMinDurationMs: 0,
      contextDisplayMode: 'text',
      expanded: true,
    });
  });

  it('falls back to legacy channels.feishu.panel', () => {
    const cfg = { channels: { feishu: { panel: { unifiedPanelMinDuration: 5 } } } };
    expect(resolvePanelSettings(cfg)).toEqual({ unifiedPanelMinDurationMs: 5000 });
  });

  it('plugin config takes priority over channel config', () => {
    const cfg = {
      plugins: {
        entries: { 'claw-fry-cards': { config: { panel: { expanded: true } } } },
      },
      channels: { feishu: { panel: { expanded: false, contextDisplayMode: 'bar' } } },
    };
    expect(resolvePanelSettings(cfg)).toEqual({ expanded: true });
  });

  it('passes modelAliases through', () => {
    const aliases = { 'mimo/mimo-v2.5': '小虾米' };
    const cfg = {
      plugins: { entries: { 'claw-fry-cards': { config: { panel: { modelAliases: aliases } } } } },
    };
    expect(resolvePanelSettings(cfg)?.modelAliases).toEqual(aliases);
  });

  it('returns undefined when nothing configured', () => {
    expect(resolvePanelSettings(undefined)).toBeUndefined();
    expect(resolvePanelSettings({})).toBeUndefined();
    expect(
      resolvePanelSettings({ plugins: { entries: { 'claw-fry-cards': { config: {} } } } }),
    ).toBeUndefined();
  });

  it('ignores invalid shapes', () => {
    expect(resolvePanelSettings({ plugins: { entries: { 'claw-fry-cards': 42 } } })).toBeUndefined();
    expect(
      resolvePanelSettings({
        plugins: { entries: { 'claw-fry-cards': { config: { panel: 'nope' } } } },
      }),
    ).toBeUndefined();
    expect(
      resolvePanelSettings({
        channels: { feishu: { panel: { contextDisplayMode: 'rainbow' } } },
      }),
    ).toBeUndefined();
  });
});

describe('expandPeakValley', () => {
  const base = { match: 'flash', peakName: '梁文锋⚡️', valleyName: '梁文谷⚡️' } as const;

  it('expands deepseek into the two peak billing windows', () => {
    expect((expandPeakValley({ ...base, schedule: 'deepseek' }) as { timeAliases?: unknown[] }).timeAliases).toEqual([
      { days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00', name: '梁文锋⚡️' },
      { days: [1, 2, 3, 4, 5], start: '14:00', end: '18:00', name: '梁文锋⚡️' },
    ]);
  });

  it('expands workday-918 / everyday-day / always-peak', () => {
    expect((expandPeakValley({ ...base, schedule: 'workday-918' }) as { timeAliases?: unknown[] }).timeAliases).toEqual([
      { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', name: '梁文锋⚡️' },
    ]);
    expect((expandPeakValley({ ...base, schedule: 'everyday-day' }) as { timeAliases?: unknown[] }).timeAliases).toEqual([
      { start: '08:00', end: '22:00', name: '梁文锋⚡️' },
    ]);
    expect(expandPeakValley({ ...base, schedule: 'always-peak' })).toEqual({ name: '梁文锋⚡️' });
  });

  it('returns undefined for custom schedule (use modelAliases instead)', () => {
    expect(expandPeakValley({ ...base, schedule: 'custom' })).toBeUndefined();
  });

  it('falls back to valleyName when missing', () => {
    const entry = expandPeakValley({
      match: 'flash',
      peakName: '峰',
      valleyName: '',
      schedule: 'deepseek',
    }) as { name?: string };
    expect(entry.name).toBe('峰');
  });

  it('returns undefined for invalid shapes', () => {
    expect(expandPeakValley(undefined)).toBeUndefined();
    expect(expandPeakValley({ match: '', peakName: 'x', valleyName: 'y', schedule: 'deepseek' })).toBeUndefined();
    expect(expandPeakValley({ match: 'flash', peakName: '', valleyName: 'y', schedule: 'deepseek' })).toBeUndefined();
  });
});
