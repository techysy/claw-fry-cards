/** CardSession — 每条消息一张流式卡片的状态机（移植自 hermes-fry-cards streaming/session.py，v0.1 简化：单卡不拆分）。 */

import { FlushController } from "./flush";
import { ToolUseTracker } from "./tooluse";
import type { ReasoningRound } from "../cardkit/builder";
import type { FooterData } from "../cardkit/builder";

export const CARD_PHASES = {
  idle: "idle",
  creating: "creating",
  streaming: "streaming",
  completed: "completed",
  aborted: "aborted",
  failed: "failed",
} as const;

export type CardPhase = (typeof CARD_PHASES)[keyof typeof CARD_PHASES];

const TERMINAL_PHASES: ReadonlySet<CardPhase> = new Set([
  CARD_PHASES.completed,
  CARD_PHASES.aborted,
  CARD_PHASES.failed,
]);

export function isTerminal(phase: CardPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

export type CardSession = {
  sessionKey: string;
  chatId: string;
  /** 收到的用户消息 id（fallback 回复锚点）。 */
  message_id: string;
  phase: CardPhase;
  card_id: string | null;
  card_message_id: string | null;
  sequence: number;
  /** CardKit 变更互斥锁（串行化 per-card API 调用）。 */
  mutex: Promise<unknown>;
  flush: FlushController;
  tool: ToolUseTracker;
  /** 面板节流脏标记：工具状态变化后置 true，flush 时写回。 */
  tool_dirty: boolean;
  reasoning_rounds: ReasoningRound[];
  reasoning_text_seen: boolean;
  answer_text: string;
  answer_streamed_chars: number;
  footer: FooterData;
  context_token_budget: number;
  started_at: number;
  updated_at: number;
  sealed: boolean;
  stale_timer: ReturnType<typeof setTimeout> | null;
};

export function createSession(sessionKey: string, chatId: string, messageId: string): CardSession {
  return {
    sessionKey,
    chatId,
    message_id: messageId,
    phase: CARD_PHASES.idle,
    card_id: null,
    card_message_id: null,
    sequence: 0,
    mutex: Promise.resolve(),
    flush: new FlushController(),
    tool: new ToolUseTracker(),
    tool_dirty: false,
    reasoning_rounds: [],
    reasoning_text_seen: false,
    answer_text: "",
    answer_streamed_chars: 0,
    footer: {},
    context_token_budget: 0,
    started_at: Date.now(),
    updated_at: Date.now(),
    sealed: false,
    stale_timer: null,
  };
}

/** 串行化执行：所有 per-card CardKit 变更经由此入口，保证 sequence 单调有效。 */
export function serialized<T>(session: CardSession, fn: () => Promise<T>): Promise<T> {
  const run = session.mutex.then(fn, fn);
  session.mutex = run.catch(() => undefined);
  return run;
}

export function nextSequence(session: CardSession): number {
  session.sequence += 1;
  return session.sequence;
}
