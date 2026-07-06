import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DashboardProjectionPanel } from '../components/dashboard/DashboardProjectionPanel';
import {
  assertReadOnlyDashboardProjection,
  buildDashboardProjectionViewModel,
  mapDashboardRowToView,
  summarizeMissingProofs,
} from '../components/dashboard/dashboardProjectionViewModel';
import {
  buildDashboardDataProjectionPlan,
  runDashboardDataProjection,
  type DashboardDataProjectionResult,
} from '../lib/dashboardDataProjectionReadiness';
import { buildDashboardDataProjectionRequestFixtureV1 } from '../lib/dashboardDataProjection/dashboardDataProjectionFixturesV1';

const LOOP_41_CHANGED_FILES = new Set([
  'src/components/dashboard/DashboardProjectionPanel.tsx',
  'src/components/dashboard/dashboardProjectionViewModel.ts',
  'src/__tests__/dashboardProjectionPanel.readiness.test.ts',
  'src/__tests__/actionRunnerBoundaryContract.readiness.test.ts',
  'src/__tests__/confirmedActionLiveDryRun.readiness.test.ts',
  'src/__tests__/confirmedActionReviewQueue.readiness.test.ts',
  'src/__tests__/dashboardDataProjection.readiness.test.ts',
  'src/__tests__/dbWritePlanDryRun.readiness.test.ts',
  'src/__tests__/humanConfirmationContract.readiness.test.ts',
  'src/__tests__/safeWriteRunnerGate.readiness.test.ts',
]);

const PRODUCTION_FILES = [
  'src/components/dashboard/DashboardProjectionPanel.tsx',
  'src/components/dashboard/dashboardProjectionViewModel.ts',
];

const FORBIDDEN_OPERATION_COPY = [
  /\bExecute\b/,
  /\bRun\b/,
  /\bSync\b/,
  /\bApprove\b/,
  /\bConfirm\b/,
  /Mark as done/,
  /Auto-run/,
  /Generate SQL/,
  /\bsuccess\b/i,
  /\bcompleted\b/i,
  /\bsynced\b/i,
  /\bwritten\b/i,
  /\bapproved\b/i,
  /\bconfirmed\b/i,
  /ready to execute/i,
  /ready to write/i,
  /automation complete/i,
  /Write to DB/,
  /Start write/,
  /Run write/,
  /Apply write/,
  /Execute write/,
  /<button[^>]*>\s*Write/i,
];

const FORBIDDEN_STATIC_TERMS = [
  'getDb',
  'db.select',
  'db.execute',
  'db.run',
  'INSERT',
  'UPDATE',
  'DELETE',
  'SELECT',
  'BEGIN TRANSACTION',
  'COMMIT',
  'ROLLBACK',
  'runDashboardDataProjection',
  'runSafeWriteRunnerGate',
  'runDbWritePlanDryRun',
  'runActionRunnerBoundaryContract',
  'runHumanConfirmationContract',
  'runConfirmedActionReviewQueue',
  'runConfirmedActionLiveDryRun',
  'runSuggestOnlyLiveDryRun',
  'ActionRunner',
  'WriteRunner',
  'executeAction',
  'confirmAndExecute',
  'textAIProvider',
  'multimodalProvider',
  'Provider',
  'ModelRouterRuntime',
  'PromptRuntime',
  'providerRuntime',
  'callProvider',
  'invokeWithFixtureAdapter',
  'runEvalDataset',
  'EvalRunner',
  'fetch',
  'axios',
  'process.env',
  'import.meta.env',
  '@tauri-apps',
  'invoke(',
  'localStorage',
  'sessionStorage.setItem',
  'document.',
  'window.',
  'Date.now',
  'Math.random',
  'crypto.randomUUID',
];

