/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Unit tests for Feishu credential overrides from the plugin's own config:
 * plugins.entries.claw-fry-cards.config.feishu 覆盖 channels.feishu 同名字段。
 */

import { describe, expect, it } from 'vitest';

import { getLarkAccount } from '../src/core/accounts';

const cfgWith = (channelsFeishu: object | undefined, pluginFeishu: object | undefined) => ({
  channels: channelsFeishu ? { feishu: channelsFeishu } : undefined,
  plugins: pluginFeishu
    ? { entries: { 'claw-fry-cards': { config: { feishu: pluginFeishu } } } }
    : undefined,
});

describe('plugin feishu credential overrides', () => {
  const base = { appId: 'cli_base', appSecret: 'base-secret', domain: 'feishu' } as const;

  it('plugin appId/appSecret override channels.feishu', () => {
    const acct = getLarkAccount(cfgWith(base, { appId: 'cli_override', appSecret: 'override-secret' }));
    expect(acct.appId).toBe('cli_override');
    expect(acct.appSecret).toBe('override-secret');
    // 未覆盖字段沿用 base
    expect(acct.config.domain).toBe('feishu');
    expect(acct.configured).toBe(true);
  });

  it('plugin overrides win even when channels.feishu is absent', () => {
    const acct = getLarkAccount(cfgWith(undefined, { appId: 'cli_only', appSecret: 'only-secret' }));
    expect(acct.appId).toBe('cli_only');
    expect(acct.appSecret).toBe('only-secret');
    expect(acct.configured).toBe(true);
  });

  it('empty/partial plugin config falls back to channels.feishu', () => {
    const acct = getLarkAccount(cfgWith(base, { appId: '' }));
    expect(acct.appId).toBe('cli_base');
    expect(acct.appSecret).toBe('base-secret');
  });

  it('no plugin config → channels.feishu untouched', () => {
    const acct = getLarkAccount(cfgWith(base, undefined));
    expect(acct.appId).toBe('cli_base');
    expect(acct.appSecret).toBe('base-secret');
  });

  it('domain/connectionMode overrides apply', () => {
    const acct = getLarkAccount(cfgWith(base, { domain: 'lark', connectionMode: 'webhook' }));
    expect(acct.config.domain).toBe('lark');
    expect(acct.config.connectionMode).toBe('webhook');
  });
});
