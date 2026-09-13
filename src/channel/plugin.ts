/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * ChannelPlugin interface implementation for the Lark/Feishu channel.
 *
 * This is the top-level entry point that the OpenClaw plugin system uses to
 * discover capabilities, resolve accounts, obtain outbound adapters, and
 * start the inbound event gateway.
 */

import type { ChannelPlugin, OpenClawConfig } from 'openclaw/plugin-sdk/core';
import type { ChannelThreadingToolContext } from 'openclaw/plugin-sdk/channel-contract';
import { DEFAULT_ACCOUNT_ID } from 'openclaw/plugin-sdk/account-id';
import { PAIRING_APPROVED_MESSAGE } from 'openclaw/plugin-sdk/channel-status';
import type { LarkAccount } from '../core/types';
import { getDefaultLarkAccountId, getLarkAccount, getLarkAccountIds } from '../core/accounts';
import { feishuOutbound } from '../messaging/outbound/outbound';
import { feishuMessageActions } from '../messaging/outbound/actions';
import { resolveFeishuGroupToolPolicy } from '../messaging/inbound/policy';
import { LarkClient } from '../core/lark-client';
import { sendMessageFeishu } from '../messaging/outbound/send';
import { looksLikeFeishuId, normalizeFeishuTarget } from '../core/targets';
import { triggerOnboarding } from '../tools/onboarding-auth';
import { larkLogger } from '../core/lark-logger';
import { FEISHU_CONFIG_JSON_SCHEMA } from '../core/config-schema';
import { applyAccountConfig, collectFeishuSecurityWarnings, deleteAccount, setAccountEnabled } from './config-adapter';
import {
  listFeishuDirectoryGroups,
  listFeishuDirectoryGroupsLive,
  listFeishuDirectoryPeers,
  listFeishuDirectoryPeersLive,
} from './directory';

const pluginLog = larkLogger('channel/plugin');

