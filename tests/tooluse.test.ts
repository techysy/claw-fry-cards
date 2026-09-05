import { describe, expect, it } from "vitest";
import { ToolUseTracker, redactInlineSecrets } from "../src/streaming/tooluse";

describe("ToolUseTracker", () => {
  it("start→end 记录成功步骤与耗时", () => {
    const tracker = new ToolUseTracker();
    tracker.recordStart("bash", "ls -la");
    tracker.recordEnd("bash", { durationMs: 1500 });
    const steps = tracker.buildDisplaySteps();
    expect(steps).toHaveLength(1);
    const s = steps[0]!;
    expect(s.name).toBe("bash");
    expect(s.status).toBe("success");
    expect(s.title).toBe("Run command (1.5 s)");
    expect(s.detail).toBe("ls -la");
    expect(s.icon).toBe("setting_outlined");
  });

  it("结束带 error → Failed 状态与 error_block", () => {
    const tracker = new ToolUseTracker();
    tracker.recordStart("read", "/tmp/a.txt");
    tracker.recordEnd("read", { error: "boom" });
    const s = tracker.buildDisplaySteps()[0]!;
    expect(s.status).toBe("error");
    expect(s.error_block?.content).toBe("boom");
    expect(s.title).toContain("Read");
  });

  it("无匹配 running 步骤时补一条记录", () => {
    const tracker = new ToolUseTracker();
    tracker.recordEnd("grep", { output: "hit" });
    const steps = tracker.buildDisplaySteps();
    expect(steps).toHaveLength(1);
    expect(steps[0]!.status).toBe("success");
  });

  it("未知工具名 humanize + 默认图标", () => {
    const tracker = new ToolUseTracker();
    tracker.recordStart("my_custom_tool", "");
    tracker.recordEnd("my_custom_tool", {});
    const s = tracker.buildDisplaySteps()[0]!;
    expect(s.title).toContain("My custom tool");
    expect(s.icon).toBe("setting-inter_outlined");
  });

  it("no_result 工具不渲染 result_block", () => {
    const tracker = new ToolUseTracker();
    tracker.recordStart("web_fetch", "https://example.com");
    tracker.recordEnd("web_fetch", { output: '{"ok":true}' });
    const s = tracker.buildDisplaySteps()[0]!;
    expect(s.result_block).toBeNull();
  });

  it("path sanitizer 只保留 basename", () => {
    const tracker = new ToolUseTracker();
    tracker.recordStart("read", "/home/user/secret-dir/file.txt");
    const s = tracker.buildDisplaySteps()[0]!;
    expect(s.detail).toBe("file.txt");
  });

  it("command sanitizer 脱敏内联密钥", () => {
    const tracker = new ToolUseTracker();
    tracker.recordStart("bash", "curl -H 'Authorization: Bearer sk-abc' https://x.com");
    const s = tracker.buildDisplaySteps()[0]!;
    expect(s.detail).not.toContain("sk-abc");
    expect(s.detail).toContain("[redacted]");
  });
});

describe("redactInlineSecrets", () => {
  it("脱敏 key=secret 形式", () => {
    expect(redactInlineSecrets("login api_key=sk-123 host=x")).toBe("login api_key=[redacted] host=x");
  });

  it("脱敏 Authorization header", () => {
    expect(redactInlineSecrets("curl -H 'Authorization: Bearer tok123'")).toContain("Authorization: Bearer [redacted]");
  });

  it("普通赋值不受影响", () => {
    expect(redactInlineSecrets("count=3 path=/tmp")).toContain("count=3");
  });
});
