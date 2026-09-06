import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MessageContext } from '../src/messaging/types';
import type { FeishuConfig, LarkAccount } from '../src/core/types';

vi.mock('../src/core/lark-logger', () => ({
  larkLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Observe the synthetic dispatch call without re-entering the inbound pipeline.
vi.mock('../src/messaging/inbound/synthetic-message', () => ({
  dispatchSyntheticTextMessage: vi.fn().mockResolvedValue('queued'),
}));

// Chat type + thread recovery are real dependencies of the handler now.
// Partial mocks: only override the one function each, keep other exports intact
// (chat-info-cache exposes injectLarkClient/clearChatInfoCache used elsewhere).
vi.mock('../src/core/chat-info-cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/chat-info-cache')>()),
  getChatInfo: vi.fn(),
}));
vi.mock('../src/messaging/shared/message-lookup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/messaging/shared/message-lookup')>()),
  getMessageFeishu: vi.fn().mockResolvedValue(null),
}));

// Other card handlers mocked so the "falls through" case is observable.
vi.mock('../src/tools/ask-user-question', () => ({
  handleAskUserAction: vi.fn().mockReturnValue(undefined),
}));
vi.mock('../src/tools/auto-auth', () => ({
  handleCardAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/channel/interactive-dispatch', () => ({
  dispatchFeishuPluginInteractiveHandler: vi.fn().mockResolvedValue(undefined),
}));

import { handleCardActionEvent } from '../src/channel/event-handlers';
import { dispatchSyntheticTextMessage } from '../src/messaging/inbound/synthetic-message';
import { dispatchFeishuPluginInteractiveHandler } from '../src/channel/interactive-dispatch';
import { getChatInfo } from '../src/core/chat-info-cache';
import { getMessageFeishu } from '../src/messaging/shared/message-lookup';
import { checkMessageGate } from '../src/messaging/inbound/gate';
import { setLarkRuntime } from '../src/core/runtime-store';

function makeCtx() {
  return {
    cfg: {} as any,
    accountId: 'account-a',
    runtime: { log: vi.fn(), error: vi.fn() },
  } as any;
}

// The dispatch runs inside setImmediate AND awaits chat-info/message-lookup;
// flush a few macrotasks so those promises settle before asserting.
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMessageFeishu).mockResolvedValue(null);
});

