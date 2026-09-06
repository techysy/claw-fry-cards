import { describe, expect, it } from "vitest";
import {
  buildCompleteCard,
  buildHeader,
  buildStreamingCardV2,
  buildToolPanel,
  contextProgressBar,
  contextText,
  formatElapsed,
  truncateModelName,
} from "../src/cardkit/builder";
import type { ToolDisplayStep } from "../src/streaming/tooluse";

const steps: ToolDisplayStep[] = [
  {
    name: "bash",
    title: "Run command (1.0 s)",
    status: "success",
    detail: "ls",
    icon: "setting_outlined",
    elapsed_ms: 1000,
    result_block: null,
    error_block: null,
  },
];

describe("buildStreamingCardV2", () => {
  it("schema 2.0 + streaming_mode + 关键 element_id", () => {
    const card = buildStreamingCardV2({}) as Record<string, any>;
    expect(card.schema).toBe("2.0");
    expect(card.config.streaming_mode).toBe(true);
    expect(card.config.streaming_config.print_frequency_ms.default).toBe(15);
    const ids = card.body.elements.map((e: any) => e.element_id);
    expect(ids).toContain("streaming_content");
    expect(ids).toContain("tool_panel");
    expect(ids).toContain("loading_icon");
  });

  it("i18n summary 为处理中", () => {
    const card = buildStreamingCardV2({}) as Record<string, any>;
    expect(card.config.summary.i18n_content.zh_cn).toBe("处理中...");
  });

  it("show_tool_use=false 时不包含工具面板", () => {
    const card = buildStreamingCardV2({ showToolUse: false }) as Record<string, any>;
    const ids = card.body.elements.map((e: any) => e.element_id);
    expect(ids).not.toContain("tool_panel");
  });

  it("header_enabled 打开时 header 为蓝色处理中", () => {
    const card = buildStreamingCardV2({ headerEnabled: true }) as Record<string, any>;
    expect(card.header.template).toBe("blue");
    expect(card.header.title.i18n_content.zh_cn).toContain("处理中");
  });
});

describe("buildHeader", () => {
  it("状态 → 模板颜色", () => {
    expect(buildHeader("completed")).toMatchObject({ template: "green" });
    expect(buildHeader("error")).toMatchObject({ template: "red" });
    expect(buildHeader("stopped")).toMatchObject({ template: "red" });
    expect(buildHeader("streaming")).toMatchObject({ template: "blue" });
    expect(buildHeader("bogus")).toMatchObject({ template: "green" });
  });
});

