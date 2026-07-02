import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VERTICAL_PROFILE_ID,
  VERTICAL_PROFILE_REQUIRED_SECTIONS,
  VERTICAL_PROFILE_REGISTRY,
  defaultGeoExportProfile,
  getActiveVerticalProfile,
  getVerticalProfile,
} from '../lib/verticalProfiles';

describe('vertical profiles', () => {
  it('registers the geo export profile as the default active profile', () => {
    expect(DEFAULT_VERTICAL_PROFILE_ID).toBe('default_geo_export');
    expect(VERTICAL_PROFILE_REGISTRY[DEFAULT_VERTICAL_PROFILE_ID]).toBe(defaultGeoExportProfile);
    expect(getVerticalProfile(DEFAULT_VERTICAL_PROFILE_ID)).toBe(defaultGeoExportProfile);
    expect(getActiveVerticalProfile()).toBe(defaultGeoExportProfile);
  });

  it('keeps default lead import thresholds and sample rows on the registered profile', () => {
    const profile = getActiveVerticalProfile();

    expect(profile.leadImport.scoreThresholds).toEqual({
      crmWithLookup: 80,
      lookupFirst: 70,
    });
    expect(profile.leadImport.sampleRows).toHaveLength(3);
  });

  it('keeps default decision rules on the registered profile', () => {
    const profile = getActiveVerticalProfile();

    expect(profile.decision).toEqual({
      lookupGoal: 'FIND_PHONE',
      gradePriority: {
        A: 100,
        B: 80,
        C: 60,
      },
      scorePriority: {
        min: 0,
        max: 100,
      },
      defaultPriority: 50,
      lookupKeywordFallback: 'company_name',
    });
  });

  it('keeps default recommended action rules on the registered profile', () => {
    const profile = getActiveVerticalProfile();

    expect(profile.rules.taskTitles).toEqual({
      wechatPassed: '首次微信沟通',
    });
    expect(profile.rules.recommendedAction).toEqual({
      overduePrefix: '【逾期】',
      byGrade: {
        A: '优先电话/微信二次触达，尝试约访',
        B: '补充客户痛点，推动明确下一步动作',
        C: '低频触达，观察反馈后再决定是否升级',
        D: '降低跟进频率或归档观察',
        default: '待评估，建议人工判断',
      },
      neverContactedByGrade: {
        A: '首次触达：优先电话/微信联系，尝试约访',
      },
    });
  });

  it('keeps the required vertical profile policy sections explicit and complete', () => {
    const profile = getActiveVerticalProfile();

    expect(VERTICAL_PROFILE_REQUIRED_SECTIONS).toEqual([
      'leadImport',
      'decision',
      'customerAdapter',
      'rules',
      'workItem',
      'capture',
      'aiDraft',
    ]);
    for (const section of VERTICAL_PROFILE_REQUIRED_SECTIONS) {
      expect(profile[section]).toBeTruthy();
    }
  });

  it('keeps business modules on the active resolver instead of the default geo profile object', () => {
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
    }
  });
});