describe('handleCardActionEvent — inject_prompt (handler boundary)', () => {
  it('resolves a group chat type and thread, and runs the real gate (cardActionGate)', async () => {
    vi.mocked(getChatInfo).mockResolvedValue({ chatMode: 'topic' } as any);
    vi.mocked(getMessageFeishu).mockResolvedValue({ threadId: 'omt_thread_1' } as any);

    const response = await handleCardActionEvent(makeCtx(), {
      operator: { open_id: 'ou_sender' },
      open_chat_id: 'oc_group',
      open_message_id: 'om_card',
      event_id: 'evt_1',
      action: { value: { action: 'inject_prompt', prompt: '帮我总结群' } },
    });

    expect(response).toEqual({ toast: { type: 'info', content: '收到，正在为你处理…' } });
    await flush();

    expect(dispatchSyntheticTextMessage).toHaveBeenCalledTimes(1);
    expect(dispatchSyntheticTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'oc_group',
        senderOpenId: 'ou_sender',
        text: '帮我总结群',
        chatType: 'group', // Problem 1: not hardcoded p2p
        threadId: 'omt_thread_1', // Problem 1: recovered from the card message
        replyToMessageId: 'om_card',
        forceMention: false, // Problem 2: run the gate...
        cardActionGate: true, // ...with mention treated as satisfied
        syntheticMessageId: 'evt_1', // Problem 3: unique per click
      }),
    );
    expect(dispatchFeishuPluginInteractiveHandler).not.toHaveBeenCalled();
  });

  it('resolves a p2p chat type for a direct-chat card', async () => {
    vi.mocked(getChatInfo).mockResolvedValue({ chatMode: 'p2p' } as any);

    await handleCardActionEvent(makeCtx(), {
      operator: { open_id: 'ou_sender' },
      open_chat_id: 'oc_dm',
      open_message_id: 'om_card',
      action: { value: { action: 'inject_prompt', prompt: 'hi' } },
    });
    await flush();

    expect(dispatchSyntheticTextMessage).toHaveBeenCalledWith(expect.objectContaining({ chatType: 'p2p' }));
  });

  it('fails closed (no dispatch) when the chat type cannot be resolved', async () => {
    vi.mocked(getChatInfo).mockResolvedValue(undefined);

    const response = await handleCardActionEvent(makeCtx(), {
      operator: { open_id: 'ou_sender' },
      open_chat_id: 'oc_group',
      open_message_id: 'om_card',
      action: { value: { action: 'inject_prompt', prompt: 'hi' } },
    });
    // Toast still returned synchronously (Feishu 3s callback), but no dispatch.
    expect(response).toEqual({ toast: { type: 'info', content: '收到，正在为你处理…' } });
    await flush();
    expect(dispatchSyntheticTextMessage).not.toHaveBeenCalled();
  });

  it('two clicks on the same card get distinct synthetic ids (both dispatch)', async () => {
    vi.mocked(getChatInfo).mockResolvedValue({ chatMode: 'p2p' } as any);

    const base = {
      operator: { open_id: 'ou_sender' },
      open_chat_id: 'oc_dm',
      open_message_id: 'om_card', // SAME card
      action: { value: { action: 'inject_prompt', prompt: 'x' } },
    };
    await handleCardActionEvent(makeCtx(), { ...base, event_id: 'evt_A' });
    await handleCardActionEvent(makeCtx(), { ...base, event_id: 'evt_B' });
    await flush();

    expect(dispatchSyntheticTextMessage).toHaveBeenCalledTimes(2);
    const ids = vi
      .mocked(dispatchSyntheticTextMessage)
      .mock.calls.map((c) => (c[0] as { syntheticMessageId: string }).syntheticMessageId);
    expect(ids[0]).not.toEqual(ids[1]); // Problem 3: not a constant per card
  });

  it('falls back to a random synthetic id when event_id and token are absent', async () => {
    vi.mocked(getChatInfo).mockResolvedValue({ chatMode: 'p2p' } as any);

    await handleCardActionEvent(makeCtx(), {
      operator: { open_id: 'ou_sender' },
      open_chat_id: 'oc_dm',
      open_message_id: 'om_card',
      action: { value: { action: 'inject_prompt', prompt: 'x' } },
    });
    await flush();

    const id = vi.mocked(dispatchSyntheticTextMessage).mock.calls[0]?.[0]?.syntheticMessageId;
    expect(id).toBeTruthy();
    expect(id).not.toContain('om_card'); // not derived from the (shared) card id
  });

  it('fails closed (error toast, no dispatch) when only a Schema-2 user_id is present', async () => {
    vi.mocked(getChatInfo).mockResolvedValue({ chatMode: 'p2p' } as any);

    const response = await handleCardActionEvent(makeCtx(), {
      operator: { user_id: 'on_sender' }, // no open_id
      open_chat_id: 'oc_dm',
      open_message_id: 'om_card',
      action: { value: { action: 'inject_prompt', prompt: 'hi' } },
    });

    // Problem 4: a user_id must never be smuggled into an open_id field.
    expect(response).toEqual({ toast: { type: 'error', content: '无法处理该操作' } });
    await flush();
    expect(dispatchSyntheticTextMessage).not.toHaveBeenCalled();
    // Intercepted, not fallen through.
    expect(dispatchFeishuPluginInteractiveHandler).not.toHaveBeenCalled();
  });

  it('error toast when chat id is missing', async () => {
    const response = await handleCardActionEvent(makeCtx(), {
      operator: { open_id: 'ou_sender' },
      open_message_id: 'om_card',
      action: { value: { action: 'inject_prompt', prompt: 'hi' } },
    });
    expect(response).toEqual({ toast: { type: 'error', content: '无法处理该操作' } });
    await flush();
    expect(dispatchSyntheticTextMessage).not.toHaveBeenCalled();
  });

  it('non-inject_prompt action falls through to the plugin pipeline', async () => {
    await handleCardActionEvent(makeCtx(), {
      operator: { open_id: 'ou_sender' },
      open_chat_id: 'oc_dm',
      open_message_id: 'om_card',
      action: { value: { action: 'example_action.submit' } },
    });
    expect(dispatchSyntheticTextMessage).not.toHaveBeenCalled();
    expect(dispatchFeishuPluginInteractiveHandler).toHaveBeenCalledTimes(1);
  });

  it('blank / non-string prompt falls through', async () => {
    await handleCardActionEvent(makeCtx(), {
      operator: { open_id: 'ou_sender' },
      open_chat_id: 'oc_dm',
      open_message_id: 'om_card',
      action: { value: { action: 'inject_prompt', prompt: '   ' } },
    });
    await handleCardActionEvent(makeCtx(), {
      operator: { open_id: 'ou_sender' },
      open_chat_id: 'oc_dm',
      open_message_id: 'om_card',
      action: { value: { action: 'inject_prompt', prompt: 123 as unknown as string } },
    });
    expect(dispatchSyntheticTextMessage).not.toHaveBeenCalled();
    expect(dispatchFeishuPluginInteractiveHandler).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Gate integration: a card click satisfies the mention requirement but must
// still be subject to group admission + sender allowlists (Problem 2).
// Uses the real checkMessageGate (mirrors gate-bot-sender.test.ts).
// ---------------------------------------------------------------------------

beforeAll(() => {
  setLarkRuntime({
    channel: {
      groups: {
        resolveGroupPolicy: ({
          cfg,
          channel,
          groupId,
        }: {
          cfg: { channels?: Record<string, { groupPolicy?: string; groups?: Record<string, unknown> }> };
          channel: string;
          groupId?: string | null;
        }) => {
          const ch = cfg.channels?.[channel] ?? {};
          const groupPolicy = ch.groupPolicy;
          const groups = ch.groups ?? {};
          const hasGroups = Object.keys(groups).length > 0;
          if (groupPolicy === 'disabled') return { allowed: false, allowlistEnabled: true };
          if (hasGroups || groupPolicy === 'allowlist') {
            const allowed = Boolean(groups[groupId ?? ''] || groups['*']);
            return { allowed, allowlistEnabled: true };
          }
          return { allowed: true, allowlistEnabled: false };
        },
        resolveRequireMention: (): boolean => true,
      },
    },
  } as any);
});

function makeGateCtx(overrides: Partial<MessageContext> = {}): MessageContext {
  return {
    chatId: 'oc_1',
    messageId: 'msg_1',
    senderId: 'ou_user',
    chatType: 'group',
    content: 'hi',
    contentType: 'text',
    resources: [],
    mentions: [],
    mentionAll: false,
    senderIsBot: false,
    rawMessage: {} as never,
    rawSender: { sender_id: { open_id: 'ou_user' }, sender_type: 'user' },
    ...overrides,
  };
}

const gateAcct: LarkAccount = {
  accountId: 'a1',
  enabled: true,
  brand: 'feishu',
  configured: true,
  appId: 'cli_x',
  appSecret: 's',
  config: {} as FeishuConfig,
};

describe('checkMessageGate — mentionSatisfied (card action)', () => {
  it('an unmentioned group message is dropped for no_mention', async () => {
    const r = await checkMessageGate({
      ctx: makeGateCtx(),
      accountFeishuCfg: {} as FeishuConfig,
      account: gateAcct,
      accountScopedCfg: { channels: { feishu: {} } } as never,
      log: () => {},
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('no_mention');
  });

  it('mentionSatisfied lets the same unmentioned click through', async () => {
    const r = await checkMessageGate({
      ctx: makeGateCtx(),
      accountFeishuCfg: {} as FeishuConfig,
      account: gateAcct,
      accountScopedCfg: { channels: { feishu: {} } } as never,
      log: () => {},
      mentionSatisfied: true,
    });
    expect(r.allowed).toBe(true);
  });

  it('mentionSatisfied does NOT bypass group admission — disabled group still rejected', async () => {
    const r = await checkMessageGate({
      ctx: makeGateCtx(),
      accountFeishuCfg: {} as FeishuConfig,
      account: gateAcct,
      accountScopedCfg: { channels: { feishu: { groupPolicy: 'disabled' } } } as never,
      log: () => {},
      mentionSatisfied: true,
    });
    expect(r.allowed).toBe(false);
  });
});
