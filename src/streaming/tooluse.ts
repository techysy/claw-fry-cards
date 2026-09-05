/** 工具调用追踪与可视化（移植自 hermes-fry-cards streaming/tooluse.py）。 */

export type ToolStatus = "running" | "success" | "error";

export type ToolBlock = { language: string; content: string; fenced: string };

export type ToolDisplayStep = {
  name: string;
  title: string;
  status: ToolStatus;
  detail: string;
  icon: string;
  elapsed_ms: number;
  result_block: ToolBlock | null;
  error_block: ToolBlock | null;
};

type ToolStepInternal = {
  name: string;
  status: ToolStatus;
  detail: string;
  output: string;
  error: string;
  result_block: ToolBlock | null;
  error_block: ToolBlock | null;
  started_at: number;
  elapsed_ms: number;
};

type ToolDescriptor = {
  aliases: string[];
  icon: string;
  title: string;
  sanitizer?: "command" | "path" | "search" | "url";
  no_result?: boolean;
};

const SENSITIVE_NAME_RE = /token|secret|password|api[_-]?key|authorization|cookie|credential|bearer|session[_-]?id|client[_-]?secret|access[_-]?key/i;
const INLINE_ASSIGNMENT_RE = /(^|[\s"'`])([A-Za-z_][A-Za-z0-9_]*)(=(?:"[^"]*"|'[^']*'|[^\s"'`]+))/g;
const AUTH_HEADER_RE = /(Authorization\s*:\s*(?:Bearer|Basic|Token)\s+)([^'"\s]+)/gi;
const SECRET_FLAG_RE = /((?:^|[\s"'`])(--?[A-Za-z0-9][A-Za-z0-9-]*)(=|\s+)("(?:[^"]*)"|'(?:[^']*)'|[^\s"'`]+))/g;
const REMOTE_IMAGE_RE = /!\[[^\]]*\]\(https?:\/\/[^)]*\)/g;

/** 脱敏 key=secret、Authorization header、--flag secret 模式。 */
export function redactInlineSecrets(value: string): string {
  const redactAssign = (m: string, g1: string, key: string) =>
    SENSITIVE_NAME_RE.test(key) ? `${g1}${key}=[redacted]` : m;
  const redactFlag = (m: string, g1: string, flagWithDashes: string, sep: string) => {
    const flag = flagWithDashes.replace(/^-+/, "");
    return SENSITIVE_NAME_RE.test(flag) ? `${g1}${flagWithDashes}${sep}[redacted]` : m;
  };
  return value
    .replace(INLINE_ASSIGNMENT_RE, (m, g1: string, key: string) => redactAssign(m, g1, key))
    .replace(AUTH_HEADER_RE, "$1[redacted]")
    .replace(SECRET_FLAG_RE, (m, g1: string, flag: string, sep: string) => redactFlag(m, g1, flag, sep));
}

