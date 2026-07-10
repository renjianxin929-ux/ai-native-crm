import { describe, expect, it } from 'vitest';

import { enqueueReasoningJob, recordReasoningResult } from '../lib/aiJobs/aiJobService';
import { InMemoryAIJobRepository } from '../lib/aiJobs/inMemoryAIJobRepository';
import { STAGE2_EVALUATION_FIXTURES } from '../lib/eval/fixtures';

describe('Stage2 Phase3 async reasoning foundation', () => {
  it('stores async job state and a non-executable result without CRM persistence', async () => {
    const repository = new InMemoryAIJobRepository();
    const fixture = STAGE2_EVALUATION_FIXTURES[0];
    const request = { requestId: 'r1', objective: 'Review facts', context: fixture.context, verticalProfile: fixture.profile };
    const job = await enqueueReasoningJob(repository, { jobId: 'j1', request, now: '2026-07-10T00:00:00.000Z' });
    expect(job).toMatchObject({ status: 'queued', automaticCRMAction: false });
    const record = await recordReasoningResult(repository, {
      resultId: 'result-1', jobId: 'j1', now: '2026-07-10T00:01:00.000Z',
      result: { requestId: 'r1', output: { kind: 'AI_REASONING_OUTPUT', version: 'v1', suggestions: [] }, requiresHumanReview: true, executable: false },
    });
    expect(record).toMatchObject({ persistedToCRM: false, executable: false });
    expect(await repository.getJob('j1')).toMatchObject({ status: 'completed' });
  });
});
