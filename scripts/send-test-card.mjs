// 🦞 claw-fry-cards 端到端卡片验证 — 用真实飞书 API 发一张流式测试卡
// 用法（在能访问 open.feishu.cn 的环境里）:
//   FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx FEISHU_CHAT_ID=oc_xxx node send-test-card.mjs
const BASE = process.env.FEISHU_BASE_URL || "https://open.feishu.cn";
const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const CHAT_ID = process.env.FEISHU_CHAT_ID;
if (!APP_ID || !APP_SECRET || !CHAT_ID) {
  console.error("用法: FEISHU_APP_ID= FEISHU_APP_SECRET= FEISHU_CHAT_ID= node send-test-card.mjs");
  process.exit(1);
}
const LOADING_KEY = "img_v3_02vb_496bec09-4b43-4773-ad6b-0cdd103cd2bg";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function token() {
  const r = await fetch(`${BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`token: ${j.code} ${j.msg}`);
  return j.tenant_access_token;
}

async function api(tk, path, body, method = "POST") {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await r.text();
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    throw new Error(`${method} ${path}: http ${r.status} non-json: ${raw.slice(0, 120)}`);
  }
  if ((j.code ?? 0) !== 0) throw new Error(`${method} ${path}: ${j.code} ${j.msg}`);
  return j.data ?? {};
}

// 与 src/cardkit/builder.ts 同构的最小流式卡（折叠面板 title 带 tag: plain_text）
function streamingCard() {
  return {
    schema: "2.0",
    config: {
      width_mode: "default",
      streaming_mode: true,
      streaming_config: { print_frequency_ms: { default: 15 }, print_step: { default: 1 }, print_strategy: "fast" },
      locales: ["zh_cn", "en_us"],
      summary: { content: "Processing...", i18n_content: { zh_cn: "处理中...", en_us: "Processing..." } },
    },
    body: {
      elements: [
        { tag: "markdown", content: "", text_align: "left", text_size: "normal_v2", margin: "0px 0px 0px 0px", element_id: "streaming_content" },
        {
          tag: "collapsible_panel",
          expanded: true,
          header: {
            title: { tag: "plain_text", content: "🛠️ Tool use pending", i18n_content: { zh_cn: "🛠️ 等待工具执行", en_us: "🛠️ Tool use pending" }, text_color: "grey", text_size: "notation" },
            vertical_align: "center",
            icon: { tag: "standard_icon", token: "down-small-ccm_outlined", size: "16px 16px", color: "grey" },
            icon_position: "right",
            icon_expanded_angle: -180,
          },
          border: { color: "grey", corner_radius: "5px" },
          vertical_spacing: "4px",
          padding: "8px 8px 8px 8px",
          elements: [],
          element_id: "tool_panel",
        },
        { tag: "markdown", content: " ", icon: { tag: "custom_icon", img_key: LOADING_KEY, size: "16px 16px" }, element_id: "loading_icon" },
      ],
    },
  };
}

function completeCard() {
  return {
    schema: "2.0",
    config: { width_mode: "default", wide_screen_mode: true, update_multi: true, locales: ["zh_cn", "en_us"] },
    body: {
      elements: [
        { tag: "markdown", content: "这是 **claw-fry-cards** 的端到端测试卡 🦞\n\n- 卡片 schema 修复验证通过\n- 统一面板标题带 `tag: plain_text`\n- 上下文 `55.6k/1.0m [█░░░░░░░] 6%`", text_size: "normal_v2" },
        {
          tag: "collapsible_panel",
          expanded: false,
          header: { title: { tag: "plain_text", content: "🦞 ⇲glm-5.3-flash · 💭0 · 🔧1 · 55.6k/1.0m [█░░░░░░░] 6% · ⏱️ 2.1s" }, text_color: "grey", text_size: "notation" },
          border: { color: "green", corner_radius: "5px" },
          elements: [
            { tag: "div", icon: { tag: "standard_icon", token: "setting_outlined", color: "grey" }, text: { tag: "lark_md", content: "**Run command** · <font color='green'>Succeeded</font>", text_size: "notation" } },
            { tag: "div", margin: "0px 0px 0px 22px", text: { tag: "plain_text", content: "ls -la", text_color: "grey", text_size: "notation" } },
          ],
        },
      ],
    },
  };
}

const tk = await token();
console.log("token ok");

const cardId = (await api(tk, "/open-apis/cardkit/v1/cards", { type: "card_json", data: JSON.stringify(streamingCard()) })).card_id;
console.log("card created:", cardId);

let seq = 0;
await api(tk, `/open-apis/im/v1/messages?receive_id_type=chat_id`, {
  receive_id: CHAT_ID,
  msg_type: "interactive",
  content: JSON.stringify({ type: "card", data: { card_id: cardId } }),
});
console.log("sent to chat");

const text = "🦞 这条消息由 claw-fry-cards 测试脚本发送，验证流式卡片链路。";
for (let i = 4; i <= text.length; i += 6) {
  await api(tk, `/open-apis/cardkit/v1/cards/${cardId}/elements/streaming_content/content`, { content: text.slice(0, i), sequence: ++seq }, "PUT");
  await sleep(120);
}

await api(tk, `/open-apis/cardkit/v1/cards/${cardId}/settings`, { settings: JSON.stringify({ streaming_mode: false }), sequence: ++seq }, "PATCH");
await api(tk, `/open-apis/cardkit/v1/cards/${cardId}`, { card: { type: "card_json", data: JSON.stringify(completeCard()) }, sequence: ++seq }, "PUT");
console.log("sealed as complete card — ✅ end-to-end OK");
