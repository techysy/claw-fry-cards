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

import type { ModelAliasEntry } from './builder';

export interface UnifiedPanelSettings {
  unifiedPanelMinDurationMs?: number;
  contextDisplayMode?: 'text' | 'bar' | 'text_bar';
  expanded?: boolean;
  modelAliases?: Record<string, ModelAliasEntry>;
  modelAliasesEnabled?: boolean;
  truncateModelName?: boolean;
  timePersona?: TimePersonaConfig;
}

/** 闲时忙时人设：比手写 timeAliases 更简单的预置方式 */
export interface TimePersonaConfig {
  /** 匹配哪些模型（大小写不敏感子串，同别名 key 语义） */
  match: string;
  /** 忙时显示 */
  busyName: string;
  /** 闲时显示（非忙时兜底） */
  idleName: string;
  /** 预置时间表；custom 表示改用 modelAliases.timeAliases 自定义规则 */
  schedule: 'workday' | 'workday-918' | 'everyday-day' | 'always-busy' | 'custom';
}

/** 预置时间表（忙时窗口，北京时间） */
const SCHEDULE_WINDOWS: Record<
  Exclude<TimePersonaConfig['schedule'], 'custom' | 'always-busy'>,
  Array<{ days?: number[]; start: string; end: string }>
> = {
  workday: [
    { days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' },
    { days: [1, 2, 3, 4, 5], start: '14:00', end: '18:00' },
  ],
  'workday-918': [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }],
  'everyday-day': [{ start: '08:00', end: '22:00' }],
};

/** 把 timePersona 展开为等价的别名条目（busyName=忙时规则，idleName=顶层兜底） */
export function expandTimePersona(tp: TimePersonaConfig | undefined): ModelAliasEntry | undefined {
  if (!tp || typeof tp !== 'object') return undefined;
  if (typeof tp.match !== 'string' || !tp.match) return undefined;
  if (typeof tp.busyName !== 'string' || !tp.busyName) return undefined;
  if (tp.schedule === 'custom') return undefined;
  if (tp.schedule === 'always-busy') return { name: tp.busyName };
  const windows = SCHEDULE_WINDOWS[tp.schedule];
  if (!windows) return undefined;
  return {
    name: typeof tp.idleName === 'string' && tp.idleName ? tp.idleName : tp.busyName,
    timeAliases: windows.map((w) => ({ ...w, name: tp.busyName })),
  };
}

const PLUGIN_ID = 'claw-fry-cards';

const CONTEXT_DISPLAY_MODES = ['text', 'bar', 'text_bar'] as const;

function readPanelSettings(raw: unknown): UnifiedPanelSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as {
    unifiedPanelMinDuration?: unknown;
    contextDisplayMode?: unknown;
    expanded?: unknown;
    modelAliases?: unknown;
    modelAliasesEnabled?: unknown;
    truncateModelName?: unknown;
    timePersona?: unknown;
  };
  const out: UnifiedPanelSettings = {};
  if (typeof p.unifiedPanelMinDuration === 'number') {
    out.unifiedPanelMinDurationMs = p.unifiedPanelMinDuration * 1000;
  }
  if (
    p.contextDisplayMode === 'text' ||
    p.contextDisplayMode === 'bar' ||
    p.contextDisplayMode === 'text_bar'
  ) {
    out.contextDisplayMode = p.contextDisplayMode;
  }
  if (typeof p.expanded === 'boolean') out.expanded = p.expanded;
  if (typeof p.truncateModelName === 'boolean') out.truncateModelName = p.truncateModelName;
  if (typeof p.modelAliasesEnabled === 'boolean') out.modelAliasesEnabled = p.modelAliasesEnabled;
  if (p.modelAliases && typeof p.modelAliases === 'object') {
    out.modelAliases = p.modelAliases as Record<string, ModelAliasEntry>;
  }
  if (p.timePersona && typeof p.timePersona === 'object') {
    out.timePersona = p.timePersona as TimePersonaConfig;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function readPluginPanel(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return undefined;
  const entries = (raw as { plugins?: { entries?: Record<string, { config?: unknown }> } }).plugins
    ?.entries;
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
