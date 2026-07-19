import { describe, expect, it } from 'vitest';

import {
  buildCallTranscriptPrompt,
  buildWechatScreenshotPrompt,
  createDraftFromCallAnalysis,
  createDraftFromScreenshotAnalysis,
  analyzeCallTranscript,
  suggestNextActionWithDeepSeek,
} from '../lib/aiDraft';
import type { Customer } from '../lib/types';
import { getActiveVerticalProfile, type VerticalRuleProfile } from '../lib/verticalProfiles';

describe('aiDraft vertical profile policy', () => {
  it('keeps legacy prompt builders on the active vertical profile policy', () => {
    expect(buildWechatScreenshotPrompt()).toBe(
      buildWechatScreenshotPrompt({ profile: getActiveVerticalProfile() }),
    );
    expect(buildCallTranscriptPrompt('Test transcript')).toBe(
      buildCallTranscriptPrompt('Test transcript', { profile: getActiveVerticalProfile() }),
    );
  });

  it('uses supplied vertical profile prompt policy', () => {
    const dummyProfile: VerticalRuleProfile = {
      ...getActiveVerticalProfile(),
      key: 'dummy_ai_draft_profile',
      name: 'Dummy AI Draft Profile',
      aiDraft: {
        ...getActiveVerticalProfile().aiDraft,
        wechatScreenshotPrompt: 'Dummy screenshot prompt',
        callTranscriptPrompt: {
          beforeTranscript: 'Before transcript\n',
          afterTranscript: '\nAfter transcript',
        },
      },
    };

    expect(buildWechatScreenshotPrompt({ profile: dummyProfile })).toBe('Dummy screenshot prompt');
    expect(buildCallTranscriptPrompt('hello', { profile: dummyProfile })).toBe(
      'Before transcript\nhello\nAfter transcript',
    );
  });

  it('uses supplied vertical profile draft summary policy', () => {
    const dummyProfile: VerticalRuleProfile = {
      ...getActiveVerticalProfile(),
      key: 'dummy_ai_draft_summary_profile',
      name: 'Dummy AI Draft Summary Profile',
      aiDraft: {
        ...getActiveVerticalProfile().aiDraft,
        draftSummaries: {
          screenshotPrefix: 'Dummy screenshot',
          screenshotUnknownCustomer: 'unknown account',
          callPrefix: 'Dummy call',
          callSummaryMaxLength: 6,
        },
      },
    };

    const screenshotDraft = createDraftFromScreenshotAnalysis({
      customer_name: '',
      wechat_id: '',
      phone_number: '',
      reply_status: 'UNKNOWN',
      intent_level: 'UNKNOWN',
      grade_suggestion: 'UNKNOWN',
      follow_up_result: 'UNKNOWN',
      next_action: '',
      next_follow_up_text: '',
      summary: '',
      evidence: '',
      confidence: 0.2,
    }, undefined, { profile: dummyProfile });
    const callDraft = createDraftFromCallAnalysis({
      summary: '1234567890',
      phone_feedback: 'UNKNOWN',
      intent_level: 'UNKNOWN',
      grade_suggestion: 'UNKNOWN',
      next_action: '',
      next_follow_up_text: '',
      risk: '',
      confidence: 0.3,
    }, undefined, { profile: dummyProfile });

    expect(screenshotDraft.raw_input_summary).toBe('Dummy screenshot: unknown account');
    expect(callDraft.raw_input_summary).toBe('Dummy call: 123456');
  });

  it('uses supplied vertical profile next-action prompt policy', async () => {
    let captured: { system: string; user: string } | null = null;

    const dummyProfile: VerticalRuleProfile = {
      ...getActiveVerticalProfile(),
      key: 'dummy_next_action_profile',
      name: 'Dummy Next Action Profile',
      aiDraft: {
        ...getActiveVerticalProfile().aiDraft,
        nextActionSuggestion: {
          systemPrompt: 'Dummy system prompt',
          emptyValue: 'EMPTY',
          contextLabels: {
            customerName: 'Account',
            customerGrade: 'Segment',
            stage: 'Step',
            intentLevel: 'Intent',
            phoneFeedback: 'Phone',
            wechatAddStatus: 'Channel status',
            phoneNumber: 'Mobile',
            wechatId: 'Channel id',
            contactPerson: 'Person',
            website: 'Site',
            industry: 'Vertical',
            source: 'Source',
            notes: 'Notes',
            recentNotes: 'Recent',
          },
          instructionLines: ['Dummy instruction one', 'Dummy instruction two'],
        },
      },
    };

    const result = await suggestNextActionWithDeepSeek(
      { provider: 'deepseek', apiKey: 'sk-test', model: 'deepseek-chat', baseUrl: 'https://example.test/v1' },
      makeCustomer({ name: 'Acme', wechat_id: null }),
      [],
      { profile: dummyProfile, transport: async request => { captured = request; return { ok: true, status: 200, content: 'Dummy suggestion' }; } },
    );

    expect(result.suggestion).toBe('Dummy suggestion');
    expect(captured!.system).toBe('Dummy system prompt');
    expect(captured!.user).toContain('Account: Acme');
    expect(captured!.user).toContain('Channel id: EMPTY');
    expect(captured!.user).toContain('Dummy instruction one');
  });

  it('uses supplied vertical profile call transcript system prompt policy', async () => {
    let system = '';

    const dummyProfile: VerticalRuleProfile = {
      ...getActiveVerticalProfile(),
      key: 'dummy_call_system_profile',
      name: 'Dummy Call System Profile',
      aiDraft: {
        ...getActiveVerticalProfile().aiDraft,
        callTranscriptSystemPrompt: 'Dummy call system prompt',
      },
    };

    await analyzeCallTranscript(
      { provider: 'deepseek', apiKey: 'sk-test', model: 'deepseek-chat', baseUrl: 'https://example.test/v1' },
      'hello',
      { profile: dummyProfile, transport: async request => { system = request.system; return { ok: true, status: 200, content: JSON.stringify({ summary: 'ok', phone_feedback: 'UNKNOWN', intent_level: 'UNKNOWN', grade_suggestion: 'UNKNOWN', next_action: '', next_follow_up_text: '', risk: '', confidence: 0.5 }) }; } },
    );

    expect(system).toBe('Dummy call system prompt');
  });
});

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  const now = new Date().toISOString();
  return {
    id: 'ai-draft-profile-customer',
    name: 'AI Draft Profile Customer',
    customer_grade: 'C',
    stage: 'NEW_LEAD',
    contact_method: null,
    wechat_id: null,
    phone_number: null,
    website: null,
    region: null,
    industry: null,
    contact_person: null,
    email: null,
    address: null,
    pitch_angle: null,
    qualification_reason: null,
    source: null,
    wechat_search_status: null,
    is_key_decision_maker: 0,
    wechat_add_status: 'NOT_ADDED',
    has_replied: 0,
    intent_level: 'UNKNOWN',
    phone_feedback: null,
    can_schedule_visit: 0,
    visit_scheduled_at: null,
    rough_visit_time_text: null,
    parsed_visit_reminder_at: null,
    time_parse_status: 'NOT_PARSED',
    time_parse_note: null,
    next_follow_up_at: null,
    last_contacted_at: null,
    last_feedback_type: 'UNKNOWN',
    next_action: null,
    no_show_count: 0,
    lost_reason: null,
    payment_status: 'NOT_STARTED',
    deal_amount: null,
    paid_at: null,
    closed_at: null,
    notes: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}
