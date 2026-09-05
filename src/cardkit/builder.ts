/** CardKit v2.0 卡片构建器 — 🦞 小龙虾品牌（移植自 hermes-fry-cards cardkit/builder.py）。 */

import { i18n, pair, t, LOCALES, type LocaleText } from "./i18n";
import { downgradeTables, optimizeMarkdownStyle, splitLongText } from "./markdown";
import type { ToolDisplayStep } from "../streaming/tooluse";

export const STREAMING_ELEMENT_ID = "streaming_content";
export const REASONING_ELEMENT_ID = "reasoning_content";
export const REASONING_TEXT_ELEMENT_ID = "reasoning_text";
export const TOOL_PANEL_ELEMENT_ID = "tool_panel";
export const LOADING_ELEMENT_ID = "loading_icon";
/** 流式 loading 动图（与 fry-cards / 官方 openclaw-lark 同源，跨租户可用）。 */
export const DEFAULT_LOADING_IMG_KEY = "img_v3_02vb_496bec09-4b43-4773-ad6b-0cdd103cd2bg";

export type Card = Record<string, unknown>;

export function truncateModelName(name: string): string {
  if (!name) return name;
  const parts = name.split("/");
  return parts.length > 1 ? `⇲${parts[parts.length - 1]}` : name;
}

function collapsiblePanel(opts: {
  expanded: boolean;
  titleEl: LocaleText & { text_color?: string; text_size?: string };
  elements: unknown[];
  verticalSpacing?: string;
  iconPosition?: string;
}): Card {
  const iconEl: Card = {
    tag: "standard_icon",
    token: "down-small-ccm_outlined",
    size: "16px 16px",
  };
  if (opts.iconPosition !== "left") iconEl["color"] = "grey";
  return {
    tag: "collapsible_panel",
    expanded: opts.expanded,
    header: {
      title: opts.titleEl,
      vertical_align: "center",
      icon: iconEl,
      icon_position: opts.iconPosition ?? "right",
      icon_expanded_angle: -180,
    },
    border: { color: "grey", corner_radius: "5px" },
    vertical_spacing: opts.verticalSpacing ?? "4px",
    padding: "8px 8px 8px 8px",
    elements: opts.elements,
  };
}

function streamingElement(content = "", opts: { elementId?: string; textSize?: string } = {}): Card {
  return {
    tag: "markdown",
    content,
    text_align: "left",
    text_size: opts.textSize ?? "normal_v2",
    margin: "0px 0px 0px 0px",
    element_id: opts.elementId ?? STREAMING_ELEMENT_ID,
  };
}

const HEADER_STATES: Record<string, { template: string; i18nKey: string }> = {
  streaming: { template: "blue", i18nKey: "processing_prefix" },
  completed: { template: "green", i18nKey: "status_completed" },
  error: { template: "red", i18nKey: "status_error" },
  stopped: { template: "red", i18nKey: "status_stopped" },
};

export function buildHeader(status: string): Card {
  const cfg = HEADER_STATES[status] ?? HEADER_STATES.completed!;
  const [en, zh] = pair(cfg.i18nKey);
  return {
    title: { tag: "plain_text", ...i18n(en, zh) } as unknown as Card,
    template: cfg.template,
  };
}

function loadingElement(imgKey: string): Card {
  return {
    tag: "markdown",
    content: " ",
    icon: { tag: "custom_icon", img_key: imgKey, size: "16px 16px" },
    element_id: LOADING_ELEMENT_ID,
  };
}

export function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

export function buildToolPanel(
  steps: ToolDisplayStep[],
  elapsedMs = 0,
  opts: { expanded?: boolean; elementId?: string | null } = {},
): Card {
  const [enT, zhT] = pair("tool_use");
  const enParts: string[] = [enT];
  const zhParts: string[] = [zhT];
  if (steps.length) {
    const [tplEn, tplZh] = pair("steps");
    const suffixEn = steps.length > 1 ? "s" : "";
    enParts.push(tplEn.replace("{}", String(steps.length)).replace("{}", suffixEn));
    zhParts.push(tplZh.replace("{}", String(steps.length)).replace("{}", ""));
  }
  if (elapsedMs > 0) {
    enParts.push(`(${formatElapsed(elapsedMs)})`);
    zhParts.push(`(${formatElapsed(elapsedMs)})`);
  }

  const children: unknown[] = [];
  for (const s of steps) children.push(...buildToolStepElements(s));

  const panel = collapsiblePanel({
    expanded: opts.expanded ?? true,
    titleEl: {
      tag: "plain_text",
      ...i18n(`🔧 ${enParts.join(" · ")}`, `🔧 ${zhParts.join(" · ")}`),
      text_color: "grey",
      text_size: "notation",
    } as LocaleText & { tag: string; text_color: string; text_size: string },
    elements: children,
  });
  if (opts.elementId !== null) panel["element_id"] = opts.elementId ?? TOOL_PANEL_ELEMENT_ID;
  return panel;
}

