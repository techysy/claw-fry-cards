/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Zod-based configuration schema for the OpenClaw Lark/Feishu channel plugin.
 *
 * Provides runtime validation, sensible defaults, and cross-field refinements
 * so that every consuming module can rely on well-typed configuration objects.
 */

import { toJSONSchema, z } from 'zod';

export { z };

// ---------------------------------------------------------------------------
// Shared micro-schemas
// ---------------------------------------------------------------------------

const DmPolicyEnum = z.enum(['open', 'pairing', 'allowlist', 'disabled']);
const GroupPolicyEnum = z.enum(['open', 'allowlist', 'disabled']);
const ConnectionModeEnum = z.enum(['websocket', 'webhook']);
const ReplyModeValue = z.enum(['auto', 'static', 'streaming']);
const ReplyModeSchema = z
  .union([
    ReplyModeValue,
    z.object({
      default: ReplyModeValue.optional(),
      group: ReplyModeValue.optional(),
      direct: ReplyModeValue.optional(),
    }),
  ])
  .optional();
const ChunkModeEnum = z.enum(['newline', 'paragraph', 'none']);

const DomainSchema = z.union([z.literal('feishu'), z.literal('lark'), z.string().regex(/^https:\/\//)]).optional();

const AllowFromSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (v === undefined || v == null) return undefined;
    return Array.isArray(v) ? v : [v];
  });

const ToolPolicySchema = z
  .object({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
  })
  .optional();

const FeishuToolsFlagSchema = z
  .object({
    doc: z.boolean().optional(),
    wiki: z.boolean().optional(),
    drive: z.boolean().optional(),
    perm: z.boolean().optional(),
    scopes: z.boolean().optional(),
  })
  .optional();

const FeishuFooterSchema = z
  .object({
    status: z.boolean().optional(),
    elapsed: z.boolean().optional(),
    tokens: z.boolean().optional(),
    cache: z.boolean().optional(),
    context: z.boolean().optional(),
    model: z.boolean().optional(),
  })
  .optional();

export const PanelConfigSchema = z
  .object({
    /** 模型显示别名：model id（或去掉 provider 的裸名）→ 卡片上显示的名字。如 { "mimo/mimo-v2.5": "梁文锋" } */
    modelAliases: z
      .record(
        z.string(),
        z.union([
          z.string(),
          z.object({
            /** 默认显示名（不在任何时间规则内时使用） */
            name: z.string().optional(),
            /** 时间规则：命中第一条即用其 name；都未命中用默认名 */
            timeAliases: z
              .array(
                z.object({
                  /** 生效星期：如 "1-5"（周一至五）、"0,6"（周末），省略 = 每天（0=周日） */
                  days: z.string().optional(),
                  /** 生效时段 HH:MM-HH:MM（本地 UTC+8），支持跨午夜 */
                  start: z.string().optional(),
                  end: z.string().optional(),
                  name: z.string(),
                }),
              )
              .optional(),
          }),
        ]),
      )
      .optional() /** 统一面板显示的耗时门槛（秒）；回复耗时 ≥ 此值或存在思考/工具时显示。0 = 每条都显示。 */,
    unifiedPanelMinDuration: z.number().optional(),
    /** 面板标题中上下文段的样式：text（纯文本）/ bar（渐变条）/ text_bar（文本+渐变条，fry 默认） */
    contextDisplayMode: z.enum(['text', 'bar', 'text_bar']).optional(),
    /** 面板默认展开 */
    expanded: z.boolean().optional(),
  })
  .optional();

const BlockStreamingCoalesceSchema = z
  .object({
    minChars: z.number().optional(),
    maxChars: z.number().optional(),
    idleMs: z.number().optional(),
  })
  .optional();

const MarkdownConfigSchema = z
  .object({
    tables: z.enum(['off', 'bullets', 'code']).optional(),
  })
  .optional();

const HeartbeatSchema = z
  .object({
    every: z.string().optional(),
    activeHours: z
      .object({
        start: z.string().optional(),
        end: z.string().optional(),
        timezone: z.string().optional(),
      })
      .optional(),
    target: z.string().optional(),
    to: z.string().optional(),
    prompt: z.string().optional(),
    accountId: z.string().optional(),
  })
  .optional();

const CapabilitiesSchema = z
  .object({
    image: z.boolean().optional(),
    audio: z.boolean().optional(),
    video: z.boolean().optional(),
  })
  .optional();

const DedupSchema = z
  .object({
    ttlMs: z.number().optional(), // default 43200000 (12h)
    maxEntries: z.number().optional(), // default 5000
  })
  .optional();

const AllowBotsSchema = z.union([z.boolean(), z.literal('mentions')]).optional();

const ReactionNotificationModeSchema = z.enum(['off', 'own', 'all']).optional();

export const UATConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    allowedScopes: z.array(z.string()).optional(),
    blockedScopes: z.array(z.string()).optional(),
  })
  .optional();

