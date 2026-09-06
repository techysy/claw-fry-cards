/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Shared utilities for the reasoning display subsystem.
 */

export function normalizeToolName(name?: string): string {
  return name?.trim().toLowerCase() ?? '';
}

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

const INLINE_ASSIGNMENT_RE = /(^|[\s"'`])([A-Za-z_][A-Za-z0-9_]*)(=(?:"[^"]*"|'[^']*'|[^\s"'`]+))/g;
const AUTH_HEADER_SECRET_RE = /(Authorization\s*:\s*(?:Bearer|Basic|Token)\s+)([^'"\s]+)/gi;
const QUOTED_HEADER_ARG_RE = /((?:^|[\s"'`])(?:-H|--header)\s+)(['"])([A-Za-z0-9_-]+)(\s*:\s*)([^'"]*)(\2)/gi;
const UNQUOTED_HEADER_ARG_RE = /((?:^|[\s"'`])(?:-H|--header)\s+)([A-Za-z0-9_-]+)(\s*:\s*)([^\s"'`]+)/gi;
const SECRET_FLAG_RE = /((?:^|[\s"'`]))(--?[A-Za-z0-9][A-Za-z0-9-]*)(=|\s+)(?:"([^"]*)"|'([^']*)'|([^\s"'`]+))/g;
const SENSITIVE_NAME_RE =
  /token|secret|password|api[_-]?key|authorization|cookie|credential|bearer|session[_-]?id|client[_-]?secret|access[_-]?key/i;

export function redactInlineSecrets(value: string): string {
  return value
    .replace(INLINE_ASSIGNMENT_RE, (match, prefix: string, key: string) =>
      isSensitiveName(key) ? `${prefix}${key}=[redacted]` : match,
    )
    .replace(AUTH_HEADER_SECRET_RE, '$1[redacted]')
    .replace(QUOTED_HEADER_ARG_RE, (match, prefix: string, quote: string, name: string, separator: string) =>
      shouldRedactHeaderValue(name) ? `${prefix}${quote}${name}${separator}[redacted]${quote}` : match,
    )
    .replace(UNQUOTED_HEADER_ARG_RE, (match, prefix: string, name: string, separator: string) =>
      shouldRedactHeaderValue(name) ? `${prefix}${name}${separator}[redacted]` : match,
    )
    .replace(
      SECRET_FLAG_RE,
      (
        match,
        prefix: string,
        flag: string,
        separator: string,
        doubleQuoted?: string,
        singleQuoted?: string,
        bare?: string,
      ) => {
        const normalizedFlag = flag.replace(/^-+/, '');
        if (!isSensitiveName(normalizedFlag)) return match;
        const redactedValue =
          doubleQuoted !== undefined
            ? '"[redacted]"'
            : singleQuoted !== undefined
              ? "'[redacted]'"
              : bare !== undefined
                ? '[redacted]'
                : '[redacted]';
        return `${prefix}${flag}${separator}${redactedValue}`;
      },
    );
}

function isSensitiveName(value: string): boolean {
  return SENSITIVE_NAME_RE.test(value);
}

function shouldRedactHeaderValue(name: string): boolean {
  return !/^authorization$/i.test(name) && isSensitiveName(name);
}

/**
 * Sanitize tool params for safe logging.
 * Logs only param key names (no values) to avoid leaking sensitive data.
 */
export function sanitizeParamsForLog(params?: Record<string, unknown>): string {
  if (!params || typeof params !== 'object') return '';
  const keys = Object.keys(params);
  if (keys.length === 0) return '{}';
  return `{${keys.join(',')}}`;
}
