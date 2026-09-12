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
