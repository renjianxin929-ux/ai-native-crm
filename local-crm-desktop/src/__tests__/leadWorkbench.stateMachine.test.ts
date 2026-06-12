import { describe, expect, it } from 'vitest';

import {
  assertCollectedLeadSyncStatusTransition,
  assertLeadDecisionStatusTransition,
  assertLeadWorkStatusTransition,
  isCollectedLeadSyncStatusTransitionAllowed,
  isLeadDecisionStatusTransitionAllowed,
  isLeadWorkStatusTransitionAllowed,
} from '../lib/leadWorkbench/stateMachine';

describe('lead workbench state machine', () => {
  it('allows legal status transitions', () => {
    expect(isLeadDecisionStatusTransitionAllowed('PENDING', 'EXECUTING')).toBe(true);
    expect(isLeadDecisionStatusTransitionAllowed('EXECUTING', 'DONE')).toBe(true);
    expect(isLeadDecisionStatusTransitionAllowed('EXECUTING', 'FAILED')).toBe(true);
    expect(isLeadDecisionStatusTransitionAllowed('FAILED', 'EXECUTING')).toBe(true);
    expect(isLeadWorkStatusTransitionAllowed('TODO', 'SEARCHING')).toBe(true);
    expect(isLeadWorkStatusTransitionAllowed('SEARCHING', 'COLLECTED')).toBe(true);
    expect(isCollectedLeadSyncStatusTransitionAllowed('UNSYNCED', 'SYNCED')).toBe(true);
  });

  it('rejects illegal status transitions', () => {
    expect(isLeadDecisionStatusTransitionAllowed('PENDING', 'DONE')).toBe(false);
    expect(isLeadDecisionStatusTransitionAllowed('PENDING', 'FAILED')).toBe(false);
    expect(isLeadDecisionStatusTransitionAllowed('FAILED', 'PENDING')).toBe(false);
    expect(isLeadDecisionStatusTransitionAllowed('DONE', 'PENDING')).toBe(false);
    expect(isLeadDecisionStatusTransitionAllowed('DONE', 'EXECUTING')).toBe(false);
    expect(isLeadDecisionStatusTransitionAllowed('DONE', 'FAILED')).toBe(false);
    expect(isLeadWorkStatusTransitionAllowed('DONE', 'SEARCHING')).toBe(false);
    expect(isCollectedLeadSyncStatusTransitionAllowed('SYNCED', 'UNSYNCED')).toBe(false);

    expect(() => assertLeadDecisionStatusTransition('DONE', 'PENDING')).toThrow('Invalid lead decision status transition');
    expect(() => assertLeadDecisionStatusTransition('PENDING', 'DONE')).toThrow('Invalid lead decision status transition');
    expect(() => assertLeadDecisionStatusTransition('PENDING', 'FAILED')).toThrow('Invalid lead decision status transition');
    expect(() => assertLeadDecisionStatusTransition('FAILED', 'PENDING')).toThrow('Invalid lead decision status transition');
    expect(() => assertLeadDecisionStatusTransition('DONE', 'EXECUTING')).toThrow('Invalid lead decision status transition');
    expect(() => assertLeadDecisionStatusTransition('DONE', 'FAILED')).toThrow('Invalid lead decision status transition');
    expect(() => assertLeadWorkStatusTransition('DONE', 'TODO')).toThrow('Invalid lead work status transition');
    expect(() => assertCollectedLeadSyncStatusTransition('IGNORED', 'SYNCED')).toThrow(
      'Invalid collected lead sync status transition',
    );
  });
});
