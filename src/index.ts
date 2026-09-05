/** 🦞 claw-fry-cards — OpenClaw 插件入口。 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { ClawCardController, type Logger } from "./controller";
import { parseConfig } from "./config";
import { FeishuClient } from "./feishu";
import type { HookRegistrar } from "./types";

export default definePluginEntry({
  id: "claw-fry-cards",
  name: "Claw Fry Cards",
  description: "🦞 OpenClaw 飞书流式卡片（fry-cards 风格：实时工具进度 · 统一面板 · 打字机收尾）",
  register(api: OpenClawPluginApi) {
    const cfg = parseConfig(api.pluginConfig);
    const log: Logger = {
      debug: (msg, ...args) => api.logger.debug?.(`🦞 ${msg}`, ...args),
      info: (msg, ...args) => api.logger.info?.(`🦞 ${msg}`, ...args),
      warn: (msg, ...args) => api.logger.warn?.(`🦞 ${msg}`, ...args),
      error: (msg, ...args) => api.logger.error?.(`🦞 ${msg}`, ...args),
    };

    if (!cfg.feishu.appId || !cfg.feishu.appSecret) {
      log.warn(
        "config missing feishu.app_id / feishu.app_secret — claw-fry-cards idle. " +
          "Set plugins.entries.claw-fry-cards.config.feishu in openclaw.json",
      );
      return;
    }
    if (!cfg.display.cancelTextOnCard) {
      log.info("cancel_text_on_card=false → 卡片与官方通道文本回复同时投递");
    }

    let client: FeishuClient;
    try {
      client = new FeishuClient({
        appId: cfg.feishu.appId,
        appSecret: cfg.feishu.appSecret,
        brand: cfg.feishu.brand,
      });
    } catch (err) {
      log.error(`init failed: ${String(err)}`);
      return;
    }

    const controller = new ClawCardController(cfg, client, log);
    const registrar: HookRegistrar = api;

    registrar.on("message_received", (event, ctx) => controller.onMessageReceived(event, ctx));
    registrar.on("before_tool_call", (event, ctx) => controller.onBeforeToolCall(event, ctx));
    registrar.on("after_tool_call", (event, ctx) => controller.onAfterToolCall(event, ctx));
    registrar.on("llm_output", (event, ctx) => controller.onLlmOutput(event, ctx));
    registrar.on("message_sending", (event, ctx) => controller.onMessageSending(event, ctx));
    registrar.on("reply_payload_sending", (event, ctx) => controller.onReplyPayloadSending(event, ctx));
    registrar.on("agent_end", (event, ctx) => controller.onAgentEnd(event, ctx));
    registrar.on("gateway_stop", () => controller.dispose());

    log.info("claw-fry-cards registered — 等待飞书消息 🦞");
  },
});
