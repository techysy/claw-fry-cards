/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Unit tests for reply-mode resolution across host config schema generations:
 *  - legacy boolean streaming (OpenClaw ≤2026.9.1 hosts)
 *  - object streaming `{ mode: "off" | "partial" }` (OpenClaw ≥2026.9.4 hosts,
 *    where the strict channel schema forbids the boolean and replyMode keys)
 */

import { describe, expect, it } from 'vitest';

import { resolveReplyMode } from '../src/card/reply-mode';
import { expandAutoMode, isStreamingEnabled } from '../src/card/reply-mode';
import type { FeishuConfig } from '../src/core/types';

const feishuCfg = (partial: object) => partial as FeishuConfig;

describe('isStreamingEnabled', () => {
  it('accepts legacy boolean true / false / unset', () => {
    expect(isStreamingEnabled(true)).toBe(true);
    expect(isStreamingEnabled(false)).toBe(false);
    expect(isStreamingEnabled(undefined)).toBe(false);
  });

  it('accepts 2026.9.4+ object form', () => {
    expect(isStreamingEnabled({ mode: 'partial' })).toBe(true);
    expect(isStreamingEnabled({ mode: 'off' })).toBe(false);
    expect(isStreamingEnabled({})).toBe(true);
  });
});

describe('resolveReplyMode with object-form streaming', () => {
  it('returns auto when streaming object enables streaming (no replyMode on 9.4 hosts)', () => {
    expect(
      resolveReplyMode({ feishuCfg: feishuCfg({ streaming: { mode: 'partial' } }), chatType: 'p2p' }),
    ).toBe('auto');
  });

  it('returns static when streaming object mode is off', () => {
    expect(
      resolveReplyMode({ feishuCfg: feishuCfg({ streaming: { mode: 'off' } }), chatType: 'p2p' }),
    ).toBe('static');
  });

  it('keeps legacy boolean gate working', () => {
    expect(resolveReplyMode({ feishuCfg: feishuCfg({ streaming: true }), chatType: 'p2p' })).toBe('auto');
    expect(resolveReplyMode({ feishuCfg: feishuCfg({ streaming: false }), chatType: 'p2p' })).toBe('static');
  });

  it('keeps legacy replyMode scene resolution when present (old hosts)', () => {
    expect(
      resolveReplyMode({
        feishuCfg: feishuCfg({
          streaming: true,
          replyMode: { default: 'streaming', group: 'static' },
        }),
        chatType: 'p2p',
      }),
    ).toBe('streaming');
    expect(
      resolveReplyMode({
        feishuCfg: feishuCfg({
          streaming: true,
          replyMode: { default: 'streaming', group: 'static' },
        }),
        chatType: 'group',
      }),
    ).toBe('static');
  });
});

describe('expandAutoMode with object-form streaming', () => {
  it('p2p → streaming, group → static when object streaming enabled', () => {
    const cfg = { mode: 'partial' } as const;
    expect(expandAutoMode({ mode: 'auto', streaming: cfg, chatType: 'p2p' })).toBe('streaming');
    expect(expandAutoMode({ mode: 'auto', streaming: cfg, chatType: 'group' })).toBe('static');
  });

  it('static when object streaming mode is off', () => {
    expect(
      expandAutoMode({ mode: 'auto', streaming: { mode: 'off' }, chatType: 'p2p' }),
    ).toBe('static');
  });
});
