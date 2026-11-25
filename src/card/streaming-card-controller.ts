/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Streaming card controller for the Lark/Feishu channel plugin.
 *
 * Manages the full lifecycle of a streaming CardKit card:
 * idle → creating → streaming → completed / aborted / terminated.
 *
 * Delegates throttling to FlushController and message-unavailable
 * detection to UnavailableGuard.
 */

// eslint-disable-next-line n/no-unsupported-features/node-builtins -- node:sqlite is required for OpenClaw 2.0 session metrics (Node >=22.5).
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ReplyPayload } from 'openclaw/plugin-sdk/core';
import { SILENT_REPLY_TOKEN } from 'openclaw/plugin-sdk/reply-runtime';
import { extractLarkApiCode } from '../core/api-error';
import { larkLogger } from '../core/lark-logger';
import { LarkClient } from '../core/lark-client';
import { registerShutdownHook } from '../core/shutdown-hooks';
import { deleteMessageFeishu, sendCardFeishu, updateCardFeishu } from '../messaging/outbound/send';
import { type UnifiedPanelSettings, resolvePanelSettings } from './panel-config';
import {
  STREAMING_ELEMENT_ID,
  buildCardContent,
  buildStreamingPreAnswerCard,
  buildStreamingThinkingCard,
  splitReasoningText,
  stripReasoningTags,
  toCardKit2,
} from './builder';
import {
  FEISHU_CARD_TABLE_LIMIT,
  isCardElementLimitError,
  isCardRateLimitError,
  isCardTableLimitError,
  sanitizeTextSegmentsForCard,
} from './card-error';
import { clampAnswerText, clampReasoningText, clampStreamingText } from './content-budget';
import {
  createCardEntity,
  sendCardByCardId,
  setCardStreamingMode,
  streamCardContent,
  updateCardKitCard,
} from './cardkit';
import { recordStreamingCard, removeStreamingCard } from './card-journal';
import { FlushController } from './flush-controller';
import { ImageResolver } from './image-resolver';
import { optimizeMarkdownStyle } from './markdown-style';
import { type ToolUseDisplayResult, buildToolUseTitleSuffix, normalizeToolUseDisplay } from './tool-use-display';
import { clearToolUseTraceRun, getToolUseTraceSteps } from './tool-use-trace-store';
import type {
  CardKitState,
  CardPhase,
  FooterSessionMetrics,
  ReasoningState,
  StreamingCardDeps,
  StreamingTextState,
  TerminalReason,
  ToolUseState,
} from './reply-dispatcher-types';
import {
  EMPTY_REPLY_FALLBACK_TEXT,
  PHASE_TRANSITIONS,
  TERMINAL_PHASES,
  THROTTLE_CONSTANTS,
} from './reply-dispatcher-types';
import { UnavailableGuard } from './unavailable-guard';
import { resolveVendorLogoImageKey } from './vendor-logos';

const log = larkLogger('card/streaming');

/**
 * 关机/重载中止时的兜底终态文案（治标①）。区分两种中止源：
 * - 宿主重载/关机/强杀（shutdown hook / notifyCardInterrupted 路径）：
 *   配置正在更新，这轮回复没有结果，提示用户稍后重问；
 * - 用户主动停止（abort fast-path）：沿用简洁的已停止语义。
 */
const CONFIG_RELOAD_NOTICE =
  '配置更新中，本轮回复已中断。请稍后重发消息重新提问。';
const USER_ABORTED_NOTICE = '已按要求停止本轮回复。';

interface TerminalCardTextImageResolver {
  resolveImages(text: string): string;
}

interface TerminalCardContentInput {
  text: string;
  reasoningText?: string;
}

// ---------------------------------------------------------------------------
// StreamingCardController
// ---------------------------------------------------------------------------

export class StreamingCardController {
  // ---- Explicit state machine ----
  private phase: CardPhase = 'idle';

  // ---- Structured state ----
  private cardKit: CardKitState = {
    cardKitCardId: null,
    originalCardKitCardId: null,
    cardKitSequence: 0,
    cardMessageId: null,
  };
  private text: StreamingTextState = {
    accumulatedText: '',
    completedText: '',
    streamingPrefix: '',
    lastPartialText: '',
    lastFlushedText: '',
  };

  private reasoning: ReasoningState = {
    accumulatedReasoningText: '',
    reasoningStartTime: null,
    reasoningElapsedMs: 0,
    isReasoningPhase: false,
  };

  private toolUse: ToolUseState = {
    startedAt: null,
    elapsedMs: 0,
    isActive: false,
  };
  // ---- Sub-controllers ----
  private readonly flush: FlushController;
  private readonly guard: UnavailableGuard;
  private readonly imageResolver: ImageResolver;

  // ---- Lifecycle ----
  private createEpoch = 0;
  private _terminalReason: TerminalReason | null = null;
  private dispatchFullyComplete = false;
  /** abortCard 正在收尾中——onEnterTerminalPhase 据此跳过兜底通知避免并发写卡 */
  private _inFlightAbort = false;
  private cardCreationPromise: Promise<void> | null = null;
  private disposeShutdownHook: (() => void) | null = null;
  private readonly dispatchStartTime = Date.now();

  // ---- Injected dependencies ----
  private readonly deps: StreamingCardDeps;

  private elapsed(): number {
    return Date.now() - this.dispatchStartTime;
  }

  private resolvePanelConfig(): UnifiedPanelSettings | undefined {
    return resolvePanelSettings(this.deps.cfg);
  }

  private needsFooterMetrics(): boolean {
    // 🍤 统一面板 header 恒需指标（模型/token/上下文），不再依赖旧 footer 配置开关
    return true;
  }

