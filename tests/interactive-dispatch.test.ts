import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPluginInteractiveHandlers, registerPluginInteractiveHandler } from 'openclaw/plugin-sdk/plugin-runtime';

vi.mock('../src/core/lark-logger', () => ({
  larkLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../src/messaging/outbound/send', () => ({
  sendCardFeishu: vi.fn(),
  sendMessageFeishu: vi.fn(),
  updateCardFeishu: vi.fn(),
}));

import { dispatchFeishuPluginInteractiveHandler } from '../src/channel/interactive-dispatch';

afterEach(() => {
  clearPluginInteractiveHandlers();
});

describe('dispatchFeishuPluginInteractiveHandler', () => {
  it('routes dot-form Feishu card actions to the registered dot namespace handler', async () => {
    const handler = vi.fn().mockReturnValue({ toast: { type: 'success', content: 'handler reached' } });
    registerPluginInteractiveHandler('example-plugin', {
      channel: 'feishu',
      namespace: 'example_action.submit',
      handler,
    });

    const response = await dispatchFeishuPluginInteractiveHandler({
      cfg: {} as any,
      accountId: 'account-a',
      data: {
        operator: { open_id: 'ou_sender' },
        open_chat_id: 'oc_chat',
        open_message_id: 'om_card',
        action: {
          value: {
            action: 'example_action.submit',
            item_id: 'ITEM-1',
          },
        },
      },
    });

    expect(response).toEqual({ toast: { type: 'success', content: 'handler reached' } });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'feishu',
        accountId: 'account-a',
        senderId: 'ou_sender',
        conversationId: 'oc_chat',
        messageId: 'om_card',
        namespace: 'example_action.submit',
        payload: '',
        action: 'example_action.submit',
      }),
    );
  });

  it('routes Feishu form submit by action.name when action.value is absent', async () => {
    const handler = vi.fn().mockReturnValue({ toast: { type: 'success', content: 'form handler reached' } });
    registerPluginInteractiveHandler('example-plugin', {
      channel: 'feishu',
      namespace: 'example_form.submit',
      handler,
    });

    const rawEvent = {
      operator: { open_id: 'ou_sender' },
      context: {
        open_chat_id: 'oc_chat',
        open_message_id: 'om_card',
      },
      action: {
        tag: 'button',
        name: 'example_form.submit',
        form_value: {
          field_a: 'alpha',
          field_b: 'beta',
        },
      },
    };

    const response = await dispatchFeishuPluginInteractiveHandler({
      cfg: {} as any,
      accountId: 'account-a',
      data: rawEvent,
    });

    expect(response).toEqual({ toast: { type: 'success', content: 'form handler reached' } });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'feishu',
        accountId: 'account-a',
        senderId: 'ou_sender',
        conversationId: 'oc_chat',
        messageId: 'om_card',
        namespace: 'example_form.submit',
        payload: '',
        action: 'example_form.submit',
        rawEvent,
      }),
    );
  });

  it('routes Feishu form_submit by form name when button action value and name are absent', async () => {
    const handler = vi.fn().mockReturnValue({ toast: { type: 'success', content: 'form submit handler reached' } });
    registerPluginInteractiveHandler('example-plugin', {
      channel: 'feishu',
      namespace: 'example_form.submit',
      handler,
    });

    const rawEvent = {
      operator: { open_id: 'ou_sender' },
      context: {
        open_chat_id: 'oc_chat',
        open_message_id: 'om_card',
      },
      action: {
        tag: 'form_submit',
        form_name: 'example_form.submit',
        form_value: {
          field_a: 'alpha',
          field_b: 'beta',
        },
      },
    };

    const response = await dispatchFeishuPluginInteractiveHandler({
      cfg: {} as any,
      accountId: 'account-a',
      data: rawEvent,
    });

    expect(response).toEqual({ toast: { type: 'success', content: 'form submit handler reached' } });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'feishu',
        accountId: 'account-a',
        senderId: 'ou_sender',
        conversationId: 'oc_chat',
        messageId: 'om_card',
        namespace: 'example_form.submit',
        payload: '',
        action: 'example_form.submit',
        rawEvent,
      }),
    );
  });
});
