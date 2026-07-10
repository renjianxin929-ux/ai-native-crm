import { describe, expect, it } from 'vitest';
import { createAgentTriggerBoundary, createSalesAgentTriggerIntent, type SalesAgentTriggerEvent } from '../lib/salesAgent/triggerSeam';

describe('Stage3 future event trigger seam', () => {
  it.each<SalesAgentTriggerEvent>([
    { kind: 'CustomerCreatedEvent', event_id: 'event-1', occurred_at: '2026-07-11T00:00:00.000Z', customer_id: 'customer-1' },
    { kind: 'InteractionAddedEvent', event_id: 'event-2', occurred_at: '2026-07-11T00:00:00.000Z', customer_id: 'customer-1', interaction_id: 'interaction-1' },
    { kind: 'CustomerUpdatedEvent', event_id: 'event-3', occurred_at: '2026-07-11T00:00:00.000Z', customer_id: 'customer-1', changed_fields: ['grade'] },
  ])('creates an inert intent for $kind without executing anything', event => {
    expect(createSalesAgentTriggerIntent(event)).toMatchObject({
      target_customer_id: 'customer-1',
      status: 'not_scheduled',
      requires_explicit_runtime_invocation: true,
      automatic_execution: false,
      background_worker: false,
      sends_notification: false,
      writes_crm: false,
    });
  });

  it('creates a MOCK runtime activation request but does not invoke the runtime', () => {
    const boundary = createAgentTriggerBoundary({ kind: 'InteractionAddedEvent', event_id: 'event-4', occurred_at: '2026-07-11T00:00:00.000Z', customer_id: 'customer-1', interaction_id: 'interaction-1' });
    expect(boundary).toMatchObject({
      next_boundary: 'SalesAgentRuntime',
      final_boundary: 'HumanReviewContract',
      status: 'request_created_not_invoked',
      runtime_request: {
        target_customer_id: 'customer-1',
        requested_execution_mode: 'MOCK',
        context_resolution: 'required_before_explicit_runtime_invocation',
        profile_resolution: 'required_before_explicit_runtime_invocation',
        requires_human_review: true,
        runtime_invoked: false,
        writes_crm: false,
      },
    });
  });
});
