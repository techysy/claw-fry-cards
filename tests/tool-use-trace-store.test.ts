/**
 * Tests for src/card/tool-use-trace-store.ts
 *
 * Covers: lifecycle, step pairing, timeouts, session limits,
 * step caps, and sanitization.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetForTesting,
  clearToolUseTraceRun,
  getToolUseTraceSteps,
  recordToolUseEnd,
  recordToolUseStart,
  sanitizeTraceValue,
  startToolUseTraceRun,
} from '../src/card/tool-use-trace-store';

afterEach(() => {
  _resetForTesting();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Basic lifecycle
// ---------------------------------------------------------------------------

describe('basic lifecycle', () => {
  it('records start → end and returns completed step', () => {
    const sk = 'sess-1';
    startToolUseTraceRun(sk);

    recordToolUseStart({ sessionKey: sk, toolName: 'read', toolParams: { file_path: '/a.ts' } });
    recordToolUseEnd({
      sessionKey: sk,
      toolName: 'read',
      toolParams: { file_path: '/a.ts' },
      result: 'ok',
      durationMs: 42,
    });

    const steps = getToolUseTraceSteps(sk);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      toolName: 'read',
      status: 'success',
      durationMs: 42,
      result: 'ok',
    });
    expect(steps[0]!.finishedAt).toBeDefined();
  });

  it('returns running step before end is recorded', () => {
    const sk = 'sess-2';
    startToolUseTraceRun(sk);
    recordToolUseStart({ sessionKey: sk, toolName: 'bash' });

    const steps = getToolUseTraceSteps(sk);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.status).toBe('running');
    expect(steps[0]!.finishedAt).toBeUndefined();
  });

  it('marks error status when error is provided', () => {
    const sk = 'sess-3';
    startToolUseTraceRun(sk);
    recordToolUseStart({ sessionKey: sk, toolName: 'write' });
    recordToolUseEnd({ sessionKey: sk, toolName: 'write', error: 'EACCES' });

    const steps = getToolUseTraceSteps(sk);
    expect(steps[0]!.status).toBe('error');
    expect(steps[0]!.error).toBe('EACCES');
  });

  it('returns empty array for unknown session', () => {
    expect(getToolUseTraceSteps('nonexistent')).toEqual([]);
  });

  it('returns empty array for undefined/empty sessionKey', () => {
    expect(getToolUseTraceSteps(undefined)).toEqual([]);
    expect(getToolUseTraceSteps('')).toEqual([]);
  });

  it('ignores start with missing sessionKey or toolName', () => {
    recordToolUseStart({ sessionKey: '', toolName: 'read' });
    recordToolUseStart({ sessionKey: 'sk', toolName: '' });
    expect(getToolUseTraceSteps('')).toEqual([]);
    expect(getToolUseTraceSteps('sk')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Disabled collection without an explicit run start
// ---------------------------------------------------------------------------

describe('disabled collection', () => {
  it('ignores start events until a trace run is explicitly started', () => {
    const sk = 'sess-disabled-start';
    recordToolUseStart({ sessionKey: sk, toolName: 'grep', toolParams: { pattern: 'TODO' } });

    expect(getToolUseTraceSteps(sk)).toEqual([]);
  });

  it('ignores end events until a trace run is explicitly started', () => {
    const sk = 'sess-disabled-end';
    recordToolUseEnd({
      sessionKey: sk,
      toolName: 'grep',
      result: '3 matches',
      durationMs: 10,
    });

    expect(getToolUseTraceSteps(sk)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Step pairing by toolName + params fingerprint
// ---------------------------------------------------------------------------

describe('fingerprint-based pairing', () => {
  it('pairs end to correct start by toolName + params', () => {
    const sk = 'sess-fp';
    startToolUseTraceRun(sk);
    recordToolUseStart({ sessionKey: sk, toolName: 'read', toolParams: { file_path: '/a.ts' } });
    recordToolUseStart({ sessionKey: sk, toolName: 'read', toolParams: { file_path: '/b.ts' } });

    // End the second one first
    recordToolUseEnd({
      sessionKey: sk,
      toolName: 'read',
      toolParams: { file_path: '/b.ts' },
      result: 'b-content',
    });

    const steps = getToolUseTraceSteps(sk);
    expect(steps).toHaveLength(2);
    // First step (a.ts) still running
    expect(steps[0]!.status).toBe('running');
    // Second step (b.ts) completed
    expect(steps[1]!.status).toBe('success');
    expect(steps[1]!.result).toBe('b-content');
  });

  it('falls back to toolName-only match when params differ', () => {
    const sk = 'sess-fallback';
    startToolUseTraceRun(sk);
    recordToolUseStart({ sessionKey: sk, toolName: 'bash', toolParams: { command: 'ls' } });

    // End arrives with different params (SDK sometimes normalizes differently)
    recordToolUseEnd({
      sessionKey: sk,
      toolName: 'bash',
      toolParams: { command: 'ls -la' },
      result: 'ok',
    });

    const steps = getToolUseTraceSteps(sk);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.status).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// Step timeout
// ---------------------------------------------------------------------------

describe('step timeout', () => {
  it('marks running steps as timed out after STEP_RUNNING_TIMEOUT_MS', () => {
    const sk = 'sess-timeout';
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    startToolUseTraceRun(sk);
    recordToolUseStart({ sessionKey: sk, toolName: 'agent' });

    // Advance past the 5-minute timeout
    vi.spyOn(Date, 'now').mockReturnValue(now + 5 * 60 * 1000 + 1);

    const steps = getToolUseTraceSteps(sk);
    expect(steps[0]!.status).toBe('error');
    expect(steps[0]!.error).toBe('timed out');
  });

  it('does not mark completed steps as timed out', () => {
    const sk = 'sess-timeout-ok';
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    startToolUseTraceRun(sk);
    recordToolUseStart({ sessionKey: sk, toolName: 'read' });
    recordToolUseEnd({ sessionKey: sk, toolName: 'read', result: 'ok' });

    vi.spyOn(Date, 'now').mockReturnValue(now + 5 * 60 * 1000 + 1);

    const steps = getToolUseTraceSteps(sk);
    expect(steps[0]!.status).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// Session TTL expiration
// ---------------------------------------------------------------------------

describe('session TTL', () => {
  it('returns empty after TRACE_TTL_MS', () => {
    const sk = 'sess-ttl';
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    startToolUseTraceRun(sk);
    recordToolUseStart({ sessionKey: sk, toolName: 'read' });
    recordToolUseEnd({ sessionKey: sk, toolName: 'read', result: 'ok' });

    // Advance past 30-minute TTL
    vi.spyOn(Date, 'now').mockReturnValue(now + 30 * 60 * 1000 + 1);

    expect(getToolUseTraceSteps(sk)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Session count limit (MAX_SESSION_TRACES = 128)
// ---------------------------------------------------------------------------

describe('session count limit', () => {
  it('evicts oldest sessions when exceeding MAX_SESSION_TRACES', () => {
    const baseTime = 1000000;
    // Pruning is lazy — runs BEFORE the new set() in startToolUseTraceRun.
    // So after 129 creates, the map has 129 entries. The 130th create triggers
    // pruning that evicts the 2 oldest (overflow = 130-1 - 128 = 1, but we
    // need 130th to trigger it). Create 130 sessions to verify eviction.
    for (let i = 0; i < 130; i++) {
      vi.spyOn(Date, 'now').mockReturnValue(baseTime + i * 100);
      startToolUseTraceRun(`sess-${i}`);
      recordToolUseStart({ sessionKey: `sess-${i}`, toolName: 'read' });
    }

    // Restore Date.now for getToolUseTraceSteps TTL check
    vi.spyOn(Date, 'now').mockReturnValue(baseTime + 130 * 100);

    // sess-0 was the oldest when sess-129 triggered pruning (map had 129),
    // so sess-0 should be evicted. Then sess-129 set brings it back to 129,
    // and sess-130's pruning evicts sess-1.
    // The oldest session(s) should be evicted
    expect(getToolUseTraceSteps('sess-0')).toEqual([]);
    // Recent sessions should still exist
    expect(getToolUseTraceSteps('sess-129')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Step cap (MAX_STEPS_PER_SESSION = 256)
// ---------------------------------------------------------------------------

describe('step cap per session', () => {
  it('trims oldest steps when exceeding MAX_STEPS_PER_SESSION', () => {
    const sk = 'sess-cap';
    startToolUseTraceRun(sk);

    for (let i = 0; i < 257; i++) {
      recordToolUseStart({
        sessionKey: sk,
        toolName: `tool-${i}`,
        toolParams: { idx: i },
      });
    }

    const steps = getToolUseTraceSteps(sk);
    expect(steps.length).toBeLessThanOrEqual(256);
    // Earliest steps should have been trimmed
    expect(steps.find((s) => s.toolName === 'tool-0')).toBeUndefined();
    // Latest should exist
    expect(steps.find((s) => s.toolName === 'tool-256')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// startToolUseTraceRun resets session
// ---------------------------------------------------------------------------

describe('startToolUseTraceRun', () => {
  it('clears existing steps for the session', () => {
    const sk = 'sess-reset';
    startToolUseTraceRun(sk);
    recordToolUseStart({ sessionKey: sk, toolName: 'read' });
    expect(getToolUseTraceSteps(sk)).toHaveLength(1);

    startToolUseTraceRun(sk);
    expect(getToolUseTraceSteps(sk)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// toolCallId-based pairing (Tier 1)
// ---------------------------------------------------------------------------

describe('toolCallId-based pairing', () => {
  it('pairs by toolCallId even when toolName and params are identical', () => {
    const sk = 'sess-tcid';
    startToolUseTraceRun(sk);
    const params = { file_path: '/same.ts' };

    recordToolUseStart({ sessionKey: sk, toolName: 'read', toolParams: params, toolCallId: 'tc-1' });
    recordToolUseStart({ sessionKey: sk, toolName: 'read', toolParams: params, toolCallId: 'tc-2' });

    // End tc-2 first (out of order)
    recordToolUseEnd({
      sessionKey: sk,
      toolName: 'read',
      toolParams: params,
      toolCallId: 'tc-2',
      result: 'result-2',
      durationMs: 20,
    });

    const steps = getToolUseTraceSteps(sk);
    expect(steps).toHaveLength(2);
    // tc-1 still running
    expect(steps[0]).toMatchObject({ toolCallId: 'tc-1', status: 'running' });
    // tc-2 completed
    expect(steps[1]).toMatchObject({ toolCallId: 'tc-2', status: 'success', result: 'result-2' });
  });

  it('completes only the targeted step among three concurrent same-tool calls', () => {
    const sk = 'sess-3way';
    startToolUseTraceRun(sk);
    const params = { file_path: '/x.ts' };

    recordToolUseStart({ sessionKey: sk, toolName: 'read', toolParams: params, toolCallId: 'a' });
    recordToolUseStart({ sessionKey: sk, toolName: 'read', toolParams: params, toolCallId: 'b' });
    recordToolUseStart({ sessionKey: sk, toolName: 'read', toolParams: params, toolCallId: 'c' });

    // Complete only the middle one
    recordToolUseEnd({ sessionKey: sk, toolName: 'read', toolCallId: 'b', result: 'mid' });

    const steps = getToolUseTraceSteps(sk);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ toolCallId: 'a', status: 'running' });
    expect(steps[1]).toMatchObject({ toolCallId: 'b', status: 'success', result: 'mid' });
    expect(steps[2]).toMatchObject({ toolCallId: 'c', status: 'running' });
  });

  it('falls back to fingerprint when toolCallId is absent', () => {
    const sk = 'sess-no-tcid';
    startToolUseTraceRun(sk);

    recordToolUseStart({ sessionKey: sk, toolName: 'read', toolParams: { file_path: '/a.ts' } });
    recordToolUseStart({ sessionKey: sk, toolName: 'read', toolParams: { file_path: '/b.ts' } });

    // End without toolCallId — should use fingerprint matching
    recordToolUseEnd({
      sessionKey: sk,
      toolName: 'read',
      toolParams: { file_path: '/a.ts' },
      result: 'a-result',
    });

    const steps = getToolUseTraceSteps(sk);
    expect(steps[0]).toMatchObject({ status: 'success', result: 'a-result' });
    expect(steps[1]).toMatchObject({ status: 'running' });
  });

  it('stores runId on steps', () => {
    const sk = 'sess-runid';
    startToolUseTraceRun(sk);
    recordToolUseStart({
      sessionKey: sk,
      toolName: 'bash',
      toolCallId: 'tc-x',
      runId: 'run-123',
    });

    const steps = getToolUseTraceSteps(sk);
    expect(steps[0]).toMatchObject({ toolCallId: 'tc-x', runId: 'run-123' });
  });
});

// ---------------------------------------------------------------------------
// sanitizeTraceValue
// ---------------------------------------------------------------------------

describe('sanitizeTraceValue', () => {
  it('redacts sensitive keys', () => {
    const result = sanitizeTraceValue({
      name: 'test',
      token: 'secret-123',
      api_key: 'ak-456',
      password: 'p4ss',
      authorization: 'Bearer xyz',
    }) as Record<string, unknown>;

    expect(result.name).toBe('test');
    expect(result.token).toBe('[redacted]');
    expect(result.api_key).toBe('[redacted]');
    expect(result.password).toBe('[redacted]');
    expect(result.authorization).toBe('[redacted]');
  });

  it('truncates long strings to 512 chars', () => {
    const long = 'a'.repeat(600);
    const result = sanitizeTraceValue(long) as string;
    expect(result.length).toBe(512);
    expect(result.endsWith('...')).toBe(true);
  });

  it('preserves strings within the 512 char limit', () => {
    const text = 'a'.repeat(500);
    expect(sanitizeTraceValue(text)).toBe(text);
  });

  it('keeps long command-like param values beyond the generic 512-char limit', () => {
    const command = 'echo very-long-token '.repeat(80).trim();
    const result = sanitizeTraceValue({ command }) as Record<string, unknown>;

    expect(typeof result.command).toBe('string');
    expect((result.command as string).length).toBe(command.length);
    expect(result.command).toBe(command);
  });

  it('redacts inline command secrets before storing params', () => {
    const result = sanitizeTraceValue({
      command: `TOKEN=supersecret curl -H 'Authorization: Bearer abc123' https://example.com`,
    }) as Record<string, unknown>;

    expect(result.command).toBe(`TOKEN=[redacted] curl -H 'Authorization: Bearer [redacted]' https://example.com`);
  });

  it('still caps raw result strings more conservatively than command params', () => {
    const resultText = 'x'.repeat(1300);
    const sanitized = sanitizeTraceValue(resultText, 0, { source: 'result' }) as string;

    expect(sanitized.length).toBe(1024);
    expect(sanitized.endsWith('...')).toBe(true);
  });

  it('truncates arrays to 8 items', () => {
    const arr = Array.from({ length: 12 }, (_, i) => i);
    const result = sanitizeTraceValue(arr) as number[];
    expect(result).toHaveLength(8);
  });

  it('truncates objects to 12 keys', () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 15; i++) obj[`key${i}`] = i;
    const result = sanitizeTraceValue(obj) as Record<string, unknown>;
    expect(Object.keys(result)).toHaveLength(12);
  });

  it('truncates at depth 2', () => {
    const deep = { a: { b: { c: 'deep' } } };
    const result = sanitizeTraceValue(deep) as Record<string, unknown>;
    const inner = result.a as Record<string, unknown>;
    expect(inner.b).toBe('[truncated]');
  });

  it('passes through primitives', () => {
    expect(sanitizeTraceValue(42)).toBe(42);
    expect(sanitizeTraceValue(true)).toBe(true);
    expect(sanitizeTraceValue(null)).toBeUndefined();
    expect(sanitizeTraceValue(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// clearToolUseTraceRun
// ---------------------------------------------------------------------------

describe('clearToolUseTraceRun', () => {
  it('removes all steps for the session immediately', () => {
    const sk = 'sess-clear';
    startToolUseTraceRun(sk);
    recordToolUseStart({ sessionKey: sk, toolName: 'read' });
    expect(getToolUseTraceSteps(sk)).toHaveLength(1);

    clearToolUseTraceRun(sk);
    expect(getToolUseTraceSteps(sk)).toEqual([]);
  });

  it('is a no-op on an unknown session key', () => {
    expect(() => clearToolUseTraceRun('nonexistent-clear')).not.toThrow();
  });

  it('is a no-op on empty string', () => {
    expect(() => clearToolUseTraceRun('')).not.toThrow();
  });

  it('does not affect other sessions', () => {
    const sk1 = 'sess-clear-a';
    const sk2 = 'sess-clear-b';
    startToolUseTraceRun(sk1);
    startToolUseTraceRun(sk2);
    recordToolUseStart({ sessionKey: sk1, toolName: 'read' });
    recordToolUseStart({ sessionKey: sk2, toolName: 'write' });

    clearToolUseTraceRun(sk1);

    expect(getToolUseTraceSteps(sk1)).toEqual([]);
    expect(getToolUseTraceSteps(sk2)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// runId-based isolation
// ---------------------------------------------------------------------------

describe('runId-based isolation', () => {
  it('latches currentRunId on first start with runId', () => {
    const sk = 'sess-runlatch';
    startToolUseTraceRun(sk);
    recordToolUseStart({ sessionKey: sk, toolName: 'read', runId: 'run-A' });

    const steps = getToolUseTraceSteps(sk);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.runId).toBe('run-A');
  });

  it('accepts subsequent starts with the same runId', () => {
    const sk = 'sess-runsame';
    startToolUseTraceRun(sk);
    recordToolUseStart({ sessionKey: sk, toolName: 'read', runId: 'run-B' });
    recordToolUseStart({ sessionKey: sk, toolName: 'write', runId: 'run-B' });

    expect(getToolUseTraceSteps(sk)).toHaveLength(2);
  });

  it('drops starts with a different runId (stale run)', () => {
    const sk = 'sess-runstale';
    startToolUseTraceRun(sk);
    recordToolUseStart({ sessionKey: sk, toolName: 'read', runId: 'run-C' });
    recordToolUseStart({ sessionKey: sk, toolName: 'write', runId: 'run-D' }); // stale

    const steps = getToolUseTraceSteps(sk);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.toolName).toBe('read');
  });

  it('drops end events with a different runId', () => {
    const sk = 'sess-runend';
    startToolUseTraceRun(sk);
    recordToolUseStart({ sessionKey: sk, toolName: 'bash', toolCallId: 'tc-1', runId: 'run-E' });
    recordToolUseEnd({ sessionKey: sk, toolName: 'bash', toolCallId: 'tc-1', runId: 'run-F', result: 'nope' }); // stale

    const steps = getToolUseTraceSteps(sk);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.status).toBe('running');
  });

  it('accepts end events without runId when currentRunId is set (backward compat)', () => {
    const sk = 'sess-runnoend';
    startToolUseTraceRun(sk);
    recordToolUseStart({ sessionKey: sk, toolName: 'grep', toolCallId: 'tc-2', runId: 'run-G' });
    recordToolUseEnd({ sessionKey: sk, toolName: 'grep', toolCallId: 'tc-2', result: 'found' }); // no runId

    const steps = getToolUseTraceSteps(sk);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.status).toBe('success');
  });

  it('accepts starts without runId when no runId has been latched', () => {
    const sk = 'sess-norunid';
    startToolUseTraceRun(sk);
    recordToolUseStart({ sessionKey: sk, toolName: 'list' });
    recordToolUseStart({ sessionKey: sk, toolName: 'search' });

    expect(getToolUseTraceSteps(sk)).toHaveLength(2);
  });

  it('startToolUseTraceRun resets the latched runId', () => {
    const sk = 'sess-runreset';
    startToolUseTraceRun(sk);
    recordToolUseStart({ sessionKey: sk, toolName: 'read', runId: 'run-H' });
    startToolUseTraceRun(sk); // new run starts — resets latch
    recordToolUseStart({ sessionKey: sk, toolName: 'write', runId: 'run-I' });

    const steps = getToolUseTraceSteps(sk);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.toolName).toBe('write');
    expect(steps[0]!.runId).toBe('run-I');
  });
});
