/** FeishuClient — lark-oapi 的 fetch 版替代（移植自 hermes-fry-cards feishu.py，CardKit 流式语义一一对应）。 */

const BASE_URLS: Record<string, string> = {
  feishu: "https://open.feishu.cn",
  lark: "https://open.larksuite.com",
};

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class FeishuAPIError extends Error {
  readonly code: number;
  readonly msg: string;

  constructor(message: string, code = 0, msg = "") {
    super(message);
    this.name = "FeishuAPIError";
    this.code = code;
    this.msg = msg;
  }

  /** 从 msg 中提取嵌套子错误码（格式: "Failed to create card content, ext=ErrCode: 11310; ..."）。 */
  extractSubCode(): number | null {
    const m = /ext=ErrCode:\s*(\d+)/.exec(this.msg);
    return m ? Number(m[1]) : null;
  }
}

export type FeishuClientConfig = {
  appId: string;
  appSecret: string;
  /** "feishu"（open.feishu.cn）或 "lark"（open.larksuite.com）。 */
  brand?: string;
  fetchImpl?: typeof fetch;
};

type ApiResult = { code?: number; msg?: string; data?: unknown } & Record<string, unknown>;

export class FeishuClient {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;
  private token: string | null = null;
  private tokenExpireAt = 0;
  private tokenPromise: Promise<string> | null = null;

  constructor(cfg: FeishuClientConfig) {
    if (!cfg.appId || !cfg.appSecret) {
      throw new FeishuAPIError("feishu app_id / app_secret is required");
    }
    this.appId = cfg.appId;
    this.appSecret = cfg.appSecret;
    this.baseUrl = BASE_URLS[cfg.brand ?? "feishu"] ?? BASE_URLS.feishu!;
    this.doFetch = cfg.fetchImpl ?? fetch;
  }

  private async token_(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpireAt) return this.token;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = (async () => {
      const resp = await this.doFetch(`${this.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
      });
      const json = (await resp.json()) as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
      if (json.code !== 0 || !json.tenant_access_token) {
        throw new FeishuAPIError(`tenant_access_token failed: ${json.code} ${json.msg ?? ""}`, json.code ?? -1, json.msg ?? "");
      }
      this.token = json.tenant_access_token;
      this.tokenExpireAt = Date.now() + (json.expire ?? 7200) * 1000 - TOKEN_REFRESH_MARGIN_MS;
      return this.token;
    })();
    try {
      return await this.tokenPromise;
    } finally {
      this.tokenPromise = null;
    }
  }

  private async call(path: string, body: unknown, operation: string, method = "POST"): Promise<ApiResult> {
    const token = await this.token_();
    let resp: Response;
    try {
      resp = await this.doFetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new FeishuAPIError(`${operation}: network error: ${String(err)}`);
    }
    let json: ApiResult;
    try {
      json = (await resp.json()) as ApiResult;
    } catch {
      throw new FeishuAPIError(`${operation}: invalid response (http ${resp.status})`, resp.status);
    }
    if ((json.code ?? 0) !== 0) {
      throw new FeishuAPIError(`${operation} failed: ${json.code} ${json.msg ?? ""}`, json.code ?? -1, json.msg ?? "");
    }
    return json;
  }

  /** 创建 CardKit 实体，返回 card_id。 */
  async cardkitCreate(card: unknown): Promise<string> {
    const json = await this.call(
      "/open-apis/cardkit/v1/cards",
      { type: "card_json", data: JSON.stringify(card) },
      "cardkit_create",
    );
    const data = json.data as { card_id?: string } | undefined;
    if (data?.card_id) return data.card_id;
    throw new FeishuAPIError("cardkit_create: response missing card_id");
  }

  /** 流式更新卡片内指定 element 的内容（打字机效果）。 */
  async cardkitStreamElement(cardId: string, elementId: string, content: string, sequence: number): Promise<void> {
    await this.call(
      `/open-apis/cardkit/v1/cards/${cardId}/elements/${elementId}/content`,
      { content, sequence },
      "cardkit_stream_element",
      "PUT",
    );
  }

  /** 全量更新 CardKit 卡片。 */
  async cardkitUpdate(cardId: string, card: unknown, sequence: number): Promise<void> {
    await this.call(
      `/open-apis/cardkit/v1/cards/${cardId}`,
      { card: { type: "card_json", data: JSON.stringify(card) }, sequence },
      "cardkit_update",
      "PUT",
    );
  }

  /** 局部更新 CardKit 卡片（增删改组件）。 */
  async cardkitBatchUpdate(cardId: string, actions: unknown[], sequence: number): Promise<void> {
    await this.call(
      `/open-apis/cardkit/v1/cards/${cardId}/batch_update`,
      { actions: JSON.stringify(actions), sequence },
      "cardkit_batch_update",
      "POST",
    );
  }

  /** 关闭 CardKit 卡片的流式模式。 */
  async cardkitCloseStreaming(cardId: string, sequence: number): Promise<void> {
    await this.call(
      `/open-apis/cardkit/v1/cards/${cardId}/settings`,
      { settings: JSON.stringify({ streaming_mode: false }), sequence },
      "cardkit_close_streaming",
      "PATCH",
    );
  }

  /** 以 card_id 实体发卡片消息到会话，返回 message_id。 */
  async sendCardEntityToChat(chatId: string, cardId: string): Promise<string> {
    const json = await this.call(
      "/open-apis/im/v1/messages?receive_id_type=chat_id",
      {
        receive_id: chatId,
        msg_type: "interactive",
        content: JSON.stringify({ type: "card", data: { card_id: cardId } }),
      },
      "send_card",
    );
    const data = json.data as { message_id?: string } | undefined;
    return data?.message_id ?? "";
  }

  /** 通过回复某条消息发送卡片实体（保证卡片落在正确的话题）。 */
  async replyCardById(messageId: string, cardId: string): Promise<string> {
    const json = await this.call(
      `/open-apis/im/v1/messages/${messageId}/reply`,
      { msg_type: "interactive", content: JSON.stringify({ type: "card", data: { card_id: cardId } }) },
      "reply_card",
    );
    const data = json.data as { message_id?: string } | undefined;
    return data?.message_id ?? "";
  }
}
