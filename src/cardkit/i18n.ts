/** 飞书卡片 i18n — 中英双语文本映射（移植自 hermes-fry-cards cardkit/i18n.py）。 */

export const LOCALES = ["zh_cn", "en_us"] as const;

export type LocaleText = { content: string; i18n_content: { zh_cn: string; en_us: string } };

/** [en, zh] */
const T: Record<string, readonly [string, string]> = {
  status_completed: ["✅ Completed", "✅ 已完成"],
  status_error: ["❌ Error", "❌ 出错"],
  status_stopped: ["🛑 Stopped", "🛑 已停止"],
  elapsed: ["Elapsed {}", "耗时 {}"],
  context: ["Context {}", "上下文 {}"],
  processing: ["Processing...", "处理中..."],
  processing_prefix: ["💭 Processing...", "💭 处理中..."],
  tool_use: ["Tool use", "工具执行"],
  tool_pending: ["🛠️ Tool use pending", "🛠️ 等待工具执行"],
  steps: ["{} step{}", "{} 步"],
  thought: ["Thought", "思考"],
  thinking_panel: ["Thinking", "思考中"],
  thought_for: ["Thought for {}", "思考了 {}"],
  done: ["Done.", "完成。"],
};

/** 构造 CardKit i18n 文本对象：zh_cn / en_us 由飞书客户端语言自动切换。 */
export function i18n(en: string, zh: string): LocaleText {
  return { content: en, i18n_content: { zh_cn: zh, en_us: en } };
}

/** 简写：t("processing") → i18n(...T["processing"])。 */
export function t(key: string): LocaleText {
  const p = pair(key);
  return i18n(p[0], p[1]);
}

/** 取原文对（用于需要在字符串里拼接的场景）。 */
export function pair(key: string): readonly [string, string] {
  const v = T[key];
  if (!v) throw new Error(`unknown i18n key: ${key}`);
  return v;
}
