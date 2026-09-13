/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Channel-message SDK compat shim.
 *
 * `openclaw/plugin-sdk/channel-message` 导出路径在 OpenClaw 2026.5.4 宿主上
 * 不存在（2026.5.12 起才有）；同名函数在老宿主由 `plugin-sdk/channel-runtime`
 * 提供（8.x 又移除了该路径）——两条路径按宿主代际互补。
 *
 * 用 createRequire 同步解析（网关的插件加载器不支持顶层 await，禁止 TLA）；
 * 首次调用时解析并缓存，调用点零改动。
 */

import { createRequire } from 'node:module';

type ChannelMessageSdk = {
  createReplyPrefixContext: typeof import('openclaw/plugin-sdk/channel-message').createReplyPrefixContext;
  createTypingCallbacks: typeof import('openclaw/plugin-sdk/channel-message').createTypingCallbacks;
};

const requireSdk = createRequire(import.meta.url);

let cached: ChannelMessageSdk | null = null;

function resolveSdk(): ChannelMessageSdk {
  if (cached) return cached;
  try {
    cached = requireSdk('openclaw/plugin-sdk/channel-message') as ChannelMessageSdk;
  } catch {
    // 2026.5.4 宿主：channel-message 未导出，回落 channel-runtime（同名同签名）。
    // 指示符用变量绕开 TS 对字面量动态 require 的静态解析（8.1 类型表里无此路径）。
    const legacySpecifier = 'openclaw/plugin-sdk/channel-runtime';
    cached = requireSdk(legacySpecifier) as ChannelMessageSdk;
  }
  return cached;
}

export function createReplyPrefixContext(
  ...args: Parameters<ChannelMessageSdk['createReplyPrefixContext']>
): ReturnType<ChannelMessageSdk['createReplyPrefixContext']> {
  return resolveSdk().createReplyPrefixContext(...args);
}

export function createTypingCallbacks(
  ...args: Parameters<ChannelMessageSdk['createTypingCallbacks']>
): ReturnType<ChannelMessageSdk['createTypingCallbacks']> {
  return resolveSdk().createTypingCallbacks(...args);
}