function buildToolStepElements(step: ToolDisplayStep): unknown[] {
  const elements: unknown[] = [buildToolStepTitle(step)];
  const detail = buildToolStepDetail(step);
  if (detail) elements.push(detail);
  const output = buildToolStepOutput(step);
  if (output) elements.push(output);
  return elements;
}

function escapeMd(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/([`*_{}[\]<>])/g, "\\$1");
}

function toolStatusInfo(status: string): { label: string; color: string } {
  switch (status) {
    case "running":
      return { label: "Running", color: "turquoise" };
    case "success":
      return { label: "Succeeded", color: "green" };
    case "error":
      return { label: "Failed", color: "red" };
    default:
      return { label: status.charAt(0).toUpperCase() + status.slice(1), color: "grey" };
  }
}

function buildToolStepTitle(step: ToolDisplayStep): Card {
  const status = step.status ?? "running";
  const info = toolStatusInfo(status);
  const title = step.title || step.name || "tool";
  const content = `**${escapeMd(title)}** · <font color='${info.color}'>${info.label}</font>`;
  return {
    tag: "div",
    icon: { tag: "standard_icon", token: step.icon || "tool_02", color: "grey" },
    text: { tag: "lark_md", content, text_size: "notation" },
  };
}

function buildToolStepDetail(step: ToolDisplayStep): Card | null {
  const detail = (step.detail ?? "").trim();
  if (!detail) return null;
  return {
    tag: "div",
    margin: "0px 0px 0px 22px",
    text: { tag: "plain_text", content: detail, text_color: "grey", text_size: "notation" },
  };
}

function buildToolStepOutput(step: ToolDisplayStep): Card | null {
  const lines: string[] = [];
  if (step.error_block) {
    lines.push("**Error**");
    lines.push(step.error_block.fenced || fenced(step.error_block.content, step.error_block.language));
  } else if (step.result_block) {
    lines.push("**Result**");
    lines.push(step.result_block.fenced || fenced(step.result_block.content, step.result_block.language));
  }
  if (!lines.length) return null;
  return {
    tag: "div",
    margin: "0px 0px 0px 22px",
    text: { tag: "lark_md", content: lines.join("\n"), text_size: "notation" },
  };
}

function fenced(content: string, language: string): string {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  const longest = Math.max(0, ...Array.from(normalized.matchAll(/`+/g), (m) => m[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${normalized}\n${fence}`;
}

export function buildReasoningPanel(
  text: string,
  elapsedMs = 0,
  opts: { expanded?: boolean; elementId?: string | null; textElementId?: string | null } = {},
): Card {
  let enLabel: string;
  let zhLabel: string;
  if (elapsedMs > 0) {
    const d = formatElapsed(elapsedMs);
    [enLabel, zhLabel] = pair("thought_for");
    enLabel = enLabel.replace("{}", d);
    zhLabel = zhLabel.replace("{}", d);
  } else if (!text.trim()) {
    [enLabel, zhLabel] = pair("thinking_panel");
  } else {
    [enLabel, zhLabel] = pair("thought");
  }
  const panel = collapsiblePanel({
    expanded: opts.expanded ?? false,
    titleEl: {
      tag: "plain_text",
      ...i18n(`💭 ${enLabel}`, `💭 ${zhLabel}`),
      text_color: "grey",
      text_size: "notation",
    } as LocaleText & { tag: string; text_color: string; text_size: string },
    elements: [
      {
        tag: "markdown",
        content: text,
        text_size: "notation",
        ...(opts.textElementId ? { element_id: opts.textElementId } : {}),
      },
    ],
    verticalSpacing: "8px",
  });
  if (opts.elementId) panel["element_id"] = opts.elementId;
  return panel;
}

export function buildToolUsePendingPanel(): Card {
  const panel = collapsiblePanel({
    expanded: false,
    titleEl: {
      tag: "plain_text",
      ...t("tool_pending"),
      text_color: "grey",
      text_size: "notation",
    } as LocaleText & { tag: string; text_color: string; text_size: string },
    elements: [],
  });
  panel["element_id"] = TOOL_PANEL_ELEMENT_ID;
  return panel;
}

// ── 上下文显示 ────────────────────────────────────────────────────────────

const CONTEXT_BAR_STEPS = ["█", "▓", "▒", "░"] as const;

/** 渐变阴影进度条：███▓▒░░░（实心到空的密度渐变）。 */
export function contextProgressBar(used: number, total: number, width = 8): string {
  if (total <= 0) return "";
  const pct = Math.min((used / total) * 100, 100);
  const n = (pct / 100) * width;
  const cells: string[] = [];
  for (let i = 0; i < width; i++) {
    const pos = i + 0.5;
    if (pos <= n) {
      if (n - pos >= 0.5) cells.push("█");
      else if (n - pos >= 0.25) cells.push("▓");
      else cells.push("▒");
    } else if (pos - 1 <= n) {
      const frac = n - (pos - 1);
      if (frac > 0.66) cells.push("▓");
      else if (frac > 0.33) cells.push("▒");
      else cells.push("░");
    } else {
      cells.push("░");
    }
  }
  return cells.join("");
}

function compactNumber(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return m >= 100 ? `${Math.floor(m)}M` : `${m.toFixed(1)}M`;
  }
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/** 上下文纯文本，格式: 55.6k/1.0m (5%)。 */
export function contextText(used: number, total: number): string {
  if (total <= 0) return "";
  const pct = Math.min((used / total) * 100, 100);
  if (total >= 1_000_000) {
    const totalStr = `${(total / 1_000_000).toFixed(1)}m`;
    const usedStr = used < 1_000_000 ? `${(used / 1000).toFixed(1)}k` : `${(used / 1_000_000).toFixed(1)}m`;
    return `${usedStr}/${totalStr} (${pct.toFixed(0)}%)`;
  }
  if (total >= 1_000) return `${(used / 1000).toFixed(1)}k/${(total / 1000).toFixed(1)}k (${pct.toFixed(0)}%)`;
  return `${used}/${total} (${pct.toFixed(0)}%)`;
}

export function contextProgressWithText(used: number, total: number, width = 8): string {
  if (total <= 0) return "";
  const pct = Math.min((used / total) * 100, 100);
  const bar = contextProgressBar(used, total, width);
  let usedStr: string;
  let totalStr: string;
  if (total >= 1_000_000) {
    totalStr = `${(total / 1_000_000).toFixed(1)}m`;
    usedStr = used < 1_000_000 ? `${(used / 1000).toFixed(1)}k` : `${(used / 1_000_000).toFixed(1)}m`;
  } else if (total >= 1_000) {
    usedStr = `${(used / 1000).toFixed(1)}k`;
    totalStr = `${(total / 1000).toFixed(1)}k`;
  } else {
    usedStr = String(used);
    totalStr = String(total);
  }
  return `${usedStr}/${totalStr} [${bar}] ${pct.toFixed(0)}%`;
}

// ── footer ────────────────────────────────────────────────────────────────

export type FooterData = {
  duration?: number; // 秒
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  context_used?: number;
  context_max?: number;
};

function renderFooterField(
  name: string,
  data: FooterData,
  isError: boolean,
  isAborted: boolean,
  showLabel: boolean,
): readonly [string | null, string | null] {
  if (name === "status") {
    if (isError) return pair("status_error");
    if (isAborted) return pair("status_stopped");
    return pair("status_completed");
  }
  if (name === "elapsed") {
    const duration = data.duration ?? 0;
    if (typeof duration === "number" && duration > 0) {
      const val = formatElapsed(duration * 1000);
      if (showLabel) {
        const [en, zh] = pair("elapsed");
        return [en.replace("{}", val), zh.replace("{}", val)];
      }
      return [val, val];
    }
    return [null, null];
  }
  if (name === "model") {
    const v = data.model || null;
    return [v, v];
  }
  if (name === "tokens") {
    const inputT = data.input_tokens ?? 0;
    const outputT = data.output_tokens ?? 0;
    if (inputT || outputT) {
      const val = `↑ ${compactNumber(inputT)} ↓ ${compactNumber(outputT)}`;
      return [val, val];
    }
    return [null, null];
  }
  if (name === "context") {
    const used = data.context_used ?? 0;
    const maxC = data.context_max ?? 0;
    if (maxC) {
      const pct = Math.floor((used / maxC) * 100);
      const val = `${compactNumber(used)}/${compactNumber(maxC)} (${pct}%)`;
      if (showLabel) {
        const [en, zh] = pair("context");
        return [en.replace("{}", val), zh.replace("{}", val)];
      }
      return [val, val];
    }
    return [null, null];
  }
  return [null, null];
}

export function buildFooterElements(
  footerData: FooterData | null | undefined,
  isError = false,
  isAborted = false,
  opts: {
    fields?: string[][];
    showLabel?: boolean;
    textSize?: string;
  } = {},
): unknown[] {
  const fields = opts.fields ?? [["status", "elapsed", "context", "model"]];
  const data = footerData ?? {};
  const enLines: string[] = [];
  const zhLines: string[] = [];
  for (const row of fields) {
    const enParts: string[] = [];
    const zhParts: string[] = [];
    for (const field of row) {
      const [en, zh] = renderFooterField(field, data, isError, isAborted, opts.showLabel ?? false);
      if (en) {
        enParts.push(en);
        if (zh) zhParts.push(zh);
      }
    }
    if (enParts.length) {
      enLines.push(enParts.join(" · "));
      zhLines.push(zhParts.join(" · "));
    }
  }
  if (!enLines.length) return [];

  // 🦞 品牌前缀：短回复无统一面板时，footer 是卡片唯一的品牌标识
  let enContent = `🦞 ${enLines.join("\n")}`;
  let zhContent = `🦞 ${zhLines.join("\n")}`;
  if (isError) {
    enContent = `<font color='red'>${enContent}</font>`;
    zhContent = `<font color='red'>${zhContent}</font>`;
  }
  return [
    {
      tag: "markdown",
      content: enContent,
      i18n_content: { zh_cn: zhContent, en_us: enContent },
      text_size: opts.textSize ?? "notation",
    },
  ];
}

// ── 流式占位卡 ────────────────────────────────────────────────────────────

export type StreamingCardOptions = {
  toolSteps?: ToolDisplayStep[];
  elapsedMs?: number;
  showToolUse?: boolean;
  showStreamingElement?: boolean;
  headerEnabled?: boolean;
  textSize?: string;
  widthMode?: string;
  loadingImgKey?: string;
};

/** CardKit 2.0 流式占位卡片 — 工具面板合并到底部。 */
export function buildStreamingCardV2(opts: StreamingCardOptions = {}): Card {
  const elements: unknown[] = [];

  if (opts.showStreamingElement !== false) {
    elements.push(streamingElement("", { textSize: opts.textSize }));
  }
  // 工具面板放在底部（answer之后，loading之前）
  if (opts.showToolUse !== false) {
    if (opts.toolSteps?.length) {
      elements.push(buildToolPanel(opts.toolSteps, opts.elapsedMs ?? 0));
    } else {
      elements.push(buildToolUsePendingPanel());
    }
  }
  elements.push(loadingElement(opts.loadingImgKey || DEFAULT_LOADING_IMG_KEY));

  const card: Card = {
    schema: "2.0",
    config: {
      width_mode: opts.widthMode ?? "default",
      streaming_mode: true,
      streaming_config: {
        print_frequency_ms: { default: 15 },
        print_step: { default: 1 },
        print_strategy: "fast",
      },
      locales: LOCALES,
      summary: t("processing"),
    },
    body: { elements },
  };
  if (opts.headerEnabled) card["header"] = buildHeader("streaming");
  return card;
}

// ── 完成态卡（全量替换封卡） ──────────────────────────────────────────────

export type ReasoningRound = { text: string; elapsedMs: number; textElId?: string };

export type CompleteCardOptions = {
  answerText: string;
  reasoningRounds: ReasoningRound[];
  allToolSteps: ToolDisplayStep[];
  toolElapsedMs: number;
  footerData?: FooterData | null;
  isError?: boolean;
  isAborted?: boolean;
  footerFields?: string[][];
  footerShowLabel?: boolean;
  footerEnabled?: boolean;
  panelExpanded?: boolean;
  headerEnabled?: boolean;
  bodyTextSize?: string;
  showToolUse?: boolean;
  widthMode?: string;
  unifiedPanelMinDuration?: number;
  contextDisplayMode?: string;
  showContext?: boolean;
  truncateModel?: boolean;
};

/** 完成态卡片 — 推理+工具合并成底部统一面板（🦞 header），答案在上面。 */
export function buildCompleteCard(opts: CompleteCardOptions): Card {
  const {
    answerText,
    reasoningRounds,
    allToolSteps,
    toolElapsedMs,
    footerData,
    isError = false,
    isAborted = false,
    footerFields,
    footerShowLabel = true,
    footerEnabled = true,
    panelExpanded = false,
    headerEnabled = false,
    bodyTextSize = "normal_v2",
    showToolUse = true,
    widthMode = "default",
    unifiedPanelMinDuration = 5,
    contextDisplayMode = "text_bar",
    showContext = true,
    truncateModel = true,
  } = opts;

  const elements: unknown[] = [];

  // 模型名截断在源头统一生效（统一面板 header 与 footer 保持一致）
  const effectiveFooter: FooterData | null | undefined = footerData
    ? {
        ...footerData,
        model: footerData.model && truncateModel ? truncateModelName(footerData.model) : footerData.model,
      }
    : footerData;

  const content = downgradeTables(optimizeMarkdownStyle(answerText));
  for (const chunk of splitLongText(content)) {
    elements.push({ tag: "markdown", content: chunk, text_size: bodyTextSize });
  }

  // 推理+工具合并成底部一个统一面板（在答案之后、footer 之前）
  const panelDurationMs = (() => {
    const d = footerData?.duration;
    return typeof d === "number" && d > 0 ? d * 1000 : 0;
  })();
  const showUnifiedPanel =
    (reasoningRounds.length > 0 || allToolSteps.length > 0) &&
    showToolUse &&
    (allToolSteps.length > 0 || panelDurationMs >= unifiedPanelMinDuration * 1000);

  if (showUnifiedPanel) {
    const borderColor = isError ? "red" : isAborted ? "yellow" : "green";
    const unifiedChildren: unknown[] = [];
    reasoningRounds.forEach((rnd, i) => {
      if (!rnd.text.trim()) return;
      const textElId = rnd.textElId || `reasoning_text_${i}`;
      unifiedChildren.push(
        buildReasoningPanel(rnd.text, rnd.elapsedMs, {
          expanded: panelExpanded,
          textElementId: textElId,
        }),
      );
    });
    if (allToolSteps.length) {
      const toolPanel = buildToolPanel(allToolSteps, toolElapsedMs, { expanded: panelExpanded, elementId: null });
      if (Array.isArray(toolPanel["elements"])) unifiedChildren.push(...(toolPanel["elements"] as unknown[]));
    }
    // header: 🦞 model · 💭n · 🔧n · context · ⏱️ elapsed
    let modelName = effectiveFooter?.model ?? "";
    if (modelName && truncateModel && modelName.includes("/")) modelName = truncateModelName(modelName);
    const elapsedMs = toolElapsedMs || panelDurationMs;
    const elapsedStr = elapsedMs ? formatElapsed(elapsedMs) : "";
    const elapsedPart = elapsedStr ? ` · ⏱️ ${elapsedStr}` : "";
    let contextPart = "";
    const ctxUsed = effectiveFooter?.context_used ?? 0;
    const ctxMax = effectiveFooter?.context_max ?? 0;
    if (showContext && ctxUsed > 0 && ctxMax > 0) {
      if (contextDisplayMode === "text") {
        contextPart = ` · ${contextText(ctxUsed, ctxMax)}`;
      } else if (contextDisplayMode === "bar") {
        contextPart = ` · [${contextProgressBar(ctxUsed, ctxMax)}] ${Math.floor((ctxUsed / ctxMax) * 100)}%`;
      } else {
        contextPart = ` · ${contextProgressWithText(ctxUsed, ctxMax)}`;
      }
    }
    const headerText = `🦞 ${modelName} · 💭${reasoningRounds.length} · 🔧${allToolSteps.length}${contextPart}${elapsedPart}`;
    elements.push({
      tag: "collapsible_panel",
      expanded: panelExpanded,
      header: {
        title: { tag: "plain_text", content: headerText },
        text_color: "grey",
        text_size: "notation",
      },
      border: { color: borderColor, corner_radius: "5px" },
      elements: unifiedChildren,
    });
  }

  if (!answerText.trim()) {
    const [doneEn] = pair("done");
    elements.push({ tag: "markdown", content: doneEn, text_size: bodyTextSize });
  }

  // 统一面板 header 已包含 状态·模型·上下文·耗时，避免重复：有面板时不渲染 footer
  if (footerEnabled && !showUnifiedPanel) {
    elements.push(
      ...buildFooterElements(effectiveFooter, isError, isAborted, {
        fields: footerFields,
        showLabel: footerShowLabel,
      }),
    );
  }

  const summary = (answerText || "")
    .slice(0, 120)
    .replace(/\n/g, " ")
    .replace(/```/g, "")
    .trim();

  const card: Card = {
    schema: "2.0",
    config: {
      width_mode: widthMode,
      wide_screen_mode: true,
      update_multi: true,
      locales: LOCALES,
    },
  };
  if (summary) card["config"] = { ...(card["config"] as Card), summary: { content: summary } };
  card["body"] = { elements };
  if (headerEnabled) {
    card["header"] = buildHeader(isError ? "error" : isAborted ? "stopped" : "completed");
  }
  return card;
}
