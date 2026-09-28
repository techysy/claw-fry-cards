/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Unified panel settings resolution.
 *
 * 面板设置有两个来源：
 * - `plugins.entries.claw-fry-cards.config.panel`（推荐，插件自有配置，
 *   随插件版本化，不受宿主 channels.feishu schema 演化影响）
 * - `channels.feishu.panel`（旧位置，向后兼容）
 *
 * 插件配置优先；两处都没配时返回 undefined（引擎用内置默认值）。
 */

import type { ModelAliasEntry, PanelField } from './builder';

export interface UnifiedPanelSettings {
  unifiedPanelMinDurationMs?: number;
  contextDisplayMode?: 'text' | 'bar' | 'text_bar';
  expanded?: boolean;
  modelAliases?: Record<string, ModelAliasEntry>;
  modelAliasesEnabled?: boolean;
  truncateModelName?: boolean;
  peakValley?: PeakValleyConfig[];
  /**
   * 面板字段**有序数组**（与 hermes-fry-cards 的 `panel_fields` 同源约定）：
   * 数组顺序即卡片标题各段的显示顺序，成员即要显示的段。
   * 缺省（未配置）时由引擎回落到默认全字段顺序。
   */
  fields?: PanelField[];
}

/**
 * 合法面板字段集合。
 *
 * 刻意在此**本地声明**而非 import builder 的 `PANEL_FIELD_POOL`：panel-config 与
 * builder 互相引用，若在模块顶层读取 builder 的常量会触发 TDZ
 * （"Cannot access 'PANEL_FIELD_POOL' before initialization"），插件加载即失败。
 * 两边用 `satisfies ReadonlyArray<PanelField>` 保证字段池同步，改动时 TS 会报错提醒。
 */
const PANEL_FIELDS = [
  'model',
  'reasoning',
  'tools',
  'context',
  'cache',
  'output',
  'speed',
  'elapsed',
] as const satisfies ReadonlyArray<PanelField>;

const PANEL_FIELD_SET: ReadonlySet<string> = new Set<string>(PANEL_FIELDS);

/** 峰谷价标识条目：峰段（计费高峰窗口）显示 peakName，谷段（闲时/优惠）显示 valleyName */
export interface PeakValleyConfig {
  /** 匹配哪些模型（大小写不敏感子串，同别名 key 语义） */
  match: string;
  /** 峰段（计费高峰窗口）显示 */
  peakName: string;
  /** 谷段（闲时/优惠窗口）显示（非峰段兜底） */
  valleyName: string;
  /** 峰段窗口预置；custom 表示改用 modelAliases.timeAliases 自定义规则 */
  schedule: 'deepseek' | 'workday-918' | 'everyday-day' | 'always-peak' | 'custom';
}

/** 峰段窗口预置（北京时间） */
const PEAK_WINDOWS: Record<
  Exclude<PeakValleyConfig['schedule'], 'custom' | 'always-peak'>,
  Array<{ days?: number[]; start: string; end: string }>
> = {
  deepseek: [
    { days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' },
    { days: [1, 2, 3, 4, 5], start: '14:00', end: '18:00' },
  ],
  'workday-918': [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }],
  'everyday-day': [{ start: '08:00', end: '22:00' }],
};

/** 把 timePersona 展开为等价的别名条目（busyName=忙时规则，idleName=顶层兜底） */
export function expandPeakValley(pv: PeakValleyConfig | undefined): ModelAliasEntry | undefined {
  if (!pv || typeof pv !== 'object') return undefined;
  if (typeof pv.match !== 'string' || !pv.match) return undefined;
  if (typeof pv.peakName !== 'string' || !pv.peakName) return undefined;
  if (pv.schedule === 'custom') return undefined;
  if (pv.schedule === 'always-peak') return { name: pv.peakName };
  const windows = PEAK_WINDOWS[pv.schedule];
  if (!windows) return undefined;
  return {
    name: typeof pv.valleyName === 'string' && pv.valleyName ? pv.valleyName : pv.peakName,
    timeAliases: windows.map((w) => ({ ...w, name: pv.peakName })),
  };
}

const PLUGIN_ID = 'claw-fry-cards';

function readPanelSettings(raw: unknown): UnifiedPanelSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as {
    unifiedPanelMinDuration?: unknown;
    contextDisplayMode?: unknown;
    expanded?: unknown;
    modelAliases?: unknown;
    modelAliasesEnabled?: unknown;
    truncateModelName?: unknown;
    peakValley?: unknown;
    fields?: unknown;
  };
  const out: UnifiedPanelSettings = {};
  if (typeof p.unifiedPanelMinDuration === 'number') {
    out.unifiedPanelMinDurationMs = p.unifiedPanelMinDuration * 1000;
  }
  if (p.contextDisplayMode === 'text' || p.contextDisplayMode === 'bar' || p.contextDisplayMode === 'text_bar') {
    out.contextDisplayMode = p.contextDisplayMode;
  }
  if (typeof p.expanded === 'boolean') out.expanded = p.expanded;
  if (typeof p.truncateModelName === 'boolean') out.truncateModelName = p.truncateModelName;
  if (typeof p.modelAliasesEnabled === 'boolean') out.modelAliasesEnabled = p.modelAliasesEnabled;
  if (p.modelAliases && typeof p.modelAliases === 'object') {
    out.modelAliases = p.modelAliases as Record<string, ModelAliasEntry>;
  }
  if (Array.isArray(p.peakValley)) {
    out.peakValley = p.peakValley as PeakValleyConfig[];
  } else if (p.peakValley && typeof p.peakValley === 'object') {
    // record 形态（Control UI 编辑器产出）：key 即 match，展开归一为数组
    out.peakValley = Object.entries(p.peakValley as Record<string, Omit<PeakValleyConfig, 'match'>>).map(
      ([match, v]) => ({ ...v, match }),
    );
  }
  // fields：面板字段有序数组（顺序即显示顺序）；逐项校验，过滤未知字段与重复项。
  // 3.0 起为唯一形态（旧的 segments 布尔对象 / showCacheHit / showSpeed 已移除，不再解析）。
  if (Array.isArray(p.fields)) {
    const fields: PanelField[] = [];
    for (const item of p.fields) {
      if (typeof item !== 'string' || !PANEL_FIELD_SET.has(item)) continue;
      const field = item as PanelField;
      if (!fields.includes(field)) fields.push(field);
    }
    out.fields = fields;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function readPluginPanel(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return undefined;
  const entries = (raw as { plugins?: { entries?: Record<string, { config?: unknown }> } }).plugins?.entries;
  const pluginEntry = entries?.[PLUGIN_ID];
  if (!pluginEntry || typeof pluginEntry !== 'object') return undefined;
  return (pluginEntry as { config?: { panel?: unknown } }).config?.panel;
}

function readChannelPanel(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return undefined;
  const feishu = (raw as { channels?: { feishu?: { panel?: unknown } } }).channels?.feishu;
  return feishu?.panel;
}

export function resolvePanelSettings(cfg: unknown): UnifiedPanelSettings | undefined {
  return readPanelSettings(readPluginPanel(cfg)) ?? readPanelSettings(readChannelPanel(cfg));
}