describe("buildCompleteCard", () => {
  const base = {
    answerText: "最终答案",
    reasoningRounds: [{ text: "想一想", elapsedMs: 1200 }],
    allToolSteps: steps,
    toolElapsedMs: 1000,
    footerData: {
      duration: 45.2,
      model: "openai/gpt-5.4",
      input_tokens: 55600,
      output_tokens: 1200,
      context_used: 55600,
      context_max: 1_000_000,
    },
  };

  it("统一面板 header 含 🍤 模型 · 💭 · 🔧 · 上下文 · 耗时", () => {
    const card = buildCompleteCard(base) as Record<string, any>;
    const panel = card.body.elements.find(
      (e: any) => e.tag === "collapsible_panel",
    );
    expect(panel).toBeTruthy();
    const title: string = panel.header.title.content;
    expect(title).toContain("🍤 ⇲gpt-5.4");
    expect(title).toContain("💭1");
    expect(title).toContain("🔧1");
    expect(title).toContain("55.6k/1.0m");
    // 耗时优先用工具耗时（1.0s），无工具时回落 total duration
    expect(title).toContain("⏱️ 1.0s");
  });

  it("完成态边框为绿色，错误态为红色", () => {
    const ok = buildCompleteCard(base) as Record<string, any>;
    const panel = ok.body.elements.find((e: any) => e.tag === "collapsible_panel");
    expect(panel.border.color).toBe("green");

    const err = buildCompleteCard({ ...base, isError: true }) as Record<string, any>;
    const errPanel = err.body.elements.find((e: any) => e.tag === "collapsible_panel");
    expect(errPanel.border.color).toBe("red");
  });

  it("truncate_model_name=false 保留全名", () => {
    const card = buildCompleteCard({ ...base, truncateModel: false }) as Record<string, any>;
    const panel = card.body.elements.find((e: any) => e.tag === "collapsible_panel");
    expect(panel.header.title.content).toContain("openai/gpt-5.4");
  });

  it("bar 模式显示渐变进度条", () => {
    const card = buildCompleteCard({ ...base, contextDisplayMode: "bar" }) as Record<string, any>;
    const panel = card.body.elements.find((e: any) => e.tag === "collapsible_panel");
    expect(panel.header.title.content).toMatch(/· \[[█▓▒░]+\] \d+% ·/);
  });

  it("无答案时显示 Done 文案", () => {
    const card = buildCompleteCard({ ...base, answerText: "" }) as Record<string, any>;
    const texts = card.body.elements.map((e: any) => e.content);
    expect(texts).toContain("Done.");
  });

  it("有答案时不再追加 Done", () => {
    const card = buildCompleteCard(base) as Record<string, any>;
    const texts = card.body.elements.map((e: any) => e.content);
    expect(texts).not.toContain("Done.");
    expect(texts).toContain("最终答案");
  });

  it("短回复且无工具时不渲染统一面板", () => {
    const card = buildCompleteCard({
      ...base,
      allToolSteps: [],
      toolElapsedMs: 0,
      footerData: { duration: 1 },
      unifiedPanelMinDuration: 5,
    }) as Record<string, any>;
    expect(card.body.elements.find((e: any) => e.tag === "collapsible_panel")).toBeUndefined();
  });

  it("有统一面板时不渲染 footer（信息已在面板 header，防重复）", () => {
    const card = buildCompleteCard(base) as Record<string, any>;
    const footer = card.body.elements.at(-1);
    expect(footer.tag === "collapsible_panel" || !String(footer.content ?? "").includes("✅")).toBe(true);
  });

  it("无统一面板时 footer 显示状态与耗时", () => {
    const card = buildCompleteCard({
      ...base,
      reasoningRounds: [],
      allToolSteps: [],
      toolElapsedMs: 0,
      footerData: { duration: 8, model: "openai/gpt-5.4" },
      unifiedPanelMinDuration: 5,
    }) as Record<string, any>;
    const footer = card.body.elements.at(-1);
    expect(footer.tag).toBe("markdown");
    expect(footer.content).toContain("✅ Completed");
    expect(footer.content).toContain("8.0s");
  });
});

describe("buildToolPanel", () => {
  it("标题含工具数", () => {
    const panel = buildToolPanel(steps, 1000) as Record<string, any>;
    expect(panel.header.title.content).toContain("🔧 Tool use · 1 step");
    expect(panel.element_id).toBe("tool_panel");
  });

  it("空步骤时为 pending 文案", () => {
    const panel = buildToolPanel([], 0) as Record<string, any>;
    expect(panel.header.title.content).toBe("🔧 Tool use");
  });
});

describe("helpers", () => {
  it("truncateModelName", () => {
    expect(truncateModelName("openai/gpt-5.4")).toBe("⇲gpt-5.4");
    expect(truncateModelName("gpt-5.4")).toBe("gpt-5.4");
  });

  it("formatElapsed", () => {
    expect(formatElapsed(450)).toBe("0.5s");
    expect(formatElapsed(45200)).toBe("45.2s");
    expect(formatElapsed(125000)).toBe("2m 5s");
  });

  it("contextProgressBar 渐变", () => {
    // 0% 时边界格呈现 ▒（与 fry-cards 渐变实现一致的特性）
    expect(contextProgressBar(0, 100)).toBe("▒░░░░░░░");
    expect(contextProgressBar(100, 100)).toBe("████████");
    expect(contextProgressBar(50, 100)).toMatch(/^[█▓▒░]+$/);
  });

  it("contextText 格式", () => {
    expect(contextText(55600, 1_000_000)).toBe("55.6k/1.0m (6%)");
    expect(contextText(500, 1000)).toBe("0.5k/1.0k (50%)");
  });
});
