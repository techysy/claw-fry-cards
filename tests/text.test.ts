import { describe, expect, it } from "vitest";
import { extractThinkingContent, splitReasoningText, stripReasoningTags } from "../src/cardkit/text";

describe("splitReasoningText", () => {
  it("无标签 → 纯回答", () => {
    const out = splitReasoningText("答案正文");
    expect(out).toEqual({ answer_text: "答案正文" });
  });

  it("<thinking> 标签 → 推理 + 回答", () => {
    const out = splitReasoningText("<thinking>想一想</thinking>最终答案");
    expect(out.reasoning_text).toBe("想一想");
    expect(out.answer_text).toBe("最终答案");
  });

  it("<antthinking> 标签同样支持", () => {
    const out = splitReasoningText("<antthinking>推理</antthinking>A");
    expect(out.reasoning_text).toBe("推理");
    expect(out.answer_text).toBe("A");
  });

  it("Reasoning: 前缀", () => {
    const out = splitReasoningText("Reasoning:\n先想一下");
    expect(out.reasoning_text).toBe("先想一下");
    expect(out.answer_text).toBeUndefined();
  });

  it("未闭合标签 → 之后全部算推理", () => {
    const out = splitReasoningText("<thinking>开始想然后没结束");
    expect(out.reasoning_text).toBe("开始想然后没结束");
    expect(out.answer_text).toBeNull();
  });

  it("空文本返回空对象", () => {
    expect(splitReasoningText("")).toEqual({});
    expect(splitReasoningText(null)).toEqual({});
  });
});

describe("stripReasoningTags", () => {
  it("移除成对标签及内容", () => {
    expect(stripReasoningTags("<thinking>隐藏</thinking>可见")).toBe("可见");
  });

  it("无标签原样返回", () => {
    expect(stripReasoningTags("plain")).toBe("plain");
  });
});

describe("extractThinkingContent", () => {
  it("抽取标签之间的内容", () => {
    expect(extractThinkingContent("前置<thinking>内A</thinking>后置")).toBe("内A");
  });

  it("无标签返回空", () => {
    expect(extractThinkingContent("plain")).toBe("");
  });
});