  private async getFooterSessionMetrics(): Promise<FooterSessionMetrics | undefined> {
    try {
      const runtime = LarkClient.runtime;
      if (!runtime) return undefined;

      // OpenClaw 2.0: per-session usage metrics live in the agent transcript
      // SQLite (transcript_events.message.usage), not the legacy sessions.json
      // file that 2.0 migrated away. Read them directly from the agent DB.
      const agentId = this.deps.agentId;
      const sessionKey = this.deps.sessionKey.trim().toLowerCase();
      const dbPath = join(homedir(), '.openclaw', 'agents', agentId, 'agent', 'openclaw-agent.sqlite');

      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const window = db
          .prepare(
            'SELECT session_id FROM session_windows WHERE lower(session_key) = ? ORDER BY updated_at DESC LIMIT 1',
          )
          .get(sessionKey) as { session_id: string } | undefined;
        if (!window) return undefined;

        const rows = db
          .prepare(
            "SELECT rowid, event_json FROM transcript_events WHERE session_id = ? AND event_json LIKE '%usage%' ORDER BY rowid DESC LIMIT 500",
          )
          .all(window.session_id) as Array<{ rowid: number; event_json: string } | undefined>;
        if (!rows.length) return undefined;

        // 最新一条 usage 事件给出本轮 input/模型/窗口；其余事件累加 outputTokens
        // （面板 🎫 段显示会话累计输出，zcode-feishu-bridge 同款语义）。
        let metrics: FooterSessionMetrics | undefined;
        let outputTotal = 0;
        let sawOutput = false;
        for (const row of rows) {
          if (!row?.event_json) continue;
          let ev: { timestamp?: unknown; message?: { model?: unknown; provider?: unknown; responseModel?: unknown; usage?: unknown } };
          try {
            ev = JSON.parse(row.event_json) as typeof ev;
          } catch {
            continue;
          }
          const msg = ev?.message ?? {};
          const u = msg.usage as
            | { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown; totalTokens?: unknown }
            | undefined;
          if (!u) continue;
          if (!metrics) {
            metrics = {
              inputTokens: typeof u.input === 'number' ? u.input : undefined,
              outputTokens: typeof u.output === 'number' ? u.output : undefined,
              cacheRead: typeof u.cacheRead === 'number' ? u.cacheRead : undefined,
              cacheWrite: typeof u.cacheWrite === 'number' ? u.cacheWrite : undefined,
              totalTokens: typeof u.totalTokens === 'number' ? u.totalTokens : undefined,
              model: typeof msg.model === 'string' ? msg.model : undefined,
              provider: typeof msg.provider === 'string' ? msg.provider : undefined,
              responseModel: typeof msg.responseModel === 'string' ? msg.responseModel : undefined,
            };
            metrics.tokensPerSecond = this.deriveTokensPerSecond(
              db,
              window.session_id,
              row.rowid,
              typeof ev.timestamp === 'string' ? ev.timestamp : undefined,
              metrics.outputTokens,
            );
          }
          if (typeof u.output === 'number' && u.output > 0) {
            outputTotal += u.output;
            sawOutput = true;
          }
        }
        if (!metrics) return undefined;
        if (sawOutput) metrics.outputTokensTotal = outputTotal;

        // Best-effort context window from the model catalog in cfg.
        const ctxWindow = this.resolveContextWindow(metrics.provider, metrics.model);
        if (ctxWindow != null) metrics.contextTokens = ctxWindow;

        log.debug('footer metrics lookup: found usage from agent transcript sqlite', {
          sessionKey: this.deps.sessionKey,
          agentId,
        });
        return metrics;
      } finally {
        db.close();
      }
    } catch (err) {
      log.warn('footer metrics lookup failed', { error: String(err), sessionKey: this.deps.sessionKey });
      return undefined;
    }
  }

  /** 面板指标 + 厂商路由 logo（响应体 responseModel 命中厂商资产时懒上传换 image_key） */
  private async resolvePanelMetrics(): Promise<{
    footerMetrics: FooterSessionMetrics | undefined;
    routingLogo: { imageKey: string; model: string } | undefined;
  }> {
    const footerMetrics = this.needsFooterMetrics() ? await this.getFooterSessionMetrics() : undefined;
    const model = footerMetrics?.responseModel?.trim() || footerMetrics?.model?.trim() || '';
    if (!model) return { footerMetrics, routingLogo: undefined };
    // panel.vendorLogo=false 关闭厂商 logo 条；默认开启
    if (this.resolvePanelConfig()?.vendorLogo === false) return { footerMetrics, routingLogo: undefined };
    const imageKey = await resolveVendorLogoImageKey(this.deps.cfg, this.deps.accountId, model);
    return { footerMetrics, routingLogo: imageKey ? { imageKey, model } : undefined };
  }

  /**
   * ⚡ 本轮生成速度（tokens/s）= 本轮 output / 本轮生成耗时。
   * 耗时由 transcript 时间戳推算：本轮 assistant(usage) 事件时间戳 − 其紧邻前一条事件
   * 的时间戳（轮次起点），不含工具执行段。任一环缺失/异常时返回 undefined（静默省略）。
   */
  private deriveTokensPerSecond(
    db: DatabaseSync,
    sessionId: string,
    usageRowid: number,
    usageTimestamp: string | undefined,
    outputTokens: number | undefined,
  ): number | undefined {
    try {
      if (typeof outputTokens !== 'number' || outputTokens <= 0) return undefined;
      const usageTsMs = typeof usageTimestamp === 'string' ? Date.parse(usageTimestamp) : NaN;
      if (!Number.isFinite(usageTsMs)) return undefined;
      const prev = db
        .prepare(
          'SELECT event_json FROM transcript_events WHERE session_id = ? AND rowid < ? ORDER BY rowid DESC LIMIT 1',
        )
        .get(sessionId, usageRowid) as { event_json: string } | undefined;
      if (!prev?.event_json) return undefined;
      const prevEv = JSON.parse(prev.event_json) as { timestamp?: unknown };
      const prevTsMs = typeof prevEv?.timestamp === 'string' ? Date.parse(prevEv.timestamp) : NaN;
      if (!Number.isFinite(prevTsMs)) return undefined;
      const durationMs = usageTsMs - prevTsMs;
      // 上限 30min：把队列等待/陈旧轮次算进耗时会严重低估速度，宁可省略
      if (durationMs <= 0 || durationMs > 30 * 60_000) return undefined;
      return outputTokens / (durationMs / 1000);
    } catch {
      return undefined;
    }
  }

  /** Resolve a model's context window from cfg.models.providers. */
  private resolveContextWindow(provider: string | undefined, model: string | undefined): number | undefined {
    try {
      const providers =
        (
          this.deps.cfg as {
            models?: { providers?: Record<string, { models?: Array<{ id?: string; contextWindow?: number }> }> };
          }
        ).models?.providers ?? {};
      const pcfg = provider ? providers[provider] : undefined;
      if (!pcfg || !Array.isArray(pcfg.models)) return undefined;
      const found = pcfg.models.find((m) => m && m.id === model);
      return typeof found?.contextWindow === 'number' ? found.contextWindow : undefined;
    } catch {
      return undefined;
    }
  }

  constructor(deps: StreamingCardDeps) {
    this.deps = deps;

    this.guard = new UnavailableGuard({
      replyToMessageId: deps.replyToMessageId,
      getCardMessageId: () => this.cardKit.cardMessageId,
      onTerminate: () => {
        this.transition('terminated', 'UnavailableGuard', 'unavailable');
      },
    });

    this.flush = new FlushController(() => this.performFlush());

    this.imageResolver = new ImageResolver({
      cfg: deps.cfg,
      accountId: deps.accountId,
      onImageResolved: () => {
        if (!this.isTerminalPhase && this.cardKit.cardMessageId) {
          void this.throttledCardUpdate();
        }
      },
    });
  }

  // ------------------------------------------------------------------
  // Public accessors
  // ------------------------------------------------------------------

  get cardMessageId(): string | null {
    return this.cardKit.cardMessageId;
  }

  get isTerminalPhase(): boolean {
    return TERMINAL_PHASES.has(this.phase);
  }

  /**
   * Whether the card has been explicitly aborted (via abortCard()).
   *
   * Distinct from isTerminalPhase — creation_failed is NOT an abort;
   * it should allow fallthrough to static delivery in the factory.
   */
  get isAborted(): boolean {
    return this.phase === 'aborted';
  }

  /** Whether the reply pipeline was terminated due to an unavailable message. */
  get isTerminated(): boolean {
    return this.guard.isTerminated;
  }

  /** Check if the pipeline should skip further operations for this source. */
  shouldSkipForUnavailable(source: string): boolean {
    return this.guard.shouldSkip(source);
  }

  /** Attempt to terminate the pipeline due to an unavailable message error. */
  terminateIfUnavailable(source: string, err?: unknown): boolean {
    return this.guard.terminate(source, err);
  }

  /** Why the controller entered a terminal phase, or null if still active. */
  get terminalReason(): TerminalReason | null {
    return this._terminalReason;
  }

  /** @internal — exposed for test assertions only. */
  get currentPhase(): CardPhase {
    return this.phase;
  }

  private get shouldDisplayToolUse(): boolean {
    return this.deps.toolUseDisplay.showToolUse;
  }

  private computeToolUseDisplay(): ToolUseDisplayResult | null {
    if (!this.shouldDisplayToolUse) return null;
    const traceSteps = getToolUseTraceSteps(this.deps.sessionKey);
    return normalizeToolUseDisplay({
      traceSteps,
      showFullPaths: this.deps.toolUseDisplay.showFullPaths,
      showResultDetails: this.deps.toolUseDisplay.showToolResultDetails,
    });
  }

  private get visibleToolUseElapsedMs(): number | undefined {
    if (!this.shouldDisplayToolUse || !this.toolUse.startedAt) {
      return undefined;
    }
    return this.toolUse.elapsedMs || Date.now() - this.toolUse.startedAt;
  }

  private computeToolUseTitleSuffix(display: ToolUseDisplayResult | null): { zh: string; en: string } | undefined {
    if (!this.shouldDisplayToolUse) return undefined;
    const stepCount = display?.stepCount ?? 0;
    return stepCount > 0 ? buildToolUseTitleSuffix({ stepCount }) : undefined;
  }

  // ------------------------------------------------------------------
  // Unified callback guard
  // ------------------------------------------------------------------

  /**
   * Unified callback guard — returns true if the pipeline is active
   * and the callback should proceed.
   *
   * Combines three checks:
   * 1. guard.isTerminated — message recalled/deleted
   * 2. guard.shouldSkip(source) — eagerly detect unavailable messages
   * 3. isTerminalPhase — completed/aborted/terminated/creation_failed
   */
  private shouldProceed(source: string): boolean {
    if (this.guard.isTerminated || this.guard.shouldSkip(source)) return false;
    return !this.isTerminalPhase;
  }

  // ------------------------------------------------------------------
  // State machine
  // ------------------------------------------------------------------

  private isStaleCreate(epoch: number): boolean {
    return epoch !== this.createEpoch;
  }

  private transition(to: CardPhase, source: string, reason?: TerminalReason): boolean {
    const from = this.phase;
    if (from === to) return false;
    if (!PHASE_TRANSITIONS[from].has(to)) {
      log.warn('phase transition rejected', { from, to, source });
      return false;
    }
    this.phase = to;
    log.info('phase transition', { from, to, source, reason });
    if (TERMINAL_PHASES.has(to)) {
      this._terminalReason = reason ?? null;
      this.onEnterTerminalPhase();
    }
    return true;
  }

  private onEnterTerminalPhase(): void {
    this.createEpoch += 1;
    this.flush.cancelPendingFlush();
    this.flush.complete();
    this.disposeShutdownHook?.();
    this.disposeShutdownHook = null;
    // journal 收尾时机（3.3.3 修正）：'terminated'（消息被撤回/删除，卡已不存在，
    // 没有任何 API 能再收尾它）与 'creation_failed'（卡从未发出）立即出 journal；
    // 'completed'/'aborted' 的条目保留到终态更新真正成功后再移除（见 abortCard/
    // onError/onIdle 的成功路径）——若进程在终态更新落定前被热重载/强杀，条目
    // 留给下次启动的 card-recovery 补终态，不再出现「卡悬死但 journal 已清」的
    // 收尾黑洞（2026-11-25 群级配置热重载中断在途卡事故根因之一）。
    if (
      (this.phase === 'terminated' || this.phase === 'creation_failed') &&
      this.cardKit.cardMessageId
    ) {
      removeStreamingCard(this.deps.accountId, this.cardKit.cardMessageId);
    }
    if (this.phase === 'terminated' || this.phase === 'creation_failed') {
      clearToolUseTraceRun(this.deps.sessionKey);
    }
    // 治标兜底：重载/强杀路径下进入 aborted 终态后，abortCard 的全量收尾可能
    // 永远没机会跑完（进程马上被卸载/事件循环关闭）。这里独立改写一次卡面为
    // 「配置更新中」终态，不依赖 abortCard；若 abortCard 正在本轮调用栈里
    // 收尾（_inFlightAbort 置位），跳过以免同序列并发写卡。
    if (this.phase === 'aborted' && !this._inFlightAbort) {
      void this._notifyCardInterrupted();
    }
  }

  /**
   * 重载/关机场景的兜底终态改写：把在途卡面板替换为「配置更新中，请重问」，
   * 保留已流出的正文/思考。fire-and-forget、自捕获错误，绝不拖慢关机链路。
   * CardKit 与 IM 兜底双路径均尝试；卡面改写成功后立即出 journal。
   */
  private async _notifyCardInterrupted(): Promise<void> {
    const effectiveCardId = this.cardKit.cardKitCardId ?? this.cardKit.originalCardKitCardId;
    const messageId = this.cardKit.cardMessageId;
    if (!effectiveCardId && !messageId) return;
    const displayText = this.buildInterruptedDisplayText();
    const noticeText = `${displayText ? displayText + '\n\n---\n' : ''}⚙️ ${CONFIG_RELOAD_NOTICE}`;
    const fallbackCard = buildCardContent('complete', {
      text: noticeText,
      showToolUse: false,
    });
    try {
      if (effectiveCardId) {
        try {
          await this.closeStreamingAndUpdate(effectiveCardId, fallbackCard, 'notifyCardInterrupted');
        } catch (err) {
          log.warn('notifyCardInterrupted: CardKit close/update failed, falling back to im.message.patch', {
            cardId: effectiveCardId,
            error: String(err),
          });
          if (messageId) {
            await updateCardFeishu({
              cfg: this.deps.cfg,
              messageId,
              card: toCardKit2(fallbackCard) as unknown as Record<string, unknown>,
              accountId: this.deps.accountId,
            });
          }
        }
      } else if (messageId) {
        await updateCardFeishu({
          cfg: this.deps.cfg,
          messageId,
          card: toCardKit2(fallbackCard) as unknown as Record<string, unknown>,
          accountId: this.deps.accountId,
        });
      }
      // 兜底终态已落卡，journal 出条目（下次启动 recovery 不再重复覆盖）
      if (messageId) {
        removeStreamingCard(this.deps.accountId, messageId);
      }
      log.info('notifyCardInterrupted: interrupted-notice card written', {
        effectiveCardId,
        messageId,
      });
    } catch (err) {
      // 写失败：journal 条目保留，下次启动 card-recovery 会再补终态
      log.warn('notifyCardInterrupted: interrupted-notice write failed, keeping journal entry', {
        effectiveCardId,
        messageId,
        error: String(err),
      });
    }
  }

  /**
   * 关机中止时「已流出的内容」快照：纯思考阶段（正文为空）时给出思考摘要，
   * 杜绝只剩裸 'Aborted.' 的空壳卡（2026-11-25 11:49 热重载事故截图特征）。
   * 供 abortCard 与 notifyCardInterrupted 共用。
   */
  private buildInterruptedDisplayText(): string {
    const answer = this.text.accumulatedText;
    if (answer && answer.trim()) return answer;
    const reasoning = this.reasoning.accumulatedReasoningText;
    if (reasoning && reasoning.trim()) {
      const clamped = clampReasoningText(reasoning);
      return `💭 **Thinking…**\n\n${clamped}`;
    }
    return '';
  }

  private markToolUseActivity(): void {
    if (!this.toolUse.startedAt) {
      this.toolUse.startedAt = Date.now();
    }
    this.toolUse.elapsedMs = Date.now() - this.toolUse.startedAt;
    this.toolUse.isActive = true;
  }

  private captureToolUseElapsed(): void {
    if (!this.toolUse.startedAt) return;
    this.toolUse.elapsedMs = Date.now() - this.toolUse.startedAt;
    this.toolUse.isActive = false;
  }

  // ------------------------------------------------------------------
  // SDK callback bindings
  // ------------------------------------------------------------------

  /**
   * Handle a deliver() call in streaming card mode.
   *
   * Accumulates text from the SDK's deliver callbacks to build the
   * authoritative "completedText" for the final card.
   */
  async onDeliver(payload: ReplyPayload): Promise<void> {
    if (!this.shouldProceed('onDeliver')) return;

    const text = payload.text ?? '';
    if (!text.trim()) return;

    await this.ensureCardCreated();
    if (!this.shouldProceed('onDeliver.postCreate')) return;

    if (!this.cardKit.cardMessageId) return;
    this.captureToolUseElapsed();

    const split = splitReasoningText(text);

    if (split.reasoningText && !split.answerText) {
      // Pure reasoning payload
      this.reasoning.reasoningElapsedMs = this.reasoning.reasoningStartTime
        ? Date.now() - this.reasoning.reasoningStartTime
        : 0;
      this.reasoning.accumulatedReasoningText = split.reasoningText;
      this.reasoning.isReasoningPhase = true;
      await this.throttledCardUpdate();
      return;
    }

    // Answer payload (may also contain inline reasoning from tags)
    this.reasoning.isReasoningPhase = false;
    if (split.reasoningText) {
      this.reasoning.accumulatedReasoningText = split.reasoningText;
    }
    const answerText = split.answerText ?? text;

    // 累积 deliver 文本用于最终卡片
    this.text.completedText += (this.text.completedText ? '\n\n' : '') + answerText;

    // 没有流式数据时，用 deliver 文本显示在卡片上
    if (!this.text.lastPartialText && !this.text.streamingPrefix) {
      this.text.accumulatedText += (this.text.accumulatedText ? '\n\n' : '') + answerText;
      this.text.streamingPrefix = this.text.accumulatedText;
      await this.throttledCardUpdate();
    }
  }

  async onReasoningStream(payload: ReplyPayload): Promise<void> {
    if (!this.shouldProceed('onReasoningStream')) return;

    await this.ensureCardCreated();
    if (!this.shouldProceed('onReasoningStream.postCreate')) return;
    if (!this.cardKit.cardMessageId) return;

    const rawText = payload.text ?? '';
    if (!rawText) return;

    if (!this.reasoning.reasoningStartTime) {
      this.reasoning.reasoningStartTime = Date.now();
    }
    this.reasoning.isReasoningPhase = true;
    const split = splitReasoningText(rawText);
    this.reasoning.accumulatedReasoningText = split.reasoningText ?? rawText;
    await this.throttledCardUpdate();
  }

  async onToolStart(payload: { name?: string; phase?: string }): Promise<void> {
    if (!this.shouldProceed('onToolStart')) return;
    if (!this.shouldDisplayToolUse) return;
    if (payload.phase && payload.phase !== 'start') return;

    this.markToolUseActivity();

    await this.ensureCardCreated();
    if (!this.shouldProceed('onToolStart.postCreate')) return;
    if (!this.cardKit.cardMessageId) return;
    if (!this.text.accumulatedText && this.cardKit.cardKitCardId) {
      await this.throttledToolUseStatusUpdate();
      return;
    }
    await this.throttledCardUpdate();
  }

  async onToolPayload(_payload: ReplyPayload): Promise<void> {
    if (!this.shouldProceed('onToolPayload')) return;
    if (!this.shouldDisplayToolUse) return;

    this.markToolUseActivity();

    await this.ensureCardCreated();
    if (!this.shouldProceed('onToolPayload.postCreate')) return;
    if (!this.cardKit.cardMessageId) return;
    if (!this.text.accumulatedText && this.cardKit.cardKitCardId) {
      await this.throttledToolUseStatusUpdate();
      return;
    }
    await this.throttledCardUpdate();
  }

  async onPartialReply(payload: ReplyPayload): Promise<void> {
    if (!this.shouldProceed('onPartialReply')) return;

    // Use splitReasoningText (consistent with onDeliver/onReasoningStream)
    // to extract <think> tag content before stripping it from the answer.
    // Previously only stripReasoningTags was called, silently discarding
    // any thinking content that the LLM wrapped in <think> tags.
    const rawText = payload.text ?? '';
    const split = splitReasoningText(rawText);
    if (split.reasoningText) {
      if (!this.reasoning.reasoningStartTime) {
        this.reasoning.reasoningStartTime = Date.now();
      }
      this.reasoning.accumulatedReasoningText = split.reasoningText;
      this.reasoning.isReasoningPhase = true;
    }
    const text = split.answerText ?? stripReasoningTags(rawText);
    log.debug('onPartialReply', { len: text.length });
    if (!text) return;

    this.captureToolUseElapsed();
    if (!this.reasoning.reasoningStartTime) {
      this.reasoning.reasoningStartTime = Date.now();
    }
    if (this.reasoning.isReasoningPhase) {
      this.reasoning.isReasoningPhase = false;
      this.reasoning.reasoningElapsedMs = this.reasoning.reasoningStartTime
        ? Date.now() - this.reasoning.reasoningStartTime
        : 0;
    }

    // 检测回复边界：文本长度缩短 → 新回复开始
    if (this.text.lastPartialText && text.length < this.text.lastPartialText.length) {
      this.text.streamingPrefix += (this.text.streamingPrefix ? '\n\n' : '') + this.text.lastPartialText;
    }
    this.text.lastPartialText = text;
    this.text.accumulatedText = this.text.streamingPrefix ? this.text.streamingPrefix + '\n\n' + text : text;

    // NO_REPLY 缓冲
    if (!this.text.streamingPrefix && SILENT_REPLY_TOKEN.startsWith(this.text.accumulatedText.trim())) {
      log.debug('onPartialReply: buffering NO_REPLY prefix');
      return;
    }

    await this.ensureCardCreated();
    if (!this.shouldProceed('onPartialReply.postCreate')) return;
    if (!this.cardKit.cardMessageId) return;
    await this.throttledCardUpdate();
  }

  async onError(err: unknown, info: { kind: string }): Promise<void> {
    if (this.guard.terminate('onError', err)) return;

    log.error(`${info.kind} reply failed`, { error: String(err) });

    this.captureToolUseElapsed();
    this.finalizeCard('onError', 'error');

    await this.flush.waitForFlush();

    if (this.cardCreationPromise) await this.cardCreationPromise;

    const errorEffectiveCardId = this.cardKit.cardKitCardId ?? this.cardKit.originalCardKitCardId;
    const { footerMetrics, routingLogo } = await this.resolvePanelMetrics();
    const toolUseDisplay = this.computeToolUseDisplay();
    try {
      if (this.cardKit.cardMessageId) {
        const rawErrorText = this.text.accumulatedText
          ? `${this.text.accumulatedText}\n\n---\n**Error**: An error occurred while generating the response.`
          : '**Error**: An error occurred while generating the response.';
        const terminalContent = prepareTerminalCardContent(
          {
            text: rawErrorText,
            reasoningText: this.reasoning.accumulatedReasoningText || undefined,
          },
          this.imageResolver,
        );
        const errorCard = buildCardContent('complete', {
          panel: this.resolvePanelConfig(),
          text: terminalContent.text,
          reasoningText: terminalContent.reasoningText,
          reasoningElapsedMs: this.reasoning.reasoningElapsedMs || undefined,
          toolUseSteps: toolUseDisplay?.steps,
          toolUseTitleSuffix: this.computeToolUseTitleSuffix(toolUseDisplay),
          toolUseElapsedMs: this.visibleToolUseElapsedMs,
          showToolUse: this.deps.toolUseDisplay.showToolUse,
          elapsedMs: this.elapsed(),
          isError: true,
          footer: this.deps.resolvedFooter,
          footerMetrics,
          routingLogo,
        });
        if (errorEffectiveCardId) {
          await this.closeStreamingAndUpdate(errorEffectiveCardId, errorCard, 'onError');
        } else {
          await updateCardFeishu({
            cfg: this.deps.cfg,
            messageId: this.cardKit.cardMessageId,
            card: errorCard as unknown as Record<string, unknown>,
            accountId: this.deps.accountId,
          });
        }
        // 错误卡已成功落卡，journal 出条目（3.3.3 修正：条目不再在进终态时提前移除）
        if (this.cardKit.cardMessageId) {
          removeStreamingCard(this.deps.accountId, this.cardKit.cardMessageId);
        }
      }
    } catch {
      // Ignore update failures during error handling
    } finally {
      clearToolUseTraceRun(this.deps.sessionKey);
    }
  }

  async onIdle(): Promise<void> {
    if (this.guard.isTerminated || this.guard.shouldSkip('onIdle')) return;

    if (!this.dispatchFullyComplete) return;

    if (this.isTerminalPhase) return;
    this.captureToolUseElapsed();
    this.finalizeCard('onIdle', 'normal');

    await this.flush.waitForFlush();

    if (this.cardCreationPromise) {
      await this.cardCreationPromise;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await this.flush.waitForFlush();
    }

    const idleEffectiveCardId = this.cardKit.cardKitCardId ?? this.cardKit.originalCardKitCardId;
    try {
      if (this.cardKit.cardMessageId) {
        // 🍤 静默回复（NO_REPLY / 空回复）不留空壳卡：撤回占位卡。
        // 「派发即建卡」让占位卡在 dispatch 一开始就已发出，agent 最终选择
        // 不回复时，老行为是灌 'Done.' 兜底文案——群里留一张无信息空壳。
        // 撤回失败（缺 im:message:delete 权限/消息已被删等）回落原兜底文案
        // 路径，保证占位卡一定收尾。
        const silentReply =
          !this.text.completedText.trim() &&
          (!this.text.accumulatedText.trim() || SILENT_REPLY_TOKEN.startsWith(this.text.accumulatedText.trim()));
        if (silentReply) {
          try {
            await deleteMessageFeishu({
              cfg: this.deps.cfg,
              messageId: this.cardKit.cardMessageId,
              accountId: this.deps.accountId,
            });
            log.info('onIdle: silent reply, placeholder card recalled', {
              messageId: this.cardKit.cardMessageId,
            });
            // 卡已撤回 = 收尾完成，journal 出条目（3.3.3 修正后条目在此阶段仍留存）
            if (this.cardKit.cardMessageId) {
              removeStreamingCard(this.deps.accountId, this.cardKit.cardMessageId);
            }
            return;
          } catch (recallErr) {
            log.warn('onIdle: silent reply card recall failed, finalizing with fallback text', {
              messageId: this.cardKit.cardMessageId,
              error: String(recallErr),
            });
          }
        }

        // 🍤 无 token 增量时的流式补偿：streaming_mode 仍开启时灌入最终全文，
        // CardKit 客户端自行播放逐字打字机动画，随后再关流式、替换终态卡。
        const isNoReplyLeakPre =
          !this.text.completedText && SILENT_REPLY_TOKEN.startsWith(this.text.accumulatedText.trim());
        const preDisplayText =
          this.text.completedText || (isNoReplyLeakPre ? '' : this.text.accumulatedText) || EMPTY_REPLY_FALLBACK_TEXT;
        if (idleEffectiveCardId && preDisplayText.trim()) {
          try {
            this.cardKit.cardKitSequence += 1;
            const seqStream = this.cardKit.cardKitSequence;
            await streamCardContent({
              cfg: this.deps.cfg,
              cardId: idleEffectiveCardId,
              elementId: STREAMING_ELEMENT_ID,
              content: clampStreamingText(preDisplayText),
              sequence: seqStream,
              accountId: this.deps.accountId,
            });
            log.info('onIdle: final text streamed into element (typewriter)', {
              seq: seqStream,
              textLen: preDisplayText.length,
            });
            // 给客户端打字机动画留播放窗口
            await new Promise((resolve) => setTimeout(resolve, 1200));
          } catch (err) {
            log.warn('onIdle: stream final text failed, falling back to direct finalize', { error: String(err) });
          }
        }
        if (idleEffectiveCardId) {
          const seqBeforeClose = this.cardKit.cardKitSequence;
          this.cardKit.cardKitSequence += 1;
          log.info('onIdle: closing streaming mode', {
            seqBefore: seqBeforeClose,
            seqAfter: this.cardKit.cardKitSequence,
          });
          await setCardStreamingMode({
            cfg: this.deps.cfg,
            cardId: idleEffectiveCardId,
            streamingMode: false,
            sequence: this.cardKit.cardKitSequence,
            accountId: this.deps.accountId,
          });
        }

        const isNoReplyLeak =
          !this.text.completedText && SILENT_REPLY_TOKEN.startsWith(this.text.accumulatedText.trim());
        const displayText =
          this.text.completedText || (isNoReplyLeak ? '' : this.text.accumulatedText) || EMPTY_REPLY_FALLBACK_TEXT;
        if (!this.text.completedText && !this.text.accumulatedText) {
          log.warn('reply completed without visible text, using empty-reply fallback');
        }

        // 等待图片异步解析（最多 15s），避免终态卡片留占位符
        const resolvedDisplayText = await this.imageResolver.resolveImagesAwait(displayText, 15_000);

        const idleToolUseDisplay = this.computeToolUseDisplay();
        const terminalContent = prepareTerminalCardContent(
          {
            text: resolvedDisplayText,
            reasoningText: this.reasoning.accumulatedReasoningText || undefined,
          },
          this.imageResolver,
        );
        const { footerMetrics, routingLogo } = await this.resolvePanelMetrics();

        log.info('finalize panel probe', { panel: JSON.stringify(this.resolvePanelConfig() ?? null) });
        const completeCard = buildCardContent('complete', {
          panel: this.resolvePanelConfig(),
          text: terminalContent.text,
          reasoningText: terminalContent.reasoningText,
          reasoningElapsedMs: this.reasoning.reasoningElapsedMs || undefined,
          toolUseSteps: idleToolUseDisplay?.steps,
          toolUseTitleSuffix: this.computeToolUseTitleSuffix(idleToolUseDisplay),
          toolUseElapsedMs: this.visibleToolUseElapsedMs,
          showToolUse: this.deps.toolUseDisplay.showToolUse,
          elapsedMs: this.elapsed(),
          footer: this.deps.resolvedFooter,
          footerMetrics,
          routingLogo,
        });

        if (idleEffectiveCardId) {
          const seqBeforeUpdate = this.cardKit.cardKitSequence;
          this.cardKit.cardKitSequence += 1;
          log.info('onIdle: updating final card', {
            seqBefore: seqBeforeUpdate,
            seqAfter: this.cardKit.cardKitSequence,
          });
          try {
            await updateCardKitCard({
              cfg: this.deps.cfg,
              cardId: idleEffectiveCardId,
              card: toCardKit2(completeCard),
              sequence: this.cardKit.cardKitSequence,
              accountId: this.deps.accountId,
            });
          } catch (updateErr) {
            // 元素超限等错误时降级重试：去掉工具列表与 reasoning 细节，仅保留核心正文，确保卡片一定能封口
            log.warn('onIdle: CardKit update failed, attempting degraded finalize fallback', {
              error: String(updateErr),
              isElementLimit: isCardElementLimitError(updateErr),
            });
            const degradedCard = buildCardContent('complete', {
              panel: this.resolvePanelConfig(),
              text: terminalContent.text,
              elapsedMs: this.elapsed(),
              showToolUse: this.deps.toolUseDisplay.showToolUse,
              footer: this.deps.resolvedFooter,
              footerMetrics,
              routingLogo,
            });
            this.cardKit.cardKitSequence += 1;
            try {
              await updateCardKitCard({
                cfg: this.deps.cfg,
                cardId: idleEffectiveCardId,
                card: toCardKit2(degradedCard),
                sequence: this.cardKit.cardKitSequence,
                accountId: this.deps.accountId,
              });
              log.info('onIdle: degraded CardKit update succeeded', { seq: this.cardKit.cardKitSequence });
            } catch (cardKitDegradeErr) {
              // CardKit update 仍被拒时，通过 IM message patch 终极保底封卡——
              // 此时剥离面板/logo 只留正文，保证这一步不再有可失败的富元素
              log.warn('onIdle: degraded CardKit update failed, falling back to im.message.patch', {
                error: String(cardKitDegradeErr),
              });
              const minimalCard = buildCardContent('complete', {
                text: terminalContent.text,
                elapsedMs: this.elapsed(),
                showToolUse: false,
              });
              await updateCardFeishu({
                cfg: this.deps.cfg,
                messageId: this.cardKit.cardMessageId,
                card: toCardKit2(minimalCard) as unknown as Record<string, unknown>,
                accountId: this.deps.accountId,
              });
              log.info('onIdle: im.message.patch fallback succeeded');
            }
          }
        } else {
          try {
            await updateCardFeishu({
              cfg: this.deps.cfg,
              messageId: this.cardKit.cardMessageId,
              card: completeCard as unknown as Record<string, unknown>,
              accountId: this.deps.accountId,
            });
          } catch (patchErr) {
            log.warn('onIdle: IM card update failed, attempting degraded fallback', { error: String(patchErr) });
            // IM 路径的最后一次兜底：面板/logo 保留（元素数可忽略），工具步骤等
            // 大体积内容仍剥离；正文尺寸导致的失败在这一层救不了，交外层记录
            const degradedCard = buildCardContent('complete', {
              panel: this.resolvePanelConfig(),
              text: terminalContent.text,
              elapsedMs: this.elapsed(),
              showToolUse: this.deps.toolUseDisplay.showToolUse,
              footer: this.deps.resolvedFooter,
              footerMetrics,
              routingLogo,
            });
            await updateCardFeishu({
              cfg: this.deps.cfg,
              messageId: this.cardKit.cardMessageId,
              card: degradedCard as unknown as Record<string, unknown>,
              accountId: this.deps.accountId,
            });
          }
        }
        log.info('reply completed, card finalized', {
          elapsedMs: this.elapsed(),
          isCardKit: !!idleEffectiveCardId,
        });
        // 终态卡已成功落卡，journal 出条目（3.3.3 修正：条目不再在进终态时提前移除）
        if (this.cardKit.cardMessageId) {
          removeStreamingCard(this.deps.accountId, this.cardKit.cardMessageId);
        }
      }
    } catch (err) {
      log.warn('final card update failed', { error: String(err) });
    } finally {
      clearToolUseTraceRun(this.deps.sessionKey);
    }
  }

  // ------------------------------------------------------------------
  // External control
  // ------------------------------------------------------------------

  markFullyComplete(): void {
    log.debug('markFullyComplete', {
      completedTextLen: this.text.completedText.length,
      accumulatedTextLen: this.text.accumulatedText.length,
    });
    this.dispatchFullyComplete = true;
  }

  /**
   * 中止在途卡并收尾。
   *
   * @param opts.reason 中止来源：
   *   - `user-stop`（默认）：用户停止指令 / 消息不可用终止，卡面提示「已按要求停止」；
   *   - `shutdown`：宿主优雅关机 hook（含配置热重载）触发的中止，卡面提示
   *     「配置更新中，请重问」并说明本轮无输出，杜绝裸 'Aborted.' 空壳卡
   *     （2026-11-25 11:49 群级配置热重载事故）。
   */
  async abortCard(opts: { reason?: 'user-stop' | 'shutdown' } = {}): Promise<void> {
    const abortNotice = opts.reason === 'shutdown' ? CONFIG_RELOAD_NOTICE : USER_ABORTED_NOTICE;
    try {
      this.captureToolUseElapsed();
      this._inFlightAbort = true;
      if (!this.transition('aborted', 'abortCard', 'abort')) return;

      // transition() already executed onEnterTerminalPhase (cancel + complete + dispose hook)
      // Only need to wait for any in-flight flush to finish
      await this.flush.waitForFlush();

      if (this.cardCreationPromise) await this.cardCreationPromise;

      const effectiveCardId = this.cardKit.cardKitCardId ?? this.cardKit.originalCardKitCardId;
      const elapsedMs = Date.now() - this.dispatchStartTime;
      const abortToolUseDisplay = this.computeToolUseDisplay();
      const interruptedText = this.buildInterruptedDisplayText();
      const terminalContent = prepareTerminalCardContent(
        {
          // 思考阶段被中止时正文为空——兜底终态写「配置更新中/已停止」提示而非裸 'Aborted.'；
          // 思考内容只在 buildInterruptedDisplayText 内联展示一次，不再重复传 reasoningText
          text: interruptedText ? `${interruptedText}\n\n---\n${abortNotice}` : abortNotice,
          reasoningText: this.text.accumulatedText?.trim()
            ? this.reasoning.accumulatedReasoningText || undefined
            : undefined,
        },
        this.imageResolver,
      );
      const { footerMetrics, routingLogo } = await this.resolvePanelMetrics();
      if (effectiveCardId) {
        const abortCardContent = buildCardContent('complete', {
          panel: this.resolvePanelConfig(),
          text: terminalContent.text,
          reasoningText: terminalContent.reasoningText,
          reasoningElapsedMs: this.reasoning.reasoningElapsedMs || undefined,
          toolUseSteps: abortToolUseDisplay?.steps,
          toolUseTitleSuffix: this.computeToolUseTitleSuffix(abortToolUseDisplay),
          toolUseElapsedMs: this.visibleToolUseElapsedMs,
          showToolUse: this.deps.toolUseDisplay.showToolUse,
          elapsedMs,
          isAborted: true,
          footer: this.deps.resolvedFooter,
          footerMetrics,
          routingLogo,
        });
        const updated = await this.closeStreamingAndUpdate(effectiveCardId, abortCardContent, 'abortCard');
        log.info('abortCard completed', {
          effectiveCardId,
          reason: opts.reason ?? 'user-stop',
          updated,
        });
        // 终态更新成功后 journal 才出条目（3.3.3 修正）：条目在 onEnterTerminalPhase
        // 已被保留，这里更新落定即移除；若所有更新路径都失败，条目留给下次启动
        // card-recovery 补终态——不再出现「卡悬死但 journal 已清」。
        if (updated && this.cardKit.cardMessageId) {
          removeStreamingCard(this.deps.accountId, this.cardKit.cardMessageId);
        }
        return;
      } else if (this.cardKit.cardMessageId) {
        // IM fallback: 卡片不是通过 CardKit 发的，用 im.message.patch 更新
        const abortCard = buildCardContent('complete', {
          panel: this.resolvePanelConfig(),
          text: terminalContent.text,
          reasoningText: terminalContent.reasoningText,
          reasoningElapsedMs: this.reasoning.reasoningElapsedMs || undefined,
          toolUseSteps: abortToolUseDisplay?.steps,
          toolUseTitleSuffix: this.computeToolUseTitleSuffix(abortToolUseDisplay),
          toolUseElapsedMs: this.visibleToolUseElapsedMs,
          showToolUse: this.deps.toolUseDisplay.showToolUse,
          elapsedMs,
          isAborted: true,
          footer: this.deps.resolvedFooter,
          footerMetrics,
          routingLogo,
        });
        await updateCardFeishu({
          cfg: this.deps.cfg,
          messageId: this.cardKit.cardMessageId,
          card: abortCard as unknown as Record<string, unknown>,
          accountId: this.deps.accountId,
        });
        log.info('abortCard completed (IM fallback)', {
          messageId: this.cardKit.cardMessageId,
          reason: opts.reason ?? 'user-stop',
        });
        // IM 兜底更新成功，journal 出条目（同上：更新失败则条目留给 recovery）
        if (this.cardKit.cardMessageId) {
          removeStreamingCard(this.deps.accountId, this.cardKit.cardMessageId);
        }
      }
    } catch (err) {
      log.warn('abortCard failed', { error: String(err) });
    } finally {
      this._inFlightAbort = false;
      clearToolUseTraceRun(this.deps.sessionKey);
    }
  }

  // ------------------------------------------------------------------
  // Internal: card creation
  // ------------------------------------------------------------------

  async ensureCardCreated(): Promise<void> {
    if (this.guard.shouldSkip('ensureCardCreated.precheck')) return;
    if (this.cardKit.cardMessageId || this.phase === 'creation_failed' || this.isTerminalPhase) {
      return;
    }
    if (this.cardCreationPromise) {
      await this.cardCreationPromise;
      return;
    }
    if (!this.transition('creating', 'ensureCardCreated')) return;
    this.createEpoch += 1;
    const epoch = this.createEpoch;
    this.cardCreationPromise = (async () => {
      try {
        try {
          // Step 1: Create card entity
          const cId = await createCardEntity({
            cfg: this.deps.cfg,
            card: buildStreamingThinkingCard(this.deps.toolUseDisplay.showToolUse),
            accountId: this.deps.accountId,
          });

          if (this.isStaleCreate(epoch)) {
            log.info('ensureCardCreated: stale epoch after createCardEntity, bailing out', {
              epoch,
              phase: this.phase,
            });
            return;
          }

          if (cId) {
            this.cardKit.cardKitCardId = cId;
            this.cardKit.originalCardKitCardId = cId;
            this.cardKit.cardKitSequence = 1;
            this.disposeShutdownHook = registerShutdownHook(`streaming-card:${cId}`, () =>
        this.abortCard({ reason: 'shutdown' }),
      );
            log.info('created CardKit entity', {
              cardId: cId,
              initialSequence: this.cardKit.cardKitSequence,
            });

            // Step 2: Send IM message referencing card_id
            const result = await sendCardByCardId({
              cfg: this.deps.cfg,
              to: this.deps.chatId,
              cardId: cId,
              replyToMessageId: this.deps.replyToMessageId,
              replyInThread: this.deps.replyInThread,
              accountId: this.deps.accountId,
            });

            // 消息已发出即记在途 journal——放在 stale 检查之前：若创建途中被
            // abort 抢先（epoch 失配 bail），消息照样发出去了，journal 留到
            // 下次启动由 recovery 收尾，不留僵尸卡
            recordStreamingCard(this.deps.accountId, {
              cardKitCardId: this.cardKit.cardKitCardId,
              cardMessageId: result.messageId,
              chatId: this.deps.chatId,
              sessionKey: this.deps.sessionKey,
              createdAt: Date.now(),
            });

            if (this.isStaleCreate(epoch)) {
              log.info('ensureCardCreated: stale epoch after sendCardByCardId, bailing out', {
                epoch,
                phase: this.phase,
              });
              this.disposeShutdownHook?.();
              this.disposeShutdownHook = null;
              return;
            }

            this.cardKit.cardMessageId = result.messageId;
            this.flush.setCardMessageReady(true);
            if (!this.transition('streaming', 'ensureCardCreated.cardkit')) {
              this.disposeShutdownHook?.();
              this.disposeShutdownHook = null;
              return;
            }
            log.info('sent CardKit card', { messageId: result.messageId });
          } else {
            throw new Error('card.create returned empty card_id');
          }
        } catch (cardKitErr: unknown) {
          if (this.isStaleCreate(epoch)) return;
          if (this.guard.terminate('ensureCardCreated.cardkitFlow', cardKitErr)) {
            return;
          }
          // CardKit flow failed — fall back to regular IM card
          const apiDetail = extractApiDetail(cardKitErr);
          log.warn('CardKit flow failed, falling back to IM', { apiDetail });
          this.cardKit.cardKitCardId = null;
          this.cardKit.originalCardKitCardId = null;

          const fallbackCard = buildCardContent('streaming', {
            showToolUse: this.deps.toolUseDisplay.showToolUse,
          });
          const result = await sendCardFeishu({
            cfg: this.deps.cfg,
            to: this.deps.chatId,
            card: fallbackCard as unknown as Record<string, unknown>,
            replyToMessageId: this.deps.replyToMessageId,
            replyInThread: this.deps.replyInThread,
            accountId: this.deps.accountId,
          });

          // 同 CardKit 主路径：消息已发出即记 journal（stale bail 也可被 recovery 收尾）
          recordStreamingCard(this.deps.accountId, {
            cardKitCardId: null,
            cardMessageId: result.messageId,
            chatId: this.deps.chatId,
            sessionKey: this.deps.sessionKey,
            createdAt: Date.now(),
          });

          if (this.isStaleCreate(epoch)) {
            log.info('ensureCardCreated: stale epoch after IM fallback send, bailing out', {
              epoch,
              phase: this.phase,
            });
            return;
          }

          this.cardKit.cardMessageId = result.messageId;
          this.flush.setCardMessageReady(true);
          if (!this.transition('streaming', 'ensureCardCreated.imFallback')) {
            return;
          }
          log.info('sent fallback IM card', { messageId: result.messageId });
        }
      } catch (err) {
        if (this.isStaleCreate(epoch)) return;
        if (this.guard.terminate('ensureCardCreated.outer', err)) {
          return;
        }
        log.warn('thinking card failed, falling back to static', {
          error: String(err),
        });
        this.transition('creation_failed', 'ensureCardCreated.outer', 'creation_failed');
      }
    })();
    await this.cardCreationPromise;
  }

  // ------------------------------------------------------------------
  // Internal: flush
  // ------------------------------------------------------------------

  private async performFlush(): Promise<void> {
    if (!this.cardKit.cardMessageId || this.isTerminalPhase) return;

    // v2 CardKit 卡片不能走 IM patch，如果流式 CardKit 已禁用但 originalCardKitCardId
    // 仍在，说明卡片是通过 CardKit 发的——跳过中间态更新，等终态用 originalCardKitCardId 收尾
    if (!this.cardKit.cardKitCardId && this.cardKit.originalCardKitCardId) {
      log.debug('performFlush: skipping (CardKit streaming disabled, awaiting final update)');
      return;
    }

    log.debug('flushCardUpdate: enter', {
      seq: this.cardKit.cardKitSequence,
      isCardKit: !!this.cardKit.cardKitCardId,
    });

    try {
      const displayText = this.buildDisplayText();
      // 流式中间帧使用同步 resolveImages（不等待异步上传）
      const resolvedText = this.imageResolver.resolveImages(displayText);

      if (this.cardKit.cardKitCardId) {
        if (resolvedText !== this.text.lastFlushedText) {
          const prevSeq = this.cardKit.cardKitSequence;
          this.cardKit.cardKitSequence += 1;
          log.debug('flushCardUpdate: answer seq bump', {
            seqBefore: prevSeq,
            seqAfter: this.cardKit.cardKitSequence,
          });
          await streamCardContent({
            cfg: this.deps.cfg,
            cardId: this.cardKit.cardKitCardId,
            elementId: STREAMING_ELEMENT_ID,
            content: optimizeMarkdownStyle(clampStreamingText(resolvedText)),
            sequence: this.cardKit.cardKitSequence,
            accountId: this.deps.accountId,
          });
          this.text.lastFlushedText = resolvedText;
        }
      } else {
        log.debug('flushCardUpdate: IM patch fallback');
        const flushDisplay = this.computeToolUseDisplay();
        const card = buildCardContent('streaming', {
          text: this.reasoning.isReasoningPhase ? '' : resolvedText,
          reasoningText: this.reasoning.isReasoningPhase ? this.reasoning.accumulatedReasoningText : undefined,
          toolUseSteps: flushDisplay?.steps,
          toolUseTitleSuffix: this.computeToolUseTitleSuffix(flushDisplay),
          showToolUse: this.deps.toolUseDisplay.showToolUse,
        });
        await updateCardFeishu({
          cfg: this.deps.cfg,
          messageId: this.cardKit.cardMessageId,
          card: card as unknown as Record<string, unknown>,
          accountId: this.deps.accountId,
        });
      }
    } catch (err: unknown) {
      if (this.guard.terminate('flushCardUpdate', err)) return;

      const apiCode = extractLarkApiCode(err);

      // 速率限制（230020）— 跳过此帧，不降级
      if (isCardRateLimitError(err)) {
        log.info('flushCardUpdate: rate limited (230020), skipping', {
          seq: this.cardKit.cardKitSequence,
        });
        return;
      }

      // 卡片表格数超出飞书限制（230099/11310）— 禁用 CardKit 流式，
      // 保留 originalCardKitCardId 供 onIdle 做最终 CardKit 更新
      if (isCardTableLimitError(err)) {
        log.warn('flushCardUpdate: card table limit exceeded (230099/11310), disabling CardKit streaming', {
          seq: this.cardKit.cardKitSequence,
        });
        this.cardKit.cardKitCardId = null;
        return;
      }

      const apiDetail = extractApiDetail(err);
      log.error('card stream update failed', {
        apiCode,
        seq: this.cardKit.cardKitSequence,
        apiDetail,
      });
      if (this.cardKit.cardKitCardId) {
        log.warn('disabling CardKit streaming, falling back to im.message.patch');
        this.cardKit.cardKitCardId = null;
      }
    }
  }

  private buildDisplayText(): string {
    if (this.reasoning.isReasoningPhase && this.reasoning.accumulatedReasoningText) {
      const reasoningDisplay = `💭 **Thinking...**\n\n${this.reasoning.accumulatedReasoningText}`;
      return this.text.accumulatedText ? this.text.accumulatedText + '\n\n' + reasoningDisplay : reasoningDisplay;
    }
    return this.text.accumulatedText;
  }

  private async throttledCardUpdate(): Promise<void> {
    if (this.guard.shouldSkip('throttledCardUpdate')) return;
    const throttleMs = this.cardKit.cardKitCardId ? THROTTLE_CONSTANTS.CARDKIT_MS : THROTTLE_CONSTANTS.PATCH_MS;
    await this.flush.throttledUpdate(throttleMs);
  }

  // ---- Tool-use status streaming (pre-answer phase) ----

  private lastToolUseStatusUpdateTime = 0;

  private async throttledToolUseStatusUpdate(): Promise<void> {
    if (!this.cardKit.cardKitCardId) return;
    const now = Date.now();
    if (now - this.lastToolUseStatusUpdateTime < THROTTLE_CONSTANTS.REASONING_STATUS_MS) return;
    this.lastToolUseStatusUpdateTime = now;
    await this.updateToolUseStatus();
  }

  private async updateToolUseStatus(): Promise<void> {
    if (!this.cardKit.cardKitCardId || this.isTerminalPhase) return;
    try {
      const display = this.computeToolUseDisplay();
      const card = buildStreamingPreAnswerCard({
        steps: display?.steps,
        elapsedMs: this.visibleToolUseElapsedMs,
        showToolUse: this.shouldDisplayToolUse,
      });
      this.cardKit.cardKitSequence += 1;
      await updateCardKitCard({
        cfg: this.deps.cfg,
        cardId: this.cardKit.cardKitCardId,
        card,
        sequence: this.cardKit.cardKitSequence,
        accountId: this.deps.accountId,
      });
    } catch (err) {
      log.debug('updateToolUseStatus failed', { error: String(err) });
    }
  }

  // ------------------------------------------------------------------
  // Internal: lifecycle helpers
  // ------------------------------------------------------------------

  private finalizeCard(source: string, reason: TerminalReason): void {
    this.transition('completed', source, reason);
  }

  /**
   * Close streaming mode then update card content (shared by onError and abortCard).
   *
   * @returns 是否有任一更新路径真正落卡（CardKit update 或 IM patch 成功）。
   *          调用方（abortCard）据此决定 journal 出条目还是留给 recovery 重试。
   */
  private async closeStreamingAndUpdate(
    cardId: string,
    card: ReturnType<typeof buildCardContent>,
    label: string,
  ): Promise<boolean> {
    const seqBeforeClose = this.cardKit.cardKitSequence;
    this.cardKit.cardKitSequence += 1;
    log.info(`${label}: closing streaming mode`, {
      seqBefore: seqBeforeClose,
      seqAfter: this.cardKit.cardKitSequence,
    });
    try {
      await setCardStreamingMode({
        cfg: this.deps.cfg,
        cardId,
        streamingMode: false,
        sequence: this.cardKit.cardKitSequence,
        accountId: this.deps.accountId,
      });
    } catch (streamModeErr) {
      log.warn(`${label}: setCardStreamingMode failed`, { error: String(streamModeErr) });
    }
    const seqBeforeUpdate = this.cardKit.cardKitSequence;
    this.cardKit.cardKitSequence += 1;
    log.info(`${label}: updating card`, {
      seqBefore: seqBeforeUpdate,
      seqAfter: this.cardKit.cardKitSequence,
    });
    try {
      await updateCardKitCard({
        cfg: this.deps.cfg,
        cardId,
        card: toCardKit2(card),
        sequence: this.cardKit.cardKitSequence,
        accountId: this.deps.accountId,
      });
      return true;
    } catch (updateErr) {
      log.warn(`${label}: updateCardKitCard failed, attempting degraded update`, { error: String(updateErr) });
      if (this.cardKit.cardMessageId) {
        try {
          await updateCardFeishu({
            cfg: this.deps.cfg,
            messageId: this.cardKit.cardMessageId,
            card: toCardKit2(card) as unknown as Record<string, unknown>,
            accountId: this.deps.accountId,
          });
          log.info(`${label}: im.message.patch fallback succeeded`);
          return true;
        } catch (patchErr) {
          log.warn(`${label}: im.message.patch fallback failed`, { error: String(patchErr) });
        }
      }
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Error detail extraction helpers (replacing `any` casts)
// ---------------------------------------------------------------------------

/**
 * 终态卡片的正文和 reasoning 都会被飞书按 markdown 渲染，
 * 因此两者都要先做图片替换与表格降级，避免再次撞到 230099/11310；
 * 再按 UTF-8 字节预算钳制（终态保尾），防长回复撑爆单卡 ~30KB JSON 上限。
 */
export function prepareTerminalCardContent(
  content: TerminalCardContentInput,
  imageResolver: TerminalCardTextImageResolver,
  tableLimit: number = FEISHU_CARD_TABLE_LIMIT,
): TerminalCardContentInput {
  const resolvedReasoningText = content.reasoningText ? imageResolver.resolveImages(content.reasoningText) : undefined;
  const resolvedText = imageResolver.resolveImages(content.text);
  const sanitizedSegments = sanitizeTextSegmentsForCard(
    resolvedReasoningText ? [resolvedReasoningText, resolvedText] : [resolvedText],
    tableLimit,
  ).map((segment, index) => (index === 0 && resolvedReasoningText ? clampReasoningText(segment) : clampAnswerText(segment)));

  if (resolvedReasoningText) {
    return {
      reasoningText: sanitizedSegments[0],
      text: sanitizedSegments[1],
    };
  }

  return { text: sanitizedSegments[0] };
}

function extractApiDetail(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);
  const e = err as { response?: { data?: unknown } };
  return e.response?.data ? JSON.stringify(e.response.data) : String(err);
}
