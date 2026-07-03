import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildCallTranscriptPrompt,
  buildWechatScreenshotPrompt,
  createDraftFromCallAnalysis,
  createDraftFromScreenshotAnalysis,
} from '../lib/aiDraft';
import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import {
  ensureLeadWorkbenchSchema,
  listLeadImportRowsByBatchId,
  listLeadWorkItemsByImportRowId,
} from '../lib/leadWorkbench/db';
import { executeLeadImportBatchDecisions } from '../lib/leadWorkbench/decision';
import { importLeadRowsToBatch } from '../lib/leadWorkbench/importer';
import { parseLeadContactText } from '../lib/leadWorkbench/parser';
import { applyWechatPassed, getRecommendedAction } from '../lib/rules';
import type { Customer } from '../lib/types';
import {
  VERTICAL_PROFILE_REQUIRED_SECTIONS,
  getActiveVerticalProfile,
  type VerticalRuleProfile,
} from '../lib/verticalProfiles';
import {
  formatLeadWorkStatusLabel,
  getLeadWorkItemStatusActions,
  getLeadWorkItemStatusUpdateSuccessMessage,
  getLeadWorkItemTerminalMessage,
  getStatusActionConfirmationMessage,
} from '../pages/LeadWorkbenchPage';

const TEST_PROFILE_E2E: VerticalRuleProfile = {
  key: 'TEST_PROFILE_E2E',
  name: 'TEST_PROFILE_E2E Full Chain',
  leadImport: {
    scoreThresholds: {
      crmWithLookup: 60,
      lookupFirst: 40,
    },
    sampleRows: [
      { company_name: 'TEST_PROFILE_SAMPLE_DIRECT', mobile: '13800138001', score: 10 },
      { company_name: 'TEST_PROFILE_SAMPLE_LOOKUP', score: 45 },
    ],
  },
  decision: {
    lookupGoal: 'VERIFY_COMPANY',
    gradePriority: {
      S: 99,
      A: 88,
      C: 44,
    },
    scorePriority: {
      min: 7,
      max: 66,
    },
    defaultPriority: 11,
    lookupKeywordFallback: 'company_name',
  },
  customerAdapter: {
    importRowFallbackName: 'TEST_PROFILE_IMPORT_FALLBACK',
    collectedLeadFallbackName: 'TEST_PROFILE_COLLECTED_FALLBACK',
    collectedLeadDefaultSource: 'TEST_PROFILE_COLLECTED_SOURCE',
    defaultContactMethod: 'WECHAT',
    gradeMapping: {
      S: 'A',
      A: 'B',
      C: 'D',
      default: 'D',
    },
  },
  rules: {
    taskTitles: {
      wechatPassed: 'TEST_PROFILE_WECHAT_TASK',
    },
    recommendedAction: {
      overduePrefix: 'TEST_PROFILE_OVERDUE ',
      byGrade: {
        A: 'TEST_PROFILE_ACTION_A',
        B: 'TEST_PROFILE_ACTION_B',
        C: 'TEST_PROFILE_ACTION_C',
        D: 'TEST_PROFILE_ACTION_D',
        default: 'TEST_PROFILE_ACTION_DEFAULT',
      },
      neverContactedByGrade: {
        A: 'TEST_PROFILE_FIRST_TOUCH_A',
      },
    },
  },
  workItem: {
    statusLabels: {
      TODO: 'TEST_PROFILE_STATUS_TODO',
      SEARCHING: 'TEST_PROFILE_STATUS_SEARCHING',
      STAGED: 'TEST_PROFILE_STATUS_STAGED',
      COLLECTED: 'TEST_PROFILE_STATUS_COLLECTED',
      NO_PHONE: 'TEST_PROFILE_STATUS_NO_PHONE',
      SKIPPED: 'TEST_PROFILE_STATUS_SKIPPED',
      DONE: 'TEST_PROFILE_STATUS_DONE',
    },
    actionLabels: {
      copySearchKeyword: 'TEST_PROFILE_ACTION_COPY',
      startSearch: 'TEST_PROFILE_ACTION_START',
      noPhone: 'TEST_PROFILE_ACTION_NO_PHONE',
      skip: 'TEST_PROFILE_ACTION_SKIP',
    },
    terminalMessages: {
      NO_PHONE: 'TEST_PROFILE_TERMINAL_NO_PHONE',
      SKIPPED: 'TEST_PROFILE_TERMINAL_SKIPPED',
      DONE: 'TEST_PROFILE_TERMINAL_DONE',
    },
    confirmationMessages: {
      NO_PHONE: 'TEST_PROFILE_CONFIRM_NO_PHONE {{companyName}}',
      SKIPPED: 'TEST_PROFILE_CONFIRM_SKIP {{companyName}}',
    },
    statusUpdateSuccessPrefix: 'TEST_PROFILE_UPDATED_TO',
  },
  capture: {
    mobilePattern: String.raw`TEST_PROFILE_MOBILE:(1[3-9]\d{9})`,
    landlineAreaCodes: ['0888'],
    possibleContactTitleSuffixes: ['顾问'],
  },
  aiDraft: {
    wechatScreenshotPrompt: 'TEST_PROFILE_SCREENSHOT_PROMPT',
    callTranscriptPrompt: {
      beforeTranscript: 'TEST_PROFILE_CALL_BEFORE\n',
      afterTranscript: '\nTEST_PROFILE_CALL_AFTER',
    },
    callTranscriptSystemPrompt: 'TEST_PROFILE_CALL_SYSTEM',
    draftSummaries: {
      screenshotPrefix: 'TEST_PROFILE_SCREENSHOT_SUMMARY',
      screenshotUnknownCustomer: 'TEST_PROFILE_UNKNOWN_CUSTOMER',
      callPrefix: 'TEST_PROFILE_CALL_SUMMARY',
      callSummaryMaxLength: 5,
    },
    nextActionSuggestion: {
      systemPrompt: 'TEST_PROFILE_NEXT_ACTION_SYSTEM',
      emptyValue: 'TEST_PROFILE_EMPTY',
      contextLabels: {
        customerName: 'TEST_PROFILE_LABEL_NAME',
        customerGrade: 'TEST_PROFILE_LABEL_GRADE',
        stage: 'TEST_PROFILE_LABEL_STAGE',
        intentLevel: 'TEST_PROFILE_LABEL_INTENT',
        phoneFeedback: 'TEST_PROFILE_LABEL_PHONE_FEEDBACK',
        wechatAddStatus: 'TEST_PROFILE_LABEL_CHANNEL_STATUS',
        phoneNumber: 'TEST_PROFILE_LABEL_PHONE',
        wechatId: 'TEST_PROFILE_LABEL_CHANNEL',
        contactPerson: 'TEST_PROFILE_LABEL_CONTACT',
        website: 'TEST_PROFILE_LABEL_WEBSITE',
        industry: 'TEST_PROFILE_LABEL_INDUSTRY',
        source: 'TEST_PROFILE_LABEL_SOURCE',
        notes: 'TEST_PROFILE_LABEL_NOTES',
        recentNotes: 'TEST_PROFILE_LABEL_RECENT',
      },
      instructionLines: ['TEST_PROFILE_NEXT_ACTION_INSTRUCTION'],
    },
  },
};

