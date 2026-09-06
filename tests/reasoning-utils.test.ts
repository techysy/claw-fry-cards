/**
 * Tests for src/card/reasoning-utils.ts
 */

import { describe, expect, it } from 'vitest';
import { normalizeToolName, redactInlineSecrets, sanitizeParamsForLog, truncateText } from '../src/card/reasoning-utils';

// ---------------------------------------------------------------------------
// normalizeToolName
// ---------------------------------------------------------------------------

describe('normalizeToolName', () => {
  it('lowercases and trims', () => {
    expect(normalizeToolName('  Read  ')).toBe('read');
    expect(normalizeToolName('BASH')).toBe('bash');
  });

  it('returns empty string for undefined/empty', () => {
    expect(normalizeToolName(undefined)).toBe('');
    expect(normalizeToolName('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// truncateText
// ---------------------------------------------------------------------------

describe('truncateText', () => {
  it('returns short strings unchanged', () => {
    expect(truncateText('hello', 10)).toBe('hello');
  });

  it('returns exact-length strings unchanged', () => {
    expect(truncateText('12345', 5)).toBe('12345');
  });

  it('truncates with ellipsis for over-length strings', () => {
    const result = truncateText('abcdefghij', 8);
    expect(result).toBe('abcde...');
    expect(result.length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// sanitizeParamsForLog
// ---------------------------------------------------------------------------

describe('sanitizeParamsForLog', () => {
  it('returns key names only', () => {
    expect(sanitizeParamsForLog({ file_path: '/secret', command: 'rm -rf' })).toBe('{file_path,command}');
  });

  it('returns {} for empty params', () => {
    expect(sanitizeParamsForLog({})).toBe('{}');
  });

  it('returns empty string for null/undefined', () => {
    expect(sanitizeParamsForLog(undefined)).toBe('');
    expect(sanitizeParamsForLog(null as unknown as undefined)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// redactInlineSecrets
// ---------------------------------------------------------------------------

describe('redactInlineSecrets', () => {
  it('redacts x-api-key style header values', () => {
    const result = redactInlineSecrets(`curl -H 'x-api-key: abc123' https://example.com`);
    expect(result).toContain(`x-api-key: [redacted]`);
    expect(result).not.toContain('abc123');
  });

  it('redacts --api-key flag values', () => {
    const result = redactInlineSecrets(`cmd --api-key abc123 --other ok`);
    expect(result).toContain(`--api-key [redacted]`);
    expect(result).not.toContain('abc123');
  });
});
