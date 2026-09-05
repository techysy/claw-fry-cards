import { describe, expect, it } from "vitest";
import { i18n, pair, t } from "../src/cardkit/i18n";

describe("i18n", () => {
  it("i18n 构造双语对象", () => {
    const obj = i18n("Hello", "你好");
    expect(obj.content).toBe("Hello");
    expect(obj.i18n_content).toEqual({ zh_cn: "你好", en_us: "Hello" });
  });

  it("t 返回已知 key 的双语对象", () => {
    const obj = t("processing");
    expect(obj.content).toBe("Processing...");
    expect(obj.i18n_content.zh_cn).toBe("处理中...");
  });

  it("t 未知 key 抛错", () => {
    expect(() => t("nope")).toThrow(/unknown i18n key/);
  });

  it("pair 返回 [en, zh] 原对", () => {
    expect(pair("status_completed")).toEqual(["✅ Completed", "✅ 已完成"]);
  });
});
