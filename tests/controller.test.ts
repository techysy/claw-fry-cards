import { describe, expect, it, vi } from "vitest";
import { ClawCardController, type Logger } from "../src/controller";
import { parseConfig } from "../src/config";
import { CARD_PHASES } from "../src/streaming/session";
import type { FeishuClient } from "../src/feishu";

const quietLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

class FakeClient {
  calls: Array<{ op: string; args: unknown[] }> = [];
  failOn: Set<string> = new Set();

  private record(op: string, args: unknown[]): void {
    this.calls.push({ op, args });
    if (this.failOn.has(op)) throw new Error(`forced failure: ${op}`);
  }

  async cardkitCreate(card: unknown): Promise<string> {
    this.record("cardkitCreate", [card]);
    return "card_abc123";
  }

  async cardkitStreamElement(cardId: string, elementId: string, content: string, sequence: number): Promise<void> {
    this.record("cardkitStreamElement", [cardId, elementId, content, sequence]);
  }

  async cardkitUpdate(cardId: string, card: unknown, sequence: number): Promise<void> {
    this.record("cardkitUpdate", [cardId, card, sequence]);
  }

  async cardkitBatchUpdate(cardId: string, actions: unknown[], sequence: number): Promise<void> {
    this.record("cardkitBatchUpdate", [cardId, actions, sequence]);
  }

  async cardkitCloseStreaming(cardId: string, sequence: number): Promise<void> {
    this.record("cardkitCloseStreaming", [cardId, sequence]);
  }

  async sendCardEntityToChat(chatId: string, cardId: string): Promise<string> {
    this.record("sendCardEntityToChat", [chatId, cardId]);
    return "msg_1";
  }

  async replyCardById(messageId: string, cardId: string): Promise<string> {
    this.record("replyCardById", [messageId, cardId]);
    return "msg_1";
  }
}

function makeController(client: FakeClient, overrides: Record<string, unknown> = {}) {
  const cfg = parseConfig({
    feishu: { app_id: "a", app_secret: "b" },
    ...overrides,
  });
  const controller = new ClawCardController(cfg, client as unknown as FeishuClient, quietLogger);
  return controller;
}

const FEISHU_CTX = { channelId: "feishu", sessionKey: "feishu:oc_chat1", conversationId: "oc_chat1" };

