/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Channel-message SDK compat shim.
 *
 * `openclaw/plugin-sdk/channel-message` 导出路径在 OpenClaw 2026.5.4 宿主上
 * 不存在（2026.5.12 起才有）；同名函数在老宿主由 `plugin-sdk/channel-runtime`
 * 提供。优先新路径，失败回落老路径，让插件兼容下限从 2026.5.12 下探到 2026.5.4。
 *
 * 顶层 await：importer 无需感知异步性，调用点零改动。
 */

type ChannelMessageSdk = typeof import('openclaw/plugin-sdk/channel-message');

let sdk: ChannelMessageSdk;

try {
  sdk = (await import('openclaw/plugin-sdk/channel-message')) as ChannelMessageSdk;
} catch {
  // 2026.5.4 宿主：channel-message 未导出，回落 channel-runtime（同名同签名）。
  // 8.x 宿主已移除 channel-runtime 导出，故本分支只在老宿主上被触发；
  // 指示符用变量绕开 TS/Vite 对字面量动态导入的静态解析（8.1 类型表里无此路径）。
  const legacySpecifier = 'openclaw/plugin-sdk/channel-runtime';
  sdk = (await import(/* @vite-ignore */ legacySpecifier)) as unknown as ChannelMessageSdk;
}

export const createReplyPrefixContext = sdk.createReplyPrefixContext;
export const createTypingCallbacks = sdk.createTypingCallbacks;