function basenameOnly(text: string): string {
  if (!text) return text;
  const cleaned = text.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = cleaned.lastIndexOf("/");
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

function redactPaths(text: string): string {
  return text.replace(
    /(^|[\s='"()])([~./][^\s'"()]+)/g,
    (_m, g1: string, path: string) => `${g1}${basenameOnly(path)}`,
  );
}

function sanitizeDetail(text: string, sanitizer?: ToolDescriptor["sanitizer"]): string {
  if (!text || !sanitizer) return text;
  let cleaned = text.replace(/<[^>]+>/g, "").trim();
  if (!cleaned) return text;
  if (sanitizer === "command") {
    cleaned = redactInlineSecrets(cleaned);
    return redactPaths(cleaned);
  }
  if (sanitizer === "path") {
    return basenameOnly(cleaned.replace(/^(?:from|file|path)\s+/i, "").trim());
  }
  if (sanitizer === "search") {
    return cleaned.replace(/^['"]|['"]$/g, "");
  }
  // url
  if (cleaned.toLowerCase().startsWith("from ")) {
    return cleaned.replace(/^['"]|['"]$/g, "").replace("from ", "");
  }
  return cleaned.replace(/^['"]|['"]$/g, "");
}

const TOOL_DESCRIPTORS: ToolDescriptor[] = [
  { aliases: ["skill"], icon: "app-default_outlined", title: "Load skill" },
  { aliases: ["read", "open"], icon: "file-link-text_outlined", title: "Read", sanitizer: "path", no_result: true },
  { aliases: ["write", "edit"], icon: "edit_outlined", title: "Edit", sanitizer: "path", no_result: true },
  { aliases: ["web_search", "web-search", "search"], icon: "search_outlined", title: "Search", sanitizer: "search" },
  {
    aliases: ["web_fetch", "web-fetch", "fetch"],
    icon: "language_outlined",
    title: "Fetch web page",
    sanitizer: "url",
    no_result: true,
  },
  { aliases: ["grep"], icon: "doc-search_outlined", title: "Search text", sanitizer: "search" },
  { aliases: ["glob"], icon: "folder_outlined", title: "Search files", sanitizer: "path" },
  { aliases: ["exec", "bash", "command", "run"], icon: "setting_outlined", title: "Run command", sanitizer: "command" },
  { aliases: ["browser", "playwright", "navigate"], icon: "browser-mac_outlined", title: "Browser", no_result: true },
  { aliases: ["agent", "task", "spawn"], icon: "robot_outlined", title: "Run sub-agent" },
  { aliases: ["check", "determine", "verify"], icon: "list-check_outlined", title: "Check" },
  { aliases: ["summarize", "analyze", "prepare"], icon: "report_outlined", title: "Analyze" },
  { aliases: ["clarify"], icon: "chat_outlined", title: "Clarify", no_result: true },
];

function resolveToolDescriptor(name: string | null | undefined): ToolDescriptor | undefined {
  if (!name) return undefined;
  const normalized = name.trim().toLowerCase().replace(/-/g, "_");
  for (const desc of TOOL_DESCRIPTORS) {
    for (const alias of desc.aliases) {
      if (normalized === alias || normalized.startsWith(`${alias}_`)) return desc;
    }
  }
  return undefined;
}

function humanizeToolName(name: string): string {
  const cleaned = name.replace(/-/g, " ").replace(/_/g, " ").trim();
  if (!cleaned) return "Tool";
  return cleaned[0]!.toUpperCase() + cleaned.slice(1);
}

function formatDurationLabel(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** 移除远程图片引用（CardKit 中是非法 image key）。 */
export function stripRemoteImages(text: string): string {
  return text.replace(REMOTE_IMAGE_RE, "");
}

function fencedBlock(language: string, content: string): ToolBlock {
  const longest = Math.max(0, ...Array.from(content.matchAll(/`+/g), (m) => m[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return { language, content, fenced: `${fence}${language}\n${content}\n${fence}` };
}

function buildDisplayBlock(value: unknown, fallbackLang: string, sanitizer?: ToolDescriptor["sanitizer"]): ToolBlock | null {
  if (value == null) return null;
  if (typeof value === "string") {
    let normalized = value.replace(/\r\n/g, "\n").trim();
    if (!normalized) return null;
    if (sanitizer === "command") normalized = redactInlineSecrets(normalized);
    if (normalized.includes("![") && normalized.includes("http")) {
      const stripped = stripRemoteImages(normalized);
      if (stripped !== normalized) {
        normalized = stripped.trim();
        if (!normalized) return null;
      }
    }
    if (normalized.startsWith("{") || normalized.startsWith("[")) {
      try {
        return fencedBlock("json", JSON.stringify(JSON.parse(normalized), null, 2));
      } catch {
        // 非 JSON 文本，回落普通文本块
      }
    }
    return fencedBlock(fallbackLang === "json" ? "text" : fallbackLang, normalized);
  }
  if (typeof value === "object") {
    try {
      return fencedBlock("json", JSON.stringify(value, null, 2));
    } catch {
      // 序列化失败回落字符串
    }
  }
  const normalized = String(value).trim();
  return normalized ? fencedBlock("text", normalized) : null;
}

export type DisplayParams = { detail?: string };

/** 追踪当前消息中的工具调用步骤，按 session 隔离。 */
export class ToolUseTracker {
  private steps: ToolStepInternal[] = [];
  private startedAt = 0;
  private readonly maxSteps: number;

  constructor(maxSteps = 128) {
    this.maxSteps = maxSteps;
  }

  get elapsed_ms(): number {
    if (!this.startedAt) return 0;
    return Date.now() - this.startedAt;
  }

  get isEmpty(): boolean {
    return this.steps.length === 0;
  }

  recordStart(name: string, detail = ""): void {
    if (!this.startedAt) this.startedAt = Date.now();
    if (this.steps.length >= this.maxSteps) return;
    this.steps.push({
      name,
      status: "running",
      detail,
      output: "",
      error: "",
      result_block: null,
      error_block: null,
      started_at: Date.now(),
      elapsed_ms: 0,
    });
  }

  /** 通过名字匹配最近的一个 running 步骤来结束。 */
  recordEnd(name: string, opts: { error?: string; output?: string; durationMs?: number } = {}): void {
    const { error = "", output = "" } = opts;
    const desc = resolveToolDescriptor(name);
    const sanitizer = desc?.sanitizer;
    for (let i = this.steps.length - 1; i >= 0; i--) {
      const step = this.steps[i]!;
      if (step.name === name && step.status === "running") {
        step.status = error ? "error" : "success";
        step.error = error;
        step.output = output;
        step.elapsed_ms = opts.durationMs ?? Date.now() - step.started_at;
        if (error) {
          step.error_block = buildDisplayBlock(error, "text", sanitizer);
        } else if (output) {
          step.result_block = buildDisplayBlock(output, "json", sanitizer);
        }
        return;
      }
    }
    // 无匹配的 running 步骤：补一条已完结记录
    this.steps.push({
      name,
      status: error ? "error" : "success",
      detail: error || output,
      output,
      error,
      started_at: Date.now(),
      elapsed_ms: opts.durationMs ?? 0,
      error_block: error ? buildDisplayBlock(error, "text", sanitizer) : null,
      result_block: output ? buildDisplayBlock(output, "json", sanitizer) : null,
    });
  }

  /** 构建用于卡片渲染的步骤列表。 */
  buildDisplaySteps(): ToolDisplayStep[] {
    return this.steps.map((s) => {
      const desc = resolveToolDescriptor(s.name);
      let baseTitle = desc ? desc.title : humanizeToolName(s.name);
      if (s.elapsed_ms > 0) baseTitle = `${baseTitle} (${formatDurationLabel(s.elapsed_ms)})`;
      return {
        name: s.name,
        title: baseTitle,
        status: s.status,
        detail: sanitizeDetail(s.detail, desc?.sanitizer),
        icon: desc ? desc.icon : "setting-inter_outlined",
        elapsed_ms: s.elapsed_ms,
        result_block: desc?.no_result ? null : s.result_block,
        error_block: s.error_block,
      };
    });
  }
}
