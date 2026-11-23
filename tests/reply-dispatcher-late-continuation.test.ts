/**
 * Tests for late-continuation delivery after the streaming card has sealed.
 *
 * Production 2026-11-23 (fnOS group): a background exec completion woke a
 * follow-up agent run AFTER the main reply's streaming card was finalized.
 * The late deliver() fell through to static text delivery and landed in the
 * group as a bare markdown message with no unified panel (reported as
 * "card overflow"). These tests pin the fix: late content routes through
 * sendMarkdownCardFeishu (fry card presentation), with text fallback on
 * send failure and unavailable-message guard passthrough.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../src/core/channel-message-compat', () => ({
  createReplyPrefixContext: () => ({
    responsePrefix: '',
    responsePrefixContextProvider: () => null,
    onModelSelected: () => {},
  }),
  createTypingCallbacks: () => ({
    onReplyStart: vi.fn().mockResolvedValue(undefined),
    onIdle: vi.fn().mockResolvedValue(undefined),
    onCleanup: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock('openclaw/plugin-sdk/channel-feedback', () => ({
  logTypingFailure: vi.fn(),
}));

vi.mock('../src/core/accounts', () => ({
  getLarkAccount: () => ({ config: {} }),
}));
vi.mock('../src/core/footer-config', () => ({
  resolveFooterConfig: () => null,
}));
vi.mock('../src/core/lark-client', () => ({
  LarkClient: {
    runtime: {
      channel: {
        text: {
          resolveTextChunkLimit: () => 4000,
          resolveChunkMode: () => 'paragraph',
          chunkTextWithMode: (text: string) => (text ? [text] : []),
        },
        reply: {
          createReplyDispatcherWithTyping: (hooks: { deliver: unknown; onError: unknown }) => ({
            dispatcher: { deliver: hooks.deliver, onError: hooks.onError },
            replyOptions: {},
            markDispatchIdle: () => {},
          }),
          resolveHumanDelayConfig: () => null,
        },
      },
    },
  },
}));
vi.mock('../src/core/lark-logger', () => ({
  larkLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockSendMessageFeishu = vi.fn();
const mockSendMarkdownCardFeishu = vi.fn();
vi.mock('../src/messaging/outbound/send', () => ({
  sendMessageFeishu: (...args: unknown[]) => mockSendMessageFeishu(...args),
  sendMarkdownCardFeishu: (...args: unknown[]) => mockSendMarkdownCardFeishu(...args),
}));

vi.mock('../src/messaging/outbound/typing', () => ({
  addTypingIndicator: vi.fn().mockResolvedValue(null),
  removeTypingIndicator: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/messaging/outbound/deliver', () => ({
  sendMediaLark: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/card/card-error', () => ({
  isCardTableLimitError: () => false,
}));
vi.mock('../src/card/reply-mode', () => ({
  resolveReplyMode: () => 'streaming',
  expandAutoMode: ({ mode }: { mode: string }) => mode,
  shouldUseCard: () => false,
}));

let terminateReturn = true;
const terminateCalls: Array<{ source: string; err: unknown }> = [];
vi.mock('../src/card/unavailable-guard', () => ({
  UnavailableGuard: class {
    shouldSkip() {
      return false;
    }
    terminate(source: string, err?: unknown) {
      terminateCalls.push({ source, err });
      return terminateReturn;
    }
    get isTerminated() {
      return false;
    }
  },
}));

import { createFeishuReplyDispatcher } from '../src/card/reply-dispatcher';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal streaming-controller stand-in with a settable phase. */
function makeController(phase: string, extra: Record<string, unknown> = {}) {
  const state = { aborted: false };
  return {
    currentPhase: phase,
    isTerminated: false,
    get isAborted() {
      return state.aborted;
    },
    set isAborted(v: boolean) {
      state.aborted = v;
    },
    cardMessageId: 'om_card',
    shouldSkipForUnavailable: () => false,
    terminateIfUnavailable: (source: string, err?: unknown) => {
      terminateCalls.push({ source, err });
      return terminateReturn;
    },
    ensureCardCreated: vi.fn().mockResolvedValue(undefined),
    onDeliver: vi.fn().mockResolvedValue(undefined),
    onReasoningStream: vi.fn().mockResolvedValue(undefined),
    onToolPayload: vi.fn().mockResolvedValue(undefined),
    onToolStart: vi.fn().mockResolvedValue(undefined),
    onPartialReply: vi.fn().mockResolvedValue(undefined),
    onIdle: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn().mockResolvedValue(undefined),
    markFullyComplete: () => {},
    abortCard: vi.fn().mockResolvedValue(undefined),
    ...extra,
  } as unknown as import('../src/card/streaming-card-controller').StreamingCardController;
}

interface TestContext {
  dispatcher: { deliver: (payload: Record<string, unknown>, meta?: { kind?: string }) => Promise<void> };
  sentText: unknown[];
  sentCards: unknown[];
}

