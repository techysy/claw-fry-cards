/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * OpenClaw Lark/Feishu plugin entry point.
 *
 * Registers the Feishu channel and all tool families:
 * doc, wiki, drive, perm, bitable, task, calendar.
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { buildPluginConfigSchema } from 'openclaw/plugin-sdk/core';
import { feishuPlugin } from './src/channel/plugin';
import { LarkClient } from './src/core/lark-client';
import { PluginConfigSchema } from './src/core/config-schema';
import { registerOapiTools } from './src/tools/oapi/index';
import { registerFeishuMcpDocTools } from './src/tools/mcp/doc/index';
import { registerFeishuOAuthTool } from './src/tools/oauth';
import { registerFeishuOAuthBatchAuthTool } from './src/tools/oauth-batch-auth';
import { registerAskUserQuestionTool } from './src/tools/ask-user-question';
import {
  analyzeTrace,
  formatDiagReportCli,
  formatTraceOutput,
  runDiagnosis,
  traceByMessageId,
} from './src/commands/diagnose';
import { registerCommands } from './src/commands/index';
import { larkLogger } from './src/core/lark-logger';
import { emitSecurityWarnings } from './src/core/security-check';
import { recordToolUseEnd, recordToolUseStart } from './src/card/tool-use-trace-store';
import { sanitizeParamsForLog } from './src/card/reasoning-utils';

const log = larkLogger('plugin');

// ---------------------------------------------------------------------------
// Re-exports for external consumers
// ---------------------------------------------------------------------------

export { resolveModelAlias, resolvePanelModelName, truncateModelId, type ModelAliasEntry } from './src/card/builder';
export { monitorFeishuProvider } from './src/channel/monitor';
export {
  PluginConfigSchema,
  PLUGIN_CONFIG_JSON_SCHEMA,
  type PluginConfig,
} from './src/core/config-schema';
export { sendMessageFeishu, sendCardFeishu, updateCardFeishu, editMessageFeishu } from './src/messaging/outbound/send';
export { getMessageFeishu } from './src/messaging/outbound/fetch';
export {
  uploadImageLark,
  uploadFileLark,
  sendImageLark,
  sendFileLark,
  sendAudioLark,
  uploadAndSendMediaLark,
} from './src/messaging/outbound/media';
export {
  sendTextLark,
  sendCardLark,
  sendMediaLark,
  type SendTextLarkParams,
  type SendCardLarkParams,
  type SendMediaLarkParams,
} from './src/messaging/outbound/deliver';
export { type FeishuChannelData } from './src/messaging/outbound/outbound';
export { probeFeishu } from './src/channel/probe';
export {
  addReactionFeishu,
  removeReactionFeishu,
  listReactionsFeishu,
  FeishuEmoji,
  VALID_FEISHU_EMOJI_TYPES,
} from './src/messaging/outbound/reactions';
export { forwardMessageFeishu } from './src/messaging/outbound/forward';
export {
  updateChatFeishu,
  addChatMembersFeishu,
  removeChatMembersFeishu,
  listChatMembersFeishu,
} from './src/messaging/outbound/chat-manage';
export { feishuMessageActions } from './src/messaging/outbound/actions';
export {
  mentionedBot,
  nonBotMentions,
  extractMessageBody,
  formatMentionForText,
  formatMentionForCard,
  formatMentionAllForText,
  formatMentionAllForCard,
  buildMentionedMessage,
  buildMentionedCardContent,
  type MentionInfo,
} from './src/messaging/inbound/mention';
export { feishuPlugin } from './src/channel/plugin';
export type {
  MessageContext,
  RawMessage,
  RawSender,
  FeishuMessageContext,
  FeishuReactionCreatedEvent,
} from './src/messaging/types';
export { handleFeishuReaction } from './src/messaging/inbound/reaction-handler';
export { parseMessageEvent } from './src/messaging/inbound/parse';
export { checkMessageGate } from './src/messaging/inbound/gate';
export { isMessageExpired } from './src/messaging/inbound/dedup';

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

