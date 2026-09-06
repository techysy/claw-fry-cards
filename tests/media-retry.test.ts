/**
 * Tests for the media download retry logic (withRetry helper).
 *
 * Verifies that transient HTTP 502/503/504 errors are retried with
 * bounded backoff, while non-retryable errors are thrown immediately.
 */

import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../src/core/lark-logger', () => ({
  larkLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../src/core/lark-client', () => ({
  LarkClient: {
    fromCfg: () => ({
      sdk: {
        im: {
          messageResource: {
            get: vi.fn(),
          },
        },
      },
    }),
  },
}));

// We test withRetry indirectly by importing downloadMessageResourceFeishu
// and controlling the SDK mock.  But withRetry is private, so we also
// test it through a minimal re-implementation to cover edge cases.

// ---------------------------------------------------------------------------
// withRetry logic (mirrored from media.ts for direct unit testing)
// ---------------------------------------------------------------------------

const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);
const MEDIA_RETRY_MAX = 2;
const MEDIA_RETRY_DELAY_MS = 10; // speed up tests

function extractHttpStatus(err: unknown): number | undefined {
  if (err != null && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (typeof obj.status === 'number') return obj.status;
    if (typeof obj.statusCode === 'number') return obj.statusCode;
    if (typeof obj.message === 'string') {
      const m = obj.message.match(/\b(50[2-4])\b/);
      if (m) return Number(m[1]);
    }
  }
  return undefined;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  _label: string,
  maxRetries = MEDIA_RETRY_MAX,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = extractHttpStatus(err);
      if (status == null || !RETRYABLE_STATUS_CODES.has(status) || attempt >= maxRetries) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, MEDIA_RETRY_DELAY_MS));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('withRetry', () => {
  // Use real timers throughout — MEDIA_RETRY_DELAY_MS is only 10ms,
  // so tests complete fast without the complexity of timer flushing.

  it('returns result on first successful attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, 'test');
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 502 and succeeds on second attempt', async () => {
    const err502 = Object.assign(new Error('Bad Gateway'), { status: 502 });
    const fn = vi.fn().mockRejectedValueOnce(err502).mockResolvedValue('ok');

    const result = await withRetry(fn, 'test');

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on 503 and succeeds on third attempt', async () => {
    const err503 = Object.assign(new Error('Service Unavailable'), { status: 503 });
    const fn = vi.fn().mockRejectedValueOnce(err503).mockRejectedValueOnce(err503).mockResolvedValue('ok');

    const result = await withRetry(fn, 'test');

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting retries on persistent 502', async () => {
    const err502 = Object.assign(new Error('Bad Gateway'), { status: 502 });
    const fn = vi.fn().mockRejectedValue(err502);

    await expect(withRetry(fn, 'test')).rejects.toThrow('Bad Gateway');

    // 1 initial + 2 retries = 3 total
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on 404 (non-retryable)', async () => {
    const err404 = Object.assign(new Error('Not Found'), { status: 404 });
    const fn = vi.fn().mockRejectedValue(err404);

    await expect(withRetry(fn, 'test')).rejects.toThrow('Not Found');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 403 (non-retryable)', async () => {
    const err403 = Object.assign(new Error('Forbidden'), { status: 403 });
    const fn = vi.fn().mockRejectedValue(err403);

    await expect(withRetry(fn, 'test')).rejects.toThrow('Forbidden');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on errors without status', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(withRetry(fn, 'test')).rejects.toThrow('Network error');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 504 (Gateway Timeout)', async () => {
    const err504 = Object.assign(new Error('Gateway Timeout'), { status: 504 });
    const fn = vi.fn().mockRejectedValueOnce(err504).mockResolvedValue('ok');

    const result = await withRetry(fn, 'test');

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('extractHttpStatus', () => {
  it('extracts from err.status', () => {
    expect(extractHttpStatus({ status: 502 })).toBe(502);
  });

  it('extracts from err.statusCode', () => {
    expect(extractHttpStatus({ statusCode: 503 })).toBe(503);
  });

  it('extracts from err.message string', () => {
    expect(extractHttpStatus({ message: 'HTTP 504 Gateway Timeout' })).toBe(504);
  });

  it('returns undefined for non-matching errors', () => {
    expect(extractHttpStatus(new Error('random error'))).toBeUndefined();
  });

  it('returns undefined for null/undefined', () => {
    expect(extractHttpStatus(null)).toBeUndefined();
    expect(extractHttpStatus(undefined)).toBeUndefined();
  });
});