const DmConfigSchema = z
  .object({
    historyLimit: z.number().optional(),
  })
  .optional();

// ---------------------------------------------------------------------------
// Group schema
// ---------------------------------------------------------------------------

export const FeishuGroupSchema = z.object({
  groupPolicy: GroupPolicyEnum.optional(),
  requireMention: z.boolean().optional(),
  respondToMentionAll: z.boolean().optional(),
  tools: ToolPolicySchema,
  skills: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  allowFrom: AllowFromSchema,
  systemPrompt: z.string().optional(),
  allowBots: AllowBotsSchema,
  // When true, bot-to-bot replies are allowed to stay inside a thread/topic
  // instead of being forced to the main chat (relaxes the #32980 guard).
  replyInThread: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Account config schema (same shape as top-level minus `accounts`)
// ---------------------------------------------------------------------------

export const FeishuAccountConfigSchema = z.object({
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  encryptKey: z.string().optional(),
  verificationToken: z.string().optional(),
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  domain: DomainSchema,
  connectionMode: ConnectionModeEnum.optional(),
  webhookPath: z.string().optional(),
  webhookPort: z.number().optional(),
  dmPolicy: DmPolicyEnum.optional(),
  allowFrom: AllowFromSchema,
  groupPolicy: GroupPolicyEnum.optional(),
  groupAllowFrom: AllowFromSchema,
  requireMention: z.boolean().optional(),
  respondToMentionAll: z.boolean().optional(),
  groups: z.record(z.string(), FeishuGroupSchema).optional(),
  historyLimit: z.number().optional(),
  dmHistoryLimit: z.number().optional(),
  dms: DmConfigSchema,
  textChunkLimit: z.number().optional(),
  chunkMode: ChunkModeEnum.optional(),
  blockStreamingCoalesce: BlockStreamingCoalesceSchema,
  mediaMaxMb: z.number().optional(),
  heartbeat: HeartbeatSchema,
  replyMode: ReplyModeSchema,
  streaming: z
    .union([z.boolean(), z.object({ mode: z.string().optional() }).loose()])
    .optional(),
  blockStreaming: z.boolean().optional(),
  toolUseDisplay: z
    .object({
      showFullPaths: z.boolean().optional(),
    })
    .optional(),
  tools: FeishuToolsFlagSchema,
  footer: FeishuFooterSchema,
  panel: PanelConfigSchema,
  markdown: MarkdownConfigSchema,
  configWrites: z.boolean().optional(),
  capabilities: CapabilitiesSchema,
  dedup: DedupSchema,
  reactionNotifications: ReactionNotificationModeSchema,
  threadSession: z.boolean().optional(),
  allowBots: AllowBotsSchema,
  // Account-level default for letting bot-to-bot replies stay in a thread
  // (per-group `replyInThread` overrides this).
  replyInThread: z.boolean().optional(),
  uat: UATConfigSchema,
});

// ---------------------------------------------------------------------------
// Top-level Feishu config schema
// ---------------------------------------------------------------------------

export const FeishuConfigSchema = FeishuAccountConfigSchema.extend({
  accounts: z.record(z.string(), FeishuAccountConfigSchema).optional(),
}).superRefine((data, ctx) => {
  // When dmPolicy is "open", allowFrom must contain the wildcard "*".
  if (data.dmPolicy === 'open') {
    const list = data.allowFrom;
    const hasWildcard = Array.isArray(list) && list.includes('*');

    if (!hasWildcard) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allowFrom'],
        message: 'When dmPolicy is "open", allowFrom must include "*" to permit all senders.',
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Auto-generated JSON Schema (single source of truth)
// ---------------------------------------------------------------------------

/**
 * JSON Schema derived from FeishuConfigSchema.
 *
 * - `io: "input"` exposes the input type for `.transform()` schemas (e.g. AllowFromSchema).
 * - `unrepresentable: "any"` degrades `.superRefine()` constraints to `{}`.
 * - `target: "draft-07"` matches the plugin system's expected JSON Schema version.
 */
export const FEISHU_CONFIG_JSON_SCHEMA: Record<string, unknown> = toJSONSchema(FeishuConfigSchema, {
  target: 'draft-07',
  io: 'input',
  unrepresentable: 'any',
});

// ---------------------------------------------------------------------------
// Plugin-level config (`plugins.entries.claw-fry-cards.config`)
// ---------------------------------------------------------------------------

const ModelAliasValueSchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    timeAliases: z
      .array(
        z.object({
          days: z
            .union([z.string(), z.array(z.number().int().min(0).max(6))])
            .describe(
              '生效星期：数组形式 [1,2,3,4,5]（0=周日，可多选）或区间字符串 "1-5"/"0,6"；省略 = 每天',
            )
            .optional(),
          start: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 格式')
            .describe('开始时间 HH:MM（北京时间），支持跨午夜（如 22:00-02:00）')
            .optional(),
          end: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 格式')
            .describe('结束时间 HH:MM（北京时间）')
            .optional(),
          name: z.string().describe('该时段显示的别名'),
        }),
      )
      .optional(),
  }),
]);

/**
 * 插件自有配置（随插件版本化，不受宿主 channels.feishu schema 演化影响）。
 * 面板设置优先读这里；`channels.feishu.panel` 作为旧位置回退。
 */
export const PluginConfigSchema = z.object({
  panel: z
    .object({
      unifiedPanelMinDuration: z
        .number()
        .describe(
          '统一面板显示的耗时门槛（秒）：回复 ≥ 此值或有思考/工具过程时显示，0 = 每条必出（默认 5）',
        )
        .optional(),
      contextDisplayMode: z
        .enum(['text', 'bar', 'text_bar'])
        .describe(
          '上下文段样式：text（129.3k/1.0m (13%)）/ bar（[██▓░░░░░] 13%）/ text_bar（129.3k/1.0m [██▓░░░░░] 13%）；默认 text',
        )
        .optional(),
      expanded: z.boolean().describe('面板默认展开（默认折叠）').optional(),
      truncateModelName: z
        .boolean()
        .describe(
          '截断模型名显示：mimo/mimo-v2.5 → ⇲mimo-v2.5（默认 true；modelAliases 别名命中时优先显示别名）',
        )
        .optional(),
      modelAliases: z
        .record(z.string(), ModelAliasValueSchema)
        .describe(
          '模型显示别名：key 对完整模型名做大小写不敏感子串匹配（如 "mimo" 命中 mimo/mimo-v2.5）；值为名称字符串，或含时段规则的对象 { name, timeAliases: [{ days: [1,2,3,4,5], start: "09:00", end: "18:00", name }] }（北京时间，days 数组 0=周日，支持跨午夜）',
        )
        .optional(),
      modelAliasesEnabled: z
        .boolean()
        .describe(
          '别名功能总开关（默认 true）：false 时忽略 modelAliases，全部回落截断/完整名显示，配置本身保留',
        )
        .optional(),
    })
    .describe('统一面板设置（完成态底部折叠面板）')
    .optional(),
}).describe('claw-fry-cards 插件自有配置');

export type PluginConfig = z.infer<typeof PluginConfigSchema>;

export const PLUGIN_CONFIG_JSON_SCHEMA: Record<string, unknown> = toJSONSchema(PluginConfigSchema, {
  target: 'draft-07',
  io: 'input',
  unrepresentable: 'any',
});