// 插件配置 schema：uiHints 提供中文名称/帮助（带 hints 的字段渲染为全宽堆叠布局）
const pluginConfigSchema = buildPluginConfigSchema(
  PluginConfigSchema as unknown as Parameters<typeof buildPluginConfigSchema>[0],
  {
    uiHints: {
      panel: { label: '统一面板设置', help: '完成态底部折叠面板的行为' },
      'panel.unifiedPanelMinDuration': {
        label: '面板耗时门槛（秒）',
        help: '回复 ≥ 此值或有思考/工具过程时显示面板，0 = 每条必出（默认 5）',
      },
      'panel.contextDisplayMode': {
        label: '上下文段样式',
        help: 'text = 368.6k/1.0m (37%)；bar = [██▓░░░░░] 37%；text_bar = 两者组合。默认 text',
      },
      'panel.expanded': { label: '默认展开', help: '开启后面板默认展开而非折叠（默认折叠）' },
      'panel.truncateModelName': {
        label: '截断模型名',
        help: 'mimo/mimo-v2.5 → ⇲mimo-v2.5；modelAliases 别名命中时优先显示别名（默认开）',
      },
      'panel.modelAliases': {
        label: '模型别名',
        help: 'key 对完整模型名做大小写不敏感子串匹配（"mimo" 命中 mimo/mimo-v2.5）；值为 { name, timeAliases: [{ days: [1,2,3,4,5], start: "09:00", end: "18:00", name }] }（北京时间，0=周日，支持跨午夜）',
      },
      'panel.modelAliasesEnabled': {
        label: '别名开关',
        help: 'false 时忽略 modelAliases，全部回落截断/完整名显示，配置本身保留（默认开）',
      },
      'panel.peakValley': {
        label: '峰谷价标识',
        advanced: true,
        help: 'DeepSeek 等按峰谷计费的模型（可添加多条）：峰段显示峰时名称，谷段（闲时）显示谷时名称；与 modelAliases 可共存，同 key 手写优先',
      },

    },
  },
);

// Control UI 的集合值编辑器对 anyOf 联合类型只会渲染窄小的 JSON 文本框，
// 纯 object schema 才有全宽结构化编辑器——UI 呈现收敛为对象形态。
// 运行时 safeParse 仍走 zod 联合类型，手写字符串别名（"mimo": "小虾米"）不受影响。
const modelAliasesUiSchema = pluginConfigSchema.jsonSchema as {
  properties?: { panel?: { properties?: { modelAliases?: { additionalProperties?: unknown } } } };
};
const maProps = modelAliasesUiSchema.properties?.panel?.properties?.modelAliases;
if (maProps?.additionalProperties && typeof maProps.additionalProperties === 'object') {
  const anyOf = (maProps.additionalProperties as { anyOf?: unknown[] }).anyOf;
  if (Array.isArray(anyOf)) {
    const objectBranch = anyOf.find(
      (b) => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'object',
    );
    if (objectBranch) maProps.additionalProperties = objectBranch;
  }
}

// peakValley 同理：数组|record 联合在 UI 上没有折叠能力（数组走条目编辑器），
// 收敛为 record 形态（key = 匹配模型）后与 modelAliases 同构，宿主表单才给折叠处理。
const panelUiProps = (
  pluginConfigSchema.jsonSchema as {
    properties?: { panel?: { properties?: Record<string, unknown> } };
  }
).properties?.panel?.properties;
const peakValleyUi = panelUiProps?.peakValley as
  | {
      anyOf?: Array<{ type?: string; items?: unknown; additionalProperties?: unknown }>;
      description?: string;
    }
  | undefined;
if (peakValleyUi && Array.isArray(peakValleyUi.anyOf)) {
  const recordBranch = peakValleyUi.anyOf.find(
    (b) => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'object',
  );
  if (recordBranch) {
    panelUiProps!.peakValley = {
      ...(recordBranch as Record<string, unknown>),
      description: peakValleyUi.description,
    };
  }
}

