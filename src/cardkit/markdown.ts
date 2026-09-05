/** Markdown 文本处理 — 标题降级、表格降级、图片 key 剥离、长文本分块（移植自 hermes-fry-cards cardkit/markdown.py）。 */

const MAX_CARD_TABLES = 5;
export const MAX_CHUNK_CHARS = 2400;

type TableMatch = { start: number; end: number; raw: string };

/** 查找代码块外的 markdown 表格。 */
export function findTablesOutsideCodeBlocks(text: string): TableMatch[] {
  const codeRanges: Array<[number, number]> = [];
  for (const m of text.matchAll(/```[\s\S]*?```/g)) {
    codeRanges.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  const inCode = (idx: number) => codeRanges.some(([s, e]) => s <= idx && idx < e);

  const results: TableMatch[] = [];
  const tableRe = /\|.+\|\n\|[-:| ]+\|[\s\S]*?(?=\n\n|\n(?!\|)|$)/g;
  for (const m of text.matchAll(tableRe)) {
    const start = m.index ?? 0;
    if (!inCode(start)) {
      results.push({ start, end: start + m[0].length, raw: m[0] });
    }
  }
  return results;
}

/** 超限表格降级为代码块（保留内容可见但飞书不渲染为表格元素）。 */
export function downgradeTables(text: string, limit: number = MAX_CARD_TABLES): string {
  const matches = findTablesOutsideCodeBlocks(text);
  if (matches.length <= limit) return text;
  let result = text;
  for (const { start, end, raw } of matches.slice(limit).reverse()) {
    result = result.slice(0, start) + `\`\`\`\n${raw}\n\`\`\`` + result.slice(end);
  }
  return result;
}

/** 移除非 img_ 前缀的图片引用。 */
export function stripInvalidImageKeys(text: string): string {
  if (!text.includes("![")) return text;
  return text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, _alt: string, target: string) =>
    target.startsWith("img_") ? match : "",
  );
}

/** 优化流式 Markdown 以适配飞书 CardKit 渲染：标题降级、压缩空行、剥离无效图片。 */
export function optimizeMarkdownStyle(text: string): string {
  try {
    // 1. 提取代码块用占位符保护
    const mark = "___CB_";
    const codeBlocks: string[] = [];
    let r = text.replace(/(^|\n)(`{3,})([^\n]*)\n[\s\S]*?\n\2(?=\n|$)/g, (match, prefix: string) => {
      const block = match.slice(prefix.length);
      codeBlocks.push(block);
      return `${prefix}${mark}${codeBlocks.length - 1}___`;
    });

    // 2. 标题降级（仅当存在 H1-H3 时）：H2-H6 → H5，H1 → H4
    if (/^#{1,3} /m.test(text)) {
      r = r.replace(/^#{2,6} (.+)$/gm, "##### $1");
      r = r.replace(/^# (.+)$/gm, "#### $1");
    }

    // 3. 还原代码块
    codeBlocks.forEach((block, i) => {
      r = r.replace(`${mark}${i}___`, block);
    });

    // 4. 压缩多余空行
    r = r.replace(/\n{3,}/g, "\n\n");

    // 5. 剥离无效图片 key
    return stripInvalidImageKeys(r);
  } catch {
    return text;
  }
}

/** 将超长文本按段落/换行拆分为多个不超过 limit 字符的块。 */
export function splitLongText(text: string, limit: number = MAX_CHUNK_CHARS): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest) {
    if (rest.length <= limit) {
      chunks.push(rest);
      break;
    }
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < limit / 2) cut = rest.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  return chunks;
}
