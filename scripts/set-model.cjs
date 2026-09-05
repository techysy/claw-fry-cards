// 配置 10Router（OpenAI 兼容）为 OpenClaw 模型供应商并设为默认
// 用法: docker exec claw-gw node /tmp/set-model.cjs <model_id> [base_url] [api_key]
//   model_id 形如 "cbcn/glm-5.3-flash"；base_url/api_key 缺省读环境变量
const fs = require("fs");
const modelId = process.argv[2];
const baseUrl = process.argv[3] || process.env.ROUTER_BASE_URL;
const apiKey = process.argv[4] || process.env.ROUTER_API_KEY;
if (!modelId || !baseUrl || !apiKey) {
  console.error("用法: node set-model.cjs <model_id> <base_url> <api_key>");
  process.exit(1);
}
const p = "/home/node/.openclaw/openclaw.json";
const c = JSON.parse(fs.readFileSync(p, "utf8"));

c.models = c.models || {};
c.models.providers = c.models.providers || {};
c.models.providers["10router"] = c.models.providers["10router"] || {
  baseUrl,
  apiKey,
  api: "openai-completions",
  models: [],
};
const prov = c.models.providers["10router"];
prov.baseUrl = baseUrl;
prov.apiKey = apiKey;

if (!prov.models.some((m) => m.id === modelId)) {
  prov.models.push({
    id: modelId,
    name: modelId.split("/").pop() || modelId,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0 },
    contextWindow: 1000000,
    maxTokens: 48000,
  });
}

c.agents = c.agents || {};
c.agents.defaults = c.agents.defaults || {};
c.agents.defaults.model = { primary: `10router/${modelId}` };

fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log(`default model -> 10router/${modelId}`);
