/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Converter for "video_chat" message type.
 */

import type { ContentConverterFn } from './types';
import { millisToDatetime, safeParse } from './utils';

export const convertVideoChat: ContentConverterFn = (raw) => {
  const parsed = safeParse(raw) as
    | {
        topic?: string;
        start_time?: string;
        meet_number?: string;
      }
    | undefined;

  const topic = parsed?.topic ?? '';
  const meetingNo = parsed?.meet_number?.trim() ?? '';
  const parts: string[] = [];

  if (topic) {
    parts.push(`Topic: ${topic}`);
  }

  if (parsed?.start_time) {
    parts.push(`Start time: ${millisToDatetime(parsed.start_time)}`);
  }

  if (meetingNo) {
    parts.push(`Meeting number: ${meetingNo}`);
  }

  const inner = parts.join('\n') || '[video chat]';

  return {
    content: `<meeting>${inner}</meeting>`,
    resources: [],
  };
};
