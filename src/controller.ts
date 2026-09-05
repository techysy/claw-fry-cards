/** ClawCardController — OpenClaw 钩子 → fry-cards 风格卡片的编排层。 */

import {
  buildCompleteCard,
  buildStreamingCardV2,
  buildToolPanel,
  LOADING_ELEMENT_ID,
  TOOL_PANEL_ELEMENT_ID,
  STREAMING_ELEMENT_ID,
  type FooterData,
} from "./cardkit/builder";
import { splitReasoningText, stripReasoningTags } from "./cardkit/text";
import type { ClawConfig } from "./config";
import type { FeishuClient } from "./feishu";
import {
  CARD_PHASES,
  createSession,
  isTerminal,
  nextSequence,
  serialized,
  type CardSession,
} from "./streaming/session";
import type {
  AfterToolCallEvent,
  AgentEndEvent,
  BeforeToolCallEvent,
  HookContext,
  LlmOutputEvent,
  MessageReceivedEvent,
  MessageSendingEvent,
  MessageSendingResult,
  ReplyPayloadSendingEvent,
  ReplyPayloadSendingResult,
} from "./types";

export type Logger = {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
};

const GRACE_MS_AFTER_AGENT_END = 5000;

export class ClawCardController {
  private readonly cfg: ClawConfig;
  private readonly client: FeishuClient;
  private readonly log: Logger;
  private readonly sessions = new Map<string, CardSession>();

  constructor(cfg: ClawConfig, client: FeishuClient, log: Logger) {
    this.cfg = cfg;
    this.client = client;
    this.log = log;
  }

