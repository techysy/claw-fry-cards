/** 插件配置 — 从 api.pluginConfig 解析（openclaw.json → plugins.entries.claw-fry-cards.config）。 */

export type ClawConfig = {
  feishu: {
    brand: "feishu" | "lark";
    appId: string;
    appSecret: string;
  };
  chats: {
    allowlist: string[];
    blocklist: string[];
  };
  streaming: {
    headerEnabled: boolean;
    footerEnabled: boolean;
    footerFields: string[][];
    widthMode: string;
    bodyTextSize: string;
    flushIntervalMs: number;
    typewriterMaxMs: number;
    staleTimeoutSec: number;
  };
  display: {
    showToolUse: boolean;
    showContext: boolean;
    contextDisplayMode: string;
    truncateModelName: boolean;
    unifiedPanelMinDuration: number;
    cancelTextOnCard: boolean;
    loadingIconImgKey: string;
  };
};

const DEFAULT_FOOTER_FIELDS: string[][] = [["status", "elapsed", "context", "model"]];

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function fieldMatrix(v: unknown): string[][] {
  if (!Array.isArray(v)) return DEFAULT_FOOTER_FIELDS;
  const rows = v
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.filter((x): x is string => typeof x === "string"))
    .filter((row) => row.length > 0);
  return rows.length ? rows : DEFAULT_FOOTER_FIELDS;
}

export function parseConfig(raw: unknown): ClawConfig {
  const root = asRecord(raw);
  const feishu = asRecord(root.feishu);
  const chats = asRecord(root.chats);
  const streaming = asRecord(root.streaming);
  const display = asRecord(root.display);

  return {
    feishu: {
      brand: str(feishu.brand, "feishu") === "lark" ? "lark" : "feishu",
      appId: str(feishu.app_id),
      appSecret: str(feishu.app_secret),
    },
    chats: {
      allowlist: strArray(chats.allowlist),
      blocklist: strArray(chats.blocklist),
    },
    streaming: {
      headerEnabled: bool(streaming.header_enabled, false),
      footerEnabled: bool(streaming.footer_enabled, true),
      footerFields: fieldMatrix(streaming.footer_fields),
      widthMode: str(streaming.width_mode, "default"),
      bodyTextSize: str(streaming.body_text_size, "normal_v2"),
      flushIntervalMs: num(streaming.flush_interval_ms, 100),
      typewriterMaxMs: num(streaming.typewriter_max_ms, 3000),
      staleTimeoutSec: num(streaming.stale_timeout_sec, 900),
    },
    display: {
      showToolUse: bool(display.show_tool_use, true),
      showContext: bool(display.show_context, true),
      contextDisplayMode: str(display.context_display_mode, "text_bar"),
      truncateModelName: bool(display.truncate_model_name, true),
      unifiedPanelMinDuration: num(display.unified_panel_min_duration, 5),
      cancelTextOnCard: bool(display.cancel_text_on_card, true),
      loadingIconImgKey: str(display.loading_icon_img_key),
    },
  };
}
