/**
 * 插件加载冒烟测试。
 *
 * 目的：捕获**模块初始化期**才会暴露的错误——典型是跨模块循环引用导致的 TDZ
 * （如 "Cannot access 'X' before initialization"）。这类错误不影响单独调用某个
 * 纯函数，因此不会被单元测试发现，却会让插件在真实网关里加载失败（整条通道消失）。
 *
 * 这里只加载卡片引擎的两个模块（真实入口 index.ts 依赖宿主 SDK，不适用单测环境），
 * 并强制走一遍它们相互引用的求值顺序。
 */

import { describe, expect, it } from 'vitest';

describe('plugin entry – module initialization', () => {
  it('loads card builder and panel-config without initialization-order errors', async () => {
    const builder = await import('../src/card/builder');
    const panelConfig = await import('../src/card/panel-config');

    // 两边各自导出、互不阻塞；字段池约定一致（改动时此处会失败）
    expect(builder.PANEL_FIELD_POOL).toEqual([
      'model',
      'reasoning',
      'tools',
      'context',
      'cache',
      'output',
      'speed',
      'elapsed',
    ]);
    expect(typeof panelConfig.resolvePanelSettings).toBe('function');

    // panel-config 能正常解析 fields（说明其模块顶层常量已初始化完成，无 TDZ）
    expect(panelConfig.resolvePanelSettings({ plugins: { entries: {} } })).toBeUndefined();
    expect(
      panelConfig.resolvePanelSettings({
        plugins: { entries: { 'claw-fry-cards': { config: { panel: { fields: ['cache', 'model'] } } } } },
      }),
    ).toEqual({ fields: ['cache', 'model'] });
  });

  it('keeps panel-config field pool in sync with the builder', async () => {
    const builder = await import('../src/card/builder');
    const panelConfig = await import('../src/card/panel-config');

    // 未知字段应被解析器过滤——用字段池反推：池内字段全部保留
    const parsed = panelConfig.resolvePanelSettings({
      plugins: {
        entries: { 'claw-fry-cards': { config: { panel: { fields: [...builder.PANEL_FIELD_POOL] } } } },
      },
    });
    expect(parsed?.fields).toEqual([...builder.PANEL_FIELD_POOL]);
  });
});
