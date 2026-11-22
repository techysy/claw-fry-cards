/**
 * Tests for the startup recovery of interrupted streaming cards
 * （重启后按 journal 把半路卡补终态）:
 *  - CardKit entry → close streaming + terminal update + journal removal
 *  - CardKit failure → im.message.patch fallback
 *  - IM-only entry (no card_id) → patch directly
 *  - stale entries dropped without API calls; failed entries kept for retry
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/core/lark-logger', () => ({
  larkLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../src/core/lark-client', () => ({ LarkClient: {} }));
vi.mock('../src/card/card-journal', () => ({
  loadStreamingCards: vi.fn(() => []),
  removeStreamingCard: vi.fn(),
  recordStreamingCard: vi.fn(),
  CARD_JOURNAL_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
}));
vi.mock('../src/card/cardkit', () => ({
  setCardStreamingMode: vi.fn(),
  updateCardKitCard: vi.fn(),
  createCardEntity: vi.fn(),
  sendCardByCardId: vi.fn(),
  streamCardContent: vi.fn(),
}));
vi.mock('../src/messaging/outbound/send', () => ({
  updateCardFeishu: vi.fn(),
  sendCardFeishu: vi.fn(),
  deleteMessageFeishu: vi.fn(),
}));

import { recoverInterruptedCards } from '../src/card/card-recovery';
import { loadStreamingCards, removeStreamingCard } from '../src/card/card-journal';
import { setCardStreamingMode, updateCardKitCard } from '../src/card/cardkit';
import { updateCardFeishu } from '../src/messaging/outbound/send';

const loadStreamingCardsMock = vi.mocked(loadStreamingCards);
const removeStreamingCardMock = vi.mocked(removeStreamingCard);
const setCardStreamingModeMock = vi.mocked(setCardStreamingMode);
const updateCardKitCardMock = vi.mocked(updateCardKitCard);
const updateCardFeishuMock = vi.mocked(updateCardFeishu);

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    cardKitCardId: 'cc_old' as string | null,
    cardMessageId: 'om_old',
    chatId: 'oc_chat',
    sessionKey: 'session',
    createdAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setCardStreamingModeMock.mockResolvedValue();
  updateCardKitCardMock.mockResolvedValue();
  updateCardFeishuMock.mockResolvedValue();
});

describe('recoverInterruptedCards', () => {
  it('no-ops without journal entries', async () => {
    loadStreamingCardsMock.mockReturnValue([]);
    await recoverInterruptedCards({ cfg: {} as never, accountId: 'main' });
    expect(setCardStreamingModeMock).not.toHaveBeenCalled();
    expect(updateCardFeishuMock).not.toHaveBeenCalled();
  });

  it('finalizes a CardKit entry with a large sequence base and removes it from the journal', async () => {
    loadStreamingCardsMock.mockReturnValue([makeEntry()]);
    await recoverInterruptedCards({ cfg: {} as never, accountId: 'main' });

    expect(setCardStreamingModeMock).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: 'cc_old', streamingMode: false, sequence: 2_000_000_000 }),
    );
    expect(updateCardKitCardMock).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: 'cc_old', sequence: 2_000_000_001 }),
    );
    expect(removeStreamingCardMock).toHaveBeenCalledWith('main', 'om_old');
  });

  it('falls back to im.message.patch when the CardKit finalize fails', async () => {
    loadStreamingCardsMock.mockReturnValue([makeEntry()]);
    setCardStreamingModeMock.mockRejectedValueOnce(new Error('card gone'));
    updateCardKitCardMock.mockRejectedValueOnce(new Error('card gone'));

    await recoverInterruptedCards({ cfg: {} as never, accountId: 'main' });

    expect(updateCardFeishuMock).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'om_old' }),
    );
    expect(removeStreamingCardMock).toHaveBeenCalledWith('main', 'om_old');
  });

  it('patches an IM-only entry directly (no card_id) without touching CardKit APIs', async () => {
    loadStreamingCardsMock.mockReturnValue([makeEntry({ cardKitCardId: null })]);
    await recoverInterruptedCards({ cfg: {} as never, accountId: 'main' });

    expect(setCardStreamingModeMock).not.toHaveBeenCalled();
    expect(updateCardKitCardMock).not.toHaveBeenCalled();
    expect(updateCardFeishuMock).toHaveBeenCalledTimes(1);
    expect(removeStreamingCardMock).toHaveBeenCalledWith('main', 'om_old');
  });

  it('drops stale entries (older than the max age) without any API calls', async () => {
    loadStreamingCardsMock.mockReturnValue([
      makeEntry({ createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000, cardMessageId: 'om_stale' }),
    ]);
    await recoverInterruptedCards({ cfg: {} as never, accountId: 'main' });

    expect(setCardStreamingModeMock).not.toHaveBeenCalled();
    expect(updateCardFeishuMock).not.toHaveBeenCalled();
    expect(removeStreamingCardMock).toHaveBeenCalledWith('main', 'om_stale');
  });

  it('keeps the journal entry when every finalize attempt fails (retry next startup)', async () => {
    loadStreamingCardsMock.mockReturnValue([makeEntry({ cardKitCardId: null })]);
    updateCardFeishuMock.mockRejectedValueOnce(new Error('network down'));

    await recoverInterruptedCards({ cfg: {} as never, accountId: 'main' });

    expect(removeStreamingCardMock).not.toHaveBeenCalled();
  });
});
