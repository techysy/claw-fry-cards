/**
 * Tests for the silent-reply (NO_REPLY) placeholder-card recall:
 *
 * 「派发即建卡」让占位卡在 dispatch 一开始就已发出；agent 最终选择不回复
 * （NO_REPLY / 空回复）时，onIdle 必须撤回（recall）占位卡而不是灌
 * 'Done.' 兜底文案留一张空壳。撤回失败时回落原兜底文案路径保证收尾。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// streaming-card-controller has heavy infra imports — mock them all.
// cardkit / send / journal are mocked so assertions can inspect the calls.
vi.mock('openclaw/plugin-sdk/reply-runtime', () => ({ SILENT_REPLY_TOKEN: 'NO_REPLY' }));
vi.mock('../src/core/lark-logger', () => ({
  larkLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../src/core/lark-client', () => ({ LarkClient: {} }));
vi.mock('../src/core/shutdown-hooks', () => ({ registerShutdownHook: () => () => {} }));
vi.mock('../src/messaging/outbound/send', () => ({
  sendCardFeishu: vi.fn(),
  updateCardFeishu: vi.fn(),
  deleteMessageFeishu: vi.fn(),
}));
vi.mock('../src/card/cardkit', () => ({
  createCardEntity: vi.fn(),
  sendCardByCardId: vi.fn(),
  setCardStreamingMode: vi.fn(),
  streamCardContent: vi.fn(),
  updateCardKitCard: vi.fn(),
}));
vi.mock('../src/card/card-journal', () => ({
  recordStreamingCard: vi.fn(),
  removeStreamingCard: vi.fn(),
  loadStreamingCards: vi.fn(() => []),
  CARD_JOURNAL_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
}));
vi.mock('../src/card/flush-controller', () => ({
  FlushController: class {
    cancelPendingFlush() {}
    complete() {}
    waitForFlush() {
      return Promise.resolve();
    }
    setCardMessageReady() {}
    throttledUpdate() {
      return Promise.resolve();
    }
  },
}));
vi.mock('../src/card/image-resolver', () => ({
  ImageResolver: class {
    resolveImages(t: string) {
      return t;
    }
    resolveImagesAwait(t: string) {
      return Promise.resolve(t);
    }
  },
}));
vi.mock('../src/card/unavailable-guard', () => ({
  UnavailableGuard: class {
    shouldSkip() {
      return false;
    }
    terminate() {
      return false;
    }
    get isTerminated() {
      return false;
    }
  },
}));

import { deleteMessageFeishu } from '../src/messaging/outbound/send';
import { recordStreamingCard, removeStreamingCard } from '../src/card/card-journal';
import {
  createCardEntity,
  sendCardByCardId,
  setCardStreamingMode,
  streamCardContent,
  updateCardKitCard,
} from '../src/card/cardkit';
import { StreamingCardController } from '../src/card/streaming-card-controller';
import type { OpenClawConfig } from 'openclaw/plugin-sdk/core';
import type { ReplyPayload } from 'openclaw/plugin-sdk/core';

const createCardEntityMock = vi.mocked(createCardEntity);
const sendCardByCardIdMock = vi.mocked(sendCardByCardId);
const deleteMessageFeishuMock = vi.mocked(deleteMessageFeishu);
const updateCardKitCardMock = vi.mocked(updateCardKitCard);
const setCardStreamingModeMock = vi.mocked(setCardStreamingMode);
const streamCardContentMock = vi.mocked(streamCardContent);
const removeStreamingCardMock = vi.mocked(removeStreamingCard);
const recordStreamingCardMock = vi.mocked(recordStreamingCard);

function makeController(): StreamingCardController {
  return new StreamingCardController({
    cfg: {} as OpenClawConfig,
    agentId: 'agent',
    sessionKey: 'session-key',
    accountId: undefined,
    chatId: 'oc_test',
    replyToMessageId: undefined,
    replyInThread: undefined,
    toolUseDisplay: { mode: 'off', showToolUse: false, showFullPaths: false, showToolResultDetails: false },
    resolvedFooter: {
      status: false,
      elapsed: false,
      tokens: false,
      cache: false,
      context: false,
      model: false,
      provider: false,
    },
  });
}

async function createCard(controller: StreamingCardController): Promise<void> {
  createCardEntityMock.mockResolvedValue('cc_test');
  sendCardByCardIdMock.mockResolvedValue({ messageId: 'om_test', chatId: 'oc_test' });
  await controller.ensureCardCreated();
  expect(controller.cardMessageId).toBe('om_test');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('silent reply placeholder card recall', () => {
  it('recalls the placeholder card when the reply is NO_REPLY (no finalize card is sent)', async () => {
    const controller = makeController();
    await createCard(controller);
    controller.markFullyComplete();

    // NO_REPLY 前缀缓冲：accumulatedText 变为 NO_REPLY 且不触发卡片更新
    await controller.onPartialReply({ text: 'NO_REPLY' } as ReplyPayload);
    await controller.onIdle();

    expect(deleteMessageFeishuMock).toHaveBeenCalledTimes(1);
    expect(deleteMessageFeishuMock).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'om_test', accountId: undefined }),
    );
    // 撤回成功后不得再做任何终态更新（不留 'Done.' 空壳）
    expect(updateCardKitCardMock).not.toHaveBeenCalled();
    expect(setCardStreamingModeMock).not.toHaveBeenCalled();
    expect(streamCardContentMock).not.toHaveBeenCalled();
    // 终态时 journal 在途条目被移除
    expect(removeStreamingCardMock).toHaveBeenCalledWith(undefined, 'om_test');
  });

  it('recalls the placeholder card when the reply is completely empty', async () => {
    const controller = makeController();
    await createCard(controller);
    controller.markFullyComplete();

    // 无任何 deliver/partial（如 SDK 层静默吞掉回复）→ 空文本 → 撤回
    await controller.onIdle();

    expect(deleteMessageFeishuMock).toHaveBeenCalledTimes(1);
    expect(updateCardKitCardMock).not.toHaveBeenCalled();
  });

  it('falls back to the fallback-text finalize when the recall fails', async () => {
    const controller = makeController();
    await createCard(controller);
    controller.markFullyComplete();
    deleteMessageFeishuMock.mockRejectedValueOnce(new Error('insufficient permissions'));

    await controller.onIdle();

    // 撤回失败 → 回落兜底文案收尾，占位卡一定被置为终态
    expect(updateCardKitCardMock).toHaveBeenCalledTimes(1);
    expect(setCardStreamingModeMock).toHaveBeenCalledTimes(1);
  });

  it('does not recall when the reply has visible text (normal finalize)', async () => {
    const controller = makeController();
    await createCard(controller);
    controller.markFullyComplete();

    await controller.onDeliver({ text: '你好，这是正常回复' } as ReplyPayload);
    await controller.onIdle();

    expect(deleteMessageFeishuMock).not.toHaveBeenCalled();
    expect(updateCardKitCardMock).toHaveBeenCalledTimes(1);
  });

  it('records an in-flight journal entry when the card message is sent', async () => {
    const controller = makeController();
    await createCard(controller);

    expect(recordStreamingCardMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        cardKitCardId: 'cc_test',
        cardMessageId: 'om_test',
        chatId: 'oc_test',
        sessionKey: 'session-key',
      }),
    );
  });
});
