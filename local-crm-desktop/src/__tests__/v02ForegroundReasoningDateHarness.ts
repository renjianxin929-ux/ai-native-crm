import { sqliteFixture } from './salesAgentProductionHarness';
import { insertSeededCustomer, type SeededCustomer } from './salesAgentFunctionalFixture';

export function sqliteFixtureFromReasoning() {
  return sqliteFixture();
}

export { insertSeededCustomer, type SeededCustomer };