/** 状态轮询的探针结果缓存时长（5 分钟）。 */
const PROBE_CACHE_TTL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert nullable SDK params to optional params for directory functions. */
function adaptDirectoryParams(params: {
  cfg: OpenClawConfig;
  query?: string | null;
  limit?: number | null;
  accountId?: string | null;
}): { cfg: OpenClawConfig; query?: string; limit?: number; accountId?: string } {
  return {
    cfg: params.cfg,
    query: params.query ?? undefined,
    limit: params.limit ?? undefined,
    accountId: params.accountId ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta = {
  id: 'feishu',
  label: '飞书 Feishu',
  selectionLabel: '飞书/Lark（虾条卡片）',
  docsPath: 'https://github.com/techysy/claw-fry-cards#配置',
  docsLabel: '虾条卡片文档',
  blurb: '飞书/Lark 企业消息通道，内置 fry 虾条流式卡片引擎（派发即建卡 · 打字机 · 统一指标面板）。',
  aliases: ['lark'],
  order: 70,
};

// ---------------------------------------------------------------------------
// Channel plugin definition
// ---------------------------------------------------------------------------

export const feishuPlugin: ChannelPlugin<LarkAccount> = {
  id: 'feishu',

  meta: {
    ...meta,
  },

  // -------------------------------------------------------------------------
  // Pairing
  // -------------------------------------------------------------------------

  pairing: {
    idLabel: 'feishuUserId',
    normalizeAllowEntry: (entry) => entry.replace(/^(feishu|user|open_id):/i, ''),
    notifyApproval: async ({ cfg, id }) => {
      const accountId = getDefaultLarkAccountId(cfg);
      pluginLog.info('notifyApproval called', { id, accountId });

      // 1. 发送配对成功消息（保持现有行为）
      await sendMessageFeishu({
        cfg,
        to: id,
        text: PAIRING_APPROVED_MESSAGE,
        accountId,
      });

      // 2. 触发 onboarding
      try {
        await triggerOnboarding({ cfg, userOpenId: id, accountId });
        pluginLog.info('onboarding completed', { id });
      } catch (err) {
        pluginLog.warn('onboarding failed', { id, error: String(err) });
      }
    },
  },

  // -------------------------------------------------------------------------
  // Capabilities
  // -------------------------------------------------------------------------

  capabilities: {
    chatTypes: ['direct', 'group'],
    media: true,
    reactions: true,
    threads: true,
    polls: false,
    nativeCommands: true,
    blockStreaming: true,
  },

  // -------------------------------------------------------------------------
  // Agent prompt
  // -------------------------------------------------------------------------

  agentPrompt: {
    messageToolHints: () => [
      '- Feishu targeting: omit `target` to reply to the current conversation (auto-inferred). Explicit targets: `user:open_id` or `chat:chat_id`.',
      '- Feishu supports interactive cards for rich messages.',
      '- Feishu reactions use UPPERCASE emoji type names (e.g. `OK`,`THUMBSUP`,`THANKS`,`MUSCLE`,`FINGERHEART`,`APPLAUSE`,`FISTBUMP`,`JIAYI`,`DONE`,`SMILE`,`BLUSH` ), not Unicode emoji characters.',
      "- Feishu `action=delete`/`action=unsend` only deletes messages sent by the bot. When the user quotes a message and says 'delete this', use the **quoted message's** message_id, not the user's own message_id.",
    ],
  },

  // -------------------------------------------------------------------------
  // Groups
  // -------------------------------------------------------------------------

  groups: {
    resolveToolPolicy: resolveFeishuGroupToolPolicy,
  },

  // -------------------------------------------------------------------------
  // Reload
  // -------------------------------------------------------------------------

  reload: { configPrefixes: ['channels.feishu'] },

  // -------------------------------------------------------------------------
  // Config schema (JSON Schema)
  // -------------------------------------------------------------------------

  configSchema: {
    schema: FEISHU_CONFIG_JSON_SCHEMA,
    // 通道配置页（Control UI Channels）的中文标签/帮助与敏感字段掩码
    uiHints: {
      enabled: { label: '启用', help: '是否启用飞书通道（默认启用）' },
      appId: { label: 'App ID', help: '飞书应用 App ID（cli_xxx，开放平台自建应用）' },
      appSecret: { label: 'App Secret', sensitive: true, help: '开放平台「凭证与基础信息」页获取' },
      encryptKey: { label: 'Encrypt Key', sensitive: true, help: '事件订阅 Encrypt Key（webhook 模式用）' },
      verificationToken: {
        label: 'Verification Token',
        sensitive: true,
        help: '事件订阅 Verification Token（webhook 模式用）',
      },
      domain: { label: '域名', help: 'feishu = 国内版，lark = 国际版' },
      connectionMode: { label: '连接模式', help: 'websocket（推荐，无需公网回调）或 webhook' },
      dmPolicy: { label: '私聊策略', help: 'open = 全部放行，pairing = 需配对' },
      allowFrom: { label: '私聊白名单', help: '飞书 user id 列表，["*"] = 全部放行' },
      groupPolicy: { label: '群聊策略', help: '群聊访问策略' },
      groupAllowFrom: { label: '群聊白名单', help: '["*"] = 全部放行' },
      requireMention: { label: '群聊需 @', help: '群聊中必须 @ 机器人才响应（默认开）' },
      streaming: { label: '流式输出', help: '2026.9.4+ 宿主：{ "mode": "partial" }；旧宿主：true' },
    },
  },

  // -------------------------------------------------------------------------
  // Config adapter
  // -------------------------------------------------------------------------

  config: {
    listAccountIds: (cfg) => getLarkAccountIds(cfg),
    resolveAccount: (cfg, accountId) => getLarkAccount(cfg, accountId),
    defaultAccountId: (cfg) => getDefaultLarkAccountId(cfg),

    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      return setAccountEnabled(cfg, accountId, enabled);
    },

    deleteAccount: ({ cfg, accountId }) => {
      return deleteAccount(cfg, accountId);
    },

    isConfigured: (account) => account.configured,

    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name,
      appId: account.appId,
      brand: account.brand,
    }),

    resolveAllowFrom: ({ cfg, accountId }) => {
      const account = getLarkAccount(cfg, accountId);
      return (account.config?.allowFrom ?? []).map((entry) => String(entry));
    },

    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },

  // -------------------------------------------------------------------------
  // Security
  // -------------------------------------------------------------------------

  security: {
    collectWarnings: ({ cfg, accountId }) =>
      collectFeishuSecurityWarnings({ cfg, accountId: accountId ?? DEFAULT_ACCOUNT_ID }),
  },

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  setup: {
    resolveAccountId: () => DEFAULT_ACCOUNT_ID,
    applyAccountConfig: ({ cfg, accountId }) => {
      return applyAccountConfig(cfg, accountId, { enabled: true });
    },
  },

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  messaging: {
    normalizeTarget: (raw) => normalizeFeishuTarget(raw) ?? undefined,
    targetResolver: {
      looksLikeId: looksLikeFeishuId,
      hint: '<chatId|user:openId|chat:chatId>',
    },
  },

  // -------------------------------------------------------------------------
  // Directory
  // -------------------------------------------------------------------------

  directory: {
    self: async () => null,
    listPeers: async (p) => listFeishuDirectoryPeers(adaptDirectoryParams(p)),
    listGroups: async (p) => listFeishuDirectoryGroups(adaptDirectoryParams(p)),
    listPeersLive: async (p) => listFeishuDirectoryPeersLive(adaptDirectoryParams(p)),
    listGroupsLive: async (p) => listFeishuDirectoryGroupsLive(adaptDirectoryParams(p)),
  },

  // -------------------------------------------------------------------------
  // Outbound
  // -------------------------------------------------------------------------

  outbound: feishuOutbound,

  // -------------------------------------------------------------------------
  // Threading
  // -------------------------------------------------------------------------

  threading: {
    buildToolContext: ({ context, hasRepliedRef }): ChannelThreadingToolContext => ({
      currentChannelId: normalizeFeishuTarget(context.To ?? '') ?? undefined,
      currentThreadTs: context.MessageThreadId != null ? String(context.MessageThreadId) : undefined,
      currentMessageId: context.CurrentMessageId,
      hasRepliedRef,
    }),
  },

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  actions: feishuMessageActions,

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
      port: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      port: snapshot.port ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account }) => {
      return await LarkClient.fromAccount(account).probe({ maxAgeMs: PROBE_CACHE_TTL_MS });
    },
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name,
      appId: account.appId,
      brand: account.brand,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      port: runtime?.port ?? null,
      probe,
    }),
  },

  // -------------------------------------------------------------------------
  // Gateway
  // -------------------------------------------------------------------------

  gateway: {
    startAccount: async (ctx) => {
      const { monitorFeishuProvider } = await import('./monitor.js');
      const account = getLarkAccount(ctx.cfg, ctx.accountId);
      const port = account.config?.webhookPort ?? null;
      ctx.setStatus({ accountId: ctx.accountId, port });
      ctx.log?.info(`starting feishu[${ctx.accountId}] (mode: ${account.config?.connectionMode ?? 'websocket'})`);
      return monitorFeishuProvider({
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        accountId: ctx.accountId,
      });
    },

    stopAccount: async (ctx) => {
      ctx.log?.info(`stopping feishu[${ctx.accountId}]`);
      await LarkClient.clearCache(ctx.accountId);
      ctx.log?.info(`stopped feishu[${ctx.accountId}]`);
    },
  },
};
