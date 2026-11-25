/**
 * Tests for the shutdown/abort-path hardening added after the 2026-11-25
 * group config hot-reload incident (在途卡被重载中止，只留裸 Aborted.):
 *
 * 治标（兜底终态）:
 *  - shutdown 变体 abortCard 写「配置更新中」提示 + 已流出正文，不再裸 'Aborted.'
 *  - 纯思考阶段被中止：卡面保留思考摘要 + 提示语（原实现只剩裸 Aborted.）
 *  - user-stop 变体（abort fast-path 默认）仍走简洁的已停止语义
 *
 * 治本（journal 收尾时机）:
 *  - 进 aborted/completed 终态时条目保留（不再立即移除）
 *  - 终态更新真正成功后才移除条目
 *  - 终态更新失败（异常）：条目留存，下次启动 recovery 可补
 *  - abortCard 收尾期间跳过 notifyCardInterrupted 兜底（无并发写卡）
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

import { updateCardFeishu } from '../src/messaging/outbound/send';
import { setCardStreamingMode, streamCardContent, updateCardKitCard } from '../src/card/cardkit';
import { recordStreamingCard, removeStreamingCard } from '../src/card/card-journal';
import { StreamingCardController } from '../src/card/streaming-card-controller';
import type { OpenClawConfig, ReplyPayload } from 'openclaw/plugin-sdk/core';

const updateCardKitCardMock = vi.mocked(updateCardKitCard);
const setCardStreamingModeMock = vi.mocked(setCardStreamingMode);
const streamCardContentMock = vi.mocked(streamCardContent);
const updateCardFeishuMock = vi.mocked(updateCardFeishu);
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
  vi.mocked(await import('../src/card/cardkit')).createCardEntity.mockResolvedValue('cc_test');
  vi.mocked(await import('../src/card/cardkit')).sendCardByCardId.mockResolvedValue({
    messageId: 'om_test',
    chatId: 'oc_test',
  });
  await controller.ensureCardCreated();
  expect(controller.cardMessageId).toBe('om_test');
}

function lastUpdateCard(): Record<string, unknown> {
  const call = updateCardKitCardMock.mock.calls.at(-1)?.[0];
  expect(call).toBeTruthy();
  return call!.card as unknown as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  updateCardKitCardMock.mockResolvedValue();
  setCardStreamingModeMock.mockResolvedValue();
  streamCardContentMock.mockResolvedValue();
  updateCardFeishuMock.mockResolvedValue();
});

describe('shutdown abort terminal copy (治标: 兜底终态)', () => {
  it('shutdown abort with partial text keeps the streamed answer and appends the reload notice', async () => {
    const controller = makeController();
    await createCard(controller);
    await controller.onPartialReply({ text: '已经查到一半的结果……' } as ReplyPayload);
    await controller.abortCard({ reason: 'shutdown' });

    const card = lastUpdateCard();
    const serialized = JSON.stringify(card);
    expect(serialized).toContain('已经查到一半的结果……');
    expect(serialized).toContain('配置更新中');
    expect(serialized).not.toContain('Aborted.');
  });

  it('shutdown abort during reasoning phase shows the reasoning snapshot instead of a bare Aborted.', async () => {
    const controller = makeController();
    await createCard(controller);
    await controller.onReasoningStream({ text: '正在推理第二个步骤……', isReasoning: true } as ReplyPayload);
    await controller.abortCard({ reason: 'shutdown' });

    const serialized = JSON.stringify(lastUpdateCard());
    expect(serialized).toContain('正在推理第二个步骤……');
    expect(serialized).toContain('配置更新中');
    expect(serialized).not.toContain('Aborted.');
  });

  it('user-stop abort (abort fast-path default) keeps the concise stopped copy', async () => {
    const controller = makeController();
    await createCard(controller);
    await controller.onPartialReply({ text: '部分回答' } as ReplyPayload);
    await controller.abortCard();

    const serialized = JSON.stringify(lastUpdateCard());
    expect(serialized).toContain('已按要求停止');
    expect(serialized).not.toContain('配置更新中');
  });
});

describe('journal removal timing (治本: 收尾时机)', () => {
  /** 等待 updateCardKitCard 被调用（abortCard 到达终态更新需跨多个微任务） */
  async function waitForUpdateCall(): Promise<void> {
    for (let i = 0; i < 200 && updateCardKitCardMock.mock.calls.length === 0; i++) {
      await Promise.resolve();
      if (i % 10 === 9) await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(updateCardKitCardMock.mock.calls.length).toBeGreaterThan(0);
  }

  it('keeps the journal entry when entering the aborted phase, removes it only after the update lands', async () => {
    const controller = makeController();
    await createCard(controller);
    // 卡创建时记了一条在途条目
    expect(recordStreamingCardMock).toHaveBeenCalled();

    // 挂起终态更新：transition 已发生但更新还没落卡
    let resolveUpdate: () => void = () => {};
    updateCardKitCardMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveUpdate = resolve)),
    );
    const aborting = controller.abortCard({ reason: 'shutdown' });
    await waitForUpdateCall();
    // 终态转换已完成但更新未落——journal 条目必须仍在
    expect(controller.isAborted).toBe(true);
    expect(removeStreamingCardMock).not.toHaveBeenCalled();

    resolveUpdate();
    await aborting;
    // 更新落定后才出条目
    expect(removeStreamingCardMock).toHaveBeenCalledWith(undefined, 'om_test');
  });

  it('keeps the journal entry when the terminal update fails (recovery can retry next startup)', async () => {
    const controller = makeController();
    await createCard(controller);
    updateCardKitCardMock.mockRejectedValueOnce(new Error('card gone'));
    setCardStreamingModeMock.mockRejectedValueOnce(new Error('card gone'));
    updateCardFeishuMock.mockRejectedValueOnce(new Error('card gone'));

    await controller.abortCard({ reason: 'shutdown' });

    // 全部更新路径失败：条目保留，留给 card-recovery
    expect(removeStreamingCardMock).not.toHaveBeenCalled();
  });

  it('skips the notifyCardInterrupted fallback while abortCard is finalizing (no concurrent writes)', async () => {
    const controller = makeController();
    await createCard(controller);
    updateCardKitCardMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => setTimeout(resolve, 20)),
    );

    await controller.abortCard({ reason: 'shutdown' });

    // abortCard 自身收尾：恰好一次关流式 + 一次终态更新，无兜底路径的额外写卡
    expect(setCardStreamingModeMock).toHaveBeenCalledTimes(1);
    expect(updateCardKitCardMock).toHaveBeenCalledTimes(1);
    expect(updateCardFeishuMock).not.toHaveBeenCalled();
  });

  it('performs exactly one terminal CardKit write across the whole abort lifecycle', async () => {
    const controller = makeController();
    await createCard(controller);
    let resolveUpdate: () => void = () => {};
    updateCardKitCardMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveUpdate = resolve)),
    );
    const aborting = controller.abortCard({ reason: 'shutdown' });
    await waitForUpdateCall();
    resolveUpdate();
    await aborting;
    // 整个生命周期内 CardKit 终态更新只发生一次（无兜底路径的并发双写）
    expect(updateCardKitCardMock).toHaveBeenCalledTimes(1);
  });
});
