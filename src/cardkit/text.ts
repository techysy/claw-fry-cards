/** 流式文本解析 — reasoning 标签提取与最终回答清理（移植自 hermes-fry-cards streaming/text.py）。 */

export const REASONING_PREFIX = "Reasoning:\n";

const REASONING_TAG = "(?:think(?:ing)?|thought|antthinking)";
const REASONING_TAG_RE = new RegExp(`<\\s*(/?)\\s*${REASONING_TAG}\\s*>`, "gi");
const REASONING_OPEN_RE = new RegExp(`<\\s*${REASONING_TAG}\\s*>`, "gi");
const REASONING_CLOSE_RE = new RegExp(`<\\s*/\\s*${REASONING_TAG}\\s*>`, "gi");

export function splitReasoningText(text: string | null | undefined): {
  reasoning_text?: string | null;
  answer_text?: string | null;
} {
  if (typeof text !== "string" || !text.trim()) return {};
  const trimmed = text.trim();
  if (trimmed.startsWith(REASONING_PREFIX) && trimmed.length > REASONING_PREFIX.length) {
    return { reasoning_text: cleanReasoningPrefix(trimmed) };
  }
  const tagged = extractThinkingContent(text);
  const stripped = stripReasoningTags(text);
  if (!tagged && stripped === text) return { answer_text: text };
  return { reasoning_text: tagged || null, answer_text: stripped || null };
}

export function extractThinkingContent(text: string | null | undefined): string {
  if (!text) return "";
  let result = "";
  let lastIndex = 0;
  let inThinking = false;
  for (const match of text.matchAll(REASONING_TAG_RE)) {
    const idx = match.index ?? 0;
    if (inThinking) result += text.slice(lastIndex, idx);
    inThinking = match[1] !== "/";
    lastIndex = idx + match[0].length;
  }
  if (inThinking) result += text.slice(lastIndex);
  return result.trim();
}

export function stripReasoningTags(text: string | null | undefined): string {
  if (!text) return "";
  // 顺序很重要：先删成对块（含内容），再删未闭合的尾部，最后删游离标签。
  // 若先删裸标签，成对块的边界会被破坏，推理内容就会泄漏进回答。
  let result = text.replace(
    new RegExp(`<\\s*${REASONING_TAG}\\s*>[\\s\\S]*?<\\s*/\\s*${REASONING_TAG}\\s*>`, "gi"),
    "",
  );
  result = result.replace(new RegExp(`<\\s*${REASONING_TAG}\\s*>[\\s\\S]*$`, "i"), "");
  result = result
    .replace(REASONING_CLOSE_RE, "")
    .replace(REASONING_OPEN_RE, "");
  if (result.trim().startsWith(REASONING_PREFIX)) result = "";
  return result;
}

function cleanReasoningPrefix(text: string): string {
  const cleaned = text.replace(/^Reasoning:\s*/i, "");
  return cleaned
    .split("\n")
    .map((line) => (line.startsWith("_") && line.endsWith("_") ? line.replaceAll("_", "") : line))
    .join("\n")
    .trim();
}
