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

import { resolvePanelSettings } from '../src/card/panel-config';

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
