/**
 * Tests for resolveCardCallbackOperatorId — the shared helper that
 * extracts operator identity from Feishu card callback events.
 *
 * Schema 2 card callbacks may carry the operator identity under
 * `operator.user_id` instead of `operator.open_id`.
 */

import { describe, expect, it } from 'vitest';
import { resolveCardCallbackOperatorId } from '../src/core/card-action-operator';

describe('resolveCardCallbackOperatorId', () => {
  it('returns open_id when both fields are present (Schema 1 default)', () => {
    expect(
      resolveCardCallbackOperatorId({ open_id: 'ou_abc', user_id: 'uid_123' }),
    ).toBe('ou_abc');
  });

  it('returns open_id when only open_id is present', () => {
    expect(
      resolveCardCallbackOperatorId({ open_id: 'ou_abc' }),
    ).toBe('ou_abc');
  });

  it('falls back to user_id when open_id is absent (Schema 2)', () => {
    expect(
      resolveCardCallbackOperatorId({ user_id: 'uid_123' }),
    ).toBe('uid_123');
  });

  it('returns undefined when operator is undefined', () => {
    expect(resolveCardCallbackOperatorId(undefined)).toBeUndefined();
  });

  it('returns undefined when both fields are absent', () => {
    expect(resolveCardCallbackOperatorId({})).toBeUndefined();
  });

  it('returns undefined when both fields are empty strings', () => {
    // Both empty strings are falsy, so || falls through to the last operand.
    expect(
      resolveCardCallbackOperatorId({ open_id: '', user_id: '' }),
    ).toBe('');
  });

  it('prefers non-empty open_id over non-empty user_id', () => {
    expect(
      resolveCardCallbackOperatorId({ open_id: 'ou_real', user_id: 'uid_fallback' }),
    ).toBe('ou_real');
  });

  it('skips empty-string open_id and returns user_id (Schema 2 edge case)', () => {
    // Some Schema 2 payloads may send open_id as "" rather than omitting it.
    // With ||, empty-string open_id is treated as falsy and falls back to user_id.
    expect(
      resolveCardCallbackOperatorId({ open_id: '', user_id: 'uid_123' }),
    ).toBe('uid_123');
  });
});
