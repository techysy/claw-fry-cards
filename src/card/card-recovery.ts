/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * 重启后在途卡收尾：插件启动时读 journal，把上一个进程没来得及收尾的
 * 流式卡补成终态（终止流式 + 替换为中断说明卡），清掉飞书侧的僵尸卡。
 *
 * 优雅关机走 shutdown-hooks（abortCard 原卡收尾）与此互不影响——正常路径
 * 终态时 journal 条目已移除，这里读到条目就说明上一进程没走到终态。
 *
 * CardKit sequence 说明：card.settings / card.update 要求 sequence 严格递增，
 * 上一进程的计数器值已不可知，故 recovery 用 int32 上限附近的大基数起跳，
 * 保证必然大于任何正常流式计数（节流后每轮至多几百次）。
 */

import type { OpenClawConfig } from 'openclaw/plugin-sdk/core';
import { larkLogger } from '../core/lark-logger';
import { updateCardFeishu } from '../messaging/outbound/send';
import { buildCardContent, toCardKit2 } from './builder';
import { CARD_JOURNAL_MAX_AGE_MS, loadStreamingCards, removeStreamingCard } from './card-journal';
import { setCardStreamingMode, updateCardKitCard } from './cardkit';

const log = larkLogger('card/card-recovery');

/** recovery 起跳序列号（> 2^31 边界内，远大于正常流式计数器） */
const RECOVERY_SEQUENCE_BASE = 2_000_000_000;

const INTERRUPTED_NOTICE = '⚠️ 上一轮回复因机器人重启被中断，本轮无输出。可直接重发消息重新提问。';

export async function recoverInterruptedCards(params: {
  cfg: OpenClawConfig;
  accountId: string | undefined;
  log?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}): Promise<void> {
  const { cfg, accountId } = params;
  const runtimeLog = params.log ?? ((...args: unknown[]) => log.info(args.map(String).join(' ')));
  const runtimeError = params.error ?? ((...args: unknown[]) => log.error(args.map(String).join(' ')));

  const entries = loadStreamingCards(accountId);
  if (entries.length === 0) return;

  runtimeLog(
    `feishu[${accountId ?? 'default'}]: card-recovery: finalizing ${entries.length} interrupted streaming card(s) from previous run`,
  );

  let finalized = 0;
  let dropped = 0;
  const failed: Array<{ messageId: string; error: string }> = [];

  for (const entry of entries) {
    // 太老的条目直接清掉：飞书对陈旧卡片的更新大概率已不可用，留着只会每次启动重试
    if (Date.now() - entry.createdAt > CARD_JOURNAL_MAX_AGE_MS) {
      removeStreamingCard(accountId, entry.cardMessageId);
      dropped += 1;
      continue;
    }
    try {
      await finalizeInterruptedCard({ cfg, accountId, entry });
      removeStreamingCard(accountId, entry.cardMessageId);
      finalized += 1;
    } catch (err) {
      // 保留条目，下次启动重试（常见于启动瞬间 token 未就绪的瞬时失败）
      failed.push({ messageId: entry.cardMessageId, error: String(err) });
    }
  }

  runtimeLog(
    `feishu[${accountId ?? 'default'}]: card-recovery: finalized=${finalized}, dropped(stale)=${dropped}, failed=${failed.length}`,
  );
  for (const f of failed) {
    runtimeError(`feishu[${accountId ?? 'default'}]: card-recovery: finalize failed for ${f.messageId}: ${f.error}`);
  }
}

/** 把一张半路卡补成终态：CardKit 路径先关流式再整体替换；失败回落 im.message.patch */
async function finalizeInterruptedCard(params: {
  cfg: OpenClawConfig;
  accountId: string | undefined;
  entry: { cardKitCardId: string | null; cardMessageId: string };
}): Promise<void> {
  const { cfg, accountId, entry } = params;
  const terminalCard = buildCardContent('complete', {
    text: INTERRUPTED_NOTICE,
    showToolUse: false,
  });

  if (entry.cardKitCardId) {
    try {
      await setCardStreamingMode({
        cfg,
        cardId: entry.cardKitCardId,
        streamingMode: false,
        sequence: RECOVERY_SEQUENCE_BASE,
        accountId,
      });
      await updateCardKitCard({
        cfg,
        cardId: entry.cardKitCardId,
        card: toCardKit2(terminalCard),
        sequence: RECOVERY_SEQUENCE_BASE + 1,
        accountId,
      });
      return;
    } catch (err) {
      log.warn('card-recovery: CardKit finalize failed, falling back to im.message.patch', {
        cardId: entry.cardKitCardId,
        error: String(err),
      });
    }
  }

  await updateCardFeishu({
    cfg,
    messageId: entry.cardMessageId,
    card: toCardKit2(terminalCard) as unknown as Record<string, unknown>,
    accountId,
  });
}
