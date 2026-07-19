import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabaseSchema, type DatabaseLike } from '../lib/db';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { createTrustedHostSalesAgentAdapter } from '../lib/salesAgentTools/trustedHostAdapter';

function database(): { db: DatabaseLike; close: () => void } {
  const sqlite = new Database(':memory:');
  const db: DatabaseLike = {
    async execute(sql, bindings = []) { const result = sqlite.prepare(sql).run(bindings as never[]); return { rowsAffected: result.changes }; },
    async select<T>(sql, bindings = []) { return sqlite.prepare(sql).all(bindings as never[]) as T[]; },
  };
  return { db, close: () => sqlite.close() };
}

describe('semantic-router-production-wiring', () => {
  it('runs Controller → production adapter → host authorization/execution and preserves one envelope id', async () => {
    const fixture = database();
    await initializeDatabaseSchema(fixture.db);
    const authorize = vi.fn(async request => ({ authorizationId: 'semantic-auth', providerKind: request.providerKind, modelId: request.modelId }));
    const execute = vi.fn(async ({ input }) => ({
      state: 'completed' as const, providerKind: 'DEEPSEEK_COMPATIBLE' as const, modelId: 'deepseek-chat', requestId: 'semantic-auth', latencyMs: 2,
      output: { intent: 'NEXT_ACTION_RECOMMENDATION', confidence: 0.93, customer_reference: null, required_capability: 'TEXT_REASONING', clarification_question: null, extracted_nonwrite_slots: {} },
      tokenUsage: null,
    }));
    const host = createTrustedHostSalesAgentAdapter({ context_snapshot_id: 'snapshot-1', profile_id: 'foreign_trade_geo', authorize, execute });
    const controller = new SalesAgentInteractionController({ db: fixture.db, createSession: () => null, semantic_intent_router: host.routeSemanticIntent });
    controller.syncExternalScope('customer-1', 'Ada');
    const turn = await controller.submit('这个局面你怎么看');

    expect(turn.state.intent_envelope).toMatchObject({ intent: 'NEXT_ACTION_PREPARATION', parser_source: 'trusted_host_semantic_intent_v1' });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ capability: 'SEMANTIC_INTENT_ROUTING', workflowKind: 'interaction_intelligence' }));
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ envelope_id: turn.state.intent_envelope?.envelope_id }) }));
    fixture.close();
  });

  it('returns a natural clarification when the semantic provider is unavailable', async () => {
    const fixture = database();
    await initializeDatabaseSchema(fixture.db);
    const controller = new SalesAgentInteractionController({ db: fixture.db, createSession: () => null, semantic_intent_router: async () => { throw new Error('missing_host_provider'); } });
    const turn = await controller.submit('这个局面你怎么看');
    expect(turn.state.phase).toBe('clarification');
    expect(turn.state.agent_message).toMatch(/未配置|请明确/);
    expect(turn.state.agent_message).not.toMatch(/SAFE_FALLBACK|Mock/i);
    fixture.close();
  });
});