const plugin = {
  id: 'claw-fry-cards',
  name: 'Feishu',
  description: 'Lark/Feishu channel plugin with im/doc/wiki/drive/task/calendar tools',
  configSchema: pluginConfigSchema,
  register(api: OpenClawPluginApi): void {
    LarkClient.setRuntime(api.runtime);
    api.registerChannel({ plugin: feishuPlugin });

    // ========================================

    // Register OAPI tools (calendar, task - using Feishu Open API directly)
    registerOapiTools(api);

    // Register MCP doc tools (using Model Context Protocol)
    registerFeishuMcpDocTools(api);

    // Register OAuth tool (UAT device flow authorization)
    registerFeishuOAuthTool(api);

    // Register OAuth batch auth tool (batch authorization for all app scopes)
    registerFeishuOAuthBatchAuthTool(api);

    // Register AskUserQuestion tool (interactive card-based user prompting)
    registerAskUserQuestionTool(api);

    api.on('before_tool_call', (event, ctx) => {
      recordToolUseStart({
        sessionKey: ctx.sessionKey,
        toolName: event.toolName,
        toolParams: event.params,
        toolCallId: event.toolCallId ?? ctx.toolCallId,
        runId: event.runId ?? ctx.runId,
      });
      if (!event.toolName.startsWith('feishu_')) return;
      const paramsPreview = sanitizeParamsForLog(event.params);
      log.info(`tool call: ${event.toolName} session=${ctx.sessionKey ?? '-'} params=${paramsPreview}`);
    });

    api.on('after_tool_call', (event, ctx) => {
      recordToolUseEnd({
        sessionKey: ctx.sessionKey,
        toolName: event.toolName,
        toolParams: event.params,
        toolCallId: event.toolCallId ?? ctx.toolCallId,
        runId: event.runId ?? ctx.runId,
        result: event.result,
        error: event.error,
        durationMs: event.durationMs,
      });
      if (!event.toolName.startsWith('feishu_')) return;
      if (event.error) {
        log.error(
          `tool fail: ${event.toolName} session=${ctx.sessionKey ?? '-'} ${event.error} (${event.durationMs ?? 0}ms)`,
        );
      } else {
        log.info(`tool done: ${event.toolName} session=${ctx.sessionKey ?? '-'} ok (${event.durationMs ?? 0}ms)`);
      }
    });

    // ---- Diagnostic commands ----

    // CLI: openclaw feishu-diagnose [--trace <messageId>]
    api.registerCli(
      (ctx) => {
        ctx.program
          .command('feishu-diagnose')
          .description('运行飞书插件诊断，检查配置、连通性和权限状态')
          .option('--trace <messageId>', '按 message_id 追踪完整处理链路')
          .option('--analyze', '分析追踪日志（需配合 --trace 使用）')
          .action(async (opts: { trace?: string; analyze?: boolean }) => {
            try {
              if (opts.trace) {
                const lines = await traceByMessageId(opts.trace);
                // eslint-disable-next-line no-console -- CLI 命令直接输出到终端
                console.log(formatTraceOutput(lines, opts.trace));
                if (opts.analyze && lines.length > 0) {
                  // eslint-disable-next-line no-console -- CLI 命令直接输出到终端
                  console.log(analyzeTrace(lines, opts.trace));
                }
              } else {
                const report = await runDiagnosis({
                  config: ctx.config,
                  logger: ctx.logger,
                });
                // eslint-disable-next-line no-console -- CLI 命令直接输出到终端
                console.log(formatDiagReportCli(report));
                if (report.overallStatus === 'unhealthy') {
                  process.exitCode = 1;
                }
              }
            } catch (err) {
              ctx.logger.error(`诊断命令执行失败: ${err}`);
              process.exitCode = 1;
            }
          });
      },
      { commands: ['feishu-diagnose'] },
    );

    // Chat commands: /feishu_diagnose, /feishu_doctor, /feishu_auth, /feishu
    registerCommands(api);

    // ---- Multi-account security checks ----
    if (api.config) {
      emitSecurityWarnings(api.config, api.logger);
    }
  },
};

export default plugin;
