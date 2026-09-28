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

import type { ModelAliasEntry, PanelSegmentToggles } from './builder';

export interface UnifiedPanelSettings {
  unifiedPanelMinDurationMs?: number;
  contextDisplayMode?: 'text' | 'bar' | 'text_bar';
  expanded?: boolean;
  modelAliases?: Record<string, ModelAliasEntry>;
  modelAliasesEnabled?: boolean;
  truncateModelName?: boolean;
  peakValley?: PeakValleyConfig[];
  /** 面板各段显示开关（缺省全开，见 PanelSegmentToggles） */
  segments?: PanelSegmentToggles;
}

/** 面板段开关字段名（用于解析与旧键兼容） */
const SEGMENT_KEYS = [
  'model',
  'reasoning',
  'tools',
  'context',
  'cache',
  'output',
  'speed',
  'elapsed',
] as const satisfies ReadonlyArray<keyof PanelSegmentToggles>;

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
    segments?: unknown;
    /** 旧键（2.0.6 早期形态），解析时并入 segments 保持兼容 */
    showCacheHit?: unknown;
    showSpeed?: unknown;
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
  // segments：面板各段显示开关（缺省全开，仅记录显式布尔值）
  const segments: PanelSegmentToggles = {};
  const rawSegments = p.segments && typeof p.segments === 'object' ? (p.segments as Record<string, unknown>) : {};
  for (const key of SEGMENT_KEYS) {
    if (typeof rawSegments[key] === 'boolean') segments[key] = rawSegments[key] as boolean;
  }
  // 旧键兼容：showCacheHit / showSpeed → segments.cache / segments.speed
  if (typeof p.showCacheHit === 'boolean') segments.cache = p.showCacheHit;
  if (typeof p.showSpeed === 'boolean') segments.speed = p.showSpeed;
  if (Object.keys(segments).length > 0) out.segments = segments;

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
