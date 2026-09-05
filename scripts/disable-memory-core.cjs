const fs = require("fs");
const p = "/home/node/.openclaw/openclaw.json";
const c = JSON.parse(fs.readFileSync(p, "utf8"));
c.plugins = c.plugins || {};
c.plugins.entries = c.plugins.entries || {};
// memory-core 每次会话更新都尝试调 openai 向量化并超时失败，拖慢回复；测试环境关闭
c.plugins.entries["memory-core"] = { enabled: false };
fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log("memory-core disabled");
