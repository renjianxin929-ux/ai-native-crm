import { describe, expect, it } from 'vitest';

import {
  buildCallDraftInputForLinkedCustomer,
  buildScreenshotDraftInputForLinkedCustomer,
} from '../pages/AIAssistantPage';
import type { CallAnalysis, Customer, ScreenshotAnalysis } from '../lib/types';

const linkedCustomer = { id: 'current-customer-1', name: 'Current Customer' } as Customer;

describe('AIAssistantPage customer binding', () => {
  it('binds screenshot drafts to the loaded current customer', () => {
    const analysis: ScreenshotAnalysis = {
      customer_name: 'Current Customer',
      wechat_id: 'current_wx',
      phone_number: '13800138000',
      reply_status: 'REPLIED',
      intent_level: 'MEDIUM',
      grade_suggestion: 'B',
      follow_up_result: 'POSITIVE',
      next_action: '继续跟进',
      next_follow_up_text: '明天',
      summary: '截图分析摘要',
      evidence: '截图里有明确回复',
      confidence: 0.82,
    };

    const draft = buildScreenshotDraftInputForLinkedCustomer(analysis, linkedCustomer);

    expect(draft.source_type).toBe('SCREENSHOT');
    expect(draft.customer_id).toBe('current-customer-1');
    expect(draft.raw_input_summary).toContain('截图');
  });

  it('binds call drafts to the loaded current customer', () => {
    const analysis: CallAnalysis = {
      summary: '客户表示可以后续了解',
      phone_feedback: 'CAN_LEARN',
      intent_level: 'MEDIUM',
      grade_suggestion: 'B',
      next_action: '短跟进',
      next_follow_up_text: '下周',
      risk: '',
      confidence: 0.76,
    };

    const draft = buildCallDraftInputForLinkedCustomer(analysis, linkedCustomer);

    expect(draft.source_type).toBe('CALL_TEXT');
    expect(draft.customer_id).toBe('current-customer-1');
    expect(draft.raw_input_summary).toContain('通话');
  });

  it('does not save AI assistant drafts without a loaded current customer', () => {
    const analysis: CallAnalysis = {
      summary: '客户表示可以后续了解',
      phone_feedback: 'CAN_LEARN',
      intent_level: 'MEDIUM',
      grade_suggestion: 'B',
      next_action: '短跟进',
      next_follow_up_text: '下周',
      risk: '',
      confidence: 0.76,
    };

    expect(() => buildCallDraftInputForLinkedCustomer(analysis, null)).toThrow('当前客户');
  });
});
