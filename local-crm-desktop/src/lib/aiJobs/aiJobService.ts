import { validateReasoningResult } from '../reasoning/reasoningContract';
import type { ReasoningRequest, ReasoningResult } from '../reasoning/types';
import type { AIJob, AIJobRepository, AIReasoningResultRecord } from './types';

export async function enqueueReasoningJob(
  repository: AIJobRepository,
  input: { jobId: string; request: ReasoningRequest; now: string },
): Promise<AIJob> {
  if (await repository.getJob(input.jobId)) throw new Error(`AI job already exists: ${input.jobId}`);
  const job: AIJob = {
    jobId: input.jobId,
    request: input.request,
    status: 'queued',
    createdAt: input.now,
    updatedAt: input.now,
    automaticCRMAction: false,
  };
  await repository.saveJob(job);
  return job;
}

export async function recordReasoningResult(
  repository: AIJobRepository,
  input: { resultId: string; jobId: string; result: ReasoningResult; now: string },
): Promise<AIReasoningResultRecord> {
  const job = await repository.getJob(input.jobId);
  if (!job) throw new Error(`Unknown AI job: ${input.jobId}`);
  const validationErrors = validateReasoningResult(input.result, job.request);
  if (validationErrors.length > 0) throw new Error(validationErrors.join('; '));

  const record: AIReasoningResultRecord = {
    resultId: input.resultId,
    jobId: input.jobId,
    reasoningResult: input.result,
    createdAt: input.now,
    persistedToCRM: false,
    executable: false,
  };
  await repository.saveResult(record);
  await repository.saveJob({ ...job, status: 'completed', updatedAt: input.now });
  return record;
}
