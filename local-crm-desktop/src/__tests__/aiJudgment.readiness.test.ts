import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildAIJudgmentCandidate,
  type AIJudgmentCandidateInput,
} from '../lib/leadWorkbench/aiJudgmentReadiness';
import type { LeadImportRow } from '../lib/leadWorkbench/types';
import { getActiveVerticalProfile, type VerticalRuleProfile } from '../lib/verticalProfiles';

function makeImportRow(overrides: Partial<LeadImportRow> = {}): LeadImportRow {
  return {
    id: 'import-row-1',
    batch_id: 'batch-1',
    row_index: 0,
    raw_data_json: JSON.stringify({ company_name: 'Readiness Co' }),
    company_name: 'Readiness Co',
    city: 'Foshan',
    industry: 'Manufacturing',
    website: null,
    contact_name: 'Alice',
    mobile: null,
    tel: null,
    email: null,
    score: 86,
    grade: 'S',
    tanji_search_keyword: 'Readiness Co phone',
    matching_reason: 'high score and no direct phone',
    priority_contact_role: 'buyer',
    source_evidence: 'expo booth card and website crawl',
    decision: 'CRM_WITH_LOOKUP',
    decision_status: 'PENDING',
    created_customer_id: null,
    created_work_item_id: null,
    error_message: null,
    created_at: '2026-07-03T00:00:00.000Z',
    updated_at: '2026-07-03T00:00:00.000Z',
    ...overrides,
  };
}

function makeInput(overrides: Partial<AIJudgmentCandidateInput> = {}): AIJudgmentCandidateInput {
  return {
    importRow: makeImportRow(),
    profile: getActiveVerticalProfile(),
    evidenceReferences: [
      { type: 'lead_import_row', id: 'import-row-1' },
      { type: 'source_evidence', id: 'import-row-1:source_evidence' },
    ],
    ...overrides,
  };
}

describe('AIJudgment readiness contract', () => {
  it('builds a non-persisted candidate from import decision, evidence, and profile policy', () => {
    const candidate = buildAIJudgmentCandidate(makeInput());

    expect(candidate.kind).toBe('AI_JUDGMENT_CANDIDATE');
    expect(candidate.persisted).toBe(false);
    expect(candidate.source_type).toBe('lead_import_row');
    expect(candidate.source_id).toBe('import-row-1');
    expect(candidate.profile_id).toBe(getActiveVerticalProfile().key);
    expect(candidate.decision).toBe('CRM_WITH_LOOKUP');
    expect(candidate.recommended_action).toBe('lookup_goal:FIND_PHONE');
    expect(candidate.evidence_references).toEqual([
      { type: 'lead_import_row', id: 'import-row-1' },
      { type: 'source_evidence', id: 'import-row-1:source_evidence' },
    ]);
    expect(candidate.model_id).toBeNull();
    expect(candidate.prompt_id).toBeNull();
    expect(candidate.confidence).toBeNull();
  });

  it('keeps profile-driven output visible without importing the default profile directly', () => {
    const dummyProfile: VerticalRuleProfile = {
      ...getActiveVerticalProfile(),
      key: 'dummy_ai_judgment_profile',
      decision: {
        ...getActiveVerticalProfile().decision,
        lookupGoal: 'VERIFY_COMPANY',
      },
    };

    const candidate = buildAIJudgmentCandidate(makeInput({ profile: dummyProfile }));

    expect(candidate.profile_id).toBe('dummy_ai_judgment_profile');
    expect(candidate.recommended_action).toBe('lookup_goal:VERIFY_COMPANY');
  });

  it('does not create a persisted AIJudgment object, table, model id, or prompt id', () => {
    const source = readFileSync(resolve(__dirname, '../lib/leadWorkbench/aiJudgmentReadiness.ts'), 'utf8');

    expect(source).toContain('AI_JUDGMENT_CANDIDATE');
    expect(source).not.toContain('ai_judgments');
    expect(source).not.toContain('CREATE TABLE');
    expect(source).not.toContain('defaultGeoExportProfile');
    expect(source).not.toMatch(/model_id:\s*['"][^'"]+/);
    expect(source).not.toMatch(/prompt_id:\s*['"][^'"]+/);
  });
});
