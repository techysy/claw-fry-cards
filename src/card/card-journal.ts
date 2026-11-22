/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * 在途流式卡 journal（重启僵尸卡收尾的最小状态持久化）。
 *
 * 卡片消息发送成功时记录一条在途条目；控制器进入终态（completed/aborted/
 * terminated）时移除。进程被强杀/崩溃/断电导致优雅关机 hook（shutdown-hooks
 * 的 abortCard）没机会执行时，条目留在 journal 里——插件下次启动由
 * card-recovery 按记录把半路卡补终态，飞书侧不再留"悬在半路"的僵尸卡。
 *
 * 存储：每账号一个 JSON 文件（~/.openclaw/claw-fry-cards/card-journal-<id>.json，
 * 测试可用 CLAW_FRY_CARDS_DATA_DIR 覆盖目录）。全部同步 fs + tmp+rename 原子写；
 * 写入频率为每轮回复两次（建卡一次、终态一次），同步开销可忽略。
 * 所有操作 best-effort：journal 故障绝不影响回复主链路。
 */

import fs from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { larkLogger } from '../core/lark-logger';

const log = larkLogger('card/card-journal');

/** 一条在途卡记录：够 recovery 补终态即可，指标/正文不落盘（重启后也不该复现旧正文） */
export interface CardJournalEntry {
  /** CardKit 卡实体 id；IM 兜底路径发出的卡为 null */
  cardKitCardId: string | null;
  /** IM 侧消息 id（撤回/patch 都靠它定位） */
  cardMessageId: string;
  chatId: string;
  sessionKey?: string;
  createdAt: number;
}

interface JournalFile {
  version: 1;
  cards: Record<string, CardJournalEntry>;
}

/** recovery 只回滚 7 天内的条目；更老的视为永久遗留，直接清掉不再尝试 */
export const CARD_JOURNAL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function journalDir(): string {
  return process.env.CLAW_FRY_CARDS_DATA_DIR || join(homedir(), '.openclaw', 'claw-fry-cards');
}

function journalPath(accountId: string | undefined): string {
  return join(journalDir(), `card-journal-${accountId ?? 'default'}.json`);
}

function readJournal(accountId: string | undefined): JournalFile {
  const empty: JournalFile = { version: 1, cards: {} };
  try {
    const raw = fs.readFileSync(journalPath(accountId), 'utf8');
    const parsed = JSON.parse(raw) as JournalFile;
    if (parsed && typeof parsed === 'object' && parsed.cards && typeof parsed.cards === 'object') {
      return { version: 1, cards: parsed.cards };
    }
  } catch {
    // 缺文件/坏 JSON 都从空开始（坏文件会在下次写入时被覆盖修复）
  }
  return empty;
}

function writeJournal(accountId: string | undefined, journal: JournalFile): void {
  const dir = journalDir();
  const path = journalPath(accountId);
  const tmp = `${path}.tmp`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(journal, null, 2), 'utf8');
  fs.renameSync(tmp, path);
}

/** 卡片消息发送成功 → 记在途条目（以 cardMessageId 为键，重复建卡时覆盖） */
export function recordStreamingCard(accountId: string | undefined, entry: CardJournalEntry): void {
  try {
    const journal = readJournal(accountId);
    journal.cards[entry.cardMessageId] = entry;
    writeJournal(accountId, journal);
  } catch (err) {
    log.warn('recordStreamingCard failed', { error: String(err), messageId: entry.cardMessageId });
  }
}

/** 控制器进入终态 → 移除在途条目 */
export function removeStreamingCard(accountId: string | undefined, cardMessageId: string): void {
  try {
    const journal = readJournal(accountId);
    if (!journal.cards[cardMessageId]) return;
    delete journal.cards[cardMessageId];
    writeJournal(accountId, journal);
  } catch (err) {
    log.warn('removeStreamingCard failed', { error: String(err), messageId: cardMessageId });
  }
}

/** 启动收尾读取：返回全部在途条目（文件本身不动，由 recovery 逐条成功后移除） */
export function loadStreamingCards(accountId: string | undefined): CardJournalEntry[] {
  try {
    return Object.values(readJournal(accountId).cards);
  } catch (err) {
    log.warn('loadStreamingCards failed', { error: String(err) });
    return [];
  }
}
