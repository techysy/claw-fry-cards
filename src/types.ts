/** OpenClaw 插件钩子事件的本地类型 — 与 openclaw/plugin-sdk 的 hook types 对齐（2026.8）。 */

export type HookContext = {
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  sessionKey?: string;
  runId?: string;
  messageId?: string;
  senderId?: string;
  replyToId?: string;
};

export type MessageReceivedEvent = {
  from: string;
  content: string;
  timestamp?: number;
  threadId?: string | number;
  messageId?: string;
  sessionKey?: string;
  runId?: string;
};

export type BeforeToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
  toolCallId?: string;
  runId?: string;
};

export type AfterToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
  toolCallId?: string;
  runId?: string;
  result?: unknown;
  error?: string;
  durationMs?: number;
};

export type LlmOutputEvent = {
  runId: string;
  sessionId: string;
  provider: string;
  model: string;
  resolvedRef?: string;
  /** 解析后的上下文 token 预算（footer 上下文窗口显示用）。 */
  contextTokenBudget?: number;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
};

export type AgentEndEvent = {
  runId?: string;
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;
};

export type MessageSendingEvent = {
  to: string;
  content: string;
  replyToId?: string | number;
  threadId?: string | number;
  metadata?: Record<string, unknown>;
};

export type MessageSendingResult = {
  content?: string;
  cancel?: boolean;
  cancelReason?: string;
  metadata?: Record<string, unknown>;
};

export type ReplyPayload = {
  text?: string;
  isReasoning?: boolean;
  interactive?: boolean;
  btw?: boolean;
  audioAsVoice?: boolean;
  mediaUrl?: string;
  mediaUrls?: string[];
  channelData?: unknown;
};

export type ReplyPayloadSendingEvent = {
  payload: ReplyPayload;
  kind: string;
  channel?: string;
  sessionKey?: string;
};

export type ReplyPayloadSendingResult = {
  payload?: unknown;
  cancel?: boolean;
  reason?: string;
};

export type GatewayStopEvent = Record<string, unknown>;

/** api.on 的最小注册面（运行时由 openclaw 提供）。 */
export type HookRegistrar = {
  on(event: "message_received", handler: (event: MessageReceivedEvent, ctx: HookContext) => void | Promise<void>): void;
  on(event: "before_tool_call", handler: (event: BeforeToolCallEvent, ctx: HookContext) => void | Promise<void>): void;
  on(event: "after_tool_call", handler: (event: AfterToolCallEvent, ctx: HookContext) => void | Promise<void>): void;
  on(event: "llm_output", handler: (event: LlmOutputEvent, ctx: HookContext) => void | Promise<void>): void;
  on(event: "agent_end", handler: (event: AgentEndEvent, ctx: HookContext) => void | Promise<void>): void;
  on(
    event: "message_sending",
    handler: (event: MessageSendingEvent, ctx: HookContext) => MessageSendingResult | void | Promise<MessageSendingResult | void>,
  ): void;
  on(
    event: "reply_payload_sending",
    handler: (event: ReplyPayloadSendingEvent, ctx: HookContext) => ReplyPayloadSendingResult | void | Promise<ReplyPayloadSendingResult | void>,
  ): void;
  on(event: "gateway_stop", handler: (event: GatewayStopEvent, ctx: HookContext) => void | Promise<void>): void;
};
