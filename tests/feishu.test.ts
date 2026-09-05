import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeishuAPIError, FeishuClient } from "../src/feishu";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

type Call = { path: string; method: string; body: any };

function makeFetch(responses: Partial<Record<string, unknown>>, calls: Call[]) {
  return vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const path = url.replace(/^https:\/\/[^/]+/, "");
    const method = init?.method ?? "GET";
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    for (const [pattern, body] of Object.entries(responses)) {
      if (path.startsWith(pattern)) return jsonResponse(body);
    }
    return jsonResponse({ code: -1, msg: `unmocked ${path}` });
  }) as unknown as typeof fetch;
}

describe("FeishuClient", () => {
  let calls: Call[];

  beforeEach(() => {
    calls = [];
  });

  it("缺 app_id 抛错", () => {
    expect(() => new FeishuClient({ appId: "", appSecret: "s" })).toThrow(FeishuAPIError);
  });

  it("cardkitCreate 返回 card_id 且使用 token", async () => {
    const client = new FeishuClient({
      appId: "cli_a",
      appSecret: "sec",
      fetchImpl: makeFetch(
        {
          "/open-apis/auth/v3/tenant_access_token/internal": {
            code: 0,
            tenant_access_token: "tok",
            expire: 7200,
          },
          "/open-apis/cardkit/v1/cards": { code: 0, data: { card_id: "card_123" } },
        },
        calls,
      ),
    });
    const id = await client.cardkitCreate({ schema: "2.0" });
    expect(id).toBe("card_123");
    expect(calls[0]!.path).toBe("/open-apis/auth/v3/tenant_access_token/internal");
    expect(calls[0]!.body).toMatchObject({ app_id: "cli_a" });
    const create = calls[1]!;
    expect(create.method).toBe("POST");
    expect(create.body.type).toBe("card_json");
    expect(JSON.parse(create.body.data)).toEqual({ schema: "2.0" });
    expect(create.body).not.toHaveProperty("authorization");
  });

  it("token 缓存：第二次调用不再请求 token", async () => {
    const fetchImpl = makeFetch(
      {
        "/open-apis/auth/v3/tenant_access_token/internal": { code: 0, tenant_access_token: "tok", expire: 7200 },
        "/open-apis/cardkit/v1/cards": { code: 0, data: { card_id: "c1" } },
      },
      calls,
    );
    const client = new FeishuClient({ appId: "a", appSecret: "b", fetchImpl });
    await client.cardkitCreate({});
    await client.cardkitCreate({});
    const tokenCalls = calls.filter((c) => c.path.includes("tenant_access_token"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("cardkitStreamElement 走 PUT content 端点并带 sequence", async () => {
    const client = new FeishuClient({
      appId: "a",
      appSecret: "b",
      fetchImpl: makeFetch(
        {
          "/open-apis/auth/v3/tenant_access_token/internal": { code: 0, tenant_access_token: "t", expire: 7200 },
          "/open-apis/cardkit/v1/cards/": { code: 0, data: {} },
        },
        calls,
      ),
    });
    await client.cardkitStreamElement("cid", "streaming_content", "hi", 7);
    const call = calls.find((c) => c.path.includes("/elements/streaming_content/content"))!;
    expect(call.method).toBe("PUT");
    expect(call.body).toEqual({ content: "hi", sequence: 7 });
  });

  it("cardkitUpdate 全量替换（card.data 为完整卡 JSON）", async () => {
    const client = new FeishuClient({
      appId: "a",
      appSecret: "b",
      fetchImpl: makeFetch(
        {
          "/open-apis/auth/v3/tenant_access_token/internal": { code: 0, tenant_access_token: "t", expire: 7200 },
          "/open-apis/cardkit/v1/cards/": { code: 0, data: {} },
        },
        calls,
      ),
    });
    await client.cardkitUpdate("cid", { schema: "2.0", body: {} }, 9);
    const call = calls.find((c) => c.method === "PUT" && c.path === "/open-apis/cardkit/v1/cards/cid")!;
    expect(call.body.sequence).toBe(9);
    expect(call.body.card.type).toBe("card_json");
    expect(JSON.parse(call.body.card.data)).toMatchObject({ schema: "2.0" });
  });

  it("cardkitCloseStreaming PATCH settings streaming_mode=false", async () => {
    const client = new FeishuClient({
      appId: "a",
      appSecret: "b",
      fetchImpl: makeFetch(
        {
          "/open-apis/auth/v3/tenant_access_token/internal": { code: 0, tenant_access_token: "t", expire: 7200 },
          "/open-apis/cardkit/v1/cards/": { code: 0, data: {} },
        },
        calls,
      ),
    });
    await client.cardkitCloseStreaming("cid", 3);
    const call = calls.find((c) => c.path === "/open-apis/cardkit/v1/cards/cid/settings")!;
    expect(call.method).toBe("PATCH");
    expect(JSON.parse(call.body.settings)).toEqual({ streaming_mode: false });
    expect(call.body.sequence).toBe(3);
  });

  it("cardkitBatchUpdate actions 为 JSON 字符串", async () => {
    const client = new FeishuClient({
      appId: "a",
      appSecret: "b",
      fetchImpl: makeFetch(
        {
          "/open-apis/auth/v3/tenant_access_token/internal": { code: 0, tenant_access_token: "t", expire: 7200 },
          "/open-apis/cardkit/v1/cards/": { code: 0, data: {} },
        },
        calls,
      ),
    });
    const actions = [{ type: "delete", element_id: "loading_icon" }];
    await client.cardkitBatchUpdate("cid", actions, 4);
    const call = calls.find((c) => c.path.includes("/batch_update"))!;
    expect(JSON.parse(call.body.actions)).toEqual(actions);
    expect(call.body.sequence).toBe(4);
  });

  it("replyCardById / sendCardEntityToChat 用 msg_type=interactive（card 会被 230001 拒绝）", async () => {
    const client = new FeishuClient({
      appId: "a",
      appSecret: "b",
      fetchImpl: makeFetch(
        {
          "/open-apis/auth/v3/tenant_access_token/internal": { code: 0, tenant_access_token: "t", expire: 7200 },
          "/open-apis/im/v1/messages": { code: 0, data: { message_id: "om_1" } },
        },
        calls,
      ),
    });
    await client.replyCardById("om_in", "card_1");
    await client.sendCardEntityToChat("oc_1", "card_2");
    const [reply, send] = calls.filter((c) => c.path.includes("/im/v1/messages"));
    expect(reply!.body.msg_type).toBe("interactive");
    expect(JSON.parse(reply!.body.content)).toEqual({ type: "card", data: { card_id: "card_1" } });
    expect(send!.body.msg_type).toBe("interactive");
    expect(send!.path).toContain("receive_id_type=chat_id");
  });

  it("API 错误抛 FeishuAPIError 并可提取子错误码", async () => {
    const client = new FeishuClient({
      appId: "a",
      appSecret: "b",
      fetchImpl: makeFetch(
        {
          "/open-apis/auth/v3/tenant_access_token/internal": { code: 0, tenant_access_token: "t", expire: 7200 },
          "/open-apis/cardkit/v1/cards": {
            code: 230001,
            msg: "Failed to create card content, ext=ErrCode: 11310; more",
          },
        },
        calls,
      ),
    });
    try {
      await client.cardkitCreate({});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FeishuAPIError);
      const e = err as FeishuAPIError;
      expect(e.code).toBe(230001);
      expect(e.extractSubCode()).toBe(11310);
    }
  });

  it("brand=lark 使用 open.larksuite.com", async () => {
    const raw = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("tenant_access_token")) return jsonResponse({ code: 0, tenant_access_token: "t", expire: 7200 });
      return jsonResponse({ code: 0, data: { card_id: "c" } });
    });
    const client = new FeishuClient({ appId: "a", appSecret: "b", brand: "lark", fetchImpl: raw as unknown as typeof fetch });
    await client.cardkitCreate({});
    expect(String(raw.mock.calls[0]![0])).toContain("open.larksuite.com");
  });
});
