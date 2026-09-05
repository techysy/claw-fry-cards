// 写入飞书凭据到容器内的 openclaw.json（channels.feishu + plugins.entries.claw-fry-cards 两处）
// 用法: docker exec claw-gw node /tmp/write-creds.cjs <app_id> <app_secret>
const fs = require("fs");
const appId = process.argv[2];
const appSecret = process.argv[3];
if (!appId || !appSecret) {
  console.error("用法: node write-creds.cjs <app_id> <app_secret>");
  process.exit(1);
}
const p = "/home/node/.openclaw/openclaw.json";
const c = JSON.parse(fs.readFileSync(p, "utf8"));

c.channels = c.channels || {};
c.channels.feishu = {
  ...(c.channels.feishu || {}),
  enabled: true,
  domain: "feishu",
  connectionMode: "websocket",
  dmPolicy: "open",
  allowFrom: ["*"],
  groupPolicy: "open",
  groupAllowFrom: ["*"],
  requireMention: true,
  appId,
  appSecret,
};

c.plugins = c.plugins || {};
c.plugins.entries = c.plugins.entries || {};
c.plugins.entries.feishu = { ...(c.plugins.entries.feishu || {}), enabled: true };
c.plugins.entries["claw-fry-cards"] = c.plugins.entries["claw-fry-cards"] || { enabled: true };
c.plugins.entries["claw-fry-cards"].hooks = { allowConversationAccess: true };
c.plugins.entries["claw-fry-cards"].config = c.plugins.entries["claw-fry-cards"].config || {};
c.plugins.entries["claw-fry-cards"].config.feishu = {
  ...(c.plugins.entries["claw-fry-cards"].config.feishu || {}),
  brand: "feishu",
  app_id: appId,
  app_secret: appSecret,
};

fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log("credentials written: channels.feishu + plugins.entries.claw-fry-cards");
