const fs = require("fs");
const p = "/state/openclaw.json";
const c = JSON.parse(fs.readFileSync(p, "utf8"));

// panel 别名的正确位置：channels.feishu.panel（插件代码读取处）
const aliases = {
  "deepseek-v4-flash": {
    name: "梁文谷⚡️",
    timeAliases: [
      { days: "1-5", start: "09:00", end: "12:00", name: "梁文锋⚡️" },
      { days: "1-5", start: "14:00", end: "18:00", name: "梁文锋⚡️" },
    ],
  },
  "deepseek-v4-pro": {
    name: "梁文谷",
    timeAliases: [
      { days: "1-5", start: "09:00", end: "12:00", name: "梁文锋" },
      { days: "1-5", start: "14:00", end: "18:00", name: "梁文锋" },
    ],
  },
};

c.channels = c.channels || {};
c.channels.feishu = c.channels.feishu || {};
c.channels.feishu.panel = c.channels.feishu.panel || {};
c.channels.feishu.panel.unifiedPanelMinDuration = 5;
c.channels.feishu.panel.contextDisplayMode = "text_bar";
c.channels.feishu.panel.expanded = false;
c.channels.feishu.panel.modelAliases = aliases;

// 清掉误写入插件 config 的别名（manifest 校验拒绝）
const larkEntry = c.plugins?.entries?.["openclaw-lark"];
if (larkEntry?.config?.modelAliases) delete larkEntry.config.modelAliases;

fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log(
  "panel aliases at channels.feishu.panel:",
  JSON.stringify(Object.keys(c.channels.feishu.panel.modelAliases)),
  "| plugin config clean:",
  !larkEntry?.config?.modelAliases,
);
