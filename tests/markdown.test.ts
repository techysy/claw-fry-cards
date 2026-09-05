import { describe, expect, it } from "vitest";
import { downgradeTables, optimizeMarkdownStyle, splitLongText, stripInvalidImageKeys } from "../src/cardkit/markdown";

describe("optimizeMarkdownStyle", () => {
  it("H1 降级为 H4、H2-H6 降级为 H5", () => {
    const md = "# Title\n## Sub\n### Three\n#### Four\nBody";
    const out = optimizeMarkdownStyle(md);
    expect(out).toContain("#### Title");
    expect(out).toContain("##### Sub");
    expect(out).toContain("##### Three");
    expect(out).toContain("##### Four");
    expect(out).not.toMatch(/^# /m);
  });

  it("代码块内的 # 不参与标题降级", () => {
    const md = "```bash\n# comment\n```";
    const out = optimizeMarkdownStyle(md);
    expect(out).toContain("# comment");
    expect(out).not.toContain("#### # comment");
  });

  it("压缩多余空行", () => {
    expect(optimizeMarkdownStyle("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("移除非 img_ 图片引用但保留 img_ 引用", () => {
    const md = "![remote](https://x.com/a.png)\n![local](img_v3_abc)";
    const out = optimizeMarkdownStyle(md);
    expect(out).not.toContain("https://x.com/a.png");
    expect(out).toContain("![local](img_v3_abc)");
  });
});

describe("stripInvalidImageKeys", () => {
  it("仅保留 img_ 前缀", () => {
    const md = "![a](img_v3_ok) ![b](http://x/y.png)";
    expect(stripInvalidImageKeys(md)).toBe("![a](img_v3_ok) ");
  });
});

describe("downgradeTables", () => {
  const table = "| a | b |\n|---|---|\n| 1 | 2 |";

  it("表格不超过上限时原样返回", () => {
    const md = `${table}\n\ntext`;
    expect(downgradeTables(md, 5)).toBe(md);
  });

  it("超限表格降级为代码块", () => {
    const md = Array.from({ length: 7 }, (_, i) => `t${i}\n\n${table}`).join("\n\n");
    const out = downgradeTables(md, 5);
    const fenced = out.match(/```\n\| a \| b \|/g)?.length ?? 0;
    expect(fenced).toBe(2);
  });
});

describe("splitLongText", () => {
  it("短文本不分块", () => {
    expect(splitLongText("hello")).toEqual(["hello"]);
  });

  it("超长文本按段落边界分块", () => {
    const para = "x".repeat(600);
    const text = Array.from({ length: 8 }, () => para).join("\n\n");
    const chunks = splitLongText(text, 2400);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(2400);
    expect(chunks.join("")).toContain(para);
  });
});
