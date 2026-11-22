/**
 * Tests for the in-flight streaming card journal (重启僵尸卡收尾的存储层):
 *  - record/load/remove roundtrip, per-account isolation
 *  - overwrite on duplicate cardMessageId
 *  - corrupt / missing files tolerated (best-effort semantics)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadStreamingCards, recordStreamingCard, removeStreamingCard } from '../src/card/card-journal';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fry-card-journal-'));
  process.env.CLAW_FRY_CARDS_DATA_DIR = dir;
});

afterEach(() => {
  delete process.env.CLAW_FRY_CARDS_DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

function entry(overrides: Partial<Parameters<typeof recordStreamingCard>[1]> = {}) {
  return {
    cardKitCardId: 'cc_1' as string | null,
    cardMessageId: 'om_1',
    chatId: 'oc_chat',
    sessionKey: 'session',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('card journal', () => {
  it('records and loads an in-flight entry', () => {
    recordStreamingCard('main', entry());
    const cards = loadStreamingCards('main');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ cardKitCardId: 'cc_1', cardMessageId: 'om_1', chatId: 'oc_chat' });
  });

  it('isolates entries per account', () => {
    recordStreamingCard('main', entry({ cardMessageId: 'om_main' }));
    recordStreamingCard('second', entry({ cardMessageId: 'om_second' }));

    expect(loadStreamingCards('main').map((c) => c.cardMessageId)).toEqual(['om_main']);
    expect(loadStreamingCards('second').map((c) => c.cardMessageId)).toEqual(['om_second']);
    expect(loadStreamingCards('unknown')).toEqual([]);
  });

  it('overwrites the entry on duplicate cardMessageId', () => {
    recordStreamingCard(undefined, entry());
    recordStreamingCard(undefined, entry({ cardKitCardId: null }));
    const cards = loadStreamingCards(undefined);
    expect(cards).toHaveLength(1);
    expect(cards[0].cardKitCardId).toBeNull();
  });

  it('removes an entry on terminal state', () => {
    recordStreamingCard('main', entry());
    removeStreamingCard('main', 'om_1');
    expect(loadStreamingCards('main')).toEqual([]);
    // 移除不存在的条目是 no-op，不抛错
    expect(() => removeStreamingCard('main', 'om_missing')).not.toThrow();
  });

  it('tolerates a corrupt journal file (starts clean, repairs on next write)', () => {
    fs.writeFileSync(path.join(dir, 'card-journal-main.json'), '{ not valid json', 'utf8');
    expect(loadStreamingCards('main')).toEqual([]);
    recordStreamingCard('main', entry());
    expect(loadStreamingCards('main')).toHaveLength(1);
  });

  it('creates the data directory on first write', () => {
    fs.rmSync(dir, { recursive: true, force: true });
    recordStreamingCard('main', entry());
    expect(fs.existsSync(path.join(dir, 'card-journal-main.json'))).toBe(true);
  });
});