  /** 全部活动会话（供 status 命令/测试）。 */
  get activeSessionCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) if (!isTerminal(s.phase)) n += 1;
    return n;
  }

  getSession(sessionKey: string): CardSession | undefined {
    return this.sessions.get(sessionKey);
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      if (session.stale_timer) clearTimeout(session.stale_timer);
      session.flush.dispose();
    }
    this.sessions.clear();
  }

  // ── message_received：建卡 ────────────────────────────────────────────

  async onMessageReceived(event: MessageReceivedEvent, ctx: HookContext): Promise<void> {
    if (!this.isFeishuChannel(ctx)) return;
    const sessionKey = ctx.sessionKey || event.sessionKey;
    if (!sessionKey) return;

    const content = (event.content ?? "").trim();
    // /stop 类命令：把已有会话封为「已停止」
    if (/^\/(stop|abort)\b/i.test(content)) {
      const existing = this.sessions.get(sessionKey);
      if (existing && !isTerminal(existing.phase)) {
        void this.seal(existing, { isAborted: true }).catch(() => undefined);
      }
      return;
    }
    // 命令/心跳等不建卡
    if (!content || content.startsWith("/")) return;

    const chatId = this.resolveChatId(event.from, ctx);
    if (!chatId || !this.chatAllowed(chatId)) return;

    // 同会话上一张卡还挂着：先封为停止，避免卡片堆积
    const existing = this.sessions.get(sessionKey);
    if (existing && !isTerminal(existing.phase)) {
      void this.seal(existing, { isAborted: true }).catch(() => undefined);
    }

    const session = createSession(sessionKey, chatId, event.messageId ?? "");
    session.phase = CARD_PHASES.creating;
    this.sessions.set(sessionKey, session);

    try {
      await this.createStreamingCard(session);
    } catch (err) {
      this.log.warn(`card_create_failed session=${sessionKey} reason=${String(err)}`);
      session.phase = CARD_PHASES.failed;
      return;
    }
    session.phase = CARD_PHASES.streaming;
    session.flush.setCardMessageReady(true);
    this.log.info(`session_created session=${sessionKey} card=${session.card_id?.slice(0, 12)}`);

    const timeoutMs = this.cfg.streaming.staleTimeoutSec * 1000;
    session.stale_timer = setTimeout(() => {
      if (!isTerminal(session.phase)) {
        this.log.warn(`card_stale_timeout session=${sessionKey}`);
        void this.seal(session, { isAborted: true }).catch(() => undefined);
      }
    }, timeoutMs);
    if (typeof session.stale_timer.unref === "function") session.stale_timer.unref();
  }

  // ── 工具进度 ──────────────────────────────────────────────────────────

  onBeforeToolCall(event: BeforeToolCallEvent, ctx: HookContext): void {
    const session = this.sessionForTool(ctx);
    if (!session) return;
    session.tool.recordStart(event.toolName, this.describeToolParams(event.params));
    session.tool_dirty = true;
    session.flush.scheduleUpdate(() => this.flushToolPanel(session));
  }

  onAfterToolCall(event: AfterToolCallEvent, ctx: HookContext): void {
    const session = this.sessionForTool(ctx);
    if (!session) return;
    session.tool.recordEnd(event.toolName, {
      error: event.error ?? "",
      durationMs: event.durationMs,
      // 工具输出只保留简短预览，防止面板爆炸
      output: this.previewToolOutput(event.result),
    });
    session.tool_dirty = true;
    session.updated_at = Date.now();
    session.flush.scheduleUpdate(() => this.flushToolPanel(session));
  }

  private sessionForTool(ctx: HookContext): CardSession | undefined {
    if (!this.isFeishuChannel(ctx)) return undefined;
    const key = ctx.sessionKey;
    if (!key) return undefined;
    const session = this.sessions.get(key);
    if (!session || isTerminal(session.phase) || !session.card_id) return undefined;
    return session;
  }

  private async flushToolPanel(session: CardSession): Promise<void> {
    if (!session.card_id || !session.tool_dirty || isTerminal(session.phase)) return;
    session.tool_dirty = false;
    const steps = session.tool.buildDisplaySteps();
    const panel = buildToolPanel(steps, session.tool.elapsed_ms);
    await serialized(session, async () => {
      try {
        await this.client.cardkitBatchUpdate(
          session.card_id!,
          [
            {
              action: "partial_update_element",
              params: {
                element_id: TOOL_PANEL_ELEMENT_ID,
                partial_element: { elements: panel["elements"], header: panel["header"] },
              },
            },
          ],
          nextSequence(session),
        );
      } catch (err) {
        this.log.debug(`tool_panel_update_failed card=${session.card_id?.slice(0, 12)} err=${String(err)}`);
      }
    });
  }

  // ── llm_output：记录模型与用量 ────────────────────────────────────────

  onLlmOutput(event: LlmOutputEvent, ctx: HookContext): void {
    if (!this.isFeishuChannel(ctx)) return;
    const key = ctx.sessionKey;
    if (!key) return;
    const session = this.sessions.get(key);
    if (!session || isTerminal(session.phase)) return;
    if (event.contextTokenBudget && event.contextTokenBudget > 0) {
      session.context_token_budget = event.contextTokenBudget;
    }
    session.footer = {
      ...session.footer,
      model: event.resolvedRef || `${event.provider}/${event.model}`,
      input_tokens: event.usage?.input ?? session.footer.input_tokens ?? 0,
      output_tokens: (session.footer.output_tokens ?? 0) + (event.usage?.output ?? 0),
    };
  }

  // ── message_sending / reply_payload_sending：答案打字机 + 封卡 + 接管 ──
  // 官方通道的卡片投递可能走任一钩子（核心托管走 message_sending，通道自渲染卡片走
  // reply_payload_sending），两个入口共用 takeoverReply：先到者接管封卡，后到者因
  // sealed 直接 cancel，保证不双投。

  async onMessageSending(event: MessageSendingEvent, ctx: HookContext): Promise<MessageSendingResult | void> {
    if (!this.isFeishuChannel(ctx)) return undefined;
    const key = ctx.sessionKey;
    if (!key) return undefined;
    const session = this.sessions.get(key);
    if (!session) return undefined;
    // 本轮已用卡片投递过正文：同一轮的后续 payload（元数据段等）一并吞掉，防止重复消息
    if (session.sealed) {
      return session.answer_text.trim()
        ? { cancel: true, cancelReason: "card_already_delivered" }
        : undefined;
    }
    if (isTerminal(session.phase) || !session.card_id) return undefined;

    const rawText = (event.content ?? "").trim();
    if (!rawText) return undefined;
    if (this.hasInteractiveMetadata(event)) return undefined;

    const delivered = await this.takeoverReply(session, rawText, key);
    if (!delivered) return undefined; // 回落：官方通道继续投递纯文本
    if (!this.cfg.display.cancelTextOnCard) return undefined;
    return { cancel: true, cancelReason: "delivered_as_card" };
  }

  async onReplyPayloadSending(
    event: ReplyPayloadSendingEvent,
    ctx: HookContext,
  ): Promise<ReplyPayloadSendingResult | void> {
    if (!this.isFeishuChannel(ctx)) return undefined;
    const key = ctx.sessionKey || event.sessionKey;
    if (!key) return undefined;
    const session = this.sessions.get(key);
    if (!session) return undefined;
    if (session.sealed) {
      return session.answer_text.trim()
        ? { cancel: true, reason: "card_already_delivered" }
        : undefined;
    }
    if (isTerminal(session.phase) || !session.card_id) return undefined;

    const p = event.payload ?? {};
    // 交互组件/媒体/纯推理/ btw 语音 payload 不接管，交给官方通道
    if (p.interactive || p.isReasoning || p.btw || p.audioAsVoice || p.mediaUrl || (p.mediaUrls?.length ?? 0) > 0) {
      return undefined;
    }
    const rawText = (p.text ?? "").trim();
    if (!rawText) return undefined;

    const delivered = await this.takeoverReply(session, rawText, key);
    if (!delivered) return undefined;
    if (!this.cfg.display.cancelTextOnCard) return undefined;
    return { cancel: true, reason: "delivered_as_card" };
  }

  /** 打字机写入 + 封卡。返回 false 表示失败（回落官方通道）。 */
  private async takeoverReply(session: CardSession, rawText: string, key: string): Promise<boolean> {
    const split = splitReasoningText(rawText);
    const reasoning = split.reasoning_text ?? "";
    let answer = split.answer_text ?? stripReasoningTags(rawText);

    if (reasoning && !session.reasoning_text_seen) {
      session.reasoning_text_seen = true;
      session.reasoning_rounds.push({ text: reasoning, elapsedMs: 0 });
    }

    // 追加 chunk（长回复可能分多次投递）
    if (session.answer_text && answer && !session.answer_text.endsWith("\n")) {
      answer = `\n${answer}`;
    }
    session.answer_text += answer;

    try {
      await this.streamAnswer(session);
      await this.seal(session, {});
    } catch (err) {
      this.log.warn(`card_seal_failed session=${key} reason=${String(err)}`);
      await this.removeLoadingIconSafe(session);
      return false;
    }
    this.log.info(`card_completed session=${key} card=${session.card_id?.slice(0, 12)}`);
    return true;
  }

  // ── agent_end：兜底收尾 ───────────────────────────────────────────────

  onAgentEnd(event: AgentEndEvent, ctx: HookContext): void {
    if (!this.isFeishuChannel(ctx)) return;
    const key = ctx.sessionKey;
    if (!key) return;
    const session = this.sessions.get(key);
    if (!session || isTerminal(session.phase)) return;
    if (event.durationMs && event.durationMs > 0) {
      session.footer = { ...session.footer, duration: event.durationMs / 1000 };
    }
    setTimeout(() => {
      if (isTerminal(session.phase)) return;
      void this.seal(session, { isError: !event.success }).catch(() => undefined);
    }, GRACE_MS_AFTER_AGENT_END).unref?.();
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  private isFeishuChannel(ctx: HookContext): boolean {
    return (ctx.channelId ?? "").toLowerCase() === "feishu";
  }

  private resolveChatId(from: string, ctx: HookContext): string {
    const candidate = ctx.conversationId || from || "";
    // 兼容 "feishu:oc_xxx" 前缀格式
    const idx = candidate.lastIndexOf(":");
    return idx >= 0 ? candidate.slice(idx + 1) : candidate;
  }

  private chatAllowed(chatId: string): boolean {
    const { allowlist, blocklist } = this.cfg.chats;
    if (blocklist.length && blocklist.includes(chatId)) return false;
    if (allowlist.length && !allowlist.includes(chatId)) return false;
    return true;
  }

  private hasInteractiveMetadata(event: MessageSendingEvent): boolean {
    const md = event.metadata;
    if (!md || typeof md !== "object") return false;
    if (md["interactive"] === true) return true;
    const channelData = md["channelData"];
    if (channelData && typeof channelData === "object" && !Array.isArray(channelData)) {
      return "execApproval" in (channelData as Record<string, unknown>);
    }
    return false;
  }

  private describeToolParams(params: Record<string, unknown>): string {
    if (!params) return "";
    for (const key of ["command", "cmd", "file_path", "path", "query", "url", "skill"]) {
      const v = params[key];
      if (typeof v === "string" && v.trim()) {
        return v.replace(/\s+/g, " ").trim().slice(0, 80);
      }
    }
    return "";
  }

  private previewToolOutput(result: unknown): string {
    if (result == null) return "";
    const text = typeof result === "string" ? result : (() => {
      try {
        return JSON.stringify(result);
      } catch {
        return String(result);
      }
    })();
    const oneLine = text.replace(/\s+/g, " ").trim();
    return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
  }

  private async createStreamingCard(session: CardSession): Promise<void> {
    await serialized(session, async () => {
      const card = buildStreamingCardV2({
        showToolUse: this.cfg.display.showToolUse,
        headerEnabled: this.cfg.streaming.headerEnabled,
        textSize: this.cfg.streaming.bodyTextSize,
        widthMode: this.cfg.streaming.widthMode,
        loadingImgKey: this.cfg.display.loadingIconImgKey || undefined,
      });
      const cardId = await this.client.cardkitCreate(card);
      const msgId = session.message_id
        ? await this.client.replyCardById(session.message_id, cardId)
        : await this.client.sendCardEntityToChat(session.chatId, cardId);
      session.card_id = cardId;
      session.card_message_id = msgId;
    });
  }

  /** 打字机：把 answer_text 分片写入 streaming_content。分片数封顶（短回复不加秒级延迟），API 耗时抵扣间隔。 */
  private async streamAnswer(session: CardSession): Promise<void> {
    const text = session.answer_text;
    if (!text || !session.card_id) return;
    const remaining = text.slice(session.answer_streamed_chars);
    if (!remaining) return;

    const interval = Math.max(50, this.cfg.streaming.flushIntervalMs);
    const chunks = Math.min(8, Math.ceil(remaining.length / 2));
    const charStep = Math.max(1, Math.ceil(remaining.length / chunks));
    let pos = 0;
    while (pos < remaining.length) {
      pos = Math.min(remaining.length, pos + charStep);
      const content = text.slice(0, session.answer_streamed_chars + pos);
      const t0 = Date.now();
      await serialized(session, async () => {
        await this.client.cardkitStreamElement(
          session.card_id!,
          STREAMING_ELEMENT_ID,
          content,
          nextSequence(session),
        );
      });
      session.answer_streamed_chars += pos;
      if (pos < remaining.length) {
        const spent = Date.now() - t0;
        if (spent < interval) await new Promise((r) => setTimeout(r, interval - spent));
      }
    }
  }

  /** 封卡：关流式 + 全量替换为完成态卡（推理+工具合并统一面板）。 */
  private async seal(
    session: CardSession,
    opts: { isError?: boolean; isAborted?: boolean },
  ): Promise<void> {
    if (session.sealed || !session.card_id) return;
    session.sealed = true;
    if (session.stale_timer) clearTimeout(session.stale_timer);
    session.flush.markCompleted();

    const durationSec = (Date.now() - session.started_at) / 1000;
    const footer: FooterData = {
      ...session.footer,
      duration: session.footer.duration ?? durationSec,
      context_used: session.footer.input_tokens ?? 0,
      context_max: session.context_token_budget || session.footer.context_max || 0,
    };
    const card = buildCompleteCard({
      answerText: session.answer_text,
      reasoningRounds: session.reasoning_rounds,
      allToolSteps: this.cfg.display.showToolUse ? session.tool.buildDisplaySteps() : [],
      toolElapsedMs: session.tool.elapsed_ms,
      footerData: footer,
      isError: opts.isError ?? false,
      isAborted: opts.isAborted ?? false,
      footerFields: this.cfg.streaming.footerFields,
      footerShowLabel: false,
      footerEnabled: this.cfg.streaming.footerEnabled,
      headerEnabled: this.cfg.streaming.headerEnabled,
      bodyTextSize: this.cfg.streaming.bodyTextSize,
      showToolUse: this.cfg.display.showToolUse,
      widthMode: this.cfg.streaming.widthMode,
      unifiedPanelMinDuration: this.cfg.display.unifiedPanelMinDuration,
      contextDisplayMode: this.cfg.display.contextDisplayMode,
      showContext: this.cfg.display.showContext,
      truncateModel: this.cfg.display.truncateModelName,
    });

    await serialized(session, async () => {
      const seq1 = nextSequence(session);
      await this.client.cardkitCloseStreaming(session.card_id!, seq1);
      const seq2 = nextSequence(session);
      await this.client.cardkitUpdate(session.card_id!, card, seq2);
    });
    session.phase = opts.isError
      ? CARD_PHASES.failed
      : opts.isAborted
        ? CARD_PHASES.aborted
        : CARD_PHASES.completed;
    this.log.info(`session_disposed session=${session.sessionKey} phase=${session.phase}`);
  }

  private async removeLoadingIconSafe(session: CardSession): Promise<void> {
    if (!session.card_id) return;
    try {
      await serialized(session, async () => {
        await this.client.cardkitBatchUpdate(
          session.card_id!,
          [{ type: "delete", element_id: LOADING_ELEMENT_ID }],
          nextSequence(session),
        );
      });
    } catch (err) {
      this.log.debug(`remove_loading_failed card=${session.card_id?.slice(0, 12)} err=${String(err)}`);
    }
  }
}