describe('Dashboard projection panel readiness', () => {
  it('builds a read-only view model from caller-provided projection data', () => {
    const projection = buildProjectionFixture();
    const viewModel = buildDashboardProjectionViewModel(projection);

    expect(assertReadOnlyDashboardProjection(projection)).toEqual({ valid: true, reason: null });
    expect(viewModel).toMatchObject({
      valid: true,
      stage: 'Safe Write Runner Gate',
      statusBadges: ['Blocked', 'Not Executable', 'No DB Write', 'Read-only'],
    });
    expect(viewModel.summaryCards).toEqual(expect.arrayContaining([
      { label: 'Total rows', value: '2' },
      { label: 'Review required', value: '1' },
      { label: 'Source blocked', value: '1' },
    ]));
    expect(viewModel.rows.map(row => row.title)).toEqual([
      'Dashboard source candidate 1',
      'Dashboard source candidate 2',
    ]);
    expect(viewModel.rows.every(row => row.rowStatus.startsWith('blocked_'))).toBe(true);
    expect(viewModel.missingProofs.map(proof => proof.name)).toEqual([
      'requires_executable_write_plan',
      'requires_real_human_confirmation',
      'requires_resolved_operator',
    ]);
  });

  it('maps rows without unsafe action copy while retaining row details', () => {
    const projection = buildProjectionFixture();
    const row = mapDashboardRowToView(projection.answer.dashboard_rows[0]);

    expect(row.title).toBe('Dashboard source candidate 1');
    expect(row.actionType).toBe('REVIEW_REVIEW_FOLLOW_UP_TASK');
    expect(row.actionType).not.toMatch(/\bConfirm\b/i);
    expect(row.rowStatus).toBe('blocked_requires_real_confirmation');
    expect(row.evidenceRefCount).toBe(1);
    expect(row.riskFlagCount).toBe(2);
    expect(row.missingRequirementNames).toContain('requires_real_human_confirmation');
  });

  it('summarizes missing proof names by affected row', () => {
    const projection = buildProjectionFixture();
    const summary = summarizeMissingProofs(projection.answer.dashboard_rows);

    expect(summary).toEqual([
      {
        name: 'requires_executable_write_plan',
        missingCount: 2,
        affectedRows: ['DASHBOARD_DATA_PROJECTION_LIVE_001', 'DASHBOARD_DATA_PROJECTION_LIVE_002'],
      },
      {
        name: 'requires_real_human_confirmation',
        missingCount: 2,
        affectedRows: ['DASHBOARD_DATA_PROJECTION_LIVE_001', 'DASHBOARD_DATA_PROJECTION_LIVE_002'],
      },
      {
        name: 'requires_resolved_operator',
        missingCount: 2,
        affectedRows: ['DASHBOARD_DATA_PROJECTION_LIVE_001', 'DASHBOARD_DATA_PROJECTION_LIVE_002'],
      },
    ]);
  });

  it('renders static markup with blocked rows and read-only safety notices', () => {
    const projection = buildProjectionFixture();
    const markup = renderToStaticMarkup(createElement(DashboardProjectionPanel, { projection, showTrace: true }));

    expect(markup).toContain('AI Safety Dashboard Projection');
    expect(markup).toContain('Safe Write Runner Gate');
    expect(markup).toContain('Blocked');
    expect(markup).toContain('Not Executable');
    expect(markup).toContain('No DB Write');
    expect(markup).toContain('projection-only');
    expect(markup).toContain('read-only');
    expect(markup).toContain('Dashboard source candidate 1');
    expect(markup).toContain('Dashboard source candidate 2');
    expect(markup).toContain('requires_real_human_confirmation');
    expect(markup).toContain('requires_executable_write_plan');
    expect(markup).toContain('No action was executed.');
    expect(markup).toContain('No DB write happened.');
    expect(markup).toContain('No SQL was generated or executed.');
    expect(markup).toContain('No real human confirmation is represented.');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<form');
    assertNoForbiddenOperationCopy(markup);
  });

  it('keeps component source and rendered markup free of action affordances', () => {
    const source = readProductionSources();
    const markup = renderToStaticMarkup(createElement(DashboardProjectionPanel, { projection: buildProjectionFixture() }));

    for (const text of [source, markup]) {
      assertNoForbiddenOperationCopy(text);
      expect(text).not.toContain('<button');
      expect(text).not.toContain('<form');
      expect(text).not.toContain('type="submit"');
      expect(text).not.toContain('onClick');
    }
    expect(markup).toContain('No DB Write');
    expect(markup).toContain('No DB write happened.');
  });

  it('keeps component and view model free of DB, upstream, provider, network, env, Tauri, DOM, and unstable APIs', () => {
    for (const file of PRODUCTION_FILES) {
      const source = readFileSync(file, 'utf8');

      for (const term of FORBIDDEN_STATIC_TERMS) {
        expect(source).not.toContain(term);
      }
    }

    const viewModelSource = readFileSync('src/components/dashboard/dashboardProjectionViewModel.ts', 'utf8');
    expect(viewModelSource).not.toContain('React');
  });

  it('handles unsafe projection state as an invalid read-only projection', () => {
    const unsafeProjection = {
      ...buildProjectionFixture(),
      answer: {
        ...buildProjectionFixture().answer,
        executable: true,
      },
    } as unknown as DashboardDataProjectionResult;
    const viewModel = buildDashboardProjectionViewModel(unsafeProjection);
    const markup = renderToStaticMarkup(createElement(DashboardProjectionPanel, { projection: unsafeProjection }));

    expect(viewModel.valid).toBe(false);
    expect(markup).toContain('Invalid projection');
    expect(markup).toContain('Invalid projection - not shown as valid.');
    expect(markup).toContain('This dashboard remains read-only.');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<form');
    assertNoForbiddenOperationCopy(markup);
  });

  it('keeps allowed negation copy without globally banning Write', () => {
    const allowed = [
      'No DB Write',
      'no DB write',
      'not executable',
      'projection only',
      'read-only',
    ];

    for (const copy of allowed) {
      expect(() => assertNoForbiddenOperationCopy(copy)).not.toThrow();
    }
  });

  it('fails forbidden operation and unsafe outcome copy checks when introduced', () => {
    for (const copy of [
      'Execute',
      'Approve',
      'Confirm',
      'Generate SQL',
      'success',
      'completed',
      'ready to execute',
      'ready to write',
      'automation complete',
      'Write to DB',
    ]) {
      expect(() => assertNoForbiddenOperationCopy(copy)).toThrow();
    }
  });

  it('does not modify App, route, page, DB, runner, provider, or package files', () => {
    const changedFiles = [
      ...gitLines(['diff', '--name-only']),
      ...gitLines(['diff', '--cached', '--name-only']),
      ...gitLines(['ls-files', '--others', '--exclude-standard']),
    ].map(file => file.replace(/^local-crm-desktop\//, ''))
      .filter(file => file.startsWith('src/') || file === 'package.json' || file.endsWith('lock.yaml'));

    expect(changedFiles.filter(file => !LOOP_41_CHANGED_FILES.has(file))).toEqual([]);
    expect(changedFiles).not.toContain('src/App.tsx');
    expect(changedFiles.filter(file => file.startsWith('src/pages/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src/lib/leadWorkbench/'))).toEqual([]);
    expect(changedFiles.filter(file => file.startsWith('src-tauri/'))).toEqual([]);
    expect(changedFiles.filter(file => file.includes('schema'))).toEqual([]);
    expect(changedFiles).not.toContain('package.json');
  });
});

function buildProjectionFixture(): DashboardDataProjectionResult {
  return runDashboardDataProjection(buildDashboardDataProjectionPlan(
    buildDashboardDataProjectionRequestFixtureV1(),
  ));
}

function readProductionSources(): string {
  return PRODUCTION_FILES.map(file => readFileSync(file, 'utf8')).join('\n');
}

function assertNoForbiddenOperationCopy(text: string): void {
  for (const pattern of FORBIDDEN_OPERATION_COPY) {
    expect(text).not.toMatch(pattern);
  }
}

function gitLines(args: readonly string[]): string[] {
  return execFileSync('git', args, { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
}
