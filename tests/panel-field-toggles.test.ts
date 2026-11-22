/**
 * Tests for panel field toggles (复选框显隐) and the vendor display-name
 * decoupling (官方名映射与 logo 显隐解耦):
 *  - fieldToggles resolve into the default-ordered fields list
 *  - fieldToggles take precedence over the legacy ordered fields array
 *  - unchecked-all = no segments; invalid entries filtered
 *  - buildCompleteCard maps the official vendor name even when routingLogo
 *    is absent (logo off / upload failed / vendor missed)
 */

import { describe, expect, it } from 'vitest';

import { buildCardContent } from '../src/card/builder';
import { resolvePanelSettings } from '../src/card/panel-config';

function pluginCfg(panel: unknown) {
  return { plugins: { entries: { 'claw-fry-cards': { config: { panel } } } } };
}

const ALL_FIELDS = ['model', 'reasoning', 'tools', 'context', 'cache', 'output', 'speed', 'elapsed'];

describe('fieldToggles resolution (panel-config)', () => {
  it('resolves toggles into the default-ordered fields list', () => {
    const settings = resolvePanelSettings(pluginCfg({ fieldToggles: { speed: false } }));
    expect(settings?.fields).toEqual(ALL_FIELDS.filter((f) => f !== 'speed'));
  });

  it('unchecks a segment via false and keeps checked segments via true', () => {
    const settings = resolvePanelSettings(pluginCfg({ fieldToggles: { model: false, cache: true } }));
    expect(settings?.fields).toEqual(['reasoning', 'tools', 'context', 'cache', 'output', 'speed', 'elapsed']);
  });

  it('unchecked-everything resolves to an empty list (no segments shown)', () => {
    const settings = resolvePanelSettings(
      pluginCfg({ fieldToggles: Object.fromEntries(ALL_FIELDS.map((f) => [f, false])) }),
    );
    expect(settings?.fields).toEqual([]);
  });

  it('treats an empty toggles object as not configured', () => {
    expect(resolvePanelSettings(pluginCfg({ fieldToggles: {} }))).toBeUndefined();
  });

  it('filters unknown toggle keys (hand-written config typos)', () => {
    const settings = resolvePanelSettings(
      pluginCfg({ fieldToggles: { model: false, bogus: true, typo: false } as Record<string, unknown> }),
    );
    expect(settings?.fields).toEqual(ALL_FIELDS.filter((f) => f !== 'model'));
  });

  it('fieldToggles take precedence over the legacy fields array', () => {
    const settings = resolvePanelSettings(
      pluginCfg({ fieldToggles: { model: false }, fields: ['elapsed'] }),
    );
    expect(settings?.fields).toEqual(ALL_FIELDS.filter((f) => f !== 'model'));
  });

  it('legacy fields array still works when no toggles are configured', () => {
    const settings = resolvePanelSettings(pluginCfg({ fields: ['elapsed', 'model'] }));
    expect(settings?.fields).toEqual(['elapsed', 'model']);
  });
});

describe('vendor display name decoupled from routingLogo (builder)', () => {
  type PanelHeaderCard = {
    elements: Array<{ tag: string; header?: { title?: { content?: string } } }>;
  };

  function panelHeaderTitle(card: unknown): string | undefined {
    const el = (card as PanelHeaderCard).elements.find((e) => e.tag === 'collapsible_panel');
    return el?.header?.title?.content;
  }

  function buildComplete(overrides: Record<string, unknown> = {}) {
    return buildCardContent('complete', {
      text: '回复正文',
      elapsedMs: 6000,
      showToolUse: true,
      footerMetrics: { model: 'hy4-flash', responseModel: 'hy4-flash' },
      ...overrides,
    });
  }

  it('maps the official vendor name even without a routing logo (logo off)', () => {
    const title = panelHeaderTitle(buildComplete({ routingLogo: undefined }));
    expect(title).toContain('Hy4 flash');
    // 无 logo 时回落 🍤 品牌图标
    expect(title).toContain('🍤');
  });

  it('keeps the official vendor name when a routing logo is present', () => {
    const title = panelHeaderTitle(buildComplete({ routingLogo: { imageKey: 'img_key', model: 'hy4-flash' } }));
    expect(title).toContain('Hy4 flash');
    expect(title).not.toContain('🍤');
  });

  it('falls back to the raw model name for unknown vendors', () => {
    const title = panelHeaderTitle(buildComplete({ footerMetrics: { model: 'totally-unknown-model' } }));
    expect(title).toContain('totally-unknown-model');
  });
});
