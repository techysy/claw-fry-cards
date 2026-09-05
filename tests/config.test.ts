import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config";

describe("parseConfig", () => {
  it("空配置使用默认值", () => {
    const cfg = parseConfig(undefined);
    expect(cfg.feishu.brand).toBe("feishu");
    expect(cfg.streaming.flushIntervalMs).toBe(100);
    expect(cfg.display.showToolUse).toBe(true);
    expect(cfg.display.cancelTextOnCard).toBe(true);
    expect(cfg.streaming.footerFields).toEqual([["status", "elapsed", "context", "model"]]);
  });

  it("覆盖字段生效", () => {
    const cfg = parseConfig({
      feishu: { brand: "lark", app_id: "cli", app_secret: "sec" },
      streaming: { header_enabled: true, flush_interval_ms: 200, footer_fields: [["status"], ["model"]] },
      display: { show_tool_use: false, context_display_mode: "bar" },
      chats: { allowlist: ["oc_a"], blocklist: ["oc_b"] },
    });
    expect(cfg.feishu).toEqual({ brand: "lark", appId: "cli", appSecret: "sec" });
    expect(cfg.streaming.headerEnabled).toBe(true);
    expect(cfg.streaming.flushIntervalMs).toBe(200);
    expect(cfg.streaming.footerFields).toEqual([["status"], ["model"]]);
    expect(cfg.display.showToolUse).toBe(false);
    expect(cfg.display.contextDisplayMode).toBe("bar");
    expect(cfg.chats).toEqual({ allowlist: ["oc_a"], blocklist: ["oc_b"] });
  });

  it("类型不匹配时回落默认", () => {
    const cfg = parseConfig({ streaming: { flush_interval_ms: "fast" }, display: { show_tool_use: "yes" } });
    expect(cfg.streaming.flushIntervalMs).toBe(100);
    expect(cfg.display.showToolUse).toBe(true);
  });
});