function createDispatcher(controller: ReturnType<typeof makeController> | null): TestContext {
  const sentText: unknown[] = [];
  const sentCards: unknown[] = [];
  terminateReturn = true;
  terminateCalls.length = 0;

  mockSendMessageFeishu.mockImplementation(async (payload: unknown) => {
    sentText.push(payload);
  });
  mockSendMarkdownCardFeishu.mockImplementation(async (payload: unknown) => {
    sentCards.push(payload);
  });

  const result = createFeishuReplyDispatcher({
    cfg: {} as never,
    agentId: 'agent-test',
    sessionKey: 'session-test',
    chatId: 'chat-test',
    replyToMessageId: 'om_reply',
    accountId: 'default',
    replyInThread: false,
    chatType: 'group',
    skipTyping: true,
    toolUseDisplay: {
      mode: 'off',
      showToolUse: false,
      showToolResultDetails: false,
      showFullPaths: false,
    },
    // The real factory instantiates StreamingCardController itself; inject
    // our stand-in through the same constructor the factory calls. We do
    // this by pre-seeding the mocked class instance via the module mock —
    // but since vi.mock replaced the class with `{}`, we instead patch the
    // created controller on the factory result path below.
    ...(controller ? {} : {}),
  });

  // Replace the internally-created controller with our stand-in. The
  // factory closes over `controller` in deliver(); the only seam is the
  // mocked StreamingCardController class, so we reach into the result's
  // replyOptions callbacks which reference it. Instead, simplest: rebuild
  // with the class returning our instance.
  // (See the class mock below — it is re-bound per test via makeControllerClass.)
  void controller;
  return {
    dispatcher: result.dispatcher as unknown as TestContext['dispatcher'],
    sentText,
    sentCards,
  };
}

// The factory does `new StreamingCardController(deps)`. Our module mock must
// return the phase-configurable stand-in, so use a settable class.
let controllerInstance: ReturnType<typeof makeController> | null = null;
vi.mock('../src/card/streaming-card-controller', () => ({
  StreamingCardController: class {
    constructor() {
      return (controllerInstance ?? makeController('idle')) as unknown as object;
    }
  },
}));

function createDispatcherWithPhase(phase: string): TestContext {
  controllerInstance = makeController(phase);
  const ctx = createDispatcher(controllerInstance);
  return ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  terminateCalls.length = 0;
  terminateReturn = true;
});

describe('late continuation delivery after card sealed', () => {
  it('routes late answer text to sendMarkdownCardFeishu (fry card, not bare text)', async () => {
    const ctx = createDispatcherWithPhase('completed');

    await ctx.dispatcher.deliver({ text: '补个精确口径：Capy 归的是 oauth 类' });

    expect(ctx.sentCards).toHaveLength(1);
    expect((ctx.sentCards[0] as { text: string }).text).toBe('补个精确口径：Capy 归的是 oauth 类');
    expect(ctx.sentText).toHaveLength(0);
    expect((ctx.dispatcher as unknown as { shouldSkipForUnavailable?: unknown }).shouldSkipForUnavailable).toBeUndefined();
  });

  it('routes late reasoning-only payload to the fry card path too', async () => {
    const ctx = createDispatcherWithPhase('completed');

    await ctx.dispatcher.deliver({ text: '内部核对：registry category 是 oauth', isReasoning: true });

    expect(ctx.sentCards).toHaveLength(1);
    expect(ctx.sentText).toHaveLength(0);
  });

  it('does NOT intercept when the controller is still streaming (normal path)', async () => {
    const ctx = createDispatcherWithPhase('streaming');

    await ctx.dispatcher.deliver({ text: 'normal in-flight answer' });

    // Normal path delegates to controller.onDeliver — no static card send.
    expect(ctx.sentCards).toHaveLength(0);
    expect(ctx.sentText).toHaveLength(0);
    expect(controllerInstance!.onDeliver).toHaveBeenCalledTimes(1);
  });

  it('does NOT intercept when the card was aborted mid-run', async () => {
    const ctx = createDispatcherWithPhase('aborted');
    (controllerInstance as unknown as { isAborted: boolean }).isAborted = true;

    // isAborted → abort guard skips delivery entirely (existing behaviour).
    await ctx.dispatcher.deliver({ text: 'should be dropped' });

    expect(ctx.sentCards).toHaveLength(0);
    expect(ctx.sentText).toHaveLength(0);
    expect(controllerInstance!.onDeliver).not.toHaveBeenCalled();
  });

  it('falls back to plain text when the late card send fails (non-unavailable error)', async () => {
    const ctx = createDispatcherWithPhase('completed');
    terminateReturn = false;
    mockSendMarkdownCardFeishu.mockImplementation(async () => {
      throw new Error('card content rejected (230099)');
    });

    await ctx.dispatcher.deliver({ text: 'late content after failed card send' });

    // Card attempt was made, then text fallback rescued the content.
    expect(ctx.sentCards).toHaveLength(0);
    expect(ctx.sentText).toHaveLength(1);
    expect((ctx.sentText[0] as { text: string }).text).toBe('late content after failed card send');
  });

  it('does not send anything for a late empty payload', async () => {
    const ctx = createDispatcherWithPhase('completed');

    await ctx.dispatcher.deliver({ text: '   ' });

    expect(ctx.sentCards).toHaveLength(0);
    expect(ctx.sentText).toHaveLength(0);
  });
});