describe('vertical profile end-to-end reliability', () => {
  it('lets one complete dummy profile drive import, decision, customer, rules, presentation, capture, and AI policy', async () => {
    const db = await createReadyDb();
    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'TEST_PROFILE_E2E_BATCH', batch_type: 'MANUAL', source_label: null },
        [
          { company_name: 'TEST_PROFILE_DIRECT_CO', mobile: '13800138101', score: 10, grade: 'S' },
          { company_name: 'TEST_PROFILE_CRM_LOOKUP_CO', score: 61, grade: 'A' },
          { company_name: 'TEST_PROFILE_LOOKUP_ONLY_CO', score: 41, grade: 'C' },
        ],
        { profile: TEST_PROFILE_E2E },
      );

      expect(imported.rows.map(row => row.decision)).toEqual([
        'DIRECT_TO_CRM',
        'CRM_WITH_LOOKUP',
        'LOOKUP_FIRST',
      ]);

      await executeLeadImportBatchDecisions(db, imported.batch.id, { profile: TEST_PROFILE_E2E });

      const savedRows = await listLeadImportRowsByBatchId(db, imported.batch.id);
      expect(savedRows.map(row => row.decision_status)).toEqual(['DONE', 'DONE', 'DONE']);

      const customers = await db.select<{
        name: string;
        customer_grade: string;
        contact_method: string | null;
      }>('SELECT name, customer_grade, contact_method FROM customers ORDER BY name ASC');
      expect(customers).toEqual([
        { name: 'TEST_PROFILE_CRM_LOOKUP_CO', customer_grade: 'B', contact_method: 'WECHAT' },
        { name: 'TEST_PROFILE_DIRECT_CO', customer_grade: 'A', contact_method: 'WECHAT' },
      ]);

      const crmLookupItems = await listLeadWorkItemsByImportRowId(db, imported.rows[1].id);
      const lookupOnlyItems = await listLeadWorkItemsByImportRowId(db, imported.rows[2].id);
      expect(crmLookupItems[0]).toMatchObject({
        company_name: 'TEST_PROFILE_CRM_LOOKUP_CO',
        lookup_goal: 'VERIFY_COMPANY',
        priority: 88,
        tanji_search_keyword: 'TEST_PROFILE_CRM_LOOKUP_CO',
      });
      expect(lookupOnlyItems[0]).toMatchObject({
        company_name: 'TEST_PROFILE_LOOKUP_ONLY_CO',
        lookup_goal: 'VERIFY_COMPANY',
        priority: 44,
        tanji_search_keyword: 'TEST_PROFILE_LOOKUP_ONLY_CO',
      });

      expect(getRecommendedAction(
        makeCustomer({ customer_grade: 'A', last_contacted_at: null }),
        { profile: TEST_PROFILE_E2E },
      )).toBe('TEST_PROFILE_FIRST_TOUCH_A');
      expect(applyWechatPassed(makeCustomer(), { profile: TEST_PROFILE_E2E }).tasks[0].title)
        .toBe('TEST_PROFILE_WECHAT_TASK');

      expect(formatLeadWorkStatusLabel('NO_PHONE', { profile: TEST_PROFILE_E2E }))
        .toBe('TEST_PROFILE_STATUS_NO_PHONE');
      expect(getLeadWorkItemStatusActions('TODO', { profile: TEST_PROFILE_E2E }).map(action => action.label))
        .toEqual(['TEST_PROFILE_ACTION_START', 'TEST_PROFILE_ACTION_NO_PHONE', 'TEST_PROFILE_ACTION_SKIP']);
      expect(getLeadWorkItemTerminalMessage('NO_PHONE', { profile: TEST_PROFILE_E2E }))
        .toBe('TEST_PROFILE_TERMINAL_NO_PHONE');
      expect(getStatusActionConfirmationMessage(
        { company_name: 'TEST_PROFILE_CONFIRM_CO' },
        'NO_PHONE',
        { profile: TEST_PROFILE_E2E },
      )).toBe('TEST_PROFILE_CONFIRM_NO_PHONE TEST_PROFILE_CONFIRM_CO');
      expect(getLeadWorkItemStatusUpdateSuccessMessage('NO_PHONE', { profile: TEST_PROFILE_E2E }))
        .toBe('TEST_PROFILE_UPDATED_TO TEST_PROFILE_STATUS_NO_PHONE');

      expect(parseLeadContactText(
        'TEST_PROFILE_MOBILE:13800138202 0888-1234567 王顾问 0757-88889999',
        { profile: TEST_PROFILE_E2E },
      )).toMatchObject({
        mobiles: ['13800138202'],
        tels: ['0888-1234567'],
        possibleContacts: ['王顾问'],
      });

      expect(buildWechatScreenshotPrompt({ profile: TEST_PROFILE_E2E }))
        .toBe('TEST_PROFILE_SCREENSHOT_PROMPT');
      expect(buildCallTranscriptPrompt('CALL BODY', { profile: TEST_PROFILE_E2E }))
        .toBe('TEST_PROFILE_CALL_BEFORE\nCALL BODY\nTEST_PROFILE_CALL_AFTER');
      expect(createDraftFromScreenshotAnalysis({
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
      }, undefined, { profile: TEST_PROFILE_E2E }).raw_input_summary)
        .toBe('TEST_PROFILE_SCREENSHOT_SUMMARY: TEST_PROFILE_UNKNOWN_CUSTOMER');
      expect(createDraftFromCallAnalysis({
        summary: '123456789',
        phone_feedback: 'UNKNOWN',
        intent_level: 'UNKNOWN',
        grade_suggestion: 'UNKNOWN',
        next_action: '',
        next_follow_up_text: '',
        risk: '',
        confidence: 0.3,
      }, undefined, { profile: TEST_PROFILE_E2E }).raw_input_summary)
        .toBe('TEST_PROFILE_CALL_SUMMARY: 12345');
    } finally {
      db.close();
    }
  });

  it('keeps default geo export behavior stable while the dummy profile remains test-only', () => {
    expect(getActiveVerticalProfile().key).toBe('default_geo_export');
    expect(getActiveVerticalProfile()).not.toBe(TEST_PROFILE_E2E);
    expect(getActiveVerticalProfile().leadImport.scoreThresholds).toEqual({
      crmWithLookup: 80,
      lookupFirst: 70,
    });
    expect(getActiveVerticalProfile().decision.lookupGoal).toBe('FIND_PHONE');
    expect(buildWechatScreenshotPrompt()).not.toContain('TEST_PROFILE_');
  });

  it('covers every required profile section and keeps business modules on active resolver boundaries', () => {
    for (const section of VERTICAL_PROFILE_REQUIRED_SECTIONS) {
      expect(TEST_PROFILE_E2E[section]).toBeTruthy();
    }

    const modules = [
      '../lib/leadWorkbench/importer.ts',
      '../lib/leadWorkbench/decision.ts',
      '../lib/leadWorkbench/customerAdapter.ts',
      '../lib/leadWorkbench/parser.ts',
      '../lib/rules.ts',
      '../lib/aiDraft.ts',
      '../pages/LeadImportCenterPage.tsx',
      '../pages/LeadWorkbenchPage.tsx',
    ];

    for (const modulePath of modules) {
      const source = readFileSync(resolve(__dirname, modulePath), 'utf8');
      expect(source).toContain('getActiveVerticalProfile');
      expect(source).not.toContain('defaultGeoExportProfile');
      expect(source).not.toContain('DEFAULT_VERTICAL_PROFILE_ID');
      expect(source).not.toContain('TEST_PROFILE_');
    }
  });
});

function createSqliteDb(): DatabaseLike & { close(): void } {
  const sqlite = new Database(':memory:');

  return {
    async execute(sql: string, bindings: unknown[] = []) {
      const result = sqlite.prepare(sql).run(bindings as never[]);
      return { rowsAffected: Number(result.changes) };
    },
    async select<T>(sql: string, bindings: unknown[] = []) {
      return sqlite.prepare(sql).all(bindings as never[]) as T[];
    },
    close() {
      sqlite.close();
    },
  };
}

async function createReadyDb() {
  const db = createSqliteDb();
  await ensureBaseSchema(db);
  await ensureLeadWorkbenchSchema(db);
  return db;
}

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  const now = new Date().toISOString();
  return {
    id: 'TEST_PROFILE_CUSTOMER',
    name: 'TEST_PROFILE_CUSTOMER',
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
    last_contacted_at: now,
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