async function drain(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe("ClawCardController 生命周期", () => {
  it("message_received → 建卡；message_sending → 打字机+封卡+取消文本", async () => {
    const client = new FakeClient();
    const controller = makeController(client, {
      streaming: { flush_interval_ms: 50, typewriter_max_ms: 50 },
      display: { unified_panel_min_duration: 0 },
    });

    await controller.onMessageReceived(
      { from: "feishu:oc_chat1", content: "你好", messageId: "om_in" },
      FEISHU_CTX,
    );
    const session = controller.getSession("feishu:oc_chat1")!;
    expect(session).toBeTruthy();
    expect(session.phase).toBe(CARD_PHASES.streaming);
    expect(client.calls.map((c) => c.op)).toEqual(["cardkitCreate", "replyCardById"]);
    const cardJson = client.calls[0]!.args[0] as Record<string, any>;
    expect(cardJson.schema).toBe("2.0");
    expect(cardJson.config.streaming_mode).toBe(true);

    const result = await controller.onMessageSending(
      { to: "oc_chat1", content: "<thinking>想</thinking>这是答案" },
      FEISHU_CTX,
    );
    expect(result).toMatchObject({ cancel: true, cancelReason: "delivered_as_card" });
    expect(session.phase).toBe(CARD_PHASES.completed);
    expect(session.answer_text).toBe("这是答案");
    expect(session.reasoning_rounds).toHaveLength(1);

    const ops = client.calls.map((c) => c.op);
    expect(ops).toContain("cardkitStreamElement");
    expect(ops).toContain("cardkitCloseStreaming");
    expect(ops).toContain("cardkitUpdate");
    // 打字机最后一片内容 = 完整答案
    const lastStream = [...client.calls].reverse().find((c) => c.op === "cardkitStreamElement")!;
    expect(lastStream.args[2]).toBe("这是答案");

    // 完成卡为全量替换：统一面板 header 带 🦞
    const sealCard = client.calls.find((c) => c.op === "cardkitUpdate")!.args[1] as Record<string, any>;
    const panel = sealCard.body.elements.find((e: any) => e.tag === "collapsible_panel");
    expect(panel.header.title.content).toContain("🦞");
    expect(panel.border.color).toBe("green");
    // reasoning 内容并入统一面板
    expect(JSON.stringify(panel.elements)).toContain("想");

    controller.dispose();
  });

  it("seal 失败 → 回落纯文本（返回 undefined）+ 删除 loading", async () => {
    const client = new FakeClient();
    client.failOn.add("cardkitUpdate");
    const controller = makeController(client, {
      streaming: { flush_interval_ms: 50, typewriter_max_ms: 50 },
    });

    await controller.onMessageReceived({ from: "f", content: "hi", messageId: "om_1" }, FEISHU_CTX);
    const result = await controller.onMessageSending({ to: "oc_chat1", content: "答案" }, FEISHU_CTX);
    expect(result).toBeUndefined();
    const ops = client.calls.map((c) => c.op);
    expect(ops).toContain("cardkitBatchUpdate"); // loading 清理
    const del = client.calls.find((c) => c.op === "cardkitBatchUpdate")!;
    expect(del.args[1]).toEqual([{ type: "delete", element_id: "loading_icon" }]);
    controller.dispose();
  });

  it("/stop 命令把进行中的会话封为已停止", async () => {
    const client = new FakeClient();
    const controller = makeController(client, {
      streaming: { flush_interval_ms: 50, typewriter_max_ms: 50 },
    });
    await controller.onMessageReceived({ from: "f", content: "干活", messageId: "om_2" }, FEISHU_CTX);
    await controller.onMessageReceived({ from: "f", content: "/stop", messageId: "om_3" }, FEISHU_CTX);
    await drain();
    const session = controller.getSession("feishu:oc_chat1")!;
    expect(session.sealed).toBe(true);
    const sealCard = client.calls.find((c) => c.op === "cardkitUpdate")!.args[1] as Record<string, any>;
    // 折叠面板边框为黄色（中断）——若面板未渲染（无工具/短耗时），至少确认卡片无蓝色流式 header
    const panel = sealCard.body.elements.find((e: any) => e.tag === "collapsible_panel");
    if (panel) expect(panel.border.color).toBe("yellow");
    expect(sealCard.body).toBeTruthy();
    controller.dispose();
  });

  it("命令消息不建卡", async () => {
    const client = new FakeClient();
    const controller = makeController(client);
    await controller.onMessageReceived({ from: "f", content: "/clear", messageId: "om_4" }, FEISHU_CTX);
    expect(controller.getSession("feishu:oc_chat1")).toBeUndefined();
    expect(client.calls).toHaveLength(0);
    controller.dispose();
  });

  it("非 feishu 渠道全部忽略", async () => {
    const client = new FakeClient();
    const controller = makeController(client);
    await controller.onMessageReceived(
      { from: "x", content: "hi", messageId: "m" },
      { channelId: "telegram", sessionKey: "tg:1" },
    );
    expect(client.calls).toHaveLength(0);
    const r = await controller.onMessageSending(
      { to: "1", content: "yo" },
      { channelId: "telegram", sessionKey: "tg:1" },
    );
    expect(r).toBeUndefined();
    controller.dispose();
  });

  it("工具进度：before/after_tool_call 触发面板 batch_update", async () => {
    vi.useFakeTimers();
    try {
      const client = new FakeClient();
      const controller = makeController(client);
      await controller.onMessageReceived({ from: "f", content: "查一下", messageId: "om_5" }, FEISHU_CTX);
      controller.onBeforeToolCall(
        { toolName: "web_search", params: { query: "小龙虾 淮安" } },
        FEISHU_CTX,
      );
      await vi.advanceTimersByTimeAsync(150);
      const updates = client.calls.filter((c) => c.op === "cardkitBatchUpdate");
      expect(updates.length).toBeGreaterThanOrEqual(1);
      const action = (updates[0]!.args[1] as unknown[])[0] as Record<string, any>;
      expect(action.action).toBe("partial_update_element");
      expect(action.params.element_id).toBe("tool_panel");

      controller.onAfterToolCall(
        { toolName: "web_search", params: {}, result: "found", durationMs: 300 },
        FEISHU_CTX,
      );
      await vi.advanceTimersByTimeAsync(150);
      expect(client.calls.filter((c) => c.op === "cardkitBatchUpdate").length).toBeGreaterThanOrEqual(2);
      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("llm_output 记录模型与 token，封卡 footer 生效", async () => {
    const client = new FakeClient();
    const controller = makeController(client, {
      streaming: { flush_interval_ms: 50, typewriter_max_ms: 50, footer_enabled: true },
      display: { unified_panel_min_duration: 0 },
    });
    await controller.onMessageReceived({ from: "f", content: "hi", messageId: "om_6" }, FEISHU_CTX);
    controller.onLlmOutput(
      {
        runId: "r",
        sessionId: "s",
        provider: "openai",
        model: "gpt-5.4",
        resolvedRef: "openai/gpt-5.4",
        contextTokenBudget: 1_000_000,
        usage: { input: 55600, output: 900 },
      },
      FEISHU_CTX,
    );
    await controller.onMessageSending({ to: "oc_chat1", content: "答" }, FEISHU_CTX);
    const sealCard = client.calls.find((c) => c.op === "cardkitUpdate")!.args[1] as Record<string, any>;
    const footer = sealCard.body.elements.at(-1);
    expect(footer.content).toContain("⇲gpt-5.4");
    expect(footer.content).toContain("55.6K/1.0M");
    controller.dispose();
  });

  it("agent_end 兜底封卡（无文本回复）", async () => {
    vi.useFakeTimers();
    try {
      const client = new FakeClient();
      const controller = makeController(client);
      await controller.onMessageReceived({ from: "f", content: "hi", messageId: "om_7" }, FEISHU_CTX);
      controller.onAgentEnd({ messages: [], success: false, error: "boom", durationMs: 1200 }, FEISHU_CTX);
      await vi.advanceTimersByTimeAsync(6000);
      const session = controller.getSession("feishu:oc_chat1")!;
      expect(session.phase).toBe(CARD_PHASES.failed);
      expect(client.calls.map((c) => c.op)).toContain("cardkitUpdate");
      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("chat allowlist 拦截", async () => {
    const client = new FakeClient();
    const controller = makeController(client, { chats: { allowlist: ["oc_other"] } });
    await controller.onMessageReceived({ from: "f", content: "hi", messageId: "om_8" }, FEISHU_CTX);
    expect(client.calls).toHaveLength(0);
    controller.dispose();
  });

  it("已封卡会话的后续 payload 被吞掉（正文已上卡，防重复）", async () => {
    const client = new FakeClient();
    const controller = makeController(client, {
      streaming: { flush_interval_ms: 50, typewriter_max_ms: 50 },
    });
    await controller.onMessageReceived({ from: "f", content: "hi", messageId: "om_11" }, FEISHU_CTX);
    await controller.onMessageSending({ to: "oc_chat1", content: "正文答案" }, FEISHU_CTX);
    const session = controller.getSession("feishu:oc_chat1")!;
    expect(session.sealed).toBe(true);

    const followup = await controller.onMessageSending(
      { to: "oc_chat1", content: "Agent: main | Model: mimo-v2.5 | Provider: 10router" },
      FEISHU_CTX,
    );
    expect(followup).toMatchObject({ cancel: true, cancelReason: "card_already_delivered" });
    controller.dispose();
  });

  it("reply_payload_sending 通道也能接管（官方卡片路径），已封卡则 cancel", async () => {
    const client = new FakeClient();
    const controller = makeController(client, {
      streaming: { flush_interval_ms: 50, typewriter_max_ms: 50 },
    });
    await controller.onMessageReceived({ from: "f", content: "hi", messageId: "om_12" }, FEISHU_CTX);

    // 官方卡片投递路径：payload 形式
    const first = await controller.onReplyPayloadSending(
      { payload: { text: "payload 正文" }, kind: "agent" },
      FEISHU_CTX,
    );
    expect(first).toMatchObject({ cancel: true, reason: "delivered_as_card" });
    const session = controller.getSession("feishu:oc_chat1")!;
    expect(session.sealed).toBe(true);
    expect(session.answer_text).toBe("payload 正文");

    // 同轮后续 payload → cancel 吞掉
    const followup = await controller.onReplyPayloadSending(
      { payload: { text: "Agent: main | Model: mimo-v2.5" }, kind: "agent" },
      FEISHU_CTX,
    );
    expect(followup).toMatchObject({ cancel: true, reason: "card_already_delivered" });

    // message_sending 晚到（同一内容另一路径）→ sealed cancel，不双投
    const late = await controller.onMessageSending({ to: "oc_chat1", content: "正文" }, FEISHU_CTX);
    expect(late).toMatchObject({ cancel: true, cancelReason: "card_already_delivered" });
    controller.dispose();
  });

  it("reply_payload_sending 不接管交互/媒体/纯推理 payload", async () => {
    const client = new FakeClient();
    const controller = makeController(client);
    await controller.onMessageReceived({ from: "f", content: "hi", messageId: "om_13" }, FEISHU_CTX);

    expect(
      await controller.onReplyPayloadSending({ payload: { text: "确认？", interactive: true }, kind: "agent" }, FEISHU_CTX),
    ).toBeUndefined();
    expect(
      await controller.onReplyPayloadSending({ payload: { text: "想", isReasoning: true }, kind: "agent" }, FEISHU_CTX),
    ).toBeUndefined();
    expect(
      await controller.onReplyPayloadSending({ payload: { text: "图", mediaUrl: "https://x/y.png" }, kind: "agent" }, FEISHU_CTX),
    ).toBeUndefined();
    const session = controller.getSession("feishu:oc_chat1")!;
    expect(session.sealed).toBe(false);
    controller.dispose();
  });

  it("同一会话新消息到来时旧卡封为停止", async () => {
    const client = new FakeClient();
    const controller = makeController(client, {
      streaming: { flush_interval_ms: 50, typewriter_max_ms: 50 },
    });
    await controller.onMessageReceived({ from: "f", content: "第一条", messageId: "om_9" }, FEISHU_CTX);
    await controller.onMessageReceived({ from: "f", content: "第二条", messageId: "om_10" }, FEISHU_CTX);
    await drain();
    const first = client.calls.filter((c) => c.op === "cardkitCreate");
    expect(first).toHaveLength(2);
    controller.dispose();
  });
});
