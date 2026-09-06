const fs = require("fs");
const p = "/home/node/.openclaw/openclaw.json";
const c = JSON.parse(fs.readFileSync(p, "utf8"));
const peak = [
  { days: "1-5", start: "09:00", end: "12:00", name: "梁文锋" },
  { days: "1-5", start: "14:00", end: "18:00", name: "梁文锋" },
];
const peakFlash = peak.map((r) => ({ ...r, name: r.name + "⚡️" }));
c.plugins.entries["openclaw-lark"].config = c.plugins.entries["openclaw-lark"].config || {};
c.plugins.entries["openclaw-lark"].config.modelAliases = {
  "deepseek-v4-flash": { name: "梁文谷⚡️", timeAliases: peakFlash },
  "deepseek-v4-pro": { name: "梁文谷", timeAliases: peak },
};
fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log(
  "aliases:",
  JSON.stringify(c.plugins.entries["openclaw-lark"].config.modelAliases["deepseek-v4-flash"].timeAliases[0]),
  "/ pro without emoji",
);
